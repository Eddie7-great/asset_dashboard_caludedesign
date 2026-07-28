#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const scriptSource = fs.readFileSync(new URL('../../script.js', import.meta.url), 'utf8')
const cobaltSource = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8')
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

const dcaContext = {}
vm.createContext(dcaContext)
for (const name of [
  'getDcaCycleLabel',
  'getDcaCellHtml',
  'getDcaAmountCellHtml',
  'holdingsEsc',
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
assert.match(assetCell, /Vanguard S&amp;P 500 ETF · VOO/, '잘린 종목 셀 툴팁에 종목명과 티커 표시')
const brokerCell = dcaContext.getHoldingsBrokerCellHtml({ broker: '토스증권', acc: 'ISA' })
assert.match(brokerCell, /data-tip="토스증권 \/ ISA"/, '증권사·계좌 셀 툴팁 제공')

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
for (const name of ['cbFlagMarket', 'cbFlagSvg']) {
  vm.runInContext(extractFunction(cobaltSource, name), flagContext)
}
assert.match(flagContext.cbFlagSvg({ cls: 'gold' }, 16), /🪙/, '금 Au 문자를 금 이모지로 대체')
assert.doesNotMatch(flagContext.cbFlagSvg({ cls: 'gold' }, 16), />Au</, '금 아이콘에 Au를 노출하지 않음')

assert.match(
  scriptSource,
  /row-market-search'\)\.style\.display = \(isCash \|\| isGold\) \? 'none' : 'block'/,
  '금 입력 시 종목 검색 행 숨김',
)
assert.match(scriptSource, /if\(grp==='금'\)\{\s*tkr=.*?'GOLD';\s*name='금'/s, '금은 내부 고정 키와 이름으로 저장')
assert.match(indexSource, /id="sidebar-refresh-btn"[^>]*>↻ <span[^>]*>새로고침<\/span>/, '좌하단 버튼 문구를 새로고침으로 표시')

console.log('PASS 자산 DCA 칼럼 분리·대시보드 실제 계좌 수 집계')
