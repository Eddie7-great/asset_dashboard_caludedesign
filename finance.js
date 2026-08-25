// =====================================================================
// finance.js — 가족 재무상태표·목표·리밸런싱·데이터 신뢰 기능
// script.js의 저장 엔진과 cobalt.js의 공통 표시 헬퍼를 재사용한다.
// =====================================================================

const FIN_DEFAULT_TARGET={crypto:5,us:35,kr:25,jp:5,gold:10,cash:20};
const FIN_ASSET_CATS=['부동산','예·적금','보험 해약환급금','차량','기타 자산'];
const FIN_LIABILITY_CATS=['주택담보대출','신용대출','전세·임대보증금','카드·단기부채','기타 부채'];
let _finBalanceEdit=null;
let _finGoalEdit=null;

function finEnsureState(){
  const bs=window._balanceSheet||{};
  window._balanceSheet={
    assets:Array.isArray(bs.assets)?bs.assets:[],
    liabilities:Array.isArray(bs.liabilities)?bs.liabilities:[],
    cashTargetMonths:Math.max(1,Number(bs.cashTargetMonths)||6)
  };
  const old=window._targetAlloc||{};
  const oldGroups=old.groups&&typeof old.groups==='object'?old.groups:{};
  const groups={};
  Object.keys(FIN_DEFAULT_TARGET).forEach(k=>{ groups[k]=Number.isFinite(Number(oldGroups[k]))?Number(oldGroups[k]):FIN_DEFAULT_TARGET[k]; });
  window._targetAlloc={...old,groups,threshold:Math.max(1,Number(old.threshold)||5)};
  if(!Array.isArray(goalData)) goalData=[];
  if(!window._dataFreshness||typeof window._dataFreshness!=='object') window._dataFreshness={};
}

