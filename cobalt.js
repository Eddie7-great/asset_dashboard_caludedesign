// =====================================================================
// cobalt.js — 메인 페이지 렌더러
// script.js(데이터 엔진)를 그대로 사용하고, 시안 레이아웃으로 렌더링한다.
// 페이지: 대시보드 / 한눈에 보기 / 성과 비교 / 가족 자산 / 리스크 진단 / 배당 관리
//        / 가족 증여 / 양도소득세 / DCA 자동매수
// =====================================================================

/* global pfolioData, RATES, OWNERS, ownerColors, monthlyPLData, benchData,
   _gicsSector, loadMonthlyPL,
   saveMonthlyPL, saveAssetsToKV, loadAssetsFromKV, saveExtDataToKV, cssVar,
   openAddModal, editItem, closeSidebar, fetchDivData, fetchDividendHistory,
   switchView, changeOwner, setTheme, isMobileLayout, authFetch */

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
let _cbDivBasis = 'gross';     // 배당 표시 기준: 'gross'(세전) | 'net'(세후, 계좌별 원천징수 반영)
let _cbRiskOwner = '전체';     // 리스크 진단 소유주 필터
let _cbDcaOwner = '전체';      // DCA 자동매수 소유주 필터
let _cbPerfTf = '1Y';         // 성과 비교 선택 기간 (5D/1M/3M/6M/YTD/1Y)
let _cbPerfSel = null;        // 성과 비교 강조 대상 (소유주/벤치마크 키, null=전체 표시)
const CB_PERF_TFS = ['5D','1M','3M','6M','YTD','1Y'];
const CB_PERF_TF_LABEL = { '5D':'최근 5일','1M':'최근 1개월','3M':'최근 3개월','6M':'최근 6개월','YTD':'연초 이후','1Y':'최근 1년' };

// ───────────────────────── 상수 (시안 팔레트) ─────────────────────────
// 자산군 색(2026-11-23 개편) — 다섯 색이 라이트·다크 모두에서 서로 구별되도록 색 차이 검증 도구로 맞춘 한 벌이다.
// 예전 금(#d4b24a)↔가상화폐(#f2a33c), 한국 주식(#4ecdc4)↔현금(#56c596)은 색이 정상인 사람도 헷갈리는 수준이었다.
// 소유주 색(ownerColors, core/data.js)과 함께 바꿀 때는 docs/invariants.md 의 색 절을 같이 고친다.
const CB_CLS = {
  crypto:{label:'가상화폐', color:'#ea5a2a'},
  us:    {label:'미국 주식', color:'#2a78d6'},
  kr:    {label:'한국 주식', color:'#1baf7a'},
  jp:    {label:'일본 주식', color:'#b844a6'},
  gold:  {label:'금',       color:'#d6a300'},
  // 현금은 투자가 아닌 대기 자금이라 무채색이다. 예전 초록(#56c596)은 한국 주식 청록과 거의 같은 색이었다.
  cash:  {label:'현금',     color:'#98a2b3'},
};
const CB_VOL = { crypto:0.65, us:0.22, kr:0.26, jp:0.20, gold:0.15, cash:0 };
const CB_SEC_PALETTE = ['#5b9bff','#c084fc','#f2a33c','#4ecdc4','#fb7185','#8bd3ac','#94a3c8','#e8875a','#d4b24a','#56c596','#b48ead','#7aa2ff'];

const CB_VIEWS  = { etf2:cbRenderEtfExplorer, cdash:cbRenderDash, perf2:cbRenderPerf, fam2:cbRenderFam, risk2:cbRenderRisk, divm:cbRenderDiv, plan2:cbRenderPlan, rebal2:cbRenderPlan, sim2:cbRenderSimulator, gift2:cbRenderGift, tax2:cbRenderTax, dca2:cbRenderDca, data2:cbRenderDataStatus, acct2:cbRenderAccounts, cal2:cbRenderCalendar, report2:cbRenderReport, reporty:cbRenderReportYear, chart2:cbRenderChart, trend2:cbRenderTrend, value2:cbRenderValue, macro2:cbRenderMacro, screen2:cbRenderScreen };
const CB_TITLES = { etf2:'ETF 탐색', cdash:'대시보드', perf2:'성과 비교', fam2:'구성원별 보유', risk2:'리스크 진단', divm:'배당 관리', plan2:'목표·리밸런싱', gift2:'가족 증여', tax2:'양도소득세', dca2:'적립식 매수 계획', data2:'데이터 상태', acct2:'계좌별 보기', cal2:'일정', report2:'월간 결산', reporty:'연간 결산', chart2:'차트 공부', trend2:'추세추종', value2:'가치투자', macro2:'매크로', screen2:'종목 찾기' };
// cobalt.js 가 렌더하지 않는 기존 화면의 소제목 — 헤더가 페이지마다 비었다 채웠다 하지 않도록 함께 관리한다.
const CB_LEGACY_SUB = {
  holdings: '보유 자산을 추가·수정하고 계좌별 기록을 관리합니다 · 적립식 매수 등록·수정은 보유 종목에서 진행합니다',
  cashflow: '월별 수입·지출 기록과 고정비 관리 · 고정비로 분류한 항목이 투자 계획 > 목표의 현금 안전판 기준이 됩니다',
  bubble:   '주식·ETF·가상화폐·금·현금 비중 비교 · ETF는 펀드 단위이며 칸을 클릭하면 하위 종목으로 들어갑니다',
};

// ───────────────────────── 헬퍼 ─────────────────────────
function cbStrip(t){ return String(t||'').toUpperCase().replace(/\.(KS|KQ|T)$/,'').replace(/^BRK[\/.-]?B$/,'BRK.B'); }
function cbCls(i){
  if (i.grp === '가상화폐') return 'crypto';
  if (i.grp === '금') return 'gold';
  if (i.grp === '현금') return 'cash';
  if (i.cur === 'JPY') return 'jp';
  if (i.cur === 'USD') return 'us';
  return 'kr';
}
// 환율·평가액·매입금액의 단일 출처는 core/data.js(curRate·assetValueKRW·assetCostKRW·assetGainKRW·assetAvgNative)다.
// 여기 cb* 는 이름만 남긴 별칭 — 식을 다시 적지 않는다(2026-11-25 숫자 일관성 점검).
function cbRate(cur){ return curRate(cur); }
function cbAvgNative(i){ return assetAvgNative(i); }
function cbValKRW(i){ return assetValueKRW(i); }
function cbCostKRW(i){ return assetCostKRW(i); }
function cbGainKRW(i){ return assetGainKRW(i); }

function cbDisp(vKrw){
  const c = _dispCur, v = vKrw / cbRate(c);
  return (v<0?'-':'') + curSymbol(c) + Math.abs(Math.round(v)).toLocaleString(c==='USD'?'en-US':'ko-KR');
}
function cbSignDisp(vKrw){ return (Math.round(vKrw)>0?'+':'') + cbDisp(vKrw); }
function cbKrw(n){ return (n<0?'-':'') + '₩' + Math.abs(Math.round(n)).toLocaleString('ko-KR'); }
function cbPct(r){ return (r>=0?'+':'') + (r*100).toFixed(Math.abs(r)<0.1?2:1) + '%'; }
// 통화 기호·소수 자릿수는 script.js 의 CURRENCY_META 하나만 따른다.
// 예전에는 여기서도 USD/JPY 를 따로 분기해, 통화를 늘릴 때마다 한쪽만 고쳐지곤 했다.
function cbFmtNative(n, cur){
  const meta = curMeta(cur);
  const loc = cur==='JPY' ? 'ja-JP' : cur==='KRW' ? 'ko-KR' : 'en-US';
  return meta.symbol + Number(n).toLocaleString(loc,{minimumFractionDigits:0,maximumFractionDigits:meta.cashDecimals});
}
function cbEsc(s){ return escHtml(s); }   // 단일 구현은 script.js 의 escHtml
// 0 은 이익도 손실도 아니라 회색이다(2026-11-23) — 예전엔 0 도 초록이라 세금 요약에 '+₩0' 이 초록으로 칠해졌다.
function cbUpDn(v){ return 'color:' + (v>0 ? 'var(--up)' : v<0 ? 'var(--dn)' : 'var(--lab)'); }
// 내역 표 한 벌(2026-11-17) — 소유주는 어느 표에서나 '색 점 + 이름', 손익은 이익·손실만 색이고
// 0·취득가 미상·현금은 회색이다. 화면마다 점을 인라인으로 복사하거나 0 을 초록으로 칠하지 않는다.
function cbOwnerTag(owner, fallback){
  const name = owner || fallback || '미지정';
  return `<span class="cb-owner-tag${owner?'':' is-none'}"><i style="background:${owner?cbOwnerColor(owner):'var(--dim)'}"></i>${cbEsc(name)}</span>`;
}
function cbGainStyle(v, unknown){
  const n = Number(v);
  if (unknown || !Number.isFinite(n) || n === 0) return 'color:var(--lab)';
  return 'color:' + (n > 0 ? 'var(--up)' : 'var(--dn)');
}
function cbOwnerColor(o){ return (typeof ownerColors!=='undefined' && ownerColors[o]) || '#8a97b0'; }

// 배당 정보 (script.js의 _divDataCache 사용)
function cbDivOf(i){
  const c = (window._divDataCache || {})[cbStrip(i.tkr)];
  if (!c || !(Number(c.annualDps) > 0)) return null;
  return c; // {eps, annualDps, yldNum, yld, cycle, months(0-index), cur, exDiv}
}
function cbDividendStatus(i){
  if(i.grp!=='주식') return {state:'none',text:'배당 대상이 아닌 자산입니다.'};
  const cov=cbSnapDivCoverage([{i}]);
  const known=cov.covered===cov.total && cov.total>0;
  if(known) return cbDivOf(i)?{state:'ready',text:''}:{state:'none',text:'조회된 최근 지급 이력에 배당이 없습니다.'};
  if(cov.status==='pending') return {state:'pending',text:'배당 데이터 확인 중'};
  return {state:'error',text:'배당 조회 실패 · 다시 확인해 주세요.'};
}
function cbDivIncomeKRW(i){
  const d = cbDivOf(i); if (!d) return 0;
  return d.annualDps * (i.qty||0) * cbRate(d.cur || i.cur);
}

// ── 배당 세후 계산 ───────────────────────────────────────
// 세율 규칙은 script.js의 getAccountDivTaxInfo와 tax-rules.js만 쓴다.
// ISA 공제는 소유주·연도 단위라서 종목별로 나눠 계산할 수 없다 —
// 소유주별 ISA 배당 총액에서 공제를 먼저 뺀 뒤 세금을 종목에 배당수입 비례로 나눈다.
const CB_FIN_INCOME_THRESHOLD = _taxRuleValue('dividend.comprehensiveIncomeThresholdKrw',20_000_000);
function cbDivTaxInfo(acc){
  return (typeof getAccountDivTaxInfo==='function')
    ? getAccountDivTaxInfo(acc)
    : { type:'일반', normalRate:_taxRuleValue('dividend.generalWithholdingCombinedRate',0.154), exempt:0, label:'일반계좌' };
}
// entries: [{owner, acc, gross, ref}] → script.js의 단일 세금 엔진을 사용한다.
function cbDivTaxAllocate(entries){
  if(typeof allocateDividendTax!=='function') throw new Error('배당세 계산 엔진을 불러오지 못했습니다.');
  return allocateDividendTax(entries,CB_FIN_INCOME_THRESHOLD);
}
// 배당성장률(2026-11-24 재점검) — 원본 지급 이력 하나로 고른다.
//  ① 완결 연도 연평균(5년 → 3년 → 확보된 전 구간). 상장 첫해처럼 지급 횟수가 뒤 해들의 중앙값보다 적은
//     '반쪽 해'는 시작점에서 뺀다 — 넣으면 10월 상장 월배당 ETF 가 2회분 → 12회분을 '+500%' 로 읽었다.
//  ② 완결 연도가 모자라면 최근 12개월 vs 직전 12개월 — 직전 12개월이 지급 간격 안에서 꽉 차 있을 때만.
//  둘 다 안 되면 산출하지 않는다(상장 2년 미만·지급 0건). 숫자를 지어내지 않는다.
function cbDivGrowthFromEvents(events, today){
  const ev=(Array.isArray(events)?events:[])
    .filter(e=>e&&/^\d{4}-\d{2}-\d{2}/.test(String(e.date||''))&&Number(e.amount)>0)
    .map(e=>({date:String(e.date).slice(0,10),amount:Number(e.amount)}))
    .sort((a,b)=>a.date.localeCompare(b.date));
  if(!ev.length) return {value:null,status:'none',basis:null,years:0,events:0};
  const now=today instanceof Date?today:new Date(), curY=now.getFullYear();
  const key=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const sum={}, cnt={};
  ev.forEach(e=>{const y=+e.date.slice(0,4); sum[y]=(sum[y]||0)+e.amount; cnt[y]=(cnt[y]||0)+1;});
  let yrs=Object.keys(sum).map(Number).filter(y=>y<curY).sort((a,b)=>a-b);
  if(yrs.length>=2){
    const later=yrs.slice(1).map(y=>cnt[y]).sort((a,b)=>a-b), med=later[Math.floor(later.length/2)];
    if(cnt[yrs[0]]<med) yrs=yrs.slice(1);
  }
  const base={years:yrs.length,events:ev.length,first:ev[0].date};
  if(yrs.length>=2){
    const lastY=yrs[yrs.length-1];
    const cagr=y0=>sum[y0]>0&&lastY>y0?(Math.pow(sum[lastY]/sum[y0],1/(lastY-y0))-1)*100:null;
    for(const k of [5,3]){
      if(!yrs.includes(lastY-k)) continue;
      const v=cagr(lastY-k); if(v!=null) return {...base,value:v,status:'ready',basis:'cagr',from:lastY-k,to:lastY};
    }
    const v=cagr(yrs[0]); if(v!=null) return {...base,value:v,status:'ready',basis:'cagr',from:yrs[0],to:lastY};
  }
  if(ev.length>=2){
    const gaps=[]; for(let k=1;k<ev.length;k++) gaps.push((Date.parse(ev[k].date)-Date.parse(ev[k-1].date))/86400000);
    gaps.sort((a,b)=>a-b);
    const gap=gaps[Math.floor(gaps.length/2)];
    const back=m=>{const d=new Date(now.getFullYear(),now.getMonth()-m,now.getDate()); return key(d);};
    const t12=back(12), t24=back(24), t0=key(now);
    const covered=(Date.parse(ev[0].date)-Date.parse(t24))/86400000 < gap;
    const recent=ev.filter(e=>e.date>=t12&&e.date<=t0).reduce((a,e)=>a+e.amount,0);
    const prior=ev.filter(e=>e.date>=t24&&e.date<t12).reduce((a,e)=>a+e.amount,0);
    if(covered&&recent>0&&prior>0) return {...base,value:(recent/prior-1)*100,status:'ready',basis:'ttm'};
  }
  return {...base,value:null,status:'insufficient',basis:null};
}
function cbDivGrowthInfo(i){
  try{
    const raw = (window._divHistoryRawCache || {})[cbStrip(i.tkr)];
    if (!raw || !Array.isArray(raw.events)) return { value:null, status:'missing', years:0, events:0 };
    return cbDivGrowthFromEvents(raw.events);
  }catch(e){ return { value:null, status:'missing', years:0, events:0 }; }
}
// 성장률 칸의 말풍선 — 무엇과 무엇을 비교했는지, 못 냈으면 왜인지
function cbDivGrowthTip(g){
  if(!g) return '';
  if(g.status==='ready') return g.basis==='ttm'
    ? '최근 12개월 지급액 vs 직전 12개월 지급액 (완결 연도가 2개 미만이라 12개월 단위로 비교)'
    : `${g.from}년 → ${g.to}년 연간 주당 배당금의 연평균 성장률(CAGR)`;
  if(g.status==='none') return '배당 지급 기록이 없습니다(분배금을 재투자하는 상품이거나 아직 지급 전).';
  if(g.status==='insufficient') return `지급 기록 ${g.events}건(${g.first}부터) — 1년 전과 비교할 자료가 아직 없습니다(상장 2년 미만).`;
  return '배당 원본 이력을 아직 받지 못했습니다.';
}
function cbDivGrowth(i){
  return cbDivGrowthInfo(i).value;
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
    : (Number(i.qty||0).toLocaleString(undefined,{maximumFractionDigits:4}) + (i.grp==='가상화폐'?'개':i.unit||'주'));
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
  // 현금 배지는 보유 통화의 기호를 쓴다 — 예전에는 통화와 무관하게 항상 ₩ 이었다.
  const icon = { crypto:{c:CB_CLS.crypto.color,t:'₿'},
    cash:{c:CB_CLS.cash.color, t:(typeof curSymbol==='function'?curSymbol(r.i&&r.i.cur):'₩')} }[r.cls]
    || { c:(r.cl&&r.cl.color)||'#8a97b0', t:'•' };
  const w = Math.round(h*1.5);
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${w}px;height:${h}px;border-radius:3px;font-size:${Math.round(h*0.66)}px;font-weight:800;background:${icon.c}22;color:${icon.c};vertical-align:-2px">${icon.t}</span>`;
}
// 국기 슬롯(고정폭, 세로 중앙) — 표 행 좌측 아이콘 칸
function cbFlagCell(r, slot, h){
  return `<span style="width:${slot||30}px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">${cbFlagSvg(r, h||16)}</span>`;
}
// 표의 '계좌' 칸 — 윗줄 증권사, 아랫줄 세제 유형 색 네모 + 계좌명. 보유 목록과 같은 구현(getHoldingsBrokerCellHtml)을 쓴다.
function cbAccountCell(i){ return getHoldingsBrokerCellHtml(i||{}); }
function cbAccountLabel(i){
  const broker = String((i&&i.broker)||'').trim();
  const account = String((i&&i.acc)||'').trim();
  return [broker,account].filter(Boolean).join(' / ');
}
function cbBrokerLabel(i){ return String((i&&i.broker)||'미지정').trim() || '미지정'; }

