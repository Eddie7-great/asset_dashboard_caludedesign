// 화면마다 같은 종목의 평가액이 같은가 — 2026-11-25 숫자 일관성 점검(사용자 요청:
// "동일 소유주, 동일 종목의 평가 금액이 동일하게 1억이 나와야 하는데 그렇지 못한 경우").
//
// 평가액·매입금액의 단일 출처는 core/data.js 의 assetValueKRW·assetCostKRW·assetAvgNative 다.
// 이 테스트는 (1) 다른 파일에 평가액 식이 다시 생기지 않았는지, (2) 같은 입력을 넣었을 때
// 보유 목록 표·홈/계좌별/결산(cbRow·cbValKRW)·비중 지도·섹터·순자산 기록이 같은 숫자를 내는지 본다.
//
// 예전 어긋남(고친 것):
//  - 보유 목록·비중 지도·섹터 집중도가 금을 '수량 × 단위 배수 × (1g 시세 || curP)'로 셌다. curP 는 이미 단위당 원화라
//    금 시세를 못 받은 날 '돈' 단위 금이 3.75배(kg 은 1000배)가 됐다 — 홈·계좌별·결산은 수량 × curP.
//  - 보유 목록이 가상화폐·금·현금의 원화 단가를 먼저 반올림한 뒤 수량을 곱했다 — 수량이 많은 코인은 수천 원씩 달랐다.
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
import { readSource, assetValueSource } from './_source.mjs'

const script = readSource('script.js')
const cobalt = readSource('cobalt.js')
const workspace = fs.readFileSync(new URL('../../workspace-pages.js', import.meta.url), 'utf8')
const finance = fs.readFileSync(new URL('../../finance.js', import.meta.url), 'utf8')

function extractFunction(source, name) {
  const start = source.search(new RegExp(`function ${name}\\(`))
  assert.ok(start >= 0, `${name} 를 찾지 못함`)
  let depth = 0, quote = null, escaped = false, line = false, block = false
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    const ch = source[i], next = source[i + 1]
    if (line) { if (ch === '\n') line = false; continue }
    if (block) { if (ch === '*' && next === '/') { block = false; i++ } continue }
    if (quote) {
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '/' && next === '/') { line = true; i++; continue }
    if (ch === '/' && next === '*') { block = true; i++; continue }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '{') depth++
    if (ch === '}' && --depth === 0) return source.slice(start, i + 1)
  }
  throw new Error(`${name} 닫는 괄호를 찾지 못함`)
}

