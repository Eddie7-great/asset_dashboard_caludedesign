#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const scriptSource = fs.readFileSync(new URL('../../script.js', import.meta.url), 'utf8')
const cobaltSource = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8')
const indexSource = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
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

const dcaContext = {}
vm.createContext(dcaContext)
for (const name of [
  'getDcaCycleLabel',
  'getDcaCellHtml',
  'getDcaAmountCellHtml',
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
for (const name of ['cbAccountLabel', 'cbBrokerLabel', 'cbBrokerWeightTip', 'cbMergeRows']) {
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
assert.equal(
  mergeContext.cbBrokerWeightTip(merged[0]),
  '미래에셋증권 75.00%\n삼성증권 25.00%',
  '다계좌 툴팁은 증권사별 비중을 줄바꿈하고 계좌 종류는 제외',
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
assert.match(scriptSource, /초기 대시보드 렌더가 그 해시를 덮어쓰지 않게[\s\S]*requestedView!==normalized/, '모바일 미리보기에서도 현재 페이지 해시를 유지')
assert.match(styleSource, /\.layout-preview-overlay\.mode-mobile \.layout-preview-stage\{width:390px[\s\S]*\.mode-desktop \.layout-preview-stage\{width:1280px/, '미리보기 iframe에 실제 모바일·PC 반응형 폭 적용')
assert.match(cobaltSource, /aria-label="국가"><\/span>/, '배당 관리 국가 헤더 문구는 숨기고 국기 칸 유지')
assert.match(cobaltSource, /연간 수입 · \$\{basisLabel\}<\/span><span[^>]*>[\s\S]{0,400}?배당세<\/span><\/span><span[^>]*>보유 주수<\/span><span[^>]*>주당 배당\(연\)/, '배당 내역을 연간 수입 → 배당세 → 보유 주수 → 주당 배당 순으로 배치')
assert.match(scriptSource, /holdings-asset-flag/, '자산 내역 종목명 왼쪽에 국기·자산 아이콘 슬롯 추가')
assert.doesNotMatch(cobaltSource, /function cbDcaDel\(/, '자산 내역에서 불러오는 DCA 페이지의 별도 삭제 기능 제거')
assert.doesNotMatch(cobaltSource, /width:44px;text-align:right">관리<\/span>/, 'DCA 페이지 관리 칼럼 제거')
assert.match(scriptSource, /holdings-broker-filter-inline/, '주식 종목 수 옆에 증권사·계좌 필터 배치')
assert.match(scriptSource, /classList\.toggle\('holdings-owner-tabs', viewId==='holdings'\)/, '자산 내역 소유주 탭 전용 여백 적용')
assert.match(styleSource, /#view-holdings \.pt-table th\.sortable\{position:sticky\}/, '수량부터 수익률까지 정렬 헤더도 스크롤 중 고정')

console.log('PASS 자산 DCA 칼럼 분리·대시보드 실제 계좌 수 집계')
