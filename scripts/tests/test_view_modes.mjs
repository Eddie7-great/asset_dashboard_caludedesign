// 페이지 통폐합(2026-11-19): 화면 id 는 그대로 두고 세부 메뉴를 줄였다. 한 세부 메뉴 안의 보기는
// 머리줄 아래 오른쪽 '보기 전환 줄'(#view-mode-bar)로, 현금 흐름의 일정은 머리줄 탭(#cf-header-tabs)으로 오간다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = f => fs.readFileSync(new URL(f, root), 'utf8');
const nav = read('navigation.js'), html = read('index.html'), script = read('script.js'), ws = read('workspace-ui.css');

// ── 표: 메뉴 8개 그대로, 세부 메뉴는 줄고 나머지 화면은 NAV_HOST 로 속한다 ──
function el(id) {
  const attrs = {}, cls = new Set();
  return { id, hidden: false, innerHTML: '', textContent: '', attrs,
    setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: k => { delete attrs[k]; }, getAttribute: k => attrs[k],
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c), toggle: (c, on) => { if (on === undefined ? !cls.has(c) : on) cls.add(c); else cls.delete(c); } } };
}
const els = { 'view-mode-bar': el('view-mode-bar'), 'page-sections': el('page-sections'), 'main-title': el('main-title') };
const menuBtns = ['dashboard', 'holdings', 'perf2', 'divm', 'plan2', 'cashflow', 'tax2', 'report2'].map(m => el('menu-' + m));
const cfTabs = ['monthly', 'fixed', 'cal'].map(k => el('cf-section-tab-' + k));
let active = 'cdash';
const switched = [];
const ctx = vm.createContext({
  document: {
    getElementById: id => els[id] || null,
    querySelector: s => (s === '.view-section.active' ? { id: 'view-' + active } : null),
    querySelectorAll: s => (s === '.menu-btn,.footer-status-btn' ? menuBtns : s === '#cf-header-tabs .cf-section-tab' ? cfTabs : []),
  },
  switchView: id => { switched.push(id); active = id; },
  switchCashFlowSection: (sec) => switched.push('section:' + sec),
  currentOwner: '전체',
});
vm.runInContext(nav, ctx);
const groups = JSON.parse(vm.runInContext('JSON.stringify(APP_NAV)', ctx));
assert.equal(groups.length, 8, '상위 메뉴 8개 그대로');
const sections = groups.flatMap(g => g.views.map(v => v[0]));
assert.deepEqual(sections, ['cdash', 'holdings', 'perf2', 'risk2', 'bubble', 'divm', 'plan2', 'rebal2', 'dca2', 'sim2', 'cashflow', 'tax2', 'gift2', 'report2']);
const hosted = JSON.parse(vm.runInContext('JSON.stringify(NAV_HOST)', ctx));
const modes = JSON.parse(vm.runInContext('JSON.stringify(NAV_MODES)', ctx));
assert.equal(sections.length + Object.keys(hosted).length, 19, '화면 19개(데이터 상태 제외) — 세부 메뉴 14 + 보기·탭으로 오가는 5');
for (const [view, host] of Object.entries(hosted)) {
  assert.ok(html.includes(`id="view-${view}"`), `${view} 화면은 그대로 있다(옛 #view= 주소)`);
  assert.ok(sections.includes(host), `${view} 의 자리 ${host} 는 세부 메뉴`);
  assert.equal(ctx.navGroup(view), ctx.navGroup(host), `${view} 는 ${host} 와 같은 메뉴 가족`);
}
assert.equal(ctx.navGroup('acct2').menu, 'holdings');
assert.equal(ctx.navGroup('etf2').menu, 'perf2', 'ETF 속 종목은 투자 분석 > 구성');
assert.equal(ctx.navGroup('cal2').menu, 'cashflow', '일정은 현금 흐름');
assert.equal(ctx.navGroup('reporty').menu, 'report2');
for (const [host, list] of Object.entries(modes)) {
  assert.equal(list[0][0], host, '첫 보기는 세부 메뉴 자신');
  for (const [view] of list.slice(1)) assert.equal(hosted[view], host, `${view} 보기는 ${host} 에 속한다`);
}
assert.ok(!modes.cashflow, '현금 흐름은 머리줄 탭이 맡는다(보기 줄 없음)');

