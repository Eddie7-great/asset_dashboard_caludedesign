// 움직임(2026-11-02)·로그인 화면: 들어갈 때만 움직이고, 토큰 곡선만 쓰며, 움직임 줄이기에서는 끈다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = f => fs.readFileSync(new URL(f, root), 'utf8');
const style = read('style.css'), ws = read('workspace-ui.css'), cobalt = read('cobalt.js'), script = read('script.js'), html = read('index.html');

// 토큰: 이즈 아웃/이즈 인·시간·간격
assert.match(style, /--ease-out:cubic-bezier\(\.22,1,\.36,1\);--ease-in:cubic-bezier\(\.4,0,1,1\);--dur-fast:150ms;--dur:240ms;--stagger:30ms;/);
assert.match(style, /\.view-section\{display:none;animation:fadeIn var\(--dur\) var\(--ease-out\);/);
// 스프링·바운스(곡선 값이 1 을 넘거나 0 미만)는 쓰지 않는다
for (const [file, src] of [['style.css', style], ['workspace-ui.css', ws]]) {
  for (const m of src.matchAll(/cubic-bezier\(([^)]*)\)/g)) {
    const ys = m[1].split(',').map(Number).filter((_, i) => i % 2 === 1);
    assert.ok(ys.every(y => y >= 0 && y <= 1), `${file} 에 튀는 곡선 ${m[0]} — 스프링·바운스는 쓰지 않는다`);
  }
}

