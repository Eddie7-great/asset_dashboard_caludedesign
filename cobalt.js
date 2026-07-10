// =====================================================================
// cobalt.js — Claude Design "Cobalt Portfolio v2" 시안 8페이지 구현
// script.js(데이터 엔진)를 그대로 사용하고, 시안 레이아웃으로 렌더링한다.
// 페이지: 대시보드 / 성과 비교 / 가족 자산 / 리스크 진단 / 배당 관리
//        / 증여 플랜 / 양도소득세 / DCA 자동매수
// =====================================================================

/* global pfolioData, RATES, OWNERS, ownerColors, monthlyPLData, benchData,
   _gicsSector, _divpAggregateByYear, _divpComputeCagr, loadMonthlyPL,
   saveMonthlyPL, saveAssetsToKV, loadAssetsFromKV, saveExtDataToKV, cssVar,
   openAddModal, editItem, closeSidebar, fetchDivData, fetchDividendHistory,
   switchView, changeOwner, updateBenchmark, setTheme, isMobileLayout, authFetch */

// ───────────────────────── 상태 ─────────────────────────
// 평가금액 표시 통화는 KRW 고정 (표시 통화 선택 UI 제거됨).
// 매수 단가·현재가 등 종목 단위 가격은 cbFmtNative로 해당 종목 통화(USD/JPY/KRW) 그대로 노출한다.
const _dispCur = 'KRW';
let _cobaltActive = null;
let _cdashQ = '', _cdashSel = null;
let _cdashOwner = '전체';      // 대시보드 소유주 필터 ('전체' 또는 소유주명)
let _cdashAllocOpen = null;   // 자산 배분 펼침 자산군 키 (재클릭 시 닫힘)
let _cdashSecOpen = null;     // 섹터 집중도 펼침 섹터 라벨 (재클릭 시 닫힘)
let _cdashSecList = [];       // 렌더 시점 섹터 라벨 목록 (onclick 인덱스 → 라벨 해석용)
let _famKey = 'all', _famQ = '';
let _cbDivHistRequested = false;
let _cbDivOwner = '전체';      // 배당 관리 소유주 필터
let _cbDivYear = null;         // 배당 캘린더 조회 연도 (null=올해)
let _cbPerfTf = '1Y';         // 성과 비교 선택 기간 (5D/1M/3M/6M/YTD/1Y)
let _cbPerfSel = null;        // 성과 비교 강조 대상 (소유주/벤치마크 키, null=전체 표시)
const CB_PERF_TFS = ['5D','1M','3M','6M','YTD','1Y'];
const CB_PERF_TF_LABEL = { '5D':'최근 5일','1M':'최근 1개월','3M':'최근 3개월','6M':'최근 6개월','YTD':'연초 이후','1Y':'최근 1년' };

// ───────────────────────── 상수 (시안 팔레트) ─────────────────────────
const CB_CLS = {
  crypto:{label:'가상화폐', color:'#f2a33c'},
  us:    {label:'미국 주식', color:'#5b9bff'},
  kr:    {label:'한국 주식', color:'#4ecdc4'},
  jp:    {label:'일본 주식', color:'#c084fc'},
  gold:  {label:'금',       color:'#d4b24a'},
  cash:  {label:'현금',     color:'#56c596'},
};
const CB_VOL = { crypto:0.65, us:0.22, kr:0.26, jp:0.20, gold:0.15, cash:0 };
const CB_SEC_PALETTE = ['#5b9bff','#c084fc','#f2a33c','#4ecdc4','#fb7185','#8bd3ac','#94a3c8','#e8875a','#d4b24a','#56c596','#b48ead','#7aa2ff'];

const CB_VIEWS  = { cdash:cbRenderDash, perf2:cbRenderPerf, fam2:cbRenderFam, risk2:cbRenderRisk, divm:cbRenderDiv, gift2:cbRenderGift, tax2:cbRenderTax, dca2:cbRenderDca };
const CB_TITLES = { cdash:'대시보드', perf2:'성과 비교', fam2:'가족 자산', risk2:'리스크 진단', divm:'배당 관리', gift2:'증여 플랜', tax2:'양도소득세', dca2:'DCA 자동매수' };

// ───────────────────────── 헬퍼 ─────────────────────────
function cbStrip(t){ return String(t||'').toUpperCase().replace(/\.(KS|KQ|T)$/,''); }
function cbCls(i){
  if (i.grp === '가상화폐') return 'crypto';
  if (i.grp === '금') return 'gold';
  if (i.grp === '현금') return 'cash';
  if (i.cur === 'JPY') return 'jp';
  if (i.cur === 'USD') return 'us';
  return 'kr';
}
function cbRate(cur){ return RATES[cur] != null ? RATES[cur] : 1; }
// 가상화폐(cur=USD)는 현재가(curP)는 USD, 평단가(avgP)는 KRW(>=1000만) 또는 USD(<1000만)로 저장된다.
// (script.js 대시보드 계산과 동일한 임계값 규칙) → 종목통화(USD) 기준 평단가로 정규화해 손익·표시를 일치시킨다.
function cbAvgNative(i){
  if (i.grp==='가상화폐' && i.cur==='USD' && i.avgP>0 && i.avgP>=10000000) return i.avgP / cbRate('USD');
  return i.avgP||0;
}
function cbValKRW(i){ return (i.qty||0) * (i.curP||0) * cbRate(i.cur); }
function cbCostKRW(i){ return (i.qty||0) * cbAvgNative(i) * cbRate(i.cur); }
function cbGainKRW(i){ return i.grp==='현금' ? 0 : cbValKRW(i) - cbCostKRW(i); }

function cbDisp(vKrw){
  const c = _dispCur, v = vKrw / cbRate(c);
  const s = c==='USD' ? '$' : c==='KRW' ? '₩' : '¥';
  return (v<0?'-':'') + s + Math.abs(Math.round(v)).toLocaleString(c==='USD'?'en-US':'ko-KR');
}
function cbSignDisp(vKrw){ return (vKrw>=0?'+':'') + cbDisp(vKrw); }
function cbKrw(n){ return (n<0?'-':'') + '₩' + Math.abs(Math.round(n)).toLocaleString('ko-KR'); }
function cbManwon(n){ return Math.round(n/10000).toLocaleString('ko-KR') + '만원'; }
function cbPct(r){ return (r>=0?'+':'') + (r*100).toFixed(Math.abs(r)<0.1?2:1) + '%'; }
function cbFmtNative(n, cur){
  if (cur==='USD') return '$' + Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
  if (cur==='JPY') return '¥' + Math.round(n).toLocaleString('ja-JP');
  return '₩' + Math.round(n).toLocaleString('ko-KR');
}
function cbEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function cbUpDn(v){ return 'color:' + (v>=0 ? 'var(--up)' : 'var(--dn)'); }
function cbOwnerColor(o){ return (typeof ownerColors!=='undefined' && ownerColors[o]) || '#8a97b0'; }

// 배당 정보 (script.js의 _divDataCache 사용)
function cbDivOf(i){
  const c = (window._divDataCache || {})[cbStrip(i.tkr)];
  if (!c || !(Number(c.annualDps) > 0)) return null;
  return c; // {eps, annualDps, yldNum, yld, cycle, months(0-index), cur, exDiv}
}
function cbDivIncomeKRW(i){
  const d = cbDivOf(i); if (!d) return 0;
  return d.annualDps * (i.qty||0) * cbRate(d.cur || i.cur);
}
function cbDivGrowth(i){
  try{
    const raw = (window._divHistoryRawCache || {})[cbStrip(i.tkr)];
    if (!raw || !Array.isArray(raw.events) || !raw.events.length) return null;
    const annualMap = _divpAggregateByYear(raw.events);
    const r = _divpComputeCagr(annualMap);
    if (r.cagr5 != null) return r.cagr5;
    if (r.cagr3 != null) return r.cagr3;
    // 표준 3/5년 구간이 비어 있어도(이력이 짧거나 특정 연도 누락) 확보된 완결연도 전 구간으로 CAGR 추정
    const curY = new Date().getFullYear();
    const yrs = Object.keys(annualMap).map(Number)
      .filter(y => y < curY && annualMap[String(y)] > 0).sort((a,b)=>a-b);
    if (yrs.length >= 2){
      const y0 = yrs[0], y1 = yrs[yrs.length-1];
      const v0 = annualMap[String(y0)], v1 = annualMap[String(y1)];
      if (v0 > 0 && y1 > y0) return (Math.pow(v1/v0, 1/(y1-y0)) - 1) * 100;
    }
    return null;
  }catch(e){ return null; }
}
function cbEnsureDivHist(){
  if (_cbDivHistRequested) return;
  _cbDivHistRequested = true;
  try{ if (typeof fetchDividendHistory === 'function') fetchDividendHistory().then(()=>cbRerender()).catch(()=>{}); }catch(e){}
}

// 종목 행 공통 뷰모델
// 표기 원칙(요구사항): 종목명은 볼드(=title), 티커는 작게(=subTitle). 통화 배지는 표기하지 않는다.
function cbRow(i, idx){
  const cls = cbCls(i), cl = CB_CLS[cls];
  const name = i.name || i.tkr || '?';
  const tkr = cbStrip(i.tkr);
  const qtyFmt = i.grp==='현금' ? '예수금'
    : (Number(i.qty||0).toLocaleString(undefined,{maximumFractionDigits:4}) + (i.unit || '주'));
  const val = cbValKRW(i), cost = cbCostKRW(i), gain = cbGainKRW(i);
  const subTkr = (i.grp==='현금') ? '' : tkr;
  return {
    i, idx, cls, cl,
    title: name,               // 볼드 = 종목명 (정렬·검색 공통 키)
    name, tkr,
    subTitle: subTkr,          // 작은 글씨 = 티커
    sub: (subTkr ? subTkr + ' · ' : '') + qtyFmt,
    chip: (cls==='kr'||cls==='jp'||i.grp==='금'||i.grp==='현금')
      ? String(name).slice(0,2) : String(i.tkr||name||'?').slice(0,4),
    val, cost, gain,
    gainPct: (i.grp!=='현금' && cost>0) ? gain/cost : null,
  };
}
function cbAllRows(){ return (pfolioData||[]).filter(i=>(i.qty||0)>0).map((i,idx)=>cbRow(i,idx)).sort((a,b)=>b.val-a.val); }

// 상장 국가 국기(또는 자산군 아이콘) — 내역의 티커 박스를 대체한다.
// 주식은 상장 시장(KR/US/JP) 국기, 그 외 자산군은 자산군 색 아이콘.
function cbFlagMarket(cls){ return cls==='kr' ? 'KR' : cls==='jp' ? 'JP' : cls==='us' ? 'US' : null; }
function cbFlagSvg(r, h){
  h = h || 16;
  const mkt = cbFlagMarket(r.cls);
  if (mkt && typeof _mktFlagSvg==='function') return _mktFlagSvg(mkt, h);
  const icon = { crypto:{c:CB_CLS.crypto.color,t:'₿'}, gold:{c:CB_CLS.gold.color,t:'Au'}, cash:{c:CB_CLS.cash.color,t:'₩'} }[r.cls]
    || { c:(r.cl&&r.cl.color)||'#8a97b0', t:'•' };
  const w = Math.round(h*1.5);
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${w}px;height:${h}px;border-radius:3px;font-size:${Math.round(h*0.66)}px;font-weight:800;background:${icon.c}22;color:${icon.c};vertical-align:-2px">${icon.t}</span>`;
}
// 국기 슬롯(고정폭, 세로 중앙) — 표 행 좌측 아이콘 칸
function cbFlagCell(r, slot, h){
  return `<span style="width:${slot||30}px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">${cbFlagSvg(r, h||16)}</span>`;
}

// 동일 소유주 + 동일 종목(다계좌)을 한 행으로 합산 (대시보드 내역·상세 공통)
// 가중 평단가는 KRW 총원가 ÷ (합산수량 × 환율)로 역산해 종목 통화 기준으로 되돌린다.
function cbMergeRows(rows){
  const m = new Map();
  rows.forEach(r=>{
    const key = (r.i.owner||'') + '::' + cbStrip(r.i.tkr) + '::' + r.cls;
    if (m.has(key)){
      const g = m.get(key);
      g.qty += (r.i.qty||0); g.val += r.val; g.cost += r.cost; g.gain += r.gain;
      g._items.push(r.i); if (r.i.acc) g.accts.add(r.i.acc);
    } else {
      m.set(key, { key, i:r.i, idx:r.idx, cls:r.cls, cl:r.cl, title:r.title, name:r.name,
        tkr:r.tkr, subTitle:r.subTitle, chip:r.chip,
        qty:(r.i.qty||0), val:r.val, cost:r.cost, gain:r.gain,
        _items:[r.i], accts:new Set(r.i.acc?[r.i.acc]:[]) });
    }
  });
  return Array.from(m.values()).map(g=>{
    const rate = cbRate(g.i.cur);
    return { ...g,
      merged: g._items.length>1,
      acctList: Array.from(g.accts),
      gainPct: (g.i.grp!=='현금' && g.cost>0) ? g.gain/g.cost : null,
      avgNative: (g.qty>0 && rate>0) ? g.cost/(g.qty*rate) : cbAvgNative(g.i),
    };
  });
}

// 보유 자산 내역 공통 정렬: 소유주 → 자산군 → 국가 → 종목명 오름차순 (대시보드·가족 자산 등 전 페이지 공통)
function cbCtryLabel(r){ return r.cls==='kr' ? '한국' : r.cls==='us' ? '미국' : r.cls==='jp' ? '일본' : ''; }
function cbSortOwnerNameVal(rows){
  const oi = o => { const k = OWNERS.indexOf(o); return k<0 ? 99 : k; };
  return rows.slice().sort((a,b)=>
    (oi(a.i.owner) - oi(b.i.owner))
    || String(a.i.grp||'').localeCompare(String(b.i.grp||''), 'ko')
    || cbCtryLabel(a).localeCompare(cbCtryLabel(b), 'ko')
    || String(a.title||'').localeCompare(String(b.title||''), 'ko'));
}

// 페이지 소제목(작은 글씨)·페이지 컨트롤을 글로벌 헤더(메인 제목 옆)로 올린다.
// sub/widgets 모두 null 이면 헤더 부속 요소를 비활성화(레거시 뷰 전환 시).
function cbSetHead(sub, widgets){
  const s = document.getElementById('main-title-sub');
  if (s) s.innerHTML = sub || '';
  const w = document.getElementById('cb-head-widgets');
  if (w){ w.innerHTML = widgets || ''; w.style.display = (sub==null && widgets==null) ? 'none' : 'flex'; }
}
// 소유주 필터 버튼 행 (전체 + 소유주 4인). onclick 은 소유주명을 인자로 받는 전역 함수명.
function cbOwnerBtns(current, fnName){
  return `<div class="owner-tabs" style="display:inline-flex;gap:3px;flex-wrap:wrap">
    ${['전체', ...OWNERS].map(o=>`<button class="owner-btn${String(current)===o?' active':''}" onclick="${fnName}('${cbEsc(o)}')">${cbEsc(o)}</button>`).join('')}
  </div>`;
}

// 섹터 집계 (주식 기준. includeCrypto=true면 가상화폐를 'Crypto'로 별도 분류해 포함)
function cbSectors(includeCrypto, ownerFilter){
  const eq = (pfolioData||[]).filter(i=>(i.grp==='주식' || (includeCrypto && i.grp==='가상화폐')) && (i.qty||0)>0
    && (!ownerFilter || i.owner===ownerFilter));
  const totals = {}; let total = 0;
  eq.forEach(i=>{ const v = cbValKRW(i); if(v<=0) return;
    const s = i.grp==='가상화폐' ? 'Crypto'
      : ((typeof _gicsSector==='function' ? _gicsSector(i) : '기타') || '기타');
    totals[s] = (totals[s]||0) + v; total += v; });
  const list = Object.keys(totals).map(s=>({label:s, v:totals[s], pct:total? totals[s]/total*100 : 0}))
    .sort((a,b)=>b.v-a.v);
  let n=0; // Crypto는 자산군 고정색, 나머지 섹터만 팔레트 순번 배정
  list.forEach(s=>{ s.color = s.label==='Crypto' ? CB_CLS.crypto.color : CB_SEC_PALETTE[(n++) % CB_SEC_PALETTE.length]; });
  return { list, total };
}

// ───────────────────────── ETF 룩스루 (구성종목 합산) ─────────────────────────
// /api/dashboard?type=etf_holdings 로 보유 ETF의 구성종목·비중을 조회해
// "직접 보유 + ETF를 통한 간접 보유"를 합산한 실질 종목 비중을 계산한다.
// 개별 주식으로 직접 보유하지 않은 구성종목은 계산하지 않는다(요구사항).
let _cbEtfFetching = false;

