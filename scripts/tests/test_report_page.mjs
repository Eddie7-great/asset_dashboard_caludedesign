// 결산 리포트(사이드 메뉴 '결산 리포트' > 월간 report2 · 연간 reporty).
// 조회 전용이며, 지난 달은 배치가 남긴 월말 기록(reportArchive), 이번 달은 같은 계산을 지금 원장에 돌린 값이다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, root), 'utf8');
const pages = read('workspace-pages.js'), nav = read('navigation.js'), cobalt = read('cobalt.js');
const html = read('index.html'), ws = read('workspace-ui.css'), script = read('script.js');

// ── 배선: 8번째 상위 메뉴, 탭 두 개, 같은 소유주 범위 ──
assert.match(nav, /\{menu:'report2',title:'결산 리포트',views:\[\['report2','월간'\],\['reporty','연간'\]\]\}/);
assert.match(nav, /\['perf2','성과'\],\['risk2','리스크'\]\]\}/, '투자 분석에서는 뺐다');
assert.match(nav, /if\(id==='report2'\|\|id==='reporty'\)return _reportOwner;/);
assert.match(nav, /if\(id==='report2'\|\|id==='reporty'\)_reportOwner=owner;/);
assert.match(html, /id="menu-report2" onclick="switchView\('report2',this\)">[\s\S]*?결산 리포트<\/button>/);
assert.match(html, /<div id="view-reporty" class="view-section"><div class="cb-scroll" id="cb-reporty">/);
assert.match(cobalt, /report2:cbRenderReport, reporty:cbRenderReportYear \};/);
assert.match(cobalt, /onclick="switchView\('report2'\)">지난달 결산 보기<\/button>/);

// ── 조회 전용 ──
const section = pages.slice(pages.indexOf('// ───────────────────────── 결산 리포트'));
assert.ok(section.length > 5000, '결산 모듈');
const code = section.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
assert.doesNotMatch(code, /saveAssetsToKV|saveExtDataToKV|setKV\(|localStorage|pfolioData\s*=[^=]|_reportArchive\s*=[^=]/, '저장하지 않는다');
// 배치가 쓰고 앱은 그대로 다시 싣는다 — 빼면 앱 저장이 지난 결산을 지운다
assert.match(script, /reportArchive: window\._reportArchive \|\| \{\} \};/);
assert.match(script, /window\._reportArchive=_normalizeReportArchive\(owns\('reportArchive'\)\?data\.reportArchive:null\);/);
assert.doesNotMatch(script.match(/function _extSnapshot\(\)\{[\s\S]*?\n\}/)[0], /reportArchive/, '되돌리기 대상이 아니다(사용자 입력이 아님)');

