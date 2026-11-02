// 휴대폰 화면 다듬기(2026-11-02): 비중 목록 숫자 대비, ETF 요약 라벨·값 줄, 적립식 남은 매수 카드.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const script = fs.readFileSync(new URL('script.js', root), 'utf8');
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
// ETF 요약: 라벨 | 값 줄, etf-explorer.css(나중에 로드)의 margin-left 를 이기도록 .etf-toolbar> 로 한 단계 강하게
assert.match(block, /\.etf-toolbar>\.etf-fund-value,\.etf-toolbar>\.etf-fund-stats\{display:grid;grid-template-columns:auto minmax\(0,1fr\)/);
assert.match(block, /\.etf-toolbar>\.etf-fund-value>span:not\(:first-child\),\.etf-toolbar>\.etf-fund-stats>span:not\(:first-child\)\{margin-left:0\}/);

console.log('ok - mobile polish');
