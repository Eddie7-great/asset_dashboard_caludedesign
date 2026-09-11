import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../../'+name,import.meta.url),'utf8');
const html=read('index.html'),navigation=read('navigation.js'),sim=read('simulator.js');
const defaults={crypto:5,us:35,kr:25,jp:5,gold:10,cash:20};
const ctx=vm.createContext({FIN_DEFAULT_TARGET:defaults});
vm.runInContext(navigation+'\n'+sim,ctx);
const groups=JSON.parse(vm.runInContext('JSON.stringify(APP_NAV)',ctx));
assert.deepEqual(groups.map(g=>g.title),['홈','자산 관리','투자 분석','배당','투자 계획','현금 흐름','세금·증여']);
assert.equal((html.match(/class="menu-btn\b/g)||[]).length,7);
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
ctx.navPrepare('fam2');assert.equal(ctx._famKey,'아내');
previous='fam2';ctx.currentOwner='전체';ctx.navPrepare('bubble');assert.equal(ctx.currentOwner,'아내');
previous='plan2';ctx.navPrepare('dca2');assert.equal(ctx._cbDcaOwner,'본인');
previous='dca2';ctx.navPrepare('sim2');assert.equal(vm.runInContext('_simOwner',ctx),'본인');
// All former top-level destinations remain reachable in the corresponding family.
for(const id of ['holdings','fam2','bubble','perf2','risk2','plan2','dca2','tax2','gift2'])assert.ok(ctx.navGroup(id));
assert.ok(read('script.js').includes("typeof navResolve==='function'?navResolve(requestedView):requestedView"),'legacy snapshot hash must resolve before first history record');
assert.doesNotMatch(sim,/\b(?:setKV|saveAssetsToKV|saveExtDataToKV|localStorage|fetch)\s*[.(]/,'scenarios cannot persist or transmit');
assert.match(sim,/id="sim-monthly" type="number" data-no-comma="1"/,'native numeric input must survive global comma formatting');
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
// DCA edits only change the selected account's plan fields, preserving valuations.
const items=[{owner:'본인',grp:'주식',tkr:'AAPL',acc:'ISA',qty:12,avgP:155,curP:190,costUnknown:true},{owner:'본인',grp:'주식',tkr:'AAPL',acc:'일반',qty:9,avgP:170,curP:190}];
let saved=0,success=true;
const dca=vm.createContext({pfolioData:items,isMobileLayout:()=>false,window:{_kvLoadState:{assets:'ready',ext:'ready'}},showSaveError:()=>{},cbRenderDca:()=>{},document:{getElementById:()=>null},saveAssetsToKV:async()=>{saved++;return{ok:success};}});
vm.runInContext(read('dca-editor.js'),dca);
dca.cbDcaEdit(1);dca.cbDcaDraft('dcaAmt','250000');await dca.cbDcaSave();
assert.equal(saved,1);assert.equal(items[1].dcaAmt,250000);assert.equal(items[0].dcaAmt,undefined);assert.equal(items[1].qty,9);assert.equal(items[1].avgP,170);assert.equal(items[1].curP,190);assert.equal(items[0].costUnknown,true);
dca.cbDcaEdit(1);dca.cbDcaDraft('dcaAmt','400000');success=false;await dca.cbDcaSave();assert.equal(items[1].dcaAmt,250000,'failed save rolls back the in-memory rule');
assert.equal(vm.runInContext('_dcaDraft.dcaAmt',dca),'400000','draft survives a failed save');
dca.cbDcaDraft('dcaAmt','0');await dca.cbDcaSave();assert.equal(saved,2,'invalid rule is not saved');
dca.cbDcaDraft('dcaAmt','500000');items[1]={...items[1]};await dca.cbDcaSave();assert.equal(saved,2,'a stale edit cannot patch a replaced asset');
dca.cbDcaEdit(0);dca.cbDcaDraft('dcaAmt','100000');dca.window._kvLoadState.ext='loading';await dca.cbDcaSave();assert.equal(saved,2,'both remote loads are required');
console.log('PASS: consolidated navigation, scenario conservation/validation, isolated DCA saves');
