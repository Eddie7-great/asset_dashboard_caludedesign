#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8')

function extractFunction(name) {
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

const context = {
  OWNERS: ['본인', '아내', '자녀1', '아버지'],
}
vm.createContext(context)
vm.runInContext(extractFunction('cbSortDividendRows'), context)

const rows = [
  { i: { owner: '아내' }, cls: 'kr', title: '삼성전자', incomeKRW: 900 },
  { i: { owner: '본인' }, cls: 'us', title: 'Apple Inc.', incomeKRW: 800 },
  { i: { owner: '본인' }, cls: 'kr', title: '현대차', incomeKRW: 700 },
  { i: { owner: '본인' }, cls: 'kr', title: '삼성전자', incomeKRW: 600 },
  { i: { owner: '본인' }, cls: 'jp', title: 'Toyota', incomeKRW: 500 },
  { i: { owner: '본인' }, cls: 'kr', title: '삼성전자', incomeKRW: 1_000 },
  { i: { owner: '아버지' }, cls: 'kr', title: 'KT&G', incomeKRW: 400 },
]

const sorted = context.cbSortDividendRows(rows)
assert.deepEqual(
  Array.from(sorted, row => [row.i.owner, row.cls, row.title, row.incomeKRW]),
  [
    ['본인', 'kr', '삼성전자', 1_000],
    ['본인', 'kr', '삼성전자', 600],
    ['본인', 'kr', '현대차', 700],
    ['본인', 'us', 'Apple Inc.', 800],
    ['본인', 'jp', 'Toyota', 500],
    ['아내', 'kr', '삼성전자', 900],
    ['아버지', 'kr', 'KT&G', 400],
  ],
  '배당 내역을 소유주 → 국가 → 종목명 → 연간 수입 순으로 정렬',
)
assert.notEqual(sorted, rows, '원본 배열을 변경하지 않음')

console.log('PASS 배당 내역 소유주·국가·종목명·연간 수입 정렬')
