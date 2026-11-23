// 로그인 뒤 첫 로딩(2026-11-20, 시안 D — 사용자 결정) — 화면 전체 스플래시: 로고 막대가 차례로 자라고 단계 점 4개가 하나씩 켜진다.
// 단계 표시는 initDashboard 의 실제 대기에 붙고(순서·병렬 그대로), 시세 반영이 끝나면 걷는다(8차 사용자 결정 — 배당·환율은 기다리지 않는다).
// 자산 로드 실패·다른 화면 이동·세션 만료·안전 시간에는 바로 걷힌다. 덮는 동안 본문은 inert, 진행 알림은 본문 밖이다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readSource } from './_source.mjs'

const root = new URL('../../', import.meta.url);
const read = f => readSource(f);
const html = read('index.html'), script = read('script.js'), cobalt = read('cobalt.js'), ws = read('workspace-ui.css'), style = read('style.css');

// ── 마크업: 본문(.layout) 밖, 로그인 화면 뒤 ──
const sp = html.match(/<div id="boot-splash"[\s\S]*?\n<\/div>\n/)[0];
assert.match(sp, /^<div id="boot-splash" class="boot-splash" aria-hidden="true">/, '처음부터 보이는 상태로 로그인 화면 아래 깔려 있다(hidden 없음)');
assert.match(sp, /<rect class="boot-bar1"[^>]*\/><rect class="boot-bar2"[^>]*\/><rect class="boot-bar3"[^>]*\/>/, '로그인 표식과 같은 막대 세 개');
assert.equal((sp.match(/<li><\/li>/g) || []).length, 4, '단계 점 4개');
assert.match(sp, /<p class="boot-title">가족 자산 관리<\/p>/);
assert.match(sp, /id="boot-step"/);
assert.match(html, /<p id="boot-status" class="sr-only" role="status" aria-live="polite"><\/p>/, '진행 상황은 화면 낭독용 한 줄');
const at = k => html.indexOf(k);
assert.ok(at('id="login-overlay"') < at('id="boot-status"') && at('id="boot-splash"') < at('<div class="layout"'), '스플래시·알림 줄은 inert 가 걸리는 본문(.layout) 밖');
assert.doesNotMatch(html, /id="boot-skeleton"|id="boot-bar"/, '시안 B 의 뼈대·진행 줄은 없앴다');

