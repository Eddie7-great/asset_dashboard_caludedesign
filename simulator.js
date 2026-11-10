// Ephemeral scenarios: this module never writes portfolio data, goals or KV.
let _simOwner='전체',_simState=null;
let _simView='backtest';
function simView(view){_simView=['allocation','retire'].includes(view)?view:'backtest';cbRenderSimulator();cbRestoreFilterFocus('cb-sim2','data-sim-view',_simView);}

// Allocate a fixed new contribution, without selling existing assets. Rounded to KRW.
function simCalculate(current,weights,monthly,months,mode='gap'){
  const keys=Object.keys(FIN_DEFAULT_TARGET);
  const validNumber=x=>typeof x==='number'&&Number.isFinite(x);
  if(!validNumber(monthly)||monthly<0||monthly>100000000||!Number.isInteger(months)||months<1||months>120)
    return {error:'월 투자금은 0~10,000만원, 기간은 1~120개월로 입력해 주세요.'};
  if(keys.some(k=>!validNumber(weights[k])||weights[k]<0||weights[k]>100))
    return {error:'모든 목표 비중에 0~100 사이의 숫자를 입력해 주세요.'};
  const weightSum=keys.reduce((s,k)=>s+weights[k],0);
  if(Math.abs(weightSum-100)>0.001)return {error:`목표 비중 합계를 100%로 맞춰 주세요. 현재 ${Number(weightSum.toFixed(2))}%입니다.`};
  if(keys.some(k=>!validNumber(current[k])||current[k]<0))return {error:'현재 자산 평가액을 확인해 주세요.'};
  const total=keys.reduce((s,k)=>s+current[k],0),budget=Math.round(monthly*months),afterTotal=total+budget;
  const scores=keys.map(k=>mode==='target'?weights[k]:Math.max(0,afterTotal*weights[k]/100-current[k]));
  const scoreTotal=scores.reduce((s,n)=>s+n,0);
  const raw=scores.map(n=>scoreTotal?budget*n/scoreTotal:0),buys=raw.map(Math.floor);
  let remainder=budget-buys.reduce((s,n)=>s+n,0);
  const ranks=keys.map((_,i)=>i).sort((a,b)=>(raw[b]-buys[b])-(raw[a]-buys[a]));
  for(const idx of ranks){if(remainder<=0)break;buys[idx]++;remainder--;}
  const rows=keys.map((key,i)=>({key,current:current[key],buy:buys[i],after:current[key]+buys[i],target:weights[key],beforePct:total?current[key]/total*100:0,afterPct:afterTotal?(current[key]+buys[i])/afterTotal*100:0}));
  const beforeGap=total?rows.reduce((s,r)=>s+Math.abs(r.beforePct-r.target),0)/2:null;
  const afterGap=afterTotal?rows.reduce((s,r)=>s+Math.abs(r.afterPct-r.target),0)/2:null;
  return {total,budget,afterTotal,rows,beforeGap,afterGap};
}
function simDefaults(){
  const saved=window._targetAlloc?.groups||FIN_DEFAULT_TARGET;
  const monthly=finRows(finOwnerF(_simOwner)).reduce((s,r)=>s+cbDcaPerMonthKRW(r.i),0);
  return {monthly:monthly>0?Math.min(10000,Math.round(monthly/1000)/10):100,months:12,mode:'gap',weights:Object.fromEntries(Object.keys(FIN_DEFAULT_TARGET).map(k=>[k,Number(saved[k]??FIN_DEFAULT_TARGET[k])]))};
}
function cbRenderSimulator(){
  const el=document.getElementById('cb-sim2');if(!el)return;
  if(!_simState)_simState=simDefaults();
  const s=_simState;
  cbSetHead('입력값을 바꿔 추가 투자 후 자산 배분을 비교합니다 · 저장되지 않는 가상 계산',cbOwnerBtns(_simOwner,'simOwner'));
  el.innerHTML=`<div class="sim-view-tabs"><button class="cb-btn" data-sim-view="backtest" aria-pressed="${_simView==='backtest'}" onclick="simView('backtest')">과거 성과 백테스트</button><button class="cb-btn" data-sim-view="allocation" aria-pressed="${_simView==='allocation'}" onclick="simView('allocation')">추가 투자 배분</button><button class="cb-btn" data-sim-view="retire" aria-pressed="${_simView==='retire'}" onclick="simView('retire')">은퇴 자금 예상</button></div><div ${_simView==='retire'?'':'hidden'}>${retHtml()}</div><div ${_simView==='backtest'?'':'hidden'}>${btHtml()}</div><div class="sim-future" ${_simView==='allocation'?'':'hidden'}>
    <div class="sim-mobile-preview"><span id="sim-mobile-total"></span><button class="cb-btn" onclick="document.querySelector('.sim-results').scrollIntoView({behavior:'smooth',block:'start'})">배분 보기 ↓</button></div>
    <div class="sim-layout"><section class="cb-panel sim-controls" aria-label="시뮬레이션 조건"><div class="fin-section-head"><span>투자 조건</span><button class="cb-btn" onclick="simReset()">초기화</button></div>
      <label class="sim-field" for="sim-monthly">월 투자금 <span>만원</span><input id="sim-monthly" type="number" data-no-comma="1" inputmode="decimal" min="0" max="10000" step="any" value="${s.monthly}" oninput="simInput('monthly',this.value)"></label>
      <input class="sim-range" id="sim-monthly-range" type="range" aria-label="월 투자금 조절 (만원)" min="0" max="10000" step="10" value="${s.monthly}" oninput="simInput('monthly',this.value)">
      <label class="sim-field" for="sim-months">적립 기간 <span>개월</span><input id="sim-months" type="number" data-no-comma="1" min="1" max="120" step="1" value="${s.months}" oninput="simInput('months',this.value)"></label>
      <input class="sim-range" id="sim-months-range" type="range" aria-label="적립 기간 조절 (개월)" min="1" max="120" step="1" value="${s.months}" oninput="simInput('months',this.value)">
      <fieldset class="sim-strategy"><legend>추가 투자금 배분 방식</legend><label><input type="radio" name="sim-mode" value="gap" ${s.mode==='gap'?'checked':''} onchange="simMode(this.value)"> 부족한 비중 우선</label><label><input type="radio" name="sim-mode" value="target" ${s.mode==='target'?'checked':''} onchange="simMode(this.value)"> 목표 비중 그대로</label></fieldset>
      <div class="fin-section-head sim-target-head"><span>가상 목표 비중</span><button class="cb-btn" onclick="simLoadTargets()">저장 목표 불러오기</button></div>
      <div class="sim-weights">${Object.entries(CB_CLS).map(([k,m])=>`<div class="sim-weight"><label for="sim-${k}"><i style="background:${m.color}"></i>${m.label}</label><input id="sim-${k}" type="number" data-no-comma="1" min="0" max="100" step="any" value="${s.weights[k]}" oninput="simWeight('${k}',this.value)"><span>%</span><input id="sim-${k}-range" class="sim-range" type="range" aria-label="${m.label} 목표 비중 조절" min="0" max="100" step="1" value="${s.weights[k]}" oninput="simWeight('${k}',this.value)"></div>`).join('')}</div>
      <p id="sim-weight-total" class="sim-weight-total"></p>
    </section><section class="sim-results" aria-label="예상 자산 배분"><p id="sim-error" class="sim-error" role="status" hidden></p><div id="sim-result"></div></section></div>
    <p class="sim-assumptions">계산 기준: 현재 주가·환율 유지, 수익률 0%, 매도 없음. 세금·수수료·배당·매수 단위는 제외합니다. 추가 투자금은 기존 보유 현금에서 차감하지 않는 새 자금입니다. 부족한 비중 우선 방식은 적립 기간 전체 금액을 투자한 뒤의 목표 부족액에 비례 배분합니다. 이 화면의 변경은 원장·목표·적립식 규칙에 저장되지 않습니다.</p></div>`;
  simUpdate();
  retUpdate();
}
function simValue(value){ return String(value).trim()===''?NaN:Number(value); }
function simInput(key,value){_simState[key]=simValue(value);simSyncPair('sim-'+key,value);simUpdate();}
function simWeight(key,value){_simState.weights[key]=simValue(value);simSyncPair('sim-'+key,value);simUpdate();}
function simSyncPair(id,value){
  [id,id+'-range'].forEach(key=>{const el=document.getElementById(key);if(el&&el!==document.activeElement)el.value=value;});
}
function simMode(value){_simState.mode=value;simUpdate();}
function simOwner(owner){_simOwner=owner;if(_retState&&_retState.currentAuto)_retState=null;cbRenderSimulator();cbRestoreFilterFocus('cb-head-widgets','data-owner',owner);}
function simReset(){_simState=simDefaults();cbRenderSimulator();document.getElementById('sim-monthly')?.focus();}
function simLoadTargets(){
  _simState.weights=simDefaults().weights;
  Object.entries(_simState.weights).forEach(([k,v])=>simSyncPair('sim-'+k,v));simUpdate();
}
function simUpdate(){
  const current=Object.fromEntries(Object.keys(FIN_DEFAULT_TARGET).map(k=>[k,0]));
  const rows=finRows(finOwnerF(_simOwner));rows.forEach(r=>{current[r.cls]+=r.val;});
  const s=_simState,r=simCalculate(current,s.weights,s.monthly*10000,s.months,s.mode);
  const sum=Object.values(s.weights).reduce((a,b)=>a+b,0);
  document.getElementById('sim-weight-total').textContent=`목표 합계 ${Number.isFinite(sum)?Number(sum.toFixed(2)):'—'}% / 100%`;
  const error=document.getElementById('sim-error'),result=document.getElementById('sim-result');
  error.hidden=!r.error;error.textContent=r.error||'';result.hidden=!!r.error;
  document.getElementById('sim-mobile-total').textContent=r.error||`투자 후 ${cbDisp(r.afterTotal)}`;
  document.getElementById('sim-weight-total').classList.toggle('invalid',!!r.error);
  if(r.error)return;
  const stack=(field,label)=>`<div class="sim-stack" role="img" aria-label="${label}: ${r.rows.map(x=>CB_CLS[x.key].label+' '+x[field].toFixed(1)+'%').join(', ')}">${r.rows.filter(x=>x[field]>0).map(x=>`<span style="width:${x[field]}%;background:${CB_CLS[x.key].color}" data-tip="${CB_CLS[x.key].label} ${x[field].toFixed(1)}%"></span>`).join('')}</div>`;
  result.innerHTML=`<div class="sim-kpis"><div class="cb-panel"><small>현재 투자자산 · ${cbEsc(_simOwner)}</small><b>${cbDisp(r.total)}</b></div><div class="cb-panel"><small>${s.months}개월 추가 투자금</small><b class="sim-accent">+${cbDisp(r.budget)}</b></div><div class="cb-panel"><small>투자 후 합계 · 수익 제외</small><b>${cbDisp(r.afterTotal)}</b></div></div>
    <div class="cb-panel sim-comparison"><div class="fin-section-head"><span>투자 전후 비교</span><small>${s.mode==='gap'?'부족한 비중 우선':'목표 비중 그대로'}</small></div>
      ${!rows.length?'<p class="sim-empty">보유 자산이 없습니다. 새 투자금만으로 시작하는 배분을 보여드립니다.</p>':''}
      ${rows.some(x=>x.i._priceStale)?'<p class="sim-empty">최신 시세 미확인 자산이 있어 마지막 저장 가격을 사용합니다.</p>':''}
      <div class="sim-stack-label"><span>현재 비중</span><b>${cbDisp(r.total)}</b></div>${stack('beforePct','현재 비중')}
      <div class="sim-stack-label"><span>투자 후 비중</span><b>${cbDisp(r.afterTotal)}</b></div>${stack('afterPct','투자 후 비중')}
      <div class="sim-legend">${Object.entries(CB_CLS).map(([k,m])=>`<span><i style="background:${m.color}"></i>${m.label}</span>`).join('')}</div>
      <p class="sim-gap">목표와의 비중 차이 <b>${r.beforeGap==null?'—':r.beforeGap.toFixed(1)+'%p'} → ${r.afterGap==null?'—':r.afterGap.toFixed(1)+'%p'}</b><small>자산군별 절대 비중 차이 합계의 절반 · 작을수록 목표에 가깝습니다</small></p>
    </div>
    <div class="cb-panel sim-breakdown"><div class="fin-section-head"><span>자산군별 배분</span><small>추가 투자금 전체 기준</small></div><div class="sim-row sim-table-head"><span>자산군</span><span>추가 투자</span><span>현재 → 투자 후</span><span>목표</span></div>${r.rows.map(x=>`<div class="sim-row"><span><i style="background:${CB_CLS[x.key].color}"></i>${CB_CLS[x.key].label}</span><b>${cbDisp(x.buy)}</b><span>${x.beforePct.toFixed(1)}% <em>→</em> ${x.afterPct.toFixed(1)}%</span><span>${x.target}%</span></div>`).join('')}</div>`;
}

