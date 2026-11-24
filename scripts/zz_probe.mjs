const UA={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36','Accept':'application/json, text/plain, */*','Accept-Language':'en-US,en;q=0.9'};
async function get(u,h={}){try{const r=await fetch(u,{headers:{...UA,...h},signal:AbortSignal.timeout(30000)});return [r.status,await r.text(),r];}catch(e){return [0,String(e)];}}
const NQH={Origin:'https://www.nasdaq.com',Referer:'https://www.nasdaq.com/'};
for(const t of ['SCHD','O','JEPI','MU','SPY','VYM','MSFT','JPM','QLD']){
 for(const ac of ['etf','stocks']){const [st,x]=await get(`https://api.nasdaq.com/api/quote/${t}/dividends?assetclass=${ac}`,NQH);
  let s;try{const d=JSON.parse(x);const rows=d?.data?.dividends?.rows||[];s=`rows=${rows.length} `+JSON.stringify(rows.slice(0,2))+' st='+JSON.stringify(d?.status);}catch(e){s='ERR '+x.slice(0,150)}
  console.log('NQ',t,ac,st,s.slice(0,500));}}
// yahoo crumb
{const [s1,,r1]=await get('https://fc.yahoo.com/',{Accept:'*/*'});const ck=(r1?.headers?.getSetCookie?.()||[]).map(c=>c.split(';')[0]).join('; ');console.log('FC',s1,ck.slice(0,60));
 const [s2,crumb]=await get('https://query2.finance.yahoo.com/v1/test/getcrumb',{Cookie:ck,Accept:'*/*'});console.log('CRUMB',s2,crumb.slice(0,40));
 for(const t of ['SCHD','O','QLD','MU','360750.KS','0117V0.KS']){const [st,x]=await get(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${t}?modules=calendarEvents,summaryDetail&crumb=${encodeURIComponent(crumb)}`,{Cookie:ck});
  let s;try{const d=JSON.parse(x);const r=d.quoteSummary.result[0];s=JSON.stringify(r.calendarEvents)+' exDiv='+JSON.stringify(r.summaryDetail?.exDividendDate);}catch(e){s='ERR '+x.slice(0,150)}console.log('YQS',t,st,s.slice(0,400));}}
// 네이버 ETF 분배 이력 API 찾기
{const [st,t]=await get('https://m.stock.naver.com/domestic/stock/360750/total');const js=[...new Set((t.match(/src="([^"]+\.js)"/g)||[]).map(s=>s.slice(5,-1)))];
 for(const u of js){const full=u.startsWith('http')?u:'https://m.stock.naver.com'+u;const [,b]=await get(full);const m=[...new Set((b.match(/.{0,120}dividendHistory.{0,160}/g)||[]))].slice(0,6);if(m.length)console.log('JS',full,'\n  '+m.join('\n  '));}
 const [s3,p]=await get('https://m.stock.naver.com/stock/domestic/etf/dividendHistory/list?code=360750');console.log('PAGE',s3,p.length,(p.match(/\/api\/[^"' ]+/g)||[]).slice(0,30).join(' '));
 const [s4,p2]=await get('https://m.stock.naver.com/domestic/stock/360750/dividend');console.log('PAGE2',s4,p2.length);
 const js2=[...new Set((p2.match(/src="([^"]+\.js)"/g)||[]).map(s=>s.slice(5,-1)))];
 for(const u of js2){const full=u.startsWith('http')?u:'https://m.stock.naver.com'+u;const [,b]=await get(full);const m=[...new Set((b.match(/.{0,100}(ividend|istribution)[A-Za-z]*\/.{0,140}/g)||[]))].slice(0,8);if(m.length)console.log('JS2',full,'\n  '+m.join('\n  '));}
 for(const u of ['https://m.stock.naver.com/api/stock/360750/dividend/history','https://m.stock.naver.com/api/etf/360750/dividendHistory','https://m.stock.naver.com/api/stock/360750/dividendHistory?page=1&pageSize=10','https://api.stock.naver.com/etf/360750/dividendHistory','https://m.stock.naver.com/front-api/etf/dividendHistory?code=360750','https://m.stock.naver.com/front-api/stock/domestic/etf/dividendHistory?itemCode=360750']){const [s,x]=await get(u,{Referer:'https://m.stock.naver.com/'});console.log('NV',u,s,x.slice(0,300).replace(/\s+/g,' '));}
}
