// Optional WebGL terrain. No idle animation loop; the HTML bars and buttons remain usable.
(() => {
  let engine=null,pending=null,queued=false,disabled=false;
  const desktop=matchMedia('(min-width:769px)');
  // No automatic motion or tweening, including when reduced motion is requested.
  function target(){return !disabled&&desktop.matches&&!document.hidden?document.querySelector('#view-etf2.active .etf-terrain'):null;}
  function destroy(){engine?.dispose();engine=null;}
  async function sync(){
    const host=target();
    if(engine&&(engine.host!==host||engine.data!==host?.dataset.holdings))destroy();
    if(!host)return;
    if(engine){engine.refresh();return;}
    if(pending)return;
    try{
      pending=import('./vendor/three.module.min.js');const T=await pending;
      if(target()!==host)return;
      const rows=JSON.parse(host.dataset.holdings||'[]');if(!rows.length)return;
      engine=create(T,host,rows);
    }catch(e){console.warn('[ETF 3D fallback]',e);disabled=true;destroy();}
    finally{pending=null;}
  }
  function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;sync();});}
  function create(T,host,rows){
    const renderer=new T.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.setClearColor(0,0);
    renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;
    const scene=new T.Scene(),group=new T.Group();scene.add(group);
    const camera=new T.PerspectiveCamera(37,1,.1,50);camera.position.set(5.4,5.6,7.6);camera.lookAt(0,.6,0);
    scene.add(new T.AmbientLight(0xdbeafe,2));
    const key=new T.DirectionalLight(0xffffff,4);key.position.set(3,7,4);scene.add(key);
    const rim=new T.DirectionalLight(0x55ddff,3);rim.position.set(-4,3,-3);scene.add(rim);
    const grid=new T.GridHelper(6,12,0x56779d,0x345572);grid.material.transparent=true;grid.material.opacity=.22;group.add(grid);
    const colors=[0x5b9bff,0x4ecdc4,0xc084fc,0xf2a33c],max=Math.max(...rows.map(h=>h.w)),meshes=[];
    rows.forEach((h,i)=>{
      const height=h.w/max*2.5;
      const material=new T.MeshPhysicalMaterial({color:colors[Math.floor(i/4)],roughness:.24,metalness:.22,clearcoat:1,clearcoatRoughness:.15});
      const mesh=new T.Mesh(new T.BoxGeometry(.82,height,.82),material);
      mesh.position.set((i%4-1.5)*1.1,height/2,(Math.floor(i/4)-1)*1.1);mesh.userData={ticker:cbStrip(h.t),name:h.n,w:h.w};group.add(mesh);meshes.push(mesh);
      const edges=new T.LineSegments(new T.EdgesGeometry(mesh.geometry),new T.LineBasicMaterial({color:0xc7efff,transparent:true,opacity:.32}));mesh.add(edges);
    });
    const canvas=renderer.domElement;canvas.setAttribute('aria-hidden','true');host.appendChild(canvas);host.classList.add('has-3d');
    const label=document.createElement('div');label.className='etf-terrain-label';label.setAttribute('aria-hidden','true');host.appendChild(label);
    let visible=true,dead=false,down=null,hover=null;
    const ray=new T.Raycaster(),point=new T.Vector2();
    function draw(){if(!dead&&visible&&!document.hidden)renderer.render(scene,camera);}
    function resize(){if(dead)return;const box=host.getBoundingClientRect();if(!box.width||!box.height)return;renderer.setSize(box.width,box.height,false);camera.aspect=box.width/box.height;camera.updateProjectionMatrix();draw();}
    function refresh(){
      const selected=host.dataset.selected;
      meshes.forEach(m=>{m.material.emissive.setHex(m===hover||m.userData.ticker===selected?0x174673:0);m.material.emissiveIntensity=.9;});
      const h=hover?.userData||meshes.find(m=>m.userData.ticker===selected)?.userData;
      const text=h?`${h.ticker} · ${h.w.toFixed(2)}%`:'';if(label.textContent!==text)label.textContent=text;draw();
    }
    function hit(event){const b=canvas.getBoundingClientRect();point.set((event.clientX-b.left)/b.width*2-1,-(event.clientY-b.top)/b.height*2+1);ray.setFromCamera(point,camera);return ray.intersectObjects(meshes,false)[0]?.object||null;}
    canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;down={x:e.clientX,y:e.clientY,angle:group.rotation.y,moved:false};canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{
      if(down){const dx=e.clientX-down.x;if(Math.abs(dx)>4||Math.abs(e.clientY-down.y)>4)down.moved=true;group.rotation.y=down.angle+dx*.009;draw();}
      else{hover=hit(e);canvas.style.cursor=hover?'pointer':'grab';refresh();}
    });
    canvas.addEventListener('pointerup',e=>{const click=down&&!down.moved;down=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(click){const h=hit(e);if(h)etfSelect(h.userData.ticker);}});
    canvas.addEventListener('pointercancel',()=>{down=null;});canvas.addEventListener('pointerleave',()=>{hover=null;refresh();});
    const contextLost=e=>{e.preventDefault();disabled=true;destroy();};canvas.addEventListener('webglcontextlost',contextLost);
    const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(host);
    const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)resize();});intersection.observe(host);resize();refresh();
    return {host,data:host.dataset.holdings,refresh,dispose(){
      dead=true;resizeObserver.disconnect();intersection.disconnect();
      scene.traverse(o=>{o.geometry?.dispose();if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());});
      canvas.removeEventListener('webglcontextlost',contextLost);renderer.dispose();renderer.forceContextLoss();canvas.remove();label.remove();host.classList.remove('has-3d');
    }};
  }
  new MutationObserver(schedule).observe(document.getElementById('content-area')||document.querySelector('.content-area'),{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-selected','data-holdings']});
  desktop.addEventListener('change',schedule);document.addEventListener('visibilitychange',schedule);
  addEventListener('pagehide',destroy);addEventListener('pageshow',schedule);
  window.EtfTerrain={sync:schedule};schedule();
})();