// ── 은퇴 자금 예상 ────────────────────────────────────────────
// 입력한 가정(수익률·물가)으로 은퇴 시점 자산과 매달 꺼내 쓸 수 있는 금액을 '오늘 돈의 가치'로 어림한다.
// 예측이 아니라 가정의 산수다. 저장하지 않고, 세금·수수료·국민연금 등 다른 소득·환율은 넣지 않는다.
let _retState=null;
function retCalculate(input){
  const {age,retireAge,endAge,current,monthly,ret,infl}=input||{};
  const num=x=>typeof x==='number'&&Number.isFinite(x);
  if(![age,retireAge,endAge,current,monthly,ret,infl].every(num)) return {error:'모든 칸에 숫자를 입력해 주세요.'};
  if(!Number.isInteger(age)||!Number.isInteger(retireAge)||!Number.isInteger(endAge)||age<0||age>99) return {error:'나이는 0~99 사이의 정수로 입력해 주세요.'};
  if(retireAge<=age||retireAge>100) return {error:'은퇴 나이는 현재 나이보다 크고 100세 이하여야 합니다.'};
  if(endAge<=retireAge||endAge>120) return {error:'인출을 마치는 나이는 은퇴 나이보다 크고 120세 이하여야 합니다.'};
  if(current<0||monthly<0||current>1e13||monthly>1e9) return {error:'현재 자산과 월 적립액을 확인해 주세요.'};
  if(ret<-10||ret>20||infl<-5||infl>15) return {error:'수익률은 -10~20%, 물가상승률은 -5~15% 사이로 입력해 주세요.'};
  // 물가를 뺀 실질 수익률로 계산하므로 결과가 모두 오늘 돈의 가치다.
  const real=(1+ret/100)/(1+infl/100)-1, rm=Math.pow(1+real,1/12)-1;
  const n=(retireAge-age)*12, m=(endAge-retireAge)*12;
  const grow=Math.pow(1+rm,n);
  const fv=current*grow+monthly*(Math.abs(rm)<1e-12?n:(grow-1)/rm);
  const withdraw=Math.abs(rm)<1e-12?fv/m:fv*rm/(1-Math.pow(1+rm,-m));
  const series=[];
  let bal=current;
  for(let a=age;a<=endAge;a++){
    series.push({age:a,bal:Math.max(0,bal)});
    for(let k=0;k<12;k++) bal=a<retireAge?bal*(1+rm)+monthly:bal*(1+rm)-withdraw;
  }
  const contributed=current+monthly*n;
  return {fv,withdraw,contributed,growth:fv-contributed,realRate:real*100,months:n,drawMonths:m,series};
}
function retDefaults(){
  const rows=finRows(finOwnerF(_simOwner));
  const current=rows.reduce((s,r)=>s+r.val,0), monthly=rows.reduce((s,r)=>s+cbDcaPerMonthKRW(r.i),0);
  return {age:40,retireAge:60,endAge:90,current:Math.round(current/10000),monthly:Math.round(monthly/1000)/10,ret:4,infl:2,currentAuto:true};
}
function retField(key,label,unit,attrs){
  const s=_retState;
  return `<label class="sim-field" for="ret-${key}">${label} <span>${unit}</span><input id="ret-${key}" type="number" data-no-comma="1" inputmode="decimal" ${attrs} value="${s[key]}" oninput="retInput('${key}',this.value)"></label>`;
}
function retHtml(){
  if(!_retState)_retState=retDefaults();
  return `<div class="sim-layout"><section class="cb-panel sim-controls" aria-label="은퇴 자금 가정"><div class="fin-section-head"><span>가정</span><button class="cb-btn" onclick="retReset()">초기화</button></div>
      ${retField('age','현재 나이','세','min="0" max="99" step="1"')}
      ${retField('retireAge','은퇴 나이','세','min="1" max="100" step="1"')}
      ${retField('endAge','인출을 마치는 나이','세','min="2" max="120" step="1"')}
      ${retField('current','현재 투자자산','만원','min="0" step="any"')}
      ${retField('monthly','은퇴 전 월 적립액','만원','min="0" step="any"')}
      ${retField('ret','연 수익률 가정','%','min="-10" max="20" step="any"')}
      ${retField('infl','연 물가상승률 가정','%','min="-5" max="15" step="any"')}
      <p class="sim-weight-total">현재 투자자산과 월 적립액의 처음 값은 ${cbEsc(_simOwner)} 보유 자산과 적립식 규칙에서 가져옵니다. 고쳐 써도 원장은 바뀌지 않습니다.</p>
    </section><section class="sim-results" aria-label="은퇴 자금 예상 결과"><p id="ret-error" class="sim-error" role="status" hidden></p><div id="ret-result"></div></section></div>
    <p class="sim-assumptions">계산 기준: 입력한 수익률이 매년 똑같이 난다고 가정하고 물가상승률을 빼 모든 금액을 오늘 돈의 가치로 보여 줍니다. 월 적립액도 물가만큼 늘려 넣는다고 봅니다. 실제 수익률은 해마다 크게 달라지며 은퇴 직전·직후의 하락은 이 계산보다 결과를 더 나쁘게 만듭니다. 세금·수수료·환율과 국민연금·퇴직연금 등 다른 소득은 넣지 않았습니다. 예측이나 투자 권유가 아니며 저장되지 않습니다.</p>`;
}
function retInput(key,value){ _retState[key]=simValue(value); if(key==='current')_retState.currentAuto=false; retUpdate(); }
function retReset(){ _retState=null; cbRenderSimulator(); document.getElementById('ret-age')?.focus(); }
function retChartSvg(r,retireAge){
  const W=640,H=220,L=58,R=12,T=12,B=26,pts=r.series,max=Math.max(...pts.map(p=>p.bal),1);
  const x=i=>L+(W-L-R)*i/(pts.length-1), y=v=>T+(H-T-B)*(1-v/max);
  const line=pts.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(p.bal).toFixed(1)}`).join(' ');
  const ri=pts.findIndex(p=>p.age===retireAge);
  const ticks=[0,.5,1].map(f=>`<line x1="${L}" x2="${W-R}" y1="${y(max*f).toFixed(1)}" y2="${y(max*f).toFixed(1)}" style="stroke:var(--grid)"></line><text x="${L-7}" y="${(y(max*f)+3.5).toFixed(1)}" text-anchor="end" font-size="10" style="fill:var(--lab)">${String(cbTaxAxisLab(max*f)).replace(/^\+/,'')}</text>`).join('');
  const ages=[0,ri,pts.length-1].filter((v,i,a)=>v>=0&&a.indexOf(v)===i).map(i=>`<text x="${x(i).toFixed(1)}" y="${H-7}" text-anchor="${i===0?'start':i===pts.length-1?'end':'middle'}" font-size="10" style="fill:var(--lab)">${pts[i].age}세${i===ri?' 은퇴':''}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="나이별 자산 추정. ${pts[0].age}세 ${cbDisp(pts[0].bal)}에서 ${retireAge}세 ${cbDisp(r.fv)}까지 늘고 ${pts[pts.length-1].age}세에 모두 쓰는 가정">
    ${ticks}<path d="${line} L${x(pts.length-1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z" style="fill:var(--acc)" fill-opacity=".10"></path>
    <path d="${line}" fill="none" style="stroke:var(--acc)" stroke-width="2" stroke-linejoin="round"></path>
    ${ri>0?`<line x1="${x(ri).toFixed(1)}" x2="${x(ri).toFixed(1)}" y1="${T}" y2="${H-B}" style="stroke:var(--bd2)" stroke-dasharray="3 3"></line><circle cx="${x(ri).toFixed(1)}" cy="${y(pts[ri].bal).toFixed(1)}" r="4" style="fill:var(--acc);stroke:var(--panelSolid)" stroke-width="2"></circle>`:''}
    ${ages}</svg>`;
}
function retUpdate(){
  const box=document.getElementById('ret-result'),error=document.getElementById('ret-error'); if(!box||!error||!_retState) return;
  const s=_retState, toInput=o=>({age:o.age,retireAge:o.retireAge,endAge:o.endAge,current:o.current*10000,monthly:o.monthly*10000,ret:o.ret,infl:o.infl});
  const r=retCalculate(toInput(s));
  error.hidden=!r.error; error.textContent=r.error||''; box.hidden=!!r.error;
  if(r.error) return;
  const cases=[-2,0,2].map(d=>({d,r:retCalculate(toInput({...s,ret:s.ret+d}))})).filter(c=>!c.r.error);
  box.innerHTML=`<div class="sim-kpis"><div class="cb-panel"><small>${s.retireAge}세 은퇴 시점 자산 · 오늘 가치</small><b>${cbDisp(r.fv)}</b></div><div class="cb-panel"><small>${s.retireAge}~${s.endAge}세 월 인출 가능액 · 오늘 가치</small><b class="sim-accent">${cbDisp(r.withdraw)}</b></div><div class="cb-panel"><small>넣는 돈 합계 · 현재 자산 + 적립</small><b>${cbDisp(r.contributed)}</b></div></div>
    <div class="cb-panel sim-comparison"><div class="fin-section-head"><span>나이별 자산 추정</span><small>물가를 뺀 실질 수익률 연 ${r.realRate.toFixed(2)}% · ${s.endAge}세에 모두 쓰는 가정</small></div>${retChartSvg(r,s.retireAge)}
      <p class="sim-gap">가정한 수익으로 늘어나는 금액 <b>${r.growth>=0?'+':'−'}${cbDisp(Math.abs(r.growth))}</b><small>은퇴 시점 자산 − 넣는 돈 합계 · 수익률 가정이 바뀌면 크게 달라집니다</small></p></div>
    <div class="cb-panel sim-breakdown"><div class="fin-section-head"><span>수익률 가정에 따른 차이</span><small>다른 조건은 같음</small></div><div class="sim-row sim-table-head"><span>연 수익률</span><span>은퇴 시점 자산</span><span>월 인출 가능액</span><span>실질 수익률</span></div>${cases.map(c=>`<div class="sim-row"><span>${(s.ret+c.d).toFixed(1)}%${c.d===0?' <em>입력값</em>':''}</span><b>${cbDisp(c.r.fv)}</b><span>${cbDisp(c.r.withdraw)}</span><span>${c.r.realRate.toFixed(2)}%</span></div>`).join('')}</div>`;
}
