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
assert.equal(requests,2,'A snapshot that needs refreshing is queried on every page entry');
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

const before=requests;await ctx.etfRefreshOnOpen("not-held");assert.equal(requests,before,"Targeted retry cannot query an unheld ETF");

// 구성종목은 리밸런싱 주기로 갱신한다 — 주기상 최신이고 완전한 자료는 진입할 때마다 원본을 다시 묻지 않는다.
{
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
  const fresh={asOf:today,source:'FunETF',coverage:'full',rebalance:'quarterly',holdings:[{t:'NVDA',w:10}]};
  const asked=[];
  const ctx2=vm.createContext({console,Date,Map,Set,AbortController,setTimeout,clearTimeout,window:{},
    cbStrip:x=>x,cbIsEtf:()=>true,cbAllRows:()=>[{i:{tkr:'133690'}},{i:{tkr:'426020'}}],
    cbEnsureEtfHoldings:async()=>{},cbEtfDoc:()=>({etfs:{133690:fresh,426020:old}}),
    fetch:async url=>{const code=new URL(url,'https://x').searchParams.get('ticker');asked.push(code);
      return {ok:true,json:async()=>({success:true,code,entry:{...(code==='133690'?fresh:old),asOf:code==='133690'?today:'2026-09-10'}})};}});
  vm.runInContext(fs.readFileSync('etf-explorer.js','utf8'),ctx2);
  vm.runInContext('etfRenderLiveUpdate=()=>{}',ctx2);
  await ctx2.etfRefreshOnOpen();
  assert.deepEqual(asked,['426020'],'페이지 진입은 갱신이 필요한 ETF 만 조회한다');
  assert.match(ctx2.etfLiveMessage('133690'),/주기상 최신/);
  await ctx2.etfRefreshOnOpen('133690');
  assert.deepEqual(asked,['426020','133690'],'점검 행의 개별 다시 확인은 최신이어도 조회한다');
  console.log('PASS cycle-aware page entry: only ETFs that need refreshing are queried');
}
