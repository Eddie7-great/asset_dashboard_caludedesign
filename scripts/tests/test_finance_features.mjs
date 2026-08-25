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
  const start = source.indexOf(`function ${name}(`)
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

assert.match(indexSource, /data-menu-group="summary"[\s\S]*data-menu-group="analysis"[\s\S]*data-menu-group="planning"[\s\S]*data-menu-group="records"/, '사이드바를 요약·분석·계획·기록 관리로 묶음')
assert.match(indexSource, /menu-fam2[\s\S]*구성원별 보유/, '가족 자산 화면 이름을 역할이 드러나는 구성원별 보유로 변경')
assert.match(indexSource, /data-menu-group="records"[\s\S]*menu-tax2/, '양도소득세는 실현손익 기록 화면이므로 기록·관리 그룹에 배치')
assert.doesNotMatch(indexSource, /data-menu-group="planning"[\s\S]{0,600}menu-tax2/, '양도소득세를 계획 그룹에서 제거')
assert.match(indexSource, /class="footer-status-btn" onclick="switchView\('data2'/, '데이터 상태는 메뉴 대신 사이드바 푸터 상태 줄에서 연다')
assert.match(indexSource, /view-balance2[\s\S]*view-plan2[\s\S]*view-data2/, '재무상태표·목표 리밸런싱·데이터 상태 화면 추가')
assert.match(indexSource, /script\.js\?v=\d+[\s\S]*finance\.js\?v=\d+[\s\S]*cobalt\.js\?v=\d+/, '데이터 엔진 다음에 재무 기능을 로드하고 cobalt 라우터와 연결')
assert.match(indexSource, /class="side-seg-btn active" id="theme-seg-light"[\s\S]*class="side-seg-btn" id="theme-seg-navy"/, '첫 렌더의 테마 선택 상태를 라이트로 표시')
assert.match(scriptSource, /if \(!THEMES\.includes\(mode\)\) mode = 'light'[\s\S]*const _m0=THEMES\.includes\(_t0\)\?_t0:'light'[\s\S]*THEMES\.includes\(savedTheme\) \? savedTheme : 'light'/, '저장값이 없거나 잘못된 경우 라이트 테마를 기본값으로 사용')
assert.match(cobaltSource, /fam2:'구성원별 보유'[\s\S]*balance2:'가족 재무상태표'[\s\S]*plan2:'목표·리밸런싱'[\s\S]*data2:'데이터 상태'/, '신규 화면 라우팅 제목 등록')
assert.match(cobaltSource, /가족 투자자산[\s\S]*finDashboardFocus\(ownerF\)[\s\S]*cb-dash-insight-grid/, '첫 화면에서 투자자산·이번 달 할 일·목표 편차·현금 안전판을 분석 카드보다 먼저 배치')
assert.match(financeSource, /function finDashboardFocus\(owner\)\{[\s\S]*finTargetAnalysis\(ownerF\)[\s\S]*finCashSafety\(ownerF\)/, '대시보드 목표 편차·현금 안전판 카드가 선택한 소유주를 따름')
assert.match(scriptSource, /balanceSheet:window\._balanceSheet[\s\S]*dataFreshness:window\._dataFreshness/, '재무상태표와 데이터 상태를 확장 KV에 저장')
assert.match(scriptSource, /nonInvestmentAssets[\s\S]*liabilities[\s\S]*total = portfolio \+ nonInvestmentAssets - liabilities/, '순자산 스냅샷에서 투자자산·기타 자산·부채를 분리')
assert.match(scriptSource, /schemaV: 2[\s\S]*netByOwner/, '스냅샷에 스키마 버전과 소유주별 순자산을 기록')
assert.match(financeSource, /function cbRenderBalanceSheet\([\s\S]*순자산 추이[\s\S]*순자산 변화 분석[\s\S]*현금 안전판/, '재무상태표에 순자산 추이·변화 분석·현금 안전판 제공')
assert.match(financeSource, /function cbRenderBalanceSheet\([\s\S]*cbOwnerBtns\(_finBalanceOwner/, '재무상태표에 소유주 탭 제공')
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
  cbDcaPerMonthKRW: () => 0,
  _autoTransferActiveInMonth: () => true,
  _autoTransferMonthlyEquivalent: row => row.amt,
  Date,
  console,
}
vm.createContext(context)
vm.runInContext(`const FIN_DEFAULT_TARGET=${JSON.stringify({ crypto: 5, us: 35, kr: 25, jp: 5, gold: 10, cash: 20 })};`, context)
vm.runInContext(`const FIN_ASSET_CATS=['부동산','예·적금','기타 자산']; const FIN_LIABILITY_CATS=['주택담보대출','기타 부채']; const FIN_SAVING_CATS=['저축/투자']; const FIN_NW_TFS={'1M':30,'3M':90,'6M':180,'1Y':365,'전체':null}; let _finBalanceEdit=null; let _finGoalEdit=null; let _finBalanceOwner='전체'; let _finPlanOwner='전체'; let _finNwTf='6M';`, context)
for (const name of ['finNewId', 'finOwnerF', 'finRows', 'finEnsureState', 'finSum', 'finBalanceTotals', 'finMonthlyFixedCost', 'finCashSafety', 'finTargetAnalysis']) {
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
for (const name of ['finMobileNote', 'finBalanceKey', 'finBalanceFind', 'finGoalFind', 'finSnapshotNet', 'finNwSeries', 'finNwStats', 'finNwChartSvg', 'finMonthCashflow', 'finNetWorthBridge', 'cbRenderBalanceSheet', 'finGoalCurrent', 'finAccountDiagnostics', 'cbRenderPlan', 'finFreshAge', 'finDataStatusRows', 'cbRenderDataStatus']) {
  vm.runInContext(extractFunction(financeSource, name), context)
}
context.cbRenderBalanceSheet()
context.cbRenderPlan()
context.cbRenderDataStatus()
assert.match(elements['cb-balance2'].innerHTML, /순자산[\s\S]*순자산 추이[\s\S]*순자산 변화 분석[\s\S]*현금 안전판/, '재무상태표 빈 상태 렌더')
assert.match(elements['cb-balance2'].innerHTML, /fin-mobile-note/, '모바일 조회 전용 안내 노출')
assert.match(elements['cb-plan2'].innerHTML, /재무 목표[\s\S]*목표 비중과 리밸런싱[\s\S]*계좌 배치 진단/, '목표·리밸런싱 빈 상태 렌더')
assert.match(elements['cb-plan2'].innerHTML, /절세계좌로 옮기면 연 최대/, '일반계좌 배당의 절세 여력을 금액으로 제시')
assert.match(elements['cb-data2'].innerHTML, /데이터 신뢰 점검[\s\S]*성과 벤치마크/, '데이터 상태 렌더')

// ── 순자산 변화 분석: 스냅샷 스키마와 저축/투자 제외 ─────────────────
// v1 스냅샷은 total 에 투자자산만 담았다. 재무상태표(기타자산 3억·부채 1억)가 있는 지금
// 그대로 빼면 그 차액이 통째로 잔차로 잡히므로 비교에서 제외돼야 한다.
context.window._netWorthHistory = [
  { date: '2026-08-01', total: 1_000_000_000 },                    // v1 → 제외
  { date: '2026-08-20', schemaV: 2, total: 1_150_000_000 },        // v2 → 비교 대상
]
context.cfData = [
  { date: '2026-08-22', type: '수입', cat: '급여', amt: 5_000_000 },
  { date: '2026-08-23', type: '지출', cat: '식비', amt: 1_000_000 },
  { date: '2026-08-24', type: '지출', cat: '저축/투자', amt: 9_000_000 },   // 자산 이동 → 제외
  { date: '2026-07-01', type: '지출', cat: '식비', amt: 7_000_000 },        // 기준일 이전 → 제외
]
const bridge = context.finNetWorthBridge()
assert.equal(bridge.prior.date, '2026-08-20', '정의가 같은 최신 스냅샷을 기준으로 삼음')
assert.equal(bridge.skipped, 1, '정의가 다른 v1 스냅샷 건수를 보고')
assert.equal(bridge.previous, 1_150_000_000, 'v2 스냅샷의 순자산을 그대로 사용')
assert.equal(bridge.change, 50_000_000, '현재 순자산과의 차이')
assert.equal(bridge.cashflow, 4_000_000, '저축/투자와 기준일 이전 기록을 뺀 순현금흐름')
assert.equal(bridge.residual, 46_000_000, '잔차 = 변화 − 순현금흐름')

// 재무상태표가 비어 있으면 v1 스냅샷도 현재 정의와 같으므로 비교에 쓸 수 있다
context.window._balanceSheet.assets = []
context.window._balanceSheet.liabilities = []
context.window._netWorthHistory = [{ date: '2026-08-01', total: 900_000_000 }]
const legacyBridge = context.finNetWorthBridge()
assert.equal(legacyBridge.prior.date, '2026-08-01', '재무상태표가 비면 v1 스냅샷도 비교 가능')
assert.equal(legacyBridge.skipped, 0, '이 경우 제외 건수 없음')

console.log('finance feature tests passed')
