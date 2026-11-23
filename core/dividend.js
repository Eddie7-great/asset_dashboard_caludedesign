// core/dividend.js — 배당 — 계좌별 배당 세제, 배당세 배분 엔진, 배당 조회·이력
// (2026-11-23 script.js 에서 그대로 옮겨 나눈 조각. 로드 순서는 index.html·scripts/tests/_source.mjs)
// =============================================
// 한국 계좌별 배당 세제 혜택
// 세율·공제액은 tax-rules.js의 선택 연도 규칙에서만 읽는다.
// ISA 화면값은 유지기간 전체 법정 정산액이 아니라 연간 현금흐름 참고치다.
//
// 이 함수는 계좌 유형별 세후 배당 실효율(배당금 × rate)을 반환합니다.
// ISA 200만원 공제는 연 배당 합계 기준으로 처리하기 위해 syncDivHistory에서
// 별도 누적 처리합니다. 여기서는 계좌별 기본 정보만 노출.
// =============================================
function getAccountDivTaxInfo(acc) {
  const a = String(acc||'일반');
  if (a.includes('ISA')) {
    const rate=_taxRuleValue('isa.separateTaxCombinedRate',0.099);
    const exempt=_taxRuleValue('isa.generalExemptionKrw',2_000_000);
    return { type:'ISA', normalRate:rate, exempt, label:`ISA, ${(rate*100).toFixed(1)}%` };
  }
  if (a.includes('연금') || a.includes('IRP')) {
    return { type:'연금', normalRate:0, exempt:Infinity, label:'연금, 과세이연' };
  }
  const rate=_taxRuleValue('dividend.generalWithholdingCombinedRate',0.154);
  return { type:'일반', normalRate:rate, exempt:0, label:`일반, ${(rate*100).toFixed(1)}%` };
}

// 계좌별 배당세 계산의 단일 엔진.
// ISA 비과세 한도는 종목별이 아니라 소유주별 연간 ISA 배당 합계에 한 번만 적용한다.
function allocateDividendTax(entries, comprehensiveThreshold=_taxRuleValue('dividend.comprehensiveIncomeThresholdKrw',20_000_000)) {
  const list=(entries||[]).map(e=>({
    ...e,
    owner:e.owner||'미지정',
    gross:Number(e.gross)||0,
    info:getAccountDivTaxInfo(e.acc),
    tax:0,
    net:Number(e.gross)||0
  }));
  const isaByOwner={};
  list.forEach(e=>{
    if(e.info.type==='ISA') isaByOwner[e.owner]=(isaByOwner[e.owner]||0)+e.gross;
  });
  const isaTaxByOwner={};
  Object.entries(isaByOwner).forEach(([owner,gross])=>{
    const info=getAccountDivTaxInfo('ISA');
    isaTaxByOwner[owner]=Math.max(0,gross-(info.exempt||0))*(info.normalRate||0);
  });
  list.forEach(e=>{
    if(e.info.type==='연금') e.tax=0;
    else if(e.info.type==='ISA') {
      const ownerGross=isaByOwner[e.owner]||0;
      e.tax=ownerGross>0?(isaTaxByOwner[e.owner]||0)*(e.gross/ownerGross):0;
    } else e.tax=e.gross*(e.info.normalRate||0);
    e.net=e.gross-e.tax;
  });
  const owners={};
  list.forEach(e=>{
    const row=owners[e.owner]||(owners[e.owner]={owner:e.owner,gross:0,net:0,tax:0,general:0,isa:0,pension:0});
    row.gross+=e.gross; row.net+=e.net; row.tax+=e.tax;
    if(e.info.type==='ISA') row.isa+=e.gross;
    else if(e.info.type==='연금') row.pension+=e.gross;
    else row.general+=e.gross;
  });
  Object.values(owners).forEach(row=>{
    row.comprehensiveBase=row.general;
    row.comprehensivePct=comprehensiveThreshold>0?row.general/comprehensiveThreshold*100:0;
    row.comprehensiveOver=Math.max(0,row.general-comprehensiveThreshold);
  });
  return {list,owners:Object.values(owners).sort((a,b)=>b.gross-a.gross)};
}

