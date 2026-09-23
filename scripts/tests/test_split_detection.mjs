import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync('script.js', 'utf8');
// _chunkTickers/API_TICKER_CHUNK는 분할 조회 청크에 필요한 의존 함수라 같이 뽑는다.
const start = source.indexOf('const API_TICKER_CHUNK = 25;');
const end = source.indexOf('// DCA는 증권사 외부 서비스이므로 이 앱에서 체결을 생성하지 않는다.');
const fn = source.slice(start, end);
assert.ok(start > -1 && end > start, '분할 감지 블록 경계를 찾지 못함');

const TODAY = '2026-09-23';
function splitsFetch(result, verified = Object.keys(result)) {
  return async () => ({ ok: true, json: async () => ({ success: true, result, verifiedTickers: verified }) });
}
function makeCtx(overrides = {}) {
  const store = {};
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  const calls = { save: 0, render: 0 };
  const ctx = vm.createContext({
    console, Date, Map, Set, JSON, Number, Array, String, Object, Math,
    window: { _kvLoadState: { assets: overrides.assetsState || 'ready' } }, localStorage,
    finLocalDateKey: () => TODAY,
    authFetch: overrides.authFetch || splitsFetch({}),
    saveAssetsToKV: async () => { calls.save++; return overrides.saveResult || { ok: true }; },
    changeOwner: () => { calls.render++; },
    currentOwner: '전체',
    pfolioData: overrides.pfolioData || [],
  });
  vm.runInContext(fn, ctx);
  return { ctx, calls };
}
const stock = (o) => ({ grp:'주식', owner:'본인', acc:'일반', broker:'', qty:10, avgP:100, splitCheckedAt:'', ...o });

// ── 배너·수동 승인 경로는 없다 ────────────────────────────────────
{
  assert.ok(!/renderSplitNotice|applySplitAdjustment|dismissSplitAdjustment/.test(source), '수동 승인 함수가 남아 있다');
  assert.ok(!fs.readFileSync('index.html', 'utf8').includes('split-notice'), '배너 컨테이너가 남아 있다');
  assert.ok(!fs.readFileSync('workspace-ui.css', 'utf8').includes('.split-notice'), '배너 CSS가 남아 있다');
  console.log('PASS 수동 승인 배너 제거');
}

// ── 기준일 이후 분할만 자동 반영, 취득원가 보존, 멱등 ────────────
{
  const a = stock({ tkr:'AAA', qty:10, avgP:100, splitCheckedAt:'2026-08-01' });
  const b = stock({ tkr:'BBB', qty:5, avgP:200, splitCheckedAt:'2026-09-10' });
  const { ctx, calls } = makeCtx({
    pfolioData: [a, b],
    authFetch: splitsFetch({
      AAA: [{ date:'2026-07-01', num:3, den:1, ratio:3 }, { date:'2026-08-20', num:1, den:10, ratio:0.1 }],
      BBB: [{ date:'2026-09-10', num:2, den:1, ratio:2 }], // 기준일 당일 → 이미 반영된 값
    }),
  });
  const cost = a.qty * a.avgP;
  const r = await ctx.checkSplitAdjustments(true);
  assert.equal(a.qty, 1, '기준일 이후 1:10 병합만 반영(7월 분할은 등록 전)');
  assert.equal(a.avgP, 1000);
  assert.ok(Math.abs(a.qty * a.avgP - cost) < 1e-9, '취득원가 보존');
  assert.equal(a.splitCheckedAt, '2026-08-20', '기준일은 반영한 분할일');
  assert.equal(b.qty, 5, '기준일 당일 분할은 반영하지 않는다');
  assert.equal(b.avgP, 200);
  assert.equal(calls.save, 1, '한 번만 저장');
  assert.equal(r.applied.length, 1);
  await ctx.checkSplitAdjustments(true);
  assert.equal(a.qty, 1, '재실행해도 다시 곱하지 않는다');
  assert.equal(a.avgP, 1000);
  assert.equal(calls.save, 1, '바뀐 게 없으면 저장하지 않는다');
  console.log('PASS 기준일 이후 분할만 자동 반영·취득원가 보존·멱등');
}

// ── 기준일이 빈 레거시 항목: 숫자는 그대로, 기준일만 오늘 ──────────
{
  const a = stock({ tkr:'NVDA', qty:5, avgP:120, splitCheckedAt:'' });
  const { ctx, calls } = makeCtx({
    pfolioData: [a],
    authFetch: splitsFetch({ NVDA: [{ date:'2024-06-10', num:10, den:1, ratio:10 }] }),
  });
  await ctx.checkSplitAdjustments(true);
  assert.equal(a.qty, 5, '등록 시점을 모르는 과거 분할을 곱하지 않는다');
  assert.equal(a.avgP, 120);
  assert.equal(a.splitCheckedAt, TODAY);
  assert.equal(calls.save, 1);
  console.log('PASS 레거시 항목 백필: 숫자 불변, 기준일만 기록');
}

