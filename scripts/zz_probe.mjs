const UA={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'};
async function get(u){try{const r=await fetch(u,{headers:UA,signal:AbortSignal.timeout(40000)});return [r.status,await r.text()];}catch(e){return [0,String(e)];}}
const strip=t=>t.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ');
let [st,t]=await get('https://www.law.go.kr/LSW/lsInfoP.do?lsId=001565&ancYnChk=0');
console.log('M1',(t.match(/.{0,40}[Ss]eq.{0,60}/g)||[]).slice(0,25).join('\n'));
let seqs=[...new Set((t.match(/\b2[6-9]\d{4}\b/g)||[]))].slice(0,20);console.log('NUMS',seqs.join(','));
[st,t]=await get('https://www.law.go.kr/lsLawLinkInfo.do?lsJoLnkSeq=1001059881&chrClsCd=010202');
console.log('M2',(t.match(/.{0,40}[Ss]eq.{0,60}/g)||[]).slice(0,25).join('\n'));
const cand=[...new Set([...(t.match(/lsiSeq\W{0,4}(\d{5,7})/g)||[])])];console.log('C2',cand.join(','));
const all=[...new Set((t.match(/\b2[6-9]\d{4}\b/g)||[]))];console.log('NUMS2',all.join(','));
for(const s of [...all].slice(0,8)){
 const u=`https://www.law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=00&joNo=0050&lsiSeq=${s}&urlMode=lsScJoRltInfoR`;
 [st,t]=await get(u);const x=strip(t);const i=x.indexOf('제50조');console.log('TRY',s,st,i>=0?x.slice(i,i+900):'NF '+x.slice(0,120));
}
