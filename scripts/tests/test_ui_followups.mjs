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
assert.match(styleSource, /\.cb-perf-card-grid\{display:grid;grid-template-columns:repeat\(6,minmax\(124px,1fr\)\)/, '성과 비교 상단 소유주·지수 카드를 한 줄로 유지')
assert.match(cobaltSource, /const entities = \[\s*\.\.\.OWNERS\.map/, '성과 데이터 유무와 무관하게 모든 소유주 탭·그래프 범례 유지')
assert.match(cobaltSource, /if \(id==='perf2'\) cbVerifyPerfOwnersOnOpen\(\)/, '성과 비교 진입 때 누락 소유주 데이터 재검증')
assert.match(styleSource, /\.cb-perf-detail-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, '성과 비교 하단 위젯을 2열 × 3행으로 배치')
assert.match(cobaltSource, /\[rows\.find\(r=>r\.e\.key==='S&P 500'\), rows\.find\(r=>r\.e\.key==='본인'\), rows\.find\(r=>r\.e\.key==='자녀1'\)\]/, '성과 비교 하단 왼쪽을 S&P 500·본인·자녀1 순으로 배치')
assert.match(cobaltSource, /\[rows\.find\(r=>r\.e\.key==='KOSPI'\), rows\.find\(r=>r\.e\.key==='아내'\), rows\.find\(r=>r\.e\.key==='아버지'\)\]/, '성과 비교 하단 오른쪽을 KOSPI·아내·아버지 순으로 배치')
assert.match(cobaltSource, /<div class="cb-perf-detail-table">[\s\S]*<div class="cb-perf-detail-row"/, '성과 비교 하단 기존 표 행 구조 유지')
assert.match(cobaltSource, /<span><span data-tip="같은 기간 S&P 500 수익률 대비 차이[\s\S]*>S&amp;P 대비<\/span><\/span>/, '성과 비교 초과수익 칼럼을 명확한 S&P 대비로 표기하고 밑줄 범위를 텍스트로 제한')
assert.match(cobaltSource, /수익률 TOP 5[\s\S]*손실률 TOP 5/, '대시보드에 수익률·손실률 TOP5 위젯 추가')
assert.match(styleSource, /\.cb-dash-movers-grid\{display:grid!important;grid-template-columns:minmax\(0,1fr\)!important;grid-template-rows:repeat\(2,minmax\(0,1fr\)\)/, '대시보드 수익률·손실률 TOP5를 세로 2×1로 강제')
assert.match(cobaltSource, /if \(id==='divm'\) cbVerifyDividendDataOnOpen\(\)/, '배당 관리 페이지 진입 때마다 데이터 캐시 검증')
assert.match(scriptSource, /divCacheTickers_[\s\S]*tickers\.every\(t=>verified\.includes\(t\)\)/, '현재 보유 티커가 일일 배당 캐시에 모두 검증됐는지 확인')
assert.match(scriptSource, /const normDivTkr = t =>[\s\S]*\(KS\|KQ\|T\)/, '일본 상장 .T 배당 캐시 키도 화면 조회 규칙과 통일')
assert.match(scriptSource, /item\.qty \* epsVal \* \(RATES\[info\.cur\|\|item\.cur\]\|\|1\)/, 'USD뿐 아니라 JPY 배당도 해당 환율로 원화 환산')
assert.match(cobaltSource, /onclick="cbTaxMonthPick\(\$\{m\}\)"/, '양도소득세 월별 그래프 클릭을 하단 내역 필터에 연결')
assert.match(cobaltSource, /onmousemove="this\.style\.fill='var\(--accSoft\)'/, '양도소득세 그래프 호버 월 강조')
assert.match(cobaltSource, /cum\[m\]=\{fgn:cf, isa:ci, profit:cp, tax\}[\s\S]*stroke-dasharray="7 4"/, '양도소득세 그래프에 누적 실현손익 점선 추이 추가')
assert.match(cobaltSource, /미실현 손실 후보 합계[\s\S]*color:var\(--dn\)[\s\S]*손실 상계 후보 TOP 3[\s\S]*color:var\(--dn\)/, '절세 위젯의 손실 금액을 하락 색상으로 통일')
assert.match(styleSource, /\.cb-dividend-tip\{[\s\S]*min-width:min\(420px/, '배당 월별 툴팁 폭 확장')
assert.match(styleSource, /\.cb-div-tip-name,\.cb-div-tip-ticker,\.cb-div-tip-row b\{white-space:nowrap\}/, '배당 툴팁 종목명·티커 줄바꿈 방지')
assert.match(scriptSource, /function formatTableFloatTipText\(text\)[\s\S]*\\n/, '전역 설명 툴팁을 문장부호 뒤에서 우선 줄바꿈')
assert.match(cobaltSource, /const score = Math\.max\(0, Math\.min\(100,/, '리스크 점수를 실제 0~100점 척도로 계산')
assert.match(cobaltSource, /<span class="cb-tax-actions"[\s\S]*class="btn-action"[\s\S]*onclick="cbTaxEdit\([\s\S]*class="btn-action"[\s\S]*onclick="cbTaxDel\(/, '양도소득세 관리 열을 자산 내역과 같은 수정·삭제 버튼으로 구성')
assert.match(styleSource, /\.cb-tax-head-grid\{[\s\S]*grid-template-columns:22px 22px[\s\S]*\.cb-tax-head-grid>span:last-child\{grid-column:2\}/, '양도소득세 관리 제목을 삭제 버튼 위에 정렬')
assert.match(styleSource, /\.cb-tax-bottom-grid\{display:grid;grid-template-columns:minmax\(0,1\.45fr\) minmax\(270px,\.85fr\)/, '실현손익 내역 폭을 줄이고 우측 절세 위젯 공간 확보')
assert.match(cobaltSource, /연말 절세 여력[\s\S]*세금 없이 추가 실현 가능한 순이익[\s\S]*손실 상계 후보 TOP 3/, '양도소득세 연말 절세 여력 위젯 추가')
assert.match(scriptSource, /holdings-owner-head/, '자산 내역 소유주 열 전용 정렬 클래스 적용')
assert.match(styleSource, /#view-holdings \.pt-table th\.holdings-owner-head,[\s\S]*padding-left:14px!important/, '자산 내역 소유주·관리 열 여백 재균형')
assert.match(scriptSource, /const _BUBBLE_SECTOR_PALETTES = \{[\s\S]*navy:[\s\S]*dark:[\s\S]*light:/, '비중 차트에 네이비·다크·라이트별 글래스 파스텔 팔레트 적용')
assert.match(scriptSource, /function _bubbleSectorColor\(sector\)[\s\S]*_bubbleThemeKey/, '비중 차트가 현재 테마 전용 팔레트를 선택')
assert.match(scriptSource, /ownerLabelNames[\s\S]*fontSize=isOwnerLabel\?'16px':'13px'[\s\S]*fontWeight=isOwnerLabel\?'800':'650'/, '비중 차트 소유주 라벨을 크게 굵게 강조')
assert.match(scriptSource, /표시할 자산이 없습니다\./, '비중 차트 빈 상태도 테마 글꼴과 한글 문구 사용')

console.log('PASS 후속 UI·INDEX ETF·현금 흐름·배당 상세')
