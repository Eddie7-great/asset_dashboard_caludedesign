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
assert.match(indexSource, /menu-fam2[\s\S]*가족 투자자산/, '기존 가족 자산 제목을 가족 투자자산으로 변경')
assert.match(indexSource, /view-balance2[\s\S]*view-plan2[\s\S]*view-data2/, '재무상태표·목표 리밸런싱·데이터 상태 화면 추가')
assert.match(indexSource, /script\.js\?v=36[\s\S]*finance\.js\?v=1[\s\S]*cobalt\.js\?v=17/, '데이터 엔진 다음에 재무 기능을 로드하고 cobalt 라우터와 연결')
assert.match(cobaltSource, /fam2:'가족 투자자산'[\s\S]*balance2:'가족 재무상태표'[\s\S]*plan2:'목표·리밸런싱'[\s\S]*data2:'데이터 상태'/, '신규 화면 라우팅 제목 등록')
assert.match(cobaltSource, /가족 투자자산[\s\S]*finDashboardFocus\(ownerF\)[\s\S]*cb-dash-insight-grid/, '첫 화면에서 투자자산·이번 달 할 일·목표 편차·현금 안전판을 분석 카드보다 먼저 배치')
assert.match(scriptSource, /balanceSheet:window\._balanceSheet[\s\S]*dataFreshness:window\._dataFreshness/, '재무상태표와 데이터 상태를 확장 KV에 저장')
assert.match(scriptSource, /nonInvestmentAssets[\s\S]*liabilities[\s\S]*total = portfolio \+ nonInvestmentAssets - liabilities/, '순자산 스냅샷에서 투자자산·기타 자산·부채를 분리')
assert.match(financeSource, /function cbRenderBalanceSheet\([\s\S]*순자산 변화 분석[\s\S]*현금 안전판/, '재무상태표에 순자산 변화 분석과 현금 안전판 제공')
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
  autoTransferData: [{ type: '지출', isFixedCost: true, amt: 1_000_000, cycle: 'monthly' }],
  cfData: [],
  pfolioData: [],
  CB_CLS: {
    crypto: { label: '가상화폐', color: '#1' }, us: { label: '미국 주식', color: '#2' },
    kr: { label: '한국 주식', color: '#3' }, jp: { label: '일본 주식', color: '#4' },
    gold: { label: '금', color: '#5' }, cash: { label: '현금', color: '#6' },
  },
  cbAllRows: () => [
    { cls: 'us', val: 600_000_000, i: { owner: '본인', broker: '미래에셋증권', acc: '일반' } },
    { cls: 'kr', val: 200_000_000, i: { owner: '아내', broker: '삼성증권', acc: 'ISA' } },
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
vm.runInContext(`const FIN_ASSET_CATS=['부동산','예·적금','기타 자산']; const FIN_LIABILITY_CATS=['주택담보대출','기타 부채']; let _finBalanceEdit=null; let _finGoalEdit=null;`, context)
for (const name of ['finEnsureState', 'finSum', 'finBalanceTotals', 'finMonthlyFixedCost', 'finCashSafety', 'finTargetAnalysis']) {
  vm.runInContext(extractFunction(financeSource, name), context)
}

const totals = context.finBalanceTotals()
assert.equal(totals.investment, 1_000_000_000, '투자자산 합계 계산')
assert.equal(totals.net, 1_200_000_000, '전체 순자산 = 투자자산 + 기타 자산 - 부채')
const safety = context.finCashSafety()
assert.equal(safety.runway, 200, '현금 / 월 필수지출로 안전판 개월 계산')
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
  cbEsc: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;'),
  cbDisp: value => `₩${Math.round(value).toLocaleString('ko-KR')}`,
  cbSignDisp: value => `${value >= 0 ? '+' : ''}₩${Math.round(value).toLocaleString('ko-KR')}`,
  cbOwnerColor: () => '#999',
  cbDivIncomeKRW: () => 0,
})
context.window._netWorthHistory = []
context.window._divDataCache = {}
for (const name of ['finMonthCashflow', 'finNetWorthBridge', 'cbRenderBalanceSheet', 'finGoalCurrent', 'finAccountDiagnostics', 'cbRenderPlan', 'finFreshAge', 'finDataStatusRows', 'cbRenderDataStatus']) {
  vm.runInContext(extractFunction(financeSource, name), context)
}
context.cbRenderBalanceSheet()
context.cbRenderPlan()
context.cbRenderDataStatus()
assert.match(elements['cb-balance2'].innerHTML, /전체 순자산[\s\S]*순자산 변화 분석[\s\S]*현금 안전판/, '재무상태표 빈 상태 렌더')
assert.match(elements['cb-plan2'].innerHTML, /재무 목표[\s\S]*목표 비중과 리밸런싱[\s\S]*계좌 배치 진단/, '목표·리밸런싱 빈 상태 렌더')
assert.match(elements['cb-data2'].innerHTML, /데이터 신뢰 점검[\s\S]*성과 벤치마크/, '데이터 상태 렌더')

console.log('finance feature tests passed')
