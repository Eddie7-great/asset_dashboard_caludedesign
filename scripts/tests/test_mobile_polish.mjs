// 휴대폰 화면 다듬기(2026-11-02): 비중 목록 숫자 대비, ETF 요약 라벨·값 줄, 적립식 남은 매수 카드.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readSource } from './_source.mjs'

const root = new URL('../../', import.meta.url);
const script = readSource('script.js');
const ws = fs.readFileSync(new URL('workspace-ui.css', root), 'utf8');

// 비중 분석 휴대폰 목록: 비중 숫자는 본문 글자색 — 막대 색(연한 파스텔)을 글자에 쓰면 흰 바탕에서 안 읽힌다
assert.match(script, /class="bubble-weight-pct" style="[^"]*color:var\(--t1\)/);
assert.doesNotMatch(script, /font-weight:800;color:\$\{color\};font-family:'Manrope'/, '비중 숫자에 막대 색을 쓰지 않는다');
assert.match(script, /<span class="bubble-weight-title">종목별 비중 <small>\$\{rows\.length\}종목<\/small><\/span>/);

// 휴대폰 규칙은 공통 블록보다 앞, 한 미디어쿼리 안에 있다
const block = ws.slice(ws.indexOf('/* ===== 휴대폰 화면 다듬기 (2026-11-02)'), ws.indexOf('/* ===== 공통 디자인 규칙 (2026-10-30)'));
assert.ok(block.length > 0, '휴대폰 다듬기 블록은 공통 블록 앞');
// 적립식 남은 매수: 강조색 윗선 없음, 휴대폰은 한 줄 요약
assert.match(block, /\.cb-dca-remaining-card\{box-shadow:none\}/);
assert.match(block, /@media\(max-width:768px\)\{[\s\S]*\.cb-dca-remaining-card\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
// ETF 요약은 2026-11-25 숫자 카드(.etf-top)로 나눴다 — 예전 한 줄 머리(.etf-toolbar)의 휴대폰 규칙은 남기지 않는다
assert.doesNotMatch(ws, /etf-toolbar|etf-fund-value|etf-fund-stats/);
const etfCss = fs.readFileSync(new URL('../../etf-explorer.css', import.meta.url), 'utf8');
assert.doesNotMatch(etfCss, /etf-toolbar|etf-fund-value|etf-fund-stats/);
assert.match(etfCss, /@media\(max-width:768px\)\{\.etf-top\{grid-template-columns:1fr 1fr/);

console.log('ok - mobile polish');
