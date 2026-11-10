// 3D 자산 배분은 선택적 효과다: 휴대폰에서는 라이브러리를 불러오지 않고, 불러오기·WebGL 이 실패하면
// SVG 로 남기며 같은 차트에서 다시 시도하지 않는다. (이 파일은 그동안 테스트가 하나도 없었다)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../../allocation-3d.js', import.meta.url), 'utf8');
assert.match(src, /import\('\.\/vendor\/three\.module\.min\.js'\)/, 'Three.js 는 CDN 이 아니라 로컬 고정 사본');
assert.match(src, /if\(dead \|\| !visible \|\| document\.hidden\) return;/, '화면 밖·숨긴 탭에서는 프레임 루프를 멈춘다');
assert.match(src, /mesh\.geometry\.dispose\(\);mesh\.material\.dispose\(\)/, '해제 시 geometry·material 정리');
assert.match(src, /renderer\.dispose\(\);renderer\.forceContextLoss\(\)/);

function boot(desktopMatches) {
  const cls = new Set(['has-3d']);
  const host = { dataset: {}, classList: { add: c => cls.add(c), remove: c => cls.delete(c) }, getBoundingClientRect: () => ({ top: 10, bottom: 200 }) };
  const frames = [], warns = [];
  const ctx = vm.createContext({
    matchMedia: q => ({ matches: q.includes('min-width') ? desktopMatches : false, addEventListener() {} }),
    document: { querySelector: sel => (sel.includes('cb-allocation-visual') ? host : null), body: {}, addEventListener() {}, hidden: false },
    window: { addEventListener() {} }, innerHeight: 900, console: { warn: (...a) => warns.push(a) },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, cancelAnimationFrame() {},
  });
  vm.runInContext(src, ctx);   // vm 스크립트의 동적 import 는 거부된다 → 불러오기 실패 경로를 그대로 탄다
  return { host, cls, frames, warns, ctx };
}
const tick = () => new Promise(r => setTimeout(r, 0));

const mobile = boot(false);
mobile.frames.shift()(); await tick();
assert.equal(mobile.host.dataset.webglFailed, undefined, '휴대폰 폭에서는 불러오기를 시도하지 않는다');
assert.equal(mobile.warns.length, 0);

const desktop = boot(true);
assert.equal(typeof desktop.ctx.window.AssetAllocation3D.sync, 'function');
desktop.frames.shift()(); await tick(); await tick();
assert.equal(desktop.host.dataset.webglFailed, 'true', '불러오기 실패 → SVG 로 남긴다');
assert.ok(!desktop.cls.has('has-3d'));
assert.equal(desktop.warns.length, 1);
desktop.ctx.window.AssetAllocation3D.sync(); desktop.frames.shift()(); await tick(); await tick();
assert.equal(desktop.warns.length, 1, '실패한 차트에서는 다시 시도하지 않는다');
console.log('PASS 3D 자산 배분 폴백');