// ── 연결 ──
assert.match(script, /_dashboardInitStarted = true;\n  bootStart\(\);\n  initDashboard\(\);/, '첫 시작에만');
const init = script.match(/function initDashboard\(\)\{[\s\S]*?\n\}\n/)[0];
assert.match(init, /loadAssetsFromKV\(\)\.then\(r=>\{bootStep\('assets'\);if\(!r\?\.ok\)bootReveal\(\);return r;\}\)/, '자산 로드 실패면 바로 걷는다');
assert.match(init, /loadExtDataFromKV\(\)\.then\(r=>\{bootStep\('ext'\);return r;\}\)/);
assert.match(init, /try\{ if\(assetsResult\?\.ok\) await refreshMarketPrices\(\); \}\n\s*finally\{ bootStep\('prices'\); \}/, '시세 반영이 끝나면 걷는다(시세 조회가 예외여도)');
assert.match(init, /refreshPyData\(\{includeDividends:[^)]*\}\)\n\s*\.catch\(/, '배당·환율은 뒤에서 돌고 로딩 화면은 기다리지 않는다');
assert.doesNotMatch(script + cobalt, /bootWaitTail|BOOT_TAIL_MS|bootStep\('market'\)/, '예전 배당·환율 대기(최대 8초)는 없앴다');
assert.match(script, /const BOOT_STEPS=\[\['auth','로그인 확인'\],\['assets','보유 자산 불러오는 중'\],\['ext','재무 기록 불러오는 중'\],\['prices','시세 반영 중'\]\];/, '4단계');
assert.match(script, /if \(res\.status === 401\) \{\n\s*bootFinish\(\);/, '세션 만료면 걷는다');
assert.match(cobalt, /if \(id!=='cdash' && typeof bootReveal==='function'\) bootReveal\(\);/, '다른 화면으로 가면 걷는다');

// ── 동작(가짜 DOM) ──
const boot = script.match(/const BOOT_STEPS=[\s\S]*?\nfunction bootFinish\(\)\{[\s\S]*?\n\}\n/)[0];
function makeEl(id) {
  const cls = new Set(), attrs = {}, props = {};
  return { id, hidden: false, textContent: '', className: '', style: { display: '', setProperty: (k, v) => { props[k] = v; } }, props,
    setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: k => { delete attrs[k]; }, hasAttribute: k => k in attrs,
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) } };
}
function run({ reduce = false, loginShown = false } = {}) {
  const els = Object.fromEntries(['boot-splash', 'boot-step', 'boot-status', 'login-overlay'].map(id => [id, makeEl(id)]));
  if (loginShown) els['login-overlay'].style.display = 'flex';
  const layout = makeEl('layout'), dots = [0, 1, 2, 3].map(k => makeEl('dot' + k)), timers = [], calls = [];
  const ctx = vm.createContext({
    document: { getElementById: id => els[id] || null,
      querySelector: s => (s === '.layout' ? layout : s === '.view-section.active' ? { id: 'view-cdash' } : null),
      querySelectorAll: s => (s === '#boot-dots>li' ? dots : []) },
    matchMedia: () => ({ matches: reduce }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: n => { if (timers[n - 1]) timers[n - 1].cleared = true; },
    requestAnimationFrame: fn => fn(),
    cbMarkEntering: id => calls.push('enter:' + id), cbCountUp: id => calls.push('count:' + id), _fitActiveCharts: () => calls.push('fit'),
  });
  vm.runInContext(boot.replace(/^const /gm, 'var ').replace(/^let /gm, 'var '), ctx);
  return { ctx, els, layout, dots, timers, calls };
}
{
  const t = run();
  assert.deepEqual([...t.ctx.bootGrowth(0.2)].map(v => +v.toFixed(2)), [0.56, 0, 0], '막대는 첫 번째부터 차례로');
  assert.deepEqual([...t.ctx.bootGrowth(0.6)].map(v => +v.toFixed(2)), [1, 0.89, 0.11]);
  assert.deepEqual([...t.ctx.bootGrowth(1)], [1, 1, 1]);
  t.ctx.bootStart();
  assert.equal(t.els['boot-splash'].hidden, false);
  assert.ok(t.layout.hasAttribute('inert'), '덮는 동안 본문은 inert');
  assert.deepEqual(t.dots.map(d => d.className), ['is-done', 'is-now', '', ''], '로그인 확인은 끝난 단계');
  assert.equal(t.els['boot-step'].textContent, '보유 자산 불러오는 중 …');
  assert.equal(t.els['boot-status'].textContent, '보유 자산 불러오는 중 (1/4)');
  assert.equal(t.els['boot-splash'].props['--g1'], '0.694');
  assert.equal(t.timers[0].ms, 25000, '안전 시간 25초');
  t.ctx.bootStep('ext'); t.ctx.bootStep('assets'); t.ctx.bootStep('assets');
  assert.deepEqual(t.dots.map(d => d.className), ['is-done', 'is-done', 'is-done', 'is-now'], '끝난 순서와 무관하게 다음 미완료 단계');
  assert.equal(t.timers.length, 1, '시세 전에는 걷지 않는다');
  t.ctx.bootStep('prices');
  assert.equal(t.els['boot-step'].textContent, '준비 완료');
  const fin = t.timers.at(-1); assert.equal(fin.ms, 320, '시세 반영까지 끝나면 마지막 막대가 다 자라는 걸 보고 걷는다'); fin.fn();
  assert.ok(t.els['boot-splash'].classList.contains('is-leaving'), '페이드로 걷는다');
  assert.ok(!t.layout.hasAttribute('inert'), '걷으면 본문 잠금 해제');
  assert.deepEqual(t.calls.slice(0, 2), ['enter:cdash', 'count:cdash'], '걷는 순간 등장 움직임·숫자 올리기');
  assert.ok(t.timers[0].cleared, '안전 시계를 지운다');
  t.timers.find(x => x.ms === 240).fn(); assert.equal(t.els['boot-splash'].hidden, true);
  assert.equal(t.els['boot-status'].textContent, '불러오기 완료');
  t.ctx.bootStep('prices'); t.ctx.bootReveal(); t.ctx.bootFinish();   // 끝난 뒤 호출은 아무 일도 하지 않는다
}
{ // 자산 로드 실패 → 바로 걷힘, 안전 시간 / 로그인 화면이 다시 떠 있으면 본문 잠금 유지
  const t = run();
  t.ctx.bootStart(); t.ctx.bootReveal();
  assert.ok(!t.layout.hasAttribute('inert'));
  const t2 = run({ loginShown: true });
  t2.ctx.bootStart(); t2.timers[0].fn();
  assert.ok(t2.layout.hasAttribute('inert'), '세션이 끊겨 로그인 화면이 다시 떠 있으면 잠금을 풀지 않는다');
}
{ // 움직임 줄이기 — 페이드·지연 없이 바로
  const t = run({ reduce: true });
  t.ctx.bootStart(); ['assets', 'ext', 'prices'].forEach(k => t.ctx.bootStep(k));
  assert.equal(t.timers.at(-1).ms, 0); t.timers.at(-1).fn();
  assert.equal(t.els['boot-splash'].hidden, true);
  assert.ok(!t.els['boot-splash'].classList.contains('is-leaving'));
}

// ── CSS ──
const block = ws.slice(ws.indexOf('/* ===== 로그인 뒤 첫 로딩(2026-11-20, 시안 D)'));
assert.ok(ws.indexOf('/* ===== 로그인 뒤 첫 로딩(2026-11-20, 시안 D)') > 0);
assert.match(block, /\.boot-splash\{position:fixed;inset:0;z-index:9000;[^}]*background:var\(--bg2,var\(--bg1\)\)/, '로그인 화면과 같은 바탕, 로그인 화면(10000) 아래');
assert.match(block, /\.boot-mark rect\.boot-bar1\{transform:scaleY\(var\(--g1,0\)\)\}/);
assert.match(block, /\.boot-mark\{[^}]*background:var\(--kpi-hi-bg\)/, '로그인 표식과 같은 토큰');
assert.match(style, /\.login-mark rect:last-child, \.boot-mark rect\.boot-bar3 \{ fill: #5b9bff; \}/, '마지막 막대 색은 로그인 표식과 한 규칙');
assert.match(block, /@media\(prefers-reduced-motion:reduce\)\{\.boot-splash,\.boot-mark rect,\.boot-dots>li\{transition:none!important\}\.boot-dots>li\.is-now\{animation:none!important\}\}/, '움직임 줄이기에서는 전환·고리 깜빡임 없음');
assert.doesNotMatch(block, /#[0-9a-f]{3,6}\b/i, '색은 토큰만');
assert.doesNotMatch(block, /font-size:\s*\d/, '글자 크기는 토큰');
assert.doesNotMatch(ws, /\.boot-skeleton|\.boot-blk|is-booting/, '시안 B 규칙은 지웠다');

console.log('test_boot_loading: ok');
