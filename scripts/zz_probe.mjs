const UA={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'};
async function get(u){try{const r=await fetch(u,{headers:UA});const t=await r.text();return [r.status,t];}catch(e){return [0,String(e)];}}
const kr=['0117V0','0162Z0','0167A0','133690','360750','361580','426020','426030','442580','487230','490590','005930'];
const us=['1629.T','DRAM','QLD','QQQ','SPYM','BMNU','SCHD'];
for(const c of kr){for(const s of ['.KS','.KQ']){const [st,t]=await get(`https://query1.finance.yahoo.com/v8/finance/chart/${c}${s}?interval=1mo&range=10y&events=div`);let n='-';try{const d=JSON.parse(t);const ev=d.chart.result[0].events?.dividends||{};const v=Object.values(ev);n=v.length+' '+v.slice(-3).map(e=>new Date(e.date*1000).toISOString().slice(0,10)+':'+e.amount).join(',');}catch(e){n='ERR '+t.slice(0,80)}console.log('Y',c+s,st,n);}}
for(const c of us){const [st,t]=await get(`https://query1.finance.yahoo.com/v8/finance/chart/${c}?interval=1mo&range=10y&events=div`);let n;try{const d=JSON.parse(t);const v=Object.values(d.chart.result[0].events?.dividends||{});const ys={};v.forEach(e=>{const y=new Date(e.date*1000).getUTCFullYear();ys[y]=(ys[y]||0)+1});n=v.length+' '+JSON.stringify(ys);}catch(e){n='ERR '+t.slice(0,80)}console.log('Y',c,st,n);}
// daily interval to compare
{const [st,t]=await get(`https://query1.finance.yahoo.com/v8/finance/chart/005930.KS?interval=1d&range=10y&events=div`);try{const d=JSON.parse(t);console.log('Y1d 005930',st,Object.keys(d.chart.result[0].events?.dividends||{}).length);}catch(e){console.log('Y1d err',st,t.slice(0,100))}}
const cands=c=>[
 `https://m.stock.naver.com/api/stock/${c}/integration`,
 `https://m.stock.naver.com/api/etf/${c}/dividend/history`,
 `https://m.stock.naver.com/api/etf/${c}/dividend`,
 `https://m.stock.naver.com/api/stock/${c}/dividend/history`,
 `https://m.stock.naver.com/api/stock/${c}/dividend`,
 `https://m.stock.naver.com/api/stock/${c}/finance/dividend`,
 `https://m.stock.naver.com/api/etf/${c}/distribution`,
 `https://api.stock.naver.com/etf/${c}/dividend`,
 `https://m.stock.naver.com/api/stock/${c}/etfAnalysis`,
 `https://m.stock.naver.com/api/stock/${c}/basic`,
];
for(const c of ['360750','490590','005930']){for(const u of cands(c)){const [st,t]=await get(u);console.log('N',u,st,t.slice(0,600).replace(/\s+/g,' '));}}
// page html of mobile etf to find api paths
{const [st,t]=await get('https://m.stock.naver.com/domestic/stock/360750/total');console.log('HTML',st,(t.match(/\/api\/[a-zA-Z0-9_\/\{\}\-]+/g)||[]).slice(0,80).join(' '));}
// funetf
{const [st,t]=await get('https://www.funetf.co.kr/product/etf/view/KR7360750004');console.log('FUN',st,(t.match(/분배[^<]{0,80}/g)||[]).slice(0,10).join(' | '));}
// seibro / krx distribution
