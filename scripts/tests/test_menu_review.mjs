// 2026-11-23 메뉴·콘텐츠 개편 5가지의 순수 계산 함수 검증
// ① reportFlowSeries/reportFlowTotals(넣은 돈 vs 값 변동) ② calDailyRules(일정 매일 적립 접기)
// ③ cbRiskMergeVerdict/cbRiskMergeEntries(리스크 카드 합치기) ⑤ cbPensionCreditPlan(연말 절세) + _normalizeTaxSaving
import assert from 'node:assert'
import vm from 'node:vm'
import { readSource } from './_source.mjs'

const workspacePages = readSource('workspace-pages.js')
const riskSource = readSource('pages/risk.js')
const taxSource = readSource('pages/tax.js')
const storedSource = readSource('core/stored-data.js')

function extractFunction(source, name) {
  const fs = source.indexOf(`function ${name}(`)
  assert.notEqual(fs, -1, `${name} 함수를 찾을 수 없음`)
  const start = source.slice(Math.max(0, fs - 6), fs) === 'async ' ? fs - 6 : fs
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1) }
  }
  throw new Error(`${name} 닫는 괄호 없음`)
}

const context = { console, Date, Math, JSON, OWNERS: ['본인', '아내', '자녀1', '아버지'] }
vm.createContext(context)

// ───────── ① 넣은 돈 vs 값이 오른 몫 ─────────
// reportFlowSeries 는 reportHoldingDiff 를 재사용하므로, 여기서는 그 결과를 조립하는
// reportFlowTotals 만 떼어 검증한다(reportHoldingDiff 자체는 test_report_page.mjs 가 지킨다).
vm.runInContext(extractFunction(workspacePages, 'reportFlowTotals'), context)
{
  const series = [
    { ym: '2026-08', flow: 1000000, market: 500000, change: 1500000, live: false },
    { ym: '2026-09', none: true },
    { ym: '2026-10', flow: -200000, market: 300000, change: 100000, live: true },
  ]
  const t = context.reportFlowTotals(series)
  assert.equal(t.flow, 800000, 'reportFlowTotals: flow 합은 none 을 건너뛴다')
  assert.equal(t.market, 800000, 'reportFlowTotals: market 합')
  assert.equal(t.months, 2, 'reportFlowTotals: 기록 있는 달만 센다')
}

// reportPrevYm / reportLastYms 는 날짜 유틸이라 함께 확인
vm.runInContext(extractFunction(workspacePages, 'reportPrevYm'), context)
vm.runInContext(extractFunction(workspacePages, 'reportLastYms'), context)
{
  assert.equal(context.reportPrevYm('2026-01'), '2025-12', 'reportPrevYm: 해 넘김')
  const yms = context.reportLastYms('2026-11-10', 3)
  assert.deepEqual(yms, ['2026-09', '2026-10', '2026-11'], 'reportLastYms: 오래된 달부터')
}

// ───────── ② 일정 달력 매일 적립 접기 ─────────
vm.runInContext(extractFunction(workspacePages, 'calDailyRules'), context)
{
  const data = { days: {
    3: [{ title: 'TQQQ 적립', owner: '본인', daily: true, amount: 50000 }],
    20: [{ title: 'TQQQ 적립', owner: '본인', daily: true, amount: 50000 }],
    25: [{ title: '월세', owner: '본인', amount: 800000 }],
  } }
  const rows = context.calDailyRules(data)
  assert.equal(rows.length, 1, 'calDailyRules: 매일 규칙만, 같은 종목은 한 줄')
  assert.equal(rows[0].count, 2, 'calDailyRules: 횟수 합산')
  assert.equal(rows[0].amount, 100000, 'calDailyRules: 금액 합산')
  assert.equal(rows[0].title, 'TQQQ 적립')
  assert.equal(rows[0].first, 3, 'calDailyRules: 첫 날')
  assert.equal(rows[0].last, 20, 'calDailyRules: 마지막 날')
}