// ── 보기 전환 줄: 보기가 있는 세부 메뉴에서만, 지금 보기를 aria-pressed 로 ──
active = 'acct2'; ctx.navSync('acct2');
const bar = els['view-mode-bar'];
assert.equal(bar.hidden, false);
assert.match(bar.innerHTML, /<button type="button" class="cb-btn" data-view-mode="holdings" aria-pressed="false" onclick="navMode\('holdings'\)">종목별<\/button>/);
assert.match(bar.innerHTML, /data-view-mode="acct2" aria-pressed="true"[^>]*>계좌별</);
assert.equal(bar.attrs['aria-label'], '보유 목록 보기 전환');
assert.equal(els['main-title'].textContent, '자산 관리');
assert.ok(menuBtns[1].classList.contains('active'), '사이드바는 자산 관리');
assert.equal(els['page-sections'].hidden, true, '자산 관리는 세부 메뉴가 하나라 숨긴다');
active = 'etf2'; ctx.navSync('etf2');
assert.match(els['page-sections'].innerHTML, /<a href="#view=bubble" aria-current="page"[^>]*switchView\(navModeTarget\('bubble'\)\);">구성<\/a>/, 'ETF 속 종목을 보는 동안 세부 메뉴는 구성');
assert.equal(ctx.navModeTarget('bubble'), 'etf2', '구성을 다시 누르면 마지막으로 본 보기');
active = 'cdash'; ctx.navSync('cdash');
assert.equal(bar.hidden, true, '보기가 없는 화면은 줄을 숨긴다');
assert.equal(bar.innerHTML, '');
active = 'acct2'; switched.length = 0; ctx.navMode('acct2'); assert.deepEqual(switched, [], '지금 보기를 누르면 아무 일 없음');
ctx.navMode('fam2'); assert.deepEqual(switched, ['fam2']);

// ── 현금 흐름 탭: 일정은 cal2 화면, 월별·고정비는 현금 흐름을 먼저 연 뒤 구역 전환 ──
active = 'cal2'; ctx.navSync('cal2');
assert.deepEqual(cfTabs.map(t => t.attrs['aria-selected']), ['false', 'false', 'true'], '일정 화면에서는 일정 탭이 선택');
switched.length = 0; ctx.cfSectionTab('fixed');
assert.deepEqual(switched, ['cashflow', 'section:fixed'], '현금 흐름 진입(구역이 월별로 돌아감) 뒤에 고정비로');
switched.length = 0; ctx.cfSectionTab('cal'); assert.deepEqual(switched, ['cal2']);
switched.length = 0; ctx.cfSectionTab('cal'); assert.deepEqual(switched, [], '이미 일정이면 그대로');
assert.match(html, /<button id="cf-section-tab-cal" class="cf-section-tab" type="button" role="tab" aria-selected="false" aria-controls="cb-cal2" onclick="cfSectionTab\('cal'\)">일정<\/button>/);
assert.match(html, /id="cf-section-tab-monthly"[^>]*onclick="cfSectionTab\('monthly'\)"/);
assert.match(html, /id="cf-section-tab-fixed"[^>]*onclick="cfSectionTab\('fixed'\)"/);
assert.match(ws, /\.content-area:has\(#view-cashflow\.active\) #cf-header-tabs,\.content-area:has\(#view-cal2\.active\) #cf-header-tabs\{display:flex\}/, '일정에서도 탭 줄이 보인다');

// ── 레거시 화면이 소유주를 '전체'로 되돌리지 않는 경우: navPrepare 의 표식(한 번 쓰고 지움) ──
const sv = script.match(/function switchView\(viewId, btn\) \{[\s\S]*?\n\}\n/)[0];
assert.match(sv, /const keepOwner = typeof _navKeepOwner!=='undefined' && _navKeepOwner;\n\s*if \(typeof _navKeepOwner!=='undefined'\) _navKeepOwner=false;\n\s*if \(viewId==='holdings' && !keepOwner\) \{/);
assert.match(sv, /if\(!keepOwner\) _cfOwner='전체';/);
assert.match(sv, /document\.getElementById\('cf-owner-'\+_cfOwner\)/, '이어 받은 현금 흐름 소유주 버튼을 켠다');

// ── 마크업·CSS: 머리줄 바로 아래(스크롤 영역 밖), 시뮬레이터 탭과 같은 밑줄형 한 벌 ──
assert.match(html, /<nav id="view-mode-bar" class="view-mode-bar" aria-label="보기 전환" hidden><\/nav>/);
const head = html.indexOf('id="page-head"'), barAt = html.indexOf('id="view-mode-bar"');
assert.ok(head < barAt && barAt < html.indexOf('id="view-cdash"'), '머리줄 뒤·화면들 앞(스크롤 영역 밖)');
assert.match(ws, /\.sim-view-tabs,\.view-mode-bar\{gap:4px;justify-content:flex-end;border-bottom:1px solid var\(--bd\);margin-bottom:12px\}/, '오른쪽 정렬 — 시뮬레이터 탭과 같은 규칙');
assert.match(ws, /\.sim-view-tabs>button\.cb-btn\[aria-pressed=true\],\.view-mode-bar>button\.cb-btn\[aria-pressed=true\]\{[^}]*box-shadow:inset 0 -2px 0 var\(--acc\)/, '선택은 밑줄');
assert.match(ws, /\.view-mode-bar\{display:flex;flex-shrink:0;/);
assert.match(ws, /\.view-mode-bar\[hidden\]\{display:none\}/);
assert.match(ws, /\.content-area:has\(#view-cal2\.active\) #cf-header-tabs\{order:-1\}/, '일정에서도 탭이 소유주 버튼 앞');

// ── 계좌별 보기 위 숫자 카드 = 보유 목록 숫자 카드(같은 함수, 새 계산 없음) ──
const rp = script.match(/function renderPortfolio\(owner, opts\) \{[\s\S]*?\n\}\n/)[0];
assert.match(rp, /const kpisOnly=!!\(opts&&opts\.kpisOnly\);/);
assert.match(rp, /if\(!kpisOnly&&_holdingsBrokerFilter!=='전체'&&!_stockSeen\.has\(_holdingsBrokerFilter\)\)_holdingsBrokerFilter='전체';/, '숫자 카드만 받을 때는 계좌 필터 상태를 건드리지 않는다');
assert.match(rp, /grpName==='주식'&&brokerF!=='전체'/, '숫자 카드만 받을 때는 계좌 필터를 \'전체\'로 본다');
const early = rp.indexOf('if(kpisOnly) return kpis;');
assert.ok(early > 0 && early < rp.indexOf('cbAssetMobile(kpis)') && early < rp.indexOf("getElementById('portfolio-tables')"), 'DOM·휴대폰 머리 보관 전에 돌아간다');
const pages = read('workspace-pages.js');
assert.match(pages, /const holdingsKpis=typeof renderPortfolio==='function'\?\(renderPortfolio\(_acctOwner,\{kpisOnly:true\}\)\|\|''\):'';\n\s*el\.innerHTML=`\$\{holdingsKpis\}<div class="acct-kind-grid">/, '숫자 카드 줄 → 계좌 종류 카드 줄(두 줄)');

// ── 홈 보유 표: 검색어가 없으면 처음 10줄 + 전체 보기(보유 목록으로, 소유주는 navPrepare 가 잇는다) ──
const cobalt = read('cobalt.js');
const hh = cobalt.match(/const HOME_HOLDINGS_LIMIT=10;\nfunction cbHomeHoldings\(rows\)\{[\s\S]*?\n\}\n/)[0];
assert.match(hh, /const shown=searching\?rows:rows\.slice\(0,HOME_HOLDINGS_LIMIT\);\n\s*const sel=shown\.find\(r=>r\.key===_cdashSel\)\|\|shown\[0\]\|\|null;/, '선택은 보이는 줄 안에서만');
assert.match(hh, /const maxVal=Math\.max\(0,\.\.\.rows\.map/, '막대 기준은 숨긴 줄까지 포함한 전체');
assert.match(hh, /<tbody>\$\{shown\.map\(row\)/);
assert.match(hh, /shown\.length<total\?`<button type="button" class="home-holdings-more" onclick="cbDashAllHoldings\(\)">전체 \$\{total\}종목 보기 ›<\/button>`/);
assert.match(cobalt, /function cbDashAllHoldings\(\)\{ switchView\('holdings'\); \}/);
assert.match(ws, /\.home-holdings-more\{[^}]*color:var\(--acc\)/, '새 버튼에는 글자색을 준다');

assert.doesNotMatch(script, /mt\.textContent = '자산 관리';/, '구성(비중 지도)에서 소유주를 골라도 제목은 투자 분석');
assert.match(script, /mt\.textContent = \(typeof navGroup==='function'&&navGroup\('bubble'\)\?\.title\)\|\|'투자 분석';/);

console.log('test_view_modes: ok');
