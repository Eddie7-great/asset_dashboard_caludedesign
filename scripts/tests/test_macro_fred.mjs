#!/usr/bin/env node
// 종목 찾기 > 매크로(시장 신호등) 의 FRED 자료 경로(2026-11-26 사용자 결정)
//  - 공개 CSV 주소만, 지표 4개(DGS10·T10Y2Y·BAA10Y·DTWEXBGS), 지표마다 한 번씩, API 키 없음
//  - 브라우저용 GET 은 KV 만 읽고 FRED 를 부르지 않는다. 새로 받기는 CRON_SECRET 예약 실행만
//  - 최신 관측일이 같으면 KV 를 다시 쓰지 않고, 실패하면 마지막 정상 값을 지킨다
//  - 화면 신호등은 기존 판정 기준(TRD_MACRO)을 그대로 쓰고 카드마다 날짜·직전 대비·출처를 적는다
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { readSource } from './_source.mjs'

const require = createRequire(import.meta.url)
const authHelper = require(fileURLToPath(new URL('../../api/_auth.js', import.meta.url)))
const quiet = { log() {}, warn() {}, error() {} }
const src = fs.readFileSync(new URL('../../api/macro.ts', import.meta.url), 'utf8')
const load = () => {
  const mod = { exports: {} }
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInContext(out, vm.createContext({ module: mod, exports: mod.exports, process, console: quiet, Buffer, AbortController, URL, Intl, Date, setTimeout, clearTimeout, fetch: (...a) => globalThis.fetch(...a),
    require(id) { if (id === './_auth.js') return authHelper; return require(id) } }))
  return mod.exports
}
const recorder = () => ({ statusCode: 200, headers: {}, body: undefined, setHeader(k, v) { this.headers[k.toLowerCase()] = v }, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } })
const M = load()
const J = x => JSON.parse(JSON.stringify(x))

// ── 키·비밀값이 코드에 없다 ──
assert.doesNotMatch(src, /api\.stlouisfed\.org|api_key/i, 'API 키가 필요한 주소를 쓰지 않는다')
assert.deepEqual([...M.FRED_SERIES], ['DGS10', 'T10Y2Y', 'BAA10Y', 'DTWEXBGS', 'DGS2', 'DFF', 'WALCL', 'SP500', 'SAHMREALTIME', 'VIXCLS'])
assert.equal(M.FRED_CSV_URL, 'https://fred.stlouisfed.org/graph/fredgraph.csv')

// ── CSV 읽기 ──
assert.deepEqual(J(M.parseFredCsv('﻿observation_date,DGS10\r\n2026-11-20,4.10\r\n2026-11-21,\r\n2026-11-24,.\r\n2026-11-25,4.13\r\n', 'DGS10')), [['2026-11-20', 4.1], ['2026-11-25', 4.13]], '빈칸·점은 건너뛴다')
assert.throws(() => M.parseFredCsv('<!DOCTYPE html><html>', 'DGS10'), /fred_bad_header/, 'HTML 은 거부')
assert.throws(() => M.parseFredCsv('observation_date,T10Y2Y\n2026-11-25,0.5', 'DGS10'), /fred_bad_series/, '다른 지표 응답은 거부')
assert.throws(() => M.parseFredCsv('observation_date,DGS10\n2026-11-25,', 'DGS10'), /fred_no_rows/)

