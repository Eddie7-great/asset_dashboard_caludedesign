// 규격 토큰(2026-11-11): 글자·굵기·글꼴·모서리·막대·버튼 값은 style.css :root 한 곳에서만 온다.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, root), 'utf8');
const style = read('style.css'), ws = read('workspace-ui.css'), etf = read('etf-explorer.css');
const html = read('index.html'), finance = read('finance.js'), script = read('script.js');
const allCss = style + ws + etf;
const allSrc = allCss + html + finance + script + read('cobalt.js') + read('workspace-pages.js');

const rootBlock = style.match(/:root\s*\{[\s\S]*?\n\s*\}/)[0];
for (const t of ['--fs-micro:11px', '--fw-regular:500', '--fw-strong:700', '--fw-heavy:800', '--font-ui:', '--font-num:', '--r-sm:4px', '--r-md:8px', '--r-lg:12px', '--bar-h:6px', '--bar-h-lg:12px', '--btn-h:36px']) {
  assert.ok(rootBlock.includes(t), `:root 에 ${t} 토큰이 있어야 한다`);
}

// 숫자 글꼴은 한 종류 — 고정폭 글꼴을 다시 들이지 않는다(화면마다 숫자 모양이 달라 보였다)
assert.doesNotMatch(allSrc, /IBM Plex Mono|JetBrains Mono/, '고정폭 글꼴을 쓰지 않는다');
assert.doesNotMatch(html, /family=IBM\+Plex\+Mono/, '쓰지 않는 글꼴을 내려받지 않는다');

// 11px 보다 작은 글자, 토큰 밖 굵기·모서리를 CSS 에 다시 적지 않는다
assert.doesNotMatch(allCss, /font-size:\s*(9|9\.5|10|10\.5)px/, '11px 미만 글자 크기를 쓰지 않는다');
assert.doesNotMatch(allCss, /font-weight:\s*(550|650|750|850|bold)\b/, '굵기는 정해진 단계만 쓴다');
assert.doesNotMatch(allCss, /border-radius:\s*(2|3|5|6|7|9|10|16)px[;}]/, '모서리는 --r-sm/md/lg 만 쓴다');

// 버튼 높이·막대 높이는 토큰에서
for (const sel of ['.cb-btn', '.api-btn']) {
  const rule = style.match(new RegExp(`\\n\\s*\\${sel}\\{[^}]*\\}`))[0];
  assert.match(rule, /min-height:var\(--btn-h\)/, `${sel} 높이는 --btn-h`);
}
for (const sel of ['.holdings-add-btn', '.fin-goal-add-btn', '.cf-entry-open,.cf-entry-close']) {
  assert.ok(ws.includes(`${sel}{`) && new RegExp(`${sel.replace(/[.,]/g, '\\$&')}\\{[^}]*min-height:var\\(--btn-h\\)`).test(ws), `${sel} 높이는 --btn-h`);
}
for (const sel of ['.cb-fam-card-track', '.cb-dca-allocation-track', '.cb-fin-income-track', '.fin-meter', '.cb-tax-deduction-track', '.cb-meter', '.cb-contrib-track']) {
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
