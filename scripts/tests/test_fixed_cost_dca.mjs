// 고정비 관리의 적립식 매수 묶음(2026-11-18 4차, 사용자 결정: 별도 묶음) — 고정비 합계에 넣지 않고, 현금 안전판과 같은 대상·금액.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readSource } from './_source.mjs'

const root = new URL('../../', import.meta.url);
const read = (f) => readSource(f);
const script = read('script.js'), cobalt = read('cobalt.js'), finance = read('finance.js'), html = read('index.html'), css = read('workspace-ui.css');
function grab(src, name) {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} 없음`);
  let i = src.indexOf('{', src.indexOf(')', at)), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(at, i + 1);
}

const pfolioData = [
  { owner: '본인', name: '엔비디아', tkr: 'NVDA', dca: true, dcaCycle: '매주', dcaDays: [1], dcaAmt: 200000, dcaCur: 'KRW' },
  { owner: '본인', name: 'QQQ', tkr: 'QQQ', dca: true, dcaCycle: '매월', dcaDay: 25, dcaAmt: 500000, dcaCur: 'KRW' },
  { owner: '본인', name: 'SCHD', tkr: 'SCHD', dca: false, dcaCycle: '매월', dcaDay: 10, dcaAmt: 300000, dcaCur: 'KRW' },
  { owner: '아내', name: 'TIME', tkr: '426030', dca: true, dcaCycle: '매월', dcaDay: 15, dcaAmt: 100, dcaCur: 'USD' },
  { owner: '아내', name: '애플', tkr: 'AAPL', dca: false },
];
const ctx = vm.createContext({ pfolioData, cbRate: (c) => (c === 'USD' ? 1400 : 1), _cfEsc: (v) => String(v),
  cbOwnerTag: (o) => `<i>${o}</i>`, window: { _balanceSheet: { cashTargetMonths: 6 } } });
for (const n of ['cbDcaPerMonthKRW', 'cbDcaDayLabel', 'cbDcaRuleLabel']) vm.runInContext(grab(cobalt, n), ctx);
for (const n of ['dcaHasRule', 'dcaState', '_fixedCostDcaGroup', '_fixedCostDcaHtml']) vm.runInContext(grab(script, n), ctx);

const all = ctx._fixedCostDcaGroup('전체');
assert.deepEqual(all.rows.map((r) => r.name), ['엔비디아', 'QQQ', 'TIME'], '켜 둔 규칙만, 월 환산 큰 순');
assert.equal(all.rows[0].monthly, 200000 * 4.33, '매주는 4.33주');
assert.equal(all.rows[0].label, '매주 월요일');
assert.equal(all.paused, undefined, '중단한 규칙은 세지도 적지도 않는다(2026-11-20 8차)');
assert.equal(all.total, 200000 * 4.33 + 500000 + 140000);
assert.deepEqual(ctx._fixedCostDcaGroup('아내').rows.map((r) => r.name), ['TIME'], '소유주 필터');

// 현금 안전판의 dca 와 같은 대상·금액(켜 둔 규칙의 cbDcaPerMonthKRW 합)
const safety = grab(finance, 'finCashSafety');
assert.match(safety, /const dca=\(pfolioData\|\|\[\]\)\.filter\(i=>i&&i\.dca&&\(!ownerF\|\|i\.owner===ownerF\)\)\.reduce\(\(s,i\)=>s\+\(typeof cbDcaPerMonthKRW==='function'\?cbDcaPerMonthKRW\(i\):0\),0\);/);
const safetyDca = pfolioData.filter((i) => i.dca).reduce((s, i) => s + ctx.cbDcaPerMonthKRW(i), 0);
assert.equal(all.total, safetyDca);

const out = ctx._fixedCostDcaHtml(all, 1);
assert.match(out, /적립식 매수 <small>고정비와 별도<\/small>/);
assert.match(out, /onclick="switchView\('holdings'\)">보유 목록에서 수정 ›<\/button>/, '조회 전용 — 수정은 보유 목록');
assert.doesNotMatch(out, /일시정지|중단/, '중단한 규칙은 드러내지 않는다');
assert.ok(out.indexOf('cf-fixed-dca-total') < out.indexOf('cf-fixed-dca-list') && out.indexOf('cf-fixed-dca-head') < out.indexOf('cf-fixed-dca-total'), '합계는 제목 바로 아래, 종목 목록보다 먼저(사용자 결정)');
assert.match(out, /'저축\/투자' 자동이체가 1건/, '증권계좌 이체와 겹칠 수 있다는 안내');
assert.doesNotMatch(ctx._fixedCostDcaHtml(all, 0), /cf-fixed-dca-warn/);

// 고정비 합계(월 고정비 카드·분포·비율)에는 넣지 않는다 — 카드 아래 한 줄로만 '+ 적립식 = 합계'
const render = grab(script, 'renderFixedCostView');
assert.match(render, /const monthly=included\.reduce\(\(sum,at\)=>sum\+_autoTransferMonthlyEquivalent\(at,y,m\),0\);/);
assert.match(render, /`\+ 적립식 ₩\$\{Math\.round\(dcaGroup\.total\)\.toLocaleString\(\)\} = ₩\$\{Math\.round\(monthly\+dcaGroup\.total\)\.toLocaleString\(\)\}`/);
assert.match(render, /_fixedCostDistributionHtml\(included,y,m\)/, '분포는 고정비만');
assert.match(html, /<div id="cf-fixed-monthly-note" class="cf-fixed-summary-note">등록된 고정비 합계<\/div><div id="cf-fixed-dca-sum" class="cf-fixed-summary-note" hidden><\/div>/);
assert.match(html, /<div class="cf-fixed-side">\s*<div class="glass-panel cf-fixed-dist-panel">[\s\S]*?<div class="glass-panel cf-fixed-dca-panel" id="cf-fixed-dca" hidden><\/div>\s*<\/div>/, '분포 카드 아래');
assert.match(css, /\.cf-fixed-side\{display:flex;flex-direction:column;gap:10px;min-width:0;min-height:0;overflow-y:auto\}/, '넘치면 오른쪽 열이 스크롤 — 분포 범례를 자르지 않는다');
assert.match(css, /\.cf-fixed-dca-link\{[^}]*color:var\(--acc\)/, '버튼 글자색을 준다(다크에서 검정이 되지 않게)');

console.log('PASS 고정비 관리 적립식 묶음');