// 대표 ETF 구성종목 비중(%) 내장 폴백표 — funetf.co.kr 공시 상위 편입 비중 기준으로 재확인해 유지한다.
// 실시간 조회(pykrx PDF / yfinance)가 실패한 "미조회 ETF"에 대해,
// 소유주가 직접 보유한 개별 종목과 매칭시켜 룩스루 비중을 계산할 수 있도록 상위 편입 비중을 담아둔다.
// (지수 구성은 서서히 변하므로 상위권 근사치 — 실시간 조회가 성공하면 그 값이 우선한다.)
const CB_ETF_FALLBACK = {
  // Nasdaq-100 계열 (QQQ/QQQM 및 레버리지 QLD·TQQQ 는 동일 지수 바스켓 비중 사용)
  QQQ: [['NVDA',8.9],['AAPL',8.8],['MSFT',8.0],['AMZN',5.5],['AVGO',5.0],['META',4.8],['NFLX',3.1],['TSLA',3.0],['COST',2.7],['GOOGL',2.6],['GOOG',2.5],['PLTR',1.6],['AMD',1.5],['TMUS',1.6],['CSCO',1.5],['PEP',1.5],['LIN',1.4],['INTU',1.4],['QCOM',1.3],['ISRG',1.3],['AMGN',1.3],['BKNG',1.3],['TXN',1.2],['ADBE',1.2],['HON',1.1],['PANW',1.1],['MU',1.0],['ADP',0.9]],
  SPY: [['NVDA',7.3],['AAPL',6.6],['MSFT',6.3],['AMZN',3.9],['META',2.7],['AVGO',2.5],['GOOGL',2.1],['TSLA',1.9],['GOOG',1.7],['BRKB',1.6],['JPM',1.5],['LLY',1.2],['V',1.0],['XOM',1.0],['UNH',1.0],['NFLX',1.2],['MA',0.9],['COST',0.9],['WMT',0.9],['HD',0.8],['PG',0.8],['JNJ',0.8],['ABBV',0.8]],
  SCHD: [['CVX',4.3],['KO',4.1],['MRK',4.0],['ABBV',4.0],['AMGN',4.0],['HD',4.0],['PEP',3.9],['TXN',3.8],['CSCO',3.8],['VZ',3.7],['LMT',3.6],['BMY',3.4],['PFE',3.2],['BLK',3.1],['ADP',3.0]],
  DIA: [['GS',9.0],['MSFT',6.5],['CAT',6.0],['HD',5.8],['V',5.0],['UNH',4.8],['AMGN',4.5],['CRM',4.0],['MCD',4.0],['AXP',3.8],['TRV',3.4],['JPM',3.2],['HON',3.0],['AAPL',3.0],['IBM',3.0],['AMZN',2.8]],
  // KODEX 200 / KOSPI200 (069500) — 상위 편입 근사 비중
  '069500': [['005930',30.0],['000660',9.0],['373220',3.2],['207940',2.6],['005380',2.3],['035420',1.9],['105560',1.8],['068270',1.8],['000270',1.6],['055550',1.5],['012330',1.3],['051910',1.3],['006400',1.1],['028260',1.1],['035720',1.1]],
};
// QQQ 바스켓을 공유하는 지수 ETF (일반/레버리지/미니)
['QQQM','QLD','TQQQ'].forEach(t=>{ CB_ETF_FALLBACK[t] = CB_ETF_FALLBACK.QQQ; });
// S&P500 바스켓 공유 — SPYM은 SPDR Portfolio S&P500(구 SPLG)의 2025-10-31 변경 티커
['VOO','IVV','VTI','SPYM','SPLG'].forEach(t=>{ CB_ETF_FALLBACK[t] = CB_ETF_FALLBACK.SPY; });
// KOSPI200 TR 계열 — RISE 200TR(361580)·KODEX 200TR(278530)은 KOSPI200 바스켓 공유 (funetf.co.kr 편입 비중 확인)
['361580','278530'].forEach(t=>{ CB_ETF_FALLBACK[t] = CB_ETF_FALLBACK['069500']; });
function cbEtfFallback(strip){
  const f = CB_ETF_FALLBACK[strip]; if (!f) return null;
  return f.map(p=>({ tkr:p[0], name:p[0], weight:p[1] }));
}

function cbIsEtf(i){
  return i.grp==='주식' && typeof _gicsSector==='function' && /ETF$/.test(_gicsSector(i)||'');
}
function cbEtfCacheLoad(){
  if (window._etfHoldingsCache) return;
  const key = 'etfHold_' + new Date().toISOString().slice(0,10);
  let saved = {};
  try{ saved = JSON.parse(localStorage.getItem(key)||'{}') || {}; }catch(e){ saved = {}; }
  window._etfHoldingsCache = saved; // { STRIP: {holdings:[{tkr,name,weight}]} | null(조회 실패) }
}
function cbEtfCacheSave(){
  const key = 'etfHold_' + new Date().toISOString().slice(0,10);
  try{
    Object.keys(localStorage).forEach(k=>{ if(k.indexOf('etfHold_')===0 && k!==key) localStorage.removeItem(k); });
    // 성공 건만 영속화 — 일시 실패(null)는 세션 내에서만 기억해 다음 방문 때 재시도
    const ok = {};
    Object.keys(window._etfHoldingsCache||{}).forEach(s=>{ if(window._etfHoldingsCache[s]) ok[s]=window._etfHoldingsCache[s]; });
    localStorage.setItem(key, JSON.stringify(ok));
  }catch(e){}
}
async function cbEnsureEtfHoldings(){
  cbEtfCacheLoad();
  if (_cbEtfFetching) return;
  const need = [];
  (pfolioData||[]).forEach(i=>{
    if (!cbIsEtf(i) || !((i.qty||0)>0)) return;
    const s = cbStrip(i.tkr);
    if (s && window._etfHoldingsCache[s] === undefined && need.indexOf(s)<0) need.push(s);
  });
  if (!need.length) return;
  _cbEtfFetching = true;
  try{
    await Promise.all(need.map(async s=>{
      try{
        const r = await authFetch('/api/dashboard?type=etf_holdings&tkr=' + encodeURIComponent(s));
        const j = await r.json();
        window._etfHoldingsCache[s] = (j && j.success && Array.isArray(j.holdings) && j.holdings.length)
          ? { holdings: j.holdings } : null;
      }catch(e){ window._etfHoldingsCache[s] = null; }
    }));
    cbEtfCacheSave();
  } finally { _cbEtfFetching = false; }
  cbRerender();
}
function cbLookThrough(ownerF){
  cbEtfCacheLoad();
  const rows = cbAllRows().filter(r=>!ownerF || r.i.owner===ownerF);
  const nw = rows.reduce((s,r)=>s+r.val,0) || 1;
  // 직접 보유한 개별 종목 (주식만, ETF 제외) — 계좌/소유주가 달라도 티커로 합산
  const direct = new Map();
  rows.forEach(r=>{
    if (r.i.grp!=='주식' || cbIsEtf(r.i)) return;
    const s = cbStrip(r.i.tkr); if(!s) return;
    const d = direct.get(s) || { tkr:s, title:r.title, val:0, via:0, etfs:[] };
    d.val += r.val; direct.set(s, d);
  });
  let etfCount = 0, pending = false; const etfMiss = [], etfFallback = [];
  rows.forEach(r=>{
    if (!cbIsEtf(r.i)) return;
    etfCount++;
    const strip = cbStrip(r.i.tkr);
    const c = window._etfHoldingsCache[strip];
    // 실시간 조회 성공값 우선, 실패(null)/미도착(undefined) 시 내장 폴백표로 대체
    let holdings = (c && Array.isArray(c.holdings)) ? c.holdings : null;
    let isFallback = false;
    if (!holdings){
      const fb = cbEtfFallback(strip);
      if (fb){ holdings = fb; isFallback = true; }
      else if (c === undefined){ pending = true; return; }
      else { if(etfMiss.indexOf(r.title)<0) etfMiss.push(r.title); return; }
    }
    if (isFallback && etfFallback.indexOf(r.title)<0) etfFallback.push(r.title);
    holdings.forEach(h=>{
      const d = direct.get(cbStrip(h.tkr));
      if (!d) return; // 개별 보유가 없는 구성종목은 계산 제외
      const add = r.val * (Number(h.weight)||0) / 100;
      if (add<=0) return;
      d.via += add;
      // 같은 ETF를 여러 계좌/소유주가 보유해도 툴팁에는 한 항목으로 합산
      const ex = d.etfs.find(e=>e.etf===r.title && e.fb===isFallback);
      if (ex) ex.val += add;
      else d.etfs.push({ etf: r.title, w: Number(h.weight)||0, val: add, fb: isFallback });
    });
  });
  const list = Array.from(direct.values())
    .map(d=>({ ...d, tot:d.val+d.via, pct:(d.val+d.via)/nw*100, dPct:d.val/nw*100, vPct:d.via/nw*100 }))
    .sort((a,b)=>b.tot-a.tot);
  return { list, nw, etfCount, etfMiss, etfFallback, pending };
}

// 리스크 규칙 진단 (시안 로직 이식)
function cbRisk(ownerFilter){
  const rows = cbAllRows().filter(r=>!ownerFilter || r.i.owner===ownerFilter);
  const nw = rows.reduce((s,r)=>s+r.val,0) || 1;
  const byCls = {}; rows.forEach(r=>{ byCls[r.cls]=(byCls[r.cls]||0)+r.val; });
  const secs0 = cbSectors(false, ownerFilter).list;
  const pctOf = v => v/nw*100;
  const nonCash = rows.filter(r=>r.cls!=='cash');
  const top = nonCash[0];
  const topPct = top ? pctOf(top.val) : 0;
  const cryptoPct = pctOf(byCls.crypto||0), cashPct = pctOf(byCls.cash||0);
  const fxPct = pctOf(rows.filter(r=>r.i.cur && r.i.cur!=='KRW').reduce((s,r)=>s+r.val,0));
  const vol = rows.reduce((s,r)=>s+(r.val/nw)*(CB_VOL[r.cls]||0),0)*100;
  const secs = secs0;
  const topSec = secs[0] || {label:'—', pct:0};
  const clsCount = Object.keys(byCls).length;
  // 테마별 CSS 토큰을 실제 hex로 해석 — 라이트/다크/네이비 모두에서 가시성 확보 (+'26' 알파 결합 가능)
  const upC=(typeof cssVar==='function'?cssVar('--up','#178a52'):'#178a52'),
        wnC=(typeof cssVar==='function'?cssVar('--warn','#d97706'):'#d97706'),
        dnC=(typeof cssVar==='function'?cssVar('--dn','#cf3d5c'):'#cf3d5c');
  const mk=(title,val,valFmt,thWarn,thBad,msgs,invert)=>{
    let lvl=0;
    if(invert){ if(val<thBad) lvl=2; else if(val<thWarn) lvl=1; }
    else { if(val>thBad) lvl=2; else if(val>thWarn) lvl=1; }
    const color=[upC,wnC,dnC][lvl];
    return { title, valFmt, status:['양호','주의','경고'][lvl], color,
      fill: Math.max(4, Math.min(100, Math.round(invert ? Math.min(100, val/(thWarn*2)*100) : val))),
      msg: msgs[lvl], lvl };
  };
  const topName = top ? top.title : '—';
  const cards = [
    mk('단일 종목 집중도', topPct, topPct.toFixed(1)+'%', 20, 30,
      ['최대 종목 비중 20% 이하로 분산이 잘 되어 있습니다.','최대 종목 '+topName+' 비중이 20%를 넘습니다. 부분 익절을 고려하세요.','단일 종목 의존도가 30%를 초과합니다. 급락 시 타격이 큽니다.']),
    mk('가상화폐 비중', cryptoPct, cryptoPct.toFixed(1)+'%', 20, 35,
      ['가상화폐 비중이 관리 가능한 수준입니다.','가상화폐가 20%를 넘습니다. 일반 권고(5–15%)보다 높습니다.','가상화폐가 35%를 초과해 변동성을 지배합니다.']),
    mk('섹터 집중도', topSec.pct, Math.round(topSec.pct)+'%', 35, 50,
      ['주식 섹터 분산이 양호합니다.','최대 섹터 '+topSec.label+' 비중이 35%를 넘습니다.',topSec.label+' 편중이 50%를 초과합니다. 섹터 분산이 시급합니다.']),
    mk('추정 연 변동성', vol, vol.toFixed(1)+'%', 22, 32,
      ['전체 변동성이 균형 잡힌 범위입니다.','변동성이 다소 높습니다. 안전자산 확대를 검토하세요.','변동성이 매우 높습니다. 하락장 손실 폭이 클 수 있습니다.']),
    mk('현금 완충 비중', cashPct, cashPct.toFixed(1)+'%', 5, 3,
      ['비상 대응 가능한 현금을 확보하고 있습니다.','현금이 5% 미만입니다. 조정장 매수 여력이 제한적입니다.','현금 3% 미만 — 유동성 리스크가 있습니다.'], true),
    mk('환노출 (원화 기준)', fxPct, fxPct.toFixed(1)+'%', 60, 80,
      ['외화 노출이 적정 범위입니다.','자산의 60% 이상이 외화입니다. 환율 하락 리스크에 유의하세요.','외화 편중이 심합니다. 환헤지나 원화 자산 확대를 검토하세요.']),
    mk('자산군 분산', clsCount, clsCount+'개', 3, 2,
      [clsCount+'개 자산군에 분산되어 있습니다.','자산군이 3개 이하입니다. 분산 폭을 넓혀보세요.','자산군 다양성이 부족합니다.'], true),
  ];
  const score = Math.max(5, Math.min(98, 100 - cards.reduce((s,c)=>s+c.lvl*10,0)));
  return { score, grade: score>=75?'안정적':score>=50?'주의 필요':'고위험',
    color: score>=75?upC:score>=50?wnC:dnC,
    warns: cards.filter(c=>c.lvl>0).length,
    vol, fxPct, cashPct, cards };
}

// ───────────────────────── SVG 빌더 ─────────────────────────
function cbDonutSvg(segs, size, clickFn){
  const stroke=size*0.16, r=size/2-stroke/2, c=2*Math.PI*r; let off=0;
  let arcs='';
  (segs||[]).forEach(s=>{
    const len=c*s.pct/100;
    const click = (clickFn && s.key!=null) ? ` onclick="${clickFn}('${s.key}')" style="cursor:pointer"` : '';
    arcs+=`<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${stroke}" stroke-dasharray="${len} ${c-len}" stroke-dashoffset="${-off}"${click}></circle>`;
    off+=len;
  });
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" style="stroke:var(--grid)" stroke-width="${stroke}"></circle>${arcs}</svg>`;
}
function cbRingSvg(score, size, color){
  const stroke=10, r=size/2-stroke/2, c=2*Math.PI*r, len=c*score/100;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" style="stroke:var(--grid)" stroke-width="${stroke}"></circle>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${len} ${c-len}"></circle></svg>`;
}
// 라인 차트 플롯 영역 좌우 패딩 (Y축 라벨 공간) — hover 히트영역 계산에도 사용
const CB_LINE_PAD = { l: 48, r: 12 };
// Catmull-Rom → cubic bezier: 포인트를 지나는 부드러운 곡선 경로
function cbSmoothPath(pts){
  if (pts.length < 3) return 'M' + pts.map(p=>p.x.toFixed(1)+','+p.y.toFixed(1)).join(' L');
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i=0; i<pts.length-1; i++){
    const p0=pts[i-1]||pts[i], p1=pts[i], p2=pts[i+1], p3=pts[i+2]||p2;
    const c1x=p1.x+(p2.x-p0.x)/6, c1y=p1.y+(p2.y-p0.y)/6;
    const c2x=p2.x-(p3.x-p1.x)/6, c2y=p2.y-(p3.y-p1.y)/6;
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}
function cbMultiLineSvg(seriesArr, w, h){
  const valid = seriesArr.filter(s=>s.data.some(v=>v!=null));
  const all = valid.flatMap(s=>s.data).filter(v=>v!=null);
  if (!all.length) return `<div style="height:${h}px;display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:12px">벤치마크 데이터 로딩 중… (새로고침을 눌러주세요)</div>`;
  const mn=Math.min(...all,0), mx=Math.max(...all,0), padV=(mx-mn)*0.08||1;
  // Y축 세분화: nice-step 눈금 + 전 눈금 금액 라벨
  const step = cbNiceStep((mx-mn+padV*2)/6);
  const lo = Math.floor((mn-padV)/step)*step, hi = Math.ceil((mx+padV)/step)*step;
  const padL=CB_LINE_PAD.l, padR=CB_LINE_PAD.r, plotW=w-padL-padR;
  const y=v=>h-8-((v-lo)/(hi-lo))*(h-16);
  let out='';
  for (let v=lo; v<=hi+step*0.01; v+=step){
    const yy=y(v).toFixed(1);
    out+=`<line x1="${padL}" x2="${w-padR}" y1="${yy}" y2="${yy}" style="stroke:var(--grid)" stroke-width="1"></line>`;
    out+=`<text x="${padL-7}" y="${(y(v)+3.4).toFixed(1)}" style="fill:var(--lab)" font-size="10" text-anchor="end" font-family="IBM Plex Mono">${v>0?'+':''}${Number(v.toFixed(2))}%</text>`;
  }
  if (lo<0 && hi>0) out+=`<line x1="${padL}" x2="${w-padR}" y1="${y(0)}" y2="${y(0)}" style="stroke:var(--bd2)" stroke-width="1.3" stroke-dasharray="4 4"></line>`;
  valid.forEach(s=>{
    const pts=s.data.map((v,i)=>({v,i})).filter(p=>p.v!=null);
    if(pts.length<2) return;
    const dx=plotW/(s.data.length-1);
    const d=cbSmoothPath(pts.map(p=>({x:padL+p.i*dx, y:y(p.v)})));
    const dimmed = !!s.dim;
    const op = dimmed ? 0.16 : (s.bold ? 1 : 0.85);
    // 렌더 애니메이션: 실선은 드로잉, 점선(벤치마크)은 목표 불투명도까지 페이드 인
    const anim = s.dash ? `class="cb-line-fade" style="--o:${op}"` : 'class="cb-line-draw" pathLength="1"';
    out+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.bold?2.8:1.8}" stroke-linejoin="round" stroke-linecap="round" opacity="${op}" ${s.dash?'stroke-dasharray="5 5"':''} ${anim}></path>`;
  });
  return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block">${out}</svg>`;
}