// ───────── ③ 리스크 카드 합치기 ─────────
vm.runInContext(extractFunction(riskSource, 'cbRiskMergeVerdict'), context)
{
  const mk = k => ({ key: k, rank: { bad: 0, warn: 1, ok: 2, hold: 3 }[k] })
  const V = list => context.cbRiskMergeVerdict(list).key
  assert.equal(V([mk('ok'), mk('warn'), mk('ok')]), 'warn', '주의 하나면 주의')
  assert.equal(V([mk('ok'), mk('bad'), mk('warn')]), 'bad', '경고가 최우선')
  assert.equal(V([mk('ok'), mk('ok')]), 'ok', '모두 양호면 양호')
  assert.equal(V([mk('ok'), mk('hold')]), 'hold', '양호+보류면 보류(확정 아님)')
}

// 빈 칸 없는 리스크 격자(12칸 중 폭) — 줄마다 합이 12
vm.runInContext(extractFunction(riskSource, 'cbRiskFillSpans'), context)
{
  const F = n => [...context.cbRiskFillSpans(n)]
  assert.deepEqual(F(6), [4, 4, 4, 4, 4, 4], '6개는 3×2')
  assert.deepEqual(F(8), [3, 3, 3, 3, 3, 3, 3, 3], '8개는 4×2')
  assert.deepEqual(F(5), [3, 3, 3, 3, 12], '5개는 4 + 마지막 1개가 한 줄')
  assert.deepEqual(F(7), [3, 3, 3, 3, 4, 4, 4], '7개는 4 + 3')
  assert.deepEqual(F(2), [6, 6])
  assert.deepEqual(F(0), [])
  for (let n = 1; n <= 16; n++) assert.equal(F(n).reduce((a, b) => a + b, 0) % 12, 0, `${n}개: 빈 칸 없음`)
}

// ───────── ⑤ 연말 절세(연금계좌 세액공제) ─────────
vm.runInContext(extractFunction(taxSource, 'cbPensionCreditPlan'), context)
{
  const caps = { pension: 6000000, total: 9000000 }
  // 연금저축만 꽉 채움: 600 공제, 남은 300 은 IRP 로만
  let p = context.cbPensionCreditPlan(6000000, 0, caps)
  assert.equal(p.credited, 6000000)
  assert.equal(p.left, 3000000)
  assert.equal(p.pensionRoom, 0, '연금저축은 한도까지 다 넣어 더 넣어도 공제 안 됨')
  // 연금저축 한도 초과분은 공제 대상에서 제외
  p = context.cbPensionCreditPlan(8000000, 0, caps)
  assert.equal(p.credited, 6000000, '연금저축 800 중 600 만 공제')
  assert.equal(p.overPension, 2000000, '초과 200')
  // 합산 한도 초과
  p = context.cbPensionCreditPlan(6000000, 5000000, caps)
  assert.equal(p.credited, 9000000, '합산 900 까지만')
  assert.equal(p.overTotal, 2000000, '합산 초과 200')
  assert.equal(p.left, 0)
  // 빈 입력
  p = context.cbPensionCreditPlan(0, 0, caps)
  assert.equal(p.credited, 0)
  assert.equal(p.pensionRoom, 6000000, '연금저축으로 최대 600')
  assert.equal(p.irpRoom, 9000000)
}

