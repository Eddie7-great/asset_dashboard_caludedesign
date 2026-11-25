#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { readSource } from './_source.mjs'

const scriptSource = readSource('script.js')
const cobaltSource = readSource('cobalt.js')
const financeSource = fs.readFileSync(new URL('../../finance.js', import.meta.url), 'utf8')
const styleSource = fs.readFileSync(new URL('../../style.css', import.meta.url), 'utf8')
const workspaceSource = fs.readFileSync(new URL('../../workspace-ui.css', import.meta.url), 'utf8')
const indexSource = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const simulatorSource = fs.readFileSync(new URL('../../simulator.js', import.meta.url), 'utf8')
const dashboardPySource = fs.readFileSync(new URL('../../api/dashboard.py', import.meta.url), 'utf8')
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
  curRate:()=>1,
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
for (const name of ['cbAmtGridSvg', 'cbAxisTicks', 'cbDefaultDivMonths', 'cbAddDivMonthDetail', 'cbDivMonthlyForYear', 'cbDivShortWon', 'cbDivCalendarSvg']) {
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
{
  // 올해 예상 그래프: 이번 달부터 남은 달은 빗금, 이번 달 이름표 강조. 지난 연도(-1)는 구분하지 않는다.
  const amt = Array(12).fill(100)
  const det = Array.from({ length: 12 }, () => [])
  const hatched = dividendContext.cbDivCalendarSvg(amt, det, 1100, 300, 10)
  assert.equal((hatched.match(/fill="url\(#cb-div-hatch\)"/g) || []).length, 2, '11·12월(이번 달부터)만 빗금')
  assert.match(hatched, />11월 · 이번 달</, '이번 달 이름표 표시')
  const plain = dividendContext.cbDivCalendarSvg(amt, det, 1100, 300)
  assert.doesNotMatch(plain, /cb-div-hatch|이번 달/, '지난 연도·내년 그래프는 구분하지 않음')
  assert.match(cobaltSource, /const divNowMonth = \(!cal\.actual && year===nowY\) \? new Date\(\)\.getMonth\(\) : -1;/, '올해 예상 그래프에서만 이번 달을 표시')
  assert.match(cobaltSource, /이번 달부터 남은 달 · 12달 모두 추정/, '지난 달을 받은 금액으로 오해하지 않게 모두 추정이라고 적음')
}
assert.match(divSvg, /onmousemove="cbDivBarHover\(event,0\)"/, '배당 막대에 종목별 상세 호버 연결')
assert.match(divSvg, /onclick="cbDivMonthPick\(0\)"/, '배당 막대 클릭을 월별 종목 필터에 연결')
// 2026-11-23: 막대 위 금액은 가장 큰 달 하나만 짧게(정확한 금액은 말풍선), 색은 배당 전용 토큰.
assert.match(divSvg, />최대 300원<\/text>/, '가장 큰 달 막대 위에만 짧은 금액')
{
  const amt = [0, 120000, 0, 265000, 0, 80000, 0, 0, 0, 0, 0, 0]
  const svg = dividendContext.cbDivCalendarSvg(amt, Array.from({ length: 12 }, () => []), 1100, 300)
  assert.equal((svg.match(/font-weight="700" text-anchor="middle">/g) || []).length, 1, '금액 글자는 한 개뿐')
  assert.match(svg, />최대 26\.5만<\/text>/, '만 단위 짧은 금액')
}
assert.match(cobaltSource, /cssVar\('--div-bar'/, '배당 막대는 손익색(--up)이 아닌 배당 전용 색')
assert.match(fs.readFileSync(new URL('../../style.css', import.meta.url), 'utf8'), /--div-bar:#3f63c9[\s\S]*--div-bar:#7d9bf0/, '라이트·다크 배당 막대 색 토큰')

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
assert.doesNotMatch(styleSource, /\[data-tip\]\{[^}]*border-bottom:1px dashed/, "용어 툴팁은 점선 밑줄 대신 ⓘ 표식");
assert.match(styleSource, /:is\(span,small,em\)\[data-tip\][^{]*::after\{content:"ⓘ"/, "글자형 툴팁에 ⓘ 표식");
assert.match(styleSource, /\.cb-thead,\s*\.pt-table th\{[\s\S]*font-family:var\(--font-ui\)/, '페이지별 칼럼명 폰트를 자산 내역과 통일')
assert.match(styleSource, /\.cb-perf-card-grid\{display:grid;grid-template-columns:repeat\(6,minmax\(124px,1fr\)\)/, '성과 비교 상단 소유주·지수 카드를 한 줄로 유지')
assert.match(styleSource, /\.cb-perf-card-grid\{[^}]*overflow:visible/, '성과 비교 상단 카드의 외곽선 때문에 세로 스크롤바가 생기지 않게 함')
assert.match(cobaltSource, /const entities = \[\s*\{key:'S&P 500'[^\n]*\n\s*\{key:'KOSPI'[^\n]*\n\s*\.\.\.OWNERS\.map/, '비교 지수(S&P 500 → KOSPI)를 소유주보다 앞에 두고, 성과 데이터 유무와 무관하게 모든 소유주 카드·범례 유지(2026-11-25 사용자 결정)')
assert.match(cobaltSource, /if \(id==='perf2'\) cbVerifyPerfOwnersOnOpen\(\)/, '성과 비교 진입 때 누락 소유주 데이터 재검증')
assert.match(styleSource, /\.cb-perf-detail-grid\{display:grid;grid-template-columns:minmax\(0,1fr\)/, '성과 비교 하단은 한 표(2026-11-17 3차 — 좌우 두 표는 순위를 눈으로 맞춰야 했다)')
assert.equal((cobaltSource.match(/<div class="cb-perf-detail-table">/g) || []).length, 1, '수익률 표는 하나')
assert.match(cobaltSource, /const sortedRows = rows\.slice\(\)\.sort\(\(a,b\)=>\{\s*if \(a\.e\.isBench!==b\.e\.isBench\) return a\.e\.isBench\?-1:1;[\s\S]*?return bv-av;/, '수익률 표는 비교 지수 두 줄을 맨 위에 고정하고, 소유주는 선택 기간 수익률 높은 순(값 없는 줄은 끝)')
assert.match(cobaltSource, /\$\{cbPerfBarHtml\(r\.vals\[tfIdx\], perfBarMax, r\.e\.color\)\}/, '선택 기간 수익률 막대 칸')
{
  const perfCtx = {}
  vm.createContext(perfCtx)
  for (const name of ['cbPerfBarHtml', 'cbPerfTickIdx', 'cbSpreadLabels']) vm.runInContext(extractFunction(cobaltSource, name), perfCtx)
  assert.match(perfCtx.cbPerfBarHtml(10, 20, '#5b9bff'), /left:50\.00%;width:25\.00%/, '이익 막대는 0(가운데)에서 오른쪽으로')
  assert.match(perfCtx.cbPerfBarHtml(-20, 20, '#5b9bff'), /left:0\.00%;width:50\.00%/, '손실 막대는 0에서 왼쪽으로, 최대 절댓값이면 끝까지')
  assert.doesNotMatch(perfCtx.cbPerfBarHtml(null, 20, '#000'), /<i /, '값이 없으면 막대를 그리지 않음')
  assert.deepEqual(Array.from(perfCtx.cbPerfTickIdx(250)), [0, 50, 100, 149, 199, 249], '일별 250점에서 날짜 눈금은 6개만 고른 간격으로')
  assert.deepEqual(Array.from(perfCtx.cbPerfTickIdx(5)), [0, 1, 2, 3, 4], '점이 적으면 모두 표시')
  const spread = Array.from(perfCtx.cbSpreadLabels([100, 102, 101, 50], 14, 10, 210))
  const sorted = spread.slice().sort((a, b) => a - b)
  for (let k = 1; k < sorted.length; k++) assert.ok(sorted[k] - sorted[k - 1] >= 13.99, '선 끝 이름표는 최소 간격만큼 벌어짐')
  assert.ok(Array.from(perfCtx.cbSpreadLabels([205, 206, 207], 14, 10, 210)).every(y => y <= 210), '아래쪽 끝을 넘으면 통째로 올림')
}
assert.match(scriptSource, /const indices = Array\.from\(\{length:n\}, \(_,i\)=>i\);/, 'JS 벤치마크 폴백은 모든 거래일을 보낸다(6등분 샘플링 금지)')
assert.doesNotMatch(scriptSource, /Math\.floor\(n\/6\)/, 'JS 폴백에 6등분 샘플링이 남지 않음')
assert.match(dashboardPySource, /\n\s*indices = list\(range\(n\)\)\n/, '서버 벤치마크도 모든 거래일을 보낸다(JS 폴백과 같은 규칙)')
assert.doesNotMatch(dashboardPySource, /n \/\/ 6/, '서버에 6등분 샘플링이 남지 않음')
assert.match(cobaltSource, /cbPerfTickIdx\(N\)\.map/, '날짜 눈금은 고른 간격 몇 개만')
assert.match(cobaltSource, /<div class="cb-chart-scroll"><div class="cb-perf-plot">[\s\S]*?cbMultiLineSvg\(seriesArr, 1100, 220\)[\s\S]*?class="cb-perf-xaxis"[\s\S]*?<\/div><\/div>/, '성과 그래프·날짜 눈금은 휴대폰 가로 스크롤 틀 안에 함께 있다')
assert.match(workspaceSource, /@media\(max-width:768px\)\{\s*\.cb-perf-plot\{min-width:1040px\}\s*\.cb-div-summary-grid>\.cb-div-top3-card\{grid-column:1\/-1\}/, '휴대폰: 성과 그래프는 줄이지 않고 옆으로 밀어 보며, 배당 TOP 3 는 한 줄 전체')
assert.doesNotMatch(cobaltSource, /rows\.find\(r=>r\.e\.key==='KOSPI'\), rows\.find\(r=>r\.e\.key==='아내'\)/, '좌우 두 표로 나누던 고정 배치를 남기지 않음(선택 기간 수익률 순 한 표)')
assert.match(cobaltSource, /<div class="cb-perf-detail-table">[\s\S]*<div class="cb-perf-detail-row\$\{r\.e\.isBench\?' is-bench':''\}"/, '성과 비교 하단 기존 표 행 구조 유지(벤치마크 줄은 is-bench 표시)')
assert.match(cobaltSource, /<span><span data-tip="같은 기간 S&P 500 수익률 대비 차이[\s\S]*>S&amp;P 대비<\/span><\/span>/, '성과 비교 초과수익 칼럼을 명확한 S&P 대비로 표기하고 밑줄 범위를 텍스트로 제한')
// 2026-11-23(사용자 결정): 홈 오른쪽 두 칸 = 평가손익 기여 TOP 막대 + 투자자산 최근 30일 추이(타일 지도·점 그림은 없앴다)
assert.doesNotMatch(cobaltSource, /수익률 TOP 5|손실률 TOP 5|cbContribSteps|cb-wf-|cbContribTiles|cbMoverScatterSvg|cbFillScatter|cb-scatter-host/, '예전 TOP5 두 카드·폭포형·타일 지도·점 그림은 없앴다')
assert.match(cobaltSource, /const cr=cbContribRank\(contributionEligible\);[\s\S]*평가손익 기여 TOP/, '기여 순위는 현금·시세 미조회를 뺀 같은 대상(contributionEligible)')
assert.match(cobaltSource, /const trend=cbInvestTrend\(window\._netWorthHistory, ownerF\);/, '30일 추이는 이미 쌓이는 일별 기록을 소유주 필터대로')
{
  const tCtx = { Math, Number, Array, Date, finLocalDateKey: d => d.toISOString().slice(0, 10), finSnapshotInvestment: e => e.portfolio ?? null, finSnapshotOwnerInvestment: (e, o) => e.portfolioByOwner?.[o] ?? null }
  vm.createContext(tCtx)
  vm.runInContext(['cbTreemapLayout', 'cbContribRank', 'cbInvestTrend'].map(n => extractFunction(cobaltSource, n)).join('\n'), tCtx)
  const items = [50, 30, 20, 10, 5, 3, 1].map((a, k) => ({ k, a }))
  const tiles = Array.from(tCtx.cbTreemapLayout(items, 0, 0, 300, 200))
  assert.equal(tiles.length, 7, '값마다 칸 하나(섹터 타일 지도)')
  const area = tiles.reduce((t, x) => t + x.w * x.h, 0)
  assert.ok(Math.abs(area - 60000) < 1e-6, '칸 넓이 합 = 영역 넓이(빈틈 없음)')
  assert.equal(tCtx.cbTreemapLayout([{ a: 0 }, { a: -3 }], 0, 0, 10, 10).length, 0, '0·음수 값은 칸을 만들지 않는다')
  const r = (title, gain) => ({ title, gain })
  const cr = tCtx.cbContribRank([r('A', 60), r('B', 20), r('C', 9), r('D', 8), r('E', 7), r('F', 6), r('L1', -15), r('L2', -5), r('L3', -4), r('L4', -1), r('Z', 0)])
  assert.deepEqual(Array.from(cr.gains, x => x.title), ['A', 'B', 'C', 'D', 'E', 'F'], '이익 상위 6')
  assert.deepEqual(Array.from(cr.losses, x => x.title), ['L1', 'L2', 'L3', 'L4'], '손실도 같은 수(최대 6, 큰 손실부터)')
  assert.equal(cr.more, 0, '나머지 개수(0 은 세지 않는다)')
  const cr3 = tCtx.cbContribRank([r('A', 60), r('B', 20), r('C', 9), r('L1', -15), r('L2', -5), r('L3', -4), r('L4', -1)], 2)
  assert.deepEqual([cr3.gains.length, cr3.losses.length, cr3.more], [2, 2, 3], '이익·손실 같은 수(사용자 결정)')
  assert.equal(cr.max, 60, '막대 기준 = 보이는 것 중 최대 |손익|')
  const today = new Date('2026-11-23T03:00:00Z')
  const hist = [{ date: '2026-10-01', portfolio: 1 }, { date: '2026-10-25', portfolio: 100, portfolioByOwner: { 본인: 60 } }, { date: '2026-11-22', portfolio: 103.6, portfolioByOwner: { 본인: 50 } }, { date: '2026-11-10', portfolio: 101 }]
  const t = tCtx.cbInvestTrend(hist, null, today)
  assert.deepEqual([t.first.date, t.last.date, t.pts.length], ['2026-10-25', '2026-11-22', 3], '30일 안의 기록만, 날짜순')
  assert.ok(Math.abs(t.change - 3.6) < 1e-9 && Math.abs(t.pct - 0.036) < 1e-9)
  assert.equal(tCtx.cbInvestTrend(hist, '본인', today).change, -10, '소유주별 기록')
  assert.equal(tCtx.cbInvestTrend([hist[2]], null, today), null, '기록이 하나면 그리지 않는다')
  // 홈 30일 그래프 hover: 마우스 x 에 가장 가까운 날을 고른다
  vm.runInContext(extractFunction(cobaltSource, 'cbTrendIdx'), tCtx)
  const hp = [{ x: 0 }, { x: 50 }, { x: 100 }]
  assert.deepEqual([tCtx.cbTrendIdx(hp, 0.1), tCtx.cbTrendIdx(hp, 0.3), tCtx.cbTrendIdx(hp, 0.9), tCtx.cbTrendIdx([], 0.5)], [0, 1, 2, -1], 'hover 는 가장 가까운 날')
}
assert.match(cobaltSource, /class="cb-trend-plot" onmousemove="cbTrendHover\(event\)" onmouseleave="cbTrendHover\(null\)"/, '홈 30일 그래프에 마우스를 올리면 날짜·금액 설명')
assert.match(cobaltSource, /function cbTrendHover[\s\S]*전날보다[\s\S]*cbDisp\(p\.v\)|function cbTrendHover[\s\S]*cbDisp\(p\.v\)[\s\S]*전날보다/, 'hover 상자: 날짜·금액·전날 대비·첫날 대비(금액 가리기 따르는 cbDisp)')
assert.match(styleSource, /\.cb-dash-insight-grid\{display:grid;grid-template-columns:minmax\(240px,1\.12fr\)[\s\S]*minmax\(205px,.74fr\)[\s\S]*minmax\(235px,.88fr\)/, '대시보드 자산 배분·섹터 위젯은 넓히고 TOP5 폭은 축소')
assert.match(cobaltSource, /if \(id==='divm'\) cbVerifyDividendDataOnOpen\(\)/, '배당 관리 페이지 진입 때마다 데이터 캐시 검증')
assert.match(scriptSource, /divCacheTickers_[\s\S]*tickers\.every\(t=>verified\.includes\(t\)\)/, '현재 보유 티커가 일일 배당 캐시에 모두 검증됐는지 확인')
assert.match(scriptSource, /const normDivTkr = t =>[\s\S]*\(KS\|KQ\|T\)/, '일본 상장 .T 배당 캐시 키도 화면 조회 규칙과 통일')
assert.match(scriptSource, /item\.qty \* epsVal \* \(RATES\[info\.cur\|\|item\.cur\]\|\|1\)/, 'USD뿐 아니라 JPY 배당도 해당 환율로 원화 환산')
assert.match(cobaltSource, /onclick="cbTaxMonthPick\(\$\{m\}\)"/, '양도소득세 월별 그래프 클릭을 하단 내역 필터에 연결')
assert.match(cobaltSource, /onmousemove="this\.style\.fill='var\(--accSoft\)'/, '양도소득세 그래프 호버 월 강조')
assert.match(cobaltSource, /cum\[m\]=\{fgn:cf, isa:ci, domProfit:cpDom, fgnProfit:cpFgn, profit:cp, tax\}/, '양도소득세 누적손익을 국내·해외·전체로 분리 집계')
assert.match(cobaltSource, /class="cb-tax-cum-step" d="\$\{step\}"/, '양도소득세 그래프의 선은 해외 누적 계단선 하나')
assert.doesNotMatch(cobaltSource, /cumulativeLine\(|label:'예상 세액'|전체 누적손익<\/span>/, '전체·국내 누적선과 예상 세액선은 그림에 그리지 않는다(설명 상자에만)')
assert.match(cobaltSource, /국내 누적손익', \(r\.cumDomProfit[\s\S]*누적 예상 세액', cbKrw\(r\.tax\)/, '그림에서 뺀 두 값은 마우스 설명 상자에 남긴다')
// 2026-11-23 사용자 결정: 한 칸 두 눈금 겹치기를 두 줄로 나눴다 — 위 ① 해외 누적 vs 공제, 아래 ② 월별 막대, 줄마다 눈금 하나.
assert.match(cobaltSource, /const YC=panel\(fgnProfitVals,DED\*1\.2,top1,bot1\);/, '위 줄은 해외 누적손익 눈금')
assert.match(cobaltSource, /const YB=panel\(vals,40000,top2,bot2\);/, '아래 줄은 월별 실현손익 눈금(양수 바닥 4만 원)')
assert.doesNotMatch(cobaltSource, /cb-tax-axis-right/, '오른쪽 두 번째 눈금은 없다')
assert.match(cobaltSource, /① 해외 누적 실현손익 vs 기본공제[\s\S]*② 월별 실현손익/, '두 줄이 무엇을 재는지 줄마다 제목으로 적는다')
assert.match(cobaltSource, /clip-path="url\(#\$\{clipId\}\)"/, '공제선을 넘은 구간만 면으로 칠한다')
assert.match(cobaltSource, /<div class="cb-tip-fit">[\s\S]*<div class="cb-tip-note">/, '설명 상자의 각주는 폭을 정하지 않는다')
assert.match(workspaceSource, /\.cb-tip-note\{width:0;min-width:100%/, '각주는 줄 폭 안에서 줄바꿈')
const taxAxisContext = {}
vm.createContext(taxAxisContext)
vm.runInContext(extractFunction(cobaltSource, 'cbTaxAxisLab'), taxAxisContext)
assert.equal(taxAxisContext.cbTaxAxisLab(2_500_000), '+250만', '양도소득세 Y축 양수에 + 기호 표시')
assert.equal(taxAxisContext.cbTaxAxisLab(-2_500_000), '−250만', '양도소득세 Y축 음수 기호 유지')
vm.runInContext(extractFunction(cobaltSource, 'cbAmtAxisLab'), taxAxisContext)
assert.equal(taxAxisContext.cbAmtAxisLab(360_000_000), '3.6억', '금액 축(투자자산 추이·배당·증여)은 양수에 + 를 붙이지 않음')
assert.equal(taxAxisContext.cbAmtAxisLab(600_000), '60만', '금액 축 만 단위에도 + 없음')
assert.equal(taxAxisContext.cbAmtAxisLab(0), '0', '금액 축 0')
assert.equal(taxAxisContext.cbAmtAxisLab(105_000_000, 5_000_000), '1억 500만', '500만 간격 눈금은 만 원까지 적어 겹치지 않음')
assert.equal(taxAxisContext.cbAmtAxisLab(110_000_000, 5_000_000), '1억 1,000만', '같은 축의 눈금은 같은 모양')
assert.equal(taxAxisContext.cbAmtAxisLab(115_000_000, 5_000_000), '1억 1,500만', '1.15억이 1.1억으로 반올림되지 않음')
assert.equal(taxAxisContext.cbAmtAxisLab(110_000_000, 10_000_000), '1.1억', '1,000만 간격이면 소수 한 자리 억')
assert.equal(taxAxisContext.cbAmtAxisLab(200_000_000, 5_000_000), '2억', '딱 떨어지는 억은 그대로')
assert.doesNotMatch(financeSource + extractFunction(cobaltSource, 'cbGiftChildChartSvg') + extractFunction(cobaltSource, 'cbGiftSpouseChartSvg') + extractFunction(cobaltSource, 'cbDivAxisLab') + simulatorSource, /cbTaxAxisLab/, '금액 그래프는 손익용 눈금 함수(cbTaxAxisLab)를 빌려 쓰지 않음')
assert.match(cobaltSource, /const lastV=cum\[maxM\]\.fgnProfit, lx=xR\(maxM\)[\s\S]*class="cb-tax-end-label"/, '마지막 등록 월 끝점에 누적 금액 표시')
assert.match(cobaltSource, /해외 기본공제 사용률[\s\S]*잔여 공제/, '양도소득세 상단에 기본공제 사용률 위젯 추가')
assert.match(cobaltSource, /미실현 손실 후보 합계[\s\S]*color:var\(--dn\)[\s\S]*손실 상계 후보 TOP 3[\s\S]*color:var\(--dn\)/, '절세 위젯의 손실 금액을 하락 색상으로 통일')
assert.match(styleSource, /\.cb-dividend-tip\{width:max-content;max-width:min\(760px,calc\(100vw - 24px\)\)\}/, '배당 월별 툴팁 폭은 종목명 길이를 따른다(고정 최소 폭 없음)')
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
assert.match(scriptSource, /const _BUBBLE_THEME_TONES = \{[\s\S]*light:[\s\S]*dark:/, '비중 차트의 동일 색 구성 규칙을 밝은 본문·다크별 톤으로 적용')
assert.doesNotMatch(scriptSource, /_BUBBLE_THEME_TONES\.navy|navy:\s*\{/, '네이비 테마 톤은 없앴다')
assert.match(scriptSource, /function _bubbleSectorColor\(sector\)[\s\S]*tone\.sectorSat,tone\.sectorLight/, '비중 차트 섹터 기준색은 공통 hue와 테마별 채도·명도로 생성')
assert.match(scriptSource, /function _bubbleLeafColor\(sector,key\)[\s\S]*const hue=base\+\(\(hash%13\)-6\)[\s\S]*tone\.leafSat[\s\S]*tone\.leafLight/, '모든 테마에서 섹터 hue를 유지하며 종목별 파스텔 명도만 변형')
assert.match(scriptSource, /const _BUBBLE_OWNER_SECTORS = \{[\s\S]*function _bubbleOwnerColor\(owner\)[\s\S]*_SECTOR_HUES\[sector\][\s\S]*tone\.sectorSat\+3,tone\.sectorLight-3/, '소유주 구분점도 섹터 팔레트와 같은 테마별 색 생성 규칙 사용')
assert.match(scriptSource, /function _bubbleOwnerFill\(owner,panelColor\)[\s\S]*colors\.push\(_bubbleOwnerFill\(owner,panelColor\)\)/, '전체 보기의 소유주 칸은 테마별 옅은 채움으로 구분')
assert.match(scriptSource, /const trace = \{\n\s*type: 'treemap',[\s\S]*tiling: \{ packing: 'squarify'[\s\S]*pathbar: \{ visible: true[\s\S]*textinfo: 'label\+percent root',[\s\S]*text: labels\.map\(\(label, i\) => customdata\[i\]\.kind === 'leaf' \? _bubbleWrapLabel\(label\) : label\),\n\s*texttemplate: customdata\.map\(d => \(d\.kind === 'leaf' && d\.weight < 2\) \? '<b>%\{text\}<\/b>' : '<b>%\{text\}<\/b><br>%\{percentRoot:\.1%\}'\)[\s\S]*size: 16,/, '비중 분석은 트리맵 — 경로 막대로 드릴다운 위치를 보여 주고 칸 안에 굵은 이름·비중을 16px 로 쓴다(작은 칸은 이름만)')
{
  const wrapContext = {}
  vm.createContext(wrapContext)
  vm.runInContext(extractFunction(scriptSource, '_bubbleWrapLabel'), wrapContext)
  assert.equal(wrapContext._bubbleWrapLabel('QQQ'), 'QQQ', '짧은 이름은 그대로')
  assert.equal(wrapContext._bubbleWrapLabel('TIGER 미국S&P500'), 'TIGER<br>미국S&P500', '긴 ETF 이름은 브랜드 뒤에서 줄바꿈')
  assert.equal(wrapContext._bubbleWrapLabel('KODEX 미국AI전력핵심인프라'), 'KODEX<br>미국AI전력핵심<br>인프라', '붙여 쓴 긴 이름은 8자씩 끊어 세 줄 안에 넣음')
  assert.ok(wrapContext._bubbleWrapLabel('가나다라마바사아자차카타파하가나다라마바사아자차카타파하가나다라').split('<br>').length <= 3, '줄 수는 최대 3줄')
}
assert.match(scriptSource, /labels\.push\(displayName\);/, '종목 칸에 이름을 직접 쓴다(바깥 리더라인 라벨 없음)')
assert.match(scriptSource, /uniformtext: \{ minsize: 13, mode: 'hide' \}/, '13px 로도 안 들어가는 칸은 글자를 숨기고 호버로 확인(minsize 가 전체 글자 크기의 바닥)')
assert.doesNotMatch(scriptSource, /_drawBubbleExternalLabels|_repositionBubbleCenter|bubble-center-summary|type: 'sunburst'/, '선버스트 전용 라벨·가운데 라벨 코드는 없앴다')
assert.match(cobaltSource, /배당 집중도[\s\S]*상위 3종목/, '배당 관리 상단에 배당원 집중도 위젯 추가')
assert.match(cobaltSource, /const top3Div = [\s\S]*상위 배당원 TOP 3[\s\S]*cb-div-top3-name[\s\S]*share\.toFixed\(1\)/, '배당 집중도 상위 3개 종목명과 각 배당 기여 비중을 별도 위젯에 표시')
assert.match(cobaltSource, /const label=\[ownerF\?'':x\.i\.owner, x\.title\|\|'종목명 미확인'\][\s\S]*cb-div-top3-metrics[\s\S]*cbDisp\(x\.incomeKRW\)[\s\S]*share\.toFixed\(1\)/, '전체 배당원 TOP3에는 소유주·종목명·금액·비중을 표시하고 티커는 제외')
assert.match(cobaltSource, /cb-div-summary-title[\s\S]*배당성장률[\s\S]*cb-div-history-status[\s\S]*산출 \$\{gList\.length\}\/\$\{list\.length\} · 원본 \$\{rawHistoryList\.length\}\/\$\{list\.length\}/, '배당성장률 산출 수와 원본 이력 확보 수를 분리해 표시')
assert.match(scriptSource, /const DIV_HIST_CACHE_VERSION = 3[\s\S]*const missingExpected = expectedDividendKeys\.filter[\s\S]*const missingRetryDue = missingExpected\.length>0 && age>=86400000[\s\S]*obj\.version===DIV_HIST_CACHE_VERSION[\s\S]*version:DIV_HIST_CACHE_VERSION/, '누락 이력은 하루 뒤 재검증하고 정상 이력 캐시는 버전·7일 기준으로 재사용')
assert.match(priceApiSource, /const symbols = krMatch[\s\S]*`\$\{krMatch\[1\]\}\.KS`,`\$\{krMatch\[1\]\}\.KQ`[\s\S]*for \(const sym of symbols\)/, '국내 배당 이력은 코스피 조회 실패 시 코스닥 심볼로 재조회')
assert.match(cobaltSource, /cbTaxChartSvg\(1120,420,list,year\)/, '양도소득세 차트는 화면 폭에 가까운 좌표계로 그려 글자가 12px 아래로 줄지 않는다')
assert.match(cobaltSource, /const padL=70, padR=24, gapMid=34;/, '양도소득세 차트 여백 — 두 줄 모두 왼쪽 눈금 하나라 오른쪽은 좁게')
const divGrowthContext = {
  window: {
    _divHistoryRawCache: {
      READY:{events:[
        {date:'2023-03-01',amount:1},
        {date:'2024-03-01',amount:1.1},
        {date:'2025-03-01',amount:1.21},
      ]},
      SHORT:{events:[
        {date:'2026-03-01',amount:1.1},
      ]},
    }
  }
}
vm.createContext(divGrowthContext)
for (const [source,name] of [
  [cobaltSource,'cbStrip'],
  [cobaltSource,'cbDivGrowthFromEvents'],
  [cobaltSource,'cbDivGrowthInfo'],
  [cobaltSource,'cbDivGrowthTip'],
]) vm.runInContext(extractFunction(source,name),divGrowthContext)
// 배당성장률 재점검(2026-11-24) — 실제 Yahoo 이력 모양으로 고정한다
{
  const G = (ev, d) => divGrowthContext.cbDivGrowthFromEvents(ev, new Date(d))
  const monthly = (from, to, amt) => { const out = []; let [y, m] = from.split('-').map(Number); for (;;) { const k = `${y}-${String(m).padStart(2, '0')}`; if (k > to) break; out.push({ date: k + '-28', amount: typeof amt === 'function' ? amt(y, m) : amt }); m++; if (m > 12) { m = 1; y++ } } return out }
  // 10월 상장 월배당(490590 모양): 2024 년 2회는 반쪽 해 — 시작점에서 빼고, 완결 연도가 1개뿐이라 12개월 비교
  let g = G(monthly('2024-11', '2026-10', (y) => y === 2026 ? 110 : 100), '2026-11-24')
  assert.equal(g.status, 'ready', '상장 2년 된 월배당은 최근 12개월 vs 직전 12개월로 산출')
  assert.equal(g.basis, 'ttm')
  assert.ok(Math.abs(g.value - ((110 * 10 + 100 * 2) / 1200 - 1) * 100) < 1e-9, '최근 12개월 1,300 vs 직전 12개월 1,200')
  // 반쪽 첫해를 그대로 쓰면 +500% 가 나온다 — 그러지 않는다
  g = G(monthly('2023-11', '2026-10', 100), '2026-11-24')
  assert.equal(g.status, 'ready'); assert.equal(g.basis, 'cagr')
  assert.equal(g.from, 2024, '2회뿐인 2023년은 시작점에서 뺀다'); assert.ok(Math.abs(g.value) < 1e-9, '매달 같은 금액이면 0%')
  // 연 1회(442580 모양) 2024·2025 → 0%
  g = G([{ date: '2024-04-29', amount: 200 }, { date: '2025-04-29', amount: 200 }, { date: '2026-04-29', amount: 100 }], '2026-11-24')
  assert.equal(g.status, 'ready'); assert.ok(Math.abs(g.value) < 1e-9)
  // 상장 1년 남짓 — 비교할 1년 전이 없다
  g = G([{ date: '2026-04-29', amount: 11 }, { date: '2026-07-30', amount: 26 }, { date: '2026-10-29', amount: 90 }], '2026-11-24')
  assert.equal(g.status, 'insufficient', '상장 2년 미만은 산출하지 않는다')
  assert.match(divGrowthContext.cbDivGrowthTip(g), /상장 2년 미만/)
  // 지급 0건은 '조회 실패'가 아니라 '이력 없음'
  assert.equal(G([], '2026-11-24').status, 'none')
  assert.match(divGrowthContext.cbDivGrowthTip({ status: 'ready', basis: 'cagr', from: 2020, to: 2025 }), /2020년 → 2025년/)
}
assert.equal(divGrowthContext.cbDivGrowthInfo({tkr:'READY'}).status,'ready','완결연도 2개 이상이면 배당성장률 산출')
assert.equal(divGrowthContext.cbDivGrowthInfo({tkr:'SHORT'}).status,'insufficient','원본 이력은 있으나 완결연도가 짧으면 이력 부족으로 구분')
assert.equal(divGrowthContext.cbDivGrowthInfo({tkr:'MISSING'}).status,'missing','원본 배당 이력 조회 실패를 별도 구분')
assert.match(cobaltSource, /소유주별 자산군 구성[\s\S]*cb-family-mix-track/, '가족 자산 내역 옆에 소유주별 자산군 구성 위젯 추가')
// 구성원 카드: 인라인 5열 그리드는 CSS 미디어쿼리로 덮을 수 없어 좁은 화면에서 금액이 잘렸다.
assert.match(cobaltSource, /<div class="cb-fam-card-grid">/, '구성원 카드 그리드를 클래스로 노출')
assert.doesNotMatch(cobaltSource, /style="display:grid;grid-template-columns:repeat\(\d,1fr\)/, '반응형이 필요한 다중 컬럼 그리드를 인라인 스타일로 두지 않는다')
assert.match(styleSource, /\.cb-fam-card-grid\{display:grid;grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/, '넓은 화면은 구성원 5장 한 줄')
assert.match(styleSource, /@media \(max-width: 1080px\)\{\s*\.cb-fam-card-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/, '중간 폭에서는 3열')
assert.match(styleSource, /@media \(max-width: 720px\)\{\s*\.cb-fam-card-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/, '좁은 화면에서는 2열로 내려 금액 잘림 방지')
// 대시보드 아코디언은 아래 표와 같은 병합 목록을 써야 종목 수가 어긋나지 않는다.
assert.match(cobaltSource, /items:mergedByVal\.filter\(r=>r\.cls===allocSel\.key\)/, '자산 배분 종목 창도 다계좌 병합 후 목록 사용')
assert.match(cobaltSource, /: sec \? \{[^\n]*items:mergedByVal\.filter/, '섹터 종목 창도 다계좌 병합 후 목록 사용')
// 홈 자산군·섹터 종목은 카드 안에서 펼치지 않고 창으로 띄운다 — 바깥 클릭(누른 채 끌고 나온 경우 제외)·Esc·닫기로 닫고, 화면을 옮기면 닫힌다.
assert.match(cobaltSource, /e\.target\.id==='cb-dash-pop';\},true\);\n\s*document\.addEventListener\('click',e=>\{if\(e\.target&&e\.target\.id==='cb-dash-pop'&&_cdashPopDown\)cbDashPopClose\(\)/, '바깥 클릭으로 닫기(끌고 나온 경우 제외)')
assert.match(cobaltSource, /role="dialog" aria-modal="true" aria-labelledby="cb-dash-pop-title"/)
assert.match(scriptSource, /if \(typeof cbDashPopClose === 'function'\) cbDashPopClose\(\);/, 'Esc 로 닫는다')
assert.match(extractFunction(cobaltSource, 'cbResetViewState'), /_cdashAllocOpen=null; _cdashSecOpen=null;/, '다른 화면으로 가면 창을 닫는다')
assert.doesNotMatch(cobaltSource, /cb-sector-open/, '카드 안 펼침 목록은 없앴다')
// 모바일에서 화면 밖으로 밀려 잘리던 레이아웃 — 인라인 폭 제약을 클래스로 빼 미디어쿼리가 닿게 한다.
assert.match(cobaltSource, /<div class="cb-panel cb-gift-panel[ "]/, '증여 패널의 min-width 를 CSS 로 이관')
assert.match(styleSource, /@media \(max-width:768px\)[\s\S]*\.cb-gift-panel\{min-width:0;flex-basis:100%\}/, '모바일에서 증여 패널을 한 줄에 하나씩 (금액 잘림 방지)')
assert.match(cobaltSource, /<div class="cb-lt-row">[\s\S]*class="cb-lt-name"[\s\S]*class="cb-lt-bar"/, '종목 집중도 행을 클래스로 노출')
assert.match(styleSource, /@media \(max-width: 720px\)\{[\s\S]*\.cb-lt-detail\{display:none\}/, '좁은 화면에서는 룩스루 직접/ETF 칸을 숨겨 잘림 방지')
assert.match(cobaltSource, /월 환산 매수 배분\$\{[\s\S]*dcaAlloc\.map[\s\S]*cb-dca-allocation-track/, 'DCA 내역 옆 월 환산 매수 배분 — 켜 둔 규칙 전부')
assert.doesNotMatch(cobaltSource, /월 환산 매수 배분 TOP 5|dcaTopAlloc/, '배분 목록을 5개로 자르지 않는다(2026-11-24)')
{
  const ctx = vm.createContext({})
  vm.runInContext(extractFunction(cobaltSource, 'cbDcaAllocLabel'), ctx)
  assert.equal(ctx.cbDcaAllocLabel({ cls: 'us', ticker: 'QQQM', title: 'Invesco NASDAQ 100' }), 'QQQM · Invesco NASDAQ 100', '미국은 티커 먼저')
  assert.equal(ctx.cbDcaAllocLabel({ cls: 'kr', ticker: '005930', title: '삼성전자' }), '삼성전자 · 005930', '한국은 이름 먼저')
  assert.equal(ctx.cbDcaAllocLabel({ cls: 'jp', ticker: '1629', title: 'NEXT FUNDS' }), 'NEXT FUNDS · 1629', '일본은 이름 먼저')
  assert.equal(ctx.cbDcaAllocLabel({ cls: 'crypto', ticker: 'BTC', title: 'BTC' }), 'BTC', '같으면 한 번만')
}
assert.match(cobaltSource, /배당 비중[\s\S]*x\.incomeKRW\/divAnnual\*100/, '배당 종목 내역에 종목별 배당 수입 비중 칼럼 추가')
assert.match(cobaltSource, /향후 90일 배당 일정[\s\S]*과거 지급 패턴/, '배당 내역 옆에 향후 90일 배당 일정 위젯 추가')
assert.match(styleSource, /@media \(min-width:1420px\)\{\s*\.cb-dca-detail-grid\{grid-template-columns:minmax\(0,1fr\) 280px\}[\s\S]*@media \(min-width:1600px\)\{\s*\.cb-family-detail-grid\{grid-template-columns:minmax\(0,1fr\) 280px\}/, '넓은 화면에서 가족 자산·DCA 표와 보조 위젯을 좌우 배치')
assert.match(styleSource, /@media \(min-width:1400px\)\{[^@]*\.cb-div-detail-grid\{grid-template-columns:minmax\(0,1fr\) 320px\}/, '배당 표(8칸)가 한 줄에 다 들어갈 때만 일정 위젯을 우측 배치')
assert.doesNotMatch(workspaceSource, /\.cb-div-detail-grid\{grid-template-columns:minmax\(0,1fr\) 270px\}/, '1180px 부터 일정 위젯을 오른쪽에 붙이던 규칙(표를 화면 밖으로 밀던 원인)을 두지 않음')
assert.match(workspaceSource, /@media\(max-width:1399px\)\{\s*\.cb-div-detail-grid>\.cb-div-upcoming-card\{order:-1\}/, '좁은 화면에서는 일정 카드를 표 위로')
// 좁은 폭(1280~1599px)에서 이름이 잘리던 세 곳: 홈 자산 배분 목록(금액을 이름 아래로), 배당 표·홈 보유 표(티커를 이름 아래로)
assert.match(workspaceSource, /@media\(min-width:769px\) and \(max-width:1439px\)\{\s*#cb-cdash \.cb-home-allocation-row\{grid-template-columns:9px minmax\(0,1fr\) 50px 11px;[\s\S]*?#cb-cdash \.cb-home-allocation-row>span:nth-child\(3\)\{grid-column:2;grid-row:2\}/, '홈 자산 배분: 1440px 미만에서는 금액을 이름 아래 줄로')
assert.match(workspaceSource, /@media\(max-width:1599px\)\{\s*\.cb-div-row \.cb-asset-inline\{flex-direction:column;/, '배당 표: 1600px 미만에서는 티커를 이름 아래로')
assert.match(workspaceSource, /@media\(max-width:1599px\)\{\s*\.home-asset\{display:inline-grid;[\s\S]*?\.home-asset>b,\.home-asset>small\{grid-column:2;/, '홈 보유 표: 1600px 미만에서는 티커를 이름 아래로')
{
  const divTable = cobaltSource.slice(cobaltSource.indexOf('<div class="cb-thead cb-div-head"'), cobaltSource.indexOf('<div class="cb-panel cb-div-upcoming-card">'))
  assert.doesNotMatch(divTable, /width:\d+px|flex:1|min-width:1110px/, '배당 표 칸 폭은 인라인 고정 폭이 아니라 격자 규칙이 정함')
  const template = workspaceSource.match(/\.cb-div-head,\.cb-div-row\{display:grid;grid-template-columns:([^;]+);/)
  assert.ok(template, '배당 표 격자 틀')
  const tracks = template[1].trim().split(/\s+(?![^(]*\))/)
  assert.equal(tracks.length, 8, '배당 표 8칸(소유주·국기·종목 + 숫자 5칸)')
  const cells = (divTable.match(/\n          <(?:span|div)[ >]/g) || []).length
  assert.equal(cells, 8, '행의 칸 수와 격자 칸 수가 같음(펼친 줄은 한 줄 전체)')
}
assert.match(cobaltSource, /cb-family-table-toolbar[\s\S]*전체 투자자산[\s\S]*cb-family-head/, '가족 투자자산 표 제목·검색줄과 칼럼 헤더에 연속 고정 클래스 적용')
assert.match(cobaltSource, /cb-div-table-toolbar[\s\S]*배당 종목 내역[\s\S]*cb-div-head/, '배당 내역 제목과 칼럼 헤더에 연속 고정 클래스 적용')
assert.match(styleSource, /\.cb-family-table-toolbar,\.cb-div-table-toolbar\{position:sticky;top:0[\s\S]*\.cb-family-table-panel \.cb-family-head,[\s\S]*top:43px/, '표 제목줄 아래 칼럼 헤더가 겹치지 않게 고정')
assert.match(styleSource, /\.cb-family-mix-card\{position:sticky;top:0;align-self:start\}[\s\S]*\.cb-div-upcoming-card\{position:sticky;top:0;align-self:start\}/, '가족 자산·배당 우측 보조 위젯을 스크롤 중 고정(sticky 는 늘어나면 동작하지 않으므로 위쪽 정렬)')
assert.match(styleSource, /\.cb-family-detail-grid,\.cb-dca-detail-grid,\.cb-div-detail-grid\{[^}]*align-items:stretch\}/, '표와 보조 위젯 2열은 바닥선을 맞춘다')
const upcomingContext = { cbStrip: ticker => String(ticker || '').toUpperCase() }
vm.createContext(upcomingContext)
vm.runInContext(extractFunction(scriptSource, '_defaultMonthsForCycle'), upcomingContext)
vm.runInContext(extractFunction(cobaltSource, 'cbDefaultDivMonths'), upcomingContext)
vm.runInContext(extractFunction(cobaltSource, 'cbUpcomingDividendSchedule'), upcomingContext)
const upcoming = upcomingContext.cbUpcomingDividendSchedule([
  { i:{owner:'본인'}, tkr:'SCHD', title:'Schwab Dividend ETF', incomeKRW:120_000, d:{months:[7,8],payDay:null} },
  { i:{owner:'아내'}, tkr:'O', title:'Realty Income', incomeKRW:240_000, d:{months:[8],payDay:5} },
], 90, '2026-07-30T00:00:00')
assert.equal(upcoming[0].dateLabel, '8월 예정', '지급일 미확인 종목은 월 단위 일정으로 표시')
assert.equal(upcoming.find(x => x.ticker === 'O').dateLabel, '9월 5일경', '과거 지급 패턴은 확정일로 표시하지 않음')
assert.equal(upcoming.find(x => x.ticker === 'SCHD').amount, 60_000, '연간 예상 배당을 지급 월수로 나눠 회차 금액 산출')
// 지급월이 응답에 없으면 주기 기반 폴백을 써야 한다 — 월별 막대(cbDivMonthlyForYear)와
// 같은 cbDefaultDivMonths 를 통과하지 않으면 같은 화면에서 두 위젯이 다른 일정을 그린다.
const upcomingAnnual = upcomingContext.cbUpcomingDividendSchedule([
  { i:{owner:'본인'}, tkr:'YEARLY', title:'연배당주', incomeKRW:120_000, d:{cycle:'연간',months:[],payDay:null} },
], 200, '2026-10-01T00:00:00')
assert.equal(upcomingAnnual.length, 1, '연 1회 배당은 예정 일정에도 1건만 잡힌다')
assert.equal(upcomingAnnual[0].dateLabel, '12월 예정', '연간 주기의 기본 지급월은 12월')
assert.equal(upcomingAnnual[0].amount, 120_000, '연 1회 지급은 회차 금액을 분기로 쪼개지 않는다')
assert.match(cobaltSource, /세액 참고 합계[\s\S]*일반 · 해외주식[\s\S]*해외 기본공제 사용률[\s\S]*일반 · 국내주식[\s\S]*ISA 계좌[\s\S]*연금저축 계좌/, '양도소득세 상단 위젯을 참고합계·해외·공제·국내·ISA·연금 순으로 배치')
assert.match(cobaltSource, /id="cb-tax-pl"[\s\S]*inputmode="numeric"[\s\S]*data-no-comma="1"[\s\S]*oninput="handlePLAmtInput\(this\)"/, '양도소득세 수정 금액 입력에도 음수 허용 실시간 쉼표 포맷 적용')
assert.match(styleSource, /\.cb-tax-deduction-value\{[\s\S]*margin-top:12px\}[\s\S]*\.cb-tax-deduction-track\{[^}]*margin-top:5px\}/, '해외 기본공제 사용률 막대를 퍼센티지 바로 아래에 배치')
assert.match(styleSource, /\.cb-tax-deduction-remain\{margin-top:auto/, '해외 기본공제 잔여액을 카드 하단에 배치')
assert.match(cobaltSource, /cb-tax-hist-head">\s*<span>월<\/span><span>소유주<\/span><span>시장<\/span><span>계좌<\/span><span><span[^>]*>세제 구분<\/span><\/span><span class="cb-tax-memo-head">메모<\/span>/, '양도소득세 세제 구분을 계좌와 메모 사이에 배치')
assert.match(workspaceSource, /\.cb-tax-hist-head,\.cb-tax-hist-row,\.cb-tax-month-sum\{display:grid;grid-template-columns:[^;]*minmax\(160px,2\.6fr\)[^;]*;column-gap:12px/, '실현손익 기록 표는 격자 — 메모 칸만 남는 폭을 독차지하지 않는다')
assert.doesNotMatch(cobaltSource, /cb-tax-memo-(head|cell)" style="flex:1/, '메모 칸에 flex:1 을 다시 쓰지 않는다')
assert.match(cobaltSource, /cbHomeSummary\(sel,nw\)/, '홈 보유 목록 옆 선택 종목 요약 유지')
assert.match(styleSource, /\.cb-dash-table-toolbar\{position:sticky;top:0/, '대시보드 제목·검색줄을 스크롤 중 고정')
assert.match(workspaceSource, /\.home-stock-summary\{position:sticky;top:12px/, '홈 우측 선택 종목 요약을 스크롤 중 고정')
assert.match(styleSource, /#cb-perf2\{display:flex;flex-direction:column;padding-bottom:12px\}[\s\S]*\.cb-perf-detail-panel\{display:flex;flex:1 0 270px/, '성과 비교 하단 위젯이 남은 세로 공간을 채움')
assert.match(cobaltSource, /class="cb-perf-value\$\{CB_PERF_TFS\[k\]===tf\?' is-active':''\}"/, '성과 표 선택 음영을 셀 전체가 아닌 텍스트 크기에 맞춤')
assert.doesNotMatch(cobaltSource, /cb-dash-sector-note|섹터 분산이 양호합니다'/, '홈 섹터 타일 아래 진단 문구는 없앴다(2026-11-18 3차, 사용자 결정)')
assert.match(scriptSource, /function _recordViewHistory\(id\)[\s\S]*history\.pushState/, '페이지 전환을 브라우저 뒤로·앞으로 가기 기록에 연결')
assert.match(scriptSource, /costUnknown[\s\S]*initialCurP/, '취득가 미상 금을 별도 상태로 저장하면서 현재 평가가는 유지')
assert.match(styleSource, /touch-action:pan-x pan-y/, '모바일 표 내부의 좌우 터치 스크롤 허용')
// 점은 비중과 무관하게 모든 소유주 라벨에 붙는다 — 10% 미만(자녀1·아버지)만 점이 빠져 범례가 어긋났다.
assert.doesNotMatch(scriptSource, /showOwnerDot/, '소유주 점을 비중으로 숨기는 조건을 두지 않는다')
assert.match(styleSource, /\.cb-risk-overview\{[^}]*grid-template-columns:minmax\(300px,320px\) minmax\(0,1fr\)/, '리스크 점수 카드를 넓히고 우측 진단 카드에 남은 폭 배분')
// 선택 달 요약(#cf-month-summary)은 더 이상 독립 패널이 아니라 우측 차트 열의 첫
// 카드(수입/지출 구성) 하단에 붙는다 — 총수입/지출/순현금흐름이 두 위젯에 중복
// 표시되던 것을 없앴고, 차트 열이 그 행까지 통째로 차지해 세로 폭이 커진다.
assert.match(indexSource, /id="cf-input-panel" class="glass-panel cf-entry-panel"[\s\S]*id="cf-couple-flow" class="glass-panel cf-flow-panel"[\s\S]*class="glass-panel cf-detail-panel"[\s\S]*class="f-col cf-chart-column"[\s\S]*id="cf-comp-list"[\s\S]*id="cf-month-summary" class="cf-chart-summary"/, '입력부 옆에는 내역·차트 열만 두고, 선택 달 요약은 차트 카드 하단에 통합')
assert.doesNotMatch(indexSource, /id="cf-tot-in"|id="cf-tot-out"|id="cf-tot-net"/, '차트 카드의 총수입·총지출·순현금흐름 중복 표시를 없앤다 — cfMonthSummaryHtml 이 유일한 출처')
assert.match(styleSource, /\.cf-grid \{[\s\S]*grid-template-columns: minmax\(0,1fr\) minmax\(460px,\.72fr\)[\s\S]*\.cf-entry-panel\{grid-column:1;grid-row:1[\s\S]*\.cf-detail-panel\{grid-column:1;grid-row:3[\s\S]*\.cf-chart-column\{grid-column:2;grid-row:1\/4[\s\S]*\.cf-flow-panel\{grid-column:1;grid-row:2/, '차트 열이 입력부·부부 흐름·내역 세 행 높이를 모두 차지한다')
assert.match(styleSource, /#cf-input-panel \.cf-entry-form\{flex-wrap:wrap!important;overflow-x:visible!important\}/, '좁아진 입력 줄은 가로 스크롤 대신 접힌다')
// 저축률은 순현금흐름과 다른 숫자다 — '저축/투자' 지출은 자산 이동이라 소비에서 되돌린다.
// (finMonthlyFixedCost·finNetWorthBridge 가 같은 이유로 제외하는 그 카테고리다)
{
  const summaryContext = {
    cfYear: 2026, cfMonth: 9, _cfOwner: '전체',
    FIN_SAVING_CATS: ['저축/투자'],
    finMonthlyFixedCost: () => ({ monthly: 0, pendingCount: 2, pendingMonthly: 330000 }),
    document: { getElementById: () => null },
  }
  summaryContext._cfEsc = v => String(v == null ? '' : v)
  vm.createContext(summaryContext)
  vm.runInContext(extractFunction(scriptSource, 'cfScopeLabel'), summaryContext)
  vm.runInContext(extractFunction(scriptSource, 'cfMonthSummaryHtml'), summaryContext)
  const html = summaryContext.cfMonthSummaryHtml(5_000_000, 3_000_000, { 식비: 1_000_000, '저축/투자': 2_000_000 })
  assert.match(html, /순현금흐름[\s\S]*?\+₩2,000,000/, '순현금흐름은 통장에 남은 돈')
  assert.match(html, /저축률[\s\S]*?80\.0%/, "저축률은 '저축/투자' 400만을 소비에서 되돌려 계산")
  assert.match(html, /자동이체 2건<\/b>이 고정비로 분류되지 않았습니다/, '미분류 자동이체를 그 자리에서 안내')
  assert.match(html, /2026년 9월 요약/, '선택한 달을 제목에 표시')
  assert.match(html, /부부 합계/, "'전체' 탭은 부부 합계로 표시")
  const noIncome = summaryContext.cfMonthSummaryHtml(0, 120000, { 식비: 120000 })
  assert.match(noIncome, /저축률[\s\S]*?—/, '수입이 없으면 저축률을 내지 않는다')
}
assert.match(financeSource, /fin-data-card-main[\s\S]*fin-data-card-meta[\s\S]*fin-data-support-grid/, '데이터 상태 카드와 안내 패널을 컴팩트 가로형으로 구성')
assert.match(scriptSource, /표시할 자산이 없습니다\./, '비중 차트 빈 상태도 테마 글꼴과 한글 문구 사용')
assert.match(indexSource, /toggleAmountPrivacy\(\)[\s\S]*id="sidebar-privacy-btn"[\s\S]*금액 가리기/, '좌하단에 전역 금액 가리기 버튼 추가')
assert.match(scriptSource, /AMOUNT_PRIVACY_KEY[\s\S]*MutationObserver[\s\S]*_syncAmountPrivacyCharts[\s\S]*localStorage\.setItem/, '금액 가리기 상태를 저장하고 동적 화면·차트에도 지속 적용')
assert.match(styleSource, /body\.amount-privacy canvas,[\s\S]*body\.amount-privacy \.js-plotly-plot\{pointer-events:none!important\}/, '금액 가리기 중 차트 툴팁으로 금액이 노출되지 않게 차단')
const privacyContext = {}
vm.createContext(privacyContext)
vm.runInContext(extractFunction(scriptSource, '_maskAmountText'), privacyContext)
assert.equal(privacyContext._maskAmountText('평가액 +₩12,345,678원'), '평가액 +₩••••', '원화 금액 마스킹')
assert.equal(privacyContext._maskAmountText('배당 $123.45 · 환산 ¥9,876'), '배당 $•••• · 환산 ¥••••', '외화 금액 마스킹')
// 2026-11-18 4차: 만·억 단위 줄임 금액(타일·그래프 눈금)도 가린다, 만기 같은 낱말은 그대로
assert.equal(privacyContext._maskAmountText('+1,755만'), '+••••만', '기여도 타일 줄임 금액')
assert.equal(privacyContext._maskAmountText('2,000만'), '••••만', '점 그림 세로 눈금')
assert.equal(privacyContext._maskAmountText('−500만'), '−••••만')
assert.equal(privacyContext._maskAmountText('3.6억'), '••••억', '증여 그래프 눈금')
assert.equal(privacyContext._maskAmountText('ISA 3년 만기 · 12개월'), 'ISA 3년 만기 · 12개월', '만기 같은 낱말은 금액이 아니다')
assert.equal(privacyContext._maskAmountText('+50%'), '+50%', '비율은 그대로')

const taxTreatmentContext = { CB_TAX_ACCTS:['일반','연금저축','ISA'], OWNERS:['본인','아내','자녀1','아버지'], _taxRuleValue:(_path,fallback)=>fallback }
vm.createContext(taxTreatmentContext)
for (const name of ['cbTaxAcctOf','cbTaxTreatment','cbSortTaxEntries','cbTaxCumulativeByEntry']) {
  vm.runInContext(extractFunction(cobaltSource, name), taxTreatmentContext)
}
assert.equal(taxTreatmentContext.cbTaxTreatment({account:'일반',category:'domestic'}).label, '비과세', '국내 일반계좌 세제 구분')
assert.equal(taxTreatmentContext.cbTaxTreatment({account:'일반',category:'foreign'}).label, '22% 대상', '해외 일반계좌 세제 구분')
assert.equal(taxTreatmentContext.cbTaxTreatment({account:'ISA',category:'domestic'}).label, '9.9% 참고', 'ISA 세제 구분은 연간 참고임을 표시')
assert.equal(taxTreatmentContext.cbTaxTreatment({account:'연금저축',category:'domestic'}).label, '과세이연', '연금저축 세제 구분')
assert.match(cobaltSource, /계좌<\/span><span><span[^>]*>세제 구분[\s\S]*cb-tax-treatment is-\$\{treatment\.tone\}[\s\S]*t\.memo/, '양도소득세 계좌 다음에 세제 구분, 메모 순으로 배치')
assert.match(cobaltSource, /cb-tax-memo-head[\s\S]*cb-tax-memo-cell/, '양도소득세 메모 칼럼에 별도 여백 클래스 적용')
assert.match(styleSource, /\.cb-tax-treatment\{[^}]*border:0!important[^}]*background:transparent!important/, '세제 구분은 아웃라인 없는 텍스트로 표시')
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
vm.runInContext(fs.readFileSync(new URL('../../finance.js', import.meta.url), 'utf8').match(/function finLocalDateKey\([\s\S]*?\n\}/)[0], dcaScheduleContext)
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
assert.match(styleSource, /\.cb-dca-summary-grid\{display:grid;grid-template-columns:minmax\(0,\.7fr\) repeat\(3,minmax\(0,1fr\)\) minmax\(0,1\.25fr\)/, 'DCA 상단 다섯 요약 위젯을 균등 배치')

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
  cbLookThrough:()=>({list:[{via:50}],etfCount:1,loaded:true,etfMiss:[]}),
  // ETF 간 중복도는 실제 구현을 넣어 돌린다 — 이 픽스처에는 ETF 가 없으므로 0% 가 나온다.
  cbEtfDoc:()=>({etfs:{}}),
  etfStockRows:entry=>(entry&&Array.isArray(entry.holdings)?entry.holdings:[]),
  etfQuality:()=>({reliable:true}),
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
// cbRiskInsights 가 부르는 함수는 함께 넣는다 — 하나라도 빠지면 ReferenceError 로 죽는다.
;['cbIsEtf','cbSyntheticEtfHoldings','cbEtfCrossOverlap','cbSectorName']
  .forEach(name=>vm.runInContext(extractFunction(cobaltSource, name), riskInsightContext))
// 섹터 표시 이름은 script.js 의 실제 대응표를 넣어 확인한다(키는 영어, 화면 글자만 한글).
const sectorKoBlock = scriptSource.match(/const SECTOR_KO = \{[\s\S]*?\n\};/)
assert.ok(sectorKoBlock, 'SECTOR_KO 대응표를 찾을 수 없음')
vm.runInContext(sectorKoBlock[0], riskInsightContext)
vm.runInContext(extractFunction(scriptSource, 'sectorKo'), riskInsightContext)
;['CB_SINGLE_STOCK_LEV_ISSUER','CB_NOT_SINGLE_STOCK'].forEach(name=>{
  const start = cobaltSource.indexOf(`const ${name}`)
  assert.notEqual(start, -1, `${name} 상수를 찾을 수 없음`)
  vm.runInContext(cobaltSource.slice(start, cobaltSource.indexOf('\n', cobaltSource.indexOf(';', start))), riskInsightContext)
})
vm.runInContext(extractFunction(cobaltSource, 'cbRiskInsights'), riskInsightContext)

// 필수지출 단일 소스: 미분류(식비 900)와 저축/투자(500)는 빠지고 고정비 100만 남는다
const safetyProbe = riskInsightContext.finCashSafety('본인')
assert.equal(safetyProbe.fixed, 100, '고정비로 분류된 지출만 필수지출에 합산')
assert.equal(safetyProbe.pendingCount, 1, '미분류 자동이체는 합산하지 않고 건수만 보고')
assert.equal(safetyProbe.committed, 200, '월 약정액 = 필수지출 + DCA')
const riskInsights = riskInsightContext.cbRiskInsights('본인',{fxPct:40})
const riskInsightById = Object.fromEntries(Array.from(riskInsights, card=>[card.id,card]))
assert.equal(riskInsights.length, 8, '리스크 보조 진단 위젯 8개 (현금 유동성 커버리지는 투자 계획 > 목표로 이동)')
// 카드가 늘어도 그리드가 조용히 버리지 않아야 한다 — 예전에는 4행 고정이라 9번째가 안 보였다.
assert.match(cobaltSource, /const gridRows=Math\.max\(/, '리스크 카드 행 수는 카드 개수를 따른다')
assert.ok(riskInsights.some(c=>c.id==='etf-cross-overlap'), 'ETF 간 중복도 위젯 존재')
assert.equal(riskInsightById['etf-overlap'].value, '5.0%', 'ETF 직접·간접 중복 노출 계산')
for (const coverage of [
  {list:[],etfCount:1,loaded:false,etfMiss:['VOO']},
  {list:[{via:50}],etfCount:2,loaded:true,etfMiss:['VOO']},
]) {
  riskInsightContext.cbLookThrough=()=>coverage
  const overlap=riskInsightContext.cbRiskInsights('본인',{}).find(c=>c.id==='etf-overlap')
  assert.equal(overlap.value,'—','미조회·부분 조회는 0% 또는 전체 비율로 단정하지 않는다')
  assert.notEqual(overlap.tone,'var(--up)','조회 실패를 안전한 상태로 표시하지 않는다')
}
assert.equal(riskInsightById['effective-holdings'].value, '2.9개', 'HHI 역수 기준 실효 종목 수 계산')
assert.equal(riskInsightById['fx-shock'].value, '−4.0%', '환율 10% 하락 민감도 계산')
assert.equal(riskInsightById['country-concentration'].value, '미국 40.0%', '최대 국가 집중도 계산')
assert.equal(riskInsightById['top2-sectors'].value, '70.0%', '상위 두 섹터 집중도 계산')
assert.match(JSON.stringify(riskInsightById['top2-sectors']), /기술 \+ 지수 ETF/, '리스크 카드의 섹터 이름은 한글로 표시')
assert.doesNotMatch(JSON.stringify(riskInsightById['top2-sectors']), /Technology|Index ETF/, '리스크 카드에 영어 섹터 키가 그대로 나오지 않음')
assert.equal(riskInsightContext.sectorKo('Financial Services'), '금융', '섹터 표시 이름 한글 대응')
assert.equal(riskInsightContext.sectorKo('처음 보는 키'), '처음 보는 키', '대응표에 없는 키는 그대로 돌려줌(빈칸으로 만들지 않음)')
for (const key of ['Technology','Financial Services','Health Care','Consumer Discretionary','Consumer Staples','Energy','Communications Services','Industrial Services','Materials & Processing','Real Estate','Utilities','Index ETF','Sector ETF','Other','Cash','Crypto','Gold']) {
  assert.notEqual(riskInsightContext.sectorKo(key), key, `섹터 키 ${key} 에 한글 이름이 있음`)
}
assert.match(scriptSource, /labels\.push\(sectorKo\(sector\)\)/, '트리맵 섹터 칸 이름은 한글')
assert.match(scriptSource, /data-bubble-sector="\$\{safeSec\}"[\s\S]{0,3000}\$\{_cfEsc\(sectorKo\(sec\)\)\}/, '섹터 목록은 글자만 한글이고 클릭 키(data-bubble-sector)는 영어 키 그대로')
assert.match(cobaltSource, /name=cbSectorName\(t\.x0\.label\)/, '홈 섹터 집중도 칸 이름은 한글')
assert.match(cobaltSource, /_cdashSecOpen===t\.x0\.label/, '홈 섹터 펼침 비교는 영어 키 그대로')
assert.equal(riskInsightById['dividend-dependency'].value, '100.0%', '배당원 TOP3 의존도 계산')
assert.ok(!('liquidity-coverage' in riskInsightById), '현금 유동성 커버리지 카드는 리스크 진단에 없다')
assert.equal(riskInsightById['recovery-return'].value, '14.3%', '평가손실 원금 회복 필요 수익률 계산')
assert.doesNotMatch(cobaltSource, /cbHomeTrend\(ownerF\)|cbHomeTotals\(ownerF\)/, '홈의 중복 요약과 추이 제거')
assert.match(cobaltSource, /const riskGridCards=Array\.from\(\{length:gridRows\}[\s\S]*r\.cards\.slice\(row\*2,row\*2\+2\)[\s\S]*insights\.slice\(row\*2,row\*2\+2\)[\s\S]*class="cb-risk-list" role="list"/, '규칙 카드와 보조 진단을 같은 흐름으로 섞어 한 줄 목록에 그린다(2026-11-24)')
assert.match(cobaltSource, /\.sort\(\(a,b\)=>a\.verdict\.rank-b\.verdict\.rank\|\|a\.idx-b\.idx\)/, '경고·주의 카드가 먼저, 같은 단계는 원래 순서')
assert.match(cobaltSource, /<span class="cb-risk-verdict is-\$\{v\.key\}">\$\{v\.label\}<\/span>/, '목록의 줄마다 판정 한 단어')
assert.doesNotMatch(styleSource+workspaceSource, /cb-risk-card-grid|cb-risk-primary-card|cb-risk-insight-card/, '예전 리스크 카드 격자 CSS 는 없앴다(2026-11-24 한 줄 목록)')
assert.match(styleSource, /\.cb-div-tip-owner\{[^}]*var\(--tiptx\)/, '라이트 테마의 어두운 배당 툴팁에서도 소유주명이 밝게 표시')
assert.match(styleSource, /\.cb-thead\{[^}]*background:var\(--panelSolid\)[\s\S]*\.cb-family-table-panel \.cb-family-head,[\s\S]*\.cb-div-history-panel \.cb-div-head\{[\s\S]*box-shadow:0 -12px 0 12px var\(--panelSolid\)/, '대시보드·가족 자산·배당 관리 고정 헤더는 불투명 배경으로 행 내용 비침 방지')

// ── PC 입력란 폭 상한 · 페이지 컴팩트화 ───────────────────────────
assert.match(styleSource, /\.fin-form-grid\{[^}]*minmax\(148px,192px\)[^}]*align-items:end/, '목표·재무 입력란 폭 상한과 하단 정렬')
assert.match(styleSource, /\.cf-fixed-form\{[^}]*minmax\(160px,300px\)[^}]*justify-content:start\}/, '고정비 항목 입력란이 남은 폭을 전부 흡수하지 않게 상한')
assert.match(styleSource, /#cf-input-panel \.form-row\{max-width:1020px\}/, '현금 흐름 수입·지출 입력 줄 폭 상한')
// 실현손익 기록 줄: 라벨을 입력 왼쪽에 두고 한 줄로. 실현손익은 고정 폭, 메모만 남는 폭을 쓴다.
assert.match(workspaceSource, /\.cb-tax-entry-form\{display:flex;flex-wrap:wrap;align-items:center/, '실현손익 기록 입력을 한 줄 flex 로 배치')
assert.match(workspaceSource, /\.cb-tax-entry-form>label\{display:flex;flex-direction:row;align-items:center/, '라벨을 드롭다운 왼쪽에 둔다')
assert.match(workspaceSource, /\.cb-tax-entry-form #cb-tax-pl\{width:120px\}/, '실현손익 입력란 고정 폭')
assert.match(workspaceSource, /\.cb-tax-entry-form>label\.cb-tax-memo-field\{flex:1 1 140px;max-width:340px\}/, '메모 입력은 남는 폭만 쓰고 상한을 둔다')
assert.match(cobaltSource, /<label class="cb-tax-memo-field"><span class="sr-only">메모<\/span><input id="cb-tax-memo" class="cb-input" value="[^"]*" placeholder="메모" \/><\/label>/, '메모 폭은 인라인이 아니라 CSS 클래스로 준다')
assert.doesNotMatch(workspaceSource, /cb-tax-entry-form\{grid-template-columns:65px/, '고정 그리드 템플릿은 flex 로 대체했다')
assert.match(styleSource, /\.cb-gift-field\{max-width:216px\}/, '증여 페이지 입력 라벨 폭 상한')
assert.match(styleSource, /@media \(max-width: 768px\) \{[\s\S]*\.cb-gift-field\{max-width:none\}/, '모바일에서는 증여 입력 라벨 폭 상한 해제')
assert.match(cobaltSource, /const field = \(label, input\) => `<label class="cb-gift-field"/, '증여 입력 라벨이 폭 상한 클래스를 단다')
assert.match(styleSource, /\.cb-scroll\{[^}]*padding:0 6px 24px 0\}/, '본문 하단 데드 스페이스 축소')
assert.match(styleSource, /\.fin-section\{padding:13px 16px;margin-top:9px/, '재무 카드 내부·바깥 여백 압축')
assert.match(financeSource, /<div class="fin-target-inputs">[\s\S]*label class="threshold"[\s\S]*finSaveTarget\(\)">목표 저장<\/button><\/div><div class="fin-rebal-comparison"><div class="fin-rebal-main">\$\{finRebalBulletHtml\(ta\)\}<div class="fin-rebal-table"[\s\S]*finPortfolioReferences/, '자산군·허용 편차·목표 저장을 카드 전체 폭 한 줄에 두고, 그 아래 좌측에 조정표를 배치')
assert.doesNotMatch(financeSource, /fin-target-actions/, '별도 저장 줄은 없앴다 — 한 줄이 통째로 여백이었다')
assert.doesNotMatch(workspaceSource, /\.fin-target-actions/, '도달 불가 CSS 도 함께 제거한다')
assert.match(workspaceSource, /\.fin-target-inputs\{display:flex;flex-wrap:wrap;/, '자산군 6개 + 허용 편차 + 목표 저장을 한 줄(좁으면 줄바꿈)로 배치')
assert.match(workspaceSource, /\.fin-target-inputs>label\{display:flex;align-items:center;/, '자산군 이름과 입력란을 나란히 둔다')
assert.match(workspaceSource, /\.fin-target-inputs>label>span\{[^}]*white-space:nowrap\}/, '자산군 이름은 말줄임 없이 온전히 보인다')
assert.doesNotMatch(workspaceSource, /\.fin-target-inputs>label>span\{[^}]*text-overflow:ellipsis/, "'가상화'·'미국 주'처럼 잘리던 말줄임을 되살리지 않는다")
assert.match(workspaceSource, /@media\(max-width:768px\)\{[^@]*\.fin-target-inputs\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/, '모바일에서는 2열 유지')
assert.match(workspaceSource, /\.fin-rebal-table>div>span:not\(:first-child\)\{text-align:right\}/, '리밸런싱 표의 숫자 칼럼(현재·목표·편차·조정액·DCA)을 우측 정렬한다')
assert.match(financeSource, /비교용 예시이며 맞춤 추천이 아닙니다\.<br>왼쪽은 상장시장별/, "'아닙니다.' 뒤에서 줄바꿈해 대표 자산 배분 비교 문장을 두 줄로 나눈다")
// 고정비 등록 줄의 세로 정렬 — 세 값은 항상 같아야 한다
{
  const h = [...styleSource.matchAll(/(?:\.btn-submit\{[^}]*|\.cf-fixed-form \.form-input\{[^}]*|\.cf-fixed-check\{[^}]*)height:(\d+)px/g)].map(m => m[1])
  assert.strictEqual(h.length, 3, '높이를 고정하는 세 규칙이 모두 존재')
  assert.strictEqual(new Set(h).size, 1, `고정비 등록 줄 컨트롤 높이 불일치: ${h.join('/')}`)
}

console.log('PASS 후속 UI·INDEX ETF·현금 흐름·배당 상세')

const lateMonth=upcomingContext.cbUpcomingDividendSchedule([{tkr:"TEST",incomeKRW:120,d:{months:[8],payDay:null}}],90,"2026-09-20T00:00:00");
assert.equal(lateMonth.length,1,"15일이 지나도 날짜 미정 월 배당은 사라지지 않는다");
assert.equal(lateMonth[0].exact,false,"추정 일정은 확정일이 아니다");
assert.equal(lateMonth[0].boundary,true,"90일 경계 월의 불확실성을 보존한다");

// 공시된 지급일이 있으면 '경' 없이 확정으로(2026-11-24)
{
  const ctx = upcomingContext
  ctx.divPayDateFor = (d, y, m0) => (y === 2026 && m0 === 11 ? { date: new Date(2026, 11, 15), exact: true } : { date: new Date(y, m0, d.payDay), exact: false })
  const ev = ctx.cbUpcomingDividendSchedule([{ tkr: 'O', incomeKRW: 1200, d: { months: [10, 11], payDay: 14 } }], 60, '2026-11-01T00:00:00')
  assert.equal(ev.find(x => x.date.getMonth() === 11).dateLabel, '12월 15일'); assert.equal(ev.find(x => x.date.getMonth() === 11).exact, true)
  assert.equal(ev.find(x => x.date.getMonth() === 10).dateLabel, '11월 14일경', '공시가 없는 달은 추정 표시')
  delete ctx.divPayDateFor
}
// 2026-11-11 배당 상단 카드 — 보조 문구는 제목 줄 오른쪽, 연간 카드에는 세전/세후·소유주 표시가 없다
{
  const grid = cobaltSource.slice(cobaltSource.indexOf('<div class="cb-div-summary-grid">'), cobaltSource.indexOf('cb-div-top3-card'))
  assert.match(grid, /<div class="cb-div-summary-head"><div class="cb-div-summary-title">평균 [\s\S]*?배당성장률<\/span><\/div>\s*<div class="cb-div-history-status"[^>]*>[\s\S]*?<\/div><\/div>\s*<div class="cb-div-summary-value"/, '보조 문구가 값보다 앞(제목 줄)에 온다')
  const annual = grid.slice(0, grid.indexOf('월평균'))
  assert.doesNotMatch(annual, /basisLabel|ownerF|세전|세금|cb-div-history-status/, '연간 배당 수입 카드에 세전/세후·소유주 표시를 두지 않는다')
  assert.match(workspaceSource, /@media\(min-width:769px\)\{\s*\.cb-div-summary-grid\{display:flex;flex-wrap:wrap;[^}]*\}\s*\.cb-div-summary-grid>\.cb-div-summary-card\{flex:1 1 auto;[^}]*\}\s*\.cb-div-summary-grid>\.cb-div-top3-card\{flex:4 1 300px;max-width:400px\}/, '넓은 화면에서 TOP 3 카드는 폭 상한이 있어 종목명과 금액이 멀어지지 않는다')
  assert.match(workspaceSource, /\.cb-dca-head,\.cb-dca-row\{display:grid;grid-template-columns:62px minmax\(170px,2\.4fr\) minmax\(84px,\.8fr\) minmax\(84px,\.8fr\) minmax\(84px,\.8fr\) minmax\(124px,\.9fr\) minmax\(76px,\.7fr\) minmax\(88px,\.8fr\) minmax\(98px,\.8fr\);column-gap:8px;align-items:center;min-width:950px;/, '적립식 규칙 표는 격자 — 종목 칸이 남는 폭을 독차지하지 않는다')
  assert.match(cobaltSource, /<div class="cb-thead cb-dca-head">\s*<span>\$\{cbSortBtn\('dca','owner','소유주','text'\)\}<\/span><span>\$\{cbSortBtn\('dca','name','종목','text'\)\}<\/span>/, "머리줄 '종목'은 들여쓰지 않아 국기와 같은 선에서 시작한다")
  assert.match(workspaceSource, /\.fin-tree\.is-acct\{grid-template-columns:/, '계좌별 내역은 트리 한 격자 — 계좌 줄과 종목 줄이 같은 칸 틀(subgrid)을 쓴다')
  assert.doesNotMatch(workspaceSource, /\.acct-row|\.acct-holding\{/, '예전 계좌별 표 규칙은 지웠다')
}

// 2026-11-16 2차 — 홈 평면 도넛, 가족 증여 결과 우선, 버튼·글꼴 한 벌
{
  assert.match(cobaltSource, /cbDonutSvg\(allocBySize,190,'cbDashAllocToggle',0\.15\)[\s\S]*cb-alloc-center/, '홈 자산 배분은 평면 도넛 + 가운데 총액')
  assert.match(cobaltSource, /const allocBySize = alloc\.slice\(\)\.sort\(\(a,b\)=>b\.v-a\.v\)/, '도넛 조각과 목록은 같은 큰 순서')
  assert.doesNotMatch(cobaltSource + fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8'), /AssetAllocation3D|allocation-3d|cb-allocation-visual/, '입체 도넛(비중 왜곡)은 없앴다')
  assert.match(cobaltSource, /cbTreemapLayout\(secs\.map[\s\S]*?color:'var\(--acc\)',mix:12\+40\*Math\.sqrt\(t\.x0\.v\/maxV\)/, '섹터 타일은 한 색이고 비중이 클수록 진하다(2026-11-18 2차)')
  assert.match(cobaltSource, /role="button" tabindex="0" aria-haspopup="dialog" data-sec-n="\$\{t\.n\}" onclick="cbDashSecToggle\(\$\{t\.n\}\)"/, '섹터 칸을 누르면 그 섹터 종목 창(키보드도)')
  assert.match(cobaltSource, /\$\{childPvT>0\?`<div class="cb-gift-detail">\$\{childBody\}<\/div>`:giftEmptyNote\}[\s\S]*?\$\{giftEditBox\('child',childSettings,!\(childPvT>0\)\)\}/, '가족 증여: 결과 → 계획 수정(접힘) 순서, 금액 0 이면 안내')
  assert.match(cobaltSource, /\$\{spouseT>0\?`<div class="cb-gift-detail">\$\{spouseBody\}<\/div>`:giftEmptyNote\}/, '금액이 0 인 부부 계획은 빈 그래프 대신 안내')
  assert.match(cobaltSource, /ontoggle="_cbGiftEditOpen\.\$\{kind\}=this\.open"/, "'계획 수정' 펼침 상태는 재렌더에도 유지")
}

// 2026-11-17 내역 표 한 벌 — 소유주 점·국기·칼럼 이름·손익 색
{
  const pagesSource = fs.readFileSync(new URL('../../workspace-pages.js', import.meta.url), 'utf8')
  const tables = cobaltSource + pagesSource
  assert.match(cobaltSource, /function cbOwnerTag\(owner, fallback\)\{[\s\S]*class="cb-owner-tag/, '소유주 점 + 이름은 한 함수가 그린다')
  assert.doesNotMatch(tables, /width:7px;height:7px;border-radius:50%;background:\$\{(cbOwnerColor|ownerOf)/, '소유주 점을 표마다 인라인으로 복사하지 않는다')
  assert.ok((tables.match(/cbOwnerTag\(/g) || []).length >= 6, '홈·가족·배당·적립식·세금 표가 같은 소유주 표시를 쓴다(계좌별 보기는 2026-11-18 부터 트리의 소유주 줄)')
  assert.match(cobaltSource, /\+`<td>\$\{cbOwnerTag\(r\.i\.owner\)\}<\/td>`\s*\+`<td title=[^`]*<span class="home-asset">\$\{cbFlagCell\(r, 24, 14\)\}/, '홈 보유 표에도 소유주 점과 국기·자산 아이콘')
  assert.match(pagesSource, /holdingName:h=>`<span class="acct-asset" title="[^"]*">\$\{cbFlagCell\(h,24,14\)\}/, '계좌별 보기의 종목 줄에도 국기·자산 아이콘')
  // 손익 색: 이익·손실만 색, 0·취득가 미상·현금은 회색
  const gainFn = new Function(cobaltSource.match(/function cbGainStyle\(v, unknown\)\{[\s\S]*?\n\}/)[0] + '; return cbGainStyle;')()
  assert.equal(gainFn(10), 'color:var(--up)')
  assert.equal(gainFn(-10), 'color:var(--dn)')
  assert.equal(gainFn(0), 'color:var(--lab)', '0 은 초록이 아니라 회색')
  assert.equal(gainFn(10, true), 'color:var(--lab)', '취득가 미상·현금은 회색')
  assert.match(workspaceSource, /#view-holdings \.pt-table td\.c-up\{color:var\(--up\)[^}]*\}\s*#view-holdings \.pt-table td\.c-dn\{color:var\(--dn\)/, '보유 목록 손익 칸도 색(기본 칸 색 규칙에 지워지지 않게)')
  // 머리글 이름 한 벌
  assert.doesNotMatch(scriptSource, /<th[^>]*>(종목명\/티커|자산명|은행\/기관)<\/th>|'평가금액\(KRW\)'|'수익금\(KRW\)'/, '보유 목록 머리글은 종목 / 평가액 / 평가손익')
  assert.doesNotMatch(tables, />(종목명|종목명 · 티커|평가금액)<\/(th|span)>/, '코발트 표 머리글에 옛 이름을 남기지 않는다')
  assert.match(scriptSource, /portfolioSortHeader\(grpName,'valKRW','평가액'\)\}\$\{portfolioSortHeader\(grpName,'profit','평가손익'\)\}/)
}

// 2026-11-18 화면 개선: 보유 목록 '종목' 머리글 들여쓰기 제거, 계좌 배치 진단 트리는 subgrid 한 격자
assert.doesNotMatch(styleSource, /th\.holdings-asset-head\{padding-left:39px/, "보유 목록 '종목' 머리글은 국기 칸부터 시작(들여쓰기 없음)")
assert.match(workspaceSource, /\.fin-tree\{min-width:900px;display:grid;grid-template-columns:minmax\(200px,max-content\) [^}]*minmax\(320px,1fr\)/, '계좌 배치 진단: 이름 칸은 가장 긴 이름만큼, 남는 폭은 진단 칸')
assert.match(workspaceSource, /\.fin-tree-row\{display:grid;grid-column:1\/-1;grid-template-columns:subgrid;/, '트리 줄은 부모 격자를 공유(subgrid) — 칸이 줄마다 어긋나지 않게')
assert.match(cobaltSource, /<div class="cb-tax-hist-top">\s*<div class="cb-panel-title">[\s\S]*?<div class="cb-tax-entry-form">[\s\S]*?<span class="cb-tax-hist-tools">[\s\S]*?cb-tax-import/, '실현손익: 제목·입력 줄·거래내역 가져오기를 한 줄에')
assert.doesNotMatch(workspaceSource, /\.cb-tax-hist-row>:nth-child\(5\)\{text-align:center/, '세제 구분은 가운데가 아니라 왼쪽 정렬(계좌와 세제 사이 빈칸 축소)')


// 2026-11-18 표 정렬 — 머리글을 누르면 그 칸으로, 다시 누르면 반대, 값 없음은 끝, 다른 화면으로 옮기면 기본 순서
{
  const ctx = vm.createContext({ OWNERS: ['본인', '아내', '자녀1', '아버지'], cbRerender() { ctx.rerenders++ }, rerenders: 0, cbRestoreFilterFocus() {}, _cobaltActive: 'cdash' })
  vm.runInContext(['cbSortCompare', 'cbSortRows', 'cbSortDir', 'cbAriaSort', 'cbSortBtn', 'cbTableSortClick', 'cbOwnerRank', 'cbHoldingSortGetters', 'cbResetViewState'].map(n => extractFunction(cobaltSource, n)).join('\n') + '\nvar _cbTableSort={};', ctx)
  const rows = [
    { key: 'a', title: '애플', i: { owner: '아내', grp: '주식', qty: 2 }, qty: 2, val: 300, cost: 200, gain: 100, gainPct: 0.5 },
    { key: 'b', title: '골드바', i: { owner: '본인', grp: '금', qty: 1, costUnknown: true }, qty: 1, val: 900, cost: 0, gain: 0, gainPct: null },
    { key: 'c', title: '삼성전자', i: { owner: '아버지', grp: '주식', qty: 10 }, qty: 10, val: 500, cost: 600, gain: -100, gainPct: -1 / 6 },
    { key: 'd', title: '원화 예수금', i: { owner: '본인', grp: '현금', qty: 1000 }, qty: 1000, val: 1000, cost: 1000, gain: 0, gainPct: null },
  ]
  const order = () => Array.from(ctx.cbSortRows('home', rows, ctx.cbHoldingSortGetters()), r => r.key)
  assert.deepEqual(order(), ['a', 'b', 'c', 'd'], '정렬하지 않으면 화면의 기본 순서 그대로')
  ctx.cbTableSortClick('home', 'gain', 'num')
  assert.deepEqual(order(), ['a', 'c', 'b', 'd'], '숫자 칸은 첫 클릭 내림차순 · 취득가 미상과 현금은 끝')
  assert.equal(ctx.rerenders, 1, '정렬은 렌더 때 적용 — 시세 갱신으로 다시 그려도 유지된다')
  ctx.cbTableSortClick('home', 'gain', 'num')
  assert.deepEqual(order(), ['c', 'a', 'b', 'd'], '다시 누르면 오름차순 · 값 없음은 여전히 끝')
  assert.equal(ctx.cbAriaSort('home', 'gain'), 'ascending')
  ctx.cbTableSortClick('home', 'owner', 'text')
  assert.deepEqual(order(), ['b', 'd', 'a', 'c'], '소유주는 글자 칸 — 첫 클릭 오름차순(소유주 순서), 같은 값끼리는 기본 순서')
  ctx.cbTableSortClick('home', 'avg', 'num')
  assert.deepEqual(order(), ['a', 'c', 'b', 'd'], '평단가는 원화 환산(매입금액 ÷ 수량)으로 비교')
  const btn = ctx.cbSortBtn('home', 'avg', '평단가')
  assert.match(btn, /class="cb-sort-btn is-on" data-sort-btn="home:avg"[^>]*>평단가<i class="cb-sort-ind"/, '켜진 칸 표시 · 화살표는 어느 칸이든 칼럼명 오른쪽')
  assert.doesNotMatch(cobaltSource + workspaceSource, /is-r\b|\.cb-sort-btn\.is-r/, '오른쪽 정렬 칸도 화살표를 글자 앞에 두지 않는다(사용자 결정)')
  assert.match(workspaceSource, /\.cb-sort-ind\{position:absolute;top:50%;left:calc\(100% \+ 2px\)/, '화살표는 칼럼명 바로 오른쪽(절대 위치)')
  assert.match(btn, /<span class="sr-only">, 내림차순 정렬됨<\/span>/, '정렬 상태를 화면 낭독기에도 알린다')
  assert.match(ctx.cbSortBtn('home', 'name', '종목', 'text'), /class="cb-sort-btn" data-sort-btn="home:name"[^>]*>종목<i class="cb-sort-ind" aria-hidden="true">↕<\/i><\/button>/)
  vm.runInContext('var _calDay=null,_acctOpen=new Set();cbResetViewState();', ctx)
  assert.deepEqual(order(), ['a', 'b', 'c', 'd'], '다른 화면으로 옮기면(cbResetViewState) 기본 순서')
  // 대상 표: 홈 보유·구성원 비교·배당·적립식·계좌별 보기·ETF 구성종목·보유 목록
  for (const t of ['home', 'fam', 'div', 'dca']) assert.match(cobaltSource, new RegExp(`cbSortRows\\('${t}',`), `${t} 표는 렌더 때 정렬한다`)
  const pages = fs.readFileSync(new URL('../../workspace-pages.js', import.meta.url), 'utf8')
  const etf = fs.readFileSync(new URL('../../etf-explorer.js', import.meta.url), 'utf8')
  assert.match(pages, /cbSortRows\('acct',finAccountTree\(treeRows\),sortGet\)/, '계좌별 보기는 각 단계 안에서 정렬')
  assert.ok(etf.indexOf("cbSortRows('etf'") < etf.indexOf('const pages=Math.max(1,Math.ceil(rows.length/ETF_PAGE_SIZE))'), 'ETF 구성종목은 쪽을 나누기 전에 정렬')
  assert.match(cobaltSource, /if\(table==='etf'&&typeof etfRefreshResults==='function'\)\{ _etfPage=0;/, 'ETF 정렬은 1쪽으로 돌아가고 표만 다시 그린다')
  assert.match(scriptSource, /portfolioSortHeader\(grpName,'name','종목','text-left holdings-asset-head'\)/, '보유 목록 종목·계좌·소유주 칸도 정렬')
  assert.match(scriptSource, /Object\.entries\(_sortState\)\.forEach\(\(\[g,st\]\)=>applyPortfolioSort\(/, '보유 목록은 다시 그린 뒤 정렬을 되살린다')
  assert.match(cobaltSource, /function cbResetViewState\(\)\{[\s\S]*?_cbTableSort=\{\};[\s\S]*?_sortState=\{\}/, '화면을 옮기면 모든 표 정렬을 지운다')
}

// 2026-11-18 2차 — 3층 막대 경계 정렬, 일정·시뮬레이터 오른쪽 정렬
{
  const financeSource = fs.readFileSync(new URL('../../finance.js', import.meta.url), 'utf8')
  const ctx = { Math, cbEsc: v => String(v), cbDisp: v => String(v), cbOwnerColor: () => '#000' }
  vm.createContext(ctx)
  vm.runInContext(extractFunction(financeSource, 'finAccountTree') + '\n' + extractFunction(financeSource, 'finTreeHtml'), ctx)
  const row = (owner, broker, acc, value) => ({ owner, broker, acc, value, dividend: 0, share: value / 10, type: '일반', tone: 'ok' })
  const tree = ctx.finAccountTree([row('본인', 'A', '일반', 50), row('본인', 'A', 'ISA', 7), row('본인', 'B', '연금', 3), row('아내', 'C', '일반', 40)])
  const html = ctx.finTreeHtml(tree, 100, { head: [], cells: () => [] })
  const widths = cls => [...html.matchAll(new RegExp(`fin-ice-seg ${cls}[^"]*" style="flex:0 0 ([0-9.]+)%`, 'g'))].map(m => Number(m[1]))
  const l1 = widths('l1'), l2 = widths('l2'), l3 = widths('l3')
  assert.deepEqual(l1, [60, 40], '소유주 칸 폭 = 평가액 % (flex 몫이 아니라 직접 지정)')
  assert.ok(Math.abs(l2[0] + l2[1] - l1[0]) < 1e-6 && Math.abs(l3[0] + l3[1] + l3[2] - l1[0]) < 1e-6, '본인의 증권사·계좌 칸 합 = 본인 칸 폭 — 경계가 같은 자리')
  assert.match(workspaceSource, /\.fin-ice-seg\{box-sizing:border-box;min-width:0;height:34px;display:flex;align-items:center;padding:0;border:0;box-shadow:/, '칸에 padding·테두리를 두지 않는다(층마다 고정 여백이 몫을 깎아 경계가 어긋났다)')
  assert.match(workspaceSource, /\.cal-toolbar\{display:flex;align-items:center;justify-content:flex-end;/, '일정의 연월·이번 달 버튼은 오른쪽 정렬')
  assert.match(workspaceSource, /\.sim-view-tabs(?:,\.view-mode-bar)?\{gap:4px;justify-content:flex-end;/, '투자 시뮬레이터 세 탭은 오른쪽 정렬')
}

// ── 2026-11-23 작은 것들 ──
{
  const ctx = vm.createContext({})
  vm.runInContext(['cbRingSvg', 'cbUpDn'].map(n => extractFunction(cobaltSource, n)).join('\n'), ctx)
  const firm = ctx.cbRingSvg(70, 100, 'var(--up)', false)
  const prov = ctx.cbRingSvg(70, 100, 'var(--up)', true)
  assert.doesNotMatch(firm, /is-provisional|stroke-dasharray="3 5"/, '확정 점수는 실선')
  assert.match(prov, /is-provisional/, '잠정 점수 표식')
  assert.match(prov, /stroke-dasharray="3 5"/, '잠정 점수는 점선 바탕')
  assert.match(prov, /stroke="var\(--lab\)"/, '잠정 점수는 회색 호')
  assert.equal(ctx.cbUpDn(0), 'color:var(--lab)', '0 은 회색')
  assert.equal(ctx.cbUpDn(1), 'color:var(--up)')
  assert.equal(ctx.cbUpDn(-1), 'color:var(--dn)')
}
assert.doesNotMatch(cobaltSource, />=0\?'\+':''\)\+cbKrw\(/, '세금 카드의 0원에 + 를 붙이지 않는다')
assert.match(cobaltSource, /const pos=Math\.max\(minPos,\.\.\.vs\.filter\(v=>v>0\)\)[\s\S]*const YB=panel\(vals,40000,/, '빈 세금 그래프 눈금이 +0만을 반복하지 않게 바닥값(월별 줄 4만 원)')
{
  const tbl = financeSource.slice(financeSource.indexOf('<div class="fin-rebal-table">'), financeSource.indexOf('<small class="fin-disclaimer">조정액은'))
  assert.match(tbl, /const out=Math\.abs\(x\.drift\)>ta\.threshold/, '범위 밖 판정은 막대 차트와 같은 > 기준')
  assert.match(tbl, /fin-rebal-out">범위 밖</, '범위 밖은 글자로도 알린다')
  assert.match(tbl, / 늘리기':' 줄이기'/, '조정 방향을 말로 적는다')
  assert.doesNotMatch(tbl, /class="(up|dn)"/, '범위 안 행은 위·아래 색을 칠하지 않는다')
}
{
  const ws = fs.readFileSync(new URL('../../workspace-pages.js', import.meta.url), 'utf8')
  assert.match(ws, /\$\{reportCoverStats\(cur,prev,adjacent,ownerF,todayKey,live\)\}/, '결산 표지에 핵심 숫자')
  const fn = extractFunction(ws, 'reportCoverStats')
  const ctx = vm.createContext({
    cbDisp: v => '₩' + Math.round(v).toLocaleString('en-US'),
    cbSignDisp: v => (v > 0 ? '+' : '') + Math.round(v),
    cbGainStyle: v => v > 0 ? 'color:var(--up)' : 'color:var(--lab)',
    reportYmLabel: ym => ym,
    reportDividendYear: () => ({ months: Array.from({ length: 12 }, (_, i) => ({ v: i === 9 ? 5000 : 0, kind: 'rec' })) }),
  })
  vm.runInContext(fn, ctx)
  const html = ctx.reportCoverStats({ ym: '2026-10', v: 1000000, entry: { goals: [{ target: 100, now: 100 }, { target: 100, now: 50 }] } }, { ym: '2026-09', v: 900000 }, true, null, '2026-11-23', false)
  assert.match(html, /월말 투자자산/)
  assert.match(html, /전월 대비[\s\S]*\+100000/)
  assert.match(html, /이 달 배당\(기록\)[\s\S]*₩5,000/)
  assert.match(html, /2개 중 1개 달성/)
}
{
  // 연간 표지에도 숫자 4칸(2026-11-23) — 뒤 장의 값을 꺼낼 뿐
  const ws = fs.readFileSync(new URL('../../workspace-pages.js', import.meta.url), 'utf8')
  assert.match(ws, /\$\{reportYearCoverStats\(year,start,last,base,ongoing,ownerF,todayKey\)\}/, '연간 표지에 핵심 숫자')
  const ctx = vm.createContext({
    cbDisp: v => '₩' + Math.round(v).toLocaleString('en-US'),
    cbSignDisp: v => (v > 0 ? '+' : '') + Math.round(v),
    cbGainStyle: v => v > 0 ? 'color:var(--up)' : 'color:var(--lab)',
    reportYmLabel: ym => ym,
    reportDividendYear: () => ({ months: Array.from({ length: 12 }, (_, i) => ({ v: i < 10 ? 1000 : 2000, kind: i < 10 ? 'rec' : 'est' })) }),
    reportRealizedYear: () => ({ count: 2, sum: 300000 }),
  })
  vm.runInContext(extractFunction(ws, 'reportYearCoverStats'), ctx)
  const start = { ym: '2025-12', v: 1000000 }, last = { ym: '2026-11', v: 1500000 }
  const html = ctx.reportYearCoverStats('2026', start, last, start, true, null, '2026-11-23')
  assert.match(html, /오늘 투자자산[\s\S]*₩1,500,000/)
  assert.match(html, /연초 대비[\s\S]*\+500000[\s\S]*수익률 아님/)
  assert.match(html, /올해 배당[\s\S]*₩14,000[\s\S]*기록 \+ 남은 달 예상/)
  assert.match(html, /실현손익[\s\S]*\+300000[\s\S]*2건/)
  const one = ctx.reportYearCoverStats('2026', last, last, null, false, null, '2026-11-23')
  assert.doesNotMatch(one, /대비/, '비교할 점이 없으면 대비 칸을 그리지 않는다')
}
console.log('PASS: 2026-11-23 작은 것들·표지·리밸런싱 표')
for (const v of ['totalDue', 'genDue', 'isaDue']) assert.match(cobaltSource, new RegExp(`color:var\\(\\$\\{${v}>0\\?'--dn':'--lab'\\}\\)`), `${v} 0원은 회색`)
