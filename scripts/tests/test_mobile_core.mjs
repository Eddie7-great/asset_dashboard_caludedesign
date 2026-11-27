// 휴대폰 핵심만 — 아래 탭 5개(2026-11-27 사용자 결정 B안).
// 휴대폰은 홈·보유·배당·현금 흐름·더보기만 열고, 화면마다 핵심 카드만 남긴다. PC 화면은 그대로다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = f => fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
const html = read('index.html'), nav = read('navigation.js'), css = read('workspace-ui.css'), cobalt = read('cobalt.js');

// 아래 탭: 다섯 버튼, 본문(main) 안, 순서 고정
const bar = html.slice(html.indexOf('<nav id="mobile-tabbar"'), html.indexOf('</nav>', html.indexOf('<nav id="mobile-tabbar"')));
assert.deepEqual([...bar.matchAll(/data-mtab="([^"]+)"/g)].map(m => m[1]), ['cdash', 'holdings', 'divm', 'cashflow', 'more2']);
assert.ok(html.indexOf('<nav id="mobile-tabbar"') < html.indexOf('</main>'));
assert.match(html, /<button id="mob-back" class="mob-back"[^>]*hidden>/, '더보기 안 화면의 돌아가기는 기본 숨김');
assert.match(html, /<div id="view-more2" class="view-section"><div class="cb-scroll" id="cb-more2">/);

// 더보기 = 여섯 화면, 휴대폰 예외 없음(사용자 결정)
assert.match(cobalt, /more2:cbRenderMore/);
assert.match(cobalt, /more2:'더보기'/);
const more = [...nav.slice(nav.indexOf('const MOB_MORE=['), nav.indexOf('];', nav.indexOf('const MOB_MORE=['))).matchAll(/view:'([^']+)'/g)].map(m => m[1]);
assert.deepEqual(more, ['perf2', 'perf2', 'risk2', 'plan2', 'report2', 'cal2']);
assert.match(nav, /navCfTabs\(id\);\n  mobSync\(id\);/, 'navSync 끝에서 휴대폰 탭 강조·화면 표식을 맞춘다');
assert.match(nav, /body\.dataset\.mview=id/);

// CSS: PC 에서는 숨기고, 휴대폰 규칙은 한 블록(768px) 안에만
const block = css.slice(css.indexOf('/* ===== 휴대폰 핵심만'));
assert.ok(css.indexOf('/* ===== 휴대폰 핵심만') > 0);
assert.match(block, /^\.mobile-tabbar,\.mob-back,\.cb-alloc-bar,\.cb-m-only\{display:none\}/m, 'PC 에서는 아래 탭·돌아가기·한 줄 막대가 없다');
const mq = block.slice(block.indexOf('@media(max-width:768px){'));
for (const sel of ['#view-cdash .kpi-divm', '#view-risk2 .cb-risk-extra', "#cb-plan2>:not(.fin-goal-grid)", '#view-risk2 .cb-risk-row-meter'])
  assert.ok(mq.includes(sel), '휴대폰에서 뺀다: ' + sel);
assert.doesNotMatch(block, /#[0-9a-f]{3,6}\b/i, '색은 토큰만');
assert.doesNotMatch(block, /font-size:\s*\d/, '글자 크기는 토큰');

// 리스크 판정 배지 줄 맞춤(2026-11-27 사용자 지적): 좁은 화면에서도 판정·값 칸은 고정 폭
assert.match(css, /\.cb-risk-row\{grid-template-columns:10px minmax\(0,1fr\) 44px 82px;/);
console.log('test_mobile_core: ok');
