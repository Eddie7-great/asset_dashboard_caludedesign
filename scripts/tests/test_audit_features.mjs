#!/usr/bin/env node
// 2026-11-25 점검 제안 시안 1·2차(사용자 확정) — 새로 넣은 계산 함수들을 원본 그대로 vm 에 올려 값으로 고정한다.
// 차트 공부 지표 · 실제 흔들림·상관 · 고점 대비 하락 · 스트레스 · 진짜 수익률(TWR) · 환율 효과 · 손실 상계 후보 ·
// 목표 달성 확률 · 세금 덜 내는 매도 순서 · 매수 평균 환율 · 현금 흐름 월 합계·저축률 · 예산 정규화 · 시세 바뀜 표시 · 빈 화면 한 벌
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { readSource, assetValueSource } from './_source.mjs'

const cobalt = readSource('cobalt.js')
const script = readSource('script.js')
const finance = fs.readFileSync(new URL('../../finance.js', import.meta.url), 'utf8')
const workspace = fs.readFileSync(new URL('../../workspace-pages.js', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../../workspace-ui.css', import.meta.url), 'utf8')

function extractFunction(source, name) {
  const asyncStart = source.indexOf(`async function ${name}(`)
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} 함수를 찾을 수 없음`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1) }
  }
  throw new Error(`${name} 함수의 닫는 괄호를 찾을 수 없음`)
}
const load = (ctx, source, names) => names.forEach(n => vm.runInContext(extractFunction(source, n), ctx))
const plain = v => JSON.parse(JSON.stringify(v))
const near = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≈ ${b}`)

// ── 차트 공부: 이동평균·지수이동평균·RSI·교차 ──
{
  const ctx = vm.createContext({ Math, Array, Number })
  load(ctx, cobalt, ['chsSma', 'chsEma', 'chsRsi', 'chsMacd', 'chsLastCross'])
  assert.deepEqual(plain(ctx.chsSma([1, 2, 3, 4, 5], 3)), [null, null, 2, 3, 4], '단순 이동평균')
  assert.deepEqual(plain(ctx.chsEma([1, 2, 3, 4, 5], 3)), [null, null, 2, 3, 4], '지수 이동평균은 첫 n개 평균에서 시작')
  assert.deepEqual(plain(ctx.chsEma([1, 2], 3)), [null, null], '자료가 n개보다 적으면 비움')
  const rsi = ctx.chsRsi([1, 2, 1, 2], 2)
  assert.equal(rsi[2], 50, 'RSI — 오른 폭과 내린 폭이 같으면 50')
  assert.equal(rsi[3], 75, 'RSI — 와일더 평활')
  assert.equal(ctx.chsRsi([1, 2, 3, 4], 2)[3], 100, '내린 날이 없으면 100')
  assert.deepEqual(plain(ctx.chsLastCross([1, 1, 3], [2, 2, 2])), { kind: 'golden', ago: 0, at: 2 }, '아래에서 위로 = 골든')
  assert.deepEqual(plain(ctx.chsLastCross([3, 3, 1, 1], [2, 2, 2, 2])), { kind: 'dead', ago: 1, at: 2 }, '위에서 아래로 = 데드, 며칠 전인지')
  assert.equal(ctx.chsLastCross([1, 1], [2, 2]), null, '교차 없음')
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i)
  const m = ctx.chsMacd(closes)
  assert.equal(m.macd.length, 60); assert.equal(m.macd[24], null); assert.notEqual(m.macd[25], null)
  assert.equal(m.signal[32], null, '시그널은 MACD 9개가 모인 뒤'); assert.notEqual(m.hist[33], null)
}

