const UA={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'};
async function get(u){try{const r=await fetch(u,{headers:UA,signal:AbortSignal.timeout(40000)});return [r.status,await r.text()];}catch(e){return [0,String(e)];}}
const strip=t=>t.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ');
let [st,t]=await get('https://www.law.go.kr/lsLawLinkInfo.do?lsJoLnkSeq=1001059881&chrClsCd=010202');
console.log('59-3',st,(t.match(/lsiSeq[=:'" ]+\d+/g)||[]).slice(0,5),(t.match(/lsJoLnkSeq=\d+/g)||[]).slice(0,5));
const seq=((t.match(/lsiSeq[=:'" ]+(\d+)/)||[])[1]);
const urls=[
 seq&&`https://www.law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=00&joNo=0050&lsiSeq=${seq}&urlMode=lsScJoRltInfoR`,
 `https://www.law.go.kr/LSW/lsJoLinkP.do?lsNm=%EC%86%8C%EB%93%9D%EC%84%B8%EB%B2%95&joNo=0050&joBrNo=00&languageType=KO&paras=1`,
 seq&&`https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=${seq}&viewCls=lsPtnThdCmp&urlMode=lsEfInfoR`,
].filter(Boolean);
for(const u of urls){[st,t]=await get(u);const s=strip(t);const i=s.indexOf('제50조(기본공제)');console.log('URL',u,st,s.length,i>=0?s.slice(i,i+1400):s.slice(0,300));console.log('LNK',(t.match(/lsJoLnkSeq=\d+/g)||[]).slice(0,3));}
