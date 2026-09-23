#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { load } from 'cheerio'

const financeSource = fs.readFileSync(new URL('../../finance.js', import.meta.url), 'utf8')
const cobaltSource = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8')
const scriptSource = fs.readFileSync(new URL('../../script.js', import.meta.url), 'utf8')
const indexSource = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const styleSource = fs.readFileSync(new URL('../../style.css', import.meta.url), 'utf8')

const $ = load(indexSource)
const seenIds = new Map()
$('[id]').each((_index, element) => {
  const id = $(element).attr('id')
  seenIds.set(id, (seenIds.get(id) || 0) + 1)
})
assert.deepEqual(Array.from(seenIds.entries()).filter(([, count]) => count > 1), [], 'HTML id 중복 없음')

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

assert.equal((indexSource.match(/class="menu-btn\b/g)||[]).length,7,'재무상태표 제거 후 상위 메뉴 7개')
assert.match(indexSource, /menu-holdings[\s\S]*자산 관리/, '자산 관리 메뉴')
assert.match(indexSource, /menu-tax2[\s\S]*세금·증여/, '세금·증여 통합 메뉴')
assert.match(indexSource, /class="footer-status-btn" onclick="switchView\('data2'/, '데이터 상태는 메뉴 대신 사이드바 푸터 상태 줄에서 연다')
assert.match(indexSource, /view-plan2[\s\S]*view-data2/, '목표 리밸런싱·데이터 상태 화면 유지')
assert.doesNotMatch(indexSource, /id="view-balance2"/, '요청에 따라 재무상태표 화면 제거; 계산·저장 데이터는 유지')
assert.match(indexSource, /script\.js\?v=\d+[\s\S]*finance\.js\?v=\d+[\s\S]*cobalt\.js\?v=\d+/, '데이터 엔진 다음에 재무 기능을 로드하고 cobalt 라우터와 연결')
assert.match(indexSource, /class="side-seg-btn active" id="theme-seg-light"[\s\S]*class="side-seg-btn" id="theme-seg-navy"/, '첫 렌더의 테마 선택 상태를 라이트로 표시')
assert.match(scriptSource, /if \(!THEMES\.includes\(mode\)\) mode = 'light'[\s\S]*const _m0=THEMES\.includes\(_t0\)\?_t0:'light'[\s\S]*THEMES\.includes\(savedTheme\) \? savedTheme : 'light'/, '저장값이 없거나 잘못된 경우 라이트 테마를 기본값으로 사용')
assert.match(cobaltSource, /fam2:'구성원별 보유'[\s\S]*plan2:'목표·리밸런싱'[\s\S]*data2:'데이터 상태'/, '신규 화면 라우팅 제목 등록')
assert.doesNotMatch(cobaltSource, /balance2:/, '도달 불가였던 재무상태표 라우팅 제거 — 옛 링크는 navResolve 가 홈으로 보낸다')
assert.doesNotMatch(cobaltSource, /finDashboardFocus\(ownerF\)/, '홈에서 이번 달 할 일 제거')
assert.match(scriptSource, /balanceSheet:window\._balanceSheet/, '재무상태표를 확장 KV에 저장')
assert.doesNotMatch(scriptSource, /const ext = \{[^\n]*dataFreshness:/, '데이터 상태는 확장 KV와 중복 저장하지 않음')
assert.match(financeSource, /FIN_FRESHNESS_KV_KEY='data_freshness'[\s\S]*setKV\(FIN_FRESHNESS_KV_KEY[\s\S]*getKV\(FIN_FRESHNESS_KV_KEY/, '데이터 상태를 전용 KV에 저장·복원')
assert.match(scriptSource, /nonInvestmentAssets[\s\S]*liabilities[\s\S]*total = portfolio \+ nonInvestmentAssets - liabilities/, '순자산 스냅샷에서 투자자산·기타 자산·부채를 분리')
assert.match(scriptSource, /schemaV: 2[\s\S]*netByOwner/, '스냅샷에 스키마 버전과 소유주별 순자산을 기록')
assert.doesNotMatch(financeSource, /function cbRenderBalanceSheet\(/, '도달 불가였던 재무상태표 렌더러 제거')
assert.doesNotMatch(financeSource, /function finNetWorthBridge\(/, '그릴 화면이 없는 순자산 브리지 제거')
assert.match(financeSource, /function finInvestTrendCard\(/, '추이는 투자자산 기준 카드가 대신한다')
assert.match(scriptSource, /balanceSheet:window\._balanceSheet/, '저장된 부동산·부채 값은 그대로 보존한다')
assert.match(financeSource, /function cbRenderPlan\([\s\S]*cbOwnerBtns\(_finPlanOwner/, '목표·리밸런싱에 소유주 탭 제공')
assert.match(financeSource, /function finNwChartSvg\(/, '순자산 추이 차트 렌더러 제공')
assert.match(financeSource, /function cbRenderPlan\([\s\S]*목표 비중과 리밸런싱[\s\S]*월 DCA 보정안[\s\S]*계좌 배치 진단/, '목표·리밸런싱·DCA 보정·계좌 배치 진단 제공')
assert.match(financeSource, /function cbRenderDataStatus\([\s\S]*데이터 신뢰 점검[\s\S]*최근 확인/, '데이터 출처·최근 확인·상태 센터 제공')
assert.match(styleSource, /\.fin-dashboard-priority[\s\S]*\.fin-summary-grid[\s\S]*\.fin-data-grid/, '신규 기능의 반응형 레이아웃 스타일 추가')

const context = {
  window: {
    _balanceSheet: {
      assets: [{ amount: 300_000_000 }],
      liabilities: [{ amount: 100_000_000 }],
      cashTargetMonths: 6,
    },
    _targetAlloc: { groups: { crypto: 10, us: 30, kr: 30, jp: 0, gold: 10, cash: 20 }, threshold: 5 },
    _dataFreshness: {},
  },
  goalData: [],
  autoTransferData: [
    { owner: '본인', type: '지출', cat: '주거/통신', isFixedCost: true, amt: 1_000_000, cycle: 'monthly' },
    { owner: '본인', type: '지출', cat: '저축/투자', isFixedCost: true, amt: 3_000_000, cycle: 'monthly' }, // 자산 이동 → 제외
    { owner: '본인', type: '지출', cat: '식비', amt: 500_000, cycle: 'monthly' },                            // 미분류 → 제외
  ],
  cfData: [],
  pfolioData: [],
  CB_CLS: {
    crypto: { label: '가상화폐', color: '#1' }, us: { label: '미국 주식', color: '#2' },
    kr: { label: '한국 주식', color: '#3' }, jp: { label: '일본 주식', color: '#4' },
    gold: { label: '금', color: '#5' }, cash: { label: '현금', color: '#6' },
  },
  cbAllRows: () => [
    { cls: 'us', val: 600_000_000, i: { owner: '본인', broker: '미래에셋증권', acc: '일반', div: 12_000_000 } },
    { cls: 'kr', val: 200_000_000, i: { owner: '아내', broker: '삼성증권', acc: 'ISA', div: 4_000_000 } },
    { cls: 'cash', val: 200_000_000, i: { owner: '본인', broker: '미래에셋증권', acc: '일반' } },
  ],
  cbDonutSvg: (segs) => `<svg data-segs="${segs.map(s => s.pct.toFixed(2)).join(',')}"></svg>`,
  cbDcaPerMonthKRW: () => 0,
  _autoTransferActiveInMonth: () => true,
  _autoTransferMonthlyEquivalent: row => row.amt,
  Date,
  console,
}
vm.createContext(context)
vm.runInContext(`const FIN_DEFAULT_TARGET=${JSON.stringify({ crypto: 5, us: 35, kr: 25, jp: 5, gold: 10, cash: 20 })};`, context)
vm.runInContext(`const FIN_GOAL_BUCKET_META=${JSON.stringify({ net: { label: '전체 순자산', color: '#94a3c8' }, investment: { label: '가족 투자자산', color: '#7aa2ff' }, manual: { label: '직접 입력', color: '#b48ead' } })};`, context)
vm.runInContext(`const FIN_SAVING_CATS=['저축/투자']; const FIN_NW_TFS={'1M':30,'3M':90,'6M':180,'1Y':365,'전체':null}; let _finGoalEdit=null; let _finPlanOwner='전체'; let _finNwTf='6M'; let _finNwOwner='전체'; const FIN_SESSION_ID='test-session';`, context)
for (const name of ['finNewId', 'finLocalDateKey', 'finOwnerF', 'finRows', 'finEnsureState', 'finSum', 'finBalanceTotals', 'finMonthlyFixedCost', 'finCashSafety', 'finTargetAnalysis']) {
  vm.runInContext(extractFunction(financeSource, name), context)
}

const totals = context.finBalanceTotals()
assert.equal(totals.investment, 1_000_000_000, '투자자산 합계 계산')
assert.equal(totals.net, 1_200_000_000, '전체 순자산 = 투자자산 + 기타 자산 - 부채')
const safety = context.finCashSafety()
assert.equal(safety.runway, 200, '현금 / 월 필수지출로 안전판 개월 계산')
assert.equal(safety.pendingCount, 1, '고정비 미분류 자동이체는 합산하지 않고 건수만 보고')
assert.equal(context.finCashSafety('아내').cash, 0, '소유주 필터가 현금·필수지출에 함께 적용')
assert.equal(context.finTargetAnalysis('아내').total, 200_000_000, '목표 비중 분석도 소유주 범위를 따름')
const target = context.finTargetAnalysis()
assert.equal(target.max.key, 'us', '목표 대비 편차가 가장 큰 자산군 탐지')
assert.equal(target.max.drift, 30, '현재 60%와 목표 30%의 편차 계산')

const elements = {
  'cb-balance2': { innerHTML: '' },
  'cb-plan2': { innerHTML: '' },
  'cb-data2': { innerHTML: '' },
}
Object.assign(context, {
  _taxRuleValue: (_path, fallback) => fallback,
  OWNERS: ['본인', '아내', '자녀1', '아버지'],
  RATES: { USD: 1350, JPY: 9 },
  benchData: { '1Y': {} },
  document: { getElementById: id => elements[id] || null },
  cbSetHead: () => {},
  cbOwnerBtns: () => '<div class="owner-tabs"></div>',
  cbNiceStep: raw => Math.pow(10, Math.ceil(Math.log10(Math.max(1, raw)))),
  cbTaxAxisLab: v => String(Math.round(v)),
  cbSmoothPath: pts => 'M' + pts.map(p => `${p.x},${p.y}`).join(' L'),
  cbUpDn: v => (v >= 0 ? 'color:var(--up)' : 'color:var(--dn)'),
  CB_LINE_PAD: { l: 48, r: 12 },
  getAccountDivTaxInfo: acc => String(acc || '').includes('ISA')
    ? { type: 'ISA', normalRate: 0.099, exempt: 2_000_000, label: 'ISA, 9.9%' }
    : (/연금|IRP/.test(String(acc || ''))
      ? { type: '연금', normalRate: 0, exempt: Infinity, label: '연금, 과세이연' }
      : { type: '일반', normalRate: 0.154, exempt: 0, label: '일반, 15.4%' }),
  isMobileLayout: () => false,
  cbEsc: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;'),
  cbDisp: value => `₩${Math.round(value).toLocaleString('ko-KR')}`,
  cbSignDisp: value => `${value >= 0 ? '+' : ''}₩${Math.round(value).toLocaleString('ko-KR')}`,
  cbOwnerColor: () => '#999',
  cbDivIncomeKRW: item => item.div || 0,
})
context.window._netWorthHistory = []
context.window._divDataCache = {}
vm.runInContext(extractFunction(scriptSource, 'allocateDividendTax'), context)
for (const name of ['finMobileNote', 'finGoalFind', 'finSnapshotKind', 'finSnapshotNumber', 'finSnapshotInvestment', 'finSnapshotOwnerInvestment', 'finNwSeries', 'finNwStats', 'finNwCoverage', 'finNwCoverageNote', 'finNwChartSvg', 'finInvestTrendCard', 'finGoalCurrent', 'finGoalPace', 'finGoalAllocation', 'finGoalAllocationCard', 'finGoalContext', 'finPortfolioReferences', 'finAccountDiagnostics', 'cbRenderPlan', 'finFreshAge', 'finDataStatusRows', 'cbRenderDataStatus', 'finSaveAndRender']) {
  vm.runInContext(extractFunction(financeSource, name), context)
}
assert.equal(Math.round(context.finNwStats([{ v: 100 }, { v: 80 }]).mdd), -20, '양수 순자산은 기존 MDD 계산 유지')
assert.equal(context.finNwStats([{ v: 100 }, { v: 0 }]).mdd, null, '0원 구간이 있으면 MDD 산정 불가')
assert.equal(context.finNwStats([{ v: -100 }, { v: -80 }]).mdd, null, '음수 순자산을 0% MDD로 오인하지 않음')
const negativeChart = context.finNwChartSvg([
  { date: '2026-08-01', v: -100 }, { date: '2026-08-02', v: -80 },
], 1100, 210)
assert.match(negativeChart, /class="fin-nw-chart-scroll"/, '모바일 차트 가독성을 위한 스크롤 래퍼')
assert.doesNotMatch(negativeChart, /NaN|Infinity/, '음수 순자산 차트 좌표도 유효')
context.cbRenderPlan()
context.cbRenderDataStatus()
assert.match(elements['cb-plan2'].innerHTML, /재무 목표[\s\S]*새 목표 추가/, '목표 탭 렌더')
assert.doesNotMatch(elements['cb-plan2'].innerHTML, /목표 비중과 리밸런싱/, '목표 탭은 리밸런싱과 분리')

// 목표 연결 자산군 도넛 — linkClass별 버킷 분리와 금액이 finGoalCurrent 와 같은 소스인지.
context.goalData = [
  { id: 'g1', name: '미국 목표', linkClass: 'us', targetAmount: 1 },
  { id: 'g2', name: '한국 목표', linkClass: 'kr', targetAmount: 1 },
  { id: 'g3', name: '직접 입력 목표', linkClass: 'manual', currentAmount: 5_000_000, targetAmount: 1 },
  { id: 'g4', name: '투자자산 목표', linkClass: 'investment', targetAmount: 1 },
]
const allocation = context.finGoalAllocation()
// vm 컨텍스트(별도 realm)의 배열이라 프로토타입이 달라 deepStrictEqual 이 실패한다 — 복제 후 비교.
assert.deepEqual(Array.from(allocation).map(b => b.key), ['investment', 'us', 'kr', 'manual'], '금액 내림차순 정렬 · linkClass별 버킷 분리')
assert.equal(allocation.find(b => b.key === 'us').value, 600_000_000, 'CB_CLS 자산군 버킷은 finGoalCurrent 와 같은 금액(직접 재계산하지 않음)')
assert.equal(allocation.find(b => b.key === 'manual').value, 5_000_000, '직접 입력 버킷은 currentAmount 를 그대로 쓴다')
assert.equal(allocation.find(b => b.key === 'investment').value, 1_000_000_000, '투자자산 버킷은 finBalanceTotals().investment')
context.cbRenderPlan()
assert.match(elements['cb-plan2'].innerHTML, /목표 연결 자산군[\s\S]*fin-goal-alloc-donut[\s\S]*fin-goal-alloc-legend/, '목표에 연결된 자산이 있으면 도넛 카드를 렌더')
context.goalData = []
context.cbRenderPlan()
assert.doesNotMatch(elements['cb-plan2'].innerHTML, /목표 연결 자산군/, '연결된 목표가 없으면 도넛을 렌더하지 않는다')

elements['view-rebal2']={classList:{contains:()=>true}}
elements['cb-rebal2']={innerHTML:''}
context.cbRenderPlan()
assert.match(elements['cb-rebal2'].innerHTML, /목표 비중과 리밸런싱[\s\S]*계좌 배치 진단/, '리밸런싱 탭 렌더')
assert.doesNotMatch(elements['cb-rebal2'].innerHTML, /fin-goal-form/, '리밸런싱 탭에 목표 입력란을 중복 생성하지 않음')
assert.match(elements['cb-rebal2'].innerHTML, /연금 과세이연 계좌로 옮긴 단순 가정상 연 최대/, '일반계좌 배당의 과세이연 여력을 금액으로 제시')
assert.match(elements['cb-data2'].innerHTML, /데이터 신뢰 점검[\s\S]*성과 벤치마크/, '데이터 상태 렌더')
assert.match(elements['cb-data2'].innerHTML, /manualRefresh\('assets'\)[\s\S]*manualRefresh\('benchmark'\)/, '데이터 상태 카드가 해당 소스만 다시 확인')

const untouchedStatus = context.finDataStatusRows()
assert.equal(untouchedStatus.every(row => row.ok === false), true, '실제 요청 전에는 기본값·빈 배열만으로 정상 판정하지 않음')
// 아직 조회하지 않은 것과 조회해서 실패한 것을 구분한다 — 부팅 직후 전부 '오류'로 켜지면
// 진짜 오류가 묻히고 사용자가 표시를 무시하게 된다.
assert.equal(untouchedStatus.every(row => row.state === 'pending'), true, '요청 전에는 오류가 아니라 확인 전(pending) 상태')
context.window._dataFreshness.assets = { ok:true, detail:'0개 항목 로드', updatedAt:'2026-08-25T00:00:00Z' }
assert.equal(context.finDataStatusRows().find(row => row.key === 'assets').ok, true, '명시적으로 성공한 요청만 정상 표시')
assert.equal(context.finDataStatusRows().find(row => row.key === 'assets').state, 'ok', '성공 기록은 ok 상태')
context.window._dataFreshness.ext = { ok:false, detail:'로드 실패', updatedAt:'2026-08-25T00:00:00Z' }
assert.equal(context.finDataStatusRows().find(row => row.key === 'ext').state, 'warn', '실패 기록은 warn 상태')
// 다른 기기/이전 접속의 기록인지 구분 (KV 로 공유되므로 '3시간 전 확인'이 내 확인이 아닐 수 있다)
assert.equal(context.finDataStatusRows().find(row => row.key === 'assets').sameSession, false, '세션 표식이 없는 기록은 다른 접속으로 취급')
context.window._dataFreshness.rates = { ok:true, detail:'환율 로드', updatedAt:'2026-08-25T00:00:00Z', session:'test-session' }
assert.equal(context.finDataStatusRows().find(row => row.key === 'rates').sameSession, true, '이번 접속에서 확인한 기록은 sameSession')
delete context.window._dataFreshness.ext
delete context.window._dataFreshness.rates
context.window._dataFreshness.prices = { ok:true, detail:'조회 성공', updatedAt:'2026-08-25T00:00:00Z' }
context.pfolioData = [{ grp:'주식', _priceStale:true }]
const staleStatus = context.finDataStatusRows().find(row => row.key === 'prices')
assert.equal(staleStatus.ok, false, '과거 성공 기록이 있어도 현재 시세 누락 자산이 있으면 확인 필요')
assert.equal(staleStatus.state, 'warn', '시세 누락은 pending 이 아니라 warn')
// 조회 기록이 아예 없어도 시세가 빈 자산이 실재하면 '확인 전'이 아니라 '확인 필요'
delete context.window._dataFreshness.prices
context.pfolioData = [{ grp:'주식', _priceStale:true }]
assert.equal(context.finDataStatusRows().find(row => row.key === 'prices').state, 'warn', '기록이 없어도 시세 누락이 확인되면 warn')
context.pfolioData = []
context.window._dataFreshness.prices = { ok:true, detail:'조회 성공', updatedAt:'2026-08-25T00:00:00Z' }
assert.match(staleStatus.detail, /1개 최신 시세 확인 필요/, '현재 누락 건수를 상태에 표시')
context.pfolioData = []
delete context.window._dataFreshness.prices

// 사이드바 푸터가 pending 을 오류로 표시하지 않는지 (cobalt.js 배선)
assert.match(cobaltSource, /warn=rows\.filter\(x=>x\.state==='warn'\)\.length/, '푸터 경고는 warn 만 집계')
assert.match(cobaltSource, /pending \? `데이터 확인 중/, '확인 전 항목은 경고가 아닌 대기 문구로 표시')
assert.match(styleSource, /\.footer-status-btn\.is-pending \.footer-status-dot\{background:var\(--lab\)\}/, '확인 전 상태 점은 경고색을 쓰지 않음')

// 계좌 진단도 공통 엔진을 사용해 동일 소유주의 ISA 공제를 계좌마다 반복하지 않는다.
const originalAllRows = context.cbAllRows
context.cbAllRows = () => [
  { cls:'kr', val:300_000_000, i:{ owner:'본인', broker:'A증권', acc:'ISA', div:2_000_000 } },
  { cls:'kr', val:200_000_000, i:{ owner:'본인', broker:'B증권', acc:'ISA', div:1_000_000 } },
]
const isaDiagnostics = context.finAccountDiagnostics()
assert.equal(Math.round(isaDiagnostics.reduce((sum, row) => sum + row.withheld, 0)), 99_000, '계좌 진단의 ISA 예상세액도 소유주별 200만원 공제를 한 번만 적용')
context.cbAllRows = originalAllRows


// ── 투자자산 기준 추이 ────────────────────────────────────────────────
// 부동산·부채는 대시보드에서 관리하지 않으므로 추이는 투자자산만 그린다.
// 순자산 기준과 달리 v1·v2 가 바로 비교되므로 재무상태표 유무로 버릴 기록이 없다.
assert.equal(context.finSnapshotInvestment({ schemaV:1, total:800_000_000 }), 800_000_000,
  'v1 은 total 자체가 투자자산이던 시절이라 그대로 쓴다')
assert.equal(context.finSnapshotInvestment({ schemaV:2, total:1_200_000_000, portfolio:800_000_000, nonInvestmentAssets:500_000_000, liabilities:100_000_000 }), 800_000_000,
  'v2 는 portfolio 를 쓴다 — 부동산·부채가 섞이지 않는다')
assert.equal(context.finSnapshotInvestment({ schemaV:2, total:1_200_000_000, nonInvestmentAssets:500_000_000, liabilities:100_000_000 }), 800_000_000,
  'portfolio 를 안 남긴 과거 항목은 구성요소로 정확히 역산한다')
assert.equal(context.finSnapshotInvestment({ schemaV:2, total:1_200_000_000 }), null,
  '구성요소가 없으면 total 이 투자자산인지 순자산인지 알 수 없으므로 버린다')
assert.equal(context.finSnapshotInvestment(null), null, '빈 항목은 null')
assert.equal(context.finSnapshotOwnerInvestment({ schemaV:2, portfolioByOwner:{ 본인:300_000_000 } }, '본인'), 300_000_000,
  '소유주 범위는 portfolioByOwner 를 쓴다')
assert.equal(context.finSnapshotOwnerInvestment({ schemaV:2, netByOwner:{ 본인:300_000_000 } }, '본인'), null,
  '소유주별 투자자산이 없으면 순자산으로 대신하지 않는다')

// 재무상태표가 채워져 있어도 투자자산 추이는 v1 기록을 버리지 않는다(순자산 기준과 다른 점).
context.window._balanceSheet.assets = [{ id:'a1', owner:'본인', category:'부동산', amount:500_000_000 }]
context.window._balanceSheet.liabilities = []
const today = new Date()
const dayKey = back => {
  const d = new Date(today); d.setDate(d.getDate() - back)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
context.window._netWorthHistory = [
  { date: dayKey(20), schemaV: 1, total: 100_000_000 },
  { date: dayKey(10), schemaV: 2, total: 640_000_000, portfolio: 140_000_000, nonInvestmentAssets: 500_000_000, liabilities: 0, portfolioByOwner: { 본인: 90_000_000 } },
  { date: dayKey(1),  schemaV: 2, total: 660_000_000, portfolio: 160_000_000, nonInvestmentAssets: 500_000_000, liabilities: 0, portfolioByOwner: { 본인: 110_000_000 } },
]
const invSeries = context.finNwSeries(null, '3M')
assert.deepEqual(invSeries.map(p => p.v), [100_000_000, 140_000_000, 160_000_000],
  '재무상태표가 있어도 v1·v2 를 모두 투자자산으로 비교한다')
const ownerSeries = context.finNwSeries('본인', '3M')
assert.deepEqual(ownerSeries.map(p => p.v), [90_000_000, 110_000_000],
  '소유주 범위는 portfolioByOwner 가 있는 기록만 쓴다')

const trendCard = context.finInvestTrendCard()
assert.match(trendCard, /투자자산 추이/, '카드 제목')
assert.match(trendCard, /부동산·부채는 포함하지 않습니다/, '순자산이 아니라는 사실을 카드가 밝힌다')
assert.match(trendCard, /수익률이 아닙니다/, '증감에 추가 입금이 섞인다는 사실을 밝힌다')
assert.match(trendCard, /data-nw-tf="3M"/, '기간 버튼 표식')
assert.match(trendCard, /data-nw-owner="전체"/, '소유주 버튼 표식')
assert.match(cobaltSource, /function cbRenderPerf\(/, '성과 페이지 렌더러 유지')
assert.match(cobaltSource, /finInvestTrendCard==='function'\?finInvestTrendCard\(\)/, '성과 페이지가 투자자산 추이 카드를 렌더')
assert.doesNotMatch(cobaltSource, /가족 재무상태표 &gt; 순자산 추이에서 확인하세요/, '없는 화면으로 안내하지 않는다')

// ── 현금 안전판 목표 개월수 ────────────────────────────────────────────
// 값 자체는 살아 있는 리스크 진단·투자 계획이 계속 쓰므로 조작 지점이 반드시 있어야 한다.
// 자리는 투자 계획 > 목표다 — 그 화면이 이미 같은 값을 '현금 안전판 · 월 필수지출 기준'으로 보여준다.
assert.match(financeSource, /function finSaveCashTarget\(\)\{[\s\S]*Math\.max\(1,Math\.min\(36,/, '목표 개월수는 1~36 으로 조인다')
assert.match(financeSource, /function finSaveCashTarget\(\)\{[\s\S]*cbRenderPlan/, '저장 후 투자 계획 화면을 다시 그린다')
assert.doesNotMatch(financeSource, /function finSaveCashTarget\(\)\{[^}]*cbRenderBalanceSheet/, '사라진 재무상태표 렌더러를 부르지 않는다')
assert.match(financeSource, /function finGoalContext\([\s\S]*?finSaveCashTarget\(\)/, '목표 화면의 현금 안전판 패널에 저장 버튼이 있다')
assert.match(financeSource, /function finGoalContext\([\s\S]*?finMobileNote\('현금 안전판 목표'\)/, '모바일에서는 읽기 전용 안내를 렌더')
assert.match(styleSource, /\.fin-cash-target\{/, '컨트롤 폭은 인라인이 아니라 클래스로 준다')
// 리스크 진단에서는 뺐다 — 보조 진단 카드가 한 줄을 통째로 쓰고 있었고, 같은 숫자를
// 투자 계획 > 목표가 더 넓은 맥락과 함께 보여준다.
assert.doesNotMatch(cobaltSource, /liquidity-coverage/, '현금 유동성 커버리지 카드는 제거됐다')
assert.doesNotMatch(cobaltSource, /card\.control/, '쓰는 카드가 없어진 컨트롤 슬롯도 함께 제거한다')
assert.doesNotMatch(styleSource, /\.cb-risk-insight-control/, '도달 불가 CSS 도 함께 제거한다')

// 재무상태표 변경 저장은 오늘 스냅샷을 먼저 갱신하고 KV는 한 번만 쓴다.
const saveOrder=[]
context.window._kvLoadState = { assets:'ready', ext:'ready' }
Object.assign(context, {
  updateNetWorthSnapshot: () => { saveOrder.push('snapshot') },
  saveExtDataToKV: async () => { saveOrder.push('save'); return {ok:true} },
  cbRerender: undefined,
})
const saveResult = await context.finSaveAndRender(() => saveOrder.push('render'), true)
assert.equal(saveResult.ok, true, '재무상태표 저장 결과 반환')
assert.deepEqual(saveOrder, ['snapshot','save','render'], '스냅샷 갱신 후 확장 KV를 한 번만 저장하고 렌더')

// 순자산 추이 커버리지 — 기록이 선택 기간을 못 채우면 어떤 버튼을 눌러도 같은 구간이 나온다.
// 그 사실을 화면이 밝히지 않으면 MDD가 안 변하는 게 고장으로 보인다.
const shortCov = context.finNwCoverage([{ date:'2026-08-25', v:1 }, { date:'2026-09-02', v:2 }], '1M')
assert.equal(shortCov.actualDays, 9, '구간 일수는 양 끝을 포함한다')
assert.equal(shortCov.requestedDays, 30, '1M 은 30일 요청')
assert.equal(shortCov.short, true, '9일 기록으로 1M 을 채울 수 없다')
const longCov = context.finNwCoverage([{ date:'2026-01-01', v:1 }, { date:'2026-09-02', v:2 }], '1M')
assert.equal(longCov.short, false, '기록이 기간보다 길면 안내하지 않는다')
assert.equal(context.finNwCoverage([{ date:'2026-08-25', v:1 }, { date:'2026-09-02', v:2 }], '전체').short, false, "'전체'는 요청 기간이 없어 항상 충족")
assert.equal(context.finNwCoverage([{ date:'2026-09-02', v:1 }], '1M').short, false, '점이 1개면 차트가 이미 안내하므로 중복 표시하지 않는다')
assert.equal(context.finNwCoverage(null, '1M').short, false, '시리즈가 없어도 터지지 않는다')
assert.equal(context.finNwCoverageNote(longCov), '', '충족 상태에서는 아무것도 렌더하지 않는다')
assert.match(context.finNwCoverageNote(shortCov), /선택한 기간\(30일\)보다 기록이 짧습니다[\s\S]*08\/25~09\/02 \(9일\)/, '부족할 때만 실제 구간을 밝힌다')

console.log('finance feature tests passed')
