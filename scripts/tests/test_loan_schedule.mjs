// 대출 상환 조건(2026-11-18 4차) — 원리금균등·원금균등·만기일시 납입액, 금액 단일 출처 위임, 정규화, 고정비 폼 저장.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readSource } from './_source.mjs'

const root = new URL('../../', import.meta.url);
const read = (f) => readSource(f);
const script = read('script.js'), html = read('index.html'), css = read('workspace-ui.css');

// 함수 본문을 중괄호 짝으로 잘라 온다(한 줄짜리 함수도 된다)
function grab(name) {
  const at = script.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} 없음`);
  let i = script.indexOf('{', script.indexOf(')', at)), depth = 0;
  for (; i < script.length; i++) {
    if (script[i] === '{') depth++;
    else if (script[i] === '}' && --depth === 0) break;
  }
  return script.slice(at, i + 1);
}
const constLine = (name) => script.match(new RegExp(`^const ${name}=.*$`, 'm'))[0];
const plain = (v) => JSON.parse(JSON.stringify(v));

const ctx = vm.createContext({ console });
vm.runInContext([constLine('LOAN_METHOD_LABEL'), constLine('_loanScheduleCache')].join('\n').replace(/^const /gm, 'var '), ctx);
for (const n of ['_safeStoredNumber', '_isStoredDateKey', '_loanMonthIndex', '_loanYm', 'loanSchedule', 'loanPaymentFor', 'loanStatusFor',
  '_normalizeLoanTerms', '_effectiveAutoTransferAmt', '_loanYmKo', '_loanStatusText']) vm.runInContext(grab(n), ctx);

// ── 원리금균등: 1억, 연 5%, 12개월 — 매달 ₩8,560,748(마지막 달은 남은 원금을 털어 ₩8,560,751)
{
  const rows = ctx.loanSchedule({ method: 'annuity', principal: 100_000_000, rate: 5, months: 12, start: '2026-01' });
  assert.equal(rows.length, 12);
  assert.deepEqual(plain(rows[0]), { month: '2026-01', payment: 8_560_748, interest: 416_667, principal: 8_144_081, balance: 91_855_919 });
  assert.deepEqual(plain(rows[1]), { month: '2026-02', payment: 8_560_748, interest: 382_733, principal: 8_178_015, balance: 83_677_904 });
  assert.equal(rows[11].month, '2026-12'); assert.equal(rows[11].payment, 8_560_751); assert.equal(rows[11].balance, 0);
  assert.equal(rows.reduce((s, r) => s + r.principal, 0), 100_000_000, '원금 합 = 대출 원금');
}
// ── 원금균등: 1.2억, 연 3.6%, 120개월 — 매달 원금 100만 + 줄어드는 이자
{
  const rows = ctx.loanSchedule({ method: 'principal', principal: 120_000_000, rate: 3.6, months: 120, start: '2025-11' });
  assert.equal(rows[0].payment, 1_360_000); assert.equal(rows[0].interest, 360_000);
  assert.equal(rows[1].payment, 1_357_000, '잔액이 줄어 이자가 3,000원 준다');
  assert.equal(rows[119].payment, 1_003_000); assert.equal(rows[119].month, '2035-10'); assert.equal(rows[119].balance, 0);
  assert.equal(rows.reduce((s, r) => s + r.principal, 0), 120_000_000);
}
// ── 만기일시: 5천만, 연 6%, 12개월 — 매달 이자만 25만, 마지막 달 원금 + 이자
{
  const rows = ctx.loanSchedule({ method: 'bullet', principal: 50_000_000, rate: 6, months: 12, start: '2026-06' });
  assert.ok(rows.slice(0, 11).every((r) => r.payment === 250_000 && r.principal === 0));
  assert.equal(rows[11].payment, 50_250_000); assert.equal(rows[11].balance, 0);
}
// ── 금리 0%·원리금균등 = 원금 ÷ 기간
assert.ok(ctx.loanSchedule({ method: 'annuity', principal: 12_000_000, rate: 0, months: 12, start: '2026-01' }).every((r) => r.payment === 1_000_000));
// ── 잘못된 조건은 빈 일정(지어내지 않는다)
for (const bad of [null, { principal: 0, rate: 4, months: 12, start: '2026-01' }, { principal: 1e8, rate: 4, months: 0, start: '2026-01' },
  { principal: 1e8, rate: 4, months: 12, start: '2026/01' }, { principal: 1e8, rate: -1, months: 12, start: '2026-01' }]) {
  assert.equal(ctx.loanSchedule(bad).length, 0);
}

// ── 그 달 납입액: 시작 전·만기 뒤는 0, 해를 넘어도 회차가 맞는다
const loan = { method: 'principal', principal: 120_000_000, rate: 3.6, months: 120, start: '2025-11' };
assert.equal(ctx.loanPaymentFor(loan, 2025, 10), 0, '첫 납입 전');
assert.equal(ctx.loanPaymentFor(loan, 2025, 11), 1_360_000);
assert.equal(ctx.loanPaymentFor(loan, 2026, 1), 1_354_000, '세 번째 회차');
assert.equal(ctx.loanPaymentFor(loan, 2035, 11), 0, '만기 뒤');

// ── 상태: 납입 전 / 상환 중(그 달 납입 뒤 잔액·남은 횟수) / 상환 끝
assert.equal(ctx.loanStatusFor(loan, 2025, 1).phase, 'before');
const st = ctx.loanStatusFor(loan, 2026, 1);
assert.equal(st.phase, 'active'); assert.equal(st.remaining, 117); assert.equal(st.balance, 117_000_000); assert.equal(st.end, '2035-10');
assert.equal(ctx.loanStatusFor(loan, 2036, 1).phase, 'done');
assert.equal(ctx._loanStatusText(loan, 2026, 1), '원금균등 · 연 3.6% · 잔여 117개월 · 잔액 ₩117,000,000');
assert.equal(ctx._loanStatusText(loan, 2025, 1), '원금균등 · 연 3.6% · 2025년 11월 납입 시작 · 120개월');

// ── 금액의 단일 출처가 대출 조건에 위임한다(옛 금액 변경 이력보다 우선)
const at = { amt: 1_500_000, amountChanges: [{ from: '2026-01', amt: 1_700_000 }], loan };
assert.equal(ctx._effectiveAutoTransferAmt(at, 2026, 1), 1_354_000);
assert.equal(ctx._effectiveAutoTransferAmt({ amt: 1_500_000, amountChanges: [{ from: '2026-01', amt: 1_700_000 }] }, 2026, 1), 1_700_000, '대출 조건이 없으면 그대로');

// ── 정규화: 지키고, 잘못된 조건은 버린다
assert.deepEqual(plain(ctx._normalizeLoanTerms({ method: 'bullet', principal: '50000000', rate: '6', months: '12', start: '2026-06', extra: 1 })),
  { method: 'bullet', principal: 50_000_000, rate: 6, months: 12, start: '2026-06' });
assert.equal(ctx._normalizeLoanTerms({ method: 'x', principal: 1e8, rate: 4, months: 360, start: '2020-03' }).method, 'annuity', '모르는 방식은 원리금균등');
assert.equal(ctx._normalizeLoanTerms({ principal: 1e8, rate: 4, months: 0, start: '2020-03' }), null);
assert.equal(ctx._normalizeLoanTerms({ principal: 1e8, rate: 4, months: 360, start: '2020-13' }), null);
assert.match(grab('_normalizeAutoTransfers'), /loan:_normalizeLoanTerms\(item\.loan\)/);
assert.match(grab('_normalizeAutoTransfers'), /if\(!row\.loan\)delete row\.loan;/);

// ── 고정비 폼: 카테고리 '대출납입금'이면 조건 칸, 세 방식, 기간(년/개월), 첫 납입 월(연·월 목록)
assert.match(html, /<select id="cf-fixed-cat" class="form-input" onchange="toggleFixedCostLoanFields\(\)">/);
assert.match(html, /<fieldset id="cf-fixed-loan" class="cf-fixed-loan" hidden>/);
for (const [v, t] of [['annuity', '원리금균등상환'], ['principal', '원금균등상환'], ['bullet', '만기일시상환']]) assert.match(html, new RegExp(`<option value="${v}">${t}</option>`));
assert.match(html, /id="cf-fixed-loan-principal" class="form-input" type="text" inputmode="numeric"/, '원금은 쉼표가 들어가는 금액 칸');
assert.match(html, /id="cf-fixed-loan-rate" class="form-input" type="number"[^>]*data-no-comma="1"/, '금리는 비율 칸');
assert.match(html, /id="cf-fixed-loan-term-unit"[^>]*><option value="12">년<\/option><option value="1">개월<\/option>/);
assert.match(html, /<select id="cf-fixed-loan-y" class="form-input"[^>]*><\/select><select id="cf-fixed-loan-m"/, '첫 납입 월은 연도·월 선택 목록');
assert.ok(html.indexOf('id="cf-fixed-loan"') < html.indexOf('id="cf-fixed-submit"'), '조건 칸은 등록 버튼 앞');
assert.match(css, /\.cf-fixed-loan\{grid-column:1\/-1;/);
assert.match(grab('editFixedCost'), /_fixedLoanFillForm\(at\.loan\|\|null\);\s*toggleFixedCostLoanFields\(\);/, '수정하면 저장된 조건을 채운다 — 기존 대출을 다시 등록하는 길');
assert.match(grab('renderFixedCostView'), /cf-fixed-loan-note[^`]*_loanStatusText\(at\.loan,y,m\)/, '표의 그 줄 아래 방식·금리·잔여·잔액');
assert.match(grab('editAutoTransferFromMonth'), /if \(at\.loan\) \{ alert\(/, '대출 항목은 월별 금액 변경 대신 조건을 고친다');

// ── 저장: 기존 주택담보대출을 조건으로 다시 등록 — 같은 id, 만기가 종료 월, 이번 달부터의 기록만 일정 값으로
{
  const els = {
    'cf-fixed-edit-id': { value: '7' }, 'cf-fixed-owner': { value: '본인' }, 'cf-fixed-cat': { value: '대출납입금' },
    'cf-fixed-desc': { value: '주택담보대출' }, 'cf-fixed-amt': { value: '1,500,000' }, 'cf-fixed-cycle': { value: 'weekly' },
    'cf-fixed-day': { value: '25' }, 'cf-fixed-dow': { value: '0' }, 'cf-fixed-start': { value: '2025-12' },
    'cf-fixed-loan-principal': { value: '120,000,000' }, 'cf-fixed-loan-rate': { value: '3.6' }, 'cf-fixed-loan-term': { value: '10' },
    'cf-fixed-loan-term-unit': { value: '12' }, 'cf-fixed-loan-y': { value: '2025' }, 'cf-fixed-loan-m': { value: '11' },
    'cf-fixed-loan-method': { value: 'principal' },
  };
  const calls = [];
  const sctx = vm.createContext({
    console, document: { getElementById: (id) => els[id] || null }, Date: class extends Date { constructor(...a) { super(...(a.length ? a : ['2026-01-15T09:00:00'])); } },
    isMobileLayout: () => false, OWNERS: ['본인', '아내', '자녀1', '아버지'], _cfMonthKey: () => '2026-01', alert: (m) => calls.push('alert:' + m),
    saveAutoTransfers: () => calls.push('saveAT'), saveCfData: () => calls.push('saveCf'), resetFixedCostForm: () => {}, renderFixedCostView: () => {}, renderCashFlow: () => {},
    autoTransferData: [{ id: 7, owner: '본인', type: '지출', cat: '대출납입금', desc: '주담대', amt: 1_500_000, cycle: 'monthly', dayOfMonth: 25, startMonth: '2025-12', endMonth: '', amountChanges: [] }],
    cfData: [
      { date: '2025-12-25', atId: 7, isAuto: true, amt: 1_500_000 },
      { date: '2026-01-26', atId: 7, isAuto: true, amt: 1_500_000 },
      { date: '2026-01-26', atId: 8, isAuto: true, amt: 9 },
    ],
  });
  vm.runInContext([constLine('LOAN_METHOD_LABEL'), constLine('_loanScheduleCache')].join('\n').replace(/^const /gm, 'var '), sctx);
  for (const n of ['_safeStoredNumber', '_isStoredDateKey', '_loanMonthIndex', '_loanYm', 'loanSchedule', 'loanPaymentFor', '_normalizeLoanTerms', '_fixedLoanFromForm', '_setAutoTransferGift', 'submitFixedCost']) vm.runInContext(grab(n), sctx);
  vm.runInContext('submitFixedCost()', sctx);
  const saved = sctx.autoTransferData[0];
  assert.deepEqual(calls.filter((c) => c.startsWith('alert')), []);
  assert.equal(sctx.autoTransferData.length, 1, '새 줄이 아니라 같은 자동이체');
  assert.deepEqual(plain(saved.loan), { method: 'principal', principal: 120_000_000, rate: 3.6, months: 120, start: '2025-11' });
  assert.equal(saved.cycle, 'monthly', '대출은 매월');
  assert.equal(saved.endMonth, '2035-10', '만기 뒤에는 기록하지 않는다');
  assert.equal(saved.startMonth, '2025-12', '앱 시작 월은 그대로 — 지난 달 현금 흐름을 소급해 만들지 않는다');
  assert.equal(saved.amt, 1_354_000, '이번 달 납입액을 금액으로');
  assert.equal(sctx.cfData[0].amt, 1_500_000, '지난 달 기록은 그대로');
  assert.equal(sctx.cfData[1].amt, 1_354_000, '이번 달 기록은 일정 값으로');
  assert.equal(sctx.cfData[2].amt, 9, '다른 자동이체는 건드리지 않는다');
  assert.ok(calls.includes('saveCf') && calls.includes('saveAT'));

  // 원금을 비우면 조건을 지우고 그 만기로 잡아 둔 종료 월도 푼다
  els['cf-fixed-loan-principal'].value = ''; els['cf-fixed-amt'].value = '1,400,000'; els['cf-fixed-cycle'].value = 'monthly';
  vm.runInContext('submitFixedCost()', sctx);
  assert.equal(saved.loan, undefined); assert.equal(saved.endMonth, '');
  assert.deepEqual(plain(saved.amountChanges), [{ from: '2026-01', amt: 1_400_000 }]);

  // 잘못된 조건은 저장하지 않는다
  els['cf-fixed-loan-principal'].value = '1,000'; els['cf-fixed-loan-rate'].value = '';
  calls.length = 0; vm.runInContext('submitFixedCost()', sctx);
  assert.ok(calls.some((c) => c.startsWith('alert:연 금리')));
  assert.ok(!calls.includes('saveAT'));
}

console.log('PASS 대출 상환 조건');
