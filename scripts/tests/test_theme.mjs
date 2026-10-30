// 테마: 기본(밝은 본문 + 진한 사이드바) / 라이트 / 다크. 예전 판(라이트·다크·네이비)의 저장값은 한 번만 옮긴다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const script = fs.readFileSync(new URL('script.js', root), 'utf8');
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

// 예전 저장값 이전 (themeV 없음)
assert.equal(run({}).theme, 'default', '저장값이 없으면 기본');
assert.equal(run({ theme: 'light' }).theme, 'default', '예전 라이트(지금 기본과 같은 본문)는 기본으로');
assert.equal(run({ theme: 'navy' }).theme, 'dark', '네이비는 다크로');
assert.equal(run({ theme: 'dark' }).theme, 'dark', '다크는 그대로');
assert.equal(run({ theme: 'navy' }).store.themeV, '2', '이전은 한 번만 — 버전 표식을 남긴다');

// 이전 후에는 사용자가 고른 값을 그대로 쓴다 (새 라이트를 기본으로 되돌리지 않는다)
assert.equal(run({ theme: 'light', themeV: '2' }).theme, 'light', '이전 뒤 고른 라이트는 유지');
assert.equal(run({ theme: 'default', themeV: '2' }).theme, 'default');
assert.equal(run({ theme: 'navy', themeV: '2' }).theme, 'default', '알 수 없는 값은 기본');

// 다크만 어두운 테마로 본다 (차트 색 분기)
assert.match(script, /function isDarkTheme\(\) \{\s*return document\.body\.getAttribute\('data-theme'\) === 'dark';/);

// CSS: 기본은 :root, 라이트는 사이드바 토큰만 덮어쓴다, 네이비 토큰은 없다
assert.match(style, /:root \{[\s\S]*--side-bg:#18213a;[\s\S]*--fs-title:22px;[\s\S]*--seg-bg:/, '기본 테마에 사이드바·크기·세그먼트 토큰');
assert.match(style, /\[data-theme="light"\] \{[^}]*--side-bg:#ffffff;/, '라이트는 사이드바를 흰 카드로');
assert.match(style, /\[data-theme="dark"\] \{[^}]*--side-bg:/, '다크도 사이드바 토큰을 정의');
assert.doesNotMatch(style, /data-theme="navy"/, '네이비 토큰 삭제');
assert.match(style, /:root \{[^}]*--gshadow:none;/, '카드 그림자 없음');
assert.match(style, /\.glass-panel\.menu-col\{background:var\(--side-bg\)/, '사이드바는 --side-* 토큰으로만 칠한다');

// 세그먼트·전환 탭은 선택 항목을 강조색 바탕으로 칠하지 않는다 — 시뮬레이터 종류 탭은 밑줄형
assert.match(ws, /\.sim-view-tabs>button\.cb-btn\[aria-pressed=true\]\{background:transparent;[^}]*box-shadow:inset 0 -2px 0 var\(--acc\)/, '시뮬레이터 탭은 밑줄로 선택 표시');

// 강조색 버튼 글자는 --on-acc — 다크의 밝은 강조색 위에 흰 글자는 읽히지 않는다
assert.match(style, /:root \{[^}]*--on-acc:#ffffff;/);
assert.match(style, /\[data-theme="dark"\] \{[^}]*--on-acc:#0b1020;/);
for (const sel of ['.holdings-add-btn', '.cf-entry-open', '.fin-goal-add-btn']) {
  const rule = ws.slice(ws.indexOf(sel + '{'), ws.indexOf('}', ws.indexOf(sel + '{')));
  assert.match(rule, /color:var\(--on-acc\)/, sel + ' 글자색은 --on-acc');
}
// 현금 흐름 섹션 전환도 밑줄형
assert.match(ws, /\.cf-section-tabs \.cf-section-tab\.active\{background:transparent;[^}]*box-shadow:inset 0 -2px 0 var\(--acc\)/);

console.log('ok - theme');
