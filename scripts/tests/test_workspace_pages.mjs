// 계좌별 보기·통합 일정(2026-11-10): 조회 전용이며 기존 판정 함수가 정한 값을 모을 뿐 새 기준을 만들지 않는다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = f => fs.readFileSync(new URL(f, root), 'utf8');
const src = read('workspace-pages.js'), nav = read('navigation.js'), html = read('index.html'), cobalt = read('cobalt.js'), ws = read('workspace-ui.css');

// 연결: 상위 메뉴는 그대로 7개, 탭만 늘었다. 이 파일은 cobalt.js 보다 먼저 로드된다.
assert.equal((nav.match(/\{menu:'/g) || []).length, 7, '상위 메뉴 7개 유지');
assert.match(nav, /\['holdings','보유 목록'\],\['acct2','계좌별 보기'\]/);
assert.match(nav, /\['dca2','적립식 매수'\],\['cal2','일정'\],\['sim2','투자 시뮬레이터'\]/);
assert.match(cobalt, /acct2:cbRenderAccounts, cal2:cbRenderCalendar[,}]/);
assert.ok(html.indexOf('workspace-pages.js') > html.indexOf('etf-explorer.js') && html.indexOf('workspace-pages.js') < html.indexOf('cobalt.js?'), 'cobalt.js 앞에 로드');
assert.match(html, /<div id="view-acct2" class="view-section"><div class="cb-scroll" id="cb-acct2">/);
assert.match(html, /<div id="view-cal2" class="view-section"><div class="cb-scroll" id="cb-cal2">/);
assert.doesNotMatch(src, /saveAssetsToKV|saveExtDataToKV|setKV|localStorage|\bfetch\(/, '조회 전용 — 저장·전송하지 않는다');
assert.doesNotMatch(src, /style="[^"]*(?:min-)?width:\s*\d/, '폭은 클래스로만 준다');
assert.ok(ws.indexOf('계좌별 보기·통합 일정') < ws.indexOf('/* ===== 움직임 (2026-11-02)'), '새 CSS 블록은 움직임·공통 블록 앞');

const OWNERS = ['본인', '아내', '자녀1', '아버지'];
const row = (o) => ({ i: { grp: '주식', owner: '본인', broker: 'A증권', acc: '일반', ...o.i }, title: o.title || 'T', tkr: o.tkr || 'T', val: o.val, cost: o.cost ?? o.val, gain: o.gain ?? 0, gainPct: null });
let rows = [];
let transfers = [];
const ctx = vm.createContext({
  OWNERS, Map, Number, Array, Object, Date, String, Math,
  finRows: ownerF => rows.filter(r => !ownerF || r.i.owner === ownerF),
  getAccountDivTaxInfo: acc => /ISA/.test(acc || '') ? { type: 'ISA', label: 'ISA' } : /연금|IRP/.test(acc || '') ? { type: '연금', label: '연금' } : { type: '일반', label: '일반' },
  cbDivIncomeKRW: i => i.div || 0,
  cbDivOf: i => i.d || null,
  cbDcaScheduledOn: (i, d) => !!i.dca && d.getDate() === i.dcaDay,
  cbDcaPerOrderKRW: i => i.dcaAmt || 0,
  _autoTransferOccursOn: (at, d) => d.getDate() === at.dayOfMonth,
  _effectiveAutoTransferAmt: at => at.amt,
  cbUpcomingDividendSchedule: (list, days, asOf) => list.flatMap(x => x.d.months.includes(asOf.getMonth())
    ? [{ date: new Date(asOf.getFullYear(), asOf.getMonth(), x.d.payDay || 1), dateLabel: x.d.payDay ? `${asOf.getMonth() + 1}월 ${x.d.payDay}일경` : `${asOf.getMonth() + 1}월 예정`, owner: x.i.owner, title: x.title, amount: x.incomeKRW / x.d.months.length }] : []),
});
vm.runInContext('var autoTransferData=[];', ctx);
vm.runInContext(src, ctx);
const plain = v => JSON.parse(JSON.stringify(v));

// ── 계좌 구분 ──
assert.equal(ctx.acctKind('일반'), '일반');
assert.equal(ctx.acctKind('중개형 ISA'), 'ISA');
assert.equal(ctx.acctKind('연금저축'), '연금');
assert.equal(ctx.acctKind('IRP'), '연금');
assert.equal(ctx.acctKind('증여계좌'), '증여계좌', "이름에 '증여'가 있으면 증여계좌");
assert.equal(ctx.acctKind(''), '일반');

// ── 계좌별 묶음: 합계 보존, 현금·취득가 미상은 손익에서 제외, 소유주 필터 ──
rows = [
  row({ i: { acc: 'ISA', div: 100 }, val: 1000, cost: 800, gain: 200 }),
  row({ i: { acc: 'ISA' }, val: 500, cost: 600, gain: -100 }),
  row({ i: { grp: '현금', acc: 'ISA' }, val: 300, cost: 300, gain: 0 }),
  row({ i: { acc: '일반', costUnknown: true, _priceStale: true }, val: 700, cost: 0, gain: 0 }),
  row({ i: { owner: '아내', acc: '연금저축', broker: 'B증권' }, val: 2500, cost: 2000, gain: 500 }),
];
let d = ctx.acctGroups(null);
assert.equal(d.total, 5000);
assert.equal(d.groups.reduce((s, g) => s + g.value, 0), 5000, '계좌 합계 = 전체 평가액');
assert.equal(d.groups.length, 3);
const isa = d.groups.find(g => g.acc === 'ISA');
assert.equal(isa.value, 1800);
assert.equal(isa.cost, 1400, '현금은 매입금액에서 제외');
assert.equal(isa.gain, 100);
assert.ok(Math.abs(isa.gainPct - 100 / 1400) < 1e-12);
assert.equal(isa.dividend, 100);
assert.equal(isa.share, 36);
const general = d.groups.find(g => g.acc === '일반');
assert.equal(general.gainPct, null, '취득가 미상뿐인 계좌는 수익률을 만들지 않는다');
assert.equal(general.stale, 1);
assert.deepEqual(d.groups.map(g => g.owner), ['본인', '본인', '아내'], '소유주 순서 → 평가액 순');
assert.deepEqual(plain(d.kinds.map(k => [k.kind, k.value, k.accounts])), [['일반', 700, 1], ['ISA', 1800, 1], ['연금', 2500, 1], ['증여계좌', 0, 0]]);
d = ctx.acctGroups('아내');
assert.equal(d.total, 2500);
assert.equal(d.groups[0].share, 100, '비중 분모는 그 소유주의 투자자산');

// ── 통합 일정: 기존 판정 함수에 날짜마다 묻는다 ──
rows = [
  row({ i: { dca: true, dcaDay: 15, dcaAmt: 500000 }, title: '적립 ETF' }),
  row({ i: { d: { months: [10], payDay: 20 }, div: 120000 }, title: '배당주A' }),
  row({ i: { d: { months: [10] }, div: 60000 }, title: '배당주B' }),
  row({ i: { owner: '아내', dca: true, dcaDay: 3, dcaAmt: 100000 }, title: '아내 ETF' }),
];
vm.runInContext("autoTransferData=[{owner:'본인',type:'지출',desc:'관리비',amt:320000,dayOfMonth:25},{owner:'아내',type:'수입',desc:'월세',amt:700000,dayOfMonth:5}];", ctx);
let c = ctx.calEvents(2026, 10, null);
assert.equal(c.last, 30);
assert.deepEqual(plain(c.days[15]), [{ kind: 'dca', title: '적립 ETF', owner: '본인', amount: 500000 }]);
assert.equal(c.days[20][0].kind, 'div');
assert.equal(c.days[20][0].amount, 120000);
assert.equal(c.days[25][0].kind, 'out');
assert.equal(c.days[5][0].kind, 'in');
assert.deepEqual(plain(c.undated), [{ kind: 'div', title: '배당주B', owner: '본인', amount: 60000 }], '지급일을 모르는 배당은 날짜 칸에 넣지 않는다');
assert.equal(c.days[1], undefined, '지급일 미정 배당을 1일에 찍지 않는다');
assert.deepEqual(plain(c.totals), { div: 180000, dca: 600000, out: 320000, in: 700000 }, '합계는 미정 배당 포함');
c = ctx.calEvents(2026, 10, '아내');
assert.deepEqual(plain(c.totals), { div: 0, dca: 100000, out: 0, in: 700000 }, '소유주 필터가 모든 종류에 걸린다');
c = ctx.calEvents(2026, 1, null);
assert.equal(c.last, 28);
assert.equal(c.totals.div, 0, '지급월이 아니면 배당 없음');

// 달 이동은 연도를 넘긴다
vm.runInContext("cbRenderCalendar=()=>{};cbRestoreFilterFocus=()=>{};_calYm={y:2026,m:11};calMove(1);", ctx);
assert.deepEqual(plain(vm.runInContext('_calYm', ctx)), { y: 2027, m: 0 });
// 문구: 추정·예정임을 밝힌다, 세금 기한은 지어내지 않는다
assert.match(src, /세전 추정 · 확정 지급액 아님/);
assert.match(src, /실제 체결 아님/);
assert.match(src, /세금 신고 기한은 세금 규칙 자료에 등록돼 있지 않아 표시하지 않습니다/);
assert.match(src, /ISA 납입 한도·만기일과 연금 납입 한도는 가입일·납입액 기록이 없어 표시하지 않습니다/);
console.log('PASS 계좌별 보기·통합 일정');