// ── 가짜 FRED + 가짜 KV ──
const mkCsv = (id, rows) => `observation_date,${id}\n` + rows.map(([d, v]) => `${d},${v}`).join('\n') + '\n'
const series = (base, step, endDay = '2026-11-25', span = 390) => { const out = []; const end = Date.parse(endDay + 'T00:00:00Z'); for (let i = span; i >= 0; i -= 1) { const t = end - i * 86400000; const wd = new Date(t).getUTCDay(); if (wd === 0 || wd === 6) continue; out.push([new Date(t).toISOString().slice(0, 10), +(base + step * (span - i)).toFixed(4)]) } return out }
let fredData = { DGS10: series(4.0, 0.0004), T10Y2Y: series(0.2, 0.001), BAA10Y: series(1.6, 0.0002), DTWEXBGS: series(118, 0.01), DGS2: series(3.9, 0.0002), DFF: series(3.88, 0), WALCL: series(6700000, -300), SP500: series(6000, 2), SAHMREALTIME: [['2026-09-01', 0.27], ['2026-10-01', 0.3]], VIXCLS: series(18, -0.001) }
const kv = new Map(); let sets = 0, fredCalls = [], fredFail = new Set(), fredFlaky = new Map(), runSetFail = false
const fakeFetch = async (url, init) => {
  const u = String(url)
  if (u.startsWith('https://kv.test')) {
    const cmd = JSON.parse(init.body)
    if (cmd[0] === 'GET') return { ok: true, json: async () => ({ result: kv.has(cmd[1]) ? kv.get(cmd[1]) : null }) }
    if (cmd[0] === 'SET' && cmd[1] === M.RUN_KEY && runSetFail) return { ok: false, status: 500, json: async () => ({}) }
    if (cmd[0] === 'SET') { kv.set(cmd[1], cmd[2]); if (cmd[1] === M.CACHE_KEY) sets += 1; return { ok: true, json: async () => ({ result: 'OK' }) } }
  }
  if (u.startsWith(M.FRED_CSV_URL)) {
    const q = new URL(u).searchParams; fredCalls.push(q.get('id'))
    assert.ok(q.get('cosd') && !q.get('id').includes(','), '한 번에 한 지표, 시작일 포함')
    if (fredFail.has(q.get('id'))) return { ok: false, status: 503, text: async () => 'down' }
    const flaky = fredFlaky.get(q.get('id'))
    if (flaky) { fredFlaky.set(q.get('id'), flaky - 1); throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }) }
    return { ok: true, status: 200, text: async () => mkCsv(q.get('id'), fredData[q.get('id')]) }
  }
  throw new Error('unexpected ' + u)
}
process.env.KV_REST_API_URL = 'https://kv.test'
process.env.KV_REST_API_TOKEN = 't'

// 주말·장 마감 전에는 확인하지 않는다
const thuAfter = Date.parse('2026-11-26T22:30:00Z')       // 목 17:30 ET
assert.equal((await M.refreshFredCache({ now: Date.parse('2026-11-28T22:30:00Z'), fetchImpl: fakeFetch })).skipped, 'weekend')
assert.equal((await M.refreshFredCache({ now: Date.parse('2026-11-26T15:00:00Z'), fetchImpl: fakeFetch })).skipped, 'before_close')
assert.equal(fredCalls.length, 0)

// 첫 확인 — 네 지표 모두 저장
let r = await M.refreshFredCache({ now: thuAfter, fetchImpl: fakeFetch })
assert.equal(r.cacheUpdated, true); assert.equal(sets, 1)
assert.deepEqual([...fredCalls].sort(), [...M.FRED_SERIES].sort())
for (const id of M.FRED_SERIES) assert.equal(r.report[id].status, 'updated')
const first = JSON.parse(kv.get(M.CACHE_KEY))
assert.equal(first.series.DGS10.date, '2026-11-25'); assert.ok(first.series.DGS10.fetchedAt)
// 실행마다 서버 전용 기록을 남긴다 — 지표별 결과·FRED 가 준 최신 날짜(값·비밀값 없음)
let run = JSON.parse(kv.get(M.RUN_KEY))
assert.equal(run.day, '2026-11-26'); assert.equal(run.updated, 10); assert.equal(run.failed, 0); assert.equal(run.force, false); assert.deepEqual(run.retried, [])
assert.deepEqual(run.series.DGS10, { status: 'updated', date: '2026-11-25', latest: '2026-11-25' })
assert.doesNotMatch(kv.get(M.RUN_KEY), /kv\.test|"t"|value/, '기록에 저장소 주소·토큰·값을 담지 않는다')
assert.ok(!['assets', 'ext_data', 'data_freshness'].includes(M.RUN_KEY), '화면용 KV allowlist 밖의 키')

// 같은 날 두 번째 확인은 하지 않는다
fredCalls = []
assert.equal((await M.refreshFredCache({ now: thuAfter + 3600000, fetchImpl: fakeFetch })).skipped, 'already_checked')
assert.equal(fredCalls.length, 0)

