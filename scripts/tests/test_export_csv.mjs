// 내보내기(CSV)(2026-11-10): 화면과 같은 값을 표 파일로 내려받는다. 서버로 보내지 않고 원장을 바꾸지 않는다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const fin = fs.readFileSync(new URL('../../finance.js', import.meta.url), 'utf8');
const pick = name => { const m = fin.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`)); assert.ok(m, name); return m[0]; };
const OWNERS = ['본인', '아내', '자녀1', '아버지'];
const clicks = [], says = { textContent: '', hidden: true };
const ctx = vm.createContext({
  OWNERS, Number, Math, Array, Object, String, console: { error() {} }, setTimeout: fn => fn(),
  window: { _netWorthHistory: [{ date: '2026-11-09', portfolio: 1000.4, portfolioByOwner: { 본인: 600, 아내: 400.6 } }], _giftActual: { records: [{ date: '2024-03-02', kind: 'spouse', amt: 5000000, memo: '=SUM(A1)' }] } },
  finRows: () => [
    { name: '삼성, "전자"', val: 73500.4, cost: 76000, gain: -2500, i: { owner: '아내', grp: '주식', broker: 'A', acc: '연금저축', tkr: '005930', qty: 1, unit: '주', cur: 'KRW', curP: 73500 } },
    { name: '예수금', val: 500, cost: 500, gain: 0, i: { owner: '본인', grp: '현금', tkr: 'KRW', qty: 500, cur: 'KRW', curP: 1, _priceStale: true } },
    { name: '미상주', val: 900, cost: 0, gain: 0, i: { owner: '본인', grp: '주식', tkr: 'X', qty: 1, cur: 'USD', curP: 9, costUnknown: true } },
  ],
  cbAvgNative: i => (i.tkr === '005930' ? 76000 : 1),
  finSnapshotInvestment: e => e.portfolio, finSnapshotOwnerInvestment: (e, o) => e.portfolioByOwner[o],
  finLocalDateKey: () => '2026-11-10',
  cfData: [{ date: '2026-11-05', type: '지출', cat: '생활비', desc: '-할인\n쿠폰', amt: 82000, owner: '아내' }],
  monthlyPLData: [{ month: '2026-10', category: 'domestic', account: 'ISA', owner: '본인', amt: -120000, memo: '@memo', ruleSetId: 'kr-2026' }],
  _amountPrivacyEnabled: false,
  URL: { createObjectURL: blob => { clicks.push(blob); return 'blob:x'; }, revokeObjectURL() {} },
  Blob: class { constructor(parts, opt) { this.text = parts.join(''); this.type = opt.type; } },
  document: { getElementById: id => (id === 'fin-export-msg' ? says : null), createElement: () => ({ click() { clicks.push(this.download); }, remove() {} }), body: { appendChild() {} } },
});
for (const n of ['finCsvCell', 'finCsv', 'finTaxFilingRows', 'finExportSets', 'finExport', 'finExportPanelHtml']) vm.runInContext(pick(n), ctx);

// 칸 이스케이프: 쉼표·따옴표·줄바꿈은 따옴표로 감싸고, 수식처럼 보이는 글자는 무력화한다. 숫자(음수 포함)는 그대로
assert.equal(ctx.finCsvCell('a,b'), '"a,b"');
assert.equal(ctx.finCsvCell('말 "따옴표"'), '"말 ""따옴표"""');
assert.equal(ctx.finCsvCell('=SUM(A1)'), "'=SUM(A1)");
assert.equal(ctx.finCsvCell('+82'), "'+82"); assert.equal(ctx.finCsvCell('@x'), "'@x"); assert.equal(ctx.finCsvCell('-메모'), "'-메모");
assert.equal(ctx.finCsvCell(-2500), '-2500', '음수 금액은 숫자로 남는다');
assert.equal(ctx.finCsvCell(null), ''); assert.equal(ctx.finCsvCell(undefined), '');
const csv = ctx.finCsv(['가', '나'], [[1, 'x'], ['y', 2]]);
assert.equal(csv, '﻿가,나\r\n1,x\r\ny,2\r\n', 'BOM + CRLF');

const sets = ctx.finExportSets();
assert.deepEqual(Object.keys(sets), ['holdings', 'cashflow', 'realized', 'networth', 'gifts', 'taxFiling']);
assert.deepEqual(JSON.parse(JSON.stringify(sets.taxFiling.rows())), [], '세금 계산 함수가 없으면 빈 표(지어내지 않는다)');
const h = JSON.parse(JSON.stringify(sets.holdings.rows()));
assert.equal(sets.holdings.header.length, h[0].length, '머리글과 칸 수가 같다');
assert.deepEqual(h[0], ['아내', '주식', 'A', '연금저축', '삼성, "전자"', '005930', 1, '주', 'KRW', 76000, 73500, 73500, 76000, -2500, '정상']);
assert.equal(h[1][13], '', '현금은 손익을 쓰지 않는다'); assert.equal(h[1][14], '미조회');
assert.deepEqual([h[2][9], h[2][12], h[2][13]], ['', '', ''], '취득가 미상은 0 이 아니라 빈칸');
assert.deepEqual(JSON.parse(JSON.stringify(sets.realized.rows())), [['2026-10', '국내', 'ISA', '본인', -120000, '@memo', 'kr-2026']]);
assert.deepEqual(JSON.parse(JSON.stringify(sets.networth.rows())), [['2026-11-09', 1000, 600, 401, '', '']], '기록이 없는 소유주는 빈칸');
assert.deepEqual(JSON.parse(JSON.stringify(sets.gifts.rows())), [['2024-03-02', '부부 증여', 5000000, '=SUM(A1)']]);
for (const set of Object.values(sets)) set.rows().forEach(r => assert.equal(r.length, set.header.length));

// 내려받기: 파일 이름에 날짜, 금액 가리기 중에는 차단
ctx.finExport('cashflow');
assert.equal(clicks[1], 'asset-dashboard-cashflow-2026-11-10.csv');
assert.equal(clicks[0].type, 'text/csv;charset=utf-8');
assert.equal(clicks[0].text, '﻿날짜,구분,분류,내용,금액(원),소유주\r\n2026-11-05,지출,생활비,"\'-할인\n쿠폰",82000,아내\r\n');
assert.match(says.textContent, /현금 흐름 기록 1건을/);
clicks.length = 0;
vm.runInContext('_amountPrivacyEnabled=true', ctx);
ctx.finExport('holdings');
assert.equal(clicks.length, 0, '금액 가리기 중에는 파일을 만들지 않는다');
assert.match(says.textContent, /금액 가리기를 켠 동안에는 내보낼 수 없습니다/);
vm.runInContext('_amountPrivacyEnabled=false;cfData=[]', ctx);
ctx.finExport('cashflow');
assert.equal(clicks.length, 0); assert.match(says.textContent, /내보낼 기록이 없습니다/);
assert.match(ctx.finExportPanelHtml(), /onclick="finExport\('cashflow'\)" disabled>현금 흐름 기록 <span>0건<\/span>/, '빈 묶음은 버튼을 끈다');

const exportSrc = pick('finExport') + pick('finExportSets');
assert.doesNotMatch(exportSrc, /fetch\(|setKV|saveExtDataToKV|saveAssetsToKV|localStorage/, '서버로 보내거나 저장하지 않는다');
assert.match(fin, /주문 전 증권사 시세를 확인하세요\.<\/p><\/div><\/div><\/div>\$\{finExportPanelHtml\(\)\}`;/, '데이터 상태 화면 하단');
// 양도세 확인표(2026-11-25) — 세금 화면과 같은 cbTaxSummary 로 소유주·연도별 합계를 낸다. 일반 계좌 해외 기록만.
const taxSrc = fs.readFileSync(new URL('../../pages/tax.js', import.meta.url), 'utf8');
const pickTax = name => { const m = taxSrc.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`)); assert.ok(m, name); return m[0]; };
const taxCtx = vm.createContext({
  OWNERS, Number, Math, Array, Object, String, Map, Set,
  _taxRuleValue: (path, fallback) => (path === 'dependent.basicDeductionIncomeLimitKrw' ? 1000000 : fallback),
});
vm.runInContext("const CB_TAX_ACCTS=['일반','연금저축','ISA']; const CB_TAX_FGN_DED=2500000; const CB_TAX_ISA_DED=2000000; const CB_TAX_DEPENDENT_OWNERS=['자녀1'];", taxCtx);
vm.runInContext(pickTax('cbTaxAcctOf') + '\n' + pickTax('cbTaxSummary'), taxCtx);
vm.runInContext(pick('finTaxFilingRows'), taxCtx);
const filing = JSON.parse(JSON.stringify(taxCtx.finTaxFilingRows([
  { month: '2026-07', category: 'foreign', account: '일반', owner: '본인', amt: -500000, memo: '' },
  { month: '2026-03', category: 'foreign', account: '', owner: '본인', amt: 3500000, memo: 'AAPL' },
  { month: '2026-05', category: 'domestic', account: '일반', owner: '본인', amt: 9999 },
  { month: '2026-06', category: 'foreign', account: 'ISA', owner: '본인', amt: 7777 },
  { month: '2026-04', category: 'foreign', account: '일반', owner: '자녀1', amt: 1200000, memo: 'QQQ' },
  { month: '2025-12', category: 'foreign', account: '일반', owner: '아내', amt: 100000, memo: 'MSFT' },
])));
assert.deepEqual(filing, [
  ['2026', '본인', '해외 매도', '2026-03', '일반', 'AAPL', 3500000, ''],
  ['2026', '본인', '해외 매도', '2026-07', '일반', '', -500000, ''],
  ['2026', '본인', '해외 실현손익 합계', '', '', '', 3000000, ''],
  ['2026', '본인', '기본공제(1인)', '', '', '', 2500000, '사람마다 따로 적용'],
  ['2026', '본인', '과세표준', '', '', '', 500000, '합계 − 기본공제, 0 미만은 0'],
  ['2026', '본인', '예상 세액(지방세 포함)', '', '', '', 110000, '세율 22% · 앱 기록 기준 추정'],
  ['2026', '자녀1', '해외 매도', '2026-04', '일반', 'QQQ', 1200000, ''],
  ['2026', '자녀1', '해외 실현손익 합계', '', '', '', 1200000, ''],
  ['2026', '자녀1', '기본공제(1인)', '', '', '', 2500000, '사람마다 따로 적용'],
  ['2026', '자녀1', '과세표준', '', '', '', 0, '합계 − 기본공제, 0 미만은 0'],
  ['2026', '자녀1', '예상 세액(지방세 포함)', '', '', '', 0, '세율 22% · 앱 기록 기준 추정'],
  ['2026', '자녀1', '부양가족 소득금액 확인', '', '', '', 1200000, '기준 1,000,000원 — 넘으면 본인 연말정산 부양가족 공제에서 빠질 수 있음'],
  ['2025', '아내', '해외 매도', '2025-12', '일반', 'MSFT', 100000, ''],
  ['2025', '아내', '해외 실현손익 합계', '', '', '', 100000, ''],
  ['2025', '아내', '기본공제(1인)', '', '', '', 2500000, '사람마다 따로 적용'],
  ['2025', '아내', '과세표준', '', '', '', 0, '합계 − 기본공제, 0 미만은 0'],
  ['2025', '아내', '예상 세액(지방세 포함)', '', '', '', 0, '세율 22% · 앱 기록 기준 추정'],
], '최근 연도 먼저 · 소유주 순서 · 국내·ISA 기록은 빼고 세금 화면과 같은 합계');
const taxSummaryCheck = taxCtx.cbTaxSummary([{ month: '2026-03', category: 'foreign', account: '일반', owner: '본인', amt: 3000000 }], null, [], '2026-12');
assert.equal(taxSummaryCheck.buckets[0].genDue, 110000, '확인표의 세액은 세금 화면 cbTaxSummary 값 그대로');
assert.match(fin, /taxFiling:\{label:'양도세 확인표'[\s\S]*?count:rows=>rows\.filter\(r=>r\[2\]==='해외 매도'\)\.length/, '버튼의 건수는 매도 기록 줄 수');
console.log('PASS 내보내기(CSV)');