// ───────────────────────── 페이지: 대시보드 ─────────────────────────
function cbRenderDash(){
  cbEnsureDivHist();
  const el = document.getElementById('cb-cdash'); if(!el) return;
  const ownerF = (_cdashOwner && _cdashOwner!=='전체') ? _cdashOwner : null;
  const rows = ownerF ? cbAllRows().filter(r=>r.i.owner===ownerF) : cbAllRows();
  const nw = rows.reduce((s,r)=>s+r.val,0);
  const gainAbs = rows.reduce((s,r)=>s+r.gain,0);
  const costTot = rows.reduce((s,r)=>s+r.cost,0) || 1;
  const divAnnual = rows.reduce((s,r)=>s+cbDivIncomeKRW(r.i),0);
  const risk = cbRisk(ownerF);

  // 자산 배분 (도넛/범례 클릭 → 해당 자산군 종목 펼침)
  const byCls={}; rows.forEach(r=>{ byCls[r.cls]=(byCls[r.cls]||0)+r.val; });
  const alloc = Object.keys(CB_CLS).filter(k=>byCls[k]).map(k=>({
    key:k, label:CB_CLS[k].label, color:CB_CLS[k].color, v:byCls[k],
    pct: nw? byCls[k]/nw*100 : 0 }));

  // 섹터 (가상화폐는 'Crypto'로 별도 분류해 비중 표기)
  const secs = cbSectors(true, ownerF).list.slice(0,8);
  _cdashSecList = secs.map(s=>s.label);
  const topSec = secs[0];
  const sectorNote = !topSec ? '주식·가상화폐 자산이 없습니다'
    : topSec.pct>=50 ? '⚠ '+topSec.label+' 편중이 심합니다 (50%+)'
    : topSec.pct>=35 ? topSec.label+' 비중이 높은 편입니다' : '섹터 분산이 양호합니다';

  // 펼침 목록 공통 행 (자산군/섹터 클릭 시 노출되는 종목)
  const miniRow = (r, baseV) => `
    <div style="display:flex;align-items:center;gap:8px;padding:4px 10px 4px 24px;font-size:11px">
      <span style="width:6px;height:6px;border-radius:50%;background:${cbOwnerColor(r.i.owner)};flex-shrink:0"></span>
      <span style="flex:1;min-width:0;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(r.title)} <span style="color:var(--dim)">· ${cbEsc(r.i.owner)}</span></span>
      <span style="font-weight:600;flex-shrink:0">${cbDisp(r.val)}</span>
      <span class="cb-num" style="width:46px;text-align:right;font-weight:700;color:var(--lab);flex-shrink:0">${baseV>0?(r.val/baseV*100).toFixed(1):'0.0'}%</span>
    </div>`;

  // 동일 소유주+종목(다계좌) 합산 → 검색 필터 → 정렬 (소유주 → 종목명 → 평가금액 오름차순)
  const mergedRows = cbMergeRows(rows);
  const q=(_cdashQ||'').trim().toLowerCase();
  const filtered = q ? mergedRows.filter(r=>((r.i.tkr||'')+' '+(r.i.name||'')+' '+r.cl.label+' '+(r.i.owner||'')).toLowerCase().includes(q)) : mergedRows;
  const held = cbSortOwnerNameVal(filtered);

  // 선택 종목 (소유주 필터로 사라진 선택은 첫 종목으로 대체) — 키는 소유주::티커::자산군
  const selValid = mergedRows.some(r=>r.key===_cdashSel);
  const sel = (selValid ? mergedRows.find(r=>r.key===_cdashSel) : null) || held[0] || null;
  if (sel) _cdashSel = sel.key;

  // 종목 상세 — 우측 세로 패널 (클릭한 종목 옆에 sticky 로 노출)
  let selPanel = '<div style="font-size:11.5px;color:var(--dim);text-align:center;padding:28px 8px">좌측 목록에서 종목을 클릭하면<br>상세 정보가 여기 표시됩니다.</div>';
  if (sel){
    const d = cbDivOf(sel.i);
    const g = cbDivGrowth(sel.i);
    const sector = sel.i.grp==='주식' ? (typeof _gicsSector==='function'? _gicsSector(sel.i):'—') : sel.cl.label;
    const yoc = (d && sel.avgNative>0 && sel.i.grp!=='가상화폐') ? ((d.annualDps/sel.avgNative)*100).toFixed(2) : null;
    const selDivKRW = d ? d.annualDps * sel.qty * cbRate(d.cur || sel.i.cur) : 0;
    const acctTxt = sel.acctList.length ? sel.acctList.join('+') : (sel.i.acc||'');
    const qtyTxt = sel.i.grp==='현금' ? '예수금'
      : Number(sel.qty||0).toLocaleString(undefined,{maximumFractionDigits:4}) + (sel.i.unit||'주');
    const divBox = d ? `
      <div style="display:flex;flex-direction:column;gap:5px;font-size:11.5px">
        <div style="display:flex;justify-content:space-between"><span style="color:var(--mut)">연간 배당수입</span><span style="font-weight:700;color:var(--up)">${cbDisp(selDivKRW)}</span></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--mut)"><span data-tip="현재 주가 대비 연간 배당금 비율">시가 수익률</span> / <span data-tip="Yield on Cost — 내 평단가 대비 연간 배당금 비율. 오래 보유할수록 높아집니다.">YoC</span></span><span style="font-weight:700">${(d.yldNum||0).toFixed(2)}% / ${yoc!=null?yoc+'%':'—'}</span></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--mut)"><span data-tip="최근 배당 이력 기준 주당 배당금의 연평균 성장률(CAGR)">배당성장률</span></span><span style="font-weight:700;${g!=null?cbUpDn(g):''}">${g!=null?(g>=0?'+':'')+g.toFixed(1)+'%':'—'}</span></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--mut)">주당 배당 · 주기</span><span class="cb-num" style="font-weight:700">${cbFmtNative(d.annualDps,d.cur||sel.i.cur)} · ${cbEsc(d.cycle||'—')}</span></div>
      </div>`
      : `<div style="font-size:11.5px;color:var(--mut);line-height:1.55">무배당 자산 — 수익은 가격 변동에서만 발생합니다.</div>`;
    const cell = (lab,val,style='',cls='') => `<div><div style="font-size:10px;color:var(--lab)">${lab}</div><div class="${cls}" style="font-size:14px;font-weight:700;margin-top:1px;${style}">${val}</div></div>`;
    selPanel = `
      <div style="display:flex;align-items:flex-start;gap:8px">
        <span style="flex-shrink:0;margin-top:1px">${cbFlagSvg(sel, 18)}</span>
        <div style="min-width:0">
          <div style="font-size:14px;font-weight:800;line-height:1.25">${cbEsc(sel.i.name||sel.i.tkr)}</div>
          <div style="font-size:10.5px;color:var(--lab);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(sel.tkr)} · ${sel.cl.label} · ${cbEsc(sel.i.owner)}${acctTxt?' · '+cbEsc(acctTxt):''}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 12px;margin-top:12px">
        ${cell('평가액', cbDisp(sel.val))}
        ${cell('평가손익', sel.i.grp==='현금'?'—':cbSignDisp(sel.gain), cbUpDn(sel.gain))}
        ${cell('보유수량', qtyTxt, 'font-size:12.5px', 'cb-num')}
        ${cell('<span data-tip="보유 수량 전체의 평균 매수 단가(가중평균)">평단가</span>', sel.i.grp==='현금'?'—':cbFmtNative(sel.avgNative,sel.i.cur), '', 'cb-num')}
        ${cell('현재가', sel.i.grp==='현금'?'—':cbFmtNative(sel.i.curP,sel.i.cur), '', 'cb-num')}
        ${cell('수익률', sel.gainPct==null?'—':cbPct(sel.gainPct), sel.gainPct==null?'color:var(--lab)':cbUpDn(sel.gainPct))}
        ${cell('섹터', cbEsc(sector), 'font-size:12.5px;font-weight:600')}
      </div>
      <div style="margin-top:13px;padding-top:11px;border-top:1px solid var(--bd)">
        <div style="font-size:10px;letter-spacing:.08em;color:var(--lab);margin-bottom:7px">배당 정보</div>${divBox}
      </div>`;
  }

  // 일일손익 — 전일 종가 대비 (시세 갱신 시 저장한 prevP/dayP 기반, 주식·가상화폐만)
  let dayAbs=0, dayBase=0;
  rows.forEach(r=>{ const i=r.i;
    if((i.grp==='주식'||i.grp==='가상화폐') && i.dayP!=null && i.prevP>0 && !i._priceStale){
      const rt=cbRate(i.cur); dayAbs+=(i.qty||0)*i.dayP*rt; dayBase+=(i.qty||0)*i.prevP*rt;
    }
  });

  // "가족 순자산 · 전일 종가 기준" 은 상단 메인 제목 옆으로 (툴팁은 헤더에서 아래로 펼쳐져 가려지지 않음)
  cbSetHead(`${ownerF?cbEsc(ownerF)+' 자산':'가족 순자산'} · <span data-tip="주식·가상화폐·금·현금 전체 평가액 합계. 전일 종가 및 최근 고시 환율 기준입니다.">전일 종가 기준</span>`);

  // 요약 배지 — 라벨(작은 글씨)이 옆 원화 금액의 세로 중앙에 오도록 inline-flex 정렬
  const badge=(lab,val,valStyle,bg,click)=>`<span ${click?`onclick="${click}" `:''}style="display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border-radius:16px;background:${bg};${click?'cursor:pointer':''}">
      <span style="font-size:10.5px;font-weight:600;color:var(--mut)">${lab}</span>
      <span style="font-size:12.5px;font-weight:700;${valStyle||''}">${val}</span></span>`;

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:34px;font-weight:800;letter-spacing:-.02em">${cbDisp(nw)}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${badge('<span data-tip="전일 종가 대비 오늘 하루 평가액 변동 (시세 연동된 주식·가상화폐 기준)">일일손익</span>',
          dayBase>0 ? cbSignDisp(dayAbs)+' · '+cbPct(dayAbs/dayBase) : '—',
          dayBase>0 ? cbUpDn(dayAbs) : 'color:var(--lab)', 'var(--upSoft)')}
        ${badge('<span data-tip="현재 평가액 − 총 매입원가">평가손익</span>', cbSignDisp(gainAbs)+' · '+cbPct(gainAbs/costTot), cbUpDn(gainAbs), 'var(--upSoft)')}
        ${badge('연 배당', cbDisp(divAnnual), 'color:var(--tx)', 'var(--accSoft)')}
        ${badge('리스크', risk.score+'점', 'color:var(--tx)', 'var(--accSoft)', "switchView('risk2',document.getElementById('menu-risk2'))")}
      </div>
      <div style="margin-left:auto">${cbOwnerBtns(_cdashOwner,'cbDashOwner')}</div>
    </div>

    <div style="display:flex;gap:12px;margin-top:14px;align-items:stretch;flex-wrap:wrap">
      <div class="cb-panel" style="flex:1;min-width:300px;padding:16px 18px">
        <div style="font-size:11px;letter-spacing:.08em;color:var(--lab);margin-bottom:10px">자산 배분 <span style="color:var(--dim)">· 차트/항목 클릭 시 종목 표시</span></div>
        <div style="display:flex;justify-content:center;margin:4px 0 14px">${cbDonutSvg(alloc,176,'cbDashAllocToggle')}</div>
        ${alloc.map(c=>{
          const open = _cdashAllocOpen===c.key;
          return `
          <div class="cb-hrow" onclick="cbDashAllocToggle('${c.key}')" style="display:flex;align-items:center;gap:9px;padding:6px 8px;cursor:pointer;font-size:12.5px;${open?'background:var(--accSoft)':''}">
            <span style="width:9px;height:9px;border-radius:2px;background:${c.color};flex-shrink:0"></span>
            <span style="flex:1;color:var(--mut)">${c.label}</span>
            <span class="cb-num" style="font-size:11px;color:var(--lab)">${cbDisp(c.v)}</span>
            <span style="width:52px;text-align:right;font-weight:700">${c.pct.toFixed(1)}%</span>
            <span style="width:11px;text-align:right;color:var(--dim);font-size:10px">${open?'▾':'▸'}</span>
          </div>
          ${open? rows.filter(r=>r.cls===c.key).map(r=>miniRow(r,c.v)).join('') : ''}`;
        }).join('')}
      </div>

      <div class="cb-panel" style="flex:1;min-width:300px;padding:16px 18px">
        <div style="font-size:11px;letter-spacing:.08em;color:var(--lab);margin-bottom:11px"><span data-tip="보유 주식을 섹터로 분류해 편중도를 점검합니다. 가상화폐는 Crypto로 별도 분류해 비중을 표기합니다.">섹터 집중도</span> <span style="color:var(--dim)">· 주식+가상화폐 · 막대 클릭 시 종목 표시</span></div>
        ${secs.map((s,n)=>{
          const open = _cdashSecOpen===s.label;
          const items = open ? rows.filter(r=> s.label==='Crypto' ? r.cls==='crypto'
            : (r.i.grp==='주식' && ((typeof _gicsSector==='function' ? _gicsSector(r.i) : '기타') || '기타')===s.label)) : [];
          return `
          <div class="cb-hrow" onclick="cbDashSecToggle(${n})" style="padding:6px 8px;cursor:pointer;${open?'background:var(--accSoft)':''}">
            <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;margin-bottom:5px">
              <span style="color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${cbEsc(s.label)} <span style="color:var(--dim);font-size:10px">${open?'▾':'▸'}</span></span>
              <span style="font-weight:700;flex-shrink:0">${s.pct.toFixed(1)}%</span>
            </div>
            <div style="height:8px;border-radius:4px;background:var(--inner);overflow:hidden"><div style="height:100%;border-radius:4px;background:${s.color};width:${Math.round(s.pct)}%"></div></div>
          </div>
          ${open? items.map(r=>miniRow(r,s.v)).join('') : ''}`;
        }).join('') || '<div style="font-size:11px;color:var(--dim)">주식·가상화폐 자산이 없습니다</div>'}
        <div style="font-size:10.5px;color:var(--dim);margin-top:8px;line-height:1.5">${sectorNote}</div>
      </div>
    </div>

    <div class="cb-dash-split" style="display:flex;gap:12px;margin-top:12px;align-items:flex-start">
      <div class="cb-panel" style="flex:1;min-width:0;padding:14px 16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;gap:8px;flex-wrap:wrap">
          <div style="font-size:10.5px;letter-spacing:.08em;color:var(--lab)">보유 자산 내역 · ${held.length}종목 <span style="color:var(--dim)">· 행 클릭 시 우측에 상세</span></div>
          <div style="display:flex;align-items:center;gap:7px;background:var(--inner);border:1px solid var(--bd2);border-radius:9px;padding:6px 11px;width:200px">
            <span style="color:var(--dim);font-size:12px">⌕</span>
            <input value="${cbEsc(_cdashQ)}" oninput="cbDashSearch(this.value)" placeholder="티커·종목명 검색…" style="background:transparent;border:none;color:var(--tx);font-family:'Noto Sans KR',sans-serif;font-size:12px;width:100%;outline:none" />
          </div>
        </div>
        <div style="overflow-x:auto"><div style="min-width:560px">
          <div style="display:flex;align-items:center;gap:8px;padding:0 9px 7px;border-bottom:1px solid var(--bd);font-size:10.5px;color:var(--dim)">
            <span style="width:28px;flex-shrink:0"></span>
            <span style="flex:1;min-width:0">종목</span>
            <span style="width:50px;text-align:right;flex-shrink:0">소유주</span>
            <span style="width:70px;text-align:right;flex-shrink:0">주수</span>
            <span style="width:78px;text-align:right;flex-shrink:0"><span data-tip="보유 수량 전체의 평균 매수 단가(가중평균)">평단가</span></span>
            <span style="width:78px;text-align:right;flex-shrink:0">현재가</span>
            <span style="width:90px;text-align:right;flex-shrink:0">평가금액</span>
            <span style="width:52px;text-align:right;flex-shrink:0">수익률</span>
          </div>
          ${held.map(r=>`
            <div class="cb-hrow" onclick="cbDashPick('${cbEsc(r.key)}')" style="display:flex;align-items:center;gap:8px;padding:7px 9px;cursor:pointer;${r.key===_cdashSel?'background:var(--accSoft);box-shadow:inset 0 0 0 1px var(--bd2)':''}">
              ${cbFlagCell(r, 28, 15)}
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:5px">
                  <span style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(r.title)}</span>
                  ${r.merged?`<span style="font-size:9px;font-weight:700;color:var(--lab);background:var(--accSoft);padding:1px 5px;border-radius:4px;flex-shrink:0" data-tip="${cbEsc(r.acctList.join(', '))} 계좌 합산">${r.acctList.length}계좌</span>`:''}
                </div>
                <div style="font-size:10.5px;color:var(--lab);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(r.subTitle)}</div>
              </div>
              <span style="display:flex;align-items:center;justify-content:flex-end;gap:4px;width:50px;font-size:11px;color:var(--mut);flex-shrink:0"><span style="width:7px;height:7px;border-radius:50%;background:${cbOwnerColor(r.i.owner)}"></span>${cbEsc(r.i.owner)}</span>
              <span class="cb-num" style="width:70px;text-align:right;font-size:12px;flex-shrink:0">${r.i.grp==='현금'?'—':cbEsc(Number(r.qty||0).toLocaleString(undefined,{maximumFractionDigits:4})+(r.i.unit||'주'))}</span>
              <span class="cb-num" style="width:78px;text-align:right;font-size:12px;flex-shrink:0">${r.i.grp==='현금'?'—':cbFmtNative(r.avgNative,r.i.cur)}</span>
              <span class="cb-num" style="width:78px;text-align:right;font-size:12px;font-weight:600;flex-shrink:0">${r.i.grp==='현금'?'—':cbFmtNative(r.i.curP,r.i.cur)}</span>
              <span style="width:90px;text-align:right;font-size:12.5px;font-weight:700;flex-shrink:0">${cbDisp(r.val)}</span>
              <span style="width:52px;text-align:right;font-size:12px;font-weight:600;flex-shrink:0;${r.gainPct==null?'color:var(--lab)':cbUpDn(r.gainPct)}">${r.gainPct==null?'—':cbPct(r.gainPct)}</span>
            </div>`).join('') || '<div style="padding:22px;text-align:center;color:var(--dim);font-size:12px">표시할 종목이 없습니다.</div>'}
        </div></div>
      </div>
      <div class="cb-panel cb-dash-detail" style="width:310px;flex-shrink:0;padding:14px 15px;position:sticky;top:6px">
        ${selPanel}
      </div>
    </div>`;
}
function cbDashSearch(v){ _cdashQ=v; cbRenderDash();
  // 검색 입력 포커스 유지
  const inp=document.querySelector('#cb-cdash input'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
function cbDashPick(key){ _cdashSel=key; cbRenderDash(); }
// 대시보드 소유주 필터 (전체/소유주) — 선택 종목은 초기화해 필터 결과 첫 종목으로 재선택
function cbDashOwner(o){ _cdashOwner=o; _cdashSel=null; _cdashAllocOpen=null; _cdashSecOpen=null; cbRenderDash(); }
// 자산 배분 도넛/범례 클릭 → 해당 자산군 종목 펼침, 재클릭 시 닫힘
function cbDashAllocToggle(key){ _cdashAllocOpen = (_cdashAllocOpen===key ? null : key); cbRenderDash(); }
// 섹터 집중도 막대 클릭 → 해당 섹터 종목 펼침, 재클릭 시 닫힘 (인덱스 → 렌더 시점 라벨)
function cbDashSecToggle(n){
  const label = _cdashSecList[n]; if (label==null) return;
  _cdashSecOpen = (_cdashSecOpen===label ? null : label);
  cbRenderDash();
}

// ───────────────────────── 페이지: 성과 비교 ─────────────────────────
function cbLastVal(arr){ if(!Array.isArray(arr)) return null; for(let k=arr.length-1;k>=0;k--){ if(arr[k]!=null) return arr[k]; } return null; }
function cbRenderPerf(){
  const el = document.getElementById('cb-perf2'); if(!el) return;
  const fmtR = v => v==null ? '—' : (v>=0?'+':'')+Number(v).toFixed(1)+'%';
  const csR = v => v==null ? 'color:var(--lab)' : cbUpDn(v);
  const oc = (typeof BENCH_OWNER_COLORS!=='undefined') ? BENCH_OWNER_COLORS : {};
  if (CB_PERF_TFS.indexOf(_cbPerfTf)<0) _cbPerfTf='1Y';
  // 소유주 4인은 데이터 유무와 무관하게 항상 표시 (데이터 없으면 '—')
  const entities = [
    ...OWNERS.map(o=>({key:o,label:o,color:oc[o]||cbOwnerColor(o),isBench:false,bold:false})),
    {key:'S&P 500',label:'S&P 500',color:'#4ade80',isBench:true},
    {key:'KOSPI',label:'KOSPI',color:'#f2a33c',isBench:true},
  ];
  const tf = _cbPerfTf;
  const sel = benchData[tf] || {labels:[],data:{}};
  const spSel = cbLastVal(sel.data['S&P 500']);
  if (_cbPerfSel && !entities.some(e=>e.key===_cbPerfSel)) _cbPerfSel = null;
  const selKey = _cbPerfSel;
  const cards = entities.map(e=>({ ...e, ret: cbLastVal(sel.data[e.key]) }));
  // 벤치마크(S&P 500·KOSPI)는 실선, 소유주는 점선. 클릭 강조 시 해당 라인 굵게, 나머지 흐리게
  const seriesArr = entities.map(e=>({ data:(sel.data[e.key]||[]), color:e.color,
    bold: e.isBench || e.key===selKey, dash: !e.isBench, dim: !!(selKey && e.key!==selKey) }));
  // 차트 hover 데이터 (body 레벨 고정 툴팁 — 위젯 overflow 로 잘리지 않음)
  window._cbPerfHover = { labels: sel.labels||[], entities: entities.map(e=>({key:e.key,label:e.label,color:e.color})), data: sel.data||{} };
  // MDD (Max Drawdown): 선택 기간 시리즈에서 고점 대비 최대 낙폭
  const mddOf = arr => { let peak=1, mdd=0, seen=false;
    (arr||[]).forEach(v=>{ if(v==null) return; seen=true; const x=1+v/100; if(x>peak) peak=x; const dd=x/peak-1; if(dd<mdd) mdd=dd; });
    return seen ? mdd*100 : null; };
  const rows = entities.map(e=>{
    const g = t => cbLastVal((benchData[t]||{data:{}}).data[e.key]);
    const rv = g(tf);
    const alpha = (!e.isBench && rv!=null && spSel!=null) ? rv-spSel : null;
    return { e, vals: CB_PERF_TFS.map(t=>g(t)), alpha, mdd: mddOf(sel.data[e.key]) };
  });
  const labels = sel.labels||[];
  const N = labels.length;
  const padLpct = (CB_LINE_PAD.l/1100*100).toFixed(2), padRpct = (CB_LINE_PAD.r/1100*100).toFixed(2);

  // 소제목·기간 버튼은 메인 제목 라인(글로벌 헤더)으로
  cbSetHead(
    `${CB_PERF_TF_LABEL[tf]} · 시작점 0% 정규화 · <span data-tip="S&P 500(^GSPC)·KOSPI(^KS11) 실지수 대비 소유주별 포트폴리오 수익률. 전일 확정 종가 기준입니다.">전일 종가 기준</span>`,
    `<div class="owner-tabs" style="display:inline-flex;gap:3px;flex-wrap:wrap">
      ${CB_PERF_TFS.map(t=>`<button class="owner-btn${t===tf?' active':''}" onclick="cbPerfTf('${t}')">${t}</button>`).join('')}
    </div>`
  );

  el.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      ${cards.map(p=>`
        <div class="cb-panel" onclick="cbPerfSelToggle('${cbEsc(p.key)}')" style="flex:1;min-width:130px;padding:12px 14px;border-top:3px solid ${p.color};cursor:pointer;transition:opacity .2s,box-shadow .2s;${selKey===p.key?`box-shadow:0 0 0 1.5px ${p.color}`:(selKey?'opacity:.5':'')}">
          <div style="display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--mut)"><span style="width:8px;height:8px;border-radius:2px;background:${p.color}"></span>${cbEsc(p.label)}</div>
          <div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:23px;font-weight:800;margin-top:3px;${csR(p.ret)}">${fmtR(p.ret)}</div>
        </div>`).join('')}
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px 8px;overflow:visible">
      <div style="display:flex;gap:14px;margin-bottom:8px;flex-wrap:wrap">
        ${entities.map(p=>`<span onclick="cbPerfSelToggle('${cbEsc(p.key)}')" style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--mut);cursor:pointer;transition:opacity .2s;${selKey&&selKey!==p.key?'opacity:.4':''}"><span style="width:13px;height:3px;border-radius:2px;background:${p.color}"></span>${cbEsc(p.label)}</span>`).join('')}
        <span style="margin-left:auto;font-size:10.5px;color:var(--dim)">카드/범례 클릭 시 해당 라인 강조 · 그래프에 마우스를 올리면 상세 수익률</span>
      </div>
      <div style="position:relative" onmouseleave="cbPerfHide()">
        ${cbMultiLineSvg(seriesArr, 1100, 250)}
        <div style="position:absolute;top:0;bottom:0;left:${padLpct}%;right:${padRpct}%">
          <div id="cb-perf-guide" style="position:absolute;top:0;bottom:0;width:0;border-left:1px dashed var(--acc);display:none;pointer-events:none"></div>
          ${N>0 ? labels.map((_,i)=>{
            const c = N>1 ? i/(N-1)*100 : 50, wc = N>1 ? 100/(N-1) : 100;
            const lft = Math.max(0, c-wc/2), rgt = Math.min(100, c+wc/2);
            return `<div style="position:absolute;top:0;bottom:0;left:${lft}%;width:${(rgt-lft)}%;cursor:crosshair" onmousemove="cbPerfHover(event,${i})"></div>`;
          }).join('') : ''}
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--dim);padding:4px 2px 6px;margin-left:${padLpct}%;margin-right:${padRpct}%">${labels.map(l=>`<span>${cbEsc(l)}</span>`).join('')}</div>
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px;overflow-x:auto">
      <div style="min-width:740px">
        <div style="display:flex;font-size:10.5px;color:var(--dim);padding:0 8px 7px;border-bottom:1px solid var(--bd)">
          <span style="flex:1;min-width:96px">구분</span>
          ${CB_PERF_TFS.map(t=>`<span style="width:66px;text-align:right${t===tf?';color:var(--acc);font-weight:700':''}">${t}</span>`).join('')}
          <span style="width:96px;text-align:right"><span data-tip="같은 기간 S&P 500 수익률을 얼마나 웃돌았는지 (포트폴리오 − 벤치마크)">초과수익</span>(${tf})</span>
          <span style="width:76px;text-align:right"><span data-tip="Max Drawdown — 선택 기간 중 고점 대비 최대 하락폭. 낙폭이 작을수록 하락장 방어력이 좋았다는 뜻입니다.">MDD</span>(${tf})</span>
        </div>
        ${rows.map(r=>`
          <div onclick="cbPerfSelToggle('${cbEsc(r.e.key)}')" style="display:flex;align-items:center;padding:9px 8px;border-bottom:1px solid var(--bd);font-size:12.5px;cursor:pointer;${selKey===r.e.key?'background:var(--accSoft);border-radius:7px':''}">
            <span style="flex:1;min-width:96px;display:flex;align-items:center;gap:7px;font-weight:700"><span style="width:8px;height:8px;border-radius:2px;background:${r.e.color}"></span>${cbEsc(r.e.label)}</span>
            ${r.vals.map((v,k)=>`<span style="width:66px;text-align:right;font-weight:600;${csR(v)}${CB_PERF_TFS[k]===tf?';background:var(--accSoft);border-radius:5px':''}">${fmtR(v)}</span>`).join('')}
            <span style="width:96px;text-align:right;font-weight:700;${csR(r.alpha)}">${r.alpha==null?'—':fmtR(r.alpha)}</span>
            <span style="width:76px;text-align:right;font-weight:700;${r.mdd==null||r.mdd>=0?'color:var(--lab)':'color:var(--dn)'}">${r.mdd==null?'—':r.mdd.toFixed(1)+'%'}</span>
          </div>`).join('')}
        <div style="font-size:10.5px;color:var(--dim);margin-top:9px">※ 소유주별 라인은 각 소유주 보유 종목의 가중 수익률입니다. 데이터가 비어 있으면 사이드바의 "새로고침"을 눌러주세요.</div>
      </div>
    </div>`;
}
function cbPerfTf(t){ _cbPerfTf = t; cbRenderPerf(); }
// 소유주/벤치마크 카드·범례·표 행 클릭 → 해당 라인 강조 (재클릭 시 해제)
function cbPerfSelToggle(k){ _cbPerfSel = (_cbPerfSel===k ? null : k); cbRenderPerf(); }
function _cbPerfTipEl(){
  let t = document.getElementById('cb-perf-tip');
  if(!t){
    t = document.createElement('div'); t.id = 'cb-perf-tip';
    t.style.cssText = 'position:fixed;z-index:9999;display:none;pointer-events:none;background:var(--tipbg);color:var(--tiptx);border:1px solid var(--bd2);border-radius:9px;padding:9px 11px;box-shadow:0 12px 30px rgba(0,0,0,.4);font-size:11.5px;min-width:158px;letter-spacing:0';
    document.body.appendChild(t);
  }
  return t;
}
function cbPerfHover(ev, idx){
  const d = window._cbPerfHover; if(!d) return;
  const t = _cbPerfTipEl();
  const body = d.entities.map(e=>{
    const v = (d.data[e.key]||[])[idx];
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:18px;padding:1.5px 0">
      <span style="display:flex;align-items:center;gap:5px;color:var(--mut)"><span style="width:8px;height:8px;border-radius:2px;background:${e.color}"></span>${cbEsc(e.label)}</span>
      <span class="cb-num" style="font-weight:700;${v==null?'color:var(--lab)':cbUpDn(v)}">${v==null?'—':(v>=0?'+':'')+Number(v).toFixed(1)+'%'}</span></div>`;
  }).join('');
  t.innerHTML = `<div style="font-size:10.5px;color:var(--lab);margin-bottom:5px;font-weight:700">${cbEsc(d.labels[idx]||'')}</div>${body}`;
  t.style.display = 'block';
  const r = t.getBoundingClientRect(); const pad = 16;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - pad;
  t.style.left = Math.max(8, x) + 'px';
  t.style.top = Math.max(8, y) + 'px';
  const g = document.getElementById('cb-perf-guide');
  if (g){ const N = d.labels.length; g.style.left = (N>1 ? idx/(N-1)*100 : 50) + '%'; g.style.display = 'block'; }
}
function cbPerfHide(){
  const t = document.getElementById('cb-perf-tip'); if(t) t.style.display = 'none';
  const g = document.getElementById('cb-perf-guide'); if(g) g.style.display = 'none';
}

