// core/live-prices.js — 시세 갱신 — 숫자 입력 쉼표, 실시간 시세, 액면분할·병합 자동 반영
// (2026-11-23 script.js 에서 그대로 옮겨 나눈 조각. 로드 순서는 index.html·scripts/tests/_source.mjs)
// =============================================
// 유틸
// =============================================
// 숫자 입력창 자동 쉼표 포맷 (입력 중 실시간 적용)
function handleAmtInput(el) {
  const raw = el.value.replace(/[^0-9]/g, '');
  if (raw === '') { el.value = ''; return; }
  el.value = parseInt(raw, 10).toLocaleString();
}

// 소수 허용 입력의 쉼표 표기 — 정수부에만 쉼표, 소수점 뒤와 입력 중인 '12.'·'-' 는 그대로 둔다.
function formatDecimalInput(raw, allowNeg) {
  let s = String(raw == null ? '' : raw).replace(/[^0-9.\-]/g, '');
  const neg = !!allowNeg && s.startsWith('-');
  s = s.replace(/-/g, '');
  const dot = s.indexOf('.');
  let int = dot < 0 ? s : s.slice(0, dot);
  const dec = dot < 0 ? null : s.slice(dot + 1).replace(/\./g, '');
  int = int.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + int + (dec !== null ? '.' + dec : '');
}
function handleDecimalInput(el) {
  const before = el.value, caret = el.selectionStart;
  const next = formatDecimalInput(before, el.dataset.neg === '1');
  if (next === before) return;
  // 커서 왼쪽에 있던 '쉼표가 아닌 글자' 수를 세어, 새 값에서 같은 자리로 되돌린다
  const keep = caret == null ? null : formatDecimalInput(before.slice(0, caret), el.dataset.neg === '1').replace(/,/g, '').length;
  el.value = next;
  if (keep == null || document.activeElement !== el) return;
  let pos = 0, seen = 0;
  while (pos < next.length && seen < keep) { if (next[pos] !== ',') seen++; pos++; }
  try { el.setSelectionRange(pos, pos); } catch (e) {}
}

// 음수 허용 금액 입력 핸들러 (매도차익/손실 전용)
function handlePLAmtInput(el) {
  const raw = el.value.replace(/[^0-9-]/g, '');
  const neg = raw.startsWith('-');
  const digits = raw.replace(/-/g, '');
  if (!digits) { el.value = neg ? '-' : ''; return; }
  el.value = (neg ? '-' : '') + parseInt(digits, 10).toLocaleString();
}

// 대시보드 전역: inputmode=numeric / decimal 인 모든 입력칸에 자동 콤마 삽입
// - inputmode=numeric → 정수(handleAmtInput)
// - inputmode=decimal → 소수 허용 (입력 중엔 콤마 넣지 않고, blur 시 정수부만 콤마 삽입)
// - data-no-comma="1" 또는 이미 commaApplied 된 요소는 스킵
function initGlobalCommaInputs(root) {
  const scope = root || document;
  const inputs = scope.querySelectorAll('input[inputmode="numeric"], input[inputmode="decimal"]');
  inputs.forEach(el => {
    if (el.dataset.commaApplied) return;
    if (el.dataset.noComma === '1') return;
    if (el.type === 'number') el.type = 'text';
    el.dataset.commaApplied = '1';
    // 입력하는 동안 쉼표를 넣는다 — 소수(decimal)는 정수부에만 쉼표·커서 위치 보존, 정수(numeric)는 실시간 쉼표.
    // 모드는 이벤트 때 읽는다(평균단가처럼 창을 열 때 decimal 로 바뀌는 칸이 있다).
    el.addEventListener('input', () => (el.getAttribute('inputmode') === 'decimal' ? handleDecimalInput(el) : handleAmtInput(el)));
  });
}