// _normalizeTaxSaving (core/stored-data.js) — _safeStoredNumber 에 의존.
// (추출기가 구조분해 기본값의 중괄호에 걸려 _safeStoredNumber 는 동작을 그대로 옮겨 쓴다.)
assert.ok(storedSource.includes('function _safeStoredNumber('), 'stored-data.js 에 _safeStoredNumber 가 있어야 함')
vm.runInContext(`function _safeStoredNumber(value,opt){opt=opt||{};const min=opt.min??-Number.MAX_SAFE_INTEGER,max=opt.max??Number.MAX_SAFE_INTEGER,fb=opt.fallback??0;const n=Number(value);if(!Number.isFinite(n))return fb;return Math.min(max,Math.max(min,n));}`, context)
vm.runInContext(extractFunction(storedSource, '_normalizeTaxSaving'), context)
{
  const N = context._normalizeTaxSaving
  assert.equal(N(null), null)
  assert.equal(N('x'), null, '객체 아니면 null')
  const ok = N({ years: { 2026: { 본인: { pension: 6000000, irp: 1000000, isa: 2000000 } } } })
  assert.deepEqual(ok.years['2026']['본인'], { pension: 6000000, irp: 1000000, isa: 2000000 })
  // 모르는 소유주·음수·NaN 정리
  const cleaned = N({ years: { 2026: { 외부인: { pension: 100 }, 아내: { pension: -5, irp: 'x', isa: 300 } } } })
  assert.equal(cleaned.years['2026']['외부인'], undefined, '모르는 소유주 제거')
  assert.deepEqual(cleaned.years['2026']['아내'], { pension: 0, irp: 0, isa: 300 }, '음수·비숫자는 0')
}

// ───────── 2026-11-24 화면 디테일 ─────────
// 연말 절세: 전체 탭은 가족 네 명 모두(자녀가 빠지지 않게), 저장 버튼 없이 입력하면 저장
{
  const ctx = vm.createContext({ OWNERS: ['본인', '아내', '자녀1', '아버지'], _cbTaxOwner: '전체' })
  vm.runInContext('var _cbTaxOwner=\'전체\';' + extractFunction(taxSource, 'cbTaxSavingOwners'), ctx)
  assert.deepEqual([...ctx.cbTaxSavingOwners('2026')], ['본인', '아내', '자녀1', '아버지'])
  vm.runInContext("_cbTaxOwner='자녀1'", ctx)
  assert.deepEqual([...ctx.cbTaxSavingOwners('2026')], ['자녀1'])
  assert.doesNotMatch(taxSource, /data-ts-save|>저장<\/button>/, '절세 체크에 저장 버튼이 없다')
  assert.match(taxSource, /oninput="cbTaxSavingInput\(this\)" onchange="cbTaxSavingInput\(this,true\)"/, '입력하면(0.8초 뒤)·칸을 벗어나면 저장')
}
// 실현손익 내역: 달마다 묶고, 최근 달이 위, 기본으로 가장 최근 달만 펼친다
{
  const ctx = vm.createContext({})
  vm.runInContext('var _cbTaxEditId=null,_cbTaxMonthFilter=null,_cbTaxMonthOpen=null;' + extractFunction(taxSource, 'cbTaxMonthGroups'), ctx)
  const rows = [
    { id: 1, month: '2026-01', amt: 100, category: 'domestic' },
    { id: 2, month: '2026-01', amt: -30, category: 'foreign' },
    { id: 3, month: '2026-03', amt: 50, category: 'foreign' },
  ]
  const cum = new Map([[rows[0], 100], [rows[1], 70], [rows[2], 120]])
  const g = ctx.cbTaxMonthGroups(rows, cum)
  assert.deepEqual(g.map(x => [x.m, x.rows.length, x.dom, x.frn, x.total, x.cum, x.open]), [[3, 1, 0, 50, 50, 120, true], [1, 2, 100, -30, 70, 70, false]])
  vm.runInContext('_cbTaxMonthFilter=1', ctx)
  assert.equal(ctx.cbTaxMonthGroups(rows, cum)[1].open, true, '차트로 고른 달은 펼친다')
  vm.runInContext('_cbTaxMonthFilter=null;_cbTaxMonthOpen=new Set([1])', ctx)
  assert.deepEqual(ctx.cbTaxMonthGroups(rows, cum).map(x => x.open), [false, true], '사용자가 바꾼 펼침을 지킨다')
}

console.log('test_menu_review: OK')