function finSum(list){ return (list||[]).reduce((s,x)=>s+(Number(x.amount)||0),0); }
function finBalanceTotals(){
  finEnsureState();
  const investment=typeof cbAllRows==='function'?cbAllRows().reduce((s,r)=>s+r.val,0):0;
  const otherAssets=finSum(window._balanceSheet.assets);
  const liabilities=finSum(window._balanceSheet.liabilities);
  return {investment,otherAssets,assets:investment+otherAssets,liabilities,net:investment+otherAssets-liabilities};
}
function finMonthlyFixedCost(){
  const d=new Date(),y=d.getFullYear(),m=d.getMonth()+1;
  return (autoTransferData||[]).filter(x=>x&&x.type==='지출'&&x.isFixedCost!==false)
    .filter(x=>typeof _autoTransferActiveInMonth!=='function'||_autoTransferActiveInMonth(x,y,m))
    .reduce((s,x)=>s+(typeof _autoTransferMonthlyEquivalent==='function'?_autoTransferMonthlyEquivalent(x,y,m):(Number(x.amt)||0)),0);
}
function finCashSafety(){
  finEnsureState();
  const cash=typeof cbAllRows==='function'?cbAllRows().filter(r=>r.cls==='cash').reduce((s,r)=>s+r.val,0):0;
  const fixed=finMonthlyFixedCost();
  const dca=(pfolioData||[]).filter(i=>i&&i.dca).reduce((s,i)=>s+(typeof cbDcaPerMonthKRW==='function'?cbDcaPerMonthKRW(i):0),0);
  const committed=fixed+dca;
  const targetMonths=window._balanceSheet.cashTargetMonths||6;
  const runway=fixed>0?cash/fixed:null;
  const committedRunway=committed>0?cash/committed:null;
  const shortage=Math.max(0,fixed*targetMonths-cash);
  return {cash,fixed,dca,committed,targetMonths,runway,committedRunway,shortage};
}
function finTargetAnalysis(){
  finEnsureState();
  const rows=typeof cbAllRows==='function'?cbAllRows():[];
  const total=rows.reduce((s,r)=>s+r.val,0);
  const current={}; rows.forEach(r=>{current[r.cls]=(current[r.cls]||0)+r.val;});
  const groups=window._targetAlloc.groups;
  const monthlyDca=(pfolioData||[]).filter(i=>i&&i.dca).reduce((s,i)=>s+(typeof cbDcaPerMonthKRW==='function'?cbDcaPerMonthKRW(i):0),0);
  const result=Object.keys(FIN_DEFAULT_TARGET).map(key=>{
    const targetPct=Number(groups[key])||0;
    const currentValue=current[key]||0;
    const currentPct=total?currentValue/total*100:0;
    const targetValue=total*targetPct/100;
    return {key,label:CB_CLS[key]?.label||key,color:CB_CLS[key]?.color||'#94a3b8',currentValue,currentPct,targetPct,targetValue,diff:targetValue-currentValue,drift:currentPct-targetPct};
  });
  const deficits=result.filter(x=>x.diff>0); const deficitTotal=deficits.reduce((s,x)=>s+x.diff,0);
  result.forEach(x=>{x.dcaSuggestion=x.diff>0&&deficitTotal>0?monthlyDca*x.diff/deficitTotal:0;});
  const max=total>0?(result.slice().sort((a,b)=>Math.abs(b.drift)-Math.abs(a.drift))[0]||null):null;
  return {total,monthlyDca,result,max,threshold:window._targetAlloc.threshold};
}
function finMonthCashflow(sinceDate=''){
  const d=new Date(),today=d.toISOString().slice(0,10),prefix=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  return (cfData||[]).filter(x=>{const date=String(x.date||'');return sinceDate?(date>sinceDate&&date<=today):date.startsWith(prefix);}).reduce((s,x)=>s+(x.type==='수입'?1:-1)*(Number(x.amt)||0),0);
}
function finNetWorthBridge(){
  const totals=finBalanceTotals();
  const hist=(window._netWorthHistory||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const today=new Date().toISOString().slice(0,10);
  const prior=hist.filter(x=>x.date!==today).slice(-1)[0]||null;
  const previous=prior?Number(prior.total)||0:totals.net;
  const change=totals.net-previous;
  const cashflow=finMonthCashflow(prior?.date||'');
  const residual=change-cashflow;
  return {totals,prior,previous,change,cashflow,residual};
}

function finMarkFresh(key,label,source,ok=true,detail=''){
  finEnsureState();
  window._dataFreshness[key]={label,source,ok:!!ok,detail:String(detail||''),updatedAt:new Date().toISOString()};
  if(typeof cbRenderDataStatus==='function'&&document.getElementById('view-data2')?.classList.contains('active')) cbRenderDataStatus();
}
function finFreshAge(iso){
  if(!iso) return '확인 전';
  const ms=Date.now()-new Date(iso).getTime(); if(!Number.isFinite(ms)) return '확인 전';
  const min=Math.max(0,Math.floor(ms/60000));
  if(min<1) return '방금 전'; if(min<60) return `${min}분 전`; if(min<1440) return `${Math.floor(min/60)}시간 전`;
  return `${Math.floor(min/1440)}일 전`;
}

function finMonthlyActions(ownerF){
  const target=finTargetAnalysis(); const safety=finCashSafety();
  const items=[];
  if(target.max&&Math.abs(target.max.drift)>=target.threshold) items.push({tone:'warn',title:`${target.max.label} 목표 비중 점검`,desc:`목표 대비 ${target.max.drift>=0?'+':''}${target.max.drift.toFixed(1)}%p`,view:'plan2',menu:'plan2'});
  else items.push({tone:'ok',title:'목표 비중 허용범위',desc:target.max?`최대 편차 ${Math.abs(target.max.drift).toFixed(1)}%p`:'투자자산 등록 필요',view:'plan2',menu:'plan2'});
  if(safety.fixed<=0) items.push({tone:'info',title:'필수지출 등록',desc:'현금 안전판 계산을 위해 현금 흐름에서 등록',view:'cashflow',menu:'cashflow'});
  else if(safety.runway<safety.targetMonths) items.push({tone:'warn',title:'현금 안전판 보강',desc:`${safety.runway.toFixed(1)}개월 · 목표 ${safety.targetMonths}개월`,view:'balance2',menu:'balance2'});
  else items.push({tone:'ok',title:'현금 안전판',desc:`${safety.runway.toFixed(1)}개월 확보`,view:'balance2',menu:'balance2'});
  const dcaItems=(pfolioData||[]).filter(i=>i&&i.dca&&(!ownerF||i.owner===ownerF));
  const schedules=dcaItems.map(i=>cbDcaScheduleSummary(i));
  const remain=schedules.reduce((s,x)=>s+(x.remainingAmount||0),0);
  const next=schedules.map(x=>x.nextDate).filter(Boolean).sort()[0];
  items.push({tone:'info',title:'이번 달 DCA 예정',desc:dcaItems.length?`${dcaItems.length}종목 · ${cbDisp(remain)}${next?' · 다음 '+next.slice(5).replace('-','/'):''}`:'활성 규칙 없음',view:'dca2',menu:'dca2'});
  const divList=(pfolioData||[]).filter(i=>(i.qty||0)>0&&(!ownerF||i.owner===ownerF)).map(i=>({i,d:cbDivOf(i),incomeKRW:cbDivIncomeKRW(i),tkr:i.tkr,title:i.name})).filter(x=>x.d&&x.incomeKRW>0);
  const upcoming=cbUpcomingDividendSchedule(divList,90); const divAmt=upcoming.reduce((s,x)=>s+x.amount,0);
  items.push({tone:'info',title:'향후 90일 배당',desc:upcoming.length?`${upcoming.length}건 · 예상 ${cbDisp(divAmt)}`:'예정 내역 없음',view:'divm',menu:'divm'});
  const stale=(pfolioData||[]).filter(i=>i&&i._priceStale).length;
  if(stale) items.push({tone:'warn',title:'시세 데이터 확인',desc:`${stale}개 자산의 최신 시세 확인 필요`,view:'data2',menu:'data2'});
  const soonGoals=(goalData||[]).filter(g=>g.targetDate&&((new Date(g.targetDate)-Date.now())/86400000)<=180&&new Date(g.targetDate)>=new Date());
  if(soonGoals.length) items.push({tone:'warn',title:'6개월 내 목표',desc:`${soonGoals.length}개 목표 진행률 점검`,view:'plan2',menu:'plan2'});
  return items.slice(0,6);
}
function finDashboardFocus(ownerF){
  const actions=finMonthlyActions(ownerF);
  const target=finTargetAnalysis(); const safety=finCashSafety();
  const drift=target.max;
  const actionRows=actions.map(a=>`<button class="fin-action-row ${a.tone}" onclick="switchView('${a.view}',document.getElementById('menu-${a.menu}'))"><span class="fin-action-dot"></span><span><b>${cbEsc(a.title)}</b><small>${cbEsc(a.desc)}</small></span><span class="fin-action-go">›</span></button>`).join('');
  const driftPct=drift?Math.min(100,Math.abs(drift.drift)/Math.max(1,target.threshold*2)*100):0;
  const runwayPct=safety.runway==null?0:Math.min(100,safety.runway/safety.targetMonths*100);
  return `<div class="fin-dashboard-priority">
    <div class="cb-panel fin-action-panel"><div class="fin-section-head"><span>이번 달 할 일</span><small>${actions.length}개 점검 항목</small></div><div class="fin-action-list">${actionRows}</div></div>
    <div class="fin-priority-side">
      <button class="cb-panel fin-focus-card" onclick="switchView('plan2',document.getElementById('menu-plan2'))"><div class="fin-section-head"><span>목표 비중 편차</span><small>허용 ±${target.threshold}%p</small></div><strong>${drift?cbEsc(drift.label):'—'} <em>${drift?(drift.drift>=0?'+':'')+drift.drift.toFixed(1)+'%p':'데이터 없음'}</em></strong><div class="fin-meter"><i style="width:${driftPct}%"></i></div><p>${drift&&Math.abs(drift.drift)>=target.threshold?'리밸런싱 검토가 필요합니다.':'현재 허용범위 안입니다.'}</p></button>
      <button class="cb-panel fin-focus-card" onclick="switchView('balance2',document.getElementById('menu-balance2'))"><div class="fin-section-head"><span>현금 안전판</span><small>목표 ${safety.targetMonths}개월</small></div><strong>${safety.runway==null?'—':safety.runway.toFixed(1)+'개월'} <em>${cbDisp(safety.cash)}</em></strong><div class="fin-meter cash"><i style="width:${runwayPct}%"></i></div><p>${safety.fixed<=0?'필수지출을 등록하면 계산됩니다.':safety.shortage>0?`목표까지 ${cbDisp(safety.shortage)} 부족`:'목표 현금이 확보되었습니다.'}</p></button>
    </div>
  </div>`;
}

async function finSaveAndRender(renderFn){
  try{ await saveExtDataToKV(); }catch(e){ console.error('[finance save]',e); }
  if(typeof renderFn==='function') renderFn();
  if(typeof cbRerender==='function'&&!document.getElementById('view-balance2')?.classList.contains('active')&&!document.getElementById('view-plan2')?.classList.contains('active')) cbRerender();
}
function finBalanceKindChange(){ const k=document.getElementById('fin-bs-kind')?.value||'asset'; const sel=document.getElementById('fin-bs-category'); if(!sel)return; const cats=k==='liability'?FIN_LIABILITY_CATS:FIN_ASSET_CATS; sel.innerHTML=cats.map(x=>`<option>${cbEsc(x)}</option>`).join(''); }
function finBalanceEdit(kind,index){ _finBalanceEdit={kind,index}; cbRenderBalanceSheet(); document.getElementById('fin-bs-form')?.scrollIntoView({behavior:'smooth',block:'center'}); }
function finBalanceCancel(){ _finBalanceEdit=null; cbRenderBalanceSheet(); }
function finBalanceDelete(kind,index){
  if(!confirm('이 항목을 삭제할까요?')) return;
  finEnsureState(); const key=kind==='liability'?'liabilities':'assets'; window._balanceSheet[key].splice(index,1); _finBalanceEdit=null; finSaveAndRender(cbRenderBalanceSheet);
}
function finBalanceSubmit(){
  finEnsureState();
  const kind=document.getElementById('fin-bs-kind')?.value||'asset';
  const row={id:_finBalanceEdit?window._balanceSheet[_finBalanceEdit.kind==='liability'?'liabilities':'assets'][_finBalanceEdit.index]?.id:Date.now(),owner:document.getElementById('fin-bs-owner')?.value||'본인',category:document.getElementById('fin-bs-category')?.value||'기타',name:(document.getElementById('fin-bs-name')?.value||'').trim(),amount:Number(document.getElementById('fin-bs-amount')?.value)||0,note:(document.getElementById('fin-bs-note')?.value||'').trim()};
  if(!row.name||row.amount<=0){ alert('항목명과 0보다 큰 금액을 입력해 주세요.'); return; }
  const key=kind==='liability'?'liabilities':'assets';
  if(_finBalanceEdit){ const oldKey=_finBalanceEdit.kind==='liability'?'liabilities':'assets'; window._balanceSheet[oldKey].splice(_finBalanceEdit.index,1); }
  window._balanceSheet[key].push(row); _finBalanceEdit=null; finSaveAndRender(cbRenderBalanceSheet);
}
function finSaveCashTarget(){ const n=Math.max(1,Math.min(36,Number(document.getElementById('fin-cash-target')?.value)||6)); window._balanceSheet.cashTargetMonths=n; finSaveAndRender(cbRenderBalanceSheet); }

function cbRenderBalanceSheet(){
  finEnsureState(); const el=document.getElementById('cb-balance2'); if(!el)return;
  const t=finBalanceTotals(),bridge=finNetWorthBridge(),safe=finCashSafety();
  cbSetHead('투자자산 + 기타 자산 − 부채 · 전체 순자산을 투자 성과와 분리해 관리');
  const rows=(kind,list)=>list.map((x,index)=>`<div class="fin-bs-row"><span><b>${cbEsc(x.name)}</b><small>${cbEsc(x.owner)} · ${cbEsc(x.category)}${x.note?' · '+cbEsc(x.note):''}</small></span><strong>${cbDisp(Number(x.amount)||0)}</strong><span class="fin-row-actions"><button onclick="finBalanceEdit('${kind}',${index})">수정</button><button onclick="finBalanceDelete('${kind}',${index})">삭제</button></span></div>`).join('')||'<div class="fin-empty">등록된 항목이 없습니다.</div>';
  const edit=_finBalanceEdit; const old=edit?window._balanceSheet[edit.kind==='liability'?'liabilities':'assets'][edit.index]:null; const kind=edit?.kind||'asset'; const cats=kind==='liability'?FIN_LIABILITY_CATS:FIN_ASSET_CATS;
  const ownerBreak=OWNERS.map(owner=>{const inv=cbAllRows().filter(r=>r.i.owner===owner).reduce((s,r)=>s+r.val,0);const oa=finSum(window._balanceSheet.assets.filter(x=>x.owner===owner));const li=finSum(window._balanceSheet.liabilities.filter(x=>x.owner===owner));return{owner,inv,oa,li,net:inv+oa-li};}).filter(x=>x.inv||x.oa||x.li);
  const bridgeCards=bridge.prior?`<div class="fin-bridge"><div><small>이전 순자산</small><b>${cbDisp(bridge.previous)}</b></div><span>+</span><div class="${bridge.cashflow>=0?'up':'down'}"><small>이후 순현금흐름</small><b>${cbSignDisp(bridge.cashflow)}</b></div><span>+</span><div class="${bridge.residual>=0?'up':'down'}"><small>가격·평가 변경(잔차)</small><b>${cbSignDisp(bridge.residual)}</b></div><span>=</span><div><small>현재 순자산</small><b>${cbDisp(t.net)}</b></div></div>`:`<div class="fin-empty">오늘부터 순자산 스냅샷을 쌓습니다. 다음 스냅샷부터 현금흐름과 가격·평가 변경을 분리해 보여드립니다.</div>`;
  el.innerHTML=`
    <div class="fin-summary-grid"><div class="cb-panel fin-kpi"><small>가족 투자자산</small><strong>${cbDisp(t.investment)}</strong><span>주식·가상화폐·금·현금</span></div><div class="cb-panel fin-kpi"><small>기타 자산</small><strong>${cbDisp(t.otherAssets)}</strong><span>부동산·예적금·보험 등</span></div><div class="cb-panel fin-kpi liability"><small>부채</small><strong>${cbDisp(t.liabilities)}</strong><span>대출·보증금·단기부채</span></div><div class="cb-panel fin-kpi net"><small>전체 순자산</small><strong>${cbDisp(t.net)}</strong><span>총자산 ${cbDisp(t.assets)} − 부채</span></div></div>
    <div class="cb-panel fin-section"><div class="fin-section-head"><span>순자산 변화 분석</span><small>${bridge.prior?cbEsc(bridge.prior.date)+' 이후 · 현금흐름 기록 기준 근사치':'스냅샷 준비 중'}</small></div>${bridgeCards}</div>
    <div class="fin-balance-grid">
      <div class="cb-panel fin-section"><div class="fin-section-head"><span>기타 자산</span><small>${window._balanceSheet.assets.length}개 · ${cbDisp(t.otherAssets)}</small></div>${rows('asset',window._balanceSheet.assets)}</div>
      <div class="cb-panel fin-section"><div class="fin-section-head"><span>부채</span><small>${window._balanceSheet.liabilities.length}개 · ${cbDisp(t.liabilities)}</small></div>${rows('liability',window._balanceSheet.liabilities)}</div>
    </div>
    <div class="fin-balance-grid">
      <div class="cb-panel fin-section"><div class="fin-section-head"><span>현금 안전판</span><small>필수지출 기준</small></div><div class="fin-safety"><strong>${safe.runway==null?'—':safe.runway.toFixed(1)+'개월'}</strong><p>현금 ${cbDisp(safe.cash)} / 월 필수지출 ${cbDisp(safe.fixed)}</p><p>DCA 포함 월 약정액 ${cbDisp(safe.committed)}${safe.committedRunway!=null?' · '+safe.committedRunway.toFixed(1)+'개월':''}</p><div class="fin-inline-form"><label>목표 개월</label><input id="fin-cash-target" type="number" min="1" max="36" value="${safe.targetMonths}"><button onclick="finSaveCashTarget()">저장</button></div>${safe.fixed<=0?'<small class="fin-callout">현금 흐름에서 필수 고정지출을 등록하면 자동 계산됩니다.</small>':safe.shortage>0?`<small class="fin-callout warn">목표까지 ${cbDisp(safe.shortage)}가 더 필요합니다.</small>`:'<small class="fin-callout ok">목표 안전판을 확보했습니다.</small>'}</div></div>
      <div class="cb-panel fin-section"><div class="fin-section-head"><span>소유주별 순자산</span><small>투자자산 + 기타 자산 − 부채</small></div><div class="fin-owner-table">${ownerBreak.map(x=>`<div><span><i style="background:${cbOwnerColor(x.owner)}"></i>${cbEsc(x.owner)}</span><small>투자 ${cbDisp(x.inv)} · 기타 ${cbDisp(x.oa)} · 부채 ${cbDisp(x.li)}</small><b>${cbDisp(x.net)}</b></div>`).join('')||'<div class="fin-empty">표시할 자산이 없습니다.</div>'}</div></div>
    </div>
    <div class="cb-panel fin-section" id="fin-bs-form"><div class="fin-section-head"><span>${edit?'재무상태표 항목 수정':'재무상태표 항목 추가'}</span><small>투자자산은 자산 내역에서 관리합니다.</small></div><div class="fin-form-grid">
      <label>구분<select id="fin-bs-kind" onchange="finBalanceKindChange()" ${edit?'disabled':''}><option value="asset" ${kind==='asset'?'selected':''}>기타 자산</option><option value="liability" ${kind==='liability'?'selected':''}>부채</option></select></label>
      <label>소유주<select id="fin-bs-owner">${OWNERS.map(o=>`<option ${old?.owner===o?'selected':''}>${cbEsc(o)}</option>`).join('')}</select></label>
      <label>분류<select id="fin-bs-category">${cats.map(c=>`<option ${old?.category===c?'selected':''}>${cbEsc(c)}</option>`).join('')}</select></label>
      <label>항목명<input id="fin-bs-name" value="${cbEsc(old?.name||'')}" placeholder="예: 거주 아파트"></label>
      <label>금액(원)<input id="fin-bs-amount" type="number" min="0" step="10000" value="${old?.amount||''}" placeholder="0"></label>
      <label>메모<input id="fin-bs-note" value="${cbEsc(old?.note||'')}" placeholder="선택 입력"></label>
    </div><div class="fin-form-actions"><button class="primary" onclick="finBalanceSubmit()">${edit?'수정 저장':'항목 추가'}</button>${edit?'<button onclick="finBalanceCancel()">취소</button>':''}</div></div>`;
}

function finGoalCurrent(g){
  const link=g.linkClass||'investment'; const t=finBalanceTotals();
  if(link==='net')return t.net; if(link==='investment')return t.investment;
  if(link==='manual')return Number(g.currentAmount)||0;
  return cbAllRows().filter(r=>r.cls===link).reduce((s,r)=>s+r.val,0);
}
function finGoalEdit(index){_finGoalEdit=index;cbRenderPlan();document.getElementById('fin-goal-form')?.scrollIntoView({behavior:'smooth',block:'center'});}
function finGoalCancel(){_finGoalEdit=null;cbRenderPlan();}
function finGoalDelete(index){if(!confirm('이 목표를 삭제할까요?'))return;goalData.splice(index,1);_finGoalEdit=null;finSaveAndRender(cbRenderPlan);}
function finGoalSubmit(){
  const g={id:_finGoalEdit!=null?goalData[_finGoalEdit]?.id:Date.now(),name:(document.getElementById('fin-goal-name')?.value||'').trim(),targetAmount:Number(document.getElementById('fin-goal-target')?.value)||0,targetDate:document.getElementById('fin-goal-date')?.value||'',linkClass:document.getElementById('fin-goal-link')?.value||'investment',currentAmount:Number(document.getElementById('fin-goal-current')?.value)||0};
  if(!g.name||g.targetAmount<=0){alert('목표명과 목표 금액을 입력해 주세요.');return;}
  if(_finGoalEdit!=null)goalData[_finGoalEdit]=g;else goalData.push(g);_finGoalEdit=null;finSaveAndRender(cbRenderPlan);
}
function finGoalLinkChange(){ const manual=document.getElementById('fin-goal-link')?.value==='manual'; const f=document.getElementById('fin-goal-current-wrap'); if(f)f.style.display=manual?'flex':'none'; }
function finSaveTarget(){
  const groups={}; Object.keys(FIN_DEFAULT_TARGET).forEach(k=>groups[k]=Math.max(0,Number(document.getElementById('fin-target-'+k)?.value)||0));
  const sum=Object.values(groups).reduce((s,x)=>s+x,0); if(Math.abs(sum-100)>.01){alert(`목표 비중 합계를 100%로 맞춰 주세요. 현재 ${sum.toFixed(1)}%입니다.`);return;}
  window._targetAlloc={...(window._targetAlloc||{}),groups,threshold:Math.max(1,Math.min(20,Number(document.getElementById('fin-target-threshold')?.value)||5))};finSaveAndRender(cbRenderPlan);
}
function finAccountDiagnostics(){
  const rows=cbAllRows(),total=rows.reduce((s,r)=>s+r.val,0)||1,map={};
  rows.forEach(r=>{const key=[r.i.owner,r.i.broker||'미지정',r.i.acc||'미지정'].join(' · ');if(!map[key])map[key]={key,owner:r.i.owner,broker:r.i.broker||'미지정',acc:r.i.acc||'미지정',value:0,dividend:0,count:0};map[key].value+=r.val;map[key].dividend+=cbDivIncomeKRW(r.i);map[key].count++;});
  return Object.values(map).sort((a,b)=>b.value-a.value).map(x=>{const taxAdv=/ISA|연금/.test(x.acc),gift=/증여/.test(x.acc);let status='일반 점검',finding='특이사항 없음';if(taxAdv){status='절세 계좌';finding='절세 계좌를 활용 중입니다.';}else if(gift){status='증여 계좌';finding='증여 원금·취득가 기록을 함께 확인하세요.';}else if(x.dividend>0){status='배당 과세 점검';finding=`예상 연 배당 ${cbDisp(x.dividend)}의 계좌 위치를 검토하세요.`;}return{...x,share:x.value/total*100,status,finding};});
}
function cbRenderPlan(){
  finEnsureState();const el=document.getElementById('cb-plan2');if(!el)return;const ta=finTargetAnalysis(),accounts=finAccountDiagnostics();
  cbSetHead('목표 진행률 · 목표 비중 편차 · 월 적립식 보정 · 계좌 배치 점검');
  const ge=_finGoalEdit!=null?goalData[_finGoalEdit]:null;
  const goalCards=(goalData||[]).map((g,index)=>{const cur=finGoalCurrent(g),pct=Math.max(0,Math.min(100,g.targetAmount?cur/g.targetAmount*100:0)),days=g.targetDate?Math.ceil((new Date(g.targetDate)-Date.now())/86400000):null;return`<div class="cb-panel fin-goal-card"><div><small>${cbEsc(g.targetDate||'목표일 미정')}${days!=null?` · ${days>=0?'D-'+days:'기한 경과'}`:''}</small><strong>${cbEsc(g.name)}</strong><span>${cbDisp(cur)} / ${cbDisp(g.targetAmount)}</span></div><b>${pct.toFixed(1)}%</b><div class="fin-meter"><i style="width:${pct}%"></i></div><div class="fin-row-actions"><button onclick="finGoalEdit(${index})">수정</button><button onclick="finGoalDelete(${index})">삭제</button></div></div>`;}).join('')||'<div class="fin-empty cb-panel">목표를 추가하면 현재 자산과 자동으로 연결해 진행률을 보여드립니다.</div>';
  el.innerHTML=`
    <div class="fin-section-head standalone"><span>재무 목표</span><small>${goalData.length}개 목표</small></div><div class="fin-goal-grid">${goalCards}</div>
    <div class="cb-panel fin-section" id="fin-goal-form"><div class="fin-section-head"><span>${ge?'목표 수정':'새 목표 추가'}</span><small>전체 순자산·투자자산·자산군과 연결 가능</small></div><div class="fin-form-grid">
      <label>목표명<input id="fin-goal-name" value="${cbEsc(ge?.name||'')}" placeholder="예: 자녀 교육자금"></label><label>목표 금액(원)<input id="fin-goal-target" type="number" min="0" step="10000" value="${ge?.targetAmount||''}"></label><label>목표일<input id="fin-goal-date" type="date" value="${cbEsc(ge?.targetDate||'')}"></label>
      <label>현재 금액 연결<select id="fin-goal-link" onchange="finGoalLinkChange()"><option value="investment" ${ge?.linkClass==='investment'?'selected':''}>가족 투자자산</option><option value="net" ${ge?.linkClass==='net'?'selected':''}>전체 순자산</option>${Object.keys(FIN_DEFAULT_TARGET).map(k=>`<option value="${k}" ${ge?.linkClass===k?'selected':''}>${cbEsc(CB_CLS[k].label)}</option>`).join('')}<option value="manual" ${ge?.linkClass==='manual'?'selected':''}>직접 입력</option></select></label>
      <label id="fin-goal-current-wrap" style="display:${ge?.linkClass==='manual'?'flex':'none'}">현재 금액(원)<input id="fin-goal-current" type="number" min="0" value="${ge?.currentAmount||''}"></label>
    </div><div class="fin-form-actions"><button class="primary" onclick="finGoalSubmit()">${ge?'수정 저장':'목표 추가'}</button>${ge?'<button onclick="finGoalCancel()">취소</button>':''}</div></div>
    <div class="cb-panel fin-section"><div class="fin-section-head"><span>목표 비중과 리밸런싱</span><small>현재 총 투자자산 ${cbDisp(ta.total)} · 월 DCA ${cbDisp(ta.monthlyDca)}</small></div><div class="fin-target-inputs">${ta.result.map(x=>`<label><span><i style="background:${x.color}"></i>${cbEsc(x.label)}</span><input id="fin-target-${x.key}" type="number" min="0" max="100" step="1" value="${x.targetPct}"><em>%</em></label>`).join('')}<label class="threshold"><span>허용 편차</span><input id="fin-target-threshold" type="number" min="1" max="20" value="${ta.threshold}"><em>%p</em></label><button onclick="finSaveTarget()">목표 저장</button></div>
      <div class="fin-rebal-table"><div class="head"><span>자산군</span><span>현재</span><span>목표</span><span>편차</span><span>필요 조정액</span><span>월 DCA 보정안</span></div>${ta.result.map(x=>`<div class="${Math.abs(x.drift)>=ta.threshold?'warn':''}"><span><i style="background:${x.color}"></i>${cbEsc(x.label)}</span><span>${x.currentPct.toFixed(1)}%</span><span>${x.targetPct.toFixed(1)}%</span><span class="${x.drift>=0?'up':'down'}">${x.drift>=0?'+':''}${x.drift.toFixed(1)}%p</span><span class="${x.diff>=0?'up':'down'}">${x.diff>=0?'매수 ':'축소 '}${cbDisp(Math.abs(x.diff))}</span><span>${x.dcaSuggestion>0?cbDisp(x.dcaSuggestion):'—'}</span></div>`).join('')}</div><small class="fin-disclaimer">조정액은 현재 평가액 기준의 단순 계산이며 매도·세금·거래비용을 반영하지 않습니다. DCA 보정안은 부족 자산군에 월 적립액을 비례 배분한 참고값입니다.</small></div>
    <div class="cb-panel fin-section"><div class="fin-section-head"><span>계좌 배치 진단</span><small>세금·이전 실행 전 증권사와 세무 전문가 확인 필요</small></div><div class="fin-account-table"><div class="head"><span>소유주 · 증권사 · 계좌</span><span>평가액</span><span>비중</span><span>진단</span></div>${accounts.map(x=>`<div><span><b>${cbEsc(x.key)}</b><small>${x.count}개 자산 · ${cbEsc(x.status)}</small></span><span>${cbDisp(x.value)}</span><span>${x.share.toFixed(1)}%</span><span>${cbEsc(x.finding)}</span></div>`).join('')||'<div class="fin-empty">계좌 정보가 있는 투자자산을 등록해 주세요.</div>'}</div></div>`;
}

function finDataStatusRows(){
  finEnsureState();const stale=(pfolioData||[]).filter(i=>i&&i._priceStale).length,stock=(pfolioData||[]).filter(i=>i&&i.grp==='주식').length,divCount=Object.keys(window._divDataCache||{}).length;
  const inferred={
    assets:{label:'투자자산 원장',source:'Vercel KV',ok:(pfolioData||[]).length>=0,detail:`${(pfolioData||[]).length}개 항목 로드`},
    ext:{label:'재무계획·현금흐름',source:'Vercel KV',ok:true,detail:`목표 ${goalData.length}개 · 재무상태표 ${window._balanceSheet.assets.length+window._balanceSheet.liabilities.length}개`},
    prices:{label:'시장 시세',source:'시장별 시세 API',ok:stale===0,detail:stale?`${stale}개 최신 확인 필요`:'등록 자산 최신 상태'},
    dividends:{label:'배당 데이터',source:'배당 데이터 API',ok:stock===0||divCount>0,detail:stock?`${divCount}/${stock}개 티커 캐시`:'주식 자산 없음'},
    rates:{label:'환율·금 시세',source:'Yahoo Finance · COMEX',ok:Number(RATES?.USD)>0,detail:`USD ${Number(RATES?.USD||0).toLocaleString()} · JPY ${Number(RATES?.JPY||0).toLocaleString()}`},
    benchmark:{label:'성과 벤치마크',source:'시장 지수 데이터',ok:Object.keys(benchData||{}).length>0,detail:Object.keys(benchData||{}).length?'기간별 데이터 로드':'아직 확인되지 않음'}
  };
  return Object.keys(inferred).map(key=>({key,...inferred[key],...(window._dataFreshness[key]||{})}));
}
function cbRenderDataStatus(){
  const el=document.getElementById('cb-data2');if(!el)return;const rows=finDataStatusRows(),ok=rows.filter(x=>x.ok).length;
  cbSetHead('출처 · 최근 확인 시각 · 오류·지연 상태를 한곳에서 확인');
  el.innerHTML=`<div class="fin-data-hero cb-panel"><div><small>데이터 신뢰 점검</small><strong>${ok}/${rows.length} 정상</strong><span>값이 비어 있거나 오래된 경우 먼저 이 화면에서 상태를 확인하세요.</span></div><button onclick="manualRefresh()">전체 데이터 새로고침</button></div><div class="fin-data-grid">${rows.map(x=>`<div class="cb-panel fin-data-card ${x.ok?'ok':'warn'}"><div><span class="fin-status-dot"></span><b>${cbEsc(x.label)}</b><em>${x.ok?'정상':'확인 필요'}</em></div><strong>${cbEsc(x.detail||'상태 정보 없음')}</strong><p>출처 · ${cbEsc(x.source||'내부 데이터')}</p><small>최근 확인 · ${finFreshAge(x.updatedAt)}</small><button onclick="manualRefresh()">다시 확인</button></div>`).join('')}</div><div class="cb-panel fin-section"><div class="fin-section-head"><span>상태 해석</span><small>투자 판단 전에 데이터 시점을 확인하세요.</small></div><div class="fin-guidance"><p><b>정상</b>은 마지막 요청이 성공했거나 현재 메모리의 데이터가 유효하다는 뜻입니다.</p><p><b>확인 필요</b>는 시세 지연, 빈 응답, 아직 실행되지 않은 동기화를 포함합니다.</p><p>외부 데이터는 거래소·제공사 사정에 따라 지연될 수 있으며, 주문 전 실제 증권사 시세를 확인해야 합니다.</p></div></div>`;
}
