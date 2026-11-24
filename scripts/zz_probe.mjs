const UA={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36','Accept':'text/html,application/json,*/*','Accept-Language':'en-US,en;q=0.9'};
async function get(u,h={}){try{const r=await fetch(u,{headers:{...UA,...h},signal:AbortSignal.timeout(20000)});return [r.status,await r.text()];}catch(e){return [0,String(e)];}}
// 1) stockanalysis 공개 배당 페이지(미국 ETF·주식) — 지급일(Pay Date) 열이 있는지
for(const [k,t] of [['etf','schd'],['etf','qld'],['etf','spym'],['etf','dram'],['etf','bmnu'],['etf','qqq'],['stocks','o'],['stocks','jpm']]){
  const [st,x]=await get(`https://stockanalysis.com/${k}/${t}/dividend/`);
  const i=x.indexOf('Pay Date');
  const pd=(x.match(/pay_?[dD]ate"?:"?[^,}]{0,20}/g)||[]).slice(0,4);
  console.log('SA',k,t,st,x.length,'idx',i,i>0?x.slice(i,i+400).replace(/<[^>]+>/g,' ').replace(/\s+/g,' '):'','| pd',pd.join(' '));
}
// 2) 네이버 국내 ETF 분배 이력(공개 모바일 페이지가 쓰는 경로)
for(const u of [
  'https://m.stock.naver.com/front-api/stock/domestic/etf/dividendHistory/list?itemCode=360750&page=1&pageSize=10',
  'https://m.stock.naver.com/front-api/stock/domestic/etf/dividendHistory/list?code=360750&page=1&pageSize=10',
  'https://m.stock.naver.com/front-api/stock/domestic/etf/dividendHistory/list?itemCode=360750&page=1&pageSize=10&firstPageSize=10',
]){const [s,x]=await get(u,{Referer:'https://m.stock.naver.com/domestic/stock/360750/total'});console.log('NV',u,s,x.slice(0,600).replace(/\s+/g,' '));}
