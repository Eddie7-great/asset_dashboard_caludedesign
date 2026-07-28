#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const scriptSource = fs.readFileSync(new URL('../../script.js', import.meta.url), 'utf8')
const cobaltSource = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8')
const styleSource = fs.readFileSync(new URL('../../style.css', import.meta.url), 'utf8')

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

const sectorContext = {
  pfolioData: [
    { grp: '주식', owner: '본인', qty: 1, value: 331, sector: 'Index ETF' },
    { grp: '주식', owner: '본인', qty: 1, value: 569, sector: 'Technology' },
    { grp: '현금', owner: '본인', qty: 1, value: 100 },
  ],
  RATES: { USD: 1 },
  _bubbleItemValueKRW: item => item.value,
  _gicsSector: item => item.sector,
  cbValKRW: item => item.value,
  CB_SEC_PALETTE: ['#1', '#2'],
  CB_CLS: { crypto: { color: '#3' } },
}
vm.createContext(sectorContext)
vm.runInContext(extractFunction(cobaltSource, 'cbSectors'), sectorContext)
const sectorResult = sectorContext.cbSectors(true, null)
assert.equal(sectorResult.total, 1_000, '대시보드 섹터 비중 분모에 현금을 포함')
assert.equal(
  sectorResult.list.find(row => row.label === 'Index ETF').pct.toFixed(1),
  '33.1',
  '대시보드 INDEX ETF 비중을 비중 차트와 같은 전체 포트폴리오 분모로 계산',
)

const dividendContext = {
  window: { _divHistoryRawCache: {} },
  cbStrip: ticker => String(ticker || '').toUpperCase(),
  cbRate: () => 1,
  cbNiceStep: () => 100,
  cbTaxAxisLab: value => String(value),
  cbDivAxisLab: value => String(value),
  cbKrw: value => `₩${Math.round(value).toLocaleString('ko-KR')}`,
  cbEsc: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  cssVar: (_name, fallback) => fallback,
}
vm.createContext(dividendContext)
for (const name of ['cbAddDivMonthDetail', 'cbDivMonthlyForYear', 'cbDivCalendarSvg']) {
  vm.runInContext(extractFunction(cobaltSource, name), dividendContext)
}
const dividendList = [
  { i: { name: 'VOO', cur: 'KRW' }, tkr: 'VOO', title: 'Vanguard S&P 500 ETF', d: { months: [0] }, incomeKRW: 100 },
  { i: { name: 'VOO', cur: 'KRW' }, tkr: 'VOO', title: 'Vanguard S&P 500 ETF', d: { months: [0] }, incomeKRW: 200 },
]
const divCal = dividendContext.cbDivMonthlyForYear(dividendList, String(new Date().getFullYear()))
assert.equal(divCal.monthAmt[0], 300, '월별 배당 합계 계산')
assert.equal(divCal.monthDetails[0].length, 1, '같은 종목의 여러 소유주·계좌 배당을 월별 툴팁에서 합산')
assert.equal(divCal.monthDetails[0][0].amount, 300, '월별 종목 배당 합계')
const divSvg = dividendContext.cbDivCalendarSvg(divCal.monthAmt, divCal.monthDetails, 1100, 300)
assert.match(divSvg, /onmousemove="cbDivBarHover\(event,0\)"/, '배당 막대에 종목별 상세 호버 연결')
assert.match(divSvg, />₩300<\/text>/, '막대 위 금액을 1원 단위 원화로 표시')