// 배당 주기명 → 기본 지급월 배열 (0-based month index)
//  월배당 → 매월, 분기 → 3/6/9/12월 말, 반기 → 6/12월 말, 연간 → 12월
function _defaultMonthsForCycle(cycle) {
  const c = String(cycle || '').trim();
  if (c === '월배당' || c === 'monthly') return [0,1,2,3,4,5,6,7,8,9,10,11];
  if (c === '반기' || c === '반기배당' || c === 'semi') return [5, 11];
  if (c === '연간' || c === '연배당' || c === 'annual' || c === 'yearly') return [11];
  if (c === '분기' || c === '분기배당' || c === 'quarterly') return [2,5,8,11];
  return null; // 미상
}

function syncDivHistory() {
  const YEARS = divHistoryYears();
  YEARS.forEach(y=>{
    if(!divHistory[y]) divHistory[y]={};
    ALL_OWNERS.forEach(o=>{
      divHistory[y][o]=Array(12).fill(0);
    });
  });
  // ── 1회 지급 배당금(eps) 계산 helper ─────────────────
  //   eps 가 없으면 yld (%) × 현재가 / cycle 횟수 로 보조 계산
  function _perPayoutEps(info, item) {
    if (!info) return 0;
    if (info.eps && info.eps > 0) return info.eps;
    const yldNum = (typeof info.yldNum === 'number') ? info.yldNum : (parseFloat(String(info.yld||'').replace('%',''))||0);
    if (yldNum <= 0) return 0;
    const cycleN = CYCLE_COUNT[info.cycle||'-']||1;
    const refPrice = (item && item.curP > 0) ? item.curP : 0;
    if (refPrice <= 0) return 0;
    return refPrice * yldNum / 100 / cycleN;
  }

  // 세전 합계(divHistoryGross)는 읽는 곳이 없어 만들지 않는다 — 세전·세후는 화면이 세금 엔진 결과에서 직접 구한다.
  // 연간 세전 배당을 공통 세금 엔진에 한 번 모은 뒤 월별 세후 금액으로 배분한다.
  // 이 과정을 종목별 루프 안에서 처리하면 ISA 200만원 공제가 종목 수만큼 중복된다.
  const taxEntries=[];
  pfolioData.forEach((item,itemIndex)=>{
    if(item.grp!=='주식'||item.qty<=0) return;
    const tkr6 = normDivTkr(item.tkr);
    const cached = window._divDataCache[tkr6] || window._divDataCache[item.tkr];
    const info = cached || DIV_INFO_DB[tkr6] || DIV_INFO_DB[item.tkr];
    if (!info) return;
    const epsVal = _perPayoutEps(info, item);
    if (epsVal <= 0) return;
    let months = (Array.isArray(info.months) && info.months.length) ? info.months : _defaultMonthsForCycle(info.cycle);
    if (!months) months = [2,5,8,11];
    const payout = item.qty * epsVal * (RATES[info.cur||item.cur]||1);
    taxEntries.push({
      owner:item.owner,
      acc:item.acc,
      gross:payout*months.length,
      ref:{itemIndex,payout,months}
    });
  });
  const taxed=allocateDividendTax(taxEntries);
  YEARS.forEach(y=>{
    taxed.list.forEach(entry=>{
      const payout=entry.ref.payout;
      const months=entry.ref.months;
      const netRatio=entry.gross>0?entry.net/entry.gross:1;
      months.forEach(m=>{
        if(m<0||m>=12) return;
        const netPayout=payout*netRatio;
        divHistory[y][entry.owner][m]+=netPayout;
        divHistory[y]['전체'][m]+=netPayout;
      });
    });
  });
}
syncDivHistory();

