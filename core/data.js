// core/data.js — 기본 데이터 — 환율 시드·통화 정의·소유주·종목 목록 같은 상수
// (2026-11-23 script.js 에서 그대로 옮겨 나눈 조각. 로드 순서는 index.html·scripts/tests/_source.mjs)
// =============================================
// DATA
// =============================================
const RATES = { USD: 1380, JPY: 9.2, AUD: 900, KRW: 1 };

// 지원 통화의 단일 출처 — 기호·현금 소수 자릿수·예수금 선택지를 여기서만 정의한다.
// 예전에는 `cur==='USD'?'$':(cur==='JPY'?'¥':'₩')` 같은 3항 분기가 여러 파일에 흩어져 있어
// 통화를 하나 늘릴 때마다 국기·기호·소수점 중 몇 군데를 반드시 빠뜨렸다.
// AUD 처럼 환율이 없을 수 있는 통화는 rate 를 1 로 대체하지 않는다 — cbRate/RATES 참조부가
// 조용히 1:1 로 환산해 평가액이 수백 배 어긋나기 때문이다(_priceStale 로 드러낸다).
const CURRENCY_META = {
  KRW: { symbol: '₩',  cashDecimals: 0, label: '₩ KRW',  flag: 'KR' },
  USD: { symbol: '$',  cashDecimals: 2, label: '$ USD',  flag: 'US' },
  JPY: { symbol: '¥',  cashDecimals: 0, label: '¥ JPY',  flag: 'JP' },
  AUD: { symbol: 'A$', cashDecimals: 2, label: 'A$ AUD', flag: 'AU' },
};
const CASH_CURRENCIES = Object.keys(CURRENCY_META);
function curMeta(cur){ return CURRENCY_META[String(cur||'').toUpperCase()] || CURRENCY_META.KRW; }
function curSymbol(cur){ return curMeta(cur).symbol; }
// 환율을 실제로 아는 통화인지 — 모르면 평가액을 만들지 않고 호출부가 stale 로 표시한다.
function curRateKnown(cur){
  const c = String(cur||'KRW').toUpperCase();
  if (c === 'KRW') return true;
  return Number.isFinite(RATES[c]) && RATES[c] > 0;
}

