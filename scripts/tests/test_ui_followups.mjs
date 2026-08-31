#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const scriptSource = fs.readFileSync(new URL('../../script.js', import.meta.url), 'utf8')
const cobaltSource = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8')
const financeSource = fs.readFileSync(new URL('../../finance.js', import.meta.url), 'utf8')
const styleSource = fs.readFileSync(new URL('../../style.css', import.meta.url), 'utf8')
const indexSource = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const priceApiSource = fs.readFileSync(new URL('../../api/price.ts', import.meta.url), 'utf8')

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
  { i: { owner: '본인', name: 'VOO', cur: 'KRW' }, tkr: 'VOO', title: 'Vanguard S&P 500 ETF', d: { months: [0] }, incomeKRW: 100 },
  { i: { owner: '아내', name: 'VOO', cur: 'KRW' }, tkr: 'VOO', title: 'Vanguard S&P 500 ETF', d: { months: [0] }, incomeKRW: 200 },
]
const divCal = dividendContext.cbDivMonthlyForYear(dividendList, String(new Date().getFullYear()))
assert.equal(divCal.monthAmt[0], 300, '월별 배당 합계 계산')
assert.equal(divCal.monthDetails[0].length, 2, '전체 모드 월별 배당 상세는 같은 종목도 소유주별로 분리')
assert.deepEqual(Array.from(divCal.monthDetails[0], row => [row.owner, row.amount]), [['아내', 200], ['본인', 100]], '월별 종목 배당에 소유주와 금액 보존')
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
assert.match(scriptSource, /cfDeletedKeys\.some\(key=>\{[\s\S]*raw===divKey[\s\S]*_normDivKey\(raw\)===legacyNorm/, '페이지 재진입 시 신규·구형 삭제 키 모두 자동 배당 재생성 차단')
assert.match(scriptSource, /rememberCfDeletion\(item\)[\s\S]*await saveExtDataToKV\(\)/, '삭제 상태를 원격 확장 데이터까지 저장')
assert.match(
  scriptSource,
  /arrayFields\.forEach\(key=>\{normalized\[key\]=owns\(key\)\?data\[key\]:\[\];\}\)[\s\S]*cfData=_normalizeCfRows\(normalized\.cfData\)/,
  '빈 현금 흐름 배열과 누락 필드를 원격 정본 기준으로 복원',
)

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
assert.match(styleSource, /\.cb-dividend-tip\{[\s\S]*min-width:min\(460px/, '배당 월별 툴팁 폭 확장')
assert.match(styleSource, /\.cb-div-tip-name,\.cb-div-tip-ticker,\.cb-div-tip-row b\{white-space:nowrap\}/, '배당 툴팁 종목명·티커 줄바꿈 방지')
assert.match(cobaltSource, /const showOwner=!_cbDivOwner\|\|_cbDivOwner==='전체'[\s\S]*cb-div-tip-owner/, '전체 배당 툴팁에서 소유주를 종목과 별도 필드로 표시')
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
assert.match(scriptSource, /function _bubbleOwnerFill\(owner,panelColor\)[\s\S]*colors\.push\(_bubbleOwnerFill\(owner,panelColor\)\)[\s\S]*path\.style\.fill=_bubbleOwnerFill\(ownerName,panelColor\)[\s\S]*path\.style\.stroke=_bubbleOwnerStroke\(ownerName,panelColor\)[\s\S]*dotSpan\.textContent='● '/, '전체 비중 차트 소유주 링은 테마별 옅은 채움·팔레트 실선·라벨 앞 컬러 점으로 구분')
assert.doesNotMatch(scriptSource, /allowedLeafIds/, '비중 차트 외부 라벨은 상위 종목으로 제한하지 않고 모든 가시 종목을 대상으로 함')
assert.match(scriptSource, /const labelMargin=Math\.min\(240,[\s\S]*margin: \{ t: 72,[\s\S]*const textR = R \+ 29[\s\S]*const tx = cx \+ lf\.dx \* textR[\s\S]*const finalTx = dx >= 0 \? Math\.min\(tx, rightXMax\)/, '차트 원을 줄여 상하 여백을 확보하고 종목 라벨을 원주 각도에 따라 배치')
assert.doesNotMatch(scriptSource, /const columnX=dx>=0/, '비중 차트 라벨을 좌우 고정 열로 강제하지 않음')
assert.match(cobaltSource, /배당 집중도[\s\S]*상위 3종목/, '배당 관리 상단에 배당원 집중도 위젯 추가')
assert.match(cobaltSource, /const top3Div = [\s\S]*상위 배당원 TOP 3[\s\S]*cb-div-top3-name[\s\S]*share\.toFixed\(1\)/, '배당 집중도 상위 3개 종목명과 각 배당 기여 비중을 별도 위젯에 표시')
assert.match(cobaltSource, /const label=\[ownerF\?'':x\.i\.owner, x\.title\|\|'종목명 미확인'\][\s\S]*cb-div-top3-metrics[\s\S]*cbDisp\(x\.incomeKRW\)[\s\S]*share\.toFixed\(1\)/, '전체 배당원 TOP3에는 소유주·종목명·금액·비중을 표시하고 티커는 제외')
assert.match(cobaltSource, /cb-div-summary-title[\s\S]*배당성장률[\s\S]*cb-div-history-status[\s\S]*산출 \$\{gList\.length\}\/\$\{list\.length\} · 원본 \$\{rawHistoryList\.length\}\/\$\{list\.length\}/, '배당성장률 산출 수와 원본 이력 확보 수를 분리해 표시')
assert.match(scriptSource, /const DIV_HIST_CACHE_VERSION = 2[\s\S]*const missingExpected = expectedDividendKeys\.filter[\s\S]*const missingRetryDue = missingExpected\.length>0 && age>=86400000[\s\S]*obj\.version===DIV_HIST_CACHE_VERSION[\s\S]*version:DIV_HIST_CACHE_VERSION/, '누락 이력은 하루 뒤 재검증하고 정상 이력 캐시는 버전·7일 기준으로 재사용')
assert.match(priceApiSource, /const symbols = krMatch[\s\S]*`\$\{krMatch\[1\]\}\.KS`,`\$\{krMatch\[1\]\}\.KQ`[\s\S]*for \(const sym of symbols\)/, '국내 배당 이력은 코스피 조회 실패 시 코스닥 심볼로 재조회')
assert.match(cobaltSource, /cbTaxChartSvg\(1240,440,list\)/, '양도소득세 중앙 차트의 가로 viewBox 확대')
assert.match(cobaltSource, /const padL=64, padR=78, padT=14, padB=22/, '양도소득세 차트 12월 우측의 불필요한 내부 여백 축소')
const divGrowthContext = {
  window: {
    _divHistoryRawCache: {
      READY:{events:[
        {date:'2023-03-01',amount:1},
        {date:'2024-03-01',amount:1.1},
        {date:'2025-03-01',amount:1.21},
      ]},
      SHORT:{events:[
        {date:'2025-03-01',amount:1},
        {date:'2026-03-01',amount:1.1},
      ]},
    }
  }
}
vm.createContext(divGrowthContext)
for (const [source,name] of [
  [scriptSource,'_divpAggregateByYear'],
  [scriptSource,'_divpComputeCagr'],
  [cobaltSource,'cbStrip'],
  [cobaltSource,'cbDivGrowthInfo'],
]) vm.runInContext(extractFunction(source,name),divGrowthContext)
assert.equal(divGrowthContext.cbDivGrowthInfo({tkr:'READY'}).status,'ready','완결연도 2개 이상이면 배당성장률 산출')
assert.equal(divGrowthContext.cbDivGrowthInfo({tkr:'SHORT'}).status,'insufficient','원본 이력은 있으나 완결연도가 짧으면 이력 부족으로 구분')
assert.equal(divGrowthContext.cbDivGrowthInfo({tkr:'MISSING'}).status,'missing','원본 배당 이력 조회 실패를 별도 구분')
assert.match(cobaltSource, /소유주별 자산군 구성[\s\S]*cb-family-mix-track/, '가족 자산 내역 옆에 소유주별 자산군 구성 위젯 추가')
assert.match(cobaltSource, /월 환산 매수 배분 TOP 5[\s\S]*cb-dca-allocation-track/, 'DCA 내역 옆에 월 환산 매수 배분 TOP 5 위젯 추가')
assert.match(cobaltSource, /배당 비중[\s\S]*x\.incomeKRW\/divAnnual\*100/, '배당 종목 내역에 종목별 배당 수입 비중 칼럼 추가')
assert.match(cobaltSource, /향후 90일 배당 일정[\s\S]*지급일이 확인되지 않은 종목은 ‘월 예정’/, '배당 내역 옆에 향후 90일 배당 일정 위젯 추가')
assert.match(styleSource, /@media \(min-width:1420px\)\{[\s\S]*cb-family-detail-grid[\s\S]*cb-dca-detail-grid[\s\S]*280px/, '넓은 화면에서 가족 자산·DCA 표와 보조 위젯을 좌우 배치')
assert.match(styleSource, /@media \(min-width:1580px\)\{[\s\S]*cb-div-detail-grid[\s\S]*290px/, '배당 표가 충분히 넓을 때만 일정 위젯을 우측 배치')
assert.match(cobaltSource, /cb-family-table-toolbar[\s\S]*전체 투자자산[\s\S]*cb-family-head/, '가족 투자자산 표 제목·검색줄과 칼럼 헤더에 연속 고정 클래스 적용')
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
assert.match(cobaltSource, /세액 참고 합계[\s\S]*일반 · 해외주식[\s\S]*해외 기본공제 사용률[\s\S]*일반 · 국내주식[\s\S]*ISA 계좌[\s\S]*연금저축 계좌/, '양도소득세 상단 위젯을 참고합계·해외·공제·국내·ISA·연금 순으로 배치')
assert.match(cobaltSource, /id="cb-tax-pl"[\s\S]*inputmode="numeric"[\s\S]*data-no-comma="1"[\s\S]*oninput="handlePLAmtInput\(this\)"/, '양도소득세 수정 금액 입력에도 음수 허용 실시간 쉼표 포맷 적용')
assert.match(styleSource, /\.cb-tax-deduction-value\{[\s\S]*margin-top:12px\}[\s\S]*\.cb-tax-deduction-track\{[^}]*margin-top:5px\}/, '해외 기본공제 사용률 막대를 퍼센티지 바로 아래에 배치')
assert.match(styleSource, /\.cb-tax-deduction-remain\{margin-top:auto/, '해외 기본공제 잔여액을 카드 하단에 배치')
assert.match(cobaltSource, /시장<\/span><span style="width:64px">계좌<\/span><span style="width:82px;text-align:center"><span[^>]*>세제 구분<\/span><\/span><span class="cb-tax-memo-head"[^>]*>메모<\/span>/, '양도소득세 세제 구분을 계좌와 메모 사이에 배치')
assert.match(cobaltSource, /cb-dash-table-toolbar[\s\S]*cb-dash-head[\s\S]*cb-dash-detail/, '대시보드 표 검색줄·칼럼·상세 패널에 고정용 클래스 적용')
assert.match(styleSource, /\.cb-dash-table-toolbar\{position:sticky;top:0[\s\S]*\.cb-dash-table-panel \.cb-dash-head\{top:45px[\s\S]*\.cb-dash-detail\{top:0!important\}/, '대시보드 제목·검색줄과 칼럼 및 우측 상세를 스크롤 중 고정')
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

const taxTreatmentContext = { CB_TAX_ACCTS:['일반','연금저축','ISA'], OWNERS:['본인','아내','자녀1','아버지'], _taxRuleValue:(_path,fallback)=>fallback }
vm.createContext(taxTreatmentContext)
for (const name of ['cbTaxAcctOf','cbTaxTreatment','cbSortTaxEntries','cbTaxCumulativeByEntry']) {
  vm.runInContext(extractFunction(cobaltSource, name), taxTreatmentContext)
}
assert.equal(taxTreatmentContext.cbTaxTreatment({account:'일반',category:'domestic'}).label, '비과세', '국내 일반계좌 세제 구분')
assert.equal(taxTreatmentContext.cbTaxTreatment({account:'일반',category:'foreign'}).label, '22% 대상', '해외 일반계좌 세제 구분')
assert.equal(taxTreatmentContext.cbTaxTreatment({account:'ISA',category:'domestic'}).label, '9.9% 참고', 'ISA 세제 구분은 연간 참고임을 표시')
assert.equal(taxTreatmentContext.cbTaxTreatment({account:'연금저축',category:'domestic'}).label, '과세이연', '연금저축 세제 구분')
assert.match(cobaltSource, /계좌<\/span><span style="width:82px[\s\S]*세제 구분[\s\S]*cb-tax-treatment is-\$\{treatment\.tone\}[\s\S]*t\.memo/, '양도소득세 계좌 다음에 세제 구분, 메모 순으로 배치')
assert.match(cobaltSource, /cb-tax-memo-head[\s\S]*cb-tax-memo-cell/, '양도소득세 메모 칼럼에 별도 여백 클래스 적용')
assert.match(styleSource, /\.cb-tax-treatment\{[^}]*border:0!important[^}]*background:transparent!important[\s\S]*\.cb-tax-memo-head,\.cb-tax-memo-cell\{[^}]*padding-left:18px\}/, '세제 구분은 아웃라인 없는 텍스트로 표시하고 메모와 간격 확보')
const cumulativeEntries = [
  { id:3, month:'2026-02', category:'foreign', owner:'본인', amt:-300_000 },
  { id:1, month:'2026-01', category:'foreign', owner:'본인', amt:1_000_000 },
  { id:2, month:'2026-02', category:'domestic', owner:'본인', amt:500_000 },
]
const cumulativeByEntry = taxTreatmentContext.cbTaxCumulativeByEntry(cumulativeEntries,t=>t.owner)
assert.equal(cumulativeByEntry.get(cumulativeEntries[1]), 1_000_000, '연간 누적손익은 월 순서로 시작')
assert.equal(cumulativeByEntry.get(cumulativeEntries[2]), 1_500_000, '같은 월은 국내 기록을 먼저 누적')
assert.equal(cumulativeByEntry.get(cumulativeEntries[0]), 1_200_000, '해외 기록까지 연간 누적손익에 합산')
assert.match(cobaltSource, /annualCumulative = cbTaxCumulativeByEntry\(list, ownerOf\)[\s\S]*연간 누적손익[\s\S]*cumulative=annualCumulative\.get\(t\)\|\|0/, '월 필터와 무관하게 조회 연도 전체 누계를 표에 표시')

const dcaScheduleContext = { cbRate:cur=>cur==='USD'?1400:1 }
vm.createContext(dcaScheduleContext)
for (const name of [
  'cbDcaPerMonthKRW','cbDcaPerOrderKRW','cbDcaExpectedQty','cbDcaDateAt','cbDcaDateKey',
  'cbDcaMarket','cbDcaIsHoliday','cbDcaScheduledOn','cbDcaScheduleSummary',
  'cbDcaIsUsDst','cbDcaBrokerTiming'
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
const usDailyBase = {
  dca:true,dcaCycle:'매일',dcaMode:'amount',dcaAmt:10_000,dcaCur:'KRW',
  cur:'USD',curP:70,grp:'주식'
}
const meritzUsSchedule = dcaScheduleContext.cbDcaScheduleSummary({
  ...usDailyBase,broker:'메리츠증권',dcaLastExec:'2026-08-10'
}, '2026-08-10')
const tossUsSchedule = dcaScheduleContext.cbDcaScheduleSummary({
  ...usDailyBase,broker:'토스증권'
}, '2026-08-10')
assert.equal(meritzUsSchedule.nextDate, '2026-08-10', '과거 내부 체결기록과 무관하게 미국주식 예정일 계산')
assert.equal(tossUsSchedule.nextDate, meritzUsSchedule.nextDate, '같은 미국시장·주기 종목은 증권사가 달라도 예정일 통일')
const meritzSummerTiming = dcaScheduleContext.cbDcaBrokerTiming({ ...usDailyBase,broker:'메리츠증권' }, '2026-08-10')
const meritzWinterTiming = dcaScheduleContext.cbDcaBrokerTiming({ ...usDailyBase,broker:'메리츠증권' }, '2026-12-10')
assert.equal(meritzSummerTiming.label, '21:30 주문', '메리츠 미국주식 서머타임 주문 기준 반영')
assert.equal(meritzWinterTiming.label, '22:30 주문', '메리츠 미국주식 표준시간 주문 기준 반영')
assert.equal(dcaScheduleContext.cbDcaBrokerTiming({ ...usDailyBase,broker:'토스증권' }, '2026-08-10').label, '당일 자동주문', '토스 미국주식은 공개된 확정시각 없이 당일 처리로 표시')
assert.equal(dcaScheduleContext.cbDcaBrokerTiming({ ...usDailyBase,cur:'KRW',broker:'삼성증권' }, '2026-08-10').label, '오전 장중', '삼성 국내주식 장중 처리 반영')
assert.equal(dcaScheduleContext.cbDcaPerMonthKRW({
  dcaCycle:'매주',dcaDays:[1,5],dcaMode:'amount',dcaAmt:10_000,dcaCur:'KRW'
}), 86_600, '복수 요일 주간 DCA 월 환산에 선택 요일 수 반영')
assert.match(cobaltSource, /이번 달 남은 매수[\s\S]*remainingCount[\s\S]*remainingAmount[\s\S]*다음 매수[\s\S]*예상 수량/, 'DCA 상단 잔여 일정 위젯과 내역 신규 칼럼 추가')
assert.match(cobaltSource, /예상 처리[\s\S]*cb-dca-timing-cell[\s\S]*x\.timing\.label[\s\S]*x\.timing\.note/, 'DCA 내역에 증권사별 예상 처리 시점 표시')
assert.doesNotMatch(scriptSource, /i\.dcaLastExec\s*=|i\.qty\s*=\s*newTotalQty/, '페이지 로드시 DCA 체결일·보유수량을 임의 변경하지 않음')
assert.match(styleSource, /\.cb-dca-summary-grid\{display:grid;grid-template-columns:repeat\(5/, 'DCA 상단 다섯 요약 위젯을 균등 배치')

const riskInsightRows = [
  {
    i:{owner:'본인',grp:'주식',cur:'USD',name:'Apple Inc.',tkr:'AAPL',dca:true,div:100},
    cls:'us',title:'Apple Inc.',val:400,cost:500,gain:-100,
  },
  {
    i:{owner:'본인',grp:'주식',cur:'KRW',name:'KOSPI 200 ETF',tkr:'069500',div:50},
    cls:'kr',title:'KOSPI 200 ETF',val:300,cost:300,gain:0,
  },
  {
    i:{owner:'본인',grp:'현금',cur:'KRW',name:'원화 예수금',tkr:'KRW'},
    cls:'cash',title:'원화 예수금',val:300,cost:300,gain:0,
  },
]
const riskInsightContext = {
  pfolioData:riskInsightRows.map(row=>row.i),
  // 필수지출은 '고정비로 분류된(isFixedCost===true) 지출'만 — 현금 흐름 화면과 같은 기준
  autoTransferData:[
    {owner:'본인',type:'지출',cat:'주거/통신',cycle:'monthly',amt:100,isFixedCost:true},
    {owner:'본인',type:'지출',cat:'저축/투자',cycle:'monthly',amt:500,isFixedCost:true},   // 자산 이동이라 제외돼야 함
    {owner:'본인',type:'지출',cat:'식비',cycle:'monthly',amt:900},                          // 미분류라 합산되지 않아야 함
  ],
  window:{ _balanceSheet:{assets:[],liabilities:[],cashTargetMonths:6}, _dataFreshness:{} },
  goalData:[],
  cbAllRows:()=>riskInsightRows,
  cbLookThrough:()=>({list:[{via:50}]}),
  cbMergeRows:rows=>rows,
  cbSectors:()=>({list:[{label:'Technology',pct:40},{label:'Index ETF',pct:30}]}),
  cbDivIncomeKRW:item=>item.div||0,
  cbStrip:ticker=>String(ticker||'').toUpperCase(),
  cbDcaPerMonthKRW:item=>item.dca?100:0,
  _effectiveAutoTransferAmt:at=>at.amt,
  _autoTransferActiveInMonth:()=>true,
  _autoTransferMonthlyEquivalent:at=>at.amt,
  cbDisp:value=>'₩'+Math.round(value),
}
vm.createContext(riskInsightContext)
// 리스크 페이지의 현금 커버리지는 재무상태표의 현금 안전판과 같은 함수를 써야 한다.
// finance.js 의 실제 구현을 넣어 두 화면이 같은 값을 내는지 여기서 검증한다.
;['FIN_DEFAULT_TARGET','FIN_SAVING_CATS'].forEach(name=>{
  const line = financeSource.split('\n').find(l=>l.startsWith(`const ${name}=`))
  assert.ok(line, `${name} 상수를 찾을 수 없음`)
  vm.runInContext(line, riskInsightContext)
})
;['finNewId','finEnsureState','finOwnerF','finRows','finMonthlyFixedCost','finCashSafety']
  .forEach(name=>vm.runInContext(extractFunction(financeSource, name), riskInsightContext))
vm.runInContext(extractFunction(cobaltSource, 'cbRiskInsights'), riskInsightContext)

// 필수지출 단일 소스: 미분류(식비 900)와 저축/투자(500)는 빠지고 고정비 100만 남는다
const safetyProbe = riskInsightContext.finCashSafety('본인')
assert.equal(safetyProbe.fixed, 100, '고정비로 분류된 지출만 필수지출에 합산')
assert.equal(safetyProbe.pendingCount, 1, '미분류 자동이체는 합산하지 않고 건수만 보고')
assert.equal(safetyProbe.committed, 200, '월 약정액 = 필수지출 + DCA')
const riskInsights = riskInsightContext.cbRiskInsights('본인',{fxPct:40})
const riskInsightById = Object.fromEntries(Array.from(riskInsights, card=>[card.id,card]))
assert.equal(riskInsights.length, 8, '리스크 보조 진단 위젯 8개 생성')
assert.equal(riskInsightById['etf-overlap'].value, '5.0%', 'ETF 직접·간접 중복 노출 계산')
assert.equal(riskInsightById['effective-holdings'].value, '2.9개', 'HHI 역수 기준 실효 종목 수 계산')
assert.equal(riskInsightById['fx-shock'].value, '−4.0%', '환율 10% 하락 민감도 계산')
assert.equal(riskInsightById['country-concentration'].value, '미국 40.0%', '최대 국가 집중도 계산')
assert.equal(riskInsightById['top2-sectors'].value, '70.0%', '상위 두 섹터 집중도 계산')
assert.equal(riskInsightById['dividend-dependency'].value, '100.0%', '배당원 TOP3 의존도 계산')
assert.equal(riskInsightById['liquidity-coverage'].value, '1.5개월', '현금 대비 월 DCA·정기지출 커버리지 계산')
assert.equal(riskInsightById['recovery-return'].value, '14.3%', '평가손실 원금 회복 필요 수익률 계산')
assert.match(cobaltSource, /포트폴리오 비중[\s\S]*min-width:640px[\s\S]*>비중<\/span>[\s\S]*r\.val\/nw\*100/, '대시보드 내역과 상세에 포트폴리오 비중 추가')
assert.match(cobaltSource, /const riskGridCards=Array\.from\(\{length:4\}[\s\S]*r\.cards\.slice\(row\*2,row\*2\+2\)[\s\S]*insights\.slice\(row\*2,row\*2\+2\)[\s\S]*class="cb-risk-card-grid"/, '기존 8개와 신규 8개 리스크 카드를 같은 행 흐름으로 교차 배치')
assert.match(styleSource, /\.cb-risk-card-grid\{min-width:0;display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/, '리스크 통합 위젯 데스크톱 4열 배치')
assert.match(styleSource, /@media \(max-width:1200px\)\{[\s\S]*\.cb-risk-card-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, '리스크 통합 위젯 중간 화면 2열 배치')
assert.match(styleSource, /@media \(max-width: 720px\)\{[\s\S]*\.cb-perf-detail-grid,\.cb-dash-insight-grid,\.cb-risk-card-grid\{grid-template-columns:1fr\}/, '리스크 위젯 모바일 1열 배치')
assert.match(styleSource, /\.cb-risk-primary-message\{[^}]*word-break:keep-all;overflow-wrap:break-word/, '리스크 설명 문구가 카드 밖으로 잘리지 않도록 단어 단위 줄바꿈')
assert.match(styleSource, /\.cb-div-tip-owner\{[^}]*var\(--tiptx\)/, '라이트 테마의 어두운 배당 툴팁에서도 소유주명이 밝게 표시')
assert.match(styleSource, /\.cb-thead\{[^}]*background:var\(--panelSolid\)[\s\S]*\.cb-family-table-panel \.cb-family-head,[\s\S]*\.cb-dash-table-panel \.cb-dash-head,[\s\S]*\.cb-div-history-panel \.cb-div-head\{[\s\S]*box-shadow:0 -12px 0 12px var\(--panelSolid\)/, '대시보드·가족 자산·배당 관리 고정 헤더는 불투명 배경으로 행 내용 비침 방지')

console.log('PASS 후속 UI·INDEX ETF·현금 흐름·배당 상세')