// ── 실제 흔들림(연 변동성)·주간 상관 ──
{
  const ctx = vm.createContext({ Math, Array, Number, Map, Date })
  load(ctx, cobalt, ['cbRealVol', 'cbRealVolFromCum', 'cbWeeklyCloses', 'cbCorrPair'])
  const closes = Array.from({ length: 51 }, (_, i) => (i % 2 ? 101 : 100))
  const bars = closes.map((c, i) => ({ t: 1_700_000_000 + i * 86400, c }))
  const r = Math.log(101 / 100), n = 50
  near(ctx.cbRealVol(bars), Math.sqrt(n * r * r / (n - 1)) * Math.sqrt(252), 1e-12, '일간 로그수익률 표본표준편차 × √252')
  assert.equal(ctx.cbRealVol(bars.slice(0, 39)), null, '40일 미만은 계산하지 않음')
  const cum = closes.map(c => (c / 100 - 1) * 100)
  near(ctx.cbRealVolFromCum(cum), ctx.cbRealVol(bars), 1e-12, '누적 수익률 시리즈로 잰 값도 같다(벤치마크·포트폴리오)')
  const day = s => Date.UTC(...s.split('-').map((v, k) => k === 1 ? v - 1 : +v)) / 1000
  const wk = ctx.cbWeeklyCloses(['2026-11-16', '2026-11-18', '2026-11-20', '2026-11-23'].map((d, k) => ({ t: day(d), c: 10 + k })))
  assert.deepEqual([...wk.entries()], [['2026-11-16', 12], ['2026-11-23', 13]], '주 단위 = 그 주 월요일 키, 마지막 종가')
  const keys = Array.from({ length: 30 }, (_, i) => `w${String(i).padStart(2, '0')}`)
  const a = new Map(keys.map((k, i) => [k, 100 * Math.exp(Math.sin(i) / 10)]))
  const inv = new Map(keys.map((k, i) => [k, 1 / a.get(k)]))
  near(ctx.cbCorrPair(a, a), 1, 1e-12, '같은 움직임 = 1')
  near(ctx.cbCorrPair(a, inv), -1, 1e-12, '정반대 = -1')
  assert.equal(ctx.cbCorrPair(a, new Map(keys.slice(0, 20).map(k => [k, a.get(k)]))), null, '겹치는 주가 21주 미만이면 계산하지 않음')
}

// ── 고점 대비 하락 ──
{
  const ctx = vm.createContext({ Math, Array, Number })
  load(ctx, cobalt, ['cbDrawdownSeries', 'cbDrawdownStats'])
  const dd = ctx.cbDrawdownSeries([0, 10, 5, -1, 10, 21, null])
  near(dd[2], (1.05 / 1.1 - 1) * 100); near(dd[3], -10); assert.equal(dd[4], 0); assert.equal(dd[6], null)
  assert.deepEqual(plain(ctx.cbDrawdownStats(dd)), { max: dd[3], at: 3, start: 2, fallDays: 1, recoverDays: 1, now: 0 }, '가장 깊은 하락·내려간 기간·회복 기간')
  const open = ctx.cbDrawdownStats(ctx.cbDrawdownSeries([0, -20, -10]))
  assert.equal(open.recoverDays, null, '아직 회복하지 못함'); near(open.now, -10)
}

// ── 스트레스 시나리오: 같은 평가액 함수 · 레버리지 배수 · 외화 자산만 환율 ──
{
  const ctx = vm.createContext({ Math, Array, Number, Object, OWNERS: ['본인', '아내', '자녀1', '아버지'], RATES: { USD: 1000, KRW: 1 } })
  vm.runInContext(assetValueSource(), ctx)
  ctx.cbCls = i => i.cls
  ctx.cbLeveragedInverseMeta = i => i.lev || null
  load(ctx, cobalt, ['cbStressRun'])
  const res = ctx.cbStressRun([
    { owner: '본인', grp: '주식', cls: 'us', cur: 'USD', qty: 10, curP: 100 },
    { owner: '아내', grp: '주식', cls: 'kr', cur: 'KRW', qty: 100, curP: 10000 },
    { owner: '본인', grp: '현금', cls: 'cash', cur: 'KRW', qty: 500000, curP: 1 },
    { owner: '본인', grp: '주식', cls: 'us', cur: 'KRW', qty: 1, curP: 1_000_000, lev: { kind: '레버리지', mult: 2 } },
  ], { us: -30, kr: -30, jp: 0, crypto: 0, gold: 0, fx: 10 })
  assert.equal(res.before, 3_500_000)
  assert.equal(Math.round(res.after), 770_000 + 700_000 + 500_000 + 400_000, '해외 −30%·환율 +10% / 국내 −30% / 현금 그대로 / 2배 레버리지 −60%')
  assert.deepEqual(plain(res.byOwner).map(o => [o.owner, Math.round(o.after)]), [['본인', 1_670_000], ['아내', 700_000]], '소유주 순서 고정')
}