// 원화 환산 환율·종목 가격 표기도 여기 하나만 쓴다. RATES 는 지원 통화마다 시드값이 있어(조회 실패에도 지우지 않는다)
// 호출부가 `||1380` 같은 숫자를 따로 들고 있을 이유가 없고, USD/JPY 만 분기하면 호주달러가 1:1 로 환산된다.
// HTML 이스케이프는 여기 하나다. _cfEsc·holdingsEsc(script.js)·cbEsc(cobalt.js)는 이름만 남긴 별칭이다
// — 같은 치환식을 네 군데 두면 한 곳만 고쳐져도 그 화면에서만 태그가 살아난다.
function escHtml(value){
  return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function curRate(cur){
  const c = String(cur||'KRW').toUpperCase();
  if (c === 'KRW') return 1;
  return Number.isFinite(RATES[c]) && RATES[c] > 0 ? RATES[c] : 1;
}
// ── 종목 한 줄의 원화 금액 — 단일 출처(2026-11-25 숫자 일관성 점검) ──
// 보유 목록·홈·구성원별·계좌별·비중 지도·섹터·리스크·ETF·결산·순자산 기록·벤치마크 가중치가 모두 이것만 쓴다
// (cobalt.js 의 cbValKRW·cbCostKRW·cbGainKRW·cbAvgNative 는 이름만 남긴 별칭). 배치는 scripts/net_worth_snapshot.py 의
// asset_value_krw·report_cost_krw 가 같은 식이고 test_net_worth_snapshot.py 가 대조한다.
// 예전 보유 목록·비중 지도는 금을 '수량 × 단위 배수 × (1g 시세 || curP)'로 따로 셌다 — curP 는 이미 단위당 원화라
//   금 시세를 못 받은 날엔 '돈' 단위 금이 3.75배(kg 은 1000배)로 부풀었다. 가상화폐·금·현금은 원화 단가를 먼저
//   반올림한 뒤 수량을 곱해 수량이 많은 코인은 수천 원씩 다른 화면과 어긋났다. 반올림은 표시할 때만 한다.
// 가상화폐(cur=USD)는 현재가는 USD, 평단가는 원화(1,000만 이상) 또는 USD(1,000만 미만)로 저장된다 — 종목 통화로 맞춘다.
const CRYPTO_KRW_AVG_THRESHOLD = 10000000;
function assetAvgNative(i){
  const avg = Number(i && i.avgP) || 0;
  if (i && i.grp==='가상화폐' && String(i.cur||'').toUpperCase()==='USD' && avg>=CRYPTO_KRW_AVG_THRESHOLD) return avg / curRate('USD');
  return avg;
}
function assetValueKRW(i){ return (Number(i && i.qty)||0) * (Number(i && i.curP)||0) * curRate(i && i.cur); }
function assetCostKRW(i){ return !i || i.costUnknown ? 0 : (Number(i.qty)||0) * assetAvgNative(i) * curRate(i.cur); }
function assetGainKRW(i){ return !i || i.grp==='현금' || i.costUnknown ? 0 : assetValueKRW(i) - assetCostKRW(i); }
// 짧은 금액 표기 — 한 벌(2026-11-25). 배당 막대 위 금액·현금 흐름 구성 목록이 같은 모양을 쓴다.
// 1억 이상 '1억 2,500만', 100만 이상 '1,234만', 1만 이상 '26.5만'(소수 한 자리), 그 밖 '8,000원'.
// 예전엔 배당 화면(cbDivShortWon)과 현금 흐름(cfShortWon)이 따로 있어 같은 26.5만 원이 '26.5만'·'27만'으로 달리 보였다.
// 그래프 눈금은 눈금 간격에 맞추는 cbAmtAxisLab(pages/tax.js) — 목적이 다르므로 따로 둔다.
function shortWon(v){
  const n = Number(v)||0, a = Math.abs(n), sign = n<0 ? '−' : '';
  if (a >= 1e8) {
    const e = Math.floor(a/1e8), m = Math.round((a - e*1e8)/1e4);
    if (m >= 10000) return sign + (e+1) + '억';
    return sign + e + '억' + (m ? ' ' + m.toLocaleString('ko-KR') + '만' : '');
  }
  if (a >= 1e6) return sign + Math.round(a/1e4).toLocaleString('ko-KR') + '만';
  if (a >= 1e4) return sign + (Math.round(a/1e3)/10).toLocaleString('ko-KR') + '만';
  return sign + Math.round(a).toLocaleString('ko-KR') + '원';
}
function fmtPriceNative(price, cur){
  const meta = curMeta(cur), d = meta.cashDecimals;
  return meta.symbol + (Number(price)||0).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});
}

function _taxRuleValue(path, fallback, when) {
  return typeof assetTaxRuleValue === 'function'
    ? assetTaxRuleValue(path, fallback, when)
    : fallback;
}


