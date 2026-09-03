#!/usr/bin/env node
// 배당 세후 계산 + 금융소득종합과세 근접도
//   - 세율은 script.js 의 getAccountDivTaxInfo 하나만 쓴다 (일반 15.4% / ISA 9.9% / 연금 과세이연)
//   - ISA 200만원 공제는 종목이 아니라 소유주·연도 단위이므로, 소유주 합계에서 공제한 뒤
//     세액을 종목에 배당수입 비례로 나눠야 한다.
//   - 종합과세 판정 대상은 일반계좌 배당뿐 (ISA 분리과세·연금 과세이연 제외)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const cobaltSource = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8')
const scriptSource = fs.readFileSync(new URL('../../script.js', import.meta.url), 'utf8')

function extractFunction(source, name) {
  const functionStart = source.indexOf(`function ${name}(`)
  assert.notEqual(functionStart, -1, `${name} 함수를 찾을 수 없음`)
  const start = source.slice(Math.max(0, functionStart - 6), functionStart) === 'async '
    ? functionStart - 6
    : functionStart
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`${name} 함수의 닫는 괄호를 찾을 수 없음`)
}

const context = { console, Date, _taxRuleValue: (_path, fallback) => fallback }
vm.createContext(context)
// 세율 규칙은 실제 script.js 구현을 그대로 가져와 중복 정의를 만들지 않는다
vm.runInContext(extractFunction(scriptSource, 'getAccountDivTaxInfo'), context)
vm.runInContext(extractFunction(scriptSource, 'allocateDividendTax'), context)
vm.runInContext('const CB_FIN_INCOME_THRESHOLD=20000000;', context)
vm.runInContext(extractFunction(cobaltSource, 'cbDivTaxInfo'), context)
vm.runInContext(extractFunction(cobaltSource, 'cbDivTaxAllocate'), context)

// ── 계좌별 세율 ────────────────────────────────────────
const single = context.cbDivTaxAllocate([
  { owner: '본인', acc: '일반', gross: 10_000_000, key: 'a' },
  { owner: '본인', acc: '연금저축', gross: 5_000_000, key: 'b' },
])
const byKey = Object.fromEntries(single.list.map(e => [e.key, e]))
assert.equal(Math.round(byKey.a.tax), 1_540_000, '일반계좌는 15.4% 원천징수')
assert.equal(byKey.b.tax, 0, '연금저축은 배당 시점 과세이연이라 세금 0')
assert.equal(Math.round(byKey.a.net), 8_460_000, '일반계좌 세후 배당')

// ── ISA 공제는 소유주 단위 ─────────────────────────────
// 같은 소유주의 ISA 배당 300만 → 200만 공제 후 100만에 9.9% = 99,000원
const isa = context.cbDivTaxAllocate([
  { owner: '본인', acc: 'ISA', gross: 2_000_000, key: 'x' },
  { owner: '본인', acc: 'ISA', gross: 1_000_000, key: 'y' },
])
const isaTax = isa.list.reduce((s, e) => s + e.tax, 0)
assert.equal(Math.round(isaTax), 99_000, 'ISA 공제를 소유주 합계에 한 번만 적용')
const isaByKey = Object.fromEntries(isa.list.map(e => [e.key, e]))
assert.equal(Math.round(isaByKey.x.tax), 66_000, 'ISA 세액을 배당수입 비례로 배분 (2/3)')
assert.equal(Math.round(isaByKey.y.tax), 33_000, 'ISA 세액을 배당수입 비례로 배분 (1/3)')

// 종목별로 따로 공제하면 둘 다 200만 이하라 세금이 0이 된다 — 그 오류를 막았는지 확인
assert.notEqual(Math.round(isaTax), 0, '종목별 공제로 계산해 세금이 사라지지 않아야 함')

// 소유주가 다르면 각자 200만원씩 공제
const twoOwners = context.cbDivTaxAllocate([
  { owner: '본인', acc: 'ISA', gross: 2_000_000, key: 'p' },
  { owner: '아내', acc: 'ISA', gross: 2_000_000, key: 'q' },
])
assert.equal(twoOwners.list.reduce((s, e) => s + e.tax, 0), 0, '소유주별로 200만원 공제를 각각 적용')

