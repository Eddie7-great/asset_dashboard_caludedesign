#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const scriptSource = fs.readFileSync(new URL('../../script.js', import.meta.url), 'utf8')
const cobaltSource = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8')

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
for (const name of ['getDcaCycleLabel', 'getDcaCellHtml', 'getDcaAmountCellHtml']) {
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

const mergeContext = {
  cbStrip: ticker => String(ticker || '').toUpperCase(),
  cbRate: () => 1,
  cbAvgNative: () => 0,
}
vm.createContext(mergeContext)
for (const name of ['cbAccountLabel', 'cbMergeRows']) {
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

console.log('PASS 자산 DCA 칼럼 분리·대시보드 실제 계좌 수 집계')
