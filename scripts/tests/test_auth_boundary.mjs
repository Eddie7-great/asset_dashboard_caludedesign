#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const scriptSource = fs.readFileSync(new URL('../../script.js', import.meta.url), 'utf8')
const kvSource = fs.readFileSync(new URL('../../api/kv.ts', import.meta.url), 'utf8')
const authSource = fs.readFileSync(new URL('../../api/auth.ts', import.meta.url), 'utf8')

assert.match(kvSource, /const expectedToken = process\.env\.AUTH_TOKEN/, 'KV 프록시가 서버 인증 토큰을 읽음')
assert.match(kvSource, /if \(!expectedToken\)[\s\S]*status\(500\)/, 'AUTH_TOKEN 누락 시 공개 동작하지 않음')
assert.match(kvSource, /authHeader !== `Bearer \$\{expectedToken\}`[\s\S]*status\(401\)/, 'KV 프록시가 Bearer 토큰을 강제')
assert.match(kvSource, /Cache-Control', 'no-store'/, '민감한 KV 응답 캐시 금지')
assert.doesNotMatch(kvSource, /Access-Control-Allow-Origin/, 'KV 프록시의 전체 출처 CORS 제거')
assert.match(scriptSource, /async function authFetch\([\s\S]*res\.status === 401[\s\S]*sessionStorage\.removeItem\('_dashAuth'\)/, '만료·오류 토큰 제거 후 재로그인 유도')
assert.match(scriptSource, /async function setKV\([\s\S]*authFetch\(`\/api\/kv/, 'KV 쓰기에 인증 헤더 사용')
assert.match(scriptSource, /async function getKV\([\s\S]*authFetch\(`\/api\/kv/, 'KV 읽기에 인증 헤더 사용')
assert.match(authSource, /Cache-Control', 'no-store'/, '로그인 토큰 응답 캐시 금지')
assert.doesNotMatch(authSource, /Access-Control-Allow-Origin/, '로그인 API의 전체 출처 CORS 제거')

// TypeScript 핸들러를 메모리에서 변환해 인증 경계의 실제 응답을 검증한다.
const compiledKv = ts.transpileModule(kvSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const kvModule = { exports: {} }
const upstreamCalls = []
const sandboxProcess = {
  env: {
    KV_REST_API_URL: 'https://kv.example.test',
    KV_REST_API_TOKEN: 'upstash-secret',
  },
}
const kvContext = {
  module: kvModule,
  exports: kvModule.exports,
  require: () => ({}),
  process: sandboxProcess,
  console,
  fetch: async (url, options) => {
    upstreamCalls.push({ url, options })
    return { ok: true, json: async () => ({ result: null }) }
  },
}
vm.createContext(kvContext)
vm.runInContext(compiledKv, kvContext)
const kvHandler = kvModule.exports.default

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

delete sandboxProcess.env.AUTH_TOKEN
let response = responseRecorder()
await kvHandler({ method: 'GET', headers: {}, query: { key: '__auth_probe__' } }, response)
assert.equal(response.statusCode, 500, 'AUTH_TOKEN 누락 시 500으로 fail-closed')
assert.equal(upstreamCalls.length, 0, '인증 설정 오류 요청은 Upstash에 전달하지 않음')

sandboxProcess.env.AUTH_TOKEN = 'browser-secret'
response = responseRecorder()
await kvHandler({ method: 'GET', headers: {}, query: { key: '__auth_probe__' } }, response)
assert.equal(response.statusCode, 401, '무인증 KV GET 차단')
assert.equal(upstreamCalls.length, 0, '무인증 요청은 Upstash에 전달하지 않음')

response = responseRecorder()
await kvHandler({
  method: 'POST',
  headers: { authorization: 'Bearer wrong-secret' },
  query: { key: '__auth_probe__' },
  body: { value: 'test' },
}, response)
assert.equal(response.statusCode, 401, '잘못된 토큰의 KV POST 차단')
assert.equal(upstreamCalls.length, 0, '잘못된 토큰 요청은 Upstash에 전달하지 않음')

response = responseRecorder()
await kvHandler({
  method: 'GET',
  headers: { authorization: 'Bearer browser-secret' },
  query: { key: '__auth_probe__' },
}, response)
assert.equal(response.statusCode, 200, '정상 토큰의 KV GET 허용')
assert.equal(upstreamCalls.length, 1, '정상 토큰 요청만 Upstash에 전달')
assert.equal(upstreamCalls[0].options.headers.Authorization, 'Bearer upstash-secret', 'Upstash 토큰은 서버에서만 사용')

console.log('PASS 인증 경계 보호')
