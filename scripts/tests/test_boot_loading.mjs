// 로그인 뒤 첫 로딩(2026-11-19, 시안 B) — 홈 모양 뼈대 + 맨 위 얇은 진행 줄.
// 단계 표시는 initDashboard 의 실제 대기에 붙고(순서·병렬 그대로), 시세 반영 뒤 뼈대를 걷는다.
// 자산 로드 실패·다른 화면 이동·세션 만료·안전 시간에는 바로 걷힌다. 움직임 줄이기에서는 반짝임·전환이 없다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = f => fs.readFileSync(new URL(f, root), 'utf8');
const html = read('index.html'), script = read('script.js'), cobalt = read('cobalt.js'), ws = read('workspace-ui.css');

// ── 마크업 ──
const sk = html.match(/<div id="boot-skeleton"[\s\S]*?\n    <\/div>/)[0];
assert.match(sk, /^<div id="boot-skeleton" class="boot-skeleton" aria-hidden="true" hidden>/, '뼈대는 화면 낭독에서 숨기고 처음엔 감춘다');
assert.equal((sk.match(/boot-sk-kpis">((?:<span class="boot-blk"><\/span>)+)/)[1].match(/boot-blk/g) || []).length, 5, '숫자 카드 5개');
assert.equal((sk.match(/boot-sk-cards">((?:<span class="boot-blk"><\/span>)+)/)[1].match(/boot-blk/g) || []).length, 4, '큰 카드 4개');
assert.match(sk, /id="boot-steps"/, '오른쪽 위 단계 표시');
assert.match(html, /<div id="boot-bar" class="boot-bar" aria-hidden="true" hidden><span><\/span><\/div>/, '맨 위 얇은 진행 줄');
assert.match(html, /<p id="boot-status" class="sr-only" role="status" aria-live="polite"><\/p>/, '진행 상황은 화면 낭독용 한 줄로 알린다');
assert.ok(html.indexOf('id="boot-status"') < html.indexOf('id="boot-skeleton"'), '알림 줄은 aria-hidden 뼈대 밖에 둔다');
assert.ok(html.indexOf('id="page-head"') < html.indexOf('id="boot-skeleton"') && html.indexOf('id="boot-skeleton"') < html.indexOf('id="view-cdash"'), '머리줄 뒤·화면들 앞');

// ── 시작·연결 ──
assert.match(script, /_dashboardInitStarted = true;\n  bootStart\(\);\n  initDashboard\(\);/, '첫 시작에만 뼈대를 띄운다');
const init = script.match(/function initDashboard\(\)\{[\s\S]*?\n\}\n/)[0];
assert.match(init, /Promise\.all\(\[\n\s*loadAssetsFromKV\(\)\.then\(r=>\{bootStep\('assets'\);if\(!r\?\.ok\)bootReveal\(\);return r;\}\),\n\s*loadExtDataFromKV\(\)\.then\(r=>\{bootStep\('ext'\);return r;\}\),\n\s*loadKoreanStocksDB\(\)\]\)/, '병렬 로드는 그대로, 끝날 때 단계만 표시');
assert.match(init, /try\{ if\(assetsResult\?\.ok\) await refreshMarketPrices\(\); \}\n\s*finally\{ bootStep\('prices'\); bootReveal\(\); \}/, '시세 반영 뒤(예외여도) 홈을 보인다');
assert.match(init, /refreshPyData\(\{includeDividends:[^)]*\}\)\n\s*\.finally\(\(\)=>bootStep\('market'\)\)/, '배당·환율은 뒤에서 이어 마지막 단계');
assert.ok(init.indexOf("switchView('dashboard'") < init.indexOf('bootStep('), '홈을 먼저 열고 그 위를 뼈대가 덮는다');
assert.match(script, /if \(res\.status === 401\) \{\n\s*bootFinish\(\);/, '세션 만료면 뼈대를 남기지 않는다');
assert.match(cobalt, /switchView = function\(id, btn\)\{\n  id=navResolve\(id\);\n[^\n]*\n  if \(id!=='cdash' && typeof bootReveal==='function'\) bootReveal\(\);/, '다른 화면으로 가면 뼈대만 걷는다(처음 여는 홈은 제외)');

// ── 동작(가짜 DOM) ──
const boot = script.match(/const BOOT_STEPS=[\s\S]*?\nfunction bootFinish\(\)\{[\s\S]*?\n\}\n/)[0];
function makeEl(id) {
  const cls = new Set();
  return { id, hidden: true, innerHTML: '', textContent: '', style: {},
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) } };
}
function run({ reduce = false } = {}) {
  const els = Object.fromEntries(['boot-skeleton', 'boot-bar', 'boot-steps', 'boot-status'].map(id => [id, makeEl(id)]));
  const fill = { style: {} }, body = makeEl('body'), timers = [], calls = [];
  const ctx = vm.createContext({
    document: { body, getElementById: id => els[id] || null,
      querySelector: s => (s === '#boot-bar>span' ? fill : s === '.view-section.active' ? { id: 'view-cdash' } : null) },
    matchMedia: () => ({ matches: reduce }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: n => { if (timers[n - 1]) timers[n - 1].cleared = true; },
    requestAnimationFrame: fn => fn(),
    cbMarkEntering: id => calls.push('enter:' + id), cbCountUp: id => calls.push('count:' + id), _fitActiveCharts: () => calls.push('fit'),
  });
  vm.runInContext(boot.replace(/^const /gm, 'var ').replace(/^let /gm, 'var '), ctx);
  return { ctx, els, fill, body, timers, calls };
}
{
  const t = run();
  t.ctx.bootStart();
  assert.equal(t.els['boot-skeleton'].hidden, false);
  assert.equal(t.els['boot-bar'].hidden, false);
  assert.ok(t.body.classList.contains('is-booting'));
  assert.match(t.els['boot-steps'].innerHTML, /보유 자산 불러오는 중 · 1\/5/, '로그인 확인은 이미 끝난 단계');
  assert.match(t.els['boot-status'].textContent, /보유 자산 불러오는 중 \(1\/5\)/);
  assert.equal(t.fill.style.transform, 'scaleX(0.2)');
  assert.equal(t.timers[0].ms, 25000, '안전 시간 25초');
  t.ctx.bootStep('ext'); t.ctx.bootStep('assets'); t.ctx.bootStep('assets');
  assert.match(t.els['boot-steps'].innerHTML, /시세 반영 중 · 3\/5/, '단계는 끝난 순서와 무관하게 다음 미완료 단계를 보인다');
  assert.equal((t.els['boot-steps'].innerHTML.match(/class="is-done"/g) || []).length, 3);
  assert.ok(t.body.classList.contains('is-booting'), '시세 전에는 걷지 않는다');
  t.ctx.bootStep('prices'); t.ctx.bootReveal();
  assert.ok(!t.body.classList.contains('is-booting'), '시세 반영 뒤 화면이 보인다');
  assert.ok(t.els['boot-skeleton'].classList.contains('is-leaving'), '페이드로 걷는다');
  assert.equal(t.els['boot-bar'].hidden, false, '진행 줄은 남는다');
  assert.deepEqual(t.calls.slice(0, 2), ['enter:cdash', 'count:cdash'], '걷는 순간 등장 움직임·숫자 올리기');
  const tail = t.timers.find(x => x.ms === 8000); assert.ok(tail, '배당·환율은 최대 8초만 기다린다');
  t.timers.find(x => x.ms === 240).fn(); assert.equal(t.els['boot-skeleton'].hidden, true);
  t.ctx.bootStep('market');
  assert.equal(t.fill.style.transform, 'scaleX(1)');
  assert.ok(t.els['boot-bar'].classList.contains('is-done'));
  assert.ok(t.timers[0].cleared && tail.cleared, '끝나면 안전·꼬리 타이머를 지운다');
  assert.equal(t.els['boot-status'].textContent, '불러오기 완료');
  t.ctx.bootStep('market'); t.ctx.bootReveal(); t.ctx.bootFinish();   // 끝난 뒤 호출은 아무 일도 하지 않는다
}
{ // 자산 로드 실패 → 바로 걷힘(오류 안내가 보이게), 안전 시간에는 무조건 끝
  const t = run();
  t.ctx.bootStart(); t.ctx.bootStep('assets'); t.ctx.bootReveal();
  assert.ok(!t.body.classList.contains('is-booting'));
  t.timers[0].fn();
  assert.ok(t.els['boot-bar'].classList.contains('is-done'), '안전 시간이 지나면 진행 줄도 걷힌다');
}
{ // 움직임 줄이기 — 페이드 없이 바로 숨긴다
  const t = run({ reduce: true });
  t.ctx.bootStart(); t.ctx.bootFinish();
  assert.equal(t.els['boot-skeleton'].hidden, true);
  assert.equal(t.els['boot-bar'].hidden, true);
  assert.ok(!t.els['boot-skeleton'].classList.contains('is-leaving'));
}

// ── CSS ──
const block = ws.slice(ws.indexOf('/* ===== 로그인 뒤 첫 로딩(2026-11-19'));
assert.ok(block.length > 0 && ws.lastIndexOf('/* ===== ') === ws.indexOf('/* ===== 로그인 뒤 첫 로딩(2026-11-19'), '파일 끝 블록');
assert.match(block, /body\.is-booting \.content-area>\.view-section\{visibility:hidden\}/, '화면은 자리를 지킨 채 숨긴다');
assert.match(block, /@media\(prefers-reduced-motion:reduce\)\{\.boot-blk\{animation:none!important;[^}]*\}\.boot-bar,\.boot-bar>span,\.boot-skeleton\{transition:none!important\}\}/, '움직임 줄이기에서는 반짝임·전환 없음');
assert.match(block, /@media\(max-width:768px\)\{[^\n]*\.boot-sk-kpis\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\.boot-sk-cards\{grid-template-columns:1fr\}/, '휴대폰은 카드 2열·큰 카드 1열');
assert.doesNotMatch(block, /#[0-9a-f]{3,6}\b/i, '색은 토큰만');
assert.doesNotMatch(block, /font-size:\s*\d/, '글자 크기는 토큰');

console.log('test_boot_loading: ok');
