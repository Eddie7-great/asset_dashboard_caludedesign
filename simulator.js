// Ephemeral scenarios: this module never writes portfolio data, goals or KV.
let _simOwner='전체',_simState=null;
let _homeTf='6M';
function cbHomeTotals(ownerF){
  const t=finBalanceTotals(ownerF);
  return `<div class="home-totals"><div><small>전체 순자산</small><strong>${cbDisp(t.net)}</strong><span>투자자산 + 기타 자산 − 부채</span></div><div><small>기타 자산</small><b>${cbDisp(t.otherAssets)}</b></div><div><small>부채</small><b>${cbDisp(t.liabilities)}</b></div><button class="cb-btn" onclick="switchView('balance2')">재무상태표 보기 ↗</button></div>`;
}
function cbHomeTrend(ownerF){
  const series=finNwSeries(ownerF,_homeTf),stats=finNwStats(series);
  return `<section class="cb-panel fin-section home-trend"><div class="fin-section-head"><span>순자산 추이 <small>· ${cbEsc(ownerF||'가구 전체')}</small></span><div class="owner-tabs">${Object.keys(FIN_NW_TFS).map(tf=>`<button class="owner-btn${tf===_homeTf?' active':''}" data-home-tf="${tf}" aria-pressed="${tf===_homeTf}" onclick="cbHomeTf('${tf}')">${tf}</button>`).join('')}</div></div><p class="home-trend-note">${stats?'기간 증감 '+cbSignDisp(stats.change):'기록이 쌓이면 순자산 변화를 볼 수 있습니다.'} · 실제 저장한 자산 기록 기준</p>${finNwCoverageNote(finNwCoverage(series,_homeTf))}${finNwChartSvg(series,1100,200)}</section>`;
}
function cbHomeTf(tf){
  if(!Object.hasOwn(FIN_NW_TFS,tf))return;
  _homeTf=tf;cbRenderDash();cbRestoreFilterFocus('cb-cdash','data-home-tf',tf);
}

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
  el.innerHTML=`<section class="sim-hero cb-panel"><div><span class="sim-eyebrow">INVESTMENT LAB · 가상 계산</span><h3>다음 투자금, 어떻게 나눌까요?</h3><p>월 투자금과 목표를 바꾸고 자산 비중의 변화를 확인하세요.</p></div><span class="sim-hero-mark" aria-hidden="true">↗</span></section>
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
    <p class="sim-assumptions">계산 기준: 현재 주가·환율 유지, 수익률 0%, 매도 없음. 세금·수수료·배당·매수 단위는 제외합니다. 추가 투자금은 기존 보유 현금에서 차감하지 않는 새 자금입니다. 부족한 비중 우선 방식은 적립 기간 전체 금액을 투자한 뒤의 목표 부족액에 비례 배분합니다. 이 화면의 변경은 원장·목표·적립식 규칙에 저장되지 않습니다.</p>`;
  simUpdate();
}
function simValue(value){ return String(value).trim()===''?NaN:Number(value); }
function simInput(key,value){_simState[key]=simValue(value);simSyncPair('sim-'+key,value);simUpdate();}
function simWeight(key,value){_simState.weights[key]=simValue(value);simSyncPair('sim-'+key,value);simUpdate();}
function simSyncPair(id,value){
  [id,id+'-range'].forEach(key=>{const el=document.getElementById(key);if(el&&el!==document.activeElement)el.value=value;});
}
function simMode(value){_simState.mode=value;simUpdate();}
function simOwner(owner){_simOwner=owner;cbRenderSimulator();cbRestoreFilterFocus('cb-head-widgets','data-owner',owner);}
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
