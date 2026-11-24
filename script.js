// script.js — 서버 연동 — KV 저장소, 국내 ETF 실시간 시세, Python API, 벤치마크, 창 크기 변경
// (2026-11-23 script.js 에서 그대로 옮겨 나눈 조각. 로드 순서는 index.html·scripts/tests/_source.mjs)
// =============================================
// Upstash KV
// =============================================
// KV 접근은 /api/kv 서버측 프록시를 통해서만 (토큰은 Vercel 환경변수 KV_REST_API_*에 보관)
const _kvRevisions=new Map();
const _kvWriteQueues=new Map();
async function _setKVOnce(key,bodyValue){
  try{
    const expectedRevision=_kvRevisions.has(key)?_kvRevisions.get(key):0;
    const res=await authFetch(`/api/kv?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:bodyValue,expectedRevision})});
    if(res.status===409){
      let conflict={};try{conflict=await res.json();}catch(e){}
      const currentRevision=Number(conflict.revision);
      if(Number.isFinite(currentRevision))_kvRevisions.set(key,currentRevision);
      if(key==='assets')window._kvLoadState.assets='failed';
      if(key==='ext_data')window._kvLoadState.ext='failed';
      showKvLoadError('⚠️ 다른 기기에서 먼저 변경했습니다. 최신 데이터를 다시 불러온 뒤 수정해 주세요.',`conflict-${key}`);
      return {ok:false,conflict:true,status:409,revision:currentRevision,currentRevision};
    }
    if(!res.ok){console.warn("[KV SET] 비정상 응답 status",res.status,key);return {ok:false,status:res.status};}
    const data=await res.json();
    if(Number.isFinite(Number(data?.revision)))_kvRevisions.set(key,Number(data.revision));
    clearKvLoadError(`conflict-${key}`);
    return data;
  }catch(err){console.error("[KV SET Error]",err);return {ok:false};}
}
async function setKV(key,value){
  const bodyValue=typeof value==='object'?JSON.stringify(value):String(value??'');
  const previous=_kvWriteQueues.get(key)||Promise.resolve(null);
  const queued=previous.catch(()=>null).then(result=>{
    // 원격 충돌 뒤에 대기 중이던 같은 탭 저장도 중단한다. 최신 원장을 다시 읽기 전
    // 오래된 메모리 상태로 새 revision을 덮어쓰지 않도록 하기 위함이다.
    if(result?.conflict)return {...result,blocked:true};
    return _setKVOnce(key,bodyValue);
  });
  _kvWriteQueues.set(key,queued);
  try{return await queued;}
  finally{if(_kvWriteQueues.get(key)===queued)_kvWriteQueues.delete(key);}
}

async function getKV(key){
  const res=await authFetch(`/api/kv?key=${encodeURIComponent(key)}`);
  if(!res.ok) throw new Error(`KV GET ${key} 실패 (${res.status})`);
  const data=await res.json();
  if(!data||!Object.prototype.hasOwnProperty.call(data,'result')) throw new Error(`KV GET ${key} 응답 형식 오류`);
  if(Number.isFinite(Number(data.revision)))_kvRevisions.set(key,Number(data.revision));
  if(typeof data.result==='string'&&(data.result.startsWith('{')||data.result.startsWith('['))){
    try{return JSON.parse(data.result);}catch(e){return data.result;}
  }
  return data.result;
}

// KV 저장 실패 시 사용자에게 보이는 자동 소멸 토스트 (재호출 시 타이머만 리셋 — 중복 방지)
function showSaveError(msg){
  let el=document.getElementById('kv-save-toast');
  if(!el){
    el=document.createElement('div');
    el.id='kv-save-toast';
    el.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10000;background:#EF4444;color:#fff;padding:11px 18px;border-radius:10px;font-size:var(--fs-body);font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.28);max-width:90vw;text-align:center;transition:opacity .3s';
    document.body.appendChild(el);
  }
  el.textContent=msg||'⚠️ 저장 실패 — 변경사항이 저장되지 않았습니다. 네트워크 상태를 확인해 주세요.';
  el.style.display='block';
  el.style.opacity='1';
  clearTimeout(window._kvSaveToastT);
  window._kvSaveToastT=setTimeout(()=>{ el.style.opacity='0'; setTimeout(()=>{ if(el)el.style.display='none'; },350); },4500);
}
async function saveAssetsToKV(){
  if(window._kvLoadState?.assets!=='ready'){
    showSaveError('⚠️ 자산 원장을 정상적으로 불러오기 전에는 저장할 수 없습니다. 데이터 상태에서 다시 확인해 주세요.');
    if(typeof finMarkFresh==='function') finMarkFresh('assets','투자자산 원장','Vercel KV',false,'원격 데이터 재로드 전 저장 차단');
    return {ok:false,blocked:true,status:null};
  }
  const sent=JSON.stringify(pfolioData);
  const res=await setKV('assets',pfolioData);
  const ok=!!(res&&res.result==='OK');
  let reverted=false;
  if(ok) _assetsLastGood=sent;
  else if(_kvShouldRevert('assets',res,_assetsLastGood,JSON.stringify(pfolioData))){ _assetsRestore(_assetsLastGood); reverted=true; }
  if(ok) console.log('KV 저장 성공'); else showSaveError(reverted?KV_REVERT_MSG:undefined);
  if(reverted) _rerenderAfterRevert();
  if(typeof finMarkFresh==='function') finMarkFresh('assets','투자자산 원장','Vercel KV',ok,ok?`${pfolioData.length}개 항목 저장`:`저장 실패${res?.status?' ('+res.status+')':''}`);
  return {ok,status:res?.status||null,reverted};
}

// 알려진 US 주식 티커 목록 (cur 자동 교정용)
const KNOWN_US_TICKERS = new Set(['NVDA','AAPL','MSFT','TSLA','AMZN','GOOGL','META','JPM','JEPI','JEPQ','MU','AMD','INTC','NFLX','DIS','VTI','SPY','QQQ','IWM','GLD','SLV','TLT','BND','VYM','SCHD',
  // 레버리지/인버스 ETF
  'QLD','TQQQ','SQQQ','UPRO','SPXU','SOXL','SOXS','LABU','LABD','FNGU','TECL','TECS','NAIL','WANT',
  // 기타 주요 US ETF
  'VOO','VEA','VWO','EFA','AGG','IEMG','ACWI','ARKK','ARKG','XLK','XLF','XLE','XLV','XBI','SOXX',
  'IBIT','FBTC','ETHU','ETHA','BITU','GBTC']);
// KRX 단축코드: 6자리 숫자 또는 알파뉴메릭(예: 0117V0, 00104K)
const _KR_CODE_RE = /^[0-9A-Z]{6}$/i;
function fixAssetCurrencies(arr) {
  const allowedGroups=new Set(['주식','가상화폐','금','현금']);
  const allowedCurrencies=new Set(CASH_CURRENCIES);
  const allowedMarkets=new Set(['KR','KOSPI','KOSDAQ','US','JP','CRYPTO','GOLD']);
  const allowedUnits=new Set(['','주','개','g','kg','돈']);
  const allowedDcaCycles=new Set(['매일','매주','매월']);
  const normalized=(Array.isArray(arr)?arr:[]).slice(0,10000).map(raw=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
    const grp=allowedGroups.has(raw.grp)?raw.grp:'주식';
    const ticker=String(raw.tkr==null?'':raw.tkr).trim().toUpperCase();
    const tkr=/^[A-Z0-9.^=_-]{1,24}$/.test(ticker)?ticker:'';
    const cur=allowedCurrencies.has(raw.cur)?raw.cur:(grp==='주식'?'USD':'KRW');
    const defaultMarket=grp==='금'?'GOLD':(grp==='가상화폐'?'CRYPTO':(cur==='KRW'?'KOSPI':cur==='JPY'?'JP':'US'));
    const market=allowedMarkets.has(raw.market)?raw.market:defaultMarket;
    const dcaCycle=allowedDcaCycles.has(raw.dcaCycle)?raw.dcaCycle:'매월';
    const dcaDays=Array.isArray(raw.dcaDays)
      ?[...new Set(raw.dcaDays.map(Number).filter(day=>Number.isInteger(day)&&day>=0&&day<=6))].slice(0,7)
      :[];
    return {
      grp,
      owner:_normalizeStoredOwner(raw.owner),
      broker:_boundedStoredText(raw.broker,120),
      acc:_boundedStoredText(raw.acc,120),
      name:_boundedStoredText(raw.name,160)||tkr,
      tkr,
      qty:_safeStoredNumber(raw.qty,{min:0,max:1_000_000_000_000_000}),
      unit:allowedUnits.has(raw.unit)?raw.unit:(grp==='가상화폐'?'개':grp==='주식'?'주':''),
      avgP:_safeStoredNumber(raw.avgP,{min:0,max:1_000_000_000_000_000}),
      curP:_safeStoredNumber(raw.curP,{min:0,max:1_000_000_000_000_000}),
      prevP:raw.prevP==null?null:_safeStoredNumber(raw.prevP,{min:0,max:1_000_000_000_000_000}),
      dayP:raw.dayP==null?null:_safeStoredNumber(raw.dayP,{min:-1_000_000_000_000_000,max:1_000_000_000_000_000,fallback:0}),
      cur,
      market,
      marketType:_boundedStoredText(raw.marketType,32),
      type:_boundedStoredText(raw.type,32),
      costUnknown:raw.costUnknown===true,
      dca:raw.dca===true,
      dcaCycle,
      dcaAmt:_safeStoredNumber(raw.dcaAmt,{min:0,max:1_000_000_000_000_000}),
      dcaCur:allowedCurrencies.has(raw.dcaCur)?raw.dcaCur:'KRW',
      dcaMode:raw.dcaMode==='qty'?'qty':'amount',
      dcaQty:_safeStoredNumber(raw.dcaQty,{min:0,max:1_000_000_000_000_000}),
      dcaDays,
      dcaDay:Math.round(_safeStoredNumber(raw.dcaDay,{min:1,max:31,fallback:1})),
      // dcaLastExec(예전 판이 수량을 스스로 늘리며 적던 날짜)는 싣지 않는다 — 불러올 때 버리고 다음 저장 때 원격에서도 사라진다.
      // 액면분할·병합을 어느 날짜까지 확인했는지. 이 날짜 '이후' 분할만 보정 후보가 된다.
      // 비어 있으면 아직 한 번도 확인하지 않은 항목이라 조회 범위 전체를 후보로 본다.
      splitCheckedAt:_isStoredDateKey(raw.splitCheckedAt)?String(raw.splitCheckedAt):'',
      _priceStale:raw._priceStale===true,
    };
  }).filter(Boolean);
  normalized.forEach(i => {
    if (i.grp === '주식') {
      const t = normTkr(i.tkr);
      // .T 접미사 = 도쿄증권거래소 → JPY
      if ((i.tkr||'').toUpperCase().endsWith('.T') && i.cur !== 'JPY') { i.cur = 'JPY'; }
      else if (KNOWN_US_TICKERS.has(t) && i.cur !== 'USD') { i.cur = 'USD'; }
      // 6자리 숫자 + 알파뉴메릭 국내 코드 → KRW
      else if (_KR_CODE_RE.test(t) && !KNOWN_US_TICKERS.has(t) && i.cur !== 'KRW') { i.cur = 'KRW'; }
    }
    // 금은 항상 KRW (USD로 잘못 저장된 경우 교정 → 이중환율 방지)
    if (i.grp === '금') i.cur = 'KRW';
    // curP가 0이면 avgP로 초기화. **반드시 _priceStale 을 같이 세운다** —
    // 표시값만 메우고 표식을 남기지 않으면 평가손익이 정확히 0이 되어, 홈의
    // 수익률/손실률 TOP5(gainPct>0 / gainPct<0)와 손익 기여도(|gain|>0)에서
    // 조용히 동시에 탈락한다. 시세를 못 받은 사실이 화면에서 사라지면 안 된다.
    if ((i.curP == null || i.curP <= 0) && i.avgP > 0) { i.curP = i.avgP; i._priceStale = true; }
  });
  return normalized;
}
function showKvLoadError(message,source='general'){
  let banner=document.getElementById('kv-error-banner');
  if(!banner){
    banner=document.createElement('div');
    banner.id='kv-error-banner';
    banner.style.cssText='position:fixed;top:0;left:0;right:0;z-index:9999;background:#EF4444;color:#fff;text-align:center;font-size:var(--fs-body);font-weight:600;';
    document.body.prepend(banner);
  }
  let row=banner.querySelector(`[data-kv-source="${source}"]`);
  if(!row){row=document.createElement('div');row.dataset.kvSource=source;row.style.padding='9px 16px';banner.appendChild(row);}
  row.textContent=message||'⚠️ 데이터를 불러오지 못했습니다. 데이터 상태에서 다시 확인해 주세요.';
}
function clearKvLoadError(source='general'){
  const banner=document.getElementById('kv-error-banner');
  if(!banner)return;
  banner.querySelector(`[data-kv-source="${source}"]`)?.remove();
  if(!banner.children.length) banner.remove();
}

async function loadAssetsFromKV(){
  window._kvLoadState.assets='pending';
  let data;
  try { data=await getKV('assets'); }
  catch(e){
    console.error('[loadAssetsFromKV]',e);
    window._kvLoadState.assets='failed';
    showKvLoadError('⚠️ 자산 데이터를 불러오지 못했습니다. 기존 데이터를 덮어쓰지 않도록 저장을 중단했습니다.','assets');
    return {ok:false,error:e?.message||'투자자산 원장 로드 실패'};
  }
  if(data==null) data=[];
  if(data&&typeof data==='object'){
    let candidate;
    if(Array.isArray(data)) candidate=data;
    else {
      if(!Object.values(data).every(Array.isArray)){
        window._kvLoadState.assets='failed';
        showKvLoadError('⚠️ 자산 데이터 형식이 올바르지 않습니다. 저장을 중단했습니다.','assets');
        return {ok:false,error:'투자자산 원장 형식 오류'};
      }
      const flat=[];
      for(const owner in data){
        if(Array.isArray(data[owner])) data[owner].forEach(item=>flat.push(item&&typeof item==='object'&&!Array.isArray(item)?{...item,owner}:item));
      }
      candidate=flat;
    }
    if(!candidate.every(item=>item&&typeof item==='object'&&!Array.isArray(item))){
      window._kvLoadState.assets='failed';
      showKvLoadError('⚠️ 자산 항목 형식이 올바르지 않습니다. 저장을 중단했습니다.','assets');
      return {ok:false,error:'투자자산 원장 항목 형식 오류'};
    }
    try{
      pfolioData=fixAssetCurrencies(candidate);
    }catch(e){
      window._kvLoadState.assets='failed';
      showKvLoadError('⚠️ 자산 데이터를 해석하지 못했습니다. 저장을 중단했습니다.','assets');
      return {ok:false,error:e?.message||'투자자산 원장 해석 오류'};
    }
    window._kvLoadState.assets='ready';
    _assetsLastGood=JSON.stringify(pfolioData);
    clearKvLoadError('assets');
    changeOwner(currentOwner, null);
    // 잘못된 티커 자동 보정 실행
    setTimeout(() => { autoFixTickers(); }, 2000);
    return {ok:true,count:pfolioData.length,detail:`${pfolioData.length}개 항목 로드`};
  }
  window._kvLoadState.assets='failed';
  showKvLoadError('⚠️ 자산 데이터 형식이 올바르지 않습니다. 저장을 중단했습니다.','assets');
  return {ok:false,error:'투자자산 원장 형식 오류'};
}

/**
 * autoFixTickers()
 * 이름이 티커로 잘못 저장된 항목(TIGER 코리아AI 등)을 백엔드 resolve API로 자동 수정.
 * ★ 2025 KRX 신규 단축코드는 알파뉴메릭(예: 0117V0)도 허용 → 정규식 [0-9A-Z]{6}.
 */
async function autoFixTickers() {
    let fixCount = 0;
    for (let i = 0; i < pfolioData.length; i++) {
        const item = pfolioData[i];
        if (item.grp !== '주식') continue;

        const raw = (item.tkr || '').trim();
        const stripped = raw.replace(/\.(KS|KQ)$/i, '').toUpperCase();
        // 유효한 KRX 6자리 코드(숫자 또는 알파뉴메릭) 이면 보정 불필요
        const isValidCode = /^[0-9A-Z]{6}$/.test(stripped);
        // 한글 포함, 이름과 티커가 같음, 혹은 6자리 코드가 아닌 경우 → 보정
        const isInvalid = !isValidCode && (/[가-힣]/.test(raw) || raw === item.name || raw.length === 0 || raw.length >= 7);
        if (!isInvalid) continue;

        console.log(`[AutoFix] Resolving ticker for: ${item.name} (${item.tkr})`);
        try {
            const resp = await authFetch(`/api/dashboard?type=resolve&name=${encodeURIComponent(item.name)}`);
            const data = await resp.json();
            const code = data && data.code ? String(data.code).toUpperCase() : '';
            if (data.success && /^[0-9A-Z]{6}$/.test(code)) {
                console.log(`[AutoFix] Resolved ${item.name} -> ${code}`);
                item.tkr = code + '.KS'; // 기본적으로 .KS 붙임
                fixCount++;
            } else {
                // 백엔드 실패 시 stocks.json (프론트 DB) 로 재시도
                const hit = (typeof resolveKrTickerByName === 'function') ? resolveKrTickerByName(item.name) : null;
                if (hit && /^[0-9A-Z]{6}$/.test(hit.code)) {
                    const suf = hit.market && String(hit.market).toUpperCase().includes('KOSDAQ') ? '.KQ' : '.KS';
                    item.tkr = hit.code + suf;
                    fixCount++;
                    console.log(`[AutoFix/DB] ${item.name} -> ${item.tkr}`);
                }
            }
        } catch(e) { console.warn('[AutoFix] Error:', e); }
    }
    if (fixCount > 0) {
        saveAssetsToKV();
        changeOwner(currentOwner, null);
        console.log(`[AutoFix] ${fixCount}개의 종목 티커 보정 완료`);
    }
}

// =============================================
// 국내 ETF · 주식 실시간 데이터 주입 모듈
//   · data/stocks.json(KRX 전체 상장 리스트)로 종목명 → 6자리 티커 매칭
//   · /api/stock-price (네이버 금융 스크래핑) 호출로 실시간 가격 주입
//   · 기존 UI/디자인은 건드리지 않고 pfolioData.curP/tkr 만 업데이트
// =============================================

// 종목명 정규화 – 공백/구분자/흔한 접미사 제거 (매칭률 향상)
function _normalizeKrName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/\(주\)/g, '')
    .replace(/보통주$/g, '')
    .replace(/우선주$/g, '')
    // ETF 상장 변경으로 자주 등장하는 접미사 제거
    .replace(/\[증권\]$/g, '')
    .replace(/\[대표\]$/g, '')
    .replace(/[\s·\-_/().&+,]/g, '');
}

// KRX 6자리 단축코드는 숫자 또는 알파뉴메릭 (예: 0117V0, 00104K). 대소문자 무관.
const KR_CODE_RE = /^[0-9A-Z]{6}$/i;

// stocks.json 로드 + 이름→티커 인덱스 구축 (1회)
window._krStocksDB = window._krStocksDB || null;
async function loadKoreanStocksDB() {
  if (window._krStocksDB) return window._krStocksDB;
  try {
    const resp = await fetch('data/stocks.json', { cache: 'no-cache' });
    if (!resp.ok) throw new Error('stocks.json load failed: ' + resp.status);
    const arr = await resp.json();
    const byName = new Map();     // 정식 종목명
    const byShort = new Map();    // 종목약명 (구버전 호환)
    const byCode = new Map();     // 6자리 티커 (숫자/알파뉴메릭)
    arr.forEach(row => {
      if (!row) return;
      // 신버전(종목코드) / 구버전(단축코드) 양쪽 호환
      const codeRaw = row['종목코드'] || row['단축코드'];
      if (!codeRaw) return;
      // 코드는 항상 문자열 6자리로 유지 (앞의 '0' 보존, 대문자 정규화)
      const code = String(codeRaw).toUpperCase().padStart(6, '0');
      const n1 = _normalizeKrName(row['종목명']);
      const n2 = _normalizeKrName(row['종목약명']);
      // 종가: 신버전에만 존재. Naver API 장애 시 fallback 가격으로 활용
      const close = Number(row['종가'] || row['close'] || 0) || 0;
      const changeRate = Number(row['등락률'] || 0) || 0;
      const meta = { code, name: row['종목명'], market: row['시장구분'], close, changeRate };
      if (n1) byName.set(n1, meta);
      if (n2) byShort.set(n2, meta);
      byCode.set(code, meta);
    });
    window._krStocksDB = { byName, byShort, byCode, raw: arr };
    console.log(`[StocksDB] KRX 종목 ${arr.length}건 로드 완료`);
    return window._krStocksDB;
  } catch (e) {
    console.warn('[StocksDB] load error:', e.message);
    window._krStocksDB = { byName: new Map(), byShort: new Map(), byCode: new Map(), raw: [] };
    return window._krStocksDB;
  }
}

/**
 * 종목명으로 6자리 티커 조회. 없으면 null.
 *   - 정식 종목명 → 종목약명 → 부분일치 순으로 탐색
 *   - 결과 6자리 코드는 항상 문자열(앞 '0', 대문자 유지)
 */
function resolveKrTickerByName(name) {
  const db = window._krStocksDB;
  if (!db || !name) return null;
  const key = _normalizeKrName(name);
  if (!key) return null;
  const exact = db.byName.get(key) || db.byShort.get(key);
  if (exact) return exact;
  // 부분일치 fallback (신규 ETF 등 정규화 후에도 매칭 실패할 때)
  //  - key를 종목약명/종목명에 포함 or 그 반대
  for (const [k, v] of db.byShort) {
    if (k.includes(key) || key.includes(k)) return v;
  }
  for (const [k, v] of db.byName) {
    if (k.includes(key) || key.includes(k)) return v;
  }
  return null;
}

/** 주어진 문자열을 정규화된 6자리 KRX 단축코드로 변환. 불가능하면 null. */

/** pfolioData 항목이 국내(KRW) 주식/ETF인지 판단 */
function _isDomesticEquity(item) {
  if (!item || item.grp !== '주식') return false;
  const raw = normTkr(item.tkr);
  if (KR_CODE_RE.test(raw)) return true;
  return item.cur === 'KRW';
}

/**
 * 페이지 로드 직후, stocks.json 으로 선제 매칭하여
 *  (1) 잘못/누락된 티커를 6자리 코드(숫자 또는 알파뉴메릭)로 보정
 *  (2) curP가 없는 경우 avgP로 초기 값 주입 (화면 공백 방지)
 * ──────────────────────────────────────────────
 *  UI/디자인은 전혀 수정하지 않음. 데이터(pfolioData)만 갱신 후
 *  기존 renderPortfolio()에 의해 그대로 노출된다.
 *  ★ 알파뉴메릭 티커(예: 0117V0, 00104K)도 보존.
 *  ★ 이름으로도 매칭되지 않으면 원래 값을 유지 (000003.KS 같이 잘못된 fallback 방지).
 */
function injectInitialFromStocksDB() {
  const db = window._krStocksDB;
  if (!db) return 0;
  let fixed = 0;
  const unresolved = [];
  pfolioData.forEach(i => {
    if (!_isDomesticEquity(i)) return;

    const raw = normTkr(i.tkr);
    // 1) 이미 유효한 6자리 KRX 코드인지 확인 (숫자 또는 알파뉴메릭)
    let code6 = KR_CODE_RE.test(raw) ? raw : null;

    // 2) 유효 코드가 아니면 종목명으로 매칭
    if (!code6) {
      const hit = resolveKrTickerByName(i.name);
      if (hit) code6 = hit.code;
    }

    // 3) 여전히 실패하면 보정 금지 (원래 값 유지) + 경고
    if (!code6) {
      unresolved.push(`${i.owner}/${i.name} (tkr=${i.tkr})`);
      // curP 초기값은 여전히 채워 둠 (화면 공백 방지)
      if ((!i.curP || i.curP <= 0) && i.avgP > 0) i.curP = i.avgP;
      return;
    }

    // 4) market 정보로 .KS/.KQ suffix 결정
    const meta = db.byCode.get(code6);
    const suffix = meta && meta.market && String(meta.market).toUpperCase().includes('KOSDAQ') ? '.KQ' : '.KS';
    const next = code6 + suffix;
    if (i.tkr !== next) { i.tkr = next; fixed++; }

    // 5) curP가 비어있으면 stocks.json의 종가(close) 우선, 없으면 avgP로 초기화
    if (!i.curP || i.curP <= 0) {
      if (meta && meta.close > 0) {
        i.curP = meta.close;
      } else if (i.avgP > 0) {
        i.curP = i.avgP;
      }
    }
  });

  if (unresolved.length > 0) {
    console.warn('[StocksDB] 티커 자동 매칭 실패 종목 (수동 확인 필요):\n' + unresolved.join('\n'));
  }
  if (fixed > 0) {
    try { changeOwner(currentOwner, null); } catch (_) {}
  }
  return fixed;
}

// 국내 종목 시세 조회 대상(6자리 단축코드, 중복 없음).
function _domesticQuoteTickers(){
  return Array.from(new Set(
    (pfolioData||[]).filter(_isDomesticEquity)
      .map(i => String(i.tkr || '').replace(/\.(KS|KQ)$/i, '').toUpperCase())
      .filter(t => KR_CODE_RE.test(t))
  ));
}
/**
 * 국내 시세를 네이버 금융 스크래핑 API(/api/stock-price)에서 받아 오기만 한다(반영은 liveRefreshDomesticEtfs).
 *   - 10개씩 묶고, 묶음은 둘씩 동시에 보낸다 — 서버가 요청마다 네이버를 5개씩 동시에 부르므로 동시 요청은 최대 10개다.
 *     예전에는 묶음을 차례로 보내 국내 종목 17개에 6.8초가 걸렸다(2026-11-20 운영 기록).
 *   - 묶음 실패는 여기서 삼킨다(빈 결과) — 첫 로딩에서 await 하기 전에 시작해 두므로 거부된 약속이 남으면 안 된다.
 *   - 서버가 한 종목을 평탄한 응답으로 줘도 버리지 않는다(예전 배포·캐시 응답 호환).
 */
async function _fetchDomesticQuotes(tickers){
  const merged={};
  const chunks=_chunkTickers(tickers||[],10);
  const one=async chunk=>{
    try{
      const resp=await authFetch(`/api/stock-price?tickers=${chunk.join(',')}`);
      if(!resp.ok) return;
      const data=await resp.json();
      Object.assign(merged,(data&&data.result)||(data&&data.ticker?{[data.ticker]:data}:{}));
    }catch(e){ console.warn('[DomesticEtfLive] chunk error:', e && e.message); }
  };
  for(let k=0;k<chunks.length;k+=2) await Promise.all(chunks.slice(k,k+2).map(one));
  return merged;
}
/**
 * 네이버 금융 스크래핑 API(/api/stock-price)로 국내 주식/ETF 실시간 가격 반영.
 *   - 숫자 뿐 아니라 알파뉴메릭 6자리 코드(예: 0117V0) 도 지원.
 *   - 성공 티커만 curP를 갱신하고 _priceStale=false 로 마킹.
 *   - 기존 liveRefresh()가 실패한 경우에도 이 함수가 폴백/보완 역할 수행.
 *   - prefetch: 미리 시작해 둔 _fetchDomesticQuotes 약속(refreshMarketPrices). 반영은 주 시세(liveRefresh)가 끝난 뒤라
 *     국내 값이 Yahoo 값을 덮는 순서는 예전과 같다.
 */
async function liveRefreshDomesticEtfs(prefetch) {
  const items = pfolioData.filter(_isDomesticEquity);
  const tickers = _domesticQuoteTickers();
  if (tickers.length === 0) return {ok:true,skipped:true,updated:0,attempted:0,stale:0};
  const result = (prefetch ? await prefetch : null) || await _fetchDomesticQuotes(tickers);

  const updatedTickers=new Set();
  pfolioData.forEach(i => {
    if (!_isDomesticEquity(i)) return;
    const t6 = String(i.tkr || '').replace(/\.(KS|KQ)$/i, '').toUpperCase();
    const q = result[t6];
    if (q && q.success && q.price > 0) {
      // 서버가 이미 '직전 종가'(장이 끝난 마지막 거래일 종가)를 price 로 준다 — 장중에는 전 거래일,
      // 15:40 뒤에는 오늘 종가. prevClose 는 그 전 거래일 종가다. 배치(net_worth_snapshot.py)와 같은 규칙.
      // 예전엔 prevClose 를 curP 로 써서 장 마감 뒤에도 하루 묵은 종가가 남았다.
      i.curP = q.price;
      i._priceStale = false;
      i.prevP = q.prevClose || null;
      i.dayP = q.prevClose ? q.price - q.prevClose : null;
      updatedTickers.add(t6);
    }
  });

  if (updatedTickers.size > 0) {
    try { changeOwner(currentOwner, null); } catch (_) {}
    console.log(`[DomesticEtfLive] ${updatedTickers.size}종목 실시간 가격 반영 완료`);
  }
  const stale=items.filter(i=>i&&i._priceStale).length;
  return {ok:updatedTickers.size===tickers.length,updated:updatedTickers.size,attempted:tickers.length,stale};
}

// 주 시세 API와 국내 보완 소스를 한 번의 최종 결과로 합친다.
async function refreshMarketPrices(){
  // 국내 시세는 주 시세와 동시에 받아 두고(기다리는 시간 단축), 반영은 주 시세 뒤에 한다(덮는 순서는 예전 그대로).
  const domTickers=_domesticQuoteTickers();
  const domPrefetch=domTickers.length?_fetchDomesticQuotes(domTickers):null;
  const primary=await liveRefresh();
  const domestic=await liveRefreshDomesticEtfs(domPrefetch);
  const marketItems=(pfolioData||[]).filter(i=>i&&(i.grp==='주식'||i.grp==='가상화폐'));
  const stale=marketItems.filter(i=>i._priceStale).length;
  const hasForeign=marketItems.some(i=>!_isDomesticEquity(i));
  const primaryResponded=!primary?.error;
  const domesticCoversAll=marketItems.length>0&&!hasForeign&&marketItems.every(i=>KR_CODE_RE.test(String(i.tkr||'').replace(/\.(KS|KQ)$/i,'').toUpperCase()));
  const ok=stale===0&&(primaryResponded||(domesticCoversAll&&domestic?.ok===true));
  const result={ok,stale,primary,domestic,detail:ok?'등록 자산 최신 상태':(stale?`${stale}개 최신 확인 필요`:(primary?.error||'시세 조회 실패'))};
  if(typeof finMarkFresh==='function') finMarkFresh('prices','시장 시세','국내 네이버 직전 종가 · 해외 Yahoo · 코인 업비트',ok,result.detail);
  return result;
}

// =============================================
// Python 하이브리드 백엔드 브릿지 (/api/dashboard)
// =============================================

window._goldUnit = 'g'; // 현재 금 단위 (g / 돈 / kg)

/** Python API 헬퍼 – 실패 시 null 반환 */
async function _pyFetch(params) {
  try {
    const qs = Object.entries(params).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
    const resp = await authFetch(`/api/dashboard?${qs}`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch(e) {
    console.warn('[PyAPI]', e.message);
    return null;
  }
}

/**
 * fetchPyRates() – 환율 데이터 (Python 1차, TS fallback)
 * 사이드바 USD/KRW, USD/JPY, JPY100/KRW 업데이트
 */
async function fetchPyRates() {
  const d = await _pyFetch({type:'rates'});
  if (!d || !d.success || !d.rates) return false;
  const rates = d.rates;

  const flash2 = (id, newV, oldV) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (Number.isFinite(newV) && newV>0) {
      el.textContent = newV.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
      if (Math.abs(newV - (oldV||0)) > 0.01) flash(el, newV > (oldV||0) ? 'up' : 'down');
    } else {
      el.textContent = newV; // '미조회'
    }
  };

  // '미조회' 문자열·키 누락(undefined) 모두 방어 — 숫자일 때만 갱신
  if (Number.isFinite(rates.usd_krw) && rates.usd_krw>0) {
    flash2('side-usd-rate', rates.usd_krw, RATES.USD);
    RATES.USD = rates.usd_krw;
  }
  if (Number.isFinite(rates.usd_jpy) && rates.usd_jpy>0) {
    flash2('side-usdjpy-rate', rates.usd_jpy, RATES.USDJPY||150);
    RATES.USDJPY = rates.usd_jpy;
  }
  if (Number.isFinite(rates.jpy100_krw) && rates.jpy100_krw>0) {
    // JPY100/KRW
    const jpyFmt = rates.jpy100_krw.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
    const el = document.getElementById('side-jpy-rate');
    if (el) el.textContent = jpyFmt;
    RATES.JPY = rates.jpy100_krw / 100;
  }
  // AUD/KRW — 호주달러 예수금 평가에 쓴다. 못 받으면 RATES.AUD 를 비워 두어야 한다.
  // 1 로 채우면 A$1 = ₩1 로 조용히 계산돼 평가액이 약 950배 어긋난다.
  // 실패해도 시드값(RATES.AUD)을 지우지 않는다 — 지우면 RATES[cur]||1 경로가 1:1 로 떨어져
  // A$1 = ₩1 로 계산된다. 값은 유지하고 신선도만 데이터 상태에서 드러낸다.
  if (Number.isFinite(rates.aud_krw) && rates.aud_krw>0) RATES.AUD = rates.aud_krw;
  return Number.isFinite(rates.usd_krw)&&rates.usd_krw>0&&Number.isFinite(rates.jpy100_krw)&&rates.jpy100_krw>0;
}

/**
 * fetchPyGold(unit) – 금 시세 (선택 단위 반영)
 * side-gold-rate 업데이트, GOLD_G_KRW 갱신
 */
async function fetchPyGold(unit) {
  unit = unit || window._goldUnit || 'g';
  const d = await _pyFetch({type:'gold', unit});
  if (!d || !d.success || !d.gold) return false;
  const g = d.gold;

  // 단위 레이블 갱신
  const selEl = document.getElementById('gold-unit-select');
  if (selEl) selEl.value = unit;

  const hG = document.getElementById('side-gold-rate');

  const priceValid=Number.isFinite(g.price)&&g.price>0;
  const gramPriceValid=Number.isFinite(g.price_per_g)&&g.price_per_g>0;
  if (!priceValid||!gramPriceValid) {
    if(hG) hG.textContent = '미조회';
    return false;
  }
  const oldVal = window._GOLD_G_KRW_UNIT || 0;
  if(hG){
    hG.textContent = '₩' + Math.round(g.price).toLocaleString();
    if (g.price !== oldVal) flash(hG, g.price > oldVal ? 'up' : 'down');
  }
  window._GOLD_G_KRW_UNIT = g.price;

  // g 단위일 때만 GOLD_G_KRW 업데이트 (포트폴리오 계산용)
  if (gramPriceValid) {
    const oldGold = window._GOLD_G_KRW || 0;
    window._GOLD_G_KRW = g.price_per_g;
    // 금 자산 curP 갱신
    pfolioData.forEach(i => {
      if (i.grp === '금') {
        const gm = i.unit === '돈' ? 3.75 : (i.unit === 'kg' ? 1000 : 1);
        i.curP = g.price_per_g * gm;
      }
    });
  }
  return true;
}

/** 금 단위 변경 핸들러 (select onchange) */
function changeGoldUnit(unit) {
  window._goldUnit = unit;
  fetchPyGold(unit);
}

/**
 * fetchPyPrices(tickers) – Python 가격 조회 (TS API 실패 fallback)
 * pfolioData.curP 업데이트
 */
async function fetchPyPrices(tickers) {
  if (!tickers || !tickers.length) return;
  // api/dashboard.py 도 MAX_TICKERS=25 로 제한한다 — 넘기면 요청 전체가 거부된다.
  const qmap = {};
  for (const chunk of _chunkTickers(tickers)) {
    try {
      const d = await _pyFetch({type:'price', tickers: chunk.join(',')});
      if (d && d.success && d.result) Object.assign(qmap, d.result);
    } catch(e) { console.warn('[fetchPyPrices chunk]', chunk.length+'개', e?.message); }
  }
  if (!Object.keys(qmap).length) return;
  let updated = false;
  pfolioData.forEach(i => {
    if (i.grp !== '주식' && i.grp !== '가상화폐') return;
    const tkr6 = normTkr(i.tkr);
    const q = qmap[quoteKey(i.tkr)] || qmap[tkr6] || qmap[i.tkr];
    if (q && q.price !== '미조회' && typeof q.price === 'number') {
      const conv = _quoteToItemCur({price:q.price, currency:q.cur}, i);
      if (conv && (!i.curP || i._priceStale)) {
        i.curP = conv.price;
        i._priceStale = false;
        updated = true;
      }
    }
  });
  if (updated) {
    syncDivHistory();
    changeOwner(currentOwner, null);
  }
}

// Python API의 dps도 TS API와 동일하게 '연간 DPS'다. 회당 eps로 정규화해
// 월/분기 배당을 지급 횟수만큼 다시 곱하는 과대계상을 막는다.
function _normalizePyDividendInfo(tkr,info,existing) {
  existing=existing||{};
  if(!info||info.dps==='미조회') return null;
  const cleanMonths=list=>[...new Set((Array.isArray(list)?list:[])
    .map(Number).filter(m=>Number.isInteger(m)&&m>=0&&m<12))];
  // 지급일 근거가 있는 값(공시 지급일·국내 ETF 관행 추정)은 배당락일 기준인 Python 값으로 덮지 않는다 — 지급월이 한 달 어긋난다.
  const payKnown=existing.paySource==='stockanalysis'||existing.paySource==='kr-etf-rule';
  let cycle=(payKnown?existing.cycle:info.cycle)||info.cycle||existing.cycle||'-';
  let months=payKnown?cleanMonths(existing.months):cleanMonths(info.months);
  if(!months.length) months=cleanMonths(info.months);
  if(!months.length) months=cleanMonths(existing.months);
  if(!months.length) months=cleanMonths(_defaultMonthsForCycle(cycle));

  const providedDps=Number(info.dps);
  const existingPeriods=months.length||(CYCLE_COUNT[existing.cycle||cycle]||1);
  const existingAnnual=Number(existing.annualDps)||(Number(existing.eps)||0)*existingPeriods;
  const annualDps=Number.isFinite(providedDps)&&providedDps>0?providedDps:existingAnnual;
  if(!months.length&&annualDps>0) months=[2,5,8,11];
  if(cycle==='-'&&months.length) cycle=months.length===12?'월배당':months.length===2?'반기':months.length===1?'연간':'분기';
  const payoutCount=months.length||(CYCLE_COUNT[cycle]||1);
  const eps=annualDps>0?annualDps/payoutCount:0;
  const yldNum=Number(info.yld);
  const safeYld=Number.isFinite(yldNum)?yldNum:(Number(existing.yldNum)||parseFloat(String(existing.yld||''))||0);
  if(!(eps>0)&&!(safeYld>0)) return null;
  const cur=info.cur||existing.cur||(/^[0-9A-Z]{6}$/.test(tkr)?'KRW':(/\.T$/i.test(tkr)?'JPY':'USD'));
  return {
    ...existing,
    eps,
    annualDps,
    yld:safeYld.toFixed(2)+'%',
    yldNum:safeYld,
    cur,
    months,
    cycle,
    exDiv:existing.exDiv||'-',
    payDay:payKnown&&existing.payDay?existing.payDay:(typeof info.payDay==='number'?info.payDay:(existing.payDay||null))
  };
}

/**
 * fetchPyDividends() – Python(pykrx/yfinance) 배당 데이터 보완
 * 등록된 모든 주식(국내 6자리 숫자/알파뉴메릭 + 해외 티커)을 병합 조회.
 * 배당 주기(months) 누락 시 cycle에서 추정하거나 기본 분기배당으로 설정.
 */
async function fetchPyDividends() {
  // 국내(6자리 알파뉴메릭 포함) + 해외(영문/기타) 모든 보유 종목
  const allTickers = [...new Set(
    pfolioData
      .filter(i => i.grp === '주식' && i.qty > 0)
      .map(i => String(i.tkr||'').toUpperCase().replace(/\.(KS|KQ)$/, ''))
      .filter(Boolean)
  )];
  if (!allTickers.length) return;

  const krTickers = allTickers.filter(t => /^[0-9A-Z]{6}$/.test(t));
  const foreignTickers = allTickers.filter(t => !/^[0-9A-Z]{6}$/.test(t));

  const mergeOne = (tkr, info) => {
    const cacheTkr = normDivTkr(tkr);
    const existing = window._divDataCache[cacheTkr] || DIV_INFO_DB[tkr] || DIV_INFO_DB[cacheTkr] || {};
    const normalized=_normalizePyDividendInfo(tkr,info,existing);
    if(normalized) window._divDataCache[cacheTkr]=normalized;
  };

  // 국내 종목 배당 (pykrx 기반)
  if (krTickers.length) {
    try {
      for (const chunk of _chunkTickers(krTickers, PY_DIVIDEND_TICKER_LIMIT)) {
        const d = await _pyFetch({type:'dividend', tickers: chunk.join(',')});
        if (d && d.success && d.result) {
          Object.entries(d.result).forEach(([tkr, info]) => mergeOne(tkr, info));
        }
      }
    } catch(e) { console.warn('[fetchPyDividends KR]', e); }
  }

  // 해외 종목 배당 (yfinance 기반)
  if (foreignTickers.length) {
    try {
      for (const chunk of _chunkTickers(foreignTickers, PY_DIVIDEND_TICKER_LIMIT)) {
        const d = await _pyFetch({type:'dividend', tickers: chunk.join(',')});
        if (d && d.success && d.result) {
          Object.entries(d.result).forEach(([tkr, info]) => mergeOne(tkr, info));
        }
      }
    } catch(e) { console.warn('[fetchPyDividends US]', e); }
  }

  syncDivHistory();
  // 현금흐름: 갱신된 배당 정보로 이번 달 누락 배당수입을 자동 등록
  try { if (typeof autoAddDividendCashFlow === 'function') await autoAddDividendCashFlow(true); } catch(_){}
  // 대시보드/포트폴리오/현금흐름/가족 화면 재렌더
  try { if (typeof changeOwner === 'function') changeOwner(currentOwner, null); } catch(_){}
  try { if (typeof renderCashFlow === 'function') renderCashFlow(); } catch(_){}
}

// =============================================
// Python API 통합 초기화 및 새로고침 연동
// =============================================

/** 전체 Python API 새로고침 (순차 실행) */
async function refreshPyData(options={}) {
  // 환율 + 금 시세는 병렬 조회
  const [ratesOk,goldOk]=await Promise.all([
    fetchPyRates(),
    fetchPyGold(window._goldUnit)
  ]);
  // 배당 보완은 확장 KV가 정상 로드된 흐름에서만 실행한다.
  // 이 함수는 배당 현금흐름을 실체화해 ext_data를 저장할 수 있기 때문이다.
  if(options.includeDividends!==false) await fetchPyDividends();
  // TS API에서 미조회(_priceStale)된 종목 Python으로 보완
  const staleTickers = [...new Set(
    pfolioData
      .filter(i => (i.grp==='주식'||i.grp==='가상화폐') && i._priceStale)
      .map(i => normTkr(i.tkr))
      .filter(Boolean)
  )];
  if (staleTickers.length) await fetchPyPrices(staleTickers);
  return {
    ok:!!ratesOk&&!!goldOk,
    ratesOk:!!ratesOk,
    goldOk:!!goldOk,
    detail:ratesOk&&goldOk
      ? `USD ${Number(RATES.USD||0).toLocaleString()} · JPY ${Number(RATES.JPY||0).toLocaleString()}`
      : `환율 ${ratesOk?'정상':'실패'} · 금 ${goldOk?'정상':'실패'}`
  };
}

// =============================================
// 벤치마크 실제 데이터 로딩 (Python backend)
// – 모든 활성 소유주(본인/아내/자녀1/아버지)의 포트폴리오 성과를 개별 조회하여
//   S&P 500 / KOSPI 벤치마크와 나란히 비교한다.
// =============================================
// ── JS 측 Yahoo Finance 벤치마크 폴백 ─────────────────
//   Python 백엔드(api/dashboard?type=benchmark)가 실패해도 차트가 비지 않도록
//   클라이언트에서 Yahoo chart API(^GSPC, ^KS11)를 직접 호출해 기간별 수익률 시계열 생성.
//   tickersWithWeights 가 있으면 동일 API 로 개별 종목 시계열도 받아 포트폴리오 성과 합성.
async function _jsBenchmarkFallback(tickersWithWeights) {
  // 오늘(intraday) 제외 — YYYY-MM-DD 문자열 비교
  const _today = new Date();
  const _todayKey = _cfLocalDateKey(_today);
  const _dayKey = _cfLocalDateKey;

  // Yahoo Finance 1y 차트 → 기간별 자료 (종가만, 오늘 제외)
  async function fetchYahoo(sym) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1y`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    if (!res) return null;
    const ts = res.timestamp || [];
    const closes = res.indicators?.quote?.[0]?.close || [];
    return ts.map((t,i)=>({ dt: new Date(t*1000), close: Number(closes[i]) }))
             .filter(e => Number.isFinite(e.close))
             .filter(e => _dayKey(e.dt) !== _todayKey);  // 오늘(intraday) 제외
  }
  async function fetchSafe(sym) {
    try { return await fetchYahoo(sym); } catch(e) { return null; }
  }
  const [spy, kospi] = await Promise.all([
    fetchSafe('^GSPC'),
    fetchSafe('^KS11'),
  ]);
  if (!spy && !kospi) return null;

  const tickerSeries = {};
  if (Array.isArray(tickersWithWeights) && tickersWithWeights.length) {
    await Promise.all(tickersWithWeights.map(async ([tkr]) => {
      const series = await fetchSafe(tkr);
      if (series && series.length) tickerSeries[tkr] = series;
    }));
  }

  // 기간별 인덱스 시리즈 빌드 (Python 동일 포맷)
  const now = spy ? spy[spy.length-1].dt : (kospi ? kospi[kospi.length-1].dt : new Date());
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const periods = {
    '5D':  new Date(now.getTime() - 7*86400000),
    '1M':  new Date(now.getTime() - 30*86400000),
    '3M':  new Date(now.getTime() - 90*86400000),
    '6M':  new Date(now.getTime() - 180*86400000),
    'YTD': startOfYear,
    '1Y':  new Date(now.getTime() - 365*86400000),
  };

  const out = {};
  Object.entries(periods).forEach(([key, start]) => {
    const filterFn = arr => arr && arr.filter(e => e.dt >= start);
    const spySlice = filterFn(spy) || [];
    const kosSlice = filterFn(kospi) || [];
    const baseArr = spySlice.length ? spySlice : kosSlice;
    if (baseArr.length < 2) return;

    const n = baseArr.length;
    // 모든 거래일 — 서버(api/dashboard.py get_benchmark)와 같은 규칙. 6등분 샘플링은 MDD 를 작게 만들었다.
    const indices = Array.from({length:n}, (_,i)=>i);

    const labels = indices.map(i => {
      const d = baseArr[i].dt; return `${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getDate().toString().padStart(2,'0')}`;
    });

    const pct = (arr, i) => {
      if (!arr || arr.length < 2) return 0;
      const slice = arr.filter(e => e.dt >= start);
      if (slice.length < 2) return 0;
      const b = slice[0].close;
      const vIdx = Math.min(i, slice.length-1);
      const v = slice[vIdx].close;
      return b > 0 ? parseFloat(((v/b - 1)*100).toFixed(2)) : 0;
    };

    const sp500_data = indices.map(i => pct(spy, i));
    const kospi_data = indices.map(i => pct(kospi, i));
    // 포트폴리오: 가중평균 (weight × 종가비율)
    let portfolio_data = [];
    if (tickersWithWeights && tickersWithWeights.length && Object.keys(tickerSeries).length) {
      portfolio_data = indices.map(i => {
        let totB=0, totV=0;
        tickersWithWeights.forEach(([tkr, w]) => {
          const arr = tickerSeries[tkr];
          if (!arr || arr.length < 2) return;
          const slice = arr.filter(e => e.dt >= start);
          if (slice.length < 2) return;
          const b = slice[0].close;
          const vIdx = Math.min(i, slice.length-1);
          const v = slice[vIdx].close;
          if (b > 0) { totB += w; totV += w * (v / b); }
        });
        return totB > 0 ? parseFloat(((totV/totB - 1)*100).toFixed(2)) : 0;
      });
    }

    out[key] = { labels, sp500: sp500_data, kospi: kospi_data, portfolio: portfolio_data };
  });

  return out;
}

async function fetchBenchmarkData(ownerOverride) {
  try {
    // 환율(RATES) 미로드 시 가중치 계산이 틀어지므로 먼저 보강
    if (!RATES || RATES.USD == null) { try { await fetchPyRates(); } catch(e){} }

    // ownerOverride 가 있으면 해당 한 명만, 없으면 자산이 있는 모든 소유주
    // 대상 판정은 '보유 여부'만 본다. 예전에는 a.curP 까지 요구해서, 시세가 비면 해당 소유주가
    // 조용히 대상에서 빠졌다 — 라인이 없는데도 loaded===targets.length 가 성립해 초록불이 됐다.
    // cobalt.js 의 재조회 경로(cbVerifyPerfOwnersOnOpen)도 qty 기준이라 이제 두 경로가 일치한다.
    const targets = ownerOverride
      ? [ownerOverride]
      : OWNERS.filter(o => getFilteredAssets(o).some(a=>(a.grp==='주식'||a.grp==='가상화폐'||a.grp==='금')&&a.qty));
    if (!targets.length) {
      // 개별 보유자가 없으면 벤치마크(SPY/KOSPI)만 가져오기 위해 가짜 호출
      targets.push('본인');
    }

    // 서버 상한 때문에 상위 N개만 보낸 소유주를 기록해 데이터 상태에 드러낸다.
    const truncatedOwners = [];

    // 소유주별 로더 (각자의 Top-N 포트폴리오 시뮬레이션) — 아래에서 병렬 실행
    const loadOwner = async (owner) => {
      // 부동산·부채 제외 (주식/가상화폐/금 취합), 금은 GC=F로 대표
      const allAssets = getFilteredAssets(owner).filter(a=>(a.grp==='주식'||a.grp==='가상화폐'||a.grp==='금')&&a.qty&&a.curP);
      // 티커별 가중치 맵 (동일 종목 다른 계좌 합산)
      const tkrWeightMap = {};
      allAssets.forEach(a => {
        // Yahoo/yfinance 인식 가능한 심볼로 변환 (국내주식 .KS/.KQ, 코인 -USD, 금 GC=F)
        let tkr;
        if (a.grp==='금') {
          tkr = 'GC=F';
        } else if (a.grp==='가상화폐') {
          const ct = (a.tkr||'').toUpperCase();
          tkr = ct.includes('-') ? ct : ct + '-USD';
        } else {
          const stripped = normTkr(a.tkr);
          const isKR = /^[0-9A-Z]{6}$/.test(stripped) && a.cur==='KRW';
          tkr = isKR ? stripped + (a.market==='KOSDAQ'?'.KQ':'.KS') : a.tkr;
        }
        const val = a.grp==='금'
          ? (a.qty||0) * (a.curP||0)               // curP는 이미 KRW
          : (a.qty||0) * (a.curP||0) * (RATES[a.cur]||1);
        tkrWeightMap[tkr] = (tkrWeightMap[tkr]||0) + val;
      });
      // 서버(api/dashboard.py)는 p_tkrs 를 20개로 제한한다. 넘기면 too_many_tickers 로
      // 요청 전체가 거부돼 해당 소유주 라인이 통째로 사라진다(보유 종목이 가장 많은 본인이 대표 사례).
      // 위 주석의 'Top-N 시뮬레이션' 의도대로 평가액 상위 N개만 보낸다.
      const rankedTkrs = Object.entries(tkrWeightMap).sort((a,b)=>b[1]-a[1]);
      const sentTkrs = rankedTkrs.slice(0, BENCH_TICKER_LIMIT);
      if (rankedTkrs.length > sentTkrs.length) {
        truncatedOwners.push(`${owner} ${sentTkrs.length}/${rankedTkrs.length}`);
        console.warn(`[Benchmark] ${owner} 보유 ${rankedTkrs.length}종목 중 평가액 상위 ${sentTkrs.length}종목으로 계산 (서버 상한 ${BENCH_TICKER_LIMIT})`);
      }
      const tkrs = sentTkrs.map(([t])=>t).join(',');
      const weights = sentTkrs.map(([,v])=>v.toFixed(0)).join(',');

      let url = '/api/dashboard?type=benchmark';
      if(tkrs && weights) url += `&p_tkrs=${encodeURIComponent(tkrs)}&p_weights=${encodeURIComponent(weights)}`;

      let data = null;
      try {
        // 진짜로 멈춘 연결만 끊기 위한 안전망 타임아웃.
        //   서버(api/dashboard.py)의 maxDuration이 60s이고, 보유 종목이 많거나(본인)
        //   KR .KS/.KQ 양쪽을 받는 종목이 많은(아버지) 소유주는 12s를 넘길 수 있어 조기 중단되면
        //   CORS로 막힌 JS 폴백으로 떨어져 라인이 통째로 사라졌다. 서버 예산보다 약간 길게 잡아
        //   정상 응답을 끊지 않는다. (소유주별 점진 렌더라 느린 소유주만 늦게 그려질 뿐 차단 없음)
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 62000); // 서버 maxDuration(60s)보다 약간 길게
        try {
          const resp = await authFetch(url, { signal: ctrl.signal });
          if (resp.ok) data = await resp.json();
        } finally { clearTimeout(to); }
      } catch(e) { console.warn('[Benchmark Py]', owner, e.message); }

      // Python 백엔드가 실패하면 JS Yahoo 폴백
      if (!data || !data.success || !data.benchmark || !Object.keys(data.benchmark).length) {
        const tw = Object.entries(tkrWeightMap).map(([tkr, w]) => [tkr, w]);
        const fbm = await _jsBenchmarkFallback(tw);
        if (fbm) {
          data = { success: true, benchmark: fbm };
          console.log(`[Benchmark] ${owner} JS 폴백 데이터 사용`);
        } else {
          console.warn(`[Benchmark] ${owner} 데이터 확보 실패 (백엔드+JS폴백 모두 실패 — 타임아웃/CORS 가능성)`);
          // 기존에 확보된 라인이 있으면 일시적 실패로 지우지 않음(라인이 사라지는 문제 방지).
          // 최초 로드 등 기존 데이터가 없을 때만 빈 배열로 마킹(범례 자동 제외).
          Object.keys(benchData).forEach(tf => {
            const cur = benchData[tf] && benchData[tf].data[owner];
            const hasGood = Array.isArray(cur) && cur.some(v => v != null);
            if (benchData[tf] && !hasGood) benchData[tf].data[owner] = [];
          });
          return false;
        }
      } else {
        console.log(`[Benchmark] ${owner} 백엔드 데이터 로드 완료`);
        if (Array.isArray(data.unresolved) && data.unresolved.length) {
          console.warn(`[Benchmark] ${owner} 해석 실패 티커(라인 누락 원인):`, data.unresolved.join(', '));
        }
      }

      const bm = data.benchmark;
      let hasBenchmarkSeries=false;
      // allAssets 는 curP 가 있는 자산만 담는다. 시세가 비면 보유 종목이 있어도 빈 배열이 되는데,
      // 이때 '자산 없음'으로 보고 성공 처리하면 라인이 없는 소유주가 초록불로 잡힌다.
      // 보유 자체가 없을 때만 포트폴리오 시리즈를 면제한다.
      const ownerHasHoldings = getFilteredAssets(owner)
        .some(a=>(a.grp==='주식'||a.grp==='가상화폐'||a.grp==='금')&&a.qty);
      let hasPortfolioSeries=!ownerHasHoldings;
      Object.keys(bm).forEach(tf => {
        const bd = bm[tf];
        if (!bd || !bd.labels) return;
        if (!benchData[tf]) benchData[tf] = { labels: bd.labels, data: {} };
        benchData[tf].labels = bd.labels;
        // 벤치마크는 공통(모든 소유주가 같은 S&P500/KOSPI 라인 공유)
        if (Array.isArray(bd.sp500)) benchData[tf].data['S&P 500'] = bd.sp500;
        if (Array.isArray(bd.kospi)) benchData[tf].data['KOSPI'] = bd.kospi;
        if([bd.sp500,bd.kospi].some(series=>Array.isArray(series)&&series.length===bd.labels.length&&series.some(Number.isFinite))) hasBenchmarkSeries=true;
        // 해당 소유주의 포트폴리오 성과
        if (Array.isArray(bd.portfolio) && bd.portfolio.length === bd.labels.length && bd.portfolio.some(Number.isFinite)) {
          benchData[tf].data[owner] = bd.portfolio;
          hasPortfolioSeries=true;
        }
      });

      return hasBenchmarkSeries&&hasPortfolioSeries;
    };

    // 모든 소유주를 병렬로 로드 — 순차 대기 제거로 체감 로딩 대폭 단축
    const results=await Promise.all(targets.map(loadOwner));

    // '전체' 소유주는 활성 소유주들의 가치 가중 평균으로 합성
    try {
      const ownerWeightMap = {};
      OWNERS.forEach(o => {
        const v = getFilteredAssets(o).reduce((s,a)=>{
          if (a.grp==='주식'||a.grp==='가상화폐') return s + (a.qty||0)*(a.curP||0)*(RATES[a.cur]||1);
          if (a.grp==='금') return s + (a.qty||0)*(a.curP||0); // curP는 이미 KRW
          return s;
        }, 0);
        if (v > 0 && Array.isArray(benchData[Object.keys(benchData)[0]]?.data?.[o])) ownerWeightMap[o] = v;
      });
      const totalW = Object.values(ownerWeightMap).reduce((s,v)=>s+v, 0);
      if (totalW > 0) {
        Object.keys(benchData).forEach(tf => {
          const labels = benchData[tf].labels || [];
          const combined = labels.map((_, idx) => {
            let sum = 0;
            Object.entries(ownerWeightMap).forEach(([o, w]) => {
              const arr = benchData[tf].data[o];
              if (Array.isArray(arr) && typeof arr[idx] === 'number') sum += arr[idx] * (w/totalW);
            });
            return Math.round(sum*100)/100;
          });
          benchData[tf].data['전체'] = combined;
        });
      }
    } catch(e) { console.warn('[Benchmark total owner]', e); }

    const loaded=results.filter(Boolean).length;
    const topNote=truncatedOwners.length?` · 상위 ${BENCH_TICKER_LIMIT}종목 기준(${truncatedOwners.join(', ')})`:'';
    return {ok:loaded===targets.length,loaded,attempted:targets.length,truncatedOwners,
      detail:`${loaded}/${targets.length}명 로드${topNote}`};
  } catch(e) {
    console.error('[Benchmark]', e);
    return {ok:false,error:e?.message||'벤치마크 조회 실패'};
  }
}