// 다음 날 — 관측일이 그대로면 KV 를 다시 쓰지 않는다
const friAfter = Date.parse('2026-11-27T22:30:00Z')
r = await M.refreshFredCache({ now: friAfter, fetchImpl: fakeFetch })
assert.equal(r.cacheUpdated, false); assert.equal(sets, 1, '관측일이 같으면 다시 쓰지 않음')
for (const id of M.FRED_SERIES) assert.equal(r.report[id].status, 'unchanged')
run = JSON.parse(kv.get(M.RUN_KEY))
assert.equal(run.unchanged, 10); assert.equal(run.series.DGS10.latest, '2026-11-25', 'FRED 가 옛 날짜를 줬는지 기록으로 보인다')
assert.match(M.runSummary(run), /^day=2026-11-27 updated=0 unchanged=10 failed=0 ms=\d+$/)

// 한 지표만 새 날짜 + 한 지표 실패 — 새 것만 바뀌고, 실패한 지표는 지난 값·날짜 유지
fredData.DGS10 = [...fredData.DGS10, ['2026-11-27', 4.2]]
fredData.T10Y2Y = [...fredData.T10Y2Y, ['2026-11-27', 0.6]]
fredFail.add('T10Y2Y')
fredCalls = []
r = await M.refreshFredCache({ now: friAfter, force: true, fetchImpl: fakeFetch, retryDelayMs: 0 })
assert.equal(fredCalls.filter(x => x === 'T10Y2Y').length, 2, '빨리 실패한 지표는 한 번만 더 받는다')
run = JSON.parse(kv.get(M.RUN_KEY))
assert.equal(run.failed, 1); assert.deepEqual(run.retried, ['T10Y2Y']); assert.equal(run.force, true)
assert.deepEqual(run.series.T10Y2Y, { status: 'failed', date: '2026-11-25', error: 'fred_http_503' })
assert.match(M.runSummary(run), /failed=1 .*retried=T10Y2Y errors=T10Y2Y:fred_http_503$/)
assert.equal(r.cacheUpdated, true); assert.equal(sets, 2)
assert.equal(r.report.DGS10.status, 'updated'); assert.equal(r.report.T10Y2Y.status, 'failed'); assert.equal(r.report.T10Y2Y.date, '2026-11-25')
const second = JSON.parse(kv.get(M.CACHE_KEY))
assert.equal(second.series.DGS10.date, '2026-11-27'); assert.equal(second.series.DGS10.prevDate, '2026-11-25')
assert.equal(second.series.BAA10Y.fetchedAt, first.series.BAA10Y.fetchedAt, '바뀌지 않은 지표의 받은 시각은 그대로')
assert.equal(second.series.T10Y2Y.date, '2026-11-25', '실패한 지표는 마지막 정상 값')

// 더 오래된 응답은 새 자료를 덮지 않는다
fredFail.clear(); fredData.DGS10 = fredData.DGS10.slice(0, -1)
r = await M.refreshFredCache({ now: friAfter, force: true, fetchImpl: fakeFetch, retryDelayMs: 0 })
assert.equal(JSON.parse(kv.get(M.CACHE_KEY)).series.DGS10.date, '2026-11-27')
assert.equal(r.report.T10Y2Y.status, 'updated', '다음 확인에서 실패했던 지표가 채워진다')

// 연결이 한 번 끊긴 지표는 다시 받아 채운다 · 두 번 끊기면 원인 코드와 함께 실패로 남는다
fredData.VIXCLS = [...fredData.VIXCLS, ['2026-11-27', 21]]; fredFlaky.set('VIXCLS', 1)
r = await M.refreshFredCache({ now: friAfter, force: true, fetchImpl: fakeFetch, retryDelayMs: 0 })
assert.equal(r.report.VIXCLS.status, 'updated'); assert.deepEqual(JSON.parse(kv.get(M.RUN_KEY)).retried, ['VIXCLS'])
fredData.WALCL = [...fredData.WALCL, ['2026-11-27', 6600000]]; fredFlaky.set('WALCL', 2)
r = await M.refreshFredCache({ now: friAfter, force: true, fetchImpl: fakeFetch, retryDelayMs: 0 })
assert.equal(r.report.WALCL.status, 'failed'); assert.equal(r.report.WALCL.error, 'fetch failed (ECONNRESET)')
fredData.WALCL = fredData.WALCL.slice(0, -1)
// 기록 쓰기가 실패해도 갱신은 성공으로 끝난다
runSetFail = true; fredData.DGS2 = [...fredData.DGS2, ['2026-11-27', 3.95]]
r = await M.refreshFredCache({ now: friAfter, force: true, fetchImpl: fakeFetch, retryDelayMs: 0 })
assert.equal(r.ok, true); assert.equal(r.report.DGS2.status, 'updated'); assert.equal(JSON.parse(kv.get(M.CACHE_KEY)).series.DGS2.date, '2026-11-27')
runSetFail = false
// 시간 초과는 다시 받지 않는다(함수 제한 20초 안에 끝나야 한다)
assert.match(src, /message !== 'fred_timeout'/)
assert.match(src, /throw controller\.signal\.aborted \? new Error\('fred_timeout'\)/)

