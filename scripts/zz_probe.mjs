const UA={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'};
async function get(u){try{const r=await fetch(u,{headers:UA,signal:AbortSignal.timeout(40000)});return [r.status,await r.text()];}catch(e){return [0,String(e)];}}
const strip=t=>t.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ');
let [st,t]=await get('https://www.law.go.kr/lsLawLinkInfo.do?lsJoLnkSeq=1001059881&chrClsCd=010202');
console.log('LEN',t.length); console.log('TXT',strip(t).slice(0,600));
console.log('ATTR',(t.match(/(lsiSeq|lsId|joNo|efYd|ancYd|ancNo)[^&"'\s<]{0,30}/g)||[]).slice(0,30).join(' | '));
const lsiSeq=(t.match(/lsiSeq=(\d+)/)||t.match(/lsiSeq['"]?\s*[:=]\s*['"]?(\d+)/)||[])[1];
console.log('SEQ',lsiSeq);
const tries=[
 'https://www.law.go.kr/LSW/lsInfoP.do?lsId=001565&ancYnChk=0',
 'https://law.go.kr/%EB%B2%95%EB%A0%B9/%EC%86%8C%EB%93%9D%EC%84%B8%EB%B2%95/%EC%A0%9C50%EC%A1%B0',
];
if(lsiSeq){tries.push(`https://www.law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=00&joNo=0050&lsiSeq=${lsiSeq}&urlMode=lsScJoRltInfoR`);tries.push(`https://www.law.go.kr/LSW/lsInfoR.do?lsiSeq=${lsiSeq}&chrClsCd=010202&urlMode=lsInfoP&viewCls=lsInfoP&efYd=20260101&ancYnChk=0`);}
for(const u of tries){[st,t]=await get(u);const s=strip(t);const i=s.indexOf('제50조(기본공제)');console.log('URL',u,st,s.length,i>=0?s.slice(i,i+1500):'NOTFOUND '+s.slice(0,200));const sq=(t.match(/lsiSeq=(\d+)/)||[])[1];console.log('seq',sq,(t.match(/lsJoLnkSeq=\d+/g)||[]).length);}
