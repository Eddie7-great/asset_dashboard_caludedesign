import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync('script.js', 'utf8');
// _chunkTickers/API_TICKER_CHUNK는 분할 조회 청크에 필요한 의존 함수라 같이 뽑는다.
const start = source.indexOf('const API_TICKER_CHUNK = 25;');
const end = source.indexOf('// DCA는 증권사 외부 서비스이므로 이 앱에서 체결을 생성하지 않는다.');
const fn = source.slice(start, end);
assert.ok(start > -1 && end > start, '분할 감지 블록 경계를 찾지 못함');

function makeCtx(overrides = {}) {
  const store = {};
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  const ctx = vm.createContext({
    console, Date, Map, Set, JSON, Number, Array, String, Object, Math,
    window: {}, localStorage,
    finLocalDateKey: d => (d || new Date()).toISOString().slice(0, 10),
    authFetch: overrides.authFetch || (async () => ({ ok: true, json: async () => ({ success: true, result: {}, verifiedTickers: [] }) })),
    saveAssetsToKV: overrides.saveAssetsToKV || (async () => ({ ok: true })),
    showSaveError: () => {},
    changeOwner: () => {},
    currentOwner: '전체',
    _cfEsc: x => String(x == null ? '' : x),
    document: { getElementById: id => (id === 'split-notice' ? overrides.host || null : null) },
    pfolioData: overrides.pfolioData || [],
  });
  vm.runInContext(fn, ctx);
  return ctx;
}
// vm의 최상위 `let` 바인딩은 컨텍스트 객체의 프로퍼티가 아니다 — 밖에서
// `ctx._splitPending = [...]` 로는 함수가 보는 값을 바꿀 수 없다. 코드 문자열로 직접 대입한다.
function setPending(ctx, list) { vm.runInContext(`_splitPending = ${JSON.stringify(list)};`, ctx); }
function getPending(ctx) { return vm.runInContext('_splitPending', ctx); }
function run(ctx, code) { return vm.runInContext(code, ctx); }

// ── splitPendingList ────────────────────────────────────────────
{
  const pfolioData = [
    { grp:'주식', tkr:'BMNU', owner:'본인', qty:11, avgP:100, splitCheckedAt:'' },
    { grp:'주식', tkr:'NVDA', owner:'본인', qty:5, avgP:200, splitCheckedAt:'2026-09-01' },
    { grp:'현금', tkr:'BMNU', owner:'본인', qty:1, avgP:1 }, // 주식이 아니면 대상 아님
  ];
  const ctx = makeCtx({ pfolioData });
  const events = {
    BMNU: [{ date:'2026-08-15', num:1, den:10, ratio:0.1 }],
    NVDA: [
      { date:'2026-08-01', num:10, den:1, ratio:10 }, // splitCheckedAt 이전 → 제외
      { date:'2026-09-05', num:2, den:1, ratio:2 },   // 이후 → 포함
    ],
  };
  const pending = ctx.splitPendingList(events);
  assert.equal(pending.length, 2, 'splitCheckedAt 없는 항목은 전체 범위, 있으면 이후만');
  assert.equal(pending[0].tkr, 'BMNU');
  assert.equal(pending[0].ratio, 0.1);
  assert.equal(pending[1].tkr, 'NVDA');
  assert.equal(pending[1].date, '2026-09-05', 'splitCheckedAt 이전 이벤트는 후보에서 빠진다');
  console.log('PASS splitPendingList: splitCheckedAt 이후 분할만, 주식 아닌 행 제외');
}

// ── applySplitAdjustment: 취득원가 보존, qty/avgP 환산 ───────────
{
  const item = { grp:'주식', tkr:'BMNU', owner:'본인', qty:11, avgP:100, splitCheckedAt:'' };
  const pfolioData = [item];
  const ctx = makeCtx({ pfolioData });
  ctx.window._kvLoadState = { assets: 'ready' };
  const key = ctx._splitRowKey(item);
  setPending(ctx, [{ key, name:'BMNU', tkr:'BMNU', owner:'본인', date:'2026-08-15', num:1, den:10, ratio:0.1 }]);
  const beforeCost = item.qty * item.avgP;
  await run(ctx, 'applySplitAdjustment(0)');
  const afterCost = item.qty * item.avgP;
  assert.ok(Math.abs(afterCost - beforeCost) < 1e-9, `취득원가 보존 실패: ${beforeCost} -> ${afterCost}`);
  assert.equal(item.qty, 1.1, '수량은 ratio를 곱한다');
  assert.equal(item.avgP, 1000, '매입가는 ratio로 나눈다');
  assert.ok(item.splitCheckedAt, 'splitCheckedAt이 갱신된다');
  assert.equal(getPending(ctx).length, 0, '적용 후 대기 목록에서 제거');
  console.log('PASS applySplitAdjustment: 취득원가(qty×avgP) 보존, 수량/단가만 환산');
}