// 동일 소유주 + 동일 종목(다계좌)을 한 행으로 합산 (대시보드 내역·상세 공통)
// 가중 평단가는 KRW 총원가 ÷ (합산수량 × 환율)로 역산해 종목 통화 기준으로 되돌린다.
function cbMergeRows(rows){
  const m = new Map();
  rows.forEach(r=>{
    // 티커가 없는 현금은 통화별, 금은 단위별로 나눈다 — 예전엔 소유주마다 한 줄이 되어 '원화 150만 + 달러 1,234'가
    // 수량 1,501,234 로, '3돈 + 17.5g' 이 20.5돈으로 보였다(금액 합은 맞았다). 주식·코인은 같은 티커면 그대로 합친다.
    const unitKey = r.cls==='cash' ? '::' + String(r.i.cur||'KRW') : r.cls==='gold' ? '::' + String(r.i.unit||'g') : '';
    const key = (r.i.owner||'') + '::' + cbStrip(r.i.tkr) + '::' + r.cls + unitKey;
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

// 시세를 못 받은 행 판정. 병합된 행은 원본 계좌 중 하나라도 미조회면 미조회다.
// 시세가 없으면 script.js 의 정규화가 현재가를 매입가로 메우므로 평가손익이 정확히
// 0 이 된다 — 그 상태를 '변동 없음'으로 순위에 흘려보내면 종목이 조용히 사라진다.
function cbRowPriceStale(r){
  return (r&&Array.isArray(r._items)?r._items:[r&&r.i]).some(i=>i&&i._priceStale===true);
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
  if (s) {s.innerHTML = sub || '';s.title=s.textContent||'';}
  const w = document.getElementById('cb-head-widgets');
  if (w){ w.innerHTML = widgets || ''; w.style.display = widgets ? 'flex' : 'none'; }
  // 모바일은 헤더 폭이 없어 소제목을 접어 두므로 'ⓘ' 토글이 유일한 통로다.
  // 설명이 없는 화면에서는 버튼도 숨기고, 화면을 옮기면 이전 설명이 열린 채 남지 않게 접는다.
  const t = document.getElementById('page-sub-toggle');
  if (t) t.style.display = sub ? '' : 'none';
  cbHeadSubOpen(false);
}
function cbHeadSubOpen(open){
  if (typeof document==='undefined' || !document.body) return;
  document.body.classList.toggle('head-sub-open', !!open);
  const t = document.getElementById('page-sub-toggle');
  if (t) t.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function toggleHeadSub(){
  const open = !!(typeof document!=='undefined' && document.body && document.body.classList.contains('head-sub-open'));
  cbHeadSubOpen(!open);
}
// 필터 버튼을 누르면 페이지가 innerHTML 로 통째로 다시 그려져 눌렀던 버튼이 사라진다.
// 키보드·스크린리더 사용자는 그때마다 포커스가 문서 맨 앞으로 튀므로, 다시 그린 뒤
// 같은 표식(attr=value)을 가진 버튼을 찾아 포커스를 되돌려준다.
// rootId 는 그 버튼이 다시 그려지는 컨테이너다 (헤더 위젯이면 'cb-head-widgets').
function cbRestoreFilterFocus(rootId, attr, value){
  const run=()=>{
    const root=document.getElementById(rootId);
    if(!root || typeof root.querySelectorAll!=='function') return;
    const hit=Array.from(root.querySelectorAll(`[${attr}]`)).find(b=>b.getAttribute(attr)===String(value));
    if(hit && typeof hit.focus==='function') hit.focus();
  };
  if(typeof requestAnimationFrame==='function') requestAnimationFrame(run); else run();
}
// ── 표 정렬(2026-11-18) ── 종목이 나오는 내역 표의 머리글을 누르면 그 칸으로 정렬한다.
// 상태는 표마다 {key,dir} 하나이고 렌더 때 행 배열에 적용한다 — 그래서 시세 갱신·소유주 변경으로 다시 그려도
// 순서가 유지되고, 다른 화면으로 옮길 때만 지운다(cbResetViewState). 첫 클릭은 숫자 내림차순·글자 오름차순,
// 같은 칸을 다시 누르면 반대. 값이 없는 행(취득가 미상·시세 없음 등)은 어느 방향에서도 끝이다.
let _cbTableSort={};
function cbSortCompare(av,bv,dir){
  const none=v=>v==null||v===''||(typeof v==='number'&&!Number.isFinite(v));
  if(none(av)) return none(bv)?0:1;
  if(none(bv)) return -1;
  if(typeof av==='number'&&typeof bv==='number') return (av-bv)*dir;
  return String(av).localeCompare(String(bv),'ko')*dir;
}
// 정렬 상태가 없으면 받은 순서(각 화면의 기본 순서) 그대로. 같은 값끼리는 기본 순서를 지킨다.
function cbSortRows(table,rows,getters){
  const st=_cbTableSort[table], get=st&&getters?getters[st.key]:null;
  if(!get) return rows;
  return rows.map((r,i)=>({r,i,v:get(r)})).sort((a,b)=>cbSortCompare(a.v,b.v,st.dir)||a.i-b.i).map(x=>x.r);
}
function cbSortDir(table,key){ const st=_cbTableSort[table]; return st&&st.key===key?st.dir:0; }
function cbAriaSort(table,key){ const d=cbSortDir(table,key); return d===1?'ascending':d===-1?'descending':'none'; }
// 머리글 버튼. type 'text' 는 첫 클릭 오름차순, 그 밖은 내림차순. 상태는 화살표와 화면 낭독용 글자로 함께 알린다.
// 화살표는 어느 칸이든 칼럼명 오른쪽이다(.cb-sort-ind, 절대 위치라 머리글 폭은 그대로).
function cbSortBtn(table,key,label,type){
  const d=cbSortDir(table,key);
  return `<button type="button" class="cb-sort-btn${d?' is-on':''}" data-sort-btn="${table}:${key}" onclick="cbTableSortClick('${table}','${key}','${type==='text'?'text':'num'}')">${label}<i class="cb-sort-ind" aria-hidden="true">${d===1?'▲':d===-1?'▼':'↕'}</i>${d?`<span class="sr-only">, ${d===1?'오름차순':'내림차순'} 정렬됨</span>`:''}</button>`;
}
function cbTableSortClick(table,key,type){
  const st=_cbTableSort[table];
  if(st&&st.key===key) st.dir=-st.dir; else _cbTableSort[table]={key,dir:type==='text'?1:-1};
  // ETF 구성종목은 표만 다시 그린다(화면 전체를 다시 그리면 구성종목 조회가 다시 돈다). 정렬하면 1쪽으로.
  if(table==='etf'&&typeof etfRefreshResults==='function'){ _etfPage=0; etfRefreshResults(); cbRestoreFilterFocus('etf-results','data-sort-btn',`${table}:${key}`); return; }
  cbRerender();
  cbRestoreFilterFocus('cb-'+_cobaltActive,'data-sort-btn',`${table}:${key}`);
}
// 소유주 필터 버튼 행 (전체 + 소유주 4인). onclick 은 소유주명을 인자로 받는 전역 함수명.
// 여러 문장인 안내문은 마침표 뒤에서 줄을 바꾼다 — 좁은 카드에서 다음 문장이 줄 끝에 한두 글자만 걸리지 않게(2026-11-18 3차).
function cbSentenceHtml(text){
  return String(text==null?'':text).split(/(?<=[.。])\s+(?=\S)/).map(x=>cbEsc(x)).join('<br>');
}
function cbOwnerBtns(current, fnName){
  return `<div class="owner-tabs" style="display:inline-flex;gap:3px;flex-wrap:wrap">
    ${['전체', ...OWNERS].map(o=>`<button class="owner-btn${String(current)===o?' active':''}" data-owner="${cbEsc(o)}" onclick="${fnName}('${cbEsc(o)}')" aria-pressed="${String(current)===o}">${cbEsc(o)}</button>`).join('')}
  </div>`;
}

// 섹터 집계 (주식 기준. includeCrypto=true면 가상화폐를 'Crypto'로 별도 분류해 포함)
// 섹터 표시 이름 — 한글 대응표는 script.js 의 sectorKo 하나다. 집계 키(label)는 영어 그대로 둔다.
function cbSectorName(key){ return typeof sectorKo==='function' ? sectorKo(key) : String(key==null?'':key); }
function cbSectors(includeCrypto, ownerFilter){
  const base = (pfolioData||[]).filter(i=>i && i.grp!=='부동산' && (i.qty||0)>0
    && (!ownerFilter || i.owner===ownerFilter));
  const itemValue = i => cbValKRW(i);
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
// 구성종목은 GitHub Actions 배치가 미국 장 마감 뒤 평일 1회 수집해 저장소에 커밋한다.
// 데이터 전용 커밋은 Vercel 배포를 만들지 않으므로 GitHub 원본을 우선 읽고, 실패할 때
// 배포 당시의 로컬 사본으로 폴백한다. ETF 페이지 진입 시 인증 API로 원본도 조회한다.
// 서버리스에서는 제한 시간이 긴 KRX·브라우저 재시도 없이 HTTP 어댑터만 사용한다.
// 개별 주식으로 직접 보유하지 않은 구성종목은 계산하지 않는다(요구사항).
let _cbEtfLoading = false;

function cbEtfDoc(){
  const doc=window._etfHoldings;
  if(!doc)return doc||null;
  const etfs={...doc.etfs};
  for(const [code,entry] of Object.entries(window._etfLiveEntries||{})){
    if(!etfs[code]?.asOf || entry.asOf>=etfs[code].asOf)etfs[code]=entry;
  }
  return {...doc,etfs};
}

let _cbEtfPromise=null;
const CB_ETF_SNAPSHOT_URLS = [
  'https://raw.githubusercontent.com/Eddie7-great/asset_dashboard_caludedesign/main/data/etf_holdings.json',
  'data/etf_holdings.json'
];
function cbEnsureEtfHoldings(force=false){
  if(_cbEtfPromise)return _cbEtfPromise;
  if(!force&&window._etfHoldings!==undefined)return Promise.resolve();
  _cbEtfPromise=cbLoadEtfHoldings(force).finally(()=>{_cbEtfPromise=null;});
  return _cbEtfPromise;
}
async function cbLoadEtfHoldings(force=false){
  if (_cbEtfLoading || (!force && window._etfHoldings !== undefined)) return;
  _cbEtfLoading = true;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    let doc=null,lastError=null;
    for(const url of CB_ETF_SNAPSHOT_URLS){
      try{
        const r=await fetch(url,{cache:'no-store',signal:controller.signal});
        if(!r.ok)throw new Error('ETF '+r.status);
        const candidate=await r.json();
        if(!candidate||!candidate.etfs||typeof candidate.etfs!=='object'||Array.isArray(candidate.etfs))throw new Error('ETF schema');
        doc=candidate;break;
      }catch(e){lastError=e;}
    }
    if(!doc)throw lastError||new Error('ETF snapshot unavailable');
    window._etfHoldings=doc;window._etfLoadError=false;
  }catch(e){ if(!window._etfHoldings)window._etfHoldings=null;window._etfLoadError=true; }
  finally{ clearTimeout(timer);_cbEtfLoading = false; }
  cbRerender();
}

function cbIsEtf(i){
  if (!i || i.grp!=='주식') return false;
  const market = String(i.market || i.marketType || i.type || '').toUpperCase();
  if (market === 'ETF' || market.endsWith(' ETF')) return true;
  const code = cbStrip(i.tkr);
  if(window._etfHoldings?.etfs?.[code])return true;
  const db = window._krStocksDB;
  const meta = db && db.byCode && typeof db.byCode.get==='function' ? db.byCode.get(code) : null;
  if (meta && String(meta.market || '').toUpperCase()==='ETF') return true;
  // 구성종목 수집이 실패한 단일종목 레버리지 ETF는 위 어느 경로에도 걸리지 않는다
  // (market 정규화 allow-list 에 'ETF' 가 없고, _etfHoldings.etfs 에도 없다).
  // 상품명만으로 기초자산·배수가 확정되는 상품은 그 해석 성공을 ETF 근거로 쓴다 —
  // 이게 없으면 룩스루와 레버리지·인버스 노출도가 둘 다 이 종목을 통째로 놓친다.
  // cbSyntheticEtfHoldings 는 cbIsEtf 를 부르지 않으므로 순환 호출이 아니다.
  if (typeof cbSyntheticEtfHoldings==='function' && cbSyntheticEtfHoldings(i)) return true;
  return typeof _gicsSector==='function' && /ETF$/.test(_gicsSector(i)||'');
}

// 단일 기초자산 레버리지 ETF는 일반 구성종목 목록 대신 기초자산·노출배수를 해석한다.
// 회사 집중도는 직접 보유한 개별 회사와의 교집합만 표시하므로 ETHU 같은 가상화폐
// 파생 ETF는 회사 행으로 나오지 않고, 이미 해석된 상품이므로 미조회 각주에도 표시하지 않는다.
//
// 이것은 QLD 처럼 '레버리지 배수로 스왑 바스켓을 추론'하는 것과 다르다 — 단일 종목 ETF는
// 기초자산이 상품명에 하나로 명시돼 있어 추론이 아니라 정의다. 그래서 지수형 상품에는
// 절대 적용하지 않도록, 단일 종목 상품만 내는 발행사와 기초자산 토큰을 함께 요구한다.
const CB_SINGLE_STOCK_LEV_ISSUER = /(T-?REX|DEFIANCE|GRANITESHARES|TRADR|LEVERAGE\s*SHARES|YIELDMAX)/;
// 아래 심볼은 지수·섹터 추종이라 '단일 회사'로 해석하면 안 된다.
const CB_NOT_SINGLE_STOCK = new Set([
  'QQQ','SPY','IWM','DIA','SOXX','SMH','XLK','XLF','XLE','TLT','IEF','EEM','EFA','VOO','VTI',
  'NDX','SPX','RUT','DJIA','KOSPI','KOSDAQ','GLD','SLV','USO','ARKK','BITO',
]);
function cbSyntheticEtfHoldings(i){
  const ticker = cbStrip(i && i.tkr);
  const name = String(i && i.name || '').toUpperCase();
  if (ticker==='ETHU' || (/(2X|ULTRA)/.test(name) && /(ETHER|ETHEREUM|이더리움)/.test(name))){
    return [{ t:'ETH', n:'이더리움', w:200 }];
  }
  // 예: 'T-REX 2X Long BMNR Daily Target' → BMNR 에 200% 노출.
  // 인버스(SHORT)는 음수 노출이라 룩스루 합산 규칙과 맞지 않으므로 해석하지 않는다
  // — 그쪽은 리스크 진단의 '레버리지·인버스 노출도' 카드가 이미 담당한다.
  if (CB_SINGLE_STOCK_LEV_ISSUER.test(name)){
    const m = name.match(/(\d(?:\.\d)?)\s*X\s+LONG\s+([A-Z]{1,5})\b/);
    const under = m && cbStrip(m[2]);
    if (under && !CB_NOT_SINGLE_STOCK.has(under)){
      const mult = Number(m[1]);
      if (Number.isFinite(mult) && mult > 0 && mult <= 5) return [{ t:under, n:under, w:mult*100 }];
    }
  }
  return null;
}

// 레버리지·인버스 노출은 ETF 평가액 자체를 투자자산과 비교한다.
// 국내 상품명 규칙과 해외 대표 티커/영문 상품명 규칙을 함께 사용해 특정 ETF에 한정하지 않는다.
// 상품명에 배수가 드러나지 않는 대표 티커의 노출 배수.
const CB_LEV_MULT = {
  TQQQ:3, UPRO:3, SPXU:3, SQQQ:3, SOXL:3, SOXS:3, LABU:3, LABD:3, TECL:3, TECS:3,
  TNA:3, TZA:3, UDOW:3, SDOW:3, FNGU:3, NAIL:3, WANT:3,
  QLD:2, SSO:2, SDS:2, QID:2, USD:2, BITU:2, ETHU:2,
  SH:1, PSQ:1, DOG:1, RWM:1,
};
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
  // 노출 배수 — 변동성 가중에 쓴다. 상품명에 적힌 배수를 우선하고, 없으면 알려진 티커 표를 본다.
  // 그래도 모르면 레버리지는 2배, 단순 인버스는 1배로 본다(가장 흔한 형태).
  // 변동 '폭'만 필요하므로 방향(인버스의 음수)은 쓰지 않는다.
  const named = name.match(/(?:^|[\s(+-])([23](?:\.\d+)?)\s*(?:X|배)(?:[\s)]|$)/);
  const mult = named ? Number(named[1])
    : (CB_LEV_MULT[ticker] || (leveraged ? 2 : 1));
  return { kind: inverse ? '인버스' : '레버리지', ticker, mult };
}

// ETF 간 중복도 — 같은 소유주가 가진 서로 다른 ETF 가 같은 회사를 동시에 담고 있는 정도.
//
// cbLookThrough 는 '직접 보유한 회사와 겹치는 부분'만 센다(그 규칙은 그대로 둔다).
// 그래서 NVDA 를 직접 안 들고 두 ETF 로만 담고 있으면 중복도가 0 으로 보인다.
// 테마가 몰린 포트폴리오에서 실제 편중이 통째로 과소평가되므로 별도 지표로 따로 낸다.
//
// 소유주 경계는 룩스루와 같다 — 서로 다른 소유주의 ETF 를 한 종목으로 합치지 않는다.
function cbEtfCrossOverlap(ownerFilter){
  const doc = cbEtfDoc();
  const rows = cbAllRows().filter(r=>!ownerFilter || r.i.owner===ownerFilter);
  const nw = rows.reduce((s,r)=>s+r.val,0) || 1;
  // key = 소유주::티커 → { val, funds:Set, name }
  const byOwnerTicker = new Map();
  let etfCount = 0; const unknown = [];
  rows.forEach(r=>{
    if (!cbIsEtf(r.i)) return;
    etfCount++;
    const ent = doc && doc.etfs ? doc.etfs[cbStrip(r.i.tkr)] : null;
    const collected = typeof etfStockRows==='function' ? etfStockRows(ent) : (ent && Array.isArray(ent.holdings)) ? ent.holdings : null;
    const holdings = (collected && collected.length) ? collected : cbSyntheticEtfHoldings(r.i);
    // 구성종목을 못 받았거나 잠정인 ETF 는 이름만 남기고 합산에서 뺀다 — 확인된 자료만 센다.
    if (!holdings || !holdings.length){ if (unknown.indexOf(r.title)<0) unknown.push(r.title); return; }
    if (ent && typeof etfQuality==='function' && !etfQuality(ent).reliable && unknown.indexOf(r.title)<0) unknown.push(r.title);
    holdings.forEach(h=>{
      const t = cbStrip(h.t); if(!t) return;
      const w = Number(h.w)||0; if(!Number.isFinite(w)||w<=0) return;
      const key = String(r.i.owner||'') + '::' + t;
      const cur = byOwnerTicker.get(key) || { val:0, funds:new Set(), name:h.n||t, tkr:t };
      cur.val += r.val * w / 100;
      cur.funds.add(r.title);
      byOwnerTicker.set(key, cur);
    });
  });
  // 두 개 이상의 ETF 에 동시에 들어 있는 종목만 '중복'이다.
  const shared = [...byOwnerTicker.values()].filter(x=>x.funds.size>=2).sort((a,b)=>b.val-a.val);
  const val = shared.reduce((s,x)=>s+x.val,0);
  return {
    pct: val/nw*100, val, etfCount, count: shared.length,
    top: shared[0] ? { name:shared[0].name, tkr:shared[0].tkr, funds:shared[0].funds.size, pct:shared[0].val/nw*100 } : null,
    unknown, provisional: etfCount>0 && (!doc || unknown.length>0),
  };
}

// 직접 보유 중인 개별 주식(ETF 제외)을 정규화 티커로 찾아보는 표.
// ownerFilter 가 없거나 '전체' 면 가구 전체, 아니면 그 소유주 것만 센다.
//
// cbLookThrough 와 etfExposure 는 이 표로 대체하지 않는다 — 둘은 '소유주별 누적 금액'이
// 필요해 모양이 다르고, 기존 테스트가 그 동작을 고정하고 있다. 이 함수는 ETF 탐색의
// '직접 보유만 보기' 필터와 '직접 보유 겹침' 카드가 **함께 쓰는 하나의 출처**다.
function cbDirectStockMap(ownerFilter){
  const scope = (!ownerFilter || ownerFilter==='전체') ? null : ownerFilter;
  const map = new Map();
  cbAllRows().forEach(r=>{
    if (scope && r.i.owner!==scope) return;
    if (r.i.grp!=='주식' || cbIsEtf(r.i)) return;     // 개별 주식만. ETF 는 겹침의 대상이 아니라 경로다
    const t = cbStrip(r.i.tkr); if(!t) return;
    const cur = map.get(t) || { tkr:t, title:r.title, val:0 };
    cur.val += r.val;
    map.set(t, cur);
  });
  return map;
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
  let etfCount = 0; const etfMiss = [], etfUncertain=[];
  rows.forEach(r=>{
    if (!cbIsEtf(r.i)) return;
    etfCount++;
    const strip = cbStrip(r.i.tkr);
    const ent = doc && doc.etfs ? doc.etfs[strip] : null;
    const collected = typeof etfStockRows==='function' ? etfStockRows(ent) : (ent && Array.isArray(ent.holdings)) ? ent.holdings : null;
    if(ent&&typeof etfQuality==='function'&&!etfQuality(ent).reliable&&!etfUncertain.includes(r.title))etfUncertain.push(r.title);
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
      const w = Number(h.w)||0;if(!Number.isFinite(w))return;
      const add = r.val * w / 100;
      if (add<=0) return;
      d.via += add;
      d.etfs.push({ owner:r.i.owner||'', etf:r.title, w: w, val:add });
    });
  });
  const list = Array.from(direct.values())
    .map(d=>({ ...d, tot:d.val+d.via, pct:(d.val+d.via)/nw*100, dPct:d.val/nw*100, vPct:d.via/nw*100 }))
    .sort((a,b)=>b.tot-a.tot);
  return { list, nw, etfCount, etfMiss, etfUncertain, loaded: !!doc };
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
  const look=cbLookThrough(ownerFilter),top = look.list[0];
  const provisional=look.etfCount>0&&(!look.loaded||look.etfMiss.length>0||(look.etfUncertain||[]).length>0);
  const topPct = top ? top.pct : 0;
  const cryptoPct = pctOf(byCls.crypto||0), cashPct = pctOf(byCls.cash||0);
  const fxPct = pctOf(rows.filter(r=>r.i.cur && r.i.cur!=='KRW').reduce((s,r)=>s+r.val,0));
  // 환노출 카드의 통화 구성 막대용 — 같은 분모(nw)·같은 판정(cur!=='KRW')을 통화별로 나눈 것뿐이다.
  const fxMixMap = {};
  rows.forEach(r=>{ const c=String(r.i.cur||'KRW').toUpperCase(); fxMixMap[c]=(fxMixMap[c]||0)+r.val; });
  const fxMix = Object.entries(fxMixMap).map(([cur,val])=>({cur,pct:pctOf(val)})).filter(x=>x.pct>0);
  const leveragedInverse = rows
    .map(r=>({ r, meta:cbLeveragedInverseMeta(r.i) }))
    .filter(x=>x.meta)
    .sort((a,b)=>b.r.val-a.r.val);
  const leveragedInverseVal = leveragedInverse.reduce((s,x)=>s+x.r.val,0);
  const leveragedInversePct = pctOf(leveragedInverseVal);
  const leveragedInverseTop = leveragedInverse[0] || null;
  // 자산군 상수만 쓰면 QLD(2배 QQQ)도 일반 미국 ETF와 똑같이 22% 로 잡혀 위험이 과소평가된다.
  // cbLeveragedInverseMeta 가 이미 배수를 알고 있으므로 그만큼 기여분을 키운다.
  const vol = rows.reduce((s,r)=>{
    const lev = cbLeveragedInverseMeta(r.i);
    return s + (r.val/nw)*(CB_VOL[r.cls]||0)*(lev ? lev.mult : 1);
  },0)*100;
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
      // 게이지는 판정에 쓴 같은 기준값을 그린다(새 기준을 만들지 않는다). 눈금 끝은 막대 길이와 같은 척도.
      meter: { value:val, warnAt:thWarn, badAt:thBad, invert:!!invert, max: invert ? thWarn*2 : 100 },
      msg: msgs[lvl], lvl };
  };
  const topName = top ? top.title : '—';
  const cards = [
    mk('단일 종목 집중도', topPct, topPct.toFixed(1)+'%', 20, 30,
      ['최대 종목 비중 20% 이하로 분산이 잘 되어 있습니다.','최대 종목 '+topName+' 비중이 20%를 넘습니다. 부분 익절을 고려하세요.','단일 종목 의존도가 30%를 초과합니다. 급락 시 타격이 큽니다.']),
    mk('가상화폐 비중', cryptoPct, cryptoPct.toFixed(1)+'%', 20, 35,
      ['가상화폐 비중이 적정합니다.','가상화폐가 20%를 넘습니다. 일반 권고(5–15%)보다 높습니다.','가상화폐가 35%를 초과해 변동성을 지배합니다.']),
    mk('섹터 집중도', topSec.pct, Math.round(topSec.pct)+'%', 35, 50,
      ['주식 섹터 분산이 양호합니다.','최대 섹터 '+cbSectorName(topSec.label)+' 비중이 35%를 넘습니다.',cbSectorName(topSec.label)+' 편중이 50%를 초과합니다. 섹터 분산이 시급합니다.']),
    mk('추정 연 변동성', vol, vol.toFixed(1)+'%', 22, 32,
      ['전체 변동성이 균형 잡힌 범위입니다.','변동성이 다소 높습니다. 안전자산 확대를 검토하세요.','변동성이 매우 높습니다. 하락장 손실 폭이 클 수 있습니다.']),
    mk('현금 완충 비중', cashPct, cashPct.toFixed(1)+'%', 5, 3,
      ['비상 대응 현금이 충분합니다.','현금이 5% 미만입니다. 조정장 매수 여력이 제한적입니다.','현금 3% 미만 — 유동성 리스크가 있습니다.'], true),
    mk('환노출 (원화 기준)', fxPct, fxPct.toFixed(1)+'%', 60, 80,
      ['외화 노출이 적정 범위입니다.','자산의 60% 이상이 외화입니다. 환율 하락 리스크에 유의하세요.','외화 편중이 심합니다. 환헤지나 원화 자산 확대를 검토하세요.']),
    mk('자산군 분산', clsCount, clsCount+'개', 3, 2,
      [clsCount+'개 자산군에 분산되어 있습니다.','자산군이 3개 이하입니다. 분산 폭을 넓혀보세요.','자산군 다양성이 부족합니다.'], true),
    mk('레버리지·인버스 노출도', leveragedInversePct, leveragedInversePct.toFixed(1)+'%', 5, 10,
      leveragedInverseTop
        ? [
            leveragedInverse.length+'개 상품을 보유 중이며 최대 기여 상품은 '+leveragedInverseTop.r.title+'입니다.',
            '투자자산의 5%를 넘습니다. 최대 기여 상품 '+leveragedInverseTop.r.title+'의 변동성에 유의하세요.',
            '투자자산의 10%를 초과합니다. 최대 기여 상품 '+leveragedInverseTop.r.title+'의 비중 축소를 검토하세요.',
          ]
        : [
            '보유 중인 레버리지·인버스 상품이 없습니다.',
            '레버리지·인버스 상품 비중을 점검하세요.',
            '레버리지·인버스 상품 비중 축소를 검토하세요.',
          ]),
  ];
  const fxCard=cards.find(c=>c.title.startsWith('환노출'));
  if(fxCard) fxCard.fxMix=fxMix;
  cards[cards.length-1].tip = '레버리지·인버스 ETF의 현재 평가액 합계를 선택한 소유주의 투자자산으로 나눈 비중입니다. 5% 초과는 주의, 10% 초과는 경고로 표시합니다.';
  const company=cards.find(c=>c.title.includes('단일 종목'));
  if(provisional&&company){company.msg='일부 ETF 구성비가 미확인·지연 상태입니다. 확인된 직접·간접 노출만 반영한 잠정 수치입니다.';if(company.lvl===0)company.status='확인 필요';}
  const score = Math.max(0, Math.min(100, 100 - cards.reduce((s,c)=>s+c.lvl*10,0)));
  return { score, provisional, grade: provisional?'자료 확인 필요':score>=75?'안정적':score>=50?'주의 필요':'고위험',
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

  // 직접 보유 회사와 ETF 편입 종목이 겹쳐 생긴 간접 보유분의 투자자산 대비 비중.
  const look=cbLookThrough(ownerFilter);
  // ETF 끼리 같은 회사를 담고 있는 정도 — 위 지표가 못 보는 부분을 따로 낸다.
  const crossOverlap=cbEtfCrossOverlap(ownerFilter);
  // 최다 중복 종목명은 ETF 구성종목 자료에서 온 외부 문자열이다. 카드 렌더러가 detail 을
  // cbEsc 로 감싸 출력하므로 여기서는 지역 변수로만 받아 둔다(이중 이스케이프 방지).
  const crossTopLabel=crossOverlap.top?String(crossOverlap.top.name||crossOverlap.top.tkr||''):'';
  const overlapVal=look.list.reduce((s,x)=>s+(Number(x.via)||0),0);
  const overlapPct=overlapVal/nw*100;
  const overlapUnknown=look.etfCount>0 && (!look.loaded || (look.etfMiss||[]).length>0 || (look.etfUncertain||[]).length>0);
  const overlapPending=overlapUnknown && window._etfHoldings===undefined;

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
  const topTwoSectorNames=topTwoSectors.map(x=>cbSectorName(x.label)).join(' + ')||'섹터 없음';

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

  // 취득가를 아는 투자자산만 사용해 현재 평가손실에서 원금까지 필요한 반등률을 계산한다.
  const recoveryRows=rows.filter(r=>r.i.grp!=='현금'&&!r.i.costUnknown&&r.cost>0);
  const recoveryValue=recoveryRows.reduce((s,r)=>s+r.val,0);
  const recoveryCost=recoveryRows.reduce((s,r)=>s+r.cost,0);
  const recoveryPct=recoveryCost>recoveryValue&&recoveryValue>0
    ? (recoveryCost-recoveryValue)/recoveryValue*100 : 0;

  return [
    {
      id:'etf-overlap', title:'ETF 중복 노출률', value:overlapUnknown?'—':overlapPct.toFixed(1)+'%',
      detail:overlapUnknown?(overlapPending?'구성종목 확인 중':'구성종목을 받지 못함 · 확인 필요'):(overlapPct>0?`간접 중복 ${cbDisp(overlapVal)}`:'직접·간접 중복 없음'),
      tone:overlapUnknown?(overlapPending?'var(--lab)':warn):toneHigh(overlapPct,5,15),
      meter:overlapUnknown?null:{value:overlapPct,warnAt:5,badAt:15,max:30},
      tip:'직접 보유한 개별 회사와 보유 ETF 구성종목이 겹쳐 추가된 간접 보유분을 투자자산으로 나눈 비중입니다. 직접 보유가 없는 회사는 여기에 잡히지 않으므로 ETF 간 중복도를 함께 보세요.',
    },
    {
      // 위 카드가 못 보는 부분 — 직접 보유가 없어도 여러 ETF 가 같은 회사를 담고 있으면 편중이다.
      id:'etf-cross-overlap', title:'ETF 간 중복도',
      value:crossOverlap.etfCount===0?'ETF 없음':(crossOverlap.provisional&&crossOverlap.count===0?'—':crossOverlap.pct.toFixed(1)+'%'),
      detail:crossOverlap.etfCount===0?'보유 ETF가 없습니다'
        :crossOverlap.count===0?(crossOverlap.provisional?'구성종목 확인 전 · 판정 보류':'겹치는 종목 없음')
        :`${crossOverlap.count}종목 겹침${crossOverlap.top?` · 최다 ${crossTopLabel} ${crossOverlap.top.funds}개 펀드`:''}${crossOverlap.provisional?' · 일부 미확인':''}`,
      tone:crossOverlap.etfCount===0?up
        :crossOverlap.provisional&&crossOverlap.count===0?'var(--lab)'
        :toneHigh(crossOverlap.pct,15,30),
      meter:crossOverlap.etfCount===0||(crossOverlap.provisional&&crossOverlap.count===0)?null:{value:crossOverlap.pct,warnAt:15,badAt:30,max:60},
      tip:'같은 소유주가 가진 서로 다른 ETF 가 동시에 담고 있는 회사의 간접 보유분 합계를 투자자산으로 나눈 비중입니다. 직접 보유 여부와 무관하게 셉니다 — 테마가 몰린 포트폴리오는 섹터 분류가 흩어져 있어도 실제로는 같은 회사에 겹쳐 노출됩니다. 구성종목을 확인하지 못한 ETF 는 합산에서 빼고 그 사실을 함께 표시합니다.',
    },
    {
      id:'effective-holdings', title:'실효 종목 수', value:effectiveCount.toFixed(1)+'개',
      detail:`실제 ${merged.length}종목 · HHI 역수`,
      tone:toneLow(effectiveCount,10,6),
      meter:merged.length?{value:effectiveCount,warnAt:10,badAt:6,invert:true,max:20}:null,
      tip:'각 종목 비중 제곱합(HHI)의 역수입니다. 종목 수가 많아도 일부에 쏠리면 실효 종목 수는 작아집니다.',
    },
    {
      id:'fx-shock', title:'환율 -10% 충격', value:'−'+fxShockPct.toFixed(1)+'%',
      detail:fxShockVal>0?`예상 감소 ${cbDisp(fxShockVal)}`:'외화 자산 없음',
      tone:toneHigh(fxShockPct,5,8),
      meter:{value:fxShockPct,warnAt:5,badAt:8,max:12},
      tip:'외화 표시 자산의 환율만 10% 하락하고 자산 가격은 그대로라고 가정한 단순 민감도입니다.',
    },
    {
      id:'country-concentration', title:'국가별 최대 집중도',
      value:topCountry[1]>0?`${topCountry[0]} ${topCountryPct.toFixed(1)}%`:'주식 없음',
      detail:'상장통화·상품명 기준 추정',
      tone:toneHigh(topCountryPct,45,65),
      meter:topCountry[1]>0?{value:topCountryPct,warnAt:45,badAt:65,max:100}:null,
      tip:'주식과 ETF의 상장통화 및 상품명으로 투자 지역을 추정한 뒤 전체 투자자산 대비 최대 지역 비중을 표시합니다.',
    },
    {
      id:'top2-sectors', title:'상위 2개 섹터 집중도', value:topTwoSectorPct.toFixed(1)+'%',
      detail:topTwoSectorNames,
      tone:toneHigh(topTwoSectorPct,50,70),
      meter:sectors.length?{value:topTwoSectorPct,warnAt:50,badAt:70,max:100}:null,
      tip:'가장 큰 두 주식 섹터의 비중을 합산합니다. 비중 분모에는 현금·금·가상화폐를 포함한 전체 투자자산을 사용합니다.',
    },
    {
      id:'dividend-dependency', title:'배당원 TOP3 의존도',
      value:dividendAnnual>0?dividendTop3Pct.toFixed(1)+'%':'배당 없음',
      detail:dividendAnnual>0?`연 배당 ${cbDisp(dividendAnnual)}`:'배당 데이터 없음',
      tone:dividendAnnual>0?toneHigh(dividendTop3Pct,45,70):warn,
      meter:dividendAnnual>0?{value:dividendTop3Pct,warnAt:45,badAt:70,max:100}:null,
      tip:'연간 예상 배당수입 중 가장 큰 세 개 배당원이 차지하는 비중입니다. 소유주가 다르면 같은 종목도 별도로 계산합니다.',
    },
    {
      id:'recovery-return', title:'손실 회복 필요 수익률',
      value:recoveryRows.length?recoveryPct.toFixed(1)+'%':'산정 제외',
      detail:recoveryPct>0?'현재 평가손실에서 원금 기준':'평가손실 없음',
      tone:toneHigh(recoveryPct,10,25),
      meter:recoveryRows.length?{value:recoveryPct,warnAt:10,badAt:25,max:50}:null,
      tip:'취득가를 아는 투자자산의 현재 평가액이 매입원가로 회복하려면 필요한 상승률입니다. 취득가 미상 자산과 현금은 제외합니다.',
    },
  ];
}

