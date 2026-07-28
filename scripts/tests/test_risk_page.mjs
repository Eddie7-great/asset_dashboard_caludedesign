#!/usr/bin/env node
// 리스크 페이지의 소유주 범위, ETF 제외, 단일 기초자산 ETF 처리 규칙을 실제 함수로 검증한다.

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

let rows = [
  { i: { owner: '아버지', grp: '주식', tkr: '005930.KS', name: '삼성전자', cur: 'KRW' }, title: '삼성전자', cls: 'kr', val: 1000 },
  { i: { owner: '아버지', grp: '주식', tkr: '426030.KS', name: 'TIME 미국나스닥100액티브', cur: 'KRW' }, title: 'TIME 미국나스닥100액티브', cls: 'kr', val: 9000 },
  { i: { owner: '본인', grp: '가상화폐', tkr: 'ETH', name: '이더리움', cur: 'USD' }, title: '이더리움', cls: 'crypto', val: 5000 },
  { i: { owner: '본인', grp: '현금', tkr: 'CASH', name: '현금', cur: 'KRW' }, title: '현금', cls: 'cash', val: 1000 },
  { i: { owner: '본인', grp: '주식', tkr: 'TSLA', name: 'Tesla, Inc.', cur: 'USD' }, title: 'Tesla, Inc.', cls: 'us', val: 4000 },
  { i: { owner: '아내', grp: '주식', tkr: 'ETHU', name: '2x Ether ETF', cur: 'USD' }, title: '2x Ether ETF', cls: 'us', val: 2000 },
]

const holdingsDoc = {
  etfs: {
    '426030': {
      holdings: [
        { t: '005930', n: '삼성전자', w: 5 },
        { t: 'TSLA', n: 'Tesla, Inc.', w: 4 },
      ],
    },
  },
}

const context = {
  window: {
    _krStocksDB: {
      byCode: new Map([
        ['005930', { market: 'KOSPI' }],
        ['426030', { market: 'ETF' }],
      ]),
    },
  },
  cbAllRows: () => rows,
  cbEtfDoc: () => holdingsDoc,
  cbSectors: () => ({ list: [{ label: 'Technology', pct: 100 }] }),
  _gicsSector: item => /ETF|PROSHARES/i.test(String(item.name || '')) ? 'Sector ETF' : 'Other',
  CB_VOL: { crypto: 0.65, us: 0.22, kr: 0.26, cash: 0 },
  cssVar: (_name, fallback) => fallback,
}
vm.createContext(context)
for (const name of ['cbStrip', 'cbIsEtf', 'cbSyntheticEtfHoldings', 'cbLeveragedInverseMeta', 'cbLookThrough', 'cbRisk']) {
  vm.runInContext(extractFunction(name), context)
}

assert.equal(context.cbIsEtf(rows[0].i), false, '삼성전자는 개별 회사')
assert.equal(context.cbIsEtf(rows[1].i), true, 'TIME ETF는 stocks.json 시장구분으로 판별')
assert.equal(context.cbIsEtf(rows[5].i), true, '2x Ether ETF는 해외 ETF로 판별')
assert.equal(context.cbLeveragedInverseMeta(rows[5].i).kind, '레버리지', '2x Ether ETF는 레버리지 상품으로 판별')
assert.equal(context.cbLeveragedInverseMeta(rows[1].i), null, '일반 액티브 ETF는 레버리지 상품에서 제외')

const fatherLookThrough = context.cbLookThrough('아버지')
assert.deepEqual(Array.from(fatherLookThrough.list, x => x.tkr), ['005930'], '집중도에는 개별 회사만 표시')
assert.equal(fatherLookThrough.list[0].via, 450, 'TIME ETF의 삼성전자 간접 보유만 합산')

const allLookThrough = context.cbLookThrough(null)
assert.equal(allLookThrough.list.some(x => x.tkr === '426030'), false, 'TIME ETF 자체는 종목 집중도에서 제외')
assert.equal(allLookThrough.list.some(x => x.tkr === 'ETHU'), false, 'ETHU 자체는 종목 집중도에서 제외')
assert.equal(allLookThrough.etfMiss.includes('2x Ether ETF'), false, '직접 ETH가 없는 ETHU는 미조회 각주에서도 제외')
assert.deepEqual(Array.from(allLookThrough.list.find(x => x.tkr === '005930').owners), ['아버지'], '전체 룩스루 행에 직접 보유 소유주 기록')
assert.match(source, /`소유주 \$\{ownerNames\.join\(' · '\)\}`/, '전체 소유주 막대 툴팁에 소유주명 표시')

const fatherRisk = context.cbRisk('아버지')
assert.equal(fatherRisk.cryptoPct, 0, '아버지 가상화폐 비중')
assert.equal(fatherRisk.cashPct, 0, '아버지 현금 비중')
assert.equal(fatherRisk.fxPct, 0, '아버지 환노출 비중')
assert.equal(fatherRisk.cards.find(x => x.title === '가상화폐 비중').fill, 0, '0% 가상화폐 막대')
assert.equal(fatherRisk.cards.find(x => x.title === '환노출 (원화 기준)').fill, 0, '0% 환노출 막대')
assert.equal(fatherRisk.cards.find(x => x.title === '현금 완충 비중').fill, 0, '0% 현금 막대')
assert.equal(fatherRisk.cards.find(x => x.title === '단일 종목 집중도').valFmt, '14.5%', 'ETF 자체 90%가 아닌 삼성전자 실질 비중')
assert.equal(fatherRisk.leveragedInversePct, 0, '아버지는 레버리지·인버스 노출 없음')

rows = rows.concat([
  { i: { owner: '아내', grp: '가상화폐', tkr: 'ETH', name: '이더리움', cur: 'USD' }, title: '이더리움', cls: 'crypto', val: 500 },
])
const wifeLookThrough = context.cbLookThrough('아내')
assert.equal(wifeLookThrough.list.length, 0, '가상화폐는 개별 회사 집중도 목록에는 표시하지 않음')
assert.equal(wifeLookThrough.etfMiss.includes('2x Ether ETF'), false, '합성 단일자산 ETF는 미조회로 표시하지 않음')
const wifeRisk = context.cbRisk('아내')
assert.equal(wifeRisk.leveragedInversePct, 80, '아내 순자산 대비 ETHU 평가액 비중')
assert.equal(wifeRisk.leveragedInverseCount, 1, '아내 레버리지·인버스 상품 수')
assert.equal(wifeRisk.leveragedInverseTop, '2x Ether ETF', '최대 기여 레버리지 상품')
assert.equal(wifeRisk.cards.find(x => x.title === '레버리지·인버스 노출도').status, '경고', '10% 초과 경고')

rows = rows.concat([
  { i: { owner: '본인', grp: '주식', tkr: 'SQQQ', name: 'ProShares UltraPro Short QQQ', cur: 'USD' }, title: 'ProShares UltraPro Short QQQ', cls: 'us', val: 100 },
  { i: { owner: '본인', grp: '주식', tkr: 'VOO', name: 'Vanguard S&P 500 ETF', cur: 'USD' }, title: 'Vanguard S&P 500 ETF', cls: 'us', val: 900 },
])
assert.equal(context.cbLeveragedInverseMeta(rows.at(-2).i).kind, '인버스', 'SQQQ는 인버스 상품으로 판별')
assert.equal(context.cbLeveragedInverseMeta(rows.at(-1).i), null, '일반 해외 ETF는 노출도에서 제외')

console.log('PASS 리스크 소유주 범위·ETF 제외·0% 막대·레버리지·인버스 노출')
