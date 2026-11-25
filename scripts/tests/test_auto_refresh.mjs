// 자동 새로고침(2026-11-25 사용자 요청) — 화면이 보이는 동안 시세가 10분 넘게 묵으면 스스로 다시 받는다.
// 날짜가 바뀌면 배당·벤치마크까지, 같은 날엔 시세·환율만. 안 보이는 탭·입력 중·창 열림·첫 로딩 중에는 부르지 않는다.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readSource } from './_source.mjs'

const script = readSource('script.js');
function extract(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} 없음`);
  const asyncStart = script.slice(Math.max(0, start - 6), start) === 'async ' ? start - 6 : start;
  let i = script.indexOf('{', start), depth = 0;
  for (; i < script.length; i++) { if (script[i] === '{') depth++; else if (script[i] === '}' && --depth === 0) break; }
  return script.slice(asyncStart, i + 1);
}
const MIN = 10 * 60 * 1000;
const ctx = { AUTO_REFRESH_MIN_MS: MIN };
vm.createContext(ctx);
vm.runInContext(extract('autoRefreshPlan'), ctx);
const base = { ready: true, visible: true, busy: false, editing: false, now: 1_000_000_000, lastAt: 1_000_000_000 - MIN, lastDay: '2026-11-25', today: '2026-11-25' };
const plan = o => { const r = ctx.autoRefreshPlan({ ...base, ...o }); return r == null ? null : [...r]; };

assert.deepEqual(plan({}), ['prices', 'rates'], '같은 날 10분이 지나면 시세·환율만 다시 받는다');
assert.equal(plan({ lastAt: base.now - MIN + 1 }), null, '10분이 안 지났으면 부르지 않는다');
assert.deepEqual(plan({ lastAt: base.now - 1000, today: '2026-11-26' }), ['prices', 'rates', 'dividends', 'benchmark'], '날짜가 바뀌면 배당·벤치마크까지');
assert.equal(plan({ visible: false }), null, '안 보이는 탭은 부르지 않는다');
assert.equal(plan({ editing: true }), null, '입력 중·창 열림이면 미룬다');
assert.equal(plan({ busy: true }), null, '새로고침이 이미 돌고 있으면 겹치지 않는다');
assert.equal(plan({ ready: false }), null, '로그인 전·첫 로딩 중이면 부르지 않는다');
assert.equal(plan({ lastAt: 0 }), null, '첫 조회가 시작되기 전이면 부르지 않는다');

// 배선: 시세 조회가 기준 시각을 찍고, 화면 이동·탭 복귀·1분 점검이 판단을 부르고, 버튼과 같은 경로(manualRefresh)를 쓴다.
assert.match(extract('refreshMarketPrices'), /_markMarketRefreshStart\(\)/, '시세 조회를 시작할 때 기준 시각을 찍는다');
assert.match(extract('autoRefreshIfStale'), /return manualRefresh\(plan\)/, '자동 새로고침은 버튼과 같은 경로');
assert.match(extract('manualRefresh'), /const keys=Array\.isArray\(source\)\?source:\[source\];/, 'manualRefresh 는 출처 키 배열을 받는다');
const start = extract('startAutoRefresh');
assert.match(start, /visibilitychange/, '탭으로 돌아오면 확인');
assert.match(start, /setInterval\(\(\)=>autoRefreshIfStale\(\),AUTO_REFRESH_CHECK_MS\)/, '보이는 동안 1분마다 확인');
assert.match(extract('switchView'), /setTimeout\(autoRefreshIfStale,0\)/, '다른 화면을 열 때도 확인');
assert.match(extract('initDashboard'), /startAutoRefresh\(\);/, '로그인 뒤 첫 로딩을 시작하며 켠다');
assert.equal(ctx.AUTO_REFRESH_MIN_MS, MIN);
assert.match(script, /const AUTO_REFRESH_MIN_MS = 10\*60\*1000;/, '간격 10분 — 시세가 직전 종가 기준이라 더 자주 부를 이유가 없다');

// manualRefresh 에 배열을 주면 'all' 전용 단계(원장 다시 읽기·스냅샷 저장)는 건너뛴다.
{
  const calls = [];
  const c = {
    window: { _kvLoadState: { assets: 'ready', ext: 'ready' } },
    document: { getElementById: () => null, querySelector: () => null },
    console,
    loadAssetsFromKV: async () => { calls.push('assets'); return { ok: true }; },
    loadExtDataFromKV: async () => { calls.push('ext'); return { ok: true }; },
    applyAutoTransfers: () => calls.push('auto'),
    refreshMarketPrices: async () => { calls.push('prices'); return { ok: true }; },
    checkSplitAdjustments: () => calls.push('split'),
    fetchDivData: async () => { calls.push('div'); return { ok: true }; },
    refreshPyData: async o => { calls.push('rates:' + o.includeDividends); return { ok: true }; },
    fetchBenchmarkData: async () => { calls.push('bench'); return { ok: true }; },
    saveNetWorthSnapshot: async () => { calls.push('snap'); return { ok: true }; },
    finMarkFresh: () => {},
    renderBubbleChart: () => {},
    changeOwner: () => {},
    currentOwner: '전체',
  };
  vm.createContext(c);
  vm.runInContext('let _manualRefreshRunning=false;\n' + extract('manualRefresh') + '\nthis.manualRefresh=manualRefresh;', c);
  const r = await c.manualRefresh(['prices', 'rates']);
  assert.equal(r.ok, true);
  assert.deepEqual(calls, ['prices', 'split', 'rates:false'], '시세·환율만 — 원장·배당·벤치마크·스냅샷은 건드리지 않는다');
}
console.log('test_auto_refresh: OK');
