#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../../script.js', import.meta.url), 'utf8')

function extractFunction(name) {
  const asyncStart = source.indexOf(`async function ${name}(`)
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} 함수를 찾을 수 없음`)
  const open = source.indexOf('{', start)
  let depth = 0
  let quote = null
  let escaped = false
  let lineComment = false
  let blockComment = false
  for (let i = open; i < source.length; i++) {
    const ch=source[i], next=source[i+1]
    if(lineComment){if(ch==='\n')lineComment=false;continue}
    if(blockComment){if(ch==='*'&&next==='/'){blockComment=false;i++}continue}
    if(quote){
      if(escaped){escaped=false;continue}
      if(ch==='\\'){escaped=true;continue}
      if(ch===quote)quote=null
      continue
    }
    if(ch==='/'&&next==='/'){lineComment=true;i++;continue}
    if(ch==='/'&&next==='*'){blockComment=true;i++;continue}
    if(ch==='\''||ch==='"'||ch==='`'){quote=ch;continue}
    if(ch==='{')depth++
    if(ch==='}'&&--depth===0)return source.slice(start,i+1)
  }
  throw new Error(`${name} 함수의 닫는 괄호를 찾을 수 없음`)
}

const notices = []
const freshMarks = []
let setCalls = 0
const context = {
  window: { _kvLoadState:{assets:'pending',ext:'pending'}, _dataFreshness:{}, _netWorthHistory:[] },
  pfolioData: [{ id:'local-asset', grp:'현금', cur:'KRW' }],
  assetHistory: [{ date:'local-history' }],
  goalData: [{ name:'local-goal' }],
  monthlyPLData: [{ id:'local-pl' }],
  cfData: [{ id:'local-cf' }],
  autoTransferData: [{ id:'local-at' }],
  cfDeletedKeys: ['local-deleted'],
  currentOwner: '전체',
  console: { log:()=>{}, warn:()=>{}, error:()=>{} },
  setTimeout: () => 0,
  localStorage: { setItem: () => {} },
  document: { getElementById: () => null, querySelector: () => null },
  getKV: async () => null,
  setKV: async () => { setCalls++; return {result:'OK'} },
  fixAssetCurrencies: value => value,
  showKvLoadError: (message, key) => notices.push({type:'show',message,key}),
  clearKvLoadError: key => notices.push({type:'clear',key}),
  showSaveError: message => notices.push({type:'save',message}),
  finMarkFresh: (...args) => freshMarks.push(args),
  changeOwner: () => {},
  autoFixTickers: () => {},
  _boundedStoredText: value => String(value || ''),
  _normalizeAssetHistoryRows: value => value,
  _normalizeGoalRows: value => value,
  _normalizeNetWorthRows: value => value,
  _normalizeTargetAlloc: value => value,
  _normalizeBalanceSheet: value => value || {assets:[],liabilities:[],cashTargetMonths:6},
  _normalizeGiftActual: value => value,
  _normalizeMonthlyPLRows: value => value,
  _normalizeCfRows: value => value,
  _normalizeAutoTransfers: value => value,
  _normalizeAutoTransferSchedules: () => {},
  saveCfDeletedKeys: () => {},
  renderHistoryChart: () => {},
  updateNetAssetDisplay: () => {},
  renderCashFlow: () => {},
  renderAutoTransfers: () => {},
  renderFixedCostView: () => {},
}
vm.createContext(context)
for (const name of ['loadAssetsFromKV','saveAssetsToKV','loadExtDataFromKV','saveExtDataToKV']) {
  vm.runInContext(extractFunction(name), context)
}

// 자산 GET 실패: 기존 메모리 보존 + 저장 잠금.
context.getKV = async () => { throw new Error('network down') }
let result = await context.loadAssetsFromKV()
assert.equal(result.ok, false, '자산 GET 실패 반환')
assert.equal(context.pfolioData[0].id, 'local-asset', 'GET 실패 시 기존 자산 메모리 보존')
assert.equal(context.window._kvLoadState.assets, 'failed', '자산 로드 상태 failed')
result = await context.saveAssetsToKV()
assert.equal(result.blocked, true, '실패한 자산 원장을 재로드하기 전 저장 차단')
assert.equal(setCalls, 0, '차단된 저장은 KV SET을 호출하지 않음')

