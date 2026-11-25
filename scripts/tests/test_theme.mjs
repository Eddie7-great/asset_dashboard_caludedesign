// 테마: 라이트(기본) / 네이비 / 다크 — 모두 리퀴드 글래스(2026-11-24). 예전 판의 저장값은 한 번만 옮긴다(themeV 3).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readSource } from './_source.mjs'

const root = new URL('../../', import.meta.url);
const script = readSource('script.js');
const style = fs.readFileSync(new URL('style.css', root), 'utf8');
const ws = fs.readFileSync(new URL('workspace-ui.css', root), 'utf8');

const themes = script.match(/const THEMES = \[[^\]]*\];/)[0];
const savedTheme = script.match(/function _savedTheme\(\)\{[\s\S]*?\n\}/)[0];

function run(initial) {
  const store = new Map(Object.entries(initial));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  const ctx = vm.createContext({ localStorage });
  vm.runInContext(`${themes}\n${savedTheme}\nresult = _savedTheme();`, ctx);
  return { theme: ctx.result, store: Object.fromEntries(store) };
}

// 예전 저장값 이전
assert.equal(run({}).theme, 'default', '저장값이 없으면 라이트(기본)');
assert.equal(run({ theme: 'light' }).theme, 'default', '그 전 판 라이트는 라이트(기본)로');
assert.equal(run({ theme: 'navy' }).theme, 'navy', '그 전 판 네이비는 네이비로');
assert.equal(run({ theme: 'dark' }).theme, 'dark', '다크는 그대로');
assert.equal(run({ theme: 'navy' }).store.themeV, '3', '이전은 한 번만 — 버전 표식을 남긴다');
// themeV 2(기본/라이트/다크) 사용자: 기본·라이트 → 라이트(기본), 다크 → 다크
assert.equal(run({ theme: 'default', themeV: '2' }).theme, 'default');
assert.equal(run({ theme: 'light', themeV: '2' }).theme, 'default', '사이드바만 밝던 라이트는 새 라이트(기본)로');
assert.equal(run({ theme: 'dark', themeV: '2' }).theme, 'dark');
// 이전 후에는 고른 값을 그대로 쓴다
assert.equal(run({ theme: 'navy', themeV: '3' }).theme, 'navy');
assert.equal(run({ theme: 'light', themeV: '3' }).theme, 'default', '알 수 없는 값은 라이트(기본)');

