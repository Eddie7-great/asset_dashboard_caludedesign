// =====================================================================
// cobalt.js — 메인 8페이지 렌더러
// script.js(데이터 엔진)를 그대로 사용하고, 시안 레이아웃으로 렌더링한다.
// 페이지: 대시보드 / 성과 비교 / 가족 자산 / 리스크 진단 / 배당 관리
//        / 가족 증여 / 양도소득세 / DCA 자동매수
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
let _cbDivVerifyPromise = null;
let _cbDivOwner = '전체';      // 배당 관리 소유주 필터
let _cbDivYear = null;         // 배당 캘린더 조회 연도 (null=올해)
let _cbDivMonthFilter = null;  // 캘린더 클릭으로 하단 내역을 거르는 월(0~11)
let _cbRiskOwner = '전체';     // 리스크 진단 소유주 필터
let _cbDcaOwner = '전체';      // DCA 자동매수 소유주 필터
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
const CB_TITLES = { cdash:'대시보드', perf2:'성과 비교', fam2:'가족 자산', risk2:'리스크 진단', divm:'배당 관리', gift2:'가족 증여', tax2:'양도소득세', dca2:'DCA 자동매수' };

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
function cbCostKRW(i){ return i.costUnknown ? 0 : (i.qty||0) * cbAvgNative(i) * cbRate(i.cur); }
function cbGainKRW(i){ return i.grp==='현금' || i.costUnknown ? 0 : cbValKRW(i) - cbCostKRW(i); }

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
// 배당 raw 이력(_divHistoryRawCache) 확보 — 배당성장률(CAGR) 계산의 유일한 소스.
// 첫 렌더 시점에는 pfolioData 가 아직 KV 에서 로드되기 전일 수 있고, 그때 요청하면
// fetchDividendHistory 가 티커 0개로 즉시 return 해 캐시가 영영 비게 된다.
// → 보유 주식이 생긴 뒤에만 요청하고, 캐시가 실제로 채워졌을 때만 가드를 세운다.
function cbEnsureDivHist(){
  if (_cbDivHistRequested) return;
  if (typeof fetchDividendHistory !== 'function') return;
  const hasStock = (pfolioData||[]).some(i=>i.grp==='주식' && (i.qty||0)>0);
  if (!hasStock) return;
  _cbDivHistRequested = true;
  try{
    fetchDividendHistory().then(()=>{
      // 실패해도 같은 화면 렌더 안에서 연속 재시도하지 않는다.
      // 다음 배당 관리 페이지 진입 때 cbVerifyDividendDataOnOpen 이 다시 검증한다.
      cbRerender();
    }).catch(()=>{});
  }catch(e){}
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
  const subTkr = (i.grp==='현금'||i.grp==='금') ? '' : tkr;
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
function cbGoldBarSvg(h){
  h = h || 16;
  const w = Math.round(h*1.5);
  return `<svg width="${w}" height="${h}" viewBox="0 0 36 24" aria-hidden="true" style="display:inline-block;vertical-align:-2px">
    <polygon points="5,9 14,3.5 30,6 21,11.5" fill="#ffe18a"/>
    <polygon points="5,9 21,11.5 21,19 5,16.2" fill="#d9a520"/>
    <polygon points="21,11.5 30,6 30,13.2 21,19" fill="#a96f0b"/>
    <path d="M9 8.2 15 5.1 25 6.7 20 9.8Z" fill="#fff2b5" opacity=".72"/>
  </svg>`;
}
// 배당 관리 페이지에 들어올 때마다 현재 보유 티커와 오늘/7일 캐시의 검증 목록을 대조한다.
// 캐시가 보유 종목을 모두 포함하면 네트워크를 쓰지 않고, 신규 종목·구형 캐시일 때만 다시 조회한다.
function cbVerifyDividendDataOnOpen(){
  if (_cbDivVerifyPromise) return _cbDivVerifyPromise;
  const hasStock = (pfolioData||[]).some(i=>i.grp==='주식' && (i.qty||0)>0);
  if (!hasStock) return Promise.resolve();
  _cbDivHistRequested = true;
  _cbDivVerifyPromise = Promise.all([
    typeof fetchDivData==='function' ? fetchDivData() : Promise.resolve(),
    typeof fetchDividendHistory==='function' ? fetchDividendHistory(false) : Promise.resolve(),
  ]).finally(()=>{
    // 현재 방문에서는 성공·실패와 무관하게 추가 렌더 재시도를 막는다.
    // 검증 함수 자체는 다음 페이지 진입 때 다시 호출된다.
    _cbDivHistRequested = true;
    _cbDivVerifyPromise = null;
    if (_cobaltActive==='divm') cbRenderDiv();
  });
  return _cbDivVerifyPromise;
}
function cbFlagSvg(r, h){
  h = h || 16;
  const mkt = cbFlagMarket(r.cls);
  if (mkt && typeof _mktFlagSvg==='function') return _mktFlagSvg(mkt, h);
  if (r.cls==='gold') return cbGoldBarSvg(h);
  const icon = { crypto:{c:CB_CLS.crypto.color,t:'₿'}, cash:{c:CB_CLS.cash.color,t:'₩'} }[r.cls]
    || { c:(r.cl&&r.cl.color)||'#8a97b0', t:'•' };
  const w = Math.round(h*1.5);
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${w}px;height:${h}px;border-radius:3px;font-size:${Math.round(h*0.66)}px;font-weight:800;background:${icon.c}22;color:${icon.c};vertical-align:-2px">${icon.t}</span>`;
}
// 국기 슬롯(고정폭, 세로 중앙) — 표 행 좌측 아이콘 칸
function cbFlagCell(r, slot, h){
  return `<span style="width:${slot||30}px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">${cbFlagSvg(r, h||16)}</span>`;
}
function cbAccountLabel(i){
  const broker = String((i&&i.broker)||'').trim();
  const account = String((i&&i.acc)||'').trim();
  return [broker,account].filter(Boolean).join(' / ');
}
function cbBrokerLabel(i){ return String((i&&i.broker)||'미지정').trim() || '미지정'; }
function cbBrokerWeightTip(r){
  return (r.brokerWeights||[]).map(x=>`${x.broker} ${x.pct.toFixed(2)}%`).join('\n');
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
      g._items.push(r.i);
      const accountLabel = cbAccountLabel(r.i); if (accountLabel) g.accts.add(accountLabel);
      const brokerLabel = cbBrokerLabel(r.i);
      g.brokers.set(brokerLabel, (g.brokers.get(brokerLabel)||0) + r.val);
    } else {
      const accountLabel = cbAccountLabel(r.i);
      const brokerLabel = cbBrokerLabel(r.i);
      m.set(key, { key, i:r.i, idx:r.idx, cls:r.cls, cl:r.cl, title:r.title, name:r.name,
        tkr:r.tkr, subTitle:r.subTitle, chip:r.chip,
        qty:(r.i.qty||0), val:r.val, cost:r.cost, gain:r.gain,
        _items:[r.i], accts:new Set(accountLabel?[accountLabel]:[]),
        brokers:new Map([[brokerLabel,r.val]]) });
    }
  });
  return Array.from(m.values()).map(g=>{
    const rate = cbRate(g.i.cur);
    const acctList = Array.from(g.accts);
    const brokerWeights = Array.from(g.brokers, ([broker,val])=>({
      broker, val, pct:g.val>0 ? val/g.val*100 : 0,
    })).sort((a,b)=>b.val-a.val);
    return { ...g,
      merged: g._items.length>1,
      acctList,
      accountCount: acctList.length,
      brokerWeights,
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
function cbSortDividendRows(rows){
  const ownerRank = o => { const k=OWNERS.indexOf(o); return k<0 ? 99 : k; };
  const countryRank = r => ({kr:0,us:1,jp:2})[r.cls] ?? 9;
  return rows.slice().sort((a,b)=>
    (ownerRank(a.i.owner)-ownerRank(b.i.owner))
    || (countryRank(a)-countryRank(b))
    || String(a.title||'').localeCompare(String(b.title||''), 'ko')
    || ((Number(b.incomeKRW)||0)-(Number(a.incomeKRW)||0)));
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
  const base = (pfolioData||[]).filter(i=>i && i.grp!=='부동산' && (i.qty||0)>0
    && (!ownerFilter || i.owner===ownerFilter));
  const itemValue = i => typeof _bubbleItemValueKRW==='function'
    ? _bubbleItemValueKRW(i, RATES.USD||1380)
    : cbValKRW(i);
  // 대시보드와 비중 차트 모두 현금·금까지 포함한 전체 포트폴리오를 분모로 사용한다.
  // 표시 목록은 섹터 집중도 성격에 맞게 주식(+선택 시 가상화폐)만 유지한다.
  const total = base.reduce((sum,i)=>sum+Math.max(0,itemValue(i)),0);
  const eq = base.filter(i=>i.grp==='주식' || (includeCrypto && i.grp==='가상화폐'));
  const totals = {};
  eq.forEach(i=>{ const v = itemValue(i); if(v<=0) return;
    const s = i.grp==='가상화폐' ? 'Crypto'
      : ((typeof _gicsSector==='function' ? _gicsSector(i) : '기타') || '기타');
    totals[s] = (totals[s]||0) + v; });
  const list = Object.keys(totals).map(s=>({label:s, v:totals[s], pct:total? totals[s]/total*100 : 0}))
    .sort((a,b)=>b.v-a.v);
  let n=0; // Crypto는 자산군 고정색, 나머지 섹터만 팔레트 순번 배정
  list.forEach(s=>{ s.color = s.label==='Crypto' ? CB_CLS.crypto.color : CB_SEC_PALETTE[(n++) % CB_SEC_PALETTE.length]; });
  return { list, total };
}

// ───────────────────────── ETF 룩스루 (구성종목 합산) ─────────────────────────
// 구성종목은 GitHub Actions 배치(scripts/collect_etf_holdings.py)가 평일 18:30에 수집해
// data/etf_holdings.json 으로 커밋한다. 브라우저는 그 파일만 읽는다 —
// 외부 사이트를 직접 fetch 하면 CORS 로 막히고, 서버리스 경유는 KRX 왕복이 함수 제한시간을 넘긴다.
// 개별 주식으로 직접 보유하지 않은 구성종목은 계산하지 않는다(요구사항).
let _cbEtfLoading = false;

function cbEtfDoc(){ return window._etfHoldings || null; }

async function cbEnsureEtfHoldings(){
  if (_cbEtfLoading || window._etfHoldings !== undefined) return;
  _cbEtfLoading = true;
  try{
    // 페이지를 다시 열 때 서버에 최신 여부만 조건부 확인한다.
    // 브라우저 캐시가 최신이면 ETag/Last-Modified 재검증 후 기존 본문을 재사용한다.
    const r = await fetch('data/etf_holdings.json', { cache:'no-cache' });
    window._etfHoldings = r.ok ? await r.json() : null;
  }catch(e){ window._etfHoldings = null; }
  finally{ _cbEtfLoading = false; }
  cbRerender();
}

function cbIsEtf(i){
  if (!i || i.grp!=='주식') return false;
  const market = String(i.market || i.marketType || i.type || '').toUpperCase();
  if (market === 'ETF' || market.endsWith(' ETF')) return true;
  const code = cbStrip(i.tkr);
  const db = window._krStocksDB;
  const meta = db && db.byCode && typeof db.byCode.get==='function' ? db.byCode.get(code) : null;
  if (meta && String(meta.market || '').toUpperCase()==='ETF') return true;
  return typeof _gicsSector==='function' && /ETF$/.test(_gicsSector(i)||'');
}

// 단일 기초자산 레버리지 ETF는 일반 구성종목 목록 대신 기초자산·노출배수를 해석한다.
// 회사 집중도는 직접 보유한 개별 회사와의 교집합만 표시하므로 ETHU 같은 가상화폐
// 파생 ETF는 회사 행으로 나오지 않고, 이미 해석된 상품이므로 미조회 각주에도 표시하지 않는다.
function cbSyntheticEtfHoldings(i){
  const ticker = cbStrip(i && i.tkr);
  const name = String(i && i.name || '').toUpperCase();
  if (ticker==='ETHU' || (/(2X|ULTRA)/.test(name) && /(ETHER|ETHEREUM|이더리움)/.test(name))){
    return [{ t:'ETH', n:'이더리움', w:200 }];
  }
  return null;
}

// 레버리지·인버스 노출은 ETF 평가액 자체를 순자산과 비교한다.
// 국내 상품명 규칙과 해외 대표 티커/영문 상품명 규칙을 함께 사용해 특정 ETF에 한정하지 않는다.
function cbLeveragedInverseMeta(i){
  if (!cbIsEtf(i)) return null;
  const ticker = cbStrip(i && i.tkr);
  const name = String(i && i.name || '').toUpperCase();
  const inverseTickers = new Set([
    'SH','PSQ','DOG','RWM','SQQQ','QID','SPXU','SDS','SOXS','LABD','TECS','TZA','SDOW',
  ]);
  const leveragedTickers = new Set([
    'QLD','TQQQ','UPRO','SSO','SOXL','LABU','TECL','TNA','UDOW','FNGU','NAIL','WANT',
    'USD','BITU','ETHU',
  ]);
  const inverse = inverseTickers.has(ticker)
    || /인버스|곱버스|INVERSE|ULTRASHORT|SHORT|BEAR/.test(name);
  const leveraged = leveragedTickers.has(ticker)
    || /레버리지|LEVERAG|ULTRAPRO|(?:^|[\s(])ULTRA(?:[\s)]|$)|(?:^|[\s(+-])[23](?:\.\d+)?\s*(?:X|배)(?:[\s)]|$)|BULL\s*[23](?:\.\d+)?X/.test(name);
  if (!inverse && !leveraged) return null;
  return { kind: inverse ? '인버스' : '레버리지', ticker };
}

function cbLookThrough(ownerFilter){
  const doc = cbEtfDoc();
  const rows = cbAllRows().filter(r=>!ownerFilter || r.i.owner===ownerFilter);
  const nw = rows.reduce((s,r)=>s+r.val,0) || 1;
  // 직접 보유한 개별 종목(주식만, ETF 제외).
  // 화면 표시는 티커별로 합산하되, ETF 간접 보유는 반드시 같은 소유주의 직접 종목에만 더한다.
  const direct = new Map();
  const directByOwner = new Map();
  rows.forEach(r=>{
    if (r.i.grp!=='주식' || cbIsEtf(r.i)) return;
    const s = cbStrip(r.i.tkr); if(!s) return;
    const ownerKey = String(r.i.owner||'') + '::' + s;
    const od = directByOwner.get(ownerKey) || { val:0 };
    od.val += r.val; directByOwner.set(ownerKey, od);
    const d = direct.get(s) || { tkr:s, title:r.title, val:0, via:0, etfs:[], owners:new Set() };
    d.val += r.val;
    d.owners.add(r.i.owner||'미지정');
    direct.set(s, d);
  });
  let etfCount = 0; const etfMiss = [];
  rows.forEach(r=>{
    if (!cbIsEtf(r.i)) return;
    etfCount++;
    const strip = cbStrip(r.i.tkr);
    const ent = doc && doc.etfs ? doc.etfs[strip] : null;
    const collected = (ent && Array.isArray(ent.holdings)) ? ent.holdings : null;
    const holdings = (collected && collected.length) ? collected : cbSyntheticEtfHoldings(r.i);
    // 수집 데이터가 없는 ETF는 간접 보유분 없이 넘어가고 각주에 이름만 남긴다
    if (!holdings || !holdings.length){
      if (doc && etfMiss.indexOf(r.title)<0) etfMiss.push(r.title);
      return;
    }
    holdings.forEach(h=>{
      const ticker = cbStrip(h.t);
      const ownerKey = String(r.i.owner||'') + '::' + ticker;
      if (!directByOwner.has(ownerKey)) return; // 같은 소유주의 직접 보유가 없으면 계산 제외
      const d = direct.get(ticker);
      if (!d) return;
      const w = Number(h.w)||0;
      const add = r.val * w / 100;
      if (add<=0) return;
      d.via += add;
      d.etfs.push({ owner:r.i.owner||'', etf:r.title, w: w, val:add });
    });
  });
  const list = Array.from(direct.values())
    .map(d=>({ ...d, tot:d.val+d.via, pct:(d.val+d.via)/nw*100, dPct:d.val/nw*100, vPct:d.via/nw*100 }))
    .sort((a,b)=>b.tot-a.tot);
  return { list, nw, etfCount, etfMiss, loaded: !!doc };
}

// 리스크 규칙 진단 (시안 로직 이식)
function cbRisk(ownerFilter){
  const rows = cbAllRows().filter(r=>!ownerFilter || r.i.owner===ownerFilter);
  const nw = rows.reduce((s,r)=>s+r.val,0) || 1;
  const byCls = {}; rows.forEach(r=>{ byCls[r.cls]=(byCls[r.cls]||0)+r.val; });
  const secs0 = cbSectors(false, ownerFilter).list;
  const pctOf = v => v/nw*100;
  // 단일 종목 집중도 역시 개별 회사만 대상으로 하며 ETF 자체·가상화폐·금은 제외한다.
  // ETF 간접 보유분은 cbLookThrough에서 같은 소유주의 직접 보유 회사와 겹치는 부분만 합산된다.
  const top = cbLookThrough(ownerFilter).list[0];
  const topPct = top ? top.pct : 0;
  const cryptoPct = pctOf(byCls.crypto||0), cashPct = pctOf(byCls.cash||0);
  const fxPct = pctOf(rows.filter(r=>r.i.cur && r.i.cur!=='KRW').reduce((s,r)=>s+r.val,0));
  const leveragedInverse = rows
    .map(r=>({ r, meta:cbLeveragedInverseMeta(r.i) }))
    .filter(x=>x.meta)
    .sort((a,b)=>b.r.val-a.r.val);
  const leveragedInverseVal = leveragedInverse.reduce((s,x)=>s+x.r.val,0);
  const leveragedInversePct = pctOf(leveragedInverseVal);
  const leveragedInverseTop = leveragedInverse[0] || null;
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
    const fillRaw = invert ? Math.min(100, val/(thWarn*2)*100) : val;
    return { title, valFmt, status:['양호','주의','경고'][lvl], color,
      // 0% 항목에 최소 너비를 강제로 칠하지 않는다. 소유주별 실제 비중과 막대 길이를 일치시킨다.
      fill: Math.max(0, Math.min(100, Math.round(fillRaw))),
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
    mk('레버리지·인버스 노출도', leveragedInversePct, leveragedInversePct.toFixed(1)+'%', 5, 10,
      leveragedInverseTop
        ? [
            leveragedInverse.length+'개 상품을 보유 중이며 최대 기여 상품은 '+leveragedInverseTop.r.title+'입니다.',
            '순자산의 5%를 넘습니다. 최대 기여 상품 '+leveragedInverseTop.r.title+'의 변동성에 유의하세요.',
            '순자산의 10%를 초과합니다. 최대 기여 상품 '+leveragedInverseTop.r.title+'의 비중 축소를 검토하세요.',
          ]
        : [
            '보유 중인 레버리지·인버스 상품이 없습니다.',
            '레버리지·인버스 상품 비중을 점검하세요.',
            '레버리지·인버스 상품 비중 축소를 검토하세요.',
          ]),
  ];
  cards[cards.length-1].tip = '레버리지·인버스 ETF의 현재 평가액 합계를 선택한 소유주의 순자산으로 나눈 비중입니다. 5% 초과는 주의, 10% 초과는 경고로 표시합니다.';
  const score = Math.max(0, Math.min(100, 100 - cards.reduce((s,c)=>s+c.lvl*10,0)));
  return { score, grade: score>=75?'안정적':score>=50?'주의 필요':'고위험',
    color: score>=75?upC:score>=50?wnC:dnC,
    warns: cards.filter(c=>c.lvl>0).length,
    vol, cryptoPct, fxPct, cashPct, leveragedInversePct,
    leveragedInverseCount: leveragedInverse.length,
    leveragedInverseTop: leveragedInverseTop ? leveragedInverseTop.r.title : '',
    cards };
}

// 리스크 보조 진단 8종 — 기존 0~100점 감점 규칙과 분리해 중복 감점을 피한다.
// 각 지표는 현재 선택한 소유주 범위를 그대로 따르며, 전체 모드에서는 가구 합산 기준이다.
function cbRiskInsights(ownerFilter, baseRisk){
  const rows = cbAllRows().filter(r=>!ownerFilter || r.i.owner===ownerFilter);
  const nw = rows.reduce((s,r)=>s+r.val,0) || 1;
  const up='var(--up)', warn='var(--warn)', down='var(--dn)';
  const toneHigh=(value,warnAt,badAt)=>value>badAt?down:value>warnAt?warn:up;
  const toneLow=(value,warnAt,badAt)=>value<badAt?down:value<warnAt?warn:up;

  // 직접 보유 회사와 ETF 편입 종목이 겹쳐 생긴 간접 보유분의 순자산 대비 비중.
  const look=cbLookThrough(ownerFilter);
  const overlapVal=look.list.reduce((s,x)=>s+(Number(x.via)||0),0);
  const overlapPct=overlapVal/nw*100;

  // HHI 역수: 동일 소유주·종목의 여러 계좌를 합친 뒤 실제 비중으로 환산한다.
  const merged=cbMergeRows(rows);
  const hhi=merged.reduce((s,x)=>s+Math.pow((Number(x.val)||0)/nw,2),0);
  const effectiveCount=hhi>0?1/hhi:0;

  // 환율이 일괄 10% 하락한다고 가정한 단순 민감도(가격 변동·환헤지 효과는 제외).
  const fxPct=Number(baseRisk?.fxPct)||0;
  const fxShockPct=fxPct*0.10;
  const fxShockVal=nw*fxShockPct/100;

  // 상장통화와 상품명으로 투자 지역을 추정한다. 광역·글로벌 ETF는 별도 지역으로 남긴다.
  const countryOf=r=>{
    if(r.i.grp!=='주식') return null;
    const text=`${r.i.name||''} ${r.i.tkr||''}`.toUpperCase();
    if(/미국|NASDAQ|S&P|DOW\s*JONES|RUSSELL/.test(text)) return '미국';
    if(/일본|NIKKEI|TOPIX/.test(text)) return '일본';
    if(/중국|CHINA|CSI\s*\d|HANG\s*SENG/.test(text)) return '중국';
    if(/유럽|EUROPE|EURO\s*STOXX|STOXX\s*EUROPE/.test(text)) return '유럽';
    if(/글로벌|GLOBAL|WORLD|ACWI/.test(text)) return '글로벌';
    if(r.cls==='us'||r.i.cur==='USD') return '미국';
    if(r.cls==='jp'||r.i.cur==='JPY') return '일본';
    return '한국';
  };
  const countries={};
  rows.forEach(r=>{
    const country=countryOf(r);
    if(country) countries[country]=(countries[country]||0)+r.val;
  });
  const topCountry=Object.entries(countries).sort((a,b)=>b[1]-a[1])[0]||['주식 없음',0];
  const topCountryPct=topCountry[1]/nw*100;

  const sectors=cbSectors(false,ownerFilter).list;
  const topTwoSectors=sectors.slice(0,2);
  const topTwoSectorPct=topTwoSectors.reduce((s,x)=>s+x.pct,0);
  const topTwoSectorNames=topTwoSectors.map(x=>x.label).join(' + ')||'섹터 없음';

  // 같은 티커라도 소유주가 다르면 별도 배당원으로 유지한다.
  const dividendMap=new Map();
  rows.forEach(r=>{
    const amount=cbDivIncomeKRW(r.i);
    if(!(amount>0)) return;
    const key=`${r.i.owner||''}::${cbStrip(r.i.tkr)||r.title}`;
    dividendMap.set(key,(dividendMap.get(key)||0)+amount);
  });
  const dividendSources=Array.from(dividendMap.values()).sort((a,b)=>b-a);
  const dividendAnnual=dividendSources.reduce((s,x)=>s+x,0);
  const dividendTop3=dividendSources.slice(0,3).reduce((s,x)=>s+x,0);
  const dividendTop3Pct=dividendAnnual>0?dividendTop3/dividendAnnual*100:0;

  // 현금성 자산이 월 DCA 약정과 등록된 정기지출을 몇 개월 감당하는지 계산한다.
  const cashVal=rows.filter(r=>r.cls==='cash').reduce((s,r)=>s+r.val,0);
  const dcaMonthly=(pfolioData||[])
    .filter(i=>i&&i.dca&&(!ownerFilter||i.owner===ownerFilter))
    .reduce((s,i)=>s+(typeof cbDcaPerMonthKRW==='function'?cbDcaPerMonthKRW(i):0),0);
  const today=new Date();
  const daysInMonth=new Date(today.getFullYear(),today.getMonth()+1,0).getDate();
  const recurringExpense=(typeof autoTransferData!=='undefined'&&Array.isArray(autoTransferData)
    ? autoTransferData : []).filter(at=>
      at&&at.type==='지출'&&at.cat!=='저축/투자'&&(!ownerFilter||at.owner===ownerFilter)
    ).reduce((s,at)=>{
      const amount=typeof _effectiveAutoTransferAmt==='function'
        ? _effectiveAutoTransferAmt(at,today.getFullYear(),today.getMonth()+1)
        : Number(at.amt)||0;
      const times=at.cycle==='daily'?daysInMonth:at.cycle==='weekly'?daysInMonth/7:1;
      return s+amount*times;
    },0);
  const monthlyCommitment=dcaMonthly+recurringExpense;
  const liquidityMonths=monthlyCommitment>0?cashVal/monthlyCommitment:null;

  // 취득가를 아는 투자자산만 사용해 현재 평가손실에서 원금까지 필요한 반등률을 계산한다.
  const recoveryRows=rows.filter(r=>r.i.grp!=='현금'&&!r.i.costUnknown&&r.cost>0);
  const recoveryValue=recoveryRows.reduce((s,r)=>s+r.val,0);
  const recoveryCost=recoveryRows.reduce((s,r)=>s+r.cost,0);
  const recoveryPct=recoveryCost>recoveryValue&&recoveryValue>0
    ? (recoveryCost-recoveryValue)/recoveryValue*100 : 0;

  return [
    {
      id:'etf-overlap', title:'ETF 중복 노출률', value:overlapPct.toFixed(1)+'%',
      detail:overlapPct>0?`간접 중복 ${cbDisp(overlapVal)}`:'직접·간접 중복 없음',
      tone:toneHigh(overlapPct,5,15),
      tip:'직접 보유한 개별 회사와 보유 ETF 구성종목이 겹쳐 추가된 간접 보유분을 순자산으로 나눈 비중입니다.',
    },
    {
      id:'effective-holdings', title:'실효 종목 수', value:effectiveCount.toFixed(1)+'개',
      detail:`실제 ${merged.length}종목 · HHI 역수`,
      tone:toneLow(effectiveCount,10,6),
      tip:'각 종목 비중 제곱합(HHI)의 역수입니다. 종목 수가 많아도 일부에 쏠리면 실효 종목 수는 작아집니다.',
    },
    {
      id:'fx-shock', title:'환율 -10% 충격', value:'−'+fxShockPct.toFixed(1)+'%',
      detail:fxShockVal>0?`예상 감소 ${cbDisp(fxShockVal)}`:'외화 자산 없음',
      tone:toneHigh(fxShockPct,5,8),
      tip:'외화 표시 자산의 환율만 10% 하락하고 자산 가격은 그대로라고 가정한 단순 민감도입니다.',
    },
    {
      id:'country-concentration', title:'국가별 최대 집중도',
      value:topCountry[1]>0?`${topCountry[0]} ${topCountryPct.toFixed(1)}%`:'주식 없음',
      detail:'상장통화·상품명 기준 추정',
      tone:toneHigh(topCountryPct,45,65),
      tip:'주식과 ETF의 상장통화 및 상품명으로 투자 지역을 추정한 뒤 전체 순자산 대비 최대 지역 비중을 표시합니다.',
    },
    {
      id:'top2-sectors', title:'상위 2개 섹터 집중도', value:topTwoSectorPct.toFixed(1)+'%',
      detail:topTwoSectorNames,
      tone:toneHigh(topTwoSectorPct,50,70),
      tip:'가장 큰 두 주식 섹터의 비중을 합산합니다. 비중 분모에는 현금·금·가상화폐를 포함한 전체 순자산을 사용합니다.',
    },
    {
      id:'dividend-dependency', title:'배당원 TOP3 의존도',
      value:dividendAnnual>0?dividendTop3Pct.toFixed(1)+'%':'배당 없음',
      detail:dividendAnnual>0?`연 배당 ${cbDisp(dividendAnnual)}`:'배당 데이터 없음',
      tone:dividendAnnual>0?toneHigh(dividendTop3Pct,45,70):warn,
      tip:'연간 예상 배당수입 중 가장 큰 세 개 배당원이 차지하는 비중입니다. 소유주가 다르면 같은 종목도 별도로 계산합니다.',
    },
    {
      id:'liquidity-coverage', title:'현금 유동성 커버리지',
      value:liquidityMonths==null?'약정 없음':liquidityMonths.toFixed(1)+'개월',
      detail:monthlyCommitment>0?`월 약정 ${cbDisp(monthlyCommitment)}`:`현금 ${cbDisp(cashVal)}`,
      tone:liquidityMonths==null?up:toneLow(liquidityMonths,3,1),
      tip:'현금성 자산을 월 DCA 자동매수액과 등록된 정기지출 합계로 나눈 값입니다.',
    },
    {
      id:'recovery-return', title:'손실 회복 필요 수익률',
      value:recoveryRows.length?recoveryPct.toFixed(1)+'%':'산정 제외',
      detail:recoveryPct>0?'현재 평가손실에서 원금 기준':'평가손실 없음',
      tone:toneHigh(recoveryPct,10,25),
      tip:'취득가를 아는 투자자산의 현재 평가액이 매입원가로 회복하려면 필요한 상승률입니다. 취득가 미상 자산과 현금은 제외합니다.',
    },
  ];
}

// ───────────────────────── SVG 빌더 ─────────────────────────
function cbDonutSvg(segs, size, clickFn){
  // 자산 배분은 항목 간 비율 비교에 도넛이 적합하다. 중앙 공백만 줄여 실제 데이터 면적을 넓힌다.
  const stroke=size*0.24, r=size/2-stroke/2, c=2*Math.PI*r; let off=0;
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
  if (!all.length) return `<div style="height:${h}px;display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:12px">벤치마크 데이터 로딩 중… (전일 종가 갱신을 눌러주세요)</div>`;
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
    // 렌더 애니메이션: 실선(벤치마크)은 드로잉, 점선(소유주)은 목표 불투명도까지 페이드 인
    const anim = s.isBench ? 'class="cb-line-draw" pathLength="1"' : `class="cb-line-fade" style="--o:${op}"`;
    out+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.bold?2.8:1.8}" stroke-linejoin="round" stroke-linecap="round" opacity="${op}" ${s.dash?'stroke-dasharray="5 5"':''} ${anim}></path>`;
  });
  // 균일 스케일(meet) + width:100%/height:auto 로 종횡비 유지 → 텍스트가 가로로 늘어나지 않는다.
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:auto">${out}</svg>`;
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
      <span class="cb-tip-block" data-overflow-tip="${cbEsc(r.title)}" style="flex:1;min-width:0">
        <span data-overflow-watch style="display:block;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(r.title)} <span style="color:var(--dim)">· ${cbEsc(r.i.owner)}</span></span>
      </span>
      <span style="font-weight:600;flex-shrink:0">${cbDisp(r.val)}</span>
      <span class="cb-num" style="width:46px;text-align:right;font-weight:700;color:var(--lab);flex-shrink:0">${baseV>0?(r.val/baseV*100).toFixed(1):'0.0'}%</span>
    </div>`;

  // 동일 소유주+종목(다계좌) 합산 → 검색 필터 → 정렬 (소유주 → 종목명 → 평가금액 오름차순)
  const mergedRows = cbMergeRows(rows);
  const q=(_cdashQ||'').trim().toLowerCase();
  const filtered = q ? mergedRows.filter(r=>((r.i.tkr||'')+' '+(r.i.name||'')+' '+r.cl.label+' '+(r.i.owner||'')).toLowerCase().includes(q)) : mergedRows;
  const held = cbSortOwnerNameVal(filtered);
  const rankedMovers = mergedRows.filter(r=>r.gainPct!=null && Number.isFinite(r.gainPct));
  const topGainers = rankedMovers.filter(r=>r.gainPct>0).sort((a,b)=>b.gainPct-a.gainPct).slice(0,5);
  const topLosers = rankedMovers.filter(r=>r.gainPct<0).sort((a,b)=>a.gainPct-b.gainPct).slice(0,5);
  // 수익률 순위가 작은 보유액을 과대평가하지 않도록 실제 원화 평가손익의 절대 기여도를 별도로 비교한다.
  const contributionRows = mergedRows
    .filter(r=>r.i.grp!=='현금' && Number.isFinite(r.gain) && Math.abs(r.gain)>0)
    .sort((a,b)=>Math.abs(b.gain)-Math.abs(a.gain))
    .slice(0,6);
  const contributionMax = Math.max(1,...contributionRows.map(r=>Math.abs(r.gain)));
  const contributionGain = mergedRows.reduce((s,r)=>s+Math.max(0,r.gain||0),0);
  const contributionLoss = mergedRows.reduce((s,r)=>s+Math.min(0,r.gain||0),0);
  const moverCard = (title, list, tone, empty) => `
    <div class="cb-panel cb-mover-card">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:7px;margin-bottom:5px">
        <span style="font-size:10.5px;letter-spacing:.08em;color:var(--lab);font-weight:700">${title}</span>
        <span style="font-size:9.5px;color:var(--dim)">${ownerF?cbEsc(ownerF):'전체 소유주'}</span>
      </div>
      ${list.map((r,n)=>`
        <div class="cb-mover-row">
          <span class="cb-num" style="width:13px;color:var(--dim);font-size:9.5px;flex-shrink:0">${n+1}</span>
          <span class="cb-tip-block" data-overflow-tip="${cbEsc([r.title,r.subTitle,!ownerF?r.i.owner:''].filter(Boolean).join(' · '))}" style="flex:1;min-width:0">
            <span data-overflow-watch style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:var(--mut)">${cbEsc(r.title)}${!ownerF?` <span class="cb-mover-owner">· ${cbEsc(r.i.owner)}</span>`:''}</span>
          </span>
          <span class="cb-num" style="font-weight:800;flex-shrink:0;color:${tone}">${cbPct(r.gainPct)}</span>
        </div>`).join('') || `<div style="padding:18px 2px;text-align:center;color:var(--dim);font-size:11px">${empty}</div>`}
    </div>`;
  const contributionCard = `
    <div class="cb-panel cb-dash-contrib-card">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:7px">
        <span data-tip="각 종목의 평가손익 원화 금액을 절대값 순으로 비교합니다. 막대 길이는 가장 큰 손익 대비 상대 크기이며 전체 비율은 아닙니다." style="font-size:10.5px;letter-spacing:.08em;color:var(--lab);font-weight:700">평가손익 기여도</span>
        <span style="font-size:9.5px;color:var(--dim);white-space:nowrap">${ownerF?cbEsc(ownerF):'전체 소유주'}</span>
      </div>
      <div class="cb-contrib-summary">
        <span>이익 기여 <b class="cb-num" style="color:var(--up)">${cbSignDisp(contributionGain)}</b></span>
        <span>손실 기여 <b class="cb-num" style="color:var(--dn)">${contributionLoss<0?cbDisp(contributionLoss):cbDisp(0)}</b></span>
      </div>
      <div class="cb-contrib-list">
        ${contributionRows.map(r=>{
          const width=Math.max(2,Math.min(49,Math.abs(r.gain)/contributionMax*49));
          const tip=[r.title,r.subTitle,_cdashOwner==='전체'?r.i.owner:''].filter(Boolean).join(' · ');
          return `
          <div class="cb-contrib-row">
            <div class="cb-contrib-row-head">
              <span class="cb-tip-block" data-overflow-tip="${cbEsc(tip)}" style="display:flex;align-items:center;gap:5px;min-width:0;flex:1">
                <span style="width:6px;height:6px;border-radius:50%;background:${cbOwnerColor(r.i.owner)};flex-shrink:0"></span>
                <span data-overflow-watch style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650;color:var(--mut)">${cbEsc(r.title)}${_cdashOwner==='전체'?` <span style="color:var(--dim);font-weight:500">· ${cbEsc(r.i.owner)}</span>`:''}</span>
              </span>
              <b class="cb-num" style="${cbUpDn(r.gain)};flex-shrink:0">${cbSignDisp(r.gain)}</b>
            </div>
            <div class="cb-contrib-track" aria-label="${cbEsc(r.title)} 평가손익 ${cbEsc(cbSignDisp(r.gain))}">
              <span class="cb-contrib-axis"></span>
              <span class="cb-contrib-bar" style="${r.gain>=0?'left:50%':'right:50%'};width:${width}%;background:${r.gain>=0?'var(--up)':'var(--dn)'}"></span>
            </div>
          </div>`;
        }).join('') || '<div style="margin:auto;text-align:center;color:var(--dim);font-size:11px">평가손익 데이터가 없습니다</div>'}
      </div>
    </div>`;

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
    const cell = (lab,val,style='',cls='',outerStyle='') => `<div style="${outerStyle}"><div style="font-size:10px;color:var(--lab)">${lab}</div><div class="${cls}" style="font-size:14px;font-weight:700;margin-top:1px;${style}">${val}</div></div>`;
    selPanel = `
      <div style="display:flex;align-items:flex-start;gap:8px">
        <span style="flex-shrink:0;margin-top:1px">${cbFlagSvg(sel, 18)}</span>
        <div style="min-width:0;flex:1">
          <div class="cb-tip-block" data-overflow-tip="${cbEsc(sel.i.name||sel.i.tkr)}"><span data-overflow-watch style="display:block;font-size:14px;font-weight:800;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(sel.i.name||sel.i.tkr)}</span></div>
          <div class="cb-tip-block" data-overflow-tip="${cbEsc([sel.tkr,sel.cl.label,sel.i.owner,acctTxt].filter(Boolean).join(' · '))}"><span data-overflow-watch style="display:block;font-size:10.5px;color:var(--lab);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(sel.tkr)} · ${sel.cl.label} · ${cbEsc(sel.i.owner)}${acctTxt?' · '+cbEsc(acctTxt):''}</span></div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 12px;margin-top:12px">
        ${cell('평가액', cbDisp(sel.val))}
        ${cell('평가손익', sel.i.grp==='현금'?'—':(sel.i.costUnknown?'산정 제외':cbSignDisp(sel.gain)), sel.i.costUnknown?'color:var(--lab)':cbUpDn(sel.gain))}
        ${cell('보유수량', qtyTxt, 'font-size:12.5px', 'cb-num')}
        ${cell('<span data-tip="보유 수량 전체의 평균 매수 단가(가중평균)">평단가</span>', sel.i.grp==='현금'?'—':(sel.i.costUnknown?'취득가 미상':cbFmtNative(sel.avgNative,sel.i.cur)), '', 'cb-num')}
        ${cell('현재가', sel.i.grp==='현금'?'—':cbFmtNative(sel.i.curP,sel.i.cur), '', 'cb-num')}
        ${cell('수익률', sel.gainPct==null?'—':cbPct(sel.gainPct), sel.gainPct==null?'color:var(--lab)':cbUpDn(sel.gainPct))}
        ${cell('<span data-tip="현재 선택한 소유주 포트폴리오에서 이 종목의 평가액이 차지하는 비중">포트폴리오 비중</span>', (nw>0?sel.val/nw*100:0).toFixed(1)+'%')}
        ${cell('섹터', cbEsc(sector), 'font-size:12px;font-weight:600;white-space:nowrap', '', 'grid-column:1/-1')}
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

    <div class="cb-dash-insight-grid">
      <div class="cb-panel" style="min-width:0;padding:16px 18px">
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

      <div class="cb-panel cb-dash-sector-card" style="min-width:0;padding:16px 18px">
        <div style="font-size:11px;letter-spacing:.08em;color:var(--lab);margin-bottom:11px"><span data-tip="보유 주식을 섹터로 분류해 편중도를 점검합니다. 가상화폐는 Crypto로 별도 분류하며, 비중은 비중 차트와 동일하게 현금·금까지 포함한 전체 포트폴리오를 기준으로 계산합니다.">섹터 집중도</span> <span style="color:var(--dim)">· 전체 포트폴리오 기준 · 막대 클릭 시 종목 표시</span></div>
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
        <div class="cb-dash-sector-note">${sectorNote}</div>
      </div>
      <div class="cb-dash-movers-grid">
        ${moverCard('수익률 TOP 5', topGainers, 'var(--up)', '수익 종목이 없습니다')}
        ${moverCard('손실률 TOP 5', topLosers, 'var(--dn)', '손실 종목이 없습니다')}
      </div>
      ${contributionCard}
    </div>

    <div class="cb-dash-split" style="display:flex;gap:12px;margin-top:12px;align-items:flex-start">
      <div class="cb-panel cb-dash-table-panel" style="flex:1;min-width:0;padding:14px 16px">
        <div class="cb-dash-table-toolbar" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="font-size:10.5px;letter-spacing:.08em;color:var(--lab)">보유 자산 내역 · ${held.length}종목 <span style="color:var(--dim)">· 행 클릭 시 우측에 상세</span></div>
          <div style="display:flex;align-items:center;gap:7px;background:var(--inner);border:1px solid var(--bd2);border-radius:9px;padding:6px 11px;width:200px">
            <span style="color:var(--dim);font-size:12px">⌕</span>
            <input value="${cbEsc(_cdashQ)}" oninput="cbDashSearch(this.value)" placeholder="티커·종목명 검색…" style="background:transparent;border:none;color:var(--tx);font-family:'Noto Sans KR',sans-serif;font-size:12px;width:100%;outline:none" />
          </div>
        </div>
        <div class="cb-tblwrap"><div style="min-width:640px">
          <div class="cb-thead cb-dash-head" style="display:flex;align-items:center;gap:8px;padding:4px 9px 7px;border-bottom:1px solid var(--bd);font-size:10.5px;color:var(--dim)">
            <span style="width:62px;flex-shrink:0">소유주</span>
            <span style="flex:1;min-width:0;box-sizing:border-box;padding-left:40px">종목</span>
            <span style="width:70px;text-align:right;flex-shrink:0">주수</span>
            <span style="width:78px;text-align:right;flex-shrink:0"><span data-tip="보유 수량 전체의 평균 매수 단가(가중평균)">평단가</span></span>
            <span style="width:78px;text-align:right;flex-shrink:0">현재가</span>
            <span style="width:90px;text-align:right;flex-shrink:0">평가금액</span>
            <span style="width:62px;text-align:right;flex-shrink:0"><span data-tip="현재 선택한 소유주 포트폴리오에서 종목 평가액이 차지하는 비중">비중</span></span>
            <span style="width:52px;text-align:right;flex-shrink:0">수익률</span>
          </div>
          ${held.map(r=>`
            <div class="cb-hrow" onclick="cbDashPick('${cbEsc(r.key)}')" style="display:flex;align-items:center;gap:8px;padding:7px 9px;cursor:pointer;${r.key===_cdashSel?'background:var(--accSoft);box-shadow:inset 0 0 0 1px var(--bd2)':''}">
              <span style="width:62px;display:flex;align-items:center;gap:5px;flex-shrink:0;font-size:11.5px;font-weight:600;color:var(--mut)"><span style="width:7px;height:7px;border-radius:50%;background:${cbOwnerColor(r.i.owner)};flex-shrink:0"></span>${cbEsc(r.i.owner)}</span>
              <div style="flex:1;min-width:0;display:flex;align-items:center;gap:12px">
                ${cbFlagCell(r, 28, 15)}
                <div style="min-width:0;display:flex;align-items:center;gap:6px;flex:1">
                  <span class="cb-asset-inline cb-tip-block" data-overflow-tip="${cbEsc([r.title,r.subTitle].filter(Boolean).join(' · '))}">
                    <span class="cb-asset-name" data-overflow-watch>${cbEsc(r.title)}</span>
                    ${r.subTitle?`<span class="cb-asset-ticker" data-overflow-watch>${cbEsc(r.subTitle)}</span>`:''}
                  </span>
                  ${r.accountCount>1?`<span class="cb-account-badge cb-tip-block cb-account-tip" data-tip="${cbEsc(cbBrokerWeightTip(r))}">${r.accountCount}계좌</span>`:''}
                </div>
              </div>
              <span class="cb-num" style="width:70px;text-align:right;font-size:12px;flex-shrink:0">${r.i.grp==='현금'?'—':cbEsc(Number(r.qty||0).toLocaleString(undefined,{maximumFractionDigits:4})+(r.i.unit||'주'))}</span>
              <span class="cb-num" style="width:78px;text-align:right;font-size:12px;flex-shrink:0">${r.i.grp==='현금'?'—':cbFmtNative(r.avgNative,r.i.cur)}</span>
              <span class="cb-num" style="width:78px;text-align:right;font-size:12px;font-weight:600;flex-shrink:0">${r.i.grp==='현금'?'—':cbFmtNative(r.i.curP,r.i.cur)}</span>
              <span style="width:90px;text-align:right;font-size:12.5px;font-weight:700;flex-shrink:0">${cbDisp(r.val)}</span>
              <span class="cb-num" style="width:62px;text-align:right;font-size:11.5px;font-weight:700;color:var(--mut);flex-shrink:0">${(nw>0?r.val/nw*100:0).toFixed(1)}%</span>
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
let _cbPerfVerifyPromise = null;
function cbVerifyPerfOwnersOnOpen(){
  if (_cbPerfVerifyPromise || typeof fetchBenchmarkData !== 'function') return;
  const investedOwners = new Set((pfolioData||[])
    .filter(i=>i && i.qty>0 && (i.grp==='주식' || i.grp==='가상화폐' || i.grp==='금'))
    .map(i=>i.owner));
  const missing = OWNERS.filter(owner=>
    investedOwners.has(owner) &&
    !CB_PERF_TFS.some(tf=>cbLastVal(((benchData[tf]||{}).data||{})[owner])!=null)
  );
  if (!missing.length) return;
  _cbPerfVerifyPromise = Promise.allSettled(missing.map(owner=>fetchBenchmarkData(owner)))
    .finally(()=>{
      _cbPerfVerifyPromise = null;
      if (_cobaltActive==='perf2') cbRenderPerf();
    });
}
function cbRenderPerf(){
  const el = document.getElementById('cb-perf2'); if(!el) return;
  const fmtR = v => v==null ? '—' : (v>=0?'+':'')+Number(v).toFixed(1)+'%';
  const csR = v => v==null ? 'color:var(--lab)' : cbUpDn(v);
  const oc = (typeof BENCH_OWNER_COLORS!=='undefined') ? BENCH_OWNER_COLORS : {};
  if (CB_PERF_TFS.indexOf(_cbPerfTf)<0) _cbPerfTf='1Y';
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
  // 클릭 강조: 선택된 소유주/벤치마크 라인은 굵게, 나머지는 흐리게
  // 선 종류: 벤치마크(S&P 500 / KOSPI) = 실선, 소유주 포트폴리오 = 점선
  const seriesArr = entities.map(e=>({ data:(sel.data[e.key]||[]), color:e.color, isBench:!!e.isBench,
    bold: !e.isBench || e.key===selKey, dash:!e.isBench, dim: !!(selKey && e.key!==selKey) }));
  // 범례·카드·표의 색 스와치도 선 종류를 그대로 반영 (소유주 = 점선, 벤치마크 = 실선)
  const swatch = (e, w) => e.isBench
    ? `<span style="width:${w}px;height:3px;border-radius:2px;background:${e.color};flex-shrink:0"></span>`
    : `<span style="width:${w}px;height:0;border-top:2px dashed ${e.color};flex-shrink:0"></span>`;
  // 차트 hover 데이터 (body 레벨 고정 툴팁 — 위젯 overflow 로 잘리지 않음)
  window._cbPerfHover = { labels: sel.labels||[], entities: entities.map(e=>({key:e.key,label:e.label,color:e.color,isBench:!!e.isBench})), data: sel.data||{} };
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
    <div class="cb-perf-card-grid">
      ${cards.map(p=>`
        <div class="cb-panel" onclick="cbPerfSelToggle('${cbEsc(p.key)}')" style="min-width:0;padding:12px 14px;border-top:3px solid ${p.color};cursor:pointer;transition:opacity .2s,box-shadow .2s;${selKey===p.key?`box-shadow:0 0 0 1.5px ${p.color}`:(selKey?'opacity:.5':'')}">
          <div style="display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--mut)">${swatch(p,13)}${cbEsc(p.label)}</div>
          <div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:23px;font-weight:800;margin-top:3px;${csR(p.ret)}">${fmtR(p.ret)}</div>
        </div>`).join('')}
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px 8px;overflow:visible">
      <div style="display:flex;gap:14px;margin-bottom:8px;flex-wrap:wrap">
        ${entities.map(p=>`<span onclick="cbPerfSelToggle('${cbEsc(p.key)}')" style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--mut);cursor:pointer;transition:opacity .2s;${selKey&&selKey!==p.key?'opacity:.4':''}">${swatch(p,13)}${cbEsc(p.label)}</span>`).join('')}
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
    <div class="cb-panel cb-perf-detail-panel" style="margin-top:12px;padding:16px 18px">
      <div class="cb-perf-detail-grid">
        ${[
          [rows.find(r=>r.e.key==='S&P 500'), rows.find(r=>r.e.key==='본인'), rows.find(r=>r.e.key==='자녀1')],
          [rows.find(r=>r.e.key==='KOSPI'), rows.find(r=>r.e.key==='아내'), rows.find(r=>r.e.key==='아버지')],
        ].map(group=>`
          <div class="cb-perf-detail-table">
            <div class="cb-perf-detail-head">
              <span>구분</span>
              ${CB_PERF_TFS.map(t=>`<span style="${t===tf?'color:var(--acc);font-weight:800':''}">${t}</span>`).join('')}
              <span><span data-tip="같은 기간 S&P 500 수익률 대비 차이 (포트폴리오 − S&P 500)">S&amp;P 대비</span></span>
              <span><span data-tip="Max Drawdown — 선택 기간 중 고점 대비 최대 하락폭. 낙폭이 작을수록 하락장 방어력이 좋았다는 뜻입니다.">MDD</span></span>
            </div>
            ${group.filter(Boolean).map(r=>`
              <div class="cb-perf-detail-row" onclick="cbPerfSelToggle('${cbEsc(r.e.key)}')" style="${selKey===r.e.key?'background:var(--accSoft)':(selKey?'opacity:.55':'')}">
                <span class="cb-perf-detail-name">${swatch(r.e,11)}${cbEsc(r.e.label)}</span>
                ${r.vals.map((v,k)=>`<span class="cb-num" style="${csR(v)}"><span class="cb-perf-value${CB_PERF_TFS[k]===tf?' is-active':''}">${fmtR(v)}</span></span>`).join('')}
                <span class="cb-num" style="${csR(r.alpha)}"><span class="cb-perf-value">${r.alpha==null?'—':fmtR(r.alpha)}</span></span>
                <span class="cb-num" style="${r.mdd==null||r.mdd>=0?'color:var(--lab)':'color:var(--dn)'}"><span class="cb-perf-value">${r.mdd==null?'—':r.mdd.toFixed(1)+'%'}</span></span>
              </div>`).join('')}
          </div>`).join('')}
      </div>
      <div class="cb-perf-detail-note">※ 소유주별 라인은 각 소유주 보유 종목의 가중 수익률입니다. 데이터가 비어 있으면 사이드바의 "새로고침"을 눌러주세요.</div>
    </div>`;
}
function cbPerfTf(t){ _cbPerfTf = t; cbRenderPerf(); }
// 소유주/벤치마크 카드·범례·표 행 클릭 → 해당 라인 강조 (재클릭 시 해제)
function cbPerfSelToggle(k){ _cbPerfSel = (_cbPerfSel===k ? null : k); cbRenderPerf(); }
function _cbPerfTipEl(){
  let t = document.getElementById('cb-perf-tip');
  if(!t){
    t = document.createElement('div'); t.id = 'cb-perf-tip'; t.className = 'cb-chart-tip';
    t.style.cssText = 'position:fixed;z-index:9999;display:none;pointer-events:none;background:var(--tipbg);color:var(--tiptx);border:1px solid var(--tipbd);border-radius:9px;padding:9px 11px;box-shadow:0 12px 30px rgba(0,0,0,.36);font-size:11.5px;min-width:158px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;box-sizing:border-box;letter-spacing:0';
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
      <span style="display:flex;align-items:center;gap:5px;color:var(--mut)">${e.isBench
        ? `<span style="width:13px;height:3px;border-radius:2px;background:${e.color};flex-shrink:0"></span>`
        : `<span style="width:13px;height:0;border-top:2px dashed ${e.color};flex-shrink:0"></span>`}${cbEsc(e.label)}</span>
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
  const famMixOwners = OWNERS.map(owner=>{
    const ownerRows=rows.filter(r=>r.i.owner===owner);
    const total=ownerRows.reduce((s,r)=>s+r.val,0);
    const segments=Object.entries(CB_CLS).map(([key,meta])=>({
      key,label:meta.label,color:meta.color,
      value:ownerRows.filter(r=>r.cls===key).reduce((s,r)=>s+r.val,0)
    })).filter(x=>x.value>0);
    return {owner,total,segments};
  });
  const famMixClasses = Object.entries(CB_CLS).map(([key,meta])=>({
    key,label:meta.label,color:meta.color,
    value:rows.filter(r=>r.cls===key).reduce((s,r)=>s+r.val,0)
  })).filter(x=>x.value>0);

  // 조회 전용 페이지 — 수정은 "자산 내역"에서만 (내역 우측 수정 버튼 제거됨)
  cbSetHead('카드 클릭 시 해당 구성원만 필터링 · 소유주→자산군→국가→종목명 순 정렬 · 조회 전용');
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
    <div class="cb-family-detail-grid">
    <div class="cb-panel cb-table-panel cb-family-table-panel" style="padding:14px 16px">
      <div class="cb-family-table-toolbar" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="font-size:10.5px;letter-spacing:.08em;color:var(--lab)">${_famKey==='all'?'전체 보유 자산':cbEsc(_famKey)+' 보유 자산'} · ${held.length}종목</div>
        <div style="display:flex;align-items:center;gap:7px;background:var(--inner);border:1px solid var(--bd2);border-radius:9px;padding:6px 11px;width:220px">
          <span style="color:var(--dim);font-size:12px">⌕</span>
          <input value="${cbEsc(_famQ)}" oninput="cbFamSearch(this.value)" placeholder="티커·종목명 검색…" style="background:transparent;border:none;color:var(--tx);font-family:'Noto Sans KR',sans-serif;font-size:12px;width:100%;outline:none" />
        </div>
      </div>
      <div class="cb-tblwrap"><div style="min-width:826px">
      <div class="cb-thead cb-family-head" style="display:flex;align-items:center;gap:10px;padding:7px 9px;border-bottom:1px solid var(--bd);font-size:10.5px;color:var(--dim)">
        <span style="width:62px;flex-shrink:0">소유주</span>
        <span style="flex:1;min-width:0;box-sizing:border-box;padding-left:40px">종목</span>
        <span style="width:76px;text-align:right;flex-shrink:0">수량</span>
        <span style="width:90px;text-align:right;flex-shrink:0"><span data-tip="보유 수량 전체의 평균 매수 단가(가중평균)">평단가</span></span>
        <span style="width:90px;text-align:right;flex-shrink:0">현재가</span>
        <span style="width:100px;text-align:right;flex-shrink:0">평가금액</span>
        <span style="width:96px;text-align:right;flex-shrink:0">평가손익</span>
        <span style="width:56px;text-align:right;flex-shrink:0">수익률</span>
      </div>
      ${held.map(r=>`
        <div class="cb-hrow" style="display:flex;align-items:center;gap:10px;padding:7px 9px">
          <span style="width:62px;display:flex;align-items:center;gap:5px;flex-shrink:0;font-size:11.5px;font-weight:600;color:var(--mut)"><span style="width:7px;height:7px;border-radius:50%;background:${cbOwnerColor(r.i.owner)};flex-shrink:0"></span>${cbEsc(r.i.owner)}</span>
          <div style="flex:1;min-width:0;display:flex;align-items:center;gap:10px">
            ${cbFlagCell(r, 30, 16)}
            <div style="min-width:0">
              <div class="cb-asset-inline cb-tip-block" data-overflow-tip="${cbEsc([r.title,r.subTitle].filter(Boolean).join(' · '))}">
                <span class="cb-asset-name" data-overflow-watch>${cbEsc(r.title)}</span>
                ${r.subTitle?`<span class="cb-asset-ticker" data-overflow-watch>${cbEsc(r.subTitle)}</span>`:''}
              </div>
              <div class="cb-tip-block" data-overflow-tip="${cbEsc([r.i.broker,r.i.acc].filter(Boolean).join(' · ')||'—')}"><span data-overflow-watch style="display:block;font-size:10.5px;color:var(--lab);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(r.i.broker||'—')}${r.i.acc?' · '+cbEsc(r.i.acc):''}</span></div>
            </div>
          </div>
          <span class="cb-num" style="width:76px;text-align:right;font-size:12px;flex-shrink:0">${r.i.grp==='현금'?'예수금':cbEsc(Number(r.i.qty||0).toLocaleString(undefined,{maximumFractionDigits:4})+(r.i.unit||'주'))}</span>
          <span class="cb-num" style="width:90px;text-align:right;font-size:12px;flex-shrink:0">${r.i.grp==='현금'?'—':cbFmtNative(cbAvgNative(r.i),r.i.cur)}</span>
          <span class="cb-num" style="width:90px;text-align:right;font-size:12px;flex-shrink:0">${r.i.grp==='현금'?'—':cbFmtNative(r.i.curP,r.i.cur)}</span>
          <span style="width:100px;text-align:right;font-size:12.5px;font-weight:700;flex-shrink:0">${cbDisp(r.val)}</span>
          <span style="width:96px;text-align:right;font-size:12px;font-weight:600;flex-shrink:0;${r.i.grp==='현금'?'color:var(--lab)':cbUpDn(r.gain)}">${r.i.grp==='현금'?'—':cbSignDisp(r.gain)}</span>
          <span style="width:56px;text-align:right;font-size:12px;font-weight:600;flex-shrink:0;${r.gainPct==null?'color:var(--lab)':cbUpDn(r.gainPct)}">${r.gainPct==null?'—':cbPct(r.gainPct)}</span>
        </div>`).join('')}
      </div></div>
    </div>
    <div class="cb-panel cb-family-mix-card">
      <div class="cb-insight-title">소유주별 자산군 구성</div>
      <div style="font-size:10.5px;color:var(--dim);line-height:1.5;margin-top:3px">각 소유주의 자산 안에서 자산군이 차지하는 비중입니다.</div>
      <div class="cb-family-mix-list">
        ${famMixOwners.map(m=>`
          <button type="button" class="cb-family-mix-owner${_famKey===m.owner?' is-active':''}" onclick="cbFamPick('${cbEsc(m.owner)}')">
            <span class="cb-family-mix-head"><b><i style="background:${cbOwnerColor(m.owner)}"></i>${cbEsc(m.owner)}</b><span>${m.total>0?cbDisp(m.total):'—'}</span></span>
            <span class="cb-family-mix-track">
              ${m.total>0?m.segments.map(seg=>`<i data-tip="${cbEsc(`${m.owner} · ${seg.label} ${(seg.value/m.total*100).toFixed(1)}%`)}" style="width:${(seg.value/m.total*100).toFixed(2)}%;background:${seg.color}"></i>`).join(''):'<i style="width:100%;background:var(--bd)"></i>'}
            </span>
          </button>`).join('')}
      </div>
      <div class="cb-family-mix-legend">
        ${famMixClasses.map(seg=>`<span><i style="background:${seg.color}"></i>${cbEsc(seg.label)}</span>`).join('')}
      </div>
    </div>
    </div>`;
}
function cbFamPick(k){ _famKey=k; cbRenderFam(); }
function cbFamSearch(v){ _famQ=v; cbRenderFam();
  const inp=document.querySelector('#cb-fam2 input'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }

// ───────────────────────── 페이지: 리스크 진단 ─────────────────────────
// 종목 집중도(ETF 룩스루) 패널 — 직접 보유(파랑) + ETF 간접 보유(주황) 스택 바
function cbLookThroughPanel(ownerFilter){
  const C_DIR = '#5b9bff', C_VIA = '#f2a33c';
  const lt = cbLookThrough(ownerFilter);
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
      // 회사명 → 직접/간접 비중 → ETF별 간접 비중 순서로 줄바꿈한다.
      // 같은 ETF를 여러 계좌에서 보유한 경우 한 줄로 합쳐 표시하며 원화 금액은 노출하지 않는다.
      const etfMap = new Map();
      x.etfs.forEach(e=>{
        const key = (ownerFilter?'':String(e.owner||'')) + '::' + String(e.etf||'');
        const prev = etfMap.get(key) || { owner:e.owner||'', etf:e.etf||'', val:0 };
        prev.val += Number(e.val)||0;
        etfMap.set(key, prev);
      });
      const pctText = p => p>0 && p<0.01 ? '<0.01%' : p.toFixed(2)+'%';
      const ownerNames = Array.from(x.owners||[]).sort((a,b)=>{
        const ai=OWNERS.indexOf(a), bi=OWNERS.indexOf(b);
        return (ai<0?99:ai)-(bi<0?99:bi);
      });
      const tipLines = [
        x.title,
        ...(!ownerFilter && ownerNames.length ? [`소유주 ${ownerNames.join(' · ')}`] : []),
        `직접 보유 ${x.dPct.toFixed(1)}%`,
        `간접 보유 ${x.vPct.toFixed(1)}%`,
        ...Array.from(etfMap.values()).map(e=>{
          const prefix = ownerFilter ? '' : (e.owner ? e.owner+' · ' : '');
          return `· ${prefix}${e.etf} ${pctText(e.val/lt.nw*100)}`;
        }),
      ];
      const stockTip = cbEsc(tipLines.join('\n'));
      return `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 0;font-size:12px">
        <span style="width:148px;flex-shrink:0;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(x.title)}</span>
        <div style="flex:1;min-width:120px;height:14px;border-radius:4px;background:var(--inner)">
          <div style="display:flex;gap:2px;height:100%">
            ${x.dPct>0?`<span class="cb-tip-block cb-risk-tip" data-tip="${stockTip}" style="display:block;height:100%;width:${Math.max(0.6,(x.dPct/mx*100)).toFixed(2)}%;background:${C_DIR};border-radius:3px"></span>`:''}
            ${x.vPct>0?`<span class="cb-tip-block cb-risk-tip" data-tip="${stockTip}" style="display:block;height:100%;width:${Math.max(0.6,(x.vPct/mx*100)).toFixed(2)}%;background:${C_VIA};border-radius:3px"></span>`:''}
          </div>
        </div>
        <span class="cb-num" style="width:54px;text-align:right;font-weight:800;color:${pctColor};flex-shrink:0">${x.pct.toFixed(1)}%</span>
        <span style="width:190px;flex-shrink:0;font-size:10.5px;color:var(--lab);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${
          x.vPct>0 ? `직접 ${x.dPct.toFixed(1)}% + <span style="color:${C_VIA};font-weight:700">ETF ${x.vPct.toFixed(1)}%</span>` : '직접 보유만'
        }</span>
      </div>`;
    }).join('');
  }

  // 각주는 구성종목을 못 받은 ETF 이름만 나열한다 (사유·소스는 노출하지 않음).
  // lt.etfMiss 는 이미 소유주 필터가 적용된 '보유 중인데 데이터가 없는' ETF 목록이고,
  // 수집기의 failures 에 오른 ETF 는 JSON 에 항목이 없으므로 그대로 여기에 잡힌다.
  const notes = lt.etfMiss.length ? ['구성종목 미조회 ETF: ' + lt.etfMiss.map(cbEsc).join(', ')] : [];

  return `
    <div class="cb-panel" style="margin-top:12px;padding:15px 17px">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <span style="font-size:10.5px;letter-spacing:.08em;color:var(--lab)"><span class="cb-risk-tip-wide" data-tip="보유 ETF의 구성종목 비중을 풀어서(룩스루) ETF 평가액 × 편입 비중으로 간접 보유분을 계산하고, 직접 보유분과 합산한 실질 종목 비중입니다. 개별 주식으로 직접 보유한 종목만 계산합니다.">종목 집중도 · ETF 룩스루</span> <span style="color:var(--dim)">· ${ownerFilter?cbEsc(ownerFilter)+' 순자산 대비':'전체 순자산 대비'}</span></span>
        <div style="display:flex;gap:12px;font-size:10.5px;color:var(--mut);margin-left:auto;flex-wrap:wrap">
          <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:${C_DIR}"></span>직접 보유</span>
          <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:${C_VIA}"></span>ETF 간접 보유</span>
        </div>
      </div>
      ${body}
      ${notes.length?`<div style="font-size:10.5px;color:var(--dim);margin-top:8px;line-height:1.6">${notes.map(t=>'※ '+t).join('<br>')}</div>`:''}
    </div>`;
}