// ── 금융소득종합과세 근접도 ────────────────────────────
const comp = context.cbDivTaxAllocate([
  { owner: '본인', acc: '일반', gross: 18_000_000, key: 'g1' },
  { owner: '본인', acc: 'ISA', gross: 9_000_000, key: 'g2' },
  { owner: '본인', acc: 'IRP', gross: 9_000_000, key: 'g3' },
  { owner: '아내', acc: '일반', gross: 25_000_000, key: 'g4' },
])
const owners = Object.fromEntries(comp.owners.map(o => [o.owner, o]))
assert.equal(owners['본인'].comprehensiveBase, 18_000_000, '종합과세 판정에는 일반계좌 배당만 포함')
assert.equal(owners['본인'].comprehensiveOver, 0, 'ISA·연금을 더해 넘긴 것으로 오판하지 않음')
assert.equal(Math.round(owners['본인'].comprehensivePct), 90, '기준 대비 근접도 계산')
assert.equal(owners['아내'].comprehensiveOver, 5_000_000, '기준 초과분 계산')
assert.equal(owners['본인'].isa, 9_000_000, 'ISA 배당을 별도로 집계')
assert.equal(owners['본인'].pension, 9_000_000, '연금 배당을 별도로 집계')

// legacy 차트 동기화 경로도 모든 종목을 모은 뒤 같은 엔진을 한 번만 호출한다.
Object.assign(context, {
  ALL_OWNERS:['전체','본인'],
  divHistory:{},
  divHistoryYears:()=>['2026'],
  pfolioData:[
    {grp:'주식',qty:1_000_000,tkr:'AAA',owner:'본인',acc:'ISA',cur:'KRW'},
    {grp:'주식',qty:1_000_000,tkr:'BBB',owner:'본인',acc:'ISA',cur:'KRW'},
  ],
  DIV_INFO_DB:{}, CYCLE_COUNT:{}, RATES:{KRW:1},
  normDivTkr:ticker=>ticker,
  _emptyDivHistory:()=>({}),
})
context.window = {
  _divDataCache:{
    AAA:{eps:2,months:[2],cur:'KRW'},
    BBB:{eps:1,months:[5],cur:'KRW'},
  },
}
vm.runInContext(extractFunction(scriptSource, 'syncDivHistory'), context)
context.syncDivHistory()
assert.equal(Math.round(context.divHistory['2026']['본인'][2]), 1_934_000, 'legacy 3월 ISA 세후 배당 비례 배분')
assert.equal(Math.round(context.divHistory['2026']['본인'][5]), 967_000, 'legacy 6월 ISA 세후 배당 비례 배분')

// ── 과거 캘린더 세후 금액 ───────────────────────────────
// 서로 다른 두 ISA 종목의 과거 지급액도 종목별 공제가 아니라 소유주 연간 합계로 계산한다.
Object.assign(context, {
  window: {
    _divHistoryRawCache: {
      AAA: { cur: 'KRW', events: [{ date: '2025-03-15', amount: 2 }] },
      BBB: { cur: 'KRW', events: [{ date: '2025-06-15', amount: 1 }] },
    },
  },
  cbRate: () => 1,
})
for (const name of ['cbStrip', 'cbDefaultDivMonths', 'cbAddDivMonthDetail', 'cbDivMonthlyForYear']) {
  vm.runInContext(extractFunction(cobaltSource, name), context)
}
const historicalList = [
  { i:{ owner:'본인', tkr:'AAA', cur:'KRW' }, tkr:'AAA', title:'A', qty:1_000_000, d:{cur:'KRW'}, taxLots:[{owner:'본인',acc:'ISA',qty:1_000_000}] },
  { i:{ owner:'본인', tkr:'BBB', cur:'KRW' }, tkr:'BBB', title:'B', qty:1_000_000, d:{cur:'KRW'}, taxLots:[{owner:'본인',acc:'ISA',qty:1_000_000}] },
]
const historicalGross = context.cbDivMonthlyForYear(historicalList, '2025', false)
const historicalNet = context.cbDivMonthlyForYear(historicalList, '2025', true)
assert.equal(Math.round(historicalGross.monthAmt.reduce((s, value) => s + value, 0)), 3_000_000, '과거 세전 캘린더는 지급 이력 합계')
assert.equal(Math.round(historicalNet.monthAmt.reduce((s, value) => s + value, 0)), 2_901_000, '과거 세후 캘린더도 ISA 연간 공제를 한 번만 적용')
assert.equal(Math.round(historicalNet.monthAmt[2]), 1_934_000, '연간 ISA 세액을 3월 지급액에 비례 배분')
assert.equal(Math.round(historicalNet.monthAmt[5]), 967_000, '연간 ISA 세액을 6월 지급액에 비례 배분')

