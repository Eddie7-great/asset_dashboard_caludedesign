const UA={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'};
async function get(u){try{const r=await fetch(u,{headers:UA,signal:AbortSignal.timeout(50000)});return [r.status,await r.text()];}catch(e){return [0,String(e)];}}
const strip=t=>t.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ');
const tries=[
 'https://www.law.go.kr/LSW/lsInfoR.do?lsiSeq=280405&chrClsCd=010202&urlMode=lsInfoP&viewCls=lsInfoP&efYd=20260101&ancYnChk=0',
 'https://www.law.go.kr/LSW/lsInfoR.do?lsiSeq=280405',
 'https://www.law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=00&joNo=0050&lsiSeq=280405&urlMode=lsScJoRltInfoR',
];
for(const u of tries){const [st,t]=await get(u);const s=strip(t);const i=s.indexOf('제50조(기본공제)');console.log('URL',u,st,s.length,i>=0?s.slice(i,i+1300):'NF '+s.slice(0,150));
 const m=(t.match(/lsJoLnkSeq=\d+/g)||[]);console.log('LNK',m.length,[...new Set(m)].slice(0,5).join(' '));
 const j=t.indexOf('제50조(기본공제)'); if(j>=0) console.log('RAW',t.slice(Math.max(0,j-600),j+100).replace(/\s+/g,' '));}
