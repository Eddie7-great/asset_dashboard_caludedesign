// 적립식 '앞으로 10일 매수 일정' — 판정은 기존 cbDcaScheduledOn 을 그대로 쓰고 날짜별로 묶기만 한다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readSource } from './_source.mjs'

const cobalt = readSource('cobalt.js');
const read = (f) => readSource(f);
const pick = (name) => cobalt.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0];
const ctx = vm.createContext({});
vm.runInContext([
  pick('cbDcaDateAt'), pick('cbDcaDateKey'), pick('cbDcaUpcoming'),
  fs.readFileSync(new URL('../../finance.js', import.meta.url), 'utf8').match(/function finLocalDateKey\([\s\S]*?\n\}/)[0],
  // 판정·금액은 테스트용 대역 — 이 함수가 새 판정을 만들지 않는다는 것을 확인한다
  "function cbDcaScheduledOn(i,d){ return i.dca && i.days.includes(d.getDate()); }",
  "function cbDcaPerOrderKRW(i){ return i.amt; }",
].join('\n'), ctx);

const list = [
  { i: { dca: true, days: [3, 25], amt: 500000 } },
  { i: { dca: true, days: [3], amt: 200000 } },
  { i: { dca: false, days: [3], amt: 999 } }, // 꺼진 규칙은 판정 함수가 거른다
];
const up = JSON.parse(JSON.stringify(ctx.cbDcaUpcoming(list, '2026-11-01', 30).map((d) => ({ key: d.key, n: d.items.length, amount: d.amount }))));
assert.deepEqual(up, [
  { key: '2026-11-03', n: 2, amount: 700000 },
  { key: '2026-11-25', n: 1, amount: 500000 },
]);
assert.equal(ctx.cbDcaUpcoming(list, '2026-11-01', 2).length, 0, '기간 밖 날짜는 넣지 않는다');
// 렌더: 활성 규칙이 있을 때만 카드, 예정이 없으면 빈 안내
assert.match(cobalt, /const up=cbDcaUpcoming\(active\);\n\s*if\(!active\.length\) return '';/);
assert.match(cobalt, /10일 안에 예정된 매수가 없습니다\./);
// 기본 범위는 10일이다 — 3일 규칙은 잡히고 25일 규칙은 범위 밖
assert.equal(ctx.cbDcaUpcoming(list, '2026-11-01').map((d) => d.key).join(), '2026-11-03', '기본 10일');
assert.match(cobalt, /aria-label="앞으로 10일 매수 일정"/);
assert.match(read('workspace-ui.css'), /\.cb-dca-upcoming-list\{display:grid;grid-template-columns:repeat\(10,minmax\(0,1fr\)\)/, '10일을 같은 폭 칸으로 카드 폭을 채운다');
assert.match(cobalt, /class="\$\{cls\}" aria-label="\$\{d\.getMonth\(\)\+1\}월 \$\{d\.getDate\(\)\}일 예정 없음"/, '빈 날도 칸으로 그린다');
assert.doesNotMatch(read('workspace-ui.css'), /\.cb-dca-upcoming-list\{[^}]*overflow-x/, '옆으로 미는 스크롤바를 만들지 않는다');
console.log('ok - dca upcoming');
