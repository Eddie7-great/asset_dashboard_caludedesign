import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync('script.js','utf8');
const fn=source.slice(source.indexOf('function renderBubbleChart(mode)'),source.indexOf('function _drawBubbleExternalLabels('));
let rendered;
const container={classList:{toggle(){}},getBoundingClientRect:()=>({width:0,height:0}),querySelector:()=>null};
const item=(owner,grp,tkr,val)=>({owner,grp,tkr,val});
const ctx=vm.createContext({window:{},document:{getElementById:id=>id==='sunburst-container'?container:null},
  isMobileLayout:()=>false,_bubbleOwner:'전체',RATES:{USD:1400},isDarkTheme:()=>false,cssVar:()=>'',
  _bubbleItemValueKRW:i=>i.val,_bubbleCategory:i=>i.grp,_renderBubbleSectorTable(){},
  _renderBubbleMobileWeights:(el,items,total)=>{rendered={items,total};},
  pfolioData:[item('A','주식','005930.KS',10),item('A','주식','005930',20),item('B','주식','005930',40),item('A','현금','005930',5),item('A','주식','BAD',Infinity),item('A','부동산','HOME',100)]});
vm.runInContext(fn,ctx);
ctx.renderBubbleChart();
assert.equal(rendered.total,75,'Without Plotly or measurable layout, finite investment values still render');
assert.equal(rendered.items.length,3,'Merge suffix variants within an owner and group, without merging other owners or asset types');
assert.equal(rendered.items.find(x=>x.raw.owner==='A'&&x.raw.grp==='주식').val,30);
console.log('PASS allocation fallback without chart CDN, finite totals and account aggregation');
