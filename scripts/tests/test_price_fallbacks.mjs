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
import { readSource } from './_source.mjs'

const require = createRequire(import.meta.url)
const rootUrl = new URL('../../', import.meta.url)
const read = f => readSource(f)
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

  // ── 1) stock-price 응답 모양 + '직전 종가' 규칙 ─────────────
  // 시각을 고정한다: 2026-11-23(월) KST 10:00 = 장중, 16:00 = 마감 뒤.
  const fixedDate = iso => { const t = Date.parse(iso); return class extends Date { constructor(...a) { super(...(a.length ? a : [t])) } static now() { return t } } }
  const naverHtml = '<div class="wrap_company"><h2><a>테스트</a></h2></div><p class="no_today"><span class="blind">71,200</span></p><table class="no_info"><tr><td><span class="blind">70,000</span></td></tr></table>'
  const dailyRows = [
    { localTradedAt: '2026-11-23', closePrice: '72,000', compareToPreviousClosePrice: '800' },
    { localTradedAt: '2026-11-20', closePrice: '71,200', compareToPreviousClosePrice: '1,200' },
    { localTradedAt: '2026-11-19', closePrice: '70,000', compareToPreviousClosePrice: '-500' },
  ]
  const loadStockPrice = (nowIso, { jsonOk = true } = {}) => {
    const spModule = { exports: {} }
    vm.runInContext(read('api/stock-price.js'), vm.createContext({
      module: spModule, exports: spModule.exports, console: quiet, Date: fixedDate(nowIso), Map, Set, Promise, Array, Number, String, JSON, Math,
      require(id) {
        if (id === 'axios') return { get: async url => {
          if (String(url).includes('m.stock.naver.com')) { if (!jsonOk) throw new Error('down'); return { data: dailyRows } }
          return { data: naverHtml }
        } }
        if (id === './_auth.js') return authHelper
        return require(id)
      },
    }))
    return spModule.exports
  }
  let stockPrice = loadStockPrice('2026-11-23T01:00:00Z')   // KST 10:00 장중
  let res = recorder()
  await stockPrice({ method: 'GET', headers: { cookie }, query: { tickers: '0117V0' } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.result['0117V0'].price, 71200, '장중에는 오늘 줄을 건너뛰고 전 거래일 종가가 직전 종가다')
  assert.equal(res.body.result['0117V0'].prevClose, 70000)
  assert.equal(res.body.result['0117V0'].asOf, '2026-11-20')
  res = recorder()
  await stockPrice({ method: 'GET', headers: { cookie }, query: { ticker: '005930' } }, res)
  assert.equal(res.body.price, 71200, 'ticker= 단일 조회는 평탄한 응답 유지')
  assert.equal(res.body.result, undefined)
  stockPrice = loadStockPrice('2026-11-23T07:00:00Z')        // KST 16:00 마감 뒤
  res = recorder()
  await stockPrice({ method: 'GET', headers: { cookie }, query: { tickers: '005930' } }, res)
  assert.equal(res.body.result['005930'].price, 72000, '15:40 뒤에는 오늘 종가')
  assert.equal(res.body.result['005930'].prevClose, 71200)
  stockPrice = loadStockPrice('2026-11-22T01:00:00Z')        // 일요일: 금요일 종가
  assert.deepEqual({ ...stockPrice.pickLastClose(dailyRows.slice(1)) }, { price: 71200, prevClose: 70000, change: 1200, asOf: '2026-11-20' })
  // JSON 이 실패하면 종목 페이지로: 장중에는 전일 종가, 마감 뒤에는 현재가
  stockPrice = loadStockPrice('2026-11-23T01:00:00Z', { jsonOk: false })
  res = recorder()
  await stockPrice({ method: 'GET', headers: { cookie }, query: { tickers: '005930' } }, res)
  assert.equal(res.body.result['005930'].price, 70000)
  assert.equal(res.body.result['005930'].prevClose, null, '장중 폴백은 그 전 종가를 모른다')
  stockPrice = loadStockPrice('2026-11-23T07:00:00Z', { jsonOk: false })
  res = recorder()
  await stockPrice({ method: 'GET', headers: { cookie }, query: { tickers: '005930' } }, res)
  assert.equal(res.body.result['005930'].price, 71200)
  assert.equal(res.body.result['005930'].prevClose, 70000)

  const script = read('script.js')
  assert.match(script, /Object\.assign\(merged,\(data&&data\.result\)\|\|\(data&&data\.ticker\?\{\[data\.ticker\]:data\}:\{\}\)\);/, '화면은 평탄한 응답도 버리지 않는다')
  assert.match(script, /const chunks=_chunkTickers\(tickers\|\|\[\],10\);/)

  // ── 1-2) 첫 로딩의 국내 시세(2026-11-20 8차): 묶음 둘씩 동시에, 주 시세와 동시에 받되 반영은 주 시세 뒤 ──
  {
    const grab = re => script.match(re)[0]
    const code = [
      grab(/function _chunkTickers\(list, size = API_TICKER_CHUNK\) \{[\s\S]*?\n\}/),
      grab(/function _isDomesticEquity\(item\) \{[\s\S]*?\n\}/),
      grab(/function _domesticQuoteTickers\(\)\{[\s\S]*?\n\}/),
      grab(/async function _fetchDomesticQuotes\(tickers\)\{[\s\S]*?\n\}/),
      grab(/async function liveRefreshDomesticEtfs\(prefetch\) \{[\s\S]*?\n\}/),
      grab(/async function refreshMarketPrices\(\)\{[\s\S]*?\n\}/),
    ].join('\n')
    const log = [], waiters = []
    const domestic = Array.from({ length: 12 }, (_, k) => ({ grp: '주식', tkr: String(100000 + k), cur: 'KRW', curP: 1 }))
    const ctx = vm.createContext({
      API_TICKER_CHUNK: 25, KR_CODE_RE: /^[0-9A-Z]{6}$/i, normTkr: t => String(t || '').trim().toUpperCase().replace(/\.(KS|KQ)$/, ''),
      pfolioData: [...domestic, { grp: '주식', tkr: 'NVDA', cur: 'USD', curP: 1 }], currentOwner: '전체', changeOwner() {}, console: quiet,
      Promise, Set, Array, Object, String,
      authFetch: url => new Promise(resolve => {
        const n = (String(url).match(/tickers=([^&]*)/)[1] || '').split(',').length
        log.push('fetch:' + n)
        waiters.push(() => {
          if (n === 2) { resolve({ ok: false }); return }   // 실패한 묶음은 삼킨다 — 거부가 남지 않는다
          const tick = String(url).match(/tickers=([^,&]*)/)[1]
          resolve({ ok: true, json: async () => n === 1 ? { ticker: tick, success: true, price: 2, prevClose: 2 } : { result: Object.fromEntries(String(url).match(/tickers=([^&]*)/)[1].split(',').map(t => [t, { success: true, price: 5, prevClose: 5 }])) } })
        })
      }),
      liveRefresh: async () => { log.push('primary'); ctx.pfolioData.forEach(i => { i.curP = 3; i._priceStale = false }); return { ok: true } },
    })
    vm.runInContext(code, ctx)
    const done = vm.runInContext('refreshMarketPrices()', ctx)
    await new Promise(r => setTimeout(r, 0))
    assert.deepEqual(log, ['fetch:10', 'fetch:2', 'primary'], '국내 두 묶음을 동시에 보내고, 주 시세를 기다리지 않고 미리 시작한다')
    waiters.forEach(w => w())
    const out = await done
    assert.equal(ctx.pfolioData[0].curP, 5, '국내 값은 주 시세(Yahoo) 뒤에 반영돼 덮는다')
    assert.equal(ctx.pfolioData[11].curP, 3, '실패한 묶음의 종목은 주 시세 값을 유지')
    assert.equal(out.domestic.updated, 10)
    assert.equal(out.domestic.ok, false, '전부 받지 못하면 ok 가 아니다')
    // 묶음이 셋 이상이면 둘씩만 동시에(네이버 동시 요청 상한)
    log.length = 0; waiters.length = 0
    ctx.pfolioData = Array.from({ length: 25 }, (_, k) => ({ grp: '주식', tkr: String(200000 + k), cur: 'KRW', curP: 1 }))
    const p2 = vm.runInContext('_fetchDomesticQuotes(_domesticQuoteTickers())', ctx)
    await new Promise(r => setTimeout(r, 0))
    assert.deepEqual(log, ['fetch:10', 'fetch:10'], '세 번째 묶음은 앞의 둘이 끝난 뒤')
    waiters.splice(0).forEach(w => w())
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0))
    assert.deepEqual(log, ['fetch:10', 'fetch:10', 'fetch:5'])
    waiters.splice(0).forEach(w => w())
    assert.equal(Object.keys(await p2).length, 25)
    // 평탄한 응답(한 종목)도 버리지 않는다
    log.length = 0; waiters.length = 0
    ctx.pfolioData = [{ grp: '주식', tkr: '0117V0', cur: 'KRW', curP: 1 }]
    const p3 = vm.runInContext('liveRefreshDomesticEtfs()', ctx)
    await new Promise(r => setTimeout(r, 0)); waiters.splice(0).forEach(w => w())
    assert.equal((await p3).updated, 1); assert.equal(ctx.pfolioData[0].curP, 2)
  }

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

  // (c) 2026-11-23 단일 기준: 환율 = 네이버(하나은행 고시), 금 = 네이버 국내 금(KRX), 가상화폐 = 업비트 원화
  const naverIdx = (closePrice, extra = {}) => ({ ok: true, status: 200, json: async () => ({ isSuccess: true, result: { closePrice, marketStatus: 'CLOSE', ...extra } }) })
  const marketFetch = ({ upbit = true, bithumb = true, goldOpen = false } = {}) => async url => {
    const u = String(url)
    if (u.includes('FX_USDKRW')) return naverIdx('1,345.20')
    if (u.includes('FX_JPYKRW')) return naverIdx('846.57')
    if (u.includes('FX_AUDKRW')) return naverIdx('894.29')
    if (u.includes('M04020000')) return naverIdx('156,560', goldOpen ? { marketStatus: 'OPEN', marketIndexTotalInfos: [{ code: 'lastClosePrice', value: '153,090' }] } : {})
    if (u.includes('api.upbit.com')) { if (!upbit) throw new Error('ENOTFOUND'); return { ok: true, status: 200, json: async () => [{ market: 'KRW-BTC', trade_price: 83500000, prev_closing_price: 83000000 }] } }
    if (u.includes('api.bithumb.com')) { if (!bithumb) throw new Error('down'); return { ok: true, status: 200, json: async () => ({ status: '0000', data: { closing_price: '83430000', prev_closing_price: '83151000' } }) } }
    if (/er-api|exchangerate|GC%3DF|gold-api/.test(u)) throw new Error('다른 출처를 부르면 안 된다 ' + u)
    return yahooQuote
  }
  res = recorder()
  await compilePrice(marketFetch())({ method: 'GET', headers: { cookie }, query: { tickers: 'NVDA,BTC' } }, res)
  assert.equal(res.body.rates.USD, 1345.2, '달러 = 하나은행 고시')
  assert.equal(Math.round(res.body.rates.JPY * 10000), 84657, '1엔 = 100엔 고시 ÷ 100')
  assert.equal(res.body.rates.AUD, 894.29)
  assert.equal(Math.round(res.body.rates.USDJPY * 100), Math.round(1345.2 / 8.4657 * 100))
  assert.equal(res.body.rates.GOLD_G_KRW, 156560, '금 = KRX 금시장 원/g (마감 뒤 오늘 종가)')
  assert.deepEqual({ ...res.body.quotes.BTC }, { price: 83500000, prevClose: 83000000, currency: 'KRW', source: 'upbit' })
  assert.equal(res.body.quotes.NVDA.currency, undefined, '해외 주식은 종목 통화 그대로')
  res = recorder()
  await compilePrice(marketFetch({ upbit: false, goldOpen: true }))({ method: 'GET', headers: { cookie }, query: { tickers: 'BTC' } }, res)
  assert.equal(res.body.quotes.BTC.source, 'bithumb', '업비트에 닿지 않으면 빗썸 원화')
  assert.equal(res.body.quotes.BTC.price, 83430000)
  assert.equal(res.body.rates.GOLD_G_KRW, 153090, '금 장중에는 전일 종가')
  res = recorder()
  await compilePrice(marketFetch({ upbit: false, bithumb: false }))({ method: 'GET', headers: { cookie }, query: { tickers: 'BTC' } }, res)
  assert.deepEqual({ ...res.body.quotes.BTC }, { price: 100, prevClose: 99, currency: 'USD', source: 'yahoo' }, '둘 다 실패하면 Yahoo 달러(통화 표시)')
  // Yahoo 장중 봉은 버린다(직전 종가)
  {
    const mod = { exports: {} }
    vm.runInContext(ts.transpileModule(priceSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      vm.createContext({ module: mod, exports: mod.exports, process, console: quiet, Buffer, AbortController, URL, setTimeout, clearTimeout, fetch: async () => { throw new Error('no') }, require(id) { return id === './_auth.js' ? authHelper : require(id) } }))
    const body = { chart: { result: [{ meta: { currentTradingPeriod: { regular: { start: 1000, end: 2000 } } }, timestamp: [100, 500, 1100], indicators: { quote: [{ close: [10, 11, 12] }] } }] } }
    assert.deepEqual({ ...mod.exports.yahooCompletedCloses(body, 1500) }, { price: 11, prevClose: 10 }, '장중이면 오늘 봉을 버린다')
    assert.deepEqual({ ...mod.exports.yahooCompletedCloses(body, 2100) }, { price: 12, prevClose: 11 }, '마감 뒤에는 오늘 종가')
    assert.equal(mod.exports.naverGoldClose(null), null)
  }

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

  // 화면: 원화로 온 가상화폐 시세를 종목 통화로 바꾼다 — 표시 원화(curP × RATES[cur])가 업비트 원화가와 같다
  {
    const qctx = vm.createContext({ RATES: { USD: 1345.2, JPY: 8.4657, AUD: 894.29, KRW: 1 } })
    vm.runInContext(script.match(/function _quoteToItemCur\(q,item\)\{[\s\S]*?\n\}/)[0], qctx)
    const usdItem = vm.runInContext('_quoteToItemCur({price:83500000,prevClose:83000000,currency:"KRW"},{cur:"USD"})', qctx)
    assert.equal(Math.round(usdItem.price * 1345.2), 83500000)
    assert.equal(Math.round(usdItem.prevClose * 1345.2), 83000000)
    assert.equal(vm.runInContext('_quoteToItemCur({price:83500000,currency:"KRW"},{cur:"KRW"}).price', qctx), 83500000)
    assert.equal(vm.runInContext('_quoteToItemCur({price:120,prevClose:118},{cur:"USD"}).price', qctx), 120, '통화 표시가 없으면 종목 통화 그대로')
    assert.equal(vm.runInContext('_quoteToItemCur({price:0},{cur:"USD"})', qctx), null)
    assert.match(script, /const conv = _quoteToItemCur\(\{price:q\.price, currency:q\.cur\}, i\);/, 'Python 시세 보완도 같은 변환을 거친다')
  }

  // ── 3) 영숫자 KRX 단축코드 ───────────────────────────────
  const KR = /^[0-9][0-9A-Z]{5}$/
  assert.ok(KR.test('0117V0') && KR.test('005930') && !KR.test('GOOGLE') && !KR.test('NVDA'))
  assert.match(script, /const isKR = \/\^\[0-9\]\[0-9A-Z\]\{5\}\$\/\.test\(rawTkr\);/, '수동 등록도 영숫자 코드를 국내로 본다')
  const search = read('api/get-stock.ts')
  assert.match(search, /const KR_SHORT_CODE_RE = \/\^\[0-9\]\[0-9A-Z\]\{5\}\$\/;/)
  assert.doesNotMatch(search, /isKR = \/\^\\d\{6\}\$\//, '숫자 6자리만 보는 판별 제거')
  assert.equal((search.match(/KR_SHORT_CODE_RE\.test\(/g) || []).length, 3)

  // ── 4) 국내 배당 세 번째 출처: 네이버 증권(2026-11-18) ─────────
  //  pykrx·Yahoo 가 실패했거나 연간 배당 0 일 때만 부르고, 형식이 어긋나면 버린다(지어내지 않는다).
  const nvStock = { stockEndType: 'stock', totalInfos: [{ code: 'lastClosePrice', value: '170,000' }, { code: 'dividendYieldRatio', value: '1.56%' }, { code: 'dividend', value: '2,630원' }] }
  const nvEtf = { stockEndType: 'etf', totalInfos: [{ code: 'lastClosePrice', value: '24,555' }], etfKeyIndicator: { dividendYieldTtm: 1.03 } }
  {
    const mod = { exports: {} }
    vm.runInContext(ts.transpileModule(priceSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      vm.createContext({ module: mod, exports: mod.exports, process, console: quiet, Buffer, AbortController, URL, setTimeout, clearTimeout, fetch: async () => { throw new Error('no') }, require(id) { return id === './_auth.js' ? authHelper : require(id) } }))
    const parse = mod.exports.parseNaverDividend
    const st = parse(nvStock)
    assert.equal(st.dps, 2630, '주식: 주당배당금')
    assert.equal(st.yld, 1.56, '주식: 배당수익률')
    assert.equal(st.source, 'naver')
    assert.equal(st.cycle, '', '주기는 비워 둔다(화면이 내장 배당표·기본값을 쓴다)')
    const etf = parse(nvEtf)
    assert.equal(etf.dps, Math.round(24555 * 1.03 / 100), 'ETF: 최근 1년 분배율 × 전일 종가')
    assert.equal(parse({ stockEndType: 'etf', totalInfos: [], etfKeyIndicator: { dividendYieldTtm: 1 } }), null, 'ETF 종가가 없으면 버림')
    assert.equal(parse({ stockEndType: 'stock', totalInfos: [{ code: 'lastClosePrice', value: '100' }] }), null, '배당 항목이 없으면 버림')
    assert.equal(parse('oops'), null, '형식 오류는 버림')
    assert.equal(parse({ stockEndType: 'stock', totalInfos: [{ code: 'dividend', value: '0원' }] }).dps, 0, '배당 0 도 확인된 값')
  }
  const divCall = async (fetchImpl, tickers) => { const r = recorder(); await compilePrice(fetchImpl)({ method: 'GET', headers: { cookie }, query: { type: 'dividend', tickers } }, r); return r }
  const yahooDivBody = events => ({ ok: true, status: 200, json: async () => ({ chart: { result: [{ meta: { currency: 'KRW', regularMarketPrice: 100000 }, events: { dividends: events } }] } }) })
  // (a) pykrx·Yahoo 모두 배당 없음 → 네이버 값
  let naverCalls = 0
  res = await divCall(async url => {
    const u = String(url)
    if (u.includes('m.stock.naver.com/api/stock/')) { naverCalls++; return { ok: true, status: 200, json: async () => nvStock } }
    if (u.includes('/api/dashboard')) return { ok: false, status: 500, json: async () => ({}) }
    if (u.includes('finance.yahoo.com')) return yahooDivBody({})
    if (u.includes('er-api')) return { ok: true, status: 200, json: async () => ({ result: 'success', rates: { KRW: 1400, JPY: 140, AUD: 1.6 } }) }
    throw new Error('unexpected ' + u)
  }, '035420')
  assert.equal(naverCalls, 1, '앞 두 출처가 배당 0 이면 네이버를 부른다')
  assert.equal(res.body.result['035420'].dps, 2630)
  assert.equal(res.body.result['035420'].source, 'naver')
  assert.ok(Array.from(res.body.verifiedTickers).includes('035420'), '네이버로 확인한 종목은 verified')
  // (b) Yahoo 가 배당을 주면 네이버를 부르지 않는다
  naverCalls = 0
  const now = Math.floor(Date.now() / 1000)
  res = await divCall(async url => {
    const u = String(url)
    if (u.includes('m.stock.naver.com/api/stock/')) { naverCalls++; return { ok: true, status: 200, json: async () => nvStock } }
    if (u.includes('/api/dashboard')) return { ok: false, status: 500, json: async () => ({}) }
    if (u.includes('finance.yahoo.com')) return yahooDivBody({ a: { date: now - 86400 * 30, amount: 500 }, b: { date: now - 86400 * 120, amount: 500 } })
    if (u.includes('er-api')) return { ok: true, status: 200, json: async () => ({ result: 'success', rates: { KRW: 1400, JPY: 140, AUD: 1.6 } }) }
    throw new Error('unexpected ' + u)
  }, '035420')
  assert.equal(naverCalls, 0, '앞 출처가 배당을 주면 네이버를 부르지 않는다')
  assert.equal(res.body.result['035420'].source, 'yahoo')
  // (c) 해외 종목은 네이버를 부르지 않는다
  naverCalls = 0
  res = await divCall(async url => {
    const u = String(url)
    if (u.includes('m.stock.naver.com/api/stock/')) { naverCalls++; return { ok: true, status: 200, json: async () => nvStock } }
    if (u.includes('finance.yahoo.com')) return yahooDivBody({})
    if (u.includes('er-api')) return { ok: true, status: 200, json: async () => ({ result: 'success', rates: { KRW: 1400, JPY: 140, AUD: 1.6 } }) }
    throw new Error('unexpected ' + u)
  }, 'NVDA')
  assert.equal(naverCalls, 0, '해외 종목은 네이버 대상이 아니다')
  // (d) 배당 지급일(2026-11-24): 미국은 stockanalysis 공시 지급일, 국내 ETF 는 배당락일 + 3평일 관행 추정
  {
    const mod = { exports: {} }
    vm.runInContext(ts.transpileModule(priceSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      vm.createContext({ module: mod, exports: mod.exports, process, console: quiet, Buffer, AbortController, URL, setTimeout, clearTimeout, fetch: async () => { throw new Error('no') }, require(id) { return id === './_auth.js' ? authHelper : require(id) } }))
    const { parseStockanalysisDividends, summarizePayDates, addWeekdays } = mod.exports
    const html = 'history:[{dt:"2026-11-30",amt:"$0.274",dec:"n/a",record:"2026-11-30",pay:"2026-12-15"},{dt:"2026-10-30",amt:"$0.2715",dec:"n/a",record:"2026-10-30",pay:"2026-11-13"},{dt:"2026-10-30",amt:"$0.2715",dec:"n/a",record:"2026-10-30",pay:"2026-11-13"}]'
    assert.deepEqual(JSON.parse(JSON.stringify(parseStockanalysisDividends(html))), [{ ex: '2026-11-30', pay: '2026-12-15' }, { ex: '2026-10-30', pay: '2026-11-13' }], '배당락일·지급일 쌍, 중복 제거')
    assert.deepEqual(JSON.parse(JSON.stringify(parseStockanalysisDividends('<html>no table</html>'))), [], '형식이 없으면 빈 목록')
    assert.deepEqual(JSON.parse(JSON.stringify(parseStockanalysisDividends(null))), [])
    const sum = summarizePayDates(['2026-03-27', '2026-07-10', '2026-10-08', '2026-12-28', '2025-01-01'], new Date(2026, 10, 24))
    assert.deepEqual(Array.from(sum.months), [2, 6, 9], '최근 1년 실제 지급월(배당락월이 아니다)')
    assert.deepEqual(Array.from(sum.payDates), ['2026-03-27', '2026-07-10', '2026-10-08', '2026-12-28'], '1년보다 오래된 지급일은 버리고 앞으로의 확정 지급일은 남긴다')
    assert.equal(summarizePayDates([], new Date()), null)
    const k = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    assert.equal(k(addWeekdays(new Date(2026, 9, 29), 3)), '2026-11-03', '국내 ETF: 10/29(목) 배당락 → 10/30 기준일 → 11/3 지급 — 다음 달로 넘어간다')
    const iso = ms => k(new Date(ms))
    const nowMs = Date.now()
    const usBody = { ok: true, status: 200, json: async () => ({ chart: { result: [{ meta: { currency: 'USD', regularMarketPrice: 50, instrumentType: 'EQUITY' }, events: { dividends: { a: { date: Math.floor(nowMs / 1000) - 86400 * 40, amount: 0.27 } } } }] } }) }
    let saUrl = ''
    res = await divCall(async url => {
      const u = String(url)
      if (u.includes('stockanalysis.com')) { saUrl = u; return { ok: true, status: 200, text: async () => `history:[{dt:"x",amt:"",dec:"",record:"",pay:"x"},{dt:"${iso(nowMs - 86400000 * 40)}",amt:"$0.27",dec:"n/a",record:"",pay:"${iso(nowMs - 86400000 * 25)}"},{dt:"${iso(nowMs + 86400000 * 5)}",amt:"$0.27",dec:"n/a",record:"",pay:"${iso(nowMs + 86400000 * 20)}"}]` } }
      if (u.includes('finance.yahoo.com')) return usBody
      if (u.includes('er-api')) return { ok: true, status: 200, json: async () => ({ result: 'success', rates: { KRW: 1400, JPY: 140, AUD: 1.6 } }) }
      throw new Error('unexpected ' + u)
    }, 'O')
    const o = res.body.result.O
    assert.match(saUrl, /stockanalysis\.com\/stocks\/o\/dividend\//, '주식은 stocks 경로')
    assert.equal(o.paySource, 'stockanalysis')
    assert.ok(Array.from(o.payDates).includes(iso(nowMs + 86400000 * 20)), '앞으로의 확정 지급일을 싣는다')
    assert.equal(o.payDay, Number(iso(nowMs - 86400000 * 25).slice(8)), '최빈 지급일은 배당락일이 아니라 지급일에서')
    // stockanalysis 실패 → 예전처럼 배당락일 기준 추정
    res = await divCall(async url => {
      const u = String(url)
      if (u.includes('stockanalysis.com')) return { ok: false, status: 404, text: async () => '' }
      if (u.includes('finance.yahoo.com')) return usBody
      if (u.includes('er-api')) return { ok: true, status: 200, json: async () => ({ result: 'success', rates: { KRW: 1400, JPY: 140, AUD: 1.6 } }) }
      throw new Error('unexpected ' + u)
    }, 'O')
    assert.equal(res.body.result.O.paySource, 'ex-date', '지급일 출처가 없으면 배당락일 기준 추정이라고 밝힌다')
    assert.equal(res.body.result.O.payDates, undefined)
  }
  // 화면: 주기를 모르면 1회 지급액을 화면이 쓸 기본 지급월 수로 나눈다(연간 배당이 4배로 잡히지 않게)
  assert.match(script, /const payMonths = months\.length \? months : \(_defaultMonthsForCycle\(cycle\) \|\| \[2,5,8,11\]\);\s*const cycleN = cycle !== '-' && CYCLE_COUNT\[cycle\] \? CYCLE_COUNT\[cycle\] : payMonths\.length;/)
} finally {
  if (saved === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = saved
}
console.log('PASS 시세 폴백·응답 모양·영숫자 종목코드')
