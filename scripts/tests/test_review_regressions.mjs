import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {load} from 'cheerio'

const script=fs.readFileSync(new URL('../../script.js',import.meta.url),'utf8')
const cobalt=fs.readFileSync(new URL('../../cobalt.js',import.meta.url),'utf8')
function fn(source,name) {
  const asyncStart=source.indexOf(`async function ${name}(`)
  const start=asyncStart<0?source.indexOf(`function ${name}(`):asyncStart
  assert.ok(start>=0,name)
  let depth=0
  for(let i=source.indexOf('{',start);i<source.length;i++) {
    if(source[i]==='{')depth++
    if(source[i]==='}'&&--depth===0)return source.slice(start,i+1)
  }
  throw new Error(name)
}

// Sorting reads raw values, so signs, display currency and masked text cannot change the order.
{
  const ctx=vm.createContext({_sortState:{}})
  vm.runInContext(fn(script,'portfolioSortData')+'\n'+fn(script,'sortPortfolioTable'),ctx)
  const values=[-2400,1200,null,0,900]
  const rows=values.map((value,id)=>({id,getAttribute:key=>key==='data-sort-profit'?value==null?'':String(value):null}))
  const tbody={querySelectorAll:()=>rows,appendChild:row=>{rows.splice(rows.indexOf(row),1);rows.push(row)}}
  const header={classList:{add(){},remove(){}},setAttribute(k,v){this[k]=v},closest:()=>table}
  const table={querySelector:()=>tbody,querySelectorAll:()=>[header]}
  const button={closest:()=>header}
  ctx.sortPortfolioTable('주식','profit',button)
  assert.deepEqual(rows.map(r=>r.id),[1,4,3,0,2],'양수→0→손실→취득가 미상')
  assert.equal(header['aria-sort'],'descending')
  ctx.sortPortfolioTable('주식','profit',button)
  assert.deepEqual(rows.map(r=>r.id),[0,3,4,1,2],'오름차순에서도 미상은 마지막')
  assert.equal(header['aria-sort'],'ascending')
  const $=load('<tr '+ctx.portfolioSortData({avgP:123.45,curP:9876,profitPct:-12.3,profit:null})+'></tr>',null,false)
  assert.equal($('tr').attr('data-sort-profitpct'),'-12.3')
  assert.equal($('tr').attr('data-sort-avgp'),'123.45','달러·엔화 기호가 없는 원시 가격')
  assert.equal($('tr').attr('data-sort-profit'),'','미상을 0으로 바꾸지 않음')
}

// Only the actual same-origin preview iframe may reuse a server-verified session.
for(const scenario of ['top','unrelated-frame','cross-origin','valid','expired','unavailable']) {
  const calls=[];let starts=0
  const win={}
  const parent={location:{origin:'https://dashboard.test'},document:{getElementById:()=>({contentWindow:scenario==='unrelated-frame'?{}:win})}}
  win.parent=scenario==='top'?win:parent
  if(scenario==='cross-origin')Object.defineProperty(parent,'location',{get(){throw new Error('cross-origin access')}})
  const ctx=vm.createContext({window:win,location:{origin:'https://dashboard.test'},console:{warn(){}},
    _layoutPreviewMode:()=>true,_setAuthenticatedUi:()=>{},_startDashboardAfterAuth:()=>starts++,
    fetch:async(_url,options)=>{calls.push(options.method);if(scenario==='unavailable')throw new Error('offline');return {ok:true,json:async()=>({authenticated:scenario!=='expired'})}},
  })
  vm.runInContext(fn(script,'startTrustedLayoutPreview'),ctx)
  const embedded=await ctx.startTrustedLayoutPreview()
  const trusted=['valid','expired','unavailable'].includes(scenario)
  assert.equal(embedded,trusted,scenario)
  assert.deepEqual(calls,trusted?['GET']:[],scenario+' never deletes shared cookie')
  assert.equal(starts,scenario==='valid'?1:0,scenario+' starts only after server authentication')
}

// A failed/missing dividend lookup is distinct from a verified empty history.
{
  const item={grp:'주식',qty:2,tkr:'MSFT'}
  const ctx=vm.createContext({window:{_divDataCache:{}},cbStrip:t=>t.replace(/\.(KS|KQ|T)$/,'')})
  for(const name of ['cbDivOf','cbSnapDivCoverage','cbDividendStatus'])vm.runInContext(fn(cobalt,name),ctx)
  assert.equal(ctx.cbDividendStatus(item).state,'pending')
  ctx.window._divFetchCoverage={status:'partial',verified:['AAPL'],missing:['MSFT']}
  assert.equal(ctx.cbDividendStatus(item).state,'error')
  ctx.window._divDataCache.MSFT={annualDps:3}
  assert.equal(ctx.cbDividendStatus(item).state,'error','과거 데이터가 있어도 새 조회 실패 표시')
  ctx.window._divFetchCoverage.verified.push('MSFT')
  assert.equal(ctx.cbDividendStatus(item).state,'ready','다른 종목 실패가 확인된 종목까지 차단하지 않음')
  delete ctx.window._divDataCache.MSFT
  assert.equal(ctx.cbDividendStatus(item).state,'none','확인된 무배당만 무배당 상태')
}

// Compact mobile rows retain full names and null acquisition costs without inventing a return.
{
  const ctx=vm.createContext({_cdashQ:'',_dispCur:'KRW',cbRate:()=>1})
  for(const name of ['cbEsc','cbDisp','cbSignDisp','cbFmtNative','cbPct','cbUpDn','cbMobileHoldings'])vm.runInContext(fn(cobalt,name),ctx)
  const html=ctx.cbMobileHoldings([{title:'Long <ETF> & name',subTitle:'VOO',val:1000000,gainPct:null,gain:0,qty:4,avgNative:0,cl:{label:'미국 주식'},i:{owner:'본인',grp:'주식',cur:'USD',curP:250,costUnknown:true}}])
  const $=load(html)
  assert.match($('summary').text(),/Long <ETF> & name/)
  assert.match($('summary').text(),/₩1,000,000/)
  assert.match($('summary').text(),/—/)
  assert.match($('dl').text(),/취득가 미상/)
  assert.match($('dl').text(),/산정 제외/)
  assert.equal($('etf').length,0,'종목명이 HTML로 실행되지 않음')
}
console.log('PASS 정렬·미리보기 인증·배당 확인 상태·모바일 상세 회귀')
