// 적립식 '앞으로 30일 매수 일정' — 판정은 기존 cbDcaScheduledOn 을 그대로 쓰고 날짜별로 묶기만 한다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const cobalt = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8');
const pick = (name) => cobalt.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0];
const ctx = vm.createContext({});
vm.runInContext([
  pick('cbDcaDateAt'), pick('cbDcaDateKey'), pick('cbDcaUpcoming'),
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
assert.match(cobalt, /30일 안에 예정된 매수가 없습니다\./);
console.log('ok - dca upcoming');