function cbRenderRisk(){
  const el = document.getElementById('cb-risk2'); if(!el) return;
  cbEnsureEtfHoldings();
  // 소유주 필터 — cbRisk/cbLookThrough 가 이미 ownerFilter 를 받으므로 점수·카드·룩스루가 함께 갱신된다
  const ownerF = (_cbRiskOwner && _cbRiskOwner!=='전체') ? _cbRiskOwner : null;
  const r = cbRisk(ownerF);
  const insights = cbRiskInsights(ownerF,r);
  cbSetHead('규칙 기반 자동 점검', cbOwnerBtns(_cbRiskOwner,'cbRiskOwner'));
  el.innerHTML = `
    <div class="cb-risk-overview">
      <div class="cb-panel cb-risk-score-card">
        <div style="position:relative;width:136px;height:136px;display:flex;align-items:center;justify-content:center">
          ${cbRingSvg(r.score,136,r.color)}
          <div style="position:absolute;text-align:center">
            <div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:34px;font-weight:800;color:${r.color}">${r.score}</div>
            <div data-tip="0~100점 척도이며 점수가 높을수록 안정적입니다. 위험 신호마다 감점되어 0점까지 내려갈 수 있습니다." style="font-size:10px;color:var(--lab)">/ 100</div>
          </div>
        </div>
        <div style="font-size:14.5px;font-weight:800;margin-top:10px;color:${r.color}">${r.grade}</div>
        <div style="font-size:11.5px;color:var(--mut);text-align:center;line-height:1.6;margin-top:6px">${r.warns===0?'모든 점검 항목이 양호합니다.':r.warns+'개 항목에서 주의·경고가 발견되었습니다.'}</div>
        <div style="width:100%;margin-top:auto;padding-top:12px;border-top:1px solid var(--bd);display:flex;flex-direction:column;gap:6px;align-self:stretch">
          <div style="display:flex;justify-content:space-between;font-size:11.5px"><span style="color:var(--mut)"><span data-tip="자산군별 역사적 변동성의 보유비중 가중평균. 1년간 수익률이 오르내리는 폭의 추정치입니다.">추정 연 변동성</span></span><span style="font-weight:700">${r.vol.toFixed(1)}%</span></div>
          <div style="display:flex;justify-content:space-between;font-size:11.5px"><span style="color:var(--mut)"><span data-tip="원화가 아닌 통화(USD·JPY)로 표시된 자산의 비중. 환율 변동에 노출됩니다.">환노출</span></span><span style="font-weight:700">${r.fxPct.toFixed(1)}%</span></div>
          <div style="display:flex;justify-content:space-between;font-size:11.5px"><span style="color:var(--mut)">현금 비중</span><span style="font-weight:700">${r.cashPct.toFixed(1)}%</span></div>
        </div>
      </div>
      <div class="cb-risk-primary-grid">
        ${r.cards.map(c=>`
          <div class="cb-panel cb-risk-primary-card">
            <div class="cb-risk-primary-head">
              <div class="cb-risk-primary-title"><span${c.tip?` data-tip="${cbEsc(c.tip)}"`:''}>${c.title}</span><span style="background:${c.lvl===0?'var(--upSoft)':c.color+'26'};color:${c.color}">${c.status}</span></div>
              <div class="cb-risk-primary-value" style="color:${c.color}">${c.valFmt}</div>
            </div>
            <div class="cb-risk-primary-message">${cbEsc(c.msg)}</div>
            <div style="height:5px;border-radius:3px;background:var(--inner);margin-top:8px;overflow:hidden"><div style="height:100%;width:${c.fill}%;background:${c.color}"></div></div>
          </div>`).join('')}
      </div>
    </div>
    <div class="cb-risk-secondary-grid">
      ${insights.map(card=>`
        <div class="cb-panel cb-risk-insight-card" style="--risk-tone:${card.tone}">
          <div class="cb-risk-insight-title"${card.tip?` data-tip="${cbEsc(card.tip)}"`:''}>${cbEsc(card.title)}</div>
          <div class="cb-risk-insight-value">${cbEsc(card.value)}</div>
          <div class="cb-risk-insight-detail cb-tip-block" data-overflow-tip="${cbEsc(card.detail)}">
            <span data-overflow-watch>${cbEsc(card.detail)}</span>
          </div>
        </div>`).join('')}
    </div>
    ${cbLookThroughPanel(ownerF)}`;
}
function cbRiskOwner(o){ _cbRiskOwner=o; cbRenderRisk(); }

