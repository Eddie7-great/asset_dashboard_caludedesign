// 고정비 관리의 적립식 매수(2026-11-24 사용자 결정) — 부부(본인·아내) 적립식만 고정비 내역·합계·분포·비율에 넣는다.
// 자녀1·아버지는 뺀다(자녀1 은 증여 이체로 산다). 금액은 켜 둔 규칙의 월 환산 그대로, 월 필수지출(finMonthlyFixedCost)에는 넣지 않는다.
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
  { owner: '자녀1', name: 'TIGER 미국S&P500', tkr: '360750', dca: true, dcaCycle: '매월', dcaDay: 2, dcaAmt: 200000, dcaCur: 'KRW' },
  { owner: '아버지', name: 'NAVER', tkr: '035420', dca: true, dcaCycle: '매월', dcaDay: 20, dcaAmt: 100000, dcaCur: 'KRW' },
];
const ctx = vm.createContext({ pfolioData, CF_OWNERS: ['본인', '아내'], ownerColors: {}, cbRate: (c) => (c === 'USD' ? 1400 : 1), _cfEsc: (v) => String(v),
  cbOwnerTag: (o) => `<i>${o}</i>`, window: { _balanceSheet: { cashTargetMonths: 6 } } });
for (const n of ['cbDcaPerMonthKRW', 'cbDcaDayLabel', 'cbDcaRuleLabel']) vm.runInContext(grab(cobalt, n), ctx);
for (const n of ['dcaHasRule', 'dcaState', '_fixedCostDcaGroup', '_fixedCostDcaRowHtml']) vm.runInContext(grab(script, n), ctx);

const all = ctx._fixedCostDcaGroup('전체');
assert.deepEqual(all.rows.map((r) => r.name), ['엔비디아', 'QQQ', 'TIME'], '켜 둔 규칙만, 월 환산 큰 순');
assert.equal(all.rows[0].monthly, 200000 * 4.33, '매주는 4.33주');
assert.equal(all.rows[0].label, '매주 월요일');
assert.equal(all.paused, undefined, '중단한 규칙은 세지도 적지도 않는다(2026-11-20 8차)');
assert.equal(all.total, 200000 * 4.33 + 500000 + 140000);
assert.deepEqual(ctx._fixedCostDcaGroup('아내').rows.map((r) => r.name), ['TIME'], '소유주 필터');
assert.deepEqual(ctx._fixedCostDcaGroup('자녀1').rows.map((r) => r.name), ['TIGER 미국S&P500'], '자녀1 탭으로 직접 고르면 그 사람 것');
assert.ok(!all.rows.some((r) => r.owner === '자녀1' || r.owner === '아버지'), '부부 합계에는 자녀1·아버지 적립식을 넣지 않는다(자녀1 은 증여 이체로 산다)');
assert.equal(all.rows[0].idx, 0, '수정 창을 열 원래 행 번호');

const row = ctx._fixedCostDcaRowHtml(all.rows[0]);
assert.match(row, /<td class="text-left cf-fixed-secondary">적립식<\/td>/, '카테고리 칸은 적립식');
assert.match(row, /onclick="cbDcaEdit\(0\)"/, '✎ 는 같은 적립식 설정 창');
assert.match(row, /₩866,000<\/td>/, '월 환산액');

// 월 고정비 = 고정비 + 부부 적립식. 분포·연간·수입 대비 비율이 같은 합계를 쓴다.
const render = grab(script, 'renderFixedCostView');
assert.match(render, /const monthly=fixedMonthly\+dcaGroup\.total;/);
assert.match(render, /_fixedCostDistributionHtml\(included,y,m,dcaGroup\.total\)/, '분포에 적립식 한 칸');
assert.match(render, /dcaGroup\.rows\.map\(_fixedCostDcaRowHtml\)/, '표에 적립식 줄');
assert.match(render, /그중 적립식 ₩/, '카드 아래 한 줄: 그중 적립식');
assert.match(render, /중복 주의/, "'저축/투자' 고정비와 겹칠 수 있다는 표식");
assert.match(render, /includes\(at\.cat\)&&!_autoTransferIsGift\(at\)\)\.length/, '증여 이체는 겹침 대상이 아니다(자녀 적립식은 합계에 없다)');
assert.doesNotMatch(grab(finance, 'finMonthlyFixedCost'), /cbDcaPerMonthKRW|_fixedCostDcaGroup/, '월 필수지출(현금 안전판)에는 넣지 않는다');
const dist = grab(script, '_fixedCostDistribution');
assert.match(dist, /if \(dcaTotal > 0\) byCat\.set\('적립식'/);
assert.match(html, /<div class="cf-fixed-summary-notes"><div id="cf-fixed-monthly-note" class="cf-fixed-summary-note">등록된 고정비 합계<\/div><div id="cf-fixed-dca-sum" class="cf-fixed-summary-note cf-fixed-dca-sum" hidden><\/div><\/div>/, '부부 합계와 적립식 금액은 한 줄에 나란히');
assert.doesNotMatch(html, /id="cf-fixed-dca"/, '따로 두던 적립식 묶음 카드는 없앴다 — 표의 줄이 대신한다');
assert.match(css, /\.cf-fixed-side\{display:flex;flex-direction:column;gap:10px;min-width:0;min-height:0;overflow-y:auto\}/, '넘치면 오른쪽 열이 스크롤 — 분포 범례를 자르지 않는다');
assert.match(read('pages/dca.js'), /view-cashflow'\)\?\.classList\.contains\('active'\)&&typeof renderFixedCostView==='function'\) renderFixedCostView\(\)/, '설정 창 저장 뒤 고정비 화면도 다시 그린다');

console.log('PASS 고정비 관리 적립식 포함');
