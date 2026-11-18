#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const scriptSource = fs.readFileSync(new URL('../../script.js', import.meta.url), 'utf8')
const cobaltSource = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8')
const indexSource = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const styleSource = fs.readFileSync(new URL('../../style.css', import.meta.url), 'utf8')
const workspaceSource = fs.readFileSync(new URL('../../workspace-ui.css', import.meta.url), 'utf8')

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

const dcaContext = { _taxRuleValue: (_path, fallback) => fallback }
vm.createContext(dcaContext)
// 통화 기호는 CURRENCY_META 단일 출처에서 온다 — 정의부를 그대로 가져온다.
vm.runInContext(scriptSource.slice(scriptSource.indexOf('const CURRENCY_META'), scriptSource.indexOf('function curRateKnown(')), dcaContext)
for (const name of [
  'getDcaCycleLabel',
  'getDcaCellHtml',
  'getDcaAmountCellHtml',
  'getDcaMergedCellHtml',
  'getAccountDivTaxInfo',
  'holdingsWeightHtml',
  'escHtml',
  'holdingsEsc',
  'updateOverflowTooltip',
  'getHoldingsBrokerCellHtml',
  'getHoldingsAssetCellHtml',
]) {
  vm.runInContext(extractFunction(scriptSource, name), dcaContext)
}