// ── 진짜 수익률(시간가중): 입금 절반을 기초에 더해 나눈 월 수익률을 이어 곱한다 ──
{
  const ctx = vm.createContext({ Math, Array, Number, Map, String })
  ctx.reportHoldingDiff = (a, b) => b.d
  load(ctx, workspace, ['reportPrevYm', 'reportTwrSeries'])
  const tl = [
    { ym: '2026-08', entry: { holdings: {} } },
    { ym: '2026-09', entry: { holdings: { d: { prevTotal: 100, flow: 20, market: 11, curTotal: 131 } } } },
    { ym: '2026-10', src: 'live', entry: { holdings: { d: { prevTotal: 131, flow: 0, market: -13.1, curTotal: 117.9 } } } },
  ]
  const s = plain(ctx.reportTwrSeries(tl, null, ['2026-08', '2026-09', '2026-10']))
  assert.equal(s[0].none, true, '앞 달 기록이 없으면 빗금')
  near(s[1].r, 0.1); near(s[2].r, -0.1); near(s[2].cum, 1.1 * 0.9 - 1); assert.equal(s[2].months, 2); assert.equal(s[2].live, true)
}

// ── 환율 효과: 손익 = 주가 몫(지금 환율) + 환율 몫(매수 평균 환율 대비) ──
{
  const ctx = vm.createContext({ Math, Array, Number, String, RATES: { USD: 1400, KRW: 1 } })
  vm.runInContext(assetValueSource(), ctx)
  load(ctx, cobalt, ['cbFxEffectRows'])
  const rows = ctx.cbFxEffectRows([
    { tkr: 'NOFX', grp: '주식', cur: 'USD', qty: 1, avgP: 100, curP: 300 },
    { tkr: 'AAPL', grp: '주식', cur: 'USD', qty: 10, avgP: 100, curP: 120, avgFx: 1300 },
    { tkr: '005930', grp: '주식', cur: 'KRW', qty: 1, avgP: 1, curP: 2 },
    { tkr: 'X', grp: '주식', cur: 'USD', qty: 1, avgP: 1, curP: 2, costUnknown: true },
  ])
  assert.deepEqual(rows.map(r => r.i.tkr), ['AAPL', 'NOFX'], '원화·취득가 미상은 빼고, 환율을 아는 종목 먼저')
  assert.equal(rows[0].gain, 280_000); assert.equal(rows[0].fx, 100_000)
  assert.equal(rows[0].total, 10 * 120 * 1400 - 10 * 100 * 1300, '합계 = 지금 원화 평가액 − 매수 때 원화 원가')
  assert.equal(rows[1].fx, null); assert.equal(rows[1].total, null, '매수 환율을 모르면 지어내지 않음')
}

// ── 손실 상계 후보: 줄 합계 = 카드의 '줄일 세금'(cbTaxHarvestPlan) ──
{
  const ctx = vm.createContext({ Math, Array, Number, Map })
  load(ctx, cobalt, ['cbTaxHarvestPlan', 'cbTaxHarvestRows'])
  const cand = (owner, tkr, loss) => ({ i: { owner, tkr }, loss })
  const cases = [
    [[{ label: '본인', genBase: 1_000_000 }, { label: '아내', genBase: 0 }], [cand('본인', 'A', -700_000), cand('본인', 'B', -500_000), cand('아내', 'C', -300_000)]],
    [[{ label: '본인', genBase: 333_333 }], [cand('본인', 'A', -111_111), cand('본인', 'B', -444_444)]],
    [[{ label: '본인', genBase: 500_001 }], [cand('본인', 'A', -250_001), cand('본인', 'B', -250_001)]],
  ]
  for (const [buckets, cs] of cases) {
    const rows = ctx.cbTaxHarvestRows(buckets, cs, 0.22)
    assert.equal(rows.reduce((s, r) => s + r.save, 0), ctx.cbTaxHarvestPlan(buckets, cs, 0.22).save, '줄을 더하면 카드 값과 1원도 다르지 않다')
  }
  const rows = plain(ctx.cbTaxHarvestRows(...cases[0], 0.22))
  assert.deepEqual(rows.map(r => [r.i.tkr, r.used, r.save]), [['A', 700_000, 154_000], ['B', 300_000, 66_000], ['C', 0, 0]], '큰 손실부터 과세표준을 채우고, 공제 안인 사람은 0')
}