// ── 자동 현금흐름 배당 ──────────────────────────────────
// 같은 소유주·종목·계좌유형의 복수 계좌를 한 항목에 합산하고, ISA 연 공제를 한 번만 적용한다.
let localSaveCount = 0
let remoteSaveCount = 0
let remoteSaveOk = true
const cashContext = {
  console, Date, JSON, Math, Number, Set, Map,
  _taxRuleValue: (_path, fallback) => fallback,
  cfData: [{
    date:'2026-03-15', type:'수입', cat:'배당금', desc:'예전 일반계좌 자동 배당', amt:1,
    owner:'본인', divKey:'div_AAA_본인_일반_2026_3',
  }], cfDeletedKeys: [], cfYear: 2026, cfMonth: 3,
  RATES: { KRW: 1, USD: 1380, JPY: 9.2 },
  pfolioData: [
    { grp:'주식', qty:1_000_000, tkr:'AAA', owner:'본인', broker:'A증권', acc:'A ISA' },
    { grp:'주식', qty:1_000_000, tkr:'AAA', owner:'본인', broker:'B증권', acc:'B ISA' },
  ],
  getDivStocks: () => [{ name:'테스트배당주', tkr:'AAA', eps:1.5, months:[2], cycle:'연간', cur:'KRW', payDay:15 }],
  cleanupDuplicateDivEntries: () => {},
  saveCfData: () => { localSaveCount++ },
  saveExtDataToKV: async () => { remoteSaveCount++; return { ok:remoteSaveOk } },
  renderCashFlow: () => {},
  alert: () => {},
}
vm.createContext(cashContext)
vm.runInContext(extractFunction(scriptSource, 'getAccountDivTaxInfo'), cashContext)
vm.runInContext(extractFunction(scriptSource, 'allocateDividendTax'), cashContext)
vm.runInContext(extractFunction(scriptSource, '_normDivKey'), cashContext)
vm.runInContext(extractFunction(scriptSource, 'autoAddDividendCashFlow'), cashContext)

const firstCashSync = await cashContext.autoAddDividendCashFlow(true)
assert.equal(firstCashSync.ok, true, '자동 배당 현금흐름 원격 저장 성공')
assert.equal(cashContext.cfData.length, 1, '동일 유형 ISA 복수 계좌를 중복 없이 한 항목으로 합산')
assert.equal(cashContext.cfData[0].divKey, 'div_AAA_본인_ISA_2026_3', '계좌유형 변경 전 오래된 자동 배당 제거')
assert.equal(cashContext.cfData[0].amt, 2_901_000, 'ISA 연 300만원에서 200만원 공제 후 세후액 반영')
assert.equal(localSaveCount, 1, '변경된 자동 배당을 로컬에 한 번 저장')
assert.equal(remoteSaveCount, 1, '변경된 자동 배당을 원격 정본에도 한 번 저장')

cashContext.pfolioData[1].qty = 2_000_000
remoteSaveOk = false
const failedCashSync = await cashContext.autoAddDividendCashFlow(true)
assert.equal(failedCashSync.ok, false, '원격 저장 실패를 성공으로 처리하지 않음')
assert.equal(cashContext.cfData.length, 1, '보유수량 변경 후에도 기존 자동 배당 항목을 재사용')
assert.equal(cashContext.cfData[0].amt, 4_252_500, '보유수량 변경 시 기존 자동 배당 금액 갱신')
assert.equal(remoteSaveCount, 2, '금액 갱신도 원격 정본에 저장')
remoteSaveOk = true
const retriedCashSync = await cashContext.autoAddDividendCashFlow(true)
assert.equal(retriedCashSync.retried, true, '저장 실패 뒤 무변경 호출도 원격 저장 재시도')
assert.equal(remoteSaveCount, 3, '실패한 원격 저장을 성공할 때까지 재시도')
await cashContext.autoAddDividendCashFlow(true)
assert.equal(remoteSaveCount, 3, '저장 성공 뒤 변경이 없으면 불필요한 원격 저장 생략')

