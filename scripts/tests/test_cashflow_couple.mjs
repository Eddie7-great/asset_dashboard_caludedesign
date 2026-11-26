#!/usr/bin/env node
// 부부 현금 흐름(2026-11-23): 현금 흐름 화면은 본인·아내만 다루고, 아내 → 본인 송금은
// 부부 합계에서 빼며, 아내 지출은 '수입 − 따로 적은 지출 − 보낸 돈'으로 추정한다.
// 2026-11-26: 흐름 카드가 생키(cfSankeyData·cfSankeySvg)로 바뀌고, 아내 월급·송금은 기록 창(cfWifeSave)에서 적는다.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { readSource } from './_source.mjs'

const source = readSource('script.js')
const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const nav = fs.readFileSync(new URL('../../navigation.js', import.meta.url), 'utf8')

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} 함수를 찾을 수 없음`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1) }
  }
  throw new Error(`${name} 닫는 괄호 없음`)
}
function extractConstLine(name) {
  const m = source.match(new RegExp(`^const ${name}\\s*=.*$`, 'm'))
  assert.notEqual(m, null, `${name} 선언 없음`)
  return m[0]
}

const ctx = {
  _cfOwner: '전체', cfData: [], autoTransferData: [],
  ownerColors: { 본인: '#5b9bff', 아내: '#f2a33c' },
  cfColors: { 식비: '#e57373', '의료/건강': '#64b5f6', '저축/투자': '#81c784', 배당금: '#ffd54f', '아내 지출(추정)': '#f2a33c', 기타: '#94a3c8', 급여: '#4caf50' },
  FIN_SAVING_CATS: ['저축/투자'],
  _autoTransferMonthlyOccurrences: () => [{ date: new Date(2026, 10, 25) }],
  _effectiveAutoTransferAmt: at => at.amt,
  _cfLocalDateKey: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
  _getCycleLabel: () => '매월 25일',
  _cfEsc: v => String(v == null ? '' : v),
  isMobileLayout: () => false,
}
vm.createContext(ctx)
vm.runInContext(extractConstLine('CF_OWNERS'), ctx)
vm.runInContext("const CF_XFER_FROM = '아내', CF_XFER_TO = '본인';", ctx)
assert.match(source, /^const CF_XFER_FROM = '아내', CF_XFER_TO = '본인';$/m, '송금 방향 상수')
for (const n of ['CF_XFER_CAT', 'CF_XFER_EST_CAT']) vm.runInContext(extractConstLine(n), ctx)
for (const n of ['CF_FLOW_REST_COLOR', 'CF_FLOW_SMALL_SHARE']) vm.runInContext(extractConstLine(n), ctx)
vm.runInContext('var _cfSkSeq = 0;', ctx)
for (const n of ['cfInScope', 'cfScopeLabel', 'cfIsXferMove', 'cfRowCounts', '_cfRowYm', 'shortWon', 'cfShortWon',
  '_cfAutoTransferMonthAmount', '_cfAutoTransferMonthTotals', 'cfPersonMonth', 'cfSpouseEstimate', 'cfSpouseSync',
  '_cfPersonByCat', '_cfIncomeLabel', 'cfSankeyData', '_cfSpreadLabels', 'cfSankeySvg', 'cfSankeyListHtml',
  'cfMonthTotals', 'cfSavingRate', 'cfStackRows', 'cfStackHtml', 'cfWifePaySources', '_cfMaterializeAutoTransfer', 'cfWifeSave'])
  vm.runInContext(extractFunction(n), ctx)

// 11월: 본인 월급 450만(기록) · 지출 300만, 아내 월급 320만(자동이체 예정) · 보험 10만(기록), 아내 배당 1만, 자녀1 배당 5만
ctx.cfData.push(
  { date: '2026-11-25', type: '수입', cat: '급여', desc: '월급', amt: 4_500_000, owner: '본인' },
  { date: '2026-11-10', type: '지출', cat: '식비', desc: '생활비', amt: 3_000_000, owner: '본인' },
  { date: '2026-11-05', type: '지출', cat: '의료/건강', desc: '보험', amt: 100_000, owner: '아내' },
  { date: '2026-11-15', type: '수입', cat: '배당금', desc: '[자동] 배당', amt: 10_000, owner: '아내' },
  { date: '2026-11-15', type: '수입', cat: '배당금', desc: '[자동] 배당', amt: 50_000, owner: '자녀1' },
)
ctx.autoTransferData.push({ id: 1, type: '수입', cat: '급여', desc: '아내 월급', amt: 3_200_000, cycle: 'monthly', owner: '아내' })

// 송금 기록 전: 묶음 없음
assert.equal(ctx.cfSpouseSync(), false, '송금이 없으면 바꿀 것이 없다')
// 송금 기록(in 한 줄) → sync 가 out·est 를 만든다
ctx.cfData.push({ date: '2026-11-27', type: '수입', cat: '부부 송금', desc: '아내가 보낸 남은 돈', amt: 1_000_000, owner: '본인', xferMonth: '2026-11', xferRole: 'in' })
assert.equal(ctx.cfSpouseSync(), true)
const out = ctx.cfData.find(c => c.xferRole === 'out'), est = ctx.cfData.find(c => c.xferRole === 'est')
assert.deepEqual([out.owner, out.type, out.amt, out.date], ['아내', '지출', 1_000_000, '2026-11-27'], '아내 쪽 송금 줄')
assert.equal(est.amt, 3_200_000 - 100_000 - 1_000_000, '아내 지출 추정 = 월급 − 따로 적은 지출 − 보낸 돈 (배당 제외)')
assert.equal(ctx.cfSpouseSync(), false, '두 번 맞춰도 그대로')

// 받은 금액을 고치면 out·est 가 따라온다
ctx.cfData.find(c => c.xferRole === 'in').amt = 1_500_000
assert.equal(ctx.cfSpouseSync(), true)
assert.equal(ctx.cfData.find(c => c.xferRole === 'out').amt, 1_500_000)
assert.equal(ctx.cfData.find(c => c.xferRole === 'est').amt, 1_600_000)

// 합계 규칙: 부부 합계는 송금(in·out)을 빼고, 자녀1은 넣지 않는다
const ym = r => r.date.slice(0, 7) === '2026-11'
const sum = owner => {
  let tin = 0, tout = 0
  ctx.cfData.filter(ym).forEach(r => { if (ctx.cfRowCounts(r, owner)) { if (r.type === '수입') tin += r.amt; else tout += r.amt } })
  return { tin, tout }
}
const all = sum('전체'), me = sum('본인'), wife = sum('아내')
// 기록된 줄만(아내 월급 자동이체는 예정 금액이라 별도) — 부부 합계 = 본인 + 아내 − 송금 양쪽
assert.equal(all.tin, me.tin + wife.tin - 1_500_000, '부부 합계 수입에서 받은 송금을 뺀다')
assert.equal(all.tout, me.tout + wife.tout - 1_500_000, '부부 합계 지출에서 보낸 송금을 뺀다')
assert.equal(all.tin - all.tout, (me.tin - me.tout) + (wife.tin - wife.tout), '송금 두 줄은 서로 상쇄 — 순현금흐름은 같다')
assert.equal(ctx.cfRowCounts({ owner: '자녀1', type: '수입', amt: 1 }, '전체'), false, '자녀1은 부부 합계에 없다')
assert.equal(ctx.cfRowCounts({ owner: '아버지', type: '수입', amt: 1 }, '전체'), false, '아버지는 부부 합계에 없다')

// 아내 쪽은 배당만 남는다(월급 − 보험 − 송금 − 추정 = 0)
const w = ctx.cfPersonMonth('아내', '2026-11')
assert.equal(w.income + w.dividend - w.expense - w.xferOut - w.est, 10_000, '아내 쪽에 남는 돈은 배당뿐')

// 돈의 흐름(생키) — 통장마다 들어온 돈 = 나간 돈(띠 굵기가 맞아야 그림이 거짓말하지 않는다)
ctx.cfYear = 2026; ctx.cfMonth = 11
const flowOf = ym => {
  const d = ctx.cfSankeyData(ym)
  const inOf = id => d.L.filter(l => l.t === id).reduce((a, l) => a + l.v, 0)
  const outOf = id => d.L.filter(l => l.s === id).reduce((a, l) => a + l.v, 0)
  return { d, inOf, outOf }
}
{
  const { d, inOf, outOf } = flowOf('2026-11')
  for (const id of ['aWife', 'aMe']) {
    assert.equal(inOf(id), d.N[id].v, `${id} 막대 = 들어온 띠 합`)
    assert.equal(outOf(id), d.N[id].v, `${id} 막대 = 나간 띠 합`)
  }
  assert.equal(d.N.sWife.label, '아내 급여', '급여뿐이면 이름이 급여')
  assert.equal(d.N.sWife.v, 3_200_000, '아내 월급(자동이체 예정)이 들어온 돈')
  assert.equal(d.L.find(l => l.s === 'aWife' && l.t === 'aMe').v, 1_500_000, '송금 띠 = 보낸 돈')
  assert.equal(d.N.eWest.v, 1_600_000, '아내 지출(추정) = 월급 − 보험 − 송금')
  assert.equal(d.N.wRest.v, 10_000, '아내 남은 돈 = 배당')
  assert.equal(d.N.rest.v, 4_500_000 + 1_500_000 - 3_000_000, '본인 남은 돈 = 월급 + 받은 돈 − 지출')
  assert.equal(d.N.sDiv.v, 10_000, '배당은 부부 것만(자녀1 배당 제외)')
  assert.ok(!d.N.sDraw, '적자가 아니면 모아 둔 돈에서 꺼낸 줄이 없다')
  // 그림: NaN 없이, 금액 이름표·송금 표시·화면 읽기 이름
  const svg = ctx.cfSankeySvg(d, 1150, 360)
  assert.doesNotMatch(svg, /NaN|undefined|Infinity/, '좌표가 모두 숫자')
  assert.match(svg, /<svg class="cf-sankey-svg" viewBox="0 0 1150 360"[^>]*role="img" aria-label="11월 돈의 흐름 — 들어온 돈: /)
  assert.match(svg, /class="cf-sk-xfer"[^>]*>송금 150만</, '송금 띠에 금액')
  assert.match(svg, /<title>아내 통장 → 본인 통장 ₩1,500,000<\/title>/, '띠에 마우스를 올리면 정확한 금액')
  assert.match(ctx.cfSankeyListHtml(d), /들어온 돈[\s\S]*아내 → 본인 송금 <b>150만<\/b>[\s\S]*나간 돈 · 남은 돈/, '휴대폰 목록')
}
// 적자인 달 — 나간 돈이 더 많으면 '모아 둔 돈에서'가 차이를 메운다(12월은 아내 월급 320만이 아내 남은 돈)
ctx.cfData.push({ date: '2026-12-03', type: '수입', cat: '급여', desc: '월급', amt: 1_000_000, owner: '본인' },
  { date: '2026-12-04', type: '지출', cat: '식비', desc: '생활비', amt: 1_400_000, owner: '본인' })
{
  const { d, inOf, outOf } = flowOf('2026-12')
  assert.equal(d.N.sDraw.v, 400_000, '본인 적자 40만')
  assert.equal(inOf('aMe'), outOf('aMe'), '적자여도 통장 양쪽 굵기가 같다')
  assert.ok(!d.N.rest, '남은 돈 없음')
}
ctx.cfData.splice(-2, 2)
// 작은 지출은 '그 밖 N개'로 — 두 개 이상일 때만
ctx.cfData.push({ date: '2026-11-11', type: '지출', cat: '교통/차량', desc: '버스', amt: 50_000, owner: '본인' },
  { date: '2026-11-12', type: '지출', cat: '교육', desc: '책', amt: 40_000, owner: '본인' })
{
  const { d, inOf, outOf } = flowOf('2026-11')
  assert.equal(d.N.mSmall.label, '그 밖 2개'); assert.equal(d.N.mSmall.v, 90_000)
  assert.ok(!d.N['m:교육'] && !d.N['m:교통/차량'], '묶인 카테고리는 따로 그리지 않는다')
  assert.equal(inOf('aMe'), outOf('aMe'))
}
ctx.cfData.splice(-2, 2)

// 6개월 누적 막대 — 쓴 돈 + 아내 지출(추정) + 보낸 돈 + 저축/투자 + 남은 돈 = 수입(흑자 달)
{
  const rows = ctx.cfStackRows(2026, 11)
  assert.equal(rows.length, 6); assert.deepEqual([rows[0].m, rows[5].m], [6, 11], '6월~11월, 고른 달이 맨 오른쪽')
  const r = rows[5]
  assert.equal(r.spend + r.est + r.xfer + r.sv + r.left, r.tIn, '막대 조각의 합 = 그 달 수입')
  assert.equal(r.xfer, 0, '부부 합계에서는 송금을 빼고 센다')
  const html = ctx.cfStackHtml(rows)
  assert.match(html, /수입이 어떻게 나뉘었나 \(6개월\)/)
  assert.match(html, /6개월 저축률 <b>/)
  assert.doesNotMatch(html, /NaN|Infinity/)
}

// 아내 월급·송금 기록 창 저장 — 월급이 자동이체 하나뿐이면 그 달만 기록 줄로 바꾸고, 송금 묶음을 만든다
{
  const fields = {}
  ctx.document = { getElementById: id => (id in fields ? { value: fields[id] } : null) }
  let saved = 0, closed = 0
  Object.assign(ctx, { saveCfData: () => saved++, renderCashFlow: () => {}, saveExtDataToKV: () => {}, cfEntryClose: () => closed++, confirm: () => true })
  vm.runInContext(extractFunction('_cfEntryNum') + '\n' + extractFunction('_cfEntryVal'), ctx)
  const inHead = ctx.cfData.find(c => c.xferRole === 'in')
  const saveHead = { ...inHead }
  ctx.cfData.splice(ctx.cfData.indexOf(inHead), 1); ctx.cfSpouseSync()   // 새 달처럼 묶음 없이 시작
  vm.runInContext("var _cfEntry = { kind: 'in', tab: 'wife', editIdx: -1, ym: '2026-11', xferYm: '' };", ctx)
  const errs = []
  const fail = m => errs.push(m)
  Object.assign(fields, { 'cf-w-pay': '3,300,000', 'cf-w-sent': '', 'cf-w-date': '2026-11-27' })
  ctx.cfWifeSave(fail)
  assert.equal(errs.pop(), '나에게 보낸 돈을 입력하세요.', '보낸 돈이 없으면 저장하지 않는다')
  fields['cf-w-sent'] = '1,200,000'
  ctx.cfWifeSave(fail)
  assert.equal(errs.length, 0)
  const pay = ctx.cfData.filter(c => c.owner === '아내' && c.type === '수입' && c.cat === '급여')
  assert.equal(pay.length, 1); assert.equal(pay[0].amt, 3_300_000); assert.equal(pay[0].atId, 1, '자동이체와 이어진 이 달만 기록(예정 줄이 다시 생기지 않는다)')
  assert.equal(ctx.cfWifePaySources('2026-11').total, 3_300_000, '그 달 아내 월급은 한 번만 센다')
  const head = ctx.cfData.find(c => c.xferRole === 'in' && c.xferMonth === '2026-11')
  assert.deepEqual([head.owner, head.amt, head.date], ['본인', 1_200_000, '2026-11-27'])
  assert.equal(ctx.cfData.find(c => c.xferRole === 'est').amt, 3_300_000 - 100_000 - 1_200_000, '저장하면 아내 지출 추정이 따라온다')
  assert.equal(saved, 1); assert.equal(closed, 1)
  // 월급이 두 곳에 나뉘어 있으면 한 칸으로 고치지 않는다
  ctx.cfData.push({ date: '2026-11-28', type: '수입', cat: '기타', desc: '부업', amt: 100_000, owner: '아내' })
  ctx._cfEntry.xferYm = '2026-11'; fields['cf-w-pay'] = '3,000,000'
  ctx.cfWifeSave(fail)
  assert.match(errs.pop(), /여러 줄/, '여러 줄이면 거부')
  ctx.cfData.splice(-1, 1)
  // 실험분 정리 — 아래 삭제 시험은 예전 묶음(150만)을 기준으로 한다
  ctx.cfData.splice(ctx.cfData.indexOf(pay[0]), 1)
  ctx.cfData.splice(ctx.cfData.indexOf(head), 1, saveHead)
  ctx.cfSpouseSync()
  assert.equal(ctx.cfData.find(c => c.xferRole === 'est').amt, 1_600_000)
}

// 송금 줄을 지우면(in 삭제) 묶음 전체가 정리된다
ctx.cfData.splice(ctx.cfData.findIndex(c => c.xferRole === 'in'), 1)
assert.equal(ctx.cfSpouseSync(), true)
assert.equal(ctx.cfData.some(c => c.xferRole), false, 'in 이 없으면 out·est 도 지운다')
assert.equal(ctx.cfSankeyData('2026-11').N.wRest.v, 3_200_000 - 100_000 + 10_000, '송금이 없으면 아내 월급이 아내 남은 돈으로 남는다(카드가 경고)')

// 화면: 부부 탭만, 자녀1·아버지 없음
assert.match(html, /id="cf-owner-전체"[^>]*>부부 합계<\/button>/)
assert.doesNotMatch(html, /id="cf-owner-(자녀1|아버지)"/, '현금 흐름 소유주 탭에 자녀1·아버지 없음')
assert.doesNotMatch(html, /id="cf-owner-input"|id="cf-input-panel"/, '입력 칸은 기록 창으로 옮겼다 — 새 기록의 소유주는 본인')
assert.match(html, /id="cf-entry-modal"[\s\S]*role="dialog"[\s\S]*id="cf-entry-tabs"/, '수입·지출 기록 창')
assert.match(source, /cfEntryOpen\('in'\)">＋ 수입<\/button><button type="button" class="cf-entry-open" onclick="cfEntryOpen\('out'\)">－ 지출</, '생키 카드의 두 버튼')
assert.doesNotMatch(extractFunction('cfEntryRender'), /매달 반복/, '수입에는 매달 반복이 없다(사용자 결정)')
assert.match(source, /function _normalizeCfRows[\s\S]*xferMonth[\s\S]*xferRole/, '저장 정규화가 송금 묶음 표식을 지킨다')
assert.match(nav, /_cfOwner=CF_OWNERS\.includes\(owner\)\?owner:'전체'/, '다른 화면에서 자녀1·아버지로 들어오면 부부 합계')

// 저장 실패 → 되돌림 → 다시 그림 → 다시 맞춤 → 다시 저장 … 의 무한 반복을 막는다
assert.match(extractFunction('cfSpouseSyncAndSave'), /_cfSpouseSaveBusy\|\|_cfSpouseSaveFailed[\s\S]*_cfSpouseSaveBusy=true[\s\S]*_cfSpouseSaveFailed=true[\s\S]*_cfSpouseSaveBusy=false/, '렌더가 부르는 자동 저장은 한 번에 하나, 실패하면 멈춘다')

console.log('PASS 부부 현금 흐름 — 범위·송금 상쇄·아내 지출 추정·생키·누적 막대·기록 창')