// 공유용 금액 가리기 — 동적으로 다시 그려지는 화면과 툴팁 속 통화 금액까지 마스킹한다.
const AMOUNT_PRIVACY_KEY = 'asset-dashboard-amount-privacy';
let _amountPrivacyEnabled = false;
let _amountPrivacyObserver = null;
let _amountPrivacyMutating = false;
const _amountPrivacyTextOriginal = new WeakMap();
const _amountPrivacyAttrOriginal = new WeakMap();
const _amountPrivacyChartState = new WeakMap();

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
  // '원' 없이 만·억 단위로 줄여 쓴 금액(타일 '+1,755만', 그래프 눈금 '2,000만'·'3.6억'·'+250만')도 가린다.
  // 단위 뒤에 한글이 이어지면(만기·억제 등) 금액이 아니므로 건드리지 않는다.
  out = out.replace(/([+\-−]?\s*)\d[\d,]*(?:\.\d+)?(\s*(?:억|천만|백만|만))(?![가-힣])/g, (match, lead, unit) => {
    const spacing = (lead.match(/^\s*/) || [''])[0];
    const sign = /[-−]/.test(lead) ? '−' : (/\+/.test(lead) ? '+' : '');
    return spacing + sign + '••••' + unit.trim();
  });
  return out;
}
function _maskAmountAttributes(el){
  if (!el || el.nodeType !== 1 || el.closest?.('[data-privacy-exempt]')) return;
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
      } else if (node.nodeType === 3 && !node.parentElement?.closest?.('[data-privacy-exempt]') && !/^(SCRIPT|STYLE|TEXTAREA|OPTION)$/.test(node.parentElement?.tagName || '')) {
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


let pfolioData = []; // KV(Upstash)에서 loadAssetsFromKV()로 로드됩니다

// 자산 내역 증권사·계좌 필터 ('전체' 또는 인코딩된 broker/acc 조합)
let _holdingsBrokerFilter = '전체';
const _BROKER_ACC_SEP = ''; // broker/acc 값에 쓰이지 않는 구분자

function getFilteredAssets(owner) {
  return filterByOwner(pfolioData, owner);
}

// 기본 팔레트 — 소유주/차트 색상
const ownerColors = {'전체':'#7d8799','본인':'#2a78d6','아내':'#eb6834','자녀1':'#1baf7a','아버지':'#b844a6'};
// 소유주 색은 모든 화면이 이 한 벌을 쓴다(성과 그래프 포함). 성과 그래프의 비교 지수는 회색이라 소유주 색과 겹치지 않는다.
// 예전 BENCH_OWNER_COLORS 는 성과 그래프에서만 아내·자녀1 색을 바꿔 화면마다 색이 달랐다 — 다시 만들지 않는다.

// 소유주 목록 (단일 소스). OWNERS = 실제 소유주 4인, ALL_OWNERS = '전체' 포함
const OWNERS = ['본인','아내','자녀1','아버지'];
const ALL_OWNERS = ['전체', ...OWNERS];

// 배당 주기 → 연간 지급 횟수 / 주기 라벨 / 요일 라벨 (단일 소스)
const CYCLE_COUNT = {'월배당':12,'분기':4,'반기':2,'연간':1,'-':1};
const CYCLE_LABEL = {daily:'매일',weekly:'매주',monthly:'매월','month-end':'매월말','month-start':'매월초',quarterly:'분기',yearly:'매년'};
const DOW_LABELS = ['일','월','화','수','목','금','토'];

// 공용 헬퍼 (중복 통합)
// 소유주 필터: '전체'/미지정이면 원본 그대로, 아니면 owner 일치 항목만
function filterByOwner(items, owner){
  if (!owner || owner === '전체') return items;
  return items.filter(i => (i.owner || '본인') === owner);
}
// 원화 전체 자릿수 표기: 1234567.8 → "₩1,234,568" (보유 표의 평가금액 칸)
function fmtMoney(v){
  return '₩' + Math.round(v||0).toLocaleString();
}
// 손익 계산: { profit, pct }
function calcProfit(cur, inv){ const p = cur - inv; return { profit: p, pct: inv > 0 ? (p/inv)*100 : 0 }; }
// 시세·배당 응답 매칭 키: 앞뒤 공백 제거 + 대문자. 서버(api/price.ts)가 요청 티커를 이렇게
// 바꿔 응답 키로 쓰므로, 저장된 티커(`bmnu`, ` NVDA`)를 그대로 찾으면 가격을 받고도
// '미조회'가 된다. 이름이 같으면 대소문자·공백과 무관하게 같은 종목이다.
const quoteKey = t => String(t==null?'':t).trim().toUpperCase();
// 티커 정규화: 대문자화 + .KS/.KQ 접미사 제거
const normTkr = t => quoteKey(t).replace(/\.(KS|KQ)$/i, '');
// 배당 캐시는 화면(Cobalt cbStrip)과 동일하게 한국·일본 거래소 접미사를 제거해 조회한다.
// API 요청 심볼은 .T를 유지해야 Yahoo가 일본 종목을 찾으므로 요청 목록에는 normDivTkr를 쓰지 않는다.
const normDivTkr = t => quoteKey(t).replace(/\.(KS|KQ|T)$/i, '');
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
// 보유 주식 중 이번 조회에서 실제 응답을 받은 티커 범위. 무배당 종목은
// _divDataCache에 행이 생기지 않으므로 데이터 키 수만으로 조회 완결성을 판단하면 안 된다.
window._divFetchCoverage = window._divFetchCoverage || {
  date:'', total:0, verified:[], missing:[], status:'idle', error:''
};

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

// 특정 연도·소유주의 월별 배당(12칸)을 안전하게 읽는 접근자. divHistory 를 직접 인덱싱하면
// 연도·소유주 키가 없을 때 undefined 가 새므로 새 코드는 이것을 쓴다(CLAUDE.md 규칙).
// 레거시 배당 차트가 사라지면서 현재 호출부는 없지만, 규칙이 가리키는 진입점이라 남겨둔다.
function divHistoryOf(year, owner){
  const y = String(year || new Date().getFullYear());
  return ((divHistory[y] || {})[owner]) || Array(12).fill(0);
}

function _emptyDivHistory(){
  const o = {};
  divHistoryYears().forEach(y=>{ o[y] = {}; });
  return o;
}
let divHistory = _emptyDivHistory();
