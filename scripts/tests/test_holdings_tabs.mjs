// 보유 목록: 자산군 탭·검색·시세 미조회 필터는 '보여 주기'만 바꾸고 합계·저장 경로는 그대로다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const script = fs.readFileSync(new URL('script.js', root), 'utf8');
const ws = fs.readFileSync(new URL('workspace-ui.css', root), 'utf8');
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const nav = fs.readFileSync(new URL('navigation.js', root), 'utf8');

const helper = script.match(/let _holdingsTab='주식'[\s\S]*?\nfunction holdingsRowMatches\(i\)\{[\s\S]*?\n\}/)[0];
const ctx = vm.createContext({});
vm.runInContext(helper + '\nthis.set=(q,s)=>{_holdingsQ=q;_holdingsStaleOnly=s;};this.m=holdingsRowMatches;', ctx);
const item = { name: '삼성전자', tkr: '005930', broker: '토스', acc: 'ISA', owner: '아내' };
ctx.set('', false); assert.equal(ctx.m(item), true, '필터 없으면 모두 보인다');
ctx.set('isa', false); assert.equal(ctx.m(item), true, '계좌명 검색(대소문자 무시)');
ctx.set('아내', false); assert.equal(ctx.m(item), true, '소유주 검색');
ctx.set('nvda', false); assert.equal(ctx.m(item), false);
ctx.set('', true); assert.equal(ctx.m(item), false, '시세 미조회만 — 정상 시세 행은 숨김');
assert.equal(ctx.m({ ...item, _priceStale: true }), true);

