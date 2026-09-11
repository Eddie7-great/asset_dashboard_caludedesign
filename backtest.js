// Read-only, single-instrument historical simulation. No portfolio/KV writes.
let _bt={query:'',selected:null,range:'5y',initial:10000,monthly:0,fee:0,result:null},_btEpoch=0,_btController=null;
function btCalculate(bars,initial,monthly,fee){
  if(!Number.isFinite(initial)||initial<=0||initial>1e12||!Number.isFinite(monthly)||monthly<0||monthly>1e10||!Number.isFinite(fee)||fee<0||fee>5)throw Error('초기 투자금은 0 초과, 월 적립금은 0 이상, 매수 수수료는 0~5%로 입력해 주세요.');
  if(!Array.isArray(bars)||bars.length<2)throw Error('계산에 필요한 과거 가격이 부족합니다.');
  const seen=new Set(),rows=bars.filter(b=>Number.isFinite(b.t)).slice().sort((a,b)=>a.t-b.t).filter(b=>{if(seen.has(b.t))return false;seen.add(b.t);return true;});
  if(rows.length<2||rows.some(b=>!Number.isFinite(b.adj)||b.adj<=0))throw Error('배당·분할 수정주가가 누락되어 계산할 수 없습니다. 다른 기간이나 종목을 선택해 주세요.');
  let units=0,paid=0,fees=0,peak=rows[0].adj,mdd=0,month='',points=[];
  rows.forEach((b,i)=>{
    const date=new Date(b.t*1000).toISOString().slice(0,10),m=date.slice(0,7);
    const contribution=i===0?initial:m!==month?monthly:0;
    const cost=contribution*fee/100;
    units+=(contribution-cost)/b.adj;paid+=contribution;fees+=cost;
    peak=Math.max(peak,b.adj);mdd=Math.min(mdd,b.adj/peak-1);month=m;
    points.push({date,value:units*b.adj,paid,price:b.adj});
  });
  const first=rows[0],last=rows[rows.length-1],years=(last.t-first.t)/86400/365.25;
  if(years<=0)throw Error('서로 다른 거래일이 필요합니다.');
  const value=points[points.length-1].value,profit=value-paid,cagr=(last.adj/first.adj)**(1/years)-1;
  return {points,paid,value,profit,fees,mdd,cagr,roi:profit/paid,years};
}
function btMoney(n){return cbEsc(_bt.selected?.currency||'')+' '+Number(n).toLocaleString('ko-KR',{maximumFractionDigits:2});}
function btHtml(){
  return `<section class="cb-panel bt-panel"><div class="fin-section-head"><span>종목 백테스팅</span><small>과거 수정주가 · 일시 투자 + 월 적립</small></div><div class="bt-search"><label for="bt-query">종목명 / 티커</label><input id="bt-query" value="${cbEsc(_bt.query)}" placeholder="예: 삼성전자, NVIDIA, 7203.T" oninput="btQuery(this.value)" onkeydown="if(event.key==='Enter')btSearch()"><button class="cb-btn" onclick="btSearch()">종목 검색</button><span id="bt-selection">${_bt.selected?cbEsc(_bt.selected.name+' · '+_bt.selected.symbol+' · '+_bt.selected.currency):'검색 후 종목을 선택하세요'}</span></div><div id="bt-candidates" role="status"></div><div class="bt-controls"><label>조회 기간<select id="bt-range" onchange="btSetting('range',this.value)">${['1y','2y','5y','10y'].map(v=>`<option value="${v}"${v===_bt.range?' selected':''}>${v.replace('y','년')}</option>`).join('')}</select></label><label>초기 투자금 · 종목 통화<input id="bt-initial" type="number" data-no-comma="1" min="1" max="1000000000000" value="${_bt.initial}" oninput="btSetting('initial',this.value)"></label><label>월 적립금 · 종목 통화<input id="bt-monthly" type="number" data-no-comma="1" min="0" max="10000000000" value="${_bt.monthly}" oninput="btSetting('monthly',this.value)"></label><label>매수 수수료 %<input id="bt-fee" type="number" data-no-comma="1" min="0" max="5" step="0.01" value="${_bt.fee}" oninput="btSetting('fee',this.value)"></label><button id="bt-run" class="cb-btn" onclick="btRun()"${_bt.selected?'':' disabled'}>백테스트 실행</button></div><p id="bt-status" role="status"></p><div id="bt-output">${_bt.result?btResultHtml(_bt.result):''}</div><p class="sim-assumptions">첫 거래일 종가에 초기 투자하고, 다음 달부터 각 월의 첫 조회 거래일 종가에 적립합니다. 소수점 매수·배당 재투자를 수정주가로 근사합니다. 환율 변동·세금·슬리피지·매도 비용은 제외하며 매수 수수료만 반영합니다. 조회 기간이 상장 이력보다 길면 실제 제공 기간으로 계산합니다. 과거 성과는 미래 수익을 보장하지 않습니다. 원장과 실제 주문은 변경하지 않습니다.</p></section>`;
}
function btInvalidate(){_btEpoch++;_btController?.abort();_bt.result=null;const out=document.getElementById('bt-output');if(out)out.innerHTML='';const status=document.getElementById('bt-status');if(status)status.textContent='설정한 조건으로 실행해 주세요.';}
function btSetting(key,value){btInvalidate();_bt[key]=key==='range'?value:String(value).trim()===''?NaN:Number(value);}
function btQuery(value){btInvalidate();_bt.query=value;_bt.selected=null;document.getElementById('bt-selection').textContent='검색 후 종목을 선택하세요';document.getElementById('bt-candidates').replaceChildren();document.getElementById('bt-run').disabled=true;}
async function btSearch(){
  btInvalidate();const epoch=_btEpoch,q=_bt.query.trim(),box=document.getElementById('bt-candidates');
  if(!q||q.length>80){box.textContent='종목명 또는 티커를 80자 이내로 입력해 주세요.';return;}
  box.textContent='검색 중…';const controller=new AbortController();_btController=controller;const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch('/api/get-stock?query='+encodeURIComponent(q),{credentials:'same-origin',signal:_btController.signal});
    const data=await response.json();if(epoch!==_btEpoch)return;
    if(!response.ok||!data.success||!data.symbol)throw Error('종목을 찾지 못했습니다. 정확한 티커나 일본 종목의 .T 코드를 입력해 주세요.');
    const symbol=String(data.symbol).toUpperCase();if(!/^[A-Z0-9.^=_-]{1,24}$/.test(symbol))throw Error('지원하지 않는 종목 코드입니다.');
    _bt.candidate={symbol,name:String(data.name||symbol),currency:String(data.currency||'USD')};
    box.innerHTML=`<button class="cb-btn" onclick="btChoose()">${cbEsc(_bt.candidate.name)} · ${cbEsc(symbol)} · 이 종목 선택</button>`;
  }catch(e){if(epoch===_btEpoch)box.textContent=e.name==='AbortError'?'검색 시간이 초과되었습니다. 다시 시도해 주세요.':e.message;}
  finally{clearTimeout(timer);}
}
function btChoose(){if(!_bt.candidate)return;_bt.selected={..._bt.candidate};document.getElementById('bt-selection').textContent=_bt.selected.name+' · '+_bt.selected.symbol+' · '+_bt.selected.currency;document.getElementById('bt-candidates').replaceChildren();document.getElementById('bt-run').disabled=false;}
async function btRun(){
  if(!_bt.selected)return;
  btInvalidate();const epoch=_btEpoch,status=document.getElementById('bt-status');
  status.textContent='과거 가격 조회 중…';const controller=new AbortController();_btController=controller;const timer=setTimeout(()=>controller.abort(),40000);
  const selected={..._bt.selected},settings={..._bt};
  try{
    const response=await fetch('/api/price?type=ohlcv&tkr='+encodeURIComponent(selected.symbol)+'&range='+encodeURIComponent(settings.range),{credentials:'same-origin',cache:'no-store',signal:_btController.signal});
    const data=await response.json();if(epoch!==_btEpoch)return;
    if(!response.ok||!data.success)throw Error('과거 가격을 조회하지 못했습니다. 종목이나 기간을 바꿔 다시 시도해 주세요.');
    if(String(data.rawTicker)!==selected.symbol)throw Error('조회 종목이 일치하지 않습니다.');
    _bt.selected.currency=String(data.currency||selected.currency);
    _bt.result=btCalculate((data.bars||[]).filter(b=>b.complete!==false),settings.initial,settings.monthly,settings.fee);
    document.getElementById('bt-output').innerHTML=btResultHtml(_bt.result);
    const p=_bt.result.points;status.textContent=`${selected.name} · ${p[0].date} ~ ${p[p.length-1].date} · ${p.length}거래일 · ${_bt.selected.currency} 기준`;
  }catch(e){if(epoch===_btEpoch)status.textContent=e.name==='AbortError'?'가격 조회 시간이 초과되었습니다. 다시 시도해 주세요.':e.message;}
  finally{clearTimeout(timer);}
}
function btResultHtml(r){
  const max=Math.max(...r.points.map(p=>Math.max(p.value,p.paid)),1),w=1000,h=200;
  const line=key=>r.points.map((p,i)=>(i/(r.points.length-1)*w).toFixed(1)+','+(h-p[key]/max*(h-15)).toFixed(1)).join(' ');
  return `<div class="bt-kpis">${[['납입 원금',btMoney(r.paid)],['최종 평가액',btMoney(r.value)],['납입원금 대비 손익률',(r.roi*100).toFixed(2)+'%'],['종목 CAGR',(r.cagr*100).toFixed(2)+'%'],['수정주가 최대 낙폭',(r.mdd*100).toFixed(2)+'%']].map(([k,v])=>`<div><small>${k}</small><b>${v}</b></div>`).join('')}</div><p>평가손익 ${btMoney(r.profit)} · 누적 매수 수수료 ${btMoney(r.fees)} · CAGR/낙폭은 적립금과 무관한 수정주가 기준입니다.</p><svg class="bt-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="시간에 따른 평가액과 누적 납입원금. 아래 슬라이더로 날짜별 금액 확인"><polyline points="${line('paid')}" fill="none" stroke="var(--lab)" stroke-width="2" stroke-dasharray="6 4"/><polyline points="${line('value')}" fill="none" stroke="var(--acc)" stroke-width="3"/></svg><div class="bt-chart-labels"><span>${r.points[0].date}</span><span>실선 평가액 · 점선 납입원금</span><span>${r.points[r.points.length-1].date}</span></div><label class="bt-inspect">거래일 살펴보기<input type="range" min="0" max="${r.points.length-1}" value="${r.points.length-1}" oninput="btInspect(this.value)"></label><p id="bt-inspect">${btPointText(r.points[r.points.length-1])}</p>`;
}
function btPointText(p){return `${p.date} · 평가액 ${btMoney(p.value)} · 납입원금 ${btMoney(p.paid)}`;}
function btInspect(index){const p=_bt.result?.points[Number(index)];if(p)document.getElementById('bt-inspect').innerHTML=btPointText(p);}