cashContext.pfolioData.forEach(item => { item.qty = 0 })
await cashContext.autoAddDividendCashFlow(true)
assert.equal(cashContext.cfData.length, 0, '전량 매도한 종목의 오래된 자동 배당 제거')
assert.equal(remoteSaveCount, 4, '오래된 자동 배당 제거도 원격 정본에 저장')

cashContext.pfolioData[0].qty = 1_000_000
cashContext.pfolioData[1].qty = 1_000_000
cashContext.cfDeletedKeys.push('div:div_AAA_본인_2026_03')
cashContext.cfData.push({
  date:'2026-03-15', type:'수입', cat:'배당금', desc:'삭제된 기존 ISA 배당', amt:2_901_000,
  owner:'본인', divKey:'div_AAA_본인_ISA_2026_3',
})
await cashContext.autoAddDividendCashFlow(true)
assert.equal(cashContext.cfData.length, 0, '구형 5-part 삭제 키도 신규 계좌유형 자동 배당 재생성을 차단')
assert.equal(remoteSaveCount, 5, '삭제 키와 충돌하는 기존 자동 배당 제거를 원격 정본에 반영')

cashContext.cfDeletedKeys.length = 0
cashContext.getDivStocks = () => []
cashContext.cfData.push({
  date:'2026-03-15', type:'수입', cat:'배당금', desc:'정상 기존 ISA 배당', amt:2_901_000,
  owner:'본인', divKey:'div_AAA_본인_ISA_2026_3',
})
await cashContext.autoAddDividendCashFlow(true)
assert.equal(cashContext.cfData.length, 1, '배당 데이터 조회가 비어도 현재 보유 중인 정상 자동 배당 보존')
assert.equal(remoteSaveCount, 5, '불완전 배당 데이터를 근거로 삭제·원격 저장하지 않음')

// ── 파괴적 정리의 경계 ──────────────────────────────────
// 이 정리는 사용자의 가계부 기록을 지운다. 어떤 근거로 지우고 어떤 경우엔 지우지 않는지
// 시나리오별로 고정해 둔다(회귀 시 조용히 데이터가 사라지는 것을 막기 위함).

// (1) 조회 중인 연·월 밖의 행은 건드리지 않는다.
cashContext.cfData.push(
  { date:'2026-04-15', type:'수입', cat:'배당금', desc:'4월 자동 배당', amt:100,
    owner:'본인', divKey:'div_AAA_본인_ISA_2026_4' },
  { date:'2025-03-15', type:'수입', cat:'배당금', desc:'작년 3월 자동 배당', amt:100,
    owner:'본인', divKey:'div_AAA_본인_ISA_2025_3' },
)
await cashContext.autoAddDividendCashFlow(true)
assert.deepEqual(
  cashContext.cfData.map(row => row.divKey).sort(),
  ['div_AAA_본인_ISA_2025_3', 'div_AAA_본인_ISA_2026_3', 'div_AAA_본인_ISA_2026_4'],
  '정리는 조회 중인 연·월에만 적용하고 다른 기간 기록은 보존',
)

// (2) 정적 DB 폴백(_divSource:'db')은 삭제 근거가 되지 못한다.
//     배당 API 가 실패해도 내장 DB 덕분에 일정이 '있는 것처럼' 보이므로,
//     이걸 근거로 지우면 조회 실패가 곧 데이터 삭제가 된다.
cashContext.getDivStocks = () => [{
  name:'테스트배당주', tkr:'AAA', eps:1.5, months:[5], cycle:'연간', cur:'KRW', payDay:15,
  _divSource:'db',
}]
const beforeDbFallback = remoteSaveCount
await cashContext.autoAddDividendCashFlow(true)
assert.equal(
  cashContext.cfData.some(row => row.divKey === 'div_AAA_본인_ISA_2026_3'), true,
  '정적 DB 폴백만으로는 이번 달 지급이 없다고 단정해 기존 행을 지우지 않음',
)
assert.equal(remoteSaveCount, beforeDbFallback, 'DB 폴백 상황에서는 원격 저장도 일으키지 않음')

