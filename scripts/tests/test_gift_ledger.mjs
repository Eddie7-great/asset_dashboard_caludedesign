// 증여 기록장(2026-11-10): 건별 기록을 확인 기준일 이전 10년으로 더해 기존 공제 검토의 입력으로만 쓴다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = f => fs.readFileSync(new URL(f, root), 'utf8');
const cobalt = read('cobalt.js'), script = read('script.js'), ws = read('workspace-ui.css');
const pick = (src, name) => { const m = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`)); assert.ok(m, name); return m[0]; };
const plain = v => JSON.parse(JSON.stringify(v));

const ctx = vm.createContext({ window: { _giftActual: {} } });
for (const n of ['cbGiftCfg', 'cbGiftRecords', 'cbGiftWindowStart', 'cbGiftLedgerSum', 'cbGiftPrior', 'cbGiftDeductionReview']) vm.runInContext(pick(cobalt, n), ctx);

// 10년 창: 기준일의 10년 전 같은 날부터 기준일까지(양 끝 포함), 2월 29일은 28일로
assert.equal(ctx.cbGiftWindowStart('2026-11-10'), '2016-11-10');
assert.equal(ctx.cbGiftWindowStart('2024-02-29'), '2014-02-28');
const recs = [
  { id: 'a', kind: 'child', date: '2016-11-10', amt: 1_000_000 },   // 창의 첫날 — 포함
  { id: 'b', kind: 'child', date: '2016-11-09', amt: 2_000_000 },   // 하루 전 — 제외
  { id: 'c', kind: 'child', date: '2026-11-10', amt: 4_000_000 },   // 기준일 당일 — 포함
  { id: 'd', kind: 'child', date: '2026-11-11', amt: 8_000_000 },   // 기준일 뒤 — 제외
  { id: 'e', kind: 'spouse', date: '2020-01-01', amt: 100_000_000 },
];
assert.equal(ctx.cbGiftLedgerSum(recs, 'child', '2026-11-10'), 5_000_000);
assert.equal(ctx.cbGiftLedgerSum(recs, 'spouse', '2026-11-10'), 100_000_000, '종류를 섞지 않는다');
assert.equal(ctx.cbGiftLedgerSum(recs, 'child', ''), null, '기준일이 없으면 합계를 만들지 않는다');
assert.equal(ctx.cbGiftLedgerSum([], 'child', '2026-11-10'), 0);

// 기록이 없으면 손으로 적은 합계를 그대로 쓴다
ctx.window._giftActual = { childPrior: { confirmed: true, asOf: '2026-11-10', amount: 7_000_000, amountKnown: true } };
let prior = ctx.cbGiftPrior('child');
assert.equal(prior.amount, 7_000_000); assert.equal(prior.fromLedger, undefined);
// 기록이 있으면 기록 합계가 우선하고, 저장된 수기 값은 지우지 않는다
ctx.window._giftActual.records = recs;
prior = ctx.cbGiftPrior('child');
assert.deepEqual(plain(prior), { confirmed: true, asOf: '2026-11-10', amount: 5_000_000, amountKnown: true, fromLedger: true, count: 4 });
assert.equal(ctx.window._giftActual.childPrior.amount, 7_000_000);
// 기존 공제 검토가 그 합계를 그대로 받는다 — 확인 체크·기준일이 없으면 여전히 판정 보류
let review = ctx.cbGiftDeductionReview(prior, 10_000_000, 20_000_000);
assert.equal(review.ready, true); assert.equal(review.total, 15_000_000); assert.equal(review.remaining, 5_000_000);
prior = ctx.cbGiftPrior('spouse');
assert.equal(prior.amountKnown, false, '기준일을 정하지 않으면 합계를 확정하지 않는다');
assert.equal(ctx.cbGiftDeductionReview(prior, 1, 600_000_000).ready, false);
ctx.window._giftActual.childPrior.confirmed = false;
assert.equal(ctx.cbGiftDeductionReview(ctx.cbGiftPrior('child'), 1, 20_000_000).ready, false, '기록이 있어도 사용자의 확인 체크는 그대로 필요');
// 최신순 정렬
assert.deepEqual(plain(ctx.cbGiftRecords('child').map(r => r.id)), ['d', 'c', 'a', 'b']);

// 저장 정규화: 형식이 틀린 행은 버리고 500건까지
const nctx = vm.createContext({});
vm.runInContext("const _STORED_TEXT_LIMIT=500;", nctx);
for (const n of ['_boundedStoredText', '_safeStoredNumber', '_isStoredDateKey', '_safeStoredToken', '_normalizeGiftActual']) vm.runInContext(pick(script, n), nctx);
const norm = plain(nctx._normalizeGiftActual({ records: [
  { id: 'ok-1', kind: 'child', date: '2024-03-02', amt: 5000000.4, memo: '<b>이체</b>' },
  { id: 'bad id!', kind: 'spouse', date: '2022-06-15', amt: 100 },
  { kind: 'child', date: '2024-13-40', amt: 100 }, { kind: 'child', date: '2024-01-01', amt: 0 },
  { kind: 'other', date: '2024-01-01', amt: 100 }, null, 'x',
] }));
assert.deepEqual(norm.records, [
  { id: 'ok-1', kind: 'child', date: '2024-03-02', amt: 5000000, memo: 'b 이체 /b' },
  { id: 'gift-1', kind: 'spouse', date: '2022-06-15', amt: 100, memo: '' },
]);
assert.deepEqual(plain(nctx._normalizeGiftActual({})).records, [], '예전 저장값에는 빈 기록장');
assert.equal(plain(nctx._normalizeGiftActual({ records: Array.from({ length: 600 }, (_, i) => ({ id: 'r' + i, kind: 'child', date: '2024-01-01', amt: 1 })) })).records.length, 500);

// 화면·안전장치
const add = pick(cobalt, 'cbGiftAddRecord'), del = pick(cobalt, 'cbGiftDelRecord'), html = pick(cobalt, 'cbGiftLedgerHtml');
assert.match(add, /isMobileLayout\(\)\) return;/, '모바일은 조회 전용');
assert.match(add, /date>finLocalDateKey\(new Date\(\)\)/, '미래 날짜는 기록이 아니다');
assert.match(del, /findIndex\(r=>r&&String\(r\.id\)===String\(id\)\)/, '삭제는 배열 순번이 아니라 id 로');
assert.match(html, /finMobileNote\('증여 기록'\)/);
assert.match(html, /cbEsc\(r\.memo\|\|'—'\)/, '메모는 이스케이프');
assert.match(html, /증여일마다의 10년 기간을 각각 판정하지 않으며/);
assert.match(ws, /@media\(max-width:768px\)\{\.cb-gift-ledger-form,\.cb-gift-ledger-row>:last-child\{display:none\}/);
assert.match(script, /targetAlloc:window\._targetAlloc\|\|null,balanceSheet:window\._balanceSheet\|\|null,giftActual:window\._giftActual\|\|null/, '저장 실패 되돌리기가 기록장을 포함');
assert.match(cobalt, /\$\{cbGiftLedgerHtml\(giftScope\)\}/, '소유주 탭의 당사자 범위를 따른다');
console.log('PASS 증여 기록장');
