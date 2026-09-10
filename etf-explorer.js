// ETF 공시 관찰 기록. 실제 보유 수량·매매 기록에는 쓰지 않는다.
let _etfOwner='전체', _etfCode='', _etfQuery='', _etfPage=0, _etfSelected='', _etfMode='holdings', _etfCompare='';
const ETF_PAGE_SIZE=10;
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
function etfMode(mode){_etfMode=mode;_etfPage=0;_etfQuery='';cbRenderEtfExplorer();cbRestoreFilterFocus('cb-etf2','data-etf-mode',mode);}
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
function etfSourceLink(entry){
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
  const fundValue=etfHeldRows().filter(r=>cbStrip(r.i.tkr)===_etfCode).reduce((sum,r)=>sum+r.val,0);
  root.innerHTML=`<div class="etf-heading"><div><span class="sim-eyebrow">ETF EXPLORER</span><h3>펀드 안의 포트폴리오</h3></div></div>
    <div class="cb-panel etf-toolbar"><label>보유 ETF<select id="etf-fund" onchange="etfChoose(this.value)">${m.funds.map(f=>`<option value="${cbEsc(f.code)}"${f.code===_etfCode?' selected':''}>${cbEsc(f.name)} · ${cbEsc(f.code)}</option>`).join('')}</select></label>
    <div class="etf-fund-value"><span>선택 ETF 평가액</span><b>${cbDisp(fundValue)}</b></div><div class="etf-status ${q.reliable?'ok':''}"><b>${cbEsc(q.label)}</b><span>구성 기준 ${cbEsc(m.entry?.asOf||'미확인')}${q.active?' · 액티브':''}</span></div><button class="cb-btn" onclick="cbEnsureEtfHoldings(true)"${_cbEtfLoading?' disabled':''}>${_cbEtfLoading?'확인 중…':'자료 다시 확인'}</button><div class="etf-toolbar-summary"><div class="etf-counts"><span>보유 <b>${m.funds.length}</b></span><span>확인 <b>${counts.ok}</b></span><span>점검 <b>${counts.check}</b></span></div><span>선택 ETF · 조회된 주식 ${q.rows.length}종목 · 주식 비중 ${q.rows.length?etfPct(q.rows.reduce((sum,h)=>sum+h.w,0)):'미확인'}</span></div></div>
    ${window._etfLoadError?'<p class="etf-notice" role="status">자료 파일을 읽지 못했습니다. 마지막 정상 자료가 있으면 유지합니다. 다시 확인해 주세요.</p>':''}
    ${m.funds.length?'': '<p class="etf-notice">선택한 구성원에게 보유 ETF가 없습니다.</p>'}
    <div class="etf-layout"><section class="cb-panel etf-visual-card"><div class="etf-section-title"><b>구성 비중 분포</b><span>상위 12종목 · 막대를 눌러 상세 확인</span></div>
    ${etfRankChart(q.rows)}
    <div class="etf-coverage"><span>조회된 주식 비중</span><b>${q.rows.length?q.rows.reduce((s,h)=>s+h.w,0).toFixed(2)+'%':'—'}</b><small>순자산 대비 원래 비중 · 현금·채권·파생은 제외하며 100%로 환산하지 않습니다.</small></div></section>
    <section class="cb-panel etf-list-card"><div class="etf-tabs">${[['holdings','구성종목'],['changes','비중 변화']].map(([id,label])=>`<button class="cb-btn" data-etf-mode="${id}" aria-pressed="${_etfMode===id}" onclick="etfMode('${id}')">${label}</button>`).join('')}</div>
    ${_etfMode==='changes'?`<label class="etf-compare">비교 기준<select id="etf-compare" onchange="_etfCompare=this.value;_etfPage=0;etfRefreshResults()">${m.history.map(s=>`<option value="${cbEsc(s.asOf+'|'+s.source)}"${s===m.previous?' selected':''}>${cbEsc(s.asOf)} · ${cbEsc(s.source)}</option>`).join('')}</select></label>`:''}
    <label class="etf-search">종목 검색<input id="etf-search" type="search" value="${cbEsc(_etfQuery)}" placeholder="종목명 또는 티커" oninput="etfSearch(this.value)"></label><div id="etf-results"></div></section></div>
    <section class="cb-panel etf-network" id="etf-network"></section>
    <details class="cb-panel etf-method"><summary>출처·갱신 주기·변경 이력 기준</summary><p>출처 ${cbEsc(m.entry?.source||'미조회')}${link?` · <a href="${link}" target="_blank" rel="noopener noreferrer">운용사 원문 ↗</a>`:''} · 마지막 수집 ${cbEsc(m.entry?.fetchedAt||'기록 없음')} · 마지막 시도 ${cbEsc(m.entry?.lastAttempt||'기록 없음')}</p><p>한국·미국 장 마감 후 평일 두 차례 수집을 시도합니다(KST 18:30, 다음 날 07:30). 화면의 다시 확인은 게시된 자료를 다시 읽습니다. 액티브 ETF는 2평일, 그 외는 5평일을 넘으면 지연으로 표시합니다(거래소 휴일 미반영). 기준일이 없으면 최신 여부를 확정하지 않습니다.</p><p>최근 30개 출처·기준일별 관찰 기록을 보관합니다. 같은 기준일의 수정 공시는 교체하며 과거 이력을 소급 생성하지 않습니다. 같은 출처의 전체 목록끼리만 편입·편출을 판정합니다. 비중 변화에는 가격 움직임도 포함되므로 실제 매매량·매매 시점을 뜻하지 않습니다. 파생·레버리지 ETF의 주식 목록은 전체 경제적 노출과 다를 수 있습니다.</p></details>`;
  etfRefreshResults();
  if(focus){const el=document.getElementById(focus);el?.focus({preventScroll:true});if(typeof selection==='number'&&el?.type==='search')el.setSelectionRange(selection,selection);}
}
function etfRankChart(rows){
  const top=rows.slice().sort((a,b)=>b.w-a.w).slice(0,12),max=Math.max(1,...top.map(h=>h.w)),axis=Math.ceil(max/5)*5;
  return `<div class="etf-rank-chart"><div class="etf-rank-axis"><span>ETF 순자산 대비 비중</span><span>0 — ${axis}%</span></div><div class="etf-rank-list">${top.map(h=>`<button class="etf-rank-row" data-etf-ticker="${cbEsc(cbStrip(h.t))}" onclick="etfSelect(this.dataset.etfTicker)" aria-pressed="${cbStrip(h.t)===_etfSelected}">${etfIdentityHtml(h)}<span class="etf-rank-track"><i style="width:${h.w/axis*100}%"></i></span><strong>${h.w.toFixed(2)}%</strong></button>`).join('')||'<p class="sim-empty">조회된 구성종목이 없습니다.</p>'}</div></div>`;
}
function etfRefreshResults(){
  const root=document.getElementById('etf-results');if(!root)return;
  const m=etfModel(),changes=_etfMode==='changes',diff=m.comparison;
  const rows=(changes?diff.rows:m.quality.rows).filter(h=>!_etfQuery||[h.t,h.n,etfIdentity(h).name,h.kind].join(' ').toLowerCase().includes(_etfQuery.toLowerCase()));
  const pages=Math.max(1,Math.ceil(rows.length/ETF_PAGE_SIZE));_etfPage=Math.max(0,Math.min(_etfPage,pages-1));
  const note=changes?(!m.previous?'다음 기준일 자료가 쌓이면 변화를 비교할 수 있습니다.':!diff.comparable?'출처가 달라 편입·편출·비중 변화를 비교하지 않습니다.':!diff.complete?'일부 자료 비교 · 양쪽에 확인된 종목의 비중 변화만 표시합니다.':`${m.previous.asOf} → ${m.entry.asOf} · 비중 차이(%p), 매매량과 다를 수 있음`):`${rows.length}종목 · ${m.quality.label}`;
  root.innerHTML=`<p class="etf-caption" role="status">${cbEsc(note)}</p><div class="etf-table${changes?' is-changes':''}"><div class="etf-table-head"><span>종목</span><span>${changes?'이전 → 현재':'비중'}</span>${changes?'<span>변화</span>':''}</div>${rows.slice(_etfPage*ETF_PAGE_SIZE,(_etfPage+1)*ETF_PAGE_SIZE).map(h=>`<button class="etf-table-row${cbStrip(h.t)===_etfSelected?' selected':''}" data-etf-ticker="${cbEsc(cbStrip(h.t))}" onclick="etfSelect(this.dataset.etfTicker)" aria-pressed="${cbStrip(h.t)===_etfSelected}"><span class="etf-table-identity">${etfIdentityHtml(h)}${changes?`<small class="etf-change-kind">${cbEsc(h.kind)}</small>`:''}</span><span>${changes?h.old.toFixed(2)+' → ':''}${h.w.toFixed(2)}%</span>${changes?`<strong class="${h.delta>0?'etf-increase':'etf-decrease'}">${h.delta>0?'+':''}${h.delta.toFixed(2)}p</strong>`:''}</button>`).join('')||'<p class="sim-empty">표시할 종목이 없습니다.</p>'}</div><div class="etf-pager"><button class="cb-btn" onclick="etfPage(-1)"${_etfPage===0?' disabled':''}>이전</button><span>${_etfPage+1} / ${pages} · ${rows.length}종목</span><button class="cb-btn" onclick="etfPage(1)"${_etfPage>=pages-1?' disabled':''}>다음</button></div>`;
  document.querySelectorAll('.etf-rank-row').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.etfTicker===_etfSelected)));
  const network=document.getElementById('etf-network');if(!network)return;
  const selected=_etfSelected===null?'':(_etfSelected||cbStrip(m.quality.rows[0]?.t));
  const holding=m.quality.rows.find(h=>cbStrip(h.t)===selected)||diff.rows.find(h=>cbStrip(h.t)===selected);
  const openOwners=new Set([...network.querySelectorAll('.etf-owner-exposure')].filter(el=>el.open).map(el=>el.dataset.exposureOwner));
  network.innerHTML=selected?etfExposureHtml(selected,holding):'<p class="sim-empty">구성종목을 선택하면 소유주별 비중을 확인할 수 있습니다.</p>';
  network.querySelectorAll('.etf-owner-exposure').forEach(el=>{if(openOwners.has(el.dataset.exposureOwner))el.open=true;});
}
