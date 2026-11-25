// core/ext-data.js — 확장 데이터 — 순자산 기록, 확장 데이터 저장·되돌리기, 차트 공통 설정
// (2026-11-23 script.js 에서 그대로 옮겨 나눈 조각. 로드 순서는 index.html·scripts/tests/_source.mjs)
// =============================================
// 자산이력 데이터
// =============================================
// 화면에서 쓰지 않는다. 원격에 저장돼 있는 값을 다음 저장 때 지우지 않으려고 읽은 그대로 다시 싣기만 한다.
let assetHistory = [];


// 가족 재무계획 데이터 — 기존 goalData 키를 재사용해 이전 KV와 호환
let goalData = [];
window._balanceSheet = window._balanceSheet || { assets:[], liabilities:[], cashTargetMonths:6 };
window._dataFreshness = window._dataFreshness || {};
// 원격 원장을 정상적으로 읽기 전에는 빈 초기값을 다시 저장하지 않는다.
// 실패 후 데이터 상태의 개별 재시도가 성공하면 ready로 전환된다.
window._kvLoadState = window._kvLoadState || {assets:'pending',ext:'pending'};

// =============================================
// 순자산 장기 추이
// =============================================
window._netWorthHistory = window._netWorthHistory || [];

// 오늘 순자산 스냅샷을 메모리에서 갱신한다. 저장 여부는 호출자가 결정한다.
// 재무상태표 CRUD 직후에도 이 함수를 호출해 KPI와 차트 마지막 점을 일치시킨다.
function updateNetWorthSnapshot() {
  const todayStr = _cfLocalDateKey(new Date());
  // 평가액은 화면과 같은 assetValueKRW(core/data.js) — 배치 asset_value_krw 와 test_net_worth_snapshot.py 가 대조한다.
  const sumAssets = (arr) => arr.reduce((s, a) => s + assetValueKRW(a), 0);
  const portfolio = sumAssets(getFilteredAssets('전체'));
  const bs = window._balanceSheet || {};
  const nonInvestmentAssets = (bs.assets||[]).reduce((s,x)=>s+(Number(x.amount)||0),0);
  const liabilities = (bs.liabilities||[]).reduce((s,x)=>s+(Number(x.amount)||0),0);
  const total = portfolio + nonInvestmentAssets - liabilities;
  // 소유주별 포트폴리오 스냅샷 — 순자산 추이 차트의 소유주 필터링에 사용
  const owners = OWNERS;
  const portfolioByOwner = {};
  const netByOwner = {};
  const ownerSum = (list, o) => (list||[]).filter(x=>x && x.owner===o).reduce((s,x)=>s+(Number(x.amount)||0),0);
  owners.forEach(o => {
    portfolioByOwner[o] = Math.round(sumAssets(getFilteredAssets(o)));
    netByOwner[o] = Math.round(portfolioByOwner[o] + ownerSum(bs.assets, o) - ownerSum(bs.liabilities, o));
  });
  // schemaV 1 = total 이 투자자산만 담던 시절. 2 = 기타자산·부채까지 포함.
  // 정의가 섞이면 순자산 변화 분석의 잔차가 왜곡되므로 버전을 함께 기록한다.
  const entry = { date: todayStr, schemaV: 2, total: Math.round(total), portfolio: Math.round(portfolio), nonInvestmentAssets:Math.round(nonInvestmentAssets), liabilities:Math.round(liabilities), portfolioByOwner, netByOwner };
  const hist = window._netWorthHistory;
  const idx = hist.findIndex(h => h.date === todayStr);
  if (idx > -1) hist[idx] = entry;
  else { hist.push(entry); hist.sort((a,b) => a.date.localeCompare(b.date)); }
  if (hist.length > 365) hist.splice(0, hist.length - 365);
  return entry;
}

async function saveNetWorthSnapshot() {
  if(window._kvLoadState?.assets!=='ready'||window._kvLoadState?.ext!=='ready') {
    return {ok:false,blocked:true,error:'원격 원장을 정상적으로 불러오기 전에는 순자산 스냅샷을 저장할 수 없습니다.'};
  }
  updateNetWorthSnapshot();
  return saveExtDataToKV();
}



