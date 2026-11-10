#!/usr/bin/env node
// 시세 경로의 세 가지 버그 회귀 방지(2026-11-10)
//  1) /api/stock-price?tickers= 는 한 종목이어도 { result } 모양이다(묶음에 1종목만 남아도 시세가 버려지지 않는다)
//  2) /api/price 는 환율·금 조회 실패 시 고정값을 지어내지 않고 null 을 준다. 화면은 받은 값만 반영한다
//  3) 영숫자 KRX 단축코드(0117V0)를 국내 종목으로 본다
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const rootUrl = new URL('../../', import.meta.url)
const read = f => fs.readFileSync(new URL(f, rootUrl), 'utf8')
const authHelper = require(fileURLToPath(new URL('../../api/_auth.js', import.meta.url)))
const quiet = { log() {}, warn() {}, error() {} }
const recorder = () => ({
  statusCode: 200, headers: {}, body: undefined,
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v },
  status(c) { this.statusCode = c; return this },
  json(b) { this.body = b; return this },
  end() { return this },
})

const saved = process.env.SESSION_SECRET
process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough'
try {
  const cookie = authHelper.sessionCookie(authHelper.createSessionValue().value).split(';')[0]

  // ── 1) stock-price 응답 모양 ─────────────────────────────
  const spModule = { exports: {} }
  const naverHtml = '<div class="wrap_company"><h2><a>테스트</a></h2></div><p class="no_today"><span class="blind">71,200</span></p><table class="no_info"><tr><td><span class="blind">70,000</span></td></tr></table>'
  vm.runInContext(read('api/stock-price.js'), vm.createContext({
    module: spModule, exports: spModule.exports, console: quiet, Date, Map, Set, Promise, Array, Number, String,
    require(id) {
      if (id === 'axios') return { get: async () => ({ data: naverHtml }) }
      if (id === './_auth.js') return authHelper
      return require(id)
    },
  }))
  const stockPrice = spModule.exports
  let res = recorder()
  await stockPrice({ method: 'GET', headers: { cookie }, query: { tickers: '0117V0' } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.result['0117V0'].price, 71200, 'tickers= 는 한 종목이어도 result 로 감싼다')
  res = recorder()
  await stockPrice({ method: 'GET', headers: { cookie }, query: { ticker: '005930' } }, res)
  assert.equal(res.body.price, 71200, 'ticker= 단일 조회는 평탄한 응답 유지')
  assert.equal(res.body.result, undefined)

  const script = read('script.js')
  assert.match(script, /const result = \(data && data\.result\) \|\| \(data && data\.ticker \? \{ \[data\.ticker\]: data \} : \{\}\);/, '화면은 평탄한 응답도 버리지 않는다')
  assert.match(script, /const chunks = _chunkTickers\(tickers, 10\);/)

  // ── 2) price.ts 는 실패한 환율·금값을 지어내지 않는다 ─────
  const priceSource = read('api/price.ts')
  assert.doesNotMatch(priceSource, /\?\? 1380|\?\? 150_000|= 1380,/, '고정 환율·금값 폴백 제거')
  const compilePrice = fetchImpl => {
    const module = { exports: {} }
    const out = ts.transpileModule(priceSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    vm.runInContext(out, vm.createContext({
      module, exports: module.exports, process, console: quiet, Buffer, AbortController, URL, setTimeout, clearTimeout, fetch: fetchImpl,
      require(id) { return id === './_auth.js' ? authHelper : require(id) },
    }))
    return module.exports.default
  }
  const yahooQuote = { ok: true, status: 200, json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: 100 }, indicators: { quote: [{ close: [99, 100] }] }, timestamp: [1, 2] }] } }) }
  // (a) 환율·금 전부 실패
  res = recorder()
  await compilePrice(async url => {
    if (/er-api|exchangerate/.test(String(url))) throw new Error('down')
    if (/GC%3DF|gold-api/.test(String(url))) throw new Error('down')
    return yahooQuote
  })({ method: 'GET', headers: { cookie }, query: { tickers: 'NVDA' } }, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual({ ...res.body.rates }, { USD: null, JPY: null, AUD: null, USDJPY: null, GOLD_G_KRW: null }, '실패한 값은 null')
  // (b) 환율은 받고 금은 실패
  res = recorder()
  await compilePrice(async url => {
    const u = String(url)
    if (u.includes('open.er-api.com')) return { ok: true, status: 200, json: async () => ({ result: 'success', rates: { KRW: 1400, JPY: 140, AUD: 1.6 } }) }
    if (/GC%3DF|gold-api/.test(u)) throw new Error('down')
    return yahooQuote
  })({ method: 'GET', headers: { cookie }, query: { tickers: 'NVDA' } }, res)
  assert.equal(res.body.rates.USD, 1400)
  assert.equal(res.body.rates.JPY, 10)
  assert.equal(res.body.rates.AUD, 875, '호주달러 환율도 함께 준다')
  assert.equal(res.body.rates.USDJPY, 140)

  // 화면: 받은 값만 반영하고 금 시세 수신 여부를 돌려준다
  const applyFn = script.match(/function _applyLiveRates\(rates\)\{[\s\S]*?\n\}/)[0]
  const els = {}
  const ctx = vm.createContext({
    RATES: { USD: 1380, JPY: 9.2, AUD: 900, KRW: 1 }, window: { _GOLD_G_KRW: 140000 },
    document: { getElementById: id => (els[id] = els[id] || { textContent: '' }) }, flash() {},
  })
  vm.runInContext(applyFn, ctx)
  assert.equal(vm.runInContext('_applyLiveRates({USD:null,JPY:null,AUD:null,USDJPY:null,GOLD_G_KRW:null})', ctx), false)
  assert.equal(vm.runInContext('RATES.USD', ctx), 1380, '못 받으면 직전 값 유지')
  assert.equal(vm.runInContext('window._GOLD_G_KRW', ctx), 140000)
  assert.equal(vm.runInContext('_applyLiveRates({USD:1400,JPY:10,AUD:875,USDJPY:140,GOLD_G_KRW:150123})', ctx), true)
  assert.equal(vm.runInContext('RATES.USD+"|"+RATES.JPY+"|"+RATES.AUD+"|"+window._GOLD_G_KRW', ctx), '1400|10|875|150123')
  assert.equal(els['side-gold-rate'].textContent, '₩150,123')
  assert.equal(vm.runInContext('_applyLiveRates(null)', ctx), false)
  assert.match(script, /if\(goldFresh\)\{[\s\S]{0,300}i\._priceStale = false;\s*\}else\{[\s\S]{0,120}i\._priceStale = true;/, '금 시세를 못 받으면 미조회로 드러내고, 받으면 끈다')

  // ── 3) 영숫자 KRX 단축코드 ───────────────────────────────
  const KR = /^[0-9][0-9A-Z]{5}$/
  assert.ok(KR.test('0117V0') && KR.test('005930') && !KR.test('GOOGLE') && !KR.test('NVDA'))
  assert.match(script, /const isKR = \/\^\[0-9\]\[0-9A-Z\]\{5\}\$\/\.test\(rawTkr\);/, '수동 등록도 영숫자 코드를 국내로 본다')
  const search = read('api/get-stock.ts')
  assert.match(search, /const KR_SHORT_CODE_RE = \/\^\[0-9\]\[0-9A-Z\]\{5\}\$\/;/)
  assert.doesNotMatch(search, /isKR = \/\^\\d\{6\}\$\//, '숫자 6자리만 보는 판별 제거')
  assert.equal((search.match(/KR_SHORT_CODE_RE\.test\(/g) || []).length, 3)
} finally {
  if (saved === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = saved
}
console.log('PASS 시세 폴백·응답 모양·영숫자 종목코드')
