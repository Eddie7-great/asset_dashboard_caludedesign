// 증여 기록장(2026-11-10): 건별 기록을 확인 기준일 이전 10년으로 더해 기존 공제 검토의 입력으로만 쓴다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readSource } from './_source.mjs'

const root = new URL('../../', import.meta.url);
const read = f => readSource(f);
const cobalt = read('cobalt.js'), script = read('script.js'), ws = read('workspace-ui.css');
const pick = (src, name) => { const m = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`)); assert.ok(m, name); return m[0]; };
const plain = v => JSON.parse(JSON.stringify(v));

const ctx = vm.createContext({ window: { _giftActual: {} } });
for (const n of ['cbGiftCfg', 'cbGiftRecords', 'cbGiftTransferRecords', 'cbGiftWindowStart', 'cbGiftLedgerSum', 'cbGiftPrior', 'cbGiftDeductionReview']) vm.runInContext(pick(cobalt, n), ctx);

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
const yearsSrc = pick(cobalt, 'cbGiftLedgerYearsHtml');
assert.match(html, /cbGiftLedgerYearsHtml\(rows,LABEL,inWindow,today\)/, '기록장 표는 연도 묶음으로');
assert.match(yearsSrc, /cbEsc\(r\.memo\|\|'—'\)/, '메모는 이스케이프');
// 연도 묶음: 올해만 펼치고, 같은 자동이체가 한 해에 만든 줄은 한 줄(합계·횟수)로 접는다.
{
  const yctx = vm.createContext({ _cbGiftYearOpen: {}, cbEsc: s => String(s).replace(/</g, '&lt;'), cbKrw: n => '₩' + Number(n).toLocaleString('en-US') });
  vm.runInContext(yearsSrc, yctx);
  const rows = [
    { id: 'at-1-2026-03-25', kind: 'child', date: '2026-03-25', amt: 100000, memo: '[자동이체] 적금', auto: true, atId: 1 },
    { id: 'm1', kind: 'child', date: '2026-02-01', amt: 500000, memo: '<b>' },
    { id: 'at-1-2026-02-25', kind: 'child', date: '2026-02-25', amt: 100000, memo: '[자동이체] 적금', auto: true, atId: 1 },
    { id: 'at-1-2026-01-25', kind: 'child', date: '2026-01-25', amt: 100000, memo: '[자동이체] 적금', auto: true, atId: 1 },
    { id: 'm0', kind: 'child', date: '2025-05-01', amt: 300000, memo: '' },
  ].sort((a, b) => b.date.localeCompare(a.date));
  const out = yctx.cbGiftLedgerYearsHtml(rows, { child: '자녀 증여' }, () => true, '2026-11-23');
  assert.match(out, /<details class="cb-gift-year" open[^>]*><summary><span>2026년<\/span><b class="cb-num">₩800,000<\/b><small>4건<\/small>/, '올해는 펼치고 합계·건수를 먼저');
  assert.match(out, /<details class="cb-gift-year" ontoggle[^>]*><summary><span>2025년/, '지난 해는 접는다');
  assert.equal((out.match(/is-auto/g) || []).length, 1, '같은 자동이체 3건은 한 줄');
  assert.match(out, /01-25 ~ 03-25<\/span><span>자녀 증여<\/span><b class="cb-num">₩300,000<\/b>[\s\S]*?· 3회/, '묶은 줄은 기간·합계·횟수');
  assert.match(out, /&lt;b>/, '손으로 적은 메모 이스케이프');
}
assert.match(html, /증여일마다의 10년 기간을 각각 판정하지 않으며/);
assert.match(ws, /@media\(max-width:768px\)\{\.cb-gift-ledger-form,\.cb-gift-ledger-row>:last-child\{display:none\}/);
assert.match(script, /targetAlloc:window\._targetAlloc\|\|null,balanceSheet:window\._balanceSheet\|\|null,giftActual:window\._giftActual\|\|null/, '저장 실패 되돌리기가 기록장을 포함');
assert.match(cobalt, /\$\{cbGiftLedgerHtml\(giftScope\)\}/, '소유주 탭의 당사자 범위를 따른다');

// 2026-11-18 3차: 증여로 연결한 자동이체는 이체일마다 기록장에 자동 기록(저장하지 않음 · giftFrom 이후 · 오늘까지)
{
  const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  Object.assign(ctx, {
    finLocalDateKey: key,
    _autoTransferOccursOn: (at, d) => d.getDate() === at.dayOfMonth,
    _effectiveAutoTransferAmt: at => at.amt,
  });
  vm.runInContext("var autoTransferData=[{id:7,type:'지출',owner:'본인',desc:'자녀1 증권계좌',amt:300000,dayOfMonth:5,startMonth:'2026-01',giftKind:'child',giftFrom:'2026-08'},{id:8,type:'지출',desc:'관리비',amt:200000,dayOfMonth:5,startMonth:'2026-01'},{id:9,type:'수입',desc:'용돈',amt:1,dayOfMonth:5,giftKind:'child',giftFrom:'2026-01'}];", ctx);
  const auto = plain(ctx.cbGiftTransferRecords('2026-11-10'));
  assert.deepEqual(auto.map(r => r.date), ['2026-08-05', '2026-09-05', '2026-10-05', '2026-11-05'], 'giftFrom 이후 · 기준일까지의 이체일만 · 증여로 연결한 지출만');
  assert.ok(auto.every(r => r.kind === 'child' && r.amt === 300000 && r.auto === true && r.memo === '[자동이체] 자녀1 증권계좌'));
  ctx.window._giftActual = { records: [], childPrior: { confirmed: true, asOf: '2026-11-10' } };
  const p2 = ctx.cbGiftPrior('child');
  assert.equal(p2.fromLedger, true, '연결한 자동이체가 있으면 기록장 합계로 판정 입력');
  assert.equal(p2.amount, ctx.cbGiftLedgerSum(plain(ctx.cbGiftRecords('child')), 'child', '2026-11-10'));
  assert.equal(ctx.window._giftActual.records.length, 0, '자동 기록은 저장하지 않는다(연결을 끊으면 사라진다)');
  vm.runInContext("autoTransferData[0].giftFrom='2025-11';", ctx);
  assert.equal(plain(ctx.cbGiftTransferRecords('2026-01-10'))[0].date, '2025-11-05', '앱 등록 달(startMonth 2026-01)보다 앞선 시작 월을 고르면 그때부터 센다 — 실제 이체가 먼저 시작됐을 수 있다')
  assert.match(cobalt, /aria-label="증여 시작 연도"[\s\S]*aria-label="증여 시작 월"/, '시작 월은 연도·월 선택 목록(월 달력 입력은 직접 입력·과거 이동이 어렵다)')
  assert.doesNotMatch(cobalt, /cb-gift-link-from">부터<input type="month"/)
  assert.match(script, /giftKind:item\.giftKind==='child'\|\|item\.giftKind==='spouse'\?item\.giftKind:''/, '자동이체 저장값이 증여 연결을 지킨다');
  assert.match(cobalt, /if\(!r\.auto\)\{ lines\.push\(\{date:r\.date,html:manualRow\(r\)\}\)[\s\S]*?const autoRow=[\s\S]*?<em class="cb-gift-auto-tag"|const autoRow=[\s\S]*?<em class="cb-gift-auto-tag"[\s\S]*?if\(!r\.auto\)\{ lines\.push\(\{date:r\.date,html:manualRow\(r\)\}\)/, '자동 기록은 삭제 버튼 대신 자동 표시(손으로 적은 기록만 삭제 버튼)');
}
// 2026-11-18 4차: 증여 기록 → 현금 흐름 연동
{
  vm.runInContext(pick(cobalt, 'cbGiftSyncCashflow'), ctx);
  vm.runInContext("var cfData=[{date:'2025-12-05',type:'지출',cat:'저축/투자',desc:'[자동] 자녀1 증권계좌',amt:300000,owner:'본인',isAuto:true,atId:7,scheduleMonth:'2025-12'}];var cfDeletedKeys=['auto:7:2025-11'];var saved=0;function saveCfData(){saved++;}function _getCycleLabel(){return '매월 5일';}", ctx);
  vm.runInContext("autoTransferData[0].giftFrom='2025-10';autoTransferData[0].cat='저축/투자';", ctx);
  ctx.window._giftActual = { records: [{ id: 'r1', kind: 'spouse', date: '2025-07-01', amt: 5_000_000, memo: '생일' }] };
  assert.equal(ctx.cbGiftSyncCashflow(), true);
  const cf = plain(vm.runInContext('cfData', ctx));
  const auto7 = cf.filter(c => c.atId === 7).map(c => c.date).sort();
  const now = new Date(), want = []
  for (let d = new Date(2025, 9, 5, 12); d <= now; d.setMonth(d.getMonth() + 1)) { const k = ctx.finLocalDateKey(d); if (!k.startsWith('2025-11')) want.push(k) }
  assert.deepEqual(auto7, want, '빠진 달만 채우고(2025-11 은 사용자가 지운 달이라 제외), 이미 있는 2025-12 줄은 그대로')
  assert.equal(cf.filter(c => c.atId === 7 && c.date.startsWith('2025-12')).length, 1, '이미 있는 달은 두 줄이 되지 않는다');
  assert.ok(cf.filter(c => c.giftBackfill).every(c => c.isAuto && c.desc === '[자동] 자녀1 증권계좌' && c.cat === '저축/투자'), '채운 줄은 자동이체 줄과 같은 모양');
  const rec = cf.find(c => c.giftRecId === 'r1');
  assert.ok(rec && rec.amt === 5_000_000 && rec.date === '2025-07-01' && rec.type === '지출' && rec.owner === '본인' && rec.cat === '저축/투자', '손으로 적은 기록은 지출 한 줄');
  assert.equal(ctx.cbGiftSyncCashflow(), false, '두 번 불러도 같은 줄을 또 만들지 않는다');
  ctx.window._giftActual.records = [];
  vm.runInContext("delete autoTransferData[0].giftKind;", ctx);
  assert.equal(ctx.cbGiftSyncCashflow(), true);
  const after = plain(vm.runInContext('cfData', ctx));
  assert.deepEqual(after.map(c => c.date), ['2025-12-05'], '연결을 끊고 기록을 지우면 채운 줄만 사라지고 원래 현금 흐름 줄은 남는다');
  assert.match(script, /if\(item\.giftBackfill===true\)row\.giftBackfill=true;/, '현금 흐름 저장값이 연동 표식을 지킨다');
}
// 2026-11-23: 연결 목록은 '증여 이체'로 표시한 지출 자동이체만 보여 준다(관리비 같은 일반 지출이 섞이지 않게)
{
  const html = read('index.html');
  const g = vm.createContext({ cbOwnerTag: o => `<i>${o}</i>`, cbEsc: v => String(v), cbKrw: n => '₩' + n, cbGiftFromPicker: () => '<span>from</span>' });
  for (const n of ['_autoTransferIsGift', '_setAutoTransferGift']) vm.runInContext(pick(script, n), g);
  vm.runInContext(pick(cobalt, 'cbGiftTransferLinkHtml'), g);
  vm.runInContext("var autoTransferData=[{id:1,type:'지출',desc:'자녀1 계좌',amt:1,giftKind:'child',giftFrom:'2026-01'},{id:2,type:'지출',desc:'아내 계좌',amt:1,isGift:true},{id:3,type:'지출',desc:'관리비',amt:1},{id:4,type:'수입',desc:'용돈',amt:1,isGift:true}];", g);
  const out = g.cbGiftTransferLinkHtml(['child', 'spouse']);
  assert.match(out, /자녀1 계좌/, '예전에 연결한 것(giftKind)은 표식이 없어도 나온다');
  assert.match(out, /아내 계좌/, "'증여 이체' 표식이 있는 지출은 나온다");
  assert.doesNotMatch(out, /관리비/, '표식이 없는 지출은 나오지 않는다');
  assert.doesNotMatch(out, /용돈/, '수입은 증여 이체가 아니다');
  assert.equal((out.match(/class="cb-gift-link-row/g) || []).length, 2);
  vm.runInContext('autoTransferData=[{id:3,type:"지출",desc:"관리비",amt:1}];', g);
  assert.match(g.cbGiftTransferLinkHtml(['child']), /증여 이체로 표시한 자동이체가 없습니다[\s\S]*'증여 이체'에 체크/, '없으면 표시하는 방법을 안내한다');
  // 표식을 끄면 연결도 함께 푼다 — 목록에서 사라진 이체가 기록장에 계속 더해지지 않게
  const at = { type: '지출', isGift: true, giftKind: 'child', giftFrom: '2026-01' };
  g._setAutoTransferGift(at, false);
  assert.deepEqual(plain(at), { type: '지출' });
  g._setAutoTransferGift(at, true); assert.equal(at.isGift, true);
  const inc = { type: '수입' }; g._setAutoTransferGift(inc, true); assert.equal(inc.isGift, undefined, '수입에는 붙이지 않는다');
  // 등록 폼 두 곳 + 고정비 표 버튼 + 저장값 정리
  // 2026-11-26: 월별 화면의 자동이체 등록은 기록 창(－ 지출 › 자동이체 (매달))으로 옮겼다
  assert.match(pick(script, 'cfEntryFieldsHtml'), /<input type="checkbox" id="cf-e-gift"> 증여 이체<\/label>/, '자동이체 기록 창의 증여 이체 체크');
  assert.match(pick(script, 'cfEntrySave'), /addAutoTransfer\(\{type:'지출'[\s\S]*isGift:!!document\.getElementById\('cf-e-gift'\)\?\.checked\}\)/, '체크 값을 그대로 넘긴다');
  assert.match(html, /<input type="checkbox" id="cf-fixed-gift"> 증여 이체<\/label>\s*<button id="cf-fixed-submit"/, '고정비 등록 폼의 증여 이체 체크');
  assert.match(pick(script, 'addAutoTransfer'), /const isGift = type==='지출' && !!v\.isGift;[\s\S]*if \(isGift\) at\.isGift = true;/, '수입에는 붙이지 않는다');
  assert.match(pick(script, 'submitFixedCost'), /_setAutoTransferGift\(existing,isGift\);[\s\S]*if\(isGift\) row\.isGift=true;/);
  assert.doesNotMatch(script, /toggleAutoTransferGift|cf-fixed-gift-btn/, "2026-11-24: 고정비 표의 '증여' 켜고 끄기 버튼은 없앴다 — 등록·수정 폼의 체크로 붙이고 뗀다");
  assert.match(pick(script, 'renderFixedCostView'), /const giftTag=_autoTransferIsGift\(at\)\?'<span class="cf-fixed-state is-gift"[^']*>증여<\/span>':'';/, '증여 이체 줄에만 작은 표식');
  assert.match(script, /isGift:item\.type!=='수입'&&\(item\.isGift===true\|\|item\.giftKind==='child'\|\|item\.giftKind==='spouse'\),/, '저장값 정리가 표식을 지킨다');
  assert.match(pick(script, 'editFixedCost'), /o\.dataset\.temp='1'/, "목록에 없는 카테고리('저축/투자')를 수정하다 '기타'로 바꾸지 않는다");
}
// 2026-11-23: '증여 한눈에' 표 — 값은 cbGiftPrior·cbGiftDeductionReview 그대로, 판정 보류면 남은 공제·초과를 쓰지 않는다
{
  const sctx = vm.createContext({ cbOwnerTag: o => `<i>${o}</i>`, cbEsc: v => String(v), cbKrw: n => '₩' + Math.round(n).toLocaleString('en-US') });
  vm.runInContext(pick(cobalt, 'cbGiftSummaryRowHtml'), sctx); vm.runInContext(pick(cobalt, 'cbGiftSummaryHtml'), sctx);
  vm.runInContext(pick(cobalt, 'cbGiftDeductionReview'), sctx);
  const prior = { confirmed: true, asOf: '2026-11-23', amount: 10_500_000, amountKnown: true, fromLedger: true, count: 35 };
  const ready = sctx.cbGiftSummaryRowHtml({ kind: 'child', owner: '자녀1', title: '자녀 증여', sub: 's', limit: 20_000_000, limitNote: '미성년', prior, review: sctx.cbGiftDeductionReview(prior, 15_534_263, 20_000_000), planned: 15_534_263 });
  assert.match(ready, /₩10,500,000<\/b><small>기록장 35건 · 기준일 11-23/);
  assert.match(ready, /남은 공제<\/span><b class="cb-num">₩9,500,000<\/b><small>한도의 47\.5% 남음/);
  assert.match(ready, /is-warn">계획대로면 ₩6,034,263 초과/, '초과 금액은 cbGiftDeductionReview 의 excess');
  assert.match(ready, /is-plan is-over/, '한도를 넘는 계획 부분은 경고 빗금');
  assert.match(ready, /onclick="cbGiftTab\('child'\)"/, '줄을 누르면 그 탭');
  const hold = { confirmed: false, asOf: '', amount: 0, amountKnown: false, fromLedger: true, count: 1 };
  const held = sctx.cbGiftSummaryRowHtml({ kind: 'spouse', owner: '아내', title: '부부 증여', sub: 's', limit: 600_000_000, prior: hold, review: sctx.cbGiftDeductionReview(hold, 100_000_000, 600_000_000), planned: 100_000_000 });
  assert.match(held, /<b class="is-hold">판정 보류<\/b>/);
  assert.doesNotMatch(held, /남음<\/small>|초과/, '판정 보류면 남은 공제·초과를 쓰지 않는다');
  assert.match(held, /기준일 미정/);
  assert.equal(sctx.cbGiftSummaryHtml([]), '', '당사자가 아니면 표를 그리지 않는다');
  assert.match(cobalt, /if \(typeof _cbGiftTab!=='undefined'\) _cbGiftTab='child';/, '화면을 옮기면 탭을 되돌린다');
  assert.doesNotMatch(cobalt, /cb-gift-ledger-sums/, '기록장의 10년 합계 카드는 한눈에 표로 옮겼다(같은 합계를 세 번 보이지 않는다)');
}
console.log('PASS 증여 기록장');
