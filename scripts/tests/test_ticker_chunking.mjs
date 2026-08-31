#!/usr/bin/env node
// 서버는 요청당 티커 수를 제한한다 (api/price.ts MAX_TICKERS=25, api/dashboard.py 벤치마크 p_tkrs=20).
// 클라이언트가 보유 종목 전량을 한 번에 보내면 요청이 통째로 거부돼 시세·배당·벤치마크가
// 영구히 '확인 필요'로 남고 보유 종목이 가장 많은 소유주의 성과 라인이 사라진다.
// 이 파일은 청크 분할·상위 N 절단·부분 실패 처리 계약을 고정한다.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../../script.js', import.meta.url), 'utf8')

function extractFunction(name) {
  const asyncStart = source.indexOf(`async function ${name}(`)
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} 함수를 찾을 수 없음`)
  const open = source.indexOf('{', start)
  let depth = 0, quote = null, escaped = false, lineComment = false, blockComment = false
  for (let i = open; i < source.length; i++) {
    const ch = source[i], next = source[i + 1]
    if (lineComment) { if (ch === '\n') lineComment = false; continue }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++ } continue }
    if (quote) {
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '{') depth++
    if (ch === '}' && --depth === 0) return source.slice(start, i + 1)
  }
  throw new Error(`${name} 닫는 괄호를 찾을 수 없음`)
}

const noop = () => {}
function baseContext(extra = {}) {
  const ctx = {
    console: { log: noop, warn: noop, error: noop },
    JSON, Object, Array, Number, String, Math, Set, Boolean, Error, Promise, isNaN,
    encodeURIComponent,
    setTimeout: (fn) => { if (typeof fn === 'function') { /* 타임아웃 콜백은 실행하지 않음 */ } return 1 },
    clearTimeout: noop,
    document: { getElementById: () => null, querySelector: () => null },
    days: ['일','월','화','수','목','금','토'],
    RATES: { USD: 1300, JPY: 9, KRW: 1 },
    ...extra,
  }
  ctx.window = ctx.window || {}
  return vm.createContext(ctx)
}

const CHUNK_DECL = source.slice(source.indexOf('const API_TICKER_CHUNK'), source.indexOf('async function liveRefresh('))
assert.match(CHUNK_DECL, /const API_TICKER_CHUNK = 25/, '가격·배당 청크 크기는 서버 MAX_TICKERS(25)와 같아야 함')
assert.match(CHUNK_DECL, /const BENCH_TICKER_LIMIT = 20/, '벤치마크 상한은 서버 p_tkrs 한도(20)와 같아야 함')

// ─────────────────────────── _chunkTickers ───────────────────────────
{
  const ctx = baseContext()
  vm.runInContext(CHUNK_DECL, ctx)
  const chunks = vm.runInContext('_chunkTickers(Array.from({length:30},(_,i)=>"T"+i))', ctx)
  assert.equal(chunks.length, 2, '30개는 두 청크로 나뉜다')
  assert.equal(chunks[0].length, 25, '첫 청크는 상한만큼 채운다')
  assert.equal(chunks[1].length, 5, '나머지는 두 번째 청크')
  assert.ok(chunks.every(c => c.length <= 25), '어떤 청크도 서버 상한을 넘지 않는다')
  assert.equal(vm.runInContext('_chunkTickers([]).length', ctx), 0, '빈 목록은 빈 청크 배열')
}

// ─────────────────────────── liveRefresh ───────────────────────────
function makeLiveRefreshCtx(responder) {
  const calls = []
  const pfolioData = Array.from({ length: 30 }, (_, i) => ({ tkr: 'T' + i, grp: '주식', cur: 'USD', qty: 1 }))
  const ctx = baseContext({
    pfolioData,
    currentOwner: '전체',
    authFetch: async (url) => {
      const list = decodeURIComponent(url.split('tickers=')[1] || '').split(',').filter(Boolean)
      calls.push(list)
      return responder(list, calls.length)
    },
    syncDivHistory: noop,
    changeOwner: noop,
    renderPortFxPanel: noop,
    flash: noop,
  })
  vm.runInContext(CHUNK_DECL, ctx)
  vm.runInContext(extractFunction('liveRefresh'), ctx)
  return { ctx, calls, pfolioData }
}

const okResponse = (list) => ({
  ok: true,
  json: async () => ({
    success: true,
    quotes: Object.fromEntries(list.map(t => [t, { price: 10, prevClose: 9 }])),
    rates: { USD: 1300, JPY: 9, USDJPY: 144, GOLD_G_KRW: 100000 },
  }),
})

{
  const { ctx, calls, pfolioData } = makeLiveRefreshCtx(okResponse)
  const result = await vm.runInContext('liveRefresh()', ctx)
  assert.equal(calls.length, 2, '티커 30개는 요청 2건으로 분할된다')
  assert.ok(calls.every(c => c.length <= 25), '각 요청은 서버 상한 이내')
  assert.equal(new Set(calls.flat()).size, 30, '분할해도 티커가 누락되지 않는다')
  assert.equal(result.ok, true, '모든 청크 성공 시 정상')
  assert.equal(result.stale, 0, '모든 종목에 시세가 반영된다')
  assert.ok(pfolioData.every(i => i.curP === 10), '병합된 시세가 전 종목에 적용된다')
}

{
  // 두 번째 청크만 실패 — 성공분은 살리고, 실패는 숨기지 않는다.
  const { ctx, calls, pfolioData } = makeLiveRefreshCtx((list, n) =>
    n === 2 ? { ok: false, status: 400, json: async () => ({}) } : okResponse(list))
  const result = await vm.runInContext('liveRefresh()', ctx)
  assert.equal(calls.length, 2, '실패해도 나머지 청크를 계속 시도한다')
  assert.equal(result.ok, false, '부분 실패를 정상으로 보고하지 않는다')
  assert.equal(result.failedChunks, 1, '실패한 청크 수를 보고한다')
  assert.equal(pfolioData.filter(i => i.curP === 10).length, 25, '성공한 청크의 시세는 버리지 않는다')
  assert.match(result.detail, /확인 필요/, '실패 사유가 데이터 상태 문구에 드러난다')
}

{
  // 전 청크 실패는 기존과 같이 오류로 떨어진다.
  const { ctx } = makeLiveRefreshCtx(() => ({ ok: false, status: 500, json: async () => ({}) }))
  const result = await vm.runInContext('liveRefresh()', ctx)
  assert.equal(result.ok, false, '전부 실패하면 실패')
  assert.ok(result.error, '오류 메시지를 반환한다')
}

// ─────────────────────────── fetchDivData ───────────────────────────
function makeDivCtx(responder) {
  const calls = []
  const store = {}
  const pfolioData = Array.from({ length: 30 }, (_, i) => ({ tkr: 'D' + i, grp: '주식', qty: 1 }))
  const ctx = baseContext({
    pfolioData,
    DIV_INFO_DB: {},
    CYCLE_COUNT: { '월배당': 12, '분기': 4, '반기': 2, '연배당': 1, '-': 1 },
    _cfLocalDateKey: () => '2026-08-31',
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v },
    },
    fetchTimeout: () => ({ signal: null, done: noop }),
    authFetch: async (url) => {
      const list = decodeURIComponent(url.split('tickers=')[1] || '').split(',').filter(Boolean)
      calls.push(list)
      return responder(list, calls.length)
    },
    syncDivHistory: noop,
    resolvePendingDivDates: noop,
  })
  ctx.window._divDataCache = {}
  vm.runInContext(CHUNK_DECL, ctx)
  vm.runInContext(extractFunction('fetchDivData'), ctx)
  return { ctx, calls, store }
}

const divOk = (list) => ({
  ok: true,
  json: async () => ({
    success: true,
    result: Object.fromEntries(list.map(t => [t, { dps: 4, yld: 2, cycle: '분기', months: [3, 6, 9, 12], cur: 'USD' }])),
  }),
})

{
  const { calls, store, ctx } = makeDivCtx(divOk)
  const result = await vm.runInContext('fetchDivData(true)', ctx)
  assert.equal(calls.length, 2, '배당 요청도 30개를 2건으로 분할한다')
  assert.ok(calls.every(c => c.length <= 25), '각 배당 요청은 서버 상한 이내')
  assert.equal(result.ok, true, '모든 청크 성공 시 정상')
  assert.equal(JSON.parse(store['divCacheTickers_2026-08-31']).length, 30, '전부 성공하면 30개 모두 verified')
}

{
  // 두 번째 청크 실패 — 실패한 티커를 verified 로 적으면 다음 접속에서 조회 없이 넘어간다.
  const { calls, store, ctx } = makeDivCtx((list, n) =>
    n === 2 ? { ok: false, status: 400, json: async () => ({}) } : divOk(list))
  const result = await vm.runInContext('fetchDivData(true)', ctx)
  assert.equal(calls.length, 2, '실패해도 남은 청크를 계속 시도')
  assert.equal(result.ok, false, '부분 실패를 정상으로 보고하지 않는다')
  const verified = JSON.parse(store['divCacheTickers_2026-08-31'])
  assert.equal(verified.length, 25, '성공한 청크의 티커만 verified 로 기록한다')
  assert.ok(!verified.includes('D29'), '실패한 청크의 티커는 verified 에 들어가지 않는다')
  assert.ok(Object.keys(ctx.window._divDataCache).length > 0, '성공분 배당 데이터는 보존한다')
}

// ────────────────── fetchBenchmarkData: 소유주별 상위 20종목 절단 ──────────────────
{
  const captured = []
  // 본인은 25종목 보유 — 서버 p_tkrs 한도(20)를 넘는다. 평가액은 B0 이 가장 크도록 배치.
  const pfolioData = Array.from({ length: 25 }, (_, i) => ({
    tkr: 'B' + i, grp: '주식', cur: 'USD', qty: 1, curP: 25 - i, owner: '본인', market: 'NASDAQ',
  }))
  const benchData = { '1Y': { labels: ['a', 'b'], data: {} } }
  const ctx = baseContext({
    pfolioData,
    benchData,
    OWNERS: ['본인'],
    getFilteredAssets: (o) => pfolioData.filter(a => a.owner === o),
    normTkr: (t) => String(t || '').toUpperCase(),
    fetchPyRates: async () => true,
    rerenderBenchmark: noop,
    _jsBenchmarkFallback: async () => null,
    AbortController: class { constructor() { this.signal = null } abort() {} },
    authFetch: async (url) => {
      captured.push(url)
      return {
        ok: true,
        json: async () => ({
          success: true,
          benchmark: { '1Y': { labels: ['a', 'b'], sp500: [0, 1], kospi: [0, 2], portfolio: [0, 3] } },
        }),
      }
    },
  })
  vm.runInContext(CHUNK_DECL, ctx)
  vm.runInContext(extractFunction('fetchBenchmarkData'), ctx)
  const result = await vm.runInContext('fetchBenchmarkData()', ctx)

  assert.equal(captured.length, 1, '소유주당 벤치마크 요청 1건')
  const sent = decodeURIComponent((captured[0].match(/p_tkrs=([^&]*)/) || [])[1] || '').split(',').filter(Boolean)
  assert.equal(sent.length, 20, 'p_tkrs 는 서버 한도(20)를 넘지 않는다')
  assert.ok(sent.includes('B0'), '평가액 최상위 종목은 반드시 포함')
  assert.ok(!sent.includes('B24'), '평가액 최하위 종목은 절단된다')
  const weights = decodeURIComponent((captured[0].match(/p_weights=([^&]*)/) || [])[1] || '').split(',').filter(Boolean)
  assert.equal(weights.length, sent.length, '티커와 가중치 개수가 일치해야 서버가 포트폴리오를 계산한다')
  assert.equal(result.ok, true, '상한 이내로 보내면 소유주 라인이 정상 로드된다')
  assert.ok(Array.isArray(benchData['1Y'].data['본인']), '본인 시리즈가 실제로 채워진다')
}

// ────────────────── 보유 종목이 있는데 라인이 없으면 실패로 보고 ──────────────────
{
  // 시세(curP)가 비어 가중치를 만들 수 없는 소유주 — 예전에는 '자산 없음'으로 보고 초록불이었다.
  const pfolioData = [{ tkr: 'B0', grp: '주식', cur: 'USD', qty: 1, owner: '본인' }]
  const benchData = { '1Y': { labels: ['a', 'b'], data: {} } }
  const ctx = baseContext({
    pfolioData,
    benchData,
    OWNERS: ['본인'],
    getFilteredAssets: (o) => pfolioData.filter(a => a.owner === o),
    normTkr: (t) => String(t || '').toUpperCase(),
    fetchPyRates: async () => true,
    rerenderBenchmark: noop,
    _jsBenchmarkFallback: async () => null,
    AbortController: class { constructor() { this.signal = null } abort() {} },
    authFetch: async () => ({
      ok: true,
      // 지수만 오고 portfolio 가 없는 응답 (p_tkrs 없이 요청됐을 때 서버가 주는 형태)
      json: async () => ({ success: true, benchmark: { '1Y': { labels: ['a', 'b'], sp500: [0, 1], kospi: [0, 2] } } }),
    }),
  })
  vm.runInContext(CHUNK_DECL, ctx)
  vm.runInContext(extractFunction('fetchBenchmarkData'), ctx)
  const result = await vm.runInContext('fetchBenchmarkData()', ctx)
  assert.equal(result.ok, false, '보유 종목이 있는데 포트폴리오 라인이 없으면 실패로 보고한다')
  const line = benchData['1Y'].data['본인']
  assert.equal(line === undefined || line.length === 0, true, '없는 라인을 있는 것처럼 채우지 않는다')
}

console.log('PASS 티커 청크 분할·상위 N 절단·부분 실패 처리')
