// 홈 '확인 필요' 줄: 이미 계산된 경고를 개수로만 모으고, 없으면 그리지 않는다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const cobalt = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8');
const src = cobalt.match(/let _cdashChecks=\[\];\nfunction cbDashChecks[\s\S]*?\nfunction cbDashCheckGo\(n\)\{[^\n]*\}/)[0];

function run({ rows = [], ta = null, pending = 0, status = [] }) {
  const visits = [];
  const ctx = vm.createContext({
    cbRowPriceStale: (r) => !!r.stale,
    finTargetAnalysis: () => ta,
    finMonthlyFixedCost: () => ({ pendingCount: pending }),
    finDataStatusRows: () => status,
    switchView: (v) => visits.push(v),
    switchCashFlowSection: (s) => visits.push('cf:' + s),
  });
  vm.runInContext(src + '\nlist = cbDashChecks(null, rows); for (let i = 0; i < list.length; i++) cbDashCheckGo(i);', Object.assign(ctx, { rows }));
  return { list: JSON.parse(JSON.stringify(ctx.list.map((c) => ({ label: c.label })))), visits };
}

// 아무 경고도 없으면 빈 목록 — 홈은 줄 자체를 그리지 않는다
assert.deepEqual(run({}).list.length, 0);

const r = run({
  rows: [
    { i: { grp: '주식' }, stale: true },
    { i: { grp: '현금' }, stale: true }, // 현금은 시세가 없으므로 세지 않는다
    { i: { grp: '주식' }, stale: false },
  ],
  ta: { total: 100, threshold: 3, result: [{ drift: 4.2 }, { drift: -3 }, { drift: -5 }] },
  pending: 2,
  status: [{ key: 'prices', state: 'warn' }, { key: 'ext', state: 'warn' }, { key: 'assets', state: 'pending' }],
});
assert.deepEqual(r.list.map((c) => c.label), [
  '시세 미조회 1종목',
  '리밸런싱 범위 밖 2개 자산군', // |편차| > 허용 편차 — 정확히 3%p 는 범위 안 (리밸런싱 막대와 같은 기준)
  '미분류 자동이체 2건',
  '데이터 확인 1건', // 시세 행은 위에서 이미 셌으므로 빼고, '확인 전(pending)'은 경고가 아니다
]);
assert.deepEqual(r.visits, ['holdings', 'rebal2', 'cashflow', 'cf:fixed', 'data2'], '각 항목은 해당 화면으로 이동');

// 투자자산이 0 이면 리밸런싱 편차를 경고로 세지 않는다
assert.equal(run({ ta: { total: 0, threshold: 3, result: [{ drift: -10 }] } }).list.length, 0);

// 렌더: 경고가 있을 때만 줄을 그리고, 라벨은 이스케이프한다
assert.match(cobalt, /\$\{checks\.length\?`<div class="cb-dash-checks" role="status">[\s\S]*cbEsc\(c\.label\)[\s\S]*`:''\}/);
// 숫자 카드는 예전 배지와 같은 값 — 총액 1개 + 이동 버튼 4개
assert.match(cobalt, /class="cb-dash-kpi is-total"[\s\S]*kpi\([^;]*오늘 손익[\s\S]*'perf2'\)[\s\S]*평가손익[\s\S]*'holdings'\)[\s\S]*'연 배당'[\s\S]*'divm'\)[\s\S]*'리스크'[\s\S]*'risk2'\)/);
assert.match(cobalt, /const kpi=\(label,value,valStyle,sub,view\)=>`<button type="button" class="cb-dash-kpi"/, '이동 카드는 진짜 button');

console.log('ok - home checks');