// =============================================
// 확장 데이터 KV 저장/로드
// =============================================
// ── 저장 실패 시 되돌리기 ─────────────────────────────────────────────
// 기준은 '마지막으로 원격과 같았던 상태'(불러온 직후 또는 저장에 성공한 직후)다. 저장이 실패하면 메모리와
// localStorage 사본을 그 상태로 되돌리고 화면을 다시 그린다 — 예전엔 실패 토스트만 뜨고 화면 값은 바뀐 채 남아
// 저장된 것처럼 보였다. 호출부마다 백업을 뜨지 않도록 저장 함수 안 한 곳에서 처리한다.
//  - 충돌(409)·로드 전 차단은 기존 안내가 맡으므로 되돌리지 않는다.
//  - 같은 키의 더 새 저장이 대기 중이면 되돌리지 않는다(그 저장이 현재 상태 전체를 싣고 있다).
//  - 순자산 스냅샷(_netWorthHistory)과 시세 필드는 사용자의 입력이 아니므로 되돌리는 대상이 아니다.
let _extLastGood=null,_assetsLastGood=null;
const KV_REVERT_MSG='⚠️ 저장하지 못해 방금 변경을 되돌렸습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.';
function _extSnapshot(){
  return JSON.stringify({goalData,monthlyPLData,cfData,autoTransferData,cfDeletedKeys,
    targetAlloc:window._targetAlloc||null,balanceSheet:window._balanceSheet||null,giftActual:window._giftActual||null,taxSaving:window._taxSaving||null});
}
function _extRestore(snapshot){
  const d=JSON.parse(snapshot);
  goalData=d.goalData;monthlyPLData=d.monthlyPLData;cfData=d.cfData;autoTransferData=d.autoTransferData;cfDeletedKeys=d.cfDeletedKeys;
  window._targetAlloc=d.targetAlloc;window._balanceSheet=d.balanceSheet;window._giftActual=d.giftActual;window._taxSaving=d.taxSaving||null;
  try{
    localStorage.setItem('monthlyPLData',JSON.stringify(monthlyPLData));
    localStorage.setItem('cfData',JSON.stringify(cfData));
    localStorage.setItem('autoTransferData',JSON.stringify(autoTransferData));
    if(window._giftActual) localStorage.setItem('giftActual',JSON.stringify(window._giftActual)); else localStorage.removeItem?.('giftActual');
  }catch(e){}
  if(typeof saveCfDeletedKeys==='function') saveCfDeletedKeys();
}
function _assetsRestore(snapshot){
  // 그 사이 받은 시세는 버리지 않는다 — 같은 행(소유주·티커·계좌)의 시세 필드를 옮겨 싣는다.
  const live=new Map(pfolioData.map(i=>[_splitRowKey(i),i]));
  pfolioData=JSON.parse(snapshot).map(row=>{
    const cur=live.get(_splitRowKey(row));
    if(cur)['curP','prevP','dayP','_priceStale'].forEach(k=>{ if(k in cur) row[k]=cur[k]; });
    return row;
  });
}
function _kvShouldRevert(key,res,lastGood,current){
  return !!(lastGood!=null&&current!==lastGood&&!res?.conflict&&!res?.blocked&&!_kvWriteQueues.has(key));
}
function _rerenderAfterRevert(){
  try{ if(typeof syncDivHistory==='function') syncDivHistory(); }catch(e){}
  try{ changeOwner(currentOwner,null); }catch(e){}
  try{
    if(document.getElementById('view-cashflow')?.classList.contains('active')){ renderAutoTransfers(); renderFixedCostView(); renderCashFlow(); }
  }catch(e){}
  try{ if(typeof cbRerender==='function') cbRerender(); }catch(e){}
}
async function saveExtDataToKV() {
  if(window._kvLoadState?.ext!=='ready') {
    showSaveError('⚠️ 재무 데이터를 정상적으로 불러오기 전에는 저장할 수 없습니다. 데이터 상태에서 다시 확인해 주세요.');
    if(typeof finMarkFresh==='function') finMarkFresh('ext','재무계획·현금흐름','Vercel KV',false,'원격 데이터 재로드 전 저장 차단');
    return {ok:false,blocked:true,status:null};
  }
  const ext = { assetHistory: assetHistory, goalData: goalData, netWorthHistory: window._netWorthHistory || [], monthlyPLData: monthlyPLData, cfData: cfData, autoTransferData: autoTransferData, cfDeletedKeys: cfDeletedKeys, targetAlloc: window._targetAlloc || null, balanceSheet:window._balanceSheet || {assets:[],liabilities:[],cashTargetMonths:6}, giftActual: window._giftActual || null, taxSaving: window._taxSaving || null,
    // 배치가 쓴 월간 결산 보관을 그대로 다시 싣는다 — 빼면 앱 저장이 지난 결산을 지운다. 사용자 입력이 아니라 되돌리기 대상은 아니다.
    reportArchive: window._reportArchive || {} };
  const sent=_extSnapshot();
  const res = await setKV('ext_data', ext);
  const ok=!!(res&&res.result==="OK");
  let reverted=false;
  if(ok) _extLastGood=sent;
  else if(_kvShouldRevert('ext_data',res,_extLastGood,_extSnapshot())){ _extRestore(_extLastGood); reverted=true; }
  if (!ok) showSaveError(reverted?KV_REVERT_MSG:undefined);
  if(reverted) _rerenderAfterRevert();
  if(typeof finMarkFresh==='function') finMarkFresh('ext','재무계획·현금흐름','Vercel KV',ok,ok?'확장 데이터 저장 완료':`저장 실패${res?.status?' ('+res.status+')':''}`);
  return {ok,status:res?.status||null,reverted};
}

