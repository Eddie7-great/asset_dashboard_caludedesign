#!/usr/bin/env node
// 부부 현금 흐름(2026-11-23): 현금 흐름 화면은 본인·아내만 다루고, 아내 → 본인 송금은
// 부부 합계에서 빼며, 아내 지출은 '수입 − 따로 적은 지출 − 보낸 돈'으로 추정한다.
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
  _autoTransferMonthlyOccurrences: () => [{}],
  _effectiveAutoTransferAmt: at => at.amt,
  _cfEsc: v => String(v == null ? '' : v),
  isMobileLayout: () => false,
  _cfXferFormOpen: false, _cfXferEditYm: '',
}
vm.createContext(ctx)
vm.runInContext(extractConstLine('CF_OWNERS'), ctx)
vm.runInContext("const CF_XFER_FROM = '아내', CF_XFER_TO = '본인';", ctx)
assert.match(source, /^const CF_XFER_FROM = '아내', CF_XFER_TO = '본인';$/m, '송금 방향 상수')
for (const n of ['CF_XFER_CAT', 'CF_XFER_EST_CAT']) vm.runInContext(extractConstLine(n), ctx)
for (const n of ['cfInScope', 'cfScopeLabel', 'cfIsXferMove', 'cfRowCounts', '_cfRowYm',
  '_cfAutoTransferMonthTotals', 'cfPersonMonth', 'cfSpouseEstimate', 'cfSpouseSync', 'cfCoupleFlowHtml'])
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

// 흐름 카드
ctx.cfYear = 2026; ctx.cfMonth = 11
const card = ctx.cfCoupleFlowHtml(2026, 11)
assert.match(card, /11월 우리 집 돈의 흐름[\s\S]*아내[\s\S]*본인에게 보낸 남은 돈[\s\S]*-₩1,500,000[\s\S]*추정[\s\S]*송금[\s\S]*본인[\s\S]*아내에게서 받은 돈[\s\S]*\+₩1,500,000/, '아내 칸 → 송금 → 본인 칸')
// 본인 4,500,000 + 1,500,000 − 3,000,000 = 3,000,000, 아내 10,000 → 부부 합계 3,010,000
assert.match(card, /부부 합계 남은 돈 <b class="c-up">₩3,010,000<\/b>/, '부부 합계 남은 돈 = 두 칸의 합')

// 송금 줄을 지우면(in 삭제) 묶음 전체가 정리된다
ctx.cfData.splice(ctx.cfData.findIndex(c => c.xferRole === 'in'), 1)
assert.equal(ctx.cfSpouseSync(), true)
assert.equal(ctx.cfData.some(c => c.xferRole), false, 'in 이 없으면 out·est 도 지운다')
assert.match(ctx.cfCoupleFlowHtml(2026, 11), /미기록[\s\S]*송금을 기록하기 전까지는/, '미기록 달 안내')

// 화면: 부부 탭만, 자녀1·아버지 없음
assert.match(html, /id="cf-owner-전체"[^>]*>부부 합계<\/button>/)
assert.doesNotMatch(html, /id="cf-owner-(자녀1|아버지)"/, '현금 흐름 소유주 탭에 자녀1·아버지 없음')
assert.match(html, /<select id="cf-owner-input" class="form-input"><option>본인<\/option><option>아내<\/option><\/select>/)
assert.match(source, /function _normalizeCfRows[\s\S]*xferMonth[\s\S]*xferRole/, '저장 정규화가 송금 묶음 표식을 지킨다')
assert.match(nav, /_cfOwner=CF_OWNERS\.includes\(owner\)\?owner:'전체'/, '다른 화면에서 자녀1·아버지로 들어오면 부부 합계')

// 저장 실패 → 되돌림 → 다시 그림 → 다시 맞춤 → 다시 저장 … 의 무한 반복을 막는다
assert.match(extractFunction('cfSpouseSyncAndSave'), /_cfSpouseSaveBusy\|\|_cfSpouseSaveFailed[\s\S]*_cfSpouseSaveBusy=true[\s\S]*_cfSpouseSaveFailed=true[\s\S]*_cfSpouseSaveBusy=false/, '렌더가 부르는 자동 저장은 한 번에 하나, 실패하면 멈춘다')

console.log('PASS 부부 현금 흐름 — 범위·송금 상쇄·아내 지출 추정')
