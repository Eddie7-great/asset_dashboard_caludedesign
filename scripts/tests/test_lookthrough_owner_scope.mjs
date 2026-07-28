#!/usr/bin/env node
// cobalt.js의 실제 cbLookThrough 함수를 격리 실행해 소유주 교차 합산을 방지하는지 검증한다.

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
  throw new Error(`${name} 함수 닫는 괄호를 찾을 수 없음`)
}

const holdingsDoc = {
  etfs: {
    '069500': {
      holdings: [
        { t: '005930', n: '삼성전자', w: 30 },
        { t: '000660', n: 'SK하이닉스', w: 20 },
        { t: '035420', n: 'NAVER', w: 5 },
      ],
    },
  },
}

const rows = [
  { i: { owner: '가족A', grp: '주식', tkr: '005930', isEtf: false }, title: '삼성전자', val: 1000 },
  { i: { owner: '가족A', grp: '주식', tkr: '069500', isEtf: true }, title: 'KODEX 200', val: 10000 },
  { i: { owner: '가족B', grp: '주식', tkr: '000660', isEtf: false }, title: 'SK하이닉스', val: 2000 },
  { i: { owner: '가족B', grp: '주식', tkr: '069500', isEtf: true }, title: 'KODEX 200', val: 20000 },
]

const context = {
  cbAllRows: () => rows,
  cbEtfDoc: () => holdingsDoc,
  cbIsEtf: i => i.isEtf,
  cbStrip: t => String(t || '').toUpperCase().replace(/\.(KS|KQ|T)$/, ''),
}
vm.createContext(context)
vm.runInContext(extractFunction('cbLookThrough'), context)

const all = context.cbLookThrough(null)
const samsung = all.list.find(x => x.tkr === '005930')
const hynix = all.list.find(x => x.tkr === '000660')

assert.equal(samsung.val, 1000, '삼성전자 직접투자액')
assert.equal(samsung.via, 3000, '가족A의 ETF만 삼성전자 간접투자에 포함')
assert.equal(hynix.val, 2000, 'SK하이닉스 직접투자액')
assert.equal(hynix.via, 4000, '가족B의 ETF만 SK하이닉스 간접투자에 포함')
assert.equal(all.list.some(x => x.tkr === '035420'), false, '직접 보유하지 않은 NAVER는 제외')

const ownerA = context.cbLookThrough('가족A')
assert.equal(ownerA.list.length, 1, '가족A 직접 보유 종목만 표시')
assert.equal(ownerA.list[0].tkr, '005930')
assert.equal(ownerA.list[0].via, 3000)

console.log('PASS 소유주별 직접투자 × ETF 구성종목 교집합만 합산')
