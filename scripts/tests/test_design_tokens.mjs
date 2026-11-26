// 규격 토큰(2026-11-11): 글자·굵기·글꼴·모서리·막대·버튼 값은 style.css :root 한 곳에서만 온다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readSource } from './_source.mjs'

const root = new URL('../../', import.meta.url);
const read = (f) => readSource(f);
const style = read('style.css'), ws = read('workspace-ui.css'), etf = read('etf-explorer.css');
const html = read('index.html'), finance = read('finance.js'), script = read('script.js');
const allCss = style + ws + etf;
const allSrc = allCss + html + finance + script + read('cobalt.js') + read('workspace-pages.js');

const rootBlock = style.match(/:root\s*\{[\s\S]*?\n\s*\}/)[0];
for (const t of ['--fs-micro:12px', '--fw-regular:500', '--fw-strong:700', '--fw-heavy:800', '--font-ui:', '--font-num:', '--r-sm:4px', '--r-md:8px', '--r-lg:12px', '--bar-h:6px', '--bar-h-lg:12px', '--btn-h:36px']) {
  assert.ok(rootBlock.includes(t), `:root 에 ${t} 토큰이 있어야 한다`);
}

// 숫자 글꼴은 한 종류 — 고정폭 글꼴을 다시 들이지 않는다(화면마다 숫자 모양이 달라 보였다)
assert.doesNotMatch(allSrc, /IBM Plex Mono|JetBrains Mono/, '고정폭 글꼴을 쓰지 않는다');
assert.doesNotMatch(html, /family=IBM\+Plex\+Mono/, '쓰지 않는 글꼴을 내려받지 않는다');

// 글꼴은 한 벌(2026-11-16) — 숫자·영문은 어디서나 Manrope, 한글은 Noto Sans KR. 두 토큰이 같은 스택이다.
// 본문 글꼴이 Noto 먼저였을 때는 같은 금액이 표에서는 Noto 숫자, 숫자 카드에서는 Manrope 숫자로 다르게 보였다.
assert.match(rootBlock, /--font-ui:'Manrope','Noto Sans KR',sans-serif;--font-num:var\(--font-ui\)/, '--font-ui 는 Manrope 먼저, --font-num 은 같은 스택');
assert.equal((allCss.match(/'Noto Sans KR'/g) || []).length, 1, 'CSS 에서 글꼴 이름은 토큰 정의 한 곳에만 적는다');
const jsSrc = finance + read('cobalt.js') + read('workspace-pages.js') + read('etf-explorer.js') + read('simulator.js') + read('navigation.js');
assert.doesNotMatch(jsSrc, /font-family="|font-family:\s*'?(Manrope|Noto)/, 'JS 가 그리는 마크업·SVG 에 글꼴 이름을 직접 적지 않는다(SVG 글자는 svg text 규칙이 맡는다)');
assert.match(ws, /svg text\{font-family:var\(--font-ui\)\}/, 'SVG 글자도 같은 글꼴 토큰');
// 글자 크기는 규격 6단에서만 — rem·12px 미만을 CSS·JS 에 다시 적지 않는다(휴대폰 입력칸 16px 은 iOS 확대 방지용 예외)
assert.doesNotMatch(allCss, /font-size:\s*[\d.]+rem/, 'CSS 에 rem 글자 크기를 적지 않는다');
assert.doesNotMatch(jsSrc + script, /font-size:\s*[\d.]*\.\d+rem|font-size:\s*\d+rem/, 'JS 인라인 스타일에 rem 글자 크기를 적지 않는다');
assert.doesNotMatch(allCss, /font-size:\s*(9|9\.5|10|10\.5|11|11\.5)px/, '12px 미만 글자 크기를 쓰지 않는다');
assert.doesNotMatch(jsSrc + script, /font-size="(?:\d|1[01])(?:\.\d+)?"/, 'SVG 글자도 12 미만으로 적지 않는다');
assert.doesNotMatch(allCss, /font-weight:\s*(550|650|750|850|bold)\b|font:\s*(550|650|750|850)\s/, '굵기는 정해진 단계만 쓴다');
assert.doesNotMatch(allCss, /border-radius:\s*(2|3|5|6|7|9|10|16)px[;}]/, '모서리는 --r-sm/md/lg 만 쓴다');

// 버튼 높이·막대 높이는 토큰에서
for (const sel of ['.cb-btn', '.api-btn']) {
  const rule = style.match(new RegExp(`\\n\\s*\\${sel}\\{[^}]*\\}`))[0];
  assert.match(rule, /min-height:var\(--btn-h\)/, `${sel} 높이는 --btn-h`);
  // 버튼은 한 벌(2026-11-16) — 연한 파랑(--acc-soft2) 바탕 대신 시작 버튼과 같은 중립 톤
  assert.match(rule, /background:var\(--inner\)/, `${sel} 는 중립 톤`);
  assert.doesNotMatch(rule, /acc-soft/, `${sel} 에 파랑 바탕을 다시 쓰지 않는다`);
}
for (const sel of ['.holdings-add-btn', '.fin-goal-add-btn', '.cf-entry-open']) {
  assert.ok(ws.includes(`${sel}{`) && new RegExp(`${sel.replace(/[.,]/g, '\\$&')}\\{[^}]*min-height:var\\(--btn-h\\)`).test(ws), `${sel} 높이는 --btn-h`);
}
for (const sel of ['.cb-fam-card-track', '.cb-dca-allocation-track', '.cb-fin-income-track', '.fin-meter', '.cb-tax-deduction-track', '.cb-meter']) {
  assert.match(style, new RegExp(`\\${sel}\\{[^}]*height:var\\(--bar-h\\)`), `${sel} 높이는 --bar-h`);
}
assert.match(style, /\.cb-lt-bar\{[^}]*height:var\(--bar-h-lg\)/, '비교용 막대는 --bar-h-lg');
assert.match(etf, /etf-rank-track\{height:var\(--bar-h-lg\)/, 'ETF 비중 막대는 --bar-h-lg');

// 적립식 규칙 표(942px)는 좁은 화면에서 옆 카드에 가려지지 않는다
assert.match(ws, /@media\(max-width:1559px\)\{\.cb-dca-detail-grid\{grid-template-columns:minmax\(0,1fr\)\}\}/, '1560px 미만에서는 배분 카드를 표 아래로');

// 예전 판의 자동 체결 흔적(dcaLastExec)은 불러올 때 버린다 — 수량은 건드리지 않는다
assert.doesNotMatch(script, /dcaLastExec\s*:/, '저장값 정규화가 dcaLastExec 를 싣지 않는다');
assert.doesNotMatch(finance + read('cobalt.js'), /dcaLastExec\s*[=:][^=]/, '어느 화면도 dcaLastExec 를 쓰거나 읽어 계산하지 않는다');
assert.doesNotMatch(finance, /finDcaLegacy/, '대조 안내는 기록과 함께 없앴다');

console.log('PASS 규격 토큰');
