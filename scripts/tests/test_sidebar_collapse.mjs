// 넓은 화면의 사이드바 접기/펴기 — 버튼·상태 저장·접근성·전환 애니메이션.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readSource } from './_source.mjs'

const root = new URL('../../', import.meta.url);
const read = (f) => readSource(f);
const html = read('index.html'), script = read('script.js'), ws = read('workspace-ui.css');

assert.match(html, /<aside class="glass-panel menu-col" id="app-sidebar"/);
assert.match(html, /<button id="side-collapse-btn" class="side-collapse-btn" type="button" onclick="toggleSideCollapsed\(\)" aria-controls="app-sidebar" aria-expanded="true"/);
// 버튼은 사이드바 왼쪽 위 — 머리말이 아니라 <aside> 바로 앞에 두고 고정 위치로 띄운다(접혀도 같은 자리에서 다시 편다)
assert.match(html, /<button id="side-collapse-btn"[^\n]*<\/button>\s*<aside class="glass-panel menu-col" id="app-sidebar"/, '버튼은 <aside> 바로 앞');
assert.doesNotMatch(html.slice(html.indexOf('id="page-head"'), html.indexOf('id="page-head"') + 3000), /side-collapse-btn/, '머리말 안에 두지 않는다');
const css = ws.slice(ws.indexOf('/* ===== 사이드바 접기/펴기'));
assert.match(css, /\.side-collapse-btn\{display:none\}\s*@media\(min-width:769px\)\{/, '휴대폰은 기존 햄버거 서랍만');
assert.match(css, /\.layout\{transition:grid-template-columns [^}]*var\(--ease-out\)/, '격자 폭을 애니메이션으로 줄인다');
assert.match(css, /body\.side-collapsed \.layout\{grid-template-columns:0px 1fr;gap:0;transition-timing-function:var\(--ease-in\)\}/, '접을 때는 가속 곡선');
assert.match(css, /\.side-collapse-btn\{position:fixed;top:22px;left:25px;/, '사이드바 왼쪽 위 고정');
// 빨려 들어가는 효과 — 버튼 중심을 기준점으로 작아지며 사라지고, 펼 때는 거꾸로
assert.match(css, /\.menu-col\{min-width:0;overflow:hidden;transform-origin:25px 22px;transition:opacity [^}]*transform [^}]*var\(--ease-out\)/);
assert.match(css, /body\.side-collapsed \.menu-col\{opacity:0;transform:scale\(\.06\);border-radius:50%;[^}]*pointer-events:none;transition-timing-function:var\(--ease-in\)\}/);
assert.match(css, /body\.side-collapsed #page-head\{padding-left:64px!important\}/, '접힌 동안 제목이 버튼 밑으로 들어가지 않게');
assert.match(css, /prefers-reduced-motion:reduce\)\{\.layout,\.menu-col,\.side-collapse-arrow,#page-head\{transition:none!important\}/);
assert.match(css, /\.menu-col>\*\{box-sizing:border-box;width:188px;flex-shrink:0\}/, '여백·테두리까지 188px — content-box 면 환율 상자 오른쪽이 잘린다');

// 동작: body 클래스·inert·aria·localStorage, 전환 뒤 차트 재배치 알림
const grab = (name) => script.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`))[0];
const store = new Map(), attrs = new Map(), classes = new Set(), events = [];
const el = (map) => ({ setAttribute: (k, v) => map.set(k, String(v)), removeAttribute: (k) => map.delete(k), title: '' });
const side = el(attrs), btnAttrs = new Map(), btn = el(btnAttrs);
const ctx = vm.createContext({
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
  document: { body: { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) } },
    querySelector: (s) => (s === '.menu-col' ? side : null), getElementById: (id) => (id === 'side-collapse-btn' ? btn : null) },
  window: { dispatchEvent: (e) => events.push(e.type) }, Event: class { constructor(t) { this.type = t; } },
  setTimeout: (fn) => fn(), clearTimeout: () => {}, _fitActiveCharts: () => events.push('fit'),
});
for (const n of ['_sideCollapsedSaved', 'applySideCollapsed', 'toggleSideCollapsed']) vm.runInContext(grab(n), ctx);
assert.equal(ctx._sideCollapsedSaved(), false);
ctx.toggleSideCollapsed();
assert.ok(classes.has('side-collapsed'));
assert.equal(attrs.get('inert'), '', '접힌 사이드바에는 포커스가 들어가지 않는다');
assert.equal(btnAttrs.get('aria-expanded'), 'false');
assert.equal(btnAttrs.get('aria-label'), '사이드 메뉴 펴기');
assert.equal(store.get('sideCollapsed'), '1', '화면 설정이라 localStorage 에만');
assert.deepEqual(events, ['resize', 'fit'], '전환이 끝나면 차트를 새 폭에 맞춘다');
ctx.toggleSideCollapsed();
assert.ok(!classes.has('side-collapsed')); assert.ok(!attrs.has('inert')); assert.equal(store.get('sideCollapsed'), '0');
assert.doesNotMatch(grab('applySideCollapsed'), /setKV|saveExtDataToKV/, 'KV 에 쓰지 않는다');
assert.match(script, /function _startDashboardAfterAuth\(\)\{\n  _setAuthenticatedUi\(true\);\n  if\(window\.innerWidth>768\) applySideCollapsed\(_sideCollapsedSaved\(\),false\);/, '다음 접속에도 상태 유지');
assert.match(grab('openSidebar'), /removeAttribute\('inert'\)/, '접어 둔 채 창을 좁혀도 휴대폰 서랍은 열린다');

console.log('PASS 사이드바 접기');