// 배당 데이터 API 조회 (일 1회 캐시)
//   - api/price.ts 경유 (내부적으로 pykrx / Yahoo Finance 호출)
//   - API 결과에 dps/yld/cycle/months 가 포함되어 반환되므로 연간 eps 를
//     cycle 에 맞게 분할해 저장한다.
//   - eps 가 누락되었어도 yld 만으로 연 배당금 추정이 가능하면 보조로 저장.
function _setDivFetchCoverage(tickers, verified, status, error='') {
  const all = [...new Set((tickers||[]).map(t=>String(t||'').toUpperCase().replace(/\.(KS|KQ|T)$/,'')).filter(Boolean))];
  const done = new Set((verified||[]).map(t=>String(t||'').toUpperCase().replace(/\.(KS|KQ|T)$/,'')).filter(Boolean));
  window._divFetchCoverage = {
    date:_cfLocalDateKey(new Date()),
    total:all.length,
    verified:all.filter(t=>done.has(t)),
    missing:all.filter(t=>!done.has(t)),
    status,
    error:String(error||''),
  };
  return window._divFetchCoverage;
}
// 배당 관리(cbVerifyDividendDataOnOpen)와 홈 종목 요약이
// 각자 페이지 진입 때 이 조회를 부른다. 두 화면을 빠르게 오가면 같은 요청이 중복으로 나가고,
// 나중 호출이 맨 앞에서 찍는 'pending' 이 먼저 끝난 호출의 완료 상태를 덮어써 화면의
// "배당 데이터 확인 중" 배너가 깜빡인다. → 진행 중인 조회를 재사용한다.
let _divFetchInFlight = null;
function fetchDivData(force=false) {
  // 강제 갱신(수동 새로고침)은 실제로 네트워크를 다시 타야 하므로 재사용하지 않고
  // 진행 중인 조회가 끝난 뒤에 이어 붙인다 — 같은 캐시 키를 두 흐름이 동시에 쓰지 않게.
  if (_divFetchInFlight && !force) return _divFetchInFlight;
  const prev = _divFetchInFlight;
  // 정리(finally)는 반드시 반환하는 프라미스 체인 '안'에 있어야 한다. 밖에서 정리하면
  // 호출자가 await 에서 깨어나는 시점에 아직 in-flight 로 남아, 바로 뒤에 종목을 추가하고
  // 다시 부른 조회가 지난 결과를 그대로 돌려받아 신규 종목이 영영 조회되지 않는다.
  const task = (prev ? prev.catch(()=>null) : Promise.resolve())
    .then(()=>_fetchDivDataOnce(force))
    .finally(()=>{ if (_divFetchInFlight===task) _divFetchInFlight = null; });
  _divFetchInFlight = task;
  return task;
}
async function _fetchDivDataOnce(force=false) {
  const today = _cfLocalDateKey(new Date());
  const cacheKey = 'divCache_' + today;
  const verifiedKey = 'divCacheTickers_' + today;
  const verifiedVersionKey = 'divCacheVerifiedVersion_' + today;
  const tickers = [...new Set(
    pfolioData.filter(i=>i.grp==='주식'&&i.qty>0)
      // 국내 suffix는 서버가 자동 보정하고, 일본 .T는 Yahoo 조회에 필요하므로 유지한다.
      .map(i=>String(i.tkr||'').toUpperCase().replace(/\.(KS|KQ)$/,''))
      .filter(Boolean)
  )];
  _setDivFetchCoverage(tickers, [], tickers.length?'pending':'complete');
  if (!tickers.length) return {ok:true,skipped:true,detail:'조회할 주식 자산 없음'};
  const cached = localStorage.getItem(cacheKey);
  if (cached&&!force) {
    try {
      const verified = JSON.parse(localStorage.getItem(verifiedKey) || '[]');
      // 무배당 종목은 결과 캐시에 키가 생기지 않으므로, 실제 요청을 마친 티커 목록을
      // 별도로 보관해 "새 보유 종목이 추가됐는지"까지 페이지 진입 때마다 검증한다.
      if (localStorage.getItem(verifiedVersionKey)==='2' && Array.isArray(verified) && tickers.every(t=>verified.includes(t))) {
        const parsed = JSON.parse(cached);
        // 화면의 cbStrip 규칙과 맞춰 일본 상장 .T도 캐시 키에서는 제거한다.
        window._divDataCache = Object.fromEntries(Object.entries(parsed||{}).map(
          ([t,d])=>[String(t).toUpperCase().replace(/\.(KS|KQ|T)$/,''),d]
        ));
        _setDivFetchCoverage(tickers, verified, 'complete');
        syncDivHistory();
        return {ok:true,cached:true,count:Object.keys(window._divDataCache).length};
      }
    } catch(e) {}
  }

  try {
    // 서버 티커 상한(MAX_TICKERS)을 넘으면 요청 전체가 거부되므로 청크로 나눠 병합한다.
    const chunks = _chunkTickers(tickers);
    const mergedResult = {};
    const verifiedTickers = [];   // 실제로 응답을 받은 티커만 기록 (아래 캐시 갱신에 사용)
    let failedChunks = 0, lastChunkError = null;
    for (const chunk of chunks) {
      const _divFetch = fetchTimeout(20000);
      try {
        const resp = await authFetch('/api/price?type=dividend&tickers='+chunk.join(','), { signal: _divFetch.signal });
        if (!resp.ok) throw new Error(`배당 데이터 HTTP ${resp.status}`);
        const data = await resp.json();
        if (!data.success || !data.result) throw new Error(data?.error||'배당 데이터 응답이 비어 있습니다.');
        Object.assign(mergedResult, data.result);
        const done=new Set((data.verifiedTickers||[]).map(t=>String(t).toUpperCase()));
        verifiedTickers.push(...chunk.filter(t=>done.has(t)));
        if(chunk.some(t=>!done.has(t))) {
          failedChunks++;
          lastChunkError=new Error('일부 종목의 배당 조회 실패');
        }
      } catch(err) {
        failedChunks++; lastChunkError = err;
        console.error('[fetchDivData chunk]', chunk.length+'개', err?.message);
      } finally { _divFetch.done(); }
    }
    if (!verifiedTickers.length) {
      const error=lastChunkError?.message||'배당 데이터 조회 실패';
      _setDivFetchCoverage(tickers, verifiedTickers, 'error', error);
      return {ok:false,error};
    }
    // 확인된 무배당만 직전 배당 캐시를 제거한다. 실패·미조회는 이전 값을 유지한다.
    verifiedTickers.forEach(t=>{
      const key=t.replace(/\.(KS|KQ|T)$/,'');
      if(!mergedResult[t]&&!mergedResult[key]) delete window._divDataCache[key];
    });
    for (const [tkr, d] of Object.entries(mergedResult)) {
      const cacheTkr = String(tkr).toUpperCase().replace(/\.(KS|KQ|T)$/,'');
      const existing = DIV_INFO_DB[tkr] || DIV_INFO_DB[cacheTkr] || {};
      if (!d || typeof d !== 'object') continue;
      const annualDps = Number(d.dps) || 0;
      const yld = Number(d.yld) || 0;
      const cycle = d.cycle || existing.cycle || '-';
      const months = (Array.isArray(d.months) && d.months.length) ? d.months : (existing.months || []);
      // 1회 지급액 = 연간 ÷ 실제로 나눌 지급 횟수. 주기를 모르면(네이버처럼 연간 배당만 온 경우) 화면이 쓸 기본 지급월 수로
      // 나눈다 — 1 로 나누고 기본 4개월에 배분하면 연간 배당이 4배로 잡힌다.
      const payMonths = months.length ? months : (_defaultMonthsForCycle(cycle) || [2,5,8,11]);
      const cycleN = cycle !== '-' && CYCLE_COUNT[cycle] ? CYCLE_COUNT[cycle] : payMonths.length;
      // 1회 지급 배당금 (eps) = 연간 DPS / cycle 횟수
      const epsPerPeriod = annualDps > 0 ? (annualDps / cycleN) : 0;

      // yld 또는 eps 중 하나라도 있으면 캐시에 저장
      if (epsPerPeriod > 0 || yld > 0) {
        window._divDataCache[cacheTkr] = {
          eps: epsPerPeriod,
          annualDps: annualDps,
          yld: yld.toFixed(2) + '%',
          yldNum: yld,
          cycle,
          months,
          cur: d.cur || existing.cur || 'USD',
          exDiv: existing.exDiv || '-',
          payDay: typeof d.payDay === 'number' ? d.payDay : (existing.payDay || null),
          // 서버가 쓴 출처(pykrx·yahoo·naver). 네이버는 연간 배당만 주므로 화면이 지급월이 추정임을 밝힌다.
          source: typeof d.source === 'string' ? d.source.slice(0, 16) : null,
        };
      }
    }
    localStorage.setItem(cacheKey, JSON.stringify(window._divDataCache));
    // 실패한 청크의 티커를 verified 로 적으면 다음 접속에서 조회 없이 넘어가 배당이 영영 비게 된다.
    localStorage.setItem(verifiedKey, JSON.stringify(verifiedTickers));
    localStorage.setItem(verifiedVersionKey, '2');
    syncDivHistory();
    resolvePendingDivDates();
    const count = Object.keys(window._divDataCache).length;
    if (failedChunks) {
      const error=`요청 ${chunks.length}건 중 ${failedChunks}건 실패 (${lastChunkError?.message||'원인 미상'})`;
      _setDivFetchCoverage(tickers, verifiedTickers, 'partial', error);
      return {ok:false,count,failedChunks,error};
    }
    _setDivFetchCoverage(tickers, verifiedTickers, 'complete');
    return {ok:true,count};
  } catch(e) {
    console.error('[fetchDivData]', e);
    const error=e?.message||'배당 데이터 조회 실패';
    _setDivFetchCoverage(tickers, [], 'error', error);
    return {ok:false,error};
  }
}

