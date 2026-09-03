// =====================================================================
// finance.js — 가족 재무상태표·목표·리밸런싱·데이터 신뢰 기능
// script.js의 저장 엔진과 cobalt.js의 공통 표시 헬퍼를 재사용한다.
// =====================================================================

const FIN_DEFAULT_TARGET={crypto:5,us:35,kr:25,jp:5,gold:10,cash:20};
const FIN_ASSET_CATS=['부동산','예·적금','보험 해약환급금','차량','기타 자산'];
const FIN_LIABILITY_CATS=['주택담보대출','신용대출','전세·임대보증금','카드·단기부채','기타 부채'];
// 순자산이 줄지 않는 자산 이동 카테고리 — 필수지출·순현금흐름 계산에서 모두 제외한다.
const FIN_SAVING_CATS=['저축/투자'];
let _finBalanceEdit=null;
let _finGoalEdit=null;
let _finBalanceOwner='전체';
let _finPlanOwner='전체';
let _finNwTf='6M';

// 같은 밀리초에 두 건을 추가해도 겹치지 않는 id (수정·삭제가 id 로 항목을 찾는다)
function finNewId(){ return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7); }
function finLocalDateKey(date=new Date()){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function finEnsureState(){
  const bs=window._balanceSheet||{};
  window._balanceSheet={
    assets:Array.isArray(bs.assets)?bs.assets:[],
    liabilities:Array.isArray(bs.liabilities)?bs.liabilities:[],
    cashTargetMonths:Math.max(1,Number(bs.cashTargetMonths)||6)
  };
  // id 없이 저장된 구버전 행에 id 를 채워 넣는다.
  ['assets','liabilities'].forEach(k=>window._balanceSheet[k].forEach(x=>{ if(x&&x.id==null) x.id=finNewId(); }));
  (Array.isArray(goalData)?goalData:[]).forEach(g=>{ if(g&&g.id==null) g.id=finNewId(); });
  const old=window._targetAlloc||{};
  const oldGroups=old.groups&&typeof old.groups==='object'?old.groups:{};
  const groups={};
  Object.keys(FIN_DEFAULT_TARGET).forEach(k=>{ groups[k]=Number.isFinite(Number(oldGroups[k]))?Number(oldGroups[k]):FIN_DEFAULT_TARGET[k]; });
  window._targetAlloc={...old,groups,threshold:Math.max(1,Number(old.threshold)||5)};
  if(!Array.isArray(goalData)) goalData=[];
  if(!window._dataFreshness||typeof window._dataFreshness!=='object') window._dataFreshness={};
}

// 소유주 필터는 전 계산 함수가 같은 규약을 쓴다 — null/'전체' 는 가구 합산.
function finOwnerF(owner){ return (owner&&owner!=='전체')?owner:null; }
function finRows(ownerF){
  const rows=typeof cbAllRows==='function'?cbAllRows():[];
  return ownerF?rows.filter(r=>r.i.owner===ownerF):rows;
}
function finSum(list,ownerF){ return (list||[]).filter(x=>!ownerF||x.owner===ownerF).reduce((s,x)=>s+(Number(x.amount)||0),0); }
function finBalanceTotals(ownerF){
  finEnsureState();
  const investment=finRows(ownerF).reduce((s,r)=>s+r.val,0);
  const otherAssets=finSum(window._balanceSheet.assets,ownerF);
  const liabilities=finSum(window._balanceSheet.liabilities,ownerF);
  return {investment,otherAssets,assets:investment+otherAssets,liabilities,net:investment+otherAssets-liabilities};
}

// 월 필수지출의 단일 소스. 현금 흐름 > 고정비 관리와 같은 기준(isFixedCost===true)을 쓰고,
// '저축/투자'는 순자산이 줄지 않는 자산 이동이므로 지출에서 제외한다(DCA는 별도로 더한다).
// 아직 분류되지 않은(isFixedCost==null) 자동이체는 합산하지 않고 건수만 돌려준다.
function finMonthlyFixedCost(ownerF){
  const d=new Date(),y=d.getFullYear(),m=d.getMonth()+1;
  const monthlyOf=x=>typeof _autoTransferMonthlyEquivalent==='function'?_autoTransferMonthlyEquivalent(x,y,m):(Number(x.amt)||0);
  const activeIn=x=>typeof _autoTransferActiveInMonth!=='function'||_autoTransferActiveInMonth(x,y,m);
  const base=(autoTransferData||[])
    .filter(x=>x&&x.type==='지출'&&!FIN_SAVING_CATS.includes(x.cat))
    .filter(x=>!ownerF||x.owner===ownerF)
    .filter(activeIn);
  const included=base.filter(x=>x.isFixedCost===true);
  const pending=base.filter(x=>x.isFixedCost==null);
  return {
    monthly:included.reduce((s,x)=>s+monthlyOf(x),0),
    pendingCount:pending.length,
    pendingMonthly:pending.reduce((s,x)=>s+monthlyOf(x),0)
  };
}
function finCashSafety(ownerF){
  finEnsureState();
  const cash=finRows(ownerF).filter(r=>r.cls==='cash').reduce((s,r)=>s+r.val,0);
  const fx=finMonthlyFixedCost(ownerF);
  const fixed=fx.monthly;
  const dca=(pfolioData||[]).filter(i=>i&&i.dca&&(!ownerF||i.owner===ownerF)).reduce((s,i)=>s+(typeof cbDcaPerMonthKRW==='function'?cbDcaPerMonthKRW(i):0),0);
  const committed=fixed+dca;
  const targetMonths=window._balanceSheet.cashTargetMonths||6;
  const runway=fixed>0?cash/fixed:null;
  const committedRunway=committed>0?cash/committed:null;
  const shortage=Math.max(0,fixed*targetMonths-cash);
  return {cash,fixed,dca,committed,targetMonths,runway,committedRunway,shortage,
    pendingCount:fx.pendingCount,pendingMonthly:fx.pendingMonthly};
}
function finTargetAnalysis(ownerF){
  finEnsureState();
  const rows=finRows(ownerF);
  const total=rows.reduce((s,r)=>s+r.val,0);
  const current={}; rows.forEach(r=>{current[r.cls]=(current[r.cls]||0)+r.val;});
  const groups=window._targetAlloc.groups;
  const monthlyDca=(pfolioData||[]).filter(i=>i&&i.dca&&(!ownerF||i.owner===ownerF)).reduce((s,i)=>s+(typeof cbDcaPerMonthKRW==='function'?cbDcaPerMonthKRW(i):0),0);
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
// 순현금흐름은 순자산 변화를 설명하기 위한 값이므로 '저축/투자'는 제외한다.
// 통장에서 증권계좌로 옮긴 돈은 지출이 아니라 자산 이동이라 순자산이 줄지 않는다.
function finMonthCashflow(sinceDate='',ownerF){
  const d=new Date(),today=finLocalDateKey(d),prefix=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  return (cfData||[])
    .filter(x=>!FIN_SAVING_CATS.includes(x&&x.cat))
    .filter(x=>!ownerF||x.owner===ownerF)
    .filter(x=>{const date=String(x.date||'');return sinceDate?(date>sinceDate&&date<=today):date.startsWith(prefix);})
    .reduce((s,x)=>s+(x.type==='수입'?1:-1)*(Number(x.amt)||0),0);
}
// 무버전 스냅샷은 두 종류다.
// - 초기 형식: total=투자자산
// - 4b86 이후 형식: nonInvestmentAssets 필드가 있고 total=전체 순자산
// schemaV만으로 모두 v1 취급하면 호환 가능한 직전 형식까지 잃으므로 구조를 함께 판별한다.
function finSnapshotKind(entry){
  if(!entry||typeof entry!=='object') return null;
  if(entry.schemaV!=null&&entry.schemaV!==''){
    const v=Number(entry.schemaV);
    if(v===1) return 'investment';
    if(Number.isFinite(v)&&v>=2) return 'full';
    return null;
  }
  const own=key=>Object.prototype.hasOwnProperty.call(entry,key);
  return own('nonInvestmentAssets')||own('netByOwner')?'full':'investment';
}
function finSnapshotNumber(value){
  if(value==null||value===''||typeof value==='boolean') return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}
function finSnapshotNet(entry,balanceSheetEmpty){
  const kind=finSnapshotKind(entry);
  const total=finSnapshotNumber(entry?.total);
  if(!kind||total==null) return null;
  if(kind==='full') return total;
  return balanceSheetEmpty?total:null;
}
function finSnapshotOwnerNet(entry,owner,balanceSheetEmpty){
  const kind=finSnapshotKind(entry);
  if(!kind||!owner) return null;
  if(kind==='full'){
    return finSnapshotNumber((entry.netByOwner||{})[owner]);
  }
  if(!balanceSheetEmpty) return null;
  return finSnapshotNumber((entry.portfolioByOwner||{})[owner]);
}
function finNetWorthBridge(){
  const totals=finBalanceTotals();
  const bsEmpty=totals.otherAssets===0&&totals.liabilities===0;
  const hist=(window._netWorthHistory||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const today=finLocalDateKey(new Date());
  const candidates=hist.filter(x=>x.date!==today);
  const skipped=candidates.filter(x=>finSnapshotNet(x,bsEmpty)==null).length;
  let prior=null,previous=totals.net;
  for(let k=candidates.length-1;k>=0;k--){
    const net=finSnapshotNet(candidates[k],bsEmpty);
    if(net!=null){ prior=candidates[k]; previous=net; break; }
  }
  const change=totals.net-previous;
  const cashflow=finMonthCashflow(prior?.date||'');
  const residual=change-cashflow;
  return {totals,prior,previous,change,cashflow,residual,skipped};
}

// 데이터 상태는 ext_data 전체 저장과 분리한다. 상태 변경만으로 현금흐름·목표 같은 큰 객체의
// revision 충돌을 만들지 않도록 data_freshness 키만 짧게 디바운스해 갱신한다.
// 이번 접속에서 직접 확인한 건지 구분해야 "3시간 전 확인"이 내 확인인지 알 수 있다.
const FIN_FRESHNESS_KV_KEY='data_freshness';
const FIN_FRESHNESS_SAVE_DELAY=500;
const FIN_SESSION_ID=finNewId();
function finFreshnessSnapshot(value=window._dataFreshness){
  const src=value&&typeof value==='object'?value:{};
  const out={};
  Object.keys(src).forEach(key=>{
    const row=src[key]; if(!row||typeof row!=='object') return;
    out[key]={
      label:String(row.label||'').slice(0,80),
      source:String(row.source||'').slice(0,120),
      ok:row.ok===true,
      detail:String(row.detail||'').slice(0,240),
      updatedAt:String(row.updatedAt||''),
      session:String(row.session||'').slice(0,80)
    };
  });
  return out;
}
function finFreshnessTime(row){
  const n=Date.parse(row?.updatedAt||'');
  return Number.isFinite(n)?n:0;
}
function finMergeFreshness(base,incoming){
  const merged=finFreshnessSnapshot(base), next=finFreshnessSnapshot(incoming);
  Object.keys(next).forEach(key=>{
    if(!merged[key]||finFreshnessTime(next[key])>=finFreshnessTime(merged[key])) merged[key]=next[key];
  });
  return merged;
}
async function finSaveFreshnessNow(){
  if(typeof setKV!=='function') return {ok:false,skipped:true,error:'KV 저장 함수 없음'};
  if(window._finFreshnessSaveTimer){ clearTimeout(window._finFreshnessSaveTimer); window._finFreshnessSaveTimer=null; }
  let payload=finFreshnessSnapshot();
  let result=await setKV(FIN_FRESHNESS_KV_KEY,payload);
  // 상태 표시는 서로 독립적인 키가 대부분이므로 충돌 시 최신 시각 기준으로 한 번 안전하게 병합한다.
  if(result?.conflict&&typeof getKV==='function'){
    const remote=await getKV(FIN_FRESHNESS_KV_KEY);
    payload=finMergeFreshness(remote,payload);
    window._dataFreshness=payload;
    result=await setKV(FIN_FRESHNESS_KV_KEY,payload);
  }
  const ok=!!(result&&result.result==='OK');
  window._finFreshnessSaveState={ok,updatedAt:new Date().toISOString(),status:result?.status||null};
  return {ok,status:result?.status||null};
}
function finScheduleFreshnessSave(){
  if(typeof setKV!=='function') return;
  if(window._finFreshnessSaveTimer) clearTimeout(window._finFreshnessSaveTimer);
  window._finFreshnessSaveTimer=setTimeout(()=>{
    window._finFreshnessSaveTimer=null;
    finSaveFreshnessNow().catch(e=>{
      window._finFreshnessSaveState={ok:false,updatedAt:new Date().toISOString(),error:e?.message||'저장 실패'};
      console.warn('[data freshness save]',e);
    });
  },FIN_FRESHNESS_SAVE_DELAY);
}
async function finLoadFreshnessFromKV(){
  if(typeof getKV!=='function') return {ok:false,skipped:true,error:'KV 조회 함수 없음'};
  let remote;
  try{ remote=await getKV(FIN_FRESHNESS_KV_KEY); }
  catch(e){ return {ok:false,error:e?.message||'데이터 상태 로드 실패'}; }
  finEnsureState();
  const clean=finFreshnessSnapshot(remote);
  window._dataFreshness=finMergeFreshness(clean,window._dataFreshness);
  if(typeof cbRenderDataStatus==='function'&&typeof document!=='undefined'&&document.getElementById('view-data2')?.classList.contains('active')) cbRenderDataStatus();
  if(typeof cbSyncFeedStatus==='function') cbSyncFeedStatus();
  return {ok:true,count:Object.keys(clean).length};
}
function finMarkFresh(key,label,source,ok=true,detail=''){
  finEnsureState();
  window._dataFreshness[key]={label,source,ok:!!ok,detail:String(detail||''),updatedAt:new Date().toISOString(),session:FIN_SESSION_ID};
  finScheduleFreshnessSave();
  if(typeof cbRenderDataStatus==='function'&&typeof document!=='undefined'&&document.getElementById('view-data2')?.classList.contains('active')) cbRenderDataStatus();
  if(typeof cbSyncFeedStatus==='function') cbSyncFeedStatus();
}
function finFreshAge(iso){
  if(!iso) return '확인 전';
  const ms=Date.now()-new Date(iso).getTime(); if(!Number.isFinite(ms)) return '확인 전';
  const min=Math.max(0,Math.floor(ms/60000));
  if(min<1) return '방금 전'; if(min<60) return `${min}분 전`; if(min<1440) return `${Math.floor(min/60)}시간 전`;
  return `${Math.floor(min/1440)}일 전`;
}

function finMonthlyActions(ownerF){
  const target=finTargetAnalysis(ownerF); const safety=finCashSafety(ownerF);
  const items=[];
  if(target.max&&Math.abs(target.max.drift)>=target.threshold) items.push({tone:'warn',title:`${target.max.label} 목표 비중 점검`,desc:`목표 대비 ${target.max.drift>=0?'+':''}${target.max.drift.toFixed(1)}%p`,view:'plan2',menu:'plan2'});
  else items.push({tone:'ok',title:'목표 비중 허용범위',desc:target.max?`최대 편차 ${Math.abs(target.max.drift).toFixed(1)}%p`:'투자자산 등록 필요',view:'plan2',menu:'plan2'});
  if(safety.fixed<=0) items.push({tone:'info',title:'필수지출 등록',desc:safety.pendingCount?`미분류 자동이체 ${safety.pendingCount}건을 고정비로 분류`:'현금 안전판 계산을 위해 현금 흐름에서 등록',view:'cashflow',menu:'cashflow'});
  else if(safety.runway<safety.targetMonths) items.push({tone:'warn',title:'현금 안전판 보강',desc:`${safety.runway.toFixed(1)}개월 · 목표 ${safety.targetMonths}개월`,view:'balance2',menu:'balance2'});
  else items.push({tone:'ok',title:'현금 안전판',desc:`${safety.runway.toFixed(1)}개월 확보`,view:'balance2',menu:'balance2'});
  if(safety.fixed>0&&safety.pendingCount) items.push({tone:'warn',title:'고정비 미분류 정리',desc:`${safety.pendingCount}건 · 월 ${cbDisp(safety.pendingMonthly)}이 안전판에서 빠짐`,view:'cashflow',menu:'cashflow'});
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
function finDashboardFocus(owner){
  // 대시보드 소유주 탭을 그대로 따른다 — 카드에도 어떤 범위를 보고 있는지 항상 명시한다.
  const ownerF=finOwnerF(owner);
  const scope=ownerF?cbEsc(ownerF):'가구 전체';
  const actions=finMonthlyActions(ownerF);
  const target=finTargetAnalysis(ownerF); const safety=finCashSafety(ownerF);
  const drift=target.max;
  const actionRows=actions.map(a=>`<button class="fin-action-row ${a.tone}" onclick="switchView('${a.view}',document.getElementById('menu-${a.menu}'))"><span class="fin-action-dot"></span><span><b>${cbEsc(a.title)}</b><small>${cbEsc(a.desc)}</small></span><span class="fin-action-go">›</span></button>`).join('');
  const driftPct=drift?Math.min(100,Math.abs(drift.drift)/Math.max(1,target.threshold*2)*100):0;
  const runwayPct=safety.runway==null?0:Math.min(100,safety.runway/safety.targetMonths*100);
  return `<div class="fin-dashboard-priority">
    <div class="cb-panel fin-action-panel"><div class="fin-section-head"><span>이번 달 할 일</span><small>${scope} · ${actions.length}개 점검 항목</small></div><div class="fin-action-list">${actionRows}</div></div>
    <div class="fin-priority-side">
      <button class="cb-panel fin-focus-card" onclick="switchView('plan2',document.getElementById('menu-plan2'))"><div class="fin-section-head"><span>목표 비중 편차</span><small>${scope} · 허용 ±${target.threshold}%p</small></div><strong>${drift?cbEsc(drift.label):'—'} <em>${drift?(drift.drift>=0?'+':'')+drift.drift.toFixed(1)+'%p':'데이터 없음'}</em></strong><div class="fin-meter"><i style="width:${driftPct}%"></i></div><p>${drift&&Math.abs(drift.drift)>=target.threshold?'리밸런싱 검토가 필요합니다.':'현재 허용범위 안입니다.'}</p></button>
      <button class="cb-panel fin-focus-card" onclick="switchView('balance2',document.getElementById('menu-balance2'))"><div class="fin-section-head"><span>현금 안전판</span><small>${scope} · 목표 ${safety.targetMonths}개월</small></div><strong>${safety.runway==null?'—':safety.runway.toFixed(1)+'개월'} <em>${cbDisp(safety.cash)}</em></strong><div class="fin-meter cash"><i style="width:${runwayPct}%"></i></div><p>${safety.fixed<=0?'필수지출을 등록하면 계산됩니다.':safety.shortage>0?`목표까지 ${cbDisp(safety.shortage)} 부족`:'목표 현금이 확보되었습니다.'}</p></button>
    </div>
  </div>`;
}

// 모바일에서는 입력 폼을 감추므로(스타일시트 768px 규칙) 왜 안 보이는지 화면에서 알려준다.
function finMobileNote(what){
  return `<div class="fin-mobile-note">모바일에서는 조회만 가능합니다. ${cbEsc(what)} 추가·수정은 PC 화면에서 해주세요.</div>`;
}

async function finSaveAndRender(renderFn,refreshSnapshot=false){
  // 재무상태표 변경은 오늘의 전체 순자산에도 즉시 반영하고, 확장 데이터는 한 번만 저장한다.
  const originalsReady=window._kvLoadState?.assets==='ready'&&window._kvLoadState?.ext==='ready';
  if(refreshSnapshot&&originalsReady&&typeof updateNetWorthSnapshot==='function') updateNetWorthSnapshot();
  let result={ok:false,error:'저장 함수를 찾을 수 없습니다.'};
  try{ result=await saveExtDataToKV(); }catch(e){ result={ok:false,error:e?.message||'저장 실패'};console.error('[finance save]',e); }
  if(typeof renderFn==='function') renderFn();
  if(typeof cbRerender==='function'&&!document.getElementById('view-balance2')?.classList.contains('active')&&!document.getElementById('view-plan2')?.classList.contains('active')) cbRerender();
  return result;
}
// 목록이 소유주 필터로 걸러지므로 수정·삭제는 배열 인덱스가 아니라 id 로 찾는다.
function finBalanceKey(kind){ return kind==='liability'?'liabilities':'assets'; }
function finBalanceFind(kind,id){
  const list=window._balanceSheet[finBalanceKey(kind)]||[];
  return list.findIndex(x=>String(x.id)===String(id));
}
function finBalanceKindChange(){ const k=document.getElementById('fin-bs-kind')?.value||'asset'; const sel=document.getElementById('fin-bs-category'); if(!sel)return; const cats=k==='liability'?FIN_LIABILITY_CATS:FIN_ASSET_CATS; sel.innerHTML=cats.map(x=>`<option>${cbEsc(x)}</option>`).join(''); }
function finBalanceEdit(kind,id){ _finBalanceEdit={kind,id}; cbRenderBalanceSheet(); document.getElementById('fin-bs-form')?.scrollIntoView({behavior:'smooth',block:'center'}); }
function finBalanceCancel(){ _finBalanceEdit=null; cbRenderBalanceSheet(); }
function finBalanceDelete(kind,id){
  finEnsureState();
  const idx=finBalanceFind(kind,id); if(idx<0) return;
  const row=window._balanceSheet[finBalanceKey(kind)][idx];
  if(!confirm(`'${row.name}' 항목을 삭제할까요?`)) return;
  window._balanceSheet[finBalanceKey(kind)].splice(idx,1); _finBalanceEdit=null; return finSaveAndRender(cbRenderBalanceSheet,true);
}
function finBalanceSubmit(){
  finEnsureState();
  const kind=document.getElementById('fin-bs-kind')?.value||'asset';
  const editIdx=_finBalanceEdit?finBalanceFind(_finBalanceEdit.kind,_finBalanceEdit.id):-1;
  const row={
    id:editIdx>=0?_finBalanceEdit.id:finNewId(),
    owner:document.getElementById('fin-bs-owner')?.value||'본인',
    category:document.getElementById('fin-bs-category')?.value||'기타',
    name:(document.getElementById('fin-bs-name')?.value||'').trim(),
    amount:Number(document.getElementById('fin-bs-amount')?.value)||0,
    note:(document.getElementById('fin-bs-note')?.value||'').trim()
  };
  if(!row.name||row.amount<=0){ alert('항목명과 0보다 큰 금액을 입력해 주세요.'); return; }
  // 수정은 제자리에서 교체한다 — splice 후 push 하면 목록 맨 아래로 튀어 어디를 고쳤는지 놓친다.
  if(editIdx>=0) window._balanceSheet[finBalanceKey(_finBalanceEdit.kind)].splice(editIdx,1,row);
  else window._balanceSheet[finBalanceKey(kind)].push(row);
  _finBalanceEdit=null; return finSaveAndRender(cbRenderBalanceSheet,true);
}
function finSaveCashTarget(){ const n=Math.max(1,Math.min(36,Number(document.getElementById('fin-cash-target')?.value)||6)); window._balanceSheet.cashTargetMonths=n; finSaveAndRender(cbRenderBalanceSheet); }
function finBalanceOwner(o){ _finBalanceOwner=o; _finBalanceEdit=null; cbRenderBalanceSheet(); }
function finNwTf(tf){ _finNwTf=tf; cbRenderBalanceSheet(); }

// ── 순자산 추이 ─────────────────────────────────────────
// _netWorthHistory 는 앱을 열 때마다 하루 1건씩 쌓이고 있었지만 그리는 화면이 없었다.
// 소유주 필터는 netByOwner(스키마 v2) → portfolioByOwner(v1 폴백) 순으로 읽는다.
const FIN_NW_TFS={'1M':30,'3M':90,'6M':180,'1Y':365,'전체':null};
// tf 를 넘기면 그 기간으로, 넘기지 않으면 재무상태표가 고른 기간(_finNwTf)으로 자른다.
// (한눈에 보기 페이지는 자기 기간을 따로 기억하므로 재무상태표 선택을 건드리지 않는다)
function finNwSeries(ownerF,tf){
  const hist=(window._netWorthHistory||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const tfKey=tf===undefined?_finNwTf:tf;
  const days=FIN_NW_TFS[tfKey]!==undefined?FIN_NW_TFS[tfKey]:180;
  const cutoff=days?Date.now()-days*86400000:null;
  const picked=hist.filter(h=>!cutoff||new Date(h.date).getTime()>=cutoff);
  const scopeTotals=finBalanceTotals(ownerF);
  const balanceSheetEmpty=scopeTotals.otherAssets===0&&scopeTotals.liabilities===0;
  return picked.map(h=>{
    const v=ownerF
      ? finSnapshotOwnerNet(h,ownerF,balanceSheetEmpty)
      : finSnapshotNet(h,balanceSheetEmpty);
    return {date:h.date,v};
  }).filter(p=>p.v!=null);
}
function finNwStats(series){
  if(series.length<2) return null;
  const values=series.map(p=>Number(p.v));
  if(values.some(v=>!Number.isFinite(v))) return null;
  const first=values[0], last=values[values.length-1];
  // MDD는 양수 자산의 고점 대비 비율이다. 0원 이하 구간을 0%로 보이는 것은
  // 실제 하락이 없었다는 뜻으로 오해되므로 해당 시리즈에서는 산정 불가로 둔다.
  let mdd=null;
  if(values.every(v=>v>0)){
    let peak=-Infinity, worst=0;
    values.forEach(v=>{ if(v>peak) peak=v; const dd=v/peak-1; if(dd<worst) worst=dd; });
    mdd=worst*100;
  }
  return {first,last,change:last-first,pct:first>0?(last/first-1)*100:null,mdd,
    min:Math.min(...values), max:Math.max(...values)};
}
function finNwChartSvg(series,w,h){
  if(series.length<2) return `<div class="fin-empty">추이를 그리려면 스냅샷이 2일치 이상 필요합니다. 앱을 열 때마다 하루 1건씩 자동으로 쌓입니다. (현재 ${series.length}건)</div>`;
  const vals=series.map(p=>p.v);
  const mn=Math.min(...vals), mx=Math.max(...vals), span=(mx-mn)||Math.abs(mx)||1;
  const step=cbNiceStep(span*1.2/4);
  const rawLo=Math.floor((mn-span*0.1)/step)*step;
  const lo=mn>=0?Math.max(0,rawLo):rawLo, hi=Math.ceil((mx+span*0.1)/step)*step;
  const padL=CB_LINE_PAD.l, padR=CB_LINE_PAD.r, plotW=w-padL-padR;
  const y=v=>h-8-((v-lo)/((hi-lo)||1))*(h-16);
  const dx=plotW/(series.length-1);
  let grid='';
  for(let v=lo; v<=hi+step*0.01; v+=step){
    const yy=y(v).toFixed(1);
    grid+=`<line x1="${padL}" x2="${w-padR}" y1="${yy}" y2="${yy}" style="stroke:var(--grid)" stroke-width="1"></line>`;
    grid+=`<text x="${padL-7}" y="${(y(v)+3.4).toFixed(1)}" style="fill:var(--lab)" font-size="10" text-anchor="end" font-family="IBM Plex Mono">${cbTaxAxisLab(v)}</text>`;
  }
  const pts=series.map((p,i)=>({x:padL+i*dx, y:y(p.v)}));
  const line=cbSmoothPath(pts);
  const up=series[series.length-1].v>=series[0].v;
  const stroke=up?'var(--up)':'var(--dn)';
  const area=`${line} L${(padL+(series.length-1)*dx).toFixed(1)},${(h-8).toFixed(1)} L${padL.toFixed(1)},${(h-8).toFixed(1)} Z`;
  const every=Math.max(1,Math.ceil(series.length/6));
  const ticks=series.map((p,i)=>({p,i})).filter(x=>x.i%every===0||x.i===series.length-1)
    .map(x=>`<text x="${(padL+x.i*dx).toFixed(1)}" y="${h+11}" style="fill:var(--dim)" font-size="9.5" text-anchor="middle" font-family="IBM Plex Mono">${cbEsc(String(x.p.date||'').slice(5).replace('-','/'))}</text>`).join('');
  const hit=series.map((p,i)=>{
    const left=Math.max(0,padL+i*dx-dx/2), width=Math.min(dx,w-left);
    return `<rect x="${left.toFixed(1)}" y="0" width="${width.toFixed(1)}" height="${h}" fill="transparent" style="cursor:crosshair" onmousemove="finNwHover(event,${i})"></rect>`;
  }).join('');
  window._finNwHover=series;
  const chartLabel=`순자산 추이. ${series[0].date} ${cbDisp(series[0].v)}에서 ${series[series.length-1].date} ${cbDisp(series[series.length-1].v)}까지`;
  return `<div class="fin-nw-chart-scroll"><div class="fin-nw-chart-canvas"><svg viewBox="0 0 ${w} ${h+18}" width="100%" preserveAspectRatio="none" style="display:block;overflow:visible" role="img" aria-label="${cbEsc(chartLabel)}" onmouseleave="finNwHide()">
    <title>${cbEsc(chartLabel)}</title>
    ${grid}
    <path d="${area}" fill="${stroke}" opacity=".10"></path>
    <path d="${line}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
    <circle cx="${pts[pts.length-1].x.toFixed(1)}" cy="${pts[pts.length-1].y.toFixed(1)}" r="3.4" fill="${stroke}"></circle>
    ${ticks}${hit}
  </svg></div></div>`;
}
function finNwHover(ev,idx){
  const series=window._finNwHover; if(!series||!series[idx]) return;
  const t=(typeof _cbPerfTipEl==='function')?_cbPerfTipEl():null; if(!t) return;
  const p=series[idx], prev=series[idx-1];
  const delta=prev?p.v-prev.v:null;
  t.innerHTML=`<div style="font-size:10.5px;color:var(--lab);margin-bottom:5px;font-weight:700">${cbEsc(p.date)}</div>
    <div style="display:flex;justify-content:space-between;gap:18px"><span style="color:var(--mut)">순자산</span><b class="cb-num">${cbDisp(p.v)}</b></div>
    ${delta!=null?`<div style="display:flex;justify-content:space-between;gap:18px"><span style="color:var(--mut)">전일 대비</span><b class="cb-num" style="${cbUpDn(delta)}">${cbSignDisp(delta)}</b></div>`:''}`;
  t.style.display='block';
  const r=t.getBoundingClientRect(), pad=16;
  let x=ev.clientX+pad, yy=ev.clientY+pad;
  if(x+r.width>window.innerWidth-8) x=ev.clientX-r.width-pad;
  if(yy+r.height>window.innerHeight-8) yy=ev.clientY-r.height-pad;
  t.style.left=Math.max(8,x)+'px'; t.style.top=Math.max(8,yy)+'px';
}
function finNwHide(){ const t=document.getElementById('cb-perf-tip'); if(t) t.style.display='none'; }

function cbRenderBalanceSheet(){
  finEnsureState(); const el=document.getElementById('cb-balance2'); if(!el)return;
  const ownerF=finOwnerF(_finBalanceOwner);
  const scope=ownerF?cbEsc(ownerF):'가구 전체';
  const t=finBalanceTotals(ownerF),bridge=finNetWorthBridge(),safe=finCashSafety(ownerF);
  cbSetHead('투자자산 + 기타 자산 − 부채 · 전체 순자산을 투자 성과와 분리해 관리',
    cbOwnerBtns(_finBalanceOwner,'finBalanceOwner'));
  const listOf=kind=>(window._balanceSheet[finBalanceKey(kind)]||[]).filter(x=>!ownerF||x.owner===ownerF);
  const rows=(kind,list)=>list.map(x=>`<div class="fin-bs-row"><span><b>${cbEsc(x.name)}</b><small>${cbEsc(x.owner)} · ${cbEsc(x.category)}${x.note?' · '+cbEsc(x.note):''}</small></span><strong>${cbDisp(Number(x.amount)||0)}</strong><span class="fin-row-actions"><button data-kind="${cbEsc(kind)}" data-id="${cbEsc(String(x.id||''))}" onclick="finBalanceEdit(this.dataset.kind,this.dataset.id)">수정</button><button data-kind="${cbEsc(kind)}" data-id="${cbEsc(String(x.id||''))}" onclick="finBalanceDelete(this.dataset.kind,this.dataset.id)">삭제</button></span></div>`).join('')||'<div class="fin-empty">등록된 항목이 없습니다.</div>';
  const assetList=listOf('asset'), liabList=listOf('liability');
  const edit=_finBalanceEdit;
  const editIdx=edit?finBalanceFind(edit.kind,edit.id):-1;
  const old=editIdx>=0?window._balanceSheet[finBalanceKey(edit.kind)][editIdx]:null;
  const kind=edit?.kind||'asset'; const cats=kind==='liability'?FIN_LIABILITY_CATS:FIN_ASSET_CATS;
  const ownerBreak=OWNERS.map(owner=>{const inv=finRows(owner).reduce((s,r)=>s+r.val,0);const oa=finSum(window._balanceSheet.assets,owner);const li=finSum(window._balanceSheet.liabilities,owner);return{owner,inv,oa,li,net:inv+oa-li};}).filter(x=>x.inv||x.oa||x.li);

  // 순자산 추이
  const series=finNwSeries(ownerF); const st=finNwStats(series);
  const tfBtns=Object.keys(FIN_NW_TFS).map(tf=>`<button class="owner-btn${tf===_finNwTf?' active':''}" onclick="finNwTf('${tf}')">${tf}</button>`).join('');

  // 브리지는 가구 전체 스냅샷만 있으므로 소유주 필터와 무관하게 가구 기준임을 밝힌다.
  const bridgeNote=bridge.prior
    ? `${cbEsc(bridge.prior.date)} 이후 · 가구 전체 기준${bridge.skipped?` · 정의가 다른 과거 스냅샷 ${bridge.skipped}건 제외`:''}`
    : '스냅샷 준비 중';
  const bridgeCards=bridge.prior
    ? `<div class="fin-bridge"><div><small>이전 순자산</small><b>${cbDisp(bridge.previous)}</b></div><span>+</span><div class="${bridge.cashflow>=0?'up':'down'}"><small>이후 순현금흐름</small><b>${cbSignDisp(bridge.cashflow)}</b></div><span>+</span><div class="${bridge.residual>=0?'up':'down'}"><small><span data-tip="순자산 변화에서 가계부에 기록된 순현금흐름을 뺀 나머지입니다. 시세·환율 변동이 대부분이지만, 가계부에 적지 않은 입출금이나 자산 내역 직접 수정도 여기에 함께 잡힙니다.">설명되지 않는 차이</span></small><b>${cbSignDisp(bridge.residual)}</b></div><span>=</span><div><small>현재 순자산</small><b>${cbDisp(bridge.totals.net)}</b></div></div>`
    : `<div class="fin-empty">오늘부터 순자산 스냅샷을 쌓습니다. 다음 스냅샷부터 현금흐름과 나머지 변동을 분리해 보여드립니다.</div>`;
  el.innerHTML=`
    <div class="fin-summary-grid"><div class="cb-panel fin-kpi"><small>${scope} 투자자산</small><strong>${cbDisp(t.investment)}</strong><span>주식·가상화폐·금·현금</span></div><div class="cb-panel fin-kpi"><small>기타 자산</small><strong>${cbDisp(t.otherAssets)}</strong><span>부동산·예적금·보험 등</span></div><div class="cb-panel fin-kpi liability"><small>부채</small><strong>${cbDisp(t.liabilities)}</strong><span>대출·보증금·단기부채</span></div><div class="cb-panel fin-kpi net"><small>${scope} 순자산</small><strong>${cbDisp(t.net)}</strong><span>총자산 ${cbDisp(t.assets)} − 부채</span></div></div>

    <div class="cb-panel fin-section">
      <div class="fin-section-head">
        <span>순자산 추이 <span style="color:var(--dim);font-weight:500">· ${scope}</span></span>
        <div class="owner-tabs" style="display:inline-flex;gap:3px;flex-wrap:wrap">${tfBtns}</div>
      </div>
      ${st?`<div class="fin-nw-stats">
        <div><small>기간 증감</small><b class="${st.change>=0?'up':'down'}">${cbSignDisp(st.change)}${st.pct!=null?` <em>${(st.pct>=0?'+':'')+st.pct.toFixed(1)}%</em>`:''}</b></div>
        <div><small><span data-tip="선택 기간 중 고점 대비 최대 하락폭입니다. 순자산이 0원 이하인 구간이 있으면 비율을 산정하지 않습니다.">최대 낙폭(MDD)</span></small><b class="${st.mdd!=null&&st.mdd<0?'down':''}">${st.mdd==null?'—':st.mdd.toFixed(1)+'%'}</b></div>
        <div><small>기간 최고 / 최저</small><b>${cbDisp(st.max)} / ${cbDisp(st.min)}</b></div>
        <div><small>스냅샷</small><b>${series.length}일</b></div>
      </div>`:''}
      ${finNwChartSvg(series,1100,230)}
    </div>

    <div class="cb-panel fin-section"><div class="fin-section-head"><span>순자산 변화 분석</span><small>${bridgeNote}</small></div>${bridgeCards}</div>
    <div class="fin-balance-grid">
      <div class="cb-panel fin-section"><div class="fin-section-head"><span>기타 자산</span><small>${assetList.length}개 · ${cbDisp(t.otherAssets)}</small></div>${rows('asset',assetList)}</div>
      <div class="cb-panel fin-section"><div class="fin-section-head"><span>부채</span><small>${liabList.length}개 · ${cbDisp(t.liabilities)}</small></div>${rows('liability',liabList)}</div>
    </div>
    <div class="fin-balance-grid">
      <div class="cb-panel fin-section"><div class="fin-section-head"><span>현금 안전판</span><small>${scope} · 필수지출 기준</small></div><div class="fin-safety"><strong>${safe.runway==null?'—':safe.runway.toFixed(1)+'개월'}</strong><p>현금 ${cbDisp(safe.cash)} / 월 필수지출 ${cbDisp(safe.fixed)}</p><p>DCA 포함 월 약정액 ${cbDisp(safe.committed)}${safe.committedRunway!=null?' · '+safe.committedRunway.toFixed(1)+'개월':''}</p><div class="fin-inline-form"><label>목표 개월</label><input id="fin-cash-target" type="number" min="1" max="36" value="${safe.targetMonths}"><button onclick="finSaveCashTarget()">저장</button></div>${safe.fixed<=0?'<small class="fin-callout">현금 흐름 &gt; 고정비 관리에서 고정비로 분류하면 자동 계산됩니다.</small>':safe.shortage>0?`<small class="fin-callout warn">목표까지 ${cbDisp(safe.shortage)}가 더 필요합니다.</small>`:'<small class="fin-callout ok">목표 안전판을 확보했습니다.</small>'}${safe.pendingCount?`<small class="fin-callout warn">미분류 자동이체 ${safe.pendingCount}건(월 ${cbDisp(safe.pendingMonthly)})은 합산하지 않았습니다. 현금 흐름 &gt; 고정비 관리에서 분류해 주세요.</small>`:''}</div></div>
      <div class="cb-panel fin-section"><div class="fin-section-head"><span>소유주별 순자산</span><small>투자자산 + 기타 자산 − 부채</small></div><div class="fin-owner-table">${ownerBreak.map(x=>`<div><span><i style="background:${cbOwnerColor(x.owner)}"></i>${cbEsc(x.owner)}</span><small>투자 ${cbDisp(x.inv)} · 기타 ${cbDisp(x.oa)} · 부채 ${cbDisp(x.li)}</small><b>${cbDisp(x.net)}</b></div>`).join('')||'<div class="fin-empty">표시할 자산이 없습니다.</div>'}</div></div>
    </div>
    ${finMobileNote('재무상태표 항목')}
    <div class="cb-panel fin-section" id="fin-bs-form"><div class="fin-section-head"><span>${old?'재무상태표 항목 수정':'재무상태표 항목 추가'}</span><small>투자자산은 자산 내역에서 관리합니다.</small></div><div class="fin-form-grid">
      <label>구분<select id="fin-bs-kind" onchange="finBalanceKindChange()" ${old?'disabled':''}><option value="asset" ${kind==='asset'?'selected':''}>기타 자산</option><option value="liability" ${kind==='liability'?'selected':''}>부채</option></select></label>
      <label>소유주<select id="fin-bs-owner">${OWNERS.map(o=>`<option ${(old?old.owner===o:ownerF===o)?'selected':''}>${cbEsc(o)}</option>`).join('')}</select></label>
      <label>분류<select id="fin-bs-category">${cats.map(c=>`<option ${old?.category===c?'selected':''}>${cbEsc(c)}</option>`).join('')}</select></label>
      <label>항목명<input id="fin-bs-name" value="${cbEsc(old?.name||'')}" placeholder="예: 거주 아파트"></label>
      <label>금액(원)<input id="fin-bs-amount" type="number" min="0" step="10000" value="${Number.isFinite(Number(old?.amount))?Number(old.amount):''}" placeholder="0"></label>
      <label>메모<input id="fin-bs-note" value="${cbEsc(old?.note||'')}" placeholder="선택 입력"></label>
    </div><div class="fin-form-actions"><button class="primary" onclick="finBalanceSubmit()">${old?'수정 저장':'항목 추가'}</button>${old?'<button onclick="finBalanceCancel()">취소</button>':''}</div></div>`;
}

function finGoalCurrent(g){
  const link=g.linkClass||'investment'; const t=finBalanceTotals();
  if(link==='net')return t.net; if(link==='investment')return t.investment;
  if(link==='manual')return Number(g.currentAmount)||0;
  return finRows().filter(r=>r.cls===link).reduce((s,r)=>s+r.val,0);
}
function finGoalFind(id){ return (goalData||[]).findIndex(g=>String(g.id)===String(id)); }
function finGoalEdit(id){_finGoalEdit=id;cbRenderPlan();document.getElementById('fin-goal-form')?.scrollIntoView({behavior:'smooth',block:'center'});}
function finGoalCancel(){_finGoalEdit=null;cbRenderPlan();}
function finGoalDelete(id){
  const idx=finGoalFind(id); if(idx<0) return;
  if(!confirm(`'${goalData[idx].name}' 목표를 삭제할까요?`))return;
  goalData.splice(idx,1);_finGoalEdit=null;finSaveAndRender(cbRenderPlan);
}
function finGoalSubmit(){
  const idx=_finGoalEdit!=null?finGoalFind(_finGoalEdit):-1;
  const g={id:idx>=0?_finGoalEdit:finNewId(),name:(document.getElementById('fin-goal-name')?.value||'').trim(),targetAmount:Number(document.getElementById('fin-goal-target')?.value)||0,targetDate:document.getElementById('fin-goal-date')?.value||'',linkClass:document.getElementById('fin-goal-link')?.value||'investment',currentAmount:Number(document.getElementById('fin-goal-current')?.value)||0};
  if(!g.name||g.targetAmount<=0){alert('목표명과 목표 금액을 입력해 주세요.');return;}
  if(idx>=0)goalData.splice(idx,1,g);else goalData.push(g);_finGoalEdit=null;finSaveAndRender(cbRenderPlan);
}
function finGoalLinkChange(){ const manual=document.getElementById('fin-goal-link')?.value==='manual'; const f=document.getElementById('fin-goal-current-wrap'); if(f)f.style.display=manual?'flex':'none'; }
function finSaveTarget(){
  const groups={}; Object.keys(FIN_DEFAULT_TARGET).forEach(k=>groups[k]=Math.max(0,Number(document.getElementById('fin-target-'+k)?.value)||0));
  const sum=Object.values(groups).reduce((s,x)=>s+x,0); if(Math.abs(sum-100)>.01){alert(`목표 비중 합계를 100%로 맞춰 주세요. 현재 ${sum.toFixed(1)}%입니다.`);return;}
  window._targetAlloc={...(window._targetAlloc||{}),groups,threshold:Math.max(1,Math.min(20,Number(document.getElementById('fin-target-threshold')?.value)||5))};finSaveAndRender(cbRenderPlan);
}
function finPlanOwner(o){ _finPlanOwner=o; _finGoalEdit=null; cbRenderPlan(); }

// 계좌 배치 진단은 script.js 의 실제 배당 원천징수 규칙(getAccountDivTaxInfo)을 그대로 쓴다.
// 일반계좌에 있는 배당을 절세계좌로 옮겼을 때 아낄 수 있는 세금을 금액으로 제시한다.
function finAccountDiagnostics(ownerF){
  const rows=finRows(ownerF),total=rows.reduce((s,r)=>s+r.val,0)||1,map={};
  rows.forEach(r=>{
    const acc=r.i.acc||'미지정';
    const key=[r.i.owner,r.i.broker||'미지정',acc].join(' · ');
    if(!map[key])map[key]={key,owner:r.i.owner,broker:r.i.broker||'미지정',acc,value:0,dividend:0,count:0};
    map[key].value+=r.val;map[key].dividend+=cbDivIncomeKRW(r.i);map[key].count++;
  });
  const groups=Object.values(map).sort((a,b)=>b.value-a.value);
  const taxEngineReady=typeof allocateDividendTax==='function';
  const allocated=taxEngineReady
    ? allocateDividendTax(groups.map(x=>({owner:x.owner,acc:x.acc,gross:x.dividend,key:x.key}))).list
    : [];
  const taxByKey=new Map(allocated.map(x=>[x.key,x]));
  const generalRate=_taxRuleValue('dividend.generalWithholdingCombinedRate',0.154);
  const isaRate=_taxRuleValue('isa.separateTaxCombinedRate',0.099);
  const isaExemption=_taxRuleValue('isa.generalExemptionKrw',2_000_000);
  const taxInfo=acc=>typeof getAccountDivTaxInfo==='function'?getAccountDivTaxInfo(acc):{type:'일반',normalRate:generalRate,label:`일반, ${(generalRate*100).toFixed(1)}%`};
  return groups.map(x=>{
    const info=taxInfo(x.acc);
    const gift=/증여/.test(x.acc);
    const withheld=taxEngineReady?(taxByKey.get(x.key)?.tax??0):null;
    let status=info.type==='일반'?'일반 과세':(info.type==='ISA'?'ISA 절세':'연금 과세이연');
    let finding;
    if(info.type==='연금') finding=x.dividend>0?`배당 ${cbDisp(x.dividend)} 전액 과세이연 — 배당 자산을 두기 좋은 계좌입니다.`:'인출 시점까지 과세이연됩니다.';
    else if(info.type==='ISA') finding=x.dividend>0?`배당 ${cbDisp(x.dividend)} · 유지기간 전체 일반형 ${cbDisp(isaExemption)} 비과세 후 ${(isaRate*100).toFixed(1)}% 분리과세. 표시 세액은 ${withheld==null?'계산 불가':'연간 현금흐름 참고 '+cbDisp(withheld)}`:'손익통산·분리과세 혜택 계좌입니다. 실제 세금은 만기·해지 때 정산합니다.';
    else if(x.dividend>0){
      // 현재 일반계좌 원천징수율 → 연금 과세이연 가정의 연간 이연액
      const saving=x.dividend*generalRate;
      status='배당 과세 점검';
      finding=`배당 ${cbDisp(x.dividend)} · ${withheld==null?'원천징수 계산 불가':`원천징수 ${cbDisp(withheld)}(${(generalRate*100).toFixed(1)}%)`}. 연금 과세이연 계좌로 옮긴 단순 가정상 연 최대 ${cbDisp(saving)} 이연`;
    }
    else finding=gift?'증여 계좌 — 증여 원금·취득가 기록을 함께 확인하세요.':'배당이 없어 계좌 위치에 따른 과세 차이가 작습니다.';
    if(gift&&info.type==='일반') status='증여 계좌';
    return{...x,share:x.value/total*100,status,finding,taxLabel:info.label,withheld};
  });
}
function cbRenderPlan(){
  finEnsureState();const el=document.getElementById('cb-plan2');if(!el)return;
  const ownerF=finOwnerF(_finPlanOwner);
  const scope=ownerF?cbEsc(ownerF):'가구 전체';
  const ta=finTargetAnalysis(ownerF),accounts=finAccountDiagnostics(ownerF);
  cbSetHead('목표 진행률 · 목표 비중 편차 · 월 적립식 보정 · 계좌 배치 점검',
    cbOwnerBtns(_finPlanOwner,'finPlanOwner'));
  const geIdx=_finGoalEdit!=null?finGoalFind(_finGoalEdit):-1;
  const ge=geIdx>=0?goalData[geIdx]:null;
  // 목표 비중 입력은 모바일에서 저장 버튼이 숨겨지므로 readonly 로 내려 오해를 줄인다.
  const ro=(typeof isMobileLayout==='function'&&isMobileLayout())?' readonly':'';
  const goalCards=(goalData||[]).map(g=>{const cur=finGoalCurrent(g),pct=Math.max(0,Math.min(100,g.targetAmount?cur/g.targetAmount*100:0)),days=g.targetDate?Math.ceil((new Date(g.targetDate)-Date.now())/86400000):null,safeId=cbEsc(String(g.id||''));return`<div class="cb-panel fin-goal-card"><div><small>${cbEsc(g.targetDate||'목표일 미정')}${days!=null?` · ${days>=0?'D-'+days:'기한 경과'}`:''}</small><strong>${cbEsc(g.name)}</strong><span>${cbDisp(cur)} / ${cbDisp(g.targetAmount)}</span></div><b>${pct.toFixed(1)}%</b><div class="fin-meter"><i style="width:${pct}%"></i></div><div class="fin-row-actions"><button data-id="${safeId}" onclick="finGoalEdit(this.dataset.id)">수정</button><button data-id="${safeId}" onclick="finGoalDelete(this.dataset.id)">삭제</button></div></div>`;}).join('')||'<div class="fin-empty cb-panel">목표를 추가하면 현재 자산과 자동으로 연결해 진행률을 보여드립니다.</div>';
  el.innerHTML=`
    <div class="fin-section-head standalone"><span>재무 목표</span><small>${goalData.length}개 목표 · 목표는 가구 공통입니다</small></div><div class="fin-goal-grid">${goalCards}</div>
    ${finMobileNote('목표·목표 비중')}
    <div class="cb-panel fin-section" id="fin-goal-form"><div class="fin-section-head"><span>${ge?'목표 수정':'새 목표 추가'}</span><small>전체 순자산·투자자산·자산군과 연결 가능</small></div><div class="fin-form-grid">
      <label>목표명<input id="fin-goal-name" value="${cbEsc(ge?.name||'')}" placeholder="예: 자녀 교육자금"></label><label>목표 금액(원)<input id="fin-goal-target" type="number" min="0" step="10000" value="${Number.isFinite(Number(ge?.targetAmount))?Number(ge.targetAmount):''}"></label><label>목표일<input id="fin-goal-date" type="date" value="${cbEsc(ge?.targetDate||'')}"></label>
      <label>현재 금액 연결<select id="fin-goal-link" onchange="finGoalLinkChange()"><option value="investment" ${ge?.linkClass==='investment'?'selected':''}>가족 투자자산</option><option value="net" ${ge?.linkClass==='net'?'selected':''}>전체 순자산</option>${Object.keys(FIN_DEFAULT_TARGET).map(k=>`<option value="${k}" ${ge?.linkClass===k?'selected':''}>${cbEsc(CB_CLS[k].label)}</option>`).join('')}<option value="manual" ${ge?.linkClass==='manual'?'selected':''}>직접 입력</option></select></label>
      <label id="fin-goal-current-wrap" style="display:${ge?.linkClass==='manual'?'flex':'none'}">현재 금액(원)<input id="fin-goal-current" type="number" min="0" value="${Number.isFinite(Number(ge?.currentAmount))?Number(ge.currentAmount):''}"></label>
    </div><div class="fin-form-actions"><button class="primary" onclick="finGoalSubmit()">${ge?'수정 저장':'목표 추가'}</button>${ge?'<button onclick="finGoalCancel()">취소</button>':''}</div></div>
    <div class="cb-panel fin-section"><div class="fin-section-head"><span>목표 비중과 리밸런싱 <span style="color:var(--dim);font-weight:500">· ${scope}</span></span><small>투자자산 ${cbDisp(ta.total)} · 월 DCA ${cbDisp(ta.monthlyDca)}${ownerF?' · 목표 비중값은 가구 공통':''}</small></div><div class="fin-target-inputs">${ta.result.map(x=>`<label><span><i style="background:${x.color}"></i>${cbEsc(x.label)}</span><input id="fin-target-${x.key}" type="number" min="0" max="100" step="1" value="${x.targetPct}"${ro}><em>%</em></label>`).join('')}<label class="threshold"><span>허용 편차</span><input id="fin-target-threshold" type="number" min="1" max="20" value="${ta.threshold}"${ro}><em>%p</em></label><button onclick="finSaveTarget()">목표 저장</button></div>
      <div class="fin-rebal-table"><div class="head"><span>자산군</span><span>현재</span><span>목표</span><span>편차</span><span>필요 조정액</span><span>월 DCA 보정안</span></div>${ta.result.map(x=>`<div class="${Math.abs(x.drift)>=ta.threshold?'warn':''}"><span><i style="background:${x.color}"></i>${cbEsc(x.label)}</span><span>${x.currentPct.toFixed(1)}%</span><span>${x.targetPct.toFixed(1)}%</span><span class="${x.drift>=0?'up':'down'}">${x.drift>=0?'+':''}${x.drift.toFixed(1)}%p</span><span class="${x.diff>=0?'up':'down'}">${x.diff>=0?'매수 ':'축소 '}${cbDisp(Math.abs(x.diff))}</span><span>${x.dcaSuggestion>0?cbDisp(x.dcaSuggestion):'—'}</span></div>`).join('')}</div><small class="fin-disclaimer">조정액은 현재 평가액 기준의 단순 계산이며 매도·세금·거래비용을 반영하지 않습니다. DCA 보정안은 부족 자산군에 월 적립액을 비례 배분한 참고값입니다.</small></div>
    <div class="cb-panel fin-section"><div class="fin-section-head"><span>계좌 배치 진단 <span style="color:var(--dim);font-weight:500">· ${scope}</span></span><small>현재 규칙 버전 기준 · ISA 표시는 연간 현금흐름 참고 · 실행 전 증권사·세무 확인 필요</small></div><div class="fin-account-table"><div class="head"><span>소유주 · 증권사 · 계좌</span><span>평가액</span><span>비중</span><span>진단</span></div>${accounts.map(x=>`<div><span><b>${cbEsc(x.key)}</b><small>${x.count}개 자산 · ${cbEsc(x.status)} · ${cbEsc(x.taxLabel)}</small></span><span>${cbDisp(x.value)}</span><span>${x.share.toFixed(1)}%</span><span>${cbEsc(x.finding)}</span></div>`).join('')||'<div class="fin-empty">계좌 정보가 있는 투자자산을 등록해 주세요.</div>'}</div></div>`;
}

function finDataStatusRows(){
  finEnsureState();
  const stale=(pfolioData||[]).filter(i=>i&&i._priceStale).length;
  const defaults={
    assets:{label:'투자자산 원장',source:'Vercel KV'},
    ext:{label:'재무계획·현금흐름',source:'Vercel KV'},
    prices:{label:'시장 시세',source:'시장별 시세 API'},
    dividends:{label:'배당 데이터',source:'배당 데이터 API'},
    rates:{label:'환율·금 시세',source:'Yahoo Finance · COMEX'},
    benchmark:{label:'성과 벤치마크',source:'시장 지수 데이터'}
  };
  return Object.entries(defaults).map(([key,meta])=>{
    const explicit=window._dataFreshness[key];
    const has=explicit&&typeof explicit==='object';
    const row={key,...meta,ok:false,detail:'아직 확인하지 않음',...(has?explicit:{})};
    // 과거 성공 기록이 남아 있어도 현재 시세가 누락된 자산이 있으면 정상으로 표시하지 않는다.
    // 조회 기록이 없더라도 시세가 빈 자산이 실재하면 '확인 전'이 아니라 '확인 필요'다.
    const staleKnown=key==='prices'&&stale>0;
    if(staleKnown){row.ok=false;row.detail=`${stale}개 최신 시세 확인 필요`;}
    // 아직 한 번도 확인하지 않은 것과 확인해서 실패한 것은 다르다.
    // 부팅 직후 전자를 '오류'로 표시하면 실제 오류가 묻힌다.
    row.state=row.ok?'ok':((has||staleKnown)?'warn':'pending');
    row.sameSession=has&&explicit.session===FIN_SESSION_ID;
    return row;
  });
}
function cbRenderDataStatus(){
  const el=document.getElementById('cb-data2');if(!el)return;
  const rows=finDataStatusRows();
  const ok=rows.filter(x=>x.state==='ok').length;
  const warn=rows.filter(x=>x.state==='warn').length;
  const pending=rows.filter(x=>x.state==='pending').length;
  const STATE={ok:{cls:'ok',label:'정상'},warn:{cls:'warn',label:'확인 필요'},pending:{cls:'pending',label:'확인 전'}};
  cbSetHead('출처 · 최근 확인 시각 · 오류·지연 상태를 한곳에서 확인');
  const heroNote=warn?`${warn}건은 확인이 필요합니다.`:(pending?`${pending}건은 아직 확인하지 않았습니다.`:'모든 데이터가 최근 요청에 성공했습니다.');
  el.innerHTML=`<div class="fin-data-hero cb-panel"><div><small>데이터 신뢰 점검</small><strong>${ok}/${rows.length} 정상</strong><span>${cbEsc(heroNote)} 값이 비어 있거나 오래된 경우 먼저 이 화면에서 상태를 확인하세요.</span></div><button onclick="manualRefresh('all')">전체 데이터 새로고침</button></div><div class="fin-data-grid">${rows.map(x=>{
    const st=STATE[x.state]||STATE.pending;
    const when=x.state==='pending'
      ? '이번 접속에서 아직 확인하지 않음'
      : `최근 확인 · ${finFreshAge(x.updatedAt)}${x.sameSession?'':' <span data-tip="다른 기기나 이전 접속에서 확인한 기록입니다. 지금 값이 최신인지 보장하지 않습니다.">· 다른 접속 기록</span>'}`;
    return `<div class="cb-panel fin-data-card ${st.cls}"><div><span class="fin-status-dot"></span><b>${cbEsc(x.label)}</b><em>${st.label}</em></div><strong>${cbEsc(x.detail||'상태 정보 없음')}</strong><p>출처 · ${cbEsc(x.source||'내부 데이터')}</p><small>${when}</small><button onclick="manualRefresh('${x.key}')">다시 확인</button></div>`;
  }).join('')}</div><div class="cb-panel fin-section"><div class="fin-section-head"><span>상태 해석</span><small>투자 판단 전에 데이터 시점을 확인하세요.</small></div><div class="fin-guidance"><p><b>정상</b>은 해당 데이터의 마지막 요청이 성공했다는 뜻입니다.</p><p><b>확인 필요</b>는 요청이 실패했거나 시세가 누락된 자산이 남아 있다는 뜻입니다.</p><p><b>확인 전</b>은 아직 조회를 실행하지 않은 상태로, 오류가 아닙니다.</p><p>최근 확인 시각은 기기별로 공유되므로 <b>다른 접속 기록</b> 표시가 붙은 항목은 다시 확인해 주세요.</p><p>외부 데이터는 거래소·제공사 사정에 따라 지연될 수 있으며, 주문 전 실제 증권사 시세를 확인해야 합니다.</p></div></div>`;
}