// ── 화면용 값 ──
const P = M.macroPayload(JSON.parse(kv.get(M.CACHE_KEY)))
assert.equal(P.success, true); assert.equal(P.t10, 4.2); assert.equal(P.series.DGS10.source, 'FRED · DGS10')
assert.equal(P.series.DGS10.change, +(4.2 - P.series.DGS10.prevValue).toFixed(4))
assert.ok(Number.isFinite(P.curve.min12m) && Number.isFinite(P.credit.ago3m) && Number.isFinite(P.dxy.ago3m))
assert.equal(M.macroPayload(null).success, false, '자료가 없으면 지어내지 않는다')
assert.ok(P.spx && P.spx.close > P.spx.ma200 && P.spx.ma200 > P.spx.ma200ago, '200일선은 마지막 200개 평균, 20거래일 전 평균과 비교')
assert.ok(P.bs.ago6m > P.bs.now && P.fed.now === 3.88 && P.sahm.now === 0.3 && Number.isFinite(P.vix.now))
assert.equal(P.series.SAHMREALTIME.staleDays, 75); assert.equal(P.series.WALCL.staleDays, 14); assert.equal(P.series.DGS10.staleDays, 7)

// ── HTTP: 세션 GET 은 KV 만 읽고, 예약 실행만 FRED 를 부른다 ──
process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough'
process.env.CRON_SECRET = 'cron-test-secret'
const cookie = authHelper.sessionCookie(authHelper.createSessionValue().value).split(';')[0]
const savedFetch = globalThis.fetch
globalThis.fetch = async (u, i) => { if (String(u).startsWith(M.FRED_CSV_URL)) throw new Error('browser path must not call FRED'); return fakeFetch(u, i) }
try {
  const M2 = load()
  let res = recorder(); await M2.default({ method: 'GET', headers: {}, query: {} }, res); assert.equal(res.statusCode, 401)
  res = recorder(); await M2.default({ method: 'GET', headers: { authorization: 'Bearer wrong' }, query: {} }, res); assert.equal(res.statusCode, 401)
  res = recorder(); await M2.default({ method: 'GET', headers: { cookie }, query: { refresh: '1' } }, res)
  assert.equal(res.statusCode, 200); assert.equal(res.body.success, true); assert.equal(res.body.series.BAA10Y.source, 'FRED · BAA10Y')
  globalThis.fetch = fakeFetch
  res = recorder(); await M2.default({ method: 'GET', headers: { authorization: 'Bearer cron-test-secret' }, query: {} }, res)
  assert.equal(res.statusCode, 200); assert.equal(res.body.ok, true)
} finally { globalThis.fetch = savedFetch; delete process.env.CRON_SECRET }

