import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import { readSource } from './_source.mjs'
const read=name=>readSource(name);
const html=read('index.html'),navigation=read('navigation.js'),sim=read('simulator.js');
const defaults={crypto:5,us:35,kr:25,jp:5,gold:10,cash:20};
const ctx=vm.createContext({FIN_DEFAULT_TARGET:defaults});
vm.runInContext(navigation+'\n'+sim,ctx);
const groups=JSON.parse(vm.runInContext('JSON.stringify(APP_NAV)',ctx));
assert.deepEqual(groups.map(g=>g.title),['홈','자산 관리','투자 분석','배당','투자 계획','현금 흐름','세금·증여','결산 리포트']);
assert.equal((html.match(/class="menu-btn\b/g)||[]).length,8);
assert.equal(ctx.navResolve('balance2'),'cdash','Retired balance-sheet links safely return home');
assert.ok(!html.includes('id="view-balance2"'));
for(const group of groups){
  assert.ok(html.includes(`id="menu-${group.menu}"`));
  for(const [view]of group.views){assert.ok(html.includes(`id="view-${view}"`));assert.equal(ctx.navGroup(view).menu,group.menu);}
}
assert.equal(ctx.navResolve('snap'),'cdash');assert.equal(ctx.navResolve('dashboard'),'cdash');
assert.equal(ctx.navResolve('risk2'),'risk2');assert.equal(ctx.navGroup('unknown'),undefined);
let previous='holdings';ctx.document={querySelector:()=>({id:'view-'+previous})};
ctx.currentOwner='아내';ctx._famKey='all';ctx._finPlanOwner='본인';ctx._cbDcaOwner='전체';
ctx._holdingsQ='삼성';ctx._famQ='';ctx._bubbleOwner='전체';ctx._etfOwner='전체';ctx._cfOwner='전체';ctx._calOwner='전체';ctx._acctOwner='전체';
ctx.navPrepare('fam2');assert.equal(ctx._famKey,'아내');assert.equal(ctx._famQ,'삼성','보유 목록 검색어를 구성원별로 잇는다');
// 페이지 통폐합(2026-11-19): 구성(bubble)은 투자 분석으로 옮겨 자산 관리와 다른 메뉴다 — 소유주를 잇지 않는다.
previous='fam2';ctx.currentOwner='전체';ctx.navPrepare('bubble');assert.equal(ctx.currentOwner,'전체');
previous='etf2';ctx._etfOwner='아내';ctx.navPrepare('bubble');
assert.equal(ctx.currentOwner,'아내');assert.equal(ctx._bubbleOwner,'아내');assert.equal(vm.runInContext('_navKeepOwner',ctx),true,'레거시 화면이 소유주를 되돌리지 않게 표식');
ctx.CF_OWNERS=['본인','아내'];
previous='cal2';ctx._calOwner='아내';vm.runInContext('_navKeepOwner=false',ctx);ctx.navPrepare('cashflow');
assert.equal(ctx._cfOwner,'아내','일정 → 현금 흐름은 소유주를 잇는다');assert.equal(vm.runInContext('_navKeepOwner',ctx),true);
previous='cal2';ctx._calOwner='자녀1';ctx.navPrepare('cashflow');
assert.equal(ctx._cfOwner,'전체','현금 흐름은 부부만 다룬다 — 자녀1·아버지는 부부 합계로 들어간다');
previous='cashflow';ctx._cfOwner='아내';ctx.navPrepare('cal2');assert.equal(ctx._calOwner,'아내');
previous='plan2';ctx.navPrepare('dca2');assert.equal(ctx._cbDcaOwner,'본인');
previous='dca2';ctx.navPrepare('sim2');assert.equal(vm.runInContext('_simOwner',ctx),'본인');
// All former top-level destinations remain reachable in the corresponding family.
for(const id of ['holdings','acct2','fam2','bubble','etf2','perf2','risk2','plan2','dca2','cal2','tax2','gift2','report2','reporty'])assert.ok(ctx.navGroup(id));
assert.ok(read('script.js').includes("typeof navResolve==='function'?navResolve(requestedView):requestedView"),'legacy snapshot hash must resolve before first history record');
assert.doesNotMatch(sim,/\b(?:setKV|saveAssetsToKV|saveExtDataToKV|localStorage|fetch)\s*[.(]/,'scenarios cannot persist or transmit');
assert.match(sim,/id="sim-monthly" type="text" inputmode="decimal" value="\$\{simAmtText\(s\.monthly\)\}"/,'금액 칸은 입력 중 쉼표가 들어가는 글자 칸');
assert.match(sim,/id="sim-months" type="number" data-no-comma="1"/,'기간·비율 칸은 기본 숫자 칸 그대로');
assert.match(sim,/function simValue\(value\)\{ const raw=String\(value\)\.replace\(\/,\/g,''\)\.trim\(\);/,'쉼표를 떼고 읽는다');
const zero=Object.fromEntries(Object.keys(defaults).map(k=>[k,0]));
const run=(current,weights,monthly,months,mode)=>JSON.parse(JSON.stringify(ctx.simCalculate(current,weights,monthly,months,mode)));
let r=run(zero,defaults,1000000,12,'gap');
assert.equal(r.budget,12000000);assert.equal(r.total,0);assert.equal(r.beforeGap,null);assert.equal(r.afterGap,0);
assert.deepEqual(r.rows.map(x=>x.buy),[600000,4200000,3000000,600000,1200000,2400000]);
const concentrated={...zero,us:100000000};
r=run(concentrated,defaults,1000000,12,'gap');
assert.equal(r.rows.find(x=>x.key==='us').buy,0,'new money must not go to an already overweight class');
assert.ok(r.afterGap<r.beforeGap);assert.deepEqual(concentrated,{...zero,us:100000000},'calculation must not mutate inputs');
assert.equal(run(concentrated,defaults,0,12).afterTotal,100000000);
assert.equal(run(concentrated,defaults,1000000,12,'target').rows.find(x=>x.key==='us').buy,4200000);
for(const monthly of [-1,NaN,Infinity,100000001])assert.ok(run(zero,defaults,monthly,12).error);
for(const months of [0,121,1.5,NaN])assert.ok(run(zero,defaults,100,months).error);
for(const weights of [{...defaults,us:50},{...defaults,us:NaN},{...defaults,us:-1}])assert.ok(run(zero,weights,100,12).error);
assert.ok(run({...zero,cash:-1},defaults,100,12).error);
assert.ok(Number.isNaN(ctx.simValue('')));assert.equal(ctx.simValue('0'),0);
// Non-even KRW budgets stay conserved, including rounding of six allocations.
let seed=17;const rand=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
for(let i=0;i<300;i++){
  const current=Object.fromEntries(Object.keys(defaults).map(k=>[k,Math.floor(rand()*1e8)]));
  const budget=Math.round(rand()*10000000)+1;
  for(const mode of ['gap','target']){
    const out=run(current,defaults,budget,1,mode);
    assert.equal(out.rows.reduce((s,x)=>s+x.buy,0),budget);
    assert.ok(out.rows.every(x=>Number.isInteger(x.buy)&&x.buy>=0&&x.after>=x.current));
    assert.equal(out.rows.reduce((s,x)=>s+x.after,0),out.afterTotal);
    assert.ok(Math.abs(out.rows.reduce((s,x)=>s+x.afterPct,0)-100)<1e-8);
  }
}
// 적립식 매수 화면은 조회 전용(2026-11-20 8차, 사용자 결정) — 관리 칸(수정·켜기/끄기 토글)과 cbDcaToggle 은 없다.
// 등록·수정·켜기/끄기는 보유 목록의 적립식 칸이 여는 설정 창(cbDcaEdit)이 맡고, 저장 가드(cbDcaCanSave·_dcaBusy)는 그 창이 쓴다.
{
  const cobaltSrc=read('cobalt.js');
  assert.doesNotMatch(cobaltSrc,/cbDcaToggle|dca-rule-edit|dca-rule-actions/,'적립식 화면의 토글·수정 버튼은 없앴다');
  const render=cobaltSrc.match(/function cbRenderDca\(\)\{[\s\S]*?\n\}\n/)[0];
  assert.doesNotMatch(render,/<span>관리<\/span>|cbDcaEdit\(/,'관리 칼럼이 없다');
  assert.match(render,/const st=dcaState\(x\.i\); return st==='on'\|\|st==='incomplete';/,'켜 둔 규칙만 — 중단한 규칙은 빠진다');
  assert.match(render,/onclick="switchView\('holdings'\)">보유 목록에서 수정 ›<\/button>/,'수정은 보유 목록으로 안내');
  assert.match(cobaltSrc,/let _dcaBusy=false;\nfunction cbDcaCanSave\(\)\{/,'저장 가드는 남긴다(설정 창이 쓴다)');
  assert.match(cobaltSrc,/async function cbDcaEditSave\(\)\{[\s\S]*?_dcaBusy[\s\S]*?cbDcaCanSave\(\)/,'설정 창 저장이 같은 가드를 쓴다');
  const start=cobaltSrc.indexOf('let _dcaBusy=false;');
  const end=cobaltSrc.indexOf('\n}\n',cobaltSrc.indexOf('function cbDcaCanSave('))+3;
  const errors=[];
  const dca=vm.createContext({window:{_kvLoadState:{assets:'ready',ext:'ready'}},showSaveError:m=>errors.push(m)});
  vm.runInContext(cobaltSrc.slice(start,end),dca);
  assert.equal(dca.cbDcaCanSave(),true);
  dca.window._kvLoadState.ext='loading';
  assert.equal(dca.cbDcaCanSave(),false,'두 원격 원장이 모두 로드돼야 저장한다');assert.equal(errors.length,1);
}
console.log('PASS: consolidated navigation, scenario conservation/validation, read-only DCA page');