// 배열 외형만 맞고 항목이 깨진 응답도 성공 처리하지 않는다.
context.getKV = async () => [null, 5]
result = await context.loadAssetsFromKV()
assert.equal(result.ok, false, '잘못된 자산 항목 형식 거부')
assert.equal(context.pfolioData[0].id, 'local-asset', '잘못된 응답도 기존 자산을 덮어쓰지 않음')
assert.equal(context.window._kvLoadState.assets, 'failed', '항목 형식 오류도 failed')

// 정상 재시도: ready 복귀 후 원격 값 적용.
context.getKV = async () => [{ id:'remote-asset', grp:'현금', cur:'KRW' }]
result = await context.loadAssetsFromKV()
assert.equal(result.ok, true, '자산 재시도 성공')
assert.equal(context.window._kvLoadState.assets, 'ready', '자산 상태 ready 복귀')
assert.equal(context.pfolioData[0].id, 'remote-asset', '정상 원격 자산 적용')
context.setKV = async () => { setCalls++; return {ok:false,status:502} }
result = await context.saveAssetsToKV()
assert.equal(result.ok, false, '자산 SET 실패 반환')
assert.equal(freshMarks.at(-1)[0], 'assets', '자산 저장 실패를 데이터 상태에 반영')
assert.equal(freshMarks.at(-1)[3], false, '자산 저장 실패 상태값')

// 확장 데이터 GET 실패·빈 객체: 기존 목표/현금흐름을 보존하고 저장을 잠근다.
context.getKV = async () => { throw new Error('ext down') }
result = await context.loadExtDataFromKV()
assert.equal(result.ok, false, '확장 데이터 GET 실패 반환')
assert.equal(context.goalData[0].name, 'local-goal', '확장 GET 실패 시 기존 목표 보존')
assert.equal(context.cfData[0].id, 'local-cf', '확장 GET 실패 시 기존 현금흐름 보존')
assert.equal(context.window._kvLoadState.ext, 'failed', '확장 로드 상태 failed')
const callsBeforeExtBlock=setCalls
result = await context.saveExtDataToKV()
assert.equal(result.blocked, true, '실패한 확장 원장을 재로드하기 전 저장 차단')
assert.equal(setCalls, callsBeforeExtBlock, '확장 저장 차단도 KV SET 미호출')

context.getKV = async () => ({})
result = await context.loadExtDataFromKV()
assert.equal(result.ok, false, '알려진 필드가 없는 객체를 확장 데이터로 승인하지 않음')
assert.equal(context.goalData[0].name, 'local-goal', '빈 객체가 기존 목표를 지우지 않음')

context.getKV = async () => ({balanceSheet:{assets:{},liabilities:[]}})
result = await context.loadExtDataFromKV()
assert.equal(result.ok, false, '재무상태표 중첩 배열 형식 검증')

context.getKV = async () => ({ goalData:[{name:'remote-goal'}], cfData:[] })
result = await context.loadExtDataFromKV()
assert.equal(result.ok, true, '확장 데이터 재시도 성공')
assert.equal(context.window._kvLoadState.ext, 'ready', '확장 상태 ready 복귀')
assert.equal(context.goalData[0].name, 'remote-goal', '정상 원격 목표 적용')
assert.equal(context.cfData.length, 0, '원격 빈 배열도 정상 적용해 로컬 잔존값 제거')
assert.equal(context.monthlyPLData.length, 0, '원격 객체의 누락 필드는 로컬 샘플과 섞지 않고 빈 값으로 정규화')
assert.equal(context.window._balanceSheet.assets.length, 0, '누락된 기타 자산을 빈 배열로 정규화')
assert.equal(context.window._balanceSheet.liabilities.length, 0, '누락된 부채를 빈 배열로 정규화')
assert.equal(context.window._balanceSheet.cashTargetMonths, 6, '누락된 현금 목표를 기본 6개월로 정규화')
context.setKV = async () => { setCalls++; return {ok:false,status:502} }
result = await context.saveExtDataToKV()
assert.equal(result.ok, false, '확장 SET 실패 반환')
assert.equal(freshMarks.at(-1)[0], 'ext', '확장 저장 실패를 데이터 상태에 반영')
assert.equal(freshMarks.at(-1)[3], false, '확장 저장 실패 상태값')

