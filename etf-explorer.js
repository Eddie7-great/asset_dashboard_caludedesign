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
function etfOwner(owner){_etfOwner=owner;_etfCode='';_etfPage=0;_etfSelected='';_etfQuery='';_etfCompare='';cbRenderEtfExplorer();cbRestoreFilterFocus('cb-head-widgets','data-owner',owner);}
function etfChoose(code){_etfCode=code;_etfPage=0;_etfQuery='';_etfSelected='';_etfCompare='';cbRenderEtfExplorer();document.getElementById('etf-fund')?.focus();}
function etfSearch(value){_etfQuery=value;_etfPage=0;etfRefreshResults();}
function etfPage(step){_etfPage+=step;etfRefreshResults();document.querySelector('#etf-results .etf-pager button:not(:disabled)')?.focus();}
function etfMode(mode){_etfMode=mode;_etfPage=0;_etfQuery='';cbRenderEtfExplorer();cbRestoreFilterFocus('cb-etf2','data-etf-mode',mode);}
function etfSelect(ticker){const inTable=!!document.activeElement?.closest('.etf-table');_etfSelected=ticker;etfRefreshResults();window.EtfTerrain?.sync();if(inTable)cbRestoreFilterFocus('etf-results','data-etf-ticker',ticker);}
function etfModel(){
  const funds=[...new Map(etfHeldRows().map(r=>[cbStrip(r.i.tkr),{code:cbStrip(r.i.tkr),name:r.title}])).values()];
  if(!funds.some(f=>f.code===_etfCode))_etfCode=(funds.find(f=>etfQuality(cbEtfDoc()?.etfs?.[f.code]).reliable)||funds.find(f=>etfStockRows(cbEtfDoc()?.etfs?.[f.code]).length)||funds[0])?.code||'';
  const entry=cbEtfDoc()?.etfs?.[_etfCode],quality=etfQuality(entry);
  const history=(entry?.history||[]).filter(s=>s.asOf&&s.asOf<entry.asOf).sort((a,b)=>b.asOf.localeCompare(a.asOf));
  const previous=history.find(s=>s.asOf+'|'+s.source===_etfCompare)||history.find(s=>s.source===entry.source)||history[0];
  const comparison=etfCompareSnapshots(entry,previous);
  return {funds,entry,quality,history,previous,comparison};
}
function etfConnections(ticker){
  // Each owner is evaluated independently before totals are combined.
  const rows=cbAllRows().filter(r=>_etfOwner==='전체'||r.i.owner===_etfOwner),items=[];
  rows.forEach(r=>{
    if(cbIsEtf(r.i)){
      const h=etfStockRows(cbEtfDoc()?.etfs?.[cbStrip(r.i.tkr)]).find(h=>cbStrip(h.t)===ticker);
      if(h)items.push({name:r.title,owner:r.i.owner,w:h.w,value:r.val*h.w/100,indirect:true});
    }else if(r.i.grp==='주식'&&cbStrip(r.i.tkr)===ticker)items.push({name:'직접 보유',owner:r.i.owner,w:null,value:r.val,indirect:false});
  });
  return items.sort((a,b)=>b.value-a.value);
}
function etfSourceLink(entry){
  if(entry?.source==='provider:TIME')return 'https://timeetf.co.kr/m11_view.php?idx='+(_etfCode==='426020'?'5':'2');
  if(entry?.source==='provider:Invesco')return 'https://www.invesco.com/us/en/financial-products/etfs/invesco-qqq-trust-series-1.html';
  return null;
}
function cbRenderEtfExplorer(){
  const root=document.getElementById('cb-etf2');if(!root)return;
  cbSetHead('ETF의 내부 구성과 기준일별 비중 변화 · 공시 관찰값이며 실시간 매매 내역은 아닙니다',cbOwnerBtns(_etfOwner,'etfOwner'));
  cbEnsureEtfHoldings();
  const m=etfModel(),q=m.quality,link=etfSourceLink(m.entry),oldTerrain=root.querySelector('.etf-terrain');
  const focus=document.activeElement?.id,selection=document.activeElement?.selectionStart;
  const counts=m.funds.reduce((a,f)=>{const q=etfQuality(cbEtfDoc()?.etfs?.[f.code]);a[q.reliable?'ok':'check']++;return a;},{ok:0,check:0});
  root.innerHTML=`<div class="etf-heading"><div><span class="sim-eyebrow">ETF EXPLORER</span><h3>펀드 안의 포트폴리오</h3></div><div class="etf-counts">보유 ${m.funds.length} · 확인 ${counts.ok} · 점검 ${counts.check}</div></div>
    <div class="cb-panel etf-toolbar"><label>보유 ETF<select id="etf-fund" onchange="etfChoose(this.value)">${m.funds.map(f=>`<option value="${cbEsc(f.code)}"${f.code===_etfCode?' selected':''}>${cbEsc(f.name)} · ${cbEsc(f.code)}</option>`).join('')}</select></label>
    <div class="etf-status ${q.reliable?'ok':''}"><b>${cbEsc(q.label)}</b><span>구성 기준 ${cbEsc(m.entry?.asOf||'미확인')}${q.active?' · 액티브':''}</span></div><button class="cb-btn" onclick="cbEnsureEtfHoldings(true)"${_cbEtfLoading?' disabled':''}>${_cbEtfLoading?'확인 중…':'자료 다시 확인'}</button></div>
    ${window._etfLoadError?'<p class="etf-notice" role="status">자료 파일을 읽지 못했습니다. 마지막 정상 자료가 있으면 유지합니다. 다시 확인해 주세요.</p>':''}
    ${m.funds.length?'': '<p class="etf-notice">선택한 구성원에게 보유 ETF가 없습니다.</p>'}
    <div class="etf-layout"><section class="cb-panel etf-visual-card"><div class="etf-section-title"><b>구성 비중 지형</b><span>상위 12종목 · 높이 = ETF 내 비중</span></div>
    <div class="etf-terrain" data-holdings="${cbEsc(JSON.stringify(q.rows.slice(0,12)))}" data-selected="${cbEsc(_etfSelected)}"><div class="etf-terrain-fallback">${etfTerrainFallback(q.rows.slice(0,12))}</div></div>
    <p class="etf-caption">3D 블록을 선택하거나 끌어서 회전 · 아래 종목 버튼으로도 탐색할 수 있습니다.</p><div class="etf-tiles">${q.rows.slice(0,12).map(h=>`<button data-etf-ticker="${cbEsc(cbStrip(h.t))}" onclick="etfSelect(this.dataset.etfTicker)" aria-pressed="${cbStrip(h.t)===_etfSelected}">${cbEsc(h.t)} <b>${h.w.toFixed(2)}%</b></button>`).join('')}</div>
    <div class="etf-coverage"><span>조회된 주식 비중</span><b>${q.rows.length?q.rows.reduce((s,h)=>s+h.w,0).toFixed(2)+'%':'—'}</b><small>순자산 대비 원래 비중 · 현금·채권·파생은 제외하며 100%로 환산하지 않습니다.</small></div></section>
    <section class="cb-panel etf-list-card"><div class="etf-tabs">${[['holdings','구성종목'],['changes','비중 변화']].map(([id,label])=>`<button class="cb-btn" data-etf-mode="${id}" aria-pressed="${_etfMode===id}" onclick="etfMode('${id}')">${label}</button>`).join('')}</div>
    ${_etfMode==='changes'?`<label class="etf-compare">비교 기준<select id="etf-compare" onchange="_etfCompare=this.value;_etfPage=0;etfRefreshResults()">${m.history.map(s=>`<option value="${cbEsc(s.asOf+'|'+s.source)}"${s===m.previous?' selected':''}>${cbEsc(s.asOf)} · ${cbEsc(s.source)}</option>`).join('')}</select></label>`:''}
    <label class="etf-search">종목 검색<input id="etf-search" type="search" value="${cbEsc(_etfQuery)}" placeholder="종목명 또는 티커" oninput="etfSearch(this.value)"></label><div id="etf-results"></div></section></div>
    <section class="cb-panel etf-network" id="etf-network"></section>
    <details class="cb-panel etf-method"><summary>출처·갱신 주기·변경 이력 기준</summary><p>출처 ${cbEsc(m.entry?.source||'미조회')}${link?` · <a href="${link}" target="_blank" rel="noopener noreferrer">운용사 원문 ↗</a>`:''} · 마지막 수집 ${cbEsc(m.entry?.fetchedAt||'기록 없음')} · 마지막 시도 ${cbEsc(m.entry?.lastAttempt||'기록 없음')}</p><p>한국·미국 장 마감 후 평일 두 차례 수집을 시도합니다(KST 18:30, 다음 날 07:30). 화면의 다시 확인은 게시된 자료를 다시 읽습니다. 액티브 ETF는 2평일, 그 외는 5평일을 넘으면 지연으로 표시합니다(거래소 휴일 미반영). 기준일이 없으면 최신 여부를 확정하지 않습니다.</p><p>최근 30개 출처·기준일별 관찰 기록을 보관합니다. 같은 기준일의 수정 공시는 교체하며 과거 이력을 소급 생성하지 않습니다. 같은 출처의 전체 목록끼리만 편입·편출을 판정합니다. 비중 변화에는 가격 움직임도 포함되므로 실제 매매량·매매 시점을 뜻하지 않습니다. 파생·레버리지 ETF의 주식 목록은 전체 경제적 노출과 다를 수 있습니다.</p></details>`;
  const next=root.querySelector('.etf-terrain');
  if(oldTerrain&&next&&oldTerrain.dataset.holdings===next.dataset.holdings){oldTerrain.dataset.selected=next.dataset.selected;next.replaceWith(oldTerrain);}
  etfRefreshResults();window.EtfTerrain?.sync();
  if(focus){const el=document.getElementById(focus);el?.focus({preventScroll:true});if(typeof selection==='number'&&el?.type==='search')el.setSelectionRange(selection,selection);}
}
function etfTerrainFallback(rows){
  const max=Math.max(1,...rows.map(h=>h.w));
  return rows.map(h=>`<div class="etf-fallback-row"><span>${cbEsc(h.t)}</span><i style="width:${h.w/max*65}%"></i><b>${h.w.toFixed(2)}%</b></div>`).join('')||'<p class="sim-empty">조회된 구성종목이 없습니다.</p>';
}
function etfRefreshResults(){
  const root=document.getElementById('etf-results');if(!root)return;
  const m=etfModel(),changes=_etfMode==='changes',diff=m.comparison;
  const rows=(changes?diff.rows:m.quality.rows).filter(h=>!_etfQuery||[h.t,h.n,h.kind].join(' ').toLowerCase().includes(_etfQuery.toLowerCase()));
  const pages=Math.max(1,Math.ceil(rows.length/ETF_PAGE_SIZE));_etfPage=Math.max(0,Math.min(_etfPage,pages-1));
  const note=changes?(!m.previous?'다음 기준일 자료가 쌓이면 변화를 비교할 수 있습니다.':!diff.comparable?'출처가 달라 편입·편출·비중 변화를 비교하지 않습니다.':!diff.complete?'일부 자료 비교 · 양쪽에 확인된 종목의 비중 변화만 표시합니다.':`${m.previous.asOf} → ${m.entry.asOf} · 비중 차이(%p), 매매량과 다를 수 있음`):`${rows.length}종목 · ${m.quality.label}`;
  root.innerHTML=`<p class="etf-caption" role="status">${cbEsc(note)}</p><div class="etf-table"><div class="etf-table-head"><span>종목</span><span>${changes?'이전 → 현재':'비중'}</span><span>${changes?'변화':'탐색'}</span></div>${rows.slice(_etfPage*ETF_PAGE_SIZE,(_etfPage+1)*ETF_PAGE_SIZE).map(h=>`<button class="etf-table-row${cbStrip(h.t)===_etfSelected?' selected':''}" data-etf-ticker="${cbEsc(cbStrip(h.t))}" onclick="etfSelect(this.dataset.etfTicker)" aria-pressed="${cbStrip(h.t)===_etfSelected}"><span><b>${cbEsc(h.n)}</b><small>${cbEsc(h.t)}${changes?' · '+cbEsc(h.kind):''}</small></span><span>${changes?h.old.toFixed(2)+' → ':''}${h.w.toFixed(2)}%</span><strong${changes?` class="${h.delta>0?'etf-increase':'etf-decrease'}"`:''}>${changes?(h.delta>0?'+':'')+h.delta.toFixed(2)+'p':'↗'}</strong></button>`).join('')||'<p class="sim-empty">표시할 종목이 없습니다.</p>'}</div><div class="etf-pager"><button class="cb-btn" onclick="etfPage(-1)"${_etfPage===0?' disabled':''}>이전</button><span>${_etfPage+1} / ${pages} · ${rows.length}종목</span><button class="cb-btn" onclick="etfPage(1)"${_etfPage>=pages-1?' disabled':''}>다음</button></div>`;
  document.querySelectorAll('.etf-tiles button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.etfTicker===_etfSelected)));
  const terrain=document.querySelector('.etf-terrain');if(terrain)terrain.dataset.selected=_etfSelected;
  const network=document.getElementById('etf-network');if(!network)return;
  const selected=_etfSelected||cbStrip(m.quality.rows[0]?.t),connections=etfConnections(selected);
  network.innerHTML=`<div class="etf-section-title"><b>${cbEsc(selected||'종목 선택')} · 보유 경로</b><span>${cbEsc(_etfOwner)} · 직접 보유와 ETF 내 간접 노출</span></div><div class="etf-flow"><div class="etf-flow-target">${cbEsc(selected||'—')}</div><div class="etf-flow-branches">${connections.map(c=>`<div><i aria-hidden="true"></i><span><b>${cbEsc(c.name)}</b><small>${cbEsc(c.owner)}${c.indirect?' · ETF 비중 '+c.w.toFixed(2)+'%':''}</small></span><strong>${cbDisp(c.value)}</strong></div>`).join('')||'<p class="sim-empty">확인된 보유 경로가 없습니다.</p>'}</div></div><p class="etf-caption">간접 노출은 현재 ETF 평가액 × 공시 비중으로 추산합니다. 조회된 자료만 포함하며 구성원별 경로를 구분합니다.</p>`;
}
