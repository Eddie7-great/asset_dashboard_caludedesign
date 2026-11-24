const UA={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36','Accept':'application/json, text/plain, */*','Accept-Language':'en-US,en;q=0.9'};
async function get(u,h={}){try{const r=await fetch(u,{headers:{...UA,...h},signal:AbortSignal.timeout(30000)});return [r.status,await r.text()];}catch(e){return [0,String(e)];}}
for(const t of ['SCHD','QQQ','QLD','SPYM','DRAM','BMNU','AAPL','O']){
 for(const ac of ['etf','stocks']){const [st,x]=await get(`https://api.nasdaq.com/api/quote/${t}/dividends?assetclass=${ac}`,{Origin:'https://www.nasdaq.com',Referer:'https://www.nasdaq.com/'});
  let s;try{const d=JSON.parse(x);const rows=d?.data?.dividends?.rows||[];s=`rows=${rows.length} `+JSON.stringify(rows.slice(0,3))+' hdr='+JSON.stringify(d?.data?.exDividendDate||'')+' '+JSON.stringify(d?.data?.dividendPaymentDate||'')+' st='+JSON.stringify(d?.status?.rCode);}catch(e){s='ERR '+x.slice(0,150)}
  console.log('NQ',t,ac,st,s.slice(0,700));}}
// yahoo quoteSummary (crumb 없이)
for(const t of ['SCHD','AAPL']){const [st,x]=await get(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${t}?modules=calendarEvents,summaryDetail`);console.log('YQS',t,st,x.slice(0,400));}
// 국내 ETF 분배 지급일 후보
for(const c of ['360750','490590','133690']){
 const isin={360750:'KR7360750004',490590:'KR7490590007',133690:'KR7133690008'}[c];
 for(const u of [`https://www.funetf.co.kr/product/etf/view/${isin}`,`https://m.stock.naver.com/api/etf/${c}/dividend/history?pageSize=10`,`https://m.stock.naver.com/front-api/etf/dividend?code=${c}`,`https://m.stock.naver.com/front-api/stock/dividend?code=${c}`]){
  const [st,x]=await get(u);const m=(x.match(/.{0,60}(지급일|지급기준일|payDate|paymentDate).{0,120}/g)||[]).slice(0,6).join(' || ').replace(/\s+/g,' ');console.log('KR',u,st,x.length,m||x.slice(0,200).replace(/\s+/g,' '));}
}
// 네이버 모바일 페이지에서 배당/분배 관련 api 경로 찾기
{const [st,t]=await get('https://m.stock.naver.com/domestic/stock/360750/total');const js=(t.match(/src="([^"]+\.js)"/g)||[]).slice(0,40);console.log('HTML',st,js.length);
 for(const s of js){const u=s.slice(5,-1);const full=u.startsWith('http')?u:'https://m.stock.naver.com'+u;const [s2,b]=await get(full);const m=[...new Set((b.match(/["'`][^"'`]{0,60}(dividend|distribut)[^"'`]{0,60}["'`]/gi)||[]))].slice(0,15);if(m.length)console.log('JS',full,m.join(' '));}}
// 국내 주식 예탁원 SEIBro 배당 공시
{const [st,x]=await get('https://seibro.or.kr/websquare/control.jsp?w2xPath=/IPORTAL/user/company/BIP_CNTS01041V.xml&menuNo=285');console.log('SEI',st,x.length,x.slice(0,150).replace(/\s+/g,' '));}