// ── 저장 실패 시 전부 롤백 ─────────────────────────────────────
{
  const a = stock({ tkr:'AAA', qty:10, avgP:100, splitCheckedAt:'2026-08-01' });
  const { ctx } = makeCtx({
    pfolioData: [a], saveResult: { ok:false },
    authFetch: splitsFetch({ AAA: [{ date:'2026-08-20', num:1, den:10, ratio:0.1 }] }),
  });
  const r = await ctx.checkSplitAdjustments(true);
  assert.equal(r.ok, false);
  assert.equal(a.qty, 10); assert.equal(a.avgP, 100); assert.equal(a.splitCheckedAt, '2026-08-01');
  console.log('PASS 저장 실패 시 메모리 롤백');
}

// ── KV 미준비 시 아무것도 바꾸지 않는다 ──────────────────────────
{
  const a = stock({ tkr:'AAA', splitCheckedAt:'2026-08-01' });
  const { ctx, calls } = makeCtx({
    pfolioData: [a], assetsState: 'pending',
    authFetch: splitsFetch({ AAA: [{ date:'2026-08-20', num:1, den:10, ratio:0.1 }] }),
  });
  await ctx.checkSplitAdjustments(true);
  assert.equal(calls.save, 0); assert.equal(a.qty, 10); assert.equal(a.splitCheckedAt, '2026-08-01');
  console.log('PASS KV 미준비 시 쓰기 차단');
}

// ── BMNU 일회성 보정 ──────────────────────────────────────────
{
  const a = stock({ tkr:'BMNU', qty:11, avgP:23.38, splitCheckedAt:'' });
  const { ctx, calls } = makeCtx({
    pfolioData: [a],
    authFetch: splitsFetch({ BMNU: [{ date:'2026-07-13', num:1, den:10, ratio:0.1 }] }),
  });
  await ctx.checkSplitAdjustments(true);
  assert.equal(a.qty, 11); assert.equal(a.avgP, 233.8); assert.equal(a.splitCheckedAt, TODAY);
  assert.equal(calls.save, 1);
  await ctx.checkSplitAdjustments(true);
  assert.equal(a.qty, 11, '보정 후 병합 이벤트를 다시 곱하지 않는다'); assert.equal(a.avgP, 233.8);
  assert.equal(calls.save, 1);
  console.log('PASS BMNU 일회성 보정: 11주·$233.8, 재실행 무동작');
}
{
  const a = stock({ tkr:'BMNU', qty:3, avgP:50, splitCheckedAt:'2026-08-01' });
  const { ctx } = makeCtx({ pfolioData: [a] });
  await ctx.checkSplitAdjustments(true);
  assert.equal(a.qty, 3, '병합 이후 기준일이면 보정하지 않는다'); assert.equal(a.avgP, 50);
  const b1 = stock({ tkr:'BMNU', owner:'본인' }), b2 = stock({ tkr:'BMNU', owner:'아내' });
  const { ctx: ctx2 } = makeCtx({ pfolioData: [b1, b2] });
  await ctx2.checkSplitAdjustments(true);
  assert.equal(b1.avgP, 100, 'BMNU 행이 둘이면 어느 쪽인지 모르므로 보정하지 않는다');
  assert.equal(b2.avgP, 100);
  console.log('PASS BMNU 일회성 보정 가드');
}

// ── fetchSplitEvents: verifiedTickers는 종목 단위로만 인정 ──────
{
  const { ctx } = makeCtx({
    pfolioData: [stock({ tkr:'BMNU' }), stock({ tkr:'NVDA' })],
    authFetch: splitsFetch({ BMNU:[{date:'2026-07-13',num:1,den:10,ratio:0.1}] }, ['BMNU']),
  });
  const r = await ctx.fetchSplitEvents(true);
  // vm 컨텍스트(별도 realm)의 배열이라 이 realm의 배열로 복제한 뒤 비교한다.
  assert.deepEqual(Array.from(r.verified), ['BMNU'], 'NVDA는 응답에 없으므로 verified에 들어가지 않는다');
  assert.ok(r.events.BMNU);
  console.log('PASS fetchSplitEvents: verifiedTickers는 서버가 확인해 준 종목만');
}

// ── 등록·수정 경로가 기준일을 남긴다 ────────────────────────────
{
  assert.ok(/dcaDay:dcaDayVal,splitCheckedAt:finLocalDateKey\(new Date\(\)\)\}/.test(source), '모달 저장이 splitCheckedAt을 버린다');
  assert.ok(/field==='qty'\|\|field==='avgP'\) item\.splitCheckedAt=/.test(source), '인라인 수정이 기준일을 갱신하지 않는다');
  console.log('PASS 등록·수정 시 기준일 기록');
}

console.log('PASS: 액면분할·병합 — 기준일 이후 자동 반영·취득원가 보존·일회성 보정·verifiedTickers 계약');