// ── 1. 평가액 식은 한 곳뿐 ──────────────────────────────────────────────
const FRONT = ['script.js', 'cobalt.js'].map(readSource).join('\n')
  + ['finance.js', 'navigation.js', 'simulator.js', 'etf-explorer.js', 'workspace-pages.js']
    .map(f => fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8')).join('\n')
const valuationLike = [...FRONT.matchAll(/[^\n]*\bqty\b[^;\n]{0,40}\*[^;\n]{0,40}\bcurP\b[^\n]*/g)]
  .map(m => m[0].trim())
  .filter(l => !/^function assetValueKRW\(i\)/.test(l))     // 단일 출처
  .filter(l => !/portfolioSortData\(/.test(l))               // 정렬용 단가 표시(curP*rate), 평가액 아님
  .filter(l => !/\bdcaQty\b/.test(l))                        // 적립식 1회 매수 금액(수량 지정), 평가액 아님
assert.deepEqual(valuationLike, [], '수량 × 현재가 평가액 식은 core/data.js assetValueKRW 에만 둔다')
assert.doesNotMatch(FRONT, /_GOLD_G_KRW\s*\|\|\s*i\.curP/, '금 평가액을 1g 시세 × 단위 배수로 다시 세지 않는다(curP 가 이미 단위당 원화)')
assert.doesNotMatch(FRONT, /\bi\.qty\*curPKRW\b|\bi\.qty\*avgPKRW\b/, '반올림한 원화 단가에 수량을 곱하지 않는다')
for (const [alias, target] of [['cbValKRW', 'assetValueKRW'], ['cbCostKRW', 'assetCostKRW'], ['cbGainKRW', 'assetGainKRW'], ['cbAvgNative', 'assetAvgNative'], ['cbRate', 'curRate']]) {
  assert.match(cobalt, new RegExp(`function ${alias}\\((?:i|cur)\\)\\{ return ${target}\\((?:i|cur)\\); \\}`), `${alias} 는 ${target} 의 별칭`)
}
assert.match(script, /function _bubbleItemValueKRW\(i\) \{\n\s*return assetValueKRW\(i\);\n\}/, '비중 지도·섹터도 같은 평가액')
assert.match(script, /const sumAssets = \(arr\) => arr\.reduce\(\(s, a\) => s \+ assetValueKRW\(a\), 0\);/, '순자산 기록도 같은 평가액')

// ── 2. 같은 입력 → 같은 숫자 ────────────────────────────────────────────
const RATES = { USD: 1391.37, JPY: 9.137, AUD: 905.4, KRW: 1 }
const ASSETS = [
  // 같은 소유주·같은 종목을 두 계좌에 — 홈은 합쳐 한 줄, 보유 목록은 계좌별 두 줄. 합은 같아야 한다.
  { owner: '본인', grp: '주식', broker: '삼성', acc: 'ISA', name: '삼성전자', tkr: '005930', cur: 'KRW', qty: 700, avgP: 61234, curP: 71300 },
  { owner: '본인', grp: '주식', broker: '토스', acc: '일반', name: '삼성전자', tkr: '005930', cur: 'KRW', qty: 702.5, avgP: 70111.7, curP: 71300 },
  { owner: '본인', grp: '주식', broker: '토스', acc: '일반', name: 'Alphabet', tkr: 'GOOGL', cur: 'USD', qty: 13.37, avgP: 141.23, curP: 177.91 },
  { owner: '아내', grp: '주식', broker: 'SBI', acc: 'NISA', name: '토요타', tkr: '7203.T', cur: 'JPY', qty: 300, avgP: 2512, curP: 2777.5 },
  // 수량이 많은 코인 — 원화 단가를 먼저 반올림하면 수천 원이 달라진다.
  { owner: '본인', grp: '가상화폐', broker: '업비트', acc: '일반', name: '리플', tkr: 'XRP', cur: 'USD', qty: 12345.6789, avgP: 1.733, curP: 2.1374 },
  // 원화(1,000만 이상)로 저장된 평단가 — assetAvgNative 가 달러로 맞춘다.
  { owner: '아내', grp: '가상화폐', broker: '업비트', acc: '일반', name: '비트코인', tkr: 'BTC', cur: 'USD', qty: 0.0731, avgP: 98765432, curP: 91234.5 },
  // '돈' 단위 금 — curP 는 1돈 가격. 금 시세를 아직 못 받은 상태(window._GOLD_G_KRW 없음)에서도 같아야 한다.
  { owner: '본인', grp: '금', broker: '실물', acc: '', name: '금반지', tkr: '', cur: 'KRW', unit: '돈', qty: 3, avgP: 0, curP: 562875, costUnknown: true },
  { owner: '아내', grp: '금', broker: 'KRX', acc: '금현물', name: '금 99.99', tkr: '', cur: 'KRW', unit: 'g', qty: 17.5, avgP: 131000.4, curP: 150100.6 },
  { owner: '본인', grp: '현금', broker: '토스', acc: '일반', name: '달러 예수금', tkr: '', cur: 'USD', qty: 1234.56, avgP: 0, curP: 1 },
  { owner: '아내', grp: '현금', broker: 'SBI', acc: 'NISA', name: '엔 예수금', tkr: '', cur: 'JPY', qty: 98765, avgP: 0, curP: 1 },
  { owner: '자녀1', grp: '현금', broker: '키움', acc: '증여', name: '원화 예수금', tkr: '', cur: 'KRW', qty: 1500000.4, avgP: 0, curP: 1 },
]

let captured = ''
const ctx = vm.createContext({
  window: {}, RATES, Math, Number, String, Object, Array, Set, Map, JSON, isNaN,
  pfolioData: ASSETS.map(a => ({ ...a })),
  OWNERS: ['본인', '아내', '자녀1', '아버지'],
  ownerColors: {}, _sortState: {}, HOLDINGS_TABS: ['주식', '가상화폐', '금', '현금'],
  _holdingsBrokerFilter: '전체', _holdingsTab: '주식', _holdingsQ: '', _holdingsStaleOnly: false, _BROKER_ACC_SEP: '\u0001',
  isMobileLayout: () => false, cbAssetMobile: undefined,
  holdingsEsc: s => String(s == null ? '' : s).replace(/"/g, '&quot;'),
  getHoldingsBrokerCellHtml: () => '', getHoldingsAssetCellHtml: () => '', getDcaMergedCellHtml: () => '',
  portfolioSortHeader: () => '<th></th>', holdingsWeightHtml: () => '', holdingsRowMatches: () => true,
  applyPortfolioSort: () => {}, normTkr: t => String(t || '').toUpperCase().replace(/\.(KS|KQ)$/, ''),
  curMeta: c => ({ KRW: { symbol: '₩', cashDecimals: 0 }, USD: { symbol: '$', cashDecimals: 2 }, JPY: { symbol: '¥', cashDecimals: 0 }, AUD: { symbol: 'A$', cashDecimals: 2 } }[c] || { symbol: '₩', cashDecimals: 0 }),
  curSymbol(c) { return this.curMeta(c).symbol },
  curRateKnown: c => c === 'KRW' || RATES[c] > 0,
  _cfLocalDateKey: () => '2026-11-25', _balanceSheet: {},
  document: { getElementById: id => (id === 'portfolio-tables' ? { set innerHTML(v) { captured = v } } : null) },
})
ctx.curSymbol = c => ctx.curMeta(c).symbol
vm.runInContext(assetValueSource(), ctx)
for (const n of ['filterByOwner', 'getFilteredAssets', 'fmtMoney', 'calcProfit', 'portfolioSortData', 'portfolioSortKeys', 'renderPortfolio', '_bubbleItemValueKRW', 'updateNetWorthSnapshot', '_splitRowKey', 'liveKeyOf'])
  vm.runInContext(extractFunction(script, n), ctx)
for (const n of ['cbStrip', 'cbCls', 'cbRate', 'cbAvgNative', 'cbValKRW', 'cbCostKRW', 'cbGainKRW']) vm.runInContext(extractFunction(cobalt, n), ctx)
vm.runInContext(extractFunction(finance, 'finGoalAllocate'), ctx)
vm.runInContext(extractFunction(workspace, 'reportBuildEntry'), ctx)
ctx.window._balanceSheet = {}
ctx.window._netWorthHistory = []

// 보유 목록 표의 행마다 평가액(정렬 값 = 화면 평가액 칸과 같은 값)
vm.runInContext("renderPortfolio('전체')", ctx)
const tableRows = [...captured.matchAll(/<tr data-sort-owner="(\d+)" data-sort-acct="([^"]*)" data-sort-name="([^"]*)"[^>]*?data-sort-valkrw="([^"]*)"/g)]
  .map(m => ({ owner: ctx.OWNERS[Number(m[1])], acct: m[2], name: m[3], val: Number(m[4]) }))
assert.equal(tableRows.length, ASSETS.length, '보유 목록 표에 모든 행')

const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} ≠ ${b}`)
for (const item of ctx.pfolioData) {
  const acct = [item.broker || '', item.acc || ''].join(' ').trim()
  const row = tableRows.find(r => r.owner === item.owner && r.acct === acct && r.name === item.name)
  assert.ok(row, `보유 목록 행 ${item.owner} ${item.name}`)
  const expected = ctx.assetValueKRW(item)
  near(row.val, expected, `보유 목록 ${item.owner} ${item.name}`)
  near(ctx.cbValKRW(item), expected, `홈·계좌별·구성원별(cbValKRW) ${item.name}`)
  near(ctx._bubbleItemValueKRW(item), expected, `비중 지도·섹터 ${item.name}`)
}
// 금 시세를 못 받은 상태: '돈' 단위 금 3돈 = 3 × 1돈 가격(예전 보유 목록·비중 지도는 × 3.75 를 한 번 더 했다)
near(ctx.assetValueKRW(ctx.pfolioData[6]), 3 * 562875, '금반지 3돈')
// 수량 많은 코인: 반올림 없이 수량 × 달러가 × 환율
near(ctx.assetValueKRW(ctx.pfolioData[4]), 12345.6789 * 2.1374 * 1391.37, '리플')
assert.ok(Math.abs(12345.6789 * Math.round(2.1374 * 1391.37) - 12345.6789 * 2.1374 * 1391.37) > 1000, '예전 방식은 리플에서 1,000원 넘게 어긋났다(회귀 근거)')

// 숫자 카드 합계 = 홈 총액(같은 종목 합)
const kpi = vm.runInContext("renderPortfolio('전체',{kpisOnly:true})", ctx)
const total = ctx.pfolioData.reduce((s, i) => s + ctx.cbValKRW(i), 0)
assert.ok(kpi.includes(`<span>평가액</span><b>₩${Math.round(total).toLocaleString()}</b>`), '보유 목록 평가액 카드 = 홈 총액')
const costAll = ctx.pfolioData.filter(i => i.grp !== '현금' && !i.costUnknown).reduce((s, i) => s + ctx.cbCostKRW(i), 0)
assert.ok(kpi.includes(`<span>매입금액</span><b>₩${Math.round(costAll).toLocaleString()}</b>`), '보유 목록 매입금액 카드 = 홈 평가손익 % 의 분모')

// 소유주 하나만 보아도 같다
for (const owner of ['본인', '아내', '자녀1']) {
  const k = vm.runInContext(`renderPortfolio(${JSON.stringify(owner)},{kpisOnly:true})`, ctx)
  const t = ctx.pfolioData.filter(i => i.owner === owner).reduce((s, i) => s + ctx.cbValKRW(i), 0)
  assert.ok(k.includes(`<span>평가액</span><b>₩${Math.round(t).toLocaleString()}</b>`), `${owner} 평가액 카드`)
}

// 순자산 기록(홈·성과 추이) · 결산 — 소유주별 합계와 종목별 금액
const snap = vm.runInContext('updateNetWorthSnapshot()', ctx)
assert.equal(snap.portfolio, Math.round(total), '순자산 기록 투자자산 = 홈 총액')
for (const owner of ['본인', '아내', '자녀1'])
  assert.equal(snap.portfolioByOwner[owner], Math.round(ctx.pfolioData.filter(i => i.owner === owner).reduce((s, i) => s + ctx.assetValueKRW(i), 0)), `순자산 기록 ${owner}`)
const rep = vm.runInContext('reportBuildEntry(pfolioData, {}, [], "2026-11-25")', ctx)
for (const h of rep.holdings) {
  const item = ctx.pfolioData.find(i => i.owner === h.o && i.broker === h.b && i.acc === h.a && i.name === h.n)
  assert.equal(h.v, Math.round(ctx.assetValueKRW(item)), `결산 ${h.n}`)
}

// 같은 소유주·같은 종목을 두 계좌에: 보유 목록 두 줄의 합 = 홈 한 줄(cbMergeRows 는 r.val 을 더한다)
const samsung = tableRows.filter(r => r.owner === '본인' && r.name === '삼성전자')
assert.equal(samsung.length, 2)
near(samsung[0].val + samsung[1].val, (700 + 702.5) * 71300, '삼성전자 두 계좌 합')
assert.match(cobalt, /g\.qty \+= \(r\.i\.qty\|\|0\); g\.val \+= r\.val; g\.cost \+= r\.cost; g\.gain \+= r\.gain;/, '홈 병합은 같은 값을 더할 뿐')
// 통화·단위가 다른 현금·금은 합치지 않는다 — 합치면 수량 칸에 '원화 + 달러'·'돈 + g' 를 더한 엉뚱한 수가 보인다.
assert.match(cobalt, /const unitKey = r\.cls==='cash' \? '::' \+ String\(r\.i\.cur\|\|'KRW'\) : r\.cls==='gold' \? '::' \+ String\(r\.i\.unit\|\|'g'\) : '';\n\s*const key = \(r\.i\.owner\|\|''\) \+ '::' \+ cbStrip\(r\.i\.tkr\) \+ '::' \+ r\.cls \+ unitKey;/, '홈 병합: 현금은 통화별·금은 단위별')

// 오늘 투자자산 기록(추이 그래프의 마지막 점)은 다시 그릴 때마다 지금 시세로 맞춘다 — 홈 총액과 같은 금액
assert.match(cobalt, /function cbRerender\(\)\{[\s\S]{0,600}?window\._kvLoadState\?\.assets==='ready' && window\._kvLoadState\?\.ext==='ready'[\s\S]{0,120}?updateNetWorthSnapshot\(\);/, '자동 새로고침 뒤에도 추이 마지막 점 = 홈 총액')

// ── 3. 배당 — 배당 화면(월별 막대·연간 수입) = 결산 배당 장(divHistory) = 현금 흐름 자동 배당 ──
// 분기 배당인데 최근 12개월 지급월이 5개 잡힌 종목: 예전 결산·현금 흐름은 '연간 ÷ 4 × 5'로 25% 크게 셌다.
{
  const year = String(new Date().getFullYear())
  const dctx = vm.createContext({
    window: { _divDataCache: { SCHD: { annualDps: 1.04, eps: 0.26, cycle: '분기', months: [0, 3, 6, 9, 11], cur: 'USD', payDay: 25 } } },
    RATES, Math, Number, String, Object, Array, Set, Map, JSON, console,
    ALL_OWNERS: ['전체', '본인', '아내', '자녀1', '아버지'], CYCLE_COUNT: { '월배당': 12, '분기': 4, '반기': 2, '연간': 1, '-': 1 },
    divHistory: {}, divHistoryYears: () => [year], DIV_INFO_DB: { SCHD: { eps: 0.9, cycle: '분기', months: [2, 5, 8, 11], cur: 'USD' } },
    normDivTkr: t => String(t || '').toUpperCase().replace(/\.(KS|KQ)$/, ''), _taxRuleValue: (_p, f) => f,
    // 연금 계좌(과세이연)라 세후 = 세전 — 금액 규칙만 비교한다.
    pfolioData: [{ grp: '주식', owner: '본인', acc: '연금저축', tkr: 'SCHD', cur: 'USD', qty: 100, curP: 27.5 },
                 { grp: '주식', owner: '아내', acc: '연금저축', tkr: 'VOO', cur: 'USD', qty: 3, curP: 600 }],
  })
  vm.runInContext(assetValueSource(), dctx)
  for (const n of ['getAccountDivTaxInfo', 'allocateDividendTax', '_defaultMonthsForCycle', 'divPayMonthsOf', 'divPerPaymentDps', 'syncDivHistory'])
    vm.runInContext(extractFunction(script, n), dctx)
  for (const n of ['cbStrip', 'cbRate', 'cbDivOf', 'cbDivIncomeKRW', 'cbDefaultDivMonths', 'cbAddDivMonthDetail', 'cbDivMonthlyForYear'])
    vm.runInContext(extractFunction(cobalt, n), dctx)
  vm.runInContext('syncDivHistory()', dctx)
  const item = dctx.pfolioData[0]
  const annual = dctx.cbDivIncomeKRW(item)
  near(annual, 1.04 * 100 * RATES.USD, '홈·배당 화면 연간 배당')
  const page = vm.runInContext(`cbDivMonthlyForYear([{i:pfolioData[0],tkr:'SCHD',title:'SCHD',d:cbDivOf(pfolioData[0]),incomeKRW:cbDivIncomeKRW(pfolioData[0])}], '${year}')`, dctx).monthAmt
  const hist = dctx.divHistory[year]['본인']
  for (let m = 0; m < 12; m++) near(hist[m], page[m], `${m + 1}월 배당: 결산(divHistory) = 배당 화면`)
  near(hist.reduce((s, v) => s + v, 0), annual, '결산 12달 합 = 연간 배당(25% 부풀림 없음)')
  // VOO 는 조회 캐시에 없다 — 배당 화면에도 없으므로 결산도 내장 배당표·수익률 추정으로 지어내지 않는다.
  assert.equal(dctx.divHistory[year]['아내'].reduce((s, v) => s + v, 0), 0, '조회되지 않은 종목은 결산에도 0')
  assert.match(script, /if\(s\._divSource==='db'\) return;\n\s*const eps=divPerPaymentDps\(s\);/, '현금 흐름 자동 배당도 같은 1회 금액 · 내장 배당표로 금액을 만들지 않는다')
}

console.log('PASS: 화면별 숫자 일관성 — 평가액(보유 목록·홈/계좌별·비중 지도·순자산 기록·결산)과 배당(배당 화면·결산·현금 흐름)이 같은 종목에 같은 금액')
