#!/usr/bin/env node
// 세금 페이지 '거래내역 가져오기' — 파일에 적힌 소유주 × 연도만 교체하고, 저장 실패·원격 미로드 시
// 기존 기록을 한 건도 잃지 않는지 확인한다.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const cobaltSource = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8')
const scriptSource = fs.readFileSync(new URL('../../script.js', import.meta.url), 'utf8')
const styleSource = fs.readFileSync(new URL('../../style.css', import.meta.url), 'utf8')

function extractFunction(source, name) {
  const asyncStart = source.indexOf(`async function ${name}(`)
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} 함수를 찾을 수 없음`)
  // 매개변수에 구조 분해 기본값({min=…})이 있어도 본문 중괄호부터 센다
  let paren = 0, p = source.indexOf('(', start)
  for (; p < source.length; p++) {
    if (source[p] === '(') paren++
    if (source[p] === ')' && --paren === 0) break
  }
  const open = source.indexOf('{', p)
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

function makeContext() {
  const ctx = {
    window: { _kvLoadState: { ext: 'ready' } },
    localStorage: { store: {}, setItem(k, v) { this.store[k] = v } },
    alerts: [], errors: [], confirms: [], renders: 0, saves: 0,
  }
  ctx.alert = msg => ctx.alerts.push(msg)
  ctx.confirm = msg => { ctx.confirms.push(msg); return true }
  ctx.showSaveError = msg => ctx.errors.push(msg)
  ctx.cbRenderTax = () => { ctx.renders++ }
  ctx.isMobileLayout = () => false
  ctx.assetTaxRulesFor = year => (String(year) === '2026' ? { id: 'kr-2026.1' } : null)
  ctx.saveResult = { ok: true }
  ctx.saveExtDataToKV = async () => { ctx.saves++; ctx.savedRows = JSON.parse(JSON.stringify(vm.runInContext('monthlyPLData', ctx))); return ctx.saveResult }
  vm.createContext(ctx)
  vm.runInContext(`
    const OWNERS=['본인','아내','자녀1','아버지'];
    const CB_TAX_ACCTS=['일반','연금저축','ISA'];
    const _STORED_TEXT_LIMIT=160;
    let monthlyPLData=[]; let _cbTaxYear=null; let _cbTaxOwner='전체'; let _cbTaxEditId=null; let _cbTaxMonthFilter=3;
    function loadMonthlyPL(){}
  `, ctx)
  for (const name of ['_boundedStoredText', '_safeStoredNumber', '_safeStoredId', '_isStoredDateKey', '_safeStoredToken', '_normalizeMonthlyPLRows']) {
    vm.runInContext(extractFunction(scriptSource, name), ctx)
  }
  const constStart = cobaltSource.indexOf("const CB_TAX_IMPORT_FORMAT=")
  const constEnd = cobaltSource.indexOf('function cbTaxImportPlan(')
  assert.ok(constStart > 0 && constEnd > constStart, '가져오기 상수 블록')
  vm.runInContext(cobaltSource.slice(constStart, constEnd), ctx)
  vm.runInContext(extractFunction(cobaltSource, 'cbTaxImportPlan'), ctx)
  vm.runInContext(extractFunction(cobaltSource, 'cbTaxImportFile'), ctx)
  return ctx
}

const existing = () => ([
  { id: 1, month: '2025-03', amt: 100, memo: '손으로 넣은 기록', owner: '본인', category: 'foreign', account: '일반' },
  { id: 2, month: '2024-05', amt: 200, memo: '가져오는 연도 밖', owner: '본인', category: 'domestic', account: '일반' },
  { id: 3, month: '2025-06', amt: 300, memo: '다른 소유주', owner: '아내', category: 'foreign', account: '일반' },
  { id: 4, month: '2025-07', amt: 400, memo: '소유주 미지정 레거시', owner: '', category: 'foreign', account: '일반' },
])
const payload = (over = {}) => ({
  format: 'asset-dashboard/realized-pl', version: 1, owner: '본인', years: ['2025', '2026'],
  rows: [
    { month: '2025-03', amt: 1234.6, memo: '애플(AAPL) · 메리츠 · 5주 매도 · 선입선출', category: 'foreign', account: '일반' },
    { month: '2026-01', amt: -500, memo: 'NAVER · 삼성 · 1주 매도 · 이동평균', category: 'domestic', account: 'ISA' },
  ],
  ...over,
})

// ── 계획: 같은 소유주 × 연도만 교체 ─────────────
{
  const ctx = makeContext()
  // vm 안에서 만든 배열은 다른 realm 이라 deepStrictEqual 이 프로토타입까지 비교한다 — 평범한 값으로 옮긴다
  const plan = JSON.parse(JSON.stringify(ctx.cbTaxImportPlan(payload(), existing(), y => ctx.assetTaxRulesFor(y)?.id || '', 1000)))
  assert.deepEqual(plan.errors, [])
  assert.deepEqual(plan.removed.map(r => r.id), [1], '본인·2025 기록만 지운다')
  assert.deepEqual(plan.next.slice(0, 3).map(r => r.id), [2, 3, 4], '다른 연도·다른 소유주·레거시는 그대로')
  assert.equal(plan.added.length, 2)
  assert.deepEqual(plan.added.map(r => r.amt), [1235, -500], '금액은 원 단위 반올림')
  assert.deepEqual(plan.added.map(r => r.owner), ['본인', '본인'])
  assert.equal(plan.added[1].ruleSetId, 'kr-2026.1', 'ruleSetId 는 파일이 아니라 세법 규칙에서 붙인다')
  assert.equal('ruleSetId' in plan.added[0], false, '규칙이 없는 연도는 비워 둔다')
  assert.ok(plan.added.every(r => r.id > 1000), 'id 는 기준값 이후')
  assert.equal(new Set(plan.next.map(r => r.id)).size, plan.next.length, 'id 는 고유')
}

// ── 한 행이라도 틀리면 통째로 거부 ─────────────
{
  const ctx = makeContext()
  const bad = [
    [{ format: 'other', version: 1 }, /세금 페이지용/],
    [payload({ owner: '삼촌' }), /소유주/],
    [payload({ years: ['25'] }), /연도 목록/],
    [payload({ rows: [] }), /가져올 기록이 없습니다/],
    [payload({ rows: [{ month: '2023-01', amt: 1, category: 'foreign', account: '일반' }] }), /연도 목록 밖/],
    [payload({ rows: [{ month: '2025-01', amt: 'x', category: 'foreign', account: '일반' }] }), /숫자가 아닙니다/],
    [payload({ rows: [{ month: '2025-01', amt: 1, category: 'foreign', account: 'ISA' }] }), /계좌 구분/],
    [payload({ rows: [{ month: '2025-01', amt: 1, category: 'bond', account: '일반' }] }), /시장 구분/],
  ]
  for (const [input, re] of bad) {
    const plan = JSON.parse(JSON.stringify(ctx.cbTaxImportPlan(input, existing(), () => '', 1000)))
    assert.ok(plan.errors.length && re.test(plan.errors.join('\n')), `거부: ${re}`)
    assert.equal(plan.next, undefined, '거부되면 바꿀 목록을 만들지 않는다')
  }
  const many = Array.from({ length: 4999 }, (_, i) => ({ id: i + 1, month: '2020-01', amt: 1, memo: '', owner: '아내', category: 'foreign', account: '일반' }))
  assert.match(ctx.cbTaxImportPlan(payload(), many, () => '', 1).errors[0], /넘어 저장할 수 없습니다/, '5000건 상한')
}

// ── 파일 가져오기: 성공 ─────────────
const file = obj => ({ files: [{ text: async () => JSON.stringify(obj) }], value: 'x' })
{
  const ctx = makeContext()
  vm.runInContext('monthlyPLData=' + JSON.stringify(existing()), ctx)
  const input = file(payload())
  await ctx.cbTaxImportFile(input)
  assert.equal(input.value, '', '같은 파일을 다시 고를 수 있게 입력을 비운다')
  assert.equal(ctx.saves, 1)
  assert.match(ctx.confirms[0], /2025~2026년 본인/)
  assert.match(ctx.confirms[0], /기존 기록 1건 삭제 · 새 기록 2건 추가/)
  assert.equal(ctx.savedRows.length, 5)
  assert.equal(vm.runInContext('_cbTaxYear', ctx), '2026', '가져온 가장 최근 연도를 연다')
  assert.equal(vm.runInContext('_cbTaxMonthFilter', ctx), null, '월 필터를 풀어 가져온 기록이 보이게 한다')
  assert.equal(JSON.parse(ctx.localStorage.store.monthlyPLData).length, 5)
}

// ── 저장 실패: 메모리·localStorage 모두 되돌림 ─────────────
{
  const ctx = makeContext()
  vm.runInContext('monthlyPLData=' + JSON.stringify(existing()), ctx)
  ctx.saveResult = { ok: false, status: 409 }
  await ctx.cbTaxImportFile(file(payload()))
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('monthlyPLData', ctx))), existing(), '실패하면 기존 기록 그대로')
  assert.deepEqual(JSON.parse(ctx.localStorage.store.monthlyPLData), existing())
  assert.match(ctx.errors[0], /가져오기를 취소했습니다/)
}

// ── 원격 데이터 미로드: 아무것도 바꾸지 않는다 ─────────────
{
  const ctx = makeContext()
  vm.runInContext('monthlyPLData=' + JSON.stringify(existing()), ctx)
  ctx.window._kvLoadState.ext = 'pending'
  await ctx.cbTaxImportFile(file(payload()))
  assert.equal(ctx.saves, 0)
  assert.equal(ctx.confirms.length, 0)
  assert.match(ctx.errors[0], /불러온 뒤에/)
  assert.equal(ctx.localStorage.store.monthlyPLData, undefined)
}

// ── 취소하면 저장하지 않는다 / 잘못된 파일은 안내 ─────────────
{
  const ctx = makeContext()
  ctx.confirm = () => false
  await ctx.cbTaxImportFile(file(payload()))
  assert.equal(ctx.saves, 0)
  await ctx.cbTaxImportFile({ files: [{ text: async () => '{not json' }], value: 'x' })
  assert.match(ctx.alerts[0], /JSON 파일을 읽지 못했습니다/)
}

// ── 마크업·모바일 ─────────────
assert.match(cobaltSource, /<button class="cb-btn cb-tax-import" onclick="document\.getElementById\('cb-tax-import-file'\)\?\.click\(\)"/)
assert.match(cobaltSource, /<input id="cb-tax-import-file" class="cb-tax-import" type="file" accept="\.json,application\/json" hidden onchange="cbTaxImportFile\(this\)"/)
assert.match(cobaltSource, /finMobileNote\('실현손익 기록과 거래내역 가져오기'\)/, '모바일에서 버튼이 없는 이유를 안내')
assert.match(styleSource, /@media \(max-width:768px\)[\s\S]*\.cb-tax-import\{display:none!important\}/, '모바일은 읽기 전용')

console.log('test_tax_import: OK')