// 리스크 기준 게이지 — 양호·주의·위험 3구간 띠 위에 현재 값까지 채운 막대.
// 구간 경계는 카드 판정(mk / toneHigh·toneLow)에 쓴 기준값 그대로다. 값이 없으면(판정 보류) 그리지 않는다.
// invert: 값이 '작을수록' 위험한 지표(현금 비중·자산군 수·실효 종목 수). unit: 표시 단위.
// 리스크 카드 게이지(2026-11-23 개편, 사용자 결정) — 회색 한 줄 + 판정 기준 눈금 두 개(숫자) + 지금 값 동그라미(판정색).
// 예전에는 16개 카드 모두 초록·노랑·분홍 구간 바탕 위에 색 막대를 덮어, 화면 전체가 알록달록하고 '어디까지 안전한지'가 오히려 안 보였다.
// 이제 색은 판정 배지와 동그라미에만 쓴다. 기준값은 판정에 쓴 같은 숫자(warnAt·badAt)이고, 방향(낮을수록/높을수록 안전)을 글자로 적는다.
function cbRiskMeterHtml(m, unit, color){
  if(!m||!Number.isFinite(Number(m.value))||!(m.max>0)) return '';
  const u=unit==null?'%':unit;
  const clamp=v=>Math.max(0,Math.min(100,v/m.max*100));
  const fmt=v=>(Math.round(v*10)/10).toLocaleString()+u;
  const v=Number(m.value);
  const desc=m.invert
    ? `현재 ${fmt(v)} · ${fmt(m.warnAt)} 미만 주의 · ${fmt(m.badAt)} 미만 위험`
    : `현재 ${fmt(v)} · ${fmt(m.warnAt)} 초과 주의 · ${fmt(m.badAt)} 초과 위험`;
  // 눈금 글자는 막대 아래. 끝에 붙은 눈금은 글자를 안쪽으로 맞추고, 두 눈금이 가까우면(14% 미만) 글자 하나로 합친다
  // — 따로 적으면 '22%32%' 처럼 겹친다. 정확한 기준은 aria-label·말풍선(desc)에 그대로 있다.
  const lab=(pos,text,kind)=>{
    const edge=pos<8?' is-start':(pos>92?' is-end':'');
    return `<span class="cb-meter-tick-lab ${kind}${edge}" style="left:${pos.toFixed(2)}%">${cbEsc(text)}</span>`;
  };
  const pw=clamp(m.warnAt), pb=clamp(m.badAt);
  const tickLine=(pos,kind)=>`<span class="cb-meter-tick ${kind}" style="left:${pos.toFixed(2)}%"></span>`;
  let ticks=tickLine(pw,'warn')+tickLine(pb,'bad');
  if(Math.abs(pw-pb)<14){
    const mid=Math.max(20,Math.min(80,(pw+pb)/2));
    ticks+=lab(mid,`${fmt(m.warnAt)} · ${fmt(m.badAt)}`,'pair');
  } else {
    ticks+=lab(pw,fmt(m.warnAt),'warn')+lab(pb,fmt(m.badAt),'bad');
  }
  // '낮을수록 안전' 글자는 눈금 글자와 같은 줄에 둔다 — 눈금이 왼쪽에 몰리면 오른쪽 끝, 오른쪽에 몰리면 왼쪽 끝,
  // 양쪽에 걸치면 막대 위 오른쪽(겹침 방지). 예전엔 눈금 아래 따로 한 줄이라 카드 안에서 떠 보였다.
  const dirPos=Math.max(pw,pb)<=58?'is-right':(Math.min(pw,pb)>=42?'is-left':'is-top');
  return `<div class="cb-meter-wrap ${dirPos}"><div class="cb-meter" role="img" aria-label="${cbEsc(desc)}" data-tip="${cbEsc(desc)}">`
    + ticks
    + `<span class="cb-meter-mark" style="left:${clamp(v).toFixed(2)}%;background:${color||'var(--acc)'}"></span></div>`
    + `<span class="cb-meter-dir">${m.invert?'높을수록 안전':'낮을수록 안전'}</span></div>`;
}

