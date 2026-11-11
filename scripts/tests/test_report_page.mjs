// 월간 결산(투자 분석 > report2): 조회 전용이며 기존 계산을 읽기만 한다. 기록이 없는 달의 숫자를 지어내지 않는다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, root), 'utf8');
const pages = read('workspace-pages.js'), nav = read('navigation.js'), cobalt = read('cobalt.js');
const html = read('index.html'), ws = read('workspace-ui.css');

// 배선 — 상위 메뉴는 7개 그대로, 투자 분석의 세 번째 탭
assert.match(nav, /\['perf2','성과'\],\['risk2','리스크'\],\['report2','월간 결산'\]/);
assert.equal((nav.match(/\{menu:'/g) || []).length, 7, '상위 메뉴는 7개');
assert.equal((html.match(/class="menu-btn/g) || []).length, 7, '사이드바 버튼도 7개');
assert.match(cobalt, /report2:cbRenderReport \};/);
assert.match(html, /<div id="view-report2" class="view-section"><div class="cb-scroll" id="cb-report2">/);
assert.match(cobalt, /class="rep-home-link" onclick="switchView\('report2'\)">지난달 결산 보기<\/button>/, '홈에서 가는 링크');

const section = pages.slice(pages.indexOf('// ───────────────────────── 월간 결산'));
assert.doesNotMatch(section, /saveAssetsToKV|saveExtDataToKV|setKV|localStorage|pfolioData\s*=|\.push\(\s*\{[^}]*date/, '조회 전용 — 저장하지 않는다');
assert.match(section, /finSnapshotOwnerInvestment\(e,ownerF\):finSnapshotInvestment\(e\)/, '월말 값은 기존 스냅샷 판정 함수에서');
assert.match(section, /finRows\(ownerF\)/, '구성·손익은 소유주 필터를 거친 cbRow 행');
assert.match(section, /divHistoryOf\(year,ownerF\|\|'전체'\)/, '배당은 배당 엔진이 채운 값');
assert.match(section, /finGoalCurrent\(g\)/, '목표는 기존 계산');
assert.match(section, /오늘 기준/, "과거 달에도 오늘 보유로 계산하는 장에는 '오늘 기준' 배지");
assert.match(section, /세후 추정/, '배당이 추정임을 밝힌다');
assert.match(section, /확정된 지급이 아닙니다/);

// 스타일은 대시보드 토큰만 — 색 직접 지정·별도 글꼴 금지(손익 대비용 두 색은 남색 장 전용)
const css = ws.slice(ws.indexOf('/* ===== 월간 결산(report2)'));
assert.ok(css.length > 500, '결산 스타일 블록');
const hex = (css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter((c) => !['#6fdca4', '#ff9db0'].includes(c));
assert.deepEqual(hex, [], '토큰 밖 색을 쓰지 않는다');
assert.doesNotMatch(css, /font-family:\s*'|font:[^;}]*'[A-Z]/, '글꼴은 --font-ui / --font-num');
assert.match(css, /prefers-reduced-motion:no-preference/, '움직임 줄이기에서는 등장 효과를 끈다');
assert.doesNotMatch(css, /\.rep-figure\{[^}]*opacity:0/, '그림을 숨긴 채 기다리지 않는다');

// 계산 — 월말 값·기본 달·빈 기록
const grab = (name) => section.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0];
const ctx = vm.createContext({
  window: {}, goalData: [], CB_CLS: { us: { label: '미국 주식', color: '#5b9bff' }, cash: { label: '현금', color: '#aaa' } },
  finSnapshotInvestment: (e) => (Number.isFinite(e.portfolio) ? e.portfolio : null),
  finSnapshotOwnerInvestment: (e, o) => (e.portfolioByOwner && Number.isFinite(e.portfolioByOwner[o]) ? e.portfolioByOwner[o] : null),
  finRows: (o) => ctx.ROWS.filter((r) => !o || r.i.owner === o),
  finGoalCurrent: (g) => g.cur, divHistoryYears: () => ['2025', '2026', '2027'],
  divHistoryOf: (y, o) => (y === '2026' && o === '전체' ? [0, 0, 30, 0, 0, 30, 0, 0, 30, 0, 0, 30] : Array(12).fill(0)),
});
for (const n of ['reportMonthEnds', 'reportDefaultYm', 'reportYmNext', 'reportYmLabel', 'reportData']) vm.runInContext(grab(n), ctx);
ctx.ROWS = [
  { cls: 'us', val: 600, cost: 400, gain: 200, gainPct: 0.5, title: 'A', i: { owner: '본인', grp: '주식' } },
  { cls: 'us', val: 100, cost: 200, gain: -100, gainPct: -0.5, title: 'B', i: { owner: '아내', grp: '주식' } },
  { cls: 'cash', val: 300, cost: 300, gain: 0, gainPct: null, title: '예수금', i: { owner: '본인', grp: '현금' } },
  { cls: 'us', val: 50, cost: 0, gain: 50, gainPct: null, title: '미상', i: { owner: '본인', grp: '주식', costUnknown: true } },
];
ctx.window._netWorthHistory = [
  { date: '2026-08-30', portfolio: 800, portfolioByOwner: { 본인: 500 } },
  { date: '2026-08-31', portfolio: 820, portfolioByOwner: { 본인: 510 } },
  { date: '2026-10-15', portfolio: 900, portfolioByOwner: { 본인: 600 } },
  { date: '2026-10-31', portfolio: null },
  { date: '2026-11-05', portfolio: 950, portfolioByOwner: { 본인: 640 } },
  { date: 'bad', portfolio: 1 },
];
const months = ctx.reportMonthEnds(ctx.window._netWorthHistory, null);
assert.deepEqual(Array.from(months, (m) => [m.ym, m.v]), [['2026-08', 820], ['2026-10', 900], ['2026-11', 950]], '그달 마지막 유효 기록만, 없는 달(9월)은 만들지 않는다');
assert.equal(ctx.reportDefaultYm(months, '2026-11-11'), '2026-10', '기본은 이미 끝난 가장 최근 달');
assert.equal(ctx.reportDefaultYm(months.slice(2), '2026-11-11'), '2026-11', '끝난 달이 없으면 가장 최근 달');
assert.equal(ctx.reportDefaultYm([], '2026-11-11'), null);

const all = ctx.reportData(null, null, '2026-11-11');
assert.equal(all.cur.v, 900); assert.equal(all.prev.v, 820);
assert.equal(all.prevAdjacent, false, "9월 기록이 없으면 '한 달 전'이라고 부르지 않는다");
assert.equal(all.total, 1050); assert.equal(all.gain, 100); assert.equal(all.cost, 600);
assert.equal(all.gain / all.cost, all.gainPct, '현금·취득가 미상은 손익에서 뺀다');
assert.equal(all.divs.reduce((s, v) => s + v, 0), 120);
const mine = ctx.reportData('본인', '2026-08', '2026-11-11');
assert.equal(mine.cur.v, 510, '소유주 탭은 그 소유주의 월말 값'); assert.equal(mine.prev, null);
assert.equal(mine.total, 950, '구성도 소유주 범위');
assert.equal(ctx.reportData('자녀1', null, '2026-11-11').cur, null, '기록이 없는 소유주는 숫자를 만들지 않는다');
assert.equal(ctx.reportData(null, '1999-01', '2026-11-11').cur.ym, '2026-10', '없는 달을 고르면 기본 달로');

console.log('PASS 월간 결산');