// ───────────────────────── 페이지: 가족 자산 ─────────────────────────
function cbRenderFam(){
  const el = document.getElementById('cb-fam2'); if(!el) return;
  const rows = cbAllRows();
  const nw = rows.reduce((s,r)=>s+r.val,0) || 1;
  const gainAbs = rows.reduce((s,r)=>s+r.gain,0);
  const byOwner = {}; rows.forEach(r=>{ const o=r.i.owner||'—'; (byOwner[o]=byOwner[o]||{v:0,g:0,n:0}); byOwner[o].v+=r.val; byOwner[o].g+=r.gain; byOwner[o].n++; });
  const cards = [{name:'전체',key:'all',color:'#8a97b0',v:nw,g:gainAbs,n:rows.length}]
    .concat(OWNERS.map(o=>({name:o,key:o,color:cbOwnerColor(o),v:(byOwner[o]||{v:0}).v,g:(byOwner[o]||{g:0}).g,n:(byOwner[o]||{n:0}).n})));
  const base = _famKey==='all' ? rows : rows.filter(r=>r.i.owner===_famKey);
  const q=(_famQ||'').trim().toLowerCase();
  const filtered = q ? base.filter(r=>((r.i.tkr||'')+' '+(r.i.name||'')+' '+r.cl.label+' '+(r.i.owner||'')).toLowerCase().includes(q)) : base;
  const held = cbSortOwnerNameVal(filtered);

  cbSetHead('카드 클릭 시 해당 구성원만 필터링 · 소유주→자산군→국가→종목명 순 정렬');
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px">
      ${cards.map(f=>`
        <div class="cb-panel" onclick="cbFamPick('${cbEsc(f.key)}')" style="cursor:pointer;padding:12px;${_famKey===f.key?`border-color:${f.color};box-shadow:0 0 0 1px ${f.color}`:''}">
          <div style="display:flex;align-items:center;gap:7px">
            <span style="width:23px;height:23px;border-radius:50%;background:${f.color}26;color:${f.color};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800">${cbEsc(f.name.slice(0,1))}</span>
            <span style="font-size:12.5px;font-weight:700">${cbEsc(f.name)}</span>
          </div>
          <div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:17px;font-weight:800;margin-top:8px">${cbDisp(f.v)}</div>
          <div style="font-size:11px;font-weight:600;margin-top:1px;${cbUpDn(f.g)}">${cbSignDisp(f.g)}</div>
          <div style="height:4px;border-radius:2px;background:var(--inner);margin-top:8px;overflow:hidden"><div style="height:100%;background:${f.color};width:${Math.round(f.v/nw*100)}%"></div></div>
          <div style="font-size:10px;color:var(--lab);margin-top:4px">전체 ${(f.v/nw*100).toFixed(1)}% · ${f.n}종목</div>
        </div>`).join('')}
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;gap:8px;flex-wrap:wrap">
        <div style="font-size:10.5px;letter-spacing:.08em;color:var(--lab)">${_famKey==='all'?'전체 보유 자산':cbEsc(_famKey)+' 보유 자산'} · ${held.length}종목</div>
        <div style="display:flex;align-items:center;gap:7px;background:var(--inner);border:1px solid var(--bd2);border-radius:9px;padding:6px 11px;width:220px">
          <span style="color:var(--dim);font-size:12px">⌕</span>
          <input value="${cbEsc(_famQ)}" oninput="cbFamSearch(this.value)" placeholder="티커·종목명 검색…" style="background:transparent;border:none;color:var(--tx);font-family:'Noto Sans KR',sans-serif;font-size:12px;width:100%;outline:none" />
        </div>
      </div>
      <div style="overflow-x:auto"><div style="min-width:860px">
      <div style="display:flex;align-items:center;gap:10px;padding:0 9px 7px;border-bottom:1px solid var(--bd);font-size:10.5px;color:var(--dim)">
        <span style="width:30px;flex-shrink:0"></span>
        <span style="flex:1;min-width:0">종목</span>
        <span style="width:62px;flex-shrink:0">소유주</span>
        <span style="width:76px;text-align:right;flex-shrink:0">수량</span>
        <span style="width:90px;text-align:right;flex-shrink:0"><span data-tip="보유 수량 전체의 평균 매수 단가(가중평균)">평단가</span></span>
        <span style="width:90px;text-align:right;flex-shrink:0">현재가</span>
        <span style="width:100px;text-align:right;flex-shrink:0">평가금액</span>
        <span style="width:96px;text-align:right;flex-shrink:0">평가손익</span>
        <span style="width:56px;text-align:right;flex-shrink:0">수익률</span>
        <span style="width:24px;flex-shrink:0"></span>
      </div>
      ${held.map(r=>`
        <div class="cb-hrow" style="display:flex;align-items:center;gap:10px;padding:7px 9px">
          ${cbFlagCell(r, 30, 16)}
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px"><span style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(r.title)}</span></div>
            <div style="font-size:10.5px;color:var(--lab);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.subTitle?cbEsc(r.subTitle)+' · ':''}${cbEsc(r.i.broker||'—')}${r.i.acc?' · '+cbEsc(r.i.acc):''}</div>
          </div>
          <span style="display:flex;align-items:center;gap:5px;width:62px;font-size:11px;color:var(--mut);flex-shrink:0"><span style="width:7px;height:7px;border-radius:50%;background:${cbOwnerColor(r.i.owner)}"></span>${cbEsc(r.i.owner)}</span>
          <span class="cb-num" style="width:76px;text-align:right;font-size:12px;flex-shrink:0">${r.i.grp==='현금'?'예수금':cbEsc(Number(r.i.qty||0).toLocaleString(undefined,{maximumFractionDigits:4})+(r.i.unit||'주'))}</span>
          <span class="cb-num" style="width:90px;text-align:right;font-size:12px;flex-shrink:0">${r.i.grp==='현금'?'—':cbFmtNative(cbAvgNative(r.i),r.i.cur)}</span>
          <span class="cb-num" style="width:90px;text-align:right;font-size:12px;flex-shrink:0">${r.i.grp==='현금'?'—':cbFmtNative(r.i.curP,r.i.cur)}</span>
          <span style="width:100px;text-align:right;font-size:12.5px;font-weight:700;flex-shrink:0">${cbDisp(r.val)}</span>
          <span style="width:96px;text-align:right;font-size:12px;font-weight:600;flex-shrink:0;${r.i.grp==='현금'?'color:var(--lab)':cbUpDn(r.gain)}">${r.i.grp==='현금'?'—':cbSignDisp(r.gain)}</span>
          <span style="width:56px;text-align:right;font-size:12px;font-weight:600;flex-shrink:0;${r.gainPct==null?'color:var(--lab)':cbUpDn(r.gainPct)}">${r.gainPct==null?'—':cbPct(r.gainPct)}</span>
          <span class="cb-edit" onclick="editItem('${cbEsc(r.i.owner)}','${cbEsc(r.i.tkr)}',${r.idx})">✎</span>
        </div>`).join('')}
      </div></div>
    </div>`;
}
function cbFamPick(k){ _famKey=k; cbRenderFam(); }
function cbFamSearch(v){ _famQ=v; cbRenderFam();
  const inp=document.querySelector('#cb-fam2 input'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }

// ───────────────────────── 페이지: 리스크 진단 ─────────────────────────
// 종목 집중도(ETF 룩스루) 패널 — 직접 보유(파랑) + ETF 간접 보유(주황) 스택 바
function cbLookThroughPanel(ownerF){
  const C_DIR = '#5b9bff', C_VIA = '#f2a33c';
  const lt = cbLookThrough(ownerF);
  const upC=(typeof cssVar==='function'?cssVar('--up','#178a52'):'#178a52'),
        wnC=(typeof cssVar==='function'?cssVar('--warn','#d97706'):'#d97706'),
        dnC=(typeof cssVar==='function'?cssVar('--dn','#cf3d5c'):'#cf3d5c');
  // ETF 간접 보유가 있는 종목은 모두 표시 + 나머지는 상위 직접 보유로 채움 (최대 12)
  const withVia = lt.list.filter(x=>x.via>0);
  const rest = lt.list.filter(x=>x.via<=0).slice(0, Math.max(0, 10-withVia.length));
  const shown = withVia.concat(rest).sort((a,b)=>b.tot-a.tot).slice(0,12);
  const mx = Math.max(...shown.map(x=>x.pct), 1);

  let body;
  if (!lt.list.length){
    body = '<div style="padding:16px;text-align:center;color:var(--dim);font-size:12px">개별 주식 보유가 없습니다.</div>';
  } else {
    body = shown.map(x=>{
      const pctColor = x.pct>30 ? dnC : x.pct>20 ? wnC : 'var(--tx)';
      // hover 설명: ETF명 + 편입 비중까지만 (금액 없음), 종목(ETF)별 줄바꿈 — 가독성 확보
      const dirTip = cbEsc(`${x.title} 직접 보유 ${x.dPct.toFixed(1)}%${x.vPct>0?` (합계 ${x.pct.toFixed(1)}%)`:''}`);
      const viaTip = cbEsc(`${x.title} ETF 간접 보유 ${x.vPct.toFixed(1)}%\n`
        + x.etfs.map(e=>`${e.etf}${e.fb?' (내장 비중표)':''} 편입 ${e.w}%`).join('\n')).replace(/\n/g,'&#10;');
      return `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 0;font-size:12px">
        <span style="width:148px;flex-shrink:0;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(x.title)}</span>
        <div style="flex:1;min-width:120px;height:14px;border-radius:4px;background:var(--inner)">
          <div style="display:flex;gap:2px;height:100%">
            ${x.dPct>0?`<span class="cb-tip-block" data-tip="${dirTip}" style="display:block;height:100%;width:${Math.max(0.6,(x.dPct/mx*100)).toFixed(2)}%;background:${C_DIR};border-radius:3px"></span>`:''}
            ${x.vPct>0?`<span class="cb-tip-block" data-tip="${viaTip}" style="display:block;height:100%;width:${Math.max(0.6,(x.vPct/mx*100)).toFixed(2)}%;background:${C_VIA};border-radius:3px"></span>`:''}
          </div>
        </div>
        <span class="cb-num" style="width:54px;text-align:right;font-weight:800;color:${pctColor};flex-shrink:0">${x.pct.toFixed(1)}%</span>
        <span style="width:190px;flex-shrink:0;font-size:10.5px;color:var(--lab);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${
          x.vPct>0 ? `직접 ${x.dPct.toFixed(1)}% + <span style="color:${C_VIA};font-weight:700">ETF ${x.vPct.toFixed(1)}%</span>` : '직접 보유만'
        }</span>
      </div>`;
    }).join('');
  }

  const notes = [];
  if (lt.pending) notes.push('ETF 구성종목 조회 중… 잠시 후 자동 갱신됩니다.');
  if (lt.etfFallback && lt.etfFallback.length) notes.push('구성종목 실시간 미조회로 내장 비중표(funetf.co.kr 상위 편입 비중 참조)를 적용한 ETF: ' + lt.etfFallback.map(cbEsc).join(', ') + ' (상위 편입 종목 근사치 — 소유주 직접 보유 종목과 매칭해 간접 보유분 반영)');
  if (lt.etfMiss.length) notes.push('구성종목 미조회 ETF: ' + lt.etfMiss.map(cbEsc).join(', ') + ' (내장 비중표에도 없어 간접 보유분은 제외된 수치입니다 — funetf.co.kr에서 편입 비중 확인 후 내장표 보강 예정)');
  if (!lt.pending && !lt.etfCount) notes.push('보유 중인 ETF가 없어 직접 보유 비중과 동일합니다.');

  return `
    <div class="cb-panel" style="margin-top:12px;padding:15px 17px">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <span style="font-size:10.5px;letter-spacing:.08em;color:var(--lab)"><span data-tip="보유 ETF의 구성종목 비중을 풀어서(룩스루) ETF 평가액 × 편입 비중으로 간접 보유분을 계산하고, 직접 보유분과 합산한 실질 종목 비중입니다. 개별 주식으로 직접 보유한 종목만 계산합니다.">종목 집중도 · ETF 룩스루</span> <span style="color:var(--dim)">· ${ownerF?cbEsc(ownerF):'전체'} 순자산 대비</span></span>
        <div style="display:flex;gap:12px;font-size:10.5px;color:var(--mut);margin-left:auto;flex-wrap:wrap">
          <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:${C_DIR}"></span>직접 보유</span>
          <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:${C_VIA}"></span>ETF 간접 보유</span>
        </div>
      </div>
      ${body}
      ${notes.length?`<div style="font-size:10.5px;color:var(--dim);margin-top:8px;line-height:1.6">${notes.map(t=>'※ '+t).join('<br>')}</div>`:''}
    </div>`;
}

let _cbRiskOwner = '전체';   // 리스크 진단 소유주 필터
function cbRiskOwner(o){ _cbRiskOwner = o; cbRenderRisk(); }
function cbRenderRisk(){
  const el = document.getElementById('cb-risk2'); if(!el) return;
  cbEnsureEtfHoldings();
  const ownerF = (_cbRiskOwner && _cbRiskOwner!=='전체') ? _cbRiskOwner : null;
  const r = cbRisk(ownerF);
  cbSetHead(`규칙 기반 자동 점검${ownerF?' · '+cbEsc(ownerF):''}`, cbOwnerBtns(_cbRiskOwner,'cbRiskOwner'));
  el.innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <div class="cb-panel" style="width:246px;flex-shrink:0;padding:18px;display:flex;flex-direction:column;align-items:center">
        <div style="position:relative;width:136px;height:136px;display:flex;align-items:center;justify-content:center">
          ${cbRingSvg(r.score,136,r.color)}
          <div style="position:absolute;text-align:center">
            <div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:34px;font-weight:800;color:${r.color}">${r.score}</div>
            <div style="font-size:10px;color:var(--lab)">/ 100</div>
          </div>
        </div>
        <div style="font-size:14.5px;font-weight:800;margin-top:10px;color:${r.color}">${r.grade}</div>
        <div style="font-size:11.5px;color:var(--mut);text-align:center;line-height:1.6;margin-top:6px">${r.warns===0?'모든 점검 항목이 양호합니다.':r.warns+'개 항목에서 주의·경고가 발견되었습니다.'}</div>
        <div style="width:100%;margin-top:13px;padding-top:12px;border-top:1px solid var(--bd);display:flex;flex-direction:column;gap:6px">
          <div style="display:flex;justify-content:space-between;font-size:11.5px"><span style="color:var(--mut)"><span data-tip="자산군별 역사적 변동성의 보유비중 가중평균. 1년간 수익률이 오르내리는 폭의 추정치입니다.">추정 연 변동성</span></span><span style="font-weight:700">${r.vol.toFixed(1)}%</span></div>
          <div style="display:flex;justify-content:space-between;font-size:11.5px"><span style="color:var(--mut)"><span data-tip="원화가 아닌 통화(USD·JPY)로 표시된 자산의 비중. 환율 변동에 노출됩니다.">환노출</span></span><span style="font-weight:700">${r.fxPct.toFixed(1)}%</span></div>
          <div style="display:flex;justify-content:space-between;font-size:11.5px"><span style="color:var(--mut)">현금 비중</span><span style="font-weight:700">${r.cashPct.toFixed(1)}%</span></div>
        </div>
      </div>
      <div style="flex:1;min-width:340px;display:grid;grid-template-columns:1fr 1fr;gap:10px;align-content:start">
        ${r.cards.map(c=>`
          <div class="cb-panel" style="padding:13px 15px">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
              <div style="display:flex;align-items:center;gap:8px"><span style="font-size:12.5px;font-weight:700">${c.title}</span><span style="font-size:10px;font-weight:800;padding:1px 8px;border-radius:16px;background:${c.lvl===0?'var(--upSoft)':c.color+'26'};color:${c.color}">${c.status}</span></div>
              <div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:16px;font-weight:800;color:${c.color}">${c.valFmt}</div>
            </div>
            <div style="font-size:11px;color:var(--mut);margin-top:4px;line-height:1.55">${c.msg}</div>
            <div style="height:5px;border-radius:3px;background:var(--inner);margin-top:8px;overflow:hidden"><div style="height:100%;width:${c.fill}%;background:${c.color}"></div></div>
          </div>`).join('')}
      </div>
    </div>
    ${cbLookThroughPanel(ownerF)}`;
}