// 통화 구성 100% 누적 막대 — 외화(USD·JPY·AUD·기타)를 왼쪽부터 쌓고 원화는 회색으로 끝에 둔다.
// 그래서 외화 부분의 길이가 곧 환노출 비중이고, 판정 기준(주의·경고) 눈금을 그대로 얹을 수 있다.
// 색은 검증한 범주 팔레트(--fx-*), 글자는 텍스트 토큰. 대비가 낮은 색이 있어 비중을 글자로도 적는다.
const CB_FX_ORDER=['USD','JPY','AUD'];
function cbFxMixHtml(mix, meter){
  const list=(mix||[]).filter(x=>x.pct>0);
  if(!list.length) return '';
  const known=CB_FX_ORDER.map(c=>list.find(x=>x.cur===c)).filter(Boolean);
  const other=list.filter(x=>x.cur!=='KRW'&&!CB_FX_ORDER.includes(x.cur));
  const otherPct=other.reduce((s,x)=>s+x.pct,0);
  const krw=list.find(x=>x.cur==='KRW');
  const segs=[...known.map(x=>({key:x.cur.toLowerCase(),label:x.cur,pct:x.pct})),
    ...(otherPct>0?[{key:'other',label:other.map(x=>x.cur).join('·'),pct:otherPct}]:[]),
    ...(krw?[{key:'krw',label:'KRW',pct:krw.pct}]:[])];
  const total=segs.reduce((s,x)=>s+x.pct,0)||1;
  const pct=v=>(Math.round(v*10)/10).toFixed(1)+'%';
  const ticks=meter?[meter.warnAt,meter.badAt].filter(v=>v>0&&v<100):[];
  const desc=segs.map(x=>`${x.label} ${pct(x.pct)}`).join(' · ');
  return `<div class="cb-fx-mix" role="img" aria-label="통화 구성 ${cbEsc(desc)}">`
    + `<div class="cb-fx-bar" data-tip="${cbEsc(desc+(ticks.length?` · 외화 ${ticks.join('%·')}% 초과 시 주의·경고`:''))}">`
    + segs.map(x=>`<span class="cb-fx-seg ${x.key}" style="width:${(x.pct/total*100).toFixed(2)}%"></span>`).join('')
    + ticks.map(t=>`<i class="cb-fx-tick" style="left:${t}%"></i>`).join('')
    + `</div><div class="cb-fx-legend">${segs.map(x=>`<span><i class="cb-fx-seg ${x.key}"></i>${cbEsc(x.label)} ${pct(x.pct)}</span>`).join('')}</div></div>`;
}

// ───────────────────────── SVG 빌더 ─────────────────────────
function cbDonutSvg(segs, size, clickFn, ratio){
  // 자산 배분은 항목 간 비율 비교에 도넛이 적합하다. 중앙 공백만 줄여 실제 데이터 면적을 넓힌다.
  const stroke=size*(ratio||0.24), r=size/2-stroke/2, c=2*Math.PI*r; let off=0;
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
// provisional(자료 확인 전 잠정 점수)이면 바탕 고리를 점선으로, 점수 호를 회색 반투명으로 그린다 —
// 초록 90점 옆에 '자료 확인 필요'가 붙어 신호가 엇갈리던 것을 한눈에 '잠정'으로 보이게 한다(2026-11-23).
function cbRingSvg(score, size, color, provisional){
  const stroke=10, r=size/2-stroke/2, c=2*Math.PI*r, len=c*score/100;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)"${provisional?' class="is-provisional"':''}>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" style="stroke:var(--grid)" stroke-width="${stroke}"${provisional?' stroke-dasharray="3 5"':''}></circle>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${provisional?'var(--lab)':color}"${provisional?' stroke-opacity=".55"':''} stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${len} ${c-len}"></circle></svg>`;
}
// 라인 차트 플롯 영역 좌우 패딩 (Y축 라벨 공간) — hover 히트영역 계산에도 사용
const CB_LINE_PAD = { l: 48, r: 12 };
// 성과 비교 선 그래프는 오른쪽 끝에 선 이름표를 달므로 오른쪽 여백을 따로 둔다(투자자산 추이는 CB_LINE_PAD 그대로).
const CB_PERF_PAD = { l: 48, r: 70 };
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
// 날짜 눈금으로 쓸 점 번호 — 점이 많아도(일별 ≈ 250점) 6개 안팎만 고른 간격으로 고른다.
function cbPerfTickIdx(n, count=6){
  if (n<=0) return [];
  if (n<=count) return Array.from({length:n},(_,i)=>i);
  return [...new Set(Array.from({length:count},(_,j)=>Math.round(j*(n-1)/(count-1))))];
}
// 선 끝 이름표 세로 위치 — 가까운 이름표끼리 겹치지 않게 최소 간격(gap)만큼 벌리고, 그림 영역을 넘으면 통째로 올린다.
function cbSpreadLabels(ys, gap, top, bottom){
  const order = ys.map((y,i)=>({y,i})).sort((a,b)=>a.y-b.y);
  for (let k=0;k<order.length;k++) order[k].y = Math.max(order[k].y, k?order[k-1].y+gap:top);
  const over = order.length ? order[order.length-1].y - bottom : 0;
  if (over>0) order.forEach(o=>{ o.y -= over; });
  for (let k=order.length-2;k>=0;k--) order[k].y = Math.min(order[k].y, order[k+1].y-gap);
  const out = Array(ys.length); order.forEach(o=>{ out[o.i]=o.y; }); return out;
}
function cbMultiLineSvg(seriesArr, w, h){
  const valid = seriesArr.filter(s=>s.data.some(v=>v!=null));
  const all = valid.flatMap(s=>s.data).filter(v=>v!=null);
  if (!all.length) return `<div style="height:${h}px;display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:var(--fs-cap)">벤치마크 데이터 로딩 중… (전일 종가 갱신을 눌러주세요)</div>`;
  const mn=Math.min(...all,0), mx=Math.max(...all,0), padV=(mx-mn)*0.08||1;
  // Y축 세분화: nice-step 눈금 + 전 눈금 금액 라벨
  const step = cbNiceStep((mx-mn+padV*2)/6);
  const lo = Math.floor((mn-padV)/step)*step, hi = Math.ceil((mx+padV)/step)*step;
  const padL=CB_PERF_PAD.l, padR=CB_PERF_PAD.r, plotW=w-padL-padR;
  const y=v=>h-8-((v-lo)/(hi-lo))*(h-16);
  let out='';
  for (let v=lo; v<=hi+step*0.01; v+=step){
    const yy=y(v).toFixed(1);
    out+=`<line x1="${padL}" x2="${w-padR}" y1="${yy}" y2="${yy}" style="stroke:var(--grid)" stroke-width="1"></line>`;
    out+=`<text x="${padL-7}" y="${(y(v)+3.4).toFixed(1)}" style="fill:var(--lab)" font-size="12" text-anchor="end">${v>0?'+':''}${Number(v.toFixed(2))}%</text>`;
  }
  if (lo<0 && hi>0) out+=`<line x1="${padL}" x2="${w-padR}" y1="${y(0)}" y2="${y(0)}" style="stroke:var(--bd2)" stroke-width="1.3" stroke-dasharray="4 4"></line>`;
  valid.forEach(s=>{
    const pts=s.data.map((v,i)=>({v,i})).filter(p=>p.v!=null);
    if(pts.length<2) return;
    const dx=plotW/(s.data.length-1);
    const xy=pts.map(p=>({x:padL+p.i*dx, y:y(p.v)}));
    // 일별 점(수십~수백 개)은 곡선 보정을 하면 실제 등락이 뭉개진다 — 점이 많으면 직선으로 잇는다.
    const d=xy.length>40 ? 'M'+xy.map(p=>p.x.toFixed(1)+','+p.y.toFixed(1)).join(' L') : cbSmoothPath(xy);
    s._end = { x:xy[xy.length-1].x, y:xy[xy.length-1].y };
    const dimmed = !!s.dim;
    const op = dimmed ? 0.16 : (s.bold ? 1 : 0.85);
    // 렌더 애니메이션: 실선은 드로잉, 점선(KOSPI)은 목표 불투명도까지 페이드 인(드로잉이 점선 간격을 덮어쓰므로)
    const anim = !s.dash ? 'class="cb-line-draw" pathLength="1"' : `class="cb-line-fade" style="--o:${op}"`;
    out+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.bold?2.6:1.6}" stroke-linejoin="round" stroke-linecap="round" opacity="${op}" ${s.dash?'stroke-dasharray="5 5"':''} ${anim}></path>`;
  });
  // 선 끝 이름표 — 범례를 오가며 색을 맞춰 보지 않아도 어느 선이 누구인지 바로 읽힌다.
  const ends = valid.filter(s=>s._end && s.label);
  const ly = cbSpreadLabels(ends.map(s=>s._end.y), 14, 10, h-6);
  ends.forEach((s,k)=>{
    const op = s.dim ? 0.3 : 1;
    out+=`<text class="cb-perf-end-label" x="${(s._end.x+6).toFixed(1)}" y="${(ly[k]+4).toFixed(1)}" font-size="12" font-weight="700" style="fill:${s.color}" opacity="${op}">${cbEsc(s.label)}</text>`;
  });
  // 균일 스케일(meet) + width:100%/height:auto 로 종횡비 유지 → 텍스트가 가로로 늘어나지 않는다.
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:auto">${out}</svg>`;
}

