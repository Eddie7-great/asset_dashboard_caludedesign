#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const rootUrl = new URL('../../', import.meta.url)
const authHelper = require(fileURLToPath(new URL('../../api/_auth.js', import.meta.url)))

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
    end() { return this },
  }
}

function compileTs(relativePath, overrides = {}) {
  const source = fs.readFileSync(new URL(relativePath, rootUrl), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  const context = {
    module,
    exports: module.exports,
    process,
    console,
    Buffer,
    AbortController,
    URL,
    setTimeout,
    clearTimeout,
    fetch: overrides.fetch || globalThis.fetch,
    require(id) {
      if (id === './_auth.js') return authHelper
      return require(id)
    },
  }
  vm.createContext(context)
  vm.runInContext(compiled, context)
  return { handler: module.exports.default, source }
}

const envNames = [
  'SESSION_SECRET', 'AUTH_TOKEN', 'INTERNAL_API_TOKEN', 'DASHBOARD_PASSWORD',
  'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'INTERNAL_API_ORIGIN', 'VERCEL_URL',
]
const savedEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]))

try {
  for (const name of envNames) delete process.env[name]

  // Signed session cookie is valid only inside its fixed, short lifetime.
  process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough'
  const signed = authHelper.createSessionValue(1_000)
  assert.equal(authHelper.verifySessionValue(signed.value, 1_001), true)
  assert.equal(authHelper.verifySessionValue(signed.value, 1_000 + authHelper.SESSION_TTL_SECONDS), false)
  assert.match(authHelper.sessionCookie(signed.value), /HttpOnly/)
  assert.match(authHelper.sessionCookie(signed.value), /Secure/)
  assert.match(authHelper.sessionCookie(signed.value), /SameSite=Strict/)

  // 기존 배포는 AUTH_TOKEN을 서버 내부 세션 서명 키로만 이어받는다. 과거처럼
  // 브라우저 bearer로 제출해도 인증되어서는 안 된다.
  delete process.env.SESSION_SECRET
  process.env.AUTH_TOKEN = 'legacy-server-only-migration-secret'
  const migrated = authHelper.createSessionValue(2_000)
  assert.equal(authHelper.verifySessionValue(migrated.value, 2_001), true, '기존 배포 환경 무중단 세션 마이그레이션')
  assert.equal(authHelper.authenticateRequest({ headers: { authorization: `Bearer ${process.env.AUTH_TOKEN}` } }).status, 401, '과거 AUTH_TOKEN bearer 재허용 금지')
  process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough'

  // Login returns a cookie (never a browser-readable bearer) and is rate limited.
  process.env.DASHBOARD_PASSWORD = 'correct horse battery staple'
  const { handler: authHandler, source: authSource } = compileTs('api/auth.ts')
  let response = responseRecorder()
  await authHandler({ method: 'POST', headers: { 'x-forwarded-for': '198.51.100.20' }, body: { password: process.env.DASHBOARD_PASSWORD } }, response)
  assert.equal(response.statusCode, 415, '로그인 POST는 단순 폼 CSRF를 막기 위해 JSON만 허용')

  response = responseRecorder()
  await authHandler({ method: 'POST', headers: { 'x-forwarded-for': '198.51.100.20', 'content-type': 'application/json' }, body: { password: process.env.DASHBOARD_PASSWORD } }, response)
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.success, true)
  assert.equal(Object.hasOwn(response.body, 'token'), false, 'bearer token must not be returned to the browser')
  assert.match(response.headers['set-cookie'], /asset_dashboard_session=/)
  const cookie = response.headers['set-cookie'].split(';')[0]

  response = responseRecorder()
  await authHandler({ method: 'GET', headers: { cookie } }, response)
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.authenticated, true)

  const originalFetch = globalThis.fetch
  process.env.KV_REST_API_URL = 'https://rate-limit.example.test'
  process.env.KV_REST_API_TOKEN = 'rate-limit-secret'
  globalThis.fetch = async () => { throw new Error('simulated Upstash outage') }
  try {
    const unavailable = await authHelper.checkLoginRateLimit({ headers:{ 'x-forwarded-for':'198.51.100.22' } })
    assert.equal(unavailable.allowed, false)
    assert.equal(unavailable.unavailable, true, '분산 제한기가 설정된 상태의 장애는 메모리 fallback 없이 로그인 차단')
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
  }

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    response = responseRecorder()
    await authHandler({ method: 'POST', headers: { 'x-forwarded-for': '198.51.100.21', 'content-type': 'application/json' }, body: { password: 'wrong' } }, response)
    assert.equal(response.statusCode, attempt <= 5 ? 401 : 429)
  }
  assert.ok(response.headers['retry-after'])
  assert.match(authSource, /req\.method === 'DELETE'/, 'logout endpoint is present')

  // All public data APIs fail closed when signing/bearer configuration is missing.
  delete process.env.SESSION_SECRET
  delete process.env.AUTH_TOKEN
  const { handler: priceHandler, source: priceSource } = compileTs('api/price.ts')
  assert.match(priceSource, /internalHeaders\.Cookie = requestCookie/, '내부 Python 호출은 사용자의 HttpOnly 세션을 전달')
  response = responseRecorder()
  await priceHandler({ method: 'GET', headers: {}, query: {} }, response)
  assert.equal(response.statusCode, 500)

  const { handler: searchHandler } = compileTs('api/get-stock.ts')
  response = responseRecorder()
  await searchHandler({ method: 'GET', headers: {}, query: { q: 'AAPL' } }, response)
  assert.equal(response.statusCode, 500)

  const stockHandlerPath = require.resolve('../../api/stock-price.js')
  delete require.cache[stockHandlerPath]
  const stockHandler = require(stockHandlerPath)
  response = responseRecorder()
  await stockHandler({ method: 'GET', headers: {}, query: { ticker: '069500' } }, response)
  assert.equal(response.statusCode, 500)

  const dashboardSource = fs.readFileSync(new URL('../../api/dashboard.py', import.meta.url), 'utf8')
  assert.match(dashboardSource, /if not _auth_configured\(\):[\s\S]*'Auth not configured'/)
  assert.doesNotMatch(dashboardSource, /Access-Control-Allow-Origin/)
  assert.match(priceSource, /process\.env\.INTERNAL_API_ORIGIN[\s\S]*process\.env\.VERCEL_URL/)
  assert.doesNotMatch(priceSource, /req\.headers\.host/)

  // Query caps are enforced before any upstream fan-out.
  process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough'
  const liveCookie = authHelper.sessionCookie(authHelper.createSessionValue().value).split(';')[0]
  const tooMany = Array.from({ length: 26 }, (_, index) => `T${String(index).padStart(2, '0')}`).join(',')
  response = responseRecorder()
  await priceHandler({ method: 'GET', headers: { cookie: liveCookie }, query: { tickers: tooMany } }, response)
  assert.equal(response.statusCode, 400)

  response = responseRecorder()
  await searchHandler({ method: 'GET', headers: { cookie: liveCookie }, query: { q: 'A'.repeat(81) } }, response)
  assert.equal(response.statusCode, 400)

  response = responseRecorder()
  await stockHandler({ method: 'GET', headers: { cookie: liveCookie }, query: { tickers: Array.from({ length: 21 }, (_, i) => String(i).padStart(6, '0')).join(',') } }, response)
  assert.equal(response.statusCode, 400)

  // price → Python dashboard 내부 호출은 신뢰된 origin과 전용 bearer만 사용한다.
  process.env.INTERNAL_API_TOKEN = 'server-internal-token'
  process.env.INTERNAL_API_ORIGIN = 'https://internal.example.test'
  const internalCalls = []
  const { handler: internalPriceHandler } = compileTs('api/price.ts', {
    fetch: async (url, options = {}) => {
      internalCalls.push({ url:String(url), options })
      if (String(url).startsWith('https://open.er-api.com/')) {
        return { ok:true, status:200, json:async()=>({ rates:{ KRW:1380, JPY:150 } }) }
      }
      if (String(url).startsWith('https://internal.example.test/api/dashboard')) {
        return { ok:true, status:200, json:async()=>({ success:true, result:{ '005930':{ dps:1200, yld:1.5, cycle:'분기', months:[2,5,8,11], cur:'KRW' } } }) }
      }
      throw new Error(`unexpected fetch: ${url}`)
    },
  })
  response = responseRecorder()
  await internalPriceHandler({ method:'GET', headers:{ cookie:liveCookie }, query:{ type:'dividend', tickers:'005930' } }, response)
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.result['005930'].source, 'pykrx')
  const dashboardCall = internalCalls.find(call => call.url.startsWith('https://internal.example.test/api/dashboard'))
  assert.ok(dashboardCall, '고정된 내부 origin으로 Python 함수를 호출')
  assert.equal(dashboardCall.options.headers.Authorization, 'Bearer server-internal-token')

  // KV GET preserves legacy values and exposes revision 0; writes require CAS.
  // The removed AUTH_TOKEN bearer must stay invalid; only INTERNAL_API_TOKEN is accepted.
  process.env.AUTH_TOKEN = 'legacy-browser-token'
  process.env.INTERNAL_API_TOKEN = 'server-internal-token'
  process.env.KV_REST_API_URL = 'https://kv.example.test'
  process.env.KV_REST_API_TOKEN = 'kv-secret'
  const upstreamResults = []
  const upstreamCalls = []
  const { handler: kvHandler, source: kvSource } = compileTs('api/kv.ts', {
    fetch: async (url, options) => {
      upstreamCalls.push({ url, options, command: JSON.parse(options.body) })
      return { ok: true, status: 200, json: async () => ({ result: upstreamResults.shift() }) }
    },
  })
  const bearerHeaders = { authorization: 'Bearer server-internal-token' }

  response = responseRecorder()
  await kvHandler({ method: 'GET', headers: { authorization: 'Bearer legacy-browser-token' }, query: { key: 'assets' } }, response)
  assert.equal(response.statusCode, 401)

  upstreamResults.push(['{"legacy":true}', '0'])
  response = responseRecorder()
  await kvHandler({ method: 'GET', headers: bearerHeaders, query: { key: 'assets' } }, response)
  assert.equal(response.body.result, '{"legacy":true}')
  assert.equal(response.body.revision, 0)
  assert.equal(upstreamCalls[0].command[0], 'EVAL')

  response = responseRecorder()
  await kvHandler({ method: 'POST', headers: { ...bearerHeaders, 'content-type': 'application/json' }, query: { key: 'assets' }, body: { value: '[]' } }, response)
  assert.equal(response.statusCode, 428)

  response = responseRecorder()
  await kvHandler({ method: 'POST', headers: bearerHeaders, query: { key: 'assets' }, body: { value: '[]', expectedRevision: 0 } }, response)
  assert.equal(response.statusCode, 415)

  upstreamResults.push([1, '1'])
  response = responseRecorder()
  await kvHandler({ method: 'POST', headers: { ...bearerHeaders, 'content-type': 'application/json; charset=utf-8' }, query: { key: 'assets' }, body: { value: '[]', expectedRevision: 0 } }, response)
  assert.equal(response.body.result, 'OK')
  assert.equal(response.body.revision, 1)

  upstreamResults.push([0, '1'])
  response = responseRecorder()
  await kvHandler({ method: 'POST', headers: { ...bearerHeaders, 'content-type': 'application/json' }, query: { key: 'assets' }, body: { value: '[]', expectedRevision: 0 } }, response)
  assert.equal(response.statusCode, 409)
  assert.equal(response.body.revision, 1)

  response = responseRecorder()
  await kvHandler({ method: 'GET', headers: bearerHeaders, query: { key: 'arbitrary' } }, response)
  assert.equal(response.statusCode, 400)
  assert.match(kvSource, /MAX_VALUE_BYTES = 1_000_000/)

  const vercel = JSON.parse(fs.readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'))
  const securityHeaders = Object.fromEntries(vercel.headers[0].headers.map(item => [item.key, item.value]))
  for (const name of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy']) {
    assert.ok(securityHeaders[name], `${name} must be configured`)
  }

  console.log('PASS backend security contracts')
} finally {
  for (const name of envNames) {
    if (savedEnv[name] === undefined) delete process.env[name]
    else process.env[name] = savedEnv[name]
  }
}