// ── 목표 달성 확률(몬테카를로): 같은 씨앗이면 같은 숫자, 흔들림 0 이면 계산값 그대로 ──
{
  const ctx = vm.createContext({ Math, Array, Number, Float64Array })
  load(ctx, finance, ['finMcRng', 'finGoalMonteCarlo'])
  const flat = ctx.finGoalMonteCarlo({ start: 1000, monthly: 100, mu: 0, sigma: 0, months: 12, target: 2200, n: 100 })
  assert.equal(flat.prob, 1); near(flat.final.p50, 2200, 1e-9); assert.equal(flat.final.paid, 2200)
  assert.equal(ctx.finGoalMonteCarlo({ start: 1000, monthly: 100, mu: 0, sigma: 0, months: 12, target: 2201, n: 100 }).prob, 0)
  const o = { start: 10_000_000, monthly: 500_000, mu: 0.05, sigma: 0.2, months: 120, target: 90_000_000, seed: 7, n: 500 }
  const a = plain(ctx.finGoalMonteCarlo(o)), b = plain(ctx.finGoalMonteCarlo(o))
  assert.deepEqual(a, b, '다시 그려도 숫자가 같다(씨앗 고정)')
  assert.ok(a.prob > 0 && a.prob < 1)
  a.pts.forEach(p => assert.ok(p.p10 <= p.p50 && p.p50 <= p.p90, '10% ≤ 가운데 ≤ 90%'))
  assert.ok(a.pts.length <= 62, '그림 점은 60개 안팎')
}

// ── 세금 덜 내는 매도 순서: 비과세·계좌 안 먼저, 해외는 손실 종목부터(남은 공제를 아낀다) ──
{
  const ctx = vm.createContext({ Math, Array, Number, String, Map })
  ctx.getAccountDivTaxInfo = acc => ({ type: acc === 'ISA' ? 'ISA' : '일반' })
  ctx.cbCls = i => i.cls
  load(ctx, finance, ['finSellKind', 'finTaxAwareSellPlan'])
  const rows = [
    { i: { owner: '본인', grp: '주식', acc: 'ISA', cur: 'KRW', cls: 'kr', tkr: 'ISA' }, val: 500, gain: 100 },
    { i: { owner: '본인', grp: '주식', acc: '일반', cur: 'USD', cls: 'us', tkr: 'A' }, val: 1000, gain: 500 },
    { i: { owner: '본인', grp: '주식', acc: '일반', cur: 'USD', cls: 'us', tkr: 'B' }, val: 1000, gain: -200 },
    { i: { owner: '본인', grp: '주식', acc: '일반', cur: 'KRW', cls: 'kr', tkr: 'KR' }, val: 300, gain: 0 },
  ]
  const p = plain(ctx.finTaxAwareSellPlan(rows, 2500, { rate: 0.22, deduction: 100 }))
  assert.deepEqual(p.rows.map(r => [r.i.tkr, r.kind, r.sell, r.tax]), [['KR', 'kr-exempt', 300, 0], ['ISA', 'shelter', 500, 0], ['B', 'foreign', 1000, 0], ['A', 'foreign', 700, 11]])
  assert.equal(p.rows[3].used, 300, '손실로 넓어진 공제(100 + 200)를 먼저 쓴다')
  assert.equal(p.tax, 11); assert.equal(p.left, 0)
  assert.equal(ctx.finTaxAwareSellPlan(rows, 5000, { rate: 0.22, deduction: 100 }).left, 2200, '다 팔아도 모자라면 남은 금액')
}

// ── 매수 평균 환율: 매입금액(외화) 가중, 이번 환율을 모르면 지운다 ──
{
  const ctx = vm.createContext({ Math, Number, String, OWNERS: ['본인'] })
  load(ctx, script, ['tradeApplyPlan'])
  const base = { grp: '주식', cur: 'USD', qty: 10, avgP: 100, avgFx: 1300, owner: '본인' }
  const buy = t => ctx.tradeApplyPlan(base, { side: 'buy', date: '2026-11-20', today: '2026-11-25', ...t })
  near(buy({ qty: 10, price: 200, fx: 1450 }).next.avgFx, (1000 * 1300 + 2000 * 1450) / 3000, 1e-9)
  assert.equal(buy({ qty: 10, price: 200 }).next.avgFx, null, '이번 매수 환율이 없으면 틀린 평균을 남기지 않는다')
  assert.ok(!('avgFx' in ctx.tradeApplyPlan({ ...base, avgFx: undefined }, { side: 'buy', qty: 1, price: 1, date: '2026-11-20', today: '2026-11-25' }).next), '적지 않은 종목은 손대지 않음')
}

