// 계좌별 보기·통합 일정(2026-11-10): 조회 전용이며 기존 판정 함수가 정한 값을 모을 뿐 새 기준을 만들지 않는다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readSource } from './_source.mjs'

const root = new URL('../../', import.meta.url);
const read = f => readSource(f);
const src = read('workspace-pages.js'), nav = read('navigation.js'), html = read('index.html'), cobalt = read('cobalt.js'), ws = read('workspace-ui.css');

// 연결: 상위 메뉴는 8개(2026-11-11 결산 리포트 추가). 이 파일은 cobalt.js 보다 먼저 로드된다.
assert.equal((nav.match(/\{menu:'/g) || []).length, 8, '상위 메뉴 8개');
// 페이지 통폐합(2026-11-19): 계좌별 보기는 보유 목록의 보기 전환, 일정은 현금 흐름 탭이다(세부 메뉴에서 빠지고 NAV_HOST 로 속한다).
assert.match(nav, /holdings:\[\['holdings','종목별'\],\['acct2','계좌별'\],\['fam2','구성원별'\],\['dca2','적립식'\]\]/);
assert.match(nav, /const NAV_HOST = \{trend2:'screen2', value2:'screen2', macro2:'screen2', acct2:'holdings', fam2:'holdings', dca2:'holdings', etf2:'bubble', reporty:'report2', cal2:'cashflow'\};/);
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
// 자녀1 의 일반 계좌는 증여받은 돈으로 운용한다(2026-11-20 8차, 사용자 설명) — 화면 구분만, ISA·연금은 세제 구분 그대로
assert.equal(ctx.acctKind('메리츠 일반', '자녀1'), '증여계좌');
assert.equal(ctx.acctKind('토스 주식', '자녀1'), '증여계좌');
assert.equal(ctx.acctKind('중개형 ISA', '자녀1'), 'ISA');
assert.equal(ctx.acctKind('연금저축', '자녀1'), '연금');
assert.equal(ctx.acctKind('일반', '본인'), '일반');
assert.equal(ctx.ACCT_GIFT_OWNER ?? vm.runInContext('ACCT_GIFT_OWNER', ctx), '자녀1');
assert.match(src, /kind:acctKind\(r\.i\.acc,owner\)/, '묶음은 소유주와 함께 판정');

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

// ── 자녀1 증여 계좌 ↔ 증여 이체 누계(cbGiftRecords('child') 그대로 — 기록장 + 증여로 연결한 자동이체) ──
{
  rows = [
    row({ i: { owner: '자녀1', broker: '메리츠', acc: '일반' }, val: 3000, cost: 2600, gain: 400 }),
    row({ i: { owner: '자녀1', broker: '토스', acc: '주식' }, val: 2000, cost: 1900, gain: 100 }),
    row({ i: { owner: '본인', acc: '증여 받은 돈' }, val: 900 }),
  ];
  let gifts = [{ kind: 'child', amt: 1500 }, { kind: 'child', amt: 2500, auto: true }];
  ctx.cbGiftRecords = kind => gifts.filter(r => !kind || r.kind === kind);
  d = ctx.acctGroups(null);
  assert.deepEqual(plain(d.kinds.map(k => [k.kind, k.value, k.accounts])), [['일반', 0, 0], ['ISA', 0, 0], ['연금', 0, 0], ['증여계좌', 5900, 3]], "자녀1 의 메리츠·토스 + 이름에 '증여'");
  assert.deepEqual(plain(ctx.acctGiftCompare(d.groups, null)), { value: 5000, gifted: 4000, diff: 1000, count: 2, accounts: 2 }, '비교는 자녀1 증여계좌만(다른 소유주의 증여 이름 계좌 제외)');
  assert.deepEqual(plain(ctx.acctGiftCompare(ctx.acctGroups('자녀1').groups, '자녀1')).value, 5000);
  assert.equal(ctx.acctGiftCompare(ctx.acctGroups('본인').groups, '본인'), null, '자녀1 이 범위에 없으면 그리지 않는다');
  gifts = [];
  assert.equal(ctx.acctGiftCompare(d.groups, null).count, 0, '기록이 없으면 count 0 — 연결 안내를 그린다');
  ctx.window = { _kvLoadState: { assets: 'ready', ext: 'failed' } };
  assert.equal(ctx.acctGiftCompare(d.groups, null), null, "재무 기록을 못 불러왔으면 '기록 없음'이라 단정하지 않는다");
  ctx.window._kvLoadState.ext = 'ready';
  assert.equal(ctx.acctGiftCompare(d.groups, null).count, 0);
  delete ctx.window;
  delete ctx.cbGiftRecords;
}

// ── 계좌별 보기 트리(2026-11-18): 리밸런싱과 같은 부품(finTreeHtml), 계좌 줄을 누르면 종목이 펼쳐진다 ──
{
  const fin = read('finance.js');
  const fn = name => { const m = fin.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`)); assert.ok(m, name); return m[0]; };
  const els = { 'cb-acct2': { innerHTML: '' } };
  Object.assign(ctx, {
    document: { getElementById: id => els[id] || null },
    finOwnerF: o => (o === '전체' ? null : o), cbSetHead: () => {}, cbOwnerBtns: () => '', cbRestoreFilterFocus: () => {},
    cbEsc: v => String(v ?? ''), cbDisp: v => '₩' + Math.round(v).toLocaleString('en-US'), cbOwnerColor: () => '#000',
    cbFlagCell: () => '<i class="flag"></i>', cbGainStyle: v => (v > 0 ? 'color:var(--up)' : v < 0 ? 'color:var(--dn)' : 'color:var(--lab)'),
    cbSignDisp: v => (v >= 0 ? '+' : '-') + Math.abs(v), cbPct: v => (v * 100).toFixed(1) + '%',
  });
  vm.runInContext(fn('finAccountTree') + '\n' + fn('finTreeHtml'), ctx);
  const cfn = name => { const m = cobalt.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`)); assert.ok(m, name); return m[0]; };
  vm.runInContext(['cbSortCompare', 'cbSortRows', 'cbSortDir', 'cbSortBtn', 'cbOwnerRank'].map(cfn).join('\n') + '\nvar _cbTableSort={};', ctx);
  rows = [
    row({ i: { acc: 'ISA', div: 100 }, title: '배당ETF', val: 1000, cost: 800, gain: 200 }),
    row({ i: { acc: 'ISA' }, title: '성장주', val: 500, cost: 600, gain: -100 }),
    row({ i: { owner: '아내', acc: '연금저축', broker: 'B증권' }, title: '연금ETF', val: 2500, cost: 2000, gain: 500 }),
  ];
  vm.runInContext("_acctOwner='전체';_acctOpen=new Set();cbRenderAccounts();", ctx);
  let h = els['cb-acct2'].innerHTML;
  assert.match(h, /class="fin-tree is-acct"/, '리밸런싱과 같은 트리 부품(열 설정만 다르다)');
  assert.equal((h.match(/fin-tree-row lv2/g) || []).length, 2, '계좌 줄 2개');
  assert.equal((h.match(/fin-tree-row lv3/g) || []).length, 0, '처음에는 종목 줄을 접어 둔다');
  assert.match(h, /<i class="fin-tree-kind isa"><\/i><b>ISA<\/b>/, '계좌 층 색은 세제 유형');
  assert.match(h, /role="button" tabindex="0" data-acct-idx="0" aria-expanded="false" onclick="acctToggle\(0\)"/, '계좌 줄은 키보드로도 누를 수 있다');
  assert.match(h, /<span class="cb-num">₩1,500<\/span>/, '계좌 평가액 = 종목 평가액 합(새 계산 없음)');
  vm.runInContext('acctToggle(0);', ctx);
  h = els['cb-acct2'].innerHTML;
  assert.equal((h.match(/fin-tree-row lv3/g) || []).length, 2, '누르면 그 계좌의 종목이 펼쳐진다');
  assert.match(h, /aria-expanded="true"/);
  assert.ok(h.indexOf('배당ETF') < h.indexOf('성장주'), '종목은 평가액 큰 순');
  vm.runInContext('acctToggle(0);', ctx);
  assert.equal((els['cb-acct2'].innerHTML.match(/fin-tree-row lv3/g) || []).length, 0, '다시 누르면 접힌다');
  vm.runInContext('acctToggleAll();', ctx);
  assert.equal((els['cb-acct2'].innerHTML.match(/fin-tree-row lv3/g) || []).length, 3, '모두 펼치기');
  assert.match(els['cb-acct2'].innerHTML, /data-acct-all="1"[^>]*>모두 접기</);
  assert.match(cobalt, /function cbResetViewState\(\)\{[\s\S]*?_acctOpen=new Set\(\)/, '다른 화면으로 옮기면 펼친 계좌를 접는다');
  // 머리글 정렬은 각 단계 안에서 — 평가액 오름차순이면 성장주(500)가 배당ETF(1000)보다 먼저, 소유주도 작은 쪽(본인 1500)이 먼저
  vm.runInContext("_cbTableSort={acct:{key:'value',dir:1}};cbRenderAccounts();", ctx);
  h = els['cb-acct2'].innerHTML;
  assert.ok(h.indexOf('성장주') < h.indexOf('배당ETF'), '종목 줄은 계좌 안에서 정렬');
  assert.ok(h.indexOf('<b>본인</b>') < h.indexOf('<b>아내</b>'), '소유주 단계도 같은 칸으로 정렬');
  assert.match(h, /data-sort-btn="acct:value"/, '머리글은 정렬 버튼');
  vm.runInContext("_cbTableSort={acct:{key:'value',dir:-1}};cbRenderAccounts();", ctx);
  h = els['cb-acct2'].innerHTML;
  assert.ok(h.indexOf('<b>아내</b>') < h.indexOf('<b>본인</b>'), '내림차순이면 큰 소유주(아내 2500)가 먼저');
  // 증여계좌 카드: 자녀1 증여 이체 누계와 평가액·차이, 기록이 없으면 가족 증여로 가는 안내
  vm.runInContext("_cbTableSort={};", ctx);
  rows = [row({ i: { owner: '자녀1', broker: '메리츠', acc: '일반' }, title: '자녀 ETF', val: 3000, cost: 2600, gain: 400 })];
  ctx.cbGiftRecords = () => [{ kind: 'child', amt: 2500 }];
  vm.runInContext("_acctOwner='전체';cbRenderAccounts();", ctx);
  h = els['cb-acct2'].innerHTML;
  assert.match(h, /<span class="acct-gift-line"><span>자녀1 증여 이체 누계 <b class="cb-num">₩2,500<\/b><\/span>/);
  assert.match(h, /평가액 ₩3,000 · <span data-tip="차이 = 자녀1 증여계좌 평가액 − 증여 이체 누계\.[^"]*증여세 신고가액\(유기정기금 평가액\)과 다릅니다\.">차이<\/span> <b class="cb-num" style="color:var\(--up\)">\+500<\/b>/);
  assert.match(h, /<em class="acct-kind-chip">증여계좌<\/em>/, '트리 계좌 줄에도 증여계좌 표식');
  ctx.cbGiftRecords = () => [];
  vm.runInContext("cbRenderAccounts();", ctx);
  assert.match(els['cb-acct2'].innerHTML, /<span class="acct-gift-line is-empty"><span>증여 이체 기록이 없습니다\.<\/span><button type="button" class="acct-gift-link" onclick="switchView\('gift2'\)">/);
  vm.runInContext("_acctOwner='아내';cbRenderAccounts();_acctOwner='전체';", ctx);
  assert.doesNotMatch(els['cb-acct2'].innerHTML, /acct-gift-line/, '자녀1 이 범위 밖이면 비교 줄이 없다');
  delete ctx.cbGiftRecords;
}

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

// 4번째 카드 — 이 달 예정 순현금(2026-11-20 8차): 위 합계를 더하고 뺄 뿐, 손익 색 없이, 수입이 없거나 저축 이체와 적립이 겹치면 밝힌다
assert.equal(ctx.calNetCash({ totals: { div: 180000, dca: 600000, out: 320000, in: 700000 } }), -40000);
{
  const els = { 'cb-cal2': { innerHTML: '' } };
  Object.assign(ctx, { document: { getElementById: id => els[id] || null }, FIN_SAVING_CATS: ['저축/투자'] });
  vm.runInContext("_calOwner='전체';_calDay=null;_calYm={y:2026,m:10};cbRenderCalendar();", ctx);
  let h = els['cb-cal2'].innerHTML;
  assert.match(h, /<div class="cb-panel cal-sum-card cal-net-card"><span class="cal-kind"><span data-tip="[^"]*일정 기준 추정이며 현금 흐름 화면의 실제 순현금흐름과 다릅니다\.">이 달 예정 순현금<\/span><\/span><b class="cb-num">-40000<\/b><small>배당 \+ 수입 − 지출 − 적립 매수<\/small><\/div>/, '손익 색(style) 없이 부호만');
  assert.doesNotMatch(h, /cal-kind in"><i><\/i>자동이체 수입<\/span><b>/, "예전 '자동이체 수입' 카드는 없다");
  assert.match(h, /cal-chip in/, '수입 자동이체는 달력·목록에 그대로 남는다');
  vm.runInContext("autoTransferData=[{owner:'본인',type:'지출',cat:'저축/투자',desc:'자녀 증여',amt:500000,dayOfMonth:10}];cbRenderCalendar();", ctx);
  h = els['cb-cal2'].innerHTML;
  assert.doesNotMatch(h, /수입 자동이체가 없어 수입은 0원입니다/, '2026-11-24: 수입 0원 안내 문장은 뺐다');
  assert.match(h, /<span class="cal-net-warn" data-tip="'저축\/투자' 이체와 적립이 같은 돈이면 두 번 빠집니다\.">중복 주의<\/span>/, '중복 경고는 카드 높이를 늘리지 않는 표식');
  assert.doesNotMatch(h, /cal-net-note/);
  vm.runInContext("autoTransferData=[{owner:'본인',type:'지출',desc:'관리비',amt:320000,dayOfMonth:25},{owner:'아내',type:'수입',desc:'월세',amt:700000,dayOfMonth:5}];", ctx);
}
assert.match(ws, /\.cal-list\{display:flex;flex-direction:column;margin-top:8px;flex:1 1 auto;min-height:160px;contain:size;position:relative;overflow-y:auto\}/, '목록은 달력 바닥까지 채우고 안에서 스크롤(목록 길이가 줄 높이를 늘리지 않게 contain:size)');
assert.match(ws, /\.cal-list-panel\{display:flex;flex-direction:column\}/);
assert.match(ws, /@media\(max-width:1100px\)\{[^\n]*\.cal-list\{contain:none;max-height:520px\}\}/, '한 단으로 쌓이면 예전 상한');
assert.doesNotMatch(ws, /\.cal-list\{[^}]*max-height:520px;overflow-y:auto\}/);

// 달 이동은 연도를 넘긴다
vm.runInContext("cbRenderCalendar=()=>{};cbRestoreFilterFocus=()=>{};_calYm={y:2026,m:11};calMove(1);", ctx);
assert.deepEqual(plain(vm.runInContext('_calYm', ctx)), { y: 2027, m: 0 });
// 날짜 고르기: 누르면 그 날, 다시 누르면 해제. 달 이동·오늘·소유주 변경도 해제한다.
vm.runInContext("calPickDay(15);", ctx);
assert.equal(vm.runInContext('_calDay', ctx), 15, '날짜를 누르면 그 날만');
vm.runInContext("calPickDay(15);", ctx);
assert.equal(vm.runInContext('_calDay', ctx), null, '같은 날을 다시 누르면 이 달 전체');
vm.runInContext("calPickDay(3);calMove(1);", ctx);
assert.equal(vm.runInContext('_calDay', ctx), null, '달을 옮기면 해제');
vm.runInContext("calPickDay(3);calOwner('아내');", ctx);
assert.equal(vm.runInContext('_calDay', ctx), null, '소유주를 바꾸면 해제');
assert.match(src, /role="button" tabindex="0" data-cal-day="\$\{day\}" aria-pressed="\$\{picked\}"/, '날짜 칸은 키보드로도 누를 수 있는 버튼');
assert.match(src, /class="cal-grid" role="group"/, '눌리는 칸이 있으므로 달력 묶음은 그림(img)이 아니라 group');
assert.match(cobalt, /function cbResetViewState\(\)\{[\s\S]*?_calDay=null/, '다른 화면으로 옮기면 고른 날을 해제');
// 문구: 추정·예정임을 밝힌다, 세금 기한은 지어내지 않는다
assert.match(src, /세전 추정 · 확정 지급액 아님/);
assert.match(src, /실제 체결 아님/);
assert.match(src, /세금 신고 기한은 세금 규칙 자료에 등록돼 있지 않아 표시하지 않습니다/);
assert.match(src, /ISA 납입 한도·만기일과 연금 납입 한도는 가입일·납입액 기록이 없어 표시하지 않습니다/);
console.log('PASS 계좌별 보기·통합 일정');