// ───────────────────────── 페이지: 배당 관리 ─────────────────────────
// 배당 캘린더 Y축 금액 라벨 (만/억 + 소액은 천 단위)
function cbDivAxisLab(v){
  if (v===0) return '0';
  if (Math.abs(v)>=10000) return cbTaxAxisLab(v);
  return Math.round(v/1000).toLocaleString('ko-KR')+'천';
}
// 배당 이력에서 특정 연도의 실제 지급액을 월별로 집계 (현재 보유수량 기준 환산)
function cbDivMonthlyForYear(list, year){
  const monthAmt = Array(12).fill(0);
  const cur = String(new Date().getFullYear());
  if (year===cur){
    // 올해 이후 → 예상: 연 배당을 지급 주기 월에 균등 배분
    list.forEach(x=>{
      const ms = (x.d.months && x.d.months.length) ? x.d.months : [2,5,8,11];
      const per = x.incomeKRW / ms.length;
      ms.forEach(m=>{ const mi=((m%12)+12)%12; monthAmt[mi]+=per; });
    });
    return { monthAmt, actual:false };
  }
  // 과거 연도 → 실제 지급 이력(주당 배당 × 현재 보유수량)
  const raw = window._divHistoryRawCache || {};
  list.forEach(x=>{
    const h = raw[cbStrip(x.i.tkr)];
    if (!h || !Array.isArray(h.events)) return;
    h.events.forEach(ev=>{
      if (String(ev.date||'').slice(0,4)!==year) return;
      const mi = parseInt(String(ev.date).slice(5,7),10)-1;
      if (mi<0||mi>11) return;
      monthAmt[mi] += (Number(ev.amount)||0) * (x.qty||0) * cbRate(h.cur || x.i.cur);
    });
  });
  return { monthAmt, actual:true };
}
// 월별 배당 캘린더 SVG — Y축 금액 + X축 '월' 라벨
function cbDivCalendarSvg(monthAmt, w, h){
  const upC = (typeof cssVar==='function'?cssVar('--up','#178a52'):'#178a52');
  const maxRaw = Math.max(...monthAmt, 1);
  const step = cbNiceStep(maxRaw/4);
  const maxV = Math.max(step, Math.ceil(maxRaw/step)*step);
  const padL=58, padR=14, padT=18, padB=26;
  const plotW=w-padL-padR, plotH=h-padT-padB;
  const Y=v=> padT + plotH - (v/maxV)*plotH;
  let out='';
  for(let v=0; v<=maxV+step*0.01; v+=step){
    const yy=Y(v).toFixed(1);
    out+=`<line x1="${padL}" x2="${w-padR}" y1="${yy}" y2="${yy}" style="stroke:var(--grid)" stroke-width="1"></line>`;
    out+=`<text x="${padL-7}" y="${(Y(v)+3.4).toFixed(1)}" style="fill:var(--lab)" font-size="10" text-anchor="end" font-family="IBM Plex Mono">${cbDivAxisLab(v)}</text>`;
  }
  const slot=plotW/12, bw=Math.min(40, slot-12);
  for(let m=0;m<12;m++){
    const v=monthAmt[m]||0, xc=padL + slot*m + slot/2, yTop=Y(v);
    if(v>0){
      out+=`<rect x="${(xc-bw/2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${(padT+plotH-yTop).toFixed(1)}" rx="3" fill="${upC}" opacity="0.85"><title>${m+1}월 — ${cbDisp(v)}</title></rect>`;
      out+=`<text x="${xc.toFixed(1)}" y="${(yTop-5).toFixed(1)}" style="fill:var(--up)" font-size="9.5" font-weight="700" text-anchor="middle" font-family="IBM Plex Mono">${cbDivAxisLab(v)}</text>`;
    }
    out+=`<text x="${xc.toFixed(1)}" y="${h-8}" style="fill:var(--lab)" font-size="11" text-anchor="middle" font-family="Noto Sans KR">${m+1}월</text>`;
  }
  return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block">${out}</svg>`;
}
function cbRenderDiv(){
  cbEnsureDivHist();
  const el = document.getElementById('cb-divm'); if(!el) return;
  const ownerF = (_cbDivOwner && _cbDivOwner!=='전체') ? _cbDivOwner : null;
  let rows = cbAllRows().filter(r=>cbDivOf(r.i));
  if (ownerF) rows = rows.filter(r=>r.i.owner===ownerF);
  // 같은 소유주+티커(다계좌) 취합
  const merged = new Map();
  rows.forEach(r=>{
    const key = r.i.owner + '::' + cbStrip(r.i.tkr);
    if (merged.has(key)){ const m = merged.get(key); m.qty += (r.i.qty||0); m.cost += r.cost; if(r.i.acc) m.accts.add(r.i.acc); }
    else merged.set(key, { i:r.i, cl:r.cl, cls:r.cls, title:r.title, tkr:r.tkr, chip:r.chip, qty:(r.i.qty||0), cost:r.cost, idx:r.idx, accts:new Set(r.i.acc?[r.i.acc]:[]) });
  });
  // 정렬: 소유주 → 자산군 → 국가 → 종목명 (보유 자산 내역 공통 규칙)
  const list = cbSortOwnerNameVal(Array.from(merged.values()).map(m=>{
    const d = cbDivOf(m.i);
    const incomeKRW = d.annualDps * m.qty * cbRate(d.cur || m.i.cur);
    const g = cbDivGrowth(m.i);
    const rate = cbRate(m.i.cur);
    const avgNative = (m.qty>0 && rate>0) ? m.cost/(m.qty*rate) : cbAvgNative(m.i);
    return { ...m, d, incomeKRW, g, avgNative,
      yoc: avgNative>0 ? d.annualDps/avgNative*100 : null };
  }));

  const divAnnual = list.reduce((s,x)=>s+x.incomeKRW,0);
  const divCost = list.reduce((s,x)=>s+x.cost,0) || 1;
  const avgG = divAnnual ? list.reduce((s,x)=>s+(x.g||0)*x.incomeKRW,0)/divAnnual : 0;

  // 조회 연도 목록 (배당 이력 연도 + 올해)
  const nowY = String(new Date().getFullYear());
  const raw = window._divHistoryRawCache || {};
  const yrSet = new Set([nowY]);
  list.forEach(x=>{ const h=raw[cbStrip(x.i.tkr)]; if(h&&Array.isArray(h.events)) h.events.forEach(ev=>{ const y=String(ev.date||'').slice(0,4); if(/^\d{4}$/.test(y)) yrSet.add(y); }); });
  const years = Array.from(yrSet).sort((a,b)=>b.localeCompare(a));
  const year = (_cbDivYear && years.includes(_cbDivYear)) ? _cbDivYear : nowY;
  const cal = cbDivMonthlyForYear(list, year);
  const calTotal = cal.monthAmt.reduce((s,v)=>s+v,0);

  // 소제목·소유주 버튼·연도 셀렉트는 메인 제목 라인(글로벌 헤더)으로
  cbSetHead(
    '<span data-tip="Yield on Cost — 내 평단가 대비 연간 배당금 비율. 배당성장 + 장기보유의 효과를 보여줍니다.">YoC</span>는 평단가(가중평균) 기준입니다',
    `${cbOwnerBtns(_cbDivOwner,'cbDivOwner')}
     <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--lab);font-weight:600">연도
       <select class="cb-input" onchange="cbDivYear(this.value)" style="padding:6px 9px">${years.map(y=>`<option value="${y}" ${y===year?'selected':''}>${y}년</option>`).join('')}</select>
     </label>`
  );
  el.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div style="flex:1;min-width:150px;background:var(--upSoft);border:1px solid var(--bd);border-radius:12px;padding:12px 14px"><div style="font-size:11px;color:var(--mut)">연간 배당 수입${ownerF?' · '+cbEsc(ownerF):''}</div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;color:var(--up);margin-top:2px">${cbDisp(divAnnual)}</div></div>
      <div class="cb-panel" style="flex:1;min-width:150px;padding:12px 14px"><div style="font-size:11px;color:var(--lab)">월평균</div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;margin-top:2px">${cbDisp(divAnnual/12)}</div></div>
      <div class="cb-panel" style="flex:1;min-width:150px;padding:12px 14px"><div style="font-size:11px;color:var(--lab)">평균 <span data-tip="배당 지급 종목 전체의 매입원가 대비 배당수입 비율">YoC</span></div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;margin-top:2px">${(divAnnual/divCost*100).toFixed(2)}%</div></div>
      <div class="cb-panel" style="flex:1;min-width:150px;padding:12px 14px"><div style="font-size:11px;color:var(--lab)">평균 <span data-tip="지급 종목들의 주당 배당금 연평균 성장률(CAGR)을 배당수입 비중으로 가중평균한 값">배당성장률</span></div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;color:var(--up);margin-top:2px">${(avgG>=0?'+':'')+avgG.toFixed(1)}%</div></div>
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px 8px">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        <span style="font-size:10.5px;letter-spacing:.08em;color:var(--lab)">${year}년 월별 배당 캘린더 ${cal.actual?'<span style="color:var(--up)">· 실제 지급</span>':'<span style="color:var(--dim)">· 예상</span>'}</span>
        <span style="margin-left:auto;font-size:11px;color:var(--mut)">${year}년 합계 <b style="color:var(--up)">${cbDisp(calTotal)}</b></span>
      </div>
      ${cbDivCalendarSvg(cal.monthAmt, 1100, 300)}
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px;overflow-x:auto">
      <div style="display:flex;font-size:10.5px;color:var(--dim);padding:0 8px 7px;border-bottom:1px solid var(--bd);min-width:820px">
        <span style="flex:1">종목</span><span style="width:62px">소유주</span><span style="width:86px;text-align:right">주당 배당(연)</span><span style="width:70px;text-align:right"><span data-tip="현재 주가 대비 연간 배당금 비율">시가수익률</span></span><span style="width:64px;text-align:right"><span data-tip="Yield on Cost — 평단가 대비 배당수익률">YoC</span></span><span style="width:78px;text-align:right"><span data-tip="배당 이력 기준 주당 배당금 연평균 성장률(CAGR)">배당성장</span></span><span style="width:96px;text-align:right">연간 수입</span><span style="width:64px;text-align:right">주기</span><span style="width:100px;text-align:right"><span data-tip="이 날짜 전까지 매수해야 다음 배당을 받을 수 있는 기준일">배당락</span></span>
      </div>
      ${list.map(x=>`
        <div style="display:flex;align-items:center;padding:9px 8px;border-bottom:1px solid var(--bd);font-size:12.5px;min-width:820px">
          <div style="flex:1;display:flex;align-items:center;gap:8px;min-width:0">
            ${cbFlagCell(x, 27, 15)}
            <div style="min-width:0"><div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(x.title)}</div><div style="font-size:10px;color:var(--lab)">${cbEsc(x.tkr)}</div></div>
          </div>
          <span style="width:62px;display:flex;align-items:center;gap:4px;font-size:11px;color:var(--mut)"><span style="width:6px;height:6px;border-radius:50%;background:${cbOwnerColor(x.i.owner)}"></span>${cbEsc(x.i.owner)}</span>
          <span class="cb-num" style="width:86px;text-align:right;font-size:11.5px">${cbFmtNative(x.d.annualDps, x.d.cur||x.i.cur)}</span>
          <span style="width:70px;text-align:right;font-weight:600">${(x.d.yldNum||0).toFixed(2)}%</span>
          <span style="width:64px;text-align:right;font-weight:800;color:var(--up)">${x.yoc!=null?x.yoc.toFixed(2)+'%':'—'}</span>
          <span style="width:78px;text-align:right;font-weight:700;${x.g!=null?cbUpDn(x.g):'color:var(--lab)'}">${x.g!=null?(x.g>=0?'+':'')+x.g.toFixed(1)+'%':'—'}</span>
          <span style="width:96px;text-align:right;font-weight:700">${cbDisp(x.incomeKRW)}</span>
          <span style="width:64px;text-align:right;color:var(--mut);font-size:11.5px">${cbEsc(x.d.cycle||'—')}</span>
          <span style="width:100px;text-align:right;color:var(--mut);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(x.d.exDiv||'—')}</span>
        </div>`).join('') || '<div style="padding:20px;text-align:center;color:var(--dim);font-size:12px">배당 지급 종목이 없거나 배당 정보를 아직 불러오지 못했습니다.</div>'}
    </div>`;
}
function cbDivOwner(o){ _cbDivOwner=o; cbRenderDiv(); }
function cbDivYear(y){ _cbDivYear=y; cbRenderDiv(); }

// ───────────────────────── 페이지: 증여 플랜 ─────────────────────────
// 실제 증여액(구간별 입력) — KV ext_data.giftActual + localStorage 미러로 영속화
window._giftActual = window._giftActual || (function(){
  try{ return JSON.parse(localStorage.getItem('giftActual')||'{}') || {}; }catch(e){ return {}; }
})();
function cbGiftActualOf(idx){
  const v = Number((window._giftActual||{})[idx]);
  return (isFinite(v) && v>0) ? v : 0;
}
function cbGiftSetActual(idx, raw){
  const v = parseFloat(String(raw||'').replace(/[^\d]/g,''));
  window._giftActual = window._giftActual || {};
  window._giftActual[idx] = (isFinite(v) && v>0) ? Math.round(v) : 0;
  try{ localStorage.setItem('giftActual', JSON.stringify(window._giftActual)); }catch(e){}
  try{ saveExtDataToKV(); }catch(e){}
  cbRenderGift();
}
function cbGiftFmtInput(el){
  const digits = el.value.replace(/[^\d]/g,'');
  el.value = digits ? Number(digits).toLocaleString('ko-KR') : '';
}
function cbGiftBirth(){
  const b = (window._giftActual||{}).birth;
  return /^\d{4}-\d{2}$/.test(b||'') ? b : '2023-08';
}
function cbGiftSetBirth(v){
  if (!/^\d{4}-\d{2}$/.test(v||'')) return;
  window._giftActual = window._giftActual || {};
  window._giftActual.birth = v;
  try{ localStorage.setItem('giftActual', JSON.stringify(window._giftActual)); }catch(e){}
  try{ saveExtDataToKV(); }catch(e){}
  cbRenderGift();
}
// 구간별 색 (코발트 팔레트 — 데이터 색이므로 테마 무관 고정)
const CB_GIFT_SEG_COLORS = ['#5b9bff','#4ecdc4','#f2a33c','#c084fc'];
function cbGiftSegs(){
  const r = Math.pow(1.03, 1/12);
  const pvf = (1 - Math.pow(1.03, -10)) / (1 - 1/r);
  return [
    {label:'미성년 전기', ages:'0~9세',  a0:0,  limit:20000000},
    {label:'미성년 후기', ages:'10~19세', a0:10, limit:20000000},
    {label:'성년 전기',   ages:'20~29세', a0:20, limit:50000000},
    {label:'성년 후기',   ages:'30~39세', a0:30, limit:50000000},
  ].map((g,i)=>{ const M=g.limit/pvf, nominal=M*120; return {...g, idx:i, color:CB_GIFT_SEG_COLORS[i], monthly:M, nominal, extra:nominal-g.limit, actual:cbGiftActualOf(i)}; });
}
// 연도별 누적 막대 그래프 — x축: 연도(출생 연월 기준), y축: 금액
function cbGiftChartSvg(w,h){
  const segs = cbGiftSegs();
  const wn = (typeof cssVar==='function'?cssVar('--warn','#d97706'):'#d97706');
  const birth = cbGiftBirth();
  const by = parseInt(birth.slice(0,4),10);
  const N = 40; // 0~39세
  const totalNominal = segs.reduce((s,g)=>s+g.nominal,0);
  const maxY = totalNominal*1.12;
  const padL=52, padR=8, padT=10, padB=22;
  const plotW=w-padL-padR, plotH=h-padT-padB;
  const X=a=>padL + a*(plotW/N);
  const bw=plotW/N-2.4;
  const Y=v=>padT + plotH - (v/maxY)*plotH;
  let out='';
  // Y축 그리드 + 라벨 (4,000만원 간격)
  for(let v=0; v<=maxY; v+=40000000){
    out+=`<line x1="${padL}" x2="${w-padR}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:var(--grid)" stroke-width="1"></line>`;
    out+=`<text x="${padL-6}" y="${Y(v)+4}" style="fill:var(--lab)" font-size="10" text-anchor="end" font-family="IBM Plex Mono">${v===0?'0':Math.round(v/10000).toLocaleString()+'만'}</text>`;
  }
  // 누적 명목 이체액 막대 (구간별 색) + 연도별 hover 설명 데이터 수집
  const hoverRows=[];
  let cum=0, limCum=0, actPrev=0;
  segs.forEach(g=>{
    const annual=g.nominal/10;
    limCum+=g.limit;
    for(let k=0;k<10;k++){
      cum+=annual;
      const a=g.a0+k, y=Y(cum);
      hoverRows.push({ year:by+a, age:a, seg:g.label, color:g.color, monthly:g.monthly,
        cumNominal:cum, cumLimit:limCum, cumActual:actPrev + g.actual*((k+1)/10) });
      out+=`<rect x="${(X(a)+1.2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${(padT+plotH-y).toFixed(1)}" rx="1.5" fill="${g.color}" opacity="0.82"></rect>`;
    }
    actPrev+=g.actual;
  });
  window._cbGiftHover = hoverRows;
  // X축 라벨: 5년 간격 연도
  for(let a=0;a<=N;a+=5){
    out+=`<text x="${X(a)+(a<N?bw/2:0)}" y="${h-6}" style="fill:var(--lab)" font-size="10" text-anchor="middle" font-family="IBM Plex Mono">${by+a}</text>`;
  }
  // 구간별 비과세 한도(누적) — 경고색 점선 + 라벨
  let c2=0;
  segs.forEach(g=>{ c2+=g.limit;
    out+=`<line x1="${X(g.a0)}" x2="${X(g.a0+10)}" y1="${Y(c2)}" y2="${Y(c2)}" stroke="${wn}" stroke-width="2" stroke-dasharray="7 5" opacity="0.95"></line>`;
    out+=`<text x="${X(g.a0)+4}" y="${Y(c2)-6}" fill="${wn}" font-size="11" font-weight="700" font-family="Noto Sans KR">한도 누적 ${Math.round(c2/10000).toLocaleString()}만</text>`;
  });
  // 실제 증여 누적 라인 (구간 내 선형 증가)
  let cumR=0; const actPts=[[0,0]]; let anyActual=false;
  segs.forEach(g=>{ actPts.push([g.a0,cumR]); if(g.actual>0) anyActual=true; cumR+=g.actual; actPts.push([g.a0+10,cumR]); });
  actPts.push([N,cumR]);
  if (anyActual){
    const actD='M'+actPts.map(p=>X(p[0]).toFixed(1)+','+Y(p[1]).toFixed(1)).join(' L');
    out+=`<path d="${actD}" fill="none" style="stroke:var(--tx)" stroke-width="2.4" stroke-linejoin="round"></path>`;
  }
  // 현재 시점 마커 (출생 연월 기준 나이)
  const now=new Date();
  const ageNow=(now - new Date(birth+'-01'))/(365.25*86400000);
  if (ageNow>=0 && ageNow<=N){
    out+=`<line x1="${X(ageNow)}" x2="${X(ageNow)}" y1="${padT}" y2="${padT+plotH}" style="stroke:var(--acc)" stroke-width="1.4" stroke-dasharray="3 4"></line>`;
    out+=`<text x="${X(ageNow)+4}" y="${padT+11}" style="fill:var(--acc)" font-size="10.5" font-weight="700" font-family="Noto Sans KR">현재 (${Math.floor(ageNow)}세)</text>`;
  }
  return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block">${out}</svg>`;
}
function cbRenderGift(){
  const el = document.getElementById('cb-gift2'); if(!el) return;
  const segs = cbGiftSegs();
  const wn = (typeof cssVar==='function'?cssVar('--warn','#d97706'):'#d97706');
  const birth = cbGiftBirth();
  const by = parseInt(birth.slice(0,4),10);
  const lumpT = segs.reduce((s,g)=>s+g.limit,0), annT = segs.reduce((s,g)=>s+g.nominal,0);
  const actT = segs.reduce((s,g)=>s+g.actual,0);
  const actPct = lumpT ? actT/lumpT*100 : 0;
  // 소제목·자녀 출생 연월 입력은 메인 제목 라인(글로벌 헤더)으로
  cbSetHead(
    '<span data-tip="일정 기간 동안 정기적으로 나누어 주는 증여. 미래 지급분을 연 3% 할인율로 현재가치 평가하므로, 같은 비과세 한도로 더 많은 금액을 이체할 수 있습니다.">유기정기금</span> 방식 · 연 3.0% 할인율 적용',
    `<label style="display:flex;align-items:center;gap:7px;font-size:11px;color:var(--lab);font-weight:600">자녀 출생 연월
      <input type="month" id="cb-gift-birth" class="cb-input cb-num" value="${birth}" onchange="cbGiftSetBirth(this.value)" style="padding:6px 9px" />
    </label>`
  );
  el.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div class="cb-panel" style="flex:1;min-width:180px;padding:12px 14px"><div style="font-size:11px;color:var(--lab)">일시금 한도 합계 (0~39세)</div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;margin-top:2px">${cbManwon(lumpT)}</div></div>
      <div style="flex:1;min-width:180px;background:var(--upSoft);border:1px solid var(--bd);border-radius:12px;padding:12px 14px"><div style="font-size:11px;color:var(--mut)">유기정기금 이체 가능 총액</div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;color:var(--up);margin-top:2px">${cbManwon(annT)}</div></div>
      <div class="cb-panel" style="flex:1;min-width:180px;padding:12px 14px"><div style="font-size:11px;color:var(--lab)">할인율 효과 (추가 이체분)</div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;color:var(--up);margin-top:2px">+${cbManwon(annT-lumpT)}</div></div>
      <div class="cb-panel" style="flex:1;min-width:180px;padding:12px 14px;border-top:3px solid var(--acc)"><div style="font-size:11px;color:var(--lab)">실제 증여 누적 / 총 한도</div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;margin-top:2px">${cbManwon(actT)} <span style="font-size:12px;color:var(--lab);font-weight:600">(${actPct.toFixed(1)}%)</span></div></div>
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px">
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;flex-wrap:wrap"><div style="font-size:10.5px;letter-spacing:.08em;color:var(--lab)">구간별 플랜 · 진행 현황</div><div style="font-size:10.5px;color:var(--dim)">실제 증여(이체)한 금액을 입력하면 비과세 한도 대비 진행률을 추적합니다</div></div>
      <div style="display:flex;font-size:10px;color:var(--dim);padding:0 0 6px;border-bottom:1px solid var(--bd);gap:12px">
        <span style="width:178px;flex-shrink:0">구간</span>
        <span style="width:86px;text-align:right;flex-shrink:0"><span data-tip="10년 단위로 재적용되는 증여세 비과세 한도 (미성년 2,000만원 / 성년 5,000만원)">비과세 한도</span></span>
        <span style="width:118px;text-align:right;flex-shrink:0">월 이체액 <span data-tip="10년간 매월 이체 시 명목 총액 — 할인율 덕분에 한도보다 커집니다">(10년 명목)</span></span>
        <span style="width:136px;text-align:right;flex-shrink:0">실제 증여액</span>
        <span style="flex:1;min-width:220px;text-align:right;padding-right:56px">진행률</span>
        <span style="width:120px;text-align:right;flex-shrink:0">잔여</span>
      </div>
      ${segs.map(g=>{
        const pct = g.limit ? g.actual/g.limit*100 : 0;
        const over = g.actual > g.limit;
        return `
        <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--bd);flex-wrap:wrap">
          <span style="width:178px;flex-shrink:0;display:flex;align-items:center;gap:7px">
            <span style="width:8px;height:8px;border-radius:2px;background:${g.color};flex-shrink:0"></span>
            <span style="line-height:1.35"><span style="font-size:12.5px;font-weight:700">${g.label}</span><br><span style="font-size:10px;color:var(--lab);white-space:nowrap">${g.ages} · ${by+g.a0}~${by+g.a0+10}년</span></span>
          </span>
          <span style="width:86px;text-align:right;font-size:12px;font-weight:600;flex-shrink:0">${cbManwon(g.limit)}</span>
          <span style="width:118px;text-align:right;flex-shrink:0;line-height:1.35"><span class="cb-num" style="font-size:11.5px;font-weight:600">${cbKrw(g.monthly)}</span><br><span style="font-size:9.5px;color:var(--lab);white-space:nowrap">명목 ${cbManwon(g.nominal)}</span></span>
          <span style="width:136px;display:flex;align-items:center;gap:4px;justify-content:flex-end;flex-shrink:0">
            <input class="cb-input cb-num" value="${g.actual?g.actual.toLocaleString('ko-KR'):''}" placeholder="0"
              inputmode="numeric" style="width:112px;text-align:right;padding:6px 8px"
              oninput="cbGiftFmtInput(this)" onchange="cbGiftSetActual(${g.idx}, this.value)" />
            <span style="font-size:10.5px;color:var(--lab)">원</span>
          </span>
          <span style="flex:1;min-width:220px;display:flex;align-items:center;gap:10px;padding-left:8px">
            <span style="flex:1;height:8px;border-radius:4px;background:var(--inner);overflow:hidden;border:1px solid var(--bd);display:block">
              <span style="display:block;height:100%;border-radius:4px;background:${over?wn:g.color};width:${Math.max(g.actual>0?2:0, Math.min(100, Math.round(pct)))}%;transition:width .25s"></span>
            </span>
            <span style="width:48px;text-align:right;font-weight:800;font-size:12px;color:${over?wn:'var(--tx)'};flex-shrink:0">${pct.toFixed(1)}%</span>
          </span>
          <span style="width:120px;text-align:right;font-size:10.5px;color:${over?wn:'var(--mut)'};flex-shrink:0">${over?'한도 초과 +'+cbManwon(g.actual-g.limit):cbManwon(g.limit-g.actual)}</span>
        </div>`;}).join('')}
      <div style="display:flex;align-items:center;gap:12px;padding:9px 0 2px;flex-wrap:wrap">
        <span style="width:178px;font-size:12.5px;font-weight:800;flex-shrink:0">전체 (0~39세)</span>
        <span style="width:86px;text-align:right;font-size:12px;font-weight:700;flex-shrink:0">${cbManwon(lumpT)}</span>
        <span style="width:118px;text-align:right;flex-shrink:0"><span style="font-size:9.5px;color:var(--lab);white-space:nowrap">명목 ${cbManwon(annT)}</span></span>
        <span class="cb-num" style="width:136px;text-align:right;font-weight:800;font-size:12px;flex-shrink:0">${cbKrw(actT)}</span>
        <span style="flex:1;min-width:220px;display:flex;align-items:center;gap:10px;padding-left:8px">
          <span style="flex:1;height:8px;border-radius:4px;background:var(--inner);overflow:hidden;border:1px solid var(--bd);display:block">
            <span style="display:block;height:100%;border-radius:4px;background:var(--up);width:${Math.max(actT>0?2:0, Math.min(100, Math.round(actPct)))}%;transition:width .25s"></span>
          </span>
          <span style="width:48px;text-align:right;font-weight:800;font-size:12px;flex-shrink:0">${actPct.toFixed(1)}%</span>
        </span>
        <span style="width:120px;text-align:right;font-size:10.5px;color:var(--mut);flex-shrink:0">${cbManwon(Math.max(0,lumpT-actT))}</span>
      </div>
      <div style="font-size:10.5px;color:var(--dim);margin-top:8px;line-height:1.6">※ 상속세 및 증여세법 기준 참고용 시뮬레이션입니다. 실제 신고 시 세무 전문가 확인이 필요합니다. 할인율(기획재정부령 고시 연 3.0%)은 변경될 수 있습니다. 실제 이체 기록 관리가 필요하면 "현금 흐름" 페이지를 사용하세요.</div>
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:16px 18px 12px">
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <div style="font-size:10.5px;letter-spacing:.08em;color:var(--lab)">연도별 누적 증여 시뮬레이션 <span style="color:var(--dim)">· 차트에 마우스를 올리면 연도별 설명이 표시됩니다</span></div>
        <div style="display:flex;gap:14px;font-size:11px;color:var(--mut);flex-wrap:wrap;margin-left:auto">
          ${segs.map(g=>`<span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:${g.color}"></span>${g.label}</span>`).join('')}
          <span style="display:flex;align-items:center;gap:5px"><span style="width:13px;height:0;border-top:2px dashed ${wn}"></span>비과세 한도 (누적)</span>
          <span style="display:flex;align-items:center;gap:5px"><span style="width:13px;height:3px;background:var(--tx)"></span>실제 증여 누적</span>
        </div>
      </div>
      <div style="position:relative" onmouseleave="cbGiftHide()">
        ${cbGiftChartSvg(1100,580)}
        <div style="position:absolute;top:0;bottom:${(22/580*100).toFixed(1)}%;left:${(52/1100*100).toFixed(2)}%;right:${(8/1100*100).toFixed(2)}%">
          ${Array.from({length:40},(_,k)=>`<div style="position:absolute;top:0;bottom:0;left:${(k*2.5).toFixed(1)}%;width:2.5%;cursor:crosshair" onmousemove="cbGiftHover(event,${k})"></div>`).join('')}
        </div>
      </div>
    </div>`;
}
// 시뮬레이션 차트 hover — 연도별 누적 이체/한도/실제 증여 설명 (body 레벨 고정 툴팁)
function cbGiftHover(ev, k){
  const rows = window._cbGiftHover || []; const r = rows[k]; if(!r) return;
  const t = _cbPerfTipEl();
  const line=(lab,val,style='')=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:18px;padding:1.5px 0">
    <span style="color:var(--mut)">${lab}</span><span class="cb-num" style="font-weight:700;${style}">${val}</span></div>`;
  t.innerHTML = `<div style="font-size:10.5px;color:var(--lab);margin-bottom:5px;font-weight:700">${r.year}년 · ${r.age}세 <span style="color:${r.color}">${r.seg}</span></div>
    ${line('월 이체액', cbKrw(r.monthly))}
    ${line('누적 이체 (명목)', cbKrw(r.cumNominal))}
    ${line('비과세 한도 누적', cbKrw(r.cumLimit))}
    ${line('실제 증여 누적', cbKrw(Math.round(r.cumActual)), r.cumActual>r.cumLimit?'color:var(--warn)':'color:var(--up)')}`;
  t.style.display = 'block';
  const rc = t.getBoundingClientRect(); const pad = 16;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + rc.width > window.innerWidth - 8) x = ev.clientX - rc.width - pad;
  if (y + rc.height > window.innerHeight - 8) y = ev.clientY - rc.height - pad;
  t.style.left = Math.max(8, x) + 'px';
  t.style.top = Math.max(8, y) + 'px';
}
function cbGiftHide(){ const t = document.getElementById('cb-perf-tip'); if(t) t.style.display = 'none'; }