const weeklyDca = {
  dca: true,
  dcaCycle: '매주',
  dcaDays: [1, 3],
  dcaMode: 'amount',
  dcaAmt: 500_000,
  dcaCur: 'KRW',
  grp: '주식',
}
assert.match(dcaContext.getDcaCellHtml(weeklyDca), /매주 월·수/, 'DCA 칼럼에는 주기만 표시')
assert.doesNotMatch(dcaContext.getDcaCellHtml(weeklyDca), /dca-tag|>DCA<|₩500,000/, 'DCA 배지와 금액을 주기 칼럼에서 제거')
assert.match(dcaContext.getDcaAmountCellHtml(weeklyDca), /₩500,000/, '회당 금액을 별도 칼럼에 표시')
// 2026-11-17 3차: 'DCA 주기'·'회당 금액' 두 칸을 '적립식' 한 칸(윗줄 주기·아랫줄 금액)으로 합쳤다
assert.match(dcaContext.getDcaMergedCellHtml(weeklyDca), /<span class="dca-cycle">매주 월·수<\/span><span class="dca-amount">₩500,000<\/span>/, '적립식 한 칸에 주기와 회당 금액을 두 줄로 표시')
assert.equal((dcaContext.getDcaMergedCellHtml({ dca: false }).match(/—/g) || []).length, 1, '적립식이 아니면 대시 하나만 표시')
assert.doesNotMatch(scriptSource, /DCA 주기<\/th>|회당 금액<\/th>|dca-cycle-cell|dca-amount-cell/, '보유 목록에 옛 두 칸(DCA 주기·회당 금액)을 남기지 않음')
assert.equal((scriptSource.match(/<th class="dca-head">적립식<\/th>/g) || []).length, 2, '주식·금 표 머리글은 적립식 한 칸')
assert.match(scriptSource, /const colspan=grpName==='현금' \? \(showOwner\?6:5\) : \(showOwner\?11:10\);/, '칸 하나를 줄였으므로 빈 행도 11칸(소유주 포함)을 덮음')
{
  const widths = scriptSource.match(/const widths=showOwner\s*\?(\[[^\]]*\])\s*:(\[[^\]]*\]);/)
  assert.ok(widths, 'colgroup 폭 배열을 찾을 수 없음')
  const withOwner = JSON.parse(widths[1].replace(/'/g, '"')).map(parseFloat)
  const noOwner = JSON.parse(widths[2].replace(/'/g, '"')).map(parseFloat)
  assert.equal(withOwner.length, 10, '소유주 칸 제외 10칸')
  assert.equal(noOwner.length, 10, '소유주 칸 없는 표도 10칸')
  assert.equal(Math.round((withOwner.reduce((a, b) => a + b, 0) + 6.5) * 10) / 10, 100, '소유주 칸(6.5%)을 더하면 100%')
  assert.equal(Math.round(noOwner.reduce((a, b) => a + b, 0) * 10) / 10, 100, '소유주 칸 없는 표도 100%')
  assert.ok(withOwner[1] >= 19, '합친 폭을 종목 칸에 준다(종목명이 잘리지 않게)')
}
// 두 줄 칸: 증권사/계좌, 종목/티커
{
  const broker = dcaContext.getHoldingsBrokerCellHtml({ broker: '미래에셋증권', acc: '연금저축' })
  assert.match(broker, /holdings-broker-cell/, '증권사 칸은 두 줄 격자')
  assert.match(broker, /<span class="holdings-account cb-acct-name" data-overflow-watch><i class="fin-tree-kind pen" aria-hidden="true"><\/i>연금저축<\/span>/, '아랫줄 계좌에는 / 구분자 없이 세제 유형 색 네모(연금)')
  assert.match(dcaContext.getHoldingsBrokerCellHtml({ broker: 'A', acc: '중개형 ISA' }), /fin-tree-kind isa/, 'ISA 계좌 색')
  assert.match(dcaContext.getHoldingsBrokerCellHtml({ broker: 'A', acc: '일반' }), /fin-tree-kind gen/, '일반 계좌 색')
  assert.match(broker, /data-overflow-tip="미래에셋증권 \/ 연금저축"/, '말풍선은 증권사 / 계좌 한 줄')
}
assert.match(workspaceSource, /#view-holdings \.holdings-inline-cell\.holdings-asset-cell\{display:grid;/, '종목 칸은 이름·티커 두 줄 격자')
// 평가액 칸 비중: 숫자는 합계 대비, 막대 길이는 가장 큰 평가액 대비
{
  const w = dcaContext.holdingsWeightHtml(25, 200, 50, 'us')
  assert.match(w, /<span class="holdings-weight-pct">12\.5%<\/span>/, '비중 숫자는 평가액 합계 대비')
  assert.match(w, /width:50\.0%/, '막대 길이는 표에서 가장 큰 평가액 대비')
  assert.match(dcaContext.holdingsWeightHtml(0, 0, 0, 'us'), /0\.0%/, '합계 0 이어도 NaN 을 찍지 않음')
  assert.match(scriptSource, /const _wTotal=sumOf\('total'\);/, '비중 분모는 평가액 숫자 카드와 같은 합계')
  assert.equal((scriptSource.match(/<!--w:\$\{(current|cashKRW)\}:/g) || []).length, 4, '네 자산군 표 모두 평가액 칸에 비중을 단다')
}
assert.match(dcaContext.getDcaAmountCellHtml({ ...weeklyDca, dcaCur: 'JPY', dcaAmt: 30_000 }), /¥30,000/, '엔화 적립식 금액은 ₩ 가 아니라 ¥ 로 표시')
assert.match(dcaContext.getDcaAmountCellHtml({ ...weeklyDca, dcaCur: 'USD', dcaAmt: 100 }), /\$100/, '달러 적립식 금액은 $ 로 표시')
assert.match(
  dcaContext.getDcaAmountCellHtml({ ...weeklyDca, dcaMode: 'qty', dcaQty: 0.5 }),
  /0\.5주/,
  '수량 기준 DCA도 별도 회당 칼럼에 표시',
)
const assetCell = dcaContext.getHoldingsAssetCellHtml('Vanguard S&P 500 ETF', 'VOO')
assert.doesNotMatch(assetCell, /<br>/, '자산 내역 종목명과 티커를 한 줄로 표시')
assert.match(assetCell, /data-overflow-tip="Vanguard S&amp;P 500 ETF · VOO"/, '잘린 종목 셀용 전체 문구 보관')
assert.doesNotMatch(assetCell, /\sdata-tip=/, '잘리지 않은 종목에는 툴팁을 미리 생성하지 않음')
const brokerCell = dcaContext.getHoldingsBrokerCellHtml({ broker: '토스증권', acc: 'ISA' })
assert.match(brokerCell, /data-overflow-tip="토스증권 \/ ISA"/, '잘린 증권사·계좌 셀용 전체 문구 보관')
assert.doesNotMatch(brokerCell, /\sdata-tip=/, '잘리지 않은 증권사·계좌에는 툴팁을 미리 생성하지 않음')

function overflowFixture(scrollWidth, clientWidth) {
  const attrs = new Map([['data-overflow-tip', '전체 문구']])
  return {
    attrs,
    querySelectorAll: () => [{ scrollWidth, clientWidth }],
    setAttribute: (name, value) => attrs.set(name, value),
    removeAttribute: name => attrs.delete(name),
    getAttribute: name => attrs.get(name),
  }
}
const fullCell = overflowFixture(90, 100)
assert.equal(dcaContext.updateOverflowTooltip(fullCell), false, '문구가 다 보이면 오버플로 툴팁 비활성')
assert.equal(fullCell.attrs.has('data-tip'), false, '문구가 다 보이면 data-tip 없음')
const clippedCell = overflowFixture(130, 100)
assert.equal(dcaContext.updateOverflowTooltip(clippedCell), true, '문구가 잘리면 오버플로 툴팁 활성')
assert.equal(clippedCell.attrs.get('data-tip'), '전체 문구', '잘린 경우에만 전체 문구 노출')

const mergeContext = {
  cbStrip: ticker => String(ticker || '').toUpperCase(),
  cbRate: () => 1,
  cbAvgNative: () => 0,
}
vm.createContext(mergeContext)
for (const name of ['cbAccountLabel', 'cbBrokerLabel', 'cbMergeRows']) {
  vm.runInContext(extractFunction(cobaltSource, name), mergeContext)
}

const base = {
  owner: '본인',
  grp: '주식',
  tkr: 'VOO',
  name: 'Vanguard S&P 500 ETF',
  cur: 'USD',
  qty: 1,
}
const rows = [
  { i: { ...base, broker: '미래에셋증권', acc: '일반' }, cls: 'us', val: 100, cost: 80, gain: 20 },
  { i: { ...base, broker: '삼성증권', acc: '일반' }, cls: 'us', val: 100, cost: 80, gain: 20 },
  { i: { ...base, broker: '미래에셋증권', acc: '연금저축' }, cls: 'us', val: 100, cost: 80, gain: 20 },
  { i: { ...base, broker: '미래에셋증권', acc: '연금저축' }, cls: 'us', val: 100, cost: 80, gain: 20 },
].map((row, idx) => ({
  ...row,
  idx,
  cl: { label: '미국주식' },
  title: base.name,
  name: base.name,
  tkr: base.tkr,
  subTitle: base.tkr,
  chip: '',
}))

const merged = mergeContext.cbMergeRows(rows)
assert.equal(merged.length, 1, '동일 소유주·종목을 한 행으로 합산')
assert.equal(merged[0].accountCount, 3, '증권사와 계좌 조합 기준 실제 계좌 수 집계')
assert.deepEqual(
  Array.from(merged[0].acctList),
  ['미래에셋증권 / 일반', '삼성증권 / 일반', '미래에셋증권 / 연금저축'],
  '같은 계좌 유형도 증권사가 다르면 별도 계좌로 처리',
)
assert.deepEqual(
  Array.from(merged[0].brokerWeights, x => [x.broker, x.pct]),
  [['미래에셋증권', 75], ['삼성증권', 25]],
  '같은 증권사의 여러 계좌를 합쳐 종목 내 증권사별 비중 계산',
)

const flagContext = {
  CB_CLS: {
    crypto: { color: '#f2a33c' },
    gold: { color: '#d4b24a' },
    cash: { color: '#56c596' },
  },
}
vm.createContext(flagContext)
for (const name of ['cbFlagMarket', 'cbGoldBarSvg', 'cbFlagSvg']) {
  vm.runInContext(extractFunction(cobaltSource, name), flagContext)
}
assert.match(flagContext.cbFlagSvg({ cls: 'gold' }, 16), /<polygon/, '금 아이콘을 입체 금괴 SVG로 표시')
assert.doesNotMatch(flagContext.cbFlagSvg({ cls: 'gold' }, 16), /🪙|>Au</, '금 아이콘에 동전 이모지나 Au를 노출하지 않음')

const taxContext = { OWNERS: ['본인', '아내', '자녀1', '아버지'] }
vm.createContext(taxContext)
vm.runInContext(extractFunction(cobaltSource, 'cbSortTaxEntries'), taxContext)
const taxRows = [
  { category: 'foreign', owner: '본인', month: '2026-01' },
  { category: 'domestic', owner: '아내', month: '2026-02' },
  { category: 'domestic', owner: '본인', month: '2026-03' },
  { category: 'foreign', owner: '아버지', month: '2026-01' },
]
const sortedTax = taxContext.cbSortTaxEntries(taxRows, row => row.owner)
assert.deepEqual(
  Array.from(sortedTax, row => [row.category, row.owner]),
  [['foreign', '본인'], ['foreign', '아버지'], ['domestic', '아내'], ['domestic', '본인']],
  '양도소득세 내역을 월 우선, 같은 월에서는 국내 → 해외·소유주 순으로 정렬',
)

assert.match(
  scriptSource,
  /row-market-search'\)\.style\.display = \(isCash \|\| isGold\) \? 'none' : 'block'/,
  '금 입력 시 종목 검색 행 숨김',
)
assert.match(indexSource, /id="row-gold-name"[\s\S]*id="add-gold-name"/, '금 전용 자산명 입력 메뉴 제공')
assert.match(scriptSource, /name=\(goldName&&goldName\.value\.trim\(\)\)\|\|'금'/, '입력한 금 자산명을 저장')
assert.doesNotMatch(indexSource, /class="login-logo"/, '로그인 창의 의미 없는 가 로고 제거')
assert.match(indexSource, /id="sidebar-refresh-btn"[^>]*>↻ <span[^>]*>새로고침<\/span>/, '좌하단 버튼 문구를 새로고침으로 표시')
assert.match(indexSource, /id="sidebar-layout-btn"[\s\S]*id="sidebar-layout-label"[^>]*>모바일버전<\/span>/, '새로고침 아래 PC·모바일 전환 버튼 배치')
assert.match(scriptSource, /function toggleLayoutPreview\(\)[\s\S]*openLayoutPreview\(isMobileLayout\(\)\?'desktop':'mobile'\)/, '현재 화면 폭에 맞춰 반대 버전 미리보기 전환')
assert.match(scriptSource, /mobilePreview[\s\S]*desktopPreview[\s\S]*sidebar-layout-label/, '미리보기 안에서는 전환 버튼 문구를 반대 버전으로 변경')
assert.match(scriptSource, /초기 대시보드 렌더가 그 해시를 덮어쓰지 않게[\s\S]*navResolve\(requestedView\):requestedView\)!==normalized/, '기존 별칭을 해석한 뒤 모바일 미리보기의 페이지 해시를 유지')
assert.match(styleSource, /\.layout-preview-overlay\.mode-mobile \.layout-preview-stage\{width:390px[\s\S]*\.mode-desktop \.layout-preview-stage\{width:1280px/, '미리보기 iframe에 실제 모바일·PC 반응형 폭 적용')
assert.match(cobaltSource, /<div class="cb-thead cb-div-head">\s*<span>소유주<\/span><span class="cb-div-c-name">종목<\/span>[\s\S]*<span class="cb-div-c-flag">\$\{cbFlagSvg\(x,15\)\}<\/span>/, "배당 관리: 머리글 '종목'은 국기 칸부터 시작하고 행의 국기 칸은 유지")
assert.match(workspaceSource, /\.cb-div-head>\.cb-div-c-name\{grid-column:span 2\}/, "배당 머리글 '종목'이 국기·이름 두 칸을 덮음")
assert.match(cobaltSource, /연간 수입 · \$\{basisLabel\}<\/span><span[^>]*>[\s\S]{0,400}?배당세<\/span><\/span><span[^>]*>보유 주수<\/span><span[^>]*>주당 배당\(연\)/, '배당 내역을 연간 수입 → 배당세 → 보유 주수 → 주당 배당 순으로 배치')
assert.match(scriptSource, /holdings-asset-flag/, '자산 내역 종목명 왼쪽에 국기·자산 아이콘 슬롯 추가')
assert.doesNotMatch(cobaltSource, /function cbDcaDel\(/, '자산 내역에서 불러오는 DCA 페이지의 별도 삭제 기능 제거')
assert.doesNotMatch(cobaltSource, /width:44px;text-align:right">관리<\/span>/, 'DCA 페이지 관리 칼럼 제거')
assert.match(scriptSource, /holdings-broker-filter-inline/, '주식 종목 수 옆에 증권사·계좌 필터 배치')
assert.match(scriptSource, /classList\.toggle\('holdings-owner-tabs', viewId==='holdings'\)/, '자산 내역 소유주 탭 전용 여백 적용')
assert.match(styleSource, /#view-holdings \.pt-table th\.sortable\{position:sticky\}/, '수량부터 수익률까지 정렬 헤더도 스크롤 중 고정')
assert.match(cobaltSource, /home-holdings-layout">`\s*\+`<section class="cb-panel home-table-column"><div class="cb-dash-table-toolbar"/, '홈 검색 도구를 우측 요약이 아닌 보유 목록 칼럼 안에 배치')
// 내역과 상세는 서로 다른 위젯이다 — 한 패널 안에서 border-left 로만 나뉘어 있었다.
assert.match(cobaltSource, /<section class="cb-panel home-table-column"/, '보유 목록은 독립 패널')
assert.match(cobaltSource, /<aside class="cb-panel home-stock-summary"/, '선택 종목 요약도 독립 패널')
// 선택은 행 전체가 받는다. 종목명만 감싼 버튼은 티커·수량·금액 칸을 죽은 영역으로 만들었다.
assert.match(cobaltSource, /<tr class="\$\{r\.key===_cdashSel\?'is-selected':''\}" role="button" tabindex="0"[\s\S]{0,120}data-key="\$\{cbEsc\(r\.key\)\}" onclick="cbDashPick\(this\.dataset\.key\)"/, '행 전체가 선택 대상이며 키는 data-key 로만 전달')
assert.doesNotMatch(cobaltSource, /home-stock-pick/, '중첩 버튼 제거 — 남기면 클릭이 두 번 발생')
assert.match(cobaltSource, /<th>소유주<\/th><th>종목<\/th><th>수량<\/th><th>매입금액<\/th><th>평가액<\/th><th>비중<\/th><th>평가손익<\/th><th>수익률<\/th><th><span class="sr-only">시세 상태<\/span>/, '홈 보유 목록 9개 칼럼 (매입금액·비중·시세 상태 포함)')
assert.match(cobaltSource, /colspan="9">검색 결과가 없습니다/, '빈 결과 행도 9칸을 덮는다')
// cbCostKRW 는 취득가 미상일 때 0 을 돌려준다 — 그대로 그리면 ₩0 이 찍힌다.
assert.match(cobaltSource, /\$\{r\.i\.costUnknown\?'—':cbDisp\(r\.cost\)\}/, '취득가 미상 매입금액은 0원이 아니라 —')
assert.match(workspaceSource, /\.home-table-column thead th\{position:sticky;top:0/, '홈 보유 목록 헤더를 목록 스크롤 중 고정')
assert.match(workspaceSource, /\.home-stock-summary\{position:sticky;top:12px[^}]*max-height:[^}]*overflow:auto/, '홈 종목 요약은 화면을 따라가며 긴 내용도 잘리지 않게 자체 스크롤')

console.log('PASS 자산 DCA 칼럼 분리·대시보드 실제 계좌 수 집계')
