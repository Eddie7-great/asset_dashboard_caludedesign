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
// cbSyntheticEtfHoldings 가 닫고 있는 상수도 함께 넣는다 — 함수만 꺼내면 ReferenceError 로 죽는다.
for (const name of ['CB_SINGLE_STOCK_LEV_ISSUER', 'CB_NOT_SINGLE_STOCK', 'CB_LEV_MULT']) {
  const start = source.indexOf(`const ${name}`)
  assert.notEqual(start, -1, `${name} 상수를 찾을 수 없음`)
  const end = source.indexOf('\n', source.indexOf(';', start))
  vm.runInContext(source.slice(start, end), context)
}
for (const name of ['cbStrip', 'cbIsEtf', 'cbSyntheticEtfHoldings', 'cbLeveragedInverseMeta', 'cbLookThrough', 'cbEtfCrossOverlap', 'cbRisk']) {
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
assert.ok(wifeRisk.score >= 0 && wifeRisk.score <= 100, '리스크 점수는 실제 0~100점 범위')
assert.match(source, /const score = Math\.max\(0, Math\.min\(100,/, '리스크 점수의 인위적 5점 하한·98점 상한 제거')

rows = rows.concat([
  { i: { owner: '본인', grp: '주식', tkr: 'SQQQ', name: 'ProShares UltraPro Short QQQ', cur: 'USD' }, title: 'ProShares UltraPro Short QQQ', cls: 'us', val: 100 },
  { i: { owner: '본인', grp: '주식', tkr: 'VOO', name: 'Vanguard S&P 500 ETF', cur: 'USD' }, title: 'Vanguard S&P 500 ETF', cls: 'us', val: 900 },
])
assert.equal(context.cbLeveragedInverseMeta(rows.at(-2).i).kind, '인버스', 'SQQQ는 인버스 상품으로 판별')
assert.equal(context.cbLeveragedInverseMeta(rows.at(-1).i), null, '일반 해외 ETF는 노출도에서 제외')

// 단일 종목 레버리지 ETF — 기초자산이 상품명에 하나로 명시된 경우만 해석한다.
// 지수형(QLD 등)에 적용하면 '레버리지 배수로 구성종목을 추론'하는 금지 규칙을 어기게 된다.
// vm 컨텍스트에서 만든 객체는 프로토타입이 달라 deepStrictEqual 이 통하지 않는다 — 직렬화해 비교한다.
const synth = (name, tkr) => JSON.stringify(context.cbSyntheticEtfHoldings({ name, tkr }))
assert.equal(synth('T-REX 2X Long BMNR Daily Target', 'BMNU'), JSON.stringify([{ t: 'BMNR', n: 'BMNR', w: 200 }]),
  '단일 종목 2배 ETF는 기초자산 200% 노출로 해석')
assert.equal(synth('Defiance Daily Target 3X Long MSTR', 'MSTX'), JSON.stringify([{ t: 'MSTR', n: 'MSTR', w: 300 }]),
  '3배 상품은 300% 노출')
assert.equal(synth('ProShares Ultra QQQ', 'QLD'), 'null',
  '지수 추종 레버리지 ETF는 배수로 구성종목을 추론하지 않는다')
assert.equal(synth('Direxion Daily Semiconductor Bull 3X', 'SOXL'), 'null',
  '섹터 지수 레버리지 ETF도 해석하지 않는다')
assert.equal(synth('T-REX 2X Long QQQ Daily', 'XXXX'), 'null',
  '단일 종목 발행사라도 기초자산이 지수면 해석하지 않는다')
assert.equal(synth('T-REX 2X Short NVDA Daily Target', 'NVDQ'), 'null',
  '인버스는 음수 노출이라 룩스루로 해석하지 않는다 — 레버리지·인버스 카드가 담당')
assert.equal(synth('TIGER 미국S&P500', '360750'), 'null', '일반 지수 ETF는 해당 없음')

// ── 레버리지 반영 변동성 ───────────────────────────────────────────────
// 자산군 상수만 쓰면 2배 ETF 도 일반 미국 ETF 와 같은 22% 로 잡혀 위험이 과소평가된다.
assert.equal(context.cbLeveragedInverseMeta({ grp:'주식', tkr:'ETHU', name:'2x Ether ETF' }).mult, 2, '이름의 2X 를 배수로 읽는다')
assert.equal(context.cbLeveragedInverseMeta({ grp:'주식', tkr:'SQQQ', name:'ProShares UltraPro Short QQQ' }).mult, 3, '이름에 배수가 없으면 티커 표를 본다')
assert.equal(context.cbLeveragedInverseMeta({ grp:'주식', tkr:'VOO', name:'Vanguard S&P 500 ETF' }), null, '일반 ETF 는 배수 대상이 아니다')

// 같은 평가액이라도 2배 상품이면 변동성 기여가 두 배여야 한다.
const volRowsPlain = [{ i:{ owner:'본인', grp:'주식', tkr:'VOO', name:'Vanguard S&P 500 ETF', cur:'USD' }, title:'Vanguard S&P 500 ETF', cls:'us', val:1000 }]
const volRowsLev = [{ i:{ owner:'본인', grp:'주식', tkr:'QLD', name:'ProShares Ultra QQQ', cur:'USD' }, title:'ProShares Ultra QQQ', cls:'us', val:1000 }]
rows = volRowsPlain
const plainVol = context.cbRisk('본인').vol
rows = volRowsLev
const levVol = context.cbRisk('본인').vol
assert.ok(Math.abs(levVol - plainVol * 2) < 1e-9, `2배 상품의 변동성 기여는 두 배 (${plainVol} → ${levVol})`)
assert.match(source, /레버리지·인버스 상품은 노출 배수만큼 키워 반영합니다/, '변동성 툴팁이 근거를 밝힌다')

// ── ETF 간 중복도 ──────────────────────────────────────────────────────
// cbLookThrough 는 '직접 보유와 겹치는 부분'만 센다. 직접 보유가 없으면 0 으로 보이므로
// 서로 다른 ETF 가 같은 회사를 담고 있는 정도를 따로 낸다.
rows = [
  { i:{ owner:'본인', grp:'주식', tkr:'AAA', name:'AI반도체 ETF', cur:'KRW' }, title:'AI반도체 ETF', cls:'kr', val:5000 },
  { i:{ owner:'본인', grp:'주식', tkr:'BBB', name:'HBM 반도체 ETF', cur:'KRW' }, title:'HBM 반도체 ETF', cls:'kr', val:5000 },
  { i:{ owner:'아내', grp:'주식', tkr:'AAA', name:'AI반도체 ETF', cur:'KRW' }, title:'AI반도체 ETF', cls:'kr', val:5000 },
]
holdingsDoc.etfs.AAA = { asOf:'2026-09-15', coverage:'full', source:'FunETF', name:'AI반도체 ETF',
  holdings:[{ t:'005930', n:'삼성전자', w:40 }, { t:'000660', n:'SK하이닉스', w:30 }] }
holdingsDoc.etfs.BBB = { asOf:'2026-09-15', coverage:'full', source:'FunETF', name:'HBM 반도체 ETF',
  holdings:[{ t:'000660', n:'SK하이닉스', w:50 }, { t:'TSLA', n:'Tesla', w:10 }] }
context.stocksDB = { byCode: new Map([['AAA',{market:'ETF'}],['BBB',{market:'ETF'}]]) }
context.window._krStocksDB = { byCode: new Map([['AAA',{market:'ETF'}],['BBB',{market:'ETF'}]]) }

const cross = context.cbEtfCrossOverlap('본인')
// SK하이닉스만 두 ETF 에 겹친다: 5000*30% + 5000*50% = 4000, 투자자산 10000 → 40%
assert.equal(cross.count, 1, '두 개 이상 펀드에 들어 있는 종목만 중복으로 센다')
assert.equal(cross.top.tkr, '000660', '최다 중복 종목')
assert.equal(cross.top.funds, 2, '겹친 펀드 수')
assert.ok(Math.abs(cross.pct - 40) < 1e-9, `중복 노출 비중 40% (실제 ${cross.pct})`)
assert.equal(cross.provisional, false, '구성종목이 모두 확인되면 잠정이 아니다')

// 소유주 경계 — 아내는 ETF 가 하나뿐이라 겹칠 상대가 없다.
const wifeCross = context.cbEtfCrossOverlap('아내')
assert.equal(wifeCross.count, 0, '다른 소유주의 ETF 와 교차 합산하지 않는다')
assert.equal(wifeCross.pct, 0, '겹치는 종목이 없으면 0%')

// 구성종목을 못 받은 ETF 가 섞이면 합산에서 빼고 그 사실을 남긴다.
delete holdingsDoc.etfs.BBB
const partialCross = context.cbEtfCrossOverlap('본인')
assert.equal(partialCross.count, 0, '확인되지 않은 ETF 는 중복 합산에 넣지 않는다')
assert.equal(partialCross.provisional, true, '미확인 ETF 가 있으면 잠정으로 표시')
assert.ok(partialCross.unknown.includes('HBM 반도체 ETF'), '미확인 ETF 이름을 남긴다')

assert.match(source, /const gridRows=Math\.max\(Math\.ceil\(r\.cards\.length\/2\),Math\.ceil\(insights\.length\/2\)\)/,
  '카드 행 수를 고정하지 않는다 — 고정하면 새 카드가 화면에서 조용히 사라진다')

console.log('PASS 리스크 소유주 범위·ETF 제외·0% 막대·레버리지 변동성·ETF 간 중복도·단일 종목 레버리지 해석')