async function loadExtDataFromKV() {
  window._kvLoadState.ext='pending';
  let data;
  try { data=await getKV('ext_data'); }
  catch(e) {
    console.error('[loadExtDataFromKV]',e);
    window._kvLoadState.ext='failed';
    showKvLoadError('⚠️ 재무계획·현금흐름을 불러오지 못했습니다. 기존 데이터를 덮어쓰지 않도록 저장을 중단했습니다.','ext');
    return {ok:false,error:e?.message||'확장 데이터 로드 실패'};
  }
  if (data==null) {
    window._kvLoadState.ext='ready';
    _extLastGood=null;   // 원격에 아무것도 없다 — 되돌릴 기준이 없다
    clearKvLoadError('ext');
    return {ok:true,empty:true,detail:'저장된 확장 데이터 없음'};
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const arrayFields=['assetHistory','goalData','netWorthHistory','monthlyPLData','cfData','autoTransferData','cfDeletedKeys'];
    const objectFields=['targetAlloc','balanceSheet','giftActual','taxSaving'];
    const knownFields=[...arrayFields,...objectFields];
    const owns=key=>Object.prototype.hasOwnProperty.call(data,key);
    const balance=data.balanceSheet;
    const balanceInvalid=owns('balanceSheet')&&balance!=null&&(
      (Object.prototype.hasOwnProperty.call(balance,'assets')&&!Array.isArray(balance.assets))
      ||(Object.prototype.hasOwnProperty.call(balance,'liabilities')&&!Array.isArray(balance.liabilities))
      ||(Object.prototype.hasOwnProperty.call(balance,'cashTargetMonths')&&(!Number.isFinite(Number(balance.cashTargetMonths))||Number(balance.cashTargetMonths)<=0))
    );
    const invalid=!knownFields.some(owns)
      || arrayFields.some(key=>owns(key)&&!Array.isArray(data[key]))
      || objectFields.some(key=>owns(key)&&data[key]!=null&&(typeof data[key]!=='object'||Array.isArray(data[key])))
      || balanceInvalid;
    if(invalid){
      window._kvLoadState.ext='failed';
      showKvLoadError('⚠️ 재무 데이터 형식이 올바르지 않습니다. 기존 데이터를 덮어쓰지 않도록 저장을 중단했습니다.','ext');
      return {ok:false,error:'확장 데이터 형식이 올바르지 않습니다.'};
    }
    // 원격 객체가 존재하면 그 객체가 정본이다. 누락 필드를 샘플·localStorage 값으로 남겨
    // 다음 자동 저장 때 원격에 섞지 않도록 명시적 빈 값으로 정규화한다.
    const normalized={};
    arrayFields.forEach(key=>{normalized[key]=owns(key)?data[key]:[];});
    normalized.targetAlloc=owns('targetAlloc')?data.targetAlloc:null;
    normalized.balanceSheet=owns('balanceSheet')&&data.balanceSheet?data.balanceSheet:{assets:[],liabilities:[],cashTargetMonths:6};
    normalized.giftActual=owns('giftActual')?data.giftActual:null;
    normalized.taxSaving=owns('taxSaving')?data.taxSaving:null;

    assetHistory=_normalizeAssetHistoryRows(normalized.assetHistory);
    goalData=_normalizeGoalRows(normalized.goalData);
    window._netWorthHistory=_normalizeNetWorthRows(normalized.netWorthHistory);
    window._reportArchive=_normalizeReportArchive(owns('reportArchive')?data.reportArchive:null);
    window._targetAlloc=_normalizeTargetAlloc(normalized.targetAlloc);
    window._balanceSheet=_normalizeBalanceSheet(normalized.balanceSheet);
    window._giftActual=_normalizeGiftActual(normalized.giftActual);
    window._taxSaving=_normalizeTaxSaving(normalized.taxSaving);
    try {
      if(window._giftActual) localStorage.setItem('giftActual',JSON.stringify(window._giftActual));
      else localStorage.removeItem?.('giftActual');
    } catch(e) {}
    monthlyPLData=_normalizeMonthlyPLRows(normalized.monthlyPLData);
    cfData=_normalizeCfRows(normalized.cfData);
    autoTransferData=_normalizeAutoTransfers(normalized.autoTransferData);
    cfDeletedKeys=[...new Set(normalized.cfDeletedKeys.map(key=>_boundedStoredText(key,220)).filter(Boolean))].slice(0,5000);
    _normalizeAutoTransferSchedules(autoTransferData);
    try {
      localStorage.setItem('monthlyPLData',JSON.stringify(monthlyPLData));
      localStorage.setItem('cfData',JSON.stringify(cfData));
      localStorage.setItem('autoTransferData',JSON.stringify(autoTransferData));
    } catch(e) {}
    saveCfDeletedKeys();
    if (document.getElementById('view-cashflow')?.classList.contains('active')) {
      renderAutoTransfers();
      renderFixedCostView();
      renderCashFlow();
    }
    changeOwner(currentOwner, null);
    window._kvLoadState.ext='ready';
    _extLastGood=_extSnapshot();
    clearKvLoadError('ext');
    return {ok:true,detail:`목표 ${goalData.length}개 · 순자산 기록 ${(window._netWorthHistory||[]).length}개`};
  }
  window._kvLoadState.ext='failed';
  showKvLoadError('⚠️ 재무 데이터 형식이 올바르지 않습니다. 기존 데이터를 덮어쓰지 않도록 저장을 중단했습니다.','ext');
  return {ok:false,error:'확장 데이터 형식이 올바르지 않습니다.'};
}

