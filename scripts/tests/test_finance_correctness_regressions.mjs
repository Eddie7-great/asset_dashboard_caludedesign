#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const cobaltSource = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8')
const financeSource = fs.readFileSync(new URL('../../finance.js', import.meta.url), 'utf8')
const scriptSource = fs.readFileSync(new URL('../../script.js', import.meta.url), 'utf8')

function extractFunction(source, name) {
  const asyncStart = source.indexOf(`async function ${name}(`)
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} 함수를 찾을 수 없음`)
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

// ── 양도세: 공제는 가구 전체 한 번이 아니라 소유주별 적용 ─────────────
const taxContext = {
  window: {},
  _taxRuleValue: (_path, fallback) => fallback,
  cssVar: (_key, fallback) => fallback,
  cbKrw: value => `${Math.round(Number(value) || 0)}원`,
  cbEsc: value => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
  cbSmoothPath: points => 'M' + points.map(point => `${point.x},${point.y}`).join(' L'),
}
vm.createContext(taxContext)
vm.runInContext("const CB_TAX_ACCTS=['일반','연금저축','ISA']; const CB_TAX_FGN_DED=2500000; const CB_TAX_ISA_DED=2000000; let _cbTaxMonthFilter=null;", taxContext)
for (const name of ['cbTaxAcctOf', 'cbTaxSummary', 'cbNiceStep', 'cbTaxAxisLab', 'cbTaxChartSvg']) {
  vm.runInContext(extractFunction(cobaltSource, name), taxContext)
}
const ownerOf = row => row.owner && row.owner !== '전체' ? row.owner : null
const foreign = (owner, amt, month='2026-01') => ({ owner, amt, month, category:'foreign', account:'일반' })

const twoOwnersBelow = taxContext.cbTaxSummary([
  foreign('본인', 2_000_000),
  foreign('아내', 2_000_000),
], ownerOf)
assert.equal(twoOwnersBelow.totalDue, 0, '두 소유주가 각각 해외이익 200만원이면 각자 기본공제 범위라 합계 세액 0')
assert.deepEqual(Array.from(twoOwnersBelow.buckets, row => row.genBase), [0, 0], '소유주별 과세표준을 각각 계산')

const twoOwnersAbove = taxContext.cbTaxSummary([
  foreign('본인', 3_000_000, '2026-01'),
  foreign('아내', 3_000_000, '2026-02'),
], ownerOf)
assert.equal(twoOwnersAbove.totalDue, 220_000, '두 소유주가 각각 해외이익 300만원이면 11만원씩 합계 22만원')
assert.deepEqual(Array.from(twoOwnersAbove.buckets, row => row.genDue), [110_000, 110_000], '소유주별 세액을 낸 뒤 합산')

const twoOwnerIsa = taxContext.cbTaxSummary([
  { owner:'본인', amt:3_000_000, month:'2026-01', category:'domestic', account:'ISA' },
  { owner:'아내', amt:3_000_000, month:'2026-01', category:'domestic', account:'ISA' },
], ownerOf)
assert.equal(twoOwnerIsa.isaDue, 198_000, 'ISA 200만원 한도도 소유주별 적용 후 9.9% 세액 합산')

const withLegacy = taxContext.cbTaxSummary([
  foreign('본인', 3_000_000),
  foreign('', 3_000_000),
], ownerOf)
assert.equal(withLegacy.knownDue, 110_000, '소유주 지정 세액을 별도로 유지')
assert.equal(withLegacy.legacyDue, 110_000, '소유주 미지정 기록을 별도 추정 버킷으로 계산')
assert.equal(withLegacy.legacy.label, '소유주 미지정', '레거시 버킷을 명시적으로 라벨링')

taxContext.cbTaxChartSvg(900, 320, [
  foreign('본인', 3_000_000, '2026-01'),
  foreign('아내', 3_000_000, '2026-02'),
])
assert.equal(taxContext.window._cbTaxHover[1].tax, 110_000, '차트 1월 누적세액도 소유주별 계산')
assert.equal(taxContext.window._cbTaxHover[2].tax, 220_000, '차트 2월 누적세액은 소유주별 세액 합계')

// ── 증여: 최근 10년 실제 내역 없이는 공제 잔여 판정 보류 ────────────
const giftContext = { window: { _giftActual:{} } }
vm.createContext(giftContext)
for (const name of ['cbGiftCfg', 'cbGiftPrior', 'cbGiftDeductionReview']) {
  vm.runInContext(extractFunction(cobaltSource, name), giftContext)
}
const unverified = giftContext.cbGiftDeductionReview({ confirmed:false, asOf:'', amount:0, amountKnown:true }, 12_000_000, 20_000_000)
assert.equal(unverified.ready, false, '최근 10년 내역 미확인 상태에서는 판정하지 않음')
assert.equal(unverified.remaining, null, '미확인 상태에서 공제 잔여액을 거짓 표시하지 않음')

const missingDate = giftContext.cbGiftDeductionReview({ confirmed:true, asOf:'', amount:0, amountKnown:true }, 12_000_000, 20_000_000)
assert.equal(missingDate.ready, false, '확인 기준일도 필수')

const missingAmount = giftContext.cbGiftDeductionReview({ confirmed:true, asOf:'2026-08-26', amount:0, amountKnown:false }, 12_000_000, 20_000_000)
assert.equal(missingAmount.ready, false, '0원인 경우도 실제 합계를 명시적으로 입력해야 함')

const verified = giftContext.cbGiftDeductionReview({ confirmed:true, asOf:'2026-08-26', amount:15_000_000, amountKnown:true }, 12_000_000, 20_000_000)
assert.equal(verified.ready, true, '실제 최근 10년 합계와 기준일을 모두 확인하면 검토 가능')
assert.equal(verified.excess, 7_000_000, '기존 1500만원과 신규 계획 1200만원을 합쳐 2000만원 공제액과 비교')
assert.match(cobaltSource, /공제 자동 갱신일이 아닙니다/, '고정 연령대·계획 구간이 공제 리셋이 아님을 명시')
assert.match(cobaltSource, /각 증여일 이전 10년/, 'rolling 10년 기준을 화면에 명시')
assert.match(cobaltSource, /판정 보류[\s\S]*최근 10년 실제 증여 합계/, '실제 내역이 없으면 결과를 보류하는 안내 제공')

// ── 데이터 상태: ext_data와 독립된 키에 저장·최신 타임스탬프 병합 ──
const kvCalls = []
const freshContext = {
  window: {
    _dataFreshness: {
      prices:{ label:'시세', source:'local', ok:true, detail:'로컬 최신', updatedAt:'2026-08-26T10:00:00.000Z', session:'local' },
    },
  },
  setKV: async (key, value) => { kvCalls.push({ key, value }); return { result:'OK' } },
  getKV: async () => ({
    prices:{ label:'시세', source:'remote', ok:false, detail:'오래됨', updatedAt:'2026-08-26T09:00:00.000Z', session:'remote' },
    rates:{ label:'환율', source:'remote', ok:true, detail:'원격 최신', updatedAt:'2026-08-26T11:00:00.000Z', session:'remote' },
  }),
  finEnsureState: () => {},
  cbSyncFeedStatus: () => {},
  console,
  Date,
  clearTimeout,
}
vm.createContext(freshContext)
vm.runInContext("const FIN_FRESHNESS_KV_KEY='data_freshness';", freshContext)
for (const name of ['finFreshnessSnapshot', 'finFreshnessTime', 'finMergeFreshness', 'finSaveFreshnessNow', 'finLoadFreshnessFromKV']) {
  vm.runInContext(extractFunction(financeSource, name), freshContext)
}
assert.equal((await freshContext.finSaveFreshnessNow()).ok, true, '분리된 상태 저장 성공')
assert.equal(kvCalls[0].key, 'data_freshness', 'ext_data 대신 data_freshness 전용 KV 키 사용')
await freshContext.finLoadFreshnessFromKV()
assert.equal(freshContext.window._dataFreshness.prices.detail, '로컬 최신', '원격의 오래된 상태가 더 최신인 로컬 상태를 덮지 않음')
assert.equal(freshContext.window._dataFreshness.rates.detail, '원격 최신', '원격의 새로운 상태는 병합')
let conflictAttempts = 0
freshContext.setKV = async (_key, value) => {
  conflictAttempts++
  kvCalls.push({ key:'data_freshness', value })
  return conflictAttempts === 1 ? { conflict:true, status:409 } : { result:'OK' }
}
freshContext.getKV = async () => ({
  dividends:{ label:'배당', source:'other-device', ok:true, detail:'다른 기기 확인', updatedAt:'2026-08-26T12:00:00.000Z', session:'remote' },
})
assert.equal((await freshContext.finSaveFreshnessNow()).ok, true, '상태 키 충돌 시 최신 항목을 병합해 한 번 재시도')
assert.equal(conflictAttempts, 2, '충돌 재시도는 한 번으로 제한')
assert.equal(freshContext.window._dataFreshness.dividends.detail, '다른 기기 확인', '충돌한 다른 기기의 최신 상태를 보존')
assert.match(financeSource, /function finMarkFresh[\s\S]*finScheduleFreshnessSave\(\)/, '상태 갱신 시 전용 저장을 디바운스')
assert.doesNotMatch(extractFunction(financeSource, 'finMarkFresh'), /saveExtDataToKV/, '상태 갱신이 ext_data 전체 저장을 재귀 호출하지 않음')

// ── SVG: 차트 의미와 키보드 조작 경로 제공 ─────────────────────────
// 키보드 활성화는 요소마다 인라인 onkeydown 을 붙이던 것에서 script.js 의 문서 위임으로
// 옮겼다(같은 스니펫이 네 벌까지 늘었고, 위임과 함께 두면 이중 실행된다).
// 마크업 쪽 계약은 role="button" + tabindex="0" 이고, 활성화 자체는 아래 위임이 보장한다.
assert.match(cobaltSource, /월별 배당 캘린더[\s\S]*tabindex="0"[\s\S]*role="button"/, '배당 월 막대를 키보드로 선택 가능')
assert.match(cobaltSource, /cb-tax-month-hit[^`]*tabindex="0"[^`]*role="button"[^`]*aria-label=/, '양도세 월 영역을 키보드로 선택 가능')
assert.match(scriptSource, /addEventListener\('keydown'[\s\S]{0,400}\[role="button"\]\[tabindex="0"\][\s\S]{0,300}\.click\(\)/, 'Enter·Space 활성화를 문서 위임 한 곳에서 처리')
assert.match(financeSource, /순자산 추이[\s\S]*role="img"[\s\S]*<title>/, '순자산 SVG에 텍스트 대체 설명 제공')

console.log('PASS: 소유주별 세액·증여 10년 전제·상태 분리 저장·SVG 접근성 회귀 테스트')