// ── 홈 타일 지도·점 그림(2026-11-18 2차, 사용자 결정 — 폭포형 막대를 바꿨다) ──
// squarified 배치: 값(a>0)에 비례하는 넓이로 (x,y,w,h) 영역을 빈틈없이 나눈다. 큰 값부터 넣고, 한 줄에 칸을
// 더할 때 가장 길쭉한 칸의 가로세로비가 나빠지면 줄을 끊는다. 새 금액 계산은 없다 — 넓이만 정한다.
function cbTreemapLayout(items, x, y, w, h){
  const out=[]; let rest=(items||[]).filter(it=>it&&it.a>0).sort((p,q)=>q.a-p.a), X=x, Y=y, Wd=w, Hd=h;
  while(rest.length && Wd>0 && Hd>0){
    const tot=rest.reduce((t,it)=>t+it.a,0), horiz=Wd>=Hd, side=horiz?Hd:Wd;
    let row=[], best=Infinity;
    for(let k=1;k<=rest.length;k++){
      const r=rest.slice(0,k), rs=r.reduce((t,it)=>t+it.a,0), len=rs/tot*(horiz?Wd:Hd);
      const worst=Math.max(...r.map(it=>{ const o=it.a/rs*side; return Math.max(len/o,o/len); }));
      if(worst<=best){ best=worst; row=r; } else break;
    }
    const rs=row.reduce((t,it)=>t+it.a,0), len=rs/tot*(horiz?Wd:Hd); let off=0;
    row.forEach(it=>{ const o=it.a/rs*side; out.push(horiz?{...it,x:X,y:Y+off,w:len,h:o}:{...it,x:X+off,y:Y,w:o,h:len}); off+=o; });
    if(horiz){ X+=len; Wd-=len; } else { Y+=len; Hd-=len; }
    rest=rest.slice(row.length);
  }
  return out;
}
// 타일 → HTML 칸(% 좌표, 카드 크기에 따라 늘어난다). W·H 는 배치에 쓴 기준 크기이고, 글자는 기준 크기에서
// 이름·금액이 들어갈 만한 칸에만 쓴다(작은 칸은 말풍선으로 본다). 색은 토큰을 패널색과 섞어 진하기만 바꾼다
// — 글자는 늘 본문색이라 기본·라이트·다크 모두 읽힌다.
function cbTileHtml(t, W, H, o){
  const pct=v=>(v*100).toFixed(3)+'%';
  const big=t.w>=62&&t.h>=36, mid=!big&&t.w>=44&&t.h>=22;
  return `<div class="cb-tile${o.cls?' '+o.cls:''}"${o.attrs||''} style="left:${pct(t.x/W)};top:${pct(t.y/H)};width:${pct(t.w/W)};height:${pct(t.h/H)};background:color-mix(in srgb,${o.color} ${Math.round(o.mix)}%,var(--panelSolid))" data-tip="${cbEsc(o.tip)}">`
    +(big?`<b>${cbEsc(o.name)}</b><span class="cb-num">${o.value}</span>`:mid?`<b>${cbEsc(o.name)}</b>`:'')+`</div>`;
}
// 평가손익 기여 순위(2026-11-23, 사용자 결정 — 타일 지도·점 그림을 대신한다): 이익·손실 같은 수(기본 6개씩, 사용자 결정).
// 막대 길이 = |평가손익| ÷ 목록 안 최대 |평가손익|. rows 는 contributionEligible(현금·시세 미조회 제외) 그대로다.
function cbContribRank(rows, nGain=6, nLoss=nGain){
  const list=(rows||[]).filter(r=>r&&Number.isFinite(r.gain)&&r.gain!==0);
  const gains=list.filter(r=>r.gain>0).sort((a,b)=>b.gain-a.gain);
  const losses=list.filter(r=>r.gain<0).sort((a,b)=>a.gain-b.gain);
  const shown=[...gains.slice(0,nGain),...losses.slice(0,nLoss)];
  return {gains:gains.slice(0,nGain),losses:losses.slice(0,nLoss),
    more:Math.max(0,gains.length-nGain)+Math.max(0,losses.length-nLoss),
    max:Math.max(1,...shown.map(r=>Math.abs(r.gain)))};
}
// 홈 '투자자산 · 최근 30일' — 매일 쌓이는 투자자산 일별 기록(finSnapshotInvestment / 소유주별)을 그대로 쓴다. 새 계산 없음.
// 기록이 둘 미만이면 null(카드가 안내 문구를 그린다).
function cbInvestTrend(history, ownerF, today=new Date(), days=30){
  const key=typeof finLocalDateKey==='function'?finLocalDateKey:(d=>d.toISOString().slice(0,10));
  const from=key(new Date(today.getTime()-days*86400000));
  const val=e=>ownerF?(typeof finSnapshotOwnerInvestment==='function'?finSnapshotOwnerInvestment(e,ownerF):null)
    :(typeof finSnapshotInvestment==='function'?finSnapshotInvestment(e):null);
  const pts=(Array.isArray(history)?history:[]).filter(e=>e&&typeof e.date==='string'&&e.date>=from)
    .map(e=>({date:e.date,v:val(e)})).filter(p=>Number.isFinite(p.v)).sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
  if(pts.length<2) return null;
  const first=pts[0], last=pts[pts.length-1];
  return {pts,first,last,change:last.v-first.v,pct:first.v>0?(last.v-first.v)/first.v:null};
}
// 홈 투자자산 30일 그래프(2026-11-23 — 축 없는 스파크라인을 대신한다): 금액 눈금(눈금선 위 왼쪽) 3~4개 + 아래 날짜 3개.
// 카드 남는 높이를 채우도록 선·눈금선은 늘어나는 SVG(viewBox 0~100, preserveAspectRatio none)이고,
// 글자는 늘어나지 않게 HTML 로 같은 % 위치에 둔다. 값은 cbInvestTrend 의 점 그대로다(새 계산 없음).
function cbTrendChartHtml(pts){
  const vs=pts.map(p=>p.v), mn=Math.min(...vs), mx=Math.max(...vs);
  const span=(mx-mn)||Math.max(Math.abs(mx)*0.02,10000);
  const step=cbNiceStep(span*1.3/3);
  const lo=Math.floor((mn-span*0.15)/step)*step, hi=Math.ceil((mx+span*0.15)/step)*step;
  const ticks=cbAxisTicks(lo,hi,step), rng=(hi-lo)||1;
  const yPct=v=>(hi-v)/rng*100, xPct=k=>(pts.length>1?k/(pts.length-1):0)*100;
  const d=pts.map((p,k)=>`${k?'L':'M'}${xPct(k).toFixed(2)},${yPct(p.v).toFixed(2)}`).join('');
  const last=pts[pts.length-1], mid=Math.floor((pts.length-1)/2);
  const md=p=>{const [,m,dd]=p.date.split('-'); return `${+m}/${+dd}`;};
  const xs=[[0,'is-first'],[mid,''],[pts.length-1,'is-last']].filter((x,n,a)=>a.findIndex(y=>y[0]===x[0])===n);
  window._cbTrendPts=pts.map((p,k)=>({date:p.date,v:p.v,x:xPct(k),y:yPct(p.v)}));
  return `<span class="cb-trend-chart">`
    // 눈금 칸 폭은 가장 긴 눈금 글자가 정한다(보이지 않는 자리 잡기 글자) — 글자는 그래프 밖 왼쪽 칸에 선다.
    +`<span class="cb-trend-y" aria-hidden="true"><b class="cb-trend-y-sizer">${ticks.map(v=>cbAmtAxisLab(v,step)).sort((a,b)=>b.length-a.length)[0]||''}</b>${ticks.map(v=>`<span style="top:${yPct(v).toFixed(2)}%">${cbAmtAxisLab(v,step)}</span>`).join('')}</span>`
    +`<span class="cb-trend-plot" onmousemove="cbTrendHover(event)" onmouseleave="cbTrendHover(null)"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">`
    +ticks.map(v=>`<line x1="0" x2="100" y1="${yPct(v).toFixed(2)}" y2="${yPct(v).toFixed(2)}" class="cb-trend-grid" vector-effect="non-scaling-stroke"/>`).join('')
    +`<path d="${d}L100,100L0,100Z" class="cb-trend-area"/><path d="${d}" class="cb-trend-line" vector-effect="non-scaling-stroke"/></svg>`
    +`<i class="cb-trend-dot" style="left:${xPct(pts.length-1)}%;top:${yPct(last.v).toFixed(2)}%"></i>`
    // 마우스를 올리면 가장 가까운 날의 세로선·점·설명 상자(cbTrendHover). 값은 위 점 그대로다.
    +`<i class="cb-trend-guide" hidden></i><i class="cb-trend-hdot" hidden></i><span class="cb-trend-tip" hidden></span></span>`
    +`<span class="cb-trend-x" aria-hidden="true">${xs.map(([k,c])=>`<span class="${c}" style="left:${xPct(k).toFixed(2)}%">${md(pts[k])}</span>`).join('')}</span>`
    +`</span>`;
}
// 홈 30일 그래프 hover — 마우스 x 에 가장 가까운 날의 날짜·금액·전날 대비·첫날 대비를 그래프 안 상자에 보인다(새 계산 없음).
function cbTrendIdx(pts, frac){
  if(!pts||!pts.length) return -1;
  let best=0, bd=Infinity;
  pts.forEach((p,k)=>{ const d=Math.abs(p.x-frac*100); if(d<bd){bd=d;best=k;} });
  return best;
}
function cbTrendHover(ev){
  const plot=ev?ev.currentTarget:document.querySelector('.cb-trend-plot');
  if(!plot) return;
  const guide=plot.querySelector('.cb-trend-guide'), dot=plot.querySelector('.cb-trend-hdot'), tip=plot.querySelector('.cb-trend-tip');
  const pts=window._cbTrendPts;
  if(!ev||!pts||!pts.length){ [guide,dot,tip].forEach(n=>n&&(n.hidden=true)); return; }
  const r=plot.getBoundingClientRect(); if(!r.width) return;
  const k=cbTrendIdx(pts, Math.min(1,Math.max(0,(ev.clientX-r.left)/r.width)));
  const p=pts[k], prev=k>0?pts[k-1]:null, first=pts[0];
  const [,m,d]=p.date.split('-');
  const diff=(label,base)=>`<span>${label} <b class="cb-num" style="${cbGainStyle(p.v-base,false)}">${cbSignDisp(p.v-base)}</b></span>`;
  tip.innerHTML=`<em>${+m}월 ${+d}일</em><b class="cb-num">${cbDisp(p.v)}</b>`
    +(prev?diff('전날보다',prev.v):'')
    +(k>1?diff(`${+first.date.slice(5,7)}/${+first.date.slice(8)}보다`,first.v):'');
  guide.style.left=dot.style.left=p.x+'%'; dot.style.top=p.y+'%';
  // 상자는 점을 가리지 않게 세로선 옆(오른쪽 절반이면 왼쪽)에, 점이 위쪽이면 아래에 둔다.
  tip.classList.toggle('is-low',p.y<50);
  [guide,dot,tip].forEach(n=>n.hidden=false);
  const W=r.width, tw=tip.offsetWidth, px=p.x/100*W;
  let left=px+12; if(left+tw>W) left=px-12-tw;
  tip.style.left=Math.max(0, Math.min(W-tw, left))+'px';
}
function cbRenderDash(){
  cbEnsureDivHist();
  const el = document.getElementById('cb-cdash'); if(!el) return;
  const ownerF = (_cdashOwner && _cdashOwner!=='전체') ? _cdashOwner : null;
  const rows = ownerF ? cbAllRows().filter(r=>r.i.owner===ownerF) : cbAllRows();
  const nw = rows.reduce((s,r)=>s+r.val,0);
  const gainAbs = rows.reduce((s,r)=>s+r.gain,0);
  // 평가손익 % 의 분모는 보유 목록 숫자 카드와 같은 '매입금액(현금·취득가 미상 제외)'이다.
  // 예전에는 현금 예수금까지 더해 같은 손익이 홈 28.8% · 보유 목록 35.4% 로 갈렸다.
  const costTot = rows.reduce((s,r)=>s+(r.i.grp==='현금'||r.i.costUnknown?0:r.cost),0) || 1;
  const divAnnual = rows.reduce((s,r)=>s+cbDivIncomeKRW(r.i),0);
  // 로딩 화면이 시세까지만 기다리므로(2026-11-20 8차) 배당 조회가 끝나기 전에 홈이 보일 수 있다 — 그동안은 '확인 중'이라고 밝힌다.
  const divPending = cbSnapDivCoverage(rows).status==='pending';
  const risk = cbRisk(ownerF);

  // 자산 배분 (도넛/범례 클릭 → 해당 자산군 종목 펼침)
  const byCls={}; rows.forEach(r=>{ byCls[r.cls]=(byCls[r.cls]||0)+r.val; });
  const alloc = Object.keys(CB_CLS).filter(k=>byCls[k]).map(k=>({
    key:k, label:CB_CLS[k].label, color:CB_CLS[k].color, v:byCls[k],
    pct: nw? byCls[k]/nw*100 : 0 }));
  // 평면 도넛과 목록은 큰 순서로 그린다 — 조각 순서와 목록 순서가 같아야 눈으로 짝을 찾는다.
  const allocBySize = alloc.slice().sort((a,b)=>b.v-a.v);
  const allocTotal = alloc.reduce((sum,c)=>sum+c.v,0);
  const allocSel = alloc.find(c=>c.key===_cdashAllocOpen) || null;

  // 섹터 (가상화폐는 'Crypto'로 별도 분류해 비중 표기)
  const secs = cbSectors(true, ownerF).list.slice(0,8);
  _cdashSecList = secs.map(s=>s.label);

  // 팝업 목록 공통 행 (자산군/섹터 클릭 시 노출되는 종목)
  const miniRow = (r, baseV) => `
    <div style="display:flex;align-items:center;gap:8px;padding:4px 10px 4px 24px;font-size:var(--fs-cap)">
      <i class="cb-owner-dot" style="background:${cbOwnerColor(r.i.owner)}"></i>
      <span class="cb-tip-block" data-overflow-tip="${cbEsc(r.title)}" style="flex:1;min-width:0">
        <span data-overflow-watch style="display:block;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(r.cls==='us'?cbStrip(r.i.tkr):r.title)} <span style="color:var(--dim)">· ${cbEsc(r.i.owner)}</span></span>
      </span>
      <span style="font-weight:600;flex-shrink:0">${cbDisp(r.val)}</span>
      <span class="cb-num" style="width:46px;text-align:right;font-weight:700;color:var(--lab);flex-shrink:0">${baseV>0?(r.val/baseV*100).toFixed(1):'0.0'}%</span>
    </div>`;

  // 동일 소유주+종목(다계좌) 합산 → 검색 필터 → 정렬 (소유주 → 종목명 → 평가금액 오름차순)
  const mergedRows = cbMergeRows(rows);
  // 자산 배분·섹터 아코디언도 아래 표와 같은 '병합된' 목록을 써야 한다. 병합 전 rows 로
  // 그리면 같은 종목을 ISA·일반 두 계좌에 나눠 가진 경우 펼침 목록에만 두 줄이 떠서
  // 표 머리의 'N종목'과 개수가 어긋난다.
  const mergedByVal = mergedRows.slice().sort((a,b)=>b.val-a.val);
  const q=(_cdashQ||'').trim().toLowerCase();
  const filtered = q ? mergedRows.filter(r=>((r.i.tkr||'')+' '+(r.i.name||'')+' '+r.cl.label+' '+(r.i.owner||'')).toLowerCase().includes(q)) : mergedRows;
  const held = cbSortOwnerNameVal(filtered);
  // 시세 미조회 종목은 기여 순위에서 빼되 그 개수를 카드 아래에 적는다(예전엔 아무 설명 없이 사라졌다 — 액면병합된 BMNU).
  // 수익률 순위가 작은 보유액을 과대평가하지 않도록 실제 원화 평가손익의 절대 기여도를 별도로 비교한다.
  // 평가손익 타일 지도의 대상: 현금·시세 미조회는 뺀다(아래 요약과 같은 기준).
  const contribStale = mergedRows.filter(r=>r.i.grp!=='현금' && cbRowPriceStale(r)).length;
  // 합계도 목록과 같은 stale 제외를 적용한다 — 안 그러면 목록엔 없는 시세 미조회
  // 종목의 손익이 상단 '이익/손실 기여' 배지에는 섞여 두 숫자가 서로 다른 기준이 된다.
  const contributionEligible = mergedRows.filter(r=>r.i.grp!=='현금' && !cbRowPriceStale(r));
  const contributionGain = contributionEligible.reduce((s,r)=>s+Math.max(0,r.gain||0),0);
  const contributionLoss = contributionEligible.reduce((s,r)=>s+Math.min(0,r.gain||0),0);
  // 평가손익 기여 순위(2026-11-23): 이익·손실 같은 수(6개씩) 막대. 한쪽 종목이 모자라면 그 사실을 한 줄로 적는다.
  const cr=cbContribRank(contributionEligible);
  const crShort=(list,label)=>list.length&&list.length<Math.max(cr.gains.length,cr.losses.length)?`<li class="cb-contrib-short">${label} 종목은 이 ${list.length}개뿐입니다</li>`:'';
  const contribNet=contributionGain+contributionLoss;
  const crRow=r=>{
    const up=r.gain>0, dup=contributionEligible.filter(x=>x.title===r.title).length>1;
    const name=(r.cls==='us'?(cbStrip(r.i.tkr)||r.title):r.title)+(dup&&r.i.owner?` · ${r.i.owner}`:'');
    return `<li class="cb-contrib-row ${up?'is-up':'is-dn'}" data-tip="${cbEsc(r.title)} · ${cbEsc(r.i.owner||'')} · ${cbEsc(cbSignDisp(r.gain))}">`
      +`<span class="cb-contrib-name">${cbEsc(name)}</span>`
      +`<span class="cb-contrib-track"><i style="width:${(Math.abs(r.gain)/cr.max*100).toFixed(1)}%"></i></span>`
      +`<b class="cb-num">${cbTaxAxisLab(Math.round(r.gain))}</b></li>`;
  };
  const contributionCard = `
    <div class="cb-panel cb-dash-contrib-card">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:7px">
        <span data-tip="평가손익(원화)이 큰 종목 순서입니다. 이익과 손실을 같은 수(최대 6개씩) 보여 주고, 막대 길이는 목록 안에서 가장 큰 금액 대비입니다. 현금과 시세 미조회 종목은 뺍니다." class="cb-panel-title">평가손익 기여 TOP</span>
        <span style="font-size:var(--fs-cap);color:var(--dim);white-space:nowrap">${ownerF?cbEsc(ownerF):'전체 소유주'}</span>
      </div>
      <div class="cb-contrib-summary is-inline">
        <span title="${cbEsc(cbSignDisp(contributionGain))}">이익 기여 <b class="cb-num" style="${cbUpDn(contributionGain)}">${cbTaxAxisLab(contributionGain)}</b></span>
        <span title="${cbEsc(contributionLoss<0?cbDisp(contributionLoss):cbDisp(0))}">손실 기여 <b class="cb-num" style="${cbUpDn(contributionLoss)}">${cbTaxAxisLab(contributionLoss)}</b></span>
      </div>
      ${cr.gains.length||cr.losses.length?`<ol class="cb-contrib-list" aria-label="종목별 평가손익 순위">${cr.gains.map(crRow).join('')}${crShort(cr.gains,'이익')}${cr.losses.length?`<li class="cb-contrib-sep" aria-hidden="true"></li>${cr.losses.map(crRow).join('')}${crShort(cr.losses,'손실')}`:''}</ol>
      <div class="cb-contrib-foot">순손익 <b class="cb-num" style="${cbGainStyle(contribNet,false)}">${cbSignDisp(contribNet)}</b>${cr.more?` · 그 밖 ${cr.more}종목`:''}${contribStale?` · 시세 미조회 ${contribStale}종목 제외`:''}</div>`
      :'<div style="margin:auto;text-align:center;color:var(--dim);font-size:var(--fs-cap)">평가손익 데이터가 없습니다</div>'}
    </div>`;
  // 투자자산 · 최근 30일 — 예전 '수익률 × 평가손익' 점 그림 자리. 이미 매일 기록되는 투자자산 일별 기록을 그대로 그린다.
  const trend=cbInvestTrend(window._netWorthHistory, ownerF);
  const trendCard = `
    <button type="button" class="cb-panel cb-dash-trend-card" onclick="switchView('perf2')" aria-label="투자자산 최근 30일 추이 — 누르면 성과 화면">
      <span style="display:flex;align-items:baseline;justify-content:space-between;gap:7px">
        <span class="cb-panel-title">투자자산 · 최근 30일</span>
        <span style="font-size:var(--fs-cap);color:var(--dim);white-space:nowrap">${ownerF?cbEsc(ownerF):'전체 소유주'} ›</span>
      </span>
      ${trend?`<b class="cb-dash-trend-value cb-num">${cbDisp(trend.last.v)}</b>
      <span class="cb-dash-trend-sub">${cbEsc(trend.first.date.slice(5).replace('-','/'))}보다 <b class="cb-num" style="${cbGainStyle(trend.change,false)}">${cbSignDisp(trend.change)}${trend.pct!=null?` (${cbPct(trend.pct)})`:''}</b></span>
      ${cbTrendChartHtml(trend.pts)}
      <span class="cb-dash-trend-note">입금·출금도 함께 섞인 금액 변화라 수익률이 아닙니다 · ${trend.pts.length}일 기록</span>`
      :'<span style="margin:auto;text-align:center;color:var(--dim);font-size:var(--fs-cap)">기록이 이틀 이상 쌓이면 추이를 보여 드립니다</span>'}
    </button>`;
  let dayAbs=0, dayBase=0;
  rows.forEach(r=>{ const i=r.i;
    if((i.grp==='주식'||i.grp==='가상화폐') && i.dayP!=null && i.prevP>0 && !i._priceStale){
      const rt=cbRate(i.cur); dayAbs+=(i.qty||0)*i.dayP*rt; dayBase+=(i.qty||0)*i.prevP*rt;
    }
  });

  // 홈 합계는 투자자산이며 부동산과 부채를 포함한 순자산과 구분한다.
  cbSetHead(`${ownerF?cbEsc(ownerF)+' 투자자산':'가족 투자자산'} · <span data-tip="주식·가상화폐·금·현금 평가액 합계입니다. 부동산·기타 자산과 부채는 포함하지 않습니다.">전일 종가 기준</span>`,cbOwnerBtns(_cdashOwner,'cbDashOwner'));

  // 요약 배지 — 라벨(작은 글씨)이 옆 원화 금액의 세로 중앙에 오도록 inline-flex 정렬
  // 숫자 카드 — 예전 작은 배지 4개와 같은 값이다(새 계산 없음). 총액만 강조 카드이고
  // 나머지는 눌러서 해당 화면으로 가는 진짜 button 이다(소유주 범위는 navPrepare 가 이어 준다).
  const kpi=(label,value,valStyle,sub,view)=>`<button type="button" class="cb-dash-kpi" onclick="switchView('${view}')">
      <span class="cb-dash-kpi-label">${label}<span class="cb-dash-kpi-go" aria-hidden="true">›</span></span>
      <b class="cb-dash-kpi-value" style="${valStyle||''}">${value}</b>
      <span class="cb-dash-kpi-sub">${sub}</span></button>`;
  const checks=cbDashChecks(ownerF, mergedRows);

  el.innerHTML = `
    ${checks.length?`<div class="cb-dash-checks" role="status"><b>확인 필요 ${checks.length}</b>${checks.map((c,n)=>`<button type="button" onclick="cbDashCheckGo(${n})">${cbEsc(c.label)} ›</button>`).join('')}</div>`:''}
    <div class="cb-dash-kpis">
      <div class="cb-dash-kpi is-total">
        <span class="cb-dash-kpi-label"><span data-tip="주식·가상화폐·금·현금 평가액 합계입니다. 부동산·기타 자산과 부채는 포함하지 않습니다.">투자자산 총액</span></span>
        <b class="cb-dash-kpi-value">${cbDisp(nw)}</b>
        <span class="cb-dash-kpi-sub">${mergedRows.length}종목 · 전일 종가 기준</span>
      </div>
      ${kpi('<span data-tip="전일 종가 대비 오늘 하루 평가액 변동 (시세 연동된 주식·가상화폐 기준)">오늘 손익</span>',
        dayBase>0 ? cbSignDisp(dayAbs) : '—', dayBase>0 ? cbUpDn(dayAbs) : 'color:var(--lab)',
        dayBase>0 ? cbPct(dayAbs/dayBase)+' · 전일 대비' : '시세 연동 종목 없음', 'perf2')}
      ${kpi('<span data-tip="현재 평가액 − 매입금액. 현금과 취득가 미상 자산은 빼고 계산합니다(보유 목록과 같은 기준).">평가손익</span>', cbSignDisp(gainAbs), cbUpDn(gainAbs), cbPct(gainAbs/costTot)+' · 매입금액 대비', 'holdings')}
      ${kpi('연 배당', cbDisp(divAnnual), '', divPending?'배당 정보 확인 중 …':'월평균 '+cbDisp(divAnnual/12), 'divm')}
      ${kpi('리스크', risk.score+'점', '', cbEsc(risk.grade)+(risk.warns?` · 주의·경고 ${risk.warns}개`:''), 'risk2')}
    </div>

    <div class="cb-dash-insight-grid">
      <div class="cb-panel" style="min-width:0;padding:16px 18px">
        <div class="cb-panel-title" style="margin-bottom:10px">자산 배분 <span style="color:var(--dim)">· 누르면 종목 창</span></div>
        <div class="cb-alloc-donut">${cbDonutSvg(allocBySize,190,'cbDashAllocToggle',0.15)}<div class="cb-alloc-center">${allocSel
          ? `<small>${cbEsc(allocSel.label)}</small><b>${allocSel.pct.toFixed(1)}%</b><small class="cb-num">${cbDisp(allocSel.v)}</small>`
          : `<small>투자자산</small><b class="cb-num">${cbDisp(allocTotal)}</b><small>${alloc.length}개 자산군</small>`}</div></div>
        ${allocBySize.map(c=>{
          const open = _cdashAllocOpen===c.key;
          return `
          <div class="cb-hrow cb-home-allocation-row" role="button" tabindex="0" aria-haspopup="dialog" data-alloc-key="${c.key}" onclick="cbDashAllocToggle('${c.key}')"${open?' data-open="1"':''}>
            <i style="background:${c.color}"></i>
            <span>${c.label}</span>
            <span class="cb-num">${cbDisp(c.v)}</span>
            <b class="cb-num">${c.pct.toFixed(1)}%</b>
            <em>›</em>
          </div>`;
        }).join('')}
      </div>

      <div class="cb-panel cb-dash-sector-card" style="min-width:0;padding:16px 18px">
        <div class="cb-panel-title" style="margin-bottom:11px"><span data-tip="보유 주식을 섹터로 분류해 편중도를 점검합니다. 가상화폐는 Crypto로 별도 분류하며, 비중은 비중 차트와 동일하게 현금·금까지 포함한 전체 포트폴리오를 기준으로 계산합니다. 칸 넓이가 섹터 평가액이고 진할수록 비중이 큽니다.">섹터 집중도</span> <span style="color:var(--dim)">· 칸을 누르면 종목 창</span></div>
        ${(()=>{
          // 섹터 타일 지도(2026-11-18 2차): 칸 넓이 = 섹터 평가액(비중 분모는 기존대로 전체 포트폴리오),
          // 색은 한 색이고 비중이 클수록 진하다(예전 '한 색 막대, 1위만 진하게'의 연장). 칸을 누르면 아래에 종목 목록.
          if(!secs.length) return '<div style="font-size:var(--fs-cap);color:var(--dim)">주식·가상화폐 자산이 없습니다</div>';
          const SW=300, SH=280, maxV=Math.max(...secs.map(x=>x.v),1);
          const tiles=cbTreemapLayout(secs.map((x,n)=>({x0:x,n,a:x.v})),0,0,SW,SH);
          return `<div class="cb-tilemap is-sector">${tiles.map(t=>{
              const on=_cdashSecOpen===t.x0.label, name=cbSectorName(t.x0.label);
              return cbTileHtml(t,SW,SH,{cls:'is-sec'+(on?' is-open':''),attrs:` role="button" tabindex="0" aria-haspopup="dialog" data-sec-n="${t.n}" onclick="cbDashSecToggle(${t.n})"`,
                color:'var(--acc)',mix:12+40*Math.sqrt(t.x0.v/maxV),name,value:t.x0.pct.toFixed(1)+'%',
                tip:`${name} · ${t.x0.pct.toFixed(1)}% · ${cbDisp(t.x0.v)} · 누르면 종목 보기`});
            }).join('')}</div>`;
        })()}
      </div>

      ${contributionCard}
      ${trendCard}
    </div>
    ${cbHomeHoldings(held)}
    ${(()=>{
      // 자산군·섹터 종목 창(2026-11-23, 사용자 결정 — 카드 안에서 아래로 펼치던 목록을 대신한다).
      // 바깥을 누르거나 Esc·닫기 버튼으로 닫는다. 안에서 누른 채 끌고 나온 경우는 닫지 않는다(_cdashPopDown).
      const sec=secs.find(x=>x.label===_cdashSecOpen);
      const pop=allocSel ? {title:allocSel.label,color:allocSel.color,pct:allocSel.pct,v:allocSel.v,items:mergedByVal.filter(r=>r.cls===allocSel.key)}
        : sec ? {title:cbSectorName(sec.label),color:'var(--acc)',pct:sec.pct,v:sec.v,items:mergedByVal.filter(r=> sec.label==='Crypto' ? r.cls==='crypto'
            : (r.i.grp==='주식' && ((typeof _gicsSector==='function' ? _gicsSector(r.i) : '기타') || '기타')===sec.label))} : null;
      if(!pop) return '';
      return `<div class="modal-overlay active cb-dash-pop-overlay" id="cb-dash-pop">
        <div class="modal-content cb-dash-pop" role="dialog" aria-modal="true" aria-labelledby="cb-dash-pop-title">
          <div class="cb-dash-pop-head"><i style="background:${pop.color}"></i><b id="cb-dash-pop-title">${cbEsc(pop.title)}</b><span>${pop.pct.toFixed(1)}% · ${cbDisp(pop.v)} · ${pop.items.length}종목</span>
            <button type="button" class="modal-close cb-dash-pop-close" onclick="cbDashPopClose()" aria-label="닫기">×</button></div>
          <div class="cb-dash-pop-list">${pop.items.length?pop.items.map(r=>miniRow(r,pop.v)).join(''):'<div class="cb-dash-pop-empty">종목이 없습니다</div>'}</div>
          <div class="cb-dash-pop-foot">비중은 ${cbEsc(pop.title)} 평가액 대비 · 바깥을 누르거나 Esc 로 닫기</div>
        </div></div>`;
    })()}`;
}
// Mobile summaries keep the important values visible; details expand in place.
function cbMobileHoldings(rows,query=_cdashQ,onSearch='cbDashSearch'){
  return '<section class="cb-mobile-holdings cb-panel"><h3>보유 자산 내역 <small>'+rows.length+'종목</small></h3><label class="sr-only" for="cb-mobile-search">보유 종목 검색</label><input id="cb-mobile-search" type="search" placeholder="티커·종목명 검색…" value="'+cbEsc(query)+'" oninput="'+onSearch+'(this.value)"><div class="cb-mobile-holdings-labels"><span>종목</span><span>평가금액 · 수익률</span></div>'+rows.map(r=>{
    const qty=r.i.grp==='현금'?'예수금':Number(r.qty||0).toLocaleString('ko-KR',{maximumFractionDigits:6})+(r.i.grp==='가상화폐'?'개':r.i.unit||'주');
    return `<details class="cb-mobile-holding"><summary><span class="cb-mobile-asset"><b>${cbEsc(r.title)}</b><small>${cbEsc(r.i.owner)} · ${cbEsc(r.subTitle||r.cl.label)}</small></span><span class="cb-mobile-value"><b>${cbDisp(r.val)}</b><small style="${cbGainStyle(r.gainPct,r.gainPct==null)}">${r.gainPct==null?'—':cbPct(r.gainPct)} <span aria-hidden="true">⌄</span></small></span></summary><dl><div><dt>보유수량</dt><dd>${cbEsc(qty)}</dd></div><div><dt>평균단가</dt><dd>${r.i.grp==='현금'?'—':r.i.costUnknown?'취득가 미상':cbFmtNative(r.avgNative,r.i.cur)}</dd></div><div><dt>현재가</dt><dd>${r.i.grp==='현금'?'—':cbFmtNative(r.i.curP,r.i.cur)}</dd></div><div><dt>평가손익</dt><dd style="${cbGainStyle(r.gain,r.i.costUnknown||r.i.grp==='현금')}">${r.i.grp==='현금'?'—':r.i.costUnknown?'산정 제외':cbSignDisp(r.gain)}</dd></div></dl></details>`;
  }).join('')+(rows.length?'':'<p class="fin-empty">검색 결과가 없습니다.</p>')+'</section>';
}
function cbHomeSummary(sel,nw){
  let selPanel = '<div style="font-size:var(--fs-cap);color:var(--dim);text-align:center;padding:28px 8px">좌측 목록에서 종목을 클릭하면<br>상세 정보가 여기 표시됩니다.</div>';
  if (sel){
    const d = cbDivOf(sel.i);
    const divState = cbDividendStatus(sel.i);
    const g = cbDivGrowth(sel.i);
    const sector = sel.i.grp==='주식' ? (typeof _gicsSector==='function'? _gicsSector(sel.i):'—') : sel.cl.label;
    const yoc = (d && !sel.i.costUnknown && sel.avgNative>0 && sel.i.grp!=='가상화폐') ? ((d.annualDps/sel.avgNative)*100).toFixed(2) : null;
    const selDivKRW = d ? d.annualDps * sel.qty * cbRate(d.cur || sel.i.cur) : 0;
    const acctTxt = sel.acctList.length ? sel.acctList.join('+') : (sel.i.acc||'');
    const qtyTxt = sel.i.grp==='현금' ? '예수금'
      : Number(sel.qty||0).toLocaleString(undefined,{maximumFractionDigits:4}) + (sel.i.grp==='가상화폐'?'개':sel.i.unit||'주');
    const divBox = d ? `
      <div style="display:flex;flex-direction:column;gap:5px;font-size:var(--fs-cap)">
        <div style="display:flex;justify-content:space-between"><span style="color:var(--mut)">연간 배당수입</span><span style="font-weight:700;color:var(--up)">${cbDisp(selDivKRW)}</span></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--mut)"><span data-tip="현재 주가 대비 연간 배당금 비율">시가 수익률</span> / <span data-tip="Yield on Cost — 내 평단가 대비 연간 배당금 비율. 오래 보유할수록 높아집니다.">YoC</span></span><span style="font-weight:700">${(d.yldNum||0).toFixed(2)}% / ${yoc!=null?yoc+'%':'—'}</span></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--mut)"><span data-tip="최근 배당 이력 기준 주당 배당금의 연평균 성장률(CAGR)">배당성장률</span></span><span style="font-weight:700;${g!=null?cbUpDn(g):''}">${g!=null?(g>=0?'+':'')+g.toFixed(1)+'%':'—'}</span></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--mut)">주당 배당 · 주기</span><span class="cb-num" style="font-weight:700">${cbFmtNative(d.annualDps,d.cur||sel.i.cur)} · ${cbEsc(d.cycle||'—')}</span></div>
      </div>`
      : `<div class="cb-div-status ${divState.state}" role="status">${cbEsc(divState.text)}</div>`;
    const cell = (lab,val,style='',cls='',outerStyle='') => `<div style="${outerStyle}"><div style="font-size:var(--fs-cap);color:var(--lab)">${lab}</div><div class="${cls}" style="font-size:var(--fs-card);font-weight:700;margin-top:1px;${style}">${val}</div></div>`;
    selPanel = `
      <div style="display:flex;align-items:flex-start;gap:8px">
        <span style="flex-shrink:0;margin-top:1px">${cbFlagSvg(sel, 18)}</span>
        <div style="min-width:0;flex:1">
          <div class="cb-tip-block" data-overflow-tip="${cbEsc(sel.i.name||sel.i.tkr)}"><span data-overflow-watch style="display:block;font-size:var(--fs-card);font-weight:800;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(sel.i.name||sel.i.tkr)}</span></div>
          <div class="cb-tip-block" data-overflow-tip="${cbEsc([sel.tkr,sel.cl.label,sel.i.owner,acctTxt].filter(Boolean).join(' · '))}"><span data-overflow-watch style="display:block;font-size:var(--fs-cap);color:var(--lab);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(sel.tkr)} · ${sel.cl.label} · ${cbEsc(sel.i.owner)}${acctTxt?' · '+cbEsc(acctTxt):''}</span></div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 12px;margin-top:12px">
        ${cell('평가액', cbDisp(sel.val))}
        ${cell('평가손익', sel.i.grp==='현금'?'—':(sel.i.costUnknown?'산정 제외':cbSignDisp(sel.gain)), sel.i.costUnknown?'color:var(--lab)':cbUpDn(sel.gain))}
        ${cell('보유수량', qtyTxt, 'font-size:var(--fs-body)', 'cb-num')}
        ${cell('<span data-tip="보유 수량 전체의 평균 매수 단가(가중평균)">평단가</span>', sel.i.grp==='현금'?'—':(sel.i.costUnknown?'취득가 미상':cbFmtNative(sel.avgNative,sel.i.cur)), '', 'cb-num')}
        ${cell('현재가', sel.i.grp==='현금'?'—':cbFmtNative(sel.i.curP,sel.i.cur), '', 'cb-num')}
        ${cell('수익률', sel.gainPct==null?'—':cbPct(sel.gainPct), sel.gainPct==null?'color:var(--lab)':cbUpDn(sel.gainPct))}
        ${cell('<span data-tip="현재 선택한 소유주 포트폴리오에서 이 종목의 평가액이 차지하는 비중">포트폴리오 비중</span>', (nw>0?sel.val/nw*100:0).toFixed(1)+'%')}
        ${cell('섹터', cbEsc(cbSectorName(sector)), 'font-size:var(--fs-cap);font-weight:600;white-space:nowrap', '', 'grid-column:1/-1')}
      </div>
      <div style="margin-top:13px;padding-top:11px;border-top:1px solid var(--bd)">
        <div class="cb-panel-title" style="margin-bottom:7px">배당 정보</div>${divBox}${d&&divState.state!=='ready'?`<p class="cb-div-status ${divState.state}">${cbEsc(divState.text)} · 이전 조회값 표시</p>`:''}
      </div>`;
  }

  return selPanel;
}
// 홈·구성원 비교 표가 함께 쓰는 정렬 값. 단가는 통화가 섞이므로 원화 환산(평가액·매입금액 ÷ 수량)으로 비교한다.
function cbOwnerRank(o){ const k=OWNERS.indexOf(o); return k<0?OWNERS.length:k; }
function cbHoldingSortGetters(){
  const unknown=r=>r.i.costUnknown||r.i.grp==='현금';
  const qty=r=>Number(r.qty??r.i.qty)||0;
  return {
    owner:r=>cbOwnerRank(r.i.owner), name:r=>r.title||r.i.name||r.i.tkr||'',
    acct:r=>[r.i.broker||'',r.i.acc||''].join(' '),
    qty:r=>r.i.grp==='현금'?null:qty(r),
    avg:r=>unknown(r)||!(qty(r)>0)?null:r.cost/qty(r),
    cur:r=>r.i.grp==='현금'||!(qty(r)>0)?null:r.val/qty(r),
    cost:r=>r.i.costUnknown?null:r.cost, val:r=>r.val, share:r=>r.val,
    gain:r=>unknown(r)?null:r.gain, pct:r=>r.gainPct==null?null:r.gainPct,
  };
}
// 홈 보유 표는 검색어가 없으면 지금 정렬의 처음 10줄만 보이고, '전체 N종목 보기'를 누르면 그 자리에서 아래로 펼친다
// (2026-11-20 사용자 결정 — 화면을 옮기지 않는다. 펼친 상태 _cdashShowAll 은 다른 화면으로 가면 cbResetViewState 가 접는다).
// 검색하면 맞는 것 전부. 선택은 보이는 줄 안에서만 하고, 비중 분모(nw)·막대 기준(maxVal)·숫자 카드는 그대로다.
const HOME_HOLDINGS_LIMIT=10;
let _cdashShowAll=false;
function cbHomeHoldings(rows){
  rows=cbSortRows('home',rows,cbHoldingSortGetters());
  const total=rows.length, searching=!!(_cdashQ||'').trim();
  const shown=searching||_cdashShowAll?rows:rows.slice(0,HOME_HOLDINGS_LIMIT);
  const canToggle=!searching&&total>HOME_HOLDINGS_LIMIT;
  const sel=shown.find(r=>r.key===_cdashSel)||shown[0]||null;
  _cdashSel=sel?.key||null;
  const nw=cbAllRows().filter(r=>_cdashOwner==='전체'||r.i.owner===_cdashOwner).reduce((sum,r)=>sum+r.val,0);
  const maxVal=Math.max(0,...rows.map(r=>r.val||0));
  // 선택은 행 전체가 받는다 — 예전에는 종목명을 감싼 button 만 눌렸고 티커·수량·금액 칸은 죽어 있었다.
  // 키는 data-key 로만 넘긴다(인라인 JS 문자열에 넣지 않는다). Enter·Space 는 script.js 의 문서 위임이
  // 처리하므로 인라인 onkeydown 을 붙이지 않는다 — 붙이면 이중 실행된다.
  const row=r=>`<tr class="${r.key===_cdashSel?'is-selected':''}" role="button" tabindex="0" aria-pressed="${r.key===_cdashSel}" data-key="${cbEsc(r.key)}" onclick="cbDashPick(this.dataset.key)">`
    +`<td>${cbOwnerTag(r.i.owner)}</td>`
    +`<td title="${cbEsc([r.title,cbStrip(r.i.tkr)].filter(Boolean).join(' · '))}"><span class="home-asset">${cbFlagCell(r, 24, 14)}<b>${cbEsc(r.title)}</b> <small>${cbEsc(cbStrip(r.i.tkr))}</small></span></td>`
    +`<td>${Number(r.qty||0).toLocaleString('ko-KR',{maximumFractionDigits:4})}</td>`
    // 취득가 미상은 cbCostKRW 가 0 을 돌려주므로 그대로 그리면 ₩0 이 찍힌다 — 평가손익 칸과 같은 가드를 쓴다.
    +`<td>${r.i.costUnknown?'—':cbDisp(r.cost)}</td>`
    +`<td data-live-key="${liveKeyOf(r.i,true)}">${cbDisp(r.val)}</td>`
    // 비중은 검색하지 않은 소유주 범위(nw) 기준, 막대 길이는 가장 큰 종목 대비
    +`<td class="home-weight"><span class="home-weight-bar" aria-hidden="true"><i style="width:${maxVal>0?Math.max(2,r.val/maxVal*100).toFixed(1):0}%;background:${CB_CLS[r.cls]?.color||'var(--acc)'}"></i></span>${nw>0?(r.val/nw*100).toFixed(1):'0.0'}%</td>`
    +`<td style="${cbGainStyle(r.gain,r.i.costUnknown||r.i.grp==='현금')}">${r.i.costUnknown||r.i.grp==='현금'?'—':cbSignDisp(r.gain)}</td>`
    +`<td style="${cbGainStyle(r.gainPct,r.gainPct==null)}">${r.gainPct==null?'—':cbPct(r.gainPct)}</td>`
    +`<td class="home-price-state">${r.i.grp==='현금'?'':cbRowPriceStale(r)?'<span class="home-price-dot is-stale" title="시세 미조회 · 직전 값으로 계산"></span><span class="sr-only">시세 미조회</span>':'<span class="home-price-dot" title="시세 정상"></span><span class="sr-only">시세 정상</span>'}</td></tr>`;
  return `<div class="home-holdings-layout">`
    +`<section class="cb-panel home-table-column"><div class="cb-dash-table-toolbar"><h3>보유 종목 <small data-tip="같은 소유주의 같은 종목은 계좌를 합쳐 한 줄로 보입니다.">${rows.length}개</small></h3>`
    +`<input type="search" aria-label="홈 보유 종목 검색" placeholder="종목명·티커·소유주 검색" value="${cbEsc(_cdashQ||'')}" oninput="cbDashSearch(this.value)"></div>`
    +`<div class="home-table-wrap${_cdashShowAll&&canToggle?' is-expanded':''}" id="home-holdings-wrap"><table><thead><tr>${[['owner','소유주','text'],['name','종목','text'],['qty','수량'],['cost','매입금액'],['val','평가액'],['share','비중'],['gain','평가손익'],['pct','수익률']].map(([k,l,t])=>`<th aria-sort="${cbAriaSort('home',k)}">${cbSortBtn('home',k,l,t)}</th>`).join('')}<th><span class="sr-only">시세 상태</span><span aria-hidden="true">시세</span></th></tr></thead>`
    +`<tbody>${shown.map(row).join('')||'<tr><td colspan="9">검색 결과가 없습니다.</td></tr>'}</tbody></table></div>`
    +(canToggle?`<button type="button" class="home-holdings-more" aria-expanded="${_cdashShowAll}" aria-controls="home-holdings-wrap" onclick="cbDashToggleAll()">${_cdashShowAll?`처음 ${HOME_HOLDINGS_LIMIT}종목만 보기 ▴`:`전체 ${total}종목 보기 ▾`}</button>`:'')
    +`</section>`
    +`<aside class="cb-panel home-stock-summary" aria-label="선택 종목 요약">${cbHomeSummary(sel,nw)}</aside></div>`;
}
function cbDashSearch(v){ _cdashQ=v; cbRenderDash();
  // 검색 입력 포커스 유지
  const inp=document.querySelector('#cb-cdash .cb-dash-table-toolbar input'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
function cbDashPick(key){ _cdashSel=key; cbRenderDash(); }
// 홈 보유 표 펼치기/접기 — 다시 그린 뒤 같은 버튼으로 포커스를 돌려준다.
function cbDashToggleAll(){
  _cdashShowAll=!_cdashShowAll; cbRenderDash();
  const run=()=>document.querySelector('#cb-cdash .home-holdings-more')?.focus();
  if(typeof requestAnimationFrame==='function') requestAnimationFrame(run); else run();
}
// 대시보드 소유주 필터 (전체/소유주) — 선택 종목은 초기화해 필터 결과 첫 종목으로 재선택
function cbDashOwner(o){ _cdashOwner=o; _cdashSel=null; _cdashAllocOpen=null; _cdashSecOpen=null; cbRenderDash(); cbRestoreFilterFocus('cb-head-widgets','data-owner',o); }
// 자산 배분 도넛/범례 클릭 → 해당 자산군 종목 창. 섹터 창과 동시에 열지 않는다.
let _cdashPopDown=false, _cdashPopReturn=null;
function cbDashPopFocus(){ const b=document.querySelector('#cb-dash-pop .cb-dash-pop-close'); if(b) b.focus(); }
function cbDashAllocToggle(key){
  _cdashPopReturn={attr:'data-alloc-key',value:key};
  _cdashAllocOpen = (_cdashAllocOpen===key ? null : key); _cdashSecOpen=null; cbRenderDash();
  if(_cdashAllocOpen) cbDashPopFocus();
}
// 섹터 집중도 타일 클릭 → 해당 섹터 종목 창 (인덱스 → 렌더 시점 라벨)
function cbDashSecToggle(n){
  const label = _cdashSecList[n]; if (label==null) return;
  _cdashPopReturn={attr:'data-sec-n',value:String(n)};
  _cdashSecOpen = (_cdashSecOpen===label ? null : label); _cdashAllocOpen=null;
  cbRenderDash();
  if(_cdashSecOpen) cbDashPopFocus();
}
// 바깥(어두운 바탕)을 누르면 닫는다 — 안에서 누른 채 끌고 나와 바깥에서 뗀 경우는 닫지 않는다(매수·매도 창과 같은 방식).
if(typeof document!=='undefined'&&typeof document.addEventListener==='function'){
  document.addEventListener('pointerdown',e=>{_cdashPopDown=!!e.target&&e.target.id==='cb-dash-pop';},true);
  document.addEventListener('click',e=>{if(e.target&&e.target.id==='cb-dash-pop'&&_cdashPopDown)cbDashPopClose();_cdashPopDown=false;});
}
// 창 닫기 — 바깥 클릭·Esc·닫기 버튼. 연 칸으로 키보드 포커스를 돌려준다.
function cbDashPopClose(){
  if(_cdashAllocOpen==null && _cdashSecOpen==null) return;
  _cdashAllocOpen=null; _cdashSecOpen=null; _cdashPopDown=false;
  cbRenderDash();
  const ret=_cdashPopReturn; _cdashPopReturn=null;
  if(ret) cbRestoreFilterFocus('cb-cdash',ret.attr,ret.value);
}

// 홈 '확인 필요' 줄 — 이미 다른 화면이 계산하는 경고를 개수로만 모은다(새 판정을 만들지 않는다).
// 할 일 목록이 아니다: 해당 경고가 하나도 없으면 줄 자체를 그리지 않는다.
// 소유주로 나눌 수 있는 항목(시세·리밸런싱·고정비)은 선택한 소유주 기준이고, 데이터 상태는 가구 공통이다.
let _cdashChecks=[];
function cbDashChecks(ownerF, mergedRows){
  const list=[];
  const stale=(mergedRows||[]).filter(r=>r.i.grp!=='현금' && cbRowPriceStale(r)).length;
  if(stale) list.push({key:'stale',label:`시세 미조회 ${stale}종목`,go:()=>switchView('holdings')});
  try{
    const ta=typeof finTargetAnalysis==='function'?finTargetAnalysis(ownerF):null;
    const th=Number(ta?.threshold)||0;
    // 리밸런싱 화면의 막대(finRebalBulletHtml)와 같은 '범위 밖' 기준: |편차| > 허용 편차
    const out=ta&&ta.total>0?ta.result.filter(x=>Math.abs(x.drift)>th).length:0;
    if(out) list.push({key:'rebal',label:`리밸런싱 범위 밖 ${out}개 자산군`,go:()=>switchView('rebal2')});
  }catch(e){}
  try{
    const pending=typeof finMonthlyFixedCost==='function'?finMonthlyFixedCost(ownerF).pendingCount:0;
    if(pending) list.push({key:'fixed',label:`미분류 자동이체 ${pending}건`,go:()=>{ switchView('cashflow'); if(typeof switchCashFlowSection==='function') switchCashFlowSection('fixed'); }});
  }catch(e){}
  try{
    // 시세 행은 위 '시세 미조회'가 이미 세므로 뺀다 — 같은 문제를 두 번 세지 않는다.
    const warn=typeof finDataStatusRows==='function'?finDataStatusRows().filter(x=>x.state==='warn'&&x.key!=='prices').length:0;
    if(warn) list.push({key:'data',label:`데이터 확인 ${warn}건`,go:()=>switchView('data2')});
  }catch(e){}
  _cdashChecks=list;
  return list;
}
function cbDashCheckGo(n){ const c=_cdashChecks[n]; if(c) c.go(); }

// ───────────────────────── 배당 조회 완결성 ─────────────────────────
// API가 무배당 종목도 "조회 완료"로 기록하므로 데이터 행 수가 아니라 verified 목록으로
// 현재 소유주 범위의 배당 요약이 완전한지 판정한다.
function cbSnapDivCoverage(rows){
  const tickers=[...new Set((rows||[])
    .filter(r=>r.i?.grp==='주식' && (r.i.qty||0)>0)
    .map(r=>cbStrip(r.i.tkr)).filter(Boolean))];
  if(!tickers.length) return {total:0,covered:0,missing:[],status:'complete',error:''};
  const live=window._divFetchCoverage||{};
  const announced=new Set([...(live.verified||[]),...(live.missing||[])].map(cbStrip));
  // 조회 범위가 현재 화면의 티커를 전부 다루지 못하면(예: 방금 추가한 종목) 완결성을
  // 판정할 근거가 없다. 이때 _divDataCache 키로 대신 세면 안 된다 — 그 캐시에는 배당이
  // 있는 종목만 들어 있어 무배당 종목이 통째로 '미확인'으로 잡히고, 이 함수가 애초에
  // 없애려던 오판(데이터 행 수로 판정)을 그대로 되풀이한다. 아직 모르면 '확인 중'이다.
  if(!live.status || live.status==='idle' || !tickers.every(t=>announced.has(t))){
    return {total:tickers.length,covered:0,missing:[],status:'pending',error:''};
  }
  const verified=new Set((live.verified||[]).map(cbStrip));
  const missing=tickers.filter(t=>!verified.has(t));
  return {
    total:tickers.length,
    covered:tickers.length-missing.length,
    missing,
    status:live.status,
    error:String(live.error||''),
  };
}
// 월별 배당 막대 — 요약 화면이라 읽기 전용이다.
// (배당 관리의 cbDivCalendarSvg 는 월 선택 상태·hover 전역과 얽혀 있어 여기서 재사용하지 않는다)

// ───────────────────────── 화면 렌더러는 pages/*.js ─────────────────────────
// 성과·구성원별·리스크·배당·증여·세금·적립식 화면은 pages/ 폴더로 옮겼다(2026-11-23, 동작 변경 없음).
// 아래 창 닫기 리스너는 적립식 설정 창과 보유 반영 창이 함께 쓰므로, 등록 순서를 지키려고 여기 그대로 둔다.
// 창 바깥(어두운 바탕)을 누르면 닫는다 — 안에서 누른 채 끌고 나온 경우는 닫지 않는다(매수·매도 창과 같은 방식).
let _cbModalDownOutside=null;
if(typeof document!=='undefined'&&typeof document.addEventListener==='function'){
  document.addEventListener('pointerdown',e=>{ const id=e.target&&e.target.id; _cbModalDownOutside=(id==='dca-modal'||id==='tax-hold-modal')?id:null; },true);
  document.addEventListener('click',e=>{
    const id=e.target&&e.target.id;
    if(id&&id===_cbModalDownOutside){ if(id==='dca-modal') cbDcaEditClose(); else if(typeof cbTaxHoldClose==='function') cbTaxHoldClose(); }
    _cbModalDownOutside=null;
  });
}
// ───────────────────────── 라우팅 통합 ─────────────────────────
function cbRerender(){
  // 오늘 투자자산 기록(메모리)을 지금 시세로 맞춘 뒤 그린다 — 홈 '최근 30일' 추이·성과 '투자자산 추이'의 마지막 점이
  // 홈 총액 카드와 같은 금액이어야 한다. 예전엔 자동 새로고침(10분)·환율 갱신 뒤에 기록이 그대로라 둘이 달랐다.
  // 저장은 하지 않는다(KV 의 오늘 값은 전체 새로고침·다음 접속 때 saveNetWorthSnapshot 이 같은 계산으로 덮는다).
  if (window._kvLoadState?.assets==='ready' && window._kvLoadState?.ext==='ready' && typeof updateNetWorthSnapshot==='function'){
    try{ updateNetWorthSnapshot(); }catch(e){ console.warn('[snapshot sync]', e); }
  }
  if (_cobaltActive && CB_VIEWS[_cobaltActive]){
    try{
      if(_cobaltActive==='sim2'&&document.getElementById('sim-result')){simUpdate();retUpdate();}
      else CB_VIEWS[_cobaltActive]();
    }catch(e){ console.error('[cobalt render]', e); }
  }
  cbSyncFeedStatus();
}
// 사이드바 푸터 상태 줄 — 데이터 상태 페이지의 요약을 그대로 보여준다.
// 확인이 필요한 항목이 있으면 점을 붉게 바꿔 페이지를 열어보게 만든다.
function cbSyncFeedStatus(){
  const fn=document.getElementById('feed-note'); if(!fn) return;
  const btn=document.getElementById('menu-data2');
  let warn=0, pending=0;
  if (typeof finDataStatusRows==='function'){
    try{
      const rows=finDataStatusRows();
      warn=rows.filter(x=>x.state==='warn').length;
      pending=rows.filter(x=>x.state==='pending').length;
    }catch(e){ warn=0; pending=0; }
  }
  // 아직 조회하지 않은 것(pending)은 오류가 아니다 — 부팅 직후 전부 붉게 켜지면
  // 진짜 오류가 묻히므로 실패(warn)일 때만 경고색을 쓴다.
  fn.textContent = warn ? `데이터 확인 필요 ${warn}건`
    : pending ? `데이터 확인 중 · ${pending}건 대기`
    : '전일 종가 연동 · ' + new Date().toLocaleTimeString('ko-KR',{hour:'numeric',minute:'2-digit'});
  if (btn){
    btn.classList.toggle('has-warning', warn>0);
    btn.classList.toggle('is-pending', warn===0&&pending>0);
  }
}

const _cbOrigSwitchView = switchView;
// 페이지에 '들어갈 때만' 순차 등장·막대 채움이 돌도록 잠깐 is-entering 을 붙인다.
// 시세 갱신(cbRerender)·필터·탭 전환은 이 클래스가 없을 때 다시 그려지므로 움직이지 않는다.
let _cbEnterTimer=null;
function cbMarkEntering(id){
  document.querySelectorAll('.view-section.is-entering').forEach(e=>e.classList.remove('is-entering'));
  const v=document.getElementById('view-'+id); if(!v) return;
  void v.offsetWidth; v.classList.add('is-entering');
  clearTimeout(_cbEnterTimer); _cbEnterTimer=setTimeout(()=>v.classList.remove('is-entering'),700);
}
// 숫자 카드의 큰 숫자를 0 에서 최종값까지 올린다(들어갈 때만). 통화 기호와 숫자는 같은 텍스트 노드에
// 둔 채 통째로 바꾼다 — 기호를 다른 요소로 떼면 금액 가리기(_maskAmountText)가 금액을 못 알아본다.
function cbCountUpParts(text){
  const m=String(text==null?'':text).match(/^(\D*?)(\d[\d,]*)(\.\d+)?(\D*)$/);
  if(!m) return null;
  const dec=m[3]?m[3].length-1:0, num=Number(m[2].replace(/,/g,'')+(m[3]||''));
  if(!Number.isFinite(num)||num===0) return null;
  return {pre:m[1], num, dec, post:m[4]};
}
function cbCountUpText(parts,p){
  const eased=1-Math.pow(1-Math.min(1,Math.max(0,p)),4);
  return parts.pre+(parts.num*eased).toLocaleString('en-US',{minimumFractionDigits:parts.dec,maximumFractionDigits:parts.dec})+parts.post;
}
const CB_COUNT_UP_MS=600;   // is-entering(700ms) 안에 끝난다
function cbCountUp(id){
  if(typeof requestAnimationFrame!=='function') return;
  if(typeof _amountPrivacyEnabled!=='undefined'&&_amountPrivacyEnabled) return;
  if(typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const v=document.getElementById('view-'+id); if(!v) return;
  const items=[];
  v.querySelectorAll('.cb-dash-kpi-value,.holdings-kpi>b').forEach(el=>{
    if(el.childNodes.length!==1||el.firstChild.nodeType!==3) return;
    const parts=cbCountUpParts(el.textContent); if(parts) items.push({el,parts,final:el.textContent});
  });
  if(!items.length) return;
  const t0=performance.now();
  const tick=now=>{
    const p=(now-t0)/CB_COUNT_UP_MS, done=p>=1||_amountPrivacyEnabled;
    let alive=false;
    items.forEach(x=>{ if(!x.el.isConnected) return; alive=true; x.el.textContent=done?x.final:cbCountUpText(x.parts,p); });
    if(alive&&!done) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
// 화면을 옮길 때만 지우는 화면 안 상태(표 정렬·달력에서 고른 날·펼친 계좌 등).
// 같은 화면을 다시 그릴 때(시세 갱신·소유주 변경)는 유지된다.
function cbResetViewState(){
  if (typeof _cbTaxHold!=='undefined') _cbTaxHold=null;   // 실현손익 '보유 반영' 선택 — 다른 화면에 갔다 오면 다시 고른다
  if (typeof _calDay!=='undefined') _calDay=null;
  if (typeof _acctOpen!=='undefined') _acctOpen=new Set();
  if (typeof _cbDivOpen!=='undefined') _cbDivOpen=new Set();   // 배당 표 펼친 줄
  if (typeof _cbGiftTab!=='undefined') _cbGiftTab='child';   // 가족 증여 자세히 보기 탭
  if (typeof _cbTaxMonthOpen!=='undefined') _cbTaxMonthOpen=null;   // 실현손익 내역 달 묶음 펼침
  if (typeof _finMcSel!=='undefined') _finMcSel=null;   // 목표 달성 확률 — 고른 목표(가정 수익률은 설정이라 둔다)
  if (typeof _cfBudgetEdit!=='undefined') _cfBudgetEdit=false;   // 현금 흐름 예산 입력 칸 — 저장 안 한 입력은 버린다
  if (typeof _finTsellOpen!=='undefined') _finTsellOpen.clear();   // 리밸런싱 '세금이 적은 순서' 펼친 자산군
  if (typeof _etfExpOwner!=='undefined') _etfExpOwner=null;   // ETF 속 종목 — 소유주 비중 창
  _cdashShowAll=false;   // 홈 보유 표 펼침
  _cdashAllocOpen=null; _cdashSecOpen=null;   // 홈 자산군·섹터 종목 창
  _cbTableSort={};
  if (typeof _sortState!=='undefined') _sortState={};   // 보유 목록 표 정렬(script.js)
}
switchView = function(id, btn){
  id=navResolve(id);
  // 로딩 중 다른 화면으로 가면 뼈대만 걷는다(진행 줄은 남는다). initDashboard 가 처음 여는 홈(cdash)은 제외.
  if (id!=='cdash' && typeof bootReveal==='function') bootReveal();
  const _prevView=document.querySelector('.view-section.active')?.id?.replace('view-','');
  if (_prevView && _prevView!==id) cbResetViewState();
  navPrepare(id);
  ['cb-perf-tip','cb-div-bar-tip','table-float-tip'].forEach(tipId=>{
    const tip=document.getElementById(tipId);
    if(tip){ tip.style.display='none'; tip._anchor=null; }
  });
  if (!CB_VIEWS[id]){
    // 레거시 화면도 Cobalt 페이지와 같이 제목 옆 소제목을 채운다 — 비어 있으면 헤더가 페이지마다 들쭉날쭉해 보인다.
    _cobaltActive=null; cbSetHead(CB_LEGACY_SUB[id] || null, null);
    _cbOrigSwitchView(id, btn);
    navSync(id);
    cbMarkEntering(id);
    cbCountUp(id);
    return;
  }
  _cobaltActive = id;
  try{ if (typeof closeSidebar==='function') closeSidebar(); }catch(e){}
  // 데이터 상태는 사이드바 푸터 버튼에서 열리므로 활성 표시 초기화 대상에 함께 넣는다.
  document.querySelectorAll('.menu-btn,.footer-status-btn').forEach(b=>{
    b.classList.remove('active');
    b.removeAttribute('aria-current');
  });
  const mbtn = btn || document.getElementById('menu-' + (id==='cdash' ? 'dashboard' : id));
  if (mbtn && mbtn.classList){ mbtn.classList.add('active'); mbtn.setAttribute('aria-current','page'); }
  document.querySelectorAll('.view-section').forEach(v=>v.classList.remove('active'));
  const v = document.getElementById('view-'+id); if(v) v.classList.add('active');
  cbMarkEntering(id);
  const title = document.getElementById('main-title'); if (title) title.textContent = CB_TITLES[id];
  ['owner-tabs-container','cf-owner-bar','bubble-owner-bar'].forEach(x=>{
    const e=document.getElementById(x); if(e) e.style.display='none';
  });
  if (id==='divm') cbVerifyDividendDataOnOpen();
  if (id==='perf2') cbVerifyPerfOwnersOnOpen();
  try{ CB_VIEWS[id](); }catch(e){ console.error('[cobalt render]', e); }
  cbCountUp(id);
  if(id==='etf2')etfRefreshOnOpen();
  navSync(id);
  if(typeof _recordViewHistory==='function') _recordViewHistory(id);
};

// 데이터 변경/갱신 시 활성 페이지 재렌더
const _cbOrigChangeOwner = changeOwner;
changeOwner = function(owner, btn){
  _cbOrigChangeOwner(owner, btn);
  cbRerender();
  const active=document.querySelector('.view-section.active')?.id.replace('view-','');
  const group=navGroup(active);if(group)document.getElementById('main-title').textContent=group.title;
};
// 자산 내역에서 추가/수정/삭제 → KV 저장이 일어나면 활성 페이지(대시보드 등)에 즉시 반영
const _cbOrigSaveAssets = saveAssetsToKV;
saveAssetsToKV = async function(){
  const r = await _cbOrigSaveAssets();
  // 자산 원장 저장 직후 오늘 스냅샷도 메모리에서 다시 계산해 요약 KPI와
  // 순자산 차트의 마지막 점이 서로 다른 금액을 가리키지 않게 한다.
  // 일부러 메모리만 갱신한다(saveNetWorthSnapshot 아님) — 자산을 고칠 때마다 ext_data 를
  // 쓰면 KV 개정번호가 불필요하게 튄다. KV 의 오늘 값은 다음 접속 때 initDashboard 의
  // saveNetWorthSnapshot() 이 원장에서 다시 계산해 덮으므로 스스로 맞춰진다.
  if(r?.ok && window._kvLoadState?.ext==='ready' && typeof updateNetWorthSnapshot==='function'){
    updateNetWorthSnapshot();
  }
  cbRerender();
  return r;
};
// 초기 KV 로드 완료 시에도 대시보드 재렌더 (시세 갱신 실패 시에도 보유 자산은 표시)
const _cbOrigLoadAssets = loadAssetsFromKV;
loadAssetsFromKV = async function(){
  let r;
  try{ r=await _cbOrigLoadAssets(); }
  catch(e){ r={ok:false,error:e?.message||'투자자산 원장 로드 실패'}; }
  if(typeof finMarkFresh==='function') finMarkFresh('assets','투자자산 원장','Vercel KV',r?.ok===true,r?.ok?(r.detail||`${(pfolioData||[]).length}개 항목 로드`):(r?.error||'로드 실패'));
  cbRerender();
  return r;
};
const _cbOrigLoadExt = loadExtDataFromKV;
loadExtDataFromKV = async function(){
  let r;
  try{ r=await _cbOrigLoadExt(); }
  catch(e){ r={ok:false,error:e?.message||'확장 데이터 로드 실패'}; }
  // 데이터 상태는 ext_data와 분리된 작은 KV 키에서 읽는다. 실패해도 핵심 재무 데이터 로드는 유지한다.
  if(typeof finLoadFreshnessFromKV==='function'){
    try{ await finLoadFreshnessFromKV(); }
    catch(e){ console.warn('[data freshness load]',e); }
  }
  if(typeof finMarkFresh==='function') finMarkFresh('ext','재무계획·현금흐름','Vercel KV',r?.ok===true,r?.ok?(r.detail||'확장 데이터 로드 완료'):(r?.error||'로드 실패'));
  cbRerender();
  return r;
};
const _cbOrigFetchDivData = fetchDivData;
fetchDivData = async function(...args){
  let r;
  try{ r=await _cbOrigFetchDivData(...args); }
  catch(e){ r={ok:false,error:e?.message||'배당 데이터 조회 실패'}; }
  if(typeof finMarkFresh==='function') finMarkFresh('dividends','배당 데이터','KRX · Yahoo · 네이버 증권',r?.ok===true,r?.ok?(r.detail||`${r?.count??Object.keys(window._divDataCache||{}).length}개 티커 캐시`):(r?.error||'조회 실패'));
  cbRerender();
  return r;
};
const _cbOrigFetchBenchmarkData = fetchBenchmarkData;
fetchBenchmarkData = async function(...args){
  let r;
  try{ r=await _cbOrigFetchBenchmarkData(...args); }
  catch(e){ r={ok:false,error:e?.message||'벤치마크 조회 실패'}; }
  if(typeof finMarkFresh==='function') finMarkFresh('benchmark','성과 벤치마크','시장 지수 데이터',r?.ok===true,r?.ok?(r.detail||'기간별 데이터 로드'):(r?.error||'조회 실패'));
  if(_cobaltActive==='perf2') cbRerender();
  return r;
};
// 테마 전환 시 활성 페이지 재렌더 — 인라인으로 해석된 테마 색(hex)을 새 테마 기준으로 다시 계산
const _cbOrigSetTheme = setTheme;
setTheme = function(mode){
  _cbOrigSetTheme(mode);
  cbRerender();
};

// 새로고침 결과를 데이터 상태 센터와 연결한다.
const _cbOrigLiveRefresh = liveRefresh;
liveRefresh = async function(...args){
  let r;
  try{ r=await _cbOrigLiveRefresh(...args); }
  catch(e){ r={ok:false,error:e?.message||'시세 조회 실패'}; }
  const stale=Number(r?.stale??(pfolioData||[]).filter(i=>i&&i._priceStale).length);
  if(typeof finMarkFresh==='function') finMarkFresh('prices','시장 시세','국내 네이버 직전 종가 · 해외 Yahoo · 코인 업비트',r?.ok===true,r?.ok?(r.detail||'등록 자산 최신 상태'):(r?.error||(stale?`${stale}개 최신 확인 필요`:'조회 실패')));
  return r;
};
const _cbOrigRefreshPyData = refreshPyData;
refreshPyData = async function(...args){
  let r;
  try{ r=await _cbOrigRefreshPyData(...args); }
  catch(e){ r={ok:false,error:e?.message||'환율·금 시세 조회 실패'}; }
  if(typeof finMarkFresh==='function') finMarkFresh('rates','환율·금 시세','네이버(하나은행 고시) · KRX 금시장',r?.ok===true,r?.ok?(r.detail||'환율·금 시세 로드'):(r?.error||r?.detail||'조회 실패'));
  return r;
};

// 리스크 페이지에 들어갈 때까지 기다리지 않고 앱을 열자마자 최신 ETF 스냅샷을 확인한다.
cbEnsureEtfHoldings();
