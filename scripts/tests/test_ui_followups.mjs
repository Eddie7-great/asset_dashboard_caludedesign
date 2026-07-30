#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const scriptSource = fs.readFileSync(new URL('../../script.js', import.meta.url), 'utf8')
const cobaltSource = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8')
const styleSource = fs.readFileSync(new URL('../../style.css', import.meta.url), 'utf8')
const indexSource = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

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

const classificationContext = { window: { _krStocksDB: null } }
vm.createContext(classificationContext)
vm.runInContext(extractFunction(scriptSource, '_gicsSector'), classificationContext)
assert.equal(classificationContext._gicsSector({ name: 'TIME 미국나스닥100액티브', tkr: '426030' }), 'Index ETF', 'TIME 지수 ETF 분류')
assert.equal(classificationContext._gicsSector({ name: '2x Ether ETF', tkr: 'ETHU' }), 'Sector ETF', '가상자산 레버리지 ETF를 섹터 ETF로 분류')
assert.equal(classificationContext._gicsSector({ name: 'Global X Robotics & AI ETF', tkr: 'BOTZ' }), 'Sector ETF', 'GLOBAL 문구만으로 테마 ETF를 지수 ETF로 오인하지 않음')
assert.equal(classificationContext._gicsSector({ name: '와이지엔터테인먼트', tkr: '122870' }), 'Communications Services', '엔터테인먼트 종목을 커뮤니케이션 서비스로 분류')
assert.equal(classificationContext._gicsSector({ name: 'TIME MACHINE CO', tkr: 'TMCO' }), 'Other', '일반 종목명의 TIME 단어를 ETF로 오인하지 않음')

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
  _cbDivMonthFilter: null,
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
assert.match(divSvg, /onclick="cbDivMonthPick\(0\)"/, '배당 막대 클릭을 월별 종목 필터에 연결')
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
assert.match(styleSource, /\.cb-perf-card-grid\{[^}]*overflow:visible/, '성과 비교 상단 카드의 외곽선 때문에 세로 스크롤바가 생기지 않게 함')
assert.match(cobaltSource, /const entities = \[\s*\.\.\.OWNERS\.map/, '성과 데이터 유무와 무관하게 모든 소유주 탭·그래프 범례 유지')
assert.match(cobaltSource, /if \(id==='perf2'\) cbVerifyPerfOwnersOnOpen\(\)/, '성과 비교 진입 때 누락 소유주 데이터 재검증')
assert.match(styleSource, /\.cb-perf-detail-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, '성과 비교 하단 위젯을 2열 × 3행으로 배치')
assert.match(cobaltSource, /\[rows\.find\(r=>r\.e\.key==='S&P 500'\), rows\.find\(r=>r\.e\.key==='본인'\), rows\.find\(r=>r\.e\.key==='자녀1'\)\]/, '성과 비교 하단 왼쪽을 S&P 500·본인·자녀1 순으로 배치')
assert.match(cobaltSource, /\[rows\.find\(r=>r\.e\.key==='KOSPI'\), rows\.find\(r=>r\.e\.key==='아내'\), rows\.find\(r=>r\.e\.key==='아버지'\)\]/, '성과 비교 하단 오른쪽을 KOSPI·아내·아버지 순으로 배치')
assert.match(cobaltSource, /<div class="cb-perf-detail-table">[\s\S]*<div class="cb-perf-detail-row"/, '성과 비교 하단 기존 표 행 구조 유지')
assert.match(cobaltSource, /<span><span data-tip="같은 기간 S&P 500 수익률 대비 차이[\s\S]*>S&amp;P 대비<\/span><\/span>/, '성과 비교 초과수익 칼럼을 명확한 S&P 대비로 표기하고 밑줄 범위를 텍스트로 제한')
assert.match(cobaltSource, /수익률 TOP 5[\s\S]*손실률 TOP 5/, '대시보드에 수익률·손실률 TOP5 위젯 추가')
assert.match(styleSource, /\.cb-dash-movers-grid\{display:grid!important;grid-template-columns:minmax\(0,1fr\)!important;grid-template-rows:repeat\(2,minmax\(0,1fr\)\)/, '대시보드 수익률·손실률 TOP5를 세로 2×1로 강제')
assert.match(cobaltSource, /const contributionRows = mergedRows[\s\S]*Math\.abs\(b\.gain\)-Math\.abs\(a\.gain\)[\s\S]*평가손익 기여도/, '대시보드에 실제 원화 평가손익 기준 기여도 위젯 추가')
assert.match(cobaltSource, /이익 기여[\s\S]*손실 기여[\s\S]*cb-contrib-track/, '평가손익 기여도에 양·음 손익 합계와 발산형 막대 표시')
assert.match(styleSource, /\.cb-dash-insight-grid\{display:grid;grid-template-columns:minmax\(240px,1\.12fr\)[\s\S]*minmax\(205px,.74fr\)[\s\S]*minmax\(235px,.88fr\)/, '대시보드 자산 배분·섹터 위젯은 넓히고 TOP5 폭은 축소')
assert.match(cobaltSource, /if \(id==='divm'\) cbVerifyDividendDataOnOpen\(\)/, '배당 관리 페이지 진입 때마다 데이터 캐시 검증')
assert.match(scriptSource, /divCacheTickers_[\s\S]*tickers\.every\(t=>verified\.includes\(t\)\)/, '현재 보유 티커가 일일 배당 캐시에 모두 검증됐는지 확인')
assert.match(scriptSource, /const normDivTkr = t =>[\s\S]*\(KS\|KQ\|T\)/, '일본 상장 .T 배당 캐시 키도 화면 조회 규칙과 통일')
assert.match(scriptSource, /item\.qty \* epsVal \* \(RATES\[info\.cur\|\|item\.cur\]\|\|1\)/, 'USD뿐 아니라 JPY 배당도 해당 환율로 원화 환산')
assert.match(cobaltSource, /onclick="cbTaxMonthPick\(\$\{m\}\)"/, '양도소득세 월별 그래프 클릭을 하단 내역 필터에 연결')
assert.match(cobaltSource, /onmousemove="this\.style\.fill='var\(--accSoft\)'/, '양도소득세 그래프 호버 월 강조')
assert.match(cobaltSource, /cum\[m\]=\{fgn:cf, isa:ci, domProfit:cpDom, fgnProfit:cpFgn, profit:cp, tax\}/, '양도소득세 누적손익을 국내·해외·전체로 분리 집계')
assert.match(cobaltSource, /cumulativeLine\('domProfit'[\s\S]*cumulativeLine\('fgnProfit'[\s\S]*cumulativeLine\('profit'/, '양도소득세 그래프에 국내·해외·전체 누적 추이 표시')
const taxAxisContext = {}
vm.createContext(taxAxisContext)
vm.runInContext(extractFunction(cobaltSource, 'cbTaxAxisLab'), taxAxisContext)
assert.equal(taxAxisContext.cbTaxAxisLab(2_500_000), '+250만', '양도소득세 Y축 양수에 + 기호 표시')
assert.equal(taxAxisContext.cbTaxAxisLab(-2_500_000), '−250만', '양도소득세 Y축 음수 기호 유지')
assert.match(cobaltSource, /endLabels\.push\(\{label:'예상 세액'[\s\S]*class="cb-tax-end-label"/, '마지막 등록 월 끝점에 그래프 라인명 표시')
assert.match(cobaltSource, /해외 기본공제 사용률[\s\S]*잔여 공제/, '양도소득세 상단에 기본공제 사용률 위젯 추가')
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
assert.match(scriptSource, /const _BUBBLE_THEME_TONES = \{[\s\S]*light:[\s\S]*dark:[\s\S]*navy:/, '비중 차트의 동일 색 구성 규칙을 라이트·다크·네이비별 톤으로 적용')
assert.match(scriptSource, /function _bubbleSectorColor\(sector\)[\s\S]*tone\.sectorSat,tone\.sectorLight/, '비중 차트 섹터 기준색은 공통 hue와 테마별 채도·명도로 생성')
assert.match(scriptSource, /function _bubbleLeafColor\(sector,key\)[\s\S]*const hue=base\+\(\(hash%13\)-6\)[\s\S]*tone\.leafSat[\s\S]*tone\.leafLight/, '모든 테마에서 섹터 hue를 유지하며 종목별 파스텔 명도만 변형')
assert.match(scriptSource, /const _BUBBLE_OWNER_SECTORS = \{[\s\S]*function _bubbleOwnerColor\(owner\)[\s\S]*_SECTOR_HUES\[sector\][\s\S]*tone\.sectorSat\+3,tone\.sectorLight-3/, '소유주 구분점도 섹터 팔레트와 같은 테마별 색 생성 규칙 사용')
assert.match(scriptSource, /colors\.push\('rgba\(0,0,0,0\)'\)[\s\S]*cb-bubble-owner-dot[\s\S]*setAttribute\('fill', _bubbleOwnerColor\(ownerName\)\)/, '전체 비중 차트 소유주 링은 투명하게 두고 라벨 앞 컬러 점으로 구분')
assert.match(cobaltSource, /배당 집중도[\s\S]*상위 3종목/, '배당 관리 상단에 배당원 집중도 위젯 추가')
assert.match(cobaltSource, /const top3Div = [\s\S]*상위 배당원 TOP 3[\s\S]*cb-div-top3-name[\s\S]*share\.toFixed\(1\)/, '배당 집중도 상위 3개 종목명과 각 배당 기여 비중을 별도 위젯에 표시')
assert.match(cobaltSource, /const label=\[ownerF\?'':x\.i\.owner, x\.title\|\|'종목명 미확인'\][\s\S]*cb-div-top3-metrics[\s\S]*cbDisp\(x\.incomeKRW\)[\s\S]*share\.toFixed\(1\)/, '전체 배당원 TOP3에는 소유주·종목명·금액·비중을 표시하고 티커는 제외')
assert.match(cobaltSource, /cb-div-summary-title[\s\S]*배당성장률[\s\S]*cb-div-history-status[\s\S]*이력 확보 \$\{gList\.length\}\/\$\{list\.length\}종목/, '배당 이력 확보 상태를 제목과 같은 줄의 괄호 안에 표시')
assert.match(cobaltSource, /소유주별 자산군 구성[\s\S]*cb-family-mix-track/, '가족 자산 내역 옆에 소유주별 자산군 구성 위젯 추가')
assert.match(cobaltSource, /월 환산 매수 배분 TOP 5[\s\S]*cb-dca-allocation-track/, 'DCA 내역 옆에 월 환산 매수 배분 TOP 5 위젯 추가')
assert.match(cobaltSource, /배당 비중[\s\S]*x\.incomeKRW\/divAnnual\*100/, '배당 종목 내역에 종목별 배당 수입 비중 칼럼 추가')
assert.match(cobaltSource, /향후 90일 배당 일정[\s\S]*지급일이 확인되지 않은 종목은 ‘월 예정’/, '배당 내역 옆에 향후 90일 배당 일정 위젯 추가')
assert.match(styleSource, /@media \(min-width:1420px\)\{[\s\S]*cb-family-detail-grid[\s\S]*cb-dca-detail-grid[\s\S]*280px/, '넓은 화면에서 가족 자산·DCA 표와 보조 위젯을 좌우 배치')
assert.match(styleSource, /@media \(min-width:1580px\)\{[\s\S]*cb-div-detail-grid[\s\S]*290px/, '배당 표가 충분히 넓을 때만 일정 위젯을 우측 배치')
assert.match(cobaltSource, /cb-family-table-toolbar[\s\S]*전체 보유 자산[\s\S]*cb-family-head/, '가족 자산 표 제목·검색줄과 칼럼 헤더에 연속 고정 클래스 적용')
assert.match(cobaltSource, /cb-div-table-toolbar[\s\S]*배당 종목 내역[\s\S]*cb-div-head/, '배당 내역 제목과 칼럼 헤더에 연속 고정 클래스 적용')
assert.match(styleSource, /\.cb-family-table-toolbar,\.cb-div-table-toolbar\{position:sticky;top:0[\s\S]*\.cb-family-table-panel \.cb-family-head,[\s\S]*top:45px/, '표 제목줄 아래 칼럼 헤더가 겹치지 않게 고정')
assert.match(styleSource, /\.cb-family-mix-card\{position:sticky;top:0\}[\s\S]*\.cb-div-upcoming-card\{position:sticky;top:0\}/, '가족 자산·배당 우측 보조 위젯을 스크롤 중 고정')
const upcomingContext = { cbStrip: ticker => String(ticker || '').toUpperCase() }
vm.createContext(upcomingContext)
vm.runInContext(extractFunction(cobaltSource, 'cbUpcomingDividendSchedule'), upcomingContext)
const upcoming = upcomingContext.cbUpcomingDividendSchedule([
  { i:{owner:'본인'}, tkr:'SCHD', title:'Schwab Dividend ETF', incomeKRW:120_000, d:{months:[7,8],payDay:null} },
  { i:{owner:'아내'}, tkr:'O', title:'Realty Income', incomeKRW:240_000, d:{months:[8],payDay:5} },
], 90, '2026-07-30T00:00:00')
assert.equal(upcoming[0].dateLabel, '8월 예정', '지급일 미확인 종목은 월 단위 일정으로 표시')
assert.equal(upcoming.find(x => x.ticker === 'O').dateLabel, '9월 5일', '확인된 지급일은 일자까지 표시')
assert.equal(upcoming.find(x => x.ticker === 'SCHD').amount, 60_000, '연간 예상 배당을 지급 월수로 나눠 회차 금액 산출')
assert.match(cobaltSource, /예상 납부세액 합계[\s\S]*일반 · 해외주식[\s\S]*해외 기본공제 사용률[\s\S]*일반 · 국내주식[\s\S]*ISA 계좌[\s\S]*연금저축 계좌/, '양도소득세 상단 위젯을 납부세액·해외·공제·국내·ISA·연금 순으로 배치')
assert.match(cobaltSource, /id="cb-tax-pl"[\s\S]*inputmode="numeric"[\s\S]*data-no-comma="1"[\s\S]*oninput="handlePLAmtInput\(this\)"/, '양도소득세 수정 금액 입력에도 음수 허용 실시간 쉼표 포맷 적용')
assert.match(styleSource, /\.cb-tax-deduction-value\{[\s\S]*margin-top:12px\}[\s\S]*\.cb-tax-deduction-track\{[^}]*margin-top:5px\}/, '해외 기본공제 사용률 막대를 퍼센티지 바로 아래에 배치')
assert.match(styleSource, /#cb-perf2\{display:flex;flex-direction:column;padding-bottom:12px\}[\s\S]*\.cb-perf-detail-panel\{display:flex;flex:1 0 270px/, '성과 비교 하단 위젯이 남은 세로 공간을 채움')
assert.match(cobaltSource, /class="cb-perf-value\$\{CB_PERF_TFS\[k\]===tf\?' is-active':''\}"/, '성과 표 선택 음영을 셀 전체가 아닌 텍스트 크기에 맞춤')
assert.match(cobaltSource, /class="cb-dash-sector-note"/, '대시보드 섹터 진단 문구를 위젯 하단에 배치')
assert.match(cobaltSource, /class="cb-mover-owner"/, '전체 소유주 TOP5 행에 소유주 표시')
assert.match(scriptSource, /function _recordViewHistory\(id\)[\s\S]*history\.pushState/, '페이지 전환을 브라우저 뒤로·앞으로 가기 기록에 연결')
assert.match(scriptSource, /costUnknown[\s\S]*initialCurP/, '취득가 미상 금을 별도 상태로 저장하면서 현재 평가가는 유지')
assert.match(styleSource, /touch-action:pan-x pan-y/, '모바일 표 내부의 좌우 터치 스크롤 허용')
assert.match(scriptSource, /ownerLabelNames[\s\S]*fontSize=isOwnerLabel\?'16px':'13px'[\s\S]*fontWeight=isOwnerLabel\?'800':'650'/, '비중 차트 소유주 라벨을 크게 굵게 강조')
assert.match(scriptSource, /표시할 자산이 없습니다\./, '비중 차트 빈 상태도 테마 글꼴과 한글 문구 사용')
assert.match(indexSource, /toggleAmountPrivacy\(\)[\s\S]*id="sidebar-privacy-btn"[\s\S]*금액 가리기/, '좌하단에 전역 금액 가리기 버튼 추가')
assert.match(scriptSource, /AMOUNT_PRIVACY_KEY[\s\S]*MutationObserver[\s\S]*_syncAmountPrivacyCharts[\s\S]*localStorage\.setItem/, '금액 가리기 상태를 저장하고 동적 화면·차트에도 지속 적용')
assert.match(styleSource, /body\.amount-privacy canvas,[\s\S]*body\.amount-privacy \.js-plotly-plot\{pointer-events:none!important\}/, '금액 가리기 중 차트 툴팁으로 금액이 노출되지 않게 차단')
const privacyContext = {}
vm.createContext(privacyContext)
vm.runInContext(extractFunction(scriptSource, '_maskAmountText'), privacyContext)
assert.equal(privacyContext._maskAmountText('평가액 +₩12,345,678원'), '평가액 +₩••••', '원화 금액 마스킹')
assert.equal(privacyContext._maskAmountText('배당 $123.45 · 환산 ¥9,876'), '배당 $•••• · 환산 ¥••••', '외화 금액 마스킹')

const taxTreatmentContext = { CB_TAX_ACCTS:['일반','연금저축','ISA'] }
vm.createContext(taxTreatmentContext)
for (const name of ['cbTaxAcctOf','cbTaxTreatment']) {
  vm.runInContext(extractFunction(cobaltSource, name), taxTreatmentContext)
}
assert.equal(taxTreatmentContext.cbTaxTreatment({account:'일반',category:'domestic'}).label, '비과세', '국내 일반계좌 세제 구분')
assert.equal(taxTreatmentContext.cbTaxTreatment({account:'일반',category:'foreign'}).label, '22% 대상', '해외 일반계좌 세제 구분')
assert.equal(taxTreatmentContext.cbTaxTreatment({account:'ISA',category:'domestic'}).label, '9.9% 분리', 'ISA 세제 구분')
assert.equal(taxTreatmentContext.cbTaxTreatment({account:'연금저축',category:'domestic'}).label, '과세이연', '연금저축 세제 구분')
assert.match(cobaltSource, /메모<\/span><span style="width:82px[\s\S]*세제 구분[\s\S]*cb-tax-treatment is-\$\{treatment\.tone\}/, '양도소득세 메모와 실현손익 사이에 세제 구분 칼럼 추가')

const dcaScheduleContext = { cbRate:cur=>cur==='USD'?1400:1 }
vm.createContext(dcaScheduleContext)
for (const name of [
  'cbDcaPerMonthKRW','cbDcaPerOrderKRW','cbDcaExpectedQty','cbDcaDateAt','cbDcaDateKey',
  'cbDcaMarket','cbDcaIsHoliday','cbDcaScheduledOn','cbDcaScheduleSummary'
]) {
  vm.runInContext(extractFunction(cobaltSource, name), dcaScheduleContext)
}
const monthlyDca = {
  dca:true,dcaCycle:'매월',dcaDay:31,dcaMode:'amount',dcaAmt:100_000,dcaCur:'KRW',
  cur:'KRW',curP:50_000,grp:'주식'
}
const monthlySchedule = dcaScheduleContext.cbDcaScheduleSummary(monthlyDca, '2026-07-30')
assert.equal(monthlySchedule.nextDate, '2026-07-31', '다음 월간 DCA 매수일 계산')
assert.equal(monthlySchedule.remainingCount, 1, '이번 달 남은 매수 횟수 계산')
assert.equal(monthlySchedule.remainingAmount, 100_000, '이번 달 남은 매수 금액 계산')
assert.equal(monthlySchedule.expectedQty, 2, '현재가 기준 회당 예상 매수 수량 계산')
assert.equal(dcaScheduleContext.cbDcaPerMonthKRW({
  dcaCycle:'매주',dcaDays:[1,5],dcaMode:'amount',dcaAmt:10_000,dcaCur:'KRW'
}), 86_600, '복수 요일 주간 DCA 월 환산에 선택 요일 수 반영')
assert.match(cobaltSource, /이번 달 남은 매수[\s\S]*remainingCount[\s\S]*remainingAmount[\s\S]*다음 매수[\s\S]*예상 수량/, 'DCA 상단 잔여 일정 위젯과 내역 신규 칼럼 추가')
assert.match(styleSource, /\.cb-dca-summary-grid\{display:grid;grid-template-columns:repeat\(5/, 'DCA 상단 다섯 요약 위젯을 균등 배치')

console.log('PASS 후속 UI·INDEX ETF·현금 흐름·배당 상세')