// ── 현금 흐름 월 합계·저축률: 화면 요약·구성·6개월 추이가 같은 한 곳 ──
{
  const ctx = vm.createContext({ Math, Number, Object, String, Date, Array, FIN_SAVING_CATS: ['저축/투자'] })
  vm.runInContext("var _cfOwner='전체'; const CF_OWNERS=['본인','아내'];", ctx)
  ctx.cfData = [
    { date: '2026-11-03', type: '수입', cat: '급여', amt: 5_000_000, owner: '본인' },
    { date: '2026-11-05', type: '지출', cat: '식비', amt: 1_000_000, owner: '아내' },
    { date: '2026-11-06', type: '지출', cat: '저축/투자', amt: 2_000_000, owner: '본인' },
    { date: '미정', divKey: 'div_AAPL_본인_일반_2026_11', type: '수입', cat: '배당금', amt: 30_000, owner: '본인' },
    { date: '2026-11-07', type: '수입', cat: '부부 송금', amt: 900_000, owner: '본인', xferRole: 'in' },
    { date: '2026-11-08', type: '지출', cat: '용돈', amt: 70_000, owner: '자녀1' },
    { date: '2026-10-08', type: '지출', cat: '식비', amt: 1, owner: '본인' },
  ]
  ctx.autoTransferData = [
    { id: 1, type: '수입', cat: '임대수입', amt: 400_000, cycle: 'monthly', owner: '아내' },
    { id: 2, type: '지출', amt: 100_000, cycle: 'monthly', owner: '본인' },
  ]
  ctx._autoTransferMonthlyOccurrences = () => [15]
  ctx._effectiveAutoTransferAmt = at => at.amt
  load(ctx, script, ['cfInScope', 'cfIsXferMove', 'cfRowCounts', '_cfRowYm', '_cfAutoTransferMonthAmount', '_cfAutoTransferMonthTotals', 'cfMonthTotals', 'cfSavingRate'])
  const t = plain(ctx.cfMonthTotals(2026, 11))
  assert.equal(t.tIn, 5_000_000 + 30_000 + 400_000, "날짜 '미정' 배당·수입 자동이체 포함, 부부 송금·자녀 제외")
  assert.equal(t.tOut, 1_000_000 + 2_000_000 + 100_000)
  assert.deepEqual(t.incomeByCat, { 급여: 5_000_000, 배당금: 30_000, 임대수입: 400_000 }, '수입 자동이체도 구성에 들어간다')
  assert.equal(t.expByCat.기타, 100_000, '카테고리 없는 자동이체는 기타')
  const sr = plain(ctx.cfSavingRate(t))
  assert.equal(sr.savingOut, 2_000_000); assert.equal(sr.kept, 5_430_000 - 1_100_000); near(sr.rate, 4_330_000 / 5_430_000 * 100)
  assert.equal(ctx.cfSavingRate({ tIn: 0, tOut: 5, expByCat: {} }).rate, null, '수입이 없는 달은 저축률을 내지 않는다')
  assert.match(script, /function cfStackRows\(y, ?m\)\{[\s\S]*?cfMonthTotals\(/, '6개월 누적 막대도 같은 합계 함수')
  assert.match(script, /const \{tIn,tOut,expByCat\}=cfMonthTotals\(cfYear,cfMonth\)/, '화면 요약도 같은 합계 함수')
}

// ── 예산 기능은 없앴다(2026-11-26 사용자 결정) — 저장값도 함께 지운다: 저장 payload·로드·되돌리기 어디에도 남기지 않는다 ──
{
  assert.doesNotMatch(script, /cfBudget|_normalizeCfBudget/, '예산 저장값을 읽거나 쓰는 코드가 남지 않는다')
  assert.doesNotMatch(cobalt, /_cfBudgetEdit/, '예산 입력 상태가 남지 않는다')
}

// ── 시세 바뀜 표시: 오른 칸·내린 칸만, 같은 종목 여러 계좌가 엇갈리면 합친 줄은 표시하지 않음 ──
{
  const classes = () => { const s = new Set(); return { add: (...c) => c.forEach(x => s.add(x)), remove: (...c) => c.forEach(x => s.delete(x)), has: c => s.has(c) } }
  const els = ['a', 'b', 'm'].map(k => ({ k, classList: classes(), offsetWidth: 1 }))
  const ctx = vm.createContext({ Math, Number, String, Map, encodeURIComponent, setTimeout: () => 0 })
  ctx.document = { querySelectorAll: () => els.map(e => ({ classList: e.classList, offsetWidth: 1, getAttribute: () => e.key })) }
  ctx._splitRowKey = i => i.id
  load(ctx, script, ['liveKeyOf', 'livePriceSnap', 'livePriceChanged', 'liveFlashApply'])
  vm.runInContext("var pfolioData=[{id:'1',owner:'본인',tkr:'AAPL',grp:'주식',curP:100},{id:'2',owner:'본인',tkr:'AAPL',grp:'주식',curP:100},{id:'3',owner:'본인',tkr:'KRW',grp:'현금',curP:1}]", ctx)
  const before = ctx.livePriceSnap()
  assert.deepEqual([...before.keys()], ['1', '2'], '현금은 보지 않는다')
  vm.runInContext("pfolioData[0].curP=101; pfolioData[1].curP=99", ctx)
  const ch = ctx.livePriceChanged(before)
  assert.equal(ch.get('1'), 'up'); assert.equal(ch.get('2'), 'down')
  assert.equal(ch.get(encodeURIComponent('본인|AAPL')), 'mixed', '합친 줄(홈 표)은 방향이 엇갈리면 표시 안 함')
  els[0].key = '1'; els[1].key = '2'; els[2].key = encodeURIComponent('본인|AAPL')
  assert.equal(ctx.liveFlashApply(ch), 2)
  assert.ok(els[0].classList.has('is-live-up') && els[1].classList.has('is-live-dn') && !els[2].classList.has('is-live-up'))
  assert.equal(ctx.liveFlashApply(new Map()), 0)
  assert.match(script, /const priceBefore=typeof livePriceSnap==='function'\?livePriceSnap\(\):null;[\s\S]*?!\(typeof _boot!=='undefined'&&_boot\)\) liveFlashApply\(livePriceChanged\(priceBefore\)\)/, '시세 새로고침 때만, 로딩 화면 중에는 하지 않음')
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{[^}]*is-live-up[^}]*animation:none/, '움직임 줄이기에서는 끈다')
}