// 순차 등장·막대 채움은 .is-entering 아래에서만 — 시세 갱신 재렌더 때는 다시 돌지 않는다
const block = ws.slice(ws.indexOf('/* ===== 움직임 (2026-11-02)'), ws.indexOf('/* ===== 공통 디자인 규칙 (2026-10-30)'));
assert.ok(block.length > 0, '움직임 블록은 공통 블록 앞');
for (const m of block.matchAll(/([^{}]+)\{[^}]*animation:cb(Rise|Grow)/g)) {
  const sels = m[1].trim();
  assert.ok(sels.split(/,(?![^(]*\))/).every(x => x.includes('.is-entering')), `들어갈 때만 움직여야 한다: ${sels}`);
}
assert.match(block, /@media\(min-width:1101px\)\{#add-modal\.active \.modal-content\{animation:cbSlideIn/, '넓은 화면 수정 패널은 오른쪽에서 슬라이드');
assert.match(block, /@media\(prefers-reduced-motion:reduce\)\{\.is-entering \*,#add-modal\.active \.modal-content,\.login-card,\.login-error\{animation:none!important\}/, '움직임 줄이기에서는 지연까지 끈다');
assert.match(style, /@media \(prefers-reduced-motion:reduce\)\{[\s\S]*?animation-duration:\.01ms!important/, '전역 줄이기 규칙 유지');

// switchView 래퍼가 is-entering 을 붙이고 700ms 뒤 뗀다 — 코발트·레거시 두 경로 모두
const mark = cobalt.match(/let _cbEnterTimer=null;\nfunction cbMarkEntering\(id\)\{[\s\S]*?\n\}/)[0];
const cls = new Set(), timers = [];
const view = { classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) }, offsetWidth: 1 };
const ctx = vm.createContext({ document: { querySelectorAll: () => [], getElementById: () => view }, setTimeout: (fn, ms) => { timers.push([fn, ms]); return timers.length; }, clearTimeout: () => {} });
vm.runInContext(mark.replace('let ', 'var '), ctx);
ctx.cbMarkEntering('cdash');
assert.ok(cls.has('is-entering'));
assert.equal(timers.at(-1)[1], 700);
timers.at(-1)[0]();
assert.ok(!cls.has('is-entering'), '시간이 지나면 떼어 재렌더가 움직이지 않게');
assert.equal((cobalt.match(/cbMarkEntering\(id\);/g) || []).length, 2, '코발트·레거시 화면 모두 표시');

// 로그인: 인증 경로는 그대로, 버튼 색은 토큰, 보기 버튼·Caps Lock 안내
assert.match(script, /loginToggleReveal\(false\);\n\s*await _loginFadeOut\(\);\n\s*_startDashboardAfterAuth\(\);/, '성공 시 숨김 → 페이드 → 대시보드');
const loginCss = style.slice(style.indexOf('/* 로그인 오버레이'), style.indexOf('=== 반응형 위생'));
assert.doesNotMatch(loginCss, /#1f5fbf/, '버튼 색 하드코딩 제거');
assert.match(loginCss, /\.login-btn \{[\s\S]*?background: var\(--acc\);\s*color: var\(--on-acc\);/);
assert.match(html, /<button type="button" class="login-reveal" id="login-reveal" aria-label="비밀번호 보기" aria-pressed="false" onclick="loginToggleReveal\(\)">/);
assert.match(html, /<p id="login-caps" class="login-caps" aria-live="polite" hidden>/);
assert.match(html, /<span class="login-mark" aria-hidden="true">/, '표식은 장식이라 읽지 않는다');
const fns = script.match(/function loginToggleReveal\(force\)\{[\s\S]*?\n\}\n[\s\S]*?function loginCapsCheck\(ev\)\{[\s\S]*?\n\}/)[0];
const pw = { type: 'password' }, attrs = {}, caps = { hidden: true };
const btn = { setAttribute: (k, v) => { attrs[k] = v; } };
const lctx = vm.createContext({ document: { getElementById: id => ({ 'login-pw': pw, 'login-reveal': btn, 'login-caps': caps })[id] } });
vm.runInContext(fns, lctx);
lctx.loginToggleReveal(); assert.equal(pw.type, 'text'); assert.equal(attrs['aria-pressed'], 'true'); assert.equal(attrs['aria-label'], '비밀번호 숨기기');
lctx.loginToggleReveal(false); assert.equal(pw.type, 'password'); assert.equal(attrs['aria-pressed'], 'false');
lctx.loginCapsCheck({ getModifierState: k => k === 'CapsLock' }); assert.equal(caps.hidden, false);
lctx.loginCapsCheck({ getModifierState: () => false }); assert.equal(caps.hidden, true);

console.log('ok - motion');

// 숫자 카운트업(2026-11-10): 기호·부호·단위는 그대로 두고 숫자만 0 → 최종값. 들어갈 때만, 금액 가리기·움직임 줄이기에서는 돌지 않는다.
const cu = cobalt.match(/function cbCountUpParts\(text\)\{[\s\S]*?\n\}\nfunction cbCountUpText\(parts,p\)\{[\s\S]*?\n\}/)[0];
const cctx = vm.createContext({});
vm.runInContext(cu, cctx);
const p1 = cctx.cbCountUpParts('+₩1,284,500');
assert.deepEqual({ ...p1 }, { pre: '+₩', num: 1284500, dec: 0, post: '' });
assert.equal(cctx.cbCountUpText(p1, 1), '+₩1,284,500', '끝 값은 원래 글자와 같다');
assert.equal(cctx.cbCountUpText(p1, 0), '+₩0');
assert.equal(cctx.cbCountUpText(cctx.cbCountUpParts('62점'), 1), '62점');
assert.equal(cctx.cbCountUpText(cctx.cbCountUpParts('-$1,234.50'), 1), '-$1,234.50', '소수 자릿수 유지');
assert.equal(cctx.cbCountUpParts('—'), null, '숫자가 없으면 건드리지 않는다');
assert.equal(cctx.cbCountUpParts('₩••••'), null, '가려진 금액은 건드리지 않는다');
const cuFn = cobalt.match(/function cbCountUp\(id\)\{[\s\S]*?\n\}/)[0];
assert.match(cuFn, /_amountPrivacyEnabled\) return;/, '금액 가리기 중에는 숫자를 움직이지 않는다');
assert.match(cuFn, /prefers-reduced-motion: reduce\)'\)\.matches\) return;/);
assert.match(cuFn, /isConnected/, '재렌더로 사라진 요소는 건드리지 않는다');
assert.equal((cobalt.match(/\n\s*cbCountUp\(id\);/g) || []).length, 2, '코발트·레거시 두 경로');
// 선 그리기는 들어갈 때만
assert.match(block, /\.is-entering \.fin-nw-line\{stroke-dasharray:1;animation:cbDraw /);
assert.match(read('finance.js'), /<path class="fin-nw-line" pathLength="1"/);
