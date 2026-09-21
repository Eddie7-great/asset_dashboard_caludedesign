// ETF 공시 관찰 기록. 실제 보유 수량·매매 기록에는 쓰지 않는다.
let _etfOwner='전체', _etfCode='', _etfQuery='', _etfPage=0, _etfSelected='', _etfCompare='', _etfDirectOnly=false;
const ETF_PAGE_SIZE=10;
let _etfRefreshGeneration=0;
const _etfLiveControllers=new Set();
const _etfLiveStates={};
function etfLiveMessage(code){
  const state=_etfLiveStates[code];
  if(!state)return '페이지 진입 시 원본 자료 확인';
  const time=state.at?new Date(state.at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):'';
  return ({cancelled:'이전 요청 중단 · 다시 확인',loading:'원본 조회 중…',ok:'원본 확인 완료',failed:'조회 실패 · 마지막 자료 유지',older:'이전 기준일 응답 · 마지막 자료 유지',undated:'기준일 미확인 응답 · 마지막 자료 유지'})[state.status]+(time?' · '+time:'');
}
function etfRetainLive(code){
  const old=cbEtfDoc()?.etfs?.[code];
  if(old)(window._etfLiveEntries ||= {})[code]={...old,retained:true,lastAttempt:new Date().toISOString()};
}
function etfAcceptLive(old,next){
  if(!next||!Array.isArray(next.holdings)||!next.holdings.length||next.holdings.some(h=>!h.t||!Number.isFinite(h.w)||h.w<=0))return null;
  if(old?.asOf&&(!next.asOf||next.asOf<old.asOf))return null;
  if(old?.coverage==='full'&&next.coverage!=='full')return null;
  const snapshots=new Map();
  for(const s of [...(old?.history||[]),old,next])if(s?.asOf)snapshots.set(s.asOf+'|'+s.source,{asOf:s.asOf,source:s.source,coverage:s.coverage,holdings:s.holdings});
  return {...old,...next,history:[...snapshots.values()].sort((a,b)=>a.asOf.localeCompare(b.asOf)).slice(-30)};
}
function etfRenderLiveUpdate(){
  if(typeof _cobaltActive!=='undefined'&&_cobaltActive!=='etf2')return;
  const root=document.getElementById('cb-etf2');
  const open=[...(root?.querySelectorAll('details')||[])].map(el=>el.open);
  const focus=document.activeElement?.id;
  cbRenderEtfExplorer();
  root?.querySelectorAll('details').forEach((el,i)=>{el.open=!!open[i];});
  if(focus)document.getElementById(focus)?.focus({preventScroll:true});
}
async function etfRefreshOnOpen(onlyCode=null){
  const generation=++_etfRefreshGeneration;
  Object.values(_etfLiveStates).forEach(state=>{if(state.status==='loading')state.status='cancelled';});
  _etfLiveControllers.forEach(controller=>controller.abort());
  _etfLiveControllers.clear();
  await cbEnsureEtfHoldings(true);
  if(generation!==_etfRefreshGeneration)return;
  // All owners' held ETFs; filtering and redraws do not restart network requests.
  const codes=[...new Set(cbAllRows().filter(r=>cbIsEtf(r.i)).map(r=>cbStrip(r.i.tkr)))].filter(code=>!onlyCode||code===onlyCode);
  codes.forEach(code=>{_etfLiveStates[code]={status:'loading'};});
  etfRenderLiveUpdate();
  async function worker(){
    while(codes.length&&generation===_etfRefreshGeneration){
      const code=codes.shift(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),50000);
      _etfLiveControllers.add(controller);
      try{
        const response=await fetch('/api/dashboard?type=etf_holdings&ticker='+encodeURIComponent(code),{cache:'no-store',credentials:'same-origin',signal:controller.signal});
        if(!response.ok)throw new Error('lookup');
        const data=await response.json();
        if(!data.success||data.code!==code){const error=new Error('lookup');error.attempts=data.attempts;throw error;}
        if(generation!==_etfRefreshGeneration)return;
        const accepted=etfAcceptLive(cbEtfDoc()?.etfs?.[code],data.entry);
        if(accepted){
          window._etfHoldings ||= {etfs:{}};
          (window._etfLiveEntries ||= {})[code]=accepted;
        }else etfRetainLive(code);
        _etfLiveStates[code]={status:accepted?'ok':data.entry?.asOf?'older':'undated',at:data.checkedAt,attempts:data.attempts||[]};
      }catch(e){
        if(generation!==_etfRefreshGeneration)return;
        etfRetainLive(code);
        _etfLiveStates[code]={status:'failed',at:new Date().toISOString(),attempts:e.attempts||[]};
      }finally{clearTimeout(timer);_etfLiveControllers.delete(controller);}
      etfRenderLiveUpdate();
    }
  }
  await Promise.all([worker(),worker()]);
}
function etfStockRows(entry){
  return (Array.isArray(entry?.holdings)?entry.holdings:[]).filter(h=>h&&h.t&&Number.isFinite(h.w)&&h.w>0
    && !/선물|\bFUT(?:URES?)?\b|E[ -]?MINI|스왑|\bSWAP\b|옵션|\bOPTION\b|MONEY\s*MARKET|GOVERNMENT\s*OBLIG|TREASURY|현금|예금|국고채|통안채|회사채|국채|\bBONDS?\b|머니마켓/i.test(h.n||''));
}
function etfBusinessAge(asOf,now=new Date()){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf||''))return null;
  const start=new Date(asOf+'T00:00:00Z'),end=new Date(now.toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'})+'T00:00:00Z');
  if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||start>end)return null;
  let age=0;for(let t=start.getTime()+86400000;t<=end.getTime();t+=86400000){const d=new Date(t).getUTCDay();if(d!==0&&d!==6)age++;}
  return age;
}
function etfQuality(entry,now=new Date()){
  const rows=etfStockRows(entry),active=entry?.active||/액티브|\bACTIVE\b/i.test(entry?.name||'');
  const age=etfBusinessAge(entry?.asOf,now),limit=active?2:5;
  const full=entry?.coverage==='full'&&rows.length===entry?.holdings?.length;
  const stale=age!==null&&age>limit, reasons=[];
  if(!rows.length)reasons.push('미조회');
  else if(!full)reasons.push('일부 자료');
  if(age===null)reasons.push('기준일 미확인');else if(stale)reasons.push('기준일 지연');
  if(entry?.retained)reasons.push('이전 자료 유지');
  return {rows,active,age,limit,full,stale,reliable:!!rows.length&&full&&age!==null&&!stale&&!entry?.retained,
    label:reasons.join(' · ')||'전체 주식 확인',reasons};
}
function etfCompareSnapshots(current,previous){
  const a=etfStockRows(current),b=etfStockRows(previous);
  // Missing rows in a truncated list are not evidence of a purchase or sale.
  const complete=!!previous&&current?.coverage==='full'&&previous.coverage==='full'
    &&current.source===previous.source&&a.length===current.holdings.length&&b.length===previous.holdings.length;
  const comparable=!!previous&&current?.source===previous.source;
  if(!comparable)return {complete:false,comparable:false,rows:[]};
  const before=new Map(b.map(h=>[cbStrip(h.t),h])),after=new Map(a.map(h=>[cbStrip(h.t),h]));
  const keys=complete?new Set([...before.keys(),...after.keys()]):new Set([...after.keys()].filter(t=>before.has(t)));
  const rows=[...keys].map(t=>{
    const old=before.get(t),next=after.get(t),delta=(next?.w||0)-(old?.w||0);
    return {t,n:next?.n||old?.n,old:old?.w||0,w:next?.w||0,delta,
      kind:!old?'편입':!next?'편출':delta>0?'비중 증가':'비중 감소'};
  }).filter(h=>Math.abs(h.delta)>=.0001).sort((x,y)=>Math.abs(y.delta)-Math.abs(x.delta));
  return {complete,comparable,rows};
}
function etfHeldRows(){return cbAllRows().filter(r=>cbIsEtf(r.i)&&(_etfOwner==='전체'||r.i.owner===_etfOwner));}
function etfOwner(owner){_etfOwner=owner===_etfOwner?'전체':owner;_etfCode='';_etfPage=0;_etfSelected='';_etfQuery='';_etfCompare='';cbRenderEtfExplorer();cbRestoreFilterFocus('cb-head-widgets','data-owner',owner);}
function etfChoose(code){_etfCode=code;_etfPage=0;_etfQuery='';_etfSelected='';_etfCompare='';cbRenderEtfExplorer();document.getElementById('etf-fund')?.focus();}
function etfSearch(value){_etfQuery=value;_etfPage=0;etfRefreshResults();}
function etfPage(step){_etfPage+=step;etfRefreshResults();document.querySelector('#etf-results .etf-pager button:not(:disabled)')?.focus();}
function etfDirectOnly(on){_etfDirectOnly=!!on;_etfPage=0;etfRefreshResults();}
function etfSelect(ticker){const inTable=!!document.activeElement?.closest('.etf-table');_etfSelected=_etfSelected===ticker?null:ticker;etfRefreshResults();if(inTable)cbRestoreFilterFocus('etf-results','data-etf-ticker',ticker);}
function etfModel(){
  const funds=[...new Map(etfHeldRows().map(r=>[cbStrip(r.i.tkr),{code:cbStrip(r.i.tkr),name:r.title}])).values()];
  if(!funds.some(f=>f.code===_etfCode))_etfCode=(funds.find(f=>etfQuality(cbEtfDoc()?.etfs?.[f.code]).reliable)||funds.find(f=>etfStockRows(cbEtfDoc()?.etfs?.[f.code]).length)||funds[0])?.code||'';
  const entry=cbEtfDoc()?.etfs?.[_etfCode],quality=etfQuality(entry);
  const history=(entry?.history||[]).filter(s=>s.asOf&&s.asOf<entry.asOf).sort((a,b)=>b.asOf.localeCompare(a.asOf));
  const previous=history.find(s=>s.asOf+'|'+s.source===_etfCompare)||history.find(s=>s.source===entry.source)||history[0];
  const comparison=etfCompareSnapshots(entry,previous);
  return {funds,entry,quality,history,previous,comparison};
}
function etfIdentity(holding){
  const ticker=cbStrip(holding?.t),kr=/^[0-9][0-9A-Z]{5}$/.test(ticker);
  const meta=kr?window._krStocksDB?.byCode?.get(ticker):null;
  const owned=kr&&typeof pfolioData!=='undefined'?pfolioData.find(i=>cbStrip(i.tkr)===ticker):null;
  let name=String(meta?.name||holding?.n||owned?.name||ticker).trim();
  const escaped=ticker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  if(escaped){
    name=name.replace(new RegExp('\\s*[（(]'+escaped+'(?:\\.(?:KS|KQ))?[)）]\\s*$','i'),'')
      .replace(new RegExp('(?:\\s+[·|:/-]\\s*|\\s+)'+escaped+'(?:\\.(?:KS|KQ))?$','i'),'')
      .replace(new RegExp('^'+escaped+'(?:\\.(?:KS|KQ))?\\s*[·|:/-]\\s*','i'),'').trim();
  }
  if(kr&&(!name||cbStrip(name)===ticker))name=owned?.name||'회사명 미확인';
  return {ticker,name:name||ticker,showTicker:!kr&&!!name&&name!==ticker};
}
function etfIdentityHtml(holding){
  const id=etfIdentity(holding);
  return `<span class="etf-company" title="${cbEsc(id.name)}"><b>${cbEsc(id.name)}</b>${id.showTicker?`<small>${cbEsc(id.ticker)}</small>`:''}</span>`;
}
function etfExposure(ticker,rows=cbAllRows(),doc=cbEtfDoc(),owner=_etfOwner,now=new Date()){
  // Denominator: the same owner's complete investment portfolio, including cash, gold and crypto.
  // ETF market value is counted once in that denominator; constituent exposure is never added to it.
  ticker=cbStrip(ticker);
  const owners=new Map();
  rows.filter(r=>owner==='전체'||r.i.owner===owner).forEach(r=>{
    const key=r.i.owner;
    if(!owners.has(key))owners.set(key,{owner:key,total:0,direct:0,indirect:0,routes:new Map(),uncertain:new Map(),invalid:false});
    const result=owners.get(key);
    if(!Number.isFinite(r.val)||r.val<0){result.invalid=true;return;}
    result.total+=r.val;
    if(r.val===0)return;
    if(cbIsEtf(r.i)){
      const code=cbStrip(r.i.tkr),entry=doc?.etfs?.[code],quality=etfQuality(entry,now);
      if(!quality.reliable)result.uncertain.set(code,{name:r.title||code,label:quality.label});
      const h=quality.rows.find(h=>cbStrip(h.t)===ticker);
      if(!h)return;
      const value=r.val*h.w/100;
      if(!Number.isFinite(value)){result.invalid=true;return;}
      const route=result.routes.get(code)||{code,name:r.title||entry?.name||code,etfValue:0,value:0,w:h.w,asOf:entry?.asOf,label:quality.label,reliable:quality.reliable};
      route.etfValue+=r.val;route.value+=value;result.indirect+=value;result.routes.set(code,route);
    }else if(r.i.grp==='주식'&&cbStrip(r.i.tkr)===ticker)result.direct+=r.val;
  });
  return [...owners.values()].map(o=>{
    const exposure=o.direct+o.indirect,valid=!o.invalid&&Number.isFinite(o.total)&&Number.isFinite(exposure)&&o.total>0;
    const pct=v=>valid?v/o.total*100:null;
    return {...o,exposure,valid,directPct:pct(o.direct),indirectPct:pct(o.indirect),totalPct:pct(exposure),
      directShare:valid&&exposure>0?o.direct/exposure*100:null,indirectShare:valid&&exposure>0?o.indirect/exposure*100:null,
      routes:[...o.routes.values()].sort((a,b)=>b.value-a.value),uncertain:[...o.uncertain.values()]};
  }).sort((a,b)=>b.total-a.total);
}
function etfPct(value){return Number.isFinite(value)?value.toFixed(2)+'%':'—';}
function etfExposureHtml(ticker,holding){
  const identity=etfIdentity(holding||{t:ticker}),owners=etfExposure(ticker);
  return `<div class="etf-section-title"><b>${cbEsc(identity.name||'종목 선택')} · 소유주별 포트폴리오 비중</b><span>전체 포트폴리오와 종목 내 보유 비율</span></div>
    <div class="etf-exposure-grid">${owners.map(o=>{
      const approximate=o.uncertain.length>0,scale=Math.max(100,o.totalPct||0),unknownIndirect=approximate&&!o.routes.length;
      const indirectLabel=unknownIndirect?'미확인':etfPct(o.indirectPct),totalLabel=unknownIndirect&&o.exposure===0?'미확인':etfPct(o.totalPct);
      return `<details class="etf-owner-exposure" data-exposure-owner="${cbEsc(o.owner)}"><summary class="etf-owner-summary"><div class="etf-exposure-head"><b>${cbEsc(o.owner)}</b><span>전체 포트 ${o.valid?cbDisp(o.total):'—'}</span></div>
        <div class="etf-exposure-total"><strong>${totalLabel}</strong><span>전체 포트에서 ${cbEsc(identity.name)} 비중${approximate?' · 확인 자료 기준':''}</span></div>
        <div class="etf-exposure-bar" role="img" aria-label="${cbEsc(o.owner)} 전체 포트 대비 직접 ${etfPct(o.directPct)}, ETF 간접 ${indirectLabel}${approximate?', 불완전한 ETF 자료 포함':''}"><i class="etf-direct" style="width:${o.valid?o.directPct/scale*100:0}%"></i><i class="etf-indirect" style="width:${o.valid?o.indirectPct/scale*100:0}%"></i></div>
        <div class="etf-exposure-legend"><span><i class="etf-direct"></i>직접 <b>${etfPct(o.directPct)}</b></span><span><i class="etf-indirect"></i>ETF 간접 <b>${indirectLabel}</b></span>${o.valid&&o.totalPct<=100?`<span class="etf-other">${approximate?'그 외·미확인':'나머지'} ${etfPct(100-o.totalPct)}</span>`:''}</div>
        ${o.valid&&o.totalPct>100?'<p class="etf-caption">명목 노출이 전체 포트 100%를 초과합니다. 막대는 총 노출에 맞춰 표시합니다.</p>':''}
        <div class="etf-stock-split"><span>이 종목 보유분을 100%로 보면</span><b>${unknownIndirect?'자료 부족으로 비율 미확정':`직접 ${etfPct(o.directShare)} <em>:</em> 간접 ${etfPct(o.indirectShare)}`}</b></div>
        <span class="etf-owner-toggle"><span class="etf-expand-label">금액·ETF별 계산 펼치기</span><span class="etf-collapse-label">계산 내역 접기</span>${approximate?' · 자료 확인 필요':''}</span></summary><div class="etf-exposure-details"><div class="etf-route-direct"><span>직접 보유 평가액</span><b>${o.valid?cbDisp(o.direct):'—'}</b></div>
        ${o.routes.map(r=>`<div class="etf-exposure-route"><b>${cbEsc(r.name)}</b><span>ETF 평가액 ${cbDisp(r.etfValue)} × 편입 비중 ${etfPct(r.w)}</span><span><strong>${cbDisp(r.value)}</strong> · 전체 포트의 ${etfPct(o.valid?r.value/o.total*100:null)}</span><small>구성 기준 ${cbEsc(r.asOf||'미확인')}${r.reliable?'':' · '+cbEsc(r.label)}</small></div>`).join('')||'<p class="etf-caption">확인된 ETF 간접 보유가 없습니다.</p>'}
        ${approximate?`<p class="etf-exposure-warning">자료 확인 필요: ${o.uncertain.map(f=>cbEsc(f.name)+' ('+cbEsc(f.label)+')').join(' · ')}</p>`:''}</div>
        ${!o.valid?'<p class="etf-exposure-warning">전체 포트 평가액을 확인할 수 없어 비중을 계산하지 않습니다.</p>':approximate?'<p class="etf-exposure-warning">일부·지연·미조회 ETF가 있어 간접 비중과 보유 비율은 확정값이 아닙니다.</p>':''}</details>`;
    }).join('')||'<p class="sim-empty">선택한 소유주에게 포트폴리오가 없습니다.</p>'}</div>
    <p class="etf-caption">전체 포트 = 해당 소유주의 주식·ETF·가상화폐·금·현금 평가액 합계(부동산·부채 제외). 간접 비중 = ETF 평가액 × 해당 종목의 ETF 내 공시 비중 ÷ 전체 포트 평가액. 각 ETF의 직접 편입 주식만 합산하며 파생·레버리지의 전체 경제적 노출은 포함하지 않습니다.</p>`;
}
// 이 ETF 의 구성종목 중 **직접 보유 중인 회사**만 모아 보여 준다.
// '직접 보유만 보기' 체크박스와 같은 출처(cbDirectStockMap)를 써서 판정이 갈리지 않는다.
// 구성종목을 못 받았거나 잠정인 ETF 는 0 건으로 단정하지 않고 그 사실을 밝힌다 — 룩스루와 같은 태도.
function etfOverlapHtml(m){
  const direct=cbDirectStockMap(_etfOwner);
  const rows=m.quality.rows
    .map(h=>({h,d:direct.get(cbStrip(h.t))}))
    .filter(x=>x.d)
    .sort((a,b)=>b.h.w-a.h.w);
  const scope=_etfOwner==='전체'?'가구 전체':cbEsc(_etfOwner);
  const provisional=!m.quality.reliable;
  const body=rows.length
    ? `<div class="etf-overlap-list">${rows.map(({h,d})=>`<div class="etf-overlap-row"><span class="etf-overlap-name">${etfIdentityHtml(h)}</span><span class="etf-overlap-w">${h.w.toFixed(2)}%</span><b>${cbDisp(d.val)}</b></div>`).join('')}</div>`
    : `<p class="sim-empty">${provisional?'확인된 구성종목 중에는':'이 ETF 구성종목 중'} 직접 보유 중인 회사가 없습니다.</p>`;
  return `<section class="cb-panel etf-overlap-card"><div class="etf-section-title"><b>직접 보유 겹침</b><span>${scope} · ${rows.length}종목</span></div>
    ${body}
    ${provisional?`<p class="etf-caption">${cbEsc(m.quality.label)} · 구성종목이 확정되지 않아 겹치는 종목이 더 있을 수 있습니다.</p>`:''}
    <p class="etf-caption">이 ETF 가 담은 회사 중 따로 직접 들고 있는 것만 추립니다. 금액은 ETF 를 뺀 <b>직접 보유 평가액</b>이며, ETF 간접 보유분은 아래 소유주별 비중에서 봅니다.</p></section>`;
}
function etfSourceLink(entry){
  if(entry?.source==='FunETF')return 'https://www.funetf.co.kr/search?schVal='+encodeURIComponent(_etfCode);
  if(entry?.source==='provider:ProShares')return 'https://www.proshares.com/our-etfs/leveraged-and-inverse/qld';
  if(entry?.source==='provider:TIME')return 'https://timeetf.co.kr/m11_view.php?idx='+(_etfCode==='426020'?'5':'2');
  if(entry?.source==='provider:Invesco')return 'https://www.invesco.com/us/en/financial-products/etfs/invesco-qqq-trust-series-1.html';
  return null;
}
function cbRenderEtfExplorer(){
  const root=document.getElementById('cb-etf2');if(!root)return;
  cbSetHead('ETF의 내부 구성과 기준일별 비중 변화 · 공시 관찰값이며 실시간 매매 내역은 아닙니다',cbOwnerBtns(_etfOwner,'etfOwner'));
  cbEnsureEtfHoldings();
  const m=etfModel(),q=m.quality,link=etfSourceLink(m.entry);
  if(_etfSelected==='')_etfSelected=cbStrip(q.rows[0]?.t);
  const focus=document.activeElement?.id,selection=document.activeElement?.selectionStart;
  const counts=m.funds.reduce((a,f)=>{const q=etfQuality(cbEtfDoc()?.etfs?.[f.code]);a[q.reliable?'ok':'check']++;return a;},{ok:0,check:0});
  // 선택 ETF 의 평가액·매입금액·평가손익. cbRow 가 val/cost/gain 을 이미 채워 주므로 합산만 한다.
  // 취득가 미상이 한 건이라도 섞이면 매입금액·손익을 '—' 로 둔다 — cbCostKRW 가 그때 0 을
  // 돌려주므로 그대로 더하면 ₩0 과 가짜 손익이 찍힌다(홈 보유 목록과 같은 규칙).
  const fundRows=etfHeldRows().filter(r=>cbStrip(r.i.tkr)===_etfCode);
  const fundValue=fundRows.reduce((sum,r)=>sum+r.val,0);
  const costKnown=fundRows.length>0&&fundRows.every(r=>!r.i.costUnknown);
  const fundCost=costKnown?fundRows.reduce((sum,r)=>sum+r.cost,0):null;
  const fundGain=costKnown?fundRows.reduce((sum,r)=>sum+r.gain,0):null;
  const fundGainPct=costKnown&&fundCost>0?fundGain/fundCost*100:null;
  root.innerHTML=`
    <div class="cb-panel etf-toolbar"><label>보유 ETF<select id="etf-fund" onchange="etfChoose(this.value)">${m.funds.map(f=>`<option value="${cbEsc(f.code)}"${f.code===_etfCode?' selected':''}>${cbEsc(f.name)} · ${cbEsc(f.code)}</option>`).join('')}</select></label>
    <div class="etf-fund-value"><span>평가액</span><b>${cbDisp(fundValue)}</b><span>매입금액</span><b>${fundCost==null?'—':cbDisp(fundCost)}</b><span>평가손익</span><b style="${fundGain==null?'':cbUpDn(fundGain)}">${fundGain==null?'—':cbSignDisp(fundGain)+(fundGainPct==null?'':` <em>${(fundGainPct>=0?'+':'')+fundGainPct.toFixed(1)}%</em>`)}</b></div><div class="etf-status ${q.reliable?'ok':''}"><b>${cbEsc(q.label)}</b><span>구성 기준 ${cbEsc(m.entry?.asOf||'미확인')}${q.active?' · 액티브':''}</span><span role="status">${cbEsc(_cbEtfLoading?'자료 확인 중…':etfLiveMessage(_etfCode))}</span></div><div class="etf-toolbar-summary"><div class="etf-counts"><span>보유 <b>${m.funds.length}</b></span><span>확인 <b>${counts.ok}</b></span><span>점검 <b>${counts.check}</b></span></div><span>선택 ETF · 조회된 주식 ${q.rows.length}종목 · 주식 비중 ${q.rows.length?etfPct(etfWeightSum(q.rows)):'미확인'}</span></div></div>
    ${window._etfLoadError?'<p class="etf-notice" role="status">자료 파일을 읽지 못했습니다. 마지막 정상 자료가 있으면 유지합니다. 다시 확인해 주세요.</p>':''}
    ${m.funds.length?'': '<p class="etf-notice">선택한 구성원에게 보유 ETF가 없습니다.</p>'}
    <div class="etf-layout"><section class="cb-panel etf-visual-card"><div class="etf-section-title"><b>구성 비중 분포</b><span>상위 12종목 · 막대를 눌러 상세 확인</span></div>
    ${etfRankChart(q.rows)}
    <div class="etf-coverage"><span>조회된 주식 비중</span><b>${q.rows.length?etfWeightSum(q.rows).toFixed(2)+'%':'—'}</b><small>순자산 대비 원래 비중 · 현금·채권은 제외하며 100%로 환산하지 않습니다.${etfWeightSum(q.rows)>100?' 합계가 100%를 넘는 것은 담보 위에 기초자산이 명시된 스왑을 얹은 구조여서이며, 그대로 표시합니다.':''}</small></div></section>
    <section class="cb-panel etf-list-card"><div class="etf-section-title"><b>구성종목</b><span>비중과 직전 기준일 대비 변화</span></div>
    <div class="etf-filters"><label class="etf-search">종목 검색<input id="etf-search" type="search" value="${cbEsc(_etfQuery)}" placeholder="종목명 또는 티커" oninput="etfSearch(this.value)"></label>
    ${m.history.length?`<label class="etf-compare">비교 기준<select id="etf-compare" onchange="_etfCompare=this.value;_etfPage=0;etfRefreshResults()">${m.history.map(s=>`<option value="${cbEsc(s.asOf+'|'+s.source)}"${s===m.previous?' selected':''}>${cbEsc(s.asOf)} · ${cbEsc(s.source)}</option>`).join('')}</select></label>`:''}
    <label class="etf-direct-only"><input type="checkbox" id="etf-direct-only"${_etfDirectOnly?' checked':''} onchange="etfDirectOnly(this.checked)">직접 보유 중인 종목만</label></div><div id="etf-results"></div></section>
    ${etfOverlapHtml(m)}</div>
    <section class="cb-panel etf-network" id="etf-network"></section>
    ${etfInspectionHtml(m.funds)}
    <details class="cb-panel etf-method"><summary>출처·갱신 주기·변경 이력 기준</summary><p>출처 ${cbEsc(m.entry?.source||'미조회')}${link?` · <a href="${link}" target="_blank" rel="noopener noreferrer">운용사 원문 ↗</a>`:''} · 마지막 수집 ${cbEsc(m.entry?.fetchedAt||'기록 없음')} · 마지막 시도 ${cbEsc(m.entry?.lastAttempt||'기록 없음')}</p><p>한국·미국 장 마감 후 평일 두 차례 수집을 시도합니다(KST 18:30, 다음 날 07:30). 페이지를 열 때마다 원본을 다시 조회합니다(점검 ETF 는 행의 재조회 버튼으로 개별 조회). 국내는 FunETF, 해외는 지원 운용사와 대체 출처를 확인합니다. 실패하거나 기준일이 이전이면 마지막 정상 자료를 유지합니다. 화면 조회 이력은 현재 세션에, 정기 수집 이력은 서버에 보관합니다. 액티브 ETF는 2평일, 그 외는 5평일을 넘으면 지연으로 표시합니다(거래소 휴일 미반영). 기준일이 없으면 최신 여부를 확정하지 않습니다.</p><p>최근 30개 출처·기준일별 관찰 기록을 보관합니다. 같은 기준일의 수정 공시는 교체하며 과거 이력을 소급 생성하지 않습니다. 같은 출처의 전체 목록끼리만 편입·편출을 판정합니다. 비중 변화에는 가격 움직임도 포함되므로 실제 매매량·매매 시점을 뜻하지 않습니다. 파생·레버리지 ETF의 주식 목록은 전체 경제적 노출과 다를 수 있습니다.</p></details>`;
  etfRefreshResults();
  if(focus){const el=document.getElementById(focus);el?.focus({preventScroll:true});if(typeof selection==='number'&&el?.type==='search')el.setSelectionRange(selection,selection);}
}
function etfWeightSum(rows){ return (rows||[]).reduce((sum,h)=>sum+(Number(h.w)||0),0); }
function etfRankChart(rows){
  const top=rows.slice().sort((a,b)=>b.w-a.w).slice(0,12),max=Math.max(1,...top.map(h=>h.w)),axis=Math.ceil(max/5)*5;
  return `<div class="etf-rank-chart"><div class="etf-rank-axis"><span>ETF 순자산 대비 비중</span><span>0 — ${axis}%</span></div><div class="etf-rank-list">${top.map(h=>`<button class="etf-rank-row" data-etf-ticker="${cbEsc(cbStrip(h.t))}" onclick="etfSelect(this.dataset.etfTicker)" aria-pressed="${cbStrip(h.t)===_etfSelected}">${etfIdentityHtml(h)}<span class="etf-rank-track"><i style="width:${h.w/axis*100}%"></i></span><strong>${h.w.toFixed(2)}%</strong></button>`).join('')||'<p class="sim-empty">조회된 구성종목이 없습니다.</p>'}</div></div>`;
}
// 구성종목 목록. 예전에는 '구성종목' / '비중 변화' 두 모드를 버튼으로 오갔지만,
// 이제 한 표에 비중과 변화를 함께 싣는다 — 변화는 비교 기준 스냅샷과의 차이다.
// etfCompareSnapshots 는 변화 없는 행을 빼고 돌려주므로, 표에 없으면 '변화 없음'이다.
function etfRefreshResults(){
  const root=document.getElementById('etf-results');if(!root)return;
  const m=etfModel(),diff=m.comparison;
  const deltas=new Map(diff.rows.map(h=>[cbStrip(h.t),h]));
  const direct=_etfDirectOnly?cbDirectStockMap(_etfOwner):null;
  const rows=m.quality.rows
    .filter(h=>!_etfQuery||[h.t,h.n,etfIdentity(h).name].join(' ').toLowerCase().includes(_etfQuery.toLowerCase()))
    .filter(h=>!direct||direct.has(cbStrip(h.t)));
  const pages=Math.max(1,Math.ceil(rows.length/ETF_PAGE_SIZE));_etfPage=Math.max(0,Math.min(_etfPage,pages-1));
  const changeNote=!m.previous?'직전 기준일 자료가 없어 변화를 비교하지 않습니다.'
    :!diff.comparable?'출처가 달라 비중 변화를 비교하지 않습니다.'
    :!diff.complete?`${m.previous.asOf} → ${m.entry.asOf} · 일부 자료라 양쪽에 확인된 종목만 비교합니다`
    :`${m.previous.asOf} → ${m.entry.asOf} · 비중 차이(%p), 매매량과 다를 수 있음`;
  const note=`${rows.length}종목${_etfDirectOnly?' · 직접 보유만':''} · ${m.quality.label} · ${changeNote}`;
  root.innerHTML=`<p class="etf-caption" role="status">${cbEsc(note)}</p><div class="etf-table"><div class="etf-table-head"><span>종목</span><span>비중</span><span>변화</span></div>${rows.slice(_etfPage*ETF_PAGE_SIZE,(_etfPage+1)*ETF_PAGE_SIZE).map(h=>{
    const d=deltas.get(cbStrip(h.t));
    return `<button class="etf-table-row${cbStrip(h.t)===_etfSelected?' selected':''}" data-etf-ticker="${cbEsc(cbStrip(h.t))}" onclick="etfSelect(this.dataset.etfTicker)" aria-pressed="${cbStrip(h.t)===_etfSelected}"><span class="etf-table-identity">${etfIdentityHtml(h)}${d?`<small class="etf-change-kind">${cbEsc(d.kind)}</small>`:''}</span><span>${h.w.toFixed(2)}%</span>${d?`<strong class="${d.delta>0?'etf-increase':'etf-decrease'}">${d.delta>0?'+':''}${d.delta.toFixed(2)}p</strong>`:'<strong class="etf-flat">—</strong>'}</button>`;
  }).join('')||`<p class="sim-empty">${_etfDirectOnly?'직접 보유 중인 구성종목이 없습니다.':'표시할 종목이 없습니다.'}</p>`}</div><div class="etf-pager"><button class="cb-btn" onclick="etfPage(-1)"${_etfPage===0?' disabled':''}>이전</button><span>${_etfPage+1} / ${pages} · ${rows.length}종목</span><button class="cb-btn" onclick="etfPage(1)"${_etfPage>=pages-1?' disabled':''}>다음</button></div>`;
  document.querySelectorAll('.etf-rank-row').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.etfTicker===_etfSelected)));
  const network=document.getElementById('etf-network');if(!network)return;
  const selected=_etfSelected===null?'':(_etfSelected||cbStrip(m.quality.rows[0]?.t));
  const holding=m.quality.rows.find(h=>cbStrip(h.t)===selected)||diff.rows.find(h=>cbStrip(h.t)===selected);
  const openOwners=new Set([...network.querySelectorAll('.etf-owner-exposure')].filter(el=>el.open).map(el=>el.dataset.exposureOwner));
  network.innerHTML=selected?etfExposureHtml(selected,holding):'<p class="sim-empty">구성종목을 선택하면 소유주별 비중을 확인할 수 있습니다.</p>';
  network.querySelectorAll('.etf-owner-exposure').forEach(el=>{if(openOwners.has(el.dataset.exposureOwner))el.open=true;});
}