// ───────────────────────── 페이지: 양도소득세 ─────────────────────────
let _cbTaxDraft = { m:String(new Date().getMonth()+1), k:'foreign', acc:'일반', pl:'' };
let _cbTaxYear = null;   // 조회 연도(문자열). null이면 올해.
let _cbTaxOwner = '전체'; // 소유주 필터 ('전체'=모든 기록)
function cbTaxOwner(o){ _cbTaxOwner = o; cbRenderTax(); }
const CB_TAX_ACCTS = ['일반','연금저축','ISA'];
const CB_TAX_FGN_DED = 2500000;   // 해외주식 기본공제(일반계좌)
const CB_TAX_ISA_DED = 2000000;   // ISA 비과세 한도(일반형 기준)
function cbTaxAcctOf(t){ return CB_TAX_ACCTS.indexOf(t.account)>=0 ? t.account : '일반'; }
function cbNiceStep(raw){
  raw = Math.max(raw||1, 1);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw/p;
  return (n<=1?1:n<=2?2:n<=5?5:10) * p;
}
function cbTaxAxisLab(v){
  if (v===0) return '0';
  const a = Math.abs(v);
  if (a>=100000000) return (v/100000000).toFixed(a%100000000?1:0)+'억';
  return Math.round(v/10000).toLocaleString('ko-KR')+'만';
}
// 월별 실현손익 막대 — Y축 금액 표기 + 해외 기본공제(250만) 기준선
function cbTaxChartSvg(w,h,list){
  const agg={};
  list.forEach(t=>{ const m=parseInt(String(t.month).split('-')[1]||'0'); if(!m) return;
    const k=m+'-'+(t.category==='domestic'?'d':'f'); agg[k]=(agg[k]||0)+(t.amt||0); });
  const vals=Object.values(agg);
  const DED=CB_TAX_FGN_DED, wn=(typeof cssVar==='function'?cssVar('--warn','#d97706'):'#d97706');
  const rawMax=Math.max(DED*1.15, 1, ...vals.filter(v=>v>0));
  const rawMin=Math.min(0, ...vals.filter(v=>v<0));
  const step=cbNiceStep((rawMax-rawMin)/5);
  const maxV=Math.ceil(rawMax/step)*step, minV=Math.floor(rawMin/step)*step;
  const padL=64, padR=12, padT=14, padB=22;
  const plotW=w-padL-padR, plotH=h-padT-padB, span=(maxV-minV)||1;
  const Y=v=> padT + plotH - ((v-minV)/span)*plotH;
  let out='';
  for(let v=minV; v<=maxV+step*0.01; v+=step){
    const yy=Y(v).toFixed(1);
    out+=`<line x1="${padL}" x2="${w-padR}" y1="${yy}" y2="${yy}" style="stroke:var(--grid)" stroke-width="1"></line>`;
    out+=`<text x="${padL-6}" y="${(Y(v)+3.4).toFixed(1)}" style="fill:var(--lab)" font-size="9.5" text-anchor="end" font-family="IBM Plex Mono">${cbTaxAxisLab(v)}</text>`;
  }
  // 0원 기준선
  out+=`<line x1="${padL}" x2="${w-padR}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" style="stroke:var(--bd2)" stroke-width="1.4"></line>`;
  // 해외 기본공제 250만원 기준선
  const yd=Y(DED).toFixed(1);
  out+=`<line x1="${padL}" x2="${w-padR}" y1="${yd}" y2="${yd}" stroke="${wn}" stroke-width="1.8" stroke-dasharray="7 5"></line>`;
  out+=`<text x="${w-padR-4}" y="${(Y(DED)-5).toFixed(1)}" fill="${wn}" font-size="10.5" font-weight="700" text-anchor="end" font-family="Noto Sans KR">해외 기본공제 250만원</text>`;
  // 월별 막대 (해외/국내)
  const bw=(plotW/12)/2-5;
  for(let m=1;m<=12;m++){
    const xf=padL+(m-1)/12*plotW+5;
    [['f','var(--acc)',0],['d','#4ecdc4',1]].forEach(cfg=>{
      const v=agg[m+'-'+cfg[0]]||0; if(!v) return;
      const yTop=Y(Math.max(0,v)), yBot=Y(Math.min(0,v));
      out+=`<rect x="${(xf+cfg[2]*(bw+3)).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1,yBot-yTop).toFixed(1)}" rx="2" style="fill:${cfg[1]}" opacity=".9"></rect>`;
    });
    out+=`<text x="${(xf+bw).toFixed(1)}" y="${h-6}" style="fill:var(--lab)" font-size="10" text-anchor="middle" font-family="Noto Sans KR">${m}월</text>`;
  }
  return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block">${out}</svg>`;
}
function cbRenderTax(){
  const el = document.getElementById('cb-tax2'); if(!el) return;
  try{ loadMonthlyPL(); }catch(e){}
  const nowY = String(new Date().getFullYear());
  const years = Array.from(new Set([
    ...(monthlyPLData||[]).map(t=>String(t.month||'').slice(0,4)).filter(y=>/^\d{4}$/.test(y)),
    nowY
  ])).sort((a,b)=>b.localeCompare(a));
  const year = (_cbTaxYear && years.includes(_cbTaxYear)) ? _cbTaxYear : nowY;
  let list = (monthlyPLData||[]).filter(t=>String(t.month||'').startsWith(year));
  if (_cbTaxOwner!=='전체') list = list.filter(t=>(t.owner||'전체')===_cbTaxOwner);
  const sumBy = pred => list.filter(pred).reduce((s,t)=>s+(t.amt||0),0);
  // 계좌별 과세 차별화
  const genFgn = sumBy(t=>cbTaxAcctOf(t)==='일반' && t.category!=='domestic');
  const genDom = sumBy(t=>cbTaxAcctOf(t)==='일반' && t.category==='domestic');
  const genBase = Math.max(0, genFgn-CB_TAX_FGN_DED), genDue = Math.round(genBase*0.22);
  const isaNet = sumBy(t=>cbTaxAcctOf(t)==='ISA');
  const isaBase = Math.max(0, isaNet-CB_TAX_ISA_DED), isaDue = Math.round(isaBase*0.099);
  const penNet = sumBy(t=>cbTaxAcctOf(t)==='연금저축');
  const totalDue = genDue + isaDue;
  const sorted = [...list].sort((a,b)=>String(a.month).localeCompare(String(b.month)));
  const row2 = (lab,val,style='') => `<div style="display:flex;justify-content:space-between;font-size:11.5px"><span style="color:var(--mut)">${lab}</span><span style="font-weight:700;${style}">${val}</span></div>`;
  // 소제목·소유주 버튼·조회 연도는 메인 제목 라인(글로벌 헤더)으로
  cbSetHead(
    '계좌(일반·연금저축·ISA)별 실현손익과 예상 세액 · 매도 확정 손익 기준',
    `${cbOwnerBtns(_cbTaxOwner,'cbTaxOwner')}
     <label style="display:flex;align-items:center;gap:7px;font-size:11px;color:var(--lab);font-weight:600">조회 연도
       <select class="cb-input" onchange="cbTaxYear(this.value)" style="padding:6px 9px">${years.map(y=>`<option value="${y}" ${y===year?'selected':''}>${y}년</option>`).join('')}</select>
     </label>`
  );
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(255px,1fr));gap:10px;align-items:stretch">
      <div style="background:var(--upSoft);border:1px solid var(--bd);border-radius:12px;padding:14px 16px;border-top:3px solid var(--dn)">
        <div style="font-size:11px;letter-spacing:.06em;color:var(--lab)">${year}년 예상 납부세액 합계${_cbTaxOwner!=='전체'?' · '+cbEsc(_cbTaxOwner):''}</div>
        <div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:24px;font-weight:800;color:var(--dn);margin-top:2px">${cbKrw(totalDue)}</div>
        <div style="font-size:10.5px;color:var(--dim);margin-top:3px">일반 해외 ${cbKrw(genDue)} + ISA ${cbKrw(isaDue)} · 신고 ${parseInt(year)+1}년 5월</div>
      </div>
      <div class="cb-panel" style="padding:14px 16px">
          <div style="font-size:11px;letter-spacing:.06em;color:var(--lab);margin-bottom:9px">일반 계좌 <span style="color:var(--dim)">· 국내·해외 구분 과세</span></div>
          <div style="border-left:3px solid var(--acc);padding-left:10px;margin-bottom:11px">
            <div style="font-size:11px;font-weight:700;color:var(--tx);margin-bottom:5px">해외주식 <span style="color:var(--dim);font-weight:500">· 양도소득세</span></div>
            <div style="display:flex;flex-direction:column;gap:5px">
              ${row2('실현손익 합계', (genFgn>=0?'+':'')+cbKrw(genFgn), cbUpDn(genFgn))}
              ${row2('<span data-tip="해외주식 양도차익에서 연 250만원까지 비과세">기본공제</span>', '−'+cbKrw(CB_TAX_FGN_DED))}
              ${row2('<span data-tip="실현손익에서 기본공제를 뺀, 세율이 적용되는 금액">과세표준</span>', cbKrw(genBase))}
              ${row2('세율', '22% <span style="color:var(--dim);font-weight:400">(지방세 포함)</span>')}
              <div style="display:flex;justify-content:space-between;align-items:baseline;padding-top:6px;border-top:1px solid var(--bd)"><span style="font-weight:700;font-size:12px">예상 세액</span><span style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:17px;font-weight:800;color:var(--dn)">${cbKrw(genDue)}</span></div>
            </div>
          </div>
          <div style="border-left:3px solid #4ecdc4;padding-left:10px">
            <div style="font-size:11px;font-weight:700;color:var(--tx);margin-bottom:5px">국내주식 <span style="color:var(--dim);font-weight:500">· 소액주주 비과세</span></div>
            <div style="display:flex;flex-direction:column;gap:5px">
              ${row2('실현손익 합계', (genDom>=0?'+':'')+cbKrw(genDom), cbUpDn(genDom))}
              ${row2('<span data-tip="종목당 보유액 50억원 미만·지분율 기준 미만인 일반 투자자">소액주주</span> 장내 양도차익', '<span style="color:var(--up);font-weight:700">비과세</span>')}
              ${row2('<span data-tip="매도 대금에 부과되는 세금(손익과 무관). 코스피 0.15% + 농특세 등, 코스닥 0.15%">증권거래세</span>', '매도액 0.15%')}
              <div style="display:flex;justify-content:space-between;align-items:baseline;padding-top:6px;border-top:1px solid var(--bd)"><span style="font-weight:700;font-size:12px">예상 양도세액</span><span style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:17px;font-weight:800;color:var(--up)">${cbKrw(0)}</span></div>
            </div>
          </div>
        </div>
        <div class="cb-panel" style="padding:14px 16px">
          <div style="font-size:11px;letter-spacing:.06em;color:var(--lab);margin-bottom:9px">ISA 계좌 <span style="color:var(--dim)">· 손익통산 분리과세</span></div>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${row2('순이익 (국내·해외 통산)', (isaNet>=0?'+':'')+cbKrw(isaNet), cbUpDn(isaNet))}
            ${row2('<span data-tip="ISA 일반형 비과세 한도 200만원(서민·농어민형 400만원)">비과세 한도</span>', '−'+cbKrw(CB_TAX_ISA_DED))}
            ${row2('과세표준', cbKrw(isaBase))}
            ${row2('세율', '9.9% <span style="color:var(--dim);font-weight:400">(분리과세)</span>')}
            <div style="display:flex;justify-content:space-between;align-items:baseline;padding-top:7px;border-top:1px solid var(--bd)"><span style="font-weight:700;font-size:12px">예상 세액</span><span style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:18px;font-weight:800;color:var(--dn)">${cbKrw(isaDue)}</span></div>
          </div>
        </div>
        <div class="cb-panel" style="padding:14px 16px">
          <div style="font-size:11px;letter-spacing:.06em;color:var(--lab);margin-bottom:7px">연금저축 계좌 <span style="color:var(--dim)">· 과세이연</span></div>
          ${row2('순이익', (penNet>=0?'+':'')+cbKrw(penNet), cbUpDn(penNet))}
          <div style="font-size:11px;color:var(--mut);margin-top:7px;line-height:1.6">계좌 내 매매 차익은 <b style="color:var(--up)">매도 시 비과세</b>이며, 실제 <b>인출(연금 수령) 시점</b>에 연금소득세(3.3~5.5%) 또는 기타소득세(16.5%)로 과세됩니다. 당해 양도소득세 대상이 아닙니다.</div>
      </div>
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:16px 18px 10px">
      <div style="display:flex;gap:14px;margin-bottom:8px;font-size:11px;color:var(--mut);flex-wrap:wrap">
        <span style="font-size:10.5px;letter-spacing:.08em;color:var(--lab)">${year}년 월별 실현손익</span>
        <span style="display:flex;align-items:center;gap:5px;margin-left:auto"><span style="width:10px;height:10px;border-radius:2px;background:var(--acc)"></span>해외주식</span>
        <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:#4ecdc4"></span>국내주식</span>
      </div>
      ${cbTaxChartSvg(1100,300,list)}
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px">
      <div style="font-size:10.5px;letter-spacing:.08em;color:var(--lab);margin-bottom:10px">실현손익 기록 · ${year}년 내역</div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
        <select id="cb-tax-m" class="cb-input">${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${String(i+1)===_cbTaxDraft.m?'selected':''}>${i+1}월</option>`).join('')}</select>
        <select id="cb-tax-k" class="cb-input"><option value="foreign" ${_cbTaxDraft.k==='foreign'?'selected':''}>해외주식</option><option value="domestic" ${_cbTaxDraft.k==='domestic'?'selected':''}>국내주식</option></select>
        <select id="cb-tax-acc" class="cb-input">${CB_TAX_ACCTS.map(a=>`<option value="${a}" ${a===_cbTaxDraft.acc?'selected':''}>${a}</option>`).join('')}</select>
        <input id="cb-tax-pl" class="cb-input" value="${cbEsc(_cbTaxDraft.pl)}" placeholder="실현손익 (원, 손실은 -)" style="flex:1;min-width:150px" />
        <button onclick="cbTaxAdd()" class="cb-btn" style="padding:8px 14px;font-size:12px">기록</button>
      </div>
      <div style="overflow-x:auto"><div style="min-width:420px">
        <div style="display:flex;font-size:10.5px;color:var(--dim);padding:0 8px 6px;border-bottom:1px solid var(--bd)">
          <span style="width:46px">월</span><span style="width:70px">시장</span><span style="width:78px">계좌</span><span style="width:58px">소유주</span><span style="flex:1;text-align:right">실현손익</span><span style="width:40px"></span>
        </div>
        ${sorted.map(t=>`
          <div style="display:flex;align-items:center;padding:7px 8px;border-bottom:1px solid var(--bd);font-size:12.5px">
            <span style="width:46px;color:var(--mut)">${parseInt(String(t.month).split('-')[1]||'0')}월</span>
            <span style="width:70px;font-weight:600">${t.category==='domestic'?'국내':'해외'}</span>
            <span style="width:78px;font-size:11px"><span style="font-weight:700;padding:1px 7px;border-radius:10px;background:var(--accSoft);color:var(--tx)">${cbEsc(cbTaxAcctOf(t))}</span></span>
            <span style="width:58px;color:var(--mut);font-size:11px">${cbEsc(t.owner||'전체')}</span>
            <span class="cb-num" style="flex:1;text-align:right;font-weight:700;font-size:12px;${cbUpDn(t.amt||0)}">${(t.amt>=0?'+':'')+cbKrw(t.amt||0)}</span>
            <span class="cb-del" onclick="cbTaxDel(${t.id})" style="width:40px;text-align:right">삭제</span>
          </div>`).join('') || '<div style="padding:16px;text-align:center;color:var(--dim);font-size:12px">기록된 실현손익이 없습니다.</div>'}
      </div></div>
    </div>`;
}
function cbTaxYear(y){ _cbTaxYear = y; cbRenderTax(); }
function cbTaxAdd(){
  if (typeof isMobileLayout==='function' && isMobileLayout()) return;
  const m = document.getElementById('cb-tax-m')?.value || '1';
  const k = document.getElementById('cb-tax-k')?.value || 'foreign';
  const acc = document.getElementById('cb-tax-acc')?.value || '일반';
  const raw = (document.getElementById('cb-tax-pl')?.value || '').replace(/,/g,'').trim();
  const pl = parseFloat(raw);
  _cbTaxDraft = { m, k, acc, pl:'' };
  if (raw==='' || isNaN(pl)) { alert('실현손익 금액을 입력하세요.'); return; }
  try{ loadMonthlyPL(); }catch(e){}
  const year = (_cbTaxYear && /^\d{4}$/.test(_cbTaxYear)) ? _cbTaxYear : String(new Date().getFullYear());
  monthlyPLData.push({ id:Date.now(), month:`${year}-${String(m).padStart(2,'0')}`, amt:pl, memo:'', owner:_cbTaxOwner, category:k, account:acc });
  saveMonthlyPL();
  cbRenderTax();
}
function cbTaxDel(id){
  if (typeof isMobileLayout==='function' && isMobileLayout()) return;
  if(!confirm('삭제하시겠습니까?')) return;
  try{ loadMonthlyPL(); }catch(e){}
  monthlyPLData = monthlyPLData.filter(r=>r.id!==id);
  saveMonthlyPL();
  cbRenderTax();
}

