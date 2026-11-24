const UA={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36','Accept':'text/html,application/json,*/*','Accept-Language':'en-US,en;q=0.9'};
async function get(u,h={}){try{const r=await fetch(u,{headers:{...UA,...h},signal:AbortSignal.timeout(20000)});return [r.status,await r.text()];}catch(e){return [0,String(e)];}}
// 1) stockanalysis 배당 페이지 구조
{const [st,x]=await get('https://stockanalysis.com/stocks/o/dividend/');
 const i=x.indexOf('Pay Date');console.log('TBL',x.slice(i-300,i+1500).replace(/\s+/g,' '));
 const j=x.search(/"?(record|pay)[A-Za-z_]*"?\s*:/);console.log('JSON',j,j>0?x.slice(j-400,j+800).replace(/\s+/g,' '):'');}
// 2) 네이버 국내 ETF 분배 이력 — code 파라미터 조합
const base='https://m.stock.naver.com/front-api/stock/domestic/etf/dividendHistory/list';
for(const q of ['code=360750','code=360750&page=1','code=360750&page=1&pageSize=5&firstPageSize=5','code=360750&pageSize=10&firstPageSize=10&page=1','code=490590&page=1&pageSize=12&firstPageSize=12','code=133690&page=1&pageSize=12&firstPageSize=12']){
  const [s,x]=await get(base+'?'+q,{Referer:'https://m.stock.naver.com/domestic/stock/360750/total'});console.log('NV',q,s,x.slice(0,900).replace(/\s+/g,' '));}
// 3) 국내 주식(005930) 배당 지급일 후보 — 네이버 모바일 주식 배당 탭이 쓰는 경로
for(const u of ['https://m.stock.naver.com/front-api/stock/domestic/dividend/list?code=005930&page=1&pageSize=10&firstPageSize=10','https://m.stock.naver.com/front-api/stock/domestic/stock/dividendHistory/list?code=005930&page=1&pageSize=10&firstPageSize=10']){
  const [s,x]=await get(u,{Referer:'https://m.stock.naver.com/domestic/stock/005930/total'});console.log('NVS',u,s,x.slice(0,500).replace(/\s+/g,' '));}
