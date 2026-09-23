// 리스크 화면 시각화: 기준 게이지(cbRiskMeterHtml)와 통화 구성 막대(cbFxMixHtml).
// 게이지 구간은 카드 판정에 쓰는 기준값 그대로여야 하고, 판정 보류 카드는 그리지 않는다.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8')
const start = source.indexOf('// 리스크 기준 게이지')
const end = source.indexOf('// ───────────────────────── SVG 빌더')
assert.ok(start > -1 && end > start, '시각화 블록을 찾지 못함')
const ctx = vm.createContext({ cbEsc: s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`) })
vm.runInContext(source.slice(start, end), ctx)

// ── 게이지: 높을수록 위험 ──────────────────────────────────────
{
  const html = ctx.cbRiskMeterHtml({ value: 13.2, warnAt: 20, badAt: 30, max: 100 }, '%', 'var(--up)')
  assert.match(html, /cb-meter-zone good" style="left:0\.00%;width:20\.00%/, '0~주의 기준은 양호 구간')
  assert.match(html, /cb-meter-zone warn" style="left:20\.00%;width:10\.00%/, '주의~위험 기준은 주의 구간')
  assert.match(html, /cb-meter-zone bad" style="left:30\.00%;width:70\.00%/, '위험 기준 이후는 위험 구간')
  assert.match(html, /cb-meter-fill" style="width:13\.20%;background:var\(--up\)/, '현재 값까지 채움')
  assert.match(html, /aria-label="현재 13\.2% · 20% 초과 주의 · 30% 초과 위험"/, '색 없이도 기준을 읽을 수 있게 설명')
}
// ── 게이지: 낮을수록 위험(현금 비중 등) ─────────────────────────
{
  const html = ctx.cbRiskMeterHtml({ value: 13.2, warnAt: 5, badAt: 3, invert: true, max: 10 }, '%', 'x')
  assert.match(html, /zone bad" style="left:0\.00%;width:30\.00%[\s\S]*zone warn" style="left:30\.00%;width:20\.00%[\s\S]*zone good" style="left:50\.00%;width:50\.00%/, '낮을수록 위험이면 구간 순서가 뒤집힌다')
  assert.match(html, /cb-meter-fill" style="width:100\.00%/, '눈금 상한을 넘는 값은 끝에서 멈춘다')
  assert.match(html, /5% 미만 주의 · 3% 미만 위험/, '낮을수록 위험인 기준 설명')
}
assert.equal(ctx.cbRiskMeterHtml(null), '', '판정 보류(meter 없음)면 그리지 않는다')
assert.equal(ctx.cbRiskMeterHtml({ value: NaN, warnAt: 1, badAt: 2, max: 10 }), '', '값이 숫자가 아니면 그리지 않는다')

// ── 통화 구성 막대 ─────────────────────────────────────────────
{
  const html = ctx.cbFxMixHtml([{ cur: 'KRW', pct: 42.5 }, { cur: 'CHF', pct: 1 }, { cur: 'USD', pct: 55.5 }, { cur: 'JPY', pct: 1 }],
    { warnAt: 60, badAt: 80 })
  const segs = [...html.matchAll(/cb-fx-seg (\w+)" style="width:([\d.]+)%/g)].map(m => [m[1], Number(m[2])])
  assert.deepEqual(segs.map(x => x[0]), ['usd', 'jpy', 'other', 'krw'], '외화를 먼저 쌓고 원화는 끝 — 외화 길이가 곧 환노출')
  assert.ok(Math.abs(segs.reduce((s, x) => s + x[1], 0) - 100) < 0.05, '구성 합은 100%')
  assert.match(html, /cb-fx-tick" style="left:60%[\s\S]*cb-fx-tick" style="left:80%/, '판정 기준(60%·80%) 눈금')
  assert.match(html, /USD 55\.5%[\s\S]*KRW 42\.5%/, '대비가 낮은 색이 있어 비중을 글자로도 표시')
}
assert.equal(ctx.cbFxMixHtml([]), '', '투자자산이 없으면 그리지 않는다')

// ── 카드 연결: 판정 기준과 게이지 기준이 같은 숫자인지 ─────────────
for (const [tone, meter] of [
  ['toneHigh(overlapPct,5,15)', 'value:overlapPct,warnAt:5,badAt:15'],
  ['toneHigh(crossOverlap.pct,15,30)', 'value:crossOverlap.pct,warnAt:15,badAt:30'],
  ['toneLow(effectiveCount,10,6)', 'value:effectiveCount,warnAt:10,badAt:6,invert:true'],
  ['toneHigh(fxShockPct,5,8)', 'value:fxShockPct,warnAt:5,badAt:8'],
  ['toneHigh(topCountryPct,45,65)', 'value:topCountryPct,warnAt:45,badAt:65'],
  ['toneHigh(topTwoSectorPct,50,70)', 'value:topTwoSectorPct,warnAt:50,badAt:70'],
  ['toneHigh(dividendTop3Pct,45,70)', 'value:dividendTop3Pct,warnAt:45,badAt:70'],
  ['toneHigh(recoveryPct,10,25)', 'value:recoveryPct,warnAt:10,badAt:25'],
]) {
  const i = source.indexOf(tone)
  assert.ok(i > -1, `${tone} 판정을 찾지 못함`)
  assert.ok(source.slice(i, i + 260).includes(meter), `${tone} 카드 게이지가 같은 기준값을 쓴다`)
}
assert.match(source, /meter: \{ value:val, warnAt:thWarn, badAt:thBad, invert:!!invert/, '주요 진단 카드 게이지도 판정 기준값을 그대로 쓴다')
assert.match(source, /c\.fxMix\?cbFxMixHtml\(c\.fxMix,c\.meter\)/, '환노출 카드는 통화 구성 막대로 그린다')
console.log('PASS 리스크 기준 게이지·통화 구성 막대')