function etfInspectionHtml(funds){
  const pending=funds.filter(f=>!etfQuality(cbEtfDoc()?.etfs?.[f.code]).reliable);
  if(!pending.length)return '';
  // 행마다 이름·코드·품질 라벨·기준일·소스 시도 이력을 모두 찍으면 정작 '왜 점검인지'가 묻힌다.
  // 이름과 한 줄 사유만 남기고, 시도 이력은 툴바의 role="status" 줄에서 계속 볼 수 있다.
  return `<details class="cb-panel etf-inspection"><summary>점검 ETF ${pending.length}개 · 사유와 원본 확인</summary>${pending.map(f=>{
    const entry=cbEtfDoc()?.etfs?.[f.code],q=etfQuality(entry),state=_etfLiveStates[f.code];
    return `<div class="etf-inspection-row"><button class="cb-btn" data-code="${cbEsc(f.code)}" onclick="etfChoose(this.dataset.code)">${cbEsc(f.name)}</button><span>${cbEsc(q.label)} · 기준 ${cbEsc(entry?.asOf||'미확인')}</span><button class="cb-btn" data-code="${cbEsc(f.code)}" onclick="etfRefreshOnOpen(this.dataset.code)"${state?.status==='loading'?' disabled':''}>재조회</button></div>`;
  }).join('')}<p>전체 목록·기준일·신선도를 확인해야 ‘확인’으로 바뀝니다. 일부 자료나 조회 실패를 정상으로 표시하지 않습니다.</p></details>`;
}
