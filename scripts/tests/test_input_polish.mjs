#!/usr/bin/env node
// 입력 다듬기(2026-11-18): 입력 중 쉼표, 목표 기한 미정, 테마 전환 뒤 차트 축 색, 고정비 분포 간격
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const read = f => fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8')
const script = read('script.js'), finance = read('finance.js'), backtest = read('backtest.js'), style = read('style.css'), index = read('index.html')
function extractFunction(source, name) {
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

// ── 소수 칸: 입력하는 동안 정수부에만 쉼표 ───────────────────────
const ctx = { document: { activeElement: null } }
vm.createContext(ctx)
vm.runInContext(extractFunction(script, 'formatDecimalInput'), ctx)
vm.runInContext(extractFunction(script, 'handleDecimalInput'), ctx)
const f = ctx.formatDecimalInput
assert.equal(f('1234567'), '1,234,567')
assert.equal(f('1234567.5'), '1,234,567.5')
assert.equal(f('1,234,5678'), '12,345,678', '이미 쉼표가 있는 값에 한 자리를 더 쳐도 다시 맞춘다')
assert.equal(f('12.'), '12.', "입력 중인 '12.' 를 지우지 않는다")
assert.equal(f('0.05'), '0.05')
assert.equal(f('1000.000100'), '1,000.000100', '소수점 뒤에는 쉼표를 넣지 않고 0 도 지우지 않는다')
assert.equal(f('1.2.3'), '1.23', '소수점은 하나만')
assert.equal(f('-1234'), '1,234', '음수를 받지 않는 칸은 부호를 버린다')
assert.equal(f('-1234', true), '-1,234', '음수 허용 칸')
assert.equal(f('-', true), '-', "입력 중인 '-' 유지")
assert.equal(f('abc'), '')
// 커서: '1234|5' 에서 6을 쳐 '12346|5' → '123,46|5' — 쉼표가 늘어도 같은 숫자 뒤에 선다
const el = { value: '123465', selectionStart: 5, dataset: {}, setSelectionRange(a) { this.caret = a } }
ctx.document.activeElement = el
ctx.handleDecimalInput(el)
assert.equal(el.value, '123,465')
assert.equal(el.caret, 6, '커서는 쉼표를 건너 같은 숫자 뒤')
assert.match(script, /if \(isDecimal\) \{[\s\S]*?el\.addEventListener\('input', \(\) => handleDecimalInput\(el\)\);/, '소수 칸도 입력 중 쉼표')
assert.doesNotMatch(script, /el\.addEventListener\('focus', \(\) => \{ el\.value = String\(el\.value\|\|''\)\.replace\(\/,\/g,''\); \}\);/, '포커스 때 쉼표를 떼지 않는다')
assert.match(index, /id="trade-pl"[^>]*data-neg="1"/, '실현손익 칸은 음수 허용')

// ── 금액을 받던 숫자 칸은 쉼표가 들어가는 글자 칸 ───────────────
assert.match(finance, /id="fin-goal-target" type="text" inputmode="numeric"/)
assert.match(finance, /id="fin-goal-current" type="text" inputmode="numeric"/)
assert.match(finance, /targetAmount:finNumInput\('fin-goal-target'\)[\s\S]*currentAmount:finNumInput\('fin-goal-current'\)/, '저장할 때 쉼표를 떼고 읽는다')
assert.match(backtest, /id="bt-initial" type="text" inputmode="numeric"[\s\S]*id="bt-monthly" type="text" inputmode="numeric"/)
assert.match(backtest, /Number\(String\(value\)\.replace\(\/,\/g,''\)\)/, '백테스트도 쉼표를 떼고 읽는다')
assert.match(backtest, /id="bt-fee" type="number" data-no-comma="1"/, '비율 칸은 그대로')

// ── 목표: 기한 미정 ─────────────────────────────────────────────
assert.match(finance, /id="fin-goal-nodate" type="checkbox" onchange="finGoalNoDateToggle\(\)"\$\{ge&&!ge\.targetDate\?' checked':''\}>기한 미정/, '기한 없는 목표는 체크된 채로 열린다')
assert.match(finance, /targetDate:document\.getElementById\('fin-goal-nodate'\)\?\.checked\?'':/, '체크하면 빈 목표일로 저장')
const dateEl = { value: '2030-01-01', disabled: false }
const gctx = { document: { getElementById: id => id === 'fin-goal-nodate' ? { checked: true } : id === 'fin-goal-date' ? dateEl : null } }
vm.createContext(gctx)
vm.runInContext(extractFunction(finance, 'finGoalNoDateToggle'), gctx)
gctx.finGoalNoDateToggle()
assert.equal(dateEl.value, '', '체크하면 날짜를 비운다')
assert.equal(dateEl.disabled, true)

// ── 테마 전환 뒤 차트 축 색 ─────────────────────────────────────
const made = () => ({ options: { scales: { x: { ticks: { color: '#c2c8d2' }, grid: { color: '#2a2f39' } }, y: { ticks: { color: '#c2c8d2' }, grid: { color: 'rgba(150,150,150,.15)' } } }, plugins: {} }, updated: 0, update() { this.updated++ } })
const plain = made(), masked = made()
masked.options.scales.x.ticks.color = masked.options.scales.y.ticks.color = 'rgba(0,0,0,0)'
const state = new Map([[masked, { ticks: [{ key: 'x', color: '#c2c8d2' }, { key: 'y', color: '#c2c8d2' }] }]])
const tctx = {
  Chart: { defaults: { plugins: { tooltip: {} } }, instances: { 0: plain, 1: masked } },
  cssVar: name => ({ '--t1': '#18213a', '--t2': '#4a5878', '--glass': '#fff', '--panel-border': '#e2e7f0', '--grid': '#e6eaf2' })[name],
  _amountPrivacyChartState: state,
}
vm.createContext(tctx)
vm.runInContext(extractFunction(script, 'applyChartTheme'), tctx)
tctx.applyChartTheme()
assert.equal(plain.options.scales.x.ticks.color, '#4a5878', '이미 만든 차트의 축 글자도 새 테마 색으로 바뀐다(다크 색에 굳지 않는다)')
assert.equal(plain.options.scales.x.grid.color, '#e6eaf2', '눈금선도 따라온다')
assert.equal(plain.options.scales.y.grid.color, 'rgba(150,150,150,.15)', '차트가 직접 준 반투명 눈금선은 그대로')
assert.equal(plain.updated, 1)
assert.equal(masked.options.scales.x.ticks.color, 'rgba(0,0,0,0)', '금액 가리기 중에는 축 글자를 드러내지 않는다')
assert.equal(state.get(masked).ticks[0].color, '#4a5878', '가리기를 풀 때 돌아갈 색을 새 테마 값으로 바꿔 둔다')

// ── 고정비 분포: 막대와 내역 사이 간격 ──────────────────────────
assert.match(style, /#cf-fixed-dist\{display:flex;flex-direction:column;gap:16px\}/)

console.log('test_input_polish: ok')
