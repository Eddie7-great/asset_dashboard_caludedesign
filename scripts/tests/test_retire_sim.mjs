// 은퇴 자금 예상(2026-11-10): 입력한 가정의 산수일 뿐이다. 저장하지 않고, 결과는 모두 오늘 돈의 가치다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sim = fs.readFileSync(new URL('../../simulator.js', import.meta.url), 'utf8');
const cobalt = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8');
const ctx = vm.createContext({ Math, Number });
vm.runInContext(sim.match(/function retCalculate\(input\)\{[\s\S]*?\n\}/)[0], ctx);
const calc = o => ctx.retCalculate({ age: 40, retireAge: 60, endAge: 90, current: 0, monthly: 0, ret: 0, infl: 0, ...o });
const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

// 수익률 0%·물가 0%: 넣은 돈이 그대로, 인출액은 단순 나눗셈
let r = calc({ current: 100_000_000, monthly: 1_000_000 });
near(r.fv, 100_000_000 + 1_000_000 * 240);
near(r.withdraw, 340_000_000 / 360);
near(r.growth, 0);
assert.equal(r.months, 240); assert.equal(r.drawMonths, 360);
// 수익률 = 물가 → 실질 0%: 오늘 가치로는 늘지 않는다
r = calc({ current: 100_000_000, ret: 3, infl: 3 });
near(r.fv, 100_000_000); near(r.realRate, 0, 1e-9);
// 목돈만, 실질 수익률 5%로 20년: (1.05)^20 배
r = calc({ current: 100_000_000, ret: 5 });
near(r.fv, 100_000_000 * Math.pow(1.05, 20), 5);
// 적립만: 월복리 연금 종가 공식과 일치
r = calc({ monthly: 500_000, ret: 6 });
const rm = Math.pow(1.06, 1 / 12) - 1;
near(r.fv, 500_000 * (Math.pow(1 + rm, 240) - 1) / rm, 5);
// 인출액을 그대로 꺼내 쓰면 마치는 나이에 0 이 된다
r = calc({ current: 300_000_000, monthly: 800_000, ret: 5, infl: 2 });
assert.equal(r.series.length, 51);
assert.equal(r.series[0].bal, 300_000_000);
near(r.series[20].bal, r.fv, 5);
near(r.series.at(-1).bal, 0, 5);
assert.ok(r.series.every(p => p.bal >= 0));
assert.ok(calc({ current: 1e8, ret: 6 }).withdraw > calc({ current: 1e8, ret: 4 }).withdraw, '수익률 가정이 높을수록 인출액이 크다');
// 물가를 빼면 결과가 줄어든다(같은 명목 수익률)
assert.ok(calc({ current: 1e8, ret: 5, infl: 2 }).fv < calc({ current: 1e8, ret: 5 }).fv);

// 입력 검증
for (const bad of [{ retireAge: 40 }, { retireAge: 101 }, { endAge: 60 }, { endAge: 121 }, { age: 40.5 }, { age: -1 }, { current: -1 }, { monthly: -1 }, { ret: 21 }, { ret: -11 }, { infl: 16 }, { ret: NaN }, { current: Infinity }])
  assert.ok(calc(bad).error, `거부해야 함: ${JSON.stringify(bad)}`);

// 화면: 세 번째 탭, 저장·전송 없음, 가정임을 밝힌다
assert.match(sim, /data-sim-view="retire" aria-pressed="\$\{_simView==='retire'\}" onclick="simView\('retire'\)">은퇴 자금 예상<\/button>/);
assert.doesNotMatch(sim, /\b(?:setKV|saveAssetsToKV|saveExtDataToKV|localStorage|fetch)\s*[.(]/, '시뮬레이터는 저장·전송하지 않는다');
assert.match(sim, /예측이나 투자 권유가 아니며 저장되지 않습니다/);
assert.match(sim, /세금·수수료·환율과 국민연금·퇴직연금 등 다른 소득은 넣지 않았습니다/);
assert.equal((sim.match(/id="ret-\$\{key\}" type="number" data-no-comma="1"/g) || []).length, 1, '숫자 입력은 data-no-comma');
assert.match(cobalt, /if\(_cobaltActive==='sim2'&&document\.getElementById\('sim-result'\)\)\{simUpdate\(\);retUpdate\(\);\}/, '시세 갱신 때 입력칸을 다시 만들지 않고 결과만 갱신');
console.log('PASS 은퇴 자금 예상');