// ── vercel.json: 함수 제한시간·평일 예약 실행(UTC 22:30 = 뉴욕 장 마감 뒤) ──
const vj = JSON.parse(fs.readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'))
assert.ok(vj.functions['api/macro.ts'].maxDuration <= 30)
assert.deepEqual(vj.crons, [{ path: '/api/macro', schedule: '30 22 * * 1-5' }])

// ── 화면: 기존 판정 기준 그대로, 카드마다 날짜·직전 대비·출처 ──
const page = readSource('pages/minervini.js')
assert.match(page, /trdFetchJson\('\/api\/macro'\)/)
assert.doesNotMatch(page, /fred\.stlouisfed\.org/, '브라우저는 FRED 를 부르지 않는다')
const pick = name => { const i = page.indexOf(`function ${name}(`); assert.ok(i >= 0, name); let d = 0, j = page.indexOf('{', i); for (let k = j; k < page.length; k += 1) { if (page[k] === '{') d += 1; else if (page[k] === '}') { d -= 1; if (!d) return page.slice(i, k + 1) } } }
const constLine = name => page.split('\n').find(l => l.startsWith(`const ${name} =`))
const ctx = vm.createContext({ cbEsc: s => String(s), Date, Number, Math, String, Object, Array })
vm.runInContext([constLine('TRD_MACRO'), constLine('TRD_MACRO_X'), pick('trdMacro'), pick('macSrcHtml'), 'this.trdMacro=trdMacro;this.macSrcHtml=macSrcHtml;'].join('\n'), ctx)
const mc = ctx.trdMacro(P)
assert.deepEqual(J(mc.items.map(x => x.key)).sort(), ['bs', 'credit', 'curve', 'dxy', 'fed', 'rate', 'sahm', 'spx', 'vix'])
assert.equal(mc.items.find(x => x.key === 'rate').light, 'n', '10년물은 기존 판정 기준이 없어 참고값')
assert.equal(mc.judged, 8)
assert.equal(mc.items.find(x => x.key === 'fed').src.source, 'FRED · DGS2 · DFF')
for (const lens of ['liq', 'eco', 'val']) assert.equal(mc.items.filter(x => x.lens === lens).length, 3, '세 묶음 모두 3장')
// 기존 기준: 3개월 +1%p 빨강 · 5% 이상 노랑 / 달러 3개월 +5% 빨강 · +2% 노랑 / 금리차 역전 노랑
const L = m => J(ctx.trdMacro({ series: {}, ...m }).items.map(x => x.light))
assert.deepEqual(L({ credit: { now: 2.0, ago3m: 0.9 } }), ['r'])
assert.deepEqual(L({ credit: { now: 5.1, ago3m: 5.0 } }), ['y'])
assert.deepEqual(L({ credit: { now: 1.8, ago3m: 1.7 } }), ['g'])
assert.deepEqual(L({ dxy: { now: 105, ago3m: 100 } }), ['r'])
assert.deepEqual(L({ dxy: { now: 102, ago3m: 100 } }), ['y'])
assert.deepEqual(L({ curve: { now: -0.1, min12m: -0.3 } }), ['y'])
assert.deepEqual(L({ curve: { now: 0.4, min12m: -0.2 } }), ['r'])
assert.deepEqual(L({ curve: { now: 0.4, min12m: 0.1 } }), ['g'])
// 되살린 카드도 기존 기준 그대로: 2년물이 기준금리보다 0.25%p 넘게 높으면 빨강 · 연준 자산 6개월 −3% 이하 빨강 · 200일선 아래 + 내림 빨강
assert.deepEqual(L({ t2: 4.2, fed: { now: 3.9 } }), ['r']); assert.deepEqual(L({ t2: 4.0, fed: { now: 3.9 } }), ['g'])
assert.deepEqual(L({ bs: { now: 96, ago6m: 100 } }), ['r']); assert.deepEqual(L({ bs: { now: 99, ago6m: 100 } }), ['y']); assert.deepEqual(L({ bs: { now: 99, ago6m: null } }), [])
assert.deepEqual(L({ spx: { close: 90, ma200: 100, ma200ago: 101 } }), ['r'])
// 새 두 장: 삼의 법칙 0.5 (원문) · VIX 20/30 (관례)
assert.deepEqual(L({ sahm: { now: 0.5 } }), ['r']); assert.deepEqual(L({ sahm: { now: 0.3 } }), ['g'])
assert.deepEqual(L({ vix: { now: 31 } }), ['r']); assert.deepEqual(L({ vix: { now: 22 } }), ['y']); assert.deepEqual(L({ vix: { now: 15 } }), ['g'])
assert.match(ctx.macSrcHtml({ ...P.series.WALCL }), /직전 대비 [+-]\d+\.\d{2}%</, '연준 자산은 % 로만')
assert.doesNotMatch(ctx.macSrcHtml({ ...P.series.SAHMREALTIME, date: '2026-10-01' }), /오래됨/, '월간 지표는 75일까지 오래됨 아님')
const html = ctx.macSrcHtml(P.series.DTWEXBGS)
assert.match(html, /FRED · DTWEXBGS/); assert.match(html, /\d{4}\.\d{2}\.\d{2} 자료/); assert.match(html, /직전 대비/)
assert.match(ctx.macSrcHtml({ ...P.series.DGS10, date: '2020-01-02' }), /오래됨/)

console.log('test_macro_fred: ok')
