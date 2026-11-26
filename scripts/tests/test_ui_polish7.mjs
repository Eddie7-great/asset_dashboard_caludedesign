#!/usr/bin/env node
// 2026-11-25 화면 다듬기 7건(사용자 확정) — 실현손익 접힌 달 줄 · 저축률 적자 · 설명 상자 테마 한 벌 ·
// 세금 순서 접기 · ETF 소유주 창(test_etf_explorer) · ETF 카드 나누기(test_etf_explorer·test_mobile_polish) ·
// 차트 공부 일·주·월·년봉 + 200선 + '읽는 법' 한 줄 요약.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { readSource } from './_source.mjs'

const root = new URL('../../', import.meta.url)
const read = p => fs.readFileSync(new URL(p, root), 'utf8')
const chart = read('pages/chart-study.js')
const tax = read('pages/tax.js')
const finance = read('finance.js')
const script = readSource('script.js')
const ws = read('workspace-ui.css')
const style = read('style.css')
const priceTs = read('api/price.ts')

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} 함수를 찾을 수 없음`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1) }
  }
  throw new Error(`${name} 함수의 닫는 괄호를 찾을 수 없음`)
}
// `const NAME = …;` 한 문장(여러 줄)을 그대로 떼어 온다
function extractConst(source, name) {
  const start = source.indexOf(`const ${name} = `)
  assert.notEqual(start, -1, `${name} 상수를 찾을 수 없음`)
  const end = source.indexOf(';\n', start)
  return source.slice(start, end + 1).replace(/^const /, 'var ')
}
const plain = v => JSON.parse(JSON.stringify(v))

// ── 차트 공부: 봉 단위·200선·'읽는 법' ──
{
  const ctx = vm.createContext({ Math, Date, String, Array })
  for (const c of ['CHS_FRAMES', 'CHS_MA_N', 'CHS_GUIDE']) vm.runInContext(extractConst(chart, c), ctx)
  for (const f of ['chsMaList', 'chsPeriodKey', 'chsMergeBars', 'chsInProgress', 'chsCacheKey']) vm.runInContext(extractFunction(chart, f), ctx)

  assert.deepEqual(plain(ctx.CHS_MA_N), [20, 60, 120, 200], '이동평균은 20·60·120·200 봉')
  assert.deepEqual(Object.keys(ctx.CHS_FRAMES), ['D', 'W', 'M', 'Y'], '봉 단위는 일·주·월·년')
  assert.deepEqual(plain(ctx.chsMaList('W').map(m => m.label)), ['20주선', '60주선', '120주선', '200주선'], '기간 이름은 봉 단위를 따른다')
  assert.equal(ctx.chsMaList('D')[3].sub, '약 10개월', '200일선 설명')
  for (const f of ['D', 'W', 'M', 'Y']) assert.equal(ctx.CHS_FRAMES[f].subs.length, 4, `${f} 의 선 설명이 선 수와 같다`)
  assert.ok(ctx.chsMaList('Y').every(m => m.sub === ''), "년봉은 '20년선 20년'처럼 같은 말을 두 번 적지 않는다")
  assert.deepEqual(Object.keys(ctx.CHS_FRAMES.Y.ranges), ['ALL'], '년봉은 전체 하나')
  assert.equal(ctx.CHS_FRAMES.D.range, '2y', '일봉 1년을 볼 때도 앞쪽 200일선이 그려지도록 2년치를 받는다')

  // 년봉 = 월봉을 해마다 묶음 — 시가는 첫 달, 종가는 마지막 달, 고가·저가는 극값, 거래량은 합
  const t = (y, m) => Date.UTC(y, m - 1, 1) / 1000
  const monthly = [
    { t: t(2025, 11), o: 10, h: 12, l: 9, c: 11, v: 1 },
    { t: t(2025, 12), o: 11, h: 15, l: 10, c: 14, v: 2 },
    { t: t(2026, 1), o: 14, h: 16, l: 8, c: 9, v: 3 },
    { t: t(2026, 2), o: 9, h: 13, l: 7, c: 12, v: 4 },
  ]
  const yearly = plain(ctx.chsMergeBars(monthly, 'Y'))
  assert.equal(yearly.length, 2)
  assert.deepEqual([yearly[0].o, yearly[0].h, yearly[0].l, yearly[0].c, yearly[0].v], [10, 15, 9, 14, 3])
  assert.deepEqual([yearly[1].o, yearly[1].h, yearly[1].l, yearly[1].c, yearly[1].v], [14, 16, 7, 12, 7])
  // 주 단위 키는 월요일 기준 — 같은 주의 월·금은 한 봉, 다음 월요일은 새 봉
  const mon = Date.UTC(2026, 10, 23) / 1000, fri = Date.UTC(2026, 10, 27) / 1000, nextMon = Date.UTC(2026, 10, 30) / 1000
  assert.equal(ctx.chsPeriodKey(mon, 'W'), ctx.chsPeriodKey(fri, 'W'))
  assert.notEqual(ctx.chsPeriodKey(fri, 'W'), ctx.chsPeriodKey(nextMon, 'W'))
  // 진행 중인 봉 — 일봉은 장이 끝난 봉만 받으므로 늘 false
  const now = new Date(Date.UTC(2026, 10, 25, 9))
  assert.equal(ctx.chsInProgress({ t: mon }, 'W', now), true, '이번 주 봉은 진행 중')
  assert.equal(ctx.chsInProgress({ t: Date.UTC(2026, 10, 16) / 1000 }, 'W', now), false, '지난주 봉은 끝남')
  assert.equal(ctx.chsInProgress({ t: Date.UTC(2026, 0, 1) / 1000 }, 'Y', now), true, '올해 년봉은 진행 중')
  assert.equal(ctx.chsInProgress({ t: mon }, 'D', now), false)
  assert.equal(ctx.chsCacheKey('AAPL', 'D'), 'AAPL', '일봉 캐시는 리스크 화면과 같은 키')
  assert.equal(ctx.chsCacheKey('AAPL', 'W'), 'W:AAPL')

  // '읽는 법'은 항목마다 한 줄 — 판단 기준이 맨 앞, 펼침(details) 없음
  assert.equal(ctx.CHS_GUIDE[0][0], '판단 기준')
  for (const [title, line] of ctx.CHS_GUIDE) {
    assert.equal(typeof line, 'string')
    assert.ok(line.length <= 110, `'${title}' 요약이 길다 (${line.length}자)`)
  }
  assert.match(ctx.CHS_GUIDE[0][1], /RSI 70 이상·30 이하/)
  assert.match(chart, /<dl class="chs-guide-list">/)
  assert.doesNotMatch(chart, /chs-guide-item|chs-guide-grid/, '예전 펼침 카드는 없앴다')
  assert.doesNotMatch(ws, /chs-guide-item|chs-guide-grid/)
  assert.match(chart, /공부용 — 지난 가격을 요약한 것이라 매매 신호가 아닙니다/, "'공부용 — 매매 신호가 아니다' 문구 유지")

  // 버튼 줄: 기간 버튼은 하나뿐이어도 그리고, 봉 단위 버튼은 맨 오른쪽(눌러도 자리가 움직이지 않게)
  assert.match(chart, /<div class="chs-tools">\$\{sel\}\$\{ranges\}\$\{logBtn\}\$\{frames\}<\/div>/)
  assert.doesNotMatch(chart, /rangeKeys\.length>1 \?/)
  // 200선 색은 무채색 토큰(라이트·다크 둘 다)
  assert.match(style, /--ma-120:#1f8fb3;--ma-200:#4a5160;/)
  assert.match(style, /--ma-120:#20a3b8;--ma-200:#c9cfd8;/)
  assert.match(ws, /\.chs-sw\.ma200\{background:var\(--ma-200\)\}/)
  assert.match(ws, /\.chs-svg \.chs-ma\.ma200\{stroke:var\(--ma-200\)/)
  // 서버는 허용한 봉 단위만 받는다
  assert.match(priceTs, /if \(!new Set\(\['1d', '1wk', '1mo'\]\)\.has\(interval\)\) \{\s*return res\.status\(400\)/)
  assert.match(priceTs, /chart\/\$\{encodeURIComponent\(sym\)\}\?interval=\$\{interval\}&range=/)
}

// ── 저축률: 적자 달은 '적자', 정확한 비율은 말풍선(2026-11-26 부터 6개월 누적 막대 cfStackHtml 의 위 숫자) ──
{
  const ctx = vm.createContext({ Math, Number, String, cfColors: { 기타: '#94a3c8', '아내 지출(추정)': '#f2a33c', '저축/투자': '#81c784' }, ownerColors: { 본인: '#2a78d6' },
    CF_XFER_EST_CAT: '아내 지출(추정)', CF_XFER_TO: '본인', CF_FLOW_REST_COLOR: '#3f63c9', cfShortWon: v => `${Math.round(v / 10000)}만`, _cfEsc: v => String(v) })
  vm.runInContext(extractFunction(script, 'cfStackHtml'), ctx)
  const row = (m, tIn, tOut, rate, kept) => ({ y: 2026, m, tIn, tOut, sv: 0, est: 0, xfer: 0, spend: tOut, left: tIn - tOut, kept, rate })
  const html = ctx.cfStackHtml([row(8, 120000, 1220000, -1016.7, -1100000), row(9, 5000000, 4000000, 20, 1000000), row(10, 0, 300000, null, -300000)])
  assert.match(html, /<b>적자<\/b>/, '수입보다 지출이 큰 달은 적자')
  assert.doesNotMatch(html, /<b>-1017%<\/b>/, '−1,017% 같은 비율을 크게 적지 않는다')
  assert.match(html, /title="2026년 8월 · 수입 ₩120,000보다 ₩1,100,000 더 씀 \(저축률 -1,017%\)"/, '정확한 비율은 말풍선')
  assert.match(html, /<b>20%<\/b>/)
  assert.match(html, /aria-label="최근 6개월 수입 나눔 — 8월 적자, 9월 저축률 20%, 10월 수입 없음"/)
  assert.match(html, /cf-stack-col is-neg/)
  // 막대 높이는 그 달 수입(지출이 더 크면 지출) 대비 — 적자 달 쓴 돈 조각이 100%
  assert.match(html, /height:100\.00%;background:#94a3c8" title="8월 쓴 돈 ₩1,220,000/)
  // 카드가 내용만큼 늘어난다(오른쪽 열은 스크롤하지 않는다)
  assert.match(ws, /\.cf-stack-panel\{flex:none;/)
}

// ── 실현손익 접힌 달 줄: 월 합계만, 화살표는 관리 칸 ──
{
  const sum = tax.slice(tax.indexOf('cb-tax-month-name'), tax.indexOf('cb-tax-month-caret') + 60)
  assert.match(sum, /cb-tax-month-total cb-tip-block[\s\S]*data-tip="국내/, '국내·해외 나눔은 합계의 말풍선으로')
  assert.doesNotMatch(sum, />국내 <span/, '접힌 줄에 국내·해외 금액을 늘어놓지 않는다')
  assert.match(ws, /\.cb-tax-month-total\{grid-column:7\}/)
  assert.match(ws, /\.cb-tax-month-caret\{grid-column:9;/)
}

// ── 줄일 때 세금이 적은 순서: 자산군마다 접기(기본 접힘) ──
{
  assert.match(finance, /<details class="fin-tsell-block" data-tsell="\$\{cbEsc\(x\.key\)\}"\$\{_finTsellOpen\.has\(x\.key\)\?' open':''\} ontoggle="finTsellToggle\(this\)">/)
  assert.match(finance, /const _finTsellOpen=new Set\(\);/)
  assert.match(read('cobalt.js'), /_finTsellOpen\.clear\(\)/, '화면을 옮기면 다시 접힌다')
  assert.match(ws, /\.fin-tsell-title>span\.fin-tsell-caret\{margin-left:12px\}/, '예상 세금은 화살표 바로 옆 오른쪽')
}

// ── 설명 상자: 모든 상자가 테마 바탕을 따른다(예전 --tipbg 는 테마와 거꾸로였다) ──
{
  const tipLines = style.match(/--tipbg:[^;]+;/g)
  assert.ok(tipLines && tipLines.length >= 2)
  for (const l of tipLines) assert.equal(l, '--tipbg:var(--modal-bg);', '라이트·다크/네이비 모두 테마 바탕')
  assert.doesNotMatch(style, /--tiptx:#0a1733/, '네이비만 따로 진한 글자를 두지 않는다')
  assert.match(ws, /\.cb-trend-tip\{[^}]*background:var\(--tipbg\)/)
  assert.match(ws, /\.chs-tip\{[^}]*background:var\(--tipbg\)/)
  assert.match(read('core/ext-data.js'), /cssVar\('--tipbg'/, 'Chart.js 말풍선도 같은 토큰')
}

console.log('ok - ui polish 7 (chart frames·200선·읽는 법 요약·저축률 적자·실현손익 달 줄·세금 순서 접기·설명 상자)')