// 페이지 초기 로드 시 Python 데이터 자동 수집 (환율/금/배당 보완)
//   벤치마크는 initDashboard 의 IIFE가 자산 로드 완료 후 호출하므로 여기선 다루지 않는다.
window.addEventListener('load', () => {
  setTimeout(() => {
    const hashMatch=String(location.hash||'').match(/^#view=(.+)$/);
    const target=window.history.state?.assetView||(hashMatch?decodeURIComponent(hashMatch[1]):null);
    if(target&&document.getElementById('view-'+target)){
      _viewHistoryRestoring=true;
      try{ switchView(target,_viewMenuButton(target)); }
      finally{ _viewHistoryRestoring=false; }
      _recordViewHistory(target);
    }else{
      const active=document.querySelector('.view-section.active');
      _recordViewHistory(active?active.id.replace('view-',''):'cdash');
    }
  },0);
});

// =============================================
// 전역 리사이즈 핸들러 (모바일 회전/드로어 대응 차트 재맞춤)
// =============================================
let _globalResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_globalResizeTimer);
  _globalResizeTimer = setTimeout(() => {
    if (!isMobileLayout()) closeSidebar(); // 데스크톱 복귀 시 드로어 잔상 제거
    const active = document.querySelector('.view-section.active');
    if (!active) return;
    _fitActiveCharts();
    if (active.id === 'view-bubble') { try { renderBubbleChart('weight'); } catch (e) {} }
  }, 200);
});