// ── 빈 화면 한 벌 ──
{
  const ctx = vm.createContext({})
  load(ctx, workspace, ['cbEmptyHtml'])
  assert.equal(ctx.cbEmptyHtml('없음', '', null), '<div class="cb-empty-state" role="status"><b>없음</b></div>')
  const html = ctx.cbEmptyHtml('t', 'b', [{ label: '첫째', onclick: 'a()' }, { label: '둘째', onclick: 'b()' }, { onclick: 'x()' }], { compact: true })
  assert.match(html, /^<div class="cb-empty-state is-compact" role="status"><b>t<\/b><p>b<\/p><div class="cb-empty-actions"><button type="button" class="cb-btn is-main" onclick="a\(\)">첫째<\/button><button type="button" class="cb-btn" onclick="b\(\)">둘째<\/button><\/div><\/div>$/, '첫 버튼만 굵게, 이름 없는 버튼은 버림')
  assert.doesNotMatch(css, /\.cb-empty-actions[^{]*\.is-main\{[^}]*background/, '버튼은 중립 톤 — 강조색 채움 없음')
}

console.log('test_audit_features: ok')

// 화면을 옮기면 고른 목표는 비운다(가정 수익률·스트레스 시나리오는 설정이라 둔다)
{
  const reset = extractFunction(cobalt, 'cbResetViewState')
  assert.match(reset, /_finMcSel=null;/)
  assert.doesNotMatch(reset, /_finMcRet=|_cbStress=/)
}
console.log('test_audit_features: reset ok')