// =============================================
// Chart.js 공통 기본값
// =============================================
// Chart.js CDN 로드가 실패하면 여기서 ReferenceError가 나고, 최상위 실행이 중단되어
// 이 아래에서 선언되는 let/const(monthlyPLData·_bubbleOwner·KR_CODE_RE 등)가 영구 TDZ에
// 갇힌다 — 차트뿐 아니라 양도소득세·비중 차트 페이지가 통째로 죽는다. 차트만 포기하고
// 나머지 앱은 계속 뜨도록 가드한다.
if (typeof Chart === "undefined") {
  console.error('[Chart.js] 라이브러리 로드 실패 — 차트 없이 계속합니다.');
} else {
  Chart.defaults.responsive=true;
  Chart.defaults.maintainAspectRatio=false;
  Chart.defaults.font.family="'Manrope','Noto Sans KR',sans-serif";
  Chart.defaults.plugins.tooltip.padding = 12;
  Chart.defaults.plugins.tooltip.cornerRadius = 10;
}

// ── 차트 테마: CSS 토큰을 단일 소스로 (라이트/다크 자동 일치) ──
function cssVar(name, fallback){
  try{ const v=getComputedStyle(document.body).getPropertyValue(name).trim(); return v||fallback; }
  catch(e){ return fallback; }
}
function applyChartTheme(){
  if(typeof Chart==='undefined') return;
  const t1=cssVar('--t1','#0f172a'), t2=cssVar('--t2','#475569'),
        glass=cssVar('--modal-bg','#ffffff'), border=cssVar('--panel-border','#e3e8ef'),
        grid=cssVar('--grid','rgba(120,120,120,.15)');
  Chart.defaults.color=t2;
  Chart.defaults.borderColor=grid;
  const tp=Chart.defaults.plugins.tooltip;
  tp.backgroundColor=glass; tp.titleColor=t1; tp.bodyColor=t2; tp.borderColor=border; tp.borderWidth=1;
  // 이미 만든 차트는 축 색을 자기 설정에 복사해 들고 있다 — 전역 기본값만 바꾸고 update() 해도
  // 만들 때의 테마 색(다크에서 만든 차트는 밝은 글자)이 그대로 남는다. 축마다 지금 테마 색을 다시 써 넣는다.
  for(const id in Chart.instances){
    const chart=Chart.instances[id];
    try{
      // 금액 가리기 중에는 축 글자가 투명이고 원래 색이 보관돼 있다 — 보관된 색을 새 테마 값으로 바꾼다.
      const masked=typeof _amountPrivacyChartState!=='undefined'&&_amountPrivacyChartState.get(chart);
      Object.entries(chart.options?.scales||{}).forEach(([key,scale])=>{
        if(!scale) return;
        if(scale.ticks){
          if(masked){ const kept=masked.ticks.find(x=>x.key===key); if(kept) kept.color=t2; }
          else scale.ticks.color=t2;
        }
        // 차트가 직접 준 반투명 눈금선(rgba)은 두 테마에서 모두 보이므로 그대로 둔다
        if(scale.grid&&!/^rgba\(/.test(String(scale.grid.color||''))) scale.grid.color=grid;
        if(scale.border) scale.border.color=grid;
      });
      const legend=chart.options?.plugins?.legend?.labels; if(legend) legend.color=t2;
      chart.update();
    }catch(e){}
  }
}
applyChartTheme();
