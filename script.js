// =============================================
// DATA
// =============================================
const RATES = { USD: 1380, JPY: 9.2, KRW: 1 };
let _donutMainLevel = 'top', _donutAccLevel = 'top';

function _taxRuleValue(path, fallback, when) {
  return typeof assetTaxRuleValue === 'function'
    ? assetTaxRuleValue(path, fallback, when)
    : fallback;
}

function _setAccountDonutTitle(label='',detail=false){
  const title=document.getElementById('donut-acc-title');
  if(!title)return;
  title.replaceChildren();
  if(detail){
    const account=document.createElement('span');
    account.style.color='var(--acc)';
    account.textContent=String(label||'미지정');
    title.append(account,document.createTextNode(' '));
  }else{
    title.append(document.createTextNode('계좌별 요약 '));
  }
  const hint=document.createElement('span');
  hint.style.cssText='font-size:.62rem;font-weight:normal';
  hint.textContent=detail?'(재클릭 → 복귀)':'(클릭 → 상세)';
  title.appendChild(hint);
}

// 공유용 금액 가리기 — 동적으로 다시 그려지는 화면과 툴팁 속 통화 금액까지 마스킹한다.
const AMOUNT_PRIVACY_KEY = 'asset-dashboard-amount-privacy';
let _amountPrivacyEnabled = false;
let _amountPrivacyObserver = null;
let _amountPrivacyMutating = false;
const _amountPrivacyTextOriginal = new WeakMap();
const _amountPrivacyAttrOriginal = new WeakMap();
const _amountPrivacyChartState = new WeakMap();

function isAmountHidden(){ return _amountPrivacyEnabled; }
function _maskAmountText(value){
  let out = String(value == null ? '' : value);
  out = out.replace(/([+\-−]?\s*[₩$¥]\s*)\d[\d,]*(?:\.\d+)?(?:\s*(?:억원|천만원|백만원|만원|원|억|천만|백만|만))?/g, (match, lead) => {
    const spacing = (lead.match(/^\s*/) || [''])[0];
    const sign = /[-−]/.test(lead) ? '−' : (/\+/.test(lead) ? '+' : '');
    const symbol = (lead.match(/[₩$¥]/) || ['₩'])[0];
    return spacing + sign + symbol + '••••';
  });
  out = out.replace(/([+\-−]?\s*)\d[\d,]*(?:\.\d+)?(?=\s*(?:억원|천만원|백만원|만원|원))/g, (match, lead) => {
    const spacing = (lead.match(/^\s*/) || [''])[0];
    const sign = /[-−]/.test(lead) ? '−' : (/\+/.test(lead) ? '+' : '');
    return spacing + sign + '••••';
  });
  return out;
}
function _maskAmountAttributes(el){
  if (!el || el.nodeType !== 1) return;
  const attrs = ['title','data-tip','data-overflow-tip','aria-label'];
  let originals = _amountPrivacyAttrOriginal.get(el);
  attrs.forEach(name => {
    if (!el.hasAttribute(name)) return;
    const current = el.getAttribute(name) || '';
    const masked = _maskAmountText(current);
    if (masked === current) return;
    if (!originals) originals = {};
    if (!(name in originals) || current !== _maskAmountText(originals[name])) originals[name] = current;
    el.setAttribute(name, masked);
  });
  if (originals) _amountPrivacyAttrOriginal.set(el, originals);
}
function _maskAmountTree(root){
  if (!_amountPrivacyEnabled || !root) return;
  _amountPrivacyMutating = true;
  try {
    if (root.nodeType === 1) _maskAmountAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while (node) {
      if (node.nodeType === 1) {
        _maskAmountAttributes(node);
      } else if (node.nodeType === 3 && !/^(SCRIPT|STYLE|TEXTAREA|OPTION)$/.test(node.parentElement?.tagName || '')) {
        const current = node.nodeValue || '';
        const masked = _maskAmountText(current);
        if (masked !== current) {
          const prior = _amountPrivacyTextOriginal.get(node);
          if (prior == null || current !== _maskAmountText(prior)) _amountPrivacyTextOriginal.set(node, current);
          node.nodeValue = masked;
        }
      }
      node = walker.nextNode();
    }
  } finally {
    _amountPrivacyMutating = false;
  }
}
function _restoreAmountTree(root){
  if (!root) return;
  _amountPrivacyMutating = true;
  try {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while (node) {
      if (node.nodeType === 3) {
        const original = _amountPrivacyTextOriginal.get(node);
        if (original != null) node.nodeValue = original;
      } else if (node.nodeType === 1) {
        const attrs = _amountPrivacyAttrOriginal.get(node);
        if (attrs) Object.entries(attrs).forEach(([name,value]) => node.setAttribute(name,value));
      }
      node = walker.nextNode();
    }
  } finally {
    _amountPrivacyMutating = false;
  }
}
function _syncAmountPrivacyCharts(){
  if (typeof Chart === 'undefined') return;
  const charts = [];
  document.querySelectorAll('canvas').forEach(canvas => {
    let chart = null;
    try { chart = typeof Chart.getChart === 'function' ? Chart.getChart(canvas) : null; } catch(e){}
    if (chart && !charts.includes(chart)) charts.push(chart);
  });
  if (!charts.length && Chart.instances) {
    const values = typeof Chart.instances.values === 'function'
      ? Array.from(Chart.instances.values())
      : Object.values(Chart.instances);
    values.forEach(chart => { if (chart && !charts.includes(chart)) charts.push(chart); });
  }
  charts.forEach(chart => {
    try {
      if (_amountPrivacyEnabled) {
        if (!_amountPrivacyChartState.has(chart)) {
          const tooltip = chart.options?.plugins?.tooltip;
          const scales = Object.entries(chart.options?.scales || {});
          _amountPrivacyChartState.set(chart, {
            tooltipEnabled: tooltip ? tooltip.enabled : undefined,
            ticks: scales.map(([key,scale]) => ({ key, color:scale?.ticks?.color }))
          });
        }
        const tooltip = chart.options?.plugins?.tooltip;
        if (tooltip) tooltip.enabled = false;
        Object.values(chart.options?.scales || {}).forEach(scale => {
          if (scale?.ticks) scale.ticks.color = 'rgba(0,0,0,0)';
        });
      } else {
        const state = _amountPrivacyChartState.get(chart);
        if (state) {
          const tooltip = chart.options?.plugins?.tooltip;
          if (tooltip) {
            if (state.tooltipEnabled === undefined) delete tooltip.enabled;
            else tooltip.enabled = state.tooltipEnabled;
          }
          state.ticks.forEach(({key,color}) => {
            const scale = chart.options?.scales?.[key];
            if (!scale?.ticks) return;
            if (color === undefined) delete scale.ticks.color;
            else scale.ticks.color = color;
          });
          _amountPrivacyChartState.delete(chart);
        }
      }
      chart.update('none');
    } catch(e){}
  });
}
function _updateAmountPrivacyButton(){
  const btn = document.getElementById('sidebar-privacy-btn');
  const label = document.getElementById('sidebar-privacy-label');
  if (btn) {
    btn.classList.toggle('active', _amountPrivacyEnabled);
    btn.setAttribute('aria-pressed', String(_amountPrivacyEnabled));
    btn.title = _amountPrivacyEnabled ? '가려진 금액 다시 표시' : '공유할 때 화면의 금액 숨기기';
    const icon = btn.querySelector('span[aria-hidden="true"]');
    if (icon) icon.textContent = _amountPrivacyEnabled ? '◎' : '◉';
  }
  if (label) label.textContent = _amountPrivacyEnabled ? '금액 보이기' : '금액 가리기';
}
function _applyAmountPrivacy(){
  document.body?.classList.toggle('amount-privacy', _amountPrivacyEnabled);
  if (_amountPrivacyEnabled) _maskAmountTree(document.body);
  else _restoreAmountTree(document.body);
  _updateAmountPrivacyButton();
  _syncAmountPrivacyCharts();
  setTimeout(_syncAmountPrivacyCharts, 250);
}
function toggleAmountPrivacy(){
  _amountPrivacyEnabled = !_amountPrivacyEnabled;
  try { localStorage.setItem(AMOUNT_PRIVACY_KEY, _amountPrivacyEnabled ? '1' : '0'); } catch(e){}
  _applyAmountPrivacy();
}
function initAmountPrivacy(){
  try { _amountPrivacyEnabled = localStorage.getItem(AMOUNT_PRIVACY_KEY) === '1'; } catch(e){}
  if (!_amountPrivacyObserver && document.body) {
    _amountPrivacyObserver = new MutationObserver(mutations => {
      if (!_amountPrivacyEnabled || _amountPrivacyMutating) return;
      mutations.forEach(mutation => {
        if (mutation.type === 'characterData') _maskAmountTree(mutation.target);
        mutation.addedNodes?.forEach(node => _maskAmountTree(node));
      });
    });
    _amountPrivacyObserver.observe(document.body, { childList:true, subtree:true, characterData:true });
  }
  _applyAmountPrivacy();
  setTimeout(_syncAmountPrivacyCharts, 800);
  setTimeout(_syncAmountPrivacyCharts, 2500);
}

function getSectorInfo(name, tkr, grp) {
  if (grp==='현금') return '현금/기타';
  if (grp==='가상화폐') return 'Crypto';
  if (grp==='금') return '원자재(금)';
  let n = name.toUpperCase();
  if (n.includes('ETF')||n.includes('TIGER')||n.includes('KODEX')||n.includes('S&P')||n.includes('TR')) return 'ETF';
  if (['NVDA','AAPL','MSFT'].includes(tkr)) return 'Tech (빅테크)';
  if (['005930'].includes(tkr)) return '반도체 (국내)';
  if (['TSLA'].includes(tkr)) return 'Auto';
  if (['JPM'].includes(tkr)) return '금융';
  return '기타 주식';
}

let pfolioData = []; // KV(Upstash)에서 loadAssetsFromKV()로 로드됩니다

// 자산 내역 증권사·계좌 필터 ('전체' 또는 인코딩된 broker/acc 조합)
let _holdingsBrokerFilter = '전체';
const _BROKER_ACC_SEP = ''; // broker/acc 값에 쓰이지 않는 구분자

function getFilteredAssets(owner) {
  return filterByOwner(pfolioData, owner);
}

// 기본 팔레트 — 소유주/차트 색상
const ownerColors = {'전체':'#4ecdc4','본인':'#5b9bff','아내':'#f2a33c','자녀1':'#4ade80','아버지':'#c084fc'};
// 벤치마크 차트 전용 소유주 색상: 아내(#f2a33c)가 KOSPI 라인(주황)과, 자녀1(#4ade80)이 S&P 라인(녹색)과 겹치므로 분리
const BENCH_OWNER_COLORS = { ...ownerColors, '아내': '#f472b6', '자녀1': '#4ecdc4' };
const CHART_PALETTE = ['#5b9bff','#4ecdc4','#f2a33c','#fb7185','#c084fc','#4ade80','#e8875a','#94a3c8','#d4b24a','#56c596'];

// 소유주 목록 (단일 소스). OWNERS = 실제 소유주 4인, ALL_OWNERS = '전체' 포함
const OWNERS = ['본인','아내','자녀1','아버지'];
const ALL_OWNERS = ['전체', ...OWNERS];

// 배당 주기 → 연간 지급 횟수 / 주기 라벨 / 요일 라벨 (단일 소스)
const CYCLE_COUNT = {'월배당':12,'분기':4,'반기':2,'연간':1,'-':1};
const CYCLE_LABEL = {daily:'매일',weekly:'매주',monthly:'매월','month-end':'매월말','month-start':'매월초'};
const DOW_LABELS = ['일','월','화','수','목','금','토'];

// 통일된 KRW 포맷 헬퍼 (Y축 레이블 등)
function formatKRW(v) {
  if (v >= 1000000000) return (v/100000000).toFixed(1)+'억';
  if (v >= 100000000) return Math.round(v/100000000)+'억';
  if (v >= 10000000) { const tm=v/10000000; return (Number.isInteger(tm)?tm:tm.toFixed(1))+'천만'; }
  if (v >= 1000000) { const bm=v/1000000; return (Number.isInteger(bm)?bm:bm.toFixed(1))+'백만'; }
  if (v >= 10000) return Math.round(v/10000)+'만';
  return v.toLocaleString();
}
// Y축 tick 콜백 (공통)
const KRW_TICK = v => v===0?'₩0':'₩'+formatKRW(Math.abs(v))+(v<0?'(-)':'');

// 공용 헬퍼 (중복 통합)
// 소유주 필터: '전체'/미지정이면 원본 그대로, 아니면 owner 일치 항목만
function filterByOwner(items, owner){
  if (!owner || owner === '전체') return items;
  return items.filter(i => (i.owner || '본인') === owner);
}
// 부호 포함 퍼센트 포맷: 12.3 → "+12.3%", -4 → "-4.0%"
function fmtPct(v, d=1){ return (v>=0?'+':'') + (v||0).toFixed(d) + '%'; }
// 콤마형 통화 포맷 (formatKRW 약어와 달리 전체 자릿수 표기)
function fmtMoney(v, cur='KRW'){
  if (cur === 'USD') return '$' + (v||0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
  if (cur === 'JPY') return '¥' + Math.round(v||0).toLocaleString();
  return '₩' + Math.round(v||0).toLocaleString();
}
// 손익 계산: { profit, pct }
function calcProfit(cur, inv){ const p = cur - inv; return { profit: p, pct: inv > 0 ? (p/inv)*100 : 0 }; }
// 티커 정규화: 대문자화 + .KS/.KQ 접미사 제거
const normTkr = t => (t||'').toUpperCase().replace(/\.(KS|KQ)$/i, '');
// 배당 캐시는 화면(Cobalt cbStrip)과 동일하게 한국·일본 거래소 접미사를 제거해 조회한다.
// API 요청 심볼은 .T를 유지해야 Yahoo가 일본 종목을 찾으므로 요청 목록에는 normDivTkr를 쓰지 않는다.
const normDivTkr = t => (t||'').toUpperCase().replace(/\.(KS|KQ|T)$/i, '');
// fetch 타임아웃 헬퍼: { signal, done() }
function fetchTimeout(ms=20000){
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

// 기간별 성과 비교 (실제 데이터는 /api/dashboard?type=benchmark 로 로드)
// 초기값은 라벨만 유지하고 값은 null 로 초기화 – 실제 데이터 로딩 전엔 차트에 선이 그려지지 않음 (0%로 오인 방지)
const _bnulls = n => Array(n).fill(null);
// 기간별 benchData 템플릿: S&P 500/KOSPI + 소유주 4인 라인을 null 로 초기화
const _benchTpl = (labels, n) => ({
  labels,
  data: { 'S&P 500': _bnulls(n), 'KOSPI': _bnulls(n), ...Object.fromEntries(OWNERS.map(o => [o, _bnulls(n)])) }
});
const benchData = {
  '5D': _benchTpl(['D1','D2','D3','D4','D5'], 5),
  '1M': _benchTpl(['W1','W2','W3','W4'], 4),
  '3M': _benchTpl(['M1','M2','M3'], 3),
  '6M': _benchTpl(['M1','M2','M3','M4','M5','M6'], 6),
  'YTD': _benchTpl(['M1','M2','M3'], 3),
  '1Y': _benchTpl(['M-12','M-10','M-8','M-6','M-4','M-2','M-0'], 7)
};

// 배당 정보 DB (티커 → 배당정보 매핑)
// pfolioData 보유종목 중 이 목록에 있는 것만 배당 집계
const DIV_INFO_DB = {
  'JPM':    {yld:'2.34%',cycle:'분기',months:[0,3,6,9],eps:1.15,cur:'USD',exDiv:'지급월 전월 첫째주',payDay:31},
  'O':      {yld:'5.82%',cycle:'월배당',months:[0,1,2,3,4,5,6,7,8,9,10,11],eps:0.256,cur:'USD',exDiv:'매월 말일',payDay:15},
  'MSFT':   {yld:'0.71%',cycle:'분기',months:[2,5,8,11],eps:0.75,cur:'USD',exDiv:'지급월 3개월 전',payDay:12},
  'AAPL':   {yld:'0.53%',cycle:'분기',months:[1,4,7,10],eps:0.24,cur:'USD',exDiv:'지급월 전월 중순',payDay:15},
  'NVDA':   {yld:'0.02%',cycle:'분기',months:[2,5,8,11],eps:0.04,cur:'USD',exDiv:'지급월 초순',payDay:null},
  'SCHD':   {yld:'3.50%',cycle:'분기',months:[2,5,8,11],eps:0.75,cur:'USD',exDiv:'매 분기 초',payDay:null},
  'VYM':    {yld:'3.20%',cycle:'분기',months:[2,5,8,11],eps:0.92,cur:'USD',exDiv:'매 분기 초',payDay:null},
  'JEPI':   {yld:'7.50%',cycle:'월배당',months:[0,1,2,3,4,5,6,7,8,9,10,11],eps:0.48,cur:'USD',exDiv:'매월 중순',payDay:null},
  'JEPQ':   {yld:'10.00%',cycle:'월배당',months:[0,1,2,3,4,5,6,7,8,9,10,11],eps:0.48,cur:'USD',exDiv:'매월 중순',payDay:null},
  'MU':     {yld:'0.50%',cycle:'분기',months:[0,3,6,9],eps:0.115,cur:'USD',exDiv:'지급월 전월 초',payDay:null},
  'AMD':    {yld:'0.00%',cycle:'-',months:[],eps:0,cur:'USD',exDiv:'-',payDay:null},
  'TSLA':   {yld:'0.00%',cycle:'-',months:[],eps:0,cur:'USD',exDiv:'-',payDay:null},
  'AMZN':   {yld:'0.00%',cycle:'-',months:[],eps:0,cur:'USD',exDiv:'-',payDay:null},
  'GOOGL':  {yld:'0.42%',cycle:'분기',months:[2,5,8,11],eps:0.20,cur:'USD',exDiv:'매 분기 말',payDay:null},
  'META':   {yld:'0.41%',cycle:'분기',months:[2,5,8,11],eps:0.50,cur:'USD',exDiv:'매 분기 말',payDay:null},
  'SPY':    {yld:'1.30%',cycle:'분기',months:[2,5,8,11],eps:1.65,cur:'USD',exDiv:'매 분기 중순',payDay:null},
  'QQQ':    {yld:'0.60%',cycle:'분기',months:[2,5,8,11],eps:0.55,cur:'USD',exDiv:'매 분기 말',payDay:null},
  'VTI':    {yld:'1.50%',cycle:'분기',months:[2,5,8,11],eps:0.93,cur:'USD',exDiv:'매 분기 말',payDay:null},
  '005930': {yld:'1.92%',cycle:'분기',months:[3,4,7,10],eps:361,cur:'KRW',exDiv:'매 분기 말일',payDay:20},
  '000660': {yld:'1.50%',cycle:'분기',months:[3,5,8,11],eps:1500,cur:'KRW',exDiv:'매 분기 말일',payDay:20},
  '360750': {yld:'1.50%',cycle:'분기',months:[1,4,7,10],eps:65,cur:'KRW',exDiv:'매 분기 말',payDay:null},
  '069500': {yld:'2.10%',cycle:'분기',months:[1,4,7,10],eps:185,cur:'KRW',exDiv:'매 분기 말',payDay:null},
  '229200': {yld:'1.80%',cycle:'분기',months:[1,4,7,10],eps:80,cur:'KRW',exDiv:'매 분기 말',payDay:null},
  '133690': {yld:'0.80%',cycle:'반기',months:[5,11],eps:50,cur:'KRW',exDiv:'매 반기 말',payDay:null},
  '252670': {yld:'0.00%',cycle:'-',months:[],eps:0,cur:'KRW',exDiv:'-',payDay:null},
  // 국내 주요 배당주
  '035420': {yld:'0.45%',cycle:'연간',months:[3],eps:1000,cur:'KRW',exDiv:'매년 4월 초',payDay:null},   // NAVER (4월 배당)
  '035720': {yld:'0.15%',cycle:'연간',months:[3],eps:60,cur:'KRW',exDiv:'매년 4월 초',payDay:null},     // KAKAO (4월 배당)
  '005380': {yld:'3.50%',cycle:'분기',months:[3,5,8,11],eps:2500,cur:'KRW',exDiv:'매 분기 말',payDay:null}, // 현대차
  '000270': {yld:'4.30%',cycle:'분기',months:[3,5,8,11],eps:1200,cur:'KRW',exDiv:'매 분기 말',payDay:null}, // 기아
  '055550': {yld:'5.00%',cycle:'분기',months:[3,5,8,11],eps:625,cur:'KRW',exDiv:'매 분기 말',payDay:null}, // 신한지주
  '105560': {yld:'4.60%',cycle:'분기',months:[3,5,8,11],eps:750,cur:'KRW',exDiv:'매 분기 말',payDay:null}, // KB금융
  '086790': {yld:'4.20%',cycle:'분기',months:[3,5,8,11],eps:650,cur:'KRW',exDiv:'매 분기 말',payDay:null}, // 하나금융지주
  '316140': {yld:'3.80%',cycle:'분기',months:[3,5,8,11],eps:220,cur:'KRW',exDiv:'매 분기 말',payDay:null}, // 우리금융지주
  '017670': {yld:'6.00%',cycle:'연간',months:[3],eps:3000,cur:'KRW',exDiv:'매년 4월 초',payDay:null},   // SK텔레콤
  '030200': {yld:'5.50%',cycle:'연간',months:[3],eps:1500,cur:'KRW',exDiv:'매년 4월 초',payDay:null},   // KT
  '015760': {yld:'5.20%',cycle:'연간',months:[3],eps:1216,cur:'KRW',exDiv:'매년 4월 초',payDay:null},   // 한국전력
  '034020': {yld:'3.90%',cycle:'반기',months:[5,11],eps:400,cur:'KRW',exDiv:'매 반기 말',payDay:null}, // 두산에너빌리티
};

// 실시간 배당 데이터 캐시 (API에서 가져온 값)
window._divDataCache = window._divDataCache || {};

// pfolioData에서 배당 정보가 있는 보유 종목 동적 조회
// DIV_INFO_DB 또는 API 캐시 사용
function getDivStocks() {
  const seen = new Set();
  return pfolioData
    .filter(i => i.grp==='주식' && i.qty>0)
    .map(i => {
      const tkr6 = normDivTkr(i.tkr);
      if (seen.has(tkr6)) return null;
      seen.add(tkr6);
      // API 캐시 우선, 없으면 DIV_INFO_DB 폴백
      const cached = window._divDataCache[tkr6] || window._divDataCache[i.tkr];
      if (cached) {
        const hasDiv = (cached.yld > 0) || (cached.eps > 0) || (cached.months && cached.months.length > 0);
        if (!hasDiv) return null;
        return { name: i.name, tkr: tkr6, ...cached, _divSource:'cache' };
      }
      const info = DIV_INFO_DB[tkr6] || DIV_INFO_DB[i.tkr];
      if (!info) return null;
      const hasDiv2 = (info.yld && parseFloat(info.yld) > 0) || (info.eps > 0) || (info.months && info.months.length > 0);
      if (!hasDiv2) return null;
      return { name: i.name, tkr: tkr6, ...info, _divSource:'db' };
    })
    .filter(Boolean);
}

// 배당 이력 연도는 하드코딩하지 않는다 — 작년·올해·내년을 매 실행 시점에 계산한다.
// (예전에는 ['2025','2026'] 이 박혀 있어 2027년이 되면 조용히 빈 화면이 됐다)
function divHistoryYears(){
  const y = new Date().getFullYear();
  return [String(y-1), String(y), String(y+1)];
}
function _emptyDivHistory(){
  const o = {};
  divHistoryYears().forEach(y=>{ o[y] = {}; });
  return o;
}
// 없는 연도/소유주를 읽어도 터지지 않도록 항상 12칸 배열을 돌려준다.
function divHistoryOf(year, owner){
  const y = String(year || new Date().getFullYear());
  return ((divHistory[y] || {})[owner]) || Array(12).fill(0);
}
// 연도 드롭다운도 하드코딩된 <option> 대신 실행 시점 기준으로 다시 채운다.
function refreshYearSelects(){
  const now = new Date().getFullYear();
  const fill = (id, years, def) => {
    const el = document.getElementById(id); if(!el) return;
    const keep = el.value;
    el.innerHTML = years.map(y=>`<option value="${y}">${y}년</option>`).join('');
    el.value = years.includes(keep) ? keep : String(def);
  };
  const divYears = divHistoryYears().slice().reverse();          // 내년·올해·작년
  ['valYearSelect','mainDivYearSelect','divYearSelect'].forEach(id=>fill(id, divYears, now));
  // 실현손익은 미래 연도가 의미 없으니 올해부터 과거 3년
  fill('pl-year-select', [now, now-1, now-2].map(String), now);
}
let divHistory = _emptyDivHistory();

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

// 배당 원천징수 세율 (세전→세후)
// 단, ISA 200만원 공제는 owner·연도·계좌 집계가 필요하므로 syncDivHistory에서 처리
function getDivWithholdingRate(acc) {
  return getAccountDivTaxInfo(acc).normalRate;
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
  // divHistoryGross: 세전 배당 (기존 호환성), divHistory: 세후 배당 (세제 혜택 반영)
  if (!window.divHistoryGross) window.divHistoryGross = _emptyDivHistory();
  YEARS.forEach(y=>{
    if(!window.divHistoryGross[y]) window.divHistoryGross[y]={};
    ALL_OWNERS.forEach(o=>{
      window.divHistoryGross[y][o]=Array(12).fill(0);
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

  // 1단계: 세전 배당 집계
  pfolioData.forEach(item=>{
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
    YEARS.forEach(y=>{
      months.forEach(m=>{
        if(m>=0&&m<12){
          window.divHistoryGross[y][item.owner][m]+=payout;
          window.divHistoryGross[y]['전체'][m]+=payout;
        }
      });
    });
  });

  // 2단계: 연간 세전 배당을 공통 세금 엔진에 한 번 모은 뒤 월별 세후 금액으로 배분한다.
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
async function fetchDivData(force=false) {
  const today = _cfLocalDateKey(new Date());
  const cacheKey = 'divCache_' + today;
  const verifiedKey = 'divCacheTickers_' + today;
  const tickers = [...new Set(
    pfolioData.filter(i=>i.grp==='주식'&&i.qty>0)
      .map(i=>(i.tkr||'').replace(/\.(KS|KQ)$/,''))
      .filter(Boolean)
  )];
  if (!tickers.length) return {ok:true,skipped:true,detail:'조회할 주식 자산 없음'};
  const cached = localStorage.getItem(cacheKey);
  if (cached&&!force) {
    try {
      const verified = JSON.parse(localStorage.getItem(verifiedKey) || '[]');
      // 무배당 종목은 결과 캐시에 키가 생기지 않으므로, 실제 요청을 마친 티커 목록을
      // 별도로 보관해 "새 보유 종목이 추가됐는지"까지 페이지 진입 때마다 검증한다.
      if (Array.isArray(verified) && tickers.every(t=>verified.includes(t))) {
        const parsed = JSON.parse(cached);
        // 화면의 cbStrip 규칙과 맞춰 일본 상장 .T도 캐시 키에서는 제거한다.
        window._divDataCache = Object.fromEntries(Object.entries(parsed||{}).map(
          ([t,d])=>[String(t).toUpperCase().replace(/\.(KS|KQ|T)$/,''),d]
        ));
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
        verifiedTickers.push(...chunk);
      } catch(err) {
        failedChunks++; lastChunkError = err;
        console.error('[fetchDivData chunk]', chunk.length+'개', err?.message);
      } finally { _divFetch.done(); }
    }
    if (failedChunks === chunks.length) {
      return {ok:false,error:lastChunkError?.message||'배당 데이터 조회 실패'};
    }
    for (const [tkr, d] of Object.entries(mergedResult)) {
      const cacheTkr = String(tkr).toUpperCase().replace(/\.(KS|KQ|T)$/,'');
      const existing = DIV_INFO_DB[tkr] || DIV_INFO_DB[cacheTkr] || {};
      if (!d || typeof d !== 'object') continue;
      const annualDps = Number(d.dps) || 0;
      const yld = Number(d.yld) || 0;
      const cycle = d.cycle || existing.cycle || '-';
      const cycleN = CYCLE_COUNT[cycle] || 1;
      const months = (Array.isArray(d.months) && d.months.length) ? d.months : (existing.months || []);
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
        };
      }
    }
    localStorage.setItem(cacheKey, JSON.stringify(window._divDataCache));
    // 실패한 청크의 티커를 verified 로 적으면 다음 접속에서 조회 없이 넘어가 배당이 영영 비게 된다.
    localStorage.setItem(verifiedKey, JSON.stringify(verifiedTickers));
    syncDivHistory();
    resolvePendingDivDates();
    const count = Object.keys(window._divDataCache).length;
    if (failedChunks) {
      return {ok:false,count,failedChunks,
        error:`요청 ${chunks.length}건 중 ${failedChunks}건 실패 (${lastChunkError?.message||'원인 미상'})`};
    }
    return {ok:true,count};
  } catch(e) {
    console.error('[fetchDivData]', e);
    return {ok:false,error:e?.message||'배당 데이터 조회 실패'};
  }
}

// 종목별 배당 raw 이력 (10년치) — YoC/CAGR/DRIP 위젯용
// 국내 .KS → .KQ 폴백을 포함하는 캐시 스키마. 버전 변경 시 기존 누락 캐시를 한 번 갱신한다.
const DIV_HIST_CACHE_VERSION = 2;
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
          return;
        }
      }
    } catch(e) {}
  }
  try {
    const _dhFetch = fetchTimeout(25000);
    const resp = await authFetch('/api/price?type=dividend_history&tickers=' + tickers.join(','), { signal: _dhFetch.signal });
    _dhFetch.done();
    if (!resp.ok) { console.warn('[fetchDividendHistory] HTTP', resp.status); return; }
    const data = await resp.json();
    if (!data.success || !data.result) return;
    window._divHistoryRawCache = Object.fromEntries(Object.entries(data.result).map(
      ([t,d])=>[String(t).toUpperCase().replace(/\.(KS|KQ|T)$/,''),d]
    ));
    try { localStorage.setItem('divHistRaw', JSON.stringify({ version:DIV_HIST_CACHE_VERSION, savedAt: Date.now(), tickers, data: window._divHistoryRawCache })); } catch(e) {}
  } catch(e) { console.error('[fetchDividendHistory]', e); }
}

const CF_DEFAULT = [
  {date:'2026-03-27',type:'지출',cat:'식비',desc:'점심식사',amt:24500},
  {date:'2026-03-26',type:'지출',cat:'주거/통신',desc:'인터넷 요금',amt:38000},
  {date:'2026-03-25',type:'수입',cat:'급여',desc:'3월 정기 급여',amt:4500000},
  {date:'2026-03-24',type:'지출',cat:'교통/차량',desc:'주유',amt:70000},
  {date:'2026-02-15',type:'지출',cat:'식비',desc:'회식',amt:50000},
  {date:'2026-01-20',type:'지출',cat:'문화/생활',desc:'가족 나들이',amt:150000},
  {date:'2025-12-25',type:'지출',cat:'기타',desc:'크리스마스 선물',amt:200000},
  {date:'2025-11-15',type:'수입',cat:'기타',desc:'연말정산 환급금',amt:350000}
];
const _STORED_TEXT_LIMIT=160;
function _boundedStoredText(value,max=_STORED_TEXT_LIMIT){
  const text=String(value==null?'':value)
    .replace(/[\u0000-\u001f\u007f<>]/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,Math.max(0,Number(max)||0));
  return /^(?:__proto__|prototype|constructor)$/i.test(text)?'':text;
}
function _safeStoredNumber(value,{min=-Number.MAX_SAFE_INTEGER,max=Number.MAX_SAFE_INTEGER,fallback=0}={}){
  const parsed=Number(value);
  if(!Number.isFinite(parsed))return fallback;
  return Math.min(max,Math.max(min,parsed));
}
function _safeStoredId(value){
  const parsed=Number(value);
  return Number.isSafeInteger(parsed)&&parsed>0?parsed:null;
}
function _isStoredDateKey(value,allowMonth=false){
  const text=String(value||'');
  const match=text.match(allowMonth?/^(\d{4})-(\d{2})$/:/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match)return false;
  const year=Number(match[1]),month=Number(match[2]),day=allowMonth?1:Number(match[3]);
  const date=new Date(Date.UTC(year,month-1,day));
  return year>=1900&&year<=2200&&date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
}
function _normalizeStoredOwner(value,{allowAll=false}={}){
  const owner=_boundedStoredText(value,24);
  return OWNERS.includes(owner)||(allowAll&&owner==='전체')?owner:'미지정';
}
function _normalizeCfRows(rows){
  if(!Array.isArray(rows))return [];
  return rows.slice(0,10000).map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))return null;
    const rawDate=String(item.date||'');
    const date=rawDate==='미정'?'미정':(_isStoredDateKey(rawDate)?rawDate:'미정');
    const row={
      date,
      type:item.type==='수입'?'수입':'지출',
      cat:_boundedStoredText(item.cat||'기타',48)||'기타',
      desc:_boundedStoredText(item.desc,240),
      amt:_safeStoredNumber(item.amt,{min:0,max:1_000_000_000_000}),
      owner:_normalizeStoredOwner(item.owner),
    };
    const atId=_safeStoredId(item.atId);
    if(atId!==null)row.atId=atId;
    if(item.isAuto===true)row.isAuto=true;
    const scheduleMonth=String(item.scheduleMonth||'');
    if(_isStoredDateKey(scheduleMonth,true))row.scheduleMonth=scheduleMonth;
    const cycleLabel=_boundedStoredText(item.cycleLabel,48);
    if(cycleLabel)row.cycleLabel=cycleLabel;
    const divKey=_boundedStoredText(item.divKey,220);
    if(divKey)row.divKey=divKey;
    if(item.dateStatus==='pending')row.dateStatus='pending';
    return row;
  }).filter(Boolean);
}
function _normalizeAutoTransfers(rows){
  if(!Array.isArray(rows))return [];
  const allowedCycles=new Set(['daily','weekly','monthly','month-end','month-start','quarterly','yearly']);
  return rows.slice(0,2000).map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))return null;
    const id=_safeStoredId(item.id);
    if(id===null)return null;
    const cycle=allowedCycles.has(item.cycle)?item.cycle:'monthly';
    const row={
      id,
      owner:_normalizeStoredOwner(item.owner),
      type:item.type==='수입'?'수입':'지출',
      cat:_boundedStoredText(item.cat||'기타',48)||'기타',
      desc:_boundedStoredText(item.desc,240),
      amt:_safeStoredNumber(item.amt,{min:0,max:1_000_000_000_000}),
      cycle,
      dayOfMonth:Math.round(_safeStoredNumber(item.dayOfMonth,{min:1,max:31,fallback:1})),
      dayOfWeek:Math.round(_safeStoredNumber(item.dayOfWeek,{min:0,max:6,fallback:1})),
      isFixedCost:typeof item.isFixedCost==='boolean'?item.isFixedCost:undefined,
      businessDayRule:item.businessDayRule==='exact'?'exact':'next',
      lastApplied:_isStoredDateKey(item.lastApplied,true)?String(item.lastApplied):'',
      startMonth:_isStoredDateKey(item.startMonth,true)?String(item.startMonth):'',
      endMonth:_isStoredDateKey(item.endMonth,true)?String(item.endMonth):'',
      amountChanges:Array.isArray(item.amountChanges)?item.amountChanges.slice(0,240).map(change=>{
        if(!change||!_isStoredDateKey(change.from,true))return null;
        return {from:String(change.from),amt:_safeStoredNumber(change.amt,{min:0,max:1_000_000_000_000})};
      }).filter(Boolean):[],
      skipMonths:Array.isArray(item.skipMonths)?[...new Set(item.skipMonths.filter(month=>_isStoredDateKey(month,true)).map(String))].slice(0,240):[],
    };
    if(row.isFixedCost===undefined)delete row.isFixedCost;
    return row;
  }).filter(Boolean);
}
function _normalizeMonthlyPLRows(rows){
  if(!Array.isArray(rows))return [];
  return rows.slice(0,5000).map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))return null;
    const id=_safeStoredId(item.id);
    if(id===null||!_isStoredDateKey(item.month,true))return null;
    const storedOwner=_boundedStoredText(item.owner,24);
    const normalizedOwner=OWNERS.includes(storedOwner)||(storedOwner==='전체')?storedOwner:'';
    const row={
      id,
      month:String(item.month),
      amt:_safeStoredNumber(item.amt,{min:-1_000_000_000_000,max:1_000_000_000_000}),
      memo:_boundedStoredText(item.memo,240),
      // 레거시 기록의 소유주 누락은 특정 납세자로 꾸미지 않고 별도 추정 버킷에 남긴다.
      owner:normalizedOwner,
      category:item.category==='domestic'?'domestic':'foreign',
      account:['일반','ISA','연금저축'].includes(item.account)?item.account:'일반',
    };
    const ruleSetId=_safeStoredToken(item.ruleSetId,'');
    if(ruleSetId)row.ruleSetId=ruleSetId;
    return row;
  }).filter(Boolean);
}
function _safeStoredToken(value,fallback=''){
  const token=String(value==null?'':value).trim();
  return /^[A-Za-z0-9._-]{1,80}$/.test(token)?token:fallback;
}
function _normalizeAssetHistoryRows(rows){
  if(!Array.isArray(rows))return [];
  return rows.slice(-240).map(item=>{
    if(!item||typeof item!=='object'||!_isStoredDateKey(item.date,true))return null;
    return {
      date:String(item.date),
      totalAssets:_safeStoredNumber(item.totalAssets,{min:0,max:1_000_000_000_000_000}),
      totalLiab:_safeStoredNumber(item.totalLiab,{min:0,max:1_000_000_000_000_000}),
      netAssets:_safeStoredNumber(item.netAssets,{min:-1_000_000_000_000_000,max:1_000_000_000_000_000}),
    };
  }).filter(Boolean);
}
function _normalizeGoalRows(rows){
  if(!Array.isArray(rows))return [];
  const links=new Set(['investment','net','crypto','us','kr','jp','gold','cash','manual']);
  return rows.slice(0,500).map((item,index)=>{
    if(!item||typeof item!=='object'||Array.isArray(item))return null;
    const name=_boundedStoredText(item.name,160);
    if(!name)return null;
    return {
      id:_safeStoredToken(item.id,`legacy-goal-${index}`),
      name,
      targetAmount:_safeStoredNumber(item.targetAmount,{min:0,max:1_000_000_000_000_000}),
      targetDate:_isStoredDateKey(item.targetDate)?String(item.targetDate):'',
      linkClass:links.has(item.linkClass)?item.linkClass:'investment',
      currentAmount:_safeStoredNumber(item.currentAmount,{min:0,max:1_000_000_000_000_000}),
    };
  }).filter(Boolean);
}
function _normalizeOwnerAmountMap(value){
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  return Object.fromEntries(OWNERS.map(owner=>[
    owner,
    _safeStoredNumber(source[owner],{min:-1_000_000_000_000_000,max:1_000_000_000_000_000}),
  ]));
}
function _normalizeNetWorthRows(rows){
  if(!Array.isArray(rows))return [];
  return rows.slice(-1000).map(item=>{
    if(!item||typeof item!=='object'||!_isStoredDateKey(item.date))return null;
    const total=Number(item.total);
    if(!Number.isFinite(total))return null;
    const owns=key=>Object.prototype.hasOwnProperty.call(item,key);
    const row={
      date:String(item.date),
      total:_safeStoredNumber(total,{min:-1_000_000_000_000_000,max:1_000_000_000_000_000}),
    };
    const schemaV=Number(item.schemaV);
    if(owns('schemaV')&&Number.isInteger(schemaV)&&schemaV>=1&&schemaV<=100)row.schemaV=schemaV;
    if(owns('portfolio'))row.portfolio=_safeStoredNumber(item.portfolio,{min:0,max:1_000_000_000_000_000});
    if(owns('nonInvestmentAssets'))row.nonInvestmentAssets=_safeStoredNumber(item.nonInvestmentAssets,{min:0,max:1_000_000_000_000_000});
    if(owns('liabilities'))row.liabilities=_safeStoredNumber(item.liabilities,{min:0,max:1_000_000_000_000_000});
    if(owns('portfolioByOwner'))row.portfolioByOwner=_normalizeOwnerAmountMap(item.portfolioByOwner);
    if(owns('netByOwner'))row.netByOwner=_normalizeOwnerAmountMap(item.netByOwner);
    return row;
  }).filter(Boolean);
}
function _normalizeBalanceSheet(value){
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const normalizeRows=(rows,kind)=>Array.isArray(rows)?rows.slice(0,1000).map((item,index)=>{
    if(!item||typeof item!=='object'||Array.isArray(item))return null;
    const name=_boundedStoredText(item.name,160);
    if(!name)return null;
    return {
      id:_safeStoredToken(item.id,`legacy-${kind}-${index}`),
      owner:_normalizeStoredOwner(item.owner),
      category:_boundedStoredText(item.category||'기타',80)||'기타',
      name,
      amount:_safeStoredNumber(item.amount,{min:0,max:1_000_000_000_000_000}),
      note:_boundedStoredText(item.note,240),
    };
  }).filter(Boolean):[];
  return {
    assets:normalizeRows(source.assets,'asset'),
    liabilities:normalizeRows(source.liabilities,'liability'),
    cashTargetMonths:_safeStoredNumber(source.cashTargetMonths,{min:1,max:36,fallback:6}),
  };
}
function _normalizeTargetAlloc(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const source=value.groups&&typeof value.groups==='object'&&!Array.isArray(value.groups)?value.groups:{};
  const defaults={crypto:5,us:35,kr:25,jp:5,gold:10,cash:20};
  const groups={};
  Object.entries(defaults).forEach(([key,fallback])=>{
    groups[key]=_safeStoredNumber(source[key],{min:0,max:100,fallback});
  });
  return {groups,threshold:_safeStoredNumber(value.threshold,{min:1,max:20,fallback:5})};
}
function _normalizeGiftActual(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const normalizeAmounts=items=>Array.from({length:4},(_,index)=>
    _safeStoredNumber(Array.isArray(items)?items[index]:0,{min:0,max:1_000_000_000_000})
  );
  const normalizePrior=prior=>{
    const source=prior&&typeof prior==='object'&&!Array.isArray(prior)?prior:{};
    const hasAmount=Object.prototype.hasOwnProperty.call(source,'amount')
      && source.amount!==''&&source.amount!==null
      && Number.isFinite(Number(source.amount))&&Number(source.amount)>=0;
    const amountKnown=source.amountKnown===true||(source.amountKnown!==false&&hasAmount);
    const normalized={
      confirmed:source.confirmed===true,
      asOf:_isStoredDateKey(source.asOf)?String(source.asOf):'',
      amountKnown,
    };
    if(amountKnown)normalized.amount=_safeStoredNumber(source.amount,{min:0,max:1_000_000_000_000});
    return normalized;
  };
  return {
    birth:_isStoredDateKey(value.birth,true)?String(value.birth):'',
    years:_safeStoredNumber(value.years,{min:5,max:60,fallback:40}),
    rate:_safeStoredNumber(value.rate,{min:0,max:20,fallback:3}),
    child:normalizeAmounts(value.child),
    marriage:_isStoredDateKey(value.marriage)?String(value.marriage):'',
    spouse:normalizeAmounts(value.spouse),
    childPrior:normalizePrior(value.childPrior),
    spousePrior:normalizePrior(value.spousePrior),
  };
}
let cfData = _normalizeCfRows(CF_DEFAULT);
try { const _s=localStorage.getItem('cfData'); if(_s){const _d=JSON.parse(_s);if(Array.isArray(_d))cfData=_normalizeCfRows(_d);} } catch(e){}
function saveCfData(){try{localStorage.setItem('cfData',JSON.stringify(cfData));}catch(e){}}
let cfDeletedKeys = [];
try {
  const _s=localStorage.getItem('cfDeletedKeys');
  if(_s){const _d=JSON.parse(_s);if(Array.isArray(_d))cfDeletedKeys=[...new Set(_d.map(key=>_boundedStoredText(key,220)).filter(Boolean))].slice(0,5000);}
} catch(e){}
function saveCfDeletedKeys(){try{localStorage.setItem('cfDeletedKeys',JSON.stringify(cfDeletedKeys));}catch(e){}}
function cfDeletionKey(item){
  if (!item) return '';
  if (item.divKey) return `div:${item.divKey}`;
  if (item.atId && item.date && item.date!=='미정') return `auto:${item.atId}:${String(item.date).slice(0,7)}`;
  return '';
}
function rememberCfDeletion(item){
  const key = cfDeletionKey(item);
  if (key && !cfDeletedKeys.includes(key)){
    cfDeletedKeys.push(key);
    saveCfDeletedKeys();
  }
  if (item && item.atId && item.date && item.date!=='미정'){
    const ym = String(item.date).slice(0,7);
    const at = autoTransferData.find(x=>x.id===item.atId);
    if (at){
      if (!Array.isArray(at.skipMonths)) at.skipMonths=[];
      if (!at.skipMonths.includes(ym)) at.skipMonths.push(ym);
      saveAutoTransfers(false);
    }
  }
  return key;
}
const cfColors = {'교통/차량':'#4ecdc4','교육':'#f472b6','급여':'#5b9bff','기타':'#94a3c8','문화/생활':'#c084fc','식비':'#f2a33c','의료/건강':'#fb7185','저축/투자':'#56c596','주거/통신':'#e8875a','배당금':'#4ade80','대출납입금':'#fb7185','관리비':'#e8875a','세금':'#e05572'};
// 자동이체 등록 데이터: {id, owner, type, cat, desc, amt, cycle, dayOfWeek, dayOfMonth,
// isFixedCost:true|false|undefined(기존 데이터 검토 필요), startMonth, endMonth, lastApplied}
let autoTransferData = [];
try { const s=localStorage.getItem('autoTransferData'); if(s) autoTransferData=_normalizeAutoTransfers(JSON.parse(s)); } catch(e){}

// 은행 영업일 계산용 국내 공휴일. 2026년 월력요항과 이후 확정된
// 노동절·제헌절 공휴일, 전국동시지방선거일을 반영한다.
const _KR_BANK_HOLIDAYS = new Set([
  '2026-01-01',
  '2026-02-16','2026-02-17','2026-02-18',
  '2026-03-01','2026-03-02',
  '2026-05-01','2026-05-05','2026-05-24','2026-05-25',
  '2026-06-03','2026-06-06','2026-07-17',
  '2026-08-15','2026-08-17',
  '2026-09-24','2026-09-25','2026-09-26',
  '2026-10-03','2026-10-05','2026-10-09','2026-12-25',
]);

function _cfLocalDateKey(date){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function _localDateFromKey(value){
  const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match)return new Date(NaN);
  return new Date(Number(match[1]),Number(match[2])-1,Number(match[3]),12,0,0,0);
}

function _isKrBankBusinessDay(date){
  const dow=date.getDay();
  return dow!==0 && dow!==6 && !_KR_BANK_HOLIDAYS.has(_cfLocalDateKey(date))
    && (typeof _isKrPublicHoliday!=='function'||!_isKrPublicHoliday(date));
}

function _nextKrBankBusinessDay(date){
  const result=new Date(date.getFullYear(),date.getMonth(),date.getDate());
  for(let guard=0;guard<14&&!_isKrBankBusinessDay(result);guard++) result.setDate(result.getDate()+1);
  return result;
}

function _normalizeAutoTransferSchedules(list=autoTransferData){
  let changed=false;
  (Array.isArray(list)?list:[]).forEach(at=>{
    if(at&&at.cycle==='month-start'){
      at.cycle='monthly';
      at.dayOfMonth=1;
      changed=true;
    }
  });
  return changed;
}

function _autoTransferScheduledDate(at,y,m){
  const lastDay=new Date(y,m,0).getDate();
  const day=at&&at.cycle==='month-end' ? lastDay : Math.min(Math.max(1,Number(at&&at.dayOfMonth)||1),lastDay);
  const nominal=new Date(y,m-1,day);
  return at&&at.businessDayRule==='exact' ? nominal : _nextKrBankBusinessDay(nominal);
}

function _autoTransferMonthlyOccurrences(at,y,m){
  if(!at||!['monthly','month-end','month-start'].includes(at.cycle))return [];
  const result=[];
  for(const offset of [0,-1]){
    const nominal=new Date(y,m-1+offset,1);
    const ny=nominal.getFullYear(),nm=nominal.getMonth()+1;
    if(!_autoTransferActiveInMonth(at,ny,nm))continue;
    const actual=_autoTransferScheduledDate(at,ny,nm);
    if(actual.getFullYear()===y&&actual.getMonth()+1===m)result.push({date:actual,scheduleMonth:`${ny}-${String(nm).padStart(2,'0')}`});
  }
  return result;
}

_normalizeAutoTransferSchedules();

function saveAutoTransfers(syncRemote=true){
  try{localStorage.setItem('autoTransferData',JSON.stringify(autoTransferData));}catch(e){}
  if(syncRemote && typeof saveExtDataToKV==='function') saveExtDataToKV();
}

/** 월별 유효 자동이체 금액 – amountChanges 타임라인을 반영 */
function _effectiveAutoTransferAmt(at, y, m) {
  if (!at) return 0;
  let amt = at.amt || 0;
  if (Array.isArray(at.amountChanges) && at.amountChanges.length) {
    // from 이 (y,m) 이하인 최신 변경분 적용
    const sorted = at.amountChanges.slice().sort((a,b)=>{
      const [ay,amo] = (a.from||'0-0').split('-').map(Number);
      const [by,bmo] = (b.from||'0-0').split('-').map(Number);
      return ay!==by ? ay-by : amo-bmo;
    });
    for (const ch of sorted) {
      if (!ch || !ch.from) continue;
      const [cy, cm] = ch.from.split('-').map(Number);
      if (y > cy || (y === cy && m >= cm)) amt = ch.amt;
    }
  }
  return amt;
}

function applyAutoTransfers() {
  const today = new Date();
  const ym = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0');
  let changed = false;
  autoTransferData.forEach(at => {
    const monthlyCycle=['monthly','month-end','month-start'].includes(at.cycle);
    const scheduledDate=monthlyCycle?_autoTransferScheduledDate(at,today.getFullYear(),today.getMonth()+1):today;
    const scheduledKey=_cfLocalDateKey(scheduledDate);
    if (at.lastApplied === ym) {
      // 구버전이 월초·지정일 자동이체를 페이지를 연 날짜로 저장한 경우,
      // 연결된 현재 월 행을 실제 예정일로 1회 교정한다.
      if(monthlyCycle){
        const legacy=cfData.find(item=>item.atId===at.id&&item.isAuto===true&&String(item.date||'').slice(0,7)===ym);
        if(legacy&&legacy.date!==scheduledKey){legacy.date=scheduledKey;legacy.scheduleMonth=ym;changed=true;}
      }
      return;
    }
    // 시작 월 이전이면 적용 금지 (4월 등록 자동이체가 3월 이하로 소급되지 않도록)
    if (at.startMonth) {
      const [sy, sm] = at.startMonth.split('-').map(Number);
      if (today.getFullYear() < sy || (today.getFullYear() === sy && (today.getMonth()+1) < sm)) return;
    }
    // 종료 월 이후면 적용 금지
    if (at.endMonth) {
      const [ey, em] = at.endMonth.split('-').map(Number);
      if (today.getFullYear() > ey || (today.getFullYear() === ey && (today.getMonth()+1) > em)) return;
    }
    let shouldApply = false;
    if (monthlyCycle && _cfLocalDateKey(today)>=scheduledKey) shouldApply = true;
    else if (at.cycle === 'weekly' || at.cycle === 'daily') shouldApply = true;
    if (shouldApply) {
      const dateStr = monthlyCycle?scheduledKey:_cfLocalDateKey(today);
      const effAmt = _effectiveAutoTransferAmt(at, today.getFullYear(), today.getMonth()+1);
      cfData.push({date:dateStr, type:at.type, cat:at.cat, desc:'[자동] '+at.desc, amt:effAmt, owner:at.owner||'미지정', isAuto:true, atId:at.id, scheduleMonth:ym, cycleLabel:_getCycleLabel(at)});
      at.lastApplied = ym;
      changed = true;
    }
  });
  if (changed) { saveAutoTransfers(false); saveCfData(); renderCashFlow(); saveExtDataToKV(); updateNetAssetDisplay(); }
}

function _getCycleLabel(at) {
  let s = CYCLE_LABEL[at.cycle]||at.cycle||'자동';
  if (at.cycle==='weekly') s += ' '+DOW_LABELS[at.dayOfWeek||1]+'요일';
  if (at.cycle==='monthly') s += ' '+at.dayOfMonth+'일';
  return s;
}

function addAutoTransfer() {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  const type = document.getElementById('cf-type').value;
  const cat = document.getElementById('cf-cat').value;
  const desc = document.getElementById('cf-desc').value.trim();
  const amt = parseFloat((document.getElementById('cf-amt').value||'').replace(/,/g,''))||0;
  const cycle = document.getElementById('at-cycle').value;
  const dom = parseInt(document.getElementById('at-dom').value)||1;
  const dow = parseInt(document.getElementById('at-dow').value)||1;
  const owner = document.getElementById('cf-owner-input')?.value || (_cfOwner==='전체'?'':_cfOwner);
  const isFixedCost = !!document.getElementById('cf-fixed-flag')?.checked;
  if (!desc||!amt) { alert('내용과 금액을 입력하세요.'); return; }
  if (!OWNERS.includes(owner)) { alert('소유주를 선택하세요.'); return; }
  const today = new Date();
  const ym = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0');
  const at = {id:Date.now(), owner, type, cat, desc, amt, cycle, dayOfMonth:dom, dayOfWeek:dow, isFixedCost, businessDayRule:'next', lastApplied:'', startMonth: ym};
  autoTransferData.push(at);
  saveAutoTransfers(false);
  // 이미 도래한 월간 일정만 실제 예정일로 상세 내역에 추가한다.
  const monthlyCycle=['monthly','month-end'].includes(cycle);
  const scheduledDate=monthlyCycle?_autoTransferScheduledDate(at,today.getFullYear(),today.getMonth()+1):today;
  if(!monthlyCycle||_cfLocalDateKey(today)>=_cfLocalDateKey(scheduledDate)){
    const dateStr=monthlyCycle?_cfLocalDateKey(scheduledDate):_cfLocalDateKey(today);
    cfData.push({date:dateStr, type, cat, desc: '[자동] ' + desc, amt, owner, isAuto:true, atId:at.id, scheduleMonth:ym, cycleLabel:_getCycleLabel(at)});
    at.lastApplied=ym;
  }
  saveCfData();
  saveExtDataToKV();
  renderCashFlow();
  const descEl=document.getElementById('cf-desc');if(descEl)descEl.value='';
  const amtEl=document.getElementById('cf-amt');if(amtEl)amtEl.value='';
  const fixedEl=document.getElementById('cf-fixed-flag');if(fixedEl)fixedEl.checked=false;
  renderFixedCostView();
}

function deleteAutoTransfer(id) {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  if (!confirm('해당 자동이체 설정을 삭제하시겠습니까?\n(연결된 [자동] 내역도 리스트에서 함께 사라집니다.)')) return;
  // 자동이체에 연결된 id(Date.now())가 있는 cfData [자동] 항목 제거
  const at = autoTransferData.find(a => a.id === id);
  autoTransferData = autoTransferData.filter(a => a.id !== id);
  if (at) {
    // desc/cat/type이 일치하는 [자동] cfData 제거 (동일 설명으로 생성된 과거 자동 기록 제거)
    cfData = cfData.filter(c => !(
      c.isAuto === true &&
      c.type === at.type &&
      c.cat === at.cat &&
      typeof c.desc === 'string' &&
      c.desc.includes(at.desc)
    ));
    saveCfData();
  }
  saveAutoTransfers(false);
  saveExtDataToKV();
  if (typeof renderCashFlow === 'function') renderCashFlow();
}

/** 자동이체 취소 (현재 달까지는 유지, 다음 달부터 중단) */
function cancelAutoTransfer(id) {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  if (!confirm('이 자동이체를 이번 달까지만 유지하고 다음 달부터 취소하시겠습니까?')) return;
  const at = autoTransferData.find(x => x.id === id);
  if (at) {
    const ym = cfYear + '-' + String(cfMonth).padStart(2,'0');
    at.endMonth = ym;
    saveAutoTransfers();
    renderCashFlow();
    alert('취소되었습니다. 다음 달부터는 내역에 나타나지 않습니다.');
  }
}

/** 특정 달의 자동이체 예상 행을 실체화하여 수정 폼 열기 (해당 월만) */
function editAutoTransferMonth(atId, y, m) {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  const at = autoTransferData.find(x => x.id === atId);
  if (!at) return;
  // 사용자에게 적용 범위 확인 – 기본: "이 달부터 이후 전부"
  const choice = confirm(
    `이 자동이체의 금액/내용을 수정합니다.\n\n` +
    `[확인] → ${y}년 ${m}월부터 이후 모든 달에 반영\n` +
    `[취소] → ${y}년 ${m}월에만 예외적으로 반영\n`
  );
  if (choice) { editAutoTransferFromMonth(atId, y, m); return; }
  // 단일월 예외 수정: 해당 월 행을 실체화 후 편집 폼 오픈
  const daysInMonth = new Date(y, m, 0).getDate();
  let times=0;
  const monthlyCycle=['monthly','month-end','month-start'].includes(at.cycle);
  const monthlyOccurrences=monthlyCycle?_autoTransferMonthlyOccurrences(at,y,m):[];
  if(monthlyCycle)times=monthlyOccurrences.length;
  else if(at.cycle==='weekly')times=Math.floor(daysInMonth/7);
  else if(at.cycle==='daily')times=daysInMonth;
  const effAmt = _effectiveAutoTransferAmt(at, y, m);
  const total = effAmt * times;
  let day = 1;
  if (at.cycle==='monthly') day = Math.min(at.dayOfMonth||1, daysInMonth);
  else if (at.cycle==='month-end') day = daysInMonth;
  const dateStr = monthlyOccurrences.length
    ? _cfLocalDateKey(monthlyOccurrences[0].date)
    : `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const newEntry = {
    date: dateStr, type: at.type, cat: at.cat,
    desc: '[자동] ' + (at.desc||''), amt: total, owner:at.owner||'미지정',
    isAuto: true, atId: at.id, cycleLabel: _getCycleLabel(at)
  };
  cfData.push(newEntry);
  saveCfData();
  renderCashFlow();
  const newIdx = cfData.length - 1;
  if (typeof editCF === 'function') editCF(newIdx);
}

/** 특정 달부터 금액을 변경 (이후 모든 달에 자동 반영) */
function editAutoTransferFromMonth(atId, y, m) {
  const at = autoTransferData.find(x => x.id === atId);
  if (!at) return;
  const curAmt = _effectiveAutoTransferAmt(at, y, m);
  const input = prompt(
    `${y}년 ${m}월부터 적용할 새로운 금액(원)을 입력하세요.\n현재 금액: ₩${curAmt.toLocaleString()}`,
    String(curAmt)
  );
  if (input === null) return;
  const newAmt = parseFloat((input||'').replace(/[^0-9.]/g,''));
  if (isNaN(newAmt) || newAmt < 0) { alert('유효한 숫자를 입력하세요.'); return; }
  if (!Array.isArray(at.amountChanges)) at.amountChanges = [];
  const fromKey = `${y}-${String(m).padStart(2,'0')}`;
  // 같은 from 키가 이미 있으면 덮어쓰기
  const existing = at.amountChanges.find(c=>c.from===fromKey);
  if (existing) existing.amt = newAmt;
  else at.amountChanges.push({from:fromKey, amt:newAmt});
  // (y,m) 이후로 이미 실체화된 cfData 항목의 금액도 업데이트 (해당 at.id 기준)
  cfData.forEach(c=>{
    if (c.atId !== atId) return;
    const cd = new Date(c.date);
    if (cd.getFullYear() > y || (cd.getFullYear()===y && cd.getMonth()+1 >= m)) {
      c.amt = newAmt;
    }
  });
  saveAutoTransfers(false);
  saveCfData();
  saveExtDataToKV();
  renderCashFlow();
  alert(`${y}년 ${m}월부터 ₩${newAmt.toLocaleString()} 로 변경되었습니다.`);
}

/** 특정 달만 자동이체 적용 건너뛰기 (skipMonths) */
function skipAutoTransferMonth(atId, y, m) {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  // 이 달만 vs 이 달부터 전부 선택
  const choice = confirm(
    `이 자동이체를 삭제합니다.\n\n` +
    `[확인] → ${y}년 ${m}월부터 이후 전부 삭제 (영구 중단)\n` +
    `[취소] → ${y}년 ${m}월에만 이번 한 달 건너뛰기\n`
  );
  if (choice) { deleteAutoTransferFromMonth(atId, y, m); return; }
  const at = autoTransferData.find(x => x.id === atId);
  if (!at) return;
  if (!Array.isArray(at.skipMonths)) at.skipMonths = [];
  const ymKey = `${y}-${String(m).padStart(2,'0')}`;
  if (!at.skipMonths.includes(ymKey)) at.skipMonths.push(ymKey);
  cfData = cfData.filter(c => !(
    c.atId === atId &&
    new Date(c.date).getFullYear() === y &&
    new Date(c.date).getMonth()+1 === m
  ));
  saveAutoTransfers(false);
  saveCfData();
  saveExtDataToKV();
  renderCashFlow();
}

/** 특정 달부터 자동이체 완전 중단 (이후 모든 달 삭제/미표시) */
function deleteAutoTransferFromMonth(atId, y, m) {
  const at = autoTransferData.find(x => x.id === atId);
  if (!at) return;
  // 시작월 이전을 끝으로 설정하면 전체 삭제
  const [sy, sm] = (at.startMonth||'').split('-').map(Number);
  if (sy && (y < sy || (y===sy && m <= sm))) {
    autoTransferData = autoTransferData.filter(x=>x.id!==atId);
    cfData = cfData.filter(c=>c.atId !== atId);
  } else {
    // endMonth = (y,m-1) → (y,m) 부터는 표시/적용 안됨
    const em = m - 1;
    if (em <= 0) at.endMonth = `${y-1}-12`;
    else at.endMonth = `${y}-${String(em).padStart(2,'0')}`;
    // (y,m) 이후 실체화된 cfData 제거
    cfData = cfData.filter(c=>{
      if (c.atId !== atId) return true;
      const cd = new Date(c.date);
      return !(cd.getFullYear() > y || (cd.getFullYear()===y && cd.getMonth()+1 >= m));
    });
  }
  saveAutoTransfers(false);
  saveCfData();
  saveExtDataToKV();
  renderCashFlow();
  alert(`${y}년 ${m}월부터 이 자동이체가 중단됩니다.`);
}

function renderAutoTransfers() {
  const tbody = document.getElementById('at-table-body'); if (!tbody) return;
  if (!autoTransferData.length) { tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:16px;color:var(--t3)">등록된 자동이체가 없습니다.</td></tr>'; return; }
  tbody.innerHTML = autoTransferData.map(at => {
    let cycleStr = CYCLE_LABEL[at.cycle]||at.cycle;
    if (at.cycle==='weekly') cycleStr += ' '+DOW_LABELS[at.dayOfWeek||1]+'요일';
    if (at.cycle==='monthly') cycleStr += ' '+at.dayOfMonth+'일';
    return `<tr>
      <td class="text-left">${at.type==='수입'?'<span style="color:var(--up)">수입</span>':'<span style="color:var(--dn)">지출</span>'}</td>
      <td class="text-left">${_cfEsc(at.cat)}</td>
      <td class="text-left">${_cfEsc(at.desc)}</td>
      <td style="text-align:right;font-family:'IBM Plex Mono'">₩${Math.round(at.amt).toLocaleString()}</td>
      <td class="text-left">${_cfEsc(cycleStr)}</td>
      <td><button class="btn-action" type="button" aria-label="${_cfEsc(at.desc)} 자동이체 삭제" onclick="deleteAutoTransfer(${Number(at.id)||0})">✕</button></td>
    </tr>`;
  }).join('');
}

function toggleAtCycleFields() {
  const cycle = document.getElementById('at-cycle')?.value;
  const domRow = document.getElementById('at-dom-row');
  const dowRow = document.getElementById('at-dow-row');
  if(domRow) domRow.style.display = cycle==='monthly'?'':'none';
  if(dowRow) dowRow.style.display = cycle==='weekly'?'':'none';
}

function toggleCfMode() {
  const isAuto = document.getElementById('cfmode-auto')?.checked;
  // 날짜 vs 주기 필드
  const dateGrp = document.getElementById('cf-date-group');
  const cycleGrp = document.getElementById('cf-cycle-group');
  const fixedFlag = document.getElementById('cf-fixed-flag-group');
  if(dateGrp) dateGrp.style.display = isAuto?'none':'';
  if(cycleGrp) cycleGrp.style.display = isAuto?'':'none';
  if(fixedFlag) fixedFlag.style.display = isAuto?'flex':'none';
  // 주기 관련 필드 표시
  toggleAtCycleFields();
}

function submitCfEntry() {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  const isAuto = document.getElementById('cfmode-auto')?.checked;
  if(isAuto) {
    addAutoTransfer();
  } else {
    addCashFlow();
  }
}

function _cfEsc(value) {
  return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function _cfMonthKey(date=new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
}

function switchCashFlowSection(section, btn) {
  _cfSection = section === 'fixed' ? 'fixed' : 'monthly';
  const monthly = document.getElementById('cf-monthly-section');
  const fixed = document.getElementById('cf-fixed-section');
  if (monthly) monthly.style.display = _cfSection === 'monthly' ? '' : 'none';
  if (fixed) fixed.style.display = _cfSection === 'fixed' ? 'flex' : 'none';
  document.querySelectorAll('.cf-section-tab').forEach(tab => {
    const active = tab === btn || tab.id === `cf-section-tab-${_cfSection}`;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (_cfSection === 'fixed') renderFixedCostView();
  else requestAnimationFrame(()=>{
    if(window.cfDonutChartInst) window.cfDonutChartInst.resize();
    if(window.cfTrendChartInst) window.cfTrendChartInst.resize();
  });
}

function _autoTransferActiveInMonth(at, y, m) {
  if (!at) return false;
  const ym = `${y}-${String(m).padStart(2,'0')}`;
  if (at.startMonth && ym < at.startMonth) return false;
  if (at.endMonth && ym > at.endMonth) return false;
  if (Array.isArray(at.skipMonths) && at.skipMonths.includes(ym)) return false;
  return true;
}

function _autoTransferMonthlyEquivalent(at, y, m) {
  const amount = _effectiveAutoTransferAmt(at, y, m);
  if (at.cycle === 'daily') return amount * 365 / 12;
  if (at.cycle === 'weekly') return amount * 52 / 12;
  if (at.cycle === 'quarterly') return amount / 3;
  if (at.cycle === 'yearly') return amount / 12;
  return amount;
}

function _fixedCostCycleText(at) {
  if (at.cycle === 'weekly') return `매주 ${DOW_LABELS[Number(at.dayOfWeek)||0]}요일`;
  if (at.cycle === 'month-start') return '매월초';
  if (at.cycle === 'month-end') return '매월말';
  if (at.cycle === 'daily') return '매일';
  if (at.cycle === 'quarterly') return '분기';
  if (at.cycle === 'yearly') return '매년';
  return `매월 ${Math.max(1,Math.min(31,Number(at.dayOfMonth)||1))}일`;
}

function _autoTransferOccursOn(at, date) {
  const y=date.getFullYear(),m=date.getMonth()+1,day=date.getDate();
  if (['monthly','month-end','month-start'].includes(at.cycle)) {
    const wanted=_cfLocalDateKey(date);
    return _autoTransferMonthlyOccurrences(at,y,m).some(row=>_cfLocalDateKey(row.date)===wanted);
  }
  if (!_autoTransferActiveInMonth(at,y,m)) return false;
  if (at.cycle === 'daily') return true;
  if (at.cycle === 'weekly') return date.getDay() === (Number(at.dayOfWeek)||0);
  if (at.cycle === 'yearly') {
    const startMonth=Number(String(at.startMonth||'').slice(5,7))||1;
    return m===startMonth && day===Math.min(Number(at.dayOfMonth)||1,new Date(y,m,0).getDate());
  }
  if (at.cycle === 'quarterly') {
    const startMonth=Number(String(at.startMonth||'').slice(5,7))||1;
    return ((m-startMonth+12)%3===0) && day===Math.min(Number(at.dayOfMonth)||1,new Date(y,m,0).getDate());
  }
  return day === Math.min(Number(at.dayOfMonth)||1,new Date(y,m,0).getDate());
}

function _nextFixedCostDate(at, fromDate=new Date()) {
  const cursor=new Date(fromDate.getFullYear(),fromDate.getMonth(),fromDate.getDate());
  for(let offset=0;offset<=370;offset++){
    const d=new Date(cursor);d.setDate(cursor.getDate()+offset);
    if(_autoTransferOccursOn(at,d)) return d;
  }
  return null;
}

function _fixedCostOwnerMatches(at) {
  if (_cfOwner === '전체') return true;
  return at.owner === _cfOwner;
}

function _fixedCostIncomeForMonth(y,m) {
  const materializedIds=new Set();
  let income=0;
  cfData.forEach(item=>{
    const d=new Date(item.date);
    if(d.getFullYear()!==y||d.getMonth()+1!==m||item.type!=='수입') return;
    if(_cfOwner!=='전체'&&item.owner!==_cfOwner) return;
    income+=Number(item.amt)||0;
    if(item.atId) materializedIds.add(item.atId);
  });
  autoTransferData.forEach(at=>{
    if(at.type!=='수입'||materializedIds.has(at.id)||!_fixedCostOwnerMatches(at)||!_autoTransferActiveInMonth(at,y,m)) return;
    income+=_autoTransferMonthlyEquivalent(at,y,m);
  });
  return income;
}

function renderFixedCostView() {
  const body=document.getElementById('cf-fixed-table-body');
  if(!body) return;
  const now=new Date(), y=now.getFullYear(),m=now.getMonth()+1;
  const ownerExpenses=autoTransferData.filter(at=>at.type==='지출'&&_fixedCostOwnerMatches(at));
  const excluded=ownerExpenses.filter(at=>at.isFixedCost===false);
  const visible=ownerExpenses.filter(at=>at.isFixedCost!==false||_cfShowExcluded);
  const included=visible.filter(at=>at.isFixedCost===true&&_autoTransferActiveInMonth(at,y,m));
  const pending=visible.filter(at=>at.isFixedCost==null);
  const monthly=included.reduce((sum,at)=>sum+_autoTransferMonthlyEquivalent(at,y,m),0);
  const annual=monthly*12;
  const income=_fixedCostIncomeForMonth(y,m);
  const ratio=income>0?monthly/income*100:null;
  const nextList=included.map(at=>({at,date:_nextFixedCostDate(at,now)})).filter(x=>x.date).sort((a,b)=>a.date-b.date);
  const next=nextList[0];
  const monthlyEl=document.getElementById('cf-fixed-monthly');if(monthlyEl)monthlyEl.textContent=`₩${Math.round(monthly).toLocaleString()}`;
  const annualEl=document.getElementById('cf-fixed-annual');if(annualEl)annualEl.textContent=`₩${Math.round(annual).toLocaleString()}`;
  const ratioEl=document.getElementById('cf-fixed-ratio');if(ratioEl)ratioEl.textContent=ratio==null?'-':`${ratio.toFixed(1)}%`;
  const ratioNote=document.getElementById('cf-fixed-ratio-note');if(ratioNote)ratioNote.textContent=income>0?`이번 달 수입 ₩${Math.round(income).toLocaleString()} 기준`:'이번 달 수입 내역이 없습니다';
  const nextEl=document.getElementById('cf-fixed-next');if(nextEl)nextEl.textContent=next?`₩${Math.round(_effectiveAutoTransferAmt(next.at,next.date.getFullYear(),next.date.getMonth()+1)).toLocaleString()}`:'-';
  const nextNote=document.getElementById('cf-fixed-next-note');if(nextNote)nextNote.textContent=next?`${next.date.getMonth()+1}월 ${next.date.getDate()}일 · ${next.at.owner||'미지정'} · ${next.at.desc}`:'예정된 결제가 없습니다';
  const monthNote=document.getElementById('cf-fixed-monthly-note');if(monthNote)monthNote.textContent=`${_cfOwner==='전체'?'가구 전체':_cfOwner} · ${included.length}개 항목`;
  const review=document.getElementById('cf-fixed-review-note');if(review)review.textContent=pending.length?`기존 자동이체 ${pending.length}건은 소유주와 고정비 여부를 확인해야 합계에 반영됩니다.`:'분류가 완료된 고정비만 합산합니다.';
  const badge=document.getElementById('cf-fixed-pending-badge');if(badge){badge.style.display=pending.length?'inline-flex':'none';badge.textContent=String(pending.length);}
  const excludedToggle=document.getElementById('cf-fixed-excluded-toggle');if(excludedToggle){excludedToggle.style.display=excluded.length?'':'none';excludedToggle.textContent=_cfShowExcluded?`제외 항목 숨기기`:`제외 항목 ${excluded.length}건`;excludedToggle.classList.toggle('active',_cfShowExcluded);}

  const rows=visible.slice().sort((a,b)=>{
    const ap=a.isFixedCost===true?0:(a.isFixedCost==null?1:2),bp=b.isFixedCost===true?0:(b.isFixedCost==null?1:2);
    return ap-bp||String(a.owner||'').localeCompare(String(b.owner||''),'ko')||String(a.desc||'').localeCompare(String(b.desc||''),'ko');
  });
  body.innerHTML=rows.length?rows.map(at=>{
    const isPending=at.isFixedCost==null;
    const isExcluded=at.isFixedCost===false;
    const active=_autoTransferActiveInMonth(at,y,m);
    const monthlyAmt=_autoTransferMonthlyEquivalent(at,y,m);
    const owner=at.owner||'미지정';
    const safeId=Number.isSafeInteger(Number(at.id))?Number(at.id):0;
    const ownerCell=isPending&&!OWNERS.includes(at.owner)
      ?`<select class="cf-fixed-inline-owner" aria-label="${_cfEsc(at.desc)} 소유주" onchange="setAutoTransferOwner(${safeId},this.value)"><option value="">미지정</option>${OWNERS.map(o=>`<option value="${o}">${o}</option>`).join('')}</select>`
      :`<span class="cf-fixed-owner"><i style="background:${ownerColors[owner]||'#8a97b0'}"></i>${_cfEsc(owner)}</span>`;
    const state=isExcluded?'<span class="cf-fixed-state is-ended">제외</span>':(isPending?'<span class="cf-fixed-state is-pending">분류 필요</span>':(!active?'<span class="cf-fixed-state is-ended">종료</span>':'<span class="cf-fixed-state is-included">합산</span>'));
    const actions=isExcluded
      ?`<button class="btn-action" onclick="restoreFixedCost(${safeId})" title="고정비 검토 대상으로 복원">↺</button>`
      :isPending
      ?`<button class="btn-action" onclick="includeFixedCost(${safeId})" title="고정비로 포함">✓</button><button class="btn-action" onclick="editFixedCost(${safeId})" title="확인 후 수정">✎</button><button class="btn-action" onclick="excludeFixedCost(${safeId})" title="고정비에서 제외">✕</button>`
      :`<button class="btn-action" onclick="editFixedCost(${safeId})" title="수정">✎</button><button class="btn-action" onclick="excludeFixedCost(${safeId})" title="고정비에서 제외">✕</button>`;
    return `<tr class="${isPending?'cf-fixed-row-pending':''}${isExcluded?' cf-fixed-row-excluded':''}"><td class="text-left">${ownerCell}</td><td class="text-left cf-fixed-secondary">${_cfEsc(at.cat||'-')}</td><td class="text-left"><span class="cf-fixed-item-name">${_cfEsc(at.desc||'-')}</span>${state}</td><td class="text-left">${_cfEsc(_fixedCostCycleText(at))}</td><td class="text-right">${isPending?'-':`₩${Math.round(monthlyAmt).toLocaleString()}`}</td><td class="text-right cf-fixed-secondary">${isPending?'-':`₩${Math.round(monthlyAmt*12).toLocaleString()}`}</td><td class="text-right cf-fixed-actions">${actions}</td></tr>`;
  }).join(''):'<tr><td colspan="7" class="cf-fixed-empty">등록된 고정비가 없습니다.</td></tr>';
}

function toggleFixedCostScheduleFields() {
  const cycle=document.getElementById('cf-fixed-cycle')?.value;
  const day=document.getElementById('cf-fixed-day-group');
  const dow=document.getElementById('cf-fixed-dow-group');
  if(day)day.style.display=cycle==='monthly'?'':'none';
  if(dow)dow.style.display=cycle==='weekly'?'':'none';
}

function resetFixedCostForm() {
  const edit=document.getElementById('cf-fixed-edit-id');if(edit)edit.value='';
  const title=document.getElementById('cf-fixed-form-title');if(title)title.textContent='고정비 등록';
  const submit=document.getElementById('cf-fixed-submit');if(submit)submit.textContent='등록';
  const cancel=document.getElementById('cf-fixed-cancel');if(cancel)cancel.style.display='none';
  const desc=document.getElementById('cf-fixed-desc');if(desc)desc.value='';
  const amt=document.getElementById('cf-fixed-amt');if(amt)amt.value='';
  const cycle=document.getElementById('cf-fixed-cycle');if(cycle)cycle.value='monthly';
  const day=document.getElementById('cf-fixed-day');if(day)day.value='25';
  const start=document.getElementById('cf-fixed-start');if(start)start.value=_cfMonthKey();
  const owner=document.getElementById('cf-fixed-owner');if(owner)owner.value=_cfOwner==='전체'?'본인':_cfOwner;
  toggleFixedCostScheduleFields();
}

function submitFixedCost() {
  if(isMobileLayout())return;
  const id=Number(document.getElementById('cf-fixed-edit-id')?.value)||0;
  const owner=document.getElementById('cf-fixed-owner')?.value;
  const cat=document.getElementById('cf-fixed-cat')?.value||'기타';
  const desc=document.getElementById('cf-fixed-desc')?.value.trim();
  const amt=Number((document.getElementById('cf-fixed-amt')?.value||'').replace(/,/g,''));
  const cycle=document.getElementById('cf-fixed-cycle')?.value||'monthly';
  const day=Math.max(1,Math.min(31,Number(document.getElementById('cf-fixed-day')?.value)||1));
  const dow=Number(document.getElementById('cf-fixed-dow')?.value)||0;
  const start=document.getElementById('cf-fixed-start')?.value||_cfMonthKey();
  if(!OWNERS.includes(owner)){alert('소유주를 선택하세요.');return;}
  if(!desc||!amt||amt<0){alert('항목과 금액을 입력하세요.');return;}
  const existing=autoTransferData.find(at=>at.id===id);
  if(existing){
    const changeFrom=_cfMonthKey();
    Object.assign(existing,{owner,type:'지출',cat,desc,cycle,dayOfMonth:day,dayOfWeek:dow,startMonth:start,isFixedCost:true,businessDayRule:existing.businessDayRule||'next'});
    if(start>changeFrom){
      existing.amt=amt;
      existing.amountChanges=(existing.amountChanges||[]).filter(ch=>ch.from<start);
    }else{
      existing.amountChanges=(existing.amountChanges||[]).filter(ch=>ch.from<changeFrom);
      existing.amountChanges.push({from:changeFrom,amt});
    }
  }else{
    autoTransferData.push({id:Date.now(),owner,type:'지출',cat,desc,amt,cycle,dayOfMonth:day,dayOfWeek:dow,startMonth:start,endMonth:'',lastApplied:'',isFixedCost:true,businessDayRule:'next'});
  }
  saveAutoTransfers();
  resetFixedCostForm();
  renderFixedCostView();
  renderCashFlow();
}

function editFixedCost(id) {
  if(isMobileLayout())return;
  const at=autoTransferData.find(x=>x.id===id);if(!at)return;
  document.getElementById('cf-fixed-edit-id').value=String(id);
  document.getElementById('cf-fixed-owner').value=OWNERS.includes(at.owner)?at.owner:(_cfOwner==='전체'?'본인':_cfOwner);
  document.getElementById('cf-fixed-cat').value=at.cat||'기타';
  document.getElementById('cf-fixed-desc').value=at.desc||'';
  const now=new Date();
  document.getElementById('cf-fixed-amt').value=Number(_effectiveAutoTransferAmt(at,now.getFullYear(),now.getMonth()+1)||0).toLocaleString();
  document.getElementById('cf-fixed-cycle').value=['monthly','month-end','weekly'].includes(at.cycle)?at.cycle:'monthly';
  document.getElementById('cf-fixed-day').value=at.dayOfMonth||1;
  document.getElementById('cf-fixed-dow').value=String(at.dayOfWeek||0);
  document.getElementById('cf-fixed-start').value=at.startMonth||_cfMonthKey();
  document.getElementById('cf-fixed-form-title').textContent='고정비 수정';
  document.getElementById('cf-fixed-submit').textContent='수정';
  document.getElementById('cf-fixed-cancel').style.display='';
  toggleFixedCostScheduleFields();
  document.getElementById('cf-fixed-desc').focus();
}

function setAutoTransferOwner(id,owner) {
  if(isMobileLayout())return;
  const at=autoTransferData.find(x=>x.id===id);if(!at||!OWNERS.includes(owner))return;
  at.owner=owner;
  saveAutoTransfers();
  renderFixedCostView();
}

function includeFixedCost(id) {
  if(isMobileLayout())return;
  const at=autoTransferData.find(x=>x.id===id);if(!at)return;
  if(!OWNERS.includes(at.owner)){alert('먼저 소유주를 선택하세요.');return;}
  at.isFixedCost=true;
  saveAutoTransfers();
  renderFixedCostView();
}

function excludeFixedCost(id) {
  if(isMobileLayout())return;
  const at=autoTransferData.find(x=>x.id===id);if(!at)return;
  at.isFixedCost=false;
  saveAutoTransfers();
  resetFixedCostForm();
  renderFixedCostView();
}

function restoreFixedCost(id) {
  if(isMobileLayout())return;
  const at=autoTransferData.find(x=>x.id===id);if(!at)return;
  delete at.isFixedCost;
  saveAutoTransfers();
  renderFixedCostView();
}

function toggleExcludedFixedCosts() {
  _cfShowExcluded=!_cfShowExcluded;
  renderFixedCostView();
}

// 경제 캘린더/뉴스 데이터는 제거됨 (메뉴 삭제)

// =============================================
// 숫자 입력 콤마 포매팅 (text 타입 입력 전용)
// =============================================
function applyCommaFormatting(inputEl) {
  if (!inputEl || inputEl.dataset.commaApplied) return;
  // type=number 입력에는 콤마 포매팅 적용 불가 → text로 변환
  if (inputEl.type === 'number') inputEl.type = 'text';
  inputEl.dataset.commaApplied = '1';
  inputEl.setAttribute('inputmode', 'numeric');

  inputEl.addEventListener('focus', function() {
    // 포커스 시 콤마 제거
    this.value = this.value.replace(/,/g, '');
  });
  inputEl.addEventListener('blur', function() {
    const raw = this.value.replace(/[^0-9.]/g, '');
    const num = parseFloat(raw);
    if (!isNaN(num) && num !== 0) {
      // data-decimal="1" 인 경우 소수점 최대 8자리 유지
      if (this.dataset.decimal === '1') {
        this.value = parseFloat(num.toFixed(8)).toLocaleString(undefined, {maximumFractionDigits: 8});
      } else {
        this.value = Math.round(num).toLocaleString();
      }
    }
    else if (raw === '' || raw === '0') this.value = '';
  });
  inputEl.addEventListener('keydown', function(e) {
    // 허용 키: 숫자, 백스페이스, 삭제, 방향키, 탭, 홈/엔드
    const allowed = ['Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Tab','Home','End','Enter'];
    if (!allowed.includes(e.key) && !/^[0-9.]$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
    }
  });
  inputEl.addEventListener('input', function() {
    // 숫자와 소수점만 허용, 콤마 제거 후 즉시 재포매팅하지 않음 (입력 중 방해 안 함)
    const raw = this.value.replace(/[^0-9.]/g, '');
    if (this.value !== raw) this.value = raw;
  });
}

// =============================================
// UI 상태
// =============================================
let currentOwner = '전체';
let myDonutChart, myBarChart, myBenchChart, miniDivChart, miniValueChart, myAccDonutChart, myPortBenchChart, portPerfChartInst, sectorDonutChartInst;
window.activeDivMonth=-1; window.activeMainDivMonth=-1; window.activeCfCat=null;
window.portToggleState = {'주식':false,'가상화폐':false,'금':false,'현금':false};
window.cfTrendDetails = {in:[],out:[]};

// 히트맵 상태
let heatmapData = {us:null,kr:null};
let currentHmPeriod = {us:'1D',kr:'1D'};
let usTreemap=null, krTreemap=null;

const now = new Date();
const days = ['일','월','화','수','목','금','토'];
const sideDate = document.getElementById('side-date-display');
if (sideDate) sideDate.innerText = `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')} (${days[now.getDay()]})`;

// =============================================
// 테마
// =============================================
// 3-테마: 'light' | 'dark' | 'navy' (기본: light)
const THEMES = ['light','dark','navy'];
function isDarkTheme() {
  const t = document.body.getAttribute('data-theme');
  return t === 'dark' || t === 'navy';
}
function setTheme(mode) {
  if (!THEMES.includes(mode)) mode = 'light';
  const body = document.body;
  if (mode === 'light') body.removeAttribute('data-theme');
  else body.setAttribute('data-theme', mode);
  // 세그먼트 컨트롤 활성 표시
  THEMES.forEach(t => {
    const b = document.getElementById('theme-seg-' + t);
    if (b) {
      const selected = t === mode;
      b.classList.toggle('active', selected);
      b.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
  });
  applyChartTheme(); // 내부에서 전 차트 재드로우 포함
  // gift 차트 범례 색상 강제 갱신
  if(window.giftChartInst){window.giftChartInst.update();}
  try{localStorage.setItem('theme', mode);}catch(e){}
  const activeView = document.querySelector('.view-section.active');
  if (activeView && activeView.id === 'view-bubble') setTimeout(()=>renderBubbleChart('weight'), 200);
  // 현금 흐름 차트는 렌더 시점에 CSS 토큰을 hex로 해석해 쓰므로 테마 변경 시 재렌더
  if (activeView && activeView.id === 'view-cashflow') { try{ renderCashFlow(); }catch(e){} }
}
// 하위 호환 (구 다크모드 토글)
function toggleTheme() { setTheme(isDarkTheme() ? 'light' : 'dark'); }
// 스크립트 로드 즉시 테마 적용 — 로그인 화면부터 저장 테마(기본 라이트) 반영.
// (이 시점엔 파일 후반부 let 변수들이 TDZ 상태라 setTheme→applyChartTheme 전체 호출은 금지)
try{
  const _t0=localStorage.getItem('theme');
  const _m0=THEMES.includes(_t0)?_t0:'light';
  if(_m0==='light') document.body.removeAttribute('data-theme');
  else document.body.setAttribute('data-theme',_m0);
  THEMES.forEach(t=>{const b=document.getElementById('theme-seg-'+t); if(b){const selected=t===_m0;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',selected?'true':'false');}});
}catch(e){}

// =============================================
// 모바일 내비게이션 (사이드바 드로어)
// =============================================
const _mobileMQ = window.matchMedia('(max-width: 768px)');
function isMobileLayout() { return _mobileMQ.matches; }
function _layoutPreviewMode() {
  const q=new URLSearchParams(location.search);
  return q.get('mobilePreview')==='1' ? 'mobile' : q.get('desktopPreview')==='1' ? 'desktop' : '';
}
function _updateLayoutPreviewLabel() {
  const mode=_layoutPreviewMode();
  const label=document.getElementById('sidebar-layout-label');
  if(label) label.textContent=(mode==='mobile'||(!mode&&isMobileLayout()))?'PC버전':'모바일버전';
}
function _layoutPreviewUrl(mode) {
  const url=new URL(location.href);
  url.searchParams.delete('mobilePreview');
  url.searchParams.delete('desktopPreview');
  url.searchParams.set(mode==='mobile'?'mobilePreview':'desktopPreview','1');
  return url.toString();
}
function openLayoutPreview(mode) {
  const overlay=document.getElementById('layout-preview-overlay');
  const frame=document.getElementById('layout-preview-frame');
  if(!overlay||!frame) return;
  const next=mode==='desktop'?'desktop':'mobile';
  overlay.classList.remove('mode-mobile','mode-desktop');
  overlay.classList.add('show','mode-'+next);
  overlay.setAttribute('aria-hidden','false');
  frame.src=_layoutPreviewUrl(next);
}
function closeLayoutPreview() {
  const overlay=document.getElementById('layout-preview-overlay');
  const frame=document.getElementById('layout-preview-frame');
  if(!overlay) return;
  overlay.classList.remove('show','mode-mobile','mode-desktop');
  overlay.setAttribute('aria-hidden','true');
  if(frame) frame.src='about:blank';
}
function toggleLayoutPreview() {
  const mode=_layoutPreviewMode();
  if(mode) {
    try {
      if(window.parent!==window&&typeof window.parent.closeLayoutPreview==='function') {
        window.parent.closeLayoutPreview();
        return;
      }
    } catch(e) {}
    if(window.parent!==window) {
      window.parent.postMessage({type:'close-layout-preview'},'*');
      return;
    }
  }
  openLayoutPreview(isMobileLayout()?'desktop':'mobile');
}
window.addEventListener('message',ev=>{
  const frame=document.getElementById('layout-preview-frame');
  if(ev.data?.type==='close-layout-preview'&&frame&&ev.source===frame.contentWindow) closeLayoutPreview();
});
window.addEventListener('keydown',ev=>{ if(ev.key==='Escape') closeLayoutPreview(); });
if(_mobileMQ.addEventListener) _mobileMQ.addEventListener('change',_updateLayoutPreviewLabel);
setTimeout(_updateLayoutPreviewLabel,0);
let _sidebarReturnFocus = null;
function openSidebar() {
  _sidebarReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.querySelector('.menu-col')?.classList.add('open');
  document.getElementById('sidebar-backdrop')?.classList.add('show');
  document.getElementById('sidebar-toggle')?.setAttribute('aria-expanded','true');
  if (isMobileLayout()) {
    setTimeout(() => document.querySelector('.menu-col button:not([disabled])')?.focus(), 0);
  }
}
function closeSidebar() {
  const wasOpen = document.querySelector('.menu-col')?.classList.contains('open');
  document.querySelector('.menu-col')?.classList.remove('open');
  document.getElementById('sidebar-backdrop')?.classList.remove('show');
  document.getElementById('sidebar-toggle')?.setAttribute('aria-expanded','false');
  if (wasOpen && _sidebarReturnFocus?.focus) {
    _sidebarReturnFocus.focus();
    _sidebarReturnFocus = null;
  }
}
function toggleSidebar() {
  document.querySelector('.menu-col')?.classList.contains('open') ? closeSidebar() : openSidebar();
}
// 첫 방문 기본값 — 자주 여는 '요약'·'분석'만 펼쳐 둔다. 4그룹을 모두 펼치면
// 항목이 13개라 접기의 이점이 사라진다. 이후에는 사용자가 접은 상태를 그대로 따른다.
const MENU_GROUP_DEFAULT_COLLAPSED = { planning:true, records:true };
function _menuGroupState(){
  try{ return JSON.parse(localStorage.getItem('menuGroupState')||'{}')||{}; }
  catch(e){ return {}; }
}
function _setMenuGroup(group, collapsed, persist){
  if(!group) return;
  group.classList.toggle('collapsed', collapsed);
  group.querySelector('.menu-group-title')?.setAttribute('aria-expanded', String(!collapsed));
  if(!persist) return;
  // 화면과 저장 상태가 어긋나면 접어둔 그룹이 새로고침마다 다시 열려 혼란스럽다.
  // 자동 펼침도 저장해 localStorage 가 항상 화면과 같은 값을 갖게 한다.
  const state=_menuGroupState(); state[group.dataset.menuGroup]=collapsed;
  try{ localStorage.setItem('menuGroupState',JSON.stringify(state)); }catch(e){}
}
function toggleMenuGroup(key, btn){
  const group=document.querySelector(`.menu-group[data-menu-group="${key}"]`); if(!group) return;
  _setMenuGroup(group, !group.classList.contains('collapsed'), true);
}
function initMenuGroups(){
  const state=_menuGroupState();
  document.querySelectorAll('.menu-group').forEach(group=>{
    const key=group.dataset.menuGroup;
    const collapsed = (state[key]===undefined) ? !!MENU_GROUP_DEFAULT_COLLAPSED[key] : state[key]===true;
    _setMenuGroup(group, collapsed, false);
  });
  expandActiveMenuGroup(document.querySelector('.menu-btn.active'));
}
function expandActiveMenuGroup(btn){
  const group=btn?.closest?.('.menu-group'); if(!group) return;
  if(group.classList.contains('collapsed')) _setMenuGroup(group, false, true);
}
// 대시보드 자산 구성 상세(NET 요약) 접기/펼치기 — 모바일 전용 토글 (데스크톱은 항상 펼침)
function toggleNetSummary() {
  const summary=document.getElementById('dash-net-summary');
  const expanded=!!summary?.classList.toggle('expanded');
  document.getElementById('dash-net-toggle')?.setAttribute('aria-expanded',expanded?'true':'false');
}
// 활성 뷰의 모든 Chart.js 인스턴스를 컨테이너 크기에 재맞춤
// — display:none 상태에서 생성/갱신된 캔버스가 잘못된 크기로 남는 문제 보정 (잘림/여백 방지)
function _fitActiveCharts() {
  const active = document.querySelector('.view-section.active');
  if (!active) return;
  active.querySelectorAll('canvas').forEach(c => {
    try { if (typeof Chart !== 'undefined' && Chart.getChart) Chart.getChart(c)?.resize(); } catch (e) {}
  });
}

let _viewHistoryRestoring=false;
function _viewMenuButton(id){
  const menuId=id==='cdash'?'dashboard':id;
  return document.getElementById('menu-'+menuId)
    || Array.from(document.querySelectorAll('.menu-btn')).find(b=>(b.getAttribute('onclick')||'').includes(`switchView('${id}'`))
    || null;
}
function _recordViewHistory(id){
  if(_viewHistoryRestoring||!id) return;
  const normalized=id==='dashboard'?'cdash':id;
  if(window.history.state?.assetView===normalized) return;
  // 새 문서가 #view=... 딥링크(PC/모바일 미리보기 포함)로 열렸다면
  // 초기 대시보드 렌더가 그 해시를 덮어쓰지 않게 두고 load 복원 단계에서 적용한다.
  const requested=String(location.hash||'').match(/^#view=(.+)$/);
  if(!window.history.state?.assetView&&requested){
    const requestedView=decodeURIComponent(requested[1]);
    if(requestedView!==normalized&&document.getElementById('view-'+requestedView)) return;
  }
  const url='#view='+encodeURIComponent(normalized);
  const state={...(window.history.state||{}),assetView:normalized};
  if(!window.history.state?.assetView) window.history.replaceState(state,'',url);
  else window.history.pushState(state,'',url);
}
window.addEventListener('popstate',ev=>{
  const hashMatch=String(location.hash||'').match(/^#view=(.+)$/);
  const target=ev.state?.assetView||(hashMatch?decodeURIComponent(hashMatch[1]):'cdash');
  if(!document.getElementById('view-'+target)) return;
  _viewHistoryRestoring=true;
  try{ switchView(target,_viewMenuButton(target)); }
  finally{ _viewHistoryRestoring=false; }
});

// =============================================
// 뷰 전환
// =============================================
function switchView(viewId, btn) {
  // 삭제된 뷰 리다이렉트
  if (viewId==='goal') { switchView('dashboard', document.getElementById('menu-dashboard')); return; }
  if (!btn) btn=document.getElementById('menu-'+viewId);
  const viewEl = document.getElementById('view-'+viewId);
  if (!viewEl) return;
  // 현재 활성 뷰가 bubble이었고 떠나는 경우: 레거시 Plotly / Highcharts 인스턴스 정리
  const prevActive = document.querySelector('.view-section.active');
  if (prevActive && prevActive.id === 'view-bubble' && viewId !== 'bubble') {
    if (_bubbleChart) { try { _bubbleChart.destroy(); } catch(e){} _bubbleChart = null; }
  }
  document.querySelectorAll('.menu-btn,.footer-status-btn').forEach(b=>{
    b.classList.remove('active');
    b.removeAttribute('aria-current');
  });
  if(btn){btn.classList.add('active');btn.setAttribute('aria-current','page');}
  expandActiveMenuGroup(btn);
  document.querySelectorAll('.view-section').forEach(v=>v.classList.remove('active')); viewEl.classList.add('active');
  if (isMobileLayout()) closeSidebar();
  // 좌측 탭 전환 시 소유주 버튼을 '전체'로 초기화 — 제목 계산보다 먼저 수행해야 제목과 버튼 상태가 일치
  if (viewId==='dashboard'||viewId==='portfolio'||viewId==='holdings'||viewId==='target_rebal') {
    document.querySelectorAll('#owner-tabs-container .owner-btn').forEach(b=>b.classList.remove('active'));
    const allBtn=document.querySelector('#owner-tabs-container .owner-btn');
    if(allBtn)allBtn.classList.add('active');
    currentOwner='전체';
  }
  const dispOwner = currentOwner==='전체'?'통합':currentOwner;
  const baseTitles={'dashboard':' 자산 관리','portfolio':' 포트폴리오','holdings':' 자산 내역','dividend':'배당 현황 상세','cashflow':'현금 흐름 관리 (가계부)','gift':'유기정기금 증여 현황','family':'가족 자산 현황','analysis':'세금 & 배당 분석','target_rebal':'목표 & 리밸런싱'};
  let title;
  if (viewId==='portfolio') title=`${currentOwner} 자산`;
  else if (viewId==='dashboard'||viewId==='holdings') title=dispOwner+(baseTitles[viewId]||'');
  else if (viewId==='bubble') {
    const _o = _bubbleOwner || currentOwner || '전체';
    const suffix = (_o === '전체') ? '전체 소유주의 포트폴리오 비중 차트' : `${_o}의 포트폴리오 비중 차트`;
    title = suffix;
  }
  else title=baseTitles[viewId]||viewId;
  document.getElementById('main-title').textContent = title;
  const ownerTabsEl = document.getElementById('owner-tabs-container');
  ownerTabsEl.style.display=(viewId==='dashboard'||viewId==='portfolio'||viewId==='holdings'||viewId==='target_rebal')?'flex':'none';
  ownerTabsEl.classList.toggle('holdings-owner-tabs', viewId==='holdings');
  const cfBar = document.getElementById('cf-owner-bar');
  if (cfBar) cfBar.style.display = (viewId==='cashflow') ? 'flex' : 'none';
  const bubbleBar = document.getElementById('bubble-owner-bar');
  if (bubbleBar) bubbleBar.style.display = (viewId==='bubble') ? 'flex' : 'none';
  const analysisBar = document.getElementById('analysis-owner-bar');
  if (analysisBar) analysisBar.style.display = (viewId==='analysis') ? 'flex' : 'none';
  if (viewId==='cashflow') {
    _cfOwner='전체';
    _cfSection='monthly';
    document.querySelectorAll('#cf-owner-bar .owner-btn').forEach(b=>b.classList.remove('active'));
    const allCfBtn=document.getElementById('cf-owner-전체');
    if(allCfBtn)allCfBtn.classList.add('active');
    const ownerInput=document.getElementById('cf-owner-input');if(ownerInput)ownerInput.value='본인';
    resetFixedCostForm();
    switchCashFlowSection('monthly',document.getElementById('cf-section-tab-monthly'));
  }
  if (viewId==='dividend'){if(window.allOwnersDivChartInst)window.allOwnersDivChartInst.resize();if(window.mainDivChartInst)window.mainDivChartInst.resize();renderDivTable(window.activeMainDivMonth);}
  if (viewId==='cashflow'){fetchDivData().then(()=>autoAddDividendCashFlow(true)).catch(e=>console.warn('[autoAddDividendCashFlow]',e));renderAutoTransfers();renderCfDivPanel();renderFixedCostView();requestAnimationFrame(()=>{if(window.cfDonutChartInst)window.cfDonutChartInst.resize();if(window.cfTrendChartInst)window.cfTrendChartInst.resize();renderCashFlow();});}
  if (viewId==='gift'){if(window.giftChartInst)window.giftChartInst.resize();setTimeout(()=>calcGift(),50);}
  if (viewId==='portfolio'){if(portPerfChartInst)portPerfChartInst.resize();renderPortfolioTop3();if(window.allOwnersDivChartInst)window.allOwnersDivChartInst.resize();if(window.mainDivChartInst)window.mainDivChartInst.resize();renderDivTable(window.activeMainDivMonth);renderFxExposure(currentOwner);renderDcaWidget(currentOwner);}
  if (viewId==='holdings'){
    const hOwner = currentOwner;
    _holdingsBrokerFilter = '전체';
    renderPortfolio(hOwner);
    updateNetAssetDisplay();
  }
  if (viewId==='family')renderFamilyView();
  if (viewId==='analysis'){renderAnalysisView();}
  if (viewId==='target_rebal'){renderTargetRebalView();}
  if (viewId==='bubble'){
    // 현재 owner 와 버블 view 의 owner 탭 active 상태 동기화
    _bubbleOwner = currentOwner || '전체';
    document.querySelectorAll('[id^="sunburst-owner-"]').forEach(b => {
      b.classList.toggle('active', b.id === `sunburst-owner-${_bubbleOwner}`);
    });
    renderBubbleChart('weight');
    // 컨테이너 크기 확보를 위해 두 단계 프레임 이후 호출 (display:none → active 직후 layout flush)
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      renderBubbleChart('weight');
      // 안전망: 300ms 후 재확인 – 컨테이너가 그때 준비되었을 수도 있음
      setTimeout(()=>renderBubbleChart('weight'), 300);
    }));
  }
  if (viewId==='dashboard'){}
  // 뷰 활성화 직후 차트들을 새 컨테이너 크기에 재맞춤 (렌더 함수들이 다음 프레임에 캔버스를 만들 수 있어 2회)
  requestAnimationFrame(() => _fitActiveCharts());
  setTimeout(_fitActiveCharts, 350);
  _recordViewHistory(viewId);
}

// =============================================
// 모달 필드 토글
// =============================================
// 자동완성 데이터
// =============================================
// 자동완성: 시장별 로컬DB + price.ts 검색 프록시
// =============================================
const KR_TICKERS = [
  // 코스피 대형주
  {tkr:'005930',name:'삼성전자'},{tkr:'000660',name:'SK하이닉스'},
  {tkr:'005380',name:'현대차'},{tkr:'000270',name:'기아'},
  {tkr:'051910',name:'LG화학'},{tkr:'006400',name:'삼성SDI'},
  {tkr:'055550',name:'신한지주'},{tkr:'105560',name:'KB금융'},
  {tkr:'086790',name:'하나금융지주'},{tkr:'003550',name:'LG'},
  {tkr:'096770',name:'SK이노베이션'},{tkr:'017670',name:'SK텔레콤'},
  {tkr:'030200',name:'KT'},{tkr:'032830',name:'삼성생명'},
  {tkr:'068270',name:'셀트리온'},{tkr:'207940',name:'삼성바이오로직스'},
  {tkr:'028260',name:'삼성물산'},{tkr:'018260',name:'삼성에스디에스'},
  {tkr:'009150',name:'삼성전기'},{tkr:'003490',name:'대한항공'},
  {tkr:'066570',name:'LG전자'},{tkr:'010950',name:'S-Oil'},
  {tkr:'011200',name:'HMM'},{tkr:'012330',name:'현대모비스'},
  {tkr:'032640',name:'LG유플러스'},{tkr:'015760',name:'한국전력'},
  {tkr:'033780',name:'KT&G'},{tkr:'010130',name:'고려아연'},
  {tkr:'000810',name:'삼성화재'},{tkr:'002790',name:'아모레퍼시픽'},
  {tkr:'271560',name:'오리온'},{tkr:'282330',name:'BGF리테일'},
  {tkr:'097950',name:'CJ제일제당'},{tkr:'139480',name:'이마트'},
  {tkr:'004020',name:'현대제철'},{tkr:'005490',name:'POSCO홀딩스'},
  {tkr:'034730',name:'SK'},
  // 코스닥 주요 종목
  {tkr:'035420',name:'NAVER'},{tkr:'035720',name:'카카오'},
  {tkr:'373220',name:'LG에너지솔루션'},{tkr:'196170',name:'알테오젠'},
  {tkr:'247540',name:'에코프로비엠'},{tkr:'086520',name:'에코프로'},
  {tkr:'091990',name:'셀트리온헬스케어'},{tkr:'263750',name:'펄어비스'},
  {tkr:'293490',name:'카카오게임즈'},{tkr:'112040',name:'위메이드'},
  {tkr:'145020',name:'휴젤'},{tkr:'214150',name:'클래시스'},
  {tkr:'259960',name:'크래프톤'},{tkr:'036570',name:'엔씨소프트'},
  {tkr:'251270',name:'넷마블'},{tkr:'078935',name:'GS'},
  {tkr:'034020',name:'두산에너빌리티'},{tkr:'042660',name:'한화오션'},
  {tkr:'047810',name:'한국항공우주'},{tkr:'161390',name:'한국타이어앤테크놀로지'},
  // 네이버/카카오 계열
  {tkr:'035420',name:'네이버'},{tkr:'035420',name:'NAVER(네이버)'},
  {tkr:'302440',name:'SK바이오사이언스'},{tkr:'326030',name:'SK바이오팜'},
  // 로보티즈 등 코스닥
  {tkr:'108490',name:'로보티즈'},{tkr:'090710',name:'휴림로봇'},
  {tkr:'277810',name:'레인보우로보틱스'},{tkr:'215100',name:'에스퓨얼셀'},
  {tkr:'039030',name:'이오테크닉스'},{tkr:'065510',name:'휴비스'},
  {tkr:'078600',name:'대주전자재료'},{tkr:'053800',name:'안랩'},
  {tkr:'950130',name:'엑스페릭스'},{tkr:'241710',name:'코스메카코리아'},
  {tkr:'053210',name:'스카이라이프'},{tkr:'041510',name:'에스엠'},
  {tkr:'035900',name:'JYP Ent'},{tkr:'122870',name:'와이지엔터테인먼트'},
  {tkr:'352820',name:'하이브'},{tkr:'016360',name:'삼성증권'},
  {tkr:'006800',name:'미래에셋증권'},{tkr:'039490',name:'키움증권'},
  {tkr:'071050',name:'한국금융지주'},{tkr:'138040',name:'메리츠금융지주'},
  // ETF
  {tkr:'360750',name:'TIGER 미국S&P500'},{tkr:'069500',name:'KODEX 200'},
  {tkr:'229200',name:'KODEX 코스닥150'},{tkr:'133690',name:'TIGER 미국나스닥100'},
  {tkr:'381170',name:'KODEX 미국S&P500TR'},{tkr:'251340',name:'KODEX 코스피'},
  {tkr:'091160',name:'KODEX반도체'},{tkr:'091180',name:'KODEX 은행'},
  {tkr:'139260',name:'TIGER 200'},{tkr:'148070',name:'KOSEF 200TR'},
  {tkr:'455050',name:'TIGER 미국배당다우존스'},{tkr:'441680',name:'TIGER 미국배당+7%프리미엄다운존스'},
  {tkr:'411060',name:'ACE 미국500'},  {tkr:'460470',name:'TIGER 미국나스닥100커버드콜ATM'},
  {tkr:'385720',name:'TIMEFOLIO Korea플러스배당액티브'},{tkr:'278530',name:'KODEX 200TR'},
];
const CRYPTO_TICKERS = [
  {tkr:'BTC',name:'비트코인'},{tkr:'ETH',name:'이더리움'},
  {tkr:'XRP',name:'리플'},{tkr:'SOL',name:'솔라나'},
  {tkr:'BNB',name:'바이낸스코인'},{tkr:'DOGE',name:'도지코인'},
  {tkr:'ADA',name:'에이다'},{tkr:'AVAX',name:'아발란체'},
];
const US_LOCAL = [
  {symbol:'NVDA',description:'Nvidia Corp'},{symbol:'AAPL',description:'Apple Inc'},
  {symbol:'MSFT',description:'Microsoft Corp'},{symbol:'TSLA',description:'Tesla Inc'},
  {symbol:'AMZN',description:'Amazon.com Inc'},{symbol:'GOOGL',description:'Alphabet Inc'},
  {symbol:'META',description:'Meta Platforms'},{symbol:'JPM',description:'JPMorgan Chase'},
  {symbol:'O',description:'Realty Income Corp'},{symbol:'VOO',description:'Vanguard S&P 500 ETF'},
  {symbol:'QQQ',description:'Invesco QQQ Trust'},{symbol:'SPY',description:'SPDR S&P 500 ETF'},
  {symbol:'SCHD',description:'Schwab US Dividend ETF'},{symbol:'VTI',description:'Vanguard Total Stock Market ETF'},
  {symbol:'JEPI',description:'JPMorgan Equity Premium Income ETF'},{symbol:'JEPQ',description:'JPMorgan Nasdaq Equity Premium Income ETF'},
  {symbol:'VYM',description:'Vanguard High Dividend Yield ETF'},{symbol:'QQQM',description:'Invesco NASDAQ 100 ETF'},
  {symbol:'BRK.B',description:'Berkshire Hathaway'},{symbol:'V',description:'Visa Inc'},
  {symbol:'JNJ',description:'Johnson & Johnson'},{symbol:'XOM',description:'Exxon Mobil'},
  // 레버리지/인버스 ETF
  {symbol:'QLD',description:'ProShares Ultra QQQ (2x)'},
  {symbol:'TQQQ',description:'ProShares UltraPro QQQ (3x)'},
  {symbol:'SQQQ',description:'ProShares UltraPro Short QQQ (-3x)'},
  {symbol:'UPRO',description:'ProShares UltraPro S&P500 (3x)'},
  {symbol:'SPXU',description:'ProShares UltraPro Short S&P500 (-3x)'},
  {symbol:'SOXL',description:'Direxion Daily Semiconductor Bull 3x'},
  {symbol:'SOXS',description:'Direxion Daily Semiconductor Bear 3x'},
  {symbol:'TECL',description:'Direxion Daily Technology Bull 3x'},
  {symbol:'FNGU',description:'MicroSectors FANG+ Index 3x Leveraged'},
  {symbol:'SSO',description:'ProShares Ultra S&P500 (2x)'},
  {symbol:'USD',description:'ProShares Ultra Semiconductors (2x)'},
];

let _searchTimer = null;
let _isComposing = false; // IME 한글 입력 중 플래그
let _hasLocalResults = false; // 로컬 결과 존재 플래그

async function onSearchInput() {
  // IME 조합 중이면 검색 스킵 (한글 입력 완성 전 중간 상태)
  if (_isComposing) return;

  const val = document.getElementById('add-search').value.trim();
  const dd = document.getElementById('search-dropdown');
  const spinner = document.getElementById('search-spinner');
  // 입력 변경 시 이전 검색 결과 패널 숨기기
  const ssr=document.getElementById('stock-search-result');if(ssr)ssr.style.display='none';
  const sse=document.getElementById('stock-search-error');if(sse)sse.style.display='none';
  window._stockSearchResult=null;
  if (!val || val.length < 1) { dd.style.display='none'; _hasLocalResults=false; return; }
  const grp = document.getElementById('add-grp').value;

  // 코인
  if (grp === '가상화폐') {
    const f = CRYPTO_TICKERS.filter(t =>
      t.tkr.toLowerCase().includes(val.toLowerCase()) || t.name.includes(val)
    );
    renderDropdown(f.map(t => ({symbol:t.tkr, description:t.name, market:'CRYPTO'})));
    return;
  }

  if (_searchTimer) clearTimeout(_searchTimer);
  if (spinner) spinner.style.display='block';

  // 한글 포함 또는 6자리 숫자 → KR 검색
  const hasKorean = /[가-힣]/.test(val);
  const isKrCode = /^\d{4,6}$/.test(val);
  const looksKR = hasKorean || isKrCode;

  // 로컬 KR 매칭 먼저 즉시 표시 (중복 제거)
  // ① stocks.json 전수 DB (window._krStocksDB) → ② 소형 KR_TICKERS 배열 순서로 병합
  _hasLocalResults = false;
  if (looksKR) {
    const seen = new Set();
    const combined = [];

    // stocks.json DB에서 검색 (수천 종목)
    const db = window._krStocksDB;
    if (db && (db.byName.size || db.byShort.size || db.byCode.size)) {
      const qRaw = val.trim();
      const qNorm = _normalizeKrName(qRaw);
      const qUpper = qRaw.toUpperCase();
      // 6자리 코드 정확 일치
      if (KR_CODE_RE.test(qUpper)) {
        const meta = db.byCode.get(qUpper.padStart(6, '0'));
        if (meta && !seen.has(meta.code)) {
          seen.add(meta.code);
          combined.push({
            symbol: meta.code + (String(meta.market||'').toUpperCase().includes('KOSDAQ') ? '.KQ' : '.KS'),
            description: meta.name,
            rawTkr: meta.code,
            market: 'KR',
            price: meta.close
          });
        }
      }
      // 부분코드 일치 (숫자 4~5자리 입력 시)
      if (/^\d{1,5}$/.test(qUpper)) {
        for (const [code, meta] of db.byCode) {
          if (code.includes(qUpper)) {
            if (seen.has(code)) continue;
            seen.add(code);
            combined.push({
              symbol: code + (String(meta.market||'').toUpperCase().includes('KOSDAQ') ? '.KQ' : '.KS'),
              description: meta.name,
              rawTkr: code,
              market: 'KR',
              price: meta.close
            });
            if (combined.length >= 20) break;
          }
        }
      }
      // 이름 부분일치 (정규화 후)
      if (qNorm) {
        for (const [nk, meta] of db.byName) {
          if (nk.includes(qNorm)) {
            if (seen.has(meta.code)) continue;
            seen.add(meta.code);
            combined.push({
              symbol: meta.code + (String(meta.market||'').toUpperCase().includes('KOSDAQ') ? '.KQ' : '.KS'),
              description: meta.name,
              rawTkr: meta.code,
              market: 'KR',
              price: meta.close
            });
            if (combined.length >= 20) break;
          }
        }
        if (combined.length < 20) {
          for (const [nk, meta] of db.byShort) {
            if (nk.includes(qNorm)) {
              if (seen.has(meta.code)) continue;
              seen.add(meta.code);
              combined.push({
                symbol: meta.code + (String(meta.market||'').toUpperCase().includes('KOSDAQ') ? '.KQ' : '.KS'),
                description: meta.name,
                rawTkr: meta.code,
                market: 'KR',
                price: meta.close
              });
              if (combined.length >= 20) break;
            }
          }
        }
      }
    }

    // KR_TICKERS 폴백 (DB 로드 실패 시 또는 추가 매칭)
    KR_TICKERS.forEach(t => {
      if (seen.has(t.tkr)) return;
      if (t.tkr.includes(val) || t.name.includes(val)) {
        seen.add(t.tkr);
        combined.push({symbol:t.tkr+'.KS', description:t.name, rawTkr:t.tkr, market:'KR'});
      }
    });

    if (combined.length > 0) {
      renderDropdown(combined);
      _hasLocalResults = true;
    }
  }

  const searchVal = val; // 타이머 콜백에서 사용할 값 캡처
  _searchTimer = setTimeout(async () => {
    // 타이머 실행 시점에 입력값이 변경되었으면 무시
    const currentVal = document.getElementById('add-search').value.trim();
    if (currentVal !== searchVal) { if(spinner) spinner.style.display='none'; return; }

    let found = false;

    try {
      // Node.js 기반의 강력한 검색 API (api/get-stock.ts) 우선 사용
      const res = await authFetch(`/api/get-stock?query=${encodeURIComponent(val)}`);
      const data = await res.json();

      if (data && data.success && data.symbol) {
        const _mkt = data.currency === 'KRW' ? 'KR' : (data.currency === 'JPY' ? 'JP' : 'US');
        renderDropdown([{
          symbol: data.symbol,
          description: data.name,
          rawTkr: data.symbol.replace(/\.(KS|KQ)$/, ''),
          market: _mkt,
          price: data.price
        }]);
        found = true;
      }
    } catch (e) {
      console.warn('[Search API Fallback]', e);
    }

    if (!found) {
      // US 로컬 검색 (오프라인 보조)
      const usF = US_LOCAL.filter(t => t.symbol.toLowerCase().includes(val.toLowerCase()) || t.description.toLowerCase().includes(val.toLowerCase()));
      if (usF.length > 0) { renderDropdown(usF.map(t=>({...t, market:'US'}))); found = true; }
    }

    if (!found && !_hasLocalResults) {
      dd.innerHTML='<div style="padding:12px 14px;font-size:.82rem;color:var(--t3)">종목을 찾을 수 없습니다. (정확한 명칭이나 6자리 코드를 입력하세요)</div>';
      dd.style.display='block';
    }
    if (spinner) spinner.style.display='none';
  }, 400);
}

function renderDropdown(items) {
  const dd = document.getElementById('search-dropdown');
  if (!items || items.length === 0) { dd.style.display='none'; return; }
  const fragment=document.createDocumentFragment();
  items.slice(0,50).forEach(t=>{
    const sym=String(t?.symbol||'').slice(0,32);
    const rawT=String(t?.rawTkr||sym).slice(0,32);
    const desc=String(t?.description||sym).slice(0,160);
    const mktVal=['KR','US','JP'].includes(t?.market)?t.market:'US';
    const priceVal=(typeof t?.price==='number'&&Number.isFinite(t.price)&&t.price>0)?t.price:'';
    const button=document.createElement('button');
    button.type='button';
    button.className='stock-search-option';
    button.style.cssText='width:100%;padding:10px 14px;cursor:pointer;font-size:.85rem;border:0;border-bottom:1px solid var(--border-light);display:flex;justify-content:space-between;align-items:center;color:var(--t1);background:transparent;text-align:left';
    const name=document.createElement('span');
    name.style.cssText='font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px;color:var(--t1)';
    name.textContent=desc;
    const ticker=document.createElement('span');
    ticker.style.cssText='color:var(--t3);font-size:.75rem;background:var(--border-dark);padding:2px 6px;border-radius:4px;flex-shrink:0;margin-left:8px';
    ticker.textContent=sym;
    button.append(name,ticker);
    button.addEventListener('click',()=>selectTicker(sym,desc,rawT,mktVal,priceVal));
    fragment.appendChild(button);
  });
  dd.replaceChildren(fragment);
  dd.style.display='block';
}

function selectTicker(tkr, name, rawTkr, market, price) {
  const storeTkr = rawTkr || tkr.replace(/\.(KS|KQ)$/, '');
  document.getElementById('add-search').value = name + ' (' + tkr + ')';
  document.getElementById('search-dropdown').style.display='none';
  document.getElementById('add-search').dataset.tkr = storeTkr;
  document.getElementById('add-search').dataset.name = name;
  // stocks.json 종가 등 선택 시점 가격을 avgp 기본값으로 채움 (사용자 수정 가능)
  const _priceNum = parseFloat(price);
  if (Number.isFinite(_priceNum) && _priceNum > 0) {
    const avgpEl = document.getElementById('add-avgp');
    if (avgpEl && !avgpEl.value) {
      avgpEl.value = (market==='KR'||market==='KOSPI'||market==='KOSDAQ'||market==='JP') ? Math.round(_priceNum) : parseFloat(_priceNum.toFixed(4));
    }
  }
  // [3] 선택한 종목의 시장 정보로 hidden input + 화폐 select 자동 세팅
  const mktEl = document.getElementById('add-market');
  const curEl = document.getElementById('add-currency-stock');
  if (market === 'KR' || market === 'KOSPI' || market === 'KOSDAQ') {
    if(mktEl) mktEl.value = 'KR';
    if(curEl) curEl.value = 'KRW';
    document.getElementById('add-search').dataset.market = 'KR';
  } else if (market === 'JP') {
    if(mktEl) mktEl.value = 'JP';
    if(curEl) curEl.value = 'JPY';
    document.getElementById('add-search').dataset.market = 'JP';
  } else if (market === 'CRYPTO') {
    if(mktEl) mktEl.value = 'CRYPTO';
    if(curEl) curEl.value = 'USD';
    document.getElementById('add-search').dataset.market = 'CRYPTO';
  } else {
    if(mktEl) mktEl.value = 'US';
    if(curEl) curEl.value = 'USD';
    document.getElementById('add-search').dataset.market = 'US';
  }
  // 화폐 select가 보이면 값 업데이트
  const cRowEl = document.getElementById('wrap-currency-row');
  if(cRowEl && cRowEl.style.display !== 'none' && curEl){
    // 이미 세팅됨
  }
  updateAvgpDecimalMode();
}

// ─── 🔍 get-stock.js 기반 종목 검색 (버튼 클릭) ─────────────────────────
async function searchStockByApi() {
  const val = (document.getElementById('add-search').value || '').trim();
  if (!val) return;

  const loading = document.getElementById('stock-search-loading');
  const result  = document.getElementById('stock-search-result');
  const errBox  = document.getElementById('stock-search-error');
  const manual  = document.getElementById('stock-manual-entry');

  if (result)  result.style.display  = 'none';
  if (errBox)  errBox.style.display  = 'none';
  if (manual)  manual.style.display  = 'none';
  if (loading) loading.style.display = 'block';

  const showManualFallback = (reason) => {
    if (errBox) {
      errBox.innerHTML = `${reason} <br><span style="color:var(--t3);font-size:.7rem">외부 조회에 실패했습니다. 아래에서 직접 입력할 수 있습니다.</span>`;
      errBox.style.display = 'block';
    }
    if (manual) {
      // 입력값으로 초기 채우기
      const mTkr = document.getElementById('manual-tkr');
      const mName = document.getElementById('manual-name');
      if (mTkr && !mTkr.value) mTkr.value = /^[A-Za-z0-9.]+$/.test(val) ? val.toUpperCase() : '';
      if (mName && !mName.value) mName.value = val;
      manual.style.display = 'block';
    }
  };

  try {
    const res = await authFetch('/api/get-stock?query=' + encodeURIComponent(val));
    const data = await res.json().catch(()=>null);

    if (loading) loading.style.display = 'none';

    if (data && data.success) {
      // 2. 결과 미리보기 섹션 업데이트
      const nameEl = document.getElementById('result-name');
      const symEl = document.getElementById('result-symbol');
      const priceEl = document.getElementById('result-price');
      const priceStr = data.currency === 'KRW'
        ? '₩' + Math.round(data.price).toLocaleString()
        : '$' + (data.price || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});

      if (nameEl) nameEl.textContent = data.name;
      if (symEl) symEl.textContent = data.symbol;
      if (priceEl) priceEl.textContent = priceStr;

      window._stockSearchResult = data;
      if (result) result.style.display = 'block';
      if (errBox) errBox.style.display = 'none';
      if (manual) manual.style.display = 'none';
    } else {
      showManualFallback('검색 결과를 찾을 수 없습니다.');
    }
  } catch (e) {
    if (loading) loading.style.display = 'none';
    console.error('[searchStockByApi] Error:', e);
    showManualFallback('네트워크 오류가 발생했습니다.');
  }
}

// 외부 API 실패 시 수동으로 입력한 티커/종목명/현재가 적용
function confirmManualStock() {
  const tkrEl = document.getElementById('manual-tkr');
  const nameEl = document.getElementById('manual-name');
  const priceEl = document.getElementById('manual-price');
  const rawTkr = (tkrEl?.value || '').trim().toUpperCase();
  const name = (nameEl?.value || '').trim() || rawTkr;
  const priceRaw = (priceEl?.value || '').replace(/,/g,'').trim();
  const price = parseFloat(priceRaw);
  if (!rawTkr || isNaN(price) || price <= 0) {
    alert('티커와 현재가를 올바르게 입력하세요.');
    return;
  }
  // 종목 시장 판별
  const isKR = /^\d{6}$/.test(rawTkr);
  const isJP = /^\d{4}$/.test(rawTkr) || rawTkr.endsWith('.T');
  const isCrypto = ['BTC','ETH','XRP','SOL','BNB','DOGE','ADA','AVAX','MATIC','DOT','LINK','UNI','ATOM','LTC','TRX'].includes(rawTkr);
  const market = isKR ? 'KR' : (isJP ? 'JP' : (isCrypto ? 'CRYPTO' : 'US'));
  const cur = isKR ? 'KRW' : (isJP ? 'JPY' : 'USD');
  // 일본 4자리 코드는 .T 접미사로 정규화 (Yahoo Finance 조회용)
  const finalTkr = (isJP && /^\d{4}$/.test(rawTkr)) ? rawTkr + '.T' : rawTkr;

  const srch = document.getElementById('add-search');
  if (srch) {
    srch.value = name + ' (' + finalTkr + ')';
    srch.dataset.tkr = finalTkr;
    srch.dataset.name = name;
    srch.dataset.market = market;
  }
  const mktEl = document.getElementById('add-market');
  const curSel = document.getElementById('add-currency-stock');
  if (mktEl) mktEl.value = market;
  if (curSel) curSel.value = cur;
  updateAvgpDecimalMode();

  // 평균단가 입력란 자동 채움 (사용자가 수정 가능)
  const avgpEl = document.getElementById('add-avgp');
  if (avgpEl && !avgpEl.value) avgpEl.value = (isKR || isJP) ? Math.round(price) : parseFloat(price.toFixed(4));

  // 내부 선택 캐시 (confirmStockSelection 호환)
  window._stockSearchResult = {
    name, symbol: rawTkr, price, currency: cur,
    quoteType: isCrypto ? 'CRYPTOCURRENCY' : 'EQUITY', manual: true
  };
  // 결과 카드도 표시
  const result = document.getElementById('stock-search-result');
  const nameOutEl = document.getElementById('result-name');
  const symOutEl = document.getElementById('result-symbol');
  const priceOutEl = document.getElementById('result-price');
  if (nameOutEl) nameOutEl.textContent = name + ' (수동 입력)';
  if (symOutEl) symOutEl.textContent = rawTkr;
  if (priceOutEl) priceOutEl.textContent = cur === 'KRW'
    ? '₩' + Math.round(price).toLocaleString()
    : cur === 'JPY'
      ? '¥' + Math.round(price).toLocaleString()
      : '$' + price.toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2});
  if (result) result.style.display = 'block';
  const manual = document.getElementById('stock-manual-entry'); if (manual) manual.style.display = 'none';
  const errBox = document.getElementById('stock-search-error'); if (errBox) errBox.style.display = 'none';
}

// 검색 결과 확인 → 종목 선택 확정
function confirmStockSelection() {
  const d = window._stockSearchResult;
  if (!d) return;

  const sym    = d.symbol || '';
  const name   = d.name   || sym;
  const isKR   = sym.endsWith('.KS') || sym.endsWith('.KQ');
  const isJP   = sym.endsWith('.T') || d.currency === 'JPY';
  const isCrypto = d.quoteType === 'CRYPTOCURRENCY';
  const market = isKR ? 'KR' : (isJP ? 'JP' : (isCrypto ? 'CRYPTO' : 'US'));
  const rawTkr = isKR ? sym.replace(/\.(KS|KQ)$/, '') : sym;
  const cur    = isKR ? 'KRW' : (isJP ? 'JPY' : 'USD');

  // 검색창에 선택 반영
  const srch = document.getElementById('add-search');
  srch.value = name + ' (' + sym + ')';
  srch.dataset.tkr    = rawTkr;
  srch.dataset.name   = name;
  srch.dataset.market = market;

  // 화폐 자동 세팅
  const mktEl = document.getElementById('add-market');
  const curEl = document.getElementById('add-currency-stock');
  if (mktEl) mktEl.value = market;
  if (curEl) curEl.value = cur;
  updateAvgpDecimalMode();

  // 현재가 평균단가 자동 채우기 (사용자가 수정 가능)
  const avgpEl = document.getElementById('add-avgp');
  if (avgpEl && d.price && !avgpEl.value) {
    avgpEl.value = (isKR || isJP) ? Math.round(d.price) : parseFloat(d.price.toFixed(4));
  }

  // 결과 패널 닫기
  const result = document.getElementById('stock-search-result');
  if (result) result.style.display = 'none';
  document.getElementById('search-dropdown').style.display = 'none';
  window._stockSearchResult = null;
}

function onMarketChange() {
  const market = document.getElementById('add-market').value;
  const currSel = document.getElementById('add-currency-stock');
  const wrapCurr = document.getElementById('wrap-currency-stock');
  if (market === 'US') { if(currSel)currSel.value='USD'; if(wrapCurr)wrapCurr.style.display='flex'; }
  else if (market === 'KR') { if(currSel)currSel.value='KRW'; if(wrapCurr)wrapCurr.style.display='none'; }
  else if (market === 'JP') { if(currSel)currSel.value='JPY'; if(wrapCurr)wrapCurr.style.display='flex'; }
  else if (market === 'CRYPTO') { if(currSel)currSel.value='USD'; if(wrapCurr)wrapCurr.style.display='flex'; }
  else { if(wrapCurr)wrapCurr.style.display='flex'; }
  updateAvgpDecimalMode();
  document.getElementById('add-search').value='';
  document.getElementById('add-search').dataset.tkr='';
  document.getElementById('add-search').dataset.name='';
  document.getElementById('search-dropdown').style.display='none';
}

function toggleDcaDetail() {
  const isDca = document.getElementById('add-dca').checked;
  document.getElementById('wrap-dca-detail').style.display = isDca ? 'block' : 'none';
  document.getElementById('row-qty-price').style.display = isDca ? 'none' : 'flex';
  if (isDca) { toggleDcaDay(); toggleDcaMode(); }
}

function toggleDcaMode() {
  const mode = document.querySelector('input[name="dca-mode"]:checked')?.value || 'amount';
  const wAmt = document.getElementById('wrap-dca-amt');
  const wQty = document.getElementById('wrap-dca-qty');
  if (wAmt) wAmt.style.display = mode === 'qty' ? 'none' : '';
  if (wQty) wQty.style.display = mode === 'qty' ? '' : 'none';
  const curSel = document.getElementById('add-dca-cur');
  if (curSel) curSel.style.display = mode === 'qty' ? 'none' : '';
}

function toggleDcaDay() {
  const cycle = document.getElementById('add-dca-cycle').value;
  const wk = document.getElementById('wrap-dca-day-week');
  const mo = document.getElementById('wrap-dca-day-month');
  if (wk) wk.style.display = cycle === '매주' ? 'block' : 'none';
  if (mo) mo.style.display = cycle === '매월' ? 'block' : 'none';
}

function showToast(msg, duration=3000) {
  let el = document.getElementById('dca-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dca-toast';
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--acc);color:#fff;padding:10px 20px;border-radius:20px;font-size:.85rem;font-weight:600;z-index:9999;pointer-events:none;transition:opacity .3s';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, duration);
}

// ── 시장 휴장일 (NYSE / KRX / JPX) ───────────────────────────────
// 연도별 하드코딩 대신 규칙으로 생성하고, 선거일처럼 규칙화할 수 없는 날짜만 명시한다.
const _MARKET_HOLIDAY_CACHE=new Map();
const _KR_ONE_OFF_HOLIDAYS=new Set(['2026-06-03']); // 전국 단위 선거일 등 확정 공휴일
function _dateAtNoon(y,m,d){return new Date(y,m,d,12,0,0,0);}
function _addDateKey(set,date){set.add(_cfLocalDateKey(date));}
function _nthWeekday(y,m,weekday,n){
  const d=_dateAtNoon(y,m,1);d.setDate(1+((7+weekday-d.getDay())%7)+(n-1)*7);return d;
}
function _lastWeekday(y,m,weekday){
  const d=_dateAtNoon(y,m+1,0);d.setDate(d.getDate()-((7+d.getDay()-weekday)%7));return d;
}
function _addObservedFixed(set,y,m,d){
  const actual=_dateAtNoon(y,m,d);_addDateKey(set,actual);
  const observed=new Date(actual);
  if(actual.getDay()===6)observed.setDate(observed.getDate()-1);
  else if(actual.getDay()===0)observed.setDate(observed.getDate()+1);
  _addDateKey(set,observed);
}
function _easterSunday(y){
  const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31)-1,day=((h+l-7*m+114)%31)+1;
  return _dateAtNoon(y,month,day);
}
function _usMarketHolidaySet(y){
  const key=`US:${y}`;if(_MARKET_HOLIDAY_CACHE.has(key))return _MARKET_HOLIDAY_CACHE.get(key);
  const set=new Set();
  _addObservedFixed(set,y,0,1);_addObservedFixed(set,y+1,0,1);
  _addDateKey(set,_nthWeekday(y,0,1,3));
  _addDateKey(set,_nthWeekday(y,1,1,3));
  const goodFriday=_easterSunday(y);goodFriday.setDate(goodFriday.getDate()-2);_addDateKey(set,goodFriday);
  _addDateKey(set,_lastWeekday(y,4,1));
  _addObservedFixed(set,y,5,19);_addObservedFixed(set,y,6,4);
  _addDateKey(set,_nthWeekday(y,8,1,1));
  _addDateKey(set,_nthWeekday(y,10,4,4));
  _addObservedFixed(set,y,11,25);
  _MARKET_HOLIDAY_CACHE.set(key,set);return set;
}
function _krLunarParts(date){
  try{
    const parts=new Intl.DateTimeFormat('en-u-ca-chinese',{month:'numeric',day:'numeric'}).formatToParts(date);
    return {month:Number(parts.find(p=>p.type==='month')?.value),day:Number(parts.find(p=>p.type==='day')?.value)};
  }catch(e){return {month:0,day:0};}
}
function _krHolidaySet(y,includeMarketClosures=true){
  const key=`KR:${y}:${includeMarketClosures?'market':'bank'}`;if(_MARKET_HOLIDAY_CACHE.has(key))return _MARKET_HOLIDAY_CACHE.get(key);
  const set=new Set(),substituteGroups=[];
  const addGroup=dates=>{dates.forEach(d=>_addDateKey(set,d));substituteGroups.push(dates);};
  [[0,1],[2,1],[4,5],[5,6],[7,15],[9,3],[9,9],[11,25]].forEach(([m,d])=>_addDateKey(set,_dateAtNoon(y,m,d)));
  _addDateKey(set,_dateAtNoon(y,4,1)); // 금융기관·거래소 근로자의 날 휴무
  if(y>=2026)_addDateKey(set,_dateAtNoon(y,6,17));
  let cursor=_dateAtNoon(y,0,1);
  while(cursor.getFullYear()===y){
    const lunar=_krLunarParts(cursor);
    if((lunar.month===1&&lunar.day===1)||(lunar.month===8&&lunar.day===15)){
      const dates=[-1,0,1].map(offset=>{const d=new Date(cursor);d.setDate(d.getDate()+offset);return d;});addGroup(dates);
    }else if(lunar.month===4&&lunar.day===8){addGroup([new Date(cursor)]);}
    cursor.setDate(cursor.getDate()+1);
  }
  [[2,1],[4,5],[7,15],[9,3],[9,9],[11,25]].forEach(([m,d])=>substituteGroups.push([_dateAtNoon(y,m,d)]));
  substituteGroups.forEach(group=>{
    if(!group.some(d=>d.getDay()===0||d.getDay()===6))return;
    const next=new Date(group[group.length-1]);
    do{next.setDate(next.getDate()+1);}while(next.getDay()===0||next.getDay()===6||set.has(_cfLocalDateKey(next)));
    if(next.getFullYear()===y)_addDateKey(set,next);
  });
  _KR_ONE_OFF_HOLIDAYS.forEach(d=>{if(d.startsWith(String(y)+'-'))set.add(d);});
  if(includeMarketClosures){
    let yearEnd=_dateAtNoon(y,11,31);while(yearEnd.getDay()===0||yearEnd.getDay()===6)yearEnd.setDate(yearEnd.getDate()-1);_addDateKey(set,yearEnd);
  }
  _MARKET_HOLIDAY_CACHE.set(key,set);return set;
}
function _jpEquinoxDay(y,autumn=false){
  return Math.floor((autumn?23.2488:20.8431)+0.242194*(y-1980)-Math.floor((y-1980)/4));
}
function _jpMarketHolidaySet(y){
  const key=`JP:${y}`;if(_MARKET_HOLIDAY_CACHE.has(key))return _MARKET_HOLIDAY_CACHE.get(key);
  const set=new Set(),base=[];
  const add=(m,d)=>{const x=_dateAtNoon(y,m,d);base.push(x);_addDateKey(set,x);};
  add(0,1);add(0,2);add(0,3);_addDateKey(set,_nthWeekday(y,0,1,2));
  add(1,11);add(1,23);add(2,_jpEquinoxDay(y,false));add(3,29);add(4,3);add(4,4);add(4,5);
  _addDateKey(set,_nthWeekday(y,6,1,3));add(7,11);_addDateKey(set,_nthWeekday(y,8,1,3));add(8,_jpEquinoxDay(y,true));
  _addDateKey(set,_nthWeekday(y,9,1,2));add(10,3);add(10,23);add(11,31);
  // 일요일 공휴일의 대체휴일
  Array.from(set).forEach(dateKey=>{
    const [yy,mm,dd]=dateKey.split('-').map(Number),d=_dateAtNoon(yy,mm-1,dd);if(d.getDay()!==0)return;
    do{d.setDate(d.getDate()+1);}while(set.has(_cfLocalDateKey(d)));if(d.getFullYear()===y)_addDateKey(set,d);
  });
  // 두 공휴일 사이의 평일은 국민의 휴일
  for(let d=_dateAtNoon(y,0,2);d.getFullYear()===y;d.setDate(d.getDate()+1)){
    if(d.getDay()===0||d.getDay()===6||set.has(_cfLocalDateKey(d)))continue;
    const prev=new Date(d),next=new Date(d);prev.setDate(prev.getDate()-1);next.setDate(next.getDate()+1);
    if(set.has(_cfLocalDateKey(prev))&&set.has(_cfLocalDateKey(next)))_addDateKey(set,d);
  }
  _MARKET_HOLIDAY_CACHE.set(key,set);return set;
}
function _isKrPublicHoliday(date){return _krHolidaySet(date.getFullYear(),false).has(_cfLocalDateKey(date));}

function _getDcaMarket(item) {
  if (item.grp === '가상화폐') return 'CRYPTO'; // 24/7 no holidays
  if (item.cur === 'USD') return 'US';
  if (item.cur === 'JPY') return 'JP';
  return 'KR';
}

function _isDcaHoliday(dateObj, market) {
  const d = dateObj.getDay(); // 0=Sun, 6=Sat
  if (market !== 'CRYPTO' && (d === 0 || d === 6)) return true;
  const ds = _cfLocalDateKey(dateObj),y=dateObj.getFullYear();
  if (market === 'US') return _usMarketHolidaySet(y).has(ds);
  if (market === 'KR') return _krHolidaySet(y,true).has(ds);
  if (market === 'JP') return _jpMarketHolidaySet(y).has(ds);
  return false;
}

// DCA 주기 레이블 (holdings 표시용)
function getDcaCycleLabel(item) {
  if (item.dcaCycle === '매일') return '매일';
  if (item.dcaCycle === '매주') {
    const days = Array.isArray(item.dcaDays) ? item.dcaDays : (item.dcaDay !== undefined ? [item.dcaDay] : [1]);
    const names = ['일','월','화','수','목','금','토'];
    return '매주 ' + days.slice().sort((a,b)=>a-b).map(d => names[d]).join('·');
  }
  const day=Math.max(1,Math.min(31,Number(item.dcaDay)||1));
  return `매월 ${day}일`;
}

// 자산 내역 표의 DCA 주기 칼럼 — 별도 배지 없이 주기만 표시한다.
function getDcaCellHtml(item){
  if (!item || !item.dca) return '<span style="color:var(--t3)">—</span>';
  return `<span class="dca-cycle">${getDcaCycleLabel(item)}</span>`;
}

// 자산 내역 표의 회당 DCA 금액/수량 칼럼.
function getDcaAmountCellHtml(item){
  if (!item || !item.dca) return '<span style="color:var(--t3)">—</span>';
  const isQty = item.dcaMode === 'qty';
  const sym = item.dcaCur === 'USD' ? '$' : '₩';
  const unit = item.grp === '가상화폐' ? '개' : '주';
  const amt = isQty
    ? (Number(item.dcaQty)||0).toLocaleString(undefined,{maximumFractionDigits:4}) + unit
    : sym + (Number(item.dcaAmt)||0).toLocaleString();
  return `<span class="dca-amount">${amt}</span>`;
}
function holdingsEsc(s){
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function updateOverflowTooltip(el){
  if (!el) return false;
  const watches = el.querySelectorAll('[data-overflow-watch]');
  const targets = watches.length ? Array.from(watches) : [el];
  const clipped = targets.some(node=>node.scrollWidth > node.clientWidth + 1);
  if (clipped) el.setAttribute('data-tip', el.getAttribute('data-overflow-tip') || '');
  else el.removeAttribute('data-tip');
  return clipped;
}
if (typeof document!=='undefined' && !window._overflowTipEventsBound){
  window._overflowTipEventsBound = true;
  document.addEventListener('mouseover', e=>{
    const el = e.target.closest?.('[data-overflow-tip]');
    if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    updateOverflowTooltip(el);
  }, true);
  document.addEventListener('mouseout', e=>{
    const el = e.target.closest?.('[data-overflow-tip]');
    if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    el.removeAttribute('data-tip');
  }, true);
}
function getTableFloatTip(){
  let tip = document.getElementById('table-float-tip');
  if (!tip){
    tip = document.createElement('div');
    tip.id = 'table-float-tip';
    tip.className = 'table-float-tip';
    tip.setAttribute('role','tooltip');
    document.body.appendChild(tip);
  }
  return tip;
}
function formatTableFloatTipText(text){
  return String(text || '').replace(/([.!?])\s+(?=\S)/g, (all, mark, offset, source) => {
    const before = source.slice(Math.max(0, offset - 12), offset + 1);
    // 회사명·영문 약어 안의 마침표는 문장 경계로 취급하지 않는다.
    if (/(?:Inc|Corp|Co|Ltd|L\.P|S\.A|U\.S|e\.g|i\.e)\.$/i.test(before)) return all;
    return mark + '\n';
  });
}
function positionTableFloatTip(tip, anchor){
  if (!tip || !anchor) return;
  const gap = 8;
  const ar = anchor.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  let left = ar.left + Math.min(ar.width/2, 90) - tr.width/2;
  left = Math.max(12, Math.min(left, window.innerWidth - tr.width - 12));
  let top = ar.top - tr.height - gap;
  if (top < 12) top = Math.min(window.innerHeight - tr.height - 12, ar.bottom + gap);
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(Math.max(12,Math.min(top,window.innerHeight-tr.height-12)))}px`;
}
function showTableFloatTip(anchor){
  const text = anchor && anchor.getAttribute('data-tip');
  if (!text) return;
  const tip = getTableFloatTip();
  tip.textContent = formatTableFloatTipText(text);
  tip.style.display = 'block';
  tip._anchor = anchor;
  positionTableFloatTip(tip, anchor);
}
function hideTableFloatTip(anchor){
  const tip = document.getElementById('table-float-tip');
  if (!tip || (anchor && tip._anchor && tip._anchor!==anchor)) return;
  tip.style.display = 'none';
  tip._anchor = null;
}
if (typeof document!=='undefined' && !window._tableFloatTipEventsBound){
  window._tableFloatTipEventsBound = true;
  document.addEventListener('mouseover', e=>{
    const el = e.target.closest?.('[data-tip]');
    if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    showTableFloatTip(el);
  }, true);
  document.addEventListener('mouseout', e=>{
    // 오버플로 툴팁은 앞선 mouseout 핸들러가 data-tip을 먼저 제거하므로
    // 원본 data-overflow-tip까지 대상으로 잡아 body 포털이 남지 않게 한다.
    const el = e.target.closest?.('[data-tip],[data-overflow-tip]');
    if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    hideTableFloatTip(el);
  }, true);
  document.addEventListener('scroll', ()=>{
    const tip = document.getElementById('table-float-tip');
    if (tip && tip.style.display!=='none' && tip._anchor) positionTableFloatTip(tip, tip._anchor);
  }, true);
  window.addEventListener('resize', ()=>hideTableFloatTip());
}
function getHoldingsBrokerCellHtml(item){
  const broker = item.broker || '—';
  const account = item.acc || '—';
  return `<span class="holdings-inline-cell cb-tip-block" data-overflow-tip="${holdingsEsc(broker+' / '+account)}">`
    + `<span class="broker-txt" data-overflow-watch>${holdingsEsc(broker)}</span>`
    + `<span class="holdings-account" data-overflow-watch>/ ${holdingsEsc(account)}</span></span>`;
}
function getHoldingsAssetCellHtml(name,ticker,item){
  const parts = [name,ticker].filter(Boolean);
  let flag = '';
  if (item) {
    const market = item.cur==='USD' ? 'US' : item.cur==='JPY' ? 'JP' : 'KR';
    if ((item.grp==='주식'||item.grp==='현금') && typeof _mktFlagSvg==='function') {
      flag = `<span class="holdings-asset-flag">${_mktFlagSvg(market,15)}</span>`;
    } else if (item.grp==='금') {
      flag = '<span class="holdings-asset-flag" aria-label="금"><svg width="23" height="15" viewBox="0 0 36 24" aria-hidden="true"><polygon points="5,9 14,3.5 30,6 21,11.5" fill="#ffe18a"/><polygon points="5,9 21,11.5 21,19 5,16.2" fill="#d9a520"/><polygon points="21,11.5 30,6 30,13.2 21,19" fill="#a96f0b"/></svg></span>';
    } else if (item.grp==='가상화폐') {
      flag = '<span class="holdings-asset-flag holdings-crypto-flag" aria-label="가상화폐">₿</span>';
    }
  }
  return `<span class="holdings-inline-cell cb-tip-block" data-overflow-tip="${holdingsEsc(parts.join(' · '))}">`
    + flag
    + `<strong class="holdings-inline-name" data-overflow-watch>${holdingsEsc(name||'—')}</strong>`
    + (ticker?`<span class="tkr-txt holdings-inline-ticker" data-overflow-watch>${holdingsEsc(ticker)}</span>`:'')
    + `</span>`;
}
function portfolioSortHeader(group,field,label){
  const safeGroup=['주식','가상화폐','금'].includes(group)?group:'주식';
  const safeField=['qty','avgP','curP','valKRW','profit','profitPct'].includes(field)?field:'qty';
  return `<th class="sortable" aria-sort="none"><button type="button" class="table-sort-btn" onclick="sortPortfolioTable('${safeGroup}','${safeField}',this)">${holdingsEsc(label)}</button></th>`;
}

// 다음 체결 예정일 계산 (시장 휴장일·주말 자동 스킵)
function getDcaNextDateStr(item) {
  const market = _getDcaMarket(item);
  const todayStr = _cfLocalDateKey(new Date());
  const ref = item.dcaLastExec && item.dcaLastExec >= todayStr ? item.dcaLastExec : todayStr;
  const start = _localDateFromKey(ref);
  if(!Number.isFinite(start.getTime()))return '';
  if (item.dcaLastExec && item.dcaLastExec < todayStr) {
    start.setDate(start.getDate() + 1);
  }

  // 매일: 첫 번째 비휴장일
  if (item.dcaCycle === '매일') {
    for (let i = 0; i < 30; i++) {
      if (!_isDcaHoliday(start, market)) return _cfLocalDateKey(start);
      start.setDate(start.getDate() + 1);
    }
    return _cfLocalDateKey(start);
  }

  // 매주: 지정 요일 중 비휴장일인 날
  if (item.dcaCycle === '매주') {
    const days = Array.isArray(item.dcaDays) ? item.dcaDays : (item.dcaDay !== undefined ? [item.dcaDay] : [1]);
    for (let i = 0; i < 30; i++) {
      if (days.includes(start.getDay()) && !_isDcaHoliday(start, market)) return _cfLocalDateKey(start);
      start.setDate(start.getDate() + 1);
    }
  }

  // 매월: 지정일(또는 그 다음 비휴장일)
  const day = item.dcaDay || 1;
  for (let i = 0; i < 40; i++) {
    if (start.getDate() === day) {
      // 해당 날짜가 휴장일이면 다음 영업일로 밀기
      let exec = new Date(start);
      for (let j = 0; j < 7; j++) {
        if (!_isDcaHoliday(exec, market)) return _cfLocalDateKey(exec);
        exec.setDate(exec.getDate() + 1);
      }
      return _cfLocalDateKey(exec);
    }
    start.setDate(start.getDate() + 1);
  }
  return '';
}

function countWeekdaysBetween(lastExecStr, todayStr, days) {
  let count = 0;
  const start = _localDateFromKey(lastExecStr);
  start.setDate(start.getDate() + 1);
  const end = _localDateFromKey(todayStr);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (days.includes(d.getDay())) count++;
  }
  return count;
}

function countMonthDaysBetween(lastExecStr, todayStr, day) {
  let count = 0;
  const start = _localDateFromKey(lastExecStr);
  start.setDate(start.getDate() + 1);
  const end = _localDateFromKey(todayStr);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDate() === day) count++;
  }
  return count;
}

async function applyPendingDCA() {
  // DCA는 각 증권사에 등록된 외부 자동주문 규칙이다.
  // 실제 주문/체결 내역을 수신하지 않는 대시보드가 보유수량·평균단가·체결일을
  // 임의로 변경하지 않도록 과거 자동 반영 엔진을 무변경 호환 함수로 남긴다.
  return { applied: 0, mode: 'schedule-only' };
}

function stopDca(owner, tkr, idx = -1) {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  // 인덱스 기반 조회 우선 (중복 티커·다계좌 지원)
  const item = (idx >= 0 && pfolioData[idx]) ? pfolioData[idx]
             : pfolioData.find(i => i.tkr === tkr && i.owner === owner);
  if (!item) return;
  if (!confirm(`${item.name} DCA 자동매수를 중단하시겠습니까?`)) return;
  item.dca = false;
  syncDivHistory();
  changeOwner(currentOwner, null, true);
  saveAssetsToKV();
}

function toggleCostUnknown() {
  const checked=!!document.getElementById('add-cost-unknown')?.checked;
  const avg=document.getElementById('add-avgp');
  if(!avg) return;
  avg.disabled=checked;
  avg.style.opacity=checked?'.45':'1';
  avg.placeholder=checked?'취득가 미상':'0';
  if(checked) avg.value='';
}

function toggleModalFields() {
  const grp = document.getElementById('add-grp').value;
  const isStock = grp === '주식';
  const isCrypto = grp === '가상화폐';
  const isGold = grp === '금';
  const isCash = grp === '현금';
  document.getElementById('row-market-search').style.display = (isCash || isGold) ? 'none' : 'block';
  document.getElementById('row-gold-name').style.display = isGold ? 'block' : 'none';
  document.getElementById('row-qty-price').style.display = isCash ? 'none' : 'flex';
  document.getElementById('row-cash-only').style.display = isCash ? 'block' : 'none';
  document.getElementById('wrap-dca-toggle').style.display = (isStock || isCrypto) ? 'block' : 'none';
  const unknownWrap=document.getElementById('wrap-cost-unknown');
  if(unknownWrap) unknownWrap.style.display=isGold?'block':'none';
  if(!isGold){
    const unknown=document.getElementById('add-cost-unknown');
    if(unknown) unknown.checked=false;
  }
  toggleCostUnknown();

  const unitFixed = document.getElementById('unit-fixed');
  const unitSel = document.getElementById('add-unit');

  const cRow=document.getElementById('wrap-currency-row');
  if (isGold) {
    if(unitFixed)unitFixed.style.display='none';
    if(unitSel)unitSel.style.display='flex';
    if(cRow)cRow.style.display='none';
    document.getElementById('label-qty').innerText='수량 / 단위';
    const qtyElG=document.getElementById('add-qty');
    if(qtyElG){delete qtyElG.dataset.decimal;qtyElG.setAttribute('inputmode','numeric');}
  } else if (isCrypto) {
    if(cRow)cRow.style.display='none';
    if(unitFixed){unitFixed.innerText='개';unitFixed.style.display='flex';}
    if(unitSel)unitSel.style.display='none';
    const mktEl=document.getElementById('add-market');if(mktEl)mktEl.value='CRYPTO';
    const curEl=document.getElementById('add-currency-stock');if(curEl)curEl.value='USD';
    document.getElementById('label-qty').innerText='수량 (개)';
    // 코인 수량은 소수점 허용 (0.001 BTC 등)
    const qtyEl=document.getElementById('add-qty');
    if(qtyEl){qtyEl.dataset.decimal='1';qtyEl.setAttribute('inputmode','decimal');}
  } else if (isStock) {
    if(unitFixed){unitFixed.innerText='주';unitFixed.style.display='flex';}
    if(unitSel)unitSel.style.display='none';
    document.getElementById('label-qty').innerText='수량 (주)';
    const qtyElS=document.getElementById('add-qty');
    if(qtyElS){qtyElS.dataset.decimal='1';qtyElS.setAttribute('inputmode','decimal');}
    // 화폐 선택 표시 (주식만)
    const cRow=document.getElementById('wrap-currency-row');
    if(cRow)cRow.style.display='flex';
    onMarketChange();
  }
}

// =============================================
// 자산 내역 - 단일 페이지 렌더 (탭 제거, 수직 나열)
// =============================================
function switchHoldingsTab(tab, btn) {
  // 레거시 탭 전환 API - 단일 페이지에서는 스크롤 이동으로 대체
  const el = document.getElementById('htab-'+tab);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function applyHoldingsOwnerFilter() {
  const sel = document.getElementById('holdings-owner-filter');
  if (!sel) return;
  renderPortfolio(sel.value);
}

function applyHoldingsBrokerFilter() {
  const sel = document.getElementById('holdings-broker-filter');
  if (!sel) return;
  _holdingsBrokerFilter = sel.value;
  renderPortfolio(currentOwner);
}

// =============================================
// 히트맵 (Highcharts Treemap)
// =============================================
async function fetchHeatmapData() {
  try {
    const _hmFetch = fetchTimeout(15000);
    const res = await authFetch('/api/price?type=heatmap', { signal: _hmFetch.signal });
    _hmFetch.done();
    const data = await res.json();
    if (data.success&&data.heatmap) {
      heatmapData = data.heatmap;
      renderTreemap('us');
      renderTreemap('kr');
    } else {
      _showHeatmapError('us'); _showHeatmapError('kr');
    }
  } catch(e){
    console.error('Heatmap err:',e);
    _showHeatmapError('us'); _showHeatmapError('kr');
  }
}

function _showHeatmapError(market) {
  const el = document.getElementById('heatmap-'+market);
  if (!el) return;
  el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;min-height:120px;color:var(--t3);font-size:.8rem;">히트맵 데이터를 불러오지 못했습니다</div>';
}

function renderTreemap(market) {
  if (!heatmapData[market]||heatmapData[market].length===0) { _showHeatmapError(market); return; }
  const period = currentHmPeriod[market];
  const chartData = heatmapData[market].map(s=>{
    const perf = (s.returns && s.returns[period]) || 0;
    return {name:s.name, value:s.marketCap||100, colorValue:parseFloat(perf.toFixed(2)), perfStr:fmtPct(perf,2)};
  });
  const containerId = 'heatmap-'+market;
  // 툴팁 색을 테마에 맞춰 반전 — 라이트는 흰 박스+어두운 글씨, 다크/네이비는 어두운 박스+밝은 글씨
  const _hmDark = isDarkTheme();
  const _hmTipBg = _hmDark ? 'rgba(20,24,32,0.96)' : 'rgba(255,255,255,0.96)';
  const _hmTipName = _hmDark ? '#f2f5fa' : '#222';
  const _hmTipSub = _hmDark ? '#c7cdd8' : '#333';
  const opts = {
    chart:{type:'treemap',backgroundColor:'transparent',margin:0,spacing:[0,0,0,0],style:{fontFamily:'DM Sans'}},
    title:{text:null},credits:{enabled:false},
    colorAxis:{min:-3,max:3,stops:[[0,'#EF4444'],[0.5,'#475569'],[1,'#10B981']]},
    tooltip:{useHTML:true,pointFormat:'<b style="color:'+_hmTipName+'">{point.name}</b><br/><span style="color:'+_hmTipSub+'">등락률: {point.perfStr}</span>',backgroundColor:_hmTipBg,borderColor:_hmDark?'rgba(255,255,255,0.14)':'rgba(0,0,0,0.10)'},
    series:[{type:'treemap',layoutAlgorithm:'squarified',data:chartData,
      dataLabels:{enabled:true,align:'center',style:{color:'#ffffff',textOutline:'none',fontWeight:'bold',fontSize:'11px'}},
      borderWidth:1,borderColor:'rgba(255,255,255,0.15)'}]
  };
  if (market==='us'){if(usTreemap)usTreemap.destroy();usTreemap=Highcharts.chart(containerId,opts);}
  else{if(krTreemap)krTreemap.destroy();krTreemap=Highcharts.chart(containerId,opts);}
}

function changeHmPeriod(market, period, btnElem) {
  currentHmPeriod[market]=period;
  const btnParent=document.getElementById('hm-period-'+market);
  if (btnParent) btnParent.querySelectorAll('.hm-btn').forEach(b=>b.classList.remove('active'));
  btnElem.classList.add('active');
  // 1D만 실시간, 나머지는 안내 표시
  if (period!=='1D') {
    const containerId='heatmap-'+market;
    const el=document.getElementById(containerId);
    if(el) el.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--t3);font-size:.8rem;">'+period+' 데이터는 Finnhub 유료 플랜에서 지원됩니다.<br>1D 버튼으로 실시간 데이터를 확인하세요.</div>';
    return;
  }
  renderTreemap(market);
}

// =============================================
// 계좌별 도넛 데이터
// =============================================
function buildAccDonutData(owner) {
  const items=getFilteredAssets(owner);
  // 항상 계좌종류 기준 (기본값), 드릴다운 시 자산군 표시
  const byAcc=Object.create(null);const grpsByAcc=Object.create(null);
  items.forEach(i=>{
    const val=i.qty*i.curP*(RATES[i.cur]||1);
    byAcc[i.acc]=(byAcc[i.acc]||0)+val;
    if(!grpsByAcc[i.acc])grpsByAcc[i.acc]=Object.create(null);
    grpsByAcc[i.acc][i.grp]=(grpsByAcc[i.acc][i.grp]||0)+val;
  });
  const entries=Object.entries(byAcc).sort((a,b)=>b[1]-a[1]);
  return{labels:entries.map(([k])=>k),data:entries.map(([,v])=>Math.round(v)),bg:entries.map((_,i)=>CHART_PALETTE[i%CHART_PALETTE.length]),grpsByAcc};
}

// =============================================
// changeOwner - 메인 렌더링
// =============================================
function changeOwner(owner, btn, isRefresh=false) {
  currentOwner=owner;
  if (!isRefresh){_donutMainLevel='top';_donutAccLevel='top';window.activeDivMonth=-1;window.activeMainDivMonth=-1;}
  // 메인 owner 탭(#owner-tabs-container)만 갱신 — cashflow/bubble 등 별도 owner 바의 활성 상태는
  // 사용자가 해당 바 버튼을 직접 클릭했을 때만 변경되도록 격리한다 (수동 새로고침 시 소유주 이동 방지)
  if (btn){document.querySelectorAll('#owner-tabs-container .owner-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');}
  else{document.querySelectorAll('#owner-tabs-container .owner-btn').forEach(b=>{if(b.innerText===owner)b.classList.add('active');else b.classList.remove('active');});}

  // 소유주명 타이틀 반영 (현재 활성 뷰에 따라 타이틀 업데이트)
  const dispOwnerTitle = owner==='전체' ? '통합' : owner;
  const mainTitleEl = document.getElementById('main-title');
  if (mainTitleEl) {
    const activeViewEl = document.querySelector('.view-section.active');
    const activeViewId = activeViewEl ? activeViewEl.id.replace('view-','') : 'dashboard';
    const baseTitles = {'dashboard':' 자산 관리','portfolio':' 포트폴리오','holdings':' 자산 내역'};
    if (baseTitles[activeViewId] !== undefined) {
      if (activeViewId==='portfolio') mainTitleEl.textContent = `${owner} 자산`;
      else mainTitleEl.textContent = dispOwnerTitle + baseTitles[activeViewId];
    }
  }

  // holdings 소유주 필터 동기화
  const hof = document.getElementById('holdings-owner-filter');
  if (hof) hof.value = owner;

  const filtered=getFilteredAssets(owner);
  renderPortfolio(owner);updatePortPerfChart(owner);updateSectorChart(owner);renderFxExposure(owner);renderDcaWidget(owner);

  let gT=0,gInv=0,gKnownT=0;
  let grpTotals={'주식':0,'가상화폐':0,'금':0,'현금':0};
  let bestArr=[],worstArr=[];
  filtered.forEach(i=>{
    let r=RATES[i.cur]||1;
    let curVal, invVal;
    if (i.grp==='금') {
      // 금: curP는 단위당 가격 (g당, 또는 돈당), 단위 변환 없이 직접 사용
      curVal = i.qty * i.curP;
      invVal = i.qty * i.avgP;
    } else if (i.grp==='가상화폐' && i.cur==='USD') {
      // 가상화폐: curP는 USD, avgP는 KRW(>=1000만) 또는 USD(<1000만)으로 저장
      // BTC가 $1M 이상이 되는 경우를 대비해 임계값을 10M으로 설정
      const _avgIsUSD = i.avgP > 0 && i.avgP < 10000000;
      curVal = i.qty * i.curP * r;
      invVal = i.qty * (_avgIsUSD ? i.avgP * r : i.avgP);
    } else {
      curVal=i.qty*i.curP*r; invVal=i.qty*i.avgP*r;
    }
    gT+=curVal;grpTotals[i.grp]+=curVal;
    if(!i.costUnknown){gInv+=invVal;gKnownT+=curVal;}
    if (i.grp!=='현금'&&!i.costUnknown){
      let pRate=invVal>0?((curVal-invVal)/invVal)*100:0;
      let profit=Math.round(curVal-invVal);
      let nmStr=owner==='전체'?`[${i.owner}] ${i.name}`:i.name;
      bestArr.push({nm:nmStr,r:pRate,f:fmtPct(pRate,1),profit});
      worstArr.push({nm:nmStr,r:pRate,f:fmtPct(pRate,1),profit});
    }
  });
  bestArr.sort((a,b)=>b.r-a.r);worstArr.sort((a,b)=>a.r-b.r);
  let dProfit=gKnownT-gInv,dPct=gInv>0?(dProfit/gInv)*100:0;

  const _cfNet=(owner==='전체'||owner==='본인')?cfData.reduce((s,i)=>i.type==='수입'?s+i.amt:s-i.amt,0):0;
  const _dispTotal=gT;
  document.getElementById('dash-val-total').innerText=_dispTotal===0?'₩0':`₩${Math.round(_dispTotal).toLocaleString()}`;
  document.getElementById('dash-val-total').style.fontFamily="'IBM Plex Mono',monospace";
  const _pvEl=document.getElementById('dash-portfolio-val');if(_pvEl)_pvEl.innerText='₩'+Math.round(gT).toLocaleString();
  const _cfEl=document.getElementById('dash-cf-val');if(_cfEl){_cfEl.innerText=(_cfNet>=0?'₩':'-₩')+Math.abs(Math.round(_cfNet)).toLocaleString();_cfEl.className=_cfNet>=0?'c-up':'c-dn';}
  const elOver=document.getElementById('dash-val-over');
  elOver.innerText=`${dProfit>=0?'+':''}₩${Math.round(Math.abs(dProfit)).toLocaleString()} (${dProfit>=0?'+':''}${dPct.toFixed(2)}%)`;
  elOver.className=dProfit>=0?'c-up':'c-dn';

  // DAILY: 전일 종가 대비 일간 변동 (시세 갱신 시 저장한 prevP/dayP 기반 — 주식/가상화폐만, 금/현금은 전일가 없음)
  const elDay=document.getElementById('dash-val-day');
  if(elDay){
    let dDay=0,dBase=0;
    filtered.forEach(i=>{
      if((i.grp==='주식'||i.grp==='가상화폐')&&i.dayP!=null&&i.prevP>0&&!i._priceStale){
        const r=RATES[i.cur]||1;
        dDay+=i.qty*i.dayP*r;
        dBase+=i.qty*i.prevP*r;
      }
    });
    if(dBase>0){
      const dDayPct=(dDay/dBase)*100;
      elDay.innerText=`${dDay>=0?'+':'-'}₩${Math.round(Math.abs(dDay)).toLocaleString()} (${dDay>=0?'+':''}${dDayPct.toFixed(2)}%)`;
      elDay.className=dDay>=0?'c-up':'c-dn';
    }else{
      elDay.innerText='-';
      elDay.className='c-dn';
    }
  }

  // Portfolio top3 위젯 업데이트
  const portBest=document.getElementById('port-best-widget'),portWorst=document.getElementById('port-worst-widget');
  if(portBest)portBest.innerHTML=`<div class="card-title">보유종목 수익률 TOP 3</div>`+bestArr.slice(0,3).map(b=>{const pAmt='('+(b.profit>=0?'+₩':'-₩')+Math.abs(b.profit).toLocaleString()+')',safeNm=holdingsEsc(b.nm);return`<div class="item-row f-between" title="${safeNm}" style="gap:4px;min-height:0;padding:4px 0"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:.78rem">${safeNm}</span><span style="display:flex;gap:4px;flex-shrink:0;align-items:center"><span class="c-up" style="font-size:.78rem;font-weight:700">${b.f}</span><span class="c-up" style="font-size:.72rem;font-family:'IBM Plex Mono',monospace">${pAmt}</span></span></div>`;}).join('');
  if(portWorst){
    const lossOnly=worstArr.filter(b=>b.r<0).slice(0,3);
    const lossHtml=lossOnly.length>0
      ? lossOnly.map(b=>{const pAmt='('+(b.profit>=0?'+₩':'-₩')+Math.abs(b.profit).toLocaleString()+')',safeNm=holdingsEsc(b.nm);return`<div class="item-row f-between" title="${safeNm}" style="gap:4px;min-height:0;padding:4px 0"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:.78rem">${safeNm}</span><span style="display:flex;gap:4px;flex-shrink:0;align-items:center"><span class="c-dn" style="font-size:.78rem;font-weight:700">${b.f}</span><span class="c-dn" style="font-size:.72rem;font-family:'IBM Plex Mono',monospace">${pAmt}</span></span></div>`;}).join('')
      : `<div style="padding:8px 0;color:var(--t3);font-size:.78rem;text-align:center">손실 종목이 없습니다 🎉</div>`;
    portWorst.innerHTML=`<div class="card-title" style="color:var(--dn)">보유종목 손실률 TOP 3</div>`+lossHtml;
  }
  if (!isRefresh) {const db=document.getElementById('div-breakdown');if(db)db.style.display='none';}

  if (myDonutChart) {
    // 소유주별 자산배분 (한국주식/해외주식/연금/가상화폐/금/현금)
    const catTotals={'한국주식':0,'해외주식':0,'연금':0,'가상화폐':0,'금':0,'현금':0};
    filtered.forEach(i=>{
      const val=i.qty*i.curP*(RATES[i.cur]||1);
      if(i.grp==='가상화폐') catTotals['가상화폐']+=val;
      else if(i.grp==='현금') catTotals['현금']+=val;
      else if(i.grp==='금'){catTotals['금']+=i.qty*i.curP;}
      else if(i.grp==='주식'){
        if((i.acc||'').match(/연금|IRP/)) catTotals['연금']+=val;
        else if(i.cur==='KRW') catTotals['한국주식']+=val;
        else catTotals['해외주식']+=val;
      }
    });
    const catColors={'한국주식':'#4ecdc4','해외주식':'#5b9bff','연금':'#c084fc','가상화폐':'#f2a33c','금':'#d4b24a','현금':'#94a3c8'};
    const catOrder=['한국주식','해외주식','연금','가상화폐','금','현금'];
    const dLabels=[],dData=[],dBg=[];
    const totalVal=catOrder.reduce((s,c)=>s+(catTotals[c]>0?catTotals[c]:0),0)||1;
    catOrder.forEach(cat=>{if(catTotals[cat]>0){dLabels.push(`${cat} (${Math.round(catTotals[cat]/totalVal*100)}%)`);dData.push(Math.round(catTotals[cat]));dBg.push(catColors[cat]);}});
    myDonutChart.data.labels=dLabels;myDonutChart.data.datasets[0].data=dData;myDonutChart.data.datasets[0].backgroundColor=dBg;myDonutChart.update();
    document.getElementById('donut-main-title').innerHTML='자산 배분';
  }
  updateNetAssetDisplay();
  if (myAccDonutChart) {
    const acc=buildAccDonutData(owner);
    myAccDonutChart.data.labels=acc.labels;myAccDonutChart.data.datasets[0].data=acc.data;myAccDonutChart.data.datasets[0].backgroundColor=acc.bg;
    myAccDonutChart._grpsByAcc=acc.grpsByAcc;myAccDonutChart.update();
    _setAccountDonutTitle();
  }
  if (myBarChart) {
    // 국내 자산(KRW 기준)은 종목명, 해외 자산은 티커로 표시. 현금은 사용자 입력 이름.
    const _t5map=new Map();
    filtered.forEach(i=>{
      const isCash = i.grp==='현금' || /^(KRW|USD)(_|$)/.test(i.tkr);
      const isKR = (i.cur === 'KRW') || /\.(KS|KQ)$/i.test(i.tkr||'') || /^[0-9A-Z]{6}$/.test(String(i.tkr||'').replace(/\.(KS|KQ)$/i,''));
      const displayName = (isCash || isKR) ? (i.name || i.tkr) : (i.tkr || i.name);
      const nm = owner==='전체'?`[${i.owner}] ${displayName}`:displayName;
      const val = i.qty*i.curP*(RATES[i.cur]||1);
      // 같은 소유주의 동일 종목은 계좌가 달라도 비중 합산 (현금은 이름 기준 유지)
      const key = (i.owner||'본인')+'|'+(isCash?(i.tkr||displayName):normTkr(i.tkr));
      const ex=_t5map.get(key);
      if(ex) ex.val+=val; else _t5map.set(key,{nm,val});
    });
    const top5=[..._t5map.values()].sort((a,b)=>b.val-a.val).slice(0,5);
    myBarChart.data.labels=top5.map(t=>t.nm);
    myBarChart.data.datasets[0].data=top5.map(t=>Math.round(t.val));
    myBarChart.data.datasets[0].backgroundColor=top5.map((_,idx)=>CHART_PALETTE[idx%CHART_PALETTE.length]);
    myBarChart.update();
  }
  updateValueChartYear();

  // 벤치마크 차트는 소유주 변경 시 데이터셋을 전부 재구성 (단일 진입점)
  rerenderBenchmark();

  syncDivHistory();
  if (miniDivChart){const y=document.getElementById('valYearSelect')?.value;miniDivChart.data.datasets[0].data=divHistoryOf(y,currentOwner);miniDivChart.update();}
  if (window.mainDivChartInst){
    const y=(document.getElementById('mainDivYearSelect')||document.getElementById('divYearSelect'))?.value||'2026';
    const divArr=((divHistory[y]||{})[currentOwner]||Array(12).fill(0)).map(v=>Math.round(v));
    const hasDiv=divArr.some(v=>v>0);
    window.mainDivChartInst.data.datasets[0].data=divArr;
    window.mainDivChartInst.data.datasets[0].backgroundColor=ownerColors[currentOwner]||'#06B6D4';
    window.mainDivChartInst.update();
    document.getElementById('div-owner-title').innerText=currentOwner;
    // no-data overlay
    const divCanvas=document.getElementById('mainDivChart');
    if(divCanvas){
      let overlay=divCanvas.parentElement.querySelector('.div-no-data-overlay');
      if(!hasDiv){
        if(!overlay){overlay=document.createElement('div');overlay.className='div-no-data-overlay';overlay.style.cssText='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(var(--inner-bg-rgb,240,244,255),.75);border-radius:8px;font-size:.82rem;color:var(--t3);pointer-events:none;z-index:5';overlay.textContent='배당 데이터를 조회할 수 없습니다.';}
        const par=divCanvas.parentElement;if(par&&par.style)par.style.position='relative';
        if(!divCanvas.parentElement.contains(overlay))divCanvas.parentElement.appendChild(overlay);
      } else {
        if(overlay)overlay.remove();
      }
    }
    renderDivTable(window.activeMainDivMonth!==undefined?window.activeMainDivMonth:-1);
  }
  if (window.allOwnersDivChartInst){
    const y=document.getElementById('valYearSelect').value||'2026';
    OWNERS.forEach((o,i)=>{
      window.allOwnersDivChartInst.data.datasets[i].data=divHistoryOf(y,o).map(v=>Math.round(v));
    });
    window.allOwnersDivChartInst.update();
  }

  const dispOwner=owner==='전체'?'통합':owner;
  document.getElementById('port-perf-title').innerHTML=dispOwner+' 자산 퍼포먼스 <span style="font-size:.65rem;font-weight:normal;color:var(--acc)">(막대 클릭 → 종목별)</span>';
  document.getElementById('port-val-total').innerText=gT===0?'₩0':`₩${Math.round(gT).toLocaleString()}`;
  const pRateEl=document.getElementById('port-val-rate'),pOverEl=document.getElementById('port-val-over');
  pRateEl.innerText=`${dProfit>=0?'+':''}${dPct.toFixed(2)}%`;pOverEl.innerText=`${dProfit>=0?'+':''}₩${Math.round(Math.abs(dProfit)).toLocaleString()}`;
  pRateEl.className=dProfit>=0?'val-lg c-up':'val-lg c-dn';pOverEl.className=dProfit>=0?'c-up':'c-dn';
  
  // [프리미엄 개선] 버블 차트 자산 마인드맵 동기화
  _bubbleOwner = owner;
  if(typeof renderBubbleChart==='function'){
    const activeView = document.querySelector('.view-section.active');
    if(activeView && activeView.id==='view-bubble') renderBubbleChart('weight');
  }

  // 배당 심화 / 목표 & 리밸런싱 view 에서도 owner 변경 시 즉시 재렌더
  const dpActive = document.getElementById('view-dividend_plus')?.classList.contains('active');
  if (dpActive) {
    window._divPlusOwner = owner;
    if (typeof _divpRenderYocTable === 'function') _divpRenderYocTable(owner);
    if (typeof _divpRenderCagrTable === 'function') _divpRenderCagrTable(owner);
    if (typeof _divpFillDripDropdown === 'function') _divpFillDripDropdown(owner);
    if (typeof renderDripSimulator === 'function') renderDripSimulator();
  }
  const trActive = document.getElementById('view-target_rebal')?.classList.contains('active');
  if (trActive) {
    if (typeof renderTargetRebalView === 'function') renderTargetRebalView();
    if (typeof _advisorRefreshForOwner === 'function') _advisorRefreshForOwner();
  }
}

// =============================================
// 포트폴리오 가치 차트 연도 업데이트
// =============================================
function updateValueChartYear() {
  const y=document.getElementById('valYearSelect').value;
  // 금은 curP가 단위당 가격 (환율 불필요), 그 외 assets는 RATES 적용
  const totalNow=Math.round(getFilteredAssets(currentOwner).reduce((a,b)=>a+(b.grp==='금'?b.qty*b.curP:b.qty*b.curP*(RATES[b.cur]||1)),0));
  const allMonthLabels=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const curMonth=new Date().getMonth(); // 0-based, April = 3
  let dVals, dLbls=allMonthLabels;
  if(y===String(new Date().getFullYear())){
    // 1월~현재월은 추정 데이터, 이후는 null (선 끊김)
    const base=Math.round(totalNow*0.82);
    const step=curMonth>0?(totalNow-base)/curMonth:0;
    dVals=allMonthLabels.map((_,i)=>i<=curMonth?Math.round(base+step*i):null);
  } else {
    // 2025 전체 추정
    dVals=allMonthLabels.map((_,i)=>Math.round(totalNow*(0.63+(0.82-0.63)*i/11)));
  }
  if (miniDivChart){miniDivChart.data.datasets[0].data=divHistoryOf(y,currentOwner);miniDivChart.update();}
  if (miniValueChart){miniValueChart.data.labels=dLbls;miniValueChart.data.datasets[0].data=dVals;miniValueChart.update();}
}

function updateBenchmark(tf,btn) {
  if(btn) btn.parentElement.querySelectorAll('.tf-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  const bd=benchData[tf];
  if(!bd) return;
  const hasData = arr => Array.isArray(arr) && arr.some(v => v!=null);
  // 항상 4인의 개별 소유주 라인을 표시('전체' 합산 라인 제외). 선택된 소유주만 강조.
  const realOwners = OWNERS.filter(o => hasData(bd.data[o]));
  const selOwner = (currentOwner !== '전체' && realOwners.includes(currentOwner)) ? currentOwner : null;
  const oc = BENCH_OWNER_COLORS;  // 자녀1은 KOSPI(녹색)와 겹치지 않도록 벤치마크 전용 색상 사용
  const buildDatasets = () => [
    {label:'S&P 500',data:bd.data['S&P 500']||[],borderColor:'#4ade80',tension:.4,borderWidth:2,pointRadius:0,spanGaps:true},
    {label:'KOSPI',data:bd.data['KOSPI']||[],borderColor:'#f2a33c',tension:.4,borderWidth:2,pointRadius:0,spanGaps:true},
    ...realOwners.map(o=>{
      const isSel = selOwner === o;
      const dim   = selOwner && !isSel;            // 특정 소유주 선택 시에만 나머지를 흐리게
      return {
        label:o,
        data:bd.data[o]||[],
        borderColor: dim ? oc[o]+'80' : oc[o],     // 80 ≈ 50% 알파(8자리 hex) — 흐림이 너무 옅어 '사라진 것처럼' 보이던 문제 완화
        tension:.4,
        borderDash: isSel ? [] : [5,5],            // 선택=실선, 그 외=점선
        borderWidth: isSel ? 3.4 : (dim ? 1.6 : 2),// 선택=굵게, 흐림=얇게, 무선택=기본
        pointRadius:0,
        spanGaps:true
      };
    })
  ];
  if(myBenchChart){
    myBenchChart.data.labels=bd.labels;
    myBenchChart.data.datasets=buildDatasets();
    myBenchChart.update();
  }
  if(myPortBenchChart){
    myPortBenchChart.data.labels=bd.labels;
    myPortBenchChart.data.datasets=buildDatasets();
    myPortBenchChart.update();
  }
}

// 활성 TF를 유지한 채 벤치마크 차트만 재렌더 (소유주 토글, KV 로드 직후 등)
function rerenderBenchmark() {
  const panel = document.querySelector('#portBenchChart')?.closest('.glass-panel');
  const activeBtn = panel?.querySelector('.tf-btn.active');
  if (!activeBtn) return;
  const tf = activeBtn.textContent.trim();
  if (benchData[tf]) updateBenchmark(tf, activeBtn);
}

// =============================================
// 포트폴리오 테이블
// =============================================
function makeEditable(el,owner,tkr,field,isCash=false,itemIdx=-1) {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  if(el.querySelector('input')||el.querySelector('select'))return;
  // 인덱스 기반 조회 우선 (중복 티커 지원)
  const item = (itemIdx >= 0 && pfolioData[itemIdx]) ? pfolioData[itemIdx] : pfolioData.find(i=>i.tkr===tkr&&i.owner===owner);
  if(!item)return;
  const originalHTML=el.innerHTML;
  const originalValue=item[field]; // 원래 값 저장 (ESC 복원용)
  const input=document.createElement('input');
  input.type='text';
  input.className='editable-input';
  input.style.cssText='width:'+(isCash?'110px':'80px')+';min-width:60px;max-width:120px;padding:3px 5px;font-size:.75rem;border:1px solid var(--acc);border-radius:4px;background:var(--modal-bg);color:var(--t1);font-family:IBM Plex Mono,monospace;display:inline-block;box-sizing:border-box';
  if(item.grp==='현금'&&field==='qty') input.style.width='110px';
  input.value = (item.grp==='가상화폐'&&field==='avgP') ? Math.round(item.avgP) : item[field];
  let cancelled=false;
  let isSaving=false;
  const save=async()=>{
    if(cancelled||isSaving)return;
    isSaving=true;
    const rawVal=input.value.replace(/,/g,'');
    const newValue=parseFloat(rawVal);
    if(!isNaN(newValue)&&newValue!==originalValue){
      item[field]=newValue;
      if(isCash){item.curP=1;item.avgP=1;}
      syncDivHistory();changeOwner(currentOwner,null,true);await saveAssetsToKV();
    } else {el.innerHTML=originalHTML;}
  };
  input.onblur=save;
  input.onkeydown=e=>{
    if(e.key==='Enter'){input.blur();}
    if(e.key==='Escape'){
      cancelled=true;
      el.innerHTML=originalHTML; // 원래 표시로 복원 (blur 이후 save 무시됨)
    }
  };
  el.innerHTML='';el.appendChild(input);input.focus();input.select();
}

function renderPortfolio(owner) {
  const items=getFilteredAssets(owner);
  const groups={'주식':[],'가상화폐':[],'금':[],'현금':[]};
  items.forEach(i=>{if(groups[i.grp])groups[i.grp].push(i);});
  // 주식 증권사·계좌 필터: 옵션은 주식 종목에서만 수집
  const stockCombos=[];
  const _stockSeen=new Set();
  groups['주식'].forEach(i=>{
    const key=(i.broker||'')+_BROKER_ACC_SEP+(i.acc||'');
    if(!_stockSeen.has(key)){_stockSeen.add(key);stockCombos.push({broker:i.broker||'',acc:i.acc||'',key});}
  });
  stockCombos.sort((a,b)=>{const br=a.broker.localeCompare(b.broker);return br!==0?br:a.acc.localeCompare(b.acc);});
  if(_holdingsBrokerFilter!=='전체'&&!_stockSeen.has(_holdingsBrokerFilter))_holdingsBrokerFilter='전체';
  const brokerFilterHtml=`<span class="holdings-broker-filter-inline" onclick="event.stopPropagation()" style="align-items:center;gap:6px;margin-left:10px">`
    +`<span style="font-size:.72rem;color:var(--t3);font-weight:600">증권사·계좌 필터</span>`
    +`<select id="holdings-broker-filter" class="form-input" style="width:auto;padding:3px 8px;font-size:.75rem;height:auto" onchange="applyHoldingsBrokerFilter()">`
    +`<option value="전체"${_holdingsBrokerFilter==='전체'?' selected':''}>전체</option>`
    +stockCombos.map(c=>`<option value="${holdingsEsc(c.key)}"${_holdingsBrokerFilter===c.key?' selected':''}>${holdingsEsc(c.broker||'(미지정)')} / ${holdingsEsc(c.acc||'(미지정)')}</option>`).join('')
    +`</select></span>`;
  let html='',totalPfolioValue=0;
  const showOwner=owner==='전체';
  // [2] 가상화폐 포함 전체 원화 환산
  items.forEach(i=>{
    let val=0;
    if(i.grp==='금'){const gm=i.unit==='돈'?3.75:(i.unit==='kg'?1000:1);val=i.qty*gm*(window._GOLD_G_KRW||i.curP);}
    else{val=i.qty*i.curP*(RATES[i.cur]||1);}
    totalPfolioValue+=val;
  });
  ['주식','가상화폐','금','현금'].forEach(grpName=>{
    let grpItems=groups[grpName];
    // 주식 그룹만 선택된 증권사·계좌 조합으로 필터링
    if(grpName==='주식'&&_holdingsBrokerFilter!=='전체'){
      const _si=_holdingsBrokerFilter.indexOf(_BROKER_ACC_SEP);
      const fb=_holdingsBrokerFilter.slice(0,_si),fa=_holdingsBrokerFilter.slice(_si+_BROKER_ACC_SEP.length);
      grpItems=grpItems.filter(i=>(i.broker||'')===fb&&(i.acc||'')===fa);
    }
    // 정렬: 소유주 → 증권사 → 계좌 → 종목명 오름차순 (자산군은 섹션 자체가 분리)
    grpItems.sort((a,b)=>{
      const oa=OWNERS.indexOf(a.owner), ob=OWNERS.indexOf(b.owner);
      const ow=(oa<0?99:oa)-(ob<0?99:ob); if(ow!==0)return ow;
      const br=(a.broker||'').localeCompare(b.broker||'','ko'); if(br!==0)return br;
      const ac=(a.acc||'').localeCompare(b.acc||'','ko'); if(ac!==0)return ac;
      return (a.name||a.tkr||'').localeCompare(b.name||b.tkr||'','ko');
    });
    let grpTotal=0,grpInvest=0,grpKnownTotal=0,grpKnownCount=0,rowsHtml='';
    const colspan=grpName==='현금' ? (showOwner?6:5) : (showOwner?12:11);
    if(grpItems.length===0){rowsHtml=`<tr><td colspan="${colspan}" style="text-align:center;padding:30px;color:var(--t3)">등록된 자산 내역이 없습니다.</td></tr>`;}
    else{
      grpItems.forEach(i=>{
        const pIdx=pfolioData.indexOf(i); // 중복 티커 대비 인덱스 기반
        let ownerTag=showOwner?`<td class="text-left holdings-owner-cell"><span class="holdings-owner"><span class="holdings-owner-dot" style="background:${ownerColors[i.owner]||'#8a97b0'}"></span>${holdingsEsc(i.owner||'미지정')}</span></td>`:'';
        const brokerCell=getHoldingsBrokerCellHtml(i);
        let mgmtBtns=`<span class="holdings-actions"><button class="btn-action" type="button" aria-label="${holdingsEsc(i.name||i.tkr||'자산')} 수정" style="color:var(--t3)" onclick="event.stopPropagation();editItem('','',${pIdx})">✎</button><button class="btn-action" type="button" aria-label="${holdingsEsc(i.name||i.tkr||'자산')} 삭제" style="color:var(--dn)" onclick="event.stopPropagation();deleteItem('','',${pIdx})">✕</button></span>`;

        if(grpName==='현금'){
          // [8] 현금: 정렬, 검정폰트, 클릭편집
          const krwRate=RATES[i.cur]||1;
          const cashKRW=Math.round(i.qty*krwRate);
          const symCur=i.cur==='USD'?'$':(i.cur==='JPY'?'¥':'₩');
          const fBal=symCur+(Number(i.qty)||0).toLocaleString();
          const fKRW='₩'+cashKRW.toLocaleString();
          grpTotal+=cashKRW;grpInvest+=cashKRW;
          // [8] 클릭으로 잔액 수정
          const fBalEdit=`<button type="button" class="editable-val editable-val-button" aria-label="잔액 수정" onclick="makeEditable(this,'','','qty',true,${pIdx})">${fBal}</button>`;
          // [9] 자산명 + 통화 배지 나란히
          rowsHtml+=`<tr>${ownerTag}<td class="text-left holdings-tooltip-cell">${brokerCell}</td><td class="text-left holdings-tooltip-cell">${getHoldingsAssetCellHtml(i.name,i.cur,i)}</td><td style="text-align:right;font-weight:600;color:var(--t1)">${fBalEdit}</td><td style="font-weight:600;color:var(--t1);text-align:right">${fKRW}</td><td class="mgmt-cell">${mgmtBtns}</td></tr>`;

        } else if(grpName==='금'){
          // [7] 금: g기준 실시간 원화, 헤더 수정
          const gm=i.unit==='돈'?3.75:(i.unit==='kg'?1000:1);
          const goldG=window._GOLD_G_KRW||i.curP;
          const curPKRW=Math.round(goldG*gm);
          const avgPKRW=Math.round(i.avgP);
          const current=i.qty*curPKRW;
          const invest=i.costUnknown?0:i.qty*avgPKRW;
          const {profit, pct:profitPct}=i.costUnknown?{profit:0,pct:0}:calcProfit(current, invest);
          if(!i.costUnknown){grpInvest+=invest;grpKnownTotal+=current;grpKnownCount++;}
          grpTotal+=current;
          const cCls=profit>0?'c-up':(profit<0?'c-dn':''),sign=profit>0?'+':'';
          const fQty=`<button type="button" class="editable-val editable-val-button" aria-label="수량 수정" onclick="makeEditable(this,'','','qty',false,${pIdx})">${(Number(i.qty)||0).toLocaleString()}</button> <span style="font-size:.65rem;color:var(--t3)">${holdingsEsc(i.unit||'g')}</span>`;
          const fAvg=i.costUnknown?'<span class="cost-unknown-badge">취득가 미상</span>':`₩<button type="button" class="editable-val editable-val-button" aria-label="평균단가 수정" onclick="makeEditable(this,'','','avgP',false,${pIdx})">${avgPKRW.toLocaleString()}</button>`;
          // [7] 현재가 괄호 뒤 제거
          const fCurP='₩'+curPKRW.toLocaleString();
          const fAmt=fmtMoney(current);
          // [7] 수익금에 (₩)
          const fProfit=i.costUnknown?'<span class="cost-unknown-note">산정 제외</span>':(profit<0?'-':'+')+' ₩'+Math.round(Math.abs(profit)).toLocaleString();
          const fProfitPct=i.costUnknown?'<span class="cost-unknown-note">—</span>':sign+profitPct.toFixed(2)+'%';
          rowsHtml+=`<tr>${ownerTag}<td class="text-left holdings-tooltip-cell">${brokerCell}</td><td class="text-left holdings-tooltip-cell">${getHoldingsAssetCellHtml(i.name,'',i)}</td><td class="dca-cycle-cell">${getDcaCellHtml(i)}</td><td class="dca-amount-cell">${getDcaAmountCellHtml(i)}</td><td>${fQty}</td><td>${fAvg}</td><td>${fCurP}</td><td style="font-weight:700">${fAmt}</td><td class="${cCls}">${fProfit}</td><td class="${cCls}">${fProfitPct}</td><td class="mgmt-cell">${mgmtBtns}</td></tr>`;

        } else if(grpName==='가상화폐'){
          // 가상화폐: avgP/curP를 저장통화 기준으로 KRW 환산
          // cur='USD'이면 USD → KRW 변환 (기존 avgP가 KRW로 저장된 경우와 USD로 저장된 경우 모두 처리)
          const _cRate = i.cur==='USD' ? (RATES.USD||1380) : 1;
          // avgP가 USD 단위라면 환산, KRW 단위라면 그대로 (safeguard: avgP > 1000이고 curP > 100이면 USD 기준 가능성)
          const _avgIsUSD = i.cur==='USD' && i.avgP > 0 && i.avgP < 10000000;
          const avgPKRW = _avgIsUSD ? Math.round(i.avgP * _cRate) : Math.round(i.avgP);
          const curPKRW=Math.round(i.curP * _cRate);
          const current=i.qty*curPKRW;
          const invest=i.qty*avgPKRW;
          const {profit, pct:profitPct}=calcProfit(current, invest);
          grpInvest+=invest;grpKnownTotal+=current;grpKnownCount++;grpTotal+=current;
          const cCls=profit>0?'c-up':(profit<0?'c-dn':''),sign=profit>0?'+':'';
          const fQty=`<button type="button" class="editable-val editable-val-button" aria-label="수량 수정" onclick="makeEditable(this,'','','qty',false,${pIdx})">${(Number(i.qty)||0).toLocaleString(undefined,{maximumFractionDigits:6})}</button> <span style="font-size:.65rem;color:var(--t3)">개</span>`;
          const fAvg=`₩<button type="button" class="editable-val editable-val-button" aria-label="평균단가 수정" onclick="makeEditable(this,'','','avgP',false,${pIdx})">${avgPKRW.toLocaleString()}</button>`;
          const fCurP='₩'+curPKRW.toLocaleString();
          const fAmt=fmtMoney(current);
          const fProfit=(profit<0?'-':'+')+' ₩'+Math.round(Math.abs(profit)).toLocaleString();
          rowsHtml+=`<tr>${ownerTag}<td class="text-left holdings-tooltip-cell">${brokerCell}</td><td class="text-left holdings-tooltip-cell">${getHoldingsAssetCellHtml(i.name,i.tkr,i)}</td><td class="dca-cycle-cell">${getDcaCellHtml(i)}</td><td class="dca-amount-cell">${getDcaAmountCellHtml(i)}</td><td>${fQty}</td><td>${fAvg}</td><td>${fCurP}</td><td style="font-weight:700">${fAmt}</td><td class="${cCls}">${fProfit}</td><td class="${cCls}">${sign+profitPct.toFixed(2)}%</td><td class="mgmt-cell">${mgmtBtns}</td></tr>`;

        } else {
          // 주식 (국내/해외)
          const rate=RATES[i.cur]||1;
          const dec=i.cur==='USD'?2:(i.cur==='JPY'?1:0);
          const sym=i.cur==='USD'?'$':(i.cur==='JPY'?'¥':'₩');
          const invest=i.qty*i.avgP*rate, current=i.qty*i.curP*rate;
          const {profit, pct:profitPct}=calcProfit(current, invest);
          grpInvest+=invest;grpKnownTotal+=current;grpKnownCount++;grpTotal+=current;
          const cCls=profit>0?'c-up':(profit<0?'c-dn':''),sign=profit>0?'+':'';
          const fQty=`<button type="button" class="editable-val editable-val-button" aria-label="수량 수정" onclick="makeEditable(this,'','','qty',false,${pIdx})">${(Number(i.qty)||0).toLocaleString()}</button> <span style="font-size:.65rem;color:var(--t3)">주</span>`;
          const fAvg=`${sym}<button type="button" class="editable-val editable-val-button" aria-label="평균단가 수정" onclick="makeEditable(this,'','','avgP',false,${pIdx})">${(Number(i.avgP)||0).toLocaleString(undefined,{minimumFractionDigits:dec,maximumFractionDigits:dec})}</button>`;
          const staleTag=i._priceStale?`<span title="현재가 조회 실패 - 평균단가 기준" style="font-size:.6rem;background:#F59E0B22;color:#F59E0B;border:1px solid #F59E0B44;padding:1px 4px;border-radius:4px;margin-left:4px">미조회</span>`:'';
          const fCurP=sym+(Number(i.curP)||0).toLocaleString(undefined,{minimumFractionDigits:dec,maximumFractionDigits:dec})+staleTag;
          const fAmt=fmtMoney(current);
          const fProfit=(profit<0?'-':'+')+' ₩'+Math.round(Math.abs(profit)).toLocaleString();
          // [5] 국내주식 티커에 .KS/.KQ 표시 (숫자 + 알파뉴메릭 6자리 모두 지원)
          const tkrStripped=normTkr(i.tkr);
          const isKR=/^[0-9A-Z]{6}$/.test(tkrStripped)&&i.cur==='KRW';
          const dispTkr=isKR?tkrStripped+(i.market==='KOSDAQ'?'.KQ':'.KS'):i.tkr;
          rowsHtml+=`<tr>${ownerTag}<td class="text-left holdings-tooltip-cell">${brokerCell}</td><td class="text-left holdings-tooltip-cell">${getHoldingsAssetCellHtml(i.name,dispTkr,i)}</td><td class="dca-cycle-cell">${getDcaCellHtml(i)}</td><td class="dca-amount-cell">${getDcaAmountCellHtml(i)}</td><td>${fQty}</td><td>${fAvg}</td><td>${fCurP}</td><td style="font-weight:700">${fAmt}</td><td class="${cCls}">${fProfit}</td><td class="${cCls}">${sign+profitPct.toFixed(2)}%</td><td class="mgmt-cell">${mgmtBtns}</td></tr>`;
        }
      });
    }
    let grpProfit=grpKnownTotal-grpInvest,grpProfitPct=grpInvest>0?(grpProfit/grpInvest)*100:0;
    let gCls=grpProfit>0?'c-up':(grpProfit<0?'c-dn':''),gSign=grpProfit>0?'+':'';
    if(grpName==='현금'||grpItems.length===0){gCls='';gSign='';}
    // 테이블 헤더: 자산군별로 다르게
    let theadHtml='';
    const ownerTh=showOwner?'<th class="text-left holdings-owner-head">소유주</th>':'';
    if(grpName==='현금'){
      theadHtml=`<tr>${ownerTh}<th class="text-left">은행/기관</th><th class="text-left holdings-asset-head">자산명</th><th>보유금액</th><th>평가금액(KRW)</th><th class="mgmt-head"><span class="mgmt-head-grid"><span></span><span class="mgmt-head-label">관리</span></span></th></tr>`;
    } else if(grpName==='금'){
      theadHtml=`<tr>${ownerTh}<th class="text-left">거래소 / 계좌</th><th class="text-left holdings-asset-head">자산명</th><th class="dca-cycle-head">DCA 주기</th><th class="dca-amount-head">회당 금액</th>${portfolioSortHeader(grpName,'qty','수량')}${portfolioSortHeader(grpName,'avgP','평균단가')}${portfolioSortHeader(grpName,'curP','현재가')}${portfolioSortHeader(grpName,'valKRW','평가금액(KRW)')}${portfolioSortHeader(grpName,'profit','수익금(KRW)')}${portfolioSortHeader(grpName,'profitPct','수익률')}<th class="mgmt-head"><span class="mgmt-head-grid"><span></span><span class="mgmt-head-label">관리</span></span></th></tr>`;
    } else {
      const brokerLabel=grpName==='가상화폐'?'거래소':'증권사';
      theadHtml=`<tr>${ownerTh}<th class="text-left">${brokerLabel} / 계좌</th><th class="text-left holdings-asset-head">종목명/티커</th><th class="dca-cycle-head">DCA 주기</th><th class="dca-amount-head">회당 금액</th>${portfolioSortHeader(grpName,'qty','수량')}${portfolioSortHeader(grpName,'avgP','평균단가')}${portfolioSortHeader(grpName,'curP','현재가')}${portfolioSortHeader(grpName,'valKRW','평가금액(KRW)')}${portfolioSortHeader(grpName,'profit','수익금(KRW)')}${portfolioSortHeader(grpName,'profitPct','수익률')}<th class="mgmt-head"><span class="mgmt-head-grid"><span></span><span class="mgmt-head-label">관리</span></span></th></tr>`;
    }
    let displayState=window.portToggleState[grpName]?'block':'none';
    const arrowTransform=displayState==='block'?'transform:rotate(180deg);':'';
    const inlineBrokerFilter=grpName==='주식'
      ? brokerFilterHtml.replace('style="align-items:', `style="display:${displayState==='block'?'inline-flex':'none'};align-items:`)
      : '';
    // 주식/가상화폐/금 표 컬럼 폭 동일화: 동일 colgroup + table-layout:fixed → 세 표가 세로로 줄 맞음
    const _isFixed=grpName!=='현금';
    let colgroupHtml='';
    if(_isFixed){
      const ownerCol=showOwner?'<col style="width:8%">':'';
      // 순서: [소유주] 증권사/계좌 · 종목명/티커 · DCA 주기 · 회당 금액 · 수량 · 평균단가 · 현재가 · 평가금액 · 수익금 · 수익률 · 관리
      const widths=showOwner
        ?['7%','16%','7%','7%','7%','8%','8%','10%','9%','7%','6%']
        :['8%','17%','7%','8%','7%','9%','9%','11%','9%','7%','8%'];
      colgroupHtml='<colgroup>'+ownerCol+widths.map(w=>`<col style="width:${w}">`).join('')+'</colgroup>';
    }
    const _fixedCls=_isFixed?' pt-table-fixed':'';
    const grpProfitText=grpItems.length===0||grpName==='현금'?'-':(grpKnownCount===0?'산정 제외':gSign+'₩'+Math.abs(Math.round(grpProfit)).toLocaleString()+' ('+gSign+grpProfitPct.toFixed(2)+'%)');
    html+=`<div class="pt-group"><div class="pt-group-header f-between" style="flex-wrap:wrap;gap:12px" onclick="const b=this.nextElementSibling;const isHidden=b.style.display==='none';b.style.display=isHidden?'block':'none';window.portToggleState['${grpName}']=isHidden;const f=this.querySelector('.holdings-broker-filter-inline');if(f)f.style.display=isHidden?'inline-flex':'none';const arr=this.querySelector('.pt-arrow');if(arr)arr.style.transform=isHidden?'rotate(180deg)':'';"><div class="pt-group-title f-row">${grpName}<span style="font-size:.75rem;color:var(--t3);font-weight:normal;margin-left:6px">(${grpItems.length}종목)</span>${inlineBrokerFilter}</div><div class="pt-group-stats f-row" style="gap:24px;flex-wrap:wrap;justify-content:flex-end"><span style="color:var(--t2)">총 평가: <strong style="color:var(--t1)">₩${Math.round(grpTotal).toLocaleString()}</strong></span><span class="${gCls}">수익: ${grpProfitText}</span><button class="api-btn" style="padding:4px 10px;font-size:.7rem;" onclick="event.stopPropagation();openAddModal('${grpName}')">＋ 추가</button><span class="pt-arrow" style="font-size:.8rem;color:var(--t3);transition:transform .2s;${arrowTransform}">▼</span></div></div><div class="pt-table-wrap" style="display:${displayState}"><table class="pt-table${_fixedCls}" data-grp="${grpName}">${colgroupHtml}<thead>${theadHtml}</thead><tbody>${rowsHtml}</tbody></table></div></div>`;
  });
  document.getElementById('portfolio-tables').innerHTML=html;
}

function renderPortfolioTop3() {
  // top3 is updated inside changeOwner; just trigger a refresh if needed
  changeOwner(currentOwner, null, true);
}

function renderPortFxPanel() {
  // 환율 스트레스 테스트 위젯 제거됨 — renderFxExposure로 대체 (호출부 호환용 no-op)
}

function updatePortPerfChart(owner) {
  if(!portPerfChartInst)return;
  const items=getFilteredAssets(owner);
  const grps=['주식','가상화폐','금','현금'];
  const gData={labels:[],data:[],amounts:[],colors:[]},dData={};
  grps.forEach(g=>{
    const gItems=items.filter(i=>i.grp===g);if(gItems.length===0)return;
    let tInv=0,tCur=0,dList=[];
    gItems.forEach(i=>{
      if(i.costUnknown) return;
      const r=RATES[i.cur]||1;
      const cur=i.qty*i.curP*r;
      let inv;
      if(i.grp==='가상화폐'&&i.cur==='USD'){
        const avgIsUSD=i.avgP>0&&i.avgP<10000000;
        inv=i.qty*(avgIsUSD?i.avgP*r:i.avgP);
      } else if(i.grp==='금'){
        inv=i.qty*i.avgP;
      } else {
        inv=i.qty*i.avgP*r;
      }
      tInv+=inv;tCur+=cur;
      const profit=cur-inv,pct=inv>0?(profit/inv)*100:0;
      dList.push({name:i.name,rate:parseFloat(pct.toFixed(2)),amt:Math.round(profit)});
    });
    if(!dList.length) return;
    let gProfit=tCur-tInv,gPct=tInv>0?(gProfit/tInv)*100:0;
    gData.labels.push(g);gData.data.push(parseFloat(gPct.toFixed(2)));gData.amounts.push(Math.round(gProfit));gData.colors.push(gPct>=0?'#10B981':'#EF4444');
    dList.sort((a,b)=>b.rate-a.rate);
    dData[g]={labels:dList.map(x=>x.name),data:dList.map(x=>x.rate),amounts:dList.map(x=>x.amt),colors:dList.map(x=>x.rate>=0?'#10B981':'#EF4444')};
  });
  window.portPerfGroupData=gData;window.portPerfDetailData=dData;window.portPerfIsDetail=false;
  portPerfChartInst.data.labels=gData.labels;portPerfChartInst.data.datasets[0].data=gData.data;portPerfChartInst.data.datasets[0].profitData=gData.amounts;portPerfChartInst.data.datasets[0].backgroundColor=gData.colors;portPerfChartInst.update();
}

function updateSectorChart(owner) {
  if(!sectorDonutChartInst)return;
  const items=getFilteredAssets(owner);
  let secMap={},secItems={};
  items.forEach(i=>{let sec=getSectorInfo(i.name,i.tkr,i.grp);let val=i.qty*i.curP*(RATES[i.cur]||1);if(val>0){secMap[sec]=(secMap[sec]||0)+val;if(!secItems[sec])secItems[sec]=[];secItems[sec].push({name:i.name,val:val});}});
  const sortedSecs=Object.keys(secMap).sort((a,b)=>secMap[b]-secMap[a]);
  sectorDonutChartInst.data.labels=sortedSecs;
  sectorDonutChartInst.data.datasets[0].data=sortedSecs.map(s=>Math.round(secMap[s]));
  sectorDonutChartInst.data.datasets[0].backgroundColor=sortedSecs.map((_,idx)=>CHART_PALETTE[idx%CHART_PALETTE.length]);
  sectorDonutChartInst._secItems=secItems;sectorDonutChartInst.update();
}

// =============================================
// 자산 추가/수정/삭제 모달
// =============================================
function openAddModal(grp) {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  document.getElementById('edit-mode-owner').value='';
  document.getElementById('edit-mode-tkr').value='';
  document.getElementById('edit-mode-idx').value='';
  document.getElementById('modal-title').innerText=grp+' 자산 추가';
  const srch=document.getElementById('add-search');
  srch.value='';srch.dataset.tkr='';srch.dataset.name='';
  document.getElementById('search-dropdown').style.display='none';
  // 검색 결과 패널 초기화
  const ssr=document.getElementById('stock-search-result');if(ssr)ssr.style.display='none';
  const sse=document.getElementById('stock-search-error');if(sse)sse.style.display='none';
  const ssl=document.getElementById('stock-search-loading');if(ssl)ssl.style.display='none';
  window._stockSearchResult=null;
  document.getElementById('add-qty').value='';
  document.getElementById('add-avgp').value='';
  const unknownCost=document.getElementById('add-cost-unknown');if(unknownCost)unknownCost.checked=false;
  toggleCostUnknown();
  document.getElementById('add-cash-amt').value='';
  const cn=document.getElementById('add-cash-name');if(cn)cn.value='';
  const gn=document.getElementById('add-gold-name');if(gn)gn.value='금';
  document.getElementById('add-dca').checked=false;
  document.getElementById('wrap-dca-detail').style.display='none';
  document.getElementById('add-dca-amt').value='';
  const _amtRdio=document.getElementById('dca-mode-amount');if(_amtRdio)_amtRdio.checked=true;
  const _qtyInp=document.getElementById('add-dca-qty');if(_qtyInp)_qtyInp.value='';
  toggleDcaMode();
  document.getElementById('add-grp').value=grp;
  // [1] 현재 소유주가 특정인이면 소유주 select 고정, 전체면 전체 표시
  const ownerSel=document.getElementById('add-owner');
  if(currentOwner!=='전체'){
    ownerSel.innerHTML=`<option value="${currentOwner}">${currentOwner}</option>`;
  } else {
    ownerSel.innerHTML='<option value="본인">본인</option><option value="아내">아내</option><option value="자녀1">자녀1</option><option value="아버지">아버지</option>';
  }
  const brokerSel=document.getElementById('add-broker'),accSel=document.getElementById('add-account');
  let brokers=[],accs=[];
  if(grp==='주식'){brokers=['증권사 선택','메리츠증권','삼성증권','키움증권','NH투자증권','토스증권','미래에셋증권','기타'];accs=['일반','ISA','연금저축','증여계좌'];}
  else if(grp==='가상화폐'){brokers=['거래소 선택','업비트','빗썸','코인원','바이낸스','기타'];accs=['일반'];}
  else if(grp==='금'){brokers=['기관 선택','KB증권','종로금거래소','한국금거래소','기타'];accs=['금현물','실물보관'];}
  else if(grp==='현금'){brokers=['은행 선택','국민은행','신한은행','하나은행','우리은행','토스뱅크','기타'];accs=['입출금','CMA','파킹통장'];}
  brokerSel.innerHTML=brokers.map(b=>`<option value="${b}">${b}</option>`).join('');
  accSel.innerHTML=accs.map(a=>`<option value="${a}">${a}</option>`).join('');
  const modal=document.getElementById('add-modal');
  window._addModalReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  modal.classList.add('active');
  modal.setAttribute('aria-hidden','false');
  toggleModalFields();
  requestAnimationFrame(()=>document.getElementById('add-search')?.focus());
}
function closeAddModal(){
  const modal=document.getElementById('add-modal');
  if(!modal?.classList.contains('active')) return;
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden','true');
  const returnFocus=window._addModalReturnFocus;
  window._addModalReturnFocus=null;
  if(returnFocus&&document.contains(returnFocus)) returnFocus.focus();
}

function editItem(owner,tkr,idx=-1) {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  // 인덱스 기반 조회 우선 (중복 티커·다계좌 지원)
  const resolvedIdx=(idx>=0&&pfolioData[idx])?idx:pfolioData.findIndex(i=>i.tkr===tkr&&i.owner===owner);
  const item=pfolioData[resolvedIdx];if(!item)return;
  // [2] broker/acc 먼저 세팅 후 openAddModal 호출
  const savedBroker=item.broker, savedAcc=item.acc;
  openAddModal(item.grp);
  document.getElementById('edit-mode-owner').value=owner;
  document.getElementById('edit-mode-tkr').value=tkr;
  document.getElementById('edit-mode-idx').value=resolvedIdx;
  document.getElementById('modal-title').innerText='자산 정보 수정';
  // 소유주 복원
  const ownerSel=document.getElementById('add-owner');
  ownerSel.innerHTML='<option value="본인">본인</option><option value="아내">아내</option><option value="자녀1">자녀1</option><option value="아버지">아버지</option>';
  ownerSel.value=item.owner;
  document.getElementById('add-grp').value=item.grp;
  // [2] broker 복원: select에 없으면 option 추가
  const brokerSel=document.getElementById('add-broker');
  if(![...brokerSel.options].find(o=>o.value===savedBroker)){
    const opt=document.createElement('option');opt.value=savedBroker;opt.text=savedBroker;brokerSel.appendChild(opt);
  }
  brokerSel.value=savedBroker;
  // [2] acc 복원
  const accSel=document.getElementById('add-account');
  if(![...accSel.options].find(o=>o.value===savedAcc)){
    const opt=document.createElement('option');opt.value=savedAcc;opt.text=savedAcc;accSel.appendChild(opt);
  }
  accSel.value=savedAcc;
  // 시장 세팅
  const mkt=(item.market==='KOSPI'||item.market==='KOSDAQ')?'KR':(item.market||'US');
  const mktEl=document.getElementById('add-market');if(mktEl)mktEl.value=mkt;
  const curEl=document.getElementById('add-currency-stock');if(curEl)curEl.value=item.cur||'USD';
  updateAvgpDecimalMode();
  const dec = item.cur === 'USD' ? 2 : (item.cur === 'JPY' ? 1 : 0);
  document.getElementById('add-qty').value=item.qty.toLocaleString();
  const unitSel=document.getElementById('add-unit');
  if(unitSel)unitSel.value=item.unit||'g';
  document.getElementById('add-avgp').value=(Math.round(item.avgP*100)/100||item.avgP).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:dec});
  document.getElementById('add-dca').checked=!!item.dca;
  document.getElementById('add-dca-cycle').value=item.dcaCycle||'매월';
  document.getElementById('add-dca-amt').value=item.dcaAmt||0;
  const dcaCurEl2=document.getElementById('add-dca-cur');
  if(dcaCurEl2)dcaCurEl2.value=item.dcaCur||'KRW';
  // dcaMode / dcaQty 복원
  const savedMode = item.dcaMode || 'amount';
  const modeEl = document.getElementById(savedMode === 'qty' ? 'dca-mode-qty' : 'dca-mode-amount');
  if (modeEl) modeEl.checked = true;
  const qtyEl = document.getElementById('add-dca-qty');
  if (qtyEl) qtyEl.value = item.dcaQty || '';
  // 요일 체크박스 복원
  document.querySelectorAll('.dca-dow').forEach(c=>{
    c.checked=Array.isArray(item.dcaDays)&&item.dcaDays.includes(parseInt(c.value));
  });
  if(document.getElementById('add-dca-day'))document.getElementById('add-dca-day').value=item.dcaDay||1;
  if(item.dca){toggleDcaDay();toggleDcaMode();}
  if(item.grp==='현금'){
    document.getElementById('add-cash-amt').value=item.qty;
    document.getElementById('add-currency').value=item.cur;
    const cashNameEl=document.getElementById('add-cash-name');
    if(cashNameEl)cashNameEl.value=item.name||'';
  }
  toggleModalFields();
  if(item.grp==='금'){
    const goldNameEl=document.getElementById('add-gold-name');
    if(goldNameEl)goldNameEl.value=item.name||'금';
    const unknownCost=document.getElementById('add-cost-unknown');
    if(unknownCost)unknownCost.checked=!!item.costUnknown;
    if(!item.costUnknown) document.getElementById('add-avgp').value=(Math.round(item.avgP*100)/100||item.avgP).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:dec});
    toggleCostUnknown();
  }
  // [2] 종목명/티커 복원: toggleModalFields → onMarketChange 가 srch 를 초기화하므로 반드시 이후에 복원
  const srch=document.getElementById('add-search');
  const tkrStripped=normTkr(item.tkr);
  const isKrTkr=/^[0-9A-Z]{6}$/i.test(tkrStripped)&&item.cur==='KRW';
  const dispTkrEdit=isKrTkr?tkrStripped+(item.market==='KOSDAQ'?'.KQ':'.KS'):item.tkr;
  if(item.grp!=='금'&&item.grp!=='현금'){
    srch.value=item.name+' ('+dispTkrEdit+')';
    srch.dataset.tkr=item.tkr;srch.dataset.name=item.name;srch.dataset.market=mkt;
  }
  if(item.dca){document.getElementById('wrap-dca-detail').style.display='block';document.getElementById('row-qty-price').style.display='none';}
}

function deleteItem(owner,tkr,idx=-1) {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  if(confirm('해당 자산을 삭제하시겠습니까?')){
    // 인덱스 기반 조회 우선 (중복 티커·다계좌 지원)
    if(!(idx>=0&&pfolioData[idx])) idx=pfolioData.findIndex(i=>i.tkr===tkr&&i.owner===owner);
    if(idx>-1){pfolioData.splice(idx,1);syncDivHistory();changeOwner(currentOwner, null);saveAssetsToKV();}
  }
}

function submitAddModal() {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  const ownerMode=document.getElementById('edit-mode-owner').value;
  const tkrMode=document.getElementById('edit-mode-tkr').value;
  const owner=document.getElementById('add-owner').value;
  const grp=document.getElementById('add-grp').value;
  const broker=document.getElementById('add-broker').value;
  const acc=document.getElementById('add-account').value;
  // [3] 시장 정보는 hidden input 또는 검색 dataset에서
  const srch=document.getElementById('add-search');
  const market=srch.dataset.market || document.getElementById('add-market').value || 'US';
  let selectedTkr=srch.dataset.tkr||'';
  let selectedName=srch.dataset.name||'';
  const searchRaw=srch.value.trim();
  if(!selectedTkr&&searchRaw){
    const pm=searchRaw.match(/\(([^)]+)\)$/);
    if(pm){selectedTkr=pm[1];selectedName=searchRaw.replace(/\s*\([^)]+\)$/,'').trim();}
    else{selectedTkr=searchRaw.toUpperCase();selectedName=searchRaw;}
  }
  let qty=parseFloat((document.getElementById('add-qty').value||'').replace(/,/g,''))||0;
  // 단위: 금은 select, 주식=주, 코인=개
  let unit='주';
  if(grp==='금'){unit=document.getElementById('add-unit').value||'g';}
  else if(grp==='가상화폐'){unit='개';}
  const costUnknown=grp==='금'&&!!document.getElementById('add-cost-unknown')?.checked;
  let avgPRaw=parseFloat((document.getElementById('add-avgp').value||'').replace(/,/g,''))||0;
  let cur='KRW';
  if(grp==='현금'){cur=document.getElementById('add-currency').value;}
  else if(grp==='금'){cur='KRW';} // 금은 항상 원화 기준 (이중환율 방지)
  else{const cs=document.getElementById('add-currency-stock');cur=cs?cs.value:(market==='US'||market==='CRYPTO'?'USD':'KRW');}
  // [4] 가상화폐 avgP는 KRW 그대로 저장
  let avgP = avgPRaw;
  if(costUnknown) avgP=0;
  const isDca=document.getElementById('add-dca').checked;
  const dcaCycle=document.getElementById('add-dca-cycle').value;
  const dcaAmt=parseInt((document.getElementById('add-dca-amt').value||'').replace(/,/g,''))||0;
  const dcaCurEl=document.getElementById('add-dca-cur');
  const dcaCur=dcaCurEl?dcaCurEl.value:'KRW';
  const dcaMode=document.querySelector('input[name="dca-mode"]:checked')?.value||'amount';
  const dcaQty=parseFloat((document.getElementById('add-dca-qty').value||'').replace(/,/g,''))||0;
  const dcaDays=dcaCycle==='매주'?Array.from(document.querySelectorAll('.dca-dow:checked')).map(c=>parseInt(c.value)):[];
  const dcaDayVal=dcaCycle==='매월'?parseInt(document.getElementById('add-dca-day').value)||1:undefined;
  if(grp==='현금'){qty=parseFloat((document.getElementById('add-cash-amt').value||'').replace(/,/g,''))||0;unit='';avgP=1;}
  if(!searchRaw&&grp!=='현금'&&grp!=='금'){alert('종목명을 입력하세요.');return;}
  let tkr=selectedTkr||searchRaw.toUpperCase();
  let name=selectedName||searchRaw;
  // 시장 저장: KR → KOSPI로 저장 (price.ts 호환)
  let savedMarket=market;
  if(market==='KR'){savedMarket='KOSPI';}
  if(grp==='현금'){
    tkr=cur+'_'+Date.now();  // 중복 방지용 유니크 키
    // 자산명: 입력값 우선, 없으면 기본값
    const cashName=document.getElementById('add-cash-name');
    name=(cashName&&cashName.value.trim())||name||cur+' 예수금';
    // 수정 모드에서는 기존 tkr 유지
    if(ownerMode&&tkrMode)tkr=tkrMode;
  }
  if(grp==='금'){
    tkr=(ownerMode&&tkrMode)?tkrMode:'GOLD_'+Date.now();
    const goldName=document.getElementById('add-gold-name');
    name=(goldName&&goldName.value.trim())||'금';
    savedMarket='GOLD';
  }
  const editingItem=(ownerMode&&tkrMode)?pfolioData.find(i=>i.tkr===tkrMode&&i.owner===ownerMode):null;
  const goldUnitFactor=unit==='돈'?3.75:(unit==='kg'?1000:1);
  const initialCurP=costUnknown
    ? ((editingItem&&editingItem.curP>0)?editingItem.curP:(window._GOLD_G_KRW||0)*goldUnitFactor)
    : avgP;
  const newData={grp,owner,broker,acc,name,tkr,qty,unit,avgP,curP:initialCurP,cur,market:savedMarket,costUnknown,dca:isDca,dcaCycle,dcaAmt,dcaCur,dcaMode,dcaQty,dcaDays,dcaDay:dcaDayVal};
  if(ownerMode&&tkrMode){
    // 수정 모드: 편집 시작 시 기록한 인덱스를 owner/tkr로 재검증 후 사용, 무효하면 폴백
    const savedIdx=parseInt(document.getElementById('edit-mode-idx').value);
    const idx=(Number.isInteger(savedIdx)&&pfolioData[savedIdx]&&pfolioData[savedIdx].tkr===tkrMode&&pfolioData[savedIdx].owner===ownerMode)
      ?savedIdx
      :pfolioData.findIndex(i=>i.tkr===tkrMode&&i.owner===ownerMode);
    if(idx>-1)pfolioData[idx]=newData;
  }
  else pfolioData.push(newData);
  syncDivHistory();changeOwner(currentOwner, null);closeAddModal();saveAssetsToKV();
}

// =============================================
// 배당
// =============================================
function showDividendBreakdown(mIdx) {
  const mLabels=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const total=divHistoryOf(document.getElementById('valYearSelect')?.value,currentOwner)[mIdx];
  const c=document.getElementById('div-breakdown');
  if(!total){c.innerHTML=`<strong style="color:var(--acc2)">${mLabels[mIdx]} 배당 내역</strong><br><span style="color:var(--t3);font-size:.75rem">배당 내역이 없습니다.</span>`;c.style.display='block';return;}
  c.innerHTML=`<strong style="color:var(--acc2)">${mLabels[mIdx]} 종목별 배당 (세전)</strong><div style="margin-top:6px;font-size:.75rem">총 예상: ₩${Math.round(total).toLocaleString()}</div>`;
  c.style.display='block';
}

function updateDivChartsYear() {
  const y=document.getElementById('divYearSelect')?.value||'2026';
  if(window.allOwnersDivChartInst){OWNERS.forEach((o,i)=>window.allOwnersDivChartInst.data.datasets[i].data=(divHistory[y]||{})[o]||Array(12).fill(0));window.allOwnersDivChartInst.update();}
  if(window.mainDivChartInst){window.mainDivChartInst.data.datasets[0].data=((divHistory[y]||{})[currentOwner]||Array(12).fill(0)).map(v=>Math.round(v));window.mainDivChartInst.update();}
  renderDivTable(window.activeMainDivMonth);
}

function updateMainDivYear() {
  const y=document.getElementById('mainDivYearSelect')?.value||'2026';
  if(window.mainDivChartInst){
    const divArr=((divHistory[y]||{})[currentOwner]||Array(12).fill(0)).map(v=>Math.round(v));
    const hasDiv=divArr.some(v=>v>0);
    window.mainDivChartInst.data.datasets[0].data=divArr;
    window.mainDivChartInst.update();
    const divCanvas=document.getElementById('mainDivChart');
    if(divCanvas){
      let overlay=divCanvas.parentElement.querySelector('.div-no-data-overlay');
      if(!hasDiv){
        if(!overlay){overlay=document.createElement('div');overlay.className='div-no-data-overlay';overlay.style.cssText='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(var(--inner-bg-rgb,240,244,255),.75);border-radius:8px;font-size:.82rem;color:var(--t3);pointer-events:none;z-index:5';overlay.textContent='배당 데이터를 조회할 수 없습니다.';}
        const par=divCanvas.parentElement;if(par&&par.style)par.style.position='relative';
        if(!divCanvas.parentElement.contains(overlay))divCanvas.parentElement.appendChild(overlay);
      } else {
        if(overlay)overlay.remove();
      }
    }
  }
  renderDivTable(window.activeMainDivMonth);
}

function renderDivTable(mIdx) {
  let html='',hasItem=false,totalExpected=0;
  // pfolioData에서 보유 배당주 동적 조회
  const divStocksDynamic = getDivStocks();
  const filtered=(mIdx!==-1&&mIdx!==undefined)
    ? divStocksDynamic.filter(s=>s.months&&s.months.includes(mIdx))
    : divStocksDynamic;
  const ownerItems=getFilteredAssets(currentOwner);
  filtered.forEach(s=>{
    // 소유주 필터링: 현재 선택된 소유주의 보유수량만
    let tQty=0;
    ownerItems.forEach(i=>{
      const tkr6=normDivTkr(i.tkr);
      if(tkr6===s.tkr||i.tkr===s.tkr) tQty+=Number(i.qty)||0;
    });
    if(tQty===0)return;hasItem=true;
    // 실시간 배당률 표시 (API 캐시 우선)
    const cachedDiv = window._divDataCache && (window._divDataCache[normDivTkr(s.tkr)]||window._divDataCache[s.tkr]);
    const displayYld = (cachedDiv && cachedDiv.yld) ? cachedDiv.yld : (s.yld||'-');
    const yldNum = parseFloat(displayYld)||0;
    const yldCls = yldNum>3?'c-up':'';
    // 연 배당률 기반 예상 배당금 계산: (보유수량 × 현재가 × 연 배당률) / 배당횟수
    const cycleCount = CYCLE_COUNT[s.cycle||'-']||1;
    // 단일 지급분 eps 우선, 없으면 현재가 기반 연 배당률 계산
    let expPerPeriod;
    if(s.eps>0){
      expPerPeriod = tQty * s.eps * (RATES[s.cur]||1);
    } else if(yldNum>0){
      // 연 배당률로 계산: 연 배당금 = qty × curP × yld / 배당횟수
      const curVal = ownerItems.filter(i=>{const t6=normDivTkr(i.tkr);return t6===normDivTkr(s.tkr)||i.tkr===s.tkr;}).reduce((sum,i)=>sum+i.qty*i.curP*(RATES[i.cur]||1),0);
      expPerPeriod = curVal * yldNum / 100 / cycleCount;
    } else {
      expPerPeriod = 0;
    }
    if (expPerPeriod === 0 && yldNum === 0) return;
    totalExpected += expPerPeriod;
    let displayCycle = s.cycle||'-';
    if(s.months && s.months.length > 0 && s.months.length < 12) {
      displayCycle += ` (${s.months.map(m=>m+1).join(',')}월)`;
    } else if (s.months && s.months.length === 12) {
      displayCycle += ` (매월)`;
    }
    html+=`<tr>
      <td class="text-left"><strong>${_cfEsc(s.name)}</strong> <span class="tkr-txt">${_cfEsc(s.tkr)}</span></td>
      <td class="${yldCls}" style="text-align:center;font-size:.75rem">${_cfEsc(displayYld)}</td>
      <td style="text-align:center;color:var(--t3);font-size:.75rem">${_cfEsc(displayCycle)}</td>
      <td style="text-align:right;font-size:.75rem">${tQty.toLocaleString(undefined,{maximumFractionDigits:4})}</td>
      <td style="color:var(--t1);text-align:right;font-size:.75rem">${expPerPeriod>0?'₩'+Math.round(expPerPeriod).toLocaleString():'-'}</td>
    </tr>`;
  });
  document.getElementById('div-table-body').innerHTML=hasItem?html:`<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--t3)">${mIdx!==-1&&mIdx!==undefined?(mIdx+1)+'월 ':''}배당 종목이 없습니다.</td></tr>`;
  // 제목 월 레이블 업데이트
  const titleEl = document.getElementById('div-list-title');
  const totalEl = document.getElementById('div-total-amt');
  if (titleEl) {
    const monthLabel = (mIdx!==-1&&mIdx!==undefined) ? `${mIdx+1}월 ` : '';
    const firstSpan = titleEl.querySelector('span:first-child');
    if (firstSpan) firstSpan.innerHTML = `${monthLabel}배당 종목 리스트 <span style="font-size:.7rem;font-weight:normal">(보유수량 기준 환산)</span>`;
  }
  const footEl = document.getElementById('div-table-foot');
  if (footEl) {
    footEl.innerHTML = totalExpected > 0
      ? `<tr>
          <td style="border-top:1px solid var(--border-dark)"></td>
          <td style="border-top:1px solid var(--border-dark)"></td>
          <td style="border-top:1px solid var(--border-dark)"></td>
          <td class="div-total-label" style="text-align:right;padding:6px 6px 4px;font-size:.72rem;color:var(--t3);border-top:1px solid var(--border-dark)">합계</td>
          <td class="div-total-value" style="text-align:right;padding:6px 6px 4px;font-size:.8rem;font-weight:700;color:var(--acc);font-family:'IBM Plex Mono',monospace;border-top:1px solid var(--border-dark)">₩${Math.round(totalExpected).toLocaleString()}</td>
        </tr>`
      : '';
  }
  if (totalEl) totalEl.textContent = '';
}

// =============================================
// 캐시플로우
// =============================================
let currentCfDate=new Date(),cfYear=currentCfDate.getFullYear(),cfMonth=currentCfDate.getMonth()+1;
let _cfOwner = '전체';
let _cfSection = 'monthly';
let _cfShowExcluded = false;

function setCfOwner(owner, btn) {
  _cfOwner = owner;
  document.querySelectorAll('[id^="cf-owner-"]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const ownerInput=document.getElementById('cf-owner-input');if(ownerInput&&owner!=='전체')ownerInput.value=owner;
  const fixedOwner=document.getElementById('cf-fixed-owner');if(fixedOwner&&owner!=='전체')fixedOwner.value=owner;
  renderCfDivPanel();
  renderCashFlow();
  renderFixedCostView();
}

function renderCfDivPanel() {
  const el = document.getElementById('cf-div-panel');
  if (!el) return;
  const year = String(cfYear);
  if (!window.divHistory || !window.divHistory[year]) { el.innerHTML = ''; el.style.display = 'none'; return; }
  const owners = _cfOwner === '전체' ? OWNERS : [_cfOwner];
  const monthly = Array(12).fill(0);
  owners.forEach(ow => {
    const od = window.divHistory[year][ow];
    if (!od) return;
    od.forEach((v, i) => { monthly[i] += (v || 0); });
  });
  const total = monthly.reduce((s, v) => s + v, 0);
  if (total === 0) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  const maxV = Math.max(...monthly, 1);
  const nowM = new Date().getMonth();
  const bars = monthly.map((v, i) => {
    const pct = (v / maxV * 100).toFixed(1);
    const isNow = i === nowM && String(cfYear) === String(new Date().getFullYear());
    return `<div style="display:flex;flex-direction:column;align-items:center;flex:1;gap:2px">
      <div style="width:100%;background:var(--inner-bg);border-radius:3px;height:36px;display:flex;align-items:flex-end">
        <div style="width:100%;height:${pct}%;background:${isNow?'var(--acc)':'var(--acc3)'};border-radius:3px;min-height:${v>0?'3px':'0'}"></div>
      </div>
      <div style="font-size:.58rem;color:var(--t3)">${i+1}월</div>
      ${v > 0 ? `<div style="font-size:.58rem;color:var(--t2);white-space:nowrap">₩${(v/10000).toFixed(0)}만</div>` : ''}
    </div>`;
  }).join('');
  el.innerHTML = `
    <div class="card-title" style="margin-bottom:6px">${_cfOwner === '전체' ? '전체' : _cfOwner} ${year}년 배당 수입 <span style="font-size:.68rem;font-weight:normal;color:var(--acc)">₩${Math.round(total).toLocaleString()}</span></div>
    <div style="display:flex;gap:2px;align-items:flex-end;padding:4px 0">${bars}</div>`;
}

function initCfDropdowns() {
  const yrSel=document.getElementById('cf-sel-year'),moSel=document.getElementById('cf-sel-month');
  let yHtml='',mHtml='';
  for(let y=2024;y<=2030;y++)yHtml+=`<option value="${y}">${y}년</option>`;
  for(let m=1;m<=12;m++)mHtml+=`<option value="${m}">${m}월</option>`;
  yrSel.innerHTML=yHtml;moSel.innerHTML=mHtml;
}

function changeCfDate(){cfYear=parseInt(document.getElementById('cf-sel-year').value);cfMonth=parseInt(document.getElementById('cf-sel-month').value);renderCashFlow();}

// divKey에서 정규화된 키 추출 (티커 suffix 제거, 월 leading zero 제거)
function _normDivKey(divKey) {
  if (!divKey) return null;
  const parts = divKey.split('_');
  if (parts.length < 5) return divKey;
  // 형식: div_TICKER_OWNER_YR_MO
  const tkrNorm = parts[1].toUpperCase().replace(/\.(KS|KQ)$/i,'');
  const yr = parts[parts.length - 2];
  const mo = String(parseInt(parts[parts.length - 1], 10)); // leading zero 제거
  const ownerParts = parts.slice(2, -2).join('_');
  return `div_${tkrNorm}_${ownerParts}_${yr}_${mo}`;
}

// 배당 중복 항목 정리: 동일 desc+owner+년+월인 배당금 항목 중 최신 1개만 유지
function cleanupDuplicateDivEntries() {
  const seen = new Map();
  const toRemove = new Set();
  cfData.forEach((entry, idx) => {
    if (entry.type !== '수입' || entry.cat !== '배당금') return;
    // divKey 있는 항목은 정규화된 divKey 기준으로 중복 처리
    if (entry.divKey) {
      const key = _normDivKey(entry.divKey);
      if (seen.has(key)) {
        const prevIdx = seen.get(key);
        const prev = cfData[prevIdx];
        const entryResolved = entry.date !== '미정';
        const prevResolved = prev.date !== '미정';
        if (entryResolved && !prevResolved) {
          // 현재 항목이 확정일, 이전이 미정 → 이전 제거
          toRemove.add(prevIdx); seen.set(key, idx);
        } else if (!entryResolved && prevResolved) {
          // 이전이 확정일, 현재가 미정 → 현재 제거
          toRemove.add(idx);
        } else if (entryResolved && prevResolved) {
          // 둘 다 확정일: 더 나중 날짜 유지
          const dt = new Date(entry.date), prevDt = new Date(prev.date);
          if (dt > prevDt) { toRemove.add(prevIdx); seen.set(key, idx); }
          else toRemove.add(idx);
        } else {
          // 둘 다 미정: 먼저 등록된 것(idx가 낮은 것) 유지
          toRemove.add(idx);
        }
      } else {
        seen.set(key, idx);
      }
      return;
    }
    // divKey 없는 레거시 항목: desc/owner/연/월 기준
    const dt = new Date(entry.date);
    const yr = isNaN(dt.getFullYear()) ? 0 : dt.getFullYear();
    const mo = isNaN(dt.getMonth()) ? -1 : dt.getMonth();
    const key = `${entry.desc||''}_${entry.owner||''}_${yr}_${mo}`;
    if (seen.has(key)) {
      const prevIdx = seen.get(key);
      const prev = cfData[prevIdx];
      const prevDate = new Date(prev.date);
      if (dt > prevDate || (dt.getTime() === prevDate.getTime() && entry.divKey && !prev.divKey)) {
        toRemove.add(prevIdx);
        seen.set(key, idx);
      } else {
        toRemove.add(idx);
      }
    } else {
      seen.set(key, idx);
    }
  });
  if (toRemove.size > 0) {
    cfData = cfData.filter((_, idx) => !toRemove.has(idx));
    saveCfData();
  }
  // 2차 정리: divKey가 없는 배당금 항목 중 같은 (desc, owner, 연, 월) 조합이 여러 날짜로 존재하는 경우
  const seen2 = new Map();
  const toRemove2 = new Set();
  cfData.forEach((entry, idx) => {
    if (entry.type !== '수입' || entry.cat !== '배당금' || entry.divKey) return;
    const dt = new Date(entry.date);
    const yr2 = isNaN(dt.getFullYear()) ? 0 : dt.getFullYear();
    const mo2 = isNaN(dt.getMonth()) ? -1 : dt.getMonth();
    const key2 = `${entry.desc||''}_${entry.owner||''}_${yr2}_${mo2}`;
    if (seen2.has(key2)) {
      const prevIdx = seen2.get(key2);
      const prev = cfData[prevIdx];
      const prevDt = new Date(prev.date);
      if (dt > prevDt) { toRemove2.add(prevIdx); seen2.set(key2, idx); }
      else toRemove2.add(idx);
    } else {
      seen2.set(key2, idx);
    }
  });
  if (toRemove2.size > 0) {
    cfData = cfData.filter((_, idx) => !toRemove2.has(idx));
    saveCfData();
  }
  // 3차 정리: owner 없는 레거시 배당 항목이 divKey 있는 항목과 같은 desc+년+월이면 레거시 제거
  const divKeyMonthSet = new Set();
  cfData.forEach(e => {
    if (!e.divKey || e.type !== '수입' || e.cat !== '배당금') return;
    const dt = e.date === '미정' ? null : new Date(e.date);
    const eyr = dt ? dt.getFullYear() : parseInt(e.divKey.split('_').slice(-2)[0]);
    const emo = dt ? dt.getMonth() : parseInt(e.divKey.split('_').slice(-1)[0]) - 1;
    divKeyMonthSet.add(`${e.desc}_${eyr}_${emo}`);
  });
  const toRemove3 = new Set();
  cfData.forEach((entry, idx) => {
    if (entry.divKey || entry.type !== '수입' || entry.cat !== '배당금') return;
    const dt2 = new Date(entry.date);
    if (isNaN(dt2)) return;
    const key3 = `${entry.desc}_${dt2.getFullYear()}_${dt2.getMonth()}`;
    if (divKeyMonthSet.has(key3)) toRemove3.add(idx);
  });
  if (toRemove3.size > 0) {
    cfData = cfData.filter((_, idx) => !toRemove3.has(idx));
    saveCfData();
  }
}

// 미정 배당 항목을 확정일로 업데이트 (fetchDivData 후 호출)
function resolvePendingDivDates() {
  let changed = false;
  cfData.forEach(entry => {
    if (entry.dateStatus !== 'pending' || !entry.divKey) return;
    const parts = entry.divKey.split('_'); // div_TKR_OWNER_YR_MO1
    if (parts.length < 5) return;
    const tkr = parts[1];
    const entryYr = parseInt(parts[parts.length - 2]);
    const entryMo1 = parseInt(parts[parts.length - 1]);
    if (!entryYr || !entryMo1) return;
    const cached = window._divDataCache?.[tkr] || DIV_INFO_DB?.[tkr];
    const payDay = (cached && typeof cached.payDay === 'number' && cached.payDay > 0) ? cached.payDay : null;
    if (!payDay) return;
    const lastDay = new Date(entryYr, entryMo1, 0).getDate();
    entry.date = `${entryYr}-${String(entryMo1).padStart(2,'0')}-${String(Math.min(payDay,lastDay)).padStart(2,'0')}`;
    delete entry.dateStatus;
    changed = true;
  });
  if (changed) { saveCfData(); renderCashFlow(); }
}

// 10. 배당 수입 자동 등록 (등록된 배당주에서 계좌 유형별 자동 생성, 연간 세금 반영)
async function autoAddDividendCashFlow(silent=false) {
  const beforeCleanup=JSON.stringify(cfData);
  cleanupDuplicateDivEntries();
  let changed=JSON.stringify(cfData)!==beforeCleanup;
  const divStocks = getDivStocks();
  // 현재 캐시플로우 뷰의 선택 연/월 기준으로 생성 (cfYear/cfMonth가 없으면 오늘 기준)
  const yr = (typeof cfYear !== 'undefined' ? cfYear : new Date().getFullYear());
  const mo = (typeof cfMonth !== 'undefined' ? cfMonth - 1 : new Date().getMonth()); // 0-based
  let added = 0;
  const cycleMap = {'월배당':'월배당','분기':'분기배당','반기':'반기배당','연간':'연간배당'};

  // ISA 200만원 공제는 월·종목·계좌마다 따로 적용하면 안 된다. 현재 보유 전체의
  // 연간 예상 배당을 한 번에 세금 엔진에 넣고, 계산된 세후 비율을 이번 달 지급액에 적용한다.
  const annualLots=[];
  const scheduleKnownTickers=new Set();
  divStocks.forEach(s => {
    const eps=Number(s.eps)||0;
    const months=[...new Set((Array.isArray(s.months)?s.months:[])
      .map(Number).filter(m=>Number.isInteger(m)&&m>=0&&m<12))];
    if(eps<=0||months.length===0) return;
    const rate = s.cur === 'USD' ? (RATES.USD||1380) : (s.cur === 'JPY' ? (RATES.JPY||9.2) : 1);
    const tkrNorm = String(s.tkr||'').toUpperCase().replace(/\.(KS|KQ)$/i,'');
    // 캐시/API에서 확인한 일정만 파괴적 stale 정리의 근거로 사용한다.
    // 정적 DB 폴백은 조회 실패 때도 나타날 수 있어 기존 행 삭제 근거로는 부족하다.
    if(s._divSource==='cache') scheduleKnownTickers.add(tkrNorm);
    const cycleLabel = cycleMap[s.cycle]||s.cycle||'배당';
    const holdings = pfolioData.filter(i => {
      const t6 = String(i.tkr||'').toUpperCase().replace(/\.(KS|KQ)$/i,'');
      return (t6 === tkrNorm || i.tkr === s.tkr) && Number(i.qty)>0;
    });
    holdings.forEach(item => {
      if(!item.owner) return;
      const payout=Number(item.qty)*eps*rate;
      if(!(payout>0)) return;
      const taxInfo=getAccountDivTaxInfo(item.acc);
      annualLots.push({
        owner:item.owner,
        acc:item.acc,
        gross:payout*months.length,
        ref:{s,tkrNorm,cycleLabel,months,payout,taxInfo}
      });
    });
  });

  // divKey는 기존 6-part 형식을 유지하되 같은 소유주·종목·계좌유형의 복수 계좌는
  // 한 항목으로 합산한다. 이 방식은 기존 삭제 키와 호환되면서 두 번째 계좌 누락을 막는다.
  const monthlyGroups=new Map();
  const deletedManagedKeys=new Set();
  allocateDividendTax(annualLots).list.forEach(entry=>{
    const ref=entry.ref;
    if(!ref.months.includes(mo)) return;
    const owner=entry.owner;
    const accType=entry.info.type;
    const divKey=`div_${ref.tkrNorm}_${owner}_${accType}_${yr}_${mo+1}`;
    const legacyDivKey=`div_${ref.tkrNorm}_${owner}_${yr}_${mo+1}`;
    const legacyNorm=_normDivKey(legacyDivKey);
    const wasDeleted=cfDeletedKeys.some(key=>{
      if(typeof key!=='string'||!key.startsWith('div:')) return false;
      const raw=key.slice(4);
      if(raw===divKey) return true;
      return raw.split('_').length===5&&_normDivKey(raw)===legacyNorm;
    });
    if(wasDeleted){deletedManagedKeys.add(divKey);return;}
    const netRatio=entry.gross>0?entry.net/entry.gross:1;
    const netPayout=ref.payout*netRatio;
    const existing=monthlyGroups.get(divKey);
    if(existing){ existing.net+=netPayout; return; }
    const payDay=(typeof ref.s.payDay==='number'&&ref.s.payDay>0)?ref.s.payDay:null;
    const lastDay=new Date(yr,mo+1,0).getDate();
    monthlyGroups.set(divKey,{
      divKey,owner,net:netPayout,payDay,
      dateStr:payDay?`${yr}-${String(mo+1).padStart(2,'0')}-${String(Math.min(payDay,lastDay)).padStart(2,'0')}`:'미정',
      desc:`${ref.s.name} ${ref.cycleLabel} 수입 (${ref.taxInfo.label})`
    });
  });

  monthlyGroups.forEach(group=>{
    const net=Math.round(group.net);
    if(net<=0) return;
    const existingIdx=cfData.findIndex(i=>i.divKey===group.divKey);
    if(existingIdx>=0){
      const current=cfData[existingIdx];
      let rowChanged=false;
      if(current.desc!==group.desc){current.desc=group.desc;rowChanged=true;}
      if(Number(current.amt)!==net){current.amt=net;rowChanged=true;}
      // 확정 지급일은 변경도 반영하되, 확인된 날짜를 미정으로 되돌리지는 않는다.
      if(group.payDay&&(current.date!==group.dateStr||current.dateStatus==='pending')){
        current.date=group.dateStr;
        delete current.dateStatus;
        rowChanged=true;
      }
      if(rowChanged){changed=true;added++;}
      return;
    }
    const row={date:group.dateStr,type:'수입',cat:'배당금',desc:group.desc,amt:net,owner:group.owner,divKey:group.divKey};
    if(!group.payDay) row.dateStatus='pending';
    cfData.push(row);
    changed=true;
    added++;
  });

  // 현재 연·월에 앱이 만든 6-part 자동 배당 중 더 이상 계산되지 않는 행을 제거한다.
  // 자산 원장에서 보유/계좌유형 소멸이 확정됐거나 해당 종목의 정상 배당 일정이 있을 때만
  // 제거해, 배당 API 실패·부분 응답을 '배당 없음'으로 오인해 정상 행을 지우지 않게 한다.
  const beforeStaleCleanup=cfData.length;
  cfData=cfData.filter(entry=>{
    if(entry.type!=='수입'||entry.cat!=='배당금'||!entry.divKey) return true;
    const parts=entry.divKey.split('_');
    const isManaged=parts.length===6&&parts[0]==='div'&&['ISA','연금','일반'].includes(parts[3]);
    if(!isManaged||String(parts[4])!==String(yr)||String(parseInt(parts[5],10))!==String(mo+1)) return true;
    if(monthlyGroups.has(entry.divKey)) return true;
    if(deletedManagedKeys.has(entry.divKey)) return false;
    const rowTicker=String(parts[1]||'').toUpperCase().replace(/\.(KS|KQ)$/i,'');
    const stillHeld=pfolioData.some(item=>{
      const itemTicker=String(item.tkr||'').toUpperCase().replace(/\.(KS|KQ)$/i,'');
      return Number(item.qty)>0&&itemTicker===rowTicker&&item.owner===parts[2]
        &&getAccountDivTaxInfo(item.acc).type===parts[3];
    });
    return stillHeld&&!scheduleKnownTickers.has(rowTicker);
  });
  if(cfData.length!==beforeStaleCleanup) changed=true;
  // 레거시 combined entry(div_TKR_OWNER_YR_MO; 5 parts) 정리 — 새 account-aware entry로 대체된 항목 제거
  const accAwareKeys = new Set();
  cfData.forEach(e => {
    if (!e.divKey) return;
    const p = e.divKey.split('_');
    // div_TKR_OWNER_ACCTYPE_YR_MO → 6 parts
    if (p.length === 6) accAwareKeys.add(`${p[1]}_${p[2]}_${p[4]}_${p[5]}`);
  });
  if (accAwareKeys.size > 0) {
    const before = cfData.length;
    cfData = cfData.filter(e => {
      if (!e.divKey) return true;
      const p = e.divKey.split('_');
      if (p.length === 5) {
        const k = `${p[1]}_${p[2]}_${p[3]}_${p[4]}`;
        if (accAwareKeys.has(k)) return false;
      }
      return true;
    });
    if (cfData.length !== before) changed=true;
  }
  // 레거시 no-divKey 항목 정리 — divKey 없는 배당금 항목 중 같은 종목명+소유주+년+월에
  // 새 account-aware entry가 있으면 제거 (예: "삼성전자 분기배당 수입" 구 항목)
  const noDivKeyBefore = cfData.length;
  const accAwareNameOwnerSet = new Set();
  cfData.forEach(e => {
    if (!e.divKey) return;
    const p = e.divKey.split('_');
    if (p.length === 6) {
      const tkrNorm2 = p[1];
      const s2 = divStocks.find(d => String(d.tkr||'').toUpperCase().replace(/\.(KS|KQ)$/i,'') === tkrNorm2);
      if (s2) accAwareNameOwnerSet.add(`${s2.name}_${p[2]}_${p[4]}_${p[5]}`);
    }
  });
  if (accAwareNameOwnerSet.size > 0) {
    cfData = cfData.filter(e => {
      if (e.divKey || e.type !== '수입' || e.cat !== '배당금') return true;
      const dt2 = e.date === '미정' ? null : new Date(e.date);
      if (!dt2 || isNaN(dt2)) return true;
      const ey2 = String(dt2.getFullYear()), em2 = String(dt2.getMonth() + 1);
      for (const k of accAwareNameOwnerSet) {
        const [kName,,kYr,kMo] = k.split('_');
        const kOwner = k.split('_')[1];
        if (e.desc && e.desc.includes(kName) && (e.owner === kOwner || !e.owner) && ey2 === kYr && em2 === kMo) return false;
      }
      return true;
    });
    if (cfData.length !== noDivKeyBefore) changed=true;
  }
  // 레거시 배당금 entry desc 보강:
  // divKey 없거나 5-part 인 배당금 항목 중 세금 라벨이 없는 경우, pfolioData 에서
  // 종목/소유주 매칭하여 계좌 타입 기반 세금 라벨 부착 + 6-part divKey 부여.
  let enriched = 0;
  cfData.forEach(e => {
    if (e.type !== '수입' || e.cat !== '배당금') return;
    const has6Part = e.divKey && e.divKey.split('_').length === 6;
    if (has6Part) return;
    // 이미 신규 포맷 세금 라벨(괄호 안 ',' 포함)이 있으면 skip
    if (/\([^)]*,\s*[^)]+\)\s*$/.test(e.desc||'')) return;
    if (!e.owner || !e.date || e.date === '미정') return;
    // desc 가 종목명으로 시작하는 경우만 매칭 (부분 일치 오탐 방지)
    const match = pfolioData.find(p =>
      p.grp === '주식' && p.qty > 0 && p.owner === e.owner &&
      p.name && e.desc && e.desc.startsWith(p.name)
    );
    if (!match) return;
    const taxInfo = getAccountDivTaxInfo(match.acc);
    // 끝의 괄호 그룹 제거 후 신규 라벨 부착
    const newDesc = (e.desc.replace(/\s*\([^)]*\)\s*$/, '') + ` (${taxInfo.label})`).trim();
    if (newDesc !== e.desc) {
      e.desc = newDesc;
      enriched++;
    }
    // 6-part divKey 부여 (다음 실행 시 정리/업데이트 로직과 호환)
    const dt = new Date(e.date);
    if (!isNaN(dt)) {
      const tkrNorm = String(match.tkr||'').toUpperCase().replace(/\.(KS|KQ)$/i,'');
      e.divKey = `div_${tkrNorm}_${e.owner}_${taxInfo.type}_${dt.getFullYear()}_${dt.getMonth()+1}`;
    }
  });
  if (enriched > 0) changed=true;
  if(changed) globalThis._cfRemoteDirty=true;
  if(changed||globalThis._cfRemoteDirty===true){
    if(changed){saveCfData();renderCashFlow();}
    // 실패 시 dirty를 유지해 다음 호출이 무변경이어도 원격 저장을 다시 시도한다.
    const saved=typeof saveExtDataToKV==='function'?await saveExtDataToKV():{ok:true,skipped:true};
    if(saved?.ok!==false) globalThis._cfRemoteDirty=false;
    if(added>0&&!silent) alert(`${added}건의 배당 수입이 자동 등록되었습니다.`);
    return {ok:saved?.ok!==false,changed,added,enriched,saved,retried:!changed};
  }
  return {ok:true,changed:false,added:0,enriched:0};
}

function addCashFlow() {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  const editIdx=parseInt(document.getElementById('cf-edit-index').value);
  const dt=document.getElementById('cf-date').value,typ=document.getElementById('cf-type').value;
  const cat=document.getElementById('cf-cat').value,des=document.getElementById('cf-desc').value.trim();
  const am=parseInt((document.getElementById('cf-amt').value||'').replace(/,/g,''));
  const owner=document.getElementById('cf-owner-input')?.value||(_cfOwner==='전체'?'':_cfOwner);
  if(!dt||!des||!am){alert('항목을 모두 입력해주세요.');return;}
  if(!OWNERS.includes(owner)){alert('소유주를 선택하세요.');return;}
  const newItem={date:dt,type:typ,cat:cat,desc:des,amt:am,owner};
  if(editIdx>-1){cfData[editIdx]=newItem;document.getElementById('cf-edit-index').value='-1';document.getElementById('btn-cf-submit').innerText='저장';}
  else cfData.push(newItem);
  document.getElementById('cf-desc').value='';document.getElementById('cf-amt').value='';saveCfData();renderCashFlow();saveExtDataToKV();
}
async function deleteCF(idx){
  if (isMobileLayout()) return; // 모바일은 조회 전용
  if(confirm('내역을 삭제하시겠습니까?')){
    const item=cfData[idx];
    rememberCfDeletion(item);
    cfData.splice(idx,1);
    saveCfData();
    renderCashFlow();
    await saveExtDataToKV();
  }
}
function editCF(idx){
  if (isMobileLayout()) return; // 모바일은 조회 전용

  const item=cfData[idx];document.getElementById('cf-edit-index').value=idx;
  document.getElementById('cf-date').value=item.date;document.getElementById('cf-type').value=item.type;
  document.getElementById('cf-cat').value=item.cat;document.getElementById('cf-desc').value=item.desc;
  const ownerInput=document.getElementById('cf-owner-input');if(ownerInput&&OWNERS.includes(item.owner))ownerInput.value=item.owner;
  document.getElementById('cf-amt').value=item.amt;document.getElementById('btn-cf-submit').innerText='수정';
}
// 편집 상태 해제 — 폼 패널 바깥을 클릭했을 때 호출.
function resetCfForm() {
  const idxEl = document.getElementById('cf-edit-index');
  if (!idxEl || parseInt(idxEl.value || '-1') === -1) return;
  idxEl.value = '-1';
  const descEl = document.getElementById('cf-desc'); if (descEl) descEl.value = '';
  const amtEl = document.getElementById('cf-amt'); if (amtEl) amtEl.value = '';
  const dEl = document.getElementById('cf-date'); if (dEl) dEl.value = _cfLocalDateKey(new Date());
  const tEl = document.getElementById('cf-type'); if (tEl) tEl.value = '지출';
  const cEl = document.getElementById('cf-cat'); if (cEl && cEl.options.length) cEl.selectedIndex = 0;
  const oEl = document.getElementById('cf-owner-input'); if (oEl) oEl.value = _cfOwner==='전체'?'본인':_cfOwner;
  const btn = document.getElementById('btn-cf-submit'); if (btn) btn.innerText = '저장';
}
// 폼 바깥 클릭 시 편집 상태 자동 해제. mousedown 으로 잡되, 다른 행의 ✎/✕ 클릭은
// 자체 onclick 핸들러(editCF/deleteCF)에 위임하기 위해 .btn-action 클릭은 건너뛴다.
document.addEventListener('mousedown', (e) => {
  const idxEl = document.getElementById('cf-edit-index');
  if (!idxEl || parseInt(idxEl.value || '-1') === -1) return;
  const panel = document.getElementById('cf-input-panel');
  if (!panel) return;
  if (panel.contains(e.target)) return;
  if (e.target.closest && e.target.closest('.btn-action')) return;
  resetCfForm();
});

function updateCfTrendChart() {
  let labels=[],netData=[],bgColors=[];
  window.cfTrendDetails={in:[],out:[]};
  // 자동이체에서 월별 예상 금액 계산 헬퍼 (startMonth 이전 / endMonth 이후 / skipMonths / 실체화 항목 제외)
  function calcAutoTransferForMonth(y, m) {
    let atIn=0, atOut=0;
    const daysInMonth = new Date(y, m, 0).getDate();
    const ymKey = y+'-'+String(m).padStart(2,'0');
    autoTransferData.forEach(at=>{
      if (!at.amt || !at.cycle) return;
      if (_cfOwner!=='전체' && at.owner!==_cfOwner) return;
      const monthlyCycle=['monthly','month-end','month-start'].includes(at.cycle);
      // 등록 시작 월 이전이면 제외 (4월 등록 시 3월 이전엔 포함되지 않음)
      if (!monthlyCycle&&at.startMonth) {
        const [sy, sm] = at.startMonth.split('-').map(Number);
        if (y < sy || (y === sy && m < sm)) return;
      }
      // 취소 종료 월 이후에도 제외
      if (!monthlyCycle&&at.endMonth) {
        const [ey, em] = at.endMonth.split('-').map(Number);
        if (y > ey || (y === ey && m > em)) return;
      }
      // 해당 월 단건 skip
      if (!monthlyCycle&&Array.isArray(at.skipMonths) && at.skipMonths.includes(ymKey)) return;
      // 이미 cfData에 atId로 실체화된 항목이 있으면 가상 금액 제외 (cfData 합계에 이미 포함됨)
      const hasMaterialized = cfData.some(item=>{
        const idate=new Date(item.date);
        return idate.getFullYear()===y && idate.getMonth()+1===m && item.atId===at.id;
      });
      if (hasMaterialized) return;
      // 레거시 [자동] desc 중복 방지
      const hasLegacy = cfData.some(item=>{
        const idate=new Date(item.date);
        return idate.getFullYear()===y && idate.getMonth()+1===m &&
          item.isAuto===true && item.atId==null &&
          typeof item.desc==='string' && item.desc.includes(at.desc);
      });
      if (hasLegacy) return;
      let times = 0;
      if (monthlyCycle) times=_autoTransferMonthlyOccurrences(at,y,m).length;
      else if (at.cycle==='weekly') times=Math.floor(daysInMonth/7);
      else if (at.cycle==='daily') times=daysInMonth;
      const effAmt = _effectiveAutoTransferAmt(at, y, m);
      const total = effAmt * times;
      if (at.type==='수입') atIn+=total; else atOut+=total;
    });
    return {atIn, atOut};
  }
  for(let i=5;i>=0;i--){
    let d=new Date(cfYear,cfMonth-1-i,1);let y=d.getFullYear();let m=d.getMonth()+1;
    labels.push(m + '월');let mIn=0,mOut=0;
    cfData.forEach(item=>{let idate=new Date(item.date);if(idate.getFullYear()===y&&idate.getMonth()+1===m&&(_cfOwner==='전체'||item.owner===_cfOwner)){if(item.type==='수입')mIn+=item.amt;else mOut+=item.amt;}});
    // 자동이체 예상금액 포함 (실체화된 항목/skip/종료 이후는 calcAutoTransferForMonth에서 이미 제외됨)
    const atAmts = calcAutoTransferForMonth(y, m);
    mIn+=atAmts.atIn; mOut+=atAmts.atOut;
    let net=mIn-mOut;netData.push(net);window.cfTrendDetails.in.push(mIn);window.cfTrendDetails.out.push(mOut);bgColors.push(net>=0?cssVar('--up','#4ade80'):cssVar('--dn','#fb7185'));
  }
  if(window.cfTrendChartInst){window.cfTrendChartInst.data.labels=labels;window.cfTrendChartInst.data.datasets[0].data=netData;window.cfTrendChartInst.data.datasets[0].backgroundColor=bgColors;window.cfTrendChartInst.update();}
}

function renderCashFlow() {
  document.getElementById('cf-sel-year').value=cfYear;document.getElementById('cf-sel-month').value=cfMonth;
  // 소유주 열은 항상 표시 — 모드 전환 시 컬럼 폭이 재계산되며 인접 셀과 글자가 겹치는 현상 방지
  const thOwner = document.getElementById('cf-th-owner');
  if (thOwner) thOwner.style.display = '';
  const allMonth=cfData.filter(i=>{
    if(i.date==='미정'&&i.divKey){const p=i.divKey.split('_');return parseInt(p[p.length-2])===cfYear&&parseInt(p[p.length-1])===cfMonth;}
    const d=new Date(i.date);return d.getFullYear()===cfYear&&(d.getMonth()+1)===cfMonth;
  });
  // owner 필터: owner 필드가 있는 항목만 해당 소유주로 필터링 (기존 항목은 owner 없으면 전체에 표시)
  const f=allMonth.filter(i=>_cfOwner==='전체'?true:i.owner===_cfOwner).sort((a,b)=>{if(a.date==='미정')return 1;if(b.date==='미정')return -1;return new Date(b.date)-new Date(a.date);});
  let html='',tIn=0,tOut=0,expByCat=Object.create(null),incomeByCat=Object.create(null);
  f.forEach(i=>{
    const realIdx=cfData.findIndex(x=>x===i);
    const amount=Number(i.amt)||0;
    if(i.type==='수입'){tIn+=amount;incomeByCat[i.cat]=(incomeByCat[i.cat]||0)+amount;}else{tOut+=amount;expByCat[i.cat]=(expByCat[i.cat]||0)+amount;}
    let cls=i.type==='수입'?'var(--up)':'var(--dn)',sign=i.type==='수입'?'+':'-';
    let fd=i.date==='미정'?'미정':i.date.substring(5).replace('-','/');
    const cycleDisp=i.isAuto?`<span style="font-size:.65rem;color:var(--t3);white-space:nowrap">자동이체${i.cycleLabel?' · '+_cfEsc(i.cycleLabel):''}</span>`:`<span style="font-size:.65rem;color:var(--t3)">일회성</span>`;
    const ownerCell=`<td class="text-left"><span style="font-size:.72rem;color:var(--t3);white-space:nowrap">${_cfEsc(i.owner||'-')}</span></td>`;
    html+=`<tr><td class="text-left">${_cfEsc(fd)}</td><td class="text-left"><span style="color:${cls};font-weight:bold">${_cfEsc(i.type)}</span></td>${ownerCell}<td class="text-left">${_cfEsc(i.cat)}</td><td class="text-left">${_cfEsc(i.desc)}</td><td style="color:${cls}" class="text-right">${sign}₩${amount.toLocaleString()}</td><td class="text-right">${cycleDisp}</td><td class="text-right" style="white-space:nowrap"><button class="btn-action" type="button" aria-label="현금흐름 수정" onclick="editCF(${realIdx})">✎</button><button class="btn-action" type="button" aria-label="현금흐름 삭제" onclick="deleteCF(${realIdx})">✕</button></td></tr>`;
  });
  // 자동이체 가상 행: 각 자동이체별로 해당 월의 실제/레거시 [자동] 항목이 없으면 예정 행 표시
  const daysInMonth=new Date(cfYear,cfMonth,0).getDate();
  const ymKey=cfYear+'-'+String(cfMonth).padStart(2,'0');
  autoTransferData.forEach(at=>{
    if(!at.amt||!at.cycle)return;
    if(_cfOwner!=='전체'&&at.owner!==_cfOwner)return;
    const monthlyCycle=['monthly','month-end','month-start'].includes(at.cycle);
    const monthlyOccurrences=monthlyCycle?_autoTransferMonthlyOccurrences(at,cfYear,cfMonth):[];
    if(monthlyCycle&&!monthlyOccurrences.length)return;
    // 최초 등록 월부터 표시
    if (!monthlyCycle&&at.startMonth) {
      const [sy, sm] = at.startMonth.split('-').map(Number);
      if (cfYear < sy || (cfYear === sy && cfMonth < sm)) return;
    }
    // 종료 월(취소 월) 이후에는 표시 안 함
    if (!monthlyCycle&&at.endMonth) {
      const [ey, em] = at.endMonth.split('-').map(Number);
      if (cfYear > ey || (cfYear === ey && cfMonth > em)) return;
    }
    // 특정 월 skip 설정
    if (!monthlyCycle&&Array.isArray(at.skipMonths) && at.skipMonths.includes(ymKey)) return;
    // 이미 해당 월 atId로 실체화된 cfData 항목이 있으면 가상 행 skip
    const hasMaterialized = cfData.some(item=>{
      const idate=new Date(item.date);
      return idate.getFullYear()===cfYear && idate.getMonth()+1===cfMonth && item.atId===at.id;
    });
    if (hasMaterialized) return;
    // 레거시 [자동] 항목 (atId 없음) 중복 방지
    const hasLegacyAuto = cfData.some(item=>{
      const idate=new Date(item.date);
      return idate.getFullYear()===cfYear && idate.getMonth()+1===cfMonth &&
        item.isAuto===true && item.atId==null &&
        typeof item.desc==='string' && item.desc.includes(at.desc);
    });
    if (hasLegacyAuto) return;
    let times=0;
    if(monthlyCycle)times=monthlyOccurrences.length;
    else if(at.cycle==='weekly')times=Math.floor(daysInMonth/7);
    else if(at.cycle==='daily')times=daysInMonth;
    const effAmt = _effectiveAutoTransferAmt(at, cfYear, cfMonth);
    const total=effAmt*times;
    if(at.type==='수입')tIn+=total;
    else{tOut+=total;expByCat[at.cat]=(expByCat[at.cat]||0)+total;}
    const atCls = at.type === '수입' ? 'var(--up)' : 'var(--dn)';
    const atSign = at.type === '수입' ? '+' : '-';
    const cycleLbl = _getCycleLabel(at);
    const safeAtId=Number.isSafeInteger(Number(at.id))?Number(at.id):0;
    const scheduledLabel=monthlyCycle&&monthlyOccurrences.length
      ? _cfLocalDateKey(monthlyOccurrences[0].date).substring(5).replace('-','/')
      : '-';
    const atOwnerCell = `<td class="text-left"><span style="font-size:.72rem;color:var(--t3);white-space:nowrap">${_cfEsc(at.owner||'미지정')}</span></td>`;
    html+=`<tr style="opacity:.75">
      <td class="text-left">${scheduledLabel}</td>
      <td class="text-left"><span style="color:${atCls};font-weight:bold">${_cfEsc(at.type)}</span></td>
      ${atOwnerCell}<td class="text-left">${_cfEsc(at.cat||'-')}</td>
      <td class="text-left"><span style="color:var(--t3)">[예정]</span> ${_cfEsc(at.desc||'자동이체')}</td>
      <td style="color:${atCls}" class="text-right">${atSign}₩${total.toLocaleString()}</td>
      <td class="text-right"><span style="font-size:.65rem;color:var(--t3)">${_cfEsc(cycleLbl)}</span></td>
      <td class="text-right" style="white-space:nowrap">
        <button class="btn-action" title="이 달 금액 수정" onclick="editAutoTransferMonth(${safeAtId},${cfYear},${cfMonth})">✎</button>
        <button class="btn-action" title="이 달만 삭제" onclick="skipAutoTransferMonth(${safeAtId},${cfYear},${cfMonth})">✕</button>
      </td>
    </tr>`;
  });
  const emptyColspan = '8';
  document.getElementById('cf-table-body').innerHTML=html||`<tr><td colspan="${emptyColspan}" style="text-align:center;padding:20px">내역이 없습니다.</td></tr>`;
  document.getElementById('cf-tot-in').innerText=`₩${tIn.toLocaleString()}`;document.getElementById('cf-tot-out').innerText=`-₩${tOut.toLocaleString()}`;
  const net=tIn-tOut,nEl=document.getElementById('cf-tot-net');
  nEl.innerText=net===0?'₩0':(net<0?'-₩':'+₩')+Math.abs(net).toLocaleString();nEl.className=net>0?'c-up':(net<0?'c-dn':'');
  const titleEl=document.getElementById('cf-widget-title-text');if(titleEl)titleEl.textContent=`수입/지출 구성 (${cfMonth}월)`;
  if(window.cfDonutChartInst){
    const incLabels=Object.keys(incomeByCat);const expLabels=Object.keys(expByCat);
    const allLabels=[...incLabels,...expLabels];
    const allData=[...incLabels.map(l=>incomeByCat[l]),...expLabels.map(l=>-expByCat[l])];
    const allColors=[...incLabels.map(l=>cfColors[l]||cssVar('--up','#4ade80')),...expLabels.map(l=>cfColors[l]||cssVar('--dn','#fb7185'))];
    window.cfDonutChartInst.data.labels=allLabels;
    window.cfDonutChartInst.data.datasets[0].data=allData;
    window.cfDonutChartInst.data.datasets[0].backgroundColor=allColors;
    window.cfDonutChartInst.update();
  }
  updateCfTrendChart();window.activeCfCat=null;
  if(_cfSection==='fixed')renderFixedCostView();
}

function prevCfMonth(){cfMonth--;if(cfMonth<1){cfMonth=12;cfYear--;}renderCashFlow();}
function nextCfMonth(){cfMonth++;if(cfMonth>12){cfMonth=1;cfYear++;}renderCashFlow();}

let _cfDetailReturnFocus = null;
function showCfDetails(cat) {
  const parent=document.getElementById('cfDetailModal'),header=document.getElementById('cf-details-header'),list=document.getElementById('cf-details-list');
  if(!parent||!header||!list)return;
  _cfDetailReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const items=cfData.filter(i=>{const d=new Date(i.date);return d.getFullYear()===cfYear&&(d.getMonth()+1)===cfMonth&&i.cat===cat&&i.type==='지출';}).sort((a,b)=>new Date(b.date)-new Date(a.date));
  header.innerText=`[${cat}] 지출 상세 내역 (${cfMonth}월)`;
  let html='';
  if(items.length===0)html='<div style="color:var(--t3);text-align:center;padding:20px 0;font-size:0.85rem">내역이 없습니다.</div>';
  else items.forEach(i=>{const shortDate=i.date==='미정'?'미정':String(i.date).substring(5).replace('-','/');html+=`<div class="f-between" style="font-size:0.9rem;padding:10px 0;border-bottom:1px dashed var(--border-light);"><span style="color:var(--t3);width:45px;">${_cfEsc(shortDate)}</span><span style="flex:1;margin:0 12px;font-weight:500;">${_cfEsc(i.desc)}</span><span style="color:var(--dn);font-weight:700;">₩${Number(i.amt||0).toLocaleString()}</span></div>`;});
  list.innerHTML=html;
  parent.classList.add('active');
  parent.setAttribute('aria-hidden','false');
  setTimeout(()=>parent.querySelector('.cf-modal-content')?.focus(),0);
}
function closeCfDetails(){
  const parent=document.getElementById('cfDetailModal');
  if(!parent)return;
  parent.classList.remove('active');
  parent.setAttribute('aria-hidden','true');
  if(_cfDetailReturnFocus?.focus)_cfDetailReturnFocus.focus();
  _cfDetailReturnFocus=null;
}

// =============================================
// 증여 시뮬레이션
// =============================================
function formatGiftInput(el){
  const pos=el.selectionStart;
  const raw=el.value.replace(/,/g,'');
  const num=parseInt(raw)||0;
  if(num>0){el.value=num.toLocaleString();}
  // 커서 위치 보정
  try{const diff=el.value.length-(raw.length);el.setSelectionRange(pos+diff,pos+diff);}catch(e){}
}

function calcGift() {
  const ruleSlot=document.getElementById('legacy-gift-tax-rule');
  if(ruleSlot&&typeof assetTaxRuleDisclosureHtml==='function')ruleSlot.innerHTML=assetTaxRuleDisclosureHtml('gift',new Date().getFullYear());
  const birthStr=document.getElementById('gift-birth').value;if(!birthStr)return;
  const birth=new Date(birthStr+'-01');
  window._giftBirthYear=birth.getFullYear(); // 툴팁에서 YYYY년 계산용
  const getAmt=(id)=>parseInt((document.getElementById(id).value||'0').replace(/,/g,''))||0;
  const amts=[getAmt('gift-amt-1'),getAmt('gift-amt-2'),getAmt('gift-amt-3'),getAmt('gift-amt-4')];
  const minorLimit=_taxRuleValue('gift.minorLinealAscendantDeductionKrw',20_000_000);
  const adultLimit=_taxRuleValue('gift.adultLinealAscendantDeductionKrw',50_000_000);
  const limits=[minorLimit,minorLimit,adultLimit,adultLimit];
  const labels_period=['미성년 전기 (0~9세)','미성년 후기 (10~19세)','성년 전기 (20~29세)','성년 후기 (30~39세)'];
  const colors=['#5b9bff','#4ade80','#f2a33c','#c084fc'];
  let html='',chartLabels=[],chartDataPV=[],chartDataNonPV=[],chartColors=[],chartLimitLine=[],totalAccumulatedPV=0,totalAccumulatedNonPV=0,currentAgeStr='',currentTotal=0;
  const today=new Date();
  let currentMonthsDiff=(today.getFullYear()-birth.getFullYear())*12+(today.getMonth()-birth.getMonth());
  if(currentMonthsDiff<0)currentMonthsDiff=0;
  for(let p=0;p<4;p++){
    // 법정 연 3%를 월말 동일액 납입으로 근사한 월납 연금현가계수.
    const annualRate=_taxRuleValue('gift.annuityDiscountRate',0.03);
    const monthlyRate=annualRate/12;
    const pvFactor=monthlyRate>0?(1-Math.pow(1+monthlyRate,-120))/monthlyRate:120;
    let pvTotal=Math.round(amts[p]*pvFactor);  // PV: 할인율 적용 누적액
    let rawTotal=amts[p]*12*10;                 // 미할인 명목 납입총액
    let pLimit=limits[p],pPct=Math.min((pvTotal/pLimit)*100,100).toFixed(1),isExceed=pvTotal>pLimit;
    html+=`<div><div class="f-between" style="font-size:.75rem;margin-bottom:4px"><span style="color:var(--t2);font-weight:600">${labels_period[p]} <span style="font-size:.65rem;font-weight:normal">(한도 ₩${pLimit.toLocaleString()})</span></span><span style="color:${isExceed?'var(--dn)':'var(--t1)'};font-weight:bold">₩${pvTotal.toLocaleString()} <span style="font-size:.6rem;color:var(--t3)">PV</span></span></div><div style="width:100%;background:var(--border-light);height:6px;border-radius:3px;overflow:hidden"><div style="width:${pPct}%;background:${colors[p]};height:100%;border-radius:3px"></div></div><div style="text-align:right;font-size:.6rem;color:var(--t3);margin-top:1px">명목 ₩${rawTotal.toLocaleString()} → PV ${pPct}% 사용</div></div>`;
    const monthlyFactor12=monthlyRate>0?(1-Math.pow(1+monthlyRate,-12))/monthlyRate:12;
    let yearlyPV=amts[p]*monthlyFactor12, yearlyNonPV=amts[p]*12;
    for(let y=0;y<10;y++){
      let age=p*10+y;chartLabels.push(age+'세');totalAccumulatedPV+=yearlyPV;totalAccumulatedNonPV+=yearlyNonPV;
      chartDataPV.push(Math.round(totalAccumulatedPV));chartDataNonPV.push(Math.round(totalAccumulatedNonPV));chartColors.push(colors[p]);
      let cumulativeLimit=limits.slice(0,p+1).reduce((a,b)=>a+b,0);chartLimitLine.push(cumulativeLimit);
      if(currentMonthsDiff>=age*12&&currentMonthsDiff<(age+1)*12){let monthsInCurrentYear=currentMonthsDiff%12;currentTotal=(totalAccumulatedPV-yearlyPV)+(yearlyPV/12*monthsInCurrentYear);currentAgeStr=`${age}세 ${monthsInCurrentYear}개월`;}
      else if(currentMonthsDiff>=480&&p===3&&y===9){currentTotal=totalAccumulatedPV;currentAgeStr='40세 이상';}
    }
  }
  document.getElementById('gift-progress-container').innerHTML=html;
  document.getElementById('gift-accumulated').innerHTML='₩'+Math.round(currentTotal).toLocaleString()+` <span style="font-size:.75rem;color:var(--t3);font-weight:normal">(현재 PV 기준: ${currentAgeStr})</span>`;
  if(window.giftChartInst){window.giftChartInst.data.labels=chartLabels;window.giftChartInst.data.datasets[1].data=chartDataNonPV;window.giftChartInst.data.datasets[2].data=chartDataPV;window.giftChartInst.data.datasets[2].backgroundColor=chartColors;window.giftChartInst.data.datasets[0].data=chartLimitLine;window.giftChartInst.update();setTimeout(()=>{if(window.giftChartInst)window.giftChartInst.resize();},50);}
}

// =============================================
// 유틸
// =============================================
// 숫자 입력창 자동 쉼표 포맷 (입력 중 실시간 적용)
function handleAmtInput(el) {
  const raw = el.value.replace(/[^0-9]/g, '');
  if (raw === '') { el.value = ''; return; }
  el.value = parseInt(raw, 10).toLocaleString();
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
    const isDecimal = el.getAttribute('inputmode') === 'decimal';
    if (isDecimal) {
      // 소수: 입력 중엔 원본 유지 (콤마가 들어가면 소수점 커서 이동이 어지러움), blur 시 정수부에만 콤마
      el.addEventListener('blur', () => {
        const raw = String(el.value||'').replace(/,/g,'').trim();
        if (raw === '' || isNaN(parseFloat(raw))) return;
        const [intPart, decPart] = raw.split('.');
        const formatted = parseInt(intPart||'0',10).toLocaleString() + (decPart!==undefined?'.'+decPart:'');
        el.value = formatted;
      });
      el.addEventListener('focus', () => { el.value = String(el.value||'').replace(/,/g,''); });
    } else {
      // 정수: 실시간 콤마
      el.addEventListener('input', () => handleAmtInput(el));
    }
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
  const curSel = document.getElementById('add-currency');
  if (curSel && curSel.value === 'USD') {
    const raw = el.value.replace(/[^0-9.]/g, '');
    if (el.value !== raw) el.value = raw;
  } else {
    handleAmtInput(el);
  }
}

// 평균단가 입력: 해외주식(USD)은 소수점 허용, 국내주식(KRW)은 정수 + 실시간 콤마
function handleAvgPriceInput(el) {
  const curSel = document.getElementById('add-currency-stock');
  const cur = curSel ? curSel.value : 'KRW';
  if (cur === 'USD') {
    let raw = el.value.replace(/,/g,'').replace(/[^0-9.]/g, '');
    const firstDot = raw.indexOf('.');
    if (firstDot !== -1) {
      raw = raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, '');
    }
    if (el.value !== raw) el.value = raw;
  } else {
    handleAmtInput(el);
  }
}

// 평균단가 blur 시 소수점 유지 여부를 현재 화폐에 맞춰 동기화
function updateAvgpDecimalMode() {
  const avgpEl = document.getElementById('add-avgp');
  if (!avgpEl) return;
  avgpEl.dataset.decimal = '1';
  avgpEl.setAttribute('inputmode', 'decimal');
}

function flash(el,dir){if(!el)return;el.classList.remove('flash-up','flash-down','flash-neutral');void el.offsetWidth;el.classList.add(dir==='up'?'flash-up':dir==='down'?'flash-down':'flash-neutral');setTimeout(()=>el.classList.remove('flash-up','flash-down','flash-neutral'),1400);}
function getFGLabel(v){if(v<=20)return'EXTREME FEAR';if(v<=40)return'FEAR';if(v<=60)return'NEUTRAL';if(v<=80)return'GREED';return'EXTREME GREED';}
function getFGColor(v){if(v<=20)return'#EF4444';if(v<=40)return'#F97316';if(v<=60)return'#FCD34D';if(v<=80)return'#84CC16';return'#10B981';}

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
      if(assetsReady) results.prices=await refreshMarketPrices();
      else markAssetBlocked('prices','시장 시세','시장별 시세 API');
    }
    if(wants('dividends')){
      if(assetsReady) results.dividends=await fetchDivData(true);
      else markAssetBlocked('dividends','배당 데이터','배당 데이터 API');
    }
    if(wants('rates')) results.rates=await refreshPyData({includeDividends:source==='all'&&assetsResult?.ok&&extResult?.ok});
    if(wants('benchmark')){
      if(assetsReady) results.benchmark=await fetchBenchmarkData();
      else markAssetBlocked('benchmark','성과 벤치마크','시장 지수 데이터');
    }
    if(source==='all') refreshFNG();

    // 전체 새로고침에서 두 KV 원본이 모두 정상일 때만 오늘 스냅샷을 다시 저장한다.
    if(source==='all'&&assetsResult?.ok&&extResult?.ok) results.snapshot=await saveNetWorthSnapshot();
    const activeView=document.querySelector('.view-section.active');
    if(activeView&&activeView.id==='view-bubble') renderBubbleChart('weight');
    changeOwner(currentOwner,null,true);
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
// 벤치마크 포트폴리오는 20). 보유 종목이 상한을 넘으면 서버가 요청 '전체'를
// too_many_tickers 로 거부해 시세·배당이 통째로 비고, 데이터 상태가 영구히 '확인 필요'가 된다.
// 상한은 입력 검증(보안 통제)이라 올리지 않고, 클라이언트가 상한에 맞춰 나눠 보낸다.
const API_TICKER_CHUNK = 25;
const BENCH_TICKER_LIMIT = 20;
function _chunkTickers(list, size = API_TICKER_CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function liveRefresh() {
  const tickers=new Set();
  pfolioData.forEach(i=>{if(i.grp==='주식'||i.grp==='가상화폐')tickers.add(i.tkr);});
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
        if(!mergedRates&&d.rates) mergedRates=d.rates;
      }catch(e){ failedChunks++; lastChunkError=e; console.error('[EOD Price Chunk]',chunk.length+'개',e?.message); }
    }
    if(failedChunks===chunks.length) throw (lastChunkError||new Error('시세 조회 실패'));
    const data={success:true,quotes,rates:mergedRates};

    const nowD=new Date();
    const dt=document.getElementById('side-date-display');
    if(dt)dt.textContent=`${nowD.getFullYear()}.${String(nowD.getMonth()+1).padStart(2,'0')}.${String(nowD.getDate()).padStart(2,'0')} (${days[nowD.getDay()]})`;

    if(data.rates){
      const updateFX=(id,newVal,oldVal)=>{const el=document.getElementById(id);if(el){el.textContent=newVal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});if(Math.abs(newVal-oldVal)>0.01)flash(el,newVal>oldVal?'up':'down');}};
      updateFX('side-usd-rate',data.rates.USD,RATES.USD);
      updateFX('side-usdjpy-rate',data.rates.USDJPY,RATES.USDJPY);
      const jpy100=data.rates.JPY*100;
      const oldJpy100=RATES.JPY*100;
      const jpyEl=document.getElementById('side-jpy-rate');
      if(jpyEl){jpyEl.textContent=jpy100.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});if(Math.abs(jpy100-oldJpy100)>0.01)flash(jpyEl,jpy100>oldJpy100?'up':'down');}
      RATES.USD=data.rates.USD;RATES.JPY=data.rates.JPY;
      const oldGold=window._GOLD_G_KRW||0;
      const hG=document.getElementById('side-gold-rate');
      if(hG){hG.textContent='₩'+data.rates.GOLD_G_KRW.toLocaleString();if(data.rates.GOLD_G_KRW!==oldGold)flash(hG,data.rates.GOLD_G_KRW>oldGold?'up':'down');}
      window._GOLD_G_KRW=data.rates.GOLD_G_KRW;
    }

    pfolioData.forEach(i=>{
      if(i.grp==='금'){
        // 금: curP는 단위당 원화. 단위에 맞는 per-unit 가격으로 업데이트
        if(window._GOLD_G_KRW){
          const gm = i.unit==='돈'?3.75:(i.unit==='kg'?1000:1);
          i.curP = window._GOLD_G_KRW * gm;
        }
      } else if(i.grp==='주식'||i.grp==='가상화폐'){
        // interval=1d는 완성된 일봉만 반환 → closes[last]가 마지막 거래일 확정 종가
        const t6=i.tkr.replace(/\.(?:KS|KQ)$/,'');
        const quotes=data.quotes||{};
        const q=quotes[i.tkr]||quotes[t6]||quotes[t6+'.KS']||quotes[t6+'.KQ'];
        const price=Number(q?.price||q?.prevClose);
        if(q&&price>0){
          i.curP = price;i._priceStale=false;
          // 일간 변동(DAILY) 산출용 — 전일 종가 및 종가 간 차이를 시세 수신 시점에 저장
          i.prevP = q.prevClose || null;
          i.dayP = (q.price && q.prevClose) ? q.price - q.prevClose : null;
        }else{i._priceStale=true;}
      }
    });
    syncDivHistory();changeOwner(currentOwner,null,true);
    renderPortFxPanel();
    const stale=pfolioData.filter(i=>i&&i._priceStale).length;
    const partial=failedChunks>0?` · 요청 ${chunks.length}건 중 ${failedChunks}건 실패`:'';
    return {ok:stale===0&&failedChunks===0,stale,failedChunks,
      detail:(stale?`${stale}개 최신 확인 필요`:'등록 자산 최신 상태')+partial};
  } catch(err){
    console.error('[EOD Price Fetch Error]',err);
    return {ok:false,error:err?.message||'시세 조회 실패'};
  }
}

// [수정7] 공포/탐욕: 하루 1번만 업데이트 (DAILY)
async function refreshFNG() {
  const today=_cfLocalDateKey(new Date());
  if(localStorage.getItem('fng_date')===today&&localStorage.getItem('fng_us')) {
    // 캐시된 값 사용
    const sfg=parseInt(localStorage.getItem('fng_us')||'50');
    const cfg=parseInt(localStorage.getItem('fng_crypto')||'50');
    applyFNG(sfg,cfg);return;
  }
  try{
    const resp=await authFetch('/api/price?type=fng');
    if(resp.ok){
      const d=await resp.json();
      if(d.success){
        localStorage.setItem('fng_date',today);
        localStorage.setItem('fng_us',String(d.us||50));
        localStorage.setItem('fng_crypto',String(d.crypto||50));
        applyFNG(d.us||50,d.crypto||50);
      }
    }
  }catch(_){}
}

function applyFNG(sfg,cfg) {
  const guEl=document.getElementById('gauge-us-val'),gcEl=document.getElementById('gauge-crypto-val');
  if(guEl)guEl.innerHTML=`<strong style="color:${getFGColor(sfg)};font-size:1.1rem">${sfg}</strong><br><span style="font-size:.55rem;color:var(--t3)">${getFGLabel(sfg)}</span>`;
  if(gcEl)gcEl.innerHTML=`<strong style="color:${getFGColor(cfg)};font-size:1.1rem">${cfg}</strong><br><span style="font-size:.55rem;color:var(--t3);letter-spacing:-.5px">${getFGLabel(cfg)}</span>`;
  if(window._gaugeUs){window._gaugeUs.data.datasets[0].needleValue=sfg;window._gaugeUs.update();}
  if(window._gaugeCrypto){window._gaugeCrypto.data.datasets[0].needleValue=cfg;window._gaugeCrypto.update();}
}

// DCA는 증권사 외부 서비스이므로 이 앱에서 체결을 생성하지 않는다.
// applyPendingDCA()는 과거 호출과의 호환을 위한 무변경 함수이며,
// 일정 표시는 cobalt.js의 시장·증권사별 계산만 사용한다.

// =============================================
// 자산이력 데이터
// =============================================
let assetHistory = [];

function getTotalPortfolioAssets() {
  let total = 0;
  pfolioData.forEach(i => {
    if (i.grp === '금') {
      // curP는 단위당 가격 (g당 KRW, 또는 돈당 KRW 등) — 단위 변환 없이 직접 곱셈
      total += i.qty * i.curP;
    } else {
      total += i.qty * i.curP * (RATES[i.cur] || 1);
    }
  });
  return total;
}
function getOwnerPortfolioAssets(owner) {
  if (!owner || owner === '전체') return getTotalPortfolioAssets();
  let total = 0;
  filterByOwner(pfolioData, owner).forEach(i => {
    if (i.grp === '금') total += i.qty * i.curP;
    else total += i.qty * i.curP * (RATES[i.cur] || 1);
  });
  return total;
}

// 도넛 클릭 시 카테고리별 상세 종목 반환
function getItemsByDonutCategory(label, owner) {
  const all = getFilteredAssets(owner);
  let items;
  switch (label) {
    case '한국주식': items = all.filter(i => i.grp === '주식' && i.cur === 'KRW' && !(i.acc || '').match(/연금|IRP/)); break;
    case '해외주식': items = all.filter(i => i.grp === '주식' && i.cur !== 'KRW' && !(i.acc || '').match(/연금|IRP/)); break;
    case '연금': items = all.filter(i => i.grp === '주식' && (i.acc || '').match(/연금|IRP/)); break;
    case '가상화폐': items = all.filter(i => i.grp === '가상화폐'); break;
    case '금': items = all.filter(i => i.grp === '금'); break;
    case '현금': items = all.filter(i => i.grp === '현금'); break;
    default: items = all.filter(i => i.grp === label);
  }
  return items.map(i => ({
    name: i.name,
    value: Math.round(i.grp === '금'
      ? i.qty * (i.unit === '돈' ? 3.75 : i.unit === 'kg' ? 1000 : 1) * (window._GOLD_G_KRW || i.curP)
      : i.qty * i.curP * (RATES[i.cur] || 1))
  })).sort((a, b) => b.value - a.value);
}

// =============================================
// 순자산 표시 업데이트
// =============================================
function updateNetAssetDisplay() {
  // 소유주 필터 반영 — '전체' 일 때만 전체 합산. 부동산·부채 제거 후 순자산 = 투자자산 합계
  const portAssets = getOwnerPortfolioAssets(currentOwner);
  const netAsset = portAssets;

  // Dashboard net asset panel
  const netEl = document.getElementById('dash-net-asset');
  if (netEl) {
    netEl.innerText = (netAsset < 0 ? '-₩' : '₩') + Math.round(Math.abs(netAsset)).toLocaleString();
    netEl.className = netAsset >= 0 ? 'c-up' : 'c-dn';
  }

  // 사이드바 자산 요약 위젯 (소유주 필터 반영)
  const sOther = document.getElementById('side-other-assets');
  if(sOther) {
    const filteredForSide = getFilteredAssets(currentOwner);
    const grpTotals={'주식':0,'가상화폐':0,'금':0,'현금':0};
    filteredForSide.forEach(i=>{
      let v=i.grp==='금'?i.qty*(i.unit==='돈'?3.75:i.unit==='kg'?1000:1)*(window._GOLD_G_KRW||i.curP):i.qty*i.curP*(RATES[i.cur]||1);
      if(grpTotals[i.grp]!==undefined)grpTotals[i.grp]+=v;
    });
    const curYear=String(new Date().getFullYear());
    const ownerForDiv = currentOwner==='전체' ? '전체' : currentOwner;
    const divArr = (divHistory[curYear]||{})[ownerForDiv] || Array(12).fill(0);
    const divTotal = divArr.reduce((a,b)=>a+(b||0),0);
    const cfNet=cfData.reduce((s,i)=>i.type==='수입'?s+i.amt:s-i.amt,0);
    const rows=[
      {label:'주식',val:grpTotals['주식']},
      {label:'가상화폐',val:grpTotals['가상화폐']},
      {label:'금',val:grpTotals['금']},
      {label:'현금',val:grpTotals['현금']},
      {label:curYear+' 배당수입',val:divTotal},
      ...(currentOwner==='본인'?[{label:'현금흐름 누적',val:cfNet}]:[]),
    ];
    sOther.innerHTML = rows.filter(r=>r.val!==0).map(r=>{
      const cls=r.val<0?'c-dn':r.val>0?'':'';
      return `<div class="f-between" style="padding:2px 0;border-bottom:1px solid var(--border-light)"><span style="color:var(--t3)">${r.label}</span><span class="${cls}" style="font-weight:600">${r.val<0?'-₩':'₩'}${Math.abs(Math.round(r.val)).toLocaleString()}</span></div>`;
    }).join('') || '<div style="color:var(--t3);font-size:.72rem">데이터 없음</div>';
  }
}


// =============================================
// 자산 이력 스냅샷
// =============================================
function saveSnapshot() {
  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const totalAssets = getTotalPortfolioAssets();
  const entry = { date: monthStr, totalAssets: Math.round(totalAssets), totalLiab: 0, netAssets: Math.round(totalAssets) };
  const existing = assetHistory.findIndex(h => h.date === monthStr);
  if (existing > -1) assetHistory[existing] = entry;
  else {
    assetHistory.push(entry);
    assetHistory.sort((a, b) => a.date.localeCompare(b.date));
    if (assetHistory.length > 24) assetHistory.splice(0, assetHistory.length - 24);
  }
  renderHistoryChart();
  saveExtDataToKV();
  alert(monthStr + ' 자산 스냅샷이 저장되었습니다.\n총자산: ₩' + Math.round(totalAssets).toLocaleString());
}

function renderHistoryChart() {
  if (!window.historyChartInst) return;
  if (assetHistory.length === 0) {
    window.historyChartInst.data.labels = [];
    window.historyChartInst.data.datasets[0].data = [];
    window.historyChartInst.data.datasets[1].data = [];
    window.historyChartInst.update();
    return;
  }
  window.historyChartInst.data.labels = assetHistory.map(h => h.date.replace('-', '년 ') + '월');
  window.historyChartInst.data.datasets[0].data = assetHistory.map(h => h.totalAssets);
  window.historyChartInst.data.datasets[1].data = assetHistory.map(h => h.netAssets);
  window.historyChartInst.update();
}

// =============================================
// 가족 현황 비교
// =============================================
function renderFamilyView() {
  const owners = OWNERS;
  const cats = ['한국주식','해외주식','연금','가상화폐','금','현금'];
  const catColors = {'한국주식':'#4ecdc4','해외주식':'#5b9bff','연금':'#c084fc','가상화폐':'#f2a33c','금':'#d4b24a','현금':'#94a3c8'};

  // 각 멤버별 자산 계산
  function getMemberCats(owner) {
    const items = pfolioData.filter(i => i.owner === owner);
    const result = {total:0, invest:0, knownTotal:0};
    cats.forEach(c => result[c] = 0);
    items.forEach(i => {
      let val = i.grp==='금' ? i.qty*i.curP : i.qty*i.curP*(RATES[i.cur]||1);
      let inv;
      if (i.grp==='금') { inv = i.qty*i.avgP; }
      else if (i.grp==='가상화폐' && i.cur==='USD') {
        const _fR=RATES.USD||1380; const _usd=i.avgP>0&&i.avgP<10000000;
        inv = i.qty*(_usd?i.avgP*_fR:i.avgP);
      } else { inv = i.qty*i.avgP*(RATES[i.cur]||1); }
      result.total += val;
      if(!i.costUnknown){result.invest += inv;result.knownTotal += val;}
      if (i.grp==='가상화폐') result['가상화폐'] += val;
      else if (i.grp==='현금') result['현금'] += val;
      else if (i.grp==='금') result['금'] += val;
      else if (i.grp==='주식') {
        if ((i.acc||'').match(/연금|IRP/)) result['연금'] += val;
        else if (i.cur==='KRW') result['한국주식'] += val;
        else result['해외주식'] += val;
      }
    });
    result.profitPct = result.invest > 0 ? ((result.knownTotal - result.invest) / result.invest * 100) : 0;
    return result;
  }

  const data = {}; owners.forEach(o => data[o] = getMemberCats(o));

  // 연간 배당 예상 (divHistory 기준)
  function getMemberAnnualDiv(owner) {
    const yr = String(new Date().getFullYear());
    const dh = divHistory[yr] && divHistory[yr][owner];
    return dh ? dh.reduce((s,v)=>s+(v||0),0) : 0;
  }

  // 비교 테이블
  const thead = document.getElementById('family-compare-head');
  const tbody = document.getElementById('family-compare-body');
  if (!thead || !tbody) return;
  thead.innerHTML = `<tr><th class="text-left" style="min-width:90px">항목</th>${owners.map(o=>`<th style="text-align:right">${o}</th>`).join('')}</tr>`;
  // 모바일은 5컬럼(항목+소유주4)이 좁은 폭에 들어가도록 억/천만/만 축약 포맷, 데스크톱은 1원 단위 풀 포맷
  const fmtKRW1 = v => isMobileLayout() ? '₩' + formatKRW(Math.round(v)) : '₩' + Math.round(v).toLocaleString();
  const rows = [
    {key:'total', label:'포트폴리오', fmt: v=>fmtKRW1(v)},
    {key:'한국주식', label:'한국주식', fmt: v=>v>0?fmtKRW1(v):'-'},
    {key:'해외주식', label:'해외주식', fmt: v=>v>0?fmtKRW1(v):'-'},
    {key:'연금', label:'연금', fmt: v=>v>0?fmtKRW1(v):'-'},
    {key:'가상화폐', label:'가상화폐', fmt: v=>v>0?fmtKRW1(v):'-'},
    {key:'금', label:'금', fmt: v=>v>0?fmtKRW1(v):'-'},
    {key:'현금', label:'현금', fmt: v=>v>0?fmtKRW1(v):'-'},
    {key:'annualDiv', label:'연간배당', fmt: v=>v>0?fmtKRW1(v):'-'},
  ];
  owners.forEach(o => { data[o].annualDiv = getMemberAnnualDiv(o); });
  // 소유주별 총자산 행
  const totalRow = `<tr style="border-top:2px solid var(--border-dark);background:var(--inner-bg)"><td class="text-left" style="font-weight:700;color:var(--t1)">총자산</td>${owners.map(o=>`<td style="text-align:right;font-weight:700">${fmtKRW1(data[o].total)}</td>`).join('')}</tr>`;
  // 수익률 행 (맨 아래)
  const profitRow = `<tr><td class="text-left" style="font-weight:600;color:var(--t2)">수익률</td>${owners.map(o=>{const v=data[o].profitPct;const c=v>=0?'var(--up)':'var(--dn)';return`<td style="text-align:right"><span style="color:${c};font-weight:700">${fmtPct(v,1)}</span></td>`}).join('')}</tr>`;
  tbody.innerHTML = rows.map(r=>`<tr>
    <td class="text-left" style="font-weight:600;color:var(--t2)">${r.label}</td>
    ${owners.map(o=>`<td style="text-align:right">${r.fmt(data[o][r.key])}</td>`).join('')}
  </tr>`).join('') + totalRow + profitRow;

  // 총자산 막대 차트
  if (window.familyBarChartInst) { window.familyBarChartInst.destroy(); window.familyBarChartInst = null; }
  const fbc = document.getElementById('familyBarChart');
  if (fbc) {
    window.familyBarChartInst = new Chart(fbc.getContext('2d'), {
      type:'bar',
      data:{ labels:owners, datasets:[{data:owners.map(o=>Math.round(data[o].total)), backgroundColor:owners.map(o=>ownerColors[o]||'#9CA3AF'), borderRadius:6}] },
      options:{ plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>` ₩${c.raw.toLocaleString()}`}}}, scales:{x:{grid:{display:false}},y:{grid:{color:'rgba(150,150,150,.15)',borderDash:[2,2]},ticks:{callback:KRW_TICK}}}}
    });
  }

  // 스택 차트
  if (window.familyStackChartInst) { window.familyStackChartInst.destroy(); window.familyStackChartInst = null; }
  const fsc = document.getElementById('familyStackChart');
  if (fsc) {
    window.familyStackChartInst = new Chart(fsc.getContext('2d'), {
      type:'bar',
      data:{
        labels:owners,
        datasets: [...cats.map(cat=>({ label:cat, data:owners.map(o=>Math.round(data[o][cat])), backgroundColor:catColors[cat], stack:'s' }))]
      },
      options:{ plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:9}}},tooltip:{mode:'index',intersect:false,callbacks:{label:c=>c.raw>0?` ${c.dataset.label}: ₩${c.raw.toLocaleString()}`:'',footer:items=>'합계: ₩'+items.reduce((s,c)=>s+(c.raw||0),0).toLocaleString()}}}, scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true,grid:{color:'rgba(150,150,150,.15)',borderDash:[2,2]},ticks:{callback:KRW_TICK}}}}
    });
  }
}

// 가족 재무계획 데이터 — 기존 goalData 키를 재사용해 이전 KV와 호환
let goalData = [];
window._balanceSheet = window._balanceSheet || { assets:[], liabilities:[], cashTargetMonths:6 };
window._dataFreshness = window._dataFreshness || {};
// 원격 원장을 정상적으로 읽기 전에는 빈 초기값을 다시 저장하지 않는다.
// 실패 후 데이터 상태의 개별 재시도가 성공하면 ready로 전환된다.
window._kvLoadState = window._kvLoadState || {assets:'pending',ext:'pending'};

// =============================================
// 환율 노출도 분석
// =============================================
function calcFxExposure(owner) {
  const assets = getFilteredAssets(owner).filter(a => a.grp !== '현금');
  let usdKRW = 0, krwTotal = 0, jpyKRW = 0;
  const usdRate = RATES.USD || 1380;
  const jpyRate = RATES.JPY || 9.2;
  assets.forEach(a => {
    const rawVal = (a.qty||0) * (a.curP||0);
    if (a.grp === '금') { krwTotal += rawVal; }
    else if (a.cur === 'USD') { usdKRW += rawVal * usdRate; }
    else if (a.cur === 'JPY') { jpyKRW += rawVal * jpyRate; }
    else { krwTotal += rawVal; }
  });
  const total = usdKRW + krwTotal + jpyKRW;
  return {
    usdKRW, krwTotal, jpyKRW, total,
    usdPct: total > 0 ? usdKRW / total * 100 : 0,
    krwPct: total > 0 ? krwTotal / total * 100 : 0,
    jpyPct: total > 0 ? jpyKRW / total * 100 : 0
  };
}

function renderDcaWidget(owner) {
  const panel = document.getElementById('port-dca-widget');
  if (!panel) return;
  const showAll = !owner || owner === '전체';
  const rawItems = pfolioData.filter(i => i.dca && (i.dcaAmt > 0 || (i.dcaMode === 'qty' && i.dcaQty > 0)) && (showAll || i.owner === owner));
  // 같은 소유주 + 같은 종목(다른 계좌)은 취합
  const mergeMap = new Map();
  rawItems.forEach(i => {
    const key = `${i.owner}::${(i.tkr||'').toUpperCase()}`;
    if (mergeMap.has(key)) {
      const m = mergeMap.get(key);
      m.dcaAmt = (m.dcaAmt||0) + (i.dcaAmt||0);
      m.dcaQty = (m.dcaQty||0) + (i.dcaQty||0);
    } else {
      mergeMap.set(key, {...i});
    }
  });
  const items = Array.from(mergeMap.values());
  if (!items.length) {
    panel.innerHTML = `<div class="card-title">DCA 자동매수</div><div style="flex:1;display:flex;align-items:center;justify-content:center;font-size:.75rem;color:var(--t3)">등록된 DCA 없음</div>`;
    return;
  }
  // 소유주 → 종목명 순 정렬
  items.sort((a,b) => {
    const oo = (a.owner||'').localeCompare(b.owner||'');
    return oo !== 0 ? oo : (a.name||'').localeCompare(b.name||'');
  });
  let prevOwner = null;
  const rows = items.map(i => {
    const isQtyMode = i.dcaMode === 'qty';
    const dcaAmtCur = ['USD','JPY','KRW'].includes(i.dcaCur) ? i.dcaCur : 'KRW';
    const amtSym = dcaAmtCur === 'USD' ? '$' : '₩';
    const amtDisplay = isQtyMode
      ? `<span style="color:var(--acc)">${(Number(i.dcaQty)||0).toLocaleString(undefined,{maximumFractionDigits:4})}주</span>`
      : `${amtSym}${(Number(i.dcaAmt)||0).toLocaleString()}`;
    const isKR = /^[0-9A-Z]{6}$/.test((i.tkr||'').replace(/\.(KS|KQ)$/,''));
    const displayName = _cfEsc(isKR ? (i.name || i.tkr) : (i.tkr || i.name));
    const ownerCell = showAll ? `<td style="font-size:.65rem;color:var(--acc);white-space:nowrap;padding-right:4px;font-weight:700">${_cfEsc(i.owner)}</td>` : '';
    let sepRow = '';
    if (showAll && i.owner !== prevOwner) {
      if (prevOwner !== null) {
        const sepColspan = showAll ? 4 : 3;
        sepRow = `<tr><td colspan="${sepColspan}" style="padding:0;border-top:1px solid var(--border-dark)"></td></tr>`;
      }
      prevOwner = i.owner;
    }
    return sepRow + `<tr>
      ${ownerCell}
      <td style="font-size:.72rem;color:var(--t1);overflow:hidden;text-overflow:ellipsis;max-width:0;width:100%">${displayName}</td>
      <td style="font-size:.68rem;color:var(--t3);white-space:nowrap;text-align:center;padding-left:6px">${_cfEsc(getDcaCycleLabel(i))}</td>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:.7rem;text-align:right;white-space:nowrap;padding-left:6px">${amtDisplay}</td>
    </tr>`;
  }).join('');
  const monthlyTotal = items.reduce((s, i) => {
    const cycle = i.dcaCycle || '매월';
    let amt;
    if (i.dcaMode === 'qty') {
      // 수량 기준: curP × rate × qty × 횟수로 KRW 환산 추정
      const rate = i.cur === 'USD' ? (RATES.USD||1380) : (i.cur === 'JPY' ? (RATES.JPY||9.2) : 1);
      amt = (i.dcaQty||0) * (i.curP||i.avgP||0) * rate;
    } else {
      // 금액 기준: dcaCur가 USD면 원화로 환산
      const dcaCur = i.dcaCur || 'KRW';
      const fxRate = dcaCur === 'USD' ? (RATES.USD||1380) : (dcaCur === 'JPY' ? (RATES.JPY||9.2) : 1);
      amt = (i.dcaAmt || 0) * fxRate;
    }
    if (cycle === '매일') return s + amt * 20;
    if (cycle === '매주') return s + amt * 4 * (Array.isArray(i.dcaDays) ? i.dcaDays.length : 1);
    return s + amt;
  }, 0);
  const thStyle = `position:sticky;top:0;z-index:1;background:var(--glass);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);padding:4px 4px;font-size:.65rem;color:var(--t3);font-weight:600;border-bottom:1px solid var(--border-dark)`;
  const ownerTh = showAll ? `<th style="${thStyle};text-align:left;width:44px">소유주</th>` : '';
  const footColspan = showAll ? 3 : 2;
  panel.innerHTML = `<div class="card-title" style="flex-shrink:0">DCA 자동매수</div>
    <div style="flex:1;overflow-y:auto;min-height:0">
      <table style="width:100%;border-collapse:collapse;font-size:.72rem;table-layout:fixed">
        <thead><tr>
          ${ownerTh}
          <th style="${thStyle};text-align:left">종목</th>
          <th style="${thStyle};text-align:center;width:60px">주기</th>
          <th style="${thStyle};text-align:right;width:80px">금액/수량</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="${footColspan}" style="font-size:.68rem;color:var(--t3);padding:5px 4px 2px;border-top:1px dashed var(--border-dark)">월 예상 합계 (수량기준 현재가 환산)</td>
          <td style="font-family:'IBM Plex Mono',monospace;font-size:.7rem;font-weight:700;color:var(--acc);text-align:right;padding:5px 4px 2px;border-top:1px dashed var(--border-dark)">₩${Math.round(monthlyTotal).toLocaleString()}</td>
        </tr></tfoot>
      </table>
    </div>`;
}

function renderFxExposure(owner) {
  const panel = document.getElementById('port-fx-column') || document.getElementById('port-fx-panel');
  if (!panel) return;
  const { usdKRW, krwTotal, jpyKRW, total, usdPct, krwPct, jpyPct } = calcFxExposure(owner);
  // 3-color progress bar: KRW(blue) | USD(orange) | JPY(pink) — only show JPY segment if > 0
  const jpyBar = jpyPct > 0
    ? `<div style="height:100%;width:${jpyPct.toFixed(1)}%;background:linear-gradient(to right,#E879F9,#F0ABFC);float:left;border-radius:0 6px 6px 0"></div>`
    : '';
  const usdRadius = jpyPct > 0 ? '0' : '6px';
  const jpyAmtRow = jpyKRW > 0
    ? `<div class="f-between"><span>JPY 자산 (환산)</span><span style="font-family:'IBM Plex Mono',monospace">₩${Math.round(jpyKRW).toLocaleString()}</span></div>`
    : '';
  const jpyLabel = jpyPct > 0
    ? `<span style="color:#E879F9;font-weight:700">JPY ${jpyPct.toFixed(1)}%</span>`
    : '';
  panel.innerHTML = `<div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <div class="card-title">환율 노출도</div>
    <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:6px">
      <span style="color:#3B82F6;font-weight:700">KRW ${krwPct.toFixed(1)}%</span>
      <span style="color:#F59E0B;font-weight:700">USD ${usdPct.toFixed(1)}%</span>
      ${jpyLabel}
    </div>
    <div style="height:10px;border-radius:6px;overflow:hidden;background:var(--inner-bg)">
      <div style="height:100%;width:${krwPct.toFixed(1)}%;background:linear-gradient(to right,#3B82F6,#60A5FA);float:left;border-radius:6px 0 0 6px"></div>
      <div style="height:100%;width:${usdPct.toFixed(1)}%;background:linear-gradient(to right,#F59E0B,#FCD34D);float:left;border-radius:0 ${usdRadius} ${usdRadius} 0"></div>
      ${jpyBar}
    </div>
    <div style="margin-top:10px;font-size:.75rem;color:var(--t2);line-height:1.8">
      <div class="f-between"><span>KRW 자산</span><span style="font-family:'IBM Plex Mono',monospace">₩${Math.round(krwTotal).toLocaleString()}</span></div>
      <div class="f-between"><span>USD 자산 (환산)</span><span style="font-family:'IBM Plex Mono',monospace">₩${Math.round(usdKRW).toLocaleString()}</span></div>
      ${jpyAmtRow}
      <div class="f-between" style="margin-top:4px;border-top:1px dashed var(--border-dark);padding-top:4px;font-weight:700"><span>합계</span><span style="font-family:'IBM Plex Mono',monospace">₩${Math.round(total).toLocaleString()}</span></div>
    </div>
  </div>`;
  panel.style.padding = '';
}

// =============================================
// 순자산 장기 추이
// =============================================
window._netWorthHistory = window._netWorthHistory || [];
window._netWorthHistoryChart = null;

// 오늘 순자산 스냅샷을 메모리에서 갱신한다. 저장 여부는 호출자가 결정한다.
// 재무상태표 CRUD 직후에도 이 함수를 호출해 KPI와 차트 마지막 점을 일치시킨다.
function updateNetWorthSnapshot() {
  const todayStr = _cfLocalDateKey(new Date());
  const sumAssets = (arr) => arr.reduce((s, a) => {
    if (a.grp === '금') return s + (a.qty||0) * (a.curP||0);
    return s + (a.qty||0) * (a.curP||0) * (RATES[a.cur]||1);
  }, 0);
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

function renderNetWorthHistoryChart(tf, btn) {
  if (btn) {
    document.querySelectorAll('.nwh-tf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  const hist = window._netWorthHistory || [];
  const now = new Date();
  // 'ALL' 은 HTML 버튼 onclick 에서, '전체' 는 switchDashTab 의 textContent 경로에서
  // 동일하게 들어옴 — 둘 다 null(falsy) 로 매핑해 전체 hist 를 반환.
  const cutoffMap = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365, 'ALL': null, '전체': null };
  const days = cutoffMap[tf];
  const filtered = days
    ? hist.filter(h => (now - new Date(h.date)) / 86400000 <= days)
    : hist;

  const canvas = document.getElementById('netWorthHistoryChart');
  if (!canvas) return;

  if (!window._netWorthHistoryChart) {
    window._netWorthHistoryChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels: [], datasets: [
        { label: '순자산', data: [], borderColor: '#3B82F6', tension: .4, pointRadius: 0, borderWidth: 2, fill: false, spanGaps: true },
        { label: '포트폴리오', data: [], borderColor: '#3B82F6', tension: .4, pointRadius: 0, borderWidth: 1.5, borderDash: [4,4], fill: false, spanGaps: true }
      ]},
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ₩${Math.round(c.raw).toLocaleString()}` } } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 12 }, maxTicksLimit: 6 } },
          y: { grid: { color: 'rgba(150,150,150,.15)', borderDash: [2,2] }, ticks: { font: { size: 12 }, callback: KRW_TICK } }
        }
      }
    });
  }
  const chart = window._netWorthHistoryChart;
  chart.data.labels = filtered.map(h => h.date.slice(5).replace('-', '/'));
  const bs=window._balanceSheet||{};
  const balanceSheetEmpty=(bs.assets||[]).reduce((s,x)=>s+(Number(x.amount)||0),0)===0
    &&(bs.liabilities||[]).reduce((s,x)=>s+(Number(x.amount)||0),0)===0;
  chart.data.datasets[0].data = filtered.map(h => typeof finSnapshotNet==='function'
    ? finSnapshotNet(h,balanceSheetEmpty)
    : h.total);
  chart.data.datasets[1].data = filtered.map(h => h.portfolio);
  chart.update();
}

function switchDashTab(tab, btn) {
  document.querySelectorAll('.dash-chart-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const mvWrap = document.getElementById('wrap-mini-value-chart');
  const nwWrap = document.getElementById('wrap-networth-chart');
  if (tab === 'portfolio') {
    if (mvWrap) mvWrap.style.display = '';
    if (nwWrap) nwWrap.style.display = 'none';
  } else {
    if (mvWrap) mvWrap.style.display = 'none';
    if (nwWrap) nwWrap.style.display = 'flex';
    const activeBtn = document.querySelector('.nwh-tf-btn.active') || document.querySelector('.nwh-tf-btn');
    renderNetWorthHistoryChart(activeBtn ? (activeBtn.textContent || '3M') : '3M', activeBtn);
  }
}

// =============================================
// 확장 데이터 KV 저장/로드
// =============================================
async function saveExtDataToKV() {
  if(window._kvLoadState?.ext!=='ready') {
    showSaveError('⚠️ 재무 데이터를 정상적으로 불러오기 전에는 저장할 수 없습니다. 데이터 상태에서 다시 확인해 주세요.');
    if(typeof finMarkFresh==='function') finMarkFresh('ext','재무계획·현금흐름','Vercel KV',false,'원격 데이터 재로드 전 저장 차단');
    return {ok:false,blocked:true,status:null};
  }
  const ext = { assetHistory: assetHistory, goalData: goalData, netWorthHistory: window._netWorthHistory || [], monthlyPLData: monthlyPLData, cfData: cfData, autoTransferData: autoTransferData, cfDeletedKeys: cfDeletedKeys, targetAlloc: window._targetAlloc || null, balanceSheet:window._balanceSheet || {assets:[],liabilities:[],cashTargetMonths:6}, giftActual: window._giftActual || null };
  const res = await setKV('ext_data', ext);
  const ok=!!(res&&res.result==="OK");
  if (!ok) showSaveError();
  if(typeof finMarkFresh==='function') finMarkFresh('ext','재무계획·현금흐름','Vercel KV',ok,ok?'확장 데이터 저장 완료':`저장 실패${res?.status?' ('+res.status+')':''}`);
  return {ok,status:res?.status||null};
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
    clearKvLoadError('ext');
    return {ok:true,empty:true,detail:'저장된 확장 데이터 없음'};
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const arrayFields=['assetHistory','goalData','netWorthHistory','monthlyPLData','cfData','autoTransferData','cfDeletedKeys'];
    const objectFields=['targetAlloc','balanceSheet','giftActual'];
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

    assetHistory=_normalizeAssetHistoryRows(normalized.assetHistory);
    goalData=_normalizeGoalRows(normalized.goalData);
    window._netWorthHistory=_normalizeNetWorthRows(normalized.netWorthHistory);
    window._targetAlloc=_normalizeTargetAlloc(normalized.targetAlloc);
    window._balanceSheet=_normalizeBalanceSheet(normalized.balanceSheet);
    window._giftActual=_normalizeGiftActual(normalized.giftActual);
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
    renderHistoryChart();
    updateNetAssetDisplay();
    changeOwner(currentOwner, null, true);
    window._kvLoadState.ext='ready';
    clearKvLoadError('ext');
    return {ok:true,detail:`목표 ${goalData.length}개 · 순자산 기록 ${(window._netWorthHistory||[]).length}개`};
  }
  window._kvLoadState.ext='failed';
  showKvLoadError('⚠️ 재무 데이터 형식이 올바르지 않습니다. 기존 데이터를 덮어쓰지 않도록 저장을 중단했습니다.','ext');
  return {ok:false,error:'확장 데이터 형식이 올바르지 않습니다.'};
}

// =============================================
// Chart.js 플러그인 등록
// =============================================
// Chart.js CDN 로드가 실패하면 여기서 ReferenceError가 나고, 최상위 실행이 중단되어
// 이 아래에서 선언되는 let/const(monthlyPLData·_bubbleOwner·KR_CODE_RE 등)가 영구 TDZ에
// 갇힌다 — 차트뿐 아니라 양도소득세·비중 차트 페이지가 통째로 죽는다. 차트만 포기하고
// 나머지 앱은 계속 뜨도록 가드한다.
if (typeof Chart === "undefined") {
  console.error('[Chart.js] 라이브러리 로드 실패 — 차트 없이 계속합니다.');
} else {
  Chart.register(
    {id:'barPercent',afterDatasetsDraw(c){if(c.canvas.id!=='holdingsBarChart')return;const{ctx,data}=c;ctx.save();ctx.font='bold 9.5px DM Sans';ctx.fillStyle=_chartLabelColor;ctx.textAlign='left';ctx.textBaseline='middle';c.getDatasetMeta(0).data.forEach((b,i)=>{const v=data.datasets[0].data[i],t=data.datasets[0].data.reduce((a,x)=>a+x,0)||1;ctx.fillText(Math.round((v/t)*100)+'%',b.x+4,b.y+1);});ctx.restore();}},
    {id:'gaugeNeedle',afterDatasetDraw(c){if(c.config.data.datasets[0].needleValue===undefined)return;const{ctx,data}=c,m=c.getDatasetMeta(0);if(!m.data.length)return;const cx=m.data[0].x,cy=m.data[0].y,or=m.data[0].outerRadius,ang=Math.PI+(data.datasets[0].needleValue/100*Math.PI);ctx.save();ctx.translate(cx,cy);ctx.rotate(ang);ctx.beginPath();ctx.moveTo(0,-2);ctx.lineTo(or-6,0);ctx.lineTo(0,2);ctx.fillStyle=_chartNeedleColor;ctx.fill();ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fillStyle=_chartHubColor;ctx.fill();ctx.restore();}}
  );
  // 버블 차트 관련 Highcharts 설정 삭제됨
  Chart.defaults.responsive=true;
  Chart.defaults.maintainAspectRatio=false;
  Chart.defaults.font.family="'Noto Sans KR','Manrope',sans-serif";
  Chart.defaults.plugins.tooltip.padding = 12;
  Chart.defaults.plugins.tooltip.cornerRadius = 10;
}

// ── 차트 테마: CSS 토큰을 단일 소스로 (라이트/다크 자동 일치) ──
function cssVar(name, fallback){
  try{ const v=getComputedStyle(document.body).getPropertyValue(name).trim(); return v||fallback; }
  catch(e){ return fallback; }
}
// 캔버스 직접 드로잉(플러그인)용 색 — applyChartTheme가 갱신
let _chartLabelColor='#64748b', _chartNeedleColor='#475569', _chartHubColor='#0f172a';
function applyChartTheme(){
  if(typeof Chart==='undefined') return;
  const t1=cssVar('--t1','#0f172a'), t2=cssVar('--t2','#475569'),
        glass=cssVar('--glass','#ffffff'), border=cssVar('--panel-border','#e3e8ef'),
        grid=cssVar('--grid','rgba(120,120,120,.15)');
  Chart.defaults.color=t2;
  Chart.defaults.borderColor=grid;
  const tp=Chart.defaults.plugins.tooltip;
  tp.backgroundColor=glass; tp.titleColor=t1; tp.bodyColor=t2; tp.borderColor=border; tp.borderWidth=1;
  _chartLabelColor=t2; _chartNeedleColor=t2; _chartHubColor=t1;
  // 테마 적용 후 기존 차트 전부 재드로우 — 초기 다크 로드 시 라이트색으로 그려진
  // 라벨(예: TOP5 위젯 y축 종목/소유주명)이 갱신되지 않던 문제 해결
  for(const id in Chart.instances){ try{ Chart.instances[id].update(); }catch(e){} }
}
applyChartTheme();

const getBConf=()=>{
  const ownerDefs=OWNERS.map(o=>({label:o,borderColor:BENCH_OWNER_COLORS[o]}));
  // 초기 placeholder — pfolioData 로드 타이밍 무관하게 4개 소유주 라인 자리 잡아둠.
  // 이후 updateBenchmark가 datasets를 통째로 교체하므로 잠깐만 보임.
  const ownerDatasets=ownerDefs.map(o=>({
    label:o.label,data:benchData['3M'].data[o.label]||[],borderColor:o.borderColor,tension:.4,
    borderDash:o.solid?[]:[5,5],borderWidth:o.solid?3:2,pointRadius:0,spanGaps:true
  }));
  return{type:'line',data:{labels:benchData['3M'].labels,datasets:[
    {label:'S&P 500',data:benchData['3M'].data['S&P 500'],borderColor:'#4ade80',tension:.4,borderWidth:2,pointRadius:0,spanGaps:true},
    {label:'KOSPI',data:benchData['3M'].data['KOSPI'],borderColor:'#f2a33c',tension:.4,borderWidth:2,pointRadius:0,spanGaps:true},
    ...ownerDatasets
  ]},options:{interaction:{mode:'index',intersect:false},plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:9}}},tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${c.raw!=null?(c.raw>0?'+':'')+c.raw+'%':'N/A'}`}}},scales:{x:{grid:{display:false}},y:{grid:{color:'rgba(150,150,150,.15)'},ticks:{callback:v=>v+'%'}}}}};
};
const cGC=v=>({type:'doughnut',data:{labels:['Extreme Fear','Fear','Neutral','Greed','Extreme Greed'],datasets:[{data:[20,20,20,20,20],backgroundColor:['#EF4444','#F97316','#FCD34D','#84CC16','#10B981'],borderWidth:0,needleValue:v}]},options:{rotation:270,circumference:180,cutout:'70%',layout:{padding:{bottom:0}},plugins:{legend:{display:false},tooltip:{enabled:false},gaugeNeedle:{}}}});

// =============================================
// 인증 (로그인)
// =============================================
function _setAuthenticatedUi(authenticated){
  const overlay=document.getElementById('login-overlay');
  const layout=document.querySelector('.layout');
  if(overlay){
    overlay.style.display=authenticated?'none':'flex';
    overlay.setAttribute('aria-hidden',authenticated?'true':'false');
  }
  if(layout){
    if(authenticated){layout.removeAttribute('inert');layout.removeAttribute('aria-hidden');}
    else{layout.setAttribute('inert','');layout.setAttribute('aria-hidden','true');}
  }
}

async function authFetch(url, options = {}) {
  // 인증 정보는 HttpOnly 쿠키로만 전송한다. 이전 빌드의 bearer 토큰은 즉시 폐기해
  // DOM XSS가 발생하더라도 JavaScript에서 세션 비밀을 읽을 수 없게 한다.
  try { sessionStorage.removeItem('_dashAuth'); } catch(e) {}
  options.credentials = 'same-origin';
  options.cache = options.cache || 'no-store';
  const res = await fetch(url, options);
  if (res.status === 401) {
    _setAuthenticatedUi(false);
    document.getElementById('login-pw')?.focus();
  }
  return res;
}

let _dashboardInitStarted = false;
function _startDashboardAfterAuth(){
  _setAuthenticatedUi(true);
  if (_dashboardInitStarted) return;
  _dashboardInitStarted = true;
  initDashboard();
  setTimeout(_fitActiveCharts, 800);
  setTimeout(_fitActiveCharts, 2500);
}

async function attemptLogin() {
  const pwEl = document.getElementById('login-pw');
  const errEl = document.getElementById('login-error');
  pwEl?.setAttribute('aria-invalid','false');
  errEl.style.display = 'none';
  errEl.textContent = '';
  const btn = document.querySelector('.login-btn');
  btn.disabled = true;
  btn.textContent = '확인 중...';
  btn.setAttribute('aria-busy','true');
  document.getElementById('login-form')?.setAttribute('aria-busy','true');
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwEl.value })
    });
    if (res.ok) {
      try { sessionStorage.removeItem('_dashAuth'); } catch(e) {}
      pwEl.value='';
      pwEl.setAttribute('aria-invalid','false');
      _startDashboardAfterAuth();
    } else {
      let message = res.status===429 ? '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.' : '비밀번호가 올바르지 않습니다.';
      try{ const body=await res.json(); if(body&&typeof body.error==='string'&&body.error.length<=120) message=body.error; }catch(e){}
      errEl.textContent = message;
      errEl.style.display = 'block';
      pwEl.setAttribute('aria-invalid','true');
      pwEl.value = '';
      pwEl.focus();
    }
  } catch (e) {
    errEl.textContent = '서버 연결 오류. 다시 시도하세요.';
    errEl.style.display = 'block';
    pwEl?.setAttribute('aria-invalid','true');
  }
  btn.disabled = false;
  btn.textContent = '확인';
  btn.removeAttribute('aria-busy');
  document.getElementById('login-form')?.removeAttribute('aria-busy');
}

async function logoutDashboard(){
  try{ await fetch('/api/auth',{method:'DELETE',credentials:'same-origin',cache:'no-store'}); }catch(e){}
  try { sessionStorage.removeItem('_dashAuth'); } catch(e) {}
  location.reload();
}

// =============================================
// window.onload - 차트 초기화
// =============================================
// [4] ESC 키로 모달 닫기
document.addEventListener('keydown', function(e) {
  const addModal=document.getElementById('add-modal');
  if(e.key==='Tab'&&addModal?.classList.contains('active')){
    const focusable=Array.from(addModal.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
      .filter(el=>el.getClientRects().length>0);
    if(focusable.length){
      const first=focusable[0],last=focusable[focusable.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  }
  const cfModal=document.getElementById('cfDetailModal');
  if(e.key==='Tab'&&cfModal?.classList.contains('active')){
    const focusable=Array.from(cfModal.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
      .filter(el=>el.getClientRects().length>0);
    if(focusable.length){
      const first=focusable[0],last=focusable[focusable.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  }
  if (e.key === 'Escape') {
    closeAddModal();
    if (typeof closeREModal === 'function') closeREModal();
    if (typeof closeLiabModal === 'function') closeLiabModal();
    closeCfDetails();
    closeSidebar();
    const dd=document.getElementById('search-dropdown');
    if(dd)dd.style.display='none';
  }
});
// 검색 드롭다운 외부 클릭시 닫기
document.addEventListener('click', function(e) {
  const srch = document.getElementById('add-search');
  const dd = document.getElementById('search-dropdown');
  if (dd && srch && !srch.contains(e.target) && !dd.contains(e.target)) {
    dd.style.display = 'none';
  }
});

// [5] 포트폴리오 테이블 정렬
let _sortState = {}; // {grpName: {field, dir}}
function sortPortfolioTable(grpName, field, thEl) {
  if (!_sortState[grpName]) _sortState[grpName] = {field: null, dir: 1};
  const st = _sortState[grpName];
  if (st.field === field) { st.dir *= -1; } else { st.field = field; st.dir = -1; }
  // 헤더 클래스 업데이트
  const header = thEl.closest('th') || thEl;
  const table = header.closest('table');
  table.querySelectorAll('th.sortable').forEach(th => {
    th.classList.remove('sort-asc','sort-desc');
    th.setAttribute('aria-sort','none');
  });
  header.classList.add(st.dir === -1 ? 'sort-desc' : 'sort-asc');
  header.setAttribute('aria-sort',st.dir===-1?'descending':'ascending');
  // tbody 행 정렬
  const tbody = table.querySelector('tbody');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const hasOwner = Array.from(table.tHead?.rows[0]?.cells || [])
    .some(th => th.textContent.trim() === '소유주');
  rows.sort((a, b) => {
    // 칼럼 인덱스(소유주 칼럼 제외 기준) — DCA 주기/회당 금액 다음부터 수치 칼럼이다.
    const cells = {
      qty: 4, avgP: 5, curP: 6, valKRW: 7, profit: 8, profitPct: 9
    };
    const ci = cells[field] ?? 5;
    const getVal = (row) => {
      const td = row.cells[ci + (hasOwner ? 1 : 0)];
      if (!td) return 0;
      const txt = td.innerText.replace(/[₩+\-,%\s]/g,'').replace(/,/g,'');
      return parseFloat(txt) || 0;
    };
    return (getVal(b) - getVal(a)) * st.dir;
  });
  rows.forEach(r => tbody.appendChild(r));
}

function initDashboard(){
  initCfDropdowns();
  document.getElementById('cf-date').value=_cfLocalDateKey(currentCfDate);

  // IME 한글 조합 이벤트 리스너 (조합 중 검색 방지)
  const searchInput = document.getElementById('add-search');
  if (searchInput) {
    searchInput.addEventListener('compositionstart', function(){ _isComposing = true; });
    searchInput.addEventListener('compositionend', function(){
      _isComposing = false;
      onSearchInput(); // 조합 완료 시 검색 실행
    });
    // Enter 키: 드롭다운 첫 번째 항목 선택 또는 API 검색 실행
    searchInput.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const dd = document.getElementById('search-dropdown');
      if (dd && dd.style.display !== 'none') {
        const first = dd.querySelector('div[onclick]');
        if (first) { first.click(); return; }
      }
      searchStockByApi();
    });
  }

  // [수정4] 포트폴리오 가치 차트 - 원 단위 Y축
  miniValueChart=new Chart(document.getElementById('miniValueChart').getContext('2d'),{
    type:'line',
    data:{labels:[],datasets:[{data:[],borderColor:'#5b9bff',tension:.4,pointRadius:2,pointHoverRadius:5,fill:true,backgroundColor:'rgba(91,155,255,.12)',spanGaps:false}]},
    options:{
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{
          title:(items)=>items[0].label,
          label:c=>{
            const cur=c.raw,base=c.dataset.data[0],p=cur-base,r=base?((p/base)*100).toFixed(2):0,s=p>0?'+':'';
            return [`평가액: ₩${Math.round(cur).toLocaleString()}원`,`누적변동: ${s}₩${Math.round(Math.abs(p)).toLocaleString()}원 (${s}${r}%)`];
          }
        }}
      },
      scales:{
        x:{grid:{display:false},ticks:{font:{size:12}}},
        y:{display:true,position:'left',grid:{color:'rgba(150,150,150,.15)',borderDash:[2,2]},ticks:{font:{size:12},callback:KRW_TICK}}
      }
    }
  });

  // benchmarkChart는 대시보드에서 제거됨 - myBenchChart는 null로 유지
  myBenchChart=null;
  myPortBenchChart=new Chart(document.getElementById('portBenchChart').getContext('2d'),getBConf());

  portPerfChartInst=new Chart(document.getElementById('portPerfChart').getContext('2d'),{type:'bar',data:{labels:[],datasets:[{label:'수익률(%)',data:[],backgroundColor:[],profitData:[],borderRadius:4}]},options:{indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>{let r=c.raw,amt=c.dataset.profitData[c.dataIndex]||0,signR=r>0?'+':'',signA=amt>0?'+':'';return` 수익률: ${signR}${r}% (${signA}₩${Math.abs(amt).toLocaleString()})`;}}},scales:{x:{title:{display:true,text:'수익률 (%)',font:{size:9},color:'#94a3b8'},grid:{color:'rgba(150,150,150,.15)',borderDash:[2,2]},ticks:{callback:v=>v+'%'}},y:{grid:{display:false}}},onClick:(e,a)=>{if(window.portPerfIsDetail){window.portPerfIsDetail=false;portPerfChartInst.data.labels=window.portPerfGroupData.labels;portPerfChartInst.data.datasets[0].data=window.portPerfGroupData.data;portPerfChartInst.data.datasets[0].profitData=window.portPerfGroupData.amounts;portPerfChartInst.data.datasets[0].backgroundColor=window.portPerfGroupData.colors;portPerfChartInst.update();}else if(a.length>0){const grp=portPerfChartInst.data.labels[a[0].index],detail=window.portPerfDetailData[grp];if(detail&&detail.labels&&detail.labels.length>0){window.portPerfIsDetail=true;portPerfChartInst.data.labels=detail.labels;portPerfChartInst.data.datasets[0].data=detail.data;portPerfChartInst.data.datasets[0].profitData=detail.amounts;portPerfChartInst.data.datasets[0].backgroundColor=detail.colors;portPerfChartInst.update();}}}}}});

  myDonutChart=new Chart(document.getElementById('donutChart').getContext('2d'),{type:'bar',data:{labels:[],datasets:[{data:[],backgroundColor:[],borderRadius:4}]},options:{indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>{const t=c.chart.data.datasets[0].data.reduce((a,b)=>a+b,0)||1;return` ₩${c.raw.toLocaleString()} (${Math.round(c.raw/t*100)}%)`;}}}},scales:{x:{display:true,grid:{color:'rgba(150,150,150,.08)',borderDash:[2,2]},ticks:{font:{size:12},maxTicksLimit:5,callback:KRW_TICK}},y:{grid:{display:false},ticks:{font:{size:12},color:'#64748b'}}}}});

  const initAccData=buildAccDonutData('전체');
  myAccDonutChart=new Chart(document.getElementById('accountDonutChart').getContext('2d'),{type:'doughnut',data:{labels:initAccData.labels,datasets:[{data:initAccData.data,backgroundColor:initAccData.bg,borderWidth:0}]},options:{cutout:'65%',layout:{padding:{right:10}},plugins:{legend:{position:'right',labels:{font:{size:9},generateLabels:c=>{const ds=c.data.datasets[0],t=ds.data.reduce((a,b)=>a+b,0)||1;return c.data.labels.map((l,i)=>({text:`${l} (${Math.round((ds.data[i]/t)*100)}%)`,fillStyle:ds.backgroundColor[i],hidden:false,index:i,fontColor:Chart.defaults.color}));}}},tooltip:{callbacks:{label:c=>` ₩${c.raw.toLocaleString()}`}}},onClick:(e,a)=>{if(a.length>0){const label=myAccDonutChart.data.labels[a[0].index];if(_donutAccLevel==='top'){_donutAccLevel='detail';const grpMap=myAccDonutChart._grpsByAcc?.[label]||{};const entries=Object.entries(grpMap).sort((a,b)=>b[1]-a[1]);if(entries.length===0){_donutAccLevel='top';return;}myAccDonutChart.data.labels=entries.map(([k])=>k);myAccDonutChart.data.datasets[0].data=entries.map(([,v])=>Math.round(v));myAccDonutChart.data.datasets[0].backgroundColor=entries.map((_,i)=>CHART_PALETTE[i%CHART_PALETTE.length]);myAccDonutChart.update('active');_setAccountDonutTitle(label,true);}else{changeOwner(currentOwner, null);}}}}});
  myAccDonutChart._grpsByAcc=initAccData.grpsByAcc;

  sectorDonutChartInst=new Chart(document.getElementById('sectorDonutChart').getContext('2d'),{type:'doughnut',data:{labels:[],datasets:[{data:[],backgroundColor:[],borderWidth:0}]},options:{cutout:'60%',layout:{padding:{right:5}},plugins:{legend:{position:'right',labels:{boxWidth:10,font:{size:9},generateLabels:c=>{const ds=c.data.datasets[0],t=ds.data.reduce((a,b)=>a+b,0)||1;return c.data.labels.map((l,i)=>({text:`${l} (${Math.round((ds.data[i]/t)*100)}%)`,fillStyle:ds.backgroundColor[i],hidden:false,index:i,fontColor:Chart.defaults.color}));}}},tooltip:{callbacks:{label:c=>{const items=sectorDonutChartInst._secItems[c.label];let tip=[` 총액: ₩${c.raw.toLocaleString()}`];if(items)items.sort((a,b)=>b.val-a.val).forEach(it=>tip.push(` - ${it.name}: ₩${Math.round(it.val).toLocaleString()}`));return tip;}}}}}});
  
  myBarChart=new Chart(document.getElementById('holdingsBarChart').getContext('2d'),{type:'bar',data:{labels:[],datasets:[{data:[],backgroundColor:[],borderRadius:4}]},options:{indexAxis:'y',layout:{padding:{right:28}},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>` ₩${c.raw.toLocaleString()}`}}},scales:{x:{display:false},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
  
  miniDivChart=new Chart(document.getElementById('miniDivChart').getContext('2d'),{type:'bar',data:{labels:['J','F','M','A','M','J','J','A','S','O','N','D'],datasets:[{data:[],backgroundColor:'#06B6D4',borderRadius:2}]},options:{plugins:{legend:{display:false},tooltip:{enabled:true,callbacks:{title:t=>(t[0].dataIndex+1)+'월',label:c=>' 예상 배당금: ₩'+c.raw.toLocaleString()}}},scales:{x:{grid:{display:false},ticks:{font:{size:8,family:'IBM Plex Mono'}}},y:{display:false}},onClick:(e,a)=>{if(a.length>0){const i=a[0].index;if(window.activeDivMonth===i){document.getElementById('div-breakdown').style.display='none';window.activeDivMonth=-1;}else{window.activeDivMonth=i;showDividendBreakdown(i);}}else{document.getElementById('div-breakdown').style.display='none';window.activeDivMonth=-1;}}}});

  window.allOwnersDivChartInst=new Chart(document.getElementById('allOwnersDivChart').getContext('2d'),{
    type:'bar',
    data:{
      labels:['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'],
      datasets:OWNERS.map(o=>({label:o, data:[...divHistoryOf(null,o)], backgroundColor:ownerColors[o], stack:'Stack 0'}))
    },
    options:{
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{position:'bottom',labels:{boxWidth:10,font:{size:10}}},
        tooltip:{callbacks:{
          label:c=>{
            const v=Math.round(c.raw||0);
            return v>0?` ${c.dataset.label}: ₩${v.toLocaleString()}`:'';
          },
          footer:items=>{
            const total=Math.round(items.reduce((s,c)=>s+(c.raw||0),0));
            return total>0?`합계: ₩${total.toLocaleString()}`:'';
          }
        }}
      },
      scales:{
        x:{stacked:true,grid:{display:false}},
        y:{stacked:true,grid:{color:'rgba(150,150,150,.15)',borderDash:[2,2]},ticks:{callback:v=>v>0?'₩'+Math.round(v).toLocaleString():''}}
      }
    }
  });

  window.mainDivChartInst=new Chart(document.getElementById('mainDivChart').getContext('2d'),{
    type:'bar',
    data:{labels:['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'],datasets:[{label:'월별 배당금',data:[...divHistoryOf(null,currentOwner)].map(v=>Math.round(v)),backgroundColor:'#06B6D4',borderRadius:6}]},
    options:{
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{
          title:items=>`${items[0].label} 예상 배당금`,
          label:c=>{const v=Math.round(c.raw||0);return v>0?` ₩${v.toLocaleString()}`:'없음';}
        }}
      },
      scales:{
        x:{grid:{display:false}},
        y:{grid:{color:'rgba(150,150,150,.15)',borderDash:[2,2]},ticks:{callback:v=>v>0?'₩'+Math.round(v).toLocaleString():''}}
      },
      onClick:(e,a)=>{
        if(a.length>0){
          const i=a[0].index;
          if(window.activeMainDivMonth===i){window.activeMainDivMonth=-1;renderDivTable(-1);}
          else{window.activeMainDivMonth=i;renderDivTable(i);}
        } else {window.activeMainDivMonth=-1;renderDivTable(-1);}
      }
    }
  });

  window.cfDonutChartInst=new Chart(document.getElementById('cfDonutChart').getContext('2d'),{type:'bar',data:{labels:[],datasets:[{data:[],backgroundColor:[],borderWidth:0,borderRadius:4}]},options:{indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>{const v=c.raw;return` ${v>=0?'+₩':'-₩'}${Math.abs(Math.round(v)).toLocaleString()}`;}}}},scales:{x:{grid:{color:'rgba(150,150,150,.1)',borderDash:[2,2]},ticks:{font:{size:9},callback:v=>{if(v===0)return'₩0';const abs=Math.abs(v);const sign=v<0?'-':'';if(abs>=10000000)return sign+'₩'+(abs/10000000).toFixed(1)+'천만';if(abs>=1000000)return sign+'₩'+(abs/1000000).toFixed(1)+'백만';return sign+'₩'+(abs/10000).toFixed(0)+'만';}}},y:{grid:{display:false},ticks:{font:{size:10}}}}}});

  window.cfTrendChartInst=new Chart(document.getElementById('cfTrendChart').getContext('2d'),{type:'bar',data:{labels:[],datasets:[{data:[],backgroundColor:[],borderRadius:4}]},options:{plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>{const idx=c.dataIndex,mIn=window.cfTrendDetails.in[idx]||0,mOut=window.cfTrendDetails.out[idx]||0,net=c.raw,sign=net<0?'-₩':'₩';return[` 순현금흐름: ${sign}${Math.abs(net).toLocaleString()}`,` 총 수입: ₩${mIn.toLocaleString()}`,` 총 지출: ₩${mOut.toLocaleString()}`];}}}},scales:{x:{grid:{display:false}},y:{grid:{color:'rgba(150,150,150,.15)',borderDash:[2,2]},ticks:{callback:v=>v===0?'₩0':(v<0?'-₩':'₩')+Math.abs(v/10000).toLocaleString()+'만'}}}}});

  window.giftChartInst=new Chart(document.getElementById('giftChart').getContext('2d'),{type:'bar',data:{labels:[],datasets:[{type:'line',label:'누적 한도액',data:[],borderColor:'#EF4444',borderDash:[5,5],borderWidth:2,pointRadius:0,fill:false,stepped:true},{type:'bar',label:'할인 미반영 증여액',data:[],backgroundColor:'#CBD5E1',borderRadius:4},{type:'bar',label:'할인 반영 증여액(PV)',data:[],backgroundColor:[],borderRadius:4}]},options:{interaction:{mode:'index',intersect:false},plugins:{legend:{position:'bottom',labels:{generateLabels:(c)=>{const isDark=isDarkTheme();const lc=isDark?'#cbd5e1':'#334155';return[{text:'누적 한도액',fillStyle:'#EF4444',strokeStyle:'#EF4444',fontColor:lc,datasetIndex:0},{text:'할인 미반영',fillStyle:'#CBD5E1',fontColor:lc,datasetIndex:1},{text:'미성년 전기(0~9세)',fillStyle:'#5b9bff',fontColor:lc,datasetIndex:2},{text:'미성년 후기(10~19세)',fillStyle:'#4ade80',fontColor:lc,datasetIndex:2},{text:'성년 전기(20~29세)',fillStyle:'#f2a33c',fontColor:lc,datasetIndex:2},{text:'성년 후기(30~39세)',fillStyle:'#c084fc',fontColor:lc,datasetIndex:2}];}}},tooltip:{callbacks:{
    title:items=>{
      const label=items[0].label||'';
      const age=parseInt(label)||0;
      const birthYr=window._giftBirthYear||new Date().getFullYear();
      const yr=birthYr+age;
      return `${yr}년, ${age}세`;
    },
    label:c=>` ${c.dataset.label}: ₩${Math.round(c.raw||0).toLocaleString()}`
  }}},scales:{x:{grid:{display:false},ticks:{maxTicksLimit:12}},y:{grid:{color:'rgba(150,150,150,.15)',borderDash:[2,2]},ticks:{callback:v=>{if(v===0)return'₩0';const abs=Math.abs(v);const sign=v<0?'-':'';if(abs>=100000000){const val=abs/100000000;return sign+'₩'+(val%1===0?val.toFixed(0):val.toFixed(1))+'억';}if(abs>=10000000){const val=abs/10000000;return sign+'₩'+val.toFixed(0)+'천만';}if(abs>=10000){const val=abs/10000;return sign+'₩'+val.toFixed(0)+'만';}return sign+'₩'+abs.toLocaleString();}}}}}});

  // 정밀 분석 - 월별 매도차익/손실 막대 차트
  window.plBarChartInst=new Chart(document.getElementById('plBarChart').getContext('2d'),{
    type:'bar',
    data:{labels:[],datasets:[
      {label:'해외',data:[],backgroundColor:[],borderRadius:4,stack:'s'},
      {label:'국내',data:[],backgroundColor:[],borderRadius:4,stack:'s'}
    ]},
    options:{
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{position:'bottom',labels:{boxWidth:10,font:{size:9}}},
        tooltip:{mode:'index',intersect:false,callbacks:{
          title:items=>items[0].label,
          label:c=>{const v=c.raw||0;const sign=v>=0?'+₩':'-₩';return ` ${c.dataset.label}: ${sign}${Math.abs(Math.round(v)).toLocaleString()}원`;},
          footer:items=>{const tot=items.reduce((s,it)=>s+(it.raw||0),0);const sign=tot>=0?'+₩':'-₩';return `총: ${sign}${Math.abs(Math.round(tot)).toLocaleString()}원`;}
        }}
      },
      scales:{
        x:{stacked:true,grid:{display:false},ticks:{font:{size:9}}},
        y:{
          stacked:true,
          grid:{color:'rgba(150,150,150,.15)',borderDash:[2,2]},
          ticks:{font:{size:9},callback:v=>{
            if(v===0)return'₩0';
            const abs=Math.abs(v);
            const sign=v<0?'-':'';
            if(abs>=10000000)return sign+'₩'+(abs/10000000).toFixed(1)+'천만';
            if(abs>=1000000)return sign+'₩'+(abs/1000000).toFixed(1)+'백만';
            return sign+'₩'+(abs/10000).toFixed(0)+'만';
          }}
        }
      }
    }
  });

  window._gaugeUs=new Chart(document.getElementById('gaugeUs'),cGC(50));
  window._gaugeCrypto=new Chart(document.getElementById('gaugeCrypto'),cGC(50));

  // 자산 추이 이력 차트
  window.historyChartInst=new Chart(document.getElementById('historyChart').getContext('2d'),{
    type:'line',
    data:{labels:[],datasets:[
      {label:'총자산',data:[],borderColor:'#5b9bff',tension:.4,pointRadius:3,fill:false,borderWidth:2},
      {label:'순자산',data:[],borderColor:'#10B981',tension:.4,pointRadius:3,fill:false,borderWidth:2,borderDash:[5,5]}
    ]},
    options:{
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:9}}},tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ₩${Math.round(c.raw).toLocaleString()}`}}},
      scales:{
        x:{grid:{display:false},ticks:{font:{size:9}}},
        y:{grid:{color:'rgba(150,150,150,.15)',borderDash:[2,2]},ticks:{callback:KRW_TICK}}
      }
    }
  });

  // 테마 복원 — 3테마 (light/dark/navy), 저장값 없으면 라이트 기본
  try{
    const savedTheme=localStorage.getItem('theme');
    setTheme(THEMES.includes(savedTheme) ? savedTheme : 'light');
  }catch(e){ setTheme('light'); }

  // 2. 숫자 입력 콤마 포매팅 적용 (모든 금액 입력란 — 기존 화이트리스트)
  ['goal-target','goal-monthly','cf-amt','add-qty','add-avgp','add-cash-amt','add-dca-amt','at-amt'].forEach(id=>{
    const el=document.getElementById(id);if(el)applyCommaFormatting(el);
  });
  // 2-1. 대시보드 전체 자동 쉼표 — inputmode=numeric/decimal 모든 input에 실시간 콤마 삽입
  try { initGlobalCommaInputs(); } catch(e){}

  changeOwner('전체', null);
  // 창을 열면 항상 대시보드로 시작
  switchView('dashboard', document.getElementById('menu-dashboard'));
  renderAutoTransfers();
  calcGift();

  // 초기 로드: KV에서 자산 로드 후 EOD 시세 1회 반영
  window.familyBarChartInst = null;
  window.familyStackChartInst = null;
  (async () => {
    // KRX 종목 DB(data/stocks.json)와 자산을 병렬 로드
    const [assetsResult,extResult]=await Promise.all([loadAssetsFromKV(), loadExtDataFromKV(), loadKoreanStocksDB()]);
    // 로컬 기본값을 원격 데이터 위에 저장하지 않도록, 확장 KV 로드 성공 뒤에만 자동이체를 실체화한다.
    if(assetsResult?.ok&&extResult?.ok) applyAutoTransfers();
    // 자산 로드 직후 벤치마크 차트 1회 정리 (placeholder → 실제 소유주 리스트)
    rerenderBenchmark();
    // 1차: stocks.json 기반으로 티커/초기값 주입 → 화면 즉시 채움
    if(assetsResult?.ok) injectInitialFromStocksDB();
    // 2차: 기존 EOD 시세(Yahoo 기반) 반영 — 페이지 진입 시 '전일 종가 갱신' 버튼과 동일한 자동 갱신
    if(assetsResult?.ok) await refreshMarketPrices();
    // 환율/금 등 Python 데이터도 자산 로드 완료 직후 자동 수집 (버튼 클릭 불필요)
    refreshPyData({includeDividends:!!assetsResult?.ok&&!!extResult?.ok});
    // 벤치마크 차트: 자산·시세(curP) 로드가 끝난 시점에 1회 로드 (고정 타이머 경합 제거).
    //   await 하지 않고 병렬 실행 — 이후 DCA/스냅샷 단계가 벤치마크 로딩을 기다리지 않도록.
    if(assetsResult?.ok) fetchBenchmarkData();
    // DCA는 증권사에서 체결되므로 이 앱에서는 일정만 표시한다.
    // 순자산 일별 스냅샷 저장 (하루 1회)
    if(assetsResult?.ok&&extResult?.ok) await saveNetWorthSnapshot();
    else console.warn('[initDashboard] 원본 KV 로드 실패로 순자산 스냅샷 저장을 건너뜁니다.');
    // 순자산 추이 차트 갱신 — 사용자가 이미 탭을 열어둔 경우에만
    // (탭이 닫힌 상태에서 차트를 새로 만들면 캔버스가 0x0으로 초기화되어
    //  이후 탭을 열어도 스케일이 갱신되지 않음. 닫힌 상태면 switchDashTab이
    //  탭 클릭 시점에 보이는 캔버스에서 정상 초기화함.)
    if (window._netWorthHistoryChart) {
      (document.querySelector('.nwh-tf-btn.active') || document.querySelector('.nwh-tf-btn'))?.click();
    }
    // 국내 시세 보완은 refreshMarketPrices에서 주 시세 API와 함께 최종 판정한다.
    refreshFNG();
    fetchHeatmapData();
    if(assetsResult?.ok) fetchDivData();
  })();
}

window.onload = async function() {
  initAmountPrivacy();
  initMenuGroups();
  refreshYearSelects();
  try { sessionStorage.removeItem('_dashAuth'); } catch(e) {}
  // 페이지를 열 때마다(새로고침 포함) 비밀번호를 다시 받는다.
  // 남아 있는 세션 쿠키를 먼저 서버에서 폐기해, 게이트가 화면 장식에 그치지 않고
  // 실제로 API 호출까지 막히도록 한다. 폐기 요청이 실패해도 게이트는 그대로 띄운다(fail-closed).
  try { await fetch('/api/auth',{method:'DELETE',credentials:'same-origin',cache:'no-store'}); }
  catch(e) { console.warn('[auth] 기존 세션 폐기 실패 — 로그인 화면은 그대로 표시합니다.', e); }
  _setAuthenticatedUi(false);
  document.getElementById('login-pw')?.focus();
};

// =============================================
// 정밀 분석 뷰 - 세금/배당/버블 차트
// =============================================
let _analysisOwner = '전체';
function setAnalysisOwner(owner, btn) {
  _analysisOwner = owner;
  document.querySelectorAll('[id^="analysis-owner-"]').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderDivCoverage();
  renderMonthlyPL();
}

function renderAnalysisView() {
  // 연도 드랍다운 현재 연도 기본 선택
  const yrSel = document.getElementById('pl-year-select');
  if(yrSel && !yrSel.value) yrSel.value = String(new Date().getFullYear());
  const ruleSlot=document.getElementById('legacy-analysis-tax-rule');
  if(ruleSlot&&typeof assetTaxRuleDisclosureHtml==='function'){
    const year=yrSel?.value||new Date().getFullYear();
    ruleSlot.innerHTML=assetTaxRuleDisclosureHtml('capitalGains',year)+assetTaxRuleDisclosureHtml('dividend',year);
  }
  renderDivCoverage();
  renderMonthlyPL();
}

// =============================================
// (removed) 리스크 & 성과 페이지 — 페이지 통째로 삭제됨.
// 일별 스냅샷(window._netWorthHistory)은 메인 대시보드의 #netWorthHistoryChart 와
// KV ext 페이로드에서 계속 사용되므로 데이터 자체는 보존.
// =============================================

// =============================================
// 배당+ (배당 심화) View
//   ① YoC: 매수원가 대비 현재 배당수익률
//   ② 배당성장률 CAGR: 종목별 주당 배당금(DPS) 연도별 추이
//   ③ DRIP 시뮬레이터: 배당 재투자 vs 현금 수령 비교
// =============================================
window._divPlusOwner = window._divPlusOwner || '전체';
window._divpDripChart = window._divpDripChart || null;
if (typeof window._divpOpenTab === 'undefined') window._divpOpenTab = null;

// 통화 기호 (₩ / $ / ¥)
function _divpCurSym(cur) {
  return cur === 'USD' ? '$' : (cur === 'JPY' ? '¥' : '₩');
}

// 배당+ 위젯 탭: 한 번에 하나만 펼침 (열린 위젯 재클릭 시 모두 닫힘)
function _divpApplyTabs() {
  ['yoc', 'cagr', 'drip'].forEach(k => {
    const body = document.getElementById('divp-tab-' + k);
    const head = document.getElementById('divp-head-' + k);
    const open = (k === window._divpOpenTab);
    if (body) body.style.display = open ? '' : 'none';
    if (head) head.classList.toggle('open', open);
  });
}
function _divpSwitchTab(key) {
  window._divpOpenTab = (window._divpOpenTab === key) ? null : key;
  _divpApplyTabs();
  // 숨김 상태로 생성된 차트는 크기가 0 → 표시 시 재렌더로 크기 보정
  if (window._divpOpenTab === 'drip') renderDripSimulator();
}

function _divpHeldStocks(owner) {
  return getFilteredAssets(owner)
    .filter(a => a.grp === '주식' && (a.qty||0) > 0)
    .map(a => ({ ...a, _key: (a.tkr||'').replace(/\.(KS|KQ)$/,'').toUpperCase() }));
}

function _divpAggregateByYear(events) {
  // events: [{date:'YYYY-MM-DD', amount:number}]
  const map = {};
  events.forEach(e => {
    const y = e.date.slice(0, 4);
    map[y] = (map[y] || 0) + e.amount;
  });
  return map;  // { '2021': 4.32, '2022': 4.56, ... }
}

// _divDataCache 에 연배당이 없거나 0인 종목(연 1회/비정기 배당주: SKM·BABA·일부 ETF 등)을
// 위해 10년치 raw 이력(_divHistoryRawCache)에서 연배당(주당, 종목통화)을 추정한다.
//  1) 최근 ~370일 지급 합(백엔드 yahooDiv 와 동일 정의), 0이면
//  2) 가장 최근 '완결' 연도(올해 제외)의 지급 합.
// 이력 자체가 없으면 null → YoC 행에서 정상 제외(진짜 무배당주 보존).
function _divpDpsFromHistory(key) {
  const raw = (window._divHistoryRawCache || {})[key];
  if (!raw || !Array.isArray(raw.events) || !raw.events.length) return null;
  const cur = raw.cur || 'USD';
  const cutoffDate=new Date();cutoffDate.setDate(cutoffDate.getDate()-370);
  const cutoff = _cfLocalDateKey(cutoffDate);
  const trailing = raw.events.reduce((s, e) => s + (e.date >= cutoff ? (e.amount || 0) : 0), 0);
  if (trailing > 0) return { dps: trailing, cur, source: 'hist-ttm' };
  const byYear = _divpAggregateByYear(raw.events);
  const curYear = new Date().getFullYear();
  const years = Object.keys(byYear).map(Number)
    .filter(y => y < curYear && byYear[String(y)] > 0).sort((a, b) => b - a);
  if (!years.length) return null;
  return { dps: byYear[String(years[0])], cur, source: 'hist-year' };
}

function _divpComputeCagr(annualMap) {
  const curYear = new Date().getFullYear();
  // 완결 연도만 (올해는 보통 미완결이라 제외)
  const completedYears = Object.keys(annualMap).map(Number).filter(y => y < curYear).sort((a,b)=>a-b);
  if (completedYears.length < 2) return { cagr3: null, cagr5: null, yoy: null, recent5: [] };
  const lastY = completedYears[completedYears.length - 1];
  const valLast = annualMap[String(lastY)];
  const cagr = (n) => {
    const target = lastY - n;
    if (!completedYears.includes(target)) return null;
    const valStart = annualMap[String(target)];
    if (!valStart || valStart <= 0) return null;
    return (Math.pow(valLast / valStart, 1 / n) - 1) * 100;
  };
  const yoyTarget = lastY - 1;
  const yoy = completedYears.includes(yoyTarget) && annualMap[String(yoyTarget)] > 0
    ? ((valLast / annualMap[String(yoyTarget)]) - 1) * 100
    : null;
  const recent5 = completedYears.slice(-5).map(y => ({ y, v: annualMap[String(y)] }));
  return { cagr3: cagr(3), cagr5: cagr(5), yoy, recent5 };
}

function _divpAggregateByTicker(stocks) {
  // 같은 _key(티커)로 묶어 qty 합, 가중평균 avgP 산출. avg curP는 여러 행의 가중평균.
  const byKey = {};
  stocks.forEach(a => {
    const k = a._key;
    if (!byKey[k]) {
      byKey[k] = { ...a, qty: 0, _totalCost: 0, _curPSum: 0, _curPWeight: 0 };
    }
    const q = a.qty || 0;
    byKey[k].qty += q;
    byKey[k]._totalCost += q * (a.avgP || 0);
    byKey[k]._curPSum += q * (a.curP || 0);
    byKey[k]._curPWeight += q;
  });
  return Object.values(byKey).map(x => {
    x.avgP = x.qty > 0 ? x._totalCost / x.qty : 0;
    if (x._curPWeight > 0) x.curP = x._curPSum / x._curPWeight;
    delete x._totalCost; delete x._curPSum; delete x._curPWeight;
    return x;
  });
}

function _divpRenderYocTable(owner) {
  const tbody = document.getElementById('divp-yoc-body');
  const tfoot = document.getElementById('divp-yoc-foot');
  if (!tbody) return;
  const aggregateMode = !!document.getElementById('divp-yoc-aggregate')?.checked;
  let stocks = _divpHeldStocks(owner);
  if (aggregateMode) stocks = _divpAggregateByTicker(stocks);
  const rows = [];
  let totalAnnualKrw = 0;

  stocks.forEach(a => {
    const cache = (window._divDataCache || {})[a._key];
    // 1순위: 현재 배당 캐시. 없거나 0이면 raw 이력으로 폴백(연 1회/비정기 배당주 구제).
    let dps, cacheCur, fromHist = false;
    if (cache && cache.annualDps > 0) {
      dps = cache.annualDps;          // 주당 연배당 (종목 통화)
      cacheCur = cache.cur;
    } else {
      const hist = _divpDpsFromHistory(a._key);
      if (!hist) return;              // 캐시·이력 모두 없음 → 정상 제외(무배당주)
      dps = hist.dps;
      cacheCur = hist.cur;
      fromHist = true;
    }
    const avgP = a.avgP || 0;
    const curP = a.curP || 0;
    // 한국 종목은 .KS/.KQ 접미사 또는 6자 영숫자 코드로 판별해 항상 KRW로 강제
    // (Yahoo가 일부 KR 종목에 USD 통화를 반환해 환산이 1380× 부풀려지는 사고 방지)
    const isKr = /\.(KS|KQ)$/i.test(a.tkr || '') || _KR_CODE_RE.test(a._key || '');
    const cur = isKr ? 'KRW' : (cacheCur || a.cur || 'KRW');
    const qty = a.qty || 0;
    const yoc = avgP > 0 ? (dps / avgP) * 100 : 0;
    // 폴백 경로엔 cache.yldNum 이 없으므로 curP 기반만 사용 (curP=0 이면 0)
    const curYld = curP > 0 ? (dps / curP) * 100 : (cache?.yldNum || 0);
    const fx = RATES[cur] || 1;
    const annualKrw = dps * qty * fx;
    totalAnnualKrw += annualKrw;
    rows.push({ name: a.name || a.tkr, cur, dps, avgP, qty, fx, yoc, curYld, annualKrw, fromHist });
  });

  rows.sort((a, b) => b.yoc - a.yoc);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--t3);padding:18px">배당 데이터 부족 — 우상단 '이력 새로고침' 시도</td></tr>`;
    if (tfoot) tfoot.innerHTML = '';
    return;
  }

  const fmtPx = (v, cur) => cur === 'USD' ? '$' + v.toFixed(2) : _divpCurSym(cur) + Math.round(v).toLocaleString();
  const fmtDps = (v, cur) => cur === 'USD' ? '$' + v.toFixed(3)
    : _divpCurSym(cur) + (cur === 'JPY' ? v.toLocaleString(undefined, {maximumFractionDigits:2}) : Math.round(v).toLocaleString());
  const yocColor = (yoc, cur) => yoc >= cur ? '#10B981' : (yoc >= cur*0.7 ? '#F59E0B' : 'var(--t1)');

  tbody.innerHTML = rows.map(r => {
    const upDelta = r.curYld > 0 ? r.yoc - r.curYld : 0;
    const arrow = upDelta > 0.1 ? '↑' : (upDelta < -0.1 ? '↓' : '·');
    const ac = upDelta > 0.1 ? '#10B981' : (upDelta < -0.1 ? '#EF4444' : 'var(--t3)');
    // 계산 투명성: 보유수량 × 주당 배당 × 환율 = 연 배당금(KRW)
    const dpsTxt = r.cur === 'USD' ? '$' + r.dps.toFixed(4)
      : _divpCurSym(r.cur) + r.dps.toLocaleString(undefined, {maximumFractionDigits: r.cur === 'JPY' ? 2 : 3});
    const fxTxt = r.cur === 'KRW' ? '×1' : `× ₩${r.fx.toLocaleString(undefined,{maximumFractionDigits:1})}/${r.cur}`;
    const breakdown = `보유 ${(Number(r.qty)||0).toLocaleString(undefined,{maximumFractionDigits:6})}주 × ${dpsTxt} ${fxTxt} = ₩${Math.round(Number(r.annualKrw)||0).toLocaleString()}`;
    // 최근 12개월 지급이 없어 직전 완결 연도 배당으로 추정한 경우 표시
    const histTag = r.fromHist
      ? ` <span title="최근 12개월 지급 이력이 없어 직전 완결 연도 배당으로 추정" style="color:var(--t3);font-weight:500;font-size:.72rem;cursor:help">≈이력</span>`
      : '';
    return `<tr>
      <td class="text-left"><strong>${_cfEsc(r.name)}</strong>${histTag}</td>
      <td class="text-right">${r.curYld.toFixed(2)}%</td>
      <td class="text-right" style="color:${yocColor(r.yoc, r.curYld)};font-weight:700">
        ${r.yoc.toFixed(2)}% <span style="color:${ac};font-weight:500;font-size:.78rem">${arrow}${Math.abs(upDelta).toFixed(2)}%p</span>
      </td>
      <td class="text-right">${fmtPx(r.avgP, r.cur)}</td>
      <td class="text-right">${fmtDps(r.dps, r.cur)}</td>
      <td class="text-right" style="cursor:help" title="${_cfEsc(breakdown)}">₩${Math.round(r.annualKrw).toLocaleString()}</td>
    </tr>`;
  }).join('');

  if (tfoot) {
    // colspan 없는 6셀 구조 — 모바일의 nth-child(4,5) 숨김·6컬럼 표시 규칙이 tfoot에도 그대로
    // 적용되어 합계가 종목별 '연 배당금' 컬럼 아래 우측 정렬로 떨어진다 (colspan 셀은 자식 순번이 밀려 정렬이 깨짐)
    tfoot.innerHTML = `<tr>
      <td class="text-left" style="font-weight:700;padding-top:10px;white-space:nowrap">연 배당 합계</td>
      <td></td><td></td><td></td><td></td>
      <td class="text-right" style="font-weight:700;color:var(--acc);padding-top:10px">₩${Math.round(totalAnnualKrw).toLocaleString()}</td>
    </tr>`;
  }
}

function _divpRenderCagrTable(owner) {
  const tbody = document.getElementById('divp-cagr-body');
  if (!tbody) return;
  // 같은 종목이 여러 계좌/소유주에 분산 보유될 수 있으므로 티커 단위로 중복 제거
  const seen = new Set();
  const stocks = _divpHeldStocks(owner).filter(a => {
    if (!a._key || seen.has(a._key)) return false;
    seen.add(a._key);
    return true;
  });
  const histRaw = window._divHistoryRawCache || {};

  const rows = stocks.map(a => {
    const raw = histRaw[a._key];
    if (!raw || !raw.events || raw.events.length < 2) return null;
    const annualMap = _divpAggregateByYear(raw.events);
    const m = _divpComputeCagr(annualMap);
    if (!m.recent5.length) return null;
    const isKr = /\.(KS|KQ)$/i.test(a.tkr || '') || _KR_CODE_RE.test(a._key || '');
    const cur = isKr ? 'KRW' : (raw.cur || window._divDataCache?.[a._key]?.cur || a.cur || 'USD');
    return { name: a.name || a.tkr, cur, ...m };
  }).filter(Boolean);

  // 5Y CAGR 우선 정렬, 없으면 3Y
  rows.sort((a, b) => {
    const av = a.cagr5 != null ? a.cagr5 : (a.cagr3 != null ? a.cagr3 : -Infinity);
    const bv = b.cagr5 != null ? b.cagr5 : (b.cagr3 != null ? b.cagr3 : -Infinity);
    return bv - av;
  });

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--t3);padding:18px">배당 이력 데이터 부족 — 우상단 '이력 새로고침' 후 재시도</td></tr>`;
    return;
  }

  const fmtPct = v => v == null ? '<span style="color:var(--t3)">-</span>' : `<span style="color:${v >= 0 ? '#10B981' : '#EF4444'};font-weight:700">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</span>`;
  const fmtDps = (v, cur) => cur === 'USD' ? '$' + v.toFixed(3)
    : _divpCurSym(cur) + (cur === 'JPY' ? v.toLocaleString(undefined, {maximumFractionDigits:2}) : Math.round(v).toLocaleString());

  tbody.innerHTML = rows.map(r => {
    const recentTxt = r.recent5.map(p => `<span class="divp-dps-item"><span class="divp-dps-yr">${p.y}</span><span class="divp-dps-val">${fmtDps(p.v, r.cur)}</span></span>`).join('');
    return `<tr>
      <td class="text-left"><strong>${_cfEsc(r.name)}</strong></td>
      <td class="text-right">${_cfEsc(r.cur)}</td>
      <td class="text-right">${fmtPct(r.cagr3)}</td>
      <td class="text-right">${fmtPct(r.cagr5)}</td>
      <td class="text-right">${fmtPct(r.yoy)}</td>
      <td class="text-right"><div class="divp-dps-row">${recentTxt}</div></td>
    </tr>`;
  }).join('');
}

function _divpFillDripDropdown(owner) {
  const sel = document.getElementById('divp-drip-tkr');
  if (!sel) return;
  const prev = sel.value;
  const seen = new Set();
  const stocks = _divpHeldStocks(owner)
    .filter(a => {
      const c = (window._divDataCache || {})[a._key];
      if (!c || !(c.annualDps > 0)) return false;
      if (!a._key || seen.has(a._key)) return false;
      seen.add(a._key);
      return true;
    });
  if (!stocks.length) {
    const option=document.createElement('option');option.value='';option.textContent='배당 종목 없음';sel.replaceChildren(option);
    return;
  }
  const options=stocks.map(a=>{const option=document.createElement('option');option.value=String(a._key||'').slice(0,80);option.textContent=String(a.name||a.tkr||'').slice(0,160);return option;});
  sel.replaceChildren(...options);
  if (prev && stocks.some(a => a._key === prev)) sel.value = prev;
}

function _divpDripTaxRules(accType) {
  // 일반·ISA 세율과 공제액은 현재 규칙 버전에서 읽고, 연금은 과세이연한다.
  if (accType === '연금') return { rate: 0, exempt: Infinity };
  if (accType === 'ISA') return {
    rate:_taxRuleValue('isa.separateTaxCombinedRate',0.099),
    exempt:_taxRuleValue('isa.generalExemptionKrw',2_000_000),
  };
  return { rate:_taxRuleValue('dividend.generalWithholdingCombinedRate',0.154), exempt:0 };
}

function renderDripSimulator() {
  const tkr = document.getElementById('divp-drip-tkr')?.value;
  const principal = Number(document.getElementById('divp-drip-principal')?.value) || 0;
  const divGrowth = (Number(document.getElementById('divp-drip-divgrowth')?.value) || 0) / 100;
  const pxGrowth = (Number(document.getElementById('divp-drip-pxgrowth')?.value) || 0) / 100;
  const years = Math.max(1, Math.min(40, Number(document.getElementById('divp-drip-years')?.value) || 20));
  const accType = document.getElementById('divp-drip-acc')?.value || '일반';

  const cardsEl = document.getElementById('divp-drip-cards');
  const empty = (msg) => {
    if (cardsEl) cardsEl.innerHTML = `<div style="grid-column:1/-1;color:var(--t3);font-size:.85rem;padding:14px;text-align:center">${msg}</div>`;
    if (window._divpDripChart) { window._divpDripChart.data.labels = []; window._divpDripChart.data.datasets.forEach(d => d.data = []); window._divpDripChart.update(); }
  };
  if (!tkr) { empty('대상 종목을 선택하세요'); return; }
  const cache = (window._divDataCache || {})[tkr];
  if (!cache || !cache.annualDps || cache.annualDps <= 0) { empty('배당 데이터 없음'); return; }
  const stock = _divpHeldStocks(window._divPlusOwner).find(a => a._key === tkr) || pfolioData.find(a => (a.tkr||'').replace(/\.(KS|KQ)$/,'').toUpperCase() === tkr);
  if (!stock) { empty('보유 정보 없음'); return; }

  const isKr = /\.(KS|KQ)$/i.test(stock.tkr || '') || _KR_CODE_RE.test(tkr || '');
  const cur = isKr ? 'KRW' : (cache.cur || stock.cur || 'KRW');
  const fx = RATES[cur] || 1;
  const startPriceNative = stock.curP || 0;
  if (startPriceNative <= 0) { empty('현재가 없음'); return; }

  // 초기 주식 수: 원금(KRW) → 종목 통화 → 주식 수
  let dripShares = principal / fx / startPriceNative;
  let cashShares = dripShares;
  let dpsNative = cache.annualDps;
  let priceNative = startPriceNative;
  let cumCashDivKrw = 0;
  let cumDripDivKrw = 0;
  const tax = _divpDripTaxRules(accType);

  const labels = ['0'];
  const dripValues = [dripShares * priceNative * fx];
  const cashValues = [cashShares * priceNative * fx];
  const cumCashDivSeries = [0];

  for (let y = 1; y <= years; y++) {
    // 연 배당 (둘 다 동일 시점에서 같은 dpsNative 사용)
    const dripDivNative = dripShares * dpsNative;
    const cashDivNative = cashShares * dpsNative;
    const dripDivKrw = dripDivNative * fx;
    const cashDivKrw = cashDivNative * fx;
    // 세금 적용 (KRW 기준)
    const dripNetKrw = Math.max(0, dripDivKrw - tax.exempt) * (1 - tax.rate) + Math.min(dripDivKrw, tax.exempt) * 1.0;
    const cashNetKrw = Math.max(0, cashDivKrw - tax.exempt) * (1 - tax.rate) + Math.min(cashDivKrw, tax.exempt) * 1.0;
    cumCashDivKrw += cashNetKrw;
    cumDripDivKrw += dripNetKrw;
    // DRIP: 세후 배당 → 종목통화 → 신규 주식 매수 (현재 가격으로)
    const newShares = (dripNetKrw / fx) / priceNative;
    dripShares += newShares;
    // 다음해로 진행
    priceNative *= (1 + pxGrowth);
    dpsNative *= (1 + divGrowth);
    labels.push(String(y));
    dripValues.push(dripShares * priceNative * fx);
    cashValues.push(cashShares * priceNative * fx);
    cumCashDivSeries.push(cumCashDivKrw);
  }

  const finalDrip = dripValues[dripValues.length - 1];
  const finalCash = cashValues[cashValues.length - 1];
  const cashTotalWithDiv = finalCash + cumCashDivKrw;
  const dripAdvantage = finalDrip - cashTotalWithDiv;

  if (cardsEl) {
    const card = (label, val, color, sub) => `
      <div class="drip-card">
        <div class="drip-card-label">${label}</div>
        <div class="drip-card-val" style="color:${color||'var(--t1)'}" title="${val}">${val}</div>
        ${sub ? `<div class="drip-card-sub">${sub}</div>` : ''}
      </div>`;
    cardsEl.innerHTML = [
      card('DRIP 최종 평가', '₩' + formatKRW(finalDrip), '#10B981', `${years}년 후 / 누적 배당 ₩${formatKRW(cumDripDivKrw)} 재투자`),
      card('현금 시나리오 평가', '₩' + formatKRW(cashTotalWithDiv), 'var(--t1)', `보유주식 ₩${formatKRW(finalCash)} + 누적 배당 ₩${formatKRW(cumCashDivKrw)}`),
      card('DRIP 우위', (dripAdvantage >= 0 ? '+' : '') + '₩' + formatKRW(Math.abs(dripAdvantage)), dripAdvantage >= 0 ? '#10B981' : '#EF4444', `${((dripAdvantage / cashTotalWithDiv) * 100).toFixed(1)}% 추가 가치`),
      card('연환산 수익률', ((Math.pow(finalDrip / principal, 1/years) - 1) * 100).toFixed(2) + '%', 'var(--acc)', `초기 투자 ₩${formatKRW(principal)} 대비`),
    ].join('');
  }

  const canvas = document.getElementById('divpDripChart');
  if (!canvas) return;
  if (!window._divpDripChart) {
    window._divpDripChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels: [], datasets: [
        { label: 'DRIP (재투자)', data: [], borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,.1)', tension: .3, fill: true, pointRadius: 0, borderWidth: 2 },
        { label: '현금 시나리오 (주식 평가)', data: [], borderColor: '#3B82F6', tension: .3, pointRadius: 0, borderWidth: 1.5, borderDash: [4,4], fill: false },
        { label: '현금 시나리오 (누적 배당)', data: [], borderColor: '#F59E0B', tension: .3, pointRadius: 0, borderWidth: 1.5, borderDash: [2,2], fill: false }
      ]},
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: { callbacks: {
            title: items => `${items[0].label}년 후`,
            label: c => ` ${c.dataset.label}: ₩${Math.round(c.raw).toLocaleString()}`
          }}
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 }, callback: function(v) { return this.getLabelForValue(v) + '년'; } } },
          y: { grid: { color: 'rgba(150,150,150,.15)', borderDash: [2,2] }, ticks: { font: { size: 11 }, callback: KRW_TICK } }
        }
      }
    });
  }
  const chart = window._divpDripChart;
  chart.data.labels = labels;
  chart.data.datasets[0].data = dripValues;
  chart.data.datasets[1].data = cashValues;
  chart.data.datasets[2].data = cumCashDivSeries;
  chart.update();
}

function setDivPlusOwner(owner, btn) {
  window._divPlusOwner = owner;
  document.querySelectorAll('#divp-owner-pills .rsk-owner-pill').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  _divpRenderYocTable(owner);
  _divpRenderCagrTable(owner);
  _divpFillDripDropdown(owner);
  renderDripSimulator();
}

async function reloadDivPlusHistory(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 조회 중...'; }
  try {
    await fetchDivData();              // 현재 배당 정보 재조회
    await fetchDividendHistory(true);  // raw 이력 강제 재조회
    _divpRenderCagrTable(window._divPlusOwner);
    _divpRenderYocTable(window._divPlusOwner);
    _divpFillDripDropdown(window._divPlusOwner);
    renderDripSimulator();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 이력 새로고침'; }
  }
}

async function renderDividendPlusView() {
  // 배당 정보가 없으면 먼저 조회
  if (!window._divDataCache || !Object.keys(window._divDataCache).length) {
    await fetchDivData();
  }
  // raw 이력은 캐시 우선 (없으면 fetch)
  if (!window._divHistoryRawCache || !Object.keys(window._divHistoryRawCache).length) {
    await fetchDividendHistory(false);
  }
  _divpRenderYocTable(window._divPlusOwner);
  _divpRenderCagrTable(window._divPlusOwner);
  _divpFillDripDropdown(window._divPlusOwner);
  renderDripSimulator();
  _divpApplyTabs();
}

// =============================================
// 목표 & 리밸런싱 View
//   집중도 리스크 위젯(소유주별) + 포트폴리오 어드바이저(한·미·일 종목 검색).
//   _targetAlloc 키는 구버전 클라이언트 호환을 위해 read/write 자체는 유지.
// =============================================
window._targetAlloc = window._targetAlloc || null;  // {groups, region, threshold} — UI 제거, KV 페이로드만 보존

function _tgtRenderConcentration() {
  const cardsEl = document.getElementById('tgt-concentration-cards');
  const top5El = document.getElementById('tgt-top5-list');
  if (!cardsEl || !top5El) return;
  // 소유주 배지 동기화 (currentOwner === '전체' → 가구 전체)
  const badgeEl = document.getElementById('tgt-conc-owner-badge');
  if (badgeEl) badgeEl.textContent = (currentOwner === '전체' || !currentOwner) ? '가구 전체' : currentOwner;
  const sectorListEl = document.getElementById('tgt-sector-list');
  const accountListEl = document.getElementById('tgt-account-list');
  // 주식+가상화폐 종목 단위 평가액 합산 — currentOwner 필터 적용
  const items = pfolioData
    .filter(a => (currentOwner === '전체' || a.owner === currentOwner)
                 && (a.grp === '주식' || a.grp === '가상화폐')
                 && (a.qty || 0) > 0)
    .map(a => ({
      name: a.name || a.tkr,
      tkr: a.tkr || '',
      owner: a.owner || '본인',
      grp: a.grp,
      acc: a.acc || '미지정',
      val: (a.qty || 0) * (a.curP || 0) * (RATES[a.cur] || 1)
    }))
    .filter(x => x.val > 0);

  const total = items.reduce((s, x) => s + x.val, 0);
  if (total <= 0 || !items.length) {
    cardsEl.innerHTML = '<div style="grid-column:1/-1;color:var(--t3);font-size:.85rem;padding:14px;text-align:center">데이터 없음</div>';
    top5El.innerHTML = '';
    if (sectorListEl) sectorListEl.innerHTML = '';
    if (accountListEl) accountListEl.innerHTML = '';
    return;
  }
  // 동일 종목이 여러 계좌에 나뉘어도 하나로 합산 (집중도 지표는 계좌 구분 불필요)
  // 키: 소유주 + 정규화 티커 — 전체 보기에서 소유주 배지 의미 보존(버블차트 _mergeMap과 동일 방식)
  const _concMap = new Map();
  items.forEach(x => {
    const baseTkr = (x.tkr || x.name || '').toUpperCase().replace(/\.(KS|KQ|T)$/, '');
    const key = `${x.owner}::${baseTkr}`;
    const cur = _concMap.get(key);
    if (cur) cur.val += x.val;
    else _concMap.set(key, { name: x.name, tkr: x.tkr, owner: x.owner, grp: x.grp, val: x.val });
  });
  const merged = Array.from(_concMap.values());

  merged.sort((a, b) => b.val - a.val);
  const top5 = merged.slice(0, 5);
  const top5Pct = (top5.reduce((s, x) => s + x.val, 0) / total) * 100;
  const maxPct = (merged[0].val / total) * 100;
  // HHI: sum of squared shares (×10000) — 0~10000, <1500 분산, 1500~2500 보통, >2500 집중
  const hhi = merged.reduce((s, x) => {
    const share = x.val / total;
    return s + share * share;
  }, 0) * 10000;

  // 섹터별 집계 (주식 → _gicsSector, 코인 → 'Crypto')
  const sectorTotals = {};
  items.forEach(x => {
    const sec = x.grp === '주식'
      ? _gicsSector({ name: x.name, tkr: x.tkr, grp: '주식' })
      : 'Crypto';
    sectorTotals[sec] = (sectorTotals[sec] || 0) + x.val;
  });
  const sectorEntries = Object.entries(sectorTotals).sort((a, b) => b[1] - a[1]);
  const sectorHHI = sectorEntries.reduce((s, [, v]) => {
    const sh = v / total;
    return s + sh * sh;
  }, 0) * 10000;

  // 꼬리 종목: 단일 비중 < 1% (계좌 합산 후 종목 단위)
  const tailCount = merged.filter(x => x.val / total < 0.01).length;

  // 계좌별 집계
  const accountTotals = Object.create(null);
  items.forEach(x => {
    accountTotals[x.acc] = (accountTotals[x.acc] || 0) + x.val;
  });
  const accountEntries = Object.entries(accountTotals).sort((a, b) => b[1] - a[1]);

  const card = (label, val, color, sub) => `
    <div style="background:var(--inner-bg);border-radius:10px;padding:10px 12px;border:1px solid var(--border-light)">
      <div style="font-size:.7rem;color:var(--t3);font-weight:600">${label}</div>
      <div style="font-size:1.15rem;font-weight:700;color:${color||'var(--t1)'};font-family:'IBM Plex Mono',monospace;line-height:1.3">${val}</div>
      ${sub ? `<div style="font-size:.65rem;color:var(--t3);margin-top:1px">${sub}</div>` : ''}
    </div>`;

  const hhiTier = hhi < 1500 ? { color: '#10B981', label: '분산' } : (hhi < 2500 ? { color: '#F59E0B', label: '보통' } : { color: '#EF4444', label: '집중' });
  const maxTier = maxPct > 25 ? { color: '#EF4444', label: '⚠ 과집중' } : (maxPct > 15 ? { color: '#F59E0B', label: '주의' } : { color: '#10B981', label: '양호' });
  const secTier = sectorHHI < 1500 ? { color: '#10B981', label: '분산' } : (sectorHHI < 2500 ? { color: '#F59E0B', label: '보통' } : { color: '#EF4444', label: '집중' });
  const tailPct = merged.length > 0 ? Math.round((tailCount / merged.length) * 100) : 0;

  cardsEl.innerHTML = [
    card('Top 5 비중', top5Pct.toFixed(1) + '%', top5Pct > 60 ? '#F59E0B' : 'var(--t1)', '주식+가상화폐 중'),
    card('단일 종목 최대', maxPct.toFixed(1) + '%', maxTier.color, maxTier.label),
    card('HHI 지수', Math.round(hhi).toLocaleString(), hhiTier.color, hhiTier.label),
    card('섹터 HHI', Math.round(sectorHHI).toLocaleString(), secTier.color, secTier.label),
    card('보유 종목수', merged.length, 'var(--t1)', '주식·코인 합산'),
    card('꼬리 종목 (<1%)', tailCount, tailCount > merged.length * 0.4 ? '#F59E0B' : 'var(--t1)', `전체 종목 중 ${tailPct}%`)
  ].join('');

  top5El.innerHTML = top5.map(x => {
    const pct = (x.val / total) * 100;
    const oc = ownerColors[x.owner] || '#888';
    const tag = `<span style="font-size:.62rem;background:${oc}22;color:${oc};padding:1px 5px;border-radius:5px;margin-right:6px;flex-shrink:0">${_cfEsc(x.owner)}</span>`;
    const barW = Math.min(100, pct * 2);  // 50%까지 풀
    return `<div class="tgt-top5-row">
      <div class="tgt-top5-name">${tag}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_cfEsc(x.name)}</span></div>
      <div class="tgt-top5-bar"><div style="width:${barW}%;background:${pct > 20 ? '#EF4444' : (pct > 10 ? '#F59E0B' : '#3B82F6')}"></div></div>
      <div class="tgt-top5-pct">${pct.toFixed(1)}%</div>
    </div>`;
  }).join('');

  // 주식 섹터별 비중 Top 5
  if (sectorListEl) {
    const topSectors = sectorEntries.slice(0, 5);
    sectorListEl.innerHTML = topSectors.map(([sec, v]) => {
      const pct = (v / total) * 100;
      const hue = (_SECTOR_HUES[sec] != null) ? _SECTOR_HUES[sec] : 60;
      const dotBg = `hsl(${hue},70%,55%)`;
      const tag = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotBg};margin-right:6px;flex-shrink:0"></span>`;
      const barW = Math.min(100, pct * 1.5);
      const barBg = pct > 40 ? '#EF4444' : (pct > 25 ? '#F59E0B' : '#3B82F6');
      return `<div class="tgt-top5-row">
        <div class="tgt-top5-name">${tag}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_cfEsc(sec)}</span></div>
        <div class="tgt-top5-bar"><div style="width:${barW}%;background:${barBg}"></div></div>
        <div class="tgt-top5-pct">${pct.toFixed(1)}%</div>
      </div>`;
    }).join('');
  }

  // 계좌별 비중 Top 5
  if (accountListEl) {
    const topAccs = accountEntries.slice(0, 5);
    accountListEl.innerHTML = topAccs.map(([acc, v]) => {
      const pct = (v / total) * 100;
      const barW = Math.min(100, pct * 1.5);
      const barBg = pct > 50 ? '#EF4444' : (pct > 30 ? '#F59E0B' : '#3B82F6');
      return `<div class="tgt-top5-row">
        <div class="tgt-top5-name"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_cfEsc(acc)}</span></div>
        <div class="tgt-top5-bar"><div style="width:${barW}%;background:${barBg}"></div></div>
        <div class="tgt-top5-pct">${pct.toFixed(1)}%</div>
      </div>`;
    }).join('');
  }
}

function renderTargetRebalView() {
  _tgtRenderConcentration();
  _advisorInit();
  _advisorSyncOwnerBadge();
}

// =============================================
// 포트폴리오 어드바이저 (한·미·일 종목 — 섹터 분산 + 피어 비교)
// =============================================
window._advisorPeerDB = window._advisorPeerDB || null;     // 캐시된 peers.json
window._advisorInited = window._advisorInited || false;
window._advisorLast = window._advisorLast || null;          // 마지막 선택 {ticker, name, market, sector}
window._advisorFundCache = window._advisorFundCache || {};  // 펀더멘털 응답 캐시 (세션 한정)
window._advisorSearchTimer = null;

function _advisorSyncOwnerBadge() {
  const badgeEl = document.getElementById('advisor-owner-badge');
  if (badgeEl) badgeEl.textContent = (currentOwner === '전체' || !currentOwner) ? '가구 전체' : currentOwner;
}

function _advisorEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function _advisorInferMarket(ticker, currency) {
  const t = String(ticker || '').toUpperCase();
  if (/\.T$/.test(t)) return 'JP';
  if (/\.(KS|KQ)$/.test(t) || /^[0-9A-Z]{6}$/.test(t)) return 'KR';
  if (currency === 'JPY') return 'JP';
  if (currency === 'USD') return 'US';
  if (currency === 'KRW') return 'KR';
  return 'US';
}

// 보유 자산에서 시장 추정 (cur 우선)
function _advisorInferMarketFromItem(item) {
  return _advisorInferMarket(item.tkr, item.cur);
}

async function _advisorLoadPeers() {
  if (window._advisorPeerDB) return window._advisorPeerDB;
  try {
    const res = await fetch('data/peers.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('peers.json HTTP ' + res.status);
    const json = await res.json();
    window._advisorPeerDB = json;
    // 섹터 키 정합성 한 번만 경고
    const knownSectors = new Set(['Technology','Financial Services','Health Care','Consumer Discretionary','Consumer Staples','Energy','Communications Services','Industrial Services','Materials & Processing','Real Estate','Utilities','Other','Index ETF','Sector ETF']);
    Object.keys(json || {}).forEach(mkt => {
      Object.keys(json[mkt] || {}).forEach(sec => {
        if (!knownSectors.has(sec)) console.warn('[advisor] unknown sector key in peers.json:', mkt, sec);
      });
    });
    return json;
  } catch (e) {
    console.warn('[advisor] peers.json load failed', e);
    window._advisorPeerDB = {};
    return {};
  }
}

function _advisorInit() {
  if (window._advisorInited) return;
  const input = document.getElementById('advisor-search-input');
  if (!input) return;
  window._advisorInited = true;
  _advisorLoadPeers();

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(window._advisorSearchTimer);
    if (!q) {
      _advisorRenderResults([]);
      const tgtEl = document.getElementById('advisor-target-card');
      const peerEl = document.getElementById('advisor-peers');
      const st = document.getElementById('advisor-status');
      if (tgtEl) tgtEl.innerHTML = '';
      if (peerEl) peerEl.innerHTML = '';
      if (st) st.textContent = '';
      window._advisorLast = null;
      return;
    }
    window._advisorSearchTimer = setTimeout(() => _advisorOnSearchInput(q), 250);
  });
  input.addEventListener('focus', () => {
    const q = input.value.trim();
    if (q && document.getElementById('advisor-search-results')?.children.length) {
      document.getElementById('advisor-search-results').style.display = 'block';
    }
  });
  document.addEventListener('click', (e) => {
    const wrap = document.querySelector('#advisor-section .advisor-search');
    if (wrap && !wrap.contains(e.target)) {
      const r = document.getElementById('advisor-search-results');
      if (r) r.style.display = 'none';
    }
  });

  const resultsEl = document.getElementById('advisor-search-results');
  if (resultsEl) {
    resultsEl.addEventListener('click', (e) => {
      const row = e.target.closest('[data-tkr]');
      if (!row) return;
      const ticker = row.dataset.tkr;
      const name = row.dataset.name || ticker;
      const market = row.dataset.market || _advisorInferMarket(ticker);
      resultsEl.style.display = 'none';
      input.value = name;
      _advisorOnSelect({ ticker, name, market });
    });
  }
}

async function _advisorOnSearchInput(q) {
  const statusEl = document.getElementById('advisor-status');
  if (statusEl) statusEl.textContent = '검색 중...';
  try {
    const res = await authFetch('/api/get-stock?query=' + encodeURIComponent(q));
    const data = await res.json();
    const items = [];
    if (data && data.success) {
      // 단일 또는 배열 응답 모두 대응
      if (Array.isArray(data.results)) items.push(...data.results);
      else if (data.symbol) items.push({ name: data.name, symbol: data.symbol, currency: data.currency, price: data.price });
    }
    if (statusEl) statusEl.textContent = '';
    _advisorRenderResults(items);
  } catch (e) {
    if (statusEl) statusEl.textContent = '검색 실패 — 다시 시도해 주세요';
    _advisorRenderResults([]);
  }
}

// 국기 인라인 SVG — 이모지 폰트 미지원 환경에서도 태극기(건곤감리)·일장기·성조기를 정확히 렌더
function _mktFlagSvg(market, px) {
  // 태극기는 작은 높이에서 네 괘가 뭉개지기 쉬워 최소 16px을 확보한다.
  const requestedH = px || 13, h = market === 'KR' ? Math.max(requestedH, 16) : requestedH;
  const w = Math.round(h * 1.5);
  const open = `<svg width="${w}" height="${h}" viewBox="0 0 36 24" style="display:inline-block;vertical-align:-2px;border:1px solid rgba(0,0,0,.15);border-radius:2px">`;
  if (market === 'JP') {
    return `${open}<rect width="36" height="24" fill="#fff"/><circle cx="18" cy="12" r="7" fill="#bc002d"/></svg>`;
  }
  if (market === 'US') {
    let s = '';
    for (let i = 0; i < 13; i++) s += `<rect x="0" y="${(i * 24 / 13).toFixed(2)}" width="36" height="${(24 / 13).toFixed(2)}" fill="${i % 2 === 0 ? '#b22234' : '#fff'}"/>`;
    s += `<rect x="0" y="0" width="15" height="${(7 * 24 / 13).toFixed(2)}" fill="#3c3b6e"/>`;
    // 별 대용 흰 점 격자 (작은 아이콘에서 성조기 식별용)
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) s += `<circle cx="${(1.6 + c * 2.9).toFixed(2)}" cy="${(1.8 + r * 3).toFixed(2)}" r="0.6" fill="#fff"/>`;
    return `${open}${s}</svg>`;
  }
  // KR — 태극기: 흰 바탕 + 태극(적/청) + 건곤감리 4괘
  const cx = 18, cy = 12, R = 6.4, r = R / 2;
  const taeguk = `<g transform="rotate(-33.69 ${cx} ${cy})"><circle cx="${cx}" cy="${cy}" r="${R}" fill="#0047a0"/>`
    + `<path d="M ${cx - R} ${cy} a ${R} ${R} 0 0 1 ${2 * R} 0 a ${r} ${r} 0 0 1 ${-R} 0 a ${r} ${r} 0 0 0 ${-R} 0 z" fill="#cd2e3a"/></g>`;
  // 3바 괘: pat=[상,중,하] (true=이어진 막대, false=끊긴 막대), (cx,cy) 중심
  const tw = 8.4, th = 1.7, gap = 1.15, brk = 1.8;
  const tri = (tcx, tcy, pat) => pat.map((solid, i) => {
    const y = (tcy + (i - 1) * (th + gap) - th / 2).toFixed(2);
    if (solid) return `<rect x="${(tcx - tw / 2).toFixed(2)}" y="${y}" width="${tw}" height="${th}" fill="#111"/>`;
    const seg = ((tw - brk) / 2).toFixed(2);
    return `<rect x="${(tcx - tw / 2).toFixed(2)}" y="${y}" width="${seg}" height="${th}" fill="#111"/><rect x="${(tcx + brk / 2).toFixed(2)}" y="${y}" width="${seg}" height="${th}" fill="#111"/>`;
  }).join('');
  // 법정 도안처럼 네 괘를 태극을 향한 대각선 축으로 배치해 작은 아이콘에서도 눌려 보이지 않게 한다.
  const gwae = `<g transform="rotate(-33.69 7.5 5.2)">${tri(7.5, 5.2, [true, true, true])}</g>`       // 건 ☰ 좌상
    + `<g transform="rotate(33.69 28.5 5.2)">${tri(28.5, 5.2, [false, true, false])}</g>`              // 감 ☵ 우상
    + `<g transform="rotate(33.69 7.5 18.8)">${tri(7.5, 18.8, [true, false, true])}</g>`               // 리 ☲ 좌하
    + `<g transform="rotate(-33.69 28.5 18.8)">${tri(28.5, 18.8, [false, false, false])}</g>`;          // 곤 ☷ 우하
  return `${open}<rect width="36" height="24" fill="#fff"/>${taeguk}${gwae}</svg>`;
}
function _advisorRenderResults(items) {
  const el = document.getElementById('advisor-search-results');
  if (!el) return;
  if (!items.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.innerHTML = items.slice(0, 8).map(it => {
    const ticker = it.symbol || it.tkr || '';
    const name = it.name || ticker;
    const market = _advisorInferMarket(ticker, it.currency);
    const mLabel = _mktFlagSvg(market, 13) + ' ' + (market === 'KR' ? 'KR' : market === 'JP' ? 'JP' : 'US');
    return `<div class="advisor-result-row" data-tkr="${_advisorEscape(ticker)}" data-name="${_advisorEscape(name)}" data-market="${market}">
      <span class="advisor-result-name">${_advisorEscape(name)}</span>
      <span class="advisor-result-tkr">${_advisorEscape(ticker)}</span>
      <span class="advisor-result-mkt">${mLabel}</span>
    </div>`;
  }).join('');
  el.style.display = 'block';
}

// 섹터 비중 계산 (currentOwner 기준, 주식만)
function _advisorOwnerSectorWeights() {
  const items = pfolioData.filter(a =>
    (currentOwner === '전체' || a.owner === currentOwner)
    && a.grp === '주식'
    && (a.qty || 0) > 0
  );
  const totals = {};
  let total = 0;
  items.forEach(a => {
    const v = (a.qty || 0) * (a.curP || 0) * (RATES[a.cur] || 1);
    if (v <= 0) return;
    const sec = _gicsSector(a);
    totals[sec] = (totals[sec] || 0) + v;
    total += v;
  });
  return { totals, total };
}

async function _advisorFetchFundamentals(tickers) {
  const result = {};
  const need = [];
  tickers.forEach(t => {
    if (window._advisorFundCache[t]) result[t] = window._advisorFundCache[t];
    else need.push(t);
  });
  // 8개씩 청크, 직렬 호출 (yfinance rate-limit 보호)
  for (let i = 0; i < need.length; i += 8) {
    const chunk = need.slice(i, i + 8);
    try {
      const res = await authFetch('/api/dashboard?type=fundamentals&tickers=' + encodeURIComponent(chunk.join(',')));
      const data = await res.json();
      if (data && data.success && data.data) {
        Object.keys(data.data).forEach(k => {
          window._advisorFundCache[k] = data.data[k];
          result[k] = data.data[k];
        });
      }
    } catch (e) {
      // 청크 실패는 무시 — 미조회로 표시됨
    }
  }
  return result;
}

// peer 가 target 대비 매력적인지 + 매력도 점수 (낮을수록 좋음)
function _advisorPeerScore(target, peer) {
  if (!peer) return null;
  const tPE = Number(target.trailingPE), pPE = Number(peer.trailingPE);
  const tPB = Number(target.priceToBook), pPB = Number(peer.priceToBook);
  const tROE = Number(target.returnOnEquity) || 0, pROE = Number(peer.returnOnEquity) || 0;
  const tEG = Number(target.earningsGrowth) || 0, pEG = Number(peer.earningsGrowth) || 0;
  const upside = (info) => {
    const t = Number(info.targetMeanPrice), c = Number(info.currentPrice);
    if (!isFinite(t) || !isFinite(c) || c <= 0) return 0;
    return t / c - 1;
  };
  const tUp = upside(target), pUp = upside(peer);

  // 매력 조건: PER & PBR 모두 낮고, ROE/성장/상승여력 중 하나는 더 좋아야 함
  const peLower = isFinite(pPE) && pPE > 0 && (!isFinite(tPE) || tPE <= 0 || pPE < tPE);
  const pbLower = isFinite(pPB) && pPB > 0 && (!isFinite(tPB) || tPB <= 0 || pPB < tPB);
  const someBetter = (pROE > tROE) || (pEG > tEG) || (pUp > tUp);
  if (!(peLower && pbLower && someBetter)) return null;

  // 단순 점수: 낮을수록 좋음
  const score = (isFinite(pPE) ? pPE : 50) * 0.4
              + (isFinite(pPB) ? pPB : 5) * 5
              - pROE * 30
              - pEG * 20
              - pUp * 25;
  return score;
}

function _advisorFmtPct(v, dp = 1) {
  if (v == null || !isFinite(Number(v))) return '미조회';
  return (Number(v) * 100).toFixed(dp) + '%';
}
function _advisorFmtNum(v, dp = 2) {
  if (v == null || !isFinite(Number(v))) return '미조회';
  return Number(v).toFixed(dp);
}
function _advisorUpside(info) {
  if (!info) return null;
  const t = Number(info.targetMeanPrice), c = Number(info.currentPrice);
  if (!isFinite(t) || !isFinite(c) || c <= 0) return null;
  return t / c - 1;
}

function _advisorMetricsTableRows(info) {
  if (!info) info = {};
  const rows = [
    ['PER', _advisorFmtNum(info.trailingPE)],
    ['PBR', _advisorFmtNum(info.priceToBook)],
    ['배당수익률', _advisorFmtPct(info.dividendYield)],
    ['ROE', _advisorFmtPct(info.returnOnEquity)],
    ['매출 성장률', _advisorFmtPct(info.revenueGrowth)],
    ['이익 성장률', _advisorFmtPct(info.earningsGrowth)],
    ['1Y 수익률', _advisorFmtPct(info.return1y)],
    ['3Y 수익률', _advisorFmtPct(info.return3y)],
    ['목표가 상승여력', _advisorFmtPct(_advisorUpside(info))],
  ];
  return rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');
}

function _advisorDiversificationOneLiner(sector, ownerSectorPct) {
  const s = ownerSectorPct;
  let tail;
  if (s >= 30) tail = '추가 매수 시 집중도 ↑ (다른 섹터 보강 권장)';
  else if (s < 5) tail = '신규 섹터 노출 ↑ (분산 효과)';
  else tail = '비중 균형 유지';
  return `이미 ${sector} 비중 ${s.toFixed(1)}% — ${tail}`;
}

function _advisorDiversificationScore(ownerSectorPct) {
  return Math.max(0, Math.min(100, 100 - 2 * Math.max(0, ownerSectorPct - 20)));
}

async function _advisorOnSelect(sel) {
  // sel: { ticker, name, market }
  window._advisorLast = sel;
  const market = sel.market || _advisorInferMarket(sel.ticker);
  if (market !== 'KR' && market !== 'US' && market !== 'JP') {
    document.getElementById('advisor-target-card').innerHTML = `<div style="color:var(--t3);font-size:.85rem;padding:14px">한·미·일 시장 외 종목은 분석 대상이 아닙니다.</div>`;
    document.getElementById('advisor-peers').innerHTML = '';
    return;
  }

  // 1) 섹터 결정 (보유 자산 동일 티커가 있으면 그 항목으로, 아니면 검색 결과만으로)
  const own = pfolioData.find(a => (a.tkr || '').toUpperCase() === sel.ticker.toUpperCase());
  const sectorItem = own || { name: sel.name, tkr: sel.ticker };
  const sector = _gicsSector(sectorItem);

  // 2) 소유주 섹터 비중
  const { totals: secTotals, total: secTotal } = _advisorOwnerSectorWeights();
  const sectorVal = secTotals[sector] || 0;
  const sectorPct = secTotal > 0 ? (sectorVal / secTotal) * 100 : 0;
  const oneLiner = _advisorDiversificationOneLiner(sector, sectorPct);
  const score = _advisorDiversificationScore(sectorPct);

  // 3) 피어 후보 결정
  const peers = await _advisorLoadPeers();
  const peerList = ((peers || {})[market] || {})[sector] || [];

  // 4) 펀더멘털 배치 호출 — 검색 티커 + 피어 (피어가 너무 많으면 상위 10개로 제한)
  const statusEl = document.getElementById('advisor-status');
  if (statusEl) statusEl.textContent = '펀더멘털 조회 중... (yfinance — 수초 소요)';
  const peerTickers = peerList.slice(0, 10).map(p => p.ticker).filter(t => t && t.toUpperCase() !== sel.ticker.toUpperCase());
  const allTickers = [sel.ticker, ...peerTickers];
  const fundMap = await _advisorFetchFundamentals(allTickers);
  if (statusEl) statusEl.textContent = '';

  const targetInfo = fundMap[sel.ticker] || {};

  _advisorRenderTargetCard(sel, sector, sectorPct, oneLiner, score, targetInfo);

  // 5) 피어 랭킹 — 매력 조건 통과한 것만, 점수 낮은 순, 상위 3
  const ranked = peerTickers.map(t => {
    const info = fundMap[t];
    if (!info) return null;
    const sc = _advisorPeerScore(targetInfo, info);
    if (sc == null) return null;
    const meta = peerList.find(p => p.ticker === t) || { ticker: t, name: t };
    return { ticker: t, name: meta.name, info, score: sc };
  }).filter(Boolean).sort((a, b) => a.score - b.score).slice(0, 3);

  _advisorRenderPeers(sector, market, targetInfo, ranked, peerList.length);
}

function _advisorRenderTargetCard(sel, sector, sectorPct, oneLiner, score, info) {
  const el = document.getElementById('advisor-target-card');
  if (!el) return;
  const scoreColor = score >= 70 ? '#10B981' : (score >= 40 ? '#F59E0B' : '#EF4444');
  const sectorTag = `<span class="advisor-sector-tag">${_advisorEscape(sector)}</span>`;
  const ownerLabel = (currentOwner === '전체' || !currentOwner) ? '가구 전체' : currentOwner;
  el.innerHTML = `
    <div class="advisor-target-card">
      <div class="advisor-target-head">
        <div>
          <div class="advisor-target-name">${_advisorEscape(sel.name)} <span class="advisor-target-tkr">${_advisorEscape(sel.ticker)}</span></div>
          <div class="advisor-target-meta">${sectorTag}<span class="advisor-owner-meta">${_advisorEscape(ownerLabel)} 기준</span></div>
        </div>
        <div class="advisor-score-wrap" title="섹터 비중 20% 까지는 100점, 이후 1%마다 2점 감점">
          <div class="advisor-score-label">분산 점수</div>
          <div class="advisor-score-value" style="color:${scoreColor}">${score.toFixed(0)}</div>
        </div>
      </div>
      <div class="advisor-oneliner">${_advisorEscape(oneLiner)}</div>
      <div class="advisor-score-bar"><div style="width:${score}%;background:${scoreColor}"></div></div>
      <table class="advisor-metrics-table">
        <tbody>${_advisorMetricsTableRows(info)}</tbody>
      </table>
    </div>`;
}

function _advisorRenderPeers(sector, market, targetInfo, ranked, peerCount) {
  const el = document.getElementById('advisor-peers');
  if (!el) return;
  if (!peerCount) {
    el.innerHTML = `<div class="advisor-empty">${_advisorEscape(sector)} (${market}) 섹터의 피어 데이터가 없습니다.</div>`;
    return;
  }
  if (!ranked.length) {
    el.innerHTML = `<div class="advisor-empty">같은 섹터(${_advisorEscape(sector)}, ${market}) 내에서 검색 종목보다 상대적으로 저평가된 피어를 찾지 못했습니다.</div>`;
    return;
  }
  const cmp = (label, p, t, fmt, betterIfHigher) => {
    if (p == null || t == null || !isFinite(Number(p)) || !isFinite(Number(t))) return `<tr><th>${label}</th><td>${fmt(p)}</td><td class="advisor-diff">-</td></tr>`;
    const diff = Number(p) - Number(t);
    const better = betterIfHigher ? diff > 0 : diff < 0;
    const arrow = better ? '↑' : (diff === 0 ? '·' : '↓');
    const color = better ? '#10B981' : (diff === 0 ? 'var(--t3)' : '#EF4444');
    return `<tr><th>${label}</th><td>${fmt(p)}</td><td class="advisor-diff" style="color:${color}">${arrow}</td></tr>`;
  };
  const cards = ranked.map((r, i) => {
    const info = r.info;
    const tUp = _advisorUpside(targetInfo), pUp = _advisorUpside(info);
    const rows = [
      cmp('PER',          info.trailingPE,      targetInfo.trailingPE,      v => _advisorFmtNum(v), false),
      cmp('PBR',          info.priceToBook,     targetInfo.priceToBook,     v => _advisorFmtNum(v), false),
      cmp('배당수익률',    info.dividendYield,   targetInfo.dividendYield,   v => _advisorFmtPct(v), true),
      cmp('ROE',          info.returnOnEquity,  targetInfo.returnOnEquity,  v => _advisorFmtPct(v), true),
      cmp('이익 성장률',   info.earningsGrowth,  targetInfo.earningsGrowth,  v => _advisorFmtPct(v), true),
      cmp('1Y 수익률',     info.return1y,        targetInfo.return1y,        v => _advisorFmtPct(v), true),
      cmp('3Y 수익률',     info.return3y,        targetInfo.return3y,        v => _advisorFmtPct(v), true),
      cmp('목표가 상승여력', pUp,                 tUp,                        v => _advisorFmtPct(v), true),
    ].join('');
    return `<div class="advisor-peer-card">
      <div class="advisor-peer-head">
        <div class="advisor-peer-rank">#${i+1}</div>
        <div>
          <div class="advisor-peer-name">${_advisorEscape(r.name)}</div>
          <div class="advisor-peer-tkr">${_advisorEscape(r.ticker)}</div>
        </div>
      </div>
      <table class="advisor-peer-table">
        <thead><tr><th></th><th>피어</th><th>vs 검색</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join('');
  el.innerHTML = `
    <div class="advisor-peers-head">${_advisorEscape(sector)} 섹터 · 상대적 저평가 피어 Top ${ranked.length}</div>
    <div class="advisor-peers-grid">${cards}</div>`;
}

function _advisorRefreshForOwner() {
  _advisorSyncOwnerBadge();
  // 선택된 종목이 있으면 섹터 비중 / 분산 평가만 다시 계산 (피어는 동일)
  if (window._advisorLast && document.getElementById('view-target_rebal')?.classList.contains('active')) {
    _advisorOnSelect(window._advisorLast);
  }
}

// ── 월별 수익/손실 기록 위젯 ──────────────────────────────
let monthlyPLData = [];
function saveMonthlyPL(){try{localStorage.setItem('monthlyPLData',JSON.stringify(monthlyPLData));}catch(e){}saveExtDataToKV();}
function loadMonthlyPL(){try{const d=localStorage.getItem('monthlyPLData');if(d)monthlyPLData=_normalizeMonthlyPLRows(JSON.parse(d));}catch(e){}}

function _plSelYear(){return document.getElementById('pl-year-select')?.value||String(new Date().getFullYear());}
function _plFilteredData(){
  loadMonthlyPL();
  const selYear=_plSelYear(), selOwner=_analysisOwner||'전체';
  return monthlyPLData.filter(r=>{
    const matchYear=r.month&&r.month.startsWith(selYear);
    const matchOwner=selOwner==='전체'||!r.owner||r.owner===selOwner;
    return matchYear&&matchOwner;
  });
}

function renderMonthlyPL(){
  const tbody=document.getElementById('pl-table-body');if(!tbody)return;
  const selYear=_plSelYear();
  const selOwner=_analysisOwner||'전체';

  // 레이블 업데이트
  const ytdLabel=document.getElementById('pl-ytd-label');
  if(ytdLabel)ytdLabel.textContent=selYear+' 누적 차익';
  const ownerLabel=document.getElementById('pl-owner-label');
  if(ownerLabel)ownerLabel.textContent=selOwner==='전체'?'전체':'소유주: '+selOwner;
  const chartYrLabel=document.getElementById('pl-chart-year-label');
  if(chartYrLabel)chartYrLabel.textContent=selYear+'년';

  const filtered=_plFilteredData();
  const ytd=filtered.reduce((s,r)=>s+r.amt,0);
  const ytdEl=document.getElementById('pl-ytd-total');
  if(ytdEl){ytdEl.textContent=(ytd>=0?'₩':'-₩')+Math.abs(Math.round(ytd)).toLocaleString();ytdEl.style.color=ytd>=0?'var(--up)':'var(--dn)';}

  // 해외/국내 누적차익 (좌측 카드 + 양도소득세 계산 공용)
  const foreignGain=filtered.filter(r=>r.category!=='domestic').reduce((s,r)=>s+r.amt,0);
  const domesticGain=filtered.filter(r=>r.category==='domestic').reduce((s,r)=>s+r.amt,0);
  const fEl=document.getElementById('pl-ytd-foreign');
  if(fEl)fEl.textContent=(foreignGain>=0?'₩':'-₩')+Math.abs(Math.round(foreignGain)).toLocaleString();
  const dEl=document.getElementById('pl-ytd-domestic');
  if(dEl)dEl.textContent=(domesticGain>=0?'₩':'-₩')+Math.abs(Math.round(domesticGain)).toLocaleString();

  // 양도소득세 자동 계산 (해외)
  const taxEl=document.getElementById('pl-tax-content');
  if(taxEl){
    if(!filtered.length){taxEl.innerHTML='<span style="color:var(--t3)">매도 기록이 없습니다.</span>';}
    else{
      // 해외 기본공제는 가구가 아니라 납세자(소유주)별로 적용한다.
      const DEDUCTION=_taxRuleValue('capitalGains.foreignStockBasicDeductionKrw',2_500_000,selYear);
      const TAX_RATE=_taxRuleValue('capitalGains.foreignStockCombinedRate',0.22,selYear);
      const foreignByOwner=new Map();
      filtered.filter(r=>r.category!=='domestic').forEach(r=>{
        const key=OWNERS.includes(r.owner)?r.owner:'소유주 미지정';
        foreignByOwner.set(key,(foreignByOwner.get(key)||0)+(Number(r.amt)||0));
      });
      const foreignTaxable=Array.from(foreignByOwner.values()).reduce((sum,gain)=>sum+Math.max(0,gain-DEDUCTION),0);
      const foreignTax=Math.round(foreignTaxable*TAX_RATE);
      // 국내: 대주주 외 비과세 (2026년 기준)
      const domesticTax=0;
      const totalTax=foreignTax+domesticTax;
      const netAfterTax=ytd-totalTax;

      if(ytd<=0 && foreignGain<=0 && domesticGain<=0){
        taxEl.innerHTML=`<span style="color:var(--t3)">${selYear}년 누적 차익이 없거나 손실입니다.</span>`;
      } else {
        // 해외 세액·공제후 과세표준·총 세후 실수익을 한 줄에 조밀 정렬
        let html='<div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:6px 16px">';
        if(foreignGain!==0){
          html+=`<div><div style="color:var(--t3);font-size:.62rem">해외 세액(${(TAX_RATE*100).toFixed(0)}%)</div><div style="font-weight:700;font-size:.8rem;color:${foreignTax>0?'var(--dn)':'var(--up)'}">₩${foreignTax.toLocaleString()}</div></div>`;
          html+=`<div><div style="color:var(--t3);font-size:.62rem">공제 후 과세표준</div><div style="font-size:.76rem">₩${foreignTaxable.toLocaleString()}</div></div>`;
        }
        html+=`<div><div style="color:var(--t3);font-size:.62rem">총 세후 실수익</div><div style="font-weight:700;font-size:.82rem;color:var(--up)">₩${Math.round(netAfterTax).toLocaleString()}</div></div>`;
        html+='</div>';
        taxEl.innerHTML=html;
      }
    }
  }

  if(!filtered.length){tbody.innerHTML='<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--t3)">기록된 내역이 없습니다.</td></tr>';updatePLBarChart();return;}
  tbody.innerHTML=[...filtered].sort((a,b)=>b.month.localeCompare(a.month)).map((r)=>{
    const isPos=r.amt>=0;
    const ownerBadge=r.owner&&r.owner!=='전체'?`<span style="font-size:.6rem;color:var(--t3);margin-left:4px">(${_cfEsc(r.owner)})</span>`:'';
    const catLabel=r.category==='domestic'?'국내':'해외';
    const catColor=r.category==='domestic'?'#4ecdc4':'#5b9bff';
    return `<tr>
      <td class="text-left">${_cfEsc(r.month)}${ownerBadge}</td>
      <td class="text-left"><span style="font-size:.65rem;padding:2px 6px;border-radius:4px;background:${catColor}22;color:${catColor};font-weight:600">${catLabel}</span></td>
      <td class="text-right ${isPos?'c-up':'c-dn'}">${isPos?'+':'−'}₩${Math.abs(r.amt).toLocaleString()}</td>
      <td class="text-right" style="color:var(--t3)">${_cfEsc(r.memo||'-')}</td>
      <td class="text-right" style="white-space:nowrap"><button class="btn-action" type="button" aria-label="실현손익 수정" onclick="editMonthlyPL(${Number(r.id)||0})">✎</button><button class="btn-action" type="button" aria-label="실현손익 삭제" onclick="deleteMonthlyPL(${Number(r.id)||0})">✕</button></td>
    </tr>`;
  }).join('');
  const mi=document.getElementById('pl-month-input');if(mi&&!mi.value){const n=new Date();mi.value=`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`;}
  updatePLBarChart();
}

function addMonthlyPL(){
  if (isMobileLayout()) return; // 모바일은 조회 전용

  const month=document.getElementById('pl-month-input')?.value;
  const amtRaw=(document.getElementById('pl-amount-input')?.value||'').replace(/,/g,'');
  const amt=parseFloat(amtRaw)||0;
  const memo=(document.getElementById('pl-memo-input')?.value||'').trim();
  const owner=_analysisOwner||'전체';
  const category=document.getElementById('pl-category-input')?.value||'foreign';
  if(!month||amtRaw===''){alert('년/월과 금액을 입력하세요.');return;}
  loadMonthlyPL();
  const ruleSetId=typeof assetTaxRulesFor==='function'?(assetTaxRulesFor(month)?.id||''):'';
  if(window._plEditId){
    const idx=monthlyPLData.findIndex(x=>x.id===window._plEditId);
    if(idx>=0){monthlyPLData[idx].month=month;monthlyPLData[idx].amt=amt;monthlyPLData[idx].memo=memo;monthlyPLData[idx].owner=owner;monthlyPLData[idx].category=category;monthlyPLData[idx].ruleSetId=ruleSetId;}
    else{monthlyPLData.push({id:Date.now(),month,amt,memo,owner,category,ruleSetId});}
    window._plEditId=null;
    const btn=document.querySelector('[onclick="addMonthlyPL()"]');if(btn)btn.textContent='저장';
  } else {
    monthlyPLData.push({id:Date.now(),month,amt,memo,owner,category,ruleSetId});
  }
  saveMonthlyPL();
  ['pl-amount-input','pl-memo-input'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  renderMonthlyPL();
}
function deleteMonthlyPL(id){
  if (isMobileLayout()) return; // 모바일은 조회 전용

  if(!confirm('삭제하시겠습니까?'))return;
  loadMonthlyPL();monthlyPLData=monthlyPLData.filter(r=>r.id!==id);saveMonthlyPL();renderMonthlyPL();
}
function editMonthlyPL(id){
  if (isMobileLayout()) return; // 모바일은 조회 전용

  loadMonthlyPL();
  const r=monthlyPLData.find(x=>x.id===id);if(!r)return;
  const mi=document.getElementById('pl-month-input');
  const ai=document.getElementById('pl-amount-input');
  const memo=document.getElementById('pl-memo-input');
  const ci=document.getElementById('pl-category-input');
  if(mi)mi.value=r.month;
  if(ai)ai.value=r.amt;
  if(memo)memo.value=r.memo||'';
  if(ci)ci.value=r.category||'foreign';
  window._plEditId=id;
  const btn=document.querySelector('[onclick="addMonthlyPL()"]');
  if(btn){btn.textContent='수정 저장';btn.focus();}
}
function updatePLBarChart(){
  if(!window.plBarChartInst)return;
  const filtered=_plFilteredData().sort((a,b)=>a.month.localeCompare(b.month));
  // 월별 국내/해외 분리 집계
  const monthMap={};
  filtered.forEach(r=>{
    const m=parseInt(r.month.substring(5))+'월';
    if(!monthMap[m])monthMap[m]={foreign:0,domestic:0};
    if(r.category==='domestic') monthMap[m].domestic+=r.amt;
    else monthMap[m].foreign+=r.amt;
  });
  const labels=Object.keys(monthMap);
  const foreignData=labels.map(m=>monthMap[m].foreign);
  const domesticData=labels.map(m=>monthMap[m].domestic);
  // 2개 데이터셋: 해외(블루), 국내(틸)
  window.plBarChartInst.data.labels=labels;
  window.plBarChartInst.data.datasets=[
    {label:'해외',data:foreignData,backgroundColor:'rgba(91,155,255,.75)',borderRadius:4,stack:'s'},
    {label:'국내',data:domesticData,backgroundColor:'rgba(78,205,196,.75)',borderRadius:4,stack:'s'}
  ];
  window.plBarChartInst.update();
}
function syncPLToTax(){
  loadMonthlyPL();
  const curYear=new Date().getFullYear();
  const ytd=monthlyPLData.filter(r=>r.month&&r.month.startsWith(String(curYear))).reduce((s,r)=>s+r.amt,0);
  const inp=document.getElementById('tax-gain-input');if(!inp)return;
  inp.value=Math.round(ytd).toLocaleString();
  calcCapGainTax();
  alert(`올해(${curYear}) 누적 차익 ₩${Math.round(ytd).toLocaleString()}이 양도소득세 시뮬레이터에 입력되었습니다.`);
}

// ── 해외주식 양도소득세 (적용 연도 규칙 매니페스트 사용) ──────────────
function calcCapGainTax() {
  const gainRaw = parseFloat((document.getElementById('tax-gain-input')?.value||'').replace(/,/g,''))||0;
  const lossRaw = parseFloat((document.getElementById('tax-loss-input')?.value||'').replace(/,/g,''))||0;
  const el = document.getElementById('tax-result'); if(!el) return;
  if(gainRaw<=0){ el.innerHTML='<div style="color:var(--t3);text-align:center">매도차익을 입력하면 세금이 계산됩니다.</div>'; return; }

  const DEDUCTION=_taxRuleValue('capitalGains.foreignStockBasicDeductionKrw',2_500_000);
  const TAX_RATE=_taxRuleValue('capitalGains.foreignStockCombinedRate',0.22);
  const netGain = Math.max(0, gainRaw - lossRaw - DEDUCTION);
  const tax = Math.round(netGain * TAX_RATE);
  const netAfterTax = gainRaw - lossRaw - tax;
  const effectiveRate = gainRaw > 0 ? ((tax / gainRaw) * 100).toFixed(2) : 0;
  const taxColor = tax > 0 ? 'var(--dn)' : 'var(--up)';
  el.innerHTML = `
    <div class="f-between"><span style="color:var(--t3)">매도차익</span><span style="font-weight:700">₩${gainRaw.toLocaleString()}</span></div>
    <div class="f-between"><span style="color:var(--t3)">같은 연도 주식 손실 상계</span><span style="color:var(--up)">-₩${lossRaw.toLocaleString()}</span></div>
    <div class="f-between"><span style="color:var(--t3)">기본공제</span><span style="color:var(--up)">-₩${DEDUCTION.toLocaleString()}</span></div>
    <div style="height:1px;background:var(--border-dark);margin:4px 0"></div>
    <div class="f-between"><span style="color:var(--t3)">과세표준</span><span style="font-weight:600">₩${netGain.toLocaleString()}</span></div>
    <div class="f-between"><span style="color:var(--t3)">세율</span><span>${(TAX_RATE*100).toFixed(0)}% (지방세 포함)</span></div>
    <div style="height:1px;background:var(--border-dark);margin:4px 0"></div>
    <div class="f-between" style="font-size:.9rem"><span style="font-weight:700">납부세액</span><span style="font-weight:800;color:${taxColor}">₩${tax.toLocaleString()}</span></div>
    <div class="f-between"><span style="color:var(--t3)">실효세율</span><span style="font-weight:600">${effectiveRate}%</span></div>
    <div class="f-between"><span style="color:var(--t3)">세후 실수익</span><span style="font-weight:700;color:var(--up)">₩${Math.round(netAfterTax).toLocaleString()}</span></div>
    ${tax===0?'<div style="margin-top:6px;padding:6px 8px;background:rgba(16,185,129,.12);border-radius:6px;font-size:.72rem;color:var(--up)">✓ 기본공제 범위 이내 — 양도소득세 없음</div>':''}
  `;
}

// ── 금융소득종합과세 시뮬레이터 ──────────────────────────
function calcFinIncomeTax() {
  const interest = parseFloat((document.getElementById('fin-interest-input')?.value||'').replace(/,/g,''))||0;
  const divInc   = parseFloat((document.getElementById('fin-div-input')?.value||'').replace(/,/g,''))||0;
  const baseRate = parseFloat(document.getElementById('fin-rate-input')?.value||'38.5')||38.5;
  const el = document.getElementById('fin-tax-result'); if(!el) return;
  if(interest+divInc<=0){ el.innerHTML='<div style="color:var(--t3);text-align:center">소득을 입력하면 과세 여부를 알려드립니다.</div>'; return; }

  const THRESHOLD=_taxRuleValue('dividend.comprehensiveIncomeThresholdKrw',20_000_000);
  const WITHHOLDING_RATE=_taxRuleValue('dividend.generalWithholdingCombinedRate',0.154);
  const total = interest + divInc;
  const taxWithheld = Math.round(total * WITHHOLDING_RATE);
  const isOver = total > THRESHOLD;
  const overAmt = Math.max(0, total - THRESHOLD);
  const additionalTax = isOver ? Math.round(overAmt * (baseRate / 100) - overAmt * WITHHOLDING_RATE) : 0;
  const color = isOver ? 'var(--dn)' : 'var(--up)';
  el.innerHTML = `
    <div class="f-between"><span style="color:var(--t3)">이자소득</span><span style="font-weight:600">₩${interest.toLocaleString()}</span></div>
    <div class="f-between"><span style="color:var(--t3)">배당소득</span><span style="font-weight:600">₩${divInc.toLocaleString()}</span></div>
    <div class="f-between"><span style="color:var(--t3)">합계</span><span style="font-weight:700">₩${total.toLocaleString()}</span></div>
    <div style="height:1px;background:var(--border-dark);margin:4px 0"></div>
    <div class="f-between"><span style="color:var(--t3)">원천징수 (${(WITHHOLDING_RATE*100).toFixed(1)}%)</span><span style="color:var(--dn)">₩${taxWithheld.toLocaleString()}</span></div>
    <div style="height:1px;background:var(--border-dark);margin:4px 0"></div>
    <div style="padding:8px 10px;border-radius:8px;background:${isOver?'rgba(239,68,68,.1)':'rgba(16,185,129,.1)'};border:1px solid ${isOver?'rgba(239,68,68,.3)':'rgba(16,185,129,.3)'}">
      <div style="font-weight:700;color:${color};margin-bottom:4px">${isOver?'⚠️ 종합과세 대상':'✅ 분리과세 (2,000만원 이하)'}</div>
      ${isOver?`<div style="font-size:.72rem;color:var(--t2)">초과금액 ₩${overAmt.toLocaleString()}에 대해 ${baseRate}% 종합과세 적용 시 예상 추가세액: <strong style="color:var(--dn)">₩${Math.max(0,additionalTax).toLocaleString()}</strong></div>`
      :`<div style="font-size:.72rem;color:var(--t3)">기준 ₩${THRESHOLD.toLocaleString()} 이내 — 원천징수로 분리과세 종결</div>`}
    </div>
    ${isOver?`<div style="margin-top:6px;font-size:.68rem;color:var(--dn)">💡 절세 팁: ISA 계좌 활용, 가족 분산 증여, 연금저축 배당 우선 활용 권고</div>`:''}
  `;
}

// ── 배당 커버리지 달성률 (월 배당 목표 금액 기반) ─────────────
function renderDivCoverage() {
  const targetRaw = parseFloat((document.getElementById('div-coverage-target')?.value||'').replace(/,/g,''))||0;
  const el = document.getElementById('div-coverage-result'); if(!el) return;

  // 현재 연간 예상 배당금 (divHistory 전체 월합 → 연환산)
  const now = new Date();
  const yr = String(now.getFullYear()); const mo = now.getMonth();
  const annualDiv = Object.values((divHistory[yr]||{})).reduce((s,arr)=>{
    if(Array.isArray(arr)) arr.forEach((v,i)=>{ if(i!==mo) s+=v||0; }); return s;
  }, 0) + ((divHistory[yr]||{})['전체']?.[mo]||0);
  const monthlyDiv = Math.round(annualDiv / 12);

  // 포트폴리오 배당주 원금(현재가치 기준) & 가중 평균 배당률 계산
  // ★ DIV_INFO_DB + window._divDataCache(API 동적 캐시) 병합 — 등록 자산 배당이 정확히 반영되도록
  const usdRate = RATES.USD || 1380;
  let divAssetValKRW = 0;
  let annualDivExpected = 0;
  pfolioData.forEach(i=>{
    if(i.grp!=='주식' || !i.qty || !i.curP) return;
    const tkr6 = normDivTkr(i.tkr);
    const cached = (window._divDataCache && (window._divDataCache[tkr6] || window._divDataCache[i.tkr])) || null;
    const info = cached || (typeof DIV_INFO_DB !== 'undefined' && (DIV_INFO_DB[tkr6] || DIV_INFO_DB[i.tkr])) || null;
    if(!info || !info.eps) return;
    const rate = i.cur==='USD'?usdRate:1;
    const mv = i.qty * i.curP * rate;
    const payout = i.qty * info.eps * (info.cur==='USD'?usdRate:rate);
    if(mv>0 && payout>0){
      divAssetValKRW += mv;
      annualDivExpected += payout;
    }
  });
  const portfolioYield = divAssetValKRW>0 ? (annualDivExpected / divAssetValKRW) : 0; // 소수(0.035 = 3.5%)
  // divHistory 기반 실현 배당률 fallback
  const realizedYield = divAssetValKRW>0 ? (annualDiv / divAssetValKRW) : 0;
  const yieldUsed = portfolioYield>0 ? portfolioYield : realizedYield;

  if(targetRaw<=0){
    el.innerHTML=`
      <div style="font-size:.8rem;color:var(--t3);line-height:1.6">
        현재 예상 월 배당금: <strong style="color:var(--acc)">₩${monthlyDiv.toLocaleString()}</strong><br>
        포트폴리오 배당률: <strong>${yieldUsed>0?(yieldUsed*100).toFixed(2)+'%':'미집계'}</strong><br>
        <span style="color:var(--t2)">월 배당 목표 금액을 입력하면 필요 원금을 계산합니다.</span>
      </div>`;
    return;
  }

  const coverage = targetRaw>0 ? (monthlyDiv / targetRaw) : 0;
  const pct = Math.min(coverage * 100, 100);
  const covered = coverage >= 1;
  const barColor = covered ? 'var(--up)' : coverage>0.5?'var(--warn)':'var(--dn)';
  const msg = covered
    ? `🎉 이번 달 배당금이 목표를 달성했습니다! (${(coverage*100).toFixed(1)}%)`
    : coverage>0.5
    ? `📈 배당금이 월 배당 목표의 ${(coverage*100).toFixed(1)}%를 커버합니다.`
    : `💪 배당금이 월 배당 목표의 ${(coverage*100).toFixed(1)}%. 배당 자산을 늘려보세요.`;

  // 필요 원금 · 추가 투자 금액 계산
  let principalBlock = '';
  if(yieldUsed>0){
    const requiredPrincipal = (targetRaw * 12) / yieldUsed; // KRW
    const additionalNeeded = Math.max(0, requiredPrincipal - divAssetValKRW);
    principalBlock = `
      <div style="height:1px;background:var(--border-dark);margin:2px 0"></div>
      <div class="f-between"><span style="font-size:.75rem;color:var(--t3)">적용 배당률 (연)</span><span style="font-weight:600">${(yieldUsed*100).toFixed(2)}%</span></div>
      <div class="f-between"><span style="font-size:.75rem;color:var(--t3)">필요 원금 (연 ₩${Math.round(targetRaw*12).toLocaleString()} / 배당률)</span><span style="font-weight:700;color:var(--acc)">₩${Math.round(requiredPrincipal).toLocaleString()}</span></div>
      <div class="f-between"><span style="font-size:.75rem;color:var(--t3)">현재 배당주 평가금액</span><span style="font-weight:600">₩${Math.round(divAssetValKRW).toLocaleString()}</span></div>
      <div class="f-between"><span style="font-size:.75rem;color:var(--t3)">추가 투자 필요</span><span style="font-weight:700;color:${additionalNeeded>0?'var(--dn)':'var(--up)'}">₩${Math.round(additionalNeeded).toLocaleString()}</span></div>`;
  } else {
    principalBlock = `<div style="font-size:.7rem;color:var(--t3);padding:6px 8px;background:var(--inner-bg);border-radius:6px">⚠️ 배당주 평가금액/배당률이 집계되지 않아 필요 원금을 계산할 수 없습니다. 보유 배당주와 배당 정보를 확인하세요.</div>`;
  }

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="f-between"><span style="font-size:.8rem;color:var(--t3)">예상 월 배당금</span><span style="font-weight:700;color:var(--acc)">₩${monthlyDiv.toLocaleString()}</span></div>
      <div class="f-between"><span style="font-size:.8rem;color:var(--t3)">월 배당 목표 금액</span><span style="font-weight:700">₩${Math.round(targetRaw).toLocaleString()}</span></div>
      <div style="background:var(--border-dark);border-radius:999px;height:10px;overflow:hidden">
        <div style="width:${pct.toFixed(1)}%;height:100%;background:${barColor};border-radius:999px;transition:width .6s ease"></div>
      </div>
      <div style="font-weight:700;font-size:.85rem;color:${barColor}">${(coverage*100).toFixed(1)}% 달성</div>
      <div style="font-size:.78rem;color:var(--t2);padding:8px 10px;background:var(--inner-bg);border-radius:8px;border-left:3px solid ${barColor}">${msg}</div>
      ${principalBlock}
      <div style="font-size:.68rem;color:var(--t3)">* 세후 연간 예상 배당 ${Math.round(annualDiv).toLocaleString()}원 / 12개월 기준 (ISA·연금 세제 혜택 반영). 필요 원금 = (월목표×12) / 배당률.</div>
    </div>
  `;
}

// ── 배당 수익 시뮬레이터 (투자금 × 배당률 → 세전/세후 배당, 계좌 유형별) ─────
function renderDivSimulator() {
  const el = document.getElementById('div-sim-result'); if(!el) return;
  const principal = parseFloat((document.getElementById('div-sim-principal')?.value||'').replace(/,/g,''))||0;
  const yieldPct = parseFloat((document.getElementById('div-sim-yield')?.value||'').replace(/,/g,''))||0;
  const acctType = document.getElementById('div-sim-acct')?.value || '일반';
  if(principal<=0 || yieldPct<=0){
    el.innerHTML = `<span style="color:var(--t3)">투자금액과 배당률을 입력하면 세전/세후 배당금을 계산합니다.</span>`;
    return;
  }
  const annualGross = principal * yieldPct / 100;
  const monthlyGross = annualGross / 12;
  const taxInfo = getAccountDivTaxInfo(acctType);
  let annualNet, taxLabel, taxDesc;
  if (taxInfo.type === '연금') {
    const minRate=_taxRuleValue('pension.pensionReceiptMinRate',0.033);
    const maxRate=_taxRuleValue('pension.pensionReceiptMaxRate',0.055);
    annualNet = annualGross; // 과세이연
    taxLabel = '과세이연 (0%)';
    taxDesc = `연금저축/IRP: 계좌 안 배당은 과세이연. 연금 수령 요건을 충족한 인출은 현재 규칙상 ${(minRate*100).toFixed(1)}~${(maxRate*100).toFixed(1)}% 범위이며 실제 세율은 연령·수령 방식 등에 따라 달라집니다.`;
  } else if (taxInfo.type === 'ISA') {
    const exempt = Math.min(taxInfo.exempt, annualGross);
    const taxable = Math.max(0, annualGross - exempt);
    annualNet = exempt + taxable * (1 - taxInfo.normalRate);
    taxLabel = `ISA 연간 참고 (비과세 가정 ₩${Math.round(exempt).toLocaleString()} + 초과 ${(taxInfo.normalRate*100).toFixed(1)}%)`;
    taxDesc = `ISA 일반형의 유지기간 전체 순소득 정산 규칙(비과세 ${Math.round(taxInfo.exempt).toLocaleString()}원, 초과분 ${(taxInfo.normalRate*100).toFixed(1)}%)을 이 입력의 1년 배당에만 단순 적용한 현금흐름 참고치입니다.`;
  } else {
    const nationalRate=_taxRuleValue('dividend.generalWithholdingNationalRate',0.14);
    const localRate=Math.max(0,taxInfo.normalRate-nationalRate);
    annualNet = annualGross * (1 - taxInfo.normalRate);
    taxLabel = `일반 (−${(taxInfo.normalRate*100).toFixed(1)}%)`;
    taxDesc = `배당 원천징수 ${(nationalRate*100).toFixed(1)}% + 지방소득세 ${(localRate*100).toFixed(1)}% = ${(taxInfo.normalRate*100).toFixed(1)}% 가정.`;
  }
  const monthlyNet = annualNet / 12;
  const effectiveRate = annualGross > 0 ? (1 - annualNet / annualGross) : 0;
  const compound5y = principal * Math.pow(1 + yieldPct/100 * (annualNet/annualGross), 5);
  const target = parseFloat((document.getElementById('div-coverage-target')?.value||'').replace(/,/g,''))||0;
  let coverageLine = '';
  if(target>0){
    const cov = monthlyNet/target*100;
    const col = cov>=100 ? 'var(--up)' : cov>=50 ? 'var(--warn)' : 'var(--dn)';
    coverageLine = `<div class="f-between"><span style="color:var(--t3)">월 배당 목표 대비 커버리지 (세후)</span><span style="font-weight:700;color:${col}">${cov.toFixed(1)}%</span></div>`;
  }
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:6px">
      <div class="f-between"><span style="color:var(--t3)">투자금액</span><span style="font-weight:600">₩${Math.round(principal).toLocaleString()}</span></div>
      <div class="f-between"><span style="color:var(--t3)">적용 배당률 (연)</span><span style="font-weight:600">${yieldPct.toFixed(2)}%</span></div>
      <div class="f-between"><span style="color:var(--t3)">계좌 유형</span><span style="font-weight:600">${taxLabel}</span></div>
      <div style="height:1px;background:var(--border-dark);margin:2px 0"></div>
      <div class="f-between"><span style="color:var(--t3)">세전 연 배당금</span><span style="font-weight:700;color:var(--acc)">₩${Math.round(annualGross).toLocaleString()}</span></div>
      <div class="f-between"><span style="color:var(--t3)">세전 월 배당금 (÷12)</span><span style="font-weight:700;color:var(--acc)">₩${Math.round(monthlyGross).toLocaleString()}</span></div>
      <div class="f-between"><span style="color:var(--t3)">세후 연 배당</span><span style="font-weight:600;color:var(--up)">₩${Math.round(annualNet).toLocaleString()}</span></div>
      <div class="f-between"><span style="color:var(--t3)">세후 월 배당</span><span style="font-weight:600;color:var(--up)">₩${Math.round(monthlyNet).toLocaleString()}</span></div>
      <div class="f-between"><span style="color:var(--t3)">실효 세율</span><span style="font-weight:600">${(effectiveRate*100).toFixed(1)}%</span></div>
      ${coverageLine}
      <div style="font-size:.68rem;color:var(--t3);margin-top:4px">${taxDesc}</div>
      <div style="font-size:.68rem;color:var(--t3)">💡 5년 재투자 복리 (세후) 추정: <strong style="color:var(--t2)">₩${Math.round(compound5y).toLocaleString()}</strong></div>
    </div>`;
}

// ── 홀로그램 버블 차트 (Highcharts) ──────────────────────
let _bubbleMode = 'weight'; // 항상 비중 기준
let _bubbleOwner = '전체';
let _bubbleChart = null;

function setBubbleOwner(owner, btn) {
  _bubbleOwner = owner;
  document.querySelectorAll('[id^="bubble-owner-"]').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderBubbleChart('weight');
}

// Glassmorphism + 네온 스펙트럼 팔레트 — 고정 카테고리-색 매핑 없이 동적 생성
// 매 렌더마다 데이터 인덱스에 맞춰 스펙트럼을 분배해 다양한 네온 그라디언트를 구성한다.
const BUBBLE_SECTOR_COLORS = {}; // 레거시 호환용

// HSL 기반 네온 팔레트 생성 — 채도/밝기는 네온 느낌을 위해 높게 고정, Hue만 균등 분포 + 약간의 시드 오프셋
function _neonPalette(n, seed){
  if (n <= 0) return [];
  const base = (typeof seed === 'number' ? seed : 210) % 360;
  const step = 360 / Math.max(n, 1);
  const pal = [];
  for (let i = 0; i < n; i++){
    // golden-angle-ish skew로 인접 섹터 간 색 유사성 회피
    const h = (base + i * step + (i % 2 ? 18 : 0)) % 360;
    // 레이어별 saturation/lightness 약간 변주 (홀수/짝수)
    const s = 92 - (i % 3) * 4;        // 84~92
    const l = 60 + ((i * 7) % 11) - 5; // 55~66
    pal.push(`hsl(${h.toFixed(1)},${s}%,${l}%)`);
  }
  return pal;
}
// HSL → RGBA (alpha 조정용)
function _hslToRgba(hsl, alpha){
  const m = /hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/i.exec(hsl);
  if(!m) return hsl;
  const h = +m[1]/360, s = +m[2]/100, l = +m[3]/100;
  const a = s * Math.min(l, 1-l);
  const f = (n)=>{
    const k = (n + h*12) % 12;
    const v = l - a * Math.max(-1, Math.min(k-3, 9-k, 1));
    return Math.round(255 * v);
  };
  return `rgba(${f(0)},${f(8)},${f(4)},${alpha!=null?alpha:1})`;
}

// ── view-bubble 용 Owner 스위처 ──
function setBubbleOwnerX(owner, btn) {
  _bubbleOwner = owner;
  document.querySelectorAll('[id^="sunburst-owner-"]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  try { if (typeof changeOwner === 'function' && currentOwner !== owner) { changeOwner(owner, null, true); } } catch(e){}
  // 타이틀 즉시 업데이트 (소유주별 포트폴리오 비중 차트)
  const mt = document.getElementById('main-title');
  if (mt) mt.textContent = (owner === '전체') ? '전체 소유주의 포트폴리오 비중 차트' : `${owner}의 포트폴리오 비중 차트`;
  renderBubbleChart('weight');
}

// 개별 자산 → KRW 환산 가치 (부동산 제외, 전 자산군 공용)
function _bubbleItemValueKRW(i, usdRate) {
  if (i.grp === '금') {
    const gm = i.unit === '돈' ? 3.75 : (i.unit === 'kg' ? 1000 : 1);
    return (i.qty || 0) * gm * (window._GOLD_G_KRW || i.curP || 0);
  }
  const rate = i.cur === 'USD' ? usdRate : (i.cur === 'JPY' ? (RATES.JPY || 9.2) : 1);
  return (i.qty || 0) * (i.curP || 0) * rate;
}

// 소유주/자산군을 키로 쓰는 안정적 HSL 해시 → 같은 owner/grp 은 렌더마다 비슷한 hue 유지
function _neonHash(key) {
  let h = 0;
  const s = String(key || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

// ─────────────────────────────────────────────────────────────
// RBICS L1 섹터 + 자산군 카테고리 매핑 (버블 차트 2nd 레이어 전용)
// ─────────────────────────────────────────────────────────────
// Russell-FactSet RBICS L1 기준 (개별 종목), ETF는 Index/Sector 두 가지만.
// 섹터 hue — 같은 섹터는 모든 소유주에서 동일 색 계열을 유지한다.
const _SECTOR_HUES = {
  'Technology': 214,
  'Financial Services': 164,
  'Health Care': 126,
  'Consumer Discretionary': 322,
  'Consumer Staples': 72,
  'Energy': 20,
  'Communications Services': 272,
  'Industrial Services': 196,
  'Materials & Processing': 46,
  'Real Estate': 346,
  'Utilities': 98,
  // ETF 분류 (Index / Sector 두 가지만)
  'Index ETF': 232,
  'Sector ETF': 292,
  'Other': 218,
  // 비주식 자산군
  'Cash': 152,
  'Crypto': 30,
  'Gold': 48
};
// 색 구성 규칙은 세 테마가 공유하고, 배경에 맞춰 채도·명도만 바꾼다.
// sector는 기준 웨지, leaf는 같은 hue 안에서 종목별로 밝기만 부드럽게 달라진다.
const _BUBBLE_THEME_TONES = {
  light: { sectorSat:40, sectorLight:68, leafSat:32, leafSatRange:11, leafLight:72, leafLightRange:11 },
  dark:  { sectorSat:46, sectorLight:69, leafSat:42, leafSatRange:12, leafLight:65, leafLightRange:10 },
  navy:  { sectorSat:50, sectorLight:64, leafSat:45, leafSatRange:12, leafLight:60, leafLightRange:10 }
};
function _bubbleThemeKey(){
  const theme=document.body.getAttribute('data-theme');
  return theme==='dark'?'dark':theme==='navy'?'navy':'light';
}
function _bubbleSectorColor(sector){
  const tone=_BUBBLE_THEME_TONES[_bubbleThemeKey()]||_BUBBLE_THEME_TONES.navy;
  const hue=Number(_SECTOR_HUES[sector]??_SECTOR_HUES.Other);
  return _bubbleHslHex(hue,tone.sectorSat,tone.sectorLight);
}
// 소유주 웨지도 섹터와 같은 hue·테마 톤 생성기를 사용한다.
// 임의의 별도 팔레트를 섞지 않아 중심 링과 바깥 섹터 링이 한 차트처럼 이어진다.
const _BUBBLE_OWNER_SECTORS = {
  '전체': 'Index ETF',
  '본인': 'Technology',
  '아내': 'Consumer Discretionary',
  '자녀1': 'Financial Services',
  '아버지': 'Communications Services'
};
function _bubbleOwnerColor(owner){
  const tone=_BUBBLE_THEME_TONES[_bubbleThemeKey()]||_BUBBLE_THEME_TONES.navy;
  const sector=_BUBBLE_OWNER_SECTORS[owner]||'Other';
  const hue=Number(_SECTOR_HUES[sector]??_SECTOR_HUES.Other);
  return _bubbleHslHex(hue,tone.sectorSat+3,tone.sectorLight-3);
}
function _bubbleOwnerFill(owner,panelColor){
  const theme=_bubbleThemeKey();
  const mixToPanel=theme==='light'?0.82:theme==='dark'?0.72:0.68;
  return _bubbleBlend(_bubbleOwnerColor(owner),panelColor,mixToPanel);
}
function _bubbleOwnerStroke(owner,panelColor){
  const theme=_bubbleThemeKey();
  const mixToPanel=theme==='light'?0.24:theme==='dark'?0.18:0.14;
  return _bubbleBlend(_bubbleOwnerColor(owner),panelColor,mixToPanel);
}
function _bubbleBlend(hex,target,amount){
  const parse=v=>{
    const s=String(v||'').trim();
    const m=s.match(/^#([0-9a-f]{6})$/i); if(!m) return null;
    return [parseInt(m[1].slice(0,2),16),parseInt(m[1].slice(2,4),16),parseInt(m[1].slice(4,6),16)];
  };
  const a=parse(hex), b=parse(target); if(!a||!b) return hex;
  const mix=a.map((v,i)=>Math.round(v+(b[i]-v)*amount));
  return '#'+mix.map(v=>v.toString(16).padStart(2,'0')).join('');
}
function _bubbleHash(value){
  let h=2166136261;
  const s=String(value||'');
  for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); }
  return h>>>0;
}
function _bubbleHslHex(h,s,l){
  h=((Number(h)%360)+360)%360;
  s=Math.max(0,Math.min(100,s))/100;
  l=Math.max(0,Math.min(100,l))/100;
  const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2;
  const rgb=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
  return '#'+rgb.map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('');
}
// 섹터 hue는 거의 움직이지 않고 종목 키마다 주로 명도를 달리한다.
// 따라서 종목 수가 많아도 같은 섹터는 한 가족처럼 보이고, 재접속 시 색도 유지된다.
function _bubbleLeafColor(sector,key){
  const hash=_bubbleHash(`${sector}::${key}`);
  const base=Number(_SECTOR_HUES[sector]??_SECTOR_HUES.Other);
  const theme=_bubbleThemeKey();
  const tone=_BUBBLE_THEME_TONES[theme]||_BUBBLE_THEME_TONES.navy;
  const hue=base+((hash%13)-6);
  const sat=tone.leafSat+((hash>>>8)%tone.leafSatRange);
  const light=tone.leafLight+((hash>>>16)%tone.leafLightRange);
  return _bubbleHslHex(hue,sat,light);
}

// 개별 종목 → RBICS L1 섹터 추정 (주식 전용). 영문 섹터명 반환.
// 티커 whitelist + 한/영 종목명 키워드 매칭 → 1차 미스 시 확장 키워드로 2차 추론.
function _gicsSector(item) {
  const nameU = (item.name || '').toUpperCase();
  const name = item.name || '';
  const tStrip = (item.tkr || '').toUpperCase().replace(/\.(KS|KQ|T)$/, '');

  // 1) ETF 우선 분류 (국내/해외 ETF 네이밍 규칙 + 대표 티커) → Index ETF / Sector ETF 두 가지만
  //    국내 종목은 stocks.json의 시장구분을 최우선으로 사용한다. 브랜드명이 상품명에
  //    직접 드러나지 않는 TIME 같은 ETF도 이름 추정에 의존하지 않고 정확히 분류된다.
  //    짧은 브랜드(ACE/SOL/PLUS)는 단어 경계로 제한해 오탐 방지
  //    (예: "SPACE Exploration"의 ACE, "SOLAR"의 SOL 이 ETF로 잘못 분류되지 않도록)
  const krMeta = window._krStocksDB && window._krStocksDB.byCode
    ? window._krStocksDB.byCode.get(tStrip)
    : null;
  const isKrEtf = !!(krMeta && String(krMeta.market || '').toUpperCase() === 'ETF');
  const isETF = isKrEtf
    || /ETF|TIGER|KODEX|KINDEX|ARIRANG|KBSTAR|HANARO|KOSEF|TIMEFOLIO/.test(nameU)
    || /^TIME\s+(미국|글로벌|차이나|일본|인도|유럽|나스닥|S&P|코스피|코스닥|KOSPI|KOSDAQ|\d)/i.test(name)
    || /(^|\s)(ACE|SOL|PLUS|RISE)(\s|\d|$)/.test(nameU)
    || /QQQ|NASDAQ\s*100|S&P\s*500|PROSHARES|DIREXION/i.test(name)
    || ['SPY','SPYM','SPLG','IVV','VOO','QQQ','QQQM','DIA','IWM','VTI','VEA','VWO','EFA','AGG','BND','TLT','GLD','SLV',
        'SCHD','VYM','JEPI','JEPQ','DVY','HDV','NOBL',
        // 섹터/테마/광범위 시장 ETF (자주 보유 — 룩스루 대상 확대)
        'SMH','SOXX','XLK','XLF','XLE','XLV','XLY','XLI','XLP','XLU','XLB','XLC','VGT','VUG','VTV','SCHG','SCHX','RSP','MOAT','SPMO',
        'IEFA','IEMG','ACWI','ARKK','ARKG','IJH','IJR','VIG','VONG','QUAL',
        // 레버리지/인버스 지수 ETF (지수 추종)
        'QLD','TQQQ','SQQQ','QID','UPRO','SPXU','SSO','SDS','SOXL','SOXS','UDOW','SDOW','TNA','TZA','FNGU',
        // KR 지수 ETF 대표 코드 (KODEX 200 / RISE 200TR / KODEX 200TR)
        '069500','361580','278530'].includes(tStrip);
  if (isETF) {
    // 지수/시장 전체 추종 → Index ETF (레버리지/인버스 지수 ETF 포함)
    if (/지수|S&P|SP500|나스닥|NASDAQ|다우|DOW|KOSPI\s*200|코스피\s*200|KOSDAQ|코스닥|ALL[-\s]?WORLD|WORLD|TOTAL\s*MARKET|미국\s*전체|전\s*세계|\s200|QQQ|러셀|RUSSELL/i.test(name)
        || ['SPY','SPYM','SPLG','IVV','VOO','QQQ','QQQM','DIA','VTI','IWM','VEA','VWO','EFA',
            'QLD','TQQQ','SQQQ','QID','UPRO','SPXU','SSO','SDS','UDOW','SDOW','TNA','TZA',
            '069500','361580','278530'].includes(tStrip)) return 'Index ETF';
    // 그 외 모든 ETF (배당, 섹터, 채권, 원자재 등) → Sector ETF
    return 'Sector ETF';
  }

  // 2) 대표 티커 / 주요 종목명 키워드 → RBICS L1
  // Technology (반도체 포함, 소프트웨어/하드웨어/IT 인프라 전반)
  if (['NVDA','AMD','INTC','QCOM','AVGO','MU','AMAT','LRCX','KLAC','SMCI','TXN','TSM','ARM','ASML','MRVL','MCHP','ADI','ON','WDC','STX','NXPI','GFS','ONTO','ALAB','CRDO',
       'AAPL','MSFT','CRM','ORCL','ADBE','CSCO','PLTR','NOW','IBM','ANET','SNOW','PANW','CRWD','DDOG','FTNT','ZS','OKTA','NET','SHOP','U','TEAM','WDAY','HUBS','MDB','TWLO','APP','DELL','HPQ','HPE','INTU','ADSK','CDNS','SNPS','ROP','FICO'].includes(tStrip)
      || ['005930','000660','000990','066570'].includes(tStrip)
      || /반도체|파운드리|웨이퍼|DRAM|낸드|NAND|칩|메모리|소프트웨어|전자|테크|IT|소프트|시스템|솔루션|클라우드|디스플레이|OLED|LED|SW|테크놀로지|하드웨어|로봇|AI|인공지능|빅데이터|보안|사이버|정보기술|전산|네트워크|통신장비/i.test(name)) return 'Technology';

  // Financial Services
  if (['JPM','BAC','C','WFC','V','MA','AXP','GS','MS','BLK','SCHW','BRK.B','BRKB','COF','SOFI','HOOD','COIN','UPST','AFRM','PYPL','SQ','XYZ','ALLY','DFS','ICE','CME','SPGI','MCO','KKR','APO','BX','ARES','PGR','TRV','MET','PRU','AIG','ALL','CB','MMC','AON','USB','PNC','TFC','FITB'].includes(tStrip)
      || /금융|은행|지주|카드|증권|보험|캐피탈|핀테크|홀딩스|인베스트|저축|선물|자산운용/i.test(name)
      || ['055550','105560','086790','316140','071050','032830','088350','138930','024110'].includes(tStrip)) return 'Financial Services';

  // Health Care
  if (['JNJ','UNH','LLY','PFE','MRK','ABBV','TMO','ABT','DHR','AMGN','GILD','BMY','CVS','ISRG','REGN','VRTX','MRNA','BNTX','HIMS','DXCM','MDT','SYK','BSX','ZTS','ELV','CI','HCA','MCK','IQV','BIIB','HUM','CNC','GEHC','IDXX','RMD','A','WST','ALNY','NBIX','VEEV'].includes(tStrip)
      || /헬스|바이오|제약|의료|병원|진단|생명과학|제네릭|백신|신약|메디|의약품|의료기기|임플란트|치료제/i.test(name)
      || ['068270','207940','326030','196170','128940','302440','091990','145020','196300'].includes(tStrip)) return 'Health Care';

  // Consumer Discretionary
  if (['TSLA','AMZN','HD','NKE','MCD','LOW','SBUX','BKNG','TJX','F','GM','TM','CMG','LULU','RIVN','LCID','ABNB','MAR','HLT','RCL','CCL','NCLH','EBAY','ETSY','DKNG','YUM','DRI','ORLY','AZO','ROST','DECK','GRMN','EXPE','DASH','CVNA','W','BABA','PDD','JD','NIO','LI','XPEV'].includes(tStrip)
      || /자동차|현대차|기아|유통|백화점|의류|호텔|면세|레저|화장품|뷰티|패션|커머스|리조트|카지노|가구|인테리어|완구|여행|화장/i.test(name)
      || ['005380','000270','012330','282330','035250','272210','161390','090430','161890'].includes(tStrip)) return 'Consumer Discretionary';

  // Energy
  if (['XOM','CVX','COP','SLB','OXY','EOG','PSX','MPC','VLO','ET','KMI','WMB','OKE','LNG','DVN','FANG','HES','HAL','BKR','TRGP','CTRA','MRO','APA'].includes(tStrip)
      || /에너지|정유|석유|오일|가스|친환경|태양광|풍력|수소|원전|태양|ESS|신재생|셰일/i.test(name)
      || ['096770','010950','011170','267250','009830'].includes(tStrip)) return 'Energy';

  // Communications Services
  if (['GOOGL','GOOG','META','NFLX','DIS','CMCSA','T','VZ','TMUS','EA','TTWO','SPOT','PINS','ROKU','SKM','LUMN','WBD','PARA','FOXA','FOX','OMC','IPG','MTCH','SE','SNAP','RBLX','BIDU','LYV','NWSA','TME'].includes(tStrip)
      || /커뮤니케이션|미디어|엔터|통신|네이버|카카오|하이브|스튜디오|플랫폼|콘텐츠|방송|광고|신문|영상|웹툰|노래|게임|ENTERTAINMENT|MEDIA|TELECOM|BROADCAST/i.test(name)
      || ['035420','035720','017670','030200','032640','352820','251270','259960'].includes(tStrip)) return 'Communications Services';

  // Consumer Staples
  if (['PG','KO','PEP','WMT','COST','KMB','CL','MO','PM','MDLZ','CLX','GIS','TGT','KHC','STZ','KDP','HSY','SYY','ADM','KR','DG','DLTR','MNST','KVUE','EL','CHD','K','HRL','TSN'].includes(tStrip)
      || /식품|음료|담배|필수소비재|농산|사료|생필품|라면|제과|유제품|주류|곡류|정육/i.test(name)
      || ['097950','271560','280360','004170','139480','005300'].includes(tStrip)) return 'Consumer Staples';

  // Industrial Services
  if (['UNP','BA','CAT','LMT','GE','MMM','HON','DE','RTX','ETN','CSX','NSC','UPS','FDX',
       'RKLB','ASTS','LUNR','ACHR','JOBY','NOC','GD','LHX','TDG','HWM','AXON','PH','EMR','ROK','CMI','PCAR','WM','RSG','GEV','PWR','URI','FAST','ODFL','CARR','OTIS','JCI'].includes(tStrip)
      || /산업|조선|항공|방산|기계|중공업|건설|전기|물류|운송|해운|운송|육상|항공기|터미널|우주|로켓|위성|발사체|드론/i.test(name)
      || ['329180','042660','010140','028050','047810','064350','034020','204320'].includes(tStrip)) return 'Industrial Services';

  // Materials & Processing
  if (['LIN','APD','SHW','FCX','ECL','DD','NEM','NUE','ALB','SQM','CTVA','DOW','LYB','PPG','VMC','MLM','FMC','MOS','CF','STLD','RS','IP'].includes(tStrip)
      || /소재|화학|철강|비철|금속|배터리|이차전지|2차전지|양극재|음극재|전해질|리튬|니켈|시멘트|유리|섬유|펄프|제지|비료/i.test(name)
      || ['051910','005490','010130','004020','006400','373220'].includes(tStrip)) return 'Materials & Processing';

  // Real Estate
  if (['AMT','PLD','CCI','EQIX','SPG','O','VICI','WELL','PSA','DLR','SBAC','EXR','AVB','EQR','VTR','ARE','WY','IRM','CBRE','CSGP','INVH'].includes(tStrip)
      || /리츠|부동산|REIT|오피스|물류센터|리테일|매장|건물|토지/i.test(name)) return 'Real Estate';

  // Utilities
  if (['NEE','DUK','SO','AEP','D','EXC','SRE','XEL','CEG','VST','ED','PEG','ETR','WEC','ES','AEE','DTE','PCG','EIX','FE','PPL','AWK'].includes(tStrip)
      || /유틸리티|전력|가스공사|한국전력|수도|상수도|하수도/i.test(name)
      || ['015760','036460'].includes(tStrip)) return 'Utilities';

  return 'Other';
}

// 버블 차트 2nd 레이어 카테고리
// 주식 → WICS 기준 분류(국내/해외 모두 영문 섹터명), 그 외 자산군 그대로
function _bubbleCategory(item) {
  const g = item.grp || '';
  if (g === '현금') return 'Cash';
  if (g === '가상화폐') return 'Crypto';
  if (g === '금') return 'Gold';
  return _gicsSector(item);
}

// leaf 라벨 규칙: 해외 주식 = 티커, 국내 주식 = 국문명, 기타 자산군 = 이름
function _bubbleLeafLabel(item) {
  const g = item.grp || '';
  const tStrip = normTkr(item.tkr);
  if (g === '현금' || g === '금') return item.name || item.tkr || g;
  if (g === '가상화폐') return tStrip || item.name || '';
  // 주식: 한국·일본은 종목명, 해외는 티커
  const isKR = (item.cur === 'KRW')
    || /\.(KS|KQ)$/i.test(item.tkr || '')
    || /^\d{6}$/.test(tStrip);
  const isJP = (item.cur === 'JPY') || /\.T$/i.test(item.tkr || '');
  if (isKR || isJP) return item.name || item.tkr || '';
  return tStrip || item.name || '';
}

// Plotly resize 후 도넛 실제 중심에 center label 재배치
function _repositionBubbleCenter(container) {
  const centerEl = document.getElementById('bubble-center-summary');
  const m = container && container._lastBubbleMargin;
  if (!centerEl || !m) return;
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  if (cw < 10 || ch < 10) return;
  const cx = m.l + (cw - m.l - m.r) / 2;
  const cy = m.t + (ch - m.t - m.b) / 2;
  centerEl.style.left = cx + 'px';
  centerEl.style.top = cy + 'px';
  centerEl.style.transform = 'translate(-50%, -50%)';
}

// 모바일 전용 버블 폴백 — Plotly sunburst 대신 종목별 비중 막대 리스트 (비중 가독성 우선)
function _renderBubbleMobileWeights(container, itemsAug, totalVal) {
  const fmt = v => '₩' + Math.round(v).toLocaleString();
  const showOwner = _bubbleOwner === '전체';
  const rows = [...itemsAug].sort((a, b) => b.val - a.val);
  const html = rows.map((x, idx) => {
    const w = (x.val / totalVal) * 100;
    const color = _bubbleSectorColor(x.sector);
    const ownerTag = showOwner ? `<span style="font-size:.62rem;color:var(--acc);font-weight:700;background:var(--inner-bg);padding:1px 6px;border-radius:8px;flex-shrink:0">${_cfEsc(x.raw.owner || '-')}</span>` : '';
    const name = _cfEsc(x.raw.name || x.raw.tkr || '-');
    return `<div style="padding:7px 2px;border-bottom:1px solid var(--border-light)">
      <div style="display:flex;align-items:center;gap:6px;min-width:0">
        ${ownerTag}
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.78rem;font-weight:600;color:var(--t1)">${name}</span>
        <span style="flex-shrink:0;font-size:.78rem;font-weight:800;color:${color};font-family:'Manrope','Noto Sans KR',sans-serif">${w.toFixed(1)}%</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
        <div style="flex:1;height:6px;border-radius:3px;background:var(--inner-bg);overflow:hidden">
          <div style="height:100%;width:${Math.max(w, 0.5).toFixed(1)}%;background:${color};border-radius:3px"></div>
        </div>
        <span style="flex-shrink:0;font-size:.68rem;color:var(--t3);font-family:'Manrope','Noto Sans KR',sans-serif">${fmt(x.val)}</span>
      </div>
    </div>`;
  }).join('');
  container.innerHTML = `<div style="padding:4px 2px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;padding:2px 2px 8px">
      <span style="font-size:.8rem;font-weight:700;color:var(--t3)">종목별 비중 (${rows.length}종목)</span>
      <span style="font-size:.74rem;font-weight:800;color:var(--t1);font-family:'Manrope','Noto Sans KR',sans-serif">${fmt(totalVal)}</span>
    </div>${html}</div>`;
}

function renderBubbleChart(mode) {
  // view-bubble 의 컨테이너 재활용 (sunburst-container), 없으면 레거시
  const container = document.getElementById('sunburst-container') || document.getElementById('bubble-chart-container');
  if (!container) return;
  if (typeof Plotly === 'undefined') {
    container.innerHTML = '<div style="color:var(--t3);text-align:center;padding:40px">Plotly 로딩 중...</div>';
    return;
  }

  if (!window._bubbleRetry) window._bubbleRetry = 0;
  const rect = container.getBoundingClientRect();
  // 모바일은 HTML 리스트 폴백이라 컨테이너 크기 불필요 — 0크기 재시도 게이트 통과
  if (!isMobileLayout() && (rect.width < 10 || rect.height < 10)) {
    const vbActive = !!document.querySelector('#view-bubble.active');
    if (vbActive && window._bubbleRetry < 30) {
      window._bubbleRetry++;
      if (window._bubbleRetry > 5 && !container.style.minHeight) container.style.minHeight = '520px';
      setTimeout(() => renderBubbleChart(mode), 200);
    } else {
      window._bubbleRetry = 0;
    }
    return;
  }
  window._bubbleRetry = 0;

  // 드릴 상태 추적 — 재렌더(소유주 변경/모드 변경) 시 root 로 리셋되어 Plotly.react 의 초기 root 와 동기화
  container._bubbleCurrentRoot = '__TOTAL__';

  // center summary div 보존 — 차트 렌더 전에 컨테이너 바깥으로 분리
  const centerEl = document.getElementById('bubble-center-summary');
  if (centerEl) {
    try { centerEl.parentNode.removeChild(centerEl); } catch (e) {}
  }

  const filterOwner = _bubbleOwner === '전체' ? null : _bubbleOwner;
  const usdRate = RATES.USD || 1380;

  // ── 부동산 제외 · 소유주 필터 적용 ──
  const baseItems = pfolioData
    .filter(i => i && i.grp !== '부동산' && (!filterOwner || i.owner === filterOwner))
    .map(i => ({ raw: i, val: _bubbleItemValueKRW(i, usdRate) }))
    .filter(x => x.val > 0);

  if (baseItems.length === 0) {
    try { if (typeof Plotly !== 'undefined') Plotly.purge(container); } catch (e) {}
    container._bubbleExtLabelsHookAttached = false;
    container.innerHTML = '<div style="color:var(--t3);text-align:center;padding:60px;font-family:\'Noto Sans KR\',\'Manrope\',sans-serif;font-weight:700" data-bubble-empty="1">표시할 자산이 없습니다.</div>';
    if (centerEl) container.appendChild(centerEl);
    return;
  }
  if (container.querySelector('[data-bubble-empty]')) {
    try { if (typeof Plotly !== 'undefined') Plotly.purge(container); } catch (e) {}
    container.innerHTML = '';
    container._bubbleExtLabelsHookAttached = false;
  }

  const totalVal = baseItems.reduce((s, x) => s + x.val, 0) || 1;
  const isDark = isDarkTheme();
  const textColor = cssVar('--t1',isDark?'#e7e9ee':'#18213a');
  const panelColor = cssVar('--glass',isDark?'#15181e':'#ffffff');

  // ── 계층 구축: ROOT → (전체 모드일 때) owner → grp → name ──
  // Plotly sunburst 는 ids / labels / parents / values 배열로 트리를 받는다.
  // root 라벨은 빈 문자열 — 중앙은 composition 오버레이가 차지한다.
  const rootId = '__TOTAL__';
  const rootDisplay = filterOwner ? `${filterOwner} 포트폴리오` : '[TOTAL]';
  const ids = [rootId];
  const labels = [''];
  const parents = [''];
  const values = [totalVal];
  const colors = ['rgba(0,0,0,0)'];
  const customdata = [{ kind: 'root', owner: '', name: rootDisplay, weight: 100, value: totalVal }];

  // 동일 소유주+티커(DCA 중복 포함)를 하나의 leaf로 병합
  const _mergeMap = new Map();
  baseItems.forEach(({ raw, val }) => {
    const key = `${raw.owner || ''}::${(raw.tkr || raw.name || '').toUpperCase()}`;
    if (_mergeMap.has(key)) {
      _mergeMap.get(key).val += val;
      if (!raw.dca) _mergeMap.get(key).raw = raw; // 보유 항목을 대표 항목으로 우선
    } else {
      _mergeMap.set(key, { raw, val });
    }
  });
  // 각 종목에 대한 2nd 레이어 카테고리(섹터/자산군) 사전 계산 & 집계
  const itemsAug = Array.from(_mergeMap.values()).map(({ raw, val }) => ({
    raw, val, sector: _bubbleCategory(raw)
  }));

  // ── 모바일: Plotly 대신 종목별 비중 리스트 + 섹터 비중표 ──
  if (isMobileLayout()) {
    try { Plotly.purge(container); } catch (e) {}
    container._bubbleExtLabelsHookAttached = false;
    _renderBubbleMobileWeights(container, itemsAug, totalVal);
    if (centerEl) container.appendChild(centerEl); // 분리된 center 엘리먼트 유실 방지 (CSS로 숨김)
    _renderBubbleSectorTable(itemsAug, totalVal, isDark);
    return;
  }

  const ownerAgg = {};
  const secAggByOwner = {};
  itemsAug.forEach(({ raw, val, sector }) => {
    const o = raw.owner || '기타';
    ownerAgg[o] = (ownerAgg[o] || 0) + val;
    if (!secAggByOwner[o]) secAggByOwner[o] = {};
    secAggByOwner[o][sector] = (secAggByOwner[o][sector] || 0) + val;
  });

  const ownerKeys = Object.keys(ownerAgg).sort((a, b) => ownerAgg[b] - ownerAgg[a]);
  const ownersForLayer = filterOwner ? [filterOwner] : ownerKeys;

  ownersForLayer.forEach((owner, oi) => {
    const ownerVal = ownerAgg[owner] || 0;
    const ownerWeight = (ownerVal / totalVal) * 100;
    let parentIdForSec;
    if (!filterOwner) {
      const oid = `O::${owner}`;
      ids.push(oid);
      labels.push(owner);
      parents.push(rootId);
      values.push(ownerVal);
      // 소유주 링은 섹터 팔레트의 같은 hue를 쓰되 테마 패널색과 섞어 옅게 채운다.
      // 소유주 구분은 유지하면서 바깥 섹터·종목 링보다 시각적 우선순위가 낮게 보인다.
      colors.push(_bubbleOwnerFill(owner,panelColor));
      customdata.push({ kind: 'owner', owner, name: owner, weight: ownerWeight, value: ownerVal });
      parentIdForSec = oid;
    } else {
      parentIdForSec = rootId;
    }

    // 2nd 레이어: GICS 섹터 or 자산군 (현금/가상화폐/금)
    const secMap = secAggByOwner[owner] || {};
    const secKeys = Object.keys(secMap).sort((a, b) => secMap[b] - secMap[a]);
    secKeys.forEach((sector) => {
      const secVal = secMap[sector];
      const secWeight = (secVal / totalVal) * 100;
      const gid = `G::${owner}::${sector}`;
      const secColor = _bubbleSectorColor(sector);
      ids.push(gid);
      labels.push(sector);
      parents.push(parentIdForSec);
      values.push(secVal);
      colors.push(_bubbleBlend(secColor,panelColor,isDark?0.10:0.06));
      customdata.push({ kind: 'grp', owner, name: sector, weight: secWeight, value: secVal });

      // 3rd 레이어: 개별 종목(leaf)
      const leafItems = itemsAug
        .filter(x => (x.raw.owner || '기타') === owner && x.sector === sector)
        .sort((a, b) => b.val - a.val);
      leafItems.forEach((x, li) => {
        const i = x.raw;
        const val = x.val;
        const weight = (val / totalVal) * 100;
        const displayName = _bubbleLeafLabel(i);
        const leafId = `L::${owner}::${sector}::${i.tkr || i.name}::${li}`;
        ids.push(leafId);
        // leaf 라벨은 내부에 표시하지 않음 — 외부 리더라인 + 텍스트로 대체
        labels.push('');
        parents.push(gid);
        values.push(val);
        colors.push(_bubbleLeafColor(sector,`${owner}::${i.tkr||i.name}::${li}`));
        customdata.push({
          kind: 'leaf',
          owner: i.owner || owner,
          grp: i.grp,
          sector,
          name: i.name || displayName,
          displayName,
          tkr: i.tkr || '',
          weight,
          value: val
        });
      });
    });
  });

  // 호버 툴팁 전용 텍스트 — 실제 평가액은 여기서만 노출 (슬라이스 내부에는 노출되지 않음)
  const fmtKRW = (v) => '₩' + Math.round(v || 0).toLocaleString('ko-KR');
  const hoverText = customdata.map(d => {
    if (d.kind === 'root') {
      return `<b>${_cfEsc(d.name)}</b><br><span style="opacity:.8">전체 비중 100.00%</span><br><span style="opacity:.9">평가액 ${fmtKRW(d.value)}</span>`;
    }
    if (d.kind === 'owner') {
      return `<b>${_cfEsc(d.owner)}</b><br><span style="opacity:.8">전체 비중 ${d.weight.toFixed(2)}%</span><br><span style="opacity:.9">평가액 ${fmtKRW(d.value)}</span>`;
    }
    if (d.kind === 'grp') {
      return `<b>${_cfEsc(d.owner)} · ${_cfEsc(d.name)}</b><br><span style="opacity:.8">전체 비중 ${d.weight.toFixed(2)}%</span><br><span style="opacity:.9">평가액 ${fmtKRW(d.value)}</span>`;
    }
    // 종목명(국문 또는 영문) 과 티커를 한 줄에 괄호로 병기
    const tkrPart = d.tkr ? ` <span style="opacity:.7">(${_cfEsc(d.tkr)})</span>` : '';
    const secLine = d.sector ? `<br><span style="opacity:.75">${_cfEsc(d.sector)}</span>` : '';
    return `<b>${_cfEsc(d.owner)} · ${_cfEsc(d.name)}${tkrPart}</b>${secLine}<br><span style="opacity:.8">비중 ${d.weight.toFixed(2)}%</span><br><span style="opacity:.9">평가액 ${fmtKRW(d.value)}</span>`;
  });

  const trace = {
    type: 'sunburst',
    ids, labels, parents, values,
    branchvalues: 'total',
    marker: {
      colors,
      line: {
        color: _bubbleThemeKey()==='light'?'rgba(255,255,255,.86)':'rgba(245,249,255,.28)',
        width: 1.35
      }
    },
    leaf: { opacity: 0.82 },
    // 내부 라벨: owner/섹터 만 노출 (leaf 는 라벨 비어있음 → 외부 리더라인으로 노출)
    textinfo: 'label',
    insidetextorientation: 'horizontal',
    textfont: {
      family: "'Noto Sans KR','Manrope',sans-serif",
      size: 13,
      color: textColor
    },
    hovertext: hoverText,
    hoverinfo: 'text',
    customdata
  };

  const longestLeafLabel=Math.max(0,...customdata
    .filter(d=>d.kind==='leaf')
    .map(d=>Array.from(String(d.displayName||d.name||'')).length));
  const labelMargin=Math.min(240,Math.max(165,Math.round(38+longestLeafLabel*6.4)));
  const layout = {
    // 외부 종목 라벨(국문명 최대 길이) 확보를 위한 넉넉한 좌우 여백
    // 가장 긴 라벨 길이에 따라 여백을 늘리되 차트 본체가 지나치게 작아지지 않게 상한을 둔다.
    margin: { t: 72, l: labelMargin, r: Math.min(265,labelMargin+(filterOwner?25:0)), b: 68 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: "'Noto Sans KR','Manrope',sans-serif", color: textColor, size: 13 },
    showlegend: false,
    // 내부 텍스트 최소 크기 — 이 값 아래로 내려가야 하는 슬라이스는 글자 대신 숨김
    uniformtext: { minsize: 8, mode: 'hide' },
    hoverlabel: {
      bgcolor: cssVar('--tipbg',isDark?'#f4f7fb':'#18213a'),
      bordercolor: cssVar('--tipbd',isDark?'#ffffff':'#31405e'),
      font: {
        family: "'Noto Sans KR','Manrope',sans-serif",
        size: 13,
        color: cssVar('--tiptx',isDark?'#111827':'#f8fafc')
      }
    },
    transition: { duration: 600, easing: 'cubic-in-out' }
  };

  try {
    Plotly.react(container, [trace], layout, {
      responsive: true,
      displayModeBar: false,
      displaylogo: false
    });
  } catch (e) {
    console.error('[Hologram-Bubble] render failed:', e);
    container.innerHTML = '<div style="color:var(--t3);text-align:center;padding:40px">차트 렌더링 실패</div>';
  }

  // margin을 컨테이너에 저장 — _repositionBubbleCenter()가 참조
  container._lastBubbleMargin = layout.margin;

  // Center label — 개별 소유주 선택 시 소유주명, 전체 모드에서는 "전체"
  if (centerEl) {
    const pctsEl = centerEl.querySelector('#bubble-summary-pcts');
    if (pctsEl) {
      const labelText = filterOwner || '전체';
      const c = filterOwner
        ? ((typeof BENCH_OWNER_COLORS!=='undefined'&&BENCH_OWNER_COLORS[filterOwner])||cssVar('--acc','#2a6fdb'))
        : cssVar('--acc','#2a6fdb');
      pctsEl.innerHTML = `<span style="color:${c};font-family:'Manrope','Noto Sans KR',sans-serif;font-weight:800">${labelText}</span>`;
    }
    container.appendChild(centerEl);
    requestAnimationFrame(() => _repositionBubbleCenter(container));
    setTimeout(() => _repositionBubbleCenter(container), 250);
    setTimeout(() => _repositionBubbleCenter(container), 700);
  }

  // 우측 섹터 비중표 렌더링 (현재 필터 기준 합계)
  _renderBubbleSectorTable(itemsAug, totalVal, isDark);

  // 외부 리더라인 + 종목명 라벨 — Plotly 렌더 완료 후 후처리
  // 최신 컨텍스트(ids/customdata/테마)를 컨테이너에 스태시하고 이벤트 훅이 읽는다.
  container._lastBubbleCtx = { ids, customdata, isDark, textColor };
  const ownerLabelNames=new Set(customdata.filter(d=>d.kind==='owner').map(d=>d.owner));
  const _fixOwnerLabelAlign = () => {
    const svgEl = container.querySelector('svg.main-svg') || container.querySelector('svg');
    if (!svgEl) return;
    svgEl.querySelectorAll('.sunburstlayer path').forEach(path=>{
      const dnode=path.__data__;
      const nodeId=(dnode?.data&&dnode.data.id)||dnode?.id||'';
      if(String(nodeId).startsWith('O::')){
        const ownerName=String(nodeId).slice(3);
        path.style.fill=_bubbleOwnerFill(ownerName,panelColor);
        path.style.fillOpacity='1';
        path.style.stroke=_bubbleOwnerStroke(ownerName,panelColor);
        path.style.strokeWidth='1.6px';
        path.style.strokeLinejoin='round';
        path.style.strokeDasharray='none';
      }
    });
    svgEl.querySelectorAll('.sunburstlayer text').forEach(t => {
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('dominant-baseline', 'central');
      const ownerName=(t.textContent||'').replace(/^●\s*/,'').trim();
      const isOwnerLabel=ownerLabelNames.has(ownerName);
      t.style.fontSize=isOwnerLabel?'16px':'13px';
      t.style.fontWeight=isOwnerLabel?'800':'650';
      if(isOwnerLabel) {
        t.setAttribute('data-cb-bubble-owner',ownerName);
        t.style.letterSpacing='.02em';
        while(t.firstChild) t.removeChild(t.firstChild);
        const dotSpan=document.createElementNS('http://www.w3.org/2000/svg','tspan');
        dotSpan.textContent='● ';
        dotSpan.setAttribute('fill',_bubbleOwnerColor(ownerName));
        dotSpan.style.fontSize='12px';
        dotSpan.style.fontWeight='900';
        const labelSpan=document.createElementNS('http://www.w3.org/2000/svg','tspan');
        labelSpan.textContent=ownerName;
        labelSpan.setAttribute('fill',textColor);
        labelSpan.style.fontSize='16px';
        labelSpan.style.fontWeight='800';
        t.append(dotSpan,labelSpan);
      } else {
        t.removeAttribute('data-cb-bubble-owner');
      }
      t.querySelectorAll('tspan').forEach(s=>{
        if(!isOwnerLabel){
          s.style.fontSize='13px';
          s.style.fontWeight='650';
        }
      });
    });
  };
  const drawLabels = () => {
    const ctx = container._lastBubbleCtx;
    if (!ctx) return;
    _drawBubbleExternalLabels(container, ctx.ids, ctx.customdata, ctx.isDark, ctx.textColor);
    _fixOwnerLabelAlign();
  };
  // 즉시 시도 + 안전망 — Plotly.react 직후 DOM 이 준비되지 않은 프레임이 있을 수 있음
  requestAnimationFrame(() => requestAnimationFrame(drawLabels));
  setTimeout(drawLabels, 200);
  setTimeout(drawLabels, 700); // 600ms 트랜지션 완료 후 재적용
  // 이벤트 훅은 컨테이너당 1회만 등록. 드릴다운 클릭은 transition 완료 후 재그림.
  if (!container._bubbleExtLabelsHookAttached) {
    container._bubbleExtLabelsHookAttached = true;
    try {
      container.on && container.on('plotly_afterplot', () => {
        requestAnimationFrame(() => requestAnimationFrame(drawLabels));
      });
      container.on && container.on('plotly_sunburstclick', (evtData) => {
        // 드릴다운 transition 이 끝난 뒤 라벨을 다시 계산 (slice 기하가 바뀌므로 필수)
        // 소유주·섹터 중첩 방지: 드릴다운 시 center overlay 숨김, 루트 복귀 시 복원
        // Plotly: 현재 표시된 root slice 를 클릭하면 부모로 navigate UP. 이때도 pt.id 는
        // 그 slice 의 id 라서 단순히 pt.id 로만 isAtRoot 를 판정하면 복귀 시 라벨이 가려진다.
        // → 컨테이너에 현재 root 를 저장해 비교한다.
        const pt = evtData && evtData.points && evtData.points[0];
        const cEl = document.getElementById('bubble-center-summary');
        if (pt && cEl) {
          const currentRoot = container._bubbleCurrentRoot || '__TOTAL__';
          const clickedId = pt.id || '';
          const newRoot = (clickedId === currentRoot) ? (pt.parent || '__TOTAL__') : clickedId;
          container._bubbleCurrentRoot = newRoot;
          const isAtRoot = !newRoot || newRoot === '__TOTAL__';
          cEl.style.transition = 'opacity .25s ease';
          cEl.style.opacity = isAtRoot ? '1' : '0';
        }
        setTimeout(drawLabels, 520);
        setTimeout(drawLabels, 900);
      });
    } catch (e) {}
  }
}

// Plotly sunburst 렌더 후 leaf 슬라이스 외부에 리더라인 + 종목명 라벨을 그린다.
// 드릴다운 등으로 현재 보이는 leaf 집합이 바뀌어도 매번 재계산한다.
// 비중이 작은 슬라이스도 포함해 전부 노출하되, 인접 라벨의 Y 좌표를 상/하로
// 밀어내는 anti-collision 으로 텍스트가 겹치지 않게 한다.
function _drawBubbleExternalLabels(container, ids, customdata, isDark, textColor) {
  if (!container) return;
  const svg = container.querySelector('svg.main-svg') || container.querySelector('svg');
  if (!svg) return;
  const layer = svg.querySelector('.sunburstlayer');
  if (!layer) return;

  // 기존 오버레이 제거 (재렌더 중복 방지)
  const old = svg.querySelector('g.bubble-ext-labels');
  if (old) old.parentNode.removeChild(old);

  // 차트 중심 · 반경 계산 — 현재 렌더된 슬라이스 기하에서 계산
  let layerBB;
  try { layerBB = layer.getBBox(); } catch (e) { return; }
  if (!layerBB || !isFinite(layerBB.width) || layerBB.width < 10) return;
  const cx = layerBB.x + layerBB.width / 2;
  const cy = layerBB.y + layerBB.height / 2;
  const R = Math.min(layerBB.width, layerBB.height) / 2;
  if (R < 20) return;
  // 우측 라벨이 COMPOSITION 패널과 겹치지 않도록 SVG 너비 기준으로 x 상한 계산
  const svgClientW = container.getBoundingClientRect().width;
  const svgViewW = parseFloat(svg.getAttribute('width')) || svgClientW;
  // SVG 좌표계와 실제 픽셀 좌표계의 스케일 비율 보정
  const svgScaleX = svgClientW > 0 ? svgViewW / svgClientW : 1;
  // 라벨이 SVG 내 좌/우 10px 마진 안쪽에 머물도록 x 한계 설정
  const rightXMax = svgViewW - 10 * svgScaleX;
  const leftXMin = 10 * svgScaleX;

  // 현재 '실제로 보이는' leaf 슬라이스만 수집. 드릴다운 후에는 범위 밖 슬라이스의
  // 폭/높이가 0 이 되므로 이를 제외해야 더미 라벨이 남지 않는다.
  const leafs = [];
  const paths = layer.querySelectorAll('path');
  paths.forEach(p => {
    const dnode = p.__data__;
    if (!dnode) return;
    const nodeId = (dnode.data && dnode.data.id) || dnode.id;
    if (!nodeId || String(nodeId).indexOf('L::') !== 0) return;
    const idx = ids.indexOf(nodeId);
    if (idx < 0) return;
    const info = customdata[idx];
    if (!info) return;
    let bb;
    try { bb = p.getBBox(); } catch (e) { return; }
    // 드릴다운 영역 밖 슬라이스는 크기 0 (또는 거의 0) — 이걸 정확히 걸러냄
    if (!bb || bb.width < 0.5 || bb.height < 0.5) return;
    // 가시성 체크 (opacity 0 이거나 display:none 조상 제외)
    const style = window.getComputedStyle(p);
    if (style && (style.display === 'none' || parseFloat(style.opacity) === 0)) return;
    let bx = bb.x + bb.width / 2;
    let by = bb.y + bb.height / 2;
    let dx = bx - cx, dy = by - cy;
    let dist = Math.hypot(dx, dy);
    // 100% 단일 슬라이스(거의 360°)는 bbox 중심이 차트 중심과 일치 → 라벨이 중앙에 떨어짐.
    // 이 경우 path 위 한 점을 샘플링해 실제 각도를 구한다 (없으면 3시 방향으로 폴백).
    if (dist < R * 0.15) {
      try {
        const len = p.getTotalLength ? p.getTotalLength() : 0;
        const pt = (len > 0 && p.getPointAtLength) ? p.getPointAtLength(len * 0.25) : null;
        if (pt && isFinite(pt.x) && isFinite(pt.y)) {
          dx = pt.x - cx;
          dy = pt.y - cy;
          dist = Math.hypot(dx, dy);
        }
      } catch (e) {}
      if (dist < R * 0.15) { dx = R; dy = 0; dist = R; } // 최종 폴백: 3시 방향
    }
    if (!dist) dist = 1;
    const angle = Math.atan2(dy, dx);
    leafs.push({ info, angle, dx: dx / dist, dy: dy / dist });
  });
  if (!leafs.length) return;

  // SVG 네임스페이스 & 오버레이 그룹
  const NS = 'http://www.w3.org/2000/svg';
  const overlay = document.createElementNS(NS, 'g');
  overlay.setAttribute('class', 'bubble-ext-labels');
  overlay.setAttribute('pointer-events', 'none');

  const lineColor = cssVar('--border-dark',isDark?'#2c313c':'#c9d3e6');
  const labelFill = cssVar('--t2',textColor);
  const labelOpacity = 1;

  const startR = R - 2;
  const lineR = R + 15;
  const textR = R + 29;
  // 라벨이 들어갈 수 있는 세로 가용 공간 (사이드별 동일)
  const availH = (R + 40) * 2;
  const yMax = cy + R + 40;
  const yMin = cy - R - 40;
  // 사이드별 라벨 간격을 가용 높이에 맞춰 적응적으로 결정 — 라벨이 적으면 여유,
  // 많으면 최소 11px 까지 압축해 모든 종목명을 노출한다.
  const computeLabelH = (count) => {
    if (count <= 1) return 15;
    return Math.max(9, Math.min(15, availH / count));
  };

  // 좌/우 분리하여 Y 좌표 기준 anti-collision — 비중이 작아도 모든 종목을 노출한다.
  const right = [];
  const left = [];
  leafs.forEach(lf => {
    const lx = cx + lf.dx * lineR;
    const ly = cy + lf.dy * lineR;
    const tx = cx + lf.dx * textR + (lf.dx >= 0 ? 6 : -6);
    const sx = cx + lf.dx * startR;
    const sy = cy + lf.dy * startR;
    const entry = { info: lf.info, sx, sy, lx, ly, tx, desiredY: ly, dx: lf.dx };
    (lf.dx >= 0 ? right : left).push(entry);
  });

  // 각 사이드: 위→아래 순으로 정렬 후 적응적 간격(labelH) 으로 anti-collision
  const resolve = (arr, labelH) => {
    arr.sort((a, b) => (a.desiredY - b.desiredY) || ((b.info.value||0)-(a.info.value||0)));
    // 1차: 위→아래로 누르며 최소 간격 확보
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].desiredY - arr[i - 1].desiredY < labelH) {
        arr[i].desiredY = arr[i - 1].desiredY + labelH;
      }
    }
    // 2차: 끝이 yMax 초과면 마지막을 yMax 로 고정 후 위로 밀어 정상화
    if (arr.length && arr[arr.length - 1].desiredY > yMax) {
      arr[arr.length - 1].desiredY = yMax;
      for (let i = arr.length - 2; i >= 0; i--) {
        if (arr[i + 1].desiredY - arr[i].desiredY < labelH) {
          arr[i].desiredY = arr[i + 1].desiredY - labelH;
        }
      }
    }
    // 3차: 시작이 yMin 미만이면 첫 라벨을 yMin 으로 고정 후 아래로 밀어 정상화
    if (arr.length && arr[0].desiredY < yMin) {
      arr[0].desiredY = yMin;
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].desiredY - arr[i - 1].desiredY < labelH) {
          arr[i].desiredY = arr[i - 1].desiredY + labelH;
        }
      }
    }
  };
  const labelH_R = computeLabelH(right.length);
  const labelH_L = computeLabelH(left.length);
  resolve(right, labelH_R);
  resolve(left, labelH_L);

  // 적응적 간격이 좁아지면 폰트도 약간 축소 (가독성 균형)
  const fontFor = (lh) => (lh >= 14 ? 12 : lh >= 12 ? 11 : lh >= 10 ? 10 : 9);

  // overlay 를 먼저 SVG 에 삽입 — paint() 내에서 getComputedTextLength() 로 라벨 폭 측정 가능
  if (layer.parentNode) layer.parentNode.appendChild(overlay);

  // 라벨이 가용 폭을 초과하면 끝부분을 자르고 '…' 표시 — 좌/우 모두 SVG 마진 안쪽에 유지
  const fitText = (textEl, fullText, maxWidth) => {
    if (!fullText) return;
    textEl.textContent = fullText;
    let w = 0;
    try { w = textEl.getComputedTextLength(); } catch (e) { return; }
    if (w <= maxWidth || maxWidth <= 0) return;
    const originalSize=parseFloat(textEl.getAttribute('font-size'))||10;
    const fittedSize=Math.max(8,Math.floor(originalSize*maxWidth/w*10)/10);
    textEl.setAttribute('font-size',String(fittedSize));
    try { w=textEl.getComputedTextLength(); } catch(e){}
    if(w<=maxWidth) return;
    let lo = 0, hi = fullText.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      textEl.textContent = fullText.slice(0, mid) + '…';
      let cw = 0;
      try { cw = textEl.getComputedTextLength(); } catch (e) { cw = Infinity; }
      if (cw <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    textEl.textContent = (lo > 0 ? fullText.slice(0, lo) : '') + '…';
  };

  const paint = (arr, labelH) => {
    const fontSize = fontFor(labelH);
    arr.forEach(({ info, sx, sy, lx, ly, tx, desiredY, dx }) => {
      const finalY = desiredY;
      // 원주의 각도를 따라 라벨 X를 유지하고, SVG 경계만 클램프한다.
      // 상·하단 라벨은 원에 가깝게, 좌·우 라벨은 자연스럽게 바깥으로 퍼진다.
      const finalTx = dx >= 0 ? Math.min(tx, rightXMax) : Math.max(tx, leftXMin);
      const line = document.createElementNS(NS, 'polyline');
      // 슬라이스 → 방사형 끝점 → 수평(라벨까지) 의 3-세그먼트 L자 리더
      const hx = lx + (dx >= 0 ? 10 : -10);
      line.setAttribute('points', `${sx},${sy} ${lx},${ly} ${hx},${finalY} ${finalTx - (dx >= 0 ? 4 : -4)},${finalY}`);
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', lineColor);
      line.setAttribute('stroke-width', '0.9');
      line.setAttribute('stroke-dasharray', '2 2.5');
      line.setAttribute('stroke-linecap', 'round');
      overlay.appendChild(line);

      const text = document.createElementNS(NS, 'text');
      text.setAttribute('x', String(finalTx));
      text.setAttribute('y', String(finalY));
      text.setAttribute('text-anchor', dx >= 0 ? 'start' : 'end');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('font-family', "'Noto Sans KR','Manrope',sans-serif");
      text.setAttribute('font-size', String(fontSize));
      text.setAttribute('font-weight', '700');
      text.setAttribute('fill', labelFill);
      text.setAttribute('opacity', String(labelOpacity));
      overlay.appendChild(text);
      // dx >= 0: 라벨이 finalTx → 우측으로 늘어남, 가용 폭 = rightXMax - finalTx
      // dx < 0:  라벨이 finalTx → 좌측으로 늘어남, 가용 폭 = finalTx - leftXMin
      const maxWidth = (dx >= 0 ? (rightXMax - finalTx) : (finalTx - leftXMin)) - 2;
      fitText(text, info.displayName || info.name || '', maxWidth);
    });
  };
  paint(right, labelH_R);
  paint(left, labelH_L);
}

// 우측 섹터 비중표 — 현재 필터(전체/소유주) 기준 섹터별 합계 + 진행 막대
// 현재 드릴된 섹터(클릭으로 우측에 종목 패널 노출 중인 섹터). 필터/뷰 변경 시 초기화.
let _bubbleDrilledSector = null;
// 마지막 렌더 컨텍스트 — 우측 패널 토글 시 다시 사용
let _bubbleLastCtx = null;

function _renderBubbleSectorTable(itemsAug, totalVal, isDark) {
  const tbl = document.getElementById('bubble-sector-table');
  if (!tbl) return;
  // 컨텍스트 보존 (드릴 토글 시 재사용)
  _bubbleLastCtx = { itemsAug, totalVal, isDark };

  if (!itemsAug || !itemsAug.length || !totalVal) {
    tbl.innerHTML = '';
    _bubbleDrilledSector = null;
    _applyBubbleDrillState(false);
    return;
  }
  const sectorTotals = {};
  itemsAug.forEach(x => {
    sectorTotals[x.sector] = (sectorTotals[x.sector] || 0) + x.val;
  });
  const rows = Object.entries(sectorTotals).sort((a, b) => b[1] - a[1]);

  // 현재 데이터에 드릴된 섹터가 더 이상 존재하지 않으면 자동 해제
  if (_bubbleDrilledSector && !sectorTotals[_bubbleDrilledSector]) {
    _bubbleDrilledSector = null;
    _applyBubbleDrillState(false);
  }

  const headerColor = 'var(--t3)';
  const rowBg = 'var(--inner-bg)';
  const rowBgSel = 'var(--acc-soft)';
  const rowBorder = 'var(--border-light)';
  const rowBorderSel = 'var(--acc)';
  const textPrimary = 'var(--t1)';
  const fmtKRW = (v) => '₩' + Math.round(v).toLocaleString('ko-KR');
  const html = [
    `<div style="font-family:'Noto Sans KR','Manrope',sans-serif;font-size:.68rem;letter-spacing:.08em;color:${headerColor};font-weight:700;padding:2px 8px 10px;">섹터 구성</div>`,
    `<div style="display:flex;flex-direction:column;gap:5px;">`
  ];
  rows.forEach(([sec, val]) => {
    const pct = (val / totalVal * 100);
    const pctStr = pct >= 10 ? pct.toFixed(1) : pct.toFixed(2);
    const c = _bubbleSectorColor(sec);
    const isSel = _bubbleDrilledSector === sec;
    const safeSec = _cfEsc(sec);
    const detailHtml = isSel ? _renderBubbleLeavesPanel(sec, itemsAug, isDark, true) : '';
    html.push(`
      <div style="border-radius:8px;background:${isSel ? rowBgSel : rowBg};border:1px solid ${isSel ? rowBorderSel : rowBorder};overflow:hidden;transition:background .15s ease, border-color .15s ease;">
      <button type="button" data-bubble-sector="${safeSec}" onclick="handleBubbleSectorClick(this.dataset.bubbleSector)" style="position:relative;padding:8px 10px;cursor:pointer;overflow:hidden;border:0;background:transparent;width:100%;text-align:left;color:inherit;font:inherit;">
        <div style="position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--border-light);pointer-events:none;"></div>
        <div style="position:absolute;left:0;bottom:0;height:3px;width:${Math.min(100, pct)}%;background:${c};pointer-events:none;"></div>
        <div style="position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;pointer-events:none;">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
            <span style="width:8px;height:8px;border-radius:3px;background:${c};flex-shrink:0;"></span>
            <span style="font-family:'Noto Sans KR','Manrope',sans-serif;font-size:.76rem;font-weight:700;color:${textPrimary};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${safeSec}</span>
          </div>
          <div style="display:flex;align-items:baseline;gap:8px;flex-shrink:0;">
            <span style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:.8rem;font-weight:800;color:${textPrimary};letter-spacing:0;">${pctStr}%</span>
          </div>
        </div>
        <div style="position:relative;font-family:'Manrope','Noto Sans KR',sans-serif;font-size:.65rem;color:${headerColor};margin-top:2px;letter-spacing:0;pointer-events:none;">${fmtKRW(val)}</div>
      </button>
      ${detailHtml}
      </div>
    `);
  });
  html.push(`</div>`);
  tbl.innerHTML = html.join('');

  // 드릴 상태 동기화 (컨텍스트 변경 후 leaves 패널 컨텐츠 재생성)
  if (_bubbleDrilledSector) {
    _applyBubbleDrillState(true);
  } else {
    _applyBubbleDrillState(false);
  }
}

// 우측 종목 패널 — 특정 섹터 내 leaf 종목들을 비중 큰 순으로 노출 (스크롤 없이 자동 압축)
function _renderBubbleLeavesPanel(sector, itemsAug, isDark, returnHtml = false) {
  const tbl = document.getElementById('bubble-leaves-table');
  if (!tbl && !returnHtml) return;
  const inSector = (itemsAug || []).filter(x => x.sector === sector);
  const secTotal = inSector.reduce((s, x) => s + x.val, 0) || 1;
  inSector.sort((a, b) => b.val - a.val);

  const accent = _bubbleSectorColor(sector);
  const headerColor = 'var(--t3)';
  const rowBg = 'var(--inner-bg)';
  const rowBorder = 'var(--border-light)';
  const textPrimary = 'var(--t1)';
  const fmtKRW = (v) => '₩' + Math.round(v).toLocaleString('ko-KR');

  // 행 수에 따라 패딩/폰트 자동 압축 — 스크롤 없이 모두 보이게
  const n = inSector.length;
  const compact = n > 14;
  const veryCompact = n > 22;
  const padY = veryCompact ? 3 : compact ? 5 : 7;
  const fontSize = veryCompact ? .68 : compact ? .72 : .76;
  const subSize = veryCompact ? .58 : compact ? .62 : .65;
  const gap = veryCompact ? 2 : compact ? 3 : 4;

  const html = [
    `<div class="bubble-inline-leaves" style="padding:4px 8px 9px;border-top:1px solid ${rowBorder};">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:2px 2px 7px;">
      <div style="font-family:'Noto Sans KR','Manrope',sans-serif;font-size:.66rem;letter-spacing:.08em;color:${headerColor};font-weight:700;">${_cfEsc(sector)}</div>
      <button type="button" data-bubble-sector="${_cfEsc(sector)}" onclick="handleBubbleSectorClick(this.dataset.bubbleSector)" style="font-family:'Noto Sans KR','Manrope',sans-serif;font-size:.66rem;color:${accent};cursor:pointer;font-weight:700;border:0;background:transparent;padding:4px;">닫기</button>
    </div>`,
    `<div style="display:flex;flex-direction:column;gap:${gap}px;">`
  ];
  inSector.forEach((x) => {
    const i = x.raw;
    const val = x.val;
    const pctSec = (val / secTotal * 100);
    const pctStr = pctSec >= 10 ? pctSec.toFixed(1) : pctSec.toFixed(2);
    const name = _cfEsc(_bubbleLeafLabel(i));
    const tkr = normTkr(i.tkr);
    const sub = (tkr && tkr !== _bubbleLeafLabel(i)) ? _cfEsc(tkr) : '';
    html.push(`
      <div style="position:relative;padding:${padY}px 10px;border-radius:6px;background:${rowBg};border:1px solid ${rowBorder};overflow:hidden;">
        <div style="position:relative;display:flex;align-items:center;justify-content:space-between;gap:6px;">
          <div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1;">
            <span style="width:6px;height:6px;border-radius:2px;background:${accent};flex-shrink:0;"></span>
            <span style="font-size:${fontSize}rem;font-weight:600;color:${textPrimary};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}${sub ? ` <span style=\"opacity:.55;font-weight:500;\">${sub}</span>` : ''}</span>
          </div>
          <span style="font-size:${fontSize}rem;font-weight:700;color:${textPrimary};flex-shrink:0;">${pctStr}%</span>
        </div>
        <div style="position:relative;font-size:${subSize}rem;color:${headerColor};margin-top:1px;letter-spacing:.3px;">${fmtKRW(val)}</div>
      </div>
    `);
  });
  html.push(`</div></div>`);
  const out = html.join('');
  if (returnHtml) return out;
  tbl.innerHTML = out;
}

// 드릴 ON/OFF 시 패널 폭/투명도 토글 — CSS transition 으로 슬라이드 애니메이션
function _applyBubbleDrillState(drilled) {
  const lp = document.getElementById('bubble-leaves-panel');
  const lt = document.getElementById('bubble-leaves-table');
  const centerEl = document.getElementById('bubble-center-summary');
  if (!lp) return;

  // 트랜지션 중 center label 을 숨김:
  // sunburst-container 가 flex 트랜지션으로 좁아지는 동안 left:50% 가 먼저 이동하고
  // Plotly 차트는 resize() 전까지 옛 위치에 머물러 둘이 따로 움직여 보이는 문제 방지.
  if (centerEl) { centerEl.style.transition = 'none'; centerEl.style.opacity = '0'; }

  if (drilled) {
    lp.style.flexBasis = '0';
    lp.style.maxWidth = '0';
    lp.style.padding = '0';
    if (lt) requestAnimationFrame(() => { lt.style.opacity = '1'; });
  } else {
    if (lt) lt.style.opacity = '0';
    lp.style.flexBasis = '0';
    lp.style.maxWidth = '0';
    lp.style.padding = '0';
  }
  // Plotly 차트가 영역 변화에 맞춰 re-layout 되도록 트리거
  // resize 완료 후 center label 위치 재계산 및 페이드인
  setTimeout(() => {
    try {
      if (typeof Plotly !== 'undefined') {
        const c = document.getElementById('sunburst-container');
        if (c) {
          Plotly.Plots.resize(c);
          // resize 후 한 프레임 뒤에 재배치 (Plotly가 새 크기로 layout 반영한 뒤)
          requestAnimationFrame(() => _repositionBubbleCenter(c));
          setTimeout(() => _repositionBubbleCenter(c), 120);
        }
      }
    } catch (e) {}
    if (centerEl) {
      centerEl.style.transition = 'opacity .2s ease';
      centerEl.style.opacity = '1';
    }
  }, 380);
}

// 섹터 행 클릭 핸들러 — 같은 섹터 재클릭 시 닫기, 그 외 새로 열기
window.handleBubbleSectorClick = function(sector) {
  if (!sector) return;
  if (_bubbleDrilledSector === sector) {
    _bubbleDrilledSector = null;
  } else {
    _bubbleDrilledSector = sector;
  }
  if (_bubbleLastCtx) {
    _renderBubbleSectorTable(_bubbleLastCtx.itemsAug, _bubbleLastCtx.totalVal, _bubbleLastCtx.isDark);
  }
};

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
    el.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10000;background:#EF4444;color:#fff;padding:11px 18px;border-radius:10px;font-size:.85rem;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.28);max-width:90vw;text-align:center;transition:opacity .3s';
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
  const res=await setKV('assets',pfolioData);
  const ok=!!(res&&res.result==='OK');
  if(ok) console.log('KV 저장 성공'); else showSaveError();
  if(typeof finMarkFresh==='function') finMarkFresh('assets','투자자산 원장','Vercel KV',ok,ok?`${pfolioData.length}개 항목 저장`:`저장 실패${res?.status?' ('+res.status+')':''}`);
  return {ok,status:res?.status||null};
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
  const allowedCurrencies=new Set(['KRW','USD','JPY']);
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
      dcaLastExec:_isStoredDateKey(raw.dcaLastExec)?String(raw.dcaLastExec):'',
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
    // curP가 0이면 avgP로 초기화
    if ((i.curP == null || i.curP <= 0) && i.avgP > 0) i.curP = i.avgP;
  });
  return normalized;
}
function showKvLoadError(message,source='general'){
  let banner=document.getElementById('kv-error-banner');
  if(!banner){
    banner=document.createElement('div');
    banner.id='kv-error-banner';
    banner.style.cssText='position:fixed;top:0;left:0;right:0;z-index:9999;background:#EF4444;color:#fff;text-align:center;font-size:.85rem;font-weight:600;';
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
    clearKvLoadError('assets');
    changeOwner(currentOwner,null,true);
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
        changeOwner(currentOwner, null, true);
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
function toKrCode6(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().toUpperCase().replace(/\.(KS|KQ)$/i, '');
  if (KR_CODE_RE.test(s)) return s;                           // 이미 6자리 알파뉴메릭
  if (/^\d+$/.test(s) && s.length > 0 && s.length < 6) {      // 숫자 1~5자리 → zero-pad
    return s.padStart(6, '0');
  }
  return null;
}

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
    try { changeOwner(currentOwner, null, true); } catch (_) {}
  }
  return fixed;
}

/**
 * 네이버 금융 스크래핑 API(/api/stock-price)로 국내 주식/ETF 실시간 가격 반영.
 *   - 숫자 뿐 아니라 알파뉴메릭 6자리 코드(예: 0117V0) 도 지원.
 *   - 최대 N건씩 묶어 호출하여 서버 부하 방지.
 *   - 성공 티커만 curP를 갱신하고 _priceStale=false 로 마킹.
 *   - 기존 liveRefresh()가 실패한 경우에도 이 함수가 폴백/보완 역할 수행.
 */
async function liveRefreshDomesticEtfs() {
  const items = pfolioData.filter(_isDomesticEquity);
  const tickers = Array.from(new Set(
    items
      .map(i => String(i.tkr || '').replace(/\.(KS|KQ)$/i, '').toUpperCase())
      .filter(t => KR_CODE_RE.test(t))
  ));
  if (tickers.length === 0) return {ok:true,skipped:true,updated:0,attempted:0,stale:0};
  // 네이버 과요청 방지: 10개씩 청크
  const CHUNK = 10;
  const chunks = [];
  for (let i = 0; i < tickers.length; i += CHUNK) {
    chunks.push(tickers.slice(i, i + CHUNK));
  }

  const updatedTickers=new Set();
  for (const chunk of chunks) {
    try {
      const resp = await authFetch(`/api/stock-price?tickers=${chunk.join(',')}`);
      if (!resp.ok) continue;
      const data = await resp.json();
      const result = (data && data.result) || {};
      pfolioData.forEach(i => {
        if (!_isDomesticEquity(i)) return;
        const t6 = String(i.tkr || '').replace(/\.(KS|KQ)$/i, '').toUpperCase();
        const q = result[t6];
        if (q && q.success && q.price > 0) {
          // 장 마감 후에도 안정값을 유지하기 위해 prevClose 가 있으면 그것을 사용,
          // 없으면 price (현재가) 사용
          i.curP = q.prevClose || q.price;
          i._priceStale = false;
          // 네이버 pair(price=현재가/당일종가, prevClose=전일종가)로 일간 변동 갱신
          // — curP가 안정값(전일종가)이라 curP-prevP 방식으로는 0이 되므로 별도 저장
          i.prevP = q.prevClose || null;
          i.dayP = (q.price && q.prevClose) ? q.price - q.prevClose : null;
          updatedTickers.add(t6);
        }
      });
    } catch (e) {
      console.warn('[DomesticEtfLive] chunk error:', e && e.message);
    }
  }

  if (updatedTickers.size > 0) {
    try { changeOwner(currentOwner, null, true); } catch (_) {}
    try { renderPortFxPanel && renderPortFxPanel(); } catch (_) {}
    console.log(`[DomesticEtfLive] ${updatedTickers.size}종목 실시간 가격 반영 완료`);
  }
  const stale=items.filter(i=>i&&i._priceStale).length;
  return {ok:updatedTickers.size===tickers.length,updated:updatedTickers.size,attempted:tickers.length,stale};
}

// 주 시세 API와 국내 보완 소스를 한 번의 최종 결과로 합친다.
async function refreshMarketPrices(){
  const primary=await liveRefresh();
  const domestic=await liveRefreshDomesticEtfs();
  const marketItems=(pfolioData||[]).filter(i=>i&&(i.grp==='주식'||i.grp==='가상화폐'));
  const stale=marketItems.filter(i=>i._priceStale).length;
  const hasForeign=marketItems.some(i=>!_isDomesticEquity(i));
  const primaryResponded=!primary?.error;
  const domesticCoversAll=marketItems.length>0&&!hasForeign&&marketItems.every(i=>KR_CODE_RE.test(String(i.tkr||'').replace(/\.(KS|KQ)$/i,'').toUpperCase()));
  const ok=stale===0&&(primaryResponded||(domesticCoversAll&&domestic?.ok===true));
  const result={ok,stale,primary,domestic,detail:ok?'등록 자산 최신 상태':(stale?`${stale}개 최신 확인 필요`:(primary?.error||'시세 조회 실패'))};
  if(typeof finMarkFresh==='function') finMarkFresh('prices','시장 시세','시장별 시세 API',ok,result.detail);
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
    const tkr6 = i.tkr.replace(/\.(KS|KQ)$/, '');
    const q = qmap[i.tkr] || qmap[tkr6];
    if (q && q.price !== '미조회' && typeof q.price === 'number') {
      if (!i.curP || i._priceStale) {
        i.curP = q.price;
        i._priceStale = false;
        updated = true;
      }
    }
  });
  if (updated) {
    syncDivHistory();
    changeOwner(currentOwner, null, true);
  }
}

// Python API의 dps도 TS API와 동일하게 '연간 DPS'다. 회당 eps로 정규화해
// 월/분기 배당을 지급 횟수만큼 다시 곱하는 과대계상을 막는다.
function _normalizePyDividendInfo(tkr,info,existing) {
  existing=existing||{};
  if(!info||info.dps==='미조회') return null;
  const cleanMonths=list=>[...new Set((Array.isArray(list)?list:[])
    .map(Number).filter(m=>Number.isInteger(m)&&m>=0&&m<12))];
  let cycle=info.cycle||existing.cycle||'-';
  let months=cleanMonths(info.months);
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
    payDay:typeof info.payDay==='number'?info.payDay:(existing.payDay||null)
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
      for (const chunk of _chunkTickers(krTickers)) {
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
      for (const chunk of _chunkTickers(foreignTickers)) {
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
  try { if (typeof changeOwner === 'function') changeOwner(currentOwner, null, true); } catch(_){}
  try { if (typeof renderCashFlow === 'function') renderCashFlow(); } catch(_){}
  try { if (typeof renderFamilyView === 'function') renderFamilyView(); } catch(_){}
  try { if (typeof renderDivCoverage === 'function') renderDivCoverage(); } catch(_){}
  try { if (typeof renderDivTable === 'function') renderDivTable(window.activeMainDivMonth); } catch(_){}
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
      .map(i => i.tkr.replace(/\.(KS|KQ)$/,''))
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
  const _todayKey = `${_today.getFullYear()}-${(_today.getMonth()+1).toString().padStart(2,'0')}-${_today.getDate().toString().padStart(2,'0')}`;
  const _dayKey = (d) => `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;

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
    const step = Math.max(1, Math.floor(n/6));
    const indices = [];
    for (let i=0;i<n;i+=step) indices.push(i);
    if (indices[indices.length-1] !== n-1) indices.push(n-1);

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
        //   서버(api/dashboard.py)의 maxDuration이 30s이고, 보유 종목이 많거나(본인)
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

      // 라인이 들어오는 대로 점진 렌더 (전부 끝날 때까지 빈 차트로 두지 않음)
      rerenderBenchmark();
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

    // 최종 차트 갱신 ('전체' 합산 라인 포함)
    rerenderBenchmark();
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
