#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const scriptSource = fs.readFileSync(new URL('../../script.js', import.meta.url), 'utf8')
const kvSource = fs.readFileSync(new URL('../../api/kv.ts', import.meta.url), 'utf8')
const authSource = fs.readFileSync(new URL('../../api/auth.ts', import.meta.url), 'utf8')
const authHelperSource = fs.readFileSync(new URL('../../api/_auth.js', import.meta.url), 'utf8')

assert.match(kvSource, /authenticateRequest\(req\)/, 'KV 프록시는 공통 인증 경계를 강제')
assert.match(authHelperSource, /HttpOnly/, '세션 쿠키는 JavaScript에서 읽을 수 없음')
assert.match(authHelperSource, /SameSite=Strict/, '세션 쿠키는 교차 사이트 요청에서 전송하지 않음')
assert.match(authHelperSource, /SESSION_TTL_SECONDS/, '서명 세션에 고정 만료시간 적용')
assert.match(kvSource, /ALLOWED_KEYS = new Set\(\['assets', 'ext_data', 'data_freshness'\]\)/, 'KV 키 allow-list 적용')
assert.match(kvSource, /expectedRevision/, 'KV 쓰기는 revision 기반 CAS 사용')
assert.match(kvSource, /status\(409\)/, 'KV 충돌은 409로 전달')
assert.match(kvSource, /Cache-Control', 'no-store'/, '민감한 KV 응답 캐시 금지')
assert.doesNotMatch(kvSource, /Access-Control-Allow-Origin/, 'KV 프록시에 전체 출처 CORS 없음')

assert.match(scriptSource, /async function authFetch[\s\S]*credentials = 'same-origin'/, '클라이언트 API 요청은 동일 출처 세션 쿠키 사용')
assert.match(scriptSource, /async function _setKVOnce[\s\S]*expectedRevision/, '클라이언트 KV 쓰기는 기대 revision 전송')
assert.match(scriptSource, /async function _setKVOnce[\s\S]*res\.status===409/, '클라이언트 KV 충돌 처리')
assert.match(scriptSource, /const _kvWriteQueues=new Map\(\)[\s\S]*async function setKV/, '같은 키의 연속 저장은 직렬화')
assert.match(scriptSource, /async function getKV[\s\S]*_kvRevisions\.set/, '클라이언트 KV 읽기는 revision 보존')
assert.match(scriptSource, /sessionStorage\.removeItem\('_dashAuth'\)/, '구형 브라우저 bearer 토큰 제거')
assert.doesNotMatch(scriptSource, /sessionStorage\.setItem\('_dashAuth'/, '새 bearer 토큰을 브라우저 저장소에 기록하지 않음')

assert.match(authSource, /Set-Cookie/, '로그인 성공은 서명 세션 쿠키 발급')
assert.match(authSource, /checkLoginRateLimit/, '로그인 시도 제한 적용')
assert.match(authSource, /req\.method === 'DELETE'/, '로그아웃으로 세션 쿠키 폐기')
assert.doesNotMatch(authSource, /token:\s*expected/, '로그인 응답에 서버 비밀을 노출하지 않음')
assert.doesNotMatch(authSource, /Access-Control-Allow-Origin/, '로그인 API에 전체 출처 CORS 없음')

function extractFunction(name) {
  const asyncStart = scriptSource.indexOf(`async function ${name}(`)
  const start = asyncStart >= 0 ? asyncStart : scriptSource.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} 함수를 찾을 수 없음`)
  const open = scriptSource.indexOf('{', start)
  let depth = 0, quote = null, escaped = false, lineComment = false, blockComment = false
  for (let index = open; index < scriptSource.length; index += 1) {
    const ch = scriptSource[index], next = scriptSource[index + 1]
    if (lineComment) { if (ch === '\n') lineComment = false; continue }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; index += 1 } continue }
    if (quote) {
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '/' && next === '/') { lineComment = true; index += 1; continue }
    if (ch === '/' && next === '*') { blockComment = true; index += 1; continue }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '{') depth += 1
    if (ch === '}' && --depth === 0) return scriptSource.slice(start, index + 1)
  }
  throw new Error(`${name} 함수의 닫는 괄호를 찾을 수 없음`)
}

// 같은 탭에서 같은 키를 연속 저장해도 CAS revision을 순서대로 사용해야 한다.
let activeWrites = 0, maxActiveWrites = 0, fetchCalls = 0
const expectedRevisions = []
let releaseFirst
const firstGate = new Promise(resolve => { releaseFirst = resolve })
const queueContext = {
  _kvRevisions: new Map(),
  _kvWriteQueues: new Map(),
  window: { _kvLoadState: { assets:'ready', ext:'ready' } },
  console: { warn:()=>{}, error:()=>{} },
  clearKvLoadError: () => {},
  showKvLoadError: () => {},
  authFetch: async (_url, options) => {
    const call = ++fetchCalls
    const body = JSON.parse(options.body)
    expectedRevisions.push(body.expectedRevision)
    activeWrites += 1
    maxActiveWrites = Math.max(maxActiveWrites, activeWrites)
    if (call === 1) await firstGate
    activeWrites -= 1
    return { ok:true, status:200, json:async()=>({ result:'OK', revision:body.expectedRevision + 1 }) }
  },
}
vm.createContext(queueContext)
vm.runInContext(`${extractFunction('_setKVOnce')}\n${extractFunction('setKV')}`, queueContext)
const firstWrite = queueContext.setKV('assets', [{id:1}])
const secondWrite = queueContext.setKV('assets', [{id:2}])
await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(fetchCalls, 1, '첫 저장 완료 전 두 번째 네트워크 쓰기를 시작하지 않음')
releaseFirst()
await Promise.all([firstWrite, secondWrite])
assert.equal(maxActiveWrites, 1, '같은 키의 네트워크 쓰기 최대 동시성은 1')
assert.deepEqual(expectedRevisions, [0, 1], '성공 revision을 다음 대기 저장이 이어받음')

// 첫 저장이 원격 충돌이면 이미 대기하던 쓰기도 최신 원장 재조회 전에는 보내지 않는다.
queueContext._kvRevisions.clear()
queueContext._kvWriteQueues.clear()
fetchCalls = 0
queueContext.authFetch = async () => {
  fetchCalls += 1
  return { ok:false, status:409, json:async()=>({ error:'Conflict', revision:7 }) }
}
const conflictResults = await Promise.all([
  queueContext.setKV('assets', [{id:3}]),
  queueContext.setKV('assets', [{id:4}]),
])
assert.equal(fetchCalls, 1, '충돌 뒤 대기 저장은 서버로 전송하지 않음')
assert.equal(conflictResults[0].conflict, true)
assert.equal(conflictResults[1].blocked, true)


// ── 매 페이지 오픈 시 재인증 ──
// 페이지를 열 때마다(새로고침 포함) 비밀번호를 다시 받는다. 화면만 가리는 게 아니라
// 남은 세션 쿠키를 서버에서 먼저 폐기해야 API 호출까지 실제로 막힌다.
const onloadStart = scriptSource.indexOf('window.onload = async function()')
assert.notEqual(onloadStart, -1, 'window.onload 진입점을 찾을 수 없음')
const onloadBody = scriptSource.slice(onloadStart, onloadStart + 1200)
assert.match(onloadBody, /fetch\('\/api\/auth',\s*\{\s*method:\s*'DELETE'/,
  '부팅 시 기존 세션 쿠키를 서버에서 폐기')
assert.match(onloadBody, /_setAuthenticatedUi\(false\)/, '부팅 시 항상 로그인 게이트를 띄움')
assert.doesNotMatch(onloadBody, /_startDashboardAfterAuth\(\)/,
  '기존 세션을 이유로 로그인을 건너뛰지 않음')
assert.doesNotMatch(scriptSource, /async function checkAuthSession\(/,
  '부팅 게이트에서 쓰지 않는 세션 확인 함수는 남기지 않음')

// 세션 쿠키: Max-Age 를 붙이지 않아 브라우저 종료 시 사라진다.
// 다만 서명 payload 의 exp 로 서버 측 만료는 그대로 강제한다.
assert.doesNotMatch(authHelperSource, /`Max-Age=\$\{maxAge\}`,\n\s*\]\.join/,
  '세션 쿠키에 무조건적인 Max-Age 를 붙이지 않음')
assert.match(authHelperSource, /if \(maxAge !== null && maxAge !== undefined\) parts\.push\(`Max-Age=\$\{maxAge\}`\)/,
  'maxAge 를 명시한 경우(로그아웃 0)에만 Max-Age 를 붙임')
assert.match(authHelperSource, /function clearSessionCookie\(\)\s*\{\s*return sessionCookie\('', 0\);/,
  '로그아웃은 Max-Age=0 으로 쿠키를 즉시 폐기')

console.log('PASS 인증·KV 클라이언트 경계')