// 종목별 배당 raw 이력 (10년치) — YoC/CAGR/DRIP 위젯용
// 국내 .KS → .KQ 폴백을 포함하는 캐시 스키마. 버전 변경 시 기존 누락 캐시를 한 번 갱신한다.
const DIV_HIST_CACHE_VERSION = 3;
window._divHistoryRawCache = window._divHistoryRawCache || {};
async function fetchDividendHistory(force = false) {
  const tickers = [...new Set(
    pfolioData.filter(i => i.grp==='주식' && i.qty>0)
      .map(i => {
        const raw=String(i.tkr||'').toUpperCase();
        const base=raw.replace(/\.(KS|KQ)$/,'');
        if (/\.KQ$/.test(raw) || String(i.market||'').toUpperCase().includes('KOSDAQ')) return base+'.KQ';
        if (/\.KS$/.test(raw)) return base+'.KS';
        return raw;
      })
      .filter(Boolean)
  )];
  if (!tickers.length) return;
  // 7일 캐시
  if (!force) {
    try {
      const cached = localStorage.getItem('divHistRaw');
      if (cached) {
        const obj = JSON.parse(cached);
        const age = obj?.savedAt ? Date.now()-obj.savedAt : Infinity;
        const normalizedData = Object.fromEntries(Object.entries(obj?.data||{}).map(
          ([t,d])=>[String(t).toUpperCase().replace(/\.(KS|KQ|T)$/,''),d]
        ));
        const expectedDividendKeys = tickers
          .map(t=>String(t).toUpperCase().replace(/\.(KS|KQ|T)$/,''))
          .filter(t=>Number(window._divDataCache?.[t]?.annualDps)>0);
        const missingExpected = expectedDividendKeys.filter(t=>!Array.isArray(normalizedData[t]?.events)||!normalizedData[t].events.length);
        // 정상 캐시는 7일간 재사용한다. 배당 지급 종목인데 원본 이력이 빠진 경우만 하루 뒤 재검증한다.
        const missingRetryDue = missingExpected.length>0 && age>=86400000;
        if (obj && obj.version===DIV_HIST_CACHE_VERSION && age < 7*86400000 && obj.data
          && Array.isArray(obj.tickers) && tickers.every(t=>obj.tickers.includes(t)) && !missingRetryDue) {
          window._divHistoryRawCache = normalizedData;
          window._divHistoryCoverage={status:'complete',verified:tickers,missing:[]};
          return {ok:true,cached:true,count:tickers.length};
        }
      }
    } catch(e) {}
  }
  const verified = [];
  const failures = [];
  window._divHistoryCoverage = {status:'pending',verified:[],missing:tickers};
  for (const chunk of _chunkTickers(tickers)) {
    const request = fetchTimeout(25000);
    try {
      const resp = await authFetch('/api/price?type=dividend_history&tickers=' + chunk.join(','), { signal:request.signal });
      if (!resp.ok) throw new Error('배당 이력 HTTP '+resp.status);
      const data = await resp.json();
      if (!data.success || !data.result) throw new Error('배당 이력 응답 오류');
      // 빈 events도 성공한 무배당 이력이다. 실패한 티커의 직전 이력은 지우지 않는다.
      const done = new Set((data.verifiedTickers||[]).map(t=>String(t).toUpperCase()));
      chunk.forEach(t=>{
        const key=t.replace(/\.(KS|KQ|T)$/,'');
        const row=data.result[t]||data.result[key]||data.result[t.replace(/\.(KS|KQ)$/,'')];
        if (done.has(t) && row && Array.isArray(row.events)) {
          window._divHistoryRawCache[key]=row;
          verified.push(t);
        } else failures.push(t);
      });
    } catch(e) {
      failures.push(...chunk);
      console.warn('[fetchDividendHistory]',e);
    } finally { request.done(); }
  }
  const status=failures.length?(verified.length?'partial':'error'):'complete';
  window._divHistoryCoverage={status,verified,missing:failures};
  // 캐시의 tickers는 성공한 목록만 담는다. 부분 실패를 7일짜리 성공으로 캐시하지 않는다.
  if(verified.length) try { localStorage.setItem('divHistRaw',JSON.stringify({version:DIV_HIST_CACHE_VERSION,savedAt:Date.now(),tickers:verified,data:window._divHistoryRawCache})); } catch(e) {}
  return {ok:failures.length===0,count:verified.length,failed:failures.length};
}
