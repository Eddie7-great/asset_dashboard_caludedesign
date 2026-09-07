// Progressive enhancement: the SVG and accessible legend remain the source of truth.
// Three.js is local, version-pinned, and loaded only for a visible desktop chart.
(() => {
  'use strict';
  const desktop = matchMedia('(min-width:769px)');
  const motion = matchMedia('(prefers-reduced-motion:reduce)');
  let engine, modulePromise, pending = 0, disposed = false;
  let observer;
  const findHost = () => document.querySelector('#view-cdash.active .cb-allocation-visual');
  const sync = () => {
    if (pending || disposed) return;
    pending = requestAnimationFrame(() => { pending=0; reconcile(); });
  };
  async function reconcile() {
    const host=findHost();
    if(engine && (engine.host!==host || !desktop.matches)) { engine.destroy(); engine=null; }
    if(!host || !desktop.matches) return;
    if(engine) { engine.update(); return; }
    const rect=host.getBoundingClientRect();
    if(rect.bottom<0 || rect.top>innerHeight) return;
    if(host.dataset.webglFailed==='true') return;
    try {
      const THREE=await (modulePromise ||= import('./vendor/three.module.min.js'));
      if(disposed || findHost()!==host || !desktop.matches || engine) return;
      engine=createChart(THREE,host);
    } catch(error) {
      host.dataset.webglFailed='true';
      host.classList.remove('has-3d');
      console.warn('[allocation 3D] SVG fallback',error);
    }
  }
  function createChart(T,host) {
    const canvas=document.createElement('canvas');
    canvas.setAttribute('aria-hidden','true');
    const renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'low-power'});
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));
    renderer.setClearColor(0x000000,0);
    const scene=new T.Scene();
    const camera=new T.OrthographicCamera(-1.65,1.65,1.4,-1.4,.1,20);
    camera.position.set(0,-3.4,6); camera.lookAt(0,0,0);
    scene.add(new T.HemisphereLight(0xffffff,0x7482a2,2.7));
    const key=new T.DirectionalLight(0xffffff,3.2); key.position.set(-3,-4,6); scene.add(key);
    const rim=new T.DirectionalLight(0xaabfff,2); rim.position.set(3,2,3); scene.add(rim);
    const group=new T.Group(); scene.add(group);
    const raycaster=new T.Raycaster(),pointer=new T.Vector2();
    let meshes=[],signature='',hover='',frame=0,dead=false,visible=true;
    const cancel=()=>{if(frame)cancelAnimationFrame(frame);frame=0;};
    const freeMeshes=()=>{meshes.forEach(mesh=>{mesh.geometry.dispose();mesh.material.dispose();group.remove(mesh);});meshes=[];};
    function render(){
      frame=0;
      if(dead || !visible || document.hidden) return;
      let moving=false;
      const selected=host.dataset.selected||'';
      meshes.forEach(mesh=>{
        const active=mesh.userData.key===(hover||selected);
        const target=active ? .17 : 0;
        const dz=target-mesh.position.z;
        mesh.position.z=motion.matches?target:Math.abs(dz)<.001?target:mesh.position.z+dz*.22;
        mesh.material.emissiveIntensity=active ? .12 : 0;
        if(Math.abs(target-mesh.position.z)>.001)moving=true;
      });
      renderer.render(scene,camera);
      if(moving&&!motion.matches)request();
    }
    function request(){if(!frame&&!dead&&visible&&!document.hidden)frame=requestAnimationFrame(render);}
    function update(){
      if(dead)return;
      const theme=document.body.dataset.theme||'light';
      const next=host.dataset.allocation+'|'+theme;
      if(next!==signature){
        signature=next;freeMeshes();
        const segments=JSON.parse(host.dataset.allocation||'[]').filter(s=>s.v>0);
        const total=segments.reduce((sum,s)=>sum+s.v,0);
        let angle=Math.PI/2;
        segments.forEach(s=>{
          const sweep=s.v/total*Math.PI*2;
          const gap=Math.min(.025,sweep*.12);
          const start=angle+gap/2,end=angle+sweep-gap/2;
          const shape=new T.Shape();
          shape.absarc(0,0,1.15,start,end,false);
          shape.absarc(0,0,.7,end,start,true);
          shape.closePath();
          const geometry=new T.ExtrudeGeometry(shape,{depth:.16,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.018,bevelThickness:.018,curveSegments:64});
          const material=new T.MeshPhysicalMaterial({color:s.color,roughness:.28,metalness:.12,clearcoat:.7,clearcoatRoughness:.25,emissive:s.color,emissiveIntensity:0});
          const mesh=new T.Mesh(geometry,material);mesh.userData.key=s.key;meshes.push(mesh);group.add(mesh);angle+=sweep;
        });
      }
      request();
    }
    function resize(){
      const {width,height}=host.getBoundingClientRect();
      if(!width||!height)return;
      renderer.setSize(width,height,false);
      const halfH=1.43,halfW=Math.max(1.43,halfH*width/height);
      camera.left=-halfW;camera.right=halfW;camera.top=halfH;camera.bottom=-halfH;camera.updateProjectionMatrix();request();
    }
    function hit(event){
      const r=canvas.getBoundingClientRect();
      pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);
      raycaster.setFromCamera(pointer,camera);
      return raycaster.intersectObjects(meshes)[0]?.object.userData.key||'';
    }
    const move=e=>{const next=hit(e);if(next!==hover){hover=next;canvas.style.cursor=hover?'pointer':'default';request();}};
    const leave=()=>{hover='';request();};
    const click=e=>{const key=hit(e);if(key&&typeof window.cbDashAllocToggle==='function')window.cbDashAllocToggle(key);};
    const visibility=()=>{if(document.hidden)cancel();else request();};
    const lost=e=>{e.preventDefault();host.dataset.webglFailed='true';destroy();if(engine?.host===host)engine=null;};
    const resizeObserver=new ResizeObserver(resize);
    const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)request();else cancel();});
    function destroy(){
      if(dead)return;dead=true;cancel();freeMeshes();resizeObserver.disconnect();intersection.disconnect();
      document.removeEventListener('visibilitychange',visibility);
      canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerleave',leave);canvas.removeEventListener('click',click);canvas.removeEventListener('webglcontextlost',lost);
      renderer.dispose();renderer.forceContextLoss();canvas.remove();host.classList.remove('has-3d');
    }
    try {
      canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerleave',leave);canvas.addEventListener('click',click);canvas.addEventListener('webglcontextlost',lost);
      document.addEventListener('visibilitychange',visibility);
      host.append(canvas);resizeObserver.observe(host);intersection.observe(host);
      update();resize();renderer.render(scene,camera);host.classList.add('has-3d');
      return {host,update,destroy};
    } catch(error) {destroy();throw error;}
  }
  observer=new MutationObserver(sync);
  observer.observe(document.querySelector('.content-area')||document.body,{childList:true,subtree:true});
  desktop.addEventListener('change',sync);motion.addEventListener('change',sync);
  document.addEventListener('scroll',sync,{capture:true,passive:true});
  window.addEventListener('pagehide',()=>{disposed=true;if(pending)cancelAnimationFrame(pending);pending=0;observer.disconnect();engine?.destroy();engine=null;});
  window.addEventListener('pageshow',()=>{if(disposed){disposed=false;observer.observe(document.querySelector('.content-area')||document.body,{childList:true,subtree:true});sync();}});
  window.AssetAllocation3D={sync};sync();
})();