// ───────────────────────── 페이지: 배당 관리 ─────────────────────────
// 배당 캘린더 Y축 금액 라벨 (만/억 + 소액은 천 단위)
function cbDivAxisLab(v){
  if (v===0) return '0';
  if (Math.abs(v)>=10000) return cbTaxAxisLab(v);
  return Math.round(v/1000).toLocaleString('ko-KR')+'천';
}
function cbAddDivMonthDetail(detailMaps, monthIndex, item, amount){
  if (!detailMaps[monthIndex] || !(amount>0)) return;
  const owner = item.i?.owner || '미지정';
  const assetKey = cbStrip(item.tkr) || item.title || item.i?.name || '미지정';
  const key = `${owner}::${assetKey}`;
  const title = item.title || item.i?.name || assetKey;
  const ticker = cbStrip(item.tkr);
  const prev = detailMaps[monthIndex].get(key) || { owner, title, ticker, amount:0 };
  prev.amount += amount;
  detailMaps[monthIndex].set(key, prev);
}
// 배당 이력에서 특정 연도의 실제 지급액을 월별로 집계 (현재 보유수량 기준 환산)
function cbDivMonthlyForYear(list, year){
  const monthAmt = Array(12).fill(0);
  const detailMaps = Array.from({length:12},()=>new Map());
  const cur = String(new Date().getFullYear());
  if (year===cur){
    // 올해 이후 → 예상: 연 배당을 지급 주기 월에 균등 배분
    list.forEach(x=>{
      const ms = (x.d.months && x.d.months.length) ? x.d.months : [2,5,8,11];
      const per = x.incomeKRW / ms.length;
      ms.forEach(m=>{
        const mi=((m%12)+12)%12;
        monthAmt[mi]+=per;
        cbAddDivMonthDetail(detailMaps,mi,x,per);
      });
    });
    return {
      monthAmt,
      monthDetails:detailMaps.map(map=>Array.from(map.values()).sort((a,b)=>b.amount-a.amount)),
      actual:false
    };
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
      const amount = (Number(ev.amount)||0) * (x.qty||0) * cbRate(h.cur || x.i.cur);
      monthAmt[mi] += amount;
      cbAddDivMonthDetail(detailMaps,mi,x,amount);
    });
  });
  return {
    monthAmt,
    monthDetails:detailMaps.map(map=>Array.from(map.values()).sort((a,b)=>b.amount-a.amount)),
    actual:true
  };
}
function cbUpcomingDividendSchedule(list, days=90, asOf=null){
  const start=asOf?new Date(asOf):new Date();
  if (Number.isNaN(start.getTime())) return [];
  start.setHours(0,0,0,0);
  const end=new Date(start);
  end.setDate(end.getDate()+Math.max(1,Number(days)||90));
  const events=[];
  (list||[]).forEach(x=>{
    const months=Array.from(new Set((x.d?.months&&x.d.months.length?x.d.months:[2,5,8,11])
      .map(m=>((Number(m)%12)+12)%12)));
    const exactDay=Number(x.d?.payDay);
    const hasExactDay=Number.isFinite(exactDay)&&exactDay>=1;
    const perAmount=months.length?x.incomeKRW/months.length:0;
    for(let offset=0;offset<=4;offset++){
      const cursor=new Date(start.getFullYear(),start.getMonth()+offset,1);
      const month=cursor.getMonth();
      if(!months.includes(month)) continue;
      const lastDay=new Date(cursor.getFullYear(),month+1,0).getDate();
      const day=hasExactDay?Math.min(exactDay,lastDay):15;
      const date=new Date(cursor.getFullYear(),month,day);
      if(date<start||date>end) continue;
      events.push({
        date,
        dateLabel:hasExactDay?`${month+1}월 ${day}일`:`${month+1}월 예정`,
        exact:hasExactDay,
        owner:x.i?.owner||'—',
        ticker:cbStrip(x.tkr||x.i?.tkr),
        title:x.title||x.i?.name||x.tkr||'—',
        amount:perAmount
      });
    }
  });
  return events.sort((a,b)=>a.date-b.date||b.amount-a.amount);
}
function cbDivTipEl(){
  let tip=document.getElementById('cb-div-bar-tip');
  if(!tip){
    tip=document.createElement('div');
    tip.id='cb-div-bar-tip';
    tip.className='table-float-tip cb-dividend-tip';
    tip.setAttribute('role','tooltip');
    document.body.appendChild(tip);
  }
  return tip;
}
function cbDivBarHover(ev, monthIndex){
  const data=window._cbDivBarData;
  if(!data) return;
  const details=(data.monthDetails&&data.monthDetails[monthIndex])||[];
  const total=(data.monthAmt&&data.monthAmt[monthIndex])||0;
  const tip=cbDivTipEl();
  const showOwner=!_cbDivOwner||_cbDivOwner==='전체';
  const rows=details.length
    ? details.map(d=>{
        const ticker=d.ticker&&d.ticker!==d.title?` <span class="cb-div-tip-ticker">(${cbEsc(d.ticker)})</span>`:'';
        const owner=showOwner
          ? `<span class="cb-div-tip-owner"><i style="background:${cbOwnerColor(d.owner)}"></i>${cbEsc(d.owner||'미지정')}</span>`
          : '';
        return `<div class="cb-div-tip-row${showOwner?' has-owner':''}">${owner}<span class="cb-div-tip-name">${cbEsc(d.title)}${ticker}</span><b>${cbKrw(d.amount)}</b></div>`;
      }).join('')
    : '<div style="opacity:.72">종목별 내역이 없습니다.</div>';
  tip.innerHTML=`<div class="cb-div-tip-title">${monthIndex+1}월 · ${cbKrw(total)}</div>${rows}`;
  tip.style.display='block';
  const rect=tip.getBoundingClientRect();
  let left=ev.clientX+12, top=ev.clientY-rect.height-12;
  if(left+rect.width>window.innerWidth-10) left=ev.clientX-rect.width-12;
  if(top<10) top=ev.clientY+12;
  tip.style.left=Math.max(10,left)+'px';
  tip.style.top=Math.max(10,Math.min(top,window.innerHeight-rect.height-10))+'px';
}
function cbDivBarHide(){
  const tip=document.getElementById('cb-div-bar-tip');
  if(tip) tip.style.display='none';
}
// 월별 배당 캘린더 SVG — Y축 금액 + X축 '월' 라벨
function cbDivCalendarSvg(monthAmt, monthDetails, w, h){
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
      const selected=_cbDivMonthFilter===m;
      const dimmed=_cbDivMonthFilter!=null&&!selected;
      out+=`<rect x="${(xc-bw/2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${(padT+plotH-yTop).toFixed(1)}" rx="3" fill="${upC}" opacity="${dimmed?'0.32':'0.88'}" stroke="${selected?'var(--tx)':'transparent'}" stroke-width="${selected?'2':'0'}" style="cursor:pointer" onmousemove="cbDivBarHover(event,${m})" onmouseleave="cbDivBarHide()" onclick="cbDivMonthPick(${m})"></rect>`;
      out+=`<text x="${xc.toFixed(1)}" y="${(yTop-5).toFixed(1)}" style="fill:var(--up)" font-size="9.2" font-weight="700" text-anchor="middle" font-family="IBM Plex Mono">${cbKrw(v)}</text>`;
    }
    out+=`<text x="${xc.toFixed(1)}" y="${h-8}" style="fill:var(--lab)" font-size="11" text-anchor="middle" font-family="Noto Sans KR">${m+1}월</text>`;
  }
  // 균일 스케일(meet) + width:100%/height:auto 로 종횡비 유지 → 텍스트가 가로로 늘어나지 않는다.
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:auto">${out}</svg>`;
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
  const list = cbSortDividendRows(Array.from(merged.values()).map(m=>{
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
  // 평균 배당성장률 — 배당 이력으로 CAGR 이 산출된 종목만 배당수입 가중평균한다.
  // (전체 배당수입으로 나누면 이력이 없는 종목이 분모만 키워 0쪽으로 희석된다)
  const gList = list.filter(x=>x.g!=null);
  const gBase = gList.reduce((s,x)=>s+x.incomeKRW,0);
  const avgG = gBase>0 ? gList.reduce((s,x)=>s+x.g*x.incomeKRW,0)/gBase : null;
  const top3Div = [...list].sort((a,b)=>b.incomeKRW-a.incomeKRW).slice(0,3);
  const top3DivShare = divAnnual>0
    ? top3Div.reduce((s,x)=>s+x.incomeKRW,0)/divAnnual*100
    : 0;

  // 조회 연도 목록 (배당 이력 연도 + 올해)
  const nowY = String(new Date().getFullYear());
  const raw = window._divHistoryRawCache || {};
  const yrSet = new Set([nowY]);
  list.forEach(x=>{ const h=raw[cbStrip(x.i.tkr)]; if(h&&Array.isArray(h.events)) h.events.forEach(ev=>{ const y=String(ev.date||'').slice(0,4); if(/^\d{4}$/.test(y)) yrSet.add(y); }); });
  const years = Array.from(yrSet).sort((a,b)=>b.localeCompare(a));
  const year = (_cbDivYear && years.includes(_cbDivYear)) ? _cbDivYear : nowY;
  const cal = cbDivMonthlyForYear(list, year);
  const calTotal = cal.monthAmt.reduce((s,v)=>s+v,0);
  const upcomingDividends=cbUpcomingDividendSchedule(list,90);
  const upcomingDividendTotal=upcomingDividends.reduce((s,x)=>s+x.amount,0);
  const upcomingDividendShown=upcomingDividends.slice(0,8);
  window._cbDivBarData = { monthAmt:cal.monthAmt, monthDetails:cal.monthDetails };
  const selectedDetails = _cbDivMonthFilter==null ? null : (cal.monthDetails[_cbDivMonthFilter]||[]);
  const selectedTickers = selectedDetails ? new Set(selectedDetails.map(d=>cbStrip(d.ticker||d.title))) : null;
  const visibleList = selectedTickers
    ? list.filter(x=>selectedTickers.has(cbStrip(x.tkr||x.title)))
    : list;

  // 소유주 버튼·조회 연도는 메인 제목 라인(글로벌 헤더) 우측으로
  cbSetHead(
    '<span data-tip="Yield on Cost — 내 평단가 대비 연간 배당금 비율. 배당성장 + 장기보유의 효과를 보여줍니다.">YoC</span>는 평단가(가중평균) 기준입니다',
    `${cbOwnerBtns(_cbDivOwner,'cbDivOwner')}
     <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--lab);font-weight:600">연도
       <select class="cb-input" onchange="cbDivYear(this.value)" style="padding:6px 9px">${years.map(y=>`<option value="${y}" ${y===year?'selected':''}>${y}년</option>`).join('')}</select>
     </label>`
  );
  el.innerHTML = `
    <div class="cb-div-summary-grid">
      <div class="cb-panel cb-div-summary-card"><div style="font-size:11px;color:var(--lab)">연간 배당 수입${ownerF?' · '+cbEsc(ownerF):''}</div><div class="cb-div-summary-value" style="color:var(--up)">${cbDisp(divAnnual)}</div></div>
      <div class="cb-panel cb-div-summary-card"><div style="font-size:11px;color:var(--lab)">월평균</div><div class="cb-div-summary-value">${cbDisp(divAnnual/12)}</div></div>
      <div class="cb-panel cb-div-summary-card"><div style="font-size:11px;color:var(--lab)">평균 <span data-tip="배당 지급 종목 전체의 매입원가 대비 배당수입 비율">YoC</span></div><div class="cb-div-summary-value">${(divAnnual/divCost*100).toFixed(2)}%</div></div>
      <div class="cb-panel cb-div-summary-card">
        <div class="cb-div-summary-title">평균 <span data-tip="지급 종목들의 주당 배당금 연평균 성장률(CAGR)을 배당수입 비중으로 가중평균한 값. 배당 이력이 확보된 종목만 계산에 포함합니다.">배당성장률</span> <span class="cb-div-history-status">(${avgG==null?'이력 조회 중':`이력 확보 ${gList.length}/${list.length}종목`})</span></div>
        <div class="cb-div-summary-value" style="${avgG==null?'color:var(--lab)':cbUpDn(avgG)}">${avgG==null?'—':(avgG>=0?'+':'')+avgG.toFixed(1)+'%'}</div>
      </div>
      <div class="cb-panel cb-div-summary-card">
        <div class="cb-div-summary-title"><span data-tip="연간 예상 배당금 중 배당 수입이 큰 상위 3개 종목이 차지하는 비중입니다. 낮을수록 배당원이 잘 분산되어 있습니다.">배당 집중도</span> <span class="cb-div-history-status">(상위 3종목)</span></div>
        <div class="cb-div-summary-value">${top3DivShare.toFixed(1)}%</div>
      </div>
      <div class="cb-panel cb-div-summary-card cb-div-top3-card">
        <div class="cb-div-summary-title"><span data-tip="연간 예상 배당 수입 기여도가 큰 상위 3개 종목과 각 종목의 배당 수입 비중입니다.">상위 배당원 TOP 3</span></div>
        <div class="cb-div-top3-list">
          ${top3Div.map((x,rank)=>{
            const label=[ownerF?'':x.i.owner, x.title||'종목명 미확인'].filter(Boolean).join(' · ');
            const share=divAnnual>0?x.incomeKRW/divAnnual*100:0;
            return `<div class="cb-div-top3-row">
              <span class="cb-div-top3-rank">${rank+1}</span>
              <span class="cb-div-top3-name cb-tip-block" data-overflow-tip="${cbEsc(label)}" data-overflow-watch>${cbEsc(label||'—')}</span>
              <span class="cb-div-top3-metrics"><b>${cbDisp(x.incomeKRW)}</b><span>(${share.toFixed(1)}%)</span></span>
            </div>`;
          }).join('') || '<div style="font-size:10.5px;color:var(--dim)">배당 종목 없음</div>'}
        </div>
      </div>
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px 8px">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        <span style="font-size:10.5px;letter-spacing:.08em;color:var(--lab)">${year}년 월별 배당 캘린더 ${cal.actual?'<span style="color:var(--up)">· 실제 지급</span>':'<span style="color:var(--dim)">· 예상</span>'}</span>
        <span style="margin-left:auto;font-size:11px;color:var(--mut)">${year}년 합계 <b style="color:var(--up)">${cbDisp(calTotal)}</b></span>
      </div>
      ${cbDivCalendarSvg(cal.monthAmt, cal.monthDetails, 1100, 300)}
    </div>
    <div class="cb-div-detail-grid">
    <div class="cb-panel cb-table-panel cb-div-history-panel" style="padding:14px 16px">
      <div class="cb-div-table-toolbar" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:10.5px;letter-spacing:.08em;color:var(--lab)">배당 종목 내역</span>
        ${_cbDivMonthFilter!=null?`<button class="cb-btn" onclick="cbDivMonthPick(${_cbDivMonthFilter})" style="margin-left:auto;padding:4px 9px;font-size:10.5px">${_cbDivMonthFilter+1}월 예상 종목 · 전체 보기 ×</button>`:''}
      </div>
      <div class="cb-thead cb-div-head" style="display:flex;font-size:10.5px;color:var(--dim);padding:7px 8px;border-bottom:1px solid var(--bd);min-width:1018px">
        <span style="width:62px">소유주</span><span style="width:38px" aria-label="국가"></span><span style="flex:1">종목명</span><span style="width:96px;text-align:right">연간 수입</span><span style="width:76px;text-align:right">보유 주수</span><span class="cb-mobile-secondary" style="width:86px;text-align:right">주당 배당(연)</span><span style="width:68px;text-align:right"><span data-tip="현재 선택된 소유주의 연간 예상 배당 수입에서 해당 종목이 차지하는 비중">배당 비중</span></span><span class="cb-mobile-secondary" style="width:70px;text-align:right"><span data-tip="현재 주가 대비 연간 배당금 비율">시가수익률</span></span><span class="cb-mobile-secondary" style="width:64px;text-align:right"><span data-tip="Yield on Cost — 평단가 대비 배당수익률">YoC</span></span><span class="cb-mobile-secondary" style="width:78px;text-align:right"><span data-tip="배당 이력 기준 주당 배당금 연평균 성장률(CAGR)">배당성장</span></span><span class="cb-mobile-secondary" style="width:64px;text-align:right">주기</span><span class="cb-mobile-secondary" style="width:100px;text-align:right"><span data-tip="이 날짜 전까지 매수해야 다음 배당을 받을 수 있는 기준일">배당락</span></span>
      </div>
      ${visibleList.map(x=>`
        <div class="cb-div-row" style="display:flex;align-items:center;padding:9px 8px;border-bottom:1px solid var(--bd);font-size:12.5px;min-width:1018px">
          <span style="width:62px;display:flex;align-items:center;gap:5px;flex-shrink:0;font-size:11.5px;font-weight:600;color:var(--mut)"><span style="width:7px;height:7px;border-radius:50%;background:${cbOwnerColor(x.i.owner)};flex-shrink:0"></span>${cbEsc(x.i.owner)}</span>
          <span style="width:38px;display:flex;align-items:center;justify-content:flex-start;flex-shrink:0">${cbFlagSvg(x,15)}</span>
          <div style="flex:1;display:flex;align-items:center;min-width:0">
            <span class="cb-asset-inline cb-tip-block" data-overflow-tip="${cbEsc([x.title,x.tkr].filter(Boolean).join(' · '))}">
              <span class="cb-asset-name" data-overflow-watch>${cbEsc(x.title)}</span>
              ${x.tkr?`<span class="cb-asset-ticker" data-overflow-watch>${cbEsc(x.tkr)}</span>`:''}
            </span>
          </div>
          <span style="width:96px;text-align:right;font-weight:700">${cbDisp(x.incomeKRW)}</span>
          <span class="cb-num" style="width:76px;text-align:right;font-size:11.5px;font-weight:600">${Number(x.qty||0).toLocaleString(undefined,{maximumFractionDigits:4})}주</span>
          <span class="cb-num cb-mobile-secondary" style="width:86px;text-align:right;font-size:11.5px">${cbFmtNative(x.d.annualDps, x.d.cur||x.i.cur)}</span>
          <span style="width:68px;text-align:right;font-weight:700;color:var(--mut)">${divAnnual>0?(x.incomeKRW/divAnnual*100).toFixed(1)+'%':'—'}</span>
          <span class="cb-mobile-secondary" style="width:70px;text-align:right;font-weight:600">${(x.d.yldNum||0).toFixed(2)}%</span>
          <span class="cb-mobile-secondary" style="width:64px;text-align:right;font-weight:800;color:var(--up)">${x.yoc!=null?x.yoc.toFixed(2)+'%':'—'}</span>
          <span class="cb-mobile-secondary" style="width:78px;text-align:right;font-weight:700;${x.g!=null?cbUpDn(x.g):'color:var(--lab)'}">${x.g!=null?(x.g>=0?'+':'')+x.g.toFixed(1)+'%':'—'}</span>
          <span class="cb-mobile-secondary" style="width:64px;text-align:right;color:var(--mut);font-size:11.5px">${cbEsc(x.d.cycle||'—')}</span>
          <span class="cb-mobile-secondary" style="width:100px;text-align:right;color:var(--mut);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(x.d.exDiv||'—')}</span>
        </div>`).join('') || '<div style="padding:20px;text-align:center;color:var(--dim);font-size:12px">배당 지급 종목이 없거나 배당 정보를 아직 불러오지 못했습니다.</div>'}
    </div>
    <div class="cb-panel cb-div-upcoming-card">
      <div class="cb-insight-title">향후 90일 배당 일정</div>
      <div class="cb-div-upcoming-total"><span>예상 수입 합계</span><b>${cbDisp(upcomingDividendTotal)}</b></div>
      <div class="cb-div-upcoming-list">
        ${upcomingDividendShown.map(x=>{
          const label=[x.ticker,x.title].filter(Boolean).join(' · ');
          return `<div class="cb-div-upcoming-row">
            <div class="cb-div-upcoming-date${x.exact?'':' is-estimated'}">${cbEsc(x.dateLabel)}</div>
            <div class="cb-div-upcoming-main">
              <span class="cb-div-upcoming-name cb-tip-block" data-overflow-tip="${cbEsc(label)}" data-overflow-watch>${cbEsc(label)}</span>
              <span>${ownerF?'':cbEsc(x.owner)+' · '}${cbDisp(x.amount)}</span>
            </div>
          </div>`;
        }).join('') || '<div class="cb-insight-empty">향후 90일 내 예상 배당이 없습니다.</div>'}
      </div>
      ${upcomingDividends.length>upcomingDividendShown.length?`<div class="cb-insight-more">외 ${upcomingDividends.length-upcomingDividendShown.length}건</div>`:''}
      <div class="cb-div-upcoming-note">지급일이 확인되지 않은 종목은 ‘월 예정’으로 표시합니다.</div>
    </div>
    </div>`;
}
function cbDivMonthPick(m){
  const month=Number(m);
  _cbDivMonthFilter=(_cbDivMonthFilter===month?null:month);
  cbDivBarHide();
  cbRenderDiv();
  requestAnimationFrame(()=>document.querySelector('#cb-divm .cb-div-history-panel')?.scrollIntoView({behavior:'smooth',block:'start'}));
}
function cbDivOwner(o){ _cbDivOwner=o; _cbDivMonthFilter=null; cbRenderDiv(); }
function cbDivYear(y){ _cbDivYear=y; _cbDivMonthFilter=null; cbRenderDiv(); }

// ───────────────────────── 페이지: 가족 증여 ─────────────────────────
// 좌: 자녀 정기증여(유기정기금 PV) / 우: 부부 증여(10년 6억 공제 한도)
// 설정값은 KV ext_data.giftActual + localStorage 미러로 영속화한다.
//   { birth:'YYYY-MM', years, rate, child:[월 이체액 ×4], marriage:'YYYY-MM-DD', spouse:[구간 총액 ×4] }
window._giftActual = window._giftActual || (function(){
  try{ return JSON.parse(localStorage.getItem('giftActual')||'{}') || {}; }catch(e){ return {}; }
})();

const CB_GIFT_SEG_COLORS  = ['#5b9bff','#4ecdc4','#f2a33c','#c084fc'];
const CB_GIFT_CHILD_SEGS  = [
  {label:'미성년 전기', ages:'0-9세',   a0:0,  limit:20000000},
  {label:'미성년 후기', ages:'10-19세', a0:10, limit:20000000},
  {label:'성년 전기',   ages:'20-29세', a0:20, limit:50000000},
  {label:'성년 후기',   ages:'30-39세', a0:30, limit:50000000},
];
const CB_GIFT_CHILD_DEFAULT  = [150000, 200000, 300000, 400000];
const CB_GIFT_SPOUSE_LIMIT   = 600000000;  // 배우자 증여재산공제 — 10년간 6억원
const CB_GIFT_SPOUSE_COLOR   = '#4ecdc4';
const CB_GIFT_GREY           = '#94a3c8';

// ── 설정값 접근 ──────────────────────────────────────────────
function cbGiftCfg(){ return (window._giftActual = window._giftActual || {}); }
function cbGiftSave(){
  try{ localStorage.setItem('giftActual', JSON.stringify(cbGiftCfg())); }catch(e){}
  try{ saveExtDataToKV(); }catch(e){}
  cbRenderGift();
}
function cbGiftBirth(){ const b=cbGiftCfg().birth; return /^\d{4}-\d{2}$/.test(b||'') ? b : '2023-08'; }
function cbGiftMarriage(){ const m=cbGiftCfg().marriage; return /^\d{4}-\d{2}-\d{2}$/.test(m||'') ? m : '2020-05-30'; }
function cbGiftYears(){ const n=parseInt(cbGiftCfg().years,10); return (isFinite(n)&&n>=5&&n<=60) ? n : 40; }
function cbGiftRate(){ const r=parseFloat(cbGiftCfg().rate); return (isFinite(r)&&r>=0&&r<=20) ? r : 3; }
function cbGiftChildAmt(k){
  const arr = cbGiftCfg().child;
  const v = Array.isArray(arr) ? Number(arr[k]) : NaN;
  return (isFinite(v) && v>=0) ? v : CB_GIFT_CHILD_DEFAULT[k];
}
function cbGiftSpouseAmt(k){
  const arr = cbGiftCfg().spouse;
  const v = Array.isArray(arr) ? Number(arr[k]) : NaN;
  return (isFinite(v) && v>=0) ? v : 0;
}
function cbGiftSetBirth(v){ if(!/^\d{4}-\d{2}$/.test(v||'')) return; cbGiftCfg().birth=v; cbGiftSave(); }
function cbGiftSetMarriage(v){ if(!/^\d{4}-\d{2}-\d{2}$/.test(v||'')) return; cbGiftCfg().marriage=v; cbGiftSave(); }
function cbGiftSetYears(v){ const n=parseInt(v,10); if(!isFinite(n)) return; cbGiftCfg().years=Math.max(5,Math.min(60,n)); cbGiftSave(); }
function cbGiftSetRate(v){ const r=parseFloat(v); if(!isFinite(r)) return; cbGiftCfg().rate=Math.max(0,Math.min(20,r)); cbGiftSave(); }
function cbGiftSetChild(k, raw){
  const c=cbGiftCfg(); if(!Array.isArray(c.child)) c.child=CB_GIFT_CHILD_DEFAULT.slice();
  const v=parseFloat(String(raw||'').replace(/[^\d]/g,''));
  c.child[k] = (isFinite(v)&&v>0) ? Math.round(v) : 0; cbGiftSave();
}
function cbGiftSetSpouse(k, raw){
  const c=cbGiftCfg(); if(!Array.isArray(c.spouse)) c.spouse=[0,0,0,0];
  const v=parseFloat(String(raw||'').replace(/[^\d]/g,''));
  c.spouse[k] = (isFinite(v)&&v>0) ? Math.round(v) : 0; cbGiftSave();
}
// 금액 입력란 천 단위 콤마
function cbGiftFmtInput(el){
  const digits = el.value.replace(/[^\d]/g,'');
  el.value = digits ? Number(digits).toLocaleString('ko-KR') : '';
}

// ── 계산 ────────────────────────────────────────────────────
// 유기정기금 현재가치 계수 — 월이율 i = 연 할인율/12, n개월 통상연금
function cbGiftPvFactor(months, ratePct){
  const i = (ratePct||0)/100/12;
  if (i <= 0) return months;
  return (1 - Math.pow(1+i, -months)) / i;
}
// 자녀 구간별 계획 — 월 이체액 → 명목 총액 / PV / 한도 사용률
function cbGiftChildPlan(){
  const rate = cbGiftRate();
  const f120 = cbGiftPvFactor(120, rate);
  return CB_GIFT_CHILD_SEGS.map((g,k)=>{
    const monthly = cbGiftChildAmt(k);
    const nominal = monthly * 120;
    const pv = monthly * f120;
    return { ...g, idx:k, color:CB_GIFT_SEG_COLORS[k], monthly, nominal, pv,
      usePct: g.limit>0 ? pv/g.limit*100 : 0 };
  });
}
// 부부 10년 구간별 계획 — 구간 총액 → 6억 공제 한도 사용률
function cbGiftSpousePlan(){
  return [0,1,2,3].map(k=>({
    idx:k, label:(k+1)+'구간', years:(k*10)+'-'+(k*10+9)+'년',
    y0:k*10, total:cbGiftSpouseAmt(k), limit:CB_GIFT_SPOUSE_LIMIT,
    usePct: cbGiftSpouseAmt(k)/CB_GIFT_SPOUSE_LIMIT*100,
  }));
}
// 출생 연월 기준 만 나이(소수)
function cbGiftAgeNow(){
  const b = new Date(cbGiftBirth()+'-01');
  return (Date.now() - b.getTime()) / (365.25*86400000);
}

// ── 자녀 차트 ────────────────────────────────────────────────
// 회색 = 표시 시작 시점부터의 누적 명목 이체액 / 색 = 현재 구간 내 누적 PV / 빨간 점선 = 구간 비과세 한도
function cbGiftChildChartSvg(w,h){
  const plan = cbGiftChildPlan(), rate = cbGiftRate(), years = cbGiftYears();
  const wn = (typeof cssVar==='function'?cssVar('--warn','#d97706'):'#d97706');
  const by = parseInt(cbGiftBirth().slice(0,4),10);
  const a0 = Math.max(0, Math.round(cbGiftAgeNow()));   // 표시 시작 나이(만 나이 반올림)
  const ages = Array.from({length:years},(_,k)=>a0+k);

  // 연도별 값 산출
  let cumNom = 0;
  const rows = ages.map(a=>{
    const si = Math.floor(a/10);
    const seg = (si>=0 && si<plan.length) ? plan[si] : null;
    cumNom += seg ? seg.monthly*12 : 0;
    // 구간 내 누적 PV — 구간 시작과 표시 시작 중 늦은 쪽부터 경과한 개월 수
    let segPv = 0;
    if (seg){
      const from = Math.max(seg.a0, a0);
      segPv = seg.monthly * cbGiftPvFactor((a - from + 1)*12, rate);
    }
    return { year:by+a, age:a, seg, segPv, cumNom };
  });
  window._cbGiftChildHover = rows;

  const step = cbNiceStep(Math.max(cumNom*1.12, 1)/5);
  const maxV = Math.max(step, Math.ceil(cumNom*1.12/step)*step);
  const gridN = Math.round(maxV/step);
  const padL=54, padR=10, padT=12, padB=24;
  const plotW=w-padL-padR, plotH=h-padT-padB;
  const X=k=>padL + k*(plotW/years);
  const Y=v=>padT + plotH - (v/maxV)*plotH;
  const slot=plotW/years, bw=Math.max(2, slot*0.72);
  let out='';
  for(let g=0; g<=gridN; g++){
    const v=step*g, yy=Y(v).toFixed(1);
    out+=`<line x1="${padL}" x2="${w-padR}" y1="${yy}" y2="${yy}" style="stroke:var(--grid)" stroke-width="1"></line>`;
    out+=`<text x="${padL-6}" y="${(Y(v)+3.6).toFixed(1)}" style="fill:var(--lab)" font-size="10" text-anchor="end" font-family="IBM Plex Mono">${cbTaxAxisLab(v)}</text>`;
  }
  // 누적 명목(회색, 뒤) → 구간 누적 PV(구간색, 앞)
  rows.forEach((r,k)=>{
    const xc = X(k) + slot/2;
    const yN = Y(r.cumNom);
    out+=`<rect x="${(xc-bw/2).toFixed(1)}" y="${yN.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,padT+plotH-yN).toFixed(1)}" rx="1.5" fill="${CB_GIFT_GREY}" opacity="0.35"></rect>`;
    if (r.seg && r.segPv>0){
      const yP = Y(r.segPv);
      out+=`<rect x="${(xc-bw/2).toFixed(1)}" y="${yP.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,padT+plotH-yP).toFixed(1)}" rx="1.5" fill="${r.seg.color}" opacity="0.9"></rect>`;
    }
  });
  // 구간 비과세 한도 계단 (빨간 점선)
  plan.forEach(g=>{
    const kStart = g.a0 - a0, kEnd = g.a0 + 10 - a0;
    const s = Math.max(0, kStart), e = Math.min(years, kEnd);
    if (e<=s) return;
    out+=`<line x1="${X(s).toFixed(1)}" x2="${X(e).toFixed(1)}" y1="${Y(g.limit).toFixed(1)}" y2="${Y(g.limit).toFixed(1)}" stroke="${wn}" stroke-width="1.8" stroke-dasharray="6 5" opacity="0.95"></line>`;
  });
  // X축 나이 라벨
  const stepX = Math.max(1, Math.round(years/5));
  for(let k=0;k<years;k+=stepX){
    out+=`<text x="${(X(k)+slot/2).toFixed(1)}" y="${h-6}" style="fill:var(--lab)" font-size="10" text-anchor="middle" font-family="IBM Plex Mono">${ages[k]}세</text>`;
  }
  out+=`<text x="${(X(years-1)+slot/2).toFixed(1)}" y="${h-6}" style="fill:var(--lab)" font-size="10" text-anchor="middle" font-family="IBM Plex Mono">${ages[years-1]}세</text>`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:auto">${out}</svg>`;
}

// ── 부부 차트 ────────────────────────────────────────────────
// 회색 = 전체 누적 / teal = 10년 구간 내 누적 / 빨간 점선 = 6억 공제 한도
function cbGiftSpouseChartSvg(w,h){
  const plan = cbGiftSpousePlan(), years = cbGiftYears();
  const wn = (typeof cssVar==='function'?cssVar('--warn','#d97706'):'#d97706');
  const my = parseInt(cbGiftMarriage().slice(0,4),10);

  let cumAll = 0;
  const rows = Array.from({length:years},(_,k)=>{
    const si = Math.floor(k/10);
    const seg = (si>=0 && si<plan.length) ? plan[si] : null;
    const inYr = k - (si*10) + 1;                       // 구간 내 몇 년차인지 (1~10)
    const segCum = seg ? seg.total*(inYr/10) : 0;
    cumAll += seg ? seg.total/10 : 0;
    return { year:my+k, nth:k+1, seg, segCum, cumAll };
  });
  window._cbGiftSpouseHover = rows;

  const maxV = Math.max(CB_GIFT_SPOUSE_LIMIT, cumAll*1.12);
  const step = maxV/5;
  const padL=54, padR=10, padT=12, padB=24;
  const plotW=w-padL-padR, plotH=h-padT-padB;
  const X=k=>padL + k*(plotW/years);
  const Y=v=>padT + plotH - (v/maxV)*plotH;
  const slot=plotW/years, bw=Math.max(2, slot*0.72);
  let out='';
  for(let g=0; g<=5; g++){
    const v=step*g, yy=Y(v).toFixed(1);
    out+=`<line x1="${padL}" x2="${w-padR}" y1="${yy}" y2="${yy}" style="stroke:var(--grid)" stroke-width="1"></line>`;
    out+=`<text x="${padL-6}" y="${(Y(v)+3.6).toFixed(1)}" style="fill:var(--lab)" font-size="10" text-anchor="end" font-family="IBM Plex Mono">${cbTaxAxisLab(v)}</text>`;
  }
  rows.forEach((r,k)=>{
    const xc = X(k) + slot/2;
    const yA = Y(r.cumAll);
    out+=`<rect x="${(xc-bw/2).toFixed(1)}" y="${yA.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,padT+plotH-yA).toFixed(1)}" rx="1.5" fill="${CB_GIFT_GREY}" opacity="0.35"></rect>`;
    if (r.segCum>0){
      const yS = Y(r.segCum);
      out+=`<rect x="${(xc-bw/2).toFixed(1)}" y="${yS.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,padT+plotH-yS).toFixed(1)}" rx="1.5" fill="${CB_GIFT_SPOUSE_COLOR}" opacity="0.9"></rect>`;
    }
  });
  // 6억 공제 한도
  out+=`<line x1="${padL}" x2="${w-padR}" y1="${Y(CB_GIFT_SPOUSE_LIMIT).toFixed(1)}" y2="${Y(CB_GIFT_SPOUSE_LIMIT).toFixed(1)}" stroke="${wn}" stroke-width="1.8" stroke-dasharray="6 5" opacity="0.95"></line>`;
  // 10년 구간 경계
  for(let k=10;k<years;k+=10){
    out+=`<line x1="${X(k).toFixed(1)}" x2="${X(k).toFixed(1)}" y1="${padT}" y2="${padT+plotH}" style="stroke:var(--bd2)" stroke-width="1" stroke-dasharray="3 4" opacity="0.7"></line>`;
  }
  const stepX = Math.max(1, Math.round(years/5));
  for(let k=0;k<years;k+=stepX){
    out+=`<text x="${(X(k)+slot/2).toFixed(1)}" y="${h-6}" style="fill:var(--lab)" font-size="10" text-anchor="middle" font-family="IBM Plex Mono">${my+k}</text>`;
  }
  out+=`<text x="${(X(years-1)+slot/2).toFixed(1)}" y="${h-6}" style="fill:var(--lab)" font-size="10" text-anchor="middle" font-family="IBM Plex Mono">${my+years-1}</text>`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:auto">${out}</svg>`;
}

// ── 렌더 ────────────────────────────────────────────────────
function cbRenderGift(){
  const el = document.getElementById('cb-gift2'); if(!el) return;
  const years = cbGiftYears(), rate = cbGiftRate();
  const child = cbGiftChildPlan(), spouse = cbGiftSpousePlan();
  const childPvT  = child.reduce((s,g)=>s+g.pv,0);
  const spouseT   = spouse.reduce((s,g)=>s+g.total,0);
  const num = 'font-family:\'Manrope\',\'Noto Sans KR\',sans-serif';

  cbSetHead('자녀 정기증여와 부부 증여 한도');

  // 입력 필드 (라벨 + 인풋)
  const field = (label, input) => `<label style="flex:1;min-width:132px;display:flex;flex-direction:column;gap:5px">
      <span style="font-size:10.5px;color:var(--lab);font-weight:600">${label}</span>${input}</label>`;
  const moneyInput = (val, onch) => `<input class="cb-input cb-num" value="${val?Number(val).toLocaleString('ko-KR'):''}" placeholder="0"
      inputmode="numeric" oninput="cbGiftFmtInput(this)" onchange="${onch}" style="padding:7px 9px;width:100%;box-sizing:border-box;text-align:right" />`;

  // 구간 진행 행 (좌: 라벨/바, 우: 금액/부제)
  const segRow = (color, title, sub, mainVal, subVal, pct) => `
    <div style="padding:9px 0;border-bottom:1px solid var(--bd)">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px">
        <span style="font-size:12px;font-weight:700">${title} <span style="color:var(--lab);font-weight:500">${sub}</span></span>
        <span class="cb-num" style="font-size:12.5px;font-weight:800;white-space:nowrap">${mainVal}</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
        <span style="flex:1;height:6px;border-radius:3px;background:var(--inner);overflow:hidden;display:block">
          <span style="display:block;height:100%;border-radius:3px;width:${Math.max(pct>0?1.5:0,Math.min(100,pct)).toFixed(1)}%;background:linear-gradient(90deg,${color},#4ecdc4);transition:width .25s"></span>
        </span>
      </div>
      <div style="text-align:right;font-size:10px;color:var(--dim);margin-top:4px">${subVal}</div>
    </div>`;

  el.innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start">

      <!-- ── 자녀 증여 ── -->
      <div class="cb-panel" style="flex:1;min-width:430px;padding:16px 18px">
        <div style="font-size:14px;font-weight:800">자녀 증여</div>
        <div style="font-size:10.5px;color:var(--lab);margin-top:3px">10년 단위 미성년 2천만원·성년 5천만원 한도 · ${years}년 계획</div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:13px">
          ${field('자녀 출생 연월', `<input type="month" class="cb-input cb-num" value="${cbGiftBirth()}" onchange="cbGiftSetBirth(this.value)" style="padding:7px 9px;width:100%;box-sizing:border-box" />`)}
          ${field('표시 기간(년)', `<input type="number" class="cb-input cb-num" value="${years}" min="5" max="60" onchange="cbGiftSetYears(this.value)" style="padding:7px 9px;width:100%;box-sizing:border-box" />`)}
          ${field('<span data-tip="유기정기금 평가에 쓰는 연 할인율. 상속세및증여세법 시행령상 3.0%입니다.">할인율(%)</span>', `<input type="number" class="cb-input cb-num" value="${rate}" min="0" max="20" step="0.1" onchange="cbGiftSetRate(this.value)" style="padding:7px 9px;width:100%;box-sizing:border-box" />`)}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
          ${child.map(g=>field(`${g.label} (${g.ages})`, moneyInput(g.monthly, `cbGiftSetChild(${g.idx}, this.value)`))).join('')}
        </div>
        <div style="font-size:10px;color:var(--dim);margin-top:6px">구간별 <b>월 이체액</b>을 입력하면 10년치를 현재가치(PV)로 환산해 비과세 한도 사용률을 계산합니다.</div>

        <div style="margin-top:14px;padding-top:13px;border-top:1px dashed var(--bd2);text-align:center">
          <div style="font-size:10.5px;color:var(--lab)">현재 누적 증여액(<span data-tip="Present Value — 미래에 나눠 이체할 금액을 할인율로 현재 시점 가치로 환산한 금액. 증여세 신고 기준 금액입니다.">PV</span>)</div>
          <div style="${num};font-size:26px;font-weight:800;margin-top:3px">${cbKrw(childPvT)}</div>
        </div>

        <div style="margin-top:10px">
          ${child.map(g=>segRow(g.color, g.label, '('+g.ages+')',
              cbKrw(g.pv)+' <span style="font-size:10px;color:var(--lab);font-weight:600">PV</span>',
              `명목 ${cbKrw(g.nominal)} → PV ${Math.min(100,g.usePct).toFixed(1)}% 사용`,
              g.usePct)).join('')}
        </div>

        <div style="position:relative;margin-top:12px" onmouseleave="cbGiftHide()">
          ${cbGiftChildChartSvg(760,330)}
          <div style="position:absolute;left:7.1%;right:1.3%;top:0;bottom:24px;display:flex">
            ${Array.from({length:years},(_,k)=>`<div style="flex:1;cursor:crosshair" onmousemove="cbGiftChildHover(event,${k})"></div>`).join('')}
          </div>
        </div>
      </div>

      <!-- ── 부부 증여 ── -->
      <div class="cb-panel" style="flex:1;min-width:430px;padding:16px 18px">
        <div style="font-size:14px;font-weight:800">부부 증여</div>
        <div style="font-size:10.5px;color:var(--lab);margin-top:3px">10년 단위 6억원 한도 · ${years}년 계획</div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:13px">
          ${field('혼인신고일', `<input type="date" class="cb-input cb-num" value="${cbGiftMarriage()}" onchange="cbGiftSetMarriage(this.value)" style="padding:7px 9px;width:100%;box-sizing:border-box" />`)}
          ${field('표시 기간(년)', `<input type="number" class="cb-input cb-num" value="${years}" min="5" max="60" onchange="cbGiftSetYears(this.value)" style="padding:7px 9px;width:100%;box-sizing:border-box" />`)}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
          ${spouse.map(g=>field(`${(g.idx+1)*10}년차까지 총액`, moneyInput(g.total, `cbGiftSetSpouse(${g.idx}, this.value)`))).join('')}
        </div>
        <div style="font-size:10px;color:var(--dim);margin-top:6px">배우자 증여재산공제는 <b>10년간 6억원</b>입니다. 구간별 증여 <b>총액</b>을 입력하세요.</div>

        <div style="margin-top:14px;padding-top:13px;border-top:1px dashed var(--bd2);text-align:center">
          <div style="font-size:10.5px;color:var(--lab)">10년 구간별 누적 증여액</div>
          <div style="${num};font-size:26px;font-weight:800;margin-top:3px">${cbKrw(spouseT)}</div>
        </div>

        <div style="margin-top:10px">
          ${spouse.map(g=>segRow(CB_GIFT_SPOUSE_COLOR, g.label, '('+g.years+')',
              cbKrw(g.total), `한도 6억원 중 ${g.usePct.toFixed(1)}% 사용`, g.usePct)).join('')}
        </div>

        <div style="position:relative;margin-top:12px" onmouseleave="cbGiftHide()">
          ${cbGiftSpouseChartSvg(760,330)}
          <div style="position:absolute;left:7.1%;right:1.3%;top:0;bottom:24px;display:flex">
            ${Array.from({length:years},(_,k)=>`<div style="flex:1;cursor:crosshair" onmousemove="cbGiftSpouseHover(event,${k})"></div>`).join('')}
          </div>
        </div>
      </div>
    </div>
    <div style="font-size:10.5px;color:var(--dim);margin-top:10px;line-height:1.6">
      ※ 상속세 및 증여세법 기준 참고용 시뮬레이션입니다. 실제 신고 시 세무 전문가 확인이 필요합니다.
      할인율(기획재정부령 고시 연 3.0%)과 공제 한도는 변경될 수 있습니다.
    </div>`;
}

// ── 차트 hover ───────────────────────────────────────────────
function _cbGiftTipLine(lab, val, style){
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:18px;padding:1.5px 0">
    <span style="color:var(--mut)">${lab}</span><span class="cb-num" style="font-weight:700;${style||''}">${val}</span></div>`;
}
function _cbGiftTipShow(ev, html){
  const t = _cbPerfTipEl();
  t.innerHTML = html; t.style.display = 'block';
  const rc = t.getBoundingClientRect(), pad = 16;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + rc.width > window.innerWidth - 8) x = ev.clientX - rc.width - pad;
  if (y + rc.height > window.innerHeight - 8) y = ev.clientY - rc.height - pad;
  t.style.left = Math.max(8, x) + 'px';
  t.style.top  = Math.max(8, y) + 'px';
}
function cbGiftChildHover(ev, k){
  const r = (window._cbGiftChildHover||[])[k]; if(!r) return;
  const segName = r.seg ? r.seg.label : '계획 기간 종료';
  const segColor = r.seg ? r.seg.color : 'var(--lab)';
  _cbGiftTipShow(ev, `<div style="font-size:10.5px;color:var(--lab);margin-bottom:5px;font-weight:700">${r.year}년 · ${r.age}세 <span style="color:${segColor}">${segName}</span></div>
    ${_cbGiftTipLine('월 이체액', r.seg?cbKrw(r.seg.monthly):'—')}
    ${_cbGiftTipLine('구간 누적 (PV)', cbKrw(Math.round(r.segPv)), r.seg&&r.segPv>r.seg.limit?'color:var(--warn)':'color:var(--up)')}
    ${_cbGiftTipLine('구간 비과세 한도', r.seg?cbKrw(r.seg.limit):'—')}
    ${_cbGiftTipLine('누적 이체 (명목)', cbKrw(Math.round(r.cumNom)))}`);
}
function cbGiftSpouseHover(ev, k){
  const r = (window._cbGiftSpouseHover||[])[k]; if(!r) return;
  _cbGiftTipShow(ev, `<div style="font-size:10.5px;color:var(--lab);margin-bottom:5px;font-weight:700">${r.year}년<br>${r.nth}년차</div>
    ${_cbGiftTipLine('10년 구간 누적', cbKrw(Math.round(r.segCum)), r.segCum>CB_GIFT_SPOUSE_LIMIT?'color:var(--warn)':'')}
    ${_cbGiftTipLine('전체 누적', cbKrw(Math.round(r.cumAll)))}
    ${_cbGiftTipLine('공제한도', cbKrw(CB_GIFT_SPOUSE_LIMIT))}`);
}
function cbGiftHide(){ const t = document.getElementById('cb-perf-tip'); if(t) t.style.display = 'none'; }

// ───────────────────────── 페이지: 양도소득세 ─────────────────────────
let _cbTaxDraft = { m:String(new Date().getMonth()+1), k:'domestic', acc:'일반', owner:'', pl:'', memo:'' }; // 구분 디폴트 = 국내주식
let _cbTaxYear = null;   // 조회 연도(문자열). null이면 올해.
let _cbTaxOwner = '전체'; // 소유주 필터 ('전체' 또는 소유주명)
let _cbTaxMonthFilter = null; // 차트 클릭으로 하단 내역을 거르는 월(1~12)
let _cbTaxEditId = null; // 수정 중인 실현손익 기록 ID
const CB_TAX_ACCTS = ['일반','연금저축','ISA'];
const CB_TAX_FGN_DED = 2500000;   // 해외주식 기본공제(일반계좌)
const CB_TAX_ISA_DED = 2000000;   // ISA 비과세 한도(일반형 기준)
function cbTaxAcctOf(t){ return CB_TAX_ACCTS.indexOf(t.account)>=0 ? t.account : '일반'; }
function cbTaxTreatment(t){
  const account=cbTaxAcctOf(t);
  if (account==='연금저축') return {
    label:'과세이연', tone:'deferred',
    tip:'계좌 안의 매매차익은 매도 시 과세하지 않고 연금 수령 시점까지 과세를 미룹니다.'
  };
  if (account==='ISA') return {
    label:'9.9% 분리', tone:'separate',
    tip:'ISA 손익통산 후 비과세 한도를 초과한 금액에 9.9% 분리과세가 적용됩니다.'
  };
  if (t.category==='domestic') return {
    label:'비과세', tone:'exempt',
    tip:'일반계좌 국내 상장주식의 소액주주 장내 양도차익 기준입니다.'
  };
  return {
    label:'22% 대상', tone:'taxable',
    tip:'일반계좌 해외주식은 연간 손익통산과 250만원 기본공제 후 22% 세율이 적용됩니다.'
  };
}
function cbNiceStep(raw){
  raw = Math.max(raw||1, 1);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw/p;
  return (n<=1?1:n<=2?2:n<=5?5:10) * p;
}
function cbTaxAxisLab(v){
  if (v===0) return '0';
  const a = Math.abs(v);
  const sign = v>0 ? '+' : '−';
  if (a>=100000000) return sign+(a/100000000).toFixed(a%100000000?1:0)+'억';
  return sign+Math.round(a/10000).toLocaleString('ko-KR')+'만';
}
// 월별 실현손익 막대(국내/해외) + 누적 손익·예상 세액 추이 라인 + 해외 기본공제(250만) 기준선 + hover 상세
function cbTaxChartSvg(w,h,list){
  const agg={}, mgf={}, misa={};
  let maxM=0;
  list.forEach(t=>{ const m=parseInt(String(t.month).split('-')[1]||'0'); if(!m) return;
    const amt=t.amt||0;
    agg[m+'-'+(t.category==='domestic'?'d':'f')]=(agg[m+'-'+(t.category==='domestic'?'d':'f')]||0)+amt;
    const acc=cbTaxAcctOf(t);
    if(acc==='일반' && t.category!=='domestic') mgf[m]=(mgf[m]||0)+amt;
    else if(acc==='ISA') misa[m]=(misa[m]||0)+amt;
    if(m>maxM) maxM=m; });
  // 국내·해외·전체 누적 손익과 예상 세액을 월별로 함께 갱신한다.
  let cf=0, ci=0, cpDom=0, cpFgn=0; const cum=[];
  window._cbTaxHover=[];
  for(let m=1;m<=12;m++){
    cf+=mgf[m]||0; ci+=misa[m]||0;
    cpDom+=agg[m+'-d']||0;
    cpFgn+=agg[m+'-f']||0;
    const cp=cpDom+cpFgn;
    const tax=Math.round(Math.max(0,cf-CB_TAX_FGN_DED)*0.22 + Math.max(0,ci-CB_TAX_ISA_DED)*0.099);
    cum[m]={fgn:cf, isa:ci, domProfit:cpDom, fgnProfit:cpFgn, profit:cp, tax};
    window._cbTaxHover[m]={m, dom:agg[m+'-d']||0, fgn:agg[m+'-f']||0, cumDomProfit:cpDom, cumFgnProfit:cpFgn, cumProfit:cp, tax};
  }
  const vals=Object.values(agg);
  const DED=CB_TAX_FGN_DED,
        wn=(typeof cssVar==='function'?cssVar('--warn','#d97706'):'#d97706'),
        acc3=(typeof cssVar==='function'?cssVar('--acc3','#7c3aed'):'#7c3aed'),
        dn=(typeof cssVar==='function'?cssVar('--dn','#cf3d5c'):'#cf3d5c');
  const taxVals=maxM?cum.slice(1,maxM+1).map(c=>c.tax):[0];
  const profitVals=maxM?cum.slice(1,maxM+1).map(c=>c.profit):[0];
  const domProfitVals=maxM?cum.slice(1,maxM+1).map(c=>c.domProfit):[0];
  const fgnProfitVals=maxM?cum.slice(1,maxM+1).map(c=>c.fgnProfit):[0];
  const allLineVals=[...taxVals,...profitVals,...domProfitVals,...fgnProfitVals];
  const rawMax=Math.max(DED*1.15, 1, ...vals.filter(v=>v>0), ...allLineVals.filter(v=>v>0));
  const rawMin=Math.min(0, ...vals.filter(v=>v<0), ...allLineVals.filter(v=>v<0));
  const step=cbNiceStep((rawMax-rawMin)/5);
  const maxV=Math.ceil(rawMax/step)*step, minV=Math.floor(rawMin/step)*step;
  const padL=64, padR=108, padT=14, padB=22;
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
  // 월별 막대 (국내 → 해외 순)
  const bw=(plotW/12)/2-5;
  for(let m=1;m<=12;m++){
    const xf=padL+(m-1)/12*plotW+5;
    [['d','#4ecdc4',0],['f','var(--acc)',1]].forEach(cfg=>{
      const v=agg[m+'-'+cfg[0]]||0; if(!v) return;
      const yTop=Y(Math.max(0,v)), yBot=Y(Math.min(0,v));
      out+=`<rect x="${(xf+cfg[2]*(bw+3)).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1,yBot-yTop).toFixed(1)}" rx="2" style="fill:${cfg[1]}" opacity=".9"></rect>`;
    });
    out+=`<text x="${(xf+bw).toFixed(1)}" y="${h-6}" style="fill:var(--lab)" font-size="10" text-anchor="middle" font-family="Noto Sans KR">${m}월</text>`;
  }
  // 국내·해외·전체 누적 실현손익 추이 라인 (기록이 있는 마지막 달까지)
  if(maxM>=1){
    const endLabels=[];
    const cumulativeLine=(key,label,color,width,dash,opacity) => {
      const pts=[]; for(let m=1;m<=maxM;m++) pts.push({x:padL+(m-0.5)/12*plotW, y:Y(cum[m][key])});
      out+=`<path d="${cbSmoothPath(pts)}" fill="none" stroke="${color}" stroke-width="${width}"${dash?` stroke-dasharray="${dash}"`:''} stroke-linejoin="round" stroke-linecap="round" opacity="${opacity}"></path>`;
      pts.forEach(p=>{ out+=`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${key==='profit'?'3.2':'2.5'}" fill="${color}"></circle>`; });
      endLabels.push({label,color,p:pts[pts.length-1]});
    };
    cumulativeLine('domProfit','국내 누적','#4ecdc4',1.9,'3 4','.86');
    cumulativeLine('fgnProfit','해외 누적','var(--acc)',1.9,'6 4','.88');
    cumulativeLine('profit','전체 누적',acc3,2.8,'','.98');
    // 누적 예상 세액 추이 라인
    const taxPts=[]; for(let m=1;m<=maxM;m++) taxPts.push({x:padL+(m-0.5)/12*plotW, y:Y(cum[m].tax)});
    out+=`<path d="${cbSmoothPath(taxPts)}" fill="none" stroke="${dn}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" opacity=".95"></path>`;
    taxPts.forEach(p=>{ out+=`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.4" fill="${dn}"></circle>`; });
    endLabels.push({label:'예상 세액',color:dn,p:taxPts[taxPts.length-1]});

    // 마지막 손익 등록 월의 끝점에만 라인명을 표시한다. 값이 비슷하면 자동으로 간격을 벌린다.
    const ordered=endLabels.sort((a,b)=>a.p.y-b.p.y);
    const minY=padT+8, maxY=padT+plotH-4, gap=14;
    ordered.forEach((d,i)=>{ d.ly=Math.max(d.p.y,i?ordered[i-1].ly+gap:minY); });
    const overflow=ordered[ordered.length-1].ly-maxY;
    if(overflow>0) ordered.forEach(d=>{ d.ly-=overflow; });
    for(let i=ordered.length-2;i>=0;i--) ordered[i].ly=Math.min(ordered[i].ly,ordered[i+1].ly-gap);
    const underflow=minY-ordered[0].ly;
    if(underflow>0) ordered.forEach(d=>{ d.ly+=underflow; });
    ordered.forEach(d=>{
      const labelX=Math.min(w-78,d.p.x+11);
      out+=`<path d="M${(d.p.x+3).toFixed(1)},${d.p.y.toFixed(1)} L${(labelX-4).toFixed(1)},${d.ly.toFixed(1)}" fill="none" stroke="${d.color}" stroke-width="1" opacity=".65"></path>`;
      out+=`<text class="cb-tax-end-label" x="${labelX.toFixed(1)}" y="${(d.ly+3.5).toFixed(1)}" fill="${d.color}" font-size="9.5" font-weight="800" font-family="Noto Sans KR">${d.label}</text>`;
    });
  }
  // hover/클릭 히트영역 — hover 시 월 음영, 클릭 시 하단 내역 필터
  for(let m=1;m<=12;m++){
    const x0=padL+(m-1)/12*plotW;
    out+=`<rect class="cb-tax-month-hit" x="${x0.toFixed(1)}" y="${padT}" width="${(plotW/12).toFixed(1)}" height="${plotH}" fill="${_cbTaxMonthFilter===m?'var(--accSoft)':'transparent'}" onmousemove="this.style.fill='var(--accSoft)';cbTaxHover(event,${m})" onmouseleave="this.style.fill='${_cbTaxMonthFilter===m?'var(--accSoft)':'transparent'}';cbTaxHide()" onclick="cbTaxMonthPick(${m})"></rect>`;
  }
  // 균일 스케일(meet) + width:100%/height:auto 로 종횡비 유지 → 텍스트가 가로로 늘어나지 않는다.
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:auto">${out}</svg>`;
}
// 차트 hover — 해당 월 실현손익/누적 손익/예상 세액 상세 (body 레벨 고정 툴팁 재사용)
function cbTaxHover(ev, m){
  const r=(window._cbTaxHover||[])[m]; if(!r) return;
  const t=_cbPerfTipEl();
  const line=(lab,val,style='')=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:18px;padding:1.5px 0">
    <span style="color:var(--mut)">${lab}</span><span class="cb-num" style="font-weight:700;${style}">${val}</span></div>`;
  t.innerHTML = `<div style="font-size:10.5px;color:var(--lab);margin-bottom:5px;font-weight:700">${m}월 실현손익 · 누적 추이</div>
    ${line('<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:2px;background:#4ecdc4"></span>국내주식</span>', (r.dom>=0?'+':'')+cbKrw(r.dom), cbUpDn(r.dom))}
    ${line('<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:2px;background:var(--acc)"></span>해외주식</span>', (r.fgn>=0?'+':'')+cbKrw(r.fgn), cbUpDn(r.fgn))}
    <div style="border-top:1px solid var(--bd);margin:5px 0 4px"></div>
    ${line('국내 누적손익', (r.cumDomProfit>=0?'+':'')+cbKrw(r.cumDomProfit), cbUpDn(r.cumDomProfit))}
    ${line('해외 누적손익', (r.cumFgnProfit>=0?'+':'')+cbKrw(r.cumFgnProfit), cbUpDn(r.cumFgnProfit))}
    ${line('전체 누적손익', (r.cumProfit>=0?'+':'')+cbKrw(r.cumProfit), cbUpDn(r.cumProfit))}
    ${line('누적 예상 세액', cbKrw(r.tax), 'color:var(--dn)')}
    <div style="font-size:10px;color:var(--dim);margin-top:4px">해외 일반 22% (공제 250만) + ISA 9.9% (한도 200만)<br>국내 소액주주 장내 양도차익은 비과세</div>`;
  t.style.display='block';
  const rc=t.getBoundingClientRect(); const pad=16;
  let x=ev.clientX+pad, y=ev.clientY+pad;
  if(x+rc.width>window.innerWidth-8) x=ev.clientX-rc.width-pad;
  if(y+rc.height>window.innerHeight-8) y=ev.clientY-rc.height-pad;
  t.style.left=Math.max(8,x)+'px';
  t.style.top=Math.max(8,y)+'px';
}
function cbTaxHide(){ const t=document.getElementById('cb-perf-tip'); if(t) t.style.display='none'; }
function cbSortTaxEntries(list, ownerOf){
  const taxOwnerRank = t => {
    const i=OWNERS.indexOf(ownerOf(t));
    return i<0 ? 99 : i;
  };
  // 내역은 월을 최우선으로 묶고, 같은 월 안에서 국내 → 해외 → 소유주 순으로 정렬한다.
  return [...list].sort((a,b)=>
    String(a.month).localeCompare(String(b.month))
    || ((a.category==='domestic'?0:1)-(b.category==='domestic'?0:1))
    || (taxOwnerRank(a)-taxOwnerRank(b)));
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
  // 소유주 필터 — 소유주가 지정되지 않은 레거시 기록(owner 없음/'전체')은 '전체' 탭에서만 집계
  if (_cbTaxOwner!=='전체' && OWNERS.indexOf(_cbTaxOwner)<0) _cbTaxOwner = '전체';
  const ownerOf = t => (t.owner && t.owner!=='전체') ? t.owner : null;
  const list = (monthlyPLData||[]).filter(t=>String(t.month||'').startsWith(year))
    .filter(t=>_cbTaxOwner==='전체' || ownerOf(t)===_cbTaxOwner);
  const ownerSuffix = _cbTaxOwner==='전체' ? '' : ' · '+cbEsc(_cbTaxOwner);
  const sumBy = pred => list.filter(pred).reduce((s,t)=>s+(t.amt||0),0);
  // 계좌별 과세 차별화
  const genFgn = sumBy(t=>cbTaxAcctOf(t)==='일반' && t.category!=='domestic');
  const genDom = sumBy(t=>cbTaxAcctOf(t)==='일반' && t.category==='domestic');
  const genBase = Math.max(0, genFgn-CB_TAX_FGN_DED), genDue = Math.round(genBase*0.22);
  const isaNet = sumBy(t=>cbTaxAcctOf(t)==='ISA');
  const isaBase = Math.max(0, isaNet-CB_TAX_ISA_DED), isaDue = Math.round(isaBase*0.099);
  const penNet = sumBy(t=>cbTaxAcctOf(t)==='연금저축');
  const totalDue = genDue + isaDue;
  // 해외 일반계좌 절세 여력 — 현재 실현손익에서 기본공제까지 추가로 확정할 수 있는 순이익과
  // 보유 중인 해외 일반계좌 미실현 손실 후보를 함께 보여준다.
  const deductionRoom = Math.max(0, CB_TAX_FGN_DED-genFgn);
  const deductionUsePct = Math.max(0, Math.min(100, genFgn/CB_TAX_FGN_DED*100));
  const harvestCandidates = (pfolioData||[])
    .filter(i=>i && i.grp==='주식' && (i.qty||0)>0 && cbCls(i)!=='kr'
      && (i.acc||'일반')==='일반'
      && (_cbTaxOwner==='전체' || i.owner===_cbTaxOwner))
    .map(i=>({ i, loss:cbGainKRW(i) }))
    .filter(x=>x.loss<0)
    .sort((a,b)=>a.loss-b.loss);
  const harvestTotal = harvestCandidates.reduce((s,x)=>s+Math.abs(x.loss),0);
  const historyList = _cbTaxMonthFilter
    ? list.filter(t=>parseInt(String(t.month).split('-')[1]||'0')===_cbTaxMonthFilter)
    : list;
  const sorted = cbSortTaxEntries(historyList, ownerOf);
  const row2 = (lab,val,style='') => `<div style="display:flex;justify-content:space-between;font-size:11.5px"><span style="color:var(--mut)">${lab}</span><span style="font-weight:700;${style}">${val}</span></div>`;
  const acctOpts = _cbTaxDraft.k==='foreign' ? ['일반'] : CB_TAX_ACCTS;
  if (acctOpts.indexOf(_cbTaxDraft.acc)<0) _cbTaxDraft.acc = acctOpts[0];
  // 기록 폼의 소유주 기본값 = 현재 선택된 소유주 탭 ('전체' 탭이면 첫 소유주)
  const draftOwner = (OWNERS.indexOf(_cbTaxDraft.owner)>=0) ? _cbTaxDraft.owner
    : (_cbTaxOwner!=='전체' ? _cbTaxOwner : OWNERS[0]);
  // 소유주 탭·조회 연도는 메인 제목 라인(글로벌 헤더) 우측으로
  cbSetHead(
    '계좌(일반·연금저축·ISA)별 실현손익과 예상 세액 · 매도 확정 손익 기준',
    `${cbOwnerBtns(_cbTaxOwner,'cbTaxOwner')}
     <label style="display:flex;align-items:center;gap:7px;font-size:11px;color:var(--lab);font-weight:600">조회 연도
       <select class="cb-input" onchange="cbTaxYear(this.value)" style="padding:6px 9px">${years.map(y=>`<option value="${y}" ${y===year?'selected':''}>${y}년</option>`).join('')}</select>
     </label>`
  );
  el.innerHTML = `
    <!-- 상단 요약: 기존 5개를 압축하고 해외 기본공제 사용률을 추가 -->
    <div class="cb-tax-summary-grid">
      <div class="cb-panel cb-tax-summary-card" style="border-top-color:var(--dn)">
        <div style="font-size:11px;letter-spacing:.06em;color:var(--lab);font-weight:800">${year}년 예상 납부세액 합계${ownerSuffix}</div>
        <div style="flex:1;display:flex;align-items:center">
          <div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:23px;font-weight:800;color:var(--dn)">${cbKrw(totalDue)}</div>
        </div>
        <div style="font-size:10.5px;color:var(--dim);padding-top:8px;line-height:1.5">일반 해외 ${cbKrw(genDue)} + ISA ${cbKrw(isaDue)}<br>신고 ${parseInt(year)+1}년 5월</div>
      </div>
      <div class="cb-panel cb-tax-summary-card" style="border-top-color:var(--acc)">
        <div style="font-size:11px;letter-spacing:.06em;color:var(--lab);font-weight:800;margin-bottom:8px">일반 · 해외주식 <span style="color:var(--dim);font-weight:500">· 양도소득세</span></div>
        <div style="display:flex;flex-direction:column;gap:5px;flex:1">
          ${row2('실현손익 합계', (genFgn>=0?'+':'')+cbKrw(genFgn), cbUpDn(genFgn))}
          ${row2('<span data-tip="해외주식 양도차익에서 연 250만원까지 비과세">기본공제</span>', '−'+cbKrw(CB_TAX_FGN_DED))}
          ${row2('<span data-tip="실현손익에서 기본공제를 뺀, 세율이 적용되는 금액">과세표준</span>', cbKrw(genBase))}
          ${row2('세율', '22% <span style="color:var(--dim);font-weight:400">(지방세 포함)</span>')}
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:auto;padding-top:6px;border-top:1px solid var(--bd)"><span style="font-weight:700;font-size:12px">예상 세액</span><span style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:16px;font-weight:800;color:var(--dn)">${cbKrw(genDue)}</span></div>
        </div>
      </div>
      <div class="cb-panel cb-tax-summary-card" style="border-top-color:var(--warn)">
        <div style="font-size:11px;letter-spacing:.06em;color:var(--lab);font-weight:800;margin-bottom:8px">해외 기본공제 사용률</div>
        <div class="cb-tax-deduction-value">
          <div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:21px;font-weight:800;color:var(--warn)">${deductionUsePct.toFixed(1)}%</div>
        </div>
        <div class="cb-tax-deduction-track"><span style="width:${deductionUsePct.toFixed(2)}%"></span></div>
        <div class="cb-tax-deduction-remain">잔여 공제 ${cbKrw(deductionRoom)}</div>
      </div>
      <div class="cb-panel cb-tax-summary-card" style="border-top-color:#4ecdc4">
        <div style="font-size:11px;letter-spacing:.06em;color:var(--lab);font-weight:800;margin-bottom:8px">일반 · 국내주식 <span style="color:var(--dim);font-weight:500">· 소액주주 비과세</span></div>
        <div style="display:flex;flex-direction:column;gap:5px;flex:1">
          ${row2('실현손익 합계', (genDom>=0?'+':'')+cbKrw(genDom), cbUpDn(genDom))}
          ${row2('<span data-tip="종목당 보유액 50억원 미만·지분율 기준 미만인 일반 투자자">소액주주</span> 장내 양도차익', '<span style="color:var(--up);font-weight:700">비과세</span>')}
          ${row2('<span data-tip="매도 대금에 부과되는 세금(손익과 무관). 코스피 0.15% + 농특세 등, 코스닥 0.15%">증권거래세</span>', '매도액 0.15%')}
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:auto;padding-top:6px;border-top:1px solid var(--bd)"><span style="font-weight:700;font-size:12px">예상 양도세액</span><span style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:16px;font-weight:800;color:var(--up)">${cbKrw(0)}</span></div>
        </div>
      </div>
      <div class="cb-panel cb-tax-summary-card" style="border-top-color:var(--purple,#c084fc)">
        <div style="font-size:11px;letter-spacing:.06em;color:var(--lab);font-weight:800;margin-bottom:8px">ISA 계좌 <span style="color:var(--dim);font-weight:500">· 손익통산 분리과세</span></div>
        <div style="display:flex;flex-direction:column;gap:5px;flex:1">
          ${row2('순이익 (국내·해외 통산)', (isaNet>=0?'+':'')+cbKrw(isaNet), cbUpDn(isaNet))}
          ${row2('<span data-tip="ISA 일반형 비과세 한도 200만원(서민·농어민형 400만원)">비과세 한도</span>', '−'+cbKrw(CB_TAX_ISA_DED))}
          ${row2('과세표준', cbKrw(isaBase))}
          ${row2('세율', '9.9% <span style="color:var(--dim);font-weight:400">(분리과세)</span>')}
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:auto;padding-top:6px;border-top:1px solid var(--bd)"><span style="font-weight:700;font-size:12px">예상 세액</span><span style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:16px;font-weight:800;color:var(--dn)">${cbKrw(isaDue)}</span></div>
        </div>
      </div>
      <div class="cb-panel cb-tax-summary-card" style="border-top-color:var(--up)">
        <div style="font-size:11px;letter-spacing:.06em;color:var(--lab);font-weight:800;margin-bottom:8px">연금저축 계좌 <span style="color:var(--dim);font-weight:500">· 과세이연</span></div>
        ${row2('순이익', (penNet>=0?'+':'')+cbKrw(penNet), cbUpDn(penNet))}
        <div style="font-size:10.5px;color:var(--mut);margin-top:7px;line-height:1.65">
          계좌 내 매매차익: <b style="color:var(--up)">매도 시 과세 없음</b><br>
          연금 수령: 연금소득세 3.3~5.5%<br>
          중도 인출: 기타소득세 16.5% · 당해 양도세 제외
        </div>
      </div>
    </div>
    <!-- 월별 실현손익 + 누적 손익·예상 세액 추이 (마우스 오버 시 월별 상세) -->
    <div class="cb-panel" style="margin-top:12px;padding:16px 18px 10px">
      <div style="display:flex;gap:14px;margin-bottom:8px;font-size:11px;color:var(--mut);flex-wrap:wrap">
        <span style="font-size:10.5px;letter-spacing:.08em;color:var(--lab)">${year}년 월별 실현손익 · 누적 추이 <span style="color:var(--dim)">· 호버: 월 강조·상세 · 클릭: 하단 내역 필터</span></span>
        <span style="display:flex;align-items:center;gap:5px;margin-left:auto"><span style="width:10px;height:10px;border-radius:2px;background:#4ecdc4"></span>국내주식</span>
        <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:var(--acc)"></span>해외주식</span>
        <span style="display:flex;align-items:center;gap:5px"><span style="width:14px;height:0;border-top:2px dashed #4ecdc4"></span>국내 누적손익</span>
        <span style="display:flex;align-items:center;gap:5px"><span style="width:14px;height:0;border-top:2px dashed var(--acc)"></span>해외 누적손익</span>
        <span style="display:flex;align-items:center;gap:5px"><span style="width:14px;height:3px;border-radius:2px;background:var(--acc3)"></span>전체 누적손익</span>
        <span style="display:flex;align-items:center;gap:5px"><span style="width:14px;height:3px;border-radius:2px;background:var(--dn)"></span>누적 예상 세액</span>
      </div>
      ${cbTaxChartSvg(1100,430,list)}
    </div>
    <!-- 하단: 좁아진 실현손익 내역 + 연말 절세 여력 -->
    <div class="cb-tax-bottom-grid">
      <div class="cb-panel cb-tax-history-panel" style="padding:14px 16px;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <div style="font-size:10.5px;letter-spacing:.08em;color:var(--lab)">실현손익 기록 <span style="color:var(--dim)">· 매도 확정 손익</span></div>
          ${_cbTaxMonthFilter?`<button class="cb-btn" onclick="cbTaxMonthPick(${_cbTaxMonthFilter})" style="margin-left:auto;padding:4px 9px;font-size:10.5px">${_cbTaxMonthFilter}월 내역 · 전체 보기 ×</button>`:''}
        </div>
        <div style="display:flex;gap:7px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
          <select id="cb-tax-m" class="cb-input">${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${String(i+1)===_cbTaxDraft.m?'selected':''}>${i+1}월</option>`).join('')}</select>
          <select id="cb-tax-k" class="cb-input" onchange="cbTaxKindChange(this.value)"><option value="domestic" ${_cbTaxDraft.k==='domestic'?'selected':''}>국내주식</option><option value="foreign" ${_cbTaxDraft.k==='foreign'?'selected':''}>해외주식</option></select>
          <select id="cb-tax-acc" class="cb-input">${acctOpts.map(a=>`<option value="${a}" ${a===_cbTaxDraft.acc?'selected':''}>${a}</option>`).join('')}</select>
          <select id="cb-tax-owner" class="cb-input">${OWNERS.map(o=>`<option value="${cbEsc(o)}" ${o===draftOwner?'selected':''}>${cbEsc(o)}</option>`).join('')}</select>
          <input id="cb-tax-pl" class="cb-input" value="${cbEsc(String(_cbTaxDraft.pl||'').replace(/,/g,'').replace(/^-?\d+$/,v=>(v.startsWith('-')?'-':'')+Math.abs(parseInt(v,10)).toLocaleString('ko-KR')))}" placeholder="실현손익" inputmode="numeric" data-no-comma="1" oninput="handlePLAmtInput(this)" style="flex:1;min-width:118px" />
          <input id="cb-tax-memo" class="cb-input" value="${cbEsc(_cbTaxDraft.memo||'')}" placeholder="메모" style="flex:1;min-width:118px" />
          <button onclick="cbTaxAdd()" class="cb-btn" style="padding:8px 12px;font-size:12px">${_cbTaxEditId!=null?'수정 저장':'기록'}</button>
          ${_cbTaxEditId!=null?'<button onclick="cbTaxCancelEdit()" class="cb-btn" style="padding:8px 10px;font-size:12px;color:var(--mut)">취소</button>':''}
        </div>
        <div style="overflow-x:auto"><div style="min-width:620px">
          <div class="cb-thead" style="display:flex;align-items:center;font-size:10.5px;color:var(--dim);padding:0 6px 6px;border-bottom:1px solid var(--bd)">
            <span style="width:58px">소유주</span><span style="width:40px">월</span><span style="width:52px">시장</span><span style="width:64px">계좌</span><span style="width:82px;text-align:center"><span data-tip="계좌 유형과 시장에 따라 이 실현손익에 적용되는 대표 세제 방식">세제 구분</span></span><span style="flex:1;min-width:72px">메모</span><span style="width:112px;text-align:right">실현손익</span>
            <span style="width:54px;text-align:center"><span class="cb-tax-head-grid"><span></span><span>관리</span></span></span>
          </div>
          ${sorted.map(t=>{ const taxId=Number(t.id), treatment=cbTaxTreatment(t); return `
            <div style="display:flex;align-items:center;padding:7px 6px;border-bottom:1px solid var(--bd);font-size:12px">
              <span style="width:58px;display:flex;align-items:center;gap:5px;flex-shrink:0;font-size:11px;font-weight:600;${ownerOf(t)?'color:var(--mut)':'color:var(--dim)'}"><span style="width:7px;height:7px;border-radius:50%;background:${ownerOf(t)?cbOwnerColor(ownerOf(t)):'#8a97b0'};flex-shrink:0"></span>${ownerOf(t)?cbEsc(ownerOf(t)):'미지정'}</span>
              <span style="width:40px;color:var(--mut)">${parseInt(String(t.month).split('-')[1]||'0')}월</span>
              <span style="width:52px;font-weight:800;color:${t.category==='domestic'?'var(--acc2)':'var(--warn)'}">${t.category==='domestic'?'국내':'해외'}</span>
              <span style="width:64px;font-size:10.5px;color:var(--mut)">${cbEsc(cbTaxAcctOf(t))}</span>
              <span style="width:82px;display:flex;justify-content:center"><span class="cb-tax-treatment is-${treatment.tone}" data-tip="${cbEsc(treatment.tip)}">${cbEsc(treatment.label)}</span></span>
              <span style="flex:1;min-width:72px;color:var(--mut);font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:6px">${cbEsc(t.memo||'—')}</span>
              <span class="cb-num" style="width:112px;text-align:right;font-weight:700;font-size:11.5px;${cbUpDn(t.amt||0)}">${(t.amt>=0?'+':'')+cbKrw(t.amt||0)}</span>
              <span class="cb-tax-actions" style="width:54px">
                <button class="btn-action" title="수정" style="color:var(--t3)" onclick="cbTaxEdit(${taxId})">✎</button>
                <button class="btn-action" title="삭제" style="color:var(--dn)" onclick="cbTaxDel(${taxId})">✕</button>
              </span>
            </div>`;}).join('') || '<div style="padding:16px;text-align:center;color:var(--dim);font-size:12px">기록된 실현손익이 없습니다.</div>'}
        </div></div>
      </div>
      <div class="cb-panel cb-tax-saving-panel" style="padding:15px 16px;min-width:0">
        <div style="font-size:10.5px;letter-spacing:.08em;color:var(--lab);font-weight:800">연말 절세 여력${ownerSuffix}</div>
        <div style="font-size:10px;color:var(--dim);margin-top:3px">해외 일반계좌 · ${year}년 실현손익 기준</div>
        <div style="margin-top:14px">
          <div style="font-size:10.5px;color:var(--mut)">세금 없이 추가 실현 가능한 순이익</div>
          <div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:23px;font-weight:800;color:${deductionRoom>0?'var(--up)':'var(--lab)'};margin-top:2px">${cbKrw(deductionRoom)}</div>
        </div>
        <div style="margin-top:11px">
          <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--mut)"><span>기본공제 사용률</span><b>${deductionUsePct.toFixed(1)}%</b></div>
          <div style="height:7px;border-radius:5px;background:var(--inner);overflow:hidden;margin-top:5px"><div style="height:100%;width:${deductionUsePct}%;background:${deductionUsePct>=100?'var(--dn)':'var(--acc)'}"></div></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:13px;padding-top:11px;border-top:1px solid var(--bd)">
          ${row2('해외 일반 실현손익', (genFgn>=0?'+':'')+cbKrw(genFgn), cbUpDn(genFgn))}
          ${row2('공제 초과 과세표준', cbKrw(genBase), genBase>0?'color:var(--dn)':'color:var(--lab)')}
          ${row2('미실현 손실 후보 합계', harvestTotal>0?'−'+cbKrw(harvestTotal):cbKrw(0), harvestTotal>0?'color:var(--dn)':'color:var(--lab)')}
        </div>
        <div style="font-size:10.5px;color:var(--lab);font-weight:800;margin-top:14px">손실 상계 후보 TOP 3</div>
        <div style="display:flex;flex-direction:column;gap:5px;margin-top:7px">
          ${harvestCandidates.slice(0,3).map(x=>`
            <div style="display:flex;align-items:center;gap:7px;font-size:11px">
              <span style="width:7px;height:7px;border-radius:50%;background:${cbOwnerColor(x.i.owner)};flex-shrink:0"></span>
              <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--mut)">${cbEsc(x.i.name||x.i.tkr)}${_cbTaxOwner==='전체'?` · ${cbEsc(x.i.owner)}`:''}</span>
              <b class="cb-num" style="color:var(--dn);flex-shrink:0">−${cbKrw(Math.abs(x.loss))}</b>
            </div>`).join('') || '<div style="font-size:11px;color:var(--dim)">현재 미실현 손실 후보가 없습니다.</div>'}
        </div>
        <div style="font-size:9.5px;color:var(--dim);line-height:1.55;margin-top:auto;padding-top:12px">손실 상계 후보는 해외 일반계좌의 현재 평가손실만 표시합니다. 실제 매도 전 수수료·환율·세법 적용 여부를 확인하세요.</div>
      </div>
    </div>`;
}
function cbTaxYear(y){ _cbTaxYear = y; cbRenderTax(); }
// 소유주 탭 — 요약 카드·차트·내역이 모두 list 파생이라 필터만 바꾸면 전부 갱신된다
function cbTaxOwner(o){ _cbTaxOwner = o; _cbTaxDraft.owner = ''; cbRenderTax(); }
function cbTaxMonthPick(m){
  const month = Number(m);
  _cbTaxMonthFilter = (_cbTaxMonthFilter===month ? null : month);
  cbTaxHide();
  cbRenderTax();
  requestAnimationFrame(()=>document.querySelector('#cb-tax2 .cb-tax-history-panel')?.scrollIntoView({block:'nearest',behavior:'smooth'}));
}
// 구분(국내/해외) 변경 → 해외주식은 일반 계좌만 노출 (해외 상장 주식은 ISA·연금저축에서 직접 매매 불가)
function cbTaxKindChange(v){
  _cbTaxDraft.k = v;
  _cbTaxDraft.pl = document.getElementById('cb-tax-pl')?.value || '';
  _cbTaxDraft.memo = document.getElementById('cb-tax-memo')?.value || '';
  _cbTaxDraft.m = document.getElementById('cb-tax-m')?.value || _cbTaxDraft.m;
  _cbTaxDraft.owner = document.getElementById('cb-tax-owner')?.value || _cbTaxDraft.owner;
  const sel = document.getElementById('cb-tax-acc'); if(!sel) return;
  const opts = v==='foreign' ? ['일반'] : CB_TAX_ACCTS;
  const cur = sel.value;
  sel.innerHTML = opts.map(a=>`<option value="${a}"${a===cur?' selected':''}>${a}</option>`).join('');
  if (opts.indexOf(cur)<0) sel.value = opts[0];
  _cbTaxDraft.acc = sel.value;
}
function cbTaxAdd(){
  if (typeof isMobileLayout==='function' && isMobileLayout()) return;
  const m = document.getElementById('cb-tax-m')?.value || '1';
  const k = document.getElementById('cb-tax-k')?.value || 'domestic';
  let acc = document.getElementById('cb-tax-acc')?.value || '일반';
  if (k==='foreign') acc = '일반'; // 해외주식은 일반 계좌만
  const raw = (document.getElementById('cb-tax-pl')?.value || '').replace(/,/g,'').trim();
  const memo = (document.getElementById('cb-tax-memo')?.value || '').trim();
  let owner = document.getElementById('cb-tax-owner')?.value || '';
  if (OWNERS.indexOf(owner)<0) owner = (_cbTaxOwner!=='전체' ? _cbTaxOwner : OWNERS[0]);
  const pl = parseFloat(raw);
  if (raw==='' || isNaN(pl)) { alert('실현손익 금액을 입력하세요.'); return; }
  try{ loadMonthlyPL(); }catch(e){}
  const year = (_cbTaxYear && /^\d{4}$/.test(_cbTaxYear)) ? _cbTaxYear : String(new Date().getFullYear());
  const entry = { id:_cbTaxEditId!=null?_cbTaxEditId:Date.now(), month:`${year}-${String(m).padStart(2,'0')}`, amt:pl, memo, owner, category:k, account:acc };
  if (_cbTaxEditId!=null){
    const idx=monthlyPLData.findIndex(r=>Number(r.id)===Number(_cbTaxEditId));
    if(idx>=0) monthlyPLData[idx]=entry;
    else monthlyPLData.push(entry);
  } else {
    monthlyPLData.push(entry);
  }
  _cbTaxEditId = null;
  _cbTaxDraft = { m, k, acc, owner, pl:'', memo:'' };
  saveMonthlyPL();
  cbRenderTax();
}
function cbTaxEdit(id){
  if (typeof isMobileLayout==='function' && isMobileLayout()) return;
  try{ loadMonthlyPL(); }catch(e){}
  const r=monthlyPLData.find(x=>Number(x.id)===Number(id)); if(!r) return;
  _cbTaxEditId=Number(r.id);
  _cbTaxYear=String(r.month||'').slice(0,4)||_cbTaxYear;
  _cbTaxDraft={
    m:String(parseInt(String(r.month||'').split('-')[1]||'1')),
    k:r.category==='domestic'?'domestic':'foreign',
    acc:cbTaxAcctOf(r),
    owner:r.owner||'',
    pl:String(r.amt==null?'':r.amt),
    memo:r.memo||''
  };
  cbRenderTax();
  requestAnimationFrame(()=>document.getElementById('cb-tax-pl')?.focus());
}
function cbTaxCancelEdit(){
  _cbTaxEditId=null;
  _cbTaxDraft={ m:String(new Date().getMonth()+1), k:'domestic', acc:'일반', owner:'', pl:'', memo:'' };
  cbRenderTax();
}
function cbTaxDel(id){
  if (typeof isMobileLayout==='function' && isMobileLayout()) return;
  if(!confirm('삭제하시겠습니까?')) return;
  try{ loadMonthlyPL(); }catch(e){}
  monthlyPLData = monthlyPLData.filter(r=>Number(r.id)!==Number(id));
  if(Number(_cbTaxEditId)===Number(id)) _cbTaxEditId=null;
  saveMonthlyPL();
  cbRenderTax();
}

// ───────────────────────── 페이지: DCA 자동매수 ─────────────────────────
// 조회 전용 페이지 — 규칙 등록/수정은 "자산 내역"(script.js 자산 추가·수정 모달)에서만 한다.
function cbDcaPerMonthKRW(i){
  const amtKrw = (i.dcaMode==='qty')
    ? (i.dcaQty||0)*(i.curP||0)*cbRate(i.cur)
    : (i.dcaAmt||0)*cbRate(i.dcaCur||'KRW');
  if (i.dcaCycle==='매주'){
    const weeklyDays=Array.isArray(i.dcaDays)&&i.dcaDays.length ? i.dcaDays.length : 1;
    return amtKrw*4.33*weeklyDays;
  }
  if (i.dcaCycle==='매일') return amtKrw*(i.grp==='가상화폐'?30.44:21.7);
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
function cbDcaPerOrderKRW(i){
  if (!i) return 0;
  if (i.dcaMode==='qty') return (i.dcaQty||0)*(i.curP||0)*cbRate(i.cur);
  return (i.dcaAmt||0)*cbRate(i.dcaCur||'KRW');
}
function cbDcaExpectedQty(i){
  if (!i) return 0;
  if (i.dcaMode==='qty') return Number(i.dcaQty)||0;
  const priceKRW=(i.curP||0)*cbRate(i.cur);
  return priceKRW>0 ? cbDcaPerOrderKRW(i)/priceKRW : 0;
}
function cbDcaDateAt(value){
  const raw=value instanceof Date ? new Date(value) : (value ? new Date(String(value).length===10?String(value)+'T12:00:00':value) : new Date());
  if (isNaN(raw.getTime())) return new Date();
  raw.setHours(12,0,0,0);
  return raw;
}
function cbDcaDateKey(value){
  const d=value instanceof Date?value:cbDcaDateAt(value);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function cbDcaMarket(i){
  if (typeof _getDcaMarket==='function') return _getDcaMarket(i);
  if (i.grp==='가상화폐') return 'CRYPTO';
  return i.cur==='USD'?'US':i.cur==='JPY'?'JP':'KR';
}
function cbDcaIsHoliday(i,date){
  const market=cbDcaMarket(i);
  if (typeof _isDcaHoliday==='function') return _isDcaHoliday(date,market);
  return market!=='CRYPTO' && (date.getDay()===0||date.getDay()===6);
}
function cbDcaScheduledOn(i,date){
  if (!i || !i.dca) return false;
  const cycle=i.dcaCycle||'매월';
  if (cycle==='매일') return !cbDcaIsHoliday(i,date);
  if (cycle==='매주'){
    const days=Array.isArray(i.dcaDays)&&i.dcaDays.length ? i.dcaDays : [i.dcaDay!=null?Number(i.dcaDay):1];
    return days.includes(date.getDay()) && !cbDcaIsHoliday(i,date);
  }
  const day=Math.max(1,Math.min(31,Number(i.dcaDay)||1));
  const wanted=cbDcaDateKey(date);
  // 월말 휴장으로 다음 달에 밀린 주문까지 찾기 위해 현재 달과 직전 달을 함께 검사한다.
  for (const monthOffset of [0,-1]){
    const base=new Date(date.getFullYear(),date.getMonth()+monthOffset,day,12,0,0,0);
    if (base.getDate()!==day) continue;
    for(let j=0;j<7 && cbDcaIsHoliday(i,base);j++) base.setDate(base.getDate()+1);
    if (cbDcaDateKey(base)===wanted) return true;
  }
  return false;
}
function cbDcaScheduleSummary(i, asOf){
  const today=cbDcaDateAt(asOf);
  const todayKey=cbDcaDateKey(today);
  const monthEnd=new Date(today.getFullYear(),today.getMonth()+1,0,12,0,0,0);
  const horizon=new Date(today); horizon.setDate(horizon.getDate()+370);
  const lastExec=String(i&&i.dcaLastExec||'').slice(0,10);
  let nextDate='', remainingCount=0;
  for(let d=new Date(today);d<=horizon;d.setDate(d.getDate()+1)){
    const key=cbDcaDateKey(d);
    if (key<todayKey || (lastExec && key<=lastExec) || !cbDcaScheduledOn(i,d)) continue;
    if (!nextDate) nextDate=key;
    if (d<=monthEnd) remainingCount++;
    if (nextDate && d>monthEnd) break;
  }
  return {
    nextDate,
    remainingCount,
    remainingAmount:remainingCount*cbDcaPerOrderKRW(i),
    expectedQty:cbDcaExpectedQty(i)
  };
}
function cbDcaNextLabel(dateKey){
  if (!dateKey) return '—';
  const d=cbDcaDateAt(dateKey);
  const D=['일','월','화','수','목','금','토'];
  return `${d.getMonth()+1}.${String(d.getDate()).padStart(2,'0')} (${D[d.getDay()]})`;
}
function cbDcaRuleLabel(i){
  const cycle=i.dcaCycle||'매월';
  if (cycle==='매일') return '매영업일';
  return cycle+' '+cbDcaDayLabel(i);
}
function cbRenderDca(){
  const el = document.getElementById('cb-dca2'); if(!el) return;
  const ownerF = (_cbDcaOwner && _cbDcaOwner!=='전체') ? _cbDcaOwner : null;
  const items = (pfolioData||[]).map((i,idx)=>({i,idx}))
    .filter(x=>(x.i.dcaAmt>0)||(x.i.dcaMode==='qty'&&x.i.dcaQty>0))
    .filter(x=>!ownerF || x.i.owner===ownerF);
  // 내역 정렬: 소유주 → 계좌 → 국기(상장국) → 종목명 오름차순
  items.forEach(x=>{ x.r = cbRow(x.i, x.idx); });
  const oi = o => { const k = OWNERS.indexOf(o); return k<0 ? 99 : k; };
  items.sort((a,b)=>
    (oi(a.i.owner) - oi(b.i.owner))
    || String(a.i.broker||'').localeCompare(String(b.i.broker||''), 'ko')
    || cbCtryLabel(a.r).localeCompare(cbCtryLabel(b.r), 'ko')
    || String(a.r.title||'').localeCompare(String(b.r.title||''), 'ko'));
  const active = items.filter(x=>x.i.dca);
  const monthly = active.reduce((s,x)=>s+cbDcaPerMonthKRW(x.i),0);
  const daily = monthly / 21.7; // 월평균 영업일 기준 일평균
  items.forEach(x=>{ x.schedule=cbDcaScheduleSummary(x.i); });
  const remainingCount=active.reduce((s,x)=>s+x.schedule.remainingCount,0);
  const remainingAmount=active.reduce((s,x)=>s+x.schedule.remainingAmount,0);
  const dcaAllocMap = new Map();
  active.forEach(x=>{
    const ticker=cbStrip(x.i.tkr);
    const key=(x.i.owner||'—')+'::'+(ticker||x.r.title);
    const prev=dcaAllocMap.get(key)||{
      owner:x.i.owner||'—',ticker,title:x.r.title||ticker||'—',amount:0
    };
    prev.amount+=cbDcaPerMonthKRW(x.i);
    dcaAllocMap.set(key,prev);
  });
  const dcaTopAlloc=Array.from(dcaAllocMap.values()).sort((a,b)=>b.amount-a.amount).slice(0,5);
  // 규칙 등록·수정은 "자산 내역" 페이지에서만 한다 (이 페이지는 현황 조회 + 활성 토글 전용)
  cbSetHead('<span data-tip="Dollar Cost Averaging — 시점을 나눠 일정 금액을 기계적으로 매수해 평균 단가를 관리하는 적립식 투자법">DCA</span> 규칙에 따라 기계적으로 매수합니다 · 규칙 등록은 "자산 내역"에서',
    cbOwnerBtns(_cbDcaOwner,'cbDcaOwner'));
  el.innerHTML = `
    <div class="cb-dca-summary-grid">
      <div class="cb-panel cb-dca-summary-card"><div class="cb-dca-summary-label">활성 규칙</div><div class="cb-dca-summary-value">${active.length}<span> / ${items.length}</span></div></div>
      <div class="cb-panel cb-dca-summary-card"><div class="cb-dca-summary-label"><span data-tip="활성 규칙의 월 자동매수 합계를 월평균 영업일(21.7일)로 나눈 하루 평균 매수 금액">일평균 자동매수 합계</span></div><div class="cb-dca-summary-value">${cbDisp(daily)}</div></div>
      <div class="cb-panel cb-dca-summary-card"><div class="cb-dca-summary-label">월 자동매수 합계 (활성 기준)</div><div class="cb-dca-summary-value">${cbDisp(monthly)}</div></div>
      <div class="cb-panel cb-dca-summary-card"><div class="cb-dca-summary-label">연간 적립 예상</div><div class="cb-dca-summary-value">${cbDisp(monthly*12)}</div></div>
      <div class="cb-panel cb-dca-summary-card cb-dca-remaining-card">
        <div class="cb-dca-summary-label"><span data-tip="오늘 이후 이번 달에 남아 있는 활성 DCA 체결일을 시장 휴장일 기준으로 계산합니다.">이번 달 남은 매수</span></div>
        <div class="cb-dca-summary-value">${remainingCount}<span>회</span></div>
        <div class="cb-dca-summary-sub">${remainingCount?cbDisp(remainingAmount)+' 예정':'이번 달 일정 완료'}</div>
      </div>
    </div>
    <div class="cb-dca-detail-grid">
    <div class="cb-panel cb-table-panel" style="padding:14px 16px">
      <div class="cb-thead cb-dca-head" style="display:flex;font-size:10.5px;color:var(--dim);padding:7px 8px;border-bottom:1px solid var(--bd);min-width:858px">
        <span style="width:62px">소유주</span><span style="flex:1;box-sizing:border-box;padding-left:35px">종목</span><span class="cb-mobile-secondary" style="width:92px;text-align:right">회당 금액</span><span style="width:92px;text-align:right">주기</span><span style="width:88px;text-align:right">다음 매수</span><span class="cb-mobile-secondary" style="width:82px;text-align:right"><span data-tip="현재가 기준으로 이번 한 회차에 매수될 것으로 예상되는 수량">예상 수량</span></span><span class="cb-mobile-secondary" style="width:110px;text-align:right">계좌</span><span style="width:100px;text-align:right">월 환산</span><span style="width:58px;text-align:center">활성</span>
      </div>
      ${items.map(x=>{
        const r=x.r;
        const amtLabel = x.i.dcaMode==='qty'
          ? (x.i.dcaQty||0).toLocaleString(undefined,{maximumFractionDigits:4})+'주'
          : cbFmtNative(x.i.dcaAmt||0, x.i.dcaCur||'KRW');
        return `
        <div class="cb-dca-row" style="display:flex;align-items:center;padding:9px 8px;border-bottom:1px solid var(--bd);font-size:12.5px;min-width:858px;${x.i.dca?'':'opacity:.45'}">
          <span style="width:62px;display:flex;align-items:center;gap:5px;flex-shrink:0;font-size:11.5px;font-weight:600;color:var(--mut)"><span style="width:7px;height:7px;border-radius:50%;background:${cbOwnerColor(x.i.owner)};flex-shrink:0"></span>${cbEsc(x.i.owner)}</span>
          <div style="flex:1;display:flex;align-items:center;gap:8px;min-width:0">
            ${cbFlagCell(r, 27, 15)}
            <span class="cb-asset-inline cb-tip-block" data-overflow-tip="${cbEsc([r.title,r.subTitle].filter(Boolean).join(' · '))}">
              <span class="cb-asset-name" data-overflow-watch>${cbEsc(r.title)}</span>
              ${r.subTitle?`<span class="cb-asset-ticker" data-overflow-watch>${cbEsc(r.subTitle)}</span>`:''}
            </span>
          </div>
          <span class="cb-mobile-secondary" style="width:92px;text-align:right;font-weight:700">${amtLabel}</span>
          <span style="width:92px;text-align:right;color:var(--mut);font-size:11.5px">${cbEsc(cbDcaRuleLabel(x.i))}</span>
          <span style="width:88px;text-align:right;color:${x.i.dca?'var(--acc)':'var(--dim)'};font-weight:700;white-space:nowrap" aria-label="${x.i.dca&&x.schedule.nextDate?'다음 매수일 '+cbEsc(x.schedule.nextDate):'다음 매수일 없음'}">${x.i.dca?cbDcaNextLabel(x.schedule.nextDate):'—'}</span>
          <span class="cb-mobile-secondary" style="width:82px;text-align:right;color:var(--mut);font-size:11.5px">${x.schedule.expectedQty>0?x.schedule.expectedQty.toLocaleString(undefined,{maximumFractionDigits:x.i.grp==='가상화폐'?6:4})+(x.i.grp==='가상화폐'?'개':'주'):'—'}</span>
          <span class="cb-mobile-secondary" style="width:110px;text-align:right;color:var(--mut);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(x.i.broker||'—')}</span>
          <span style="width:100px;text-align:right;font-weight:600">${cbDisp(cbDcaPerMonthKRW(x.i))}/월</span>
          <span style="width:58px;display:flex;justify-content:center">
            <span onclick="cbDcaToggle(${x.idx})" style="width:34px;height:19px;border-radius:10px;cursor:pointer;position:relative;transition:background .15s;background:${x.i.dca?'var(--up)':'var(--bd2)'}"><span style="position:absolute;top:2px;width:15px;height:15px;border-radius:50%;background:#fff;transition:left .15s;left:${x.i.dca?'17px':'2px'}"></span></span>
          </span>
        </div>`;}).join('') || '<div style="padding:16px;text-align:center;color:var(--dim);font-size:12px">등록된 DCA 규칙이 없습니다. "자산 내역"에서 종목을 수정해 DCA를 설정하세요.</div>'}
    </div>
    <div class="cb-panel cb-dca-allocation-card">
      <div class="cb-insight-title">월 환산 매수 배분 TOP 5</div>
      <div class="cb-dca-allocation-total"><span>활성 규칙 월 합계</span><b>${cbDisp(monthly)}</b></div>
      <div class="cb-dca-allocation-list">
        ${dcaTopAlloc.map((x,rank)=>{
          const share=monthly>0?x.amount/monthly*100:0;
          const label=[x.ticker,x.title].filter(Boolean).join(' · ');
          return `<div class="cb-dca-allocation-row">
            <div class="cb-dca-allocation-head">
              <span class="cb-dca-allocation-rank">${rank+1}</span>
              <span class="cb-dca-allocation-name cb-tip-block" data-overflow-tip="${cbEsc(label)}" data-overflow-watch>${cbEsc(label)}</span>
              <b>${share.toFixed(1)}%</b>
            </div>
            <div class="cb-dca-allocation-meta"><span>${ownerF?'':cbEsc(x.owner)+' · '}${cbDisp(x.amount)}/월</span></div>
            <div class="cb-dca-allocation-track"><i style="width:${share.toFixed(2)}%;background:${cbOwnerColor(x.owner)}"></i></div>
          </div>`;
        }).join('') || '<div class="cb-insight-empty">활성화된 DCA 규칙이 없습니다.</div>'}
      </div>
    </div>
    </div>`;
}
function cbDcaOwner(o){ _cbDcaOwner=o; cbRenderDca(); }
function cbDcaToggle(idx){
  const item=pfolioData[idx]; if(!item) return;
  item.dca=!item.dca;
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
  ['cb-perf-tip','cb-div-bar-tip','table-float-tip'].forEach(tipId=>{
    const tip=document.getElementById(tipId);
    if(tip){ tip.style.display='none'; tip._anchor=null; }
  });
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
  if (id==='divm') cbVerifyDividendDataOnOpen();
  if (id==='perf2') cbVerifyPerfOwnersOnOpen();
  try{ CB_VIEWS[id](); }catch(e){ console.error('[cobalt render]', e); }
  if(typeof _recordViewHistory==='function') _recordViewHistory(id);
};

// 데이터 변경/갱신 시 활성 페이지 재렌더
const _cbOrigChangeOwner = changeOwner;
changeOwner = function(owner, btn, isRefresh){
  _cbOrigChangeOwner(owner, btn, isRefresh);
  cbRerender();
};
// 자산 내역에서 추가/수정/삭제 → KV 저장이 일어나면 활성 페이지(대시보드 등)에 즉시 반영
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
// 테마 전환 시 활성 페이지 재렌더 — 인라인으로 해석된 테마 색(hex)을 새 테마 기준으로 다시 계산
const _cbOrigSetTheme = setTheme;
setTheme = function(mode){
  _cbOrigSetTheme(mode);
  cbRerender();
};

// 리스크 페이지에 들어갈 때까지 기다리지 않고 앱을 열자마자 최신 ETF 스냅샷을 확인한다.
cbEnsureEtfHoldings();