// ───────────────────────── 페이지: DCA 자동매수 ─────────────────────────
let _cbDcaOwner = '전체';   // DCA 소유주 필터
function cbDcaOwner(o){ _cbDcaOwner = o; cbRenderDca(); }
function cbDcaPerMonthKRW(i){
  const amtKrw = (i.dcaMode==='qty')
    ? (i.dcaQty||0)*(i.curP||0)*cbRate(i.cur)
    : (i.dcaAmt||0)*cbRate(i.dcaCur||'KRW');
  if (i.dcaCycle==='매주') return amtKrw*4.33;
  if (i.dcaCycle==='매일') return amtKrw*21.7; // 월평균 영업일
  return amtKrw;
}
function cbDcaDayLabel(i){
  if (i.dcaCycle==='매월') return (i.dcaDay!=null && i.dcaDay!=='') ? i.dcaDay+'일' : '—';
  if (i.dcaCycle==='매주'){
    const D=['일','월','화','수','목','금','토'];
    return Array.isArray(i.dcaDays)&&i.dcaDays.length ? i.dcaDays.map(d=>D[d]||'').join('·')+'요일' : '—';
  }
  return '매영업일';
}
function cbRenderDca(){
  const el = document.getElementById('cb-dca2'); if(!el) return;
  const ownerF = (_cbDcaOwner && _cbDcaOwner!=='전체') ? _cbDcaOwner : null;
  const items = (pfolioData||[]).map((i,idx)=>({i,idx}))
    .filter(x=>((x.i.dcaAmt>0)||(x.i.dcaMode==='qty'&&x.i.dcaQty>0)) && (!ownerF || x.i.owner===ownerF));
  const active = items.filter(x=>x.i.dca);
  const monthly = active.reduce((s,x)=>s+cbDcaPerMonthKRW(x.i),0);
  cbSetHead(
    '<span data-tip="Dollar Cost Averaging — 시점을 나눠 일정 금액을 기계적으로 매수해 평균 단가를 관리하는 적립식 투자법">DCA</span> 규칙에 따라 기계적으로 매수합니다 · 규칙 등록은 자산 내역의 종목 수정에서',
    cbOwnerBtns(_cbDcaOwner,'cbDcaOwner')
  );
  el.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div style="flex:1;min-width:170px;background:var(--accSoft);border:1px solid var(--bd);border-radius:12px;padding:12px 14px"><div style="font-size:11px;color:var(--mut)">월 자동매수 합계 (활성 기준)${ownerF?' · '+cbEsc(ownerF):''}</div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;margin-top:2px">${cbDisp(monthly)}</div></div>
      <div class="cb-panel" style="flex:1;min-width:170px;padding:12px 14px"><div style="font-size:11px;color:var(--lab)">활성 규칙</div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;margin-top:2px">${active.length}<span style="font-size:13px;color:var(--lab)"> / ${items.length}</span></div></div>
      <div class="cb-panel" style="flex:1;min-width:170px;padding:12px 14px"><div style="font-size:11px;color:var(--lab)">연간 적립 예상</div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;margin-top:2px">${cbDisp(monthly*12)}</div></div>
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px;overflow-x:auto">
      <div style="display:flex;font-size:10.5px;color:var(--dim);padding:0 8px 7px;border-bottom:1px solid var(--bd);min-width:760px">
        <span style="flex:1">종목</span><span style="width:100px;text-align:right">회당 금액</span><span style="width:64px;text-align:right">주기</span><span style="width:110px;text-align:right">이체일</span><span style="width:120px;text-align:right">계좌</span><span style="width:110px;text-align:right">월 환산</span><span style="width:66px;text-align:center">활성</span><span style="width:44px"></span>
      </div>
      ${items.map(x=>{
        const r=cbRow(x.i,x.idx);
        const amtLabel = x.i.dcaMode==='qty'
          ? (x.i.dcaQty||0).toLocaleString(undefined,{maximumFractionDigits:4})+'주'
          : cbFmtNative(x.i.dcaAmt||0, x.i.dcaCur||'KRW');
        return `
        <div style="display:flex;align-items:center;padding:9px 8px;border-bottom:1px solid var(--bd);font-size:12.5px;min-width:760px;${x.i.dca?'':'opacity:.45'}">
          <div style="flex:1;display:flex;align-items:center;gap:8px;min-width:0">
            ${cbFlagCell(r, 27, 15)}
            <span style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(r.title)} <span style="font-size:10px;color:var(--lab);font-weight:500">${cbEsc(x.i.owner)}</span></span>
          </div>
          <span style="width:100px;text-align:right;font-weight:700">${amtLabel}</span>
          <span style="width:64px;text-align:right;color:var(--mut)">${cbEsc(x.i.dcaCycle||'매월')}</span>
          <span style="width:110px;text-align:right;color:var(--mut)">${cbDcaDayLabel(x.i)}</span>
          <span style="width:120px;text-align:right;color:var(--mut);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(x.i.broker||'—')}</span>
          <span style="width:110px;text-align:right;font-weight:600">${cbDisp(cbDcaPerMonthKRW(x.i))}/월</span>
          <span style="width:66px;display:flex;justify-content:center">
            <span onclick="cbDcaToggle(${x.idx})" style="width:34px;height:19px;border-radius:10px;cursor:pointer;position:relative;transition:background .15s;background:${x.i.dca?'var(--up)':'var(--bd2)'}"><span style="position:absolute;top:2px;width:15px;height:15px;border-radius:50%;background:#fff;transition:left .15s;left:${x.i.dca?'17px':'2px'}"></span></span>
          </span>
          <span class="cb-del" onclick="cbDcaDel(${x.idx})" style="width:44px;text-align:right">삭제</span>
        </div>`;}).join('') || '<div style="padding:16px;text-align:center;color:var(--dim);font-size:12px">등록된 DCA 규칙이 없습니다.</div>'}
    </div>`;
}
function cbDcaToggle(idx){
  const item=pfolioData[idx]; if(!item) return;
  item.dca=!item.dca;
  try{ saveAssetsToKV(); }catch(e){}
  cbRenderDca();
}
function cbDcaDel(idx){
  if(!confirm('DCA 규칙을 삭제하시겠습니까?')) return;
  const item=pfolioData[idx]; if(!item) return;
  item.dca=false; delete item.dcaAmt; delete item.dcaQty; delete item.dcaMode; delete item.dcaCycle; delete item.dcaDay; delete item.dcaDays; delete item.dcaCur;
  try{ saveAssetsToKV(); }catch(e){}
  cbRenderDca();
}

// ───────────────────────── 라우팅 통합 ─────────────────────────
function cbRerender(){
  if (_cobaltActive && CB_VIEWS[_cobaltActive]){
    try{ CB_VIEWS[_cobaltActive](); }catch(e){ console.error('[cobalt render]', e); }
  }
  const fn=document.getElementById('feed-note');
  if (fn) fn.textContent = '전일 종가 연동 · ' + new Date().toLocaleTimeString('ko-KR',{hour:'numeric',minute:'2-digit'});
}

const _cbOrigSwitchView = switchView;
switchView = function(id, btn){
  if (id === 'dashboard'){ id='cdash'; btn = btn || document.getElementById('menu-dashboard'); }
  if (!CB_VIEWS[id]){ _cobaltActive=null; cbSetHead(null, null); return _cbOrigSwitchView(id, btn); }
  _cobaltActive = id;
  try{ if (typeof closeSidebar==='function') closeSidebar(); }catch(e){}
  document.querySelectorAll('.menu-btn').forEach(b=>b.classList.remove('active'));
  const mbtn = btn || document.getElementById('menu-' + (id==='cdash' ? 'dashboard' : id));
  if (mbtn && mbtn.classList) mbtn.classList.add('active');
  document.querySelectorAll('.view-section').forEach(v=>v.classList.remove('active'));
  const v = document.getElementById('view-'+id); if(v) v.classList.add('active');
  const title = document.getElementById('main-title'); if (title) title.textContent = CB_TITLES[id];
  ['owner-tabs-container','cf-owner-bar','bubble-owner-bar','analysis-owner-bar'].forEach(x=>{
    const e=document.getElementById(x); if(e) e.style.display='none';
  });
  try{ CB_VIEWS[id](); }catch(e){ console.error('[cobalt render]', e); }
};

// 데이터 변경/갱신 시 활성 Cobalt 페이지 재렌더
const _cbOrigChangeOwner = changeOwner;
changeOwner = function(owner, btn, isRefresh){
  _cbOrigChangeOwner(owner, btn, isRefresh);
  cbRerender();
};
// 자산 내역에서 추가/수정/삭제 → KV 저장이 일어나면 활성 Cobalt 페이지(대시보드 등)에 즉시 반영
const _cbOrigSaveAssets = saveAssetsToKV;
saveAssetsToKV = async function(){
  const r = await _cbOrigSaveAssets();
  cbRerender();
  return r;
};
// 초기 KV 로드 완료 시에도 대시보드 재렌더 (시세 갱신 실패 시에도 보유 자산은 표시)
const _cbOrigLoadAssets = loadAssetsFromKV;
loadAssetsFromKV = async function(){
  const r = await _cbOrigLoadAssets();
  cbRerender();
  return r;
};
const _cbOrigFetchDivData = fetchDivData;
fetchDivData = async function(){
  await _cbOrigFetchDivData();
  cbRerender();
};
const _cbOrigUpdateBenchmark = updateBenchmark;
updateBenchmark = function(tf, btn){
  _cbOrigUpdateBenchmark(tf, btn);
  if (_cobaltActive === 'perf2') cbRerender();
};
// 테마 전환 시 활성 Cobalt 페이지 재렌더 — 인라인으로 해석된 테마 색(hex)을 새 테마 기준으로 다시 계산
const _cbOrigSetTheme = setTheme;
setTheme = function(mode){
  _cbOrigSetTheme(mode);
  cbRerender();
};