const cashContext = {
  cfDeletedKeys: [],
  autoTransferData: [{ id: 7, skipMonths: [] }],
  saveCfDeletedKeys: () => {},
  saveAutoTransfers: () => {},
}
vm.createContext(cashContext)
for (const name of ['cfDeletionKey', 'rememberCfDeletion']) {
  vm.runInContext(extractFunction(scriptSource, name), cashContext)
}
assert.equal(
  cashContext.rememberCfDeletion({ divKey: 'div_VOO_본인_일반_2026_7' }),
  'div:div_VOO_본인_일반_2026_7',
  '삭제한 자동 배당 키를 기억',
)
cashContext.rememberCfDeletion({ atId: 7, date: '2026-07-15' })
assert.deepEqual(Array.from(cashContext.autoTransferData[0].skipMonths), ['2026-07'], '삭제한 자동이체 월을 건너뛰기로 기록')
assert.match(scriptSource, /cfDeletedKeys\.includes\(`div:\$\{divKey\}`\)/, '페이지 재진입 시 삭제한 자동 배당 재생성 차단')
assert.match(scriptSource, /rememberCfDeletion\(item\)[\s\S]*await saveExtDataToKV\(\)/, '삭제 상태를 원격 확장 데이터까지 저장')
assert.match(scriptSource, /if\s*\(Array\.isArray\(data\.cfData\)\)/, '빈 현금 흐름 배열도 원격 저장값으로 복원')

assert.match(styleSource, /#owner-tabs-container\.holdings-owner-tabs\{margin-left:auto!important;margin-right:0!important/, '자산 내역 소유주 탭 우측 정렬')
assert.match(styleSource, /\.table-float-tip\{[\s\S]*position:fixed/, '전역 툴팁을 스크롤 컨테이너 밖 고정 레이어로 표시')
assert.match(scriptSource, /closest\?\.\('\[data-tip\]'\)/, '모든 페이지 data-tip을 body 포털 툴팁으로 연결')
assert.match(styleSource, /\[data-tip\]:hover::after\{display:none!important\}/, '잘리고 흔들리는 pseudo 툴팁 비활성화')
assert.match(styleSource, /\.cb-thead,\s*\.pt-table th\{[\s\S]*font-family:'Noto Sans KR','Manrope'/, '페이지별 칼럼명 폰트를 자산 내역과 통일')
assert.match(cobaltSource, /<div style="display:flex;gap:10px;flex-wrap:wrap">[\s\S]*cards\.map/, '성과 비교 상단 카드를 한 줄 flex 배치로 복원')
assert.match(styleSource, /\.cb-perf-detail-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, '성과 비교 하단 위젯을 2열 × 3행으로 배치')
assert.match(cobaltSource, /<div class="cb-perf-detail-grid">/, '성과 비교 하단 6개 성과 카드에 2×3 그리드 적용')
assert.match(cobaltSource, /수익률 TOP 5[\s\S]*손실률 TOP 5/, '대시보드에 수익률·손실률 TOP5 위젯 추가')
assert.match(cobaltSource, /if \(id==='divm'\) cbVerifyDividendDataOnOpen\(\)/, '배당 관리 페이지 진입 때마다 데이터 캐시 검증')
assert.match(scriptSource, /divCacheTickers_[\s\S]*tickers\.every\(t=>verified\.includes\(t\)\)/, '현재 보유 티커가 일일 배당 캐시에 모두 검증됐는지 확인')
assert.match(scriptSource, /const normDivTkr = t =>[\s\S]*\(KS\|KQ\|T\)/, '일본 상장 .T 배당 캐시 키도 화면 조회 규칙과 통일')
assert.match(scriptSource, /item\.qty \* epsVal \* \(RATES\[info\.cur\|\|item\.cur\]\|\|1\)/, 'USD뿐 아니라 JPY 배당도 해당 환율로 원화 환산')
assert.match(cobaltSource, /onclick="cbTaxMonthPick\(\$\{m\}\)"/, '양도소득세 월별 그래프 클릭을 하단 내역 필터에 연결')
assert.match(cobaltSource, /onmousemove="this\.style\.fill='var\(--accSoft\)'/, '양도소득세 그래프 호버 월 강조')

console.log('PASS 후속 UI·INDEX ETF·현금 흐름·배당 상세')
