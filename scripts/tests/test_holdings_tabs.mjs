// 보유 목록: 자산군 탭·검색·시세 미조회 필터는 '보여 주기'만 바꾸고 합계·저장 경로는 그대로다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const script = fs.readFileSync(new URL('script.js', root), 'utf8');
const ws = fs.readFileSync(new URL('workspace-ui.css', root), 'utf8');

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

console.log('ok - holdings tabs');