// ── 화면 단위 전환 ──
const css = ws.slice(ws.indexOf('/* ===== 결산 리포트(report2'), ws.indexOf('/* ===== 사이드바 접기'));
assert.match(css, /\.rep-scroll\{[^}]*scroll-snap-type:y mandatory/);
assert.match(css, /\.rep-page\{[^}]*min-height:var\(--rep-h[^}]*scroll-snap-align:start/);
assert.match(css, /@media\(max-width:860px\),\(max-height:620px\)\{\s*\.rep-scroll\{scroll-snap-type:none\}/, '좁거나 낮은 화면은 스냅을 끈다');
assert.match(css, /prefers-reduced-motion:reduce\)\{\.rep-scroll\{scroll-behavior:auto\}/);
assert.doesNotMatch(css, /animation-timeline/, '스냅과 겹치는 등장 효과는 뺐다');
const hex = (css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter((c) => !['#6fdca4', '#ff9db0'].includes(c));
assert.deepEqual(hex, [], '토큰 밖 색을 쓰지 않는다(남색 장의 손익 대비색 두 개만 예외)');
assert.doesNotMatch(css, /font-family:\s*'|font:[^;}]*'[A-Z]/, '글꼴은 --font-ui / --font-num');
assert.match(section, /<nav class="rep-dots" aria-label="장 이동">[\s\S]*<button type="button" data-rep-dot=/, '장 표시는 진짜 버튼');
assert.match(section, /addEventListener\('wheel'[\s\S]*passive:false/, '휠 한 칸에 한 장');
assert.match(section, /new ResizeObserver\(\(\)=>\{ if\(el\.classList\.contains\('rep-scroll'\)\) fit\(\); \}\)/, '장 높이를 스크롤 영역에 맞춘다');
assert.match(ws, /\.rep-page\{word-break:keep-all;overflow-wrap:anywhere\}/, '한글을 글자 단위로 끊지 않는다');
assert.match(ws, /\.rep-chapter h2>\.rep-title\{white-space:nowrap\}/, '장 제목은 한 덩어리 — 배지만 다음 줄로');
assert.match(section, /<span class="rep-title">\$\{title\}<\/span>/);

// ── 계산 ──
const grab = (name) => section.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0];
const RATES = { USD: 1400, JPY: 9.5, KRW: 1 };
const ctx = vm.createContext({
  window: {}, RATES, cfData: [], monthlyPLData: [], pfolioData: [], goalData: [],
  finSnapshotInvestment: (e) => (Number.isFinite(e.portfolio) ? e.portfolio : null),
  finSnapshotOwnerInvestment: (e, o) => (e.portfolioByOwner && Number.isFinite(e.portfolioByOwner[o]) ? e.portfolioByOwner[o] : null),
  divHistoryYears: () => ['2025', '2026', '2027'],
  divHistoryOf: (y, o) => (y === '2026' && o === '전체' ? [0, 0, 30, 0, 0, 30, 0, 0, 30, 0, 50, 70] : Array(12).fill(0)),
});
for (const n of ['cbStrip', 'cbCls', 'cbRate', 'cbAvgNative', 'cbValKRW', 'cbCostKRW']) vm.runInContext(cobalt.match(new RegExp(`function ${n}\\([^)]*\\)\\{[\\s\\S]*?\\n?\\}`))[0], ctx);
for (const n of ['reportYmNext', 'reportBuildEntry', 'reportMonthEnds', 'reportEntryValue', 'reportTimeline', 'reportDefaultYm', 'reportHoldingDiff', 'reportDividendYear', 'reportRealizedYear']) vm.runInContext(grab(n), ctx);

// reportBuildEntry — 분류·원가 규칙(가상화폐 원화 평단), 현금·취득가 미상은 손익 제외, 목표 연결
const items = [
  { owner: '본인', grp: '주식', cur: 'USD', tkr: 'AAPL', name: '애플', broker: '키움', acc: '일반', qty: 10, avgP: 150, curP: 200 },
  { owner: '아내', grp: '가상화폐', cur: 'USD', tkr: 'BTC', name: '비트코인', broker: '업비트', acc: '일반', qty: 0.5, avgP: 80000000, curP: 90000 },
  { owner: '본인', grp: '현금', cur: 'KRW', tkr: 'KRW_1', name: '예수금', qty: 1000000, avgP: 1, curP: 1 },
  { owner: '본인', grp: '주식', cur: 'KRW', tkr: '005930', name: '삼성전자', qty: 10, avgP: 0, curP: 70000, costUnknown: true },
  { owner: '본인', grp: '주식', cur: 'KRW', tkr: 'GONE', name: '판 종목', qty: 0, avgP: 1, curP: 1 },
];
const goals = [{ name: '은퇴', targetAmount: 1e8, linkClass: 'investment' }, { name: '현금', targetAmount: 1e6, linkClass: 'cash' }, { name: '집', targetAmount: 1e9, linkClass: 'net' }];
const e = ctx.reportBuildEntry(items, { assets: [{ owner: '본인', amount: 5e8 }], liabilities: [{ owner: '본인', amount: 1e8 }] }, goals, '2026-11-11');
assert.equal(e.ym, '2026-11');
assert.equal(e.total, 2800000 + 63000000 + 1000000 + 700000);
assert.equal(e.holdings.length, 4, '수량 0 은 뺀다');
assert.deepEqual(JSON.parse(JSON.stringify(e.cls['전체'])), { crypto: 63000000, us: 2800000, cash: 1000000, kr: 700000 });
assert.equal(e.pl['전체'].cost, 2100000 + 40000000, '가상화폐 원화 평단은 달러로 바꿔 원가 계산, 현금·미상 제외');
assert.equal(e.pl['본인'].gain, 700000);
assert.deepEqual(Array.from(e.goals, (g) => g.now), [e.total, 1000000, e.total + 4e8]);

// reportTimeline — 지난 달은 보관 우선, 일별 기록만 있는 달은 총액만, 이번 달은 실시간
ctx.window._reportArchive = { '2026-09': { ym: '2026-09', date: '2026-09-30', total: 900, byOwner: { 본인: 600 }, cls: {}, pl: {}, holdings: [], goals: [] }, '2025-01': { ym: '2025-01', date: '2025-01-31', total: 500, byOwner: {}, cls: {}, pl: {}, goals: [] } };
ctx.window._netWorthHistory = [{ date: '2026-08-31', portfolio: 800 }, { date: '2026-09-15', portfolio: 850 }, { date: '2026-10-31', portfolio: 950 }, { date: '2026-11-05', portfolio: 999 }];
ctx.pfolioData = items; ctx.window._balanceSheet = null;
const tl = ctx.reportTimeline(null, '2026-11-11');
assert.deepEqual(Array.from(tl, (m) => [m.ym, m.src]), [['2025-01', 'archive'], ['2026-08', 'daily'], ['2026-09', 'archive'], ['2026-10', 'daily'], ['2026-11', 'live']], '1년 넘은 달도 보관 값으로 남는다');
assert.equal(tl.find((m) => m.ym === '2026-09').v, 900, '보관이 일별 기록보다 우선');
assert.equal(tl.find((m) => m.ym === '2026-10').entry, null, '보관이 없는 지난 달은 구성을 지어내지 않는다');
assert.equal(tl.find((m) => m.ym === '2026-11').v, e.total, '이번 달은 지금 원장');
assert.equal(ctx.reportDefaultYm(tl, '2026-11-11'), '2026-10');
assert.equal(ctx.reportTimeline('아내', '2026-11-11').find((m) => m.ym === '2025-01'), undefined, '소유주 값이 없는 보관 달은 그 소유주 목록에 넣지 않는다');

// reportHoldingDiff — 새로 담음·더 삼·줄임·모두 팖·분할, 접미사 무시, 원가 흐름 분리
const H = (t, q, c, v, extra = {}) => ({ o: '본인', b: '키움', a: '일반', t, n: t, g: 'kr', q, c, v, u: false, ...extra });
const prev = [H('005930', 10, 700, 800), H('AAA', 5, 500, 600), H('BBB', 3, 300, 300), H('SPL', 10, 1000, 1000), H('KRW_1', 1000, 1000, 1000, { g: 'cash' })];
const cur = [H('005930.KS', 10, 700, 900), H('AAA', 8, 800, 960), H('NEW', 2, 200, 250), H('SPL', 40, 1000, 1100), H('KRW_1', 600, 600, 600, { g: 'cash' })];
const d = ctx.reportHoldingDiff(prev, cur, null);
const kinds = Object.fromEntries(d.rows.map((r) => [r.t, r.kind]));
assert.deepEqual(kinds, { NEW: 'new', AAA: 'more', BBB: 'out', SPL: 'split', KRW_1: 'cash' }, '005930 과 005930.KS 는 같은 종목이다');
assert.equal(d.trades, 3, '분할과 현금 변화는 매매로 세지 않는다');
assert.equal(d.flow, 300 + 200 - 300 - 400);
assert.equal(d.change, (900 + 960 + 250 + 1100 + 600) - (800 + 600 + 300 + 1000 + 1000));
assert.equal(d.market, d.change - d.flow);
assert.equal(ctx.reportHoldingDiff(null, cur, null), null, '앞 달 종목 기록이 없으면 비교하지 않는다');
assert.equal(ctx.reportHoldingDiff(prev, cur, '아내').rows.length, 0, '소유주 범위');

// reportDividendYear — 끝난 달은 현금 흐름 기록, 이번 달부터는 추정
ctx.cfData = [{ date: '2026-03-25', type: '수입', cat: '배당금', amt: 40, owner: '본인' }, { date: '2026-03-26', type: '수입', cat: '급여', amt: 999, owner: '본인' }];
const dv = ctx.reportDividendYear('2026', null, '2026-11-11');
assert.deepEqual(Array.from(dv.months, (m) => m.v), [0, 0, 40, 0, 0, 0, 0, 0, 0, 0, 50, 70]);
assert.deepEqual(Array.from(dv.months, (m) => m.kind).slice(9), ['rec', 'est', 'est']);
ctx.cfData = [];
assert.equal(ctx.reportDividendYear('2026', null, '2026-11-11').months[2].v, null, '기록이 하나도 없으면 0 이 아니라 빈칸');

ctx.monthlyPLData = [{ month: '2026-03', amt: 100, owner: '본인' }, { month: '2026-07', amt: -30, owner: '아내' }, { month: '2025-12', amt: 5, owner: '본인' }];
assert.deepEqual({ ...ctx.reportRealizedYear('2026', null) }, { count: 2, sum: 70 });
assert.deepEqual({ ...ctx.reportRealizedYear('2026', '본인') }, { count: 1, sum: 100 });

// 화면 문구 — 기준 배지와 추정 표시
assert.match(section, /진행 중 · 오늘 기준/);
assert.match(section, /일 종가 기준/);
assert.match(section, /이 달은 총액만 남아 있습니다/, '보관 없는 지난 달은 오늘 값으로 대신하지 않는다');
assert.match(section, /거래 기록이 아니라 두 시점의 보유를 견준 추정입니다/);
assert.match(section, /확정된 지급이 아닙니다/);

// 불러오기 정규화 — 형식이 틀린 달·숫자가 아닌 값은 버린다(화면이 숫자를 지어내지 않도록)
{
  const nctx = vm.createContext({});
  for (const n of ['_safeStoredNumber', '_isStoredDateKey', '_boundedStoredText']) {
    const m = script.match(new RegExp(`function ${n}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
    if (m) vm.runInContext(m[0], nctx);
  }
  if (typeof nctx._isStoredDateKey !== 'function') vm.runInContext("function _isStoredDateKey(v){return /^\\d{4}-\\d{2}-\\d{2}$/.test(String(v))}", nctx);
  if (typeof nctx._boundedStoredText !== 'function') vm.runInContext("function _boundedStoredText(v,n){return String(v||'').slice(0,n)}", nctx);
  vm.runInContext(script.match(/function _normalizeReportArchive\(raw\)\{[\s\S]*?\n\}/)[0], nctx);
  const out = JSON.parse(JSON.stringify(nctx._normalizeReportArchive({
    '2026-09': { date: '2026-09-30', total: 100, byOwner: { 본인: 60, 아내: 'x' }, holdings: [{ o: '본인', t: 'A', q: 1, c: 2, v: 3 }, { t: 'B', q: 'x', c: 1, v: 1 }], goals: [{ name: 'g', now: 1, target: 2 }, { name: 'bad' }] },
    '2026-10': { date: '2026-09-30', total: 1 },
    '2026-13': { date: '2026-13-01', total: 1 },
    '2026-08': { date: '2026-08-31', total: 'NaN?' },
    junk: 1,
  })));
  assert.deepEqual(Object.keys(out), ['2026-09'], '날짜가 달과 다르거나 총액이 숫자가 아니면 그 달을 버린다');
  assert.deepEqual(out['2026-09'].byOwner, { 본인: 60 });
  assert.deepEqual(out['2026-09'].holdings.map((h) => h.t), ['A']);
  assert.deepEqual(out['2026-09'].goals.map((g) => g.name), ['g']);
  assert.deepEqual(JSON.parse(JSON.stringify(nctx._normalizeReportArchive(null))), {});
}

console.log('PASS 결산 리포트');