// 동적으로 추가된 입력칸에도 적용될 수 있도록 MutationObserver 등록 (모달·폼 재렌더 대응)
function observeCommaInputs() {
  if (window._commaObserverInstalled) return;
  window._commaObserverInstalled = true;
  try {
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes && m.addedNodes.forEach(n => {
          if (n.nodeType !== 1) return;
          if (n.matches && (n.matches('input[inputmode="numeric"]') || n.matches('input[inputmode="decimal"]'))) {
            initGlobalCommaInputs(n.parentNode || document);
          } else if (n.querySelectorAll) {
            initGlobalCommaInputs(n);
          }
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  } catch(e){}
}
// DOM 준비된 뒤 observer 가동
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', observeCommaInputs);
} else {
  observeCommaInputs();
}

// 현금 잔액 입력: USD는 소수점 허용 (달러센트 지원)
function handleCashAmtInput(el) {
  // 소수 허용 여부는 통화 정의(CURRENCY_META)를 따른다 — 예전에는 'USD' 만 하드코딩돼 있어
  // 통화를 늘리면 센트·소수가 조용히 잘렸다.
  const curSel = document.getElementById('add-currency');
  if (curMeta(curSel && curSel.value).cashDecimals > 0) {
    handleDecimalInput(el);
  } else {
    handleAmtInput(el);
  }
}

// 평균단가 입력: 해외주식(USD)은 소수점 허용, 국내주식(KRW)은 정수 + 실시간 콤마

// 평균단가 blur 시 소수점 유지 여부를 현재 화폐에 맞춰 동기화
function updateAvgpDecimalMode() {
  const avgpEl = document.getElementById('add-avgp');
  if (!avgpEl) return;
  avgpEl.dataset.decimal = '1';
  avgpEl.setAttribute('inputmode', 'decimal');
}

function flash(el,dir){if(!el)return;el.classList.remove('flash-up','flash-down','flash-neutral');void el.offsetWidth;el.classList.add(dir==='up'?'flash-up':dir==='down'?'flash-down':'flash-neutral');setTimeout(()=>el.classList.remove('flash-up','flash-down','flash-neutral'),1400);}

// =============================================
// 실시간 시세 갱신 (30초)
// =============================================
let _manualRefreshRunning=false;
async function manualRefresh(source='all') {
  if(_manualRefreshRunning) return {ok:false,busy:true};
  _manualRefreshRunning=true;
  const btn = document.getElementById('sidebar-refresh-btn');
  if(btn) btn.style.opacity='0.6';
  const wants=key=>source==='all'||source===key;
  let assetsResult={ok:window._kvLoadState?.assets==='ready',skipped:true};
  let extResult={ok:window._kvLoadState?.ext==='ready',skipped:true};
  const results={};
  try{
    const loadTasks=[];
    if(wants('assets')) loadTasks.push(loadAssetsFromKV().then(r=>{assetsResult=r;results.assets=r;}));
    if(wants('ext')) loadTasks.push(loadExtDataFromKV().then(r=>{extResult=r;results.ext=r;}));
    if(loadTasks.length) await Promise.all(loadTasks);

    // 자동이체 실체화는 원격 확장 데이터를 정상적으로 받은 뒤에만 실행한다.
    if(wants('ext')&&extResult?.ok&&(source!=='all'||assetsResult?.ok)) applyAutoTransfers();
    const assetsReady=assetsResult?.ok===true&&window._kvLoadState?.assets==='ready';
    const markAssetBlocked=(key,label,sourceLabel)=>{
      const result={ok:false,blocked:true,error:'투자자산 원장을 먼저 정상적으로 불러와야 합니다.'};
      results[key]=result;
      if(typeof finMarkFresh==='function') finMarkFresh(key,label,sourceLabel,false,result.error);
    };
    if(wants('prices')){
      if(assetsReady){
        results.prices=await refreshMarketPrices();
        // 분할 이력도 같이 다시 본다. 기준일 이후 분할은 자동 반영·저장되며, 시세
        // 새로고침과는 별개 작업이라 성공 판정(results)에는 넣지 않는다.
        checkSplitAdjustments(true);
      }
      else markAssetBlocked('prices','시장 시세','국내 네이버 직전 종가 · 해외 Yahoo · 코인 업비트');
    }
    if(wants('dividends')){
      if(assetsReady) results.dividends=await fetchDivData(true);
      else markAssetBlocked('dividends','배당 데이터','KRX · Yahoo · 네이버 증권');
    }
    if(wants('rates')) results.rates=await refreshPyData({includeDividends:source==='all'&&assetsResult?.ok&&extResult?.ok});
    if(wants('benchmark')){
      if(assetsReady) results.benchmark=await fetchBenchmarkData();
      else markAssetBlocked('benchmark','성과 벤치마크','시장 지수 데이터');
    }

    // 전체 새로고침에서 두 KV 원본이 모두 정상일 때만 오늘 스냅샷을 다시 저장한다.
    if(source==='all'&&assetsResult?.ok&&extResult?.ok) results.snapshot=await saveNetWorthSnapshot();
    const activeView=document.querySelector('.view-section.active');
    if(activeView&&activeView.id==='view-bubble') renderBubbleChart('weight');
    changeOwner(currentOwner, null);
    if(typeof cbRerender==='function') cbRerender();
    const attempted=Object.values(results);
    return {ok:attempted.length>0&&attempted.every(r=>r?.ok===true),results};
  }catch(e){
    console.error('[manualRefresh]',e);
    return {ok:false,error:e?.message||'새로고침 실패',results};
  }finally{
    _manualRefreshRunning=false;
    if(btn) btn.style.opacity='1';
  }
}

// 서버(api/price.ts·api/dashboard.py)는 요청당 티커 개수를 제한한다(MAX_TICKERS=25,
// 벤치마크 포트폴리오는 20, dashboard.py 배당(type=dividend)은 MAX_DIVIDEND_TICKERS=20).
// 보유 종목이 상한을 넘으면 서버가 요청 '전체'를
// too_many_tickers 로 거부해 시세·배당이 통째로 비고, 데이터 상태가 영구히 '확인 필요'가 된다.
// 상한은 입력 검증(보안 통제)이라 올리지 않고, 클라이언트가 상한에 맞춰 나눠 보낸다.
const API_TICKER_CHUNK = 25;
const BENCH_TICKER_LIMIT = 20;
const PY_DIVIDEND_TICKER_LIMIT = 20;
function _chunkTickers(list, size = API_TICKER_CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// 시세 응답의 환율·금값 반영. 유한한 양수만 쓰고, 금 시세를 이번에 받았는지 돌려준다.
function _applyLiveRates(rates){
  const ok=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
  if(!rates) return false;
  const fmt2=v=>v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const show=(id,text,newVal,oldVal)=>{const el=document.getElementById(id);if(el){el.textContent=text;if(Math.abs(newVal-(oldVal||0))>0.01)flash(el,newVal>(oldVal||0)?'up':'down');}};
  if(ok(rates.USD)){show('side-usd-rate',fmt2(rates.USD),rates.USD,RATES.USD);RATES.USD=rates.USD;}
  if(ok(rates.USDJPY)){show('side-usdjpy-rate',fmt2(rates.USDJPY),rates.USDJPY,RATES.USDJPY);RATES.USDJPY=rates.USDJPY;}
  if(ok(rates.JPY)){show('side-jpy-rate',fmt2(rates.JPY*100),rates.JPY*100,RATES.JPY*100);RATES.JPY=rates.JPY;}
  if(ok(rates.AUD))RATES.AUD=rates.AUD;
  if(!ok(rates.GOLD_G_KRW)) return false;
  show('side-gold-rate','₩'+rates.GOLD_G_KRW.toLocaleString(),rates.GOLD_G_KRW,window._GOLD_G_KRW);
  window._GOLD_G_KRW=rates.GOLD_G_KRW;
  return true;
}
// 시세 응답이 종목 통화와 다른 통화로 왔을 때(가상화폐 업비트 원화가 ↔ 달러로 저장된 종목) 종목 통화로 바꾼다.
// 화면은 curP × RATES[cur] 로 원화를 다시 구하므로, 같은 환율로 나눠 두면 표시 원화가 업비트 원화가와 같다.
// 배치(net_worth_snapshot.py market_price)도 같은 방식이다. 환율을 모르면 반영하지 않는다(null).
function _quoteToItemCur(q,item){
  if(!q) return null;
  const price=Number(q.price||q.prevClose);
  if(!(price>0)) return null;
  const from=String(q.currency||item.cur||'KRW').toUpperCase(), to=String(item.cur||'KRW').toUpperCase();
  if(from===to) return {price, prevClose:Number(q.prevClose)||null};
  const rFrom=from==='KRW'?1:Number(RATES[from]), rTo=to==='KRW'?1:Number(RATES[to]);
  if(!(rFrom>0)||!(rTo>0)) return null;
  const k=rFrom/rTo;
  return {price:price*k, prevClose:Number(q.prevClose)>0?Number(q.prevClose)*k:null};
}
async function liveRefresh() {
  const tickers=new Set();
  pfolioData.forEach(i=>{if((i.grp==='주식'||i.grp==='가상화폐')&&quoteKey(i.tkr))tickers.add(quoteKey(i.tkr));});
  if(!tickers.size)return {ok:true,skipped:true,stale:0,detail:'조회할 시세 자산 없음'};
  try {
    // 청크별로 요청하고 병합한다. 일부 청크가 실패해도 성공한 청크의 시세는 반영하고,
    // 실패분은 _priceStale 로 남아 최종 stale 집계에 정직하게 드러난다.
    const chunks=_chunkTickers(Array.from(tickers));
    const quotes={};
    let mergedRates=null,failedChunks=0,lastChunkError=null;
    for(const chunk of chunks){
      try{
        const resp=await authFetch(`/api/price?tickers=${chunk.join(',')}`);
        if(!resp.ok) throw new Error(`시세 HTTP ${resp.status}`);
        const d=await resp.json();
        if(!d.success) throw new Error(d.error||'시세 응답 오류');
        Object.assign(quotes,d.quotes||{});
        // 청크마다 환율·금값이 실려 온다 — 먼저 받은 유효한 값을 쓰고, 빈 칸만 뒤 청크로 채운다.
        if(d.rates){mergedRates=mergedRates||{};Object.keys(d.rates).forEach(k=>{if(mergedRates[k]==null)mergedRates[k]=d.rates[k];});}
      }catch(e){ failedChunks++; lastChunkError=e; console.error('[EOD Price Chunk]',chunk.length+'개',e?.message); }
    }
    if(failedChunks===chunks.length) throw (lastChunkError||new Error('시세 조회 실패'));
    const data={success:true,quotes,rates:mergedRates};

    const nowD=new Date();
    const dt=document.getElementById('side-date-display');
    if(dt)dt.textContent=`${nowD.getFullYear()}.${String(nowD.getMonth()+1).padStart(2,'0')}.${String(nowD.getDate()).padStart(2,'0')} (${days[nowD.getDay()]})`;

    // 서버가 못 받은 값은 null 로 온다 — 받은 값만 반영하고 나머지는 직전 값을 그대로 둔다.
    const goldFresh=_applyLiveRates(data.rates);

    pfolioData.forEach(i=>{
      if(i.grp==='금'){
        // 금: curP는 단위당 원화. 단위에 맞는 per-unit 가격으로 업데이트
        if(goldFresh){
          const gm = i.unit==='돈'?3.75:(i.unit==='kg'?1000:1);
          i.curP = window._GOLD_G_KRW * gm;
          // 켜기만 하고 끄지 않으면 KV 에 저장된 표시가 영구 빨간불로 남는다.
          i._priceStale = false;
        }else{
          // 이번 조회에서 금 시세를 못 받았다 — 직전 값은 유지하고 미조회로 드러낸다(다음 수신 때 꺼진다).
          i._priceStale = true;
        }
      } else if(i.grp==='현금'){
        i._priceStale = !curRateKnown(i.cur);
      } else if(i.grp==='주식'||i.grp==='가상화폐'){
        // interval=1d는 완성된 일봉만 반환 → closes[last]가 마지막 거래일 확정 종가
        const key=quoteKey(i.tkr);
        const t6=normTkr(i.tkr);
        const quotes=data.quotes||{};
        const q=quotes[key]||quotes[t6]||quotes[t6+'.KS']||quotes[t6+'.KQ'];
        // 가상화폐는 업비트 원화가(currency:'KRW')로 온다 — 종목 통화로 바꿔 넣는다(_quoteToItemCur).
        const conv=_quoteToItemCur(q,i);
        const price=conv?Number(conv.price):NaN;
        if(conv&&price>0){
          i.curP = price;i._priceStale=false;
          // 일간 변동(DAILY) 산출용 — 전일 종가 및 종가 간 차이를 시세 수신 시점에 저장
          i.prevP = conv.prevClose || null;
          i.dayP = (conv.price && conv.prevClose) ? conv.price - conv.prevClose : null;
        }else{i._priceStale=true;}
      }
    });
    syncDivHistory();changeOwner(currentOwner, null);
    const stale=pfolioData.filter(i=>i&&i._priceStale).length;
    const partial=failedChunks>0?` · 요청 ${chunks.length}건 중 ${failedChunks}건 실패`:'';
    return {ok:stale===0&&failedChunks===0,stale,failedChunks,
      detail:(stale?`${stale}개 최신 확인 필요`:'등록 자산 최신 상태')+partial};
  } catch(err){
    console.error('[EOD Price Fetch Error]',err);
    return {ok:false,error:err?.message||'시세 조회 실패'};
  }
}

// =============================================
// 액면분할 · 병합 자동 반영
// =============================================
// 이 앱에는 매수일 필드가 없고 취득원가는 qty×avgP 로만 파생된다. 그래서 병합 후
// 수량만 고치고 매입가를 그대로 두면 취득원가가 배수만큼 줄어 손실 종목이 큰 수익
// 종목으로 뒤집힌다(BMNU 가 실제로 그랬다).
//
// **사용자에게 묻지 않는다.** 판단 근거는 항목의 `splitCheckedAt` 하나다 — "이 날짜
// 기준으로 수량·매입가가 맞다"는 기준일이고, 등록·수정 모달 저장과 수량/매입가 인라인
// 수정이 오늘 날짜로 찍는다. 그 **이후** 분할만 자동으로 반영한다. 등록 전 분할은
// 사용자가 이미 분할 후 값으로 입력한 것이므로 건드리지 않는다(예전 배너가 5년치 분할을
// 전부 띄워 사기 전의 분할까지 반영하라고 했다).
//  - 값과 기준일(=분할일)이 같은 저장에 함께 들어가므로 같은 분할이 두 번 곱해지지 않는다.
//  - 저장이 실패하면 메모리 변경을 전부 되돌린다 — 다음 진입에서 같은 계산을 다시 한다.
//  - 기준일이 빈 레거시 항목은 오늘로 한 번 백필한다(현재 값이 맞다고 본다).
// 일회성 보정: 사용자가 증권사 기준 값을 직접 확인해 준 건. 병합 공시일(after) 이전
// 기준일인 행이 정확히 하나일 때만 적용하고, 적용하면 기준일이 오늘이 되어 다시 돌지 않는다.
const SPLIT_ONE_TIME_FIXES = [
  // T-REX 2X Long BMNR(BMNU) 1:10 병합, 2026-07-13 병합 기준 거래 시작(REX Shares 공시).
  { tkr:'BMNU', after:'2026-07-13', qty:11, avgP:233.8 },
];
function _splitCacheKey(){ return 'splitCache_'+finLocalDateKey(new Date()); }
// 보유 행은 id 가 없어 배열 인덱스로는 안전하게 가리킬 수 없다(재로드·정렬로 어긋난다).
// 소유주·티커·계좌 조합으로 찾는다 — 같은 종목을 여러 계좌에 나눠 담은 경우도 구분된다.
function _splitRowKey(item){
  return [item.owner||'',String(item.tkr||'').toUpperCase(),item.acc||'',item.broker||''].join('\u001f');
}
function _splitIsStock(i){ return !!(i&&i.grp==='주식'&&(i.qty||0)>0&&i.tkr); }
// 분할 이력 조회. 하루치는 localStorage 에 캐시해 화면 전환마다 재조회하지 않는다.
async function fetchSplitEvents(force=false){
  const tickers=[...new Set(pfolioData.filter(_splitIsStock).map(i=>i.tkr))];
  if(!tickers.length) return {ok:true,skipped:true,events:{},verified:[]};
  const key=_splitCacheKey();
  if(!force){
    try{
      const cached=JSON.parse(localStorage.getItem(key)||'null');
      if(cached&&cached.events&&Array.isArray(cached.verified)
        &&tickers.every(t=>cached.verified.includes(t))) return {ok:true,cached:true,...cached};
    }catch(e){}
  }
  const events={};const verified=[];let failed=0;
  for(const chunk of _chunkTickers(tickers)){
    try{
      const resp=await authFetch(`/api/price?type=splits&tickers=${chunk.join(',')}`);
      if(!resp.ok) throw new Error(`분할 조회 HTTP ${resp.status}`);
      const d=await resp.json();
      if(!d.success) throw new Error(d.error||'분할 응답 오류');
      Object.assign(events,d.result||{});
      // 서버가 종목 단위로 확인해 준 것만 verified 다 — 청크 성공을 근거로 쓰지 않는다.
      (d.verifiedTickers||[]).forEach(t=>verified.push(t));
    }catch(e){ failed++; console.error('[Split Chunk]',chunk.length+'개',e?.message); }
  }
  try{ localStorage.setItem(key,JSON.stringify({events,verified})); }catch(e){}
  return {ok:failed===0,events,verified,failedChunks:failed};
}
// 항목별 미반영 분할 목록. 기준일(splitCheckedAt) '이후' 분할만 후보다.
// 기준일이 비어 있으면 후보가 없다 — 등록 시점을 모르는 항목에 과거 분할을 곱하지 않는다.
function splitPendingList(events){
  const out=[];
  pfolioData.forEach(item=>{
    if(!_splitIsStock(item)) return;
    const since=item.splitCheckedAt||'';
    if(!since) return;
    const upper=String(item.tkr).toUpperCase();
    const list=events[upper.replace(/\.(?:KS|KQ)$/,'')]||events[upper];
    if(!Array.isArray(list)||!list.length) return;
    list.forEach(ev=>{
      if(!ev||!(ev.num>0)||!(ev.den>0)||!(ev.ratio>0)||ev.ratio===1||!ev.date) return;
      if(ev.date<=since) return;
      out.push({item,key:_splitRowKey(item),tkr:item.tkr,owner:item.owner,
        date:ev.date,num:ev.num,den:ev.den,ratio:ev.ratio});
    });
  });
  return out.sort((a,b)=>a.date.localeCompare(b.date));
}
// 일회성 보정 대상. 같은 티커 주식 행이 둘 이상이면 어느 쪽인지 모르므로 적용하지 않는다.
function splitOneTimeFixTargets(){
  const out=[];
  SPLIT_ONE_TIME_FIXES.forEach(fix=>{
    const rows=pfolioData.filter(i=>i&&i.grp==='주식'&&String(i.tkr||'').toUpperCase()===fix.tkr);
    if(rows.length!==1) return;
    const item=rows[0];
    if((item.splitCheckedAt||'')>=fix.after) return;
    out.push({item,fix});
  });
  return out;
}
let _splitRunning=null;
async function checkSplitAdjustments(force=false){
  if(_splitRunning) return _splitRunning;
  _splitRunning=(async()=>{
    try{ return await _checkSplitAdjustmentsOnce(force); }
    catch(e){
      console.error('[checkSplitAdjustments]',e);
      return {ok:false,error:e?.message||'분할 조회 실패'};
    }finally{ _splitRunning=null; }
  })();
  return _splitRunning;
}
async function _checkSplitAdjustmentsOnce(force){
  // 원장을 제대로 불러오기 전에는 판단도 쓰기도 하지 않는다(빈 기본값을 덮어쓰지 않는다).
  if(window._kvLoadState?.assets!=='ready') return {ok:false,blocked:true,applied:[]};
  const today=finLocalDateKey(new Date());
  const backup=new Map();
  const remember=item=>{ if(!backup.has(item)) backup.set(item,{qty:item.qty,avgP:item.avgP,splitCheckedAt:item.splitCheckedAt}); };
  const applied=[];
  // ① 일회성 보정
  splitOneTimeFixTargets().forEach(({item,fix})=>{
    remember(item);
    item.qty=fix.qty; item.avgP=fix.avgP; item.splitCheckedAt=today;
    applied.push({tkr:item.tkr,owner:item.owner,kind:'fix',qty:fix.qty,avgP:fix.avgP});
  });
  // ② 기준일이 빈 레거시 항목 백필 — 숫자는 그대로 두고 기준일만 오늘로.
  pfolioData.forEach(item=>{
    if(_splitIsStock(item)&&!item.splitCheckedAt){ remember(item); item.splitCheckedAt=today; }
  });
  // ③ 기준일 이후 분할 자동 반영. 분할 조회가 실패해도 ①② 는 저장한다.
  let fetchOk=true;
  const r=await fetchSplitEvents(force);
  if(!r.skipped){
    fetchOk=r.ok;
    splitPendingList(r.events||{}).forEach(p=>{
      const item=p.item;
      if((item.splitCheckedAt||'')>=p.date) return;
      remember(item);
      // 수량 ×(num/den), 매입가 ÷(num/den) → 취득원가(qty×avgP) 보존.
      item.qty=Number(item.qty||0)*p.ratio;
      item.avgP=Number(item.avgP||0)/p.ratio;
      item.splitCheckedAt=p.date;
      applied.push({tkr:item.tkr,owner:item.owner,kind:p.ratio<1?'병합':'분할',date:p.date,num:p.num,den:p.den});
    });
  }
  if(!backup.size) return {ok:fetchOk,applied};
  let saved=null;
  try{ saved=await saveAssetsToKV(); }
  catch(e){ console.error('[checkSplitAdjustments] 저장 실패',e); }
  if(!saved||!saved.ok){
    backup.forEach((v,item)=>Object.assign(item,v));
    return {ok:false,error:'분할 반영 저장 실패',applied:[]};
  }
  window._splitAutoResult={applied,at:today};
  if(applied.length){
    console.info('[액면분할·병합 자동 반영]',applied);
    changeOwner(currentOwner, null);
  }
  return {ok:fetchOk,applied};
}

// DCA는 증권사 외부 서비스이므로 이 앱에서 체결을 생성하지 않는다.
// 일정 표시는 cobalt.js의 시장·증권사별 계산만 사용한다.