// 프론트 KV 계약: HTTP 오류·result 누락은 예외, 정상 JSON 문자열만 파싱.
vm.runInContext(extractFunction('getKV'), context)
context.authFetch = async () => ({ ok:false, status:502 })
await assert.rejects(() => context.getKV('assets'), /KV GET assets 실패 \(502\)/)
context.authFetch = async () => ({ ok:true, json:async () => ({error:'bad shape'}) })
await assert.rejects(() => context.getKV('assets'), /응답 형식 오류/)
context.authFetch = async () => ({ ok:true, json:async () => ({result:'[{"id":1}]'}) })
assert.equal((await context.getKV('assets'))[0].id, 1, '정상 KV JSON 문자열 파싱')

// Yahoo 폴백에서 모든 보유 티커가 실패하면 0% 평탄선을 포트폴리오 성공으로 만들지 않는다.
vm.runInContext(extractFunction('_jsBenchmarkFallback'), context)
const benchmarkTimestamps=[1704067200,1704153600,1704240000]
context.fetch = async url => {
  if(String(url).includes('BAD')) return {ok:false,status:404}
  return {
    ok:true,
    json:async () => ({chart:{result:[{timestamp:benchmarkTimestamps,indicators:{quote:[{close:[100,101,102]}]}}]}}),
  }
}
const fallbackBenchmark=await context._jsBenchmarkFallback([['BAD',100]])
assert.equal(Object.values(fallbackBenchmark).every(row => row.portfolio.length===0), true, '해결된 보유 티커가 없으면 포트폴리오 시계열을 비워 둠')

// 개별 재시도는 요청한 원본만 호출하고, 자산 원장 미준비 시 의존 소스를 성공으로 오판하지 않는다.
const calls={assets:0,ext:0,prices:0,dividends:0,rates:0,benchmark:0,snapshot:0}
Object.assign(context, {
  loadAssetsFromKV: async () => { calls.assets++; context.window._kvLoadState.assets='ready'; return {ok:true} },
  loadExtDataFromKV: async () => { calls.ext++; context.window._kvLoadState.ext='ready'; return {ok:true} },
  refreshMarketPrices: async () => { calls.prices++; return {ok:true} },
  fetchDivData: async () => { calls.dividends++; return {ok:true} },
  refreshPyData: async () => { calls.rates++; return {ok:true} },
  fetchBenchmarkData: async () => { calls.benchmark++; return {ok:true} },
  saveNetWorthSnapshot: async () => { calls.snapshot++; return {ok:true} },
  applyAutoTransfers: () => {}, liveRefreshDomesticEtfs: async () => {}, refreshFNG: () => {},
  renderBubbleChart: () => {}, cbRerender: () => {}, finMarkFresh: () => {},
})
vm.runInContext('let _manualRefreshRunning=false;', context)
vm.runInContext(extractFunction('manualRefresh'), context)
result = await context.manualRefresh('assets')
assert.equal(result.ok, true, '자산 카드 재시도 성공')
assert.deepEqual(calls, {assets:1,ext:0,prices:0,dividends:0,rates:0,benchmark:0,snapshot:0}, '자산 카드가 다른 소스를 호출하지 않음')

context.window._kvLoadState.assets='failed'
result = await context.manualRefresh('benchmark')
assert.equal(result.ok, false, '자산 원장 미준비 상태의 벤치마크 재시도 차단')
assert.equal(result.results.benchmark.blocked, true, '의존성 차단 사유 반환')
assert.equal(calls.benchmark, 0, '빈 자산으로 벤치마크 성공을 만들지 않음')

context.window._kvLoadState.assets='ready'
result = await context.manualRefresh('benchmark')
assert.equal(result.ok, true, '자산 원장 준비 후 벤치마크 개별 재시도 성공')
assert.equal(calls.benchmark, 1, '벤치마크 소스만 실제 호출')

console.log('PASS 데이터 로드 보호·개별 재시도')