// 다크·네이비가 어두운 바탕이다 (차트 색 분기)
assert.match(script, /function isDarkTheme\(\) \{\s*const t = document\.body\.getAttribute\('data-theme'\);\s*return t === 'dark' \|\| t === 'navy';/);

// CSS: 라이트는 :root, 다크·네이비는 공통 블록 + 네이비 덮어쓰기. 예전 '라이트(사이드바만)' 블록은 없다
assert.match(style, /:root \{[\s\S]*--side-bg:var\(--glass\);[\s\S]*--fs-title:22px;[\s\S]*--seg-bg:/, '라이트에 사이드바·크기·세그먼트 토큰');
assert.match(style, /\[data-theme="dark"\],\[data-theme="navy"\] \{[^}]*--side-bg:/, '다크·네이비 공통 토큰');
assert.match(style, /\[data-theme="navy"\] \{[^}]*--glass:rgba\(255,255,255,/, '네이비 유리판은 색 없는 흰 투명(2026-11-25)');
assert.match(style, /\[data-theme="navy"\] \{[^}]*--app-mesh:/, '네이비는 자기 배경 빛');
assert.match(style, /body\{[^}]*background:var\(--app-mesh\),var\(--app-base\)/, '바탕 = 빛 덩어리 + 기본 그라데이션');
assert.doesNotMatch(style, /\[data-theme="light"\]/, '사이드바만 밝던 라이트 블록은 없앴다');
// 유리 토큰은 세 테마 모두 정의하고, 카드는 반투명 바탕 + 옅은 그림자
for (const tok of ['--glass:rgba(', '--glass-edge:', '--glass-hi:', '--glass-rim:', '--app-mesh:', '--app-base:', '--glass-sheen:', '--gshadow:0 1px 2px']) {
  assert.ok(style.slice(style.indexOf(':root {'), style.indexOf('}', style.indexOf(':root {'))).includes(tok), '라이트 ' + tok);
}
assert.match(style, /\.glass-panel\.menu-col\{background:var\(--side-bg\)/, '사이드바는 --side-* 토큰으로만 칠한다');
// 유리 효과는 workspace-ui.css 끝 블록 한 곳 — :is() 로 묶지 않는다(#view-holdings 우선순위가 전체에 붙는다)
const glass = ws.slice(ws.indexOf('/* ===== 리퀴드 글래스'));
assert.ok(glass.length > 100, '리퀴드 글래스 블록');
assert.match(glass, /backdrop-filter:blur\(var\(--glass-blur\)\) saturate\(var\(--glass-sat\)\)/);
assert.doesNotMatch(glass.split('@media')[0], /:is\(\.glass-panel/, '유리판 선택자를 :is() 로 묶지 않는다');
assert.match(glass, /@media\(max-width:768px\)\{:root,body\{--glass-blur:10px/, '휴대폰은 흐림을 낮춘다');
assert.match(glass, /@media\(prefers-reduced-transparency:reduce\)\{[\s\S]*backdrop-filter:none;background:var\(--panelSolid\)/, '투명도 줄이기는 불투명 판');
assert.match(glass, /#login-overlay,\.boot-splash\{background:var\(--app-mesh\),var\(--app-base\)/, '로그인·로딩도 같은 배경');
assert.match(glass, /background:var\(--glass-sheen\),var\(--glass\)/, '유리판 = 빛 반사 + 색 없는 투명');
for (const th of ['', '[data-theme="dark"],[data-theme="navy"] {', '[data-theme="navy"] {']) {
  const blk = th ? style.slice(style.indexOf(th), style.indexOf('}', style.indexOf(th))) : style.slice(style.indexOf(':root {'), style.indexOf('}', style.indexOf(':root {')));
  const a = Number((blk.match(/--glass:rgba\(255,255,255,([.\d]+)\)/) || [])[1]);
  assert.ok(a > 0 && a <= 0.4, `유리판 불투명도는 0.4 이하여야 뒤가 비친다 (${th || ':root'}: ${a})`);
}

// 세그먼트·전환 탭은 선택 항목을 강조색 바탕으로 칠하지 않는다 — 시뮬레이터 종류 탭은 밑줄형
assert.match(ws, /\.sim-view-tabs>button\.cb-btn\[aria-pressed=true\](?:,\.view-mode-bar>button\.cb-btn\[aria-pressed=true\])?\{background:transparent;[^}]*box-shadow:inset 0 -2px 0 var\(--acc\)/, '시뮬레이터 탭은 밑줄로 선택 표시');

// --on-acc 는 강조색 바탕 위 글자색이다(다크의 밝은 강조색 위에 흰 글자는 읽히지 않는다).
// 시작 버튼(＋추가·＋수입·＋새 목표 추가)은 2026-11-16 부터 파랑 채움이 아니라 일반 버튼과 같은 중립 톤이다.
assert.match(style, /:root \{[^}]*--on-acc:#ffffff;/);
assert.match(style, /\[data-theme="dark"\],\[data-theme="navy"\] \{[^}]*--on-acc:#0b1020;/);
assert.match(style, /\[data-theme="navy"\] \{[^}]*--on-acc:#0a1733;/);
for (const sel of ['.holdings-add-btn', '.cf-entry-open', '.fin-goal-add-btn']) {
  const rule = ws.slice(ws.indexOf(sel + '{'), ws.indexOf('}', ws.indexOf(sel + '{')));
  assert.match(rule, /border:1px solid var\(--bd2\);background:var\(--inner\);color:var\(--tx\)/, sel + ' 는 중립 톤 버튼');
  assert.doesNotMatch(rule, /background:var\(--acc\)/, sel + ' 에 파랑 채움을 다시 쓰지 않는다');
}
// 현금 흐름 섹션 전환도 밑줄형
assert.match(ws, /\.cf-section-tabs \.cf-section-tab\.active\{background:transparent;[^}]*box-shadow:inset 0 -2px 0 var\(--acc\)/);

console.log('ok - theme');