// (3) 캐시/API 로 확인된 일정에서 이번 달 지급이 사라지면 그때는 지운다.
cashContext.getDivStocks = () => [{
  name:'테스트배당주', tkr:'AAA', eps:1.5, months:[5], cycle:'연간', cur:'KRW', payDay:15,
  _divSource:'cache',
}]
await cashContext.autoAddDividendCashFlow(true)
assert.equal(
  cashContext.cfData.some(row => row.divKey === 'div_AAA_본인_ISA_2026_3'), false,
  '확인된 일정에서 이번 달 지급이 빠지면 오래된 자동 배당 제거',
)
assert.deepEqual(
  cashContext.cfData.map(row => row.divKey).sort(),
  ['div_AAA_본인_ISA_2025_3', 'div_AAA_본인_ISA_2026_4'],
  '삭제는 해당 연·월 행에만 적용',
)

// (4) 사용자가 직접 만든(divKey 없는) 배당 기록은 자동 정리 대상이 아니다.
cashContext.cfData.push({
  date:'2026-03-20', type:'수입', cat:'배당금', desc:'직접 입력한 배당', amt:500_000, owner:'본인',
})
await cashContext.autoAddDividendCashFlow(true)
assert.equal(
  cashContext.cfData.some(row => row.desc === '직접 입력한 배당'), true,
  '앱이 만들지 않은 수기 배당 기록은 자동 정리에서 제외',
)

// Python API의 dps는 연간 합계이므로 지급월 수로 나눠 회당 eps를 만든다.
const normalizeContext = {
  Number, Set,
  CYCLE_COUNT:{'월배당':12,'분기':4,'반기':2,'연간':1,'-':1},
}
vm.createContext(normalizeContext)
vm.runInContext(extractFunction(scriptSource, '_defaultMonthsForCycle'), normalizeContext)
vm.runInContext(extractFunction(scriptSource, '_normalizePyDividendInfo'), normalizeContext)
const quarterlyPy = normalizeContext._normalizePyDividendInfo(
  'AAA', {dps:120, yld:4, cycle:'분기', months:[2,5,8,11], cur:'USD'}, {},
)
assert.equal(quarterlyPy.annualDps, 120, 'Python 연간 DPS 원값 보존')
assert.equal(quarterlyPy.eps, 30, '분기배당 연간 DPS를 4회로 나눔')
const monthlyPy = normalizeContext._normalizePyDividendInfo(
  'BBB', {dps:120, yld:6, cycle:'월배당', months:[0,1,2,3,4,5,6,7,8,9,10,11], cur:'USD'}, {},
)
assert.equal(monthlyPy.eps, 10, '월배당 연간 DPS를 12회로 나눔')

// ── 페이지 배선 ────────────────────────────────────────
assert.match(cobaltSource, /onclick="cbDivBasis\('gross'\)"[\s\S]*onclick="cbDivBasis\('net'\)"/, '배당 관리에 세전/세후 토글 제공')
assert.match(cobaltSource, /return allocateDividendTax\(entries,CB_FIN_INCOME_THRESHOLD\)/, '화면은 script.js의 공통 배당세 엔진에 위임')
assert.match(cobaltSource, /const incomeKRW = netBasis \? netKRW : grossKRW/, '표시 기준에 따라 카드·캘린더·표가 같은 값을 사용')
assert.match(cobaltSource, /지급 이력 기반/, '과거 캘린더는 현재 보유수량 환산임을 오해하지 않게 표시')
assert.match(cobaltSource, /입력된 일반계좌 배당 기준 금융소득 근접도/, '소유주별 부분 금융소득 게이지 제공')
assert.match(cobaltSource, /소급 적용\(백캐스트\)/, '성과 비교가 백캐스트임을 헤더에 표기')
assert.match(scriptSource, /function divHistoryYears\(\)/, '배당 이력 연도를 실행 시점 기준으로 계산')
assert.match(scriptSource, /async function autoAddDividendCashFlow[\s\S]*allocateDividendTax\(annualLots\)[\s\S]*await saveExtDataToKV\(\)/, '자동 현금흐름도 공통 연간 세금 엔진과 원격 저장 사용')
assert.match(scriptSource, /function _normalizePyDividendInfo[\s\S]*annualDps\/payoutCount/, 'Python 연간 DPS를 회당 지급액으로 정규화')
assert.doesNotMatch(scriptSource.replace(/^.*예전에는.*$/m, ''), /\['2025','2026'\]/, '연도 하드코딩 제거')

console.log('PASS 배당 세후·금융소득종합과세')
