import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const old={asOf:'2026-09-09',source:'FunETF',coverage:'full',holdings:[{t:'NVDA',w:10}]};
let requests=0,fail=false,release;
const ctx=vm.createContext({console,Date,Map,Set,AbortController,setTimeout,clearTimeout,window:{},
  cbStrip:x=>x,cbIsEtf:()=>true,cbAllRows:()=>[{i:{tkr:'133690'}}],
  cbEnsureEtfHoldings:async()=>{},cbEtfDoc:()=>({etfs:{133690:ctx.window._etfLiveEntries?.['133690']||old}}),
  fetch:async()=>{requests++;if(release)await new Promise(resolve=>{release=resolve;});if(fail)throw Error('offline');return {ok:true,json:async()=>({success:true,code:'133690',entry:{...old,asOf:'2026-09-10'}})};}});
vm.runInContext(fs.readFileSync('etf-explorer.js','utf8'),ctx);
vm.runInContext('etfRenderLiveUpdate=()=>{}',ctx);
assert.equal(ctx.etfAcceptLive(old,{...old,asOf:'2026-09-08'}),null);
assert.equal(ctx.etfAcceptLive(old,{...old,asOf:null,coverage:'partial'}),null);
assert.equal(ctx.etfAcceptLive(old,{...old,holdings:[{t:'A',w:NaN}]}),null);
const correction=ctx.etfAcceptLive(old,{...old,holdings:[{t:'NVDA',w:11}]});
assert.equal(correction.history.length,1);assert.equal(correction.holdings[0].w,11);
await ctx.etfRefreshOnOpen();await ctx.etfRefreshOnOpen();
assert.equal(requests,2,'Every page entry queries again');
assert.equal(ctx.window._etfLiveEntries['133690'].asOf,'2026-09-10');
fail=true;await ctx.etfRefreshOnOpen();
assert.equal(ctx.window._etfLiveEntries['133690'].asOf,'2026-09-10');
assert.match(ctx.etfLiveMessage('133690'),/조회 실패/);
fail=false;release=true;
const superseded=ctx.etfRefreshOnOpen();
while(typeof release!=='function')await Promise.resolve();
const resume=release;release=null;fail=true;
await ctx.etfRefreshOnOpen();
fail=false;resume();await superseded;
assert.match(ctx.etfLiveMessage('133690'),/조회 실패/,'Superseded successful response must not overwrite the latest attempt');
console.log('PASS per-open ETF refresh and last-good protection');