// 행 숨김은 합계를 더한 '뒤'에 한다 — 검색해도 그룹 합계·숫자 카드가 바뀌지 않는다
assert.match(script, /grpItems\.forEach\(i=>\{\n\s*const _rowStart=rowsHtml\.length;[\s\S]*?if\(!holdingsRowMatches\(i\)\) rowsHtml=rowsHtml\.slice\(0,_rowStart\);/);
assert.match(script, /grpStats\[grpName\]=\{count:grpItems\.length,total:grpTotal,invest:grpInvest,known:grpKnownTotal/);

// 탭: 진짜 tab 버튼 + 연결된 tabpanel, 지금 탭만 보임
assert.match(script, /role="tab" class="holdings-tab" id="holdings-tab-\$\{g\}"[^`]*aria-controls="holdings-panel-\$\{g\}" aria-selected="\$\{g===_holdingsTab\}"/);
assert.match(script, /id="holdings-panel-\$\{grpName\}" role="tabpanel" aria-labelledby="holdings-tab-\$\{grpName\}"\$\{grpName===_holdingsTab\?'':' hidden'\}/);
assert.doesNotMatch(script, /portToggleState/, '예전 접기 상태는 없앴다');
// 추가는 기존 모달(같은 저장 경로)을 연다
assert.match(script, /class="holdings-add-btn" onclick="openAddModal\('\$\{_holdingsTab\}'\)"/);
// 수정 창은 같은 DOM 을 넓은 화면에서만 오른쪽 패널로 — 좁은 화면은 팝업 유지
assert.match(ws, /@media\(min-width:1101px\)\{\n\s*#add-modal\.modal-overlay\{[^}]*right:0;width:440px/);
assert.match(ws, /body:has\(#add-modal\.active\) \.content-area\{padding-right:440px/, '패널이 표를 가리지 않도록 본문 오른쪽을 비운다');

// 수량 옆 단위 상자(주/개)·단위 선택(g/돈/kg)은 세로 padding 없이 입력칸 높이를 따른다 —
// padding:10px 이면 상자가 46px 로 커져 '수량' 제목이 옆 '평균단가' 제목보다 10px 위로 떴다
assert.match(html, /<div id="unit-fixed" style="display:flex;align-items:center;padding:0 12px;/);
assert.match(html, /<select id="add-unit" class="form-input" style="flex:0\.7;padding:0 4px;/);

// 휴대폰: 같은 숫자 카드(kpis) → 자산군 탭 → 조회 전용 카드 목록. 추가 버튼은 없다.
assert.match(script, /if\(_mobileHoldings&&typeof cbAssetMobile==='function'\)\{cbAssetMobile\(kpis\);return;\}/);
assert.match(script, /_holdingsBrokerFilter!=='전체'&&!_mobileHoldings/, '휴대폰엔 계좌 필터가 없으니 숫자 카드에 필터를 걸지 않는다');
const mobileSrc = nav.match(/let _assetQ=''[^\n]*\n[\s\S]*?\nfunction cbAssetSearch\(value\)\{[\s\S]*?\n\}/)[0];
const dom = { innerHTML: '', focus() {}, setSelectionRange() {} };
const rowsAll = [
  { title: 'VOO', subTitle: '', i: { grp: '주식', tkr: 'VOO', owner: '본인' } },
  { title: '삼성전자', subTitle: '', i: { grp: '주식', tkr: '005930', owner: '아내' } },
  { title: '달러 예수금', subTitle: '', i: { grp: '현금', tkr: 'USD_1', owner: '본인' } },
];
const mctx = vm.createContext({
  document: { getElementById: () => dom }, currentOwner: '전체', _holdingsTab: '주식', HOLDINGS_TABS: ['주식', '가상화폐', '금', '현금'],
  finOwnerF: () => null, finRows: () => rowsAll, cbMergeRows: r => r, cbSortOwnerNameVal: r => r,
  cbMobileHoldings: (rows) => '<list>' + rows.map(r => r.title).join(',') + '</list>',
});
vm.runInContext(mobileSrc.replace(/^let /, 'var '), mctx);
mctx.cbAssetMobile('<KPI/>');
assert.ok(dom.innerHTML.startsWith('<KPI/><div class="holdings-tabs holdings-tabs-mobile" role="tablist"'), '숫자 카드 다음에 탭');
assert.match(dom.innerHTML, /<list>VOO,삼성전자<\/list>$/, '선택한 자산군 행만 목록에');
assert.match(dom.innerHTML, /data-grp="주식" aria-selected="true"[^>]*>주식<span>2<\/span>/);
assert.match(dom.innerHTML, /현금<span>1<\/span>/, '탭 개수는 목록에 보이는 행 수');
assert.doesNotMatch(dom.innerHTML, /holdings-add-btn/, '휴대폰은 조회 전용');
mctx.cbAssetSearch('삼성');
assert.ok(dom.innerHTML.startsWith('<KPI/>'), '검색으로 다시 그려도 숫자 카드는 그대로');
assert.match(dom.innerHTML, /<list>삼성전자<\/list>$/);
assert.match(dom.innerHTML, /주식<span>2<\/span>/, '검색은 행만 숨기고 탭 개수는 바꾸지 않는다');

console.log('ok - holdings tabs');

// 2026-11-11 — 탭(왼쪽)과 검색·계좌·시세 미조회만·＋추가(오른쪽)를 한 줄에 둔다
{
  const fs2 = await import('node:fs');
  const root2 = new URL('../../', import.meta.url);
  const s2 = fs2.readFileSync(new URL('script.js', root2), 'utf8');
  const w2 = fs2.readFileSync(new URL('workspace-ui.css', root2), 'utf8');
  if (!/<div class="holdings-card"><div class="holdings-head">\$\{tabs\}\$\{toolbar\}<\/div>\$\{html\}<\/div>/.test(s2)) throw new Error('탭과 도구가 한 머리줄에 있어야 한다');
  if (!/\.holdings-head\{display:flex;flex-wrap:wrap;align-items:center;[^}]*border-bottom/.test(w2)) throw new Error('머리줄이 밑줄을 가진다');
  if (!/\.holdings-toolbar\{[^}]*justify-content:flex-end;[^}]*margin-left:auto/.test(w2)) throw new Error('도구는 오른쪽 정렬');
  if (/\.holdings-add-btn\{margin-left:auto/.test(w2)) throw new Error('＋추가 버튼만 따로 밀지 않는다');
  console.log('PASS 자산 관리 머리줄');
}