// ── applySplitAdjustment: 저장 실패 시 롤백 ─────────────────────
{
  const item = { grp:'주식', tkr:'BMNU', owner:'본인', qty:11, avgP:100, splitCheckedAt:'' };
  const pfolioData = [item];
  const ctx = makeCtx({ pfolioData, saveAssetsToKV: async () => ({ ok:false }) });
  ctx.window._kvLoadState = { assets: 'ready' };
  const key = ctx._splitRowKey(item);
  setPending(ctx, [{ key, name:'BMNU', tkr:'BMNU', owner:'본인', date:'2026-08-15', num:1, den:10, ratio:0.1 }]);
  await run(ctx, 'applySplitAdjustment(0)');
  assert.equal(item.qty, 11, '저장 실패 시 수량 롤백');
  assert.equal(item.avgP, 100, '저장 실패 시 매입가 롤백');
  assert.equal(item.splitCheckedAt, '', '저장 실패 시 splitCheckedAt도 롤백');
  assert.equal(getPending(ctx).length, 1, '저장 실패 시 대기 목록에 그대로 남는다');
  console.log('PASS applySplitAdjustment: 저장 실패 시 메모리 변경 롤백');
}

// ── applySplitAdjustment: KV 로드 전에는 쓰지 않는다 ─────────────
{
  const item = { grp:'주식', tkr:'BMNU', owner:'본인', qty:11, avgP:100, splitCheckedAt:'' };
  const pfolioData = [item];
  let saveCalled = false;
  const ctx = makeCtx({ pfolioData, saveAssetsToKV: async () => { saveCalled = true; return { ok:true }; } });
  ctx.window._kvLoadState = { assets: 'pending' };
  const key = ctx._splitRowKey(item);
  setPending(ctx, [{ key, name:'BMNU', tkr:'BMNU', owner:'본인', date:'2026-08-15', num:1, den:10, ratio:0.1 }]);
  await run(ctx, 'applySplitAdjustment(0)');
  assert.equal(saveCalled, false, 'assets가 ready가 아니면 저장을 시도하지 않는다');
  assert.equal(item.qty, 11, '값도 바뀌지 않는다');
  console.log('PASS applySplitAdjustment: KV 미준비 시 쓰기 차단');
}

// ── dismissSplitAdjustment: 수량/단가는 그대로, 확인일만 갱신 ────
{
  const item = { grp:'주식', tkr:'BMNU', owner:'본인', qty:11, avgP:100, splitCheckedAt:'' };
  const pfolioData = [item];
  const ctx = makeCtx({ pfolioData });
  ctx.window._kvLoadState = { assets: 'ready' };
  const key = ctx._splitRowKey(item);
  setPending(ctx, [{ key, name:'BMNU', tkr:'BMNU', owner:'본인', date:'2026-08-15', num:1, den:10, ratio:0.1 }]);
  await run(ctx, 'dismissSplitAdjustment(0)');
  assert.equal(item.qty, 11, '이미 반영됨은 수량을 건드리지 않는다');
  assert.equal(item.avgP, 100, '이미 반영됨은 매입가를 건드리지 않는다');
  assert.ok(item.splitCheckedAt, '확인일만 갱신');
  assert.equal(getPending(ctx).length, 0);
  console.log('PASS dismissSplitAdjustment: 숫자는 유지, 확인일만 갱신');
}

// ── fetchSplitEvents: verifiedTickers는 종목 단위로만 인정 ──────
{
  const pfolioData = [
    { grp:'주식', tkr:'BMNU', owner:'본인', qty:11, avgP:100 },
    { grp:'주식', tkr:'NVDA', owner:'본인', qty:5, avgP:200 },
  ];
  const ctx = makeCtx({
    pfolioData,
    authFetch: async () => ({
      ok: true,
      json: async () => ({ success:true, result:{ BMNU:[{date:'2026-08-15',num:1,den:10,ratio:0.1}] }, verifiedTickers:['BMNU'] }),
    }),
  });
  const r = await ctx.fetchSplitEvents(true);
  // r.verified는 vm 컨텍스트(별도 realm)에서 만들어진 배열이라 프로토타입이 달라
  // deepStrictEqual이 실패한다 — 값 비교 전에 이 realm의 배열로 복제한다.
  assert.deepEqual(Array.from(r.verified), ['BMNU'], 'NVDA는 응답에 없으므로 verified에 들어가지 않는다(HTTP 200만으로 확인 처리하지 않음)');
  assert.ok(r.events.BMNU, 'BMNU 이벤트는 반영된다');
  console.log('PASS fetchSplitEvents: verifiedTickers는 서버가 확인해 준 종목만');
}

// ── renderSplitNotice: 대기 건이 없으면 숨긴다 ───────────────────
{
  const host = { hidden: false, innerHTML: 'x' };
  const ctx = makeCtx({ pfolioData: [], host });
  setPending(ctx, []);
  ctx.renderSplitNotice();
  assert.equal(host.hidden, true, '대기 건이 없으면 배너를 숨긴다');
  assert.equal(host.innerHTML, '');
  console.log('PASS renderSplitNotice: 빈 목록이면 배너를 숨긴다');
}

console.log('PASS: 액면분할·병합 감지 — 취득원가 보존·수동 승인·verifiedTickers 계약');
