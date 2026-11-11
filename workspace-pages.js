// 계좌별 보기(acct2)·통합 일정(cal2) — 조회 전용 화면이다. 원장·재무계획·KV 에 쓰지 않는다.
// 새 판정 기준을 만들지 않는다: 평가액·손익은 cbRow, 계좌 세제 구분은 getAccountDivTaxInfo,
// 배당 일정은 cbUpcomingDividendSchedule, 적립 매수는 cbDcaScheduledOn·cbDcaPerOrderKRW,
// 자동이체는 _autoTransferOccursOn·_effectiveAutoTransferAmt 가 이미 정한 값을 모아 보여 줄 뿐이다.
// cobalt.js 의 CB_VIEWS 가 이 파일의 렌더 함수를 참조하므로 cobalt.js 보다 먼저 로드한다.
let _acctOwner='전체';
let _calOwner='전체', _calYm=null;

// ───────────────────────── 계좌별 보기 ─────────────────────────
const ACCT_KINDS=['일반','ISA','연금','증여계좌'];
const ACCT_KIND_NOTE={
  '일반':'배당·매매차익에 일반 과세',
  'ISA':'만기·해지 때 계좌 전체 손익으로 정산',
  '연금':'인출할 때까지 과세이연',
  '증여계좌':'증여받은 자금 계좌 · 과세는 일반 계좌와 같음',
};
// 화면 구분: 계좌 이름에 '증여'가 있으면 증여계좌, 그 밖은 배당세 엔진과 같은 구분(getAccountDivTaxInfo).
function acctKind(acc){
  const a=String(acc||'');
  if(/증여/.test(a)) return '증여계좌';
  const type=getAccountDivTaxInfo(a).type;
  return type==='ISA'?'ISA':type==='연금'?'연금':'일반';
}
function acctGroups(ownerF){
  const rows=finRows(ownerF), total=rows.reduce((s,r)=>s+r.val,0), map=new Map();
  rows.forEach(r=>{
    const owner=r.i.owner||'—', broker=r.i.broker||'미지정', acc=r.i.acc||'미지정';
    const key=[owner,broker,acc].join('\u001f');
    let g=map.get(key);
    if(!g){ g={key,owner,broker,acc,kind:acctKind(r.i.acc),value:0,cost:0,gain:0,dividend:0,stale:0,rows:[]}; map.set(key,g); }
    g.value+=r.val;
    // 현금과 취득가 미상은 손익에서 뺀다(보유 목록 숫자 카드와 같은 기준).
    if(r.i.grp!=='현금'&&!r.i.costUnknown){ g.cost+=r.cost; g.gain+=r.gain; }
    g.dividend+=cbDivIncomeKRW(r.i);
    if(r.i._priceStale===true) g.stale++;
    g.rows.push(r);
  });
  const ownerRank=o=>{ const k=OWNERS.indexOf(o); return k<0?99:k; };
  const groups=Array.from(map.values()).sort((a,b)=>ownerRank(a.owner)-ownerRank(b.owner)||b.value-a.value);
  groups.forEach(g=>{ g.share=total>0?g.value/total*100:0; g.gainPct=g.cost>0?g.gain/g.cost:null; g.rows.sort((a,b)=>b.val-a.val); });
  const kinds=ACCT_KINDS.map(kind=>{
    const list=groups.filter(g=>g.kind===kind), value=list.reduce((s,g)=>s+g.value,0);
    return {kind,value,share:total>0?value/total*100:0,accounts:list.length,holdings:list.reduce((s,g)=>s+g.rows.length,0)};
  });
  return {total,groups,kinds};
}
function acctOwner(o){ _acctOwner=o; cbRenderAccounts(); cbRestoreFilterFocus('cb-head-widgets','data-owner',o); }
function cbRenderAccounts(){
  const el=document.getElementById('cb-acct2'); if(!el) return;
  const ownerF=finOwnerF(_acctOwner), data=acctGroups(ownerF);
  cbSetHead('계좌 종류별 평가액·손익·예상 배당 · 조회 전용이며 수정은 보유 목록에서 합니다',cbOwnerBtns(_acctOwner,'acctOwner'));
  if(!data.groups.length){
    el.innerHTML=`<div class="cb-panel"><div class="fin-empty">${ownerF?cbEsc(ownerF)+' 소유의 ':''}보유 자산이 없습니다. 자산 관리 > 보유 목록에서 추가하면 계좌별로 묶어 보여 드립니다.</div></div>`;
    return;
  }
  const kindCards=data.kinds.map(k=>`<div class="cb-panel acct-kind-card${k.accounts?'':' is-empty'}">
      <span class="acct-kind-label">${k.kind}</span>
      <b class="acct-kind-value">${k.accounts?cbDisp(k.value):'—'}</b>
      <span class="acct-kind-sub">${k.accounts?`${k.share.toFixed(1)}% · 계좌 ${k.accounts}개 · ${k.holdings}종목`:'해당 계좌 없음'}</span>
      <span class="acct-kind-note">${ACCT_KIND_NOTE[k.kind]}</span>
    </div>`).join('');
  const body=data.groups.map(g=>{
    const info=getAccountDivTaxInfo(g.acc);
    return `<details class="acct-group">
      <summary class="acct-row">
        <span class="acct-name"><i style="background:${cbOwnerColor(g.owner)}"></i><b>${cbEsc(g.owner)}</b><span>${cbEsc(g.broker)} · ${cbEsc(g.acc)}</span><em class="acct-kind-chip">${g.kind}</em>${g.stale?`<em class="acct-stale-chip">시세 미조회 ${g.stale}</em>`:''}</span>
        <span class="cb-num">${cbDisp(g.value)}</span>
        <span class="cb-num">${g.share.toFixed(1)}%</span>
        <span class="cb-num" style="${g.gainPct==null?'color:var(--lab)':cbUpDn(g.gain)}">${g.gainPct==null?'—':cbSignDisp(g.gain)+' · '+cbPct(g.gainPct)}</span>
        <span class="cb-num">${g.dividend>0?cbDisp(g.dividend):'—'}</span>
        <span class="cb-num">${g.rows.length}</span>
      </summary>
      <div class="acct-holdings">
        <div class="acct-tax-line">배당 과세: ${cbEsc(info.label||g.kind)}</div>
        ${g.rows.map(r=>`<div class="acct-holding">
          <span><b>${cbEsc(r.title)}</b>${r.subTitle?` <small>${cbEsc(r.subTitle)}</small>`:''}</span>
          <span class="cb-num">${cbDisp(r.val)}</span>
          <span class="cb-num" style="${r.gainPct==null?'color:var(--lab)':cbUpDn(r.gain)}">${r.gainPct==null?'—':cbSignDisp(r.gain)+' · '+cbPct(r.gainPct)}</span>
        </div>`).join('')}
      </div>
    </details>`;
  }).join('');
  el.innerHTML=`<div class="acct-kind-grid">${kindCards}</div>
    <div class="cb-panel acct-table-panel">
      <div class="cb-panel-title">계좌별 내역 <span style="color:var(--dim)">· ${data.groups.length}개 계좌 · 줄을 누르면 보유 종목이 펼쳐집니다</span></div>
      <div class="acct-table-wrap"><div class="acct-table">
        <div class="acct-row acct-head"><span>소유주 · 증권사 · 계좌</span><span>평가액</span><span>비중</span><span>평가손익</span><span><span data-tip="현재 보유 수량 × 최근 1년 주당 배당. 세전 금액이며 확정 지급액이 아닙니다.">연 배당(세전 추정)</span></span><span>종목</span></div>
        ${body}
      </div></div>
      <p class="acct-foot">비중은 ${ownerF?cbEsc(ownerF):'가족 전체'} 투자자산(주식·가상화폐·금·현금) 대비입니다. 현금과 취득가 미상 종목은 평가손익에서 뺍니다. ISA 납입 한도·만기일과 연금 납입 한도는 가입일·납입액 기록이 없어 표시하지 않습니다.</p>
    </div>`;
}

// ───────────────────────── 통합 일정 ─────────────────────────
const CAL_KINDS={
  div:{label:'배당 예상',cls:'div'},
  dca:{label:'적립 매수',cls:'dca'},
  out:{label:'자동이체 지출',cls:'out'},
  in:{label:'자동이체 수입',cls:'in'},
};
function calYm(){ if(!_calYm){ const d=new Date(); _calYm={y:d.getFullYear(),m:d.getMonth()}; } return _calYm; }
// 한 달의 일정. days[일] = 그날의 항목, undated = 지급일을 모르는 배당(달만 안다 — 임의의 날짜에 찍지 않는다).
function calEvents(year, month0, ownerF){
  const last=new Date(year,month0+1,0).getDate();
  const days={}, undated=[], totals={div:0,dca:0,out:0,in:0};
  const push=(day,ev)=>{ (days[day]=days[day]||[]).push(ev); totals[ev.kind]+=ev.amount; };
  const rows=finRows(ownerF);
  // 적립식 매수 · 자동이체: 날짜마다 기존 판정 함수에 묻는다
  const dcaRows=rows.filter(r=>r.i.dca);
  const transfers=(typeof autoTransferData!=='undefined'&&Array.isArray(autoTransferData)?autoTransferData:[]).filter(at=>!ownerF||at.owner===ownerF);
  for(let day=1;day<=last;day++){
    const date=new Date(year,month0,day,12,0,0,0);
    dcaRows.forEach(r=>{
      if(!cbDcaScheduledOn(r.i,date)) return;
      const amount=cbDcaPerOrderKRW(r.i);
      if(amount>0) push(day,{kind:'dca',title:r.title,owner:r.i.owner||'—',amount});
    });
    transfers.forEach(at=>{
      if(!_autoTransferOccursOn(at,date)) return;
      const amount=_effectiveAutoTransferAmt(at,year,month0+1);
      if(amount>0) push(day,{kind:at.type==='수입'?'in':'out',title:at.desc||at.cat||'자동이체',owner:at.owner||'—',amount});
    });
  }
  // 배당: 과거 지급 패턴으로 추정한 세전 금액. 지급일을 모르면 '이번 달 예정'으로만 둔다.
  const divList=rows.filter(r=>r.i.grp==='주식'&&cbDivOf(r.i)).map(r=>({i:r.i,tkr:r.tkr,title:r.title,d:cbDivOf(r.i),incomeKRW:cbDivIncomeKRW(r.i)}));
  cbUpcomingDividendSchedule(divList,last-1,new Date(year,month0,1)).forEach(ev=>{
    if(ev.date.getFullYear()!==year||ev.date.getMonth()!==month0) return;
    const item={kind:'div',title:ev.title,owner:ev.owner,amount:ev.amount};
    if(/예정$/.test(ev.dateLabel)){ undated.push(item); totals.div+=item.amount; }
    else push(ev.date.getDate(),item);
  });
  return {year,month0,last,days,undated,totals};
}
function calMove(delta){
  const ym=calYm(), d=new Date(ym.y,ym.m+delta,1);
  _calYm={y:d.getFullYear(),m:d.getMonth()}; cbRenderCalendar();
  cbRestoreFilterFocus('cb-cal2','data-cal-move',String(delta));
}
function calToday(){ _calYm=null; cbRenderCalendar(); cbRestoreFilterFocus('cb-cal2','data-cal-move','0'); }
function calOwner(o){ _calOwner=o; cbRenderCalendar(); cbRestoreFilterFocus('cb-head-widgets','data-owner',o); }
function cbRenderCalendar(){
  const el=document.getElementById('cb-cal2'); if(!el) return;
  const ym=calYm(), ownerF=finOwnerF(_calOwner), data=calEvents(ym.y,ym.m,ownerF);
  cbSetHead('배당 예상·적립 매수·자동이체를 한 달력에 모아 봅니다 · 각 화면의 일정을 그대로 가져온 조회 전용 화면',cbOwnerBtns(_calOwner,'calOwner'));
  const today=new Date(), isThisMonth=today.getFullYear()===ym.y&&today.getMonth()===ym.m;
  const first=new Date(ym.y,ym.m,1).getDay();
  const chip=ev=>`<span class="cal-chip ${CAL_KINDS[ev.kind].cls}" data-tip="${cbEsc(CAL_KINDS[ev.kind].label+' · '+ev.owner+' · '+ev.title+' · '+cbDisp(ev.amount))}"><i></i><span>${cbEsc(ev.title)}</span></span>`;
  let cells='';
  for(let n=0;n<first;n++) cells+='<div class="cal-cell is-blank"></div>';
  for(let day=1;day<=data.last;day++){
    const list=data.days[day]||[], dow=(first+day-1)%7;
    cells+=`<div class="cal-cell${isThisMonth&&today.getDate()===day?' is-today':''}${dow===0?' is-sun':dow===6?' is-sat':''}">
      <span class="cal-day">${day}</span>
      ${list.slice(0,3).map(chip).join('')}${list.length>3?`<span class="cal-more">외 ${list.length-3}건</span>`:''}
    </div>`;
  }
  const all=[];
  Object.keys(data.days).map(Number).sort((a,b)=>a-b).forEach(day=>data.days[day].forEach(ev=>all.push({...ev,when:`${ym.m+1}월 ${day}일`})));
  data.undated.forEach(ev=>all.push({...ev,when:`${ym.m+1}월 중 · 지급일 미정`}));
  const row=ev=>`<div class="cal-list-row">
      <span class="cal-list-when">${ev.when}</span>
      <span class="cal-kind ${CAL_KINDS[ev.kind].cls}"><i></i>${CAL_KINDS[ev.kind].label}</span>
      <span class="cal-list-title">${cbEsc(ev.title)}<small>${cbEsc(ev.owner)}</small></span>
      <b class="cb-num">${ev.kind==='div'||ev.kind==='in'?'+':'−'}${cbDisp(ev.amount)}</b>
    </div>`;
  const card=(kind,sub)=>`<div class="cb-panel cal-sum-card"><span class="cal-kind ${CAL_KINDS[kind].cls}"><i></i>${CAL_KINDS[kind].label}</span><b>${cbDisp(data.totals[kind])}</b><small>${sub}</small></div>`;
  el.innerHTML=`<div class="cal-toolbar">
      <button type="button" class="cb-btn" data-cal-move="-1" onclick="calMove(-1)" aria-label="이전 달">‹</button>
      <b class="cal-title" aria-live="polite">${ym.y}년 ${ym.m+1}월</b>
      <button type="button" class="cb-btn" data-cal-move="1" onclick="calMove(1)" aria-label="다음 달">›</button>
      <button type="button" class="cb-btn" data-cal-move="0" onclick="calToday()"${isThisMonth?' disabled':''}>이번 달</button>
    </div>
    <div class="cal-sum-grid">
      ${card('div','세전 추정 · 확정 지급액 아님')}
      ${card('dca','활성 규칙 기준 · 실제 체결 아님')}
      ${card('out','등록한 자동이체')}
      ${card('in','등록한 자동이체')}
    </div>
    <div class="cal-layout">
      <div class="cb-panel cal-grid-panel">
        <div class="cal-grid" role="img" aria-label="${ym.y}년 ${ym.m+1}월 일정 달력. 일정 ${all.length}건은 옆 목록에서 읽을 수 있습니다.">
          ${['일','월','화','수','목','금','토'].map(d=>`<div class="cal-dow">${d}</div>`).join('')}${cells}
        </div>
      </div>
      <div class="cb-panel cal-list-panel">
        <div class="cb-panel-title">이 달의 일정 <span style="color:var(--dim)">· ${all.length}건</span></div>
        ${all.length?`<div class="cal-list">${all.map(row).join('')}</div>`:`<div class="fin-empty">${ownerF?cbEsc(ownerF)+' 소유의 ':''}이 달 일정이 없습니다. 적립식 규칙·자동이체·배당 종목이 있으면 여기에 모입니다.</div>`}
      </div>
    </div>
    <p class="cal-foot">배당은 과거 지급 패턴과 현재 보유 수량으로 추정한 세전 금액이며, 지급일을 모르는 종목은 날짜 칸에 넣지 않고 '지급일 미정'으로 둡니다. 적립 매수는 휴장일을 반영한 예정일이고 실제 체결 기록이 아닙니다. 세금 신고 기한은 세금 규칙 자료에 등록돼 있지 않아 표시하지 않습니다.</p>`;
}

// ───────────────────────── 결산 리포트 (report2 월간 · reporty 연간) ─────────────────────────
// 조회 전용 — 원장·KV·브라우저 저장소에 쓰지 않는다.
// 지난 달은 매일 도는 배치(scripts/net_worth_snapshot.py)가 남긴 월말 기록(window._reportArchive)으로 그리고,
// 이번 달은 같은 계산(reportBuildEntry)을 지금 원장에 돌려 실시간으로 그린다. 기록이 없는 달의 숫자를 지어내지 않는다.
let _reportOwner='전체', _reportYm=null, _reportYear=null;
const _reportScroll={}, _reportObserver={};
const REPORT_CLS_ORDER=['us','kr','jp','crypto','gold','cash'];
function reportOwner(o){ _reportOwner=o; reportRerender(); cbRestoreFilterFocus('cb-head-widgets','data-owner',o); }
function reportMonth(ym){ _reportYm=ym; delete _reportScroll.report2; cbRenderReport(); document.getElementById('rep-month')?.focus(); }
function reportYear(y){ _reportYear=y; delete _reportScroll.reporty; cbRenderReportYear(); document.getElementById('rep-year')?.focus(); }
function reportRerender(){ if(document.getElementById('view-reporty')?.classList.contains('active')) cbRenderReportYear(); else cbRenderReport(); }
function reportYmLabel(ym){ const [y,m]=String(ym).split('-'); return `${y}년 ${Number(m)}월`; }
function reportYmNext(ym){ const [y,m]=ym.split('-').map(Number); return m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,'0')}`; }

// 한 시점의 요약. 배치의 build_month_entry 와 같은 계산이다 — 한쪽만 고치면 지난 결산과 이번 달 화면의 기준이 갈린다
// (scripts/tests/test_net_worth_snapshot.py 가 같은 입력으로 두 결과를 대조한다).
function reportBuildEntry(items, balanceSheet, goals, dateStr){
  const num=v=>{ const n=Number(v); return Number.isFinite(n)?n:0; };
  const rows=(Array.isArray(items)?items:[]).filter(i=>i&&num(i.qty)>0).map(i=>({i,val:cbValKRW(i),cost:cbCostKRW(i)})).sort((a,b)=>b.val-a.val);
  let total=0; const byOwner={}, cls={'전체':{}}, pl={'전체':{cost:0,gain:0}}, holdings=[];
  rows.forEach(({i,val,cost})=>{
    const owner=i.owner||'본인', kind=cbCls(i);
    total+=val; byOwner[owner]=(byOwner[owner]||0)+val;
    ['전체',owner].forEach(k=>{ (cls[k]=cls[k]||{})[kind]=(cls[k][kind]||0)+val; });
    if(i.grp!=='현금'&&!i.costUnknown) ['전체',owner].forEach(k=>{ const a=(pl[k]=pl[k]||{cost:0,gain:0}); a.cost+=cost; a.gain+=val-cost; });
    holdings.push({o:owner,b:String(i.broker||''),a:String(i.acc||''),t:String(i.tkr||''),n:String(i.name||i.tkr||''),g:kind,q:num(i.qty),c:Math.round(cost),v:Math.round(val),u:!!i.costUnknown});
  });
  const sumAmt=list=>(Array.isArray(list)?list:[]).reduce((s,r)=>s+(r&&typeof r==='object'?num(r.amount):0),0);
  const bs=balanceSheet&&typeof balanceSheet==='object'?balanceSheet:{};
  const net=total+sumAmt(bs.assets)-sumAmt(bs.liabilities);
  const goalRows=(Array.isArray(goals)?goals:[]).filter(g=>g&&typeof g==='object').map(g=>{
    const link=g.linkClass||'investment';
    const now=link==='net'?net:link==='investment'?total:link==='manual'?num(g.currentAmount):(cls['전체'][link]||0);
    return {name:String(g.name||'목표'),now:Math.round(now),target:Math.round(num(g.targetAmount))};
  });
  const roundMap=m=>Object.fromEntries(Object.entries(m).map(([k,v])=>[k,Math.round(v)]));
  return {ym:String(dateStr).slice(0,7),date:String(dateStr),schemaV:1,total:Math.round(total),byOwner:roundMap(byOwner),
    cls:Object.fromEntries(Object.entries(cls).map(([k,m])=>[k,roundMap(m)])),
    pl:Object.fromEntries(Object.entries(pl).map(([k,v])=>[k,{cost:Math.round(v.cost),gain:Math.round(v.gain)}])),
    holdings,goals:goalRows};
}
// 일별 기록의 월말 값(그달 마지막 유효 기록). 기록이 없는 달은 만들지 않는다.
function reportMonthEnds(history, ownerF){
  const byYm=new Map();
  (Array.isArray(history)?history:[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date))).forEach(e=>{
    const date=String(e&&e.date||''); if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const v=ownerF?finSnapshotOwnerInvestment(e,ownerF):finSnapshotInvestment(e);
    if(v==null||!Number.isFinite(v)) return;
    byYm.set(date.slice(0,7),{ym:date.slice(0,7),date,v});
  });
  return Array.from(byYm.values());
}
function reportEntryValue(entry, ownerF){
  if(!entry) return null;
  if(!ownerF) return Number.isFinite(entry.total)?entry.total:null;
  const v=(entry.byOwner||{})[ownerF]; return Number.isFinite(v)?v:null;
}
// 달 목록: 월말 보관 ∪ 일별 기록이 있는 달 ∪ 이번 달(실시간). src 로 어디서 온 값인지 남긴다.
function reportTimeline(ownerF, todayKey){
  const curYm=String(todayKey).slice(0,7), archive=window._reportArchive||{}, map=new Map();
  reportMonthEnds(window._netWorthHistory, ownerF).forEach(m=>{ if(m.ym<curYm) map.set(m.ym,{ym:m.ym,date:m.date,v:m.v,entry:null,src:'daily'}); });
  Object.keys(archive).forEach(ym=>{
    if(ym>=curYm) return;
    const v=reportEntryValue(archive[ym],ownerF); if(v==null) return;
    map.set(ym,{ym,date:archive[ym].date,v,entry:archive[ym],src:'archive'});
  });
  const live=reportBuildEntry(typeof pfolioData!=='undefined'?pfolioData:[],window._balanceSheet,typeof goalData!=='undefined'?goalData:[],todayKey);
  const liveV=reportEntryValue(live,ownerF);
  if(liveV!=null&&(live.holdings.length||map.size)) map.set(curYm,{ym:curYm,date:todayKey,v:liveV,entry:live,src:'live'});
  return Array.from(map.values()).sort((a,b)=>a.ym.localeCompare(b.ym));
}
// 기본 달: 이미 끝난 가장 최근 달. 끝난 달이 없으면 이번 달.
function reportDefaultYm(months, todayKey){
  if(!months.length) return null;
  const cur=String(todayKey).slice(0,7), done=months.filter(m=>m.ym<cur);
  return (done.length?done[done.length-1]:months[months.length-1]).ym;
}
// 두 시점의 보유를 소유주·증권사·계좌·티커로 맞대어 무엇이 달라졌는지 본다(거래 기록이 아니라 두 시점의 차이).
// flow = 취득원가 변화의 합(현금 포함 — 현금은 원가=평가액) → 새로 넣거나 뺀 돈의 추정. 나머지가 값이 오르내린 몫이다.
function reportHoldingDiff(prevHoldings, curHoldings, ownerF){
  if(!Array.isArray(prevHoldings)||!Array.isArray(curHoldings)) return null;
  const pick=list=>list.filter(h=>h&&(!ownerF||h.o===ownerF));
  // 티커는 거래소 접미사를 떼고 맞춘다 — 앱은 불러올 때 005930 을 005930.KS 로 고쳐 쓰므로 그대로 비교하면 같은 종목이 '새로 담음'과 '모두 팖'으로 갈린다.
  const key=h=>[h.o,h.b,h.a,cbStrip(h.t)].join('\u001f');
  const prev=new Map(pick(prevHoldings).map(h=>[key(h),h])), cur=new Map(pick(curHoldings).map(h=>[key(h),h]));
  const rows=[]; let flow=0, prevTotal=0, curTotal=0;
  prev.forEach(h=>{ prevTotal+=h.v; }); cur.forEach(h=>{ curTotal+=h.v; });
  new Set([...prev.keys(),...cur.keys()]).forEach(k=>{
    const p=prev.get(k), c=cur.get(k), ref=c||p, pq=p?p.q:0, cq=c?c.q:0, pc=p?p.c:0, cc=c?c.c:0;
    flow+=cc-pc;
    if(Math.abs(cq-pq)<=1e-9*Math.max(1,Math.abs(pq),Math.abs(cq))) return;
    let kind;
    if(ref.g==='cash') kind='cash';
    else if(!p) kind='new';
    else if(!c) kind='out';
    else if(pc>0&&Math.abs(cc-pc)<=Math.max(1,pc*0.005)) kind='split';
    else kind=cq>pq?'more':'less';
    rows.push({kind,o:ref.o,n:ref.n,t:ref.t,g:ref.g,pq,cq,dc:cc-pc,dv:(c?c.v:0)-(p?p.v:0),unknown:!!ref.u});
  });
  const order={new:0,more:1,less:2,out:3,split:4,cash:5};
  rows.sort((a,b)=>(order[a.kind]-order[b.kind])||Math.abs(b.dc||b.dv)-Math.abs(a.dc||a.dv));
  const trades=rows.filter(r=>r.kind!=='cash'&&r.kind!=='split').length;
  return {rows,trades,flow,change:curTotal-prevTotal,market:(curTotal-prevTotal)-flow};
}
// 배당 12칸: 끝난 달은 현금 흐름에 기록된 '배당금' 수입, 이번 달 이후는 배당 엔진의 세후 예상(divHistoryOf).
function reportDividendYear(year, ownerF, todayKey){
  const curYm=String(todayKey).slice(0,7), y=String(year);
  const rec=Array(12).fill(0); let recorded=false;
  (typeof cfData!=='undefined'&&Array.isArray(cfData)?cfData:[]).forEach(e=>{
    if(!e||e.type!=='수입'||e.cat!=='배당금') return;
    const d=String(e.date||''); if(!/^\d{4}-\d{2}/.test(d)||d.slice(0,4)!==y) return;
    if(ownerF&&e.owner!==ownerF) return;
    rec[Number(d.slice(5,7))-1]+=Number(e.amt)||0; recorded=true;
  });
  const est=(typeof divHistoryYears==='function'&&divHistoryYears().map(String).includes(y))?divHistoryOf(y,ownerF||'전체').map(v=>Number(v)||0):null;
  const months=rec.map((v,i)=>{
    const ym=`${y}-${String(i+1).padStart(2,'0')}`;
    if(ym<curYm) return {v:recorded?v:null,kind:'rec'};
    return {v:est?est[i]:null,kind:'est'};
  });
  return {months,recorded,hasEst:!!est};
}
function reportRealizedYear(year, ownerF){
  const rows=(typeof monthlyPLData!=='undefined'&&Array.isArray(monthlyPLData)?monthlyPLData:[]).filter(r=>r&&String(r.month||'').slice(0,4)===String(year)&&(!ownerF||r.owner===ownerF));
  return {count:rows.length,sum:rows.reduce((s,r)=>s+(Number(r.amt)||0),0)};
}

// ── 그리기 도우미 ──
function reportQty(q){ return Number(q).toLocaleString('ko-KR',{maximumFractionDigits:4}); }
function reportBar(label,width,right,color,amount){
  return `<div class="rep-bar"><span>${cbEsc(label)}</span><i style="--p:${Math.max(0,Math.min(100,width)).toFixed(1)}%;--c:${color}"></i><b>${right}</b><em>${amount}</em></div>`;
}
function reportDiffAmt(v){ return `<b class="${v<0?'rep-dn':'rep-up'}">${v>0?'+':''}${cbDisp(v)}</b>`; }
function reportSign(p,d=1){ return (p>0?'+':'')+p.toFixed(d)+'%'; }
function reportTrendSvg(points){
  if(points.length<2) return '';
  const w=520,h=190,pad=14,vals=points.map(m=>m.v),mn=Math.min(...vals),mx=Math.max(...vals),span=mx-mn||1;
  const pts=points.map((m,i)=>[pad+i*(w-2*pad)/(points.length-1),h-30-(m.v-mn)/span*(h-30-pad)]);
  const d=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  const a=points[0],z=points[points.length-1];
  return `<svg class="rep-trend" viewBox="0 0 ${w} ${h}" role="img" aria-label="${reportYmLabel(a.ym)}부터 ${reportYmLabel(z.ym)}까지 월말 투자자산 추이">
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${pts.map((p,i)=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${i===pts.length-1?5.5:2.8}" fill="currentColor"/>`).join('')}
    <text x="${pts[0][0]}" y="${h-6}" font-size="12" fill="currentColor">${Number(a.ym.slice(5))}월</text>
    <text x="${pts[pts.length-1][0]}" y="${h-6}" font-size="12" fill="currentColor" text-anchor="end">${Number(z.ym.slice(5))}월</text></svg>`;
}
const REPORT_DIFF_LABEL={new:'새로 담음',more:'더 삼',less:'줄임',out:'모두 팖',split:'분할·병합으로 보임',cash:'현금'};
function reportDiffHtml(diff, limit){
  if(!diff.rows.length) return '<p class="rep-note">보유 종목과 현금 잔액에 변화가 없었습니다.</p>';
  const rows=diff.rows.slice(0,limit||12);
  return `<ul class="rep-diff">${rows.map(r=>{
    const qty=r.kind==='cash'?reportDiffAmt(r.dv):`${reportQty(r.pq)} → ${reportQty(r.cq)}`;
    const money=r.kind==='cash'||r.kind==='split'?'':(r.unknown?'<em>취득가 미상</em>':`<em>원가 ${r.dc>0?'+':''}${cbDisp(r.dc)}</em>`);
    return `<li class="is-${r.kind}"><span class="rep-diff-tag">${REPORT_DIFF_LABEL[r.kind]}</span><b>${cbEsc(r.n)}</b><small>${cbEsc(r.o)}</small><span class="rep-diff-qty">${qty}</span>${money}</li>`;
  }).join('')}</ul>${diff.rows.length>rows.length?`<p class="rep-note">그 밖에 ${diff.rows.length-rows.length}건이 더 있습니다.</p>`:''}`;
}
function reportSplitBars(diff){
  const mx=Math.max(1,Math.abs(diff.flow),Math.abs(diff.market));
  const row=(label,v)=>`<div class="rep-split-row"><span>${label}</span><i class="${v<0?'is-neg':''}" style="--p:${(Math.abs(v)/mx*100).toFixed(1)}%"></i>${reportDiffAmt(v)}</div>`;
  return `<div class="rep-split">${row('새로 넣거나 뺀 돈',diff.flow)}${row('값이 오르내린 몫',diff.market)}</div>`;
}
function reportChapter(id,no,title,badge,tone,prose,figure,flip){
  return `<section class="rep-page rep-chapter ${tone||''}${flip?' is-flip':''}" data-rep-page="${cbEsc(title)}" aria-labelledby="${id}-h${no}"><div class="rep-inner">
      <div class="rep-prose"><p class="rep-no">${no}장</p><h2 id="${id}-h${no}"><span class="rep-title">${title}</span> ${badge||''}</h2>${prose}</div>
      <div class="rep-figure">${figure}</div></div></section>`;
}
// 화면에 붙이기: 스크롤 위치 유지(시세 갱신 재렌더) + 장 표시(점) + 현재 장 추적.
function reportMount(viewId, pages){
  const el=document.getElementById('cb-'+viewId); if(!el) return;
  const keep=_reportScroll[viewId]===true?el.scrollTop:0;
  el.classList.add('rep-scroll');
  const titles=[...pages.matchAll(/data-rep-page="([^"]*)"/g)].map(m=>m[1]);
  el.innerHTML=`<nav class="rep-dots" aria-label="장 이동">${titles.map((t,i)=>`<button type="button" data-rep-dot="${i}" onclick="reportGo('${viewId}',${i})"${i===0?' aria-current="true"':''}><span>${t}</span></button>`).join('')}</nav>${pages}`;
  const fit=()=>{ if(el.clientHeight>200) el.style.setProperty('--rep-h',el.clientHeight+'px'); };
  // 헤더 높이가 바뀌면(소유주 탭 줄바꿈·사이드바 접기) 스크롤 영역 높이도 바뀐다 — 장 높이를 그 값에 다시 맞춘다.
  fit(); if(!el._repFit){ el._repFit=true; if(typeof ResizeObserver==='function') new ResizeObserver(()=>{ if(el.classList.contains('rep-scroll')) fit(); }).observe(el); else window.addEventListener('resize',fit); }
  // 휠 한 칸에 한 장. 스냅만 두면 작은 휠 한 칸은 제자리로 되돌아가 '안 넘어가는' 것처럼 보인다.
  // 장 안에서 스스로 스크롤되는 목록(보유 변화)은 그 목록이 끝까지 갔을 때만 장을 넘긴다. 좁은 화면(스냅 해제)에서는 손대지 않는다.
  if(!el._repWheel){ el._repWheel=true; el.addEventListener('wheel',e=>{
    if(!el.classList.contains('rep-scroll')||getComputedStyle(el).scrollSnapType.indexOf('mandatory')<0||e.ctrlKey||Math.abs(e.deltaY)<4||Math.abs(e.deltaX)>Math.abs(e.deltaY)) return;
    const inner=e.target.closest&&e.target.closest('.rep-diff');
    if(inner&&inner.scrollHeight>inner.clientHeight+1){ const down=e.deltaY>0; if(down?inner.scrollTop+inner.clientHeight<inner.scrollHeight-1:inner.scrollTop>0) return; }
    e.preventDefault();
    if(el._repLock&&Date.now()<el._repLock) return;
    const pages=[...el.querySelectorAll('.rep-page')], top=el.scrollTop;
    let cur=0; pages.forEach((p,i)=>{ if(p.offsetTop<=top+4) cur=i; });
    const next=Math.max(0,Math.min(pages.length-1,cur+(e.deltaY>0?1:-1)));
    el._repLock=Date.now()+650;
    if(next!==cur) reportGo(viewId,next);
  },{passive:false}); }
  el.scrollTop=keep; _reportScroll[viewId]=true;
  _reportObserver[viewId]?.disconnect?.();
  if(typeof IntersectionObserver==='function'){
    const io=new IntersectionObserver(es=>es.forEach(e=>{
      if(!e.isIntersecting) return;
      const idx=[...el.querySelectorAll('.rep-page')].indexOf(e.target);
      el.querySelectorAll('[data-rep-dot]').forEach((b,i)=>{ if(i===idx) b.setAttribute('aria-current','true'); else b.removeAttribute('aria-current'); });
    }),{root:el,threshold:0.55});
    el.querySelectorAll('.rep-page').forEach(s=>io.observe(s));
    _reportObserver[viewId]=io;
  }
}
function reportGo(viewId, idx){
  const el=document.getElementById('cb-'+viewId), page=el&&el.querySelectorAll('.rep-page')[idx];
  if(page) el.scrollTo({top:page.offsetTop,behavior:(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)?'auto':'smooth'});
}
function reportHeadPick(id,label,options,current,fn){
  return options.length?`<label class="rep-month-pick" for="${id}">${label}<select id="${id}" onchange="${fn}(this.value)">${options.map(o=>`<option value="${o.value}"${o.value===current?' selected':''}>${cbEsc(o.label)}</option>`).join('')}</select></label>`:'';
}
// 구성·손익·목표 장(월간·연간 공용). entry 가 없으면 빈 문자열.
function reportEntryChapters(id, startNo, entry, ownerF, basisBadge, flipStart){
  if(!entry) return {html:'',count:0};
  const key=ownerF||'전체', out=[]; let no=startNo, flip=flipStart;
  const cls=(entry.cls||{})[key]||{}, total=reportEntryValue(entry,ownerF)||0;
  const clsRows=REPORT_CLS_ORDER.filter(k=>cls[k]>0).map(k=>({k,v:cls[k],p:total>0?cls[k]/total*100:0})).sort((a,b)=>b.v-a.v);
  if(clsRows.length){
    const mx=Math.max(1,...clsRows.map(x=>x.p)), cash=clsRows.find(x=>x.k==='cash');
    const owners=Object.entries(entry.byOwner||{}).map(([k,v])=>({k,p:entry.total>0?v/entry.total*100:0})).sort((a,b)=>b.p-a.p);
    out.push(reportChapter(id,no++,'어디에 있는가',basisBadge,'',
      `<p>${clsRows.slice(0,2).map(x=>`${cbEsc((CB_CLS[x.k]||{}).label||x.k)} <b>${x.p.toFixed(0)}%</b>`).join(', ')} 순으로 큽니다.${cash?` 현금은 <b>${cash.p.toFixed(0)}%</b>입니다.`:''}</p>${ownerF||!owners.length?'':`<p>소유주별로는 ${owners.map(o=>`${cbEsc(o.k)} <b>${o.p.toFixed(0)}%</b>`).join(', ')}입니다.</p>`}`,
      `<div class="rep-bars">${clsRows.map(x=>reportBar((CB_CLS[x.k]||{}).label||x.k,x.p/mx*100,x.p.toFixed(1)+'%',(CB_CLS[x.k]||{}).color||'var(--acc)',cbDisp(x.v))).join('')}</div><p class="rep-cap">자산군별 비중과 평가액</p>`,flip)); flip=!flip;
  }
  return {html:out.join(''),count:out.length,flip};
}
function reportPlChapter(id,no,entry,ownerF,basisBadge,flip,extraProse){
  const pl=((entry&&entry.pl)||{})[ownerF||'전체']; if(!pl) return '';
  const hs=(entry.holdings||[]).filter(h=>(!ownerF||h.o===ownerF)&&h.g!=='cash'&&!h.u&&h.c>0).map(h=>({n:h.n,gain:h.v-h.c,pct:(h.v-h.c)/h.c})).sort((a,b)=>b.pct-a.pct);
  const top=hs.slice(0,3), bottom=hs.length>3?hs.slice(-Math.min(3,hs.length-3)):[], rank=[...top,...bottom], mx=Math.max(0.0001,...rank.map(r=>Math.abs(r.pct)));
  return reportChapter(id,no,'얼마나 불었는가',basisBadge,'',
    `<p>넣은 돈 대비 평가손익은 ${reportDiffAmt(pl.gain)}${pl.cost>0?` (<b>${reportSign(pl.gain/pl.cost*100)}</b>)`:''}입니다.</p>${extraProse||''}<p class="rep-note">현금과 취득가를 모르는 자산은 뺐습니다.</p>`,
    rank.length?`<div class="rep-bars">${rank.map(r=>reportBar(r.n,Math.abs(r.pct)/mx*100,`<span class="${r.pct<0?'rep-dn':'rep-up'}">${reportSign(r.pct*100,0)}</span>`,r.pct<0?'var(--dn)':'var(--up)',cbDisp(r.gain))).join('')}</div><p class="rep-cap">수익률 위 ${top.length}종목${bottom.length?`과 아래 ${bottom.length}종목`:''}</p>`:'<p class="rep-note">종목별 기록이 남아 있지 않은 달입니다.</p>',flip);
}
function reportDivChapter(id,no,year,ownerF,todayKey,focusIdx,flip){
  const dv=reportDividendYear(year,ownerF,todayKey), vals=dv.months.map(m=>m.v||0), sum=vals.reduce((s,v)=>s+v,0), mx=Math.max(1,...vals);
  if(!dv.recorded&&!dv.hasEst) return '';
  const f=focusIdx!=null?dv.months[focusIdx]:null;
  const recSum=dv.months.reduce((t,m)=>t+(m.kind==='rec'&&m.v?m.v:0),0), estSum=dv.months.reduce((t,m)=>t+(m.kind==='est'&&m.v?m.v:0),0);
  const yearLine=estSum>0?`${year}년은 기록 <b>${cbDisp(recSum)}</b>에 남은 달 예상 <b>${cbDisp(estSum)}</b>을 더해 <b>${cbDisp(sum)}</b>쯤입니다.`:`${year}년 현금 흐름에 기록된 배당금은 모두 <b>${cbDisp(sum)}</b>입니다.`;
  const lead=f?(f.v==null?`<p>${focusIdx+1}월 배당금은 현금 흐름에 기록이 없습니다. ${yearLine}</p>`
    :`<p>${focusIdx+1}월 배당금은 ${f.kind==='est'?`<b>${cbDisp(f.v)}</b>쯤으로 예상합니다`:`현금 흐름에 <b>${cbDisp(f.v)}</b> 기록돼 있습니다`}. ${yearLine}</p>`):`<p>${yearLine}</p>`;
  return reportChapter(id,no,'배당',`<span class="rep-badge is-now">${year}년</span>`,'is-soft',
    `${lead}<p class="rep-note">끝난 달은 현금 흐름에 기록된 배당금 수입이라, 기록하지 않은 달은 0으로 보입니다. 이번 달부터는 과거 지급 주기와 지금 보유 수량으로 계산한 세후 추정이며 확정된 지급이 아닙니다.</p>`,
    `<div class="rep-months" role="img" aria-label="${year}년 월별 배당">${dv.months.map((m,i)=>`<i class="${i===focusIdx?'is-cur ':''}${m.kind==='est'?'is-est':''}" style="--h:${((m.v||0)/mx*100).toFixed(1)}%" title="${i+1}월"></i>`).join('')}</div><div class="rep-months-l" aria-hidden="true">${dv.months.map((_,i)=>`<span class="${i===focusIdx?'is-cur':''}">${i+1}</span>`).join('')}</div><p class="rep-cap">월별 배당 · 빗금은 예상</p>`,flip);
}
function reportGoalChapter(id,no,entry,basisBadge){
  const goals=((entry&&entry.goals)||[]).map(g=>({...g,p:g.target>0?Math.min(100,Math.max(0,g.now)/g.target*100):0}));
  if(!goals.length) return '';
  const done=goals.filter(g=>g.p>=100).length;
  return reportChapter(id,no,'목표까지',basisBadge,'is-ink',
    `<p>목표 ${goals.length}개 가운데 <b>${done}개</b>를 채웠습니다.</p><p class="rep-note">목표는 가족이 함께 쓰는 값이라 소유주를 바꿔도 같습니다. 고치려면 투자 계획 &gt; 목표로 갑니다.</p>`,
    `<div class="rep-goals">${goals.map(g=>`<div><h3><span>${cbEsc(g.name)}</span><span>${g.p.toFixed(0)}%</span></h3><i style="--p:${g.p.toFixed(1)}%"></i><p>${g.p>=100?'목표 금액을 채웠습니다.':`${cbDisp(g.now)} / ${cbDisp(g.target)}`}</p></div>`).join('')}</div>`);
}

// ── 월간 ──
function cbRenderReport(){
  const el=document.getElementById('cb-report2'); if(!el) return;
  const ownerF=finOwnerF(_reportOwner), todayKey=finLocalDateKey(new Date()), curYm=todayKey.slice(0,7);
  const tl=reportTimeline(ownerF,todayKey), who=ownerF?cbEsc(ownerF):'가족 전체';
  const ym=tl.some(m=>m.ym===_reportYm)?_reportYm:reportDefaultYm(tl,todayKey);
  const idx=tl.findIndex(m=>m.ym===ym), cur=idx>=0?tl[idx]:null, prev=idx>0?tl[idx-1]:null;
  // 달 선택 목록에서 보유 변화가 있었던 달에 점을 찍는다.
  const changed=new Set(); tl.forEach((m,i)=>{ const p=tl[i-1]; if(!p||!m.entry||!p.entry) return; const d=reportHoldingDiff(p.entry.holdings,m.entry.holdings,ownerF); if(d&&d.trades) changed.add(m.ym); });
  cbSetHead('한 달을 장으로 나눠 돌아봅니다 · 조회 전용 · 지난 달은 월말 종가 기준 기록입니다',
    cbOwnerBtns(_reportOwner,'reportOwner')+reportHeadPick('rep-month','결산 달',tl.slice().reverse().map(m=>({value:m.ym,label:reportYmLabel(m.ym)+(m.ym===curYm?' (진행 중)':'')+(changed.has(m.ym)?' ●':'')})),ym,'reportMonth'));
  if(!cur){
    el.classList.remove('rep-scroll');
    el.innerHTML=`<div class="cb-panel"><div class="fin-empty">${who}의 결산 기록이 아직 없습니다. 보유 자산을 등록하면 이번 달부터 볼 수 있고, 월말 기록은 매일 자동으로 남습니다.</div></div>`;
    return;
  }
  const live=cur.src==='live', mLabel=reportYmLabel(cur.ym), mShort=Number(cur.ym.slice(5))+'월', day=Number(cur.date.slice(8));
  const basis=live?'<span class="rep-badge is-now">진행 중 · 오늘 기준</span>':`<span class="rep-badge">${mShort} ${day}일 종가 기준</span>`;
  const adjacent=prev&&reportYmNext(prev.ym)===cur.ym;
  const prevLine=prev?`${adjacent?(live?'지난달 말':'한 달 전')+'보다':reportYmLabel(prev.ym)+' 말보다'} ${reportDiffAmt(cur.v-prev.v)} ${cur.v-prev.v<0?'줄었습니다':'늘었습니다'}.`:'비교할 앞 달 기록이 없습니다.';
  const yearFirst=tl.find(m=>m.ym.slice(0,4)===cur.ym.slice(0,4));
  const yLine=(yearFirst&&yearFirst.ym!==cur.ym)?` ${cur.ym.slice(0,4)}년 첫 기록(${Number(yearFirst.ym.slice(5))}월)보다는 ${reportDiffAmt(cur.v-yearFirst.v)}입니다.`:'';
  const pages=[];
  pages.push(`<section class="rep-page rep-cover" data-rep-page="표지"><div class="rep-inner"><p class="rep-kicker">${who} · 월간 결산</p><h1>${mLabel}</h1>
    <p>${live?'아직 끝나지 않은 달이라 오늘 기준으로 보여 줍니다. 보유 종목을 고치면 바로 반영됩니다.':`${mShort} ${day}일 종가 기준 기록입니다.`}</p><p class="rep-scroll-hint" aria-hidden="true">아래로 스크롤하면 다음 장으로 넘어갑니다</p></div></section>`);
  let no=1, flip=false;
  pages.push(reportChapter('rep',no++,'얼마인가',basis,'is-ink',
    `<p>${live?'오늘':mLabel+' 말'} ${who}의 투자자산은 <b>${cbDisp(cur.v)}</b>입니다. ${prevLine}${yLine}</p><p class="rep-note">새로 넣은 돈과 값이 오른 몫이 함께 들어 있어 수익률이 아닙니다.</p>`,
    `<p class="rep-fig">${cbDisp(cur.v)}</p>${reportTrendSvg(tl.slice(0,idx+1).slice(-12))||'<p class="rep-note">두 달 이상 쌓이면 추이 선을 그립니다.</p>'}<p class="rep-cap">월말 투자자산 · 기록이 있는 달만</p>`));
  if(!cur.entry){
    pages.push(`<section class="rep-page rep-chapter" data-rep-page="기록 없음"><div class="rep-inner is-single"><div class="rep-prose"><h2>이 달은 총액만 남아 있습니다</h2><p>구성·보유 변화·손익·목표는 월말 기록을 남기기 시작한 뒤의 달부터 볼 수 있습니다. 지난 달의 구성을 오늘 보유로 대신 보여 주지 않습니다.</p></div></div></section>`);
  } else {
    flip=true;
    const comp=reportEntryChapters('rep',no,cur.entry,ownerF,basis,flip); pages.push(comp.html); no+=comp.count; if(comp.count) flip=!flip;
    // 무엇이 달라졌나
    const prevEntry=prev&&prev.entry, diff=prevEntry?reportHoldingDiff(prevEntry.holdings,cur.entry.holdings,ownerF):null;
    pages.push(reportChapter('rep',no++,'무엇이 달라졌나',diff?`<span class="rep-badge">${reportYmLabel(prev.ym)} 말과 비교</span>`:'','is-soft',
      diff?`<p>${diff.trades?`보유 종목 <b>${diff.trades}건</b>이 바뀌었습니다.`:'사고판 종목은 없었습니다.'} 평가액 변화 ${reportDiffAmt(diff.change)}를 둘로 나누면 아래와 같습니다.</p>${reportSplitBars(diff)}<p class="rep-note">거래 기록이 아니라 두 시점의 보유를 견준 추정입니다. 종목 수정은 입력한 달에 잡힙니다. 취득가를 모르는 자산을 더하면 값이 오른 몫으로 잡힙니다.</p>`
          :`<p>비교할 앞 달의 종목 기록이 없어 변화를 계산하지 않았습니다.</p><p class="rep-note">다음 달부터는 이 달과 견주어 새로 담은 종목, 더 사거나 줄인 종목, 모두 판 종목을 보여 줍니다.</p>`,
      diff?reportDiffHtml(diff,10):`<p class="rep-cap">현재 ${(cur.entry.holdings||[]).filter(h=>!ownerF||h.o===ownerF).length}종목 보유</p>`,flip)); flip=!flip;
    const plc=reportPlChapter('rep',no,cur.entry,ownerF,basis,flip,'<p class="rep-note">팔아서 확정한 손익은 세금·증여 화면에 따로 있습니다.</p>'); if(plc){ pages.push(plc); no++; flip=!flip; }
  }
  const dvc=reportDivChapter('rep',no,cur.ym.slice(0,4),ownerF,todayKey,Number(cur.ym.slice(5))-1,flip); if(dvc){ pages.push(dvc); no++; }
  if(cur.entry){ const gc=reportGoalChapter('rep',no,cur.entry,live?'<span class="rep-badge is-now">오늘 기준 · 가구 전체</span>':`<span class="rep-badge">${mShort} ${day}일 기준 · 가구 전체</span>`); if(gc) pages.push(gc); }
  reportMount('report2',pages.join(''));
}

// ── 연간 ──
function cbRenderReportYear(){
  const el=document.getElementById('cb-reporty'); if(!el) return;
  const ownerF=finOwnerF(_reportOwner), todayKey=finLocalDateKey(new Date()), curY=todayKey.slice(0,4);
  const tl=reportTimeline(ownerF,todayKey), who=ownerF?cbEsc(ownerF):'가족 전체';
  const years=[...new Set(tl.map(m=>m.ym.slice(0,4)))].sort();
  // 기본 해: 올해(진행 중). 1월에는 아직 볼 것이 없으므로 지난해.
  const prefer=todayKey.slice(5,7)==='01'?String(Number(curY)-1):curY;
  const year=years.includes(_reportYear)?_reportYear:(years.includes(prefer)?prefer:(years[years.length-1]||null));
  cbSetHead('한 해를 장으로 나눠 돌아봅니다 · 조회 전용 · 지난 달은 월말 종가 기준 기록입니다',
    cbOwnerBtns(_reportOwner,'reportOwner')+reportHeadPick('rep-year','결산 해',years.slice().reverse().map(y=>({value:y,label:y+'년'+(y===curY?' (진행 중)':'')})),year,'reportYear'));
  if(!year){
    el.classList.remove('rep-scroll');
    el.innerHTML=`<div class="cb-panel"><div class="fin-empty">${who}의 결산 기록이 아직 없습니다.</div></div>`;
    return;
  }
  const inYear=tl.filter(m=>m.ym.slice(0,4)===year), last=inYear[inYear.length-1], first=inYear[0];
  const base=tl.filter(m=>m.ym<year+'-01').pop()||null;           // 전년 마지막 기록(있으면 연초 기준)
  const start=base||first, ongoing=year===curY, lastM=Number(last.ym.slice(5));
  const basis=ongoing?`<span class="rep-badge is-now">${lastM}월까지 · 진행 중</span>`:`<span class="rep-badge">${lastM}월 ${Number(last.date.slice(8))}일 종가 기준</span>`;
  const pages=[];
  pages.push(`<section class="rep-page rep-cover" data-rep-page="표지"><div class="rep-inner"><p class="rep-kicker">${who} · 연간 결산</p><h1>${year}년</h1>
    <p>${ongoing?`아직 끝나지 않은 해라 ${lastM}월까지의 기록으로 보여 줍니다.`:`${year}년 ${lastM}월 말 기록까지의 한 해입니다.`} 기록이 있는 달은 ${inYear.length}개입니다.</p><p class="rep-scroll-hint" aria-hidden="true">아래로 스크롤하면 다음 장으로 넘어갑니다</p></div></section>`);
  let no=1, flip=false;
  const byM=new Map(inYear.map(m=>[Number(m.ym.slice(5)),m])), mx=Math.max(1,...inYear.map(m=>m.v));
  const grew=last.v-start.v;
  pages.push(reportChapter('repy',no++,'한 해 동안 얼마나 늘었나',basis,'is-ink',
    `<p>${start===last?`기록이 한 달뿐이라 비교할 수 없습니다. ${reportYmLabel(last.ym)} 말 투자자산은 <b>${cbDisp(last.v)}</b>입니다.`:`${base?reportYmLabel(base.ym)+' 말':reportYmLabel(first.ym)+' 말(그해 첫 기록)'} <b>${cbDisp(start.v)}</b>에서 ${reportYmLabel(last.ym)} 말 <b>${cbDisp(last.v)}</b>로, ${reportDiffAmt(grew)} ${grew<0?'줄었습니다':'늘었습니다'}.`}</p><p class="rep-note">새로 넣은 돈과 값이 오른 몫이 함께 들어 있어 수익률이 아닙니다.</p>`,
    `<p class="rep-fig">${cbDisp(last.v)}</p><div class="rep-months is-total" role="img" aria-label="${year}년 월말 투자자산">${Array.from({length:12},(_,i)=>{const m=byM.get(i+1);return `<i class="${m?(m.src==='live'?'is-est':''):'is-none'}" style="--h:${m?(m.v/mx*100).toFixed(1):0}%" title="${i+1}월"></i>`;}).join('')}</div><div class="rep-months-l" aria-hidden="true">${Array.from({length:12},(_,i)=>`<span>${i+1}</span>`).join('')}</div><p class="rep-cap">월말 투자자산 · 빈칸은 기록이 없는 달</p>`));
  const lastEntry=inYear.slice().reverse().find(m=>m.entry), entry=lastEntry&&lastEntry.entry;
  if(!entry){
    pages.push(`<section class="rep-page rep-chapter" data-rep-page="기록 없음"><div class="rep-inner is-single"><div class="rep-prose"><h2>이 해는 총액만 남아 있습니다</h2><p>구성·보유 변화·손익·목표는 월말 기록을 남기기 시작한 뒤부터 볼 수 있습니다.</p></div></div></section>`);
  } else {
    const eBadge=lastEntry.src==='live'?'<span class="rep-badge is-now">오늘 기준</span>':`<span class="rep-badge">${Number(lastEntry.ym.slice(5))}월 ${Number(lastEntry.date.slice(8))}일 종가 기준</span>`;
    flip=true;
    const comp=reportEntryChapters('repy',no,entry,ownerF,eBadge,flip); pages.push(comp.html.replace(/어디에 있는가/g,'어디에 있었나')); no+=comp.count; if(comp.count) flip=!flip;
    // 무엇이 달라졌나 — 그해 기준 시점(전년 말 또는 그해 첫 종목 기록) 대비 + 달별 변화 건수
    const withEntry=tl.filter(m=>m.entry), baseEntry=(withEntry.filter(m=>m.ym<year+'-01').pop()||withEntry.find(m=>m.ym.slice(0,4)===year));
    const diff=(baseEntry&&baseEntry!==lastEntry)?reportHoldingDiff(baseEntry.entry.holdings,entry.holdings,ownerF):null;
    const perMonth=Array(12).fill(null); withEntry.forEach((m,i)=>{ if(m.ym.slice(0,4)!==year) return; const p=withEntry[i-1]; if(!p) return; const d=reportHoldingDiff(p.entry.holdings,m.entry.holdings,ownerF); perMonth[Number(m.ym.slice(5))-1]=d?d.trades:null; });
    const strip=`<div class="rep-strip" role="img" aria-label="달별 보유 변화 건수">${perMonth.map((n,i)=>`<span class="${n==null?'is-none':n?'is-on':''}"><b>${n==null?'·':n}</b><small>${i+1}월</small></span>`).join('')}</div>`;
    pages.push(reportChapter('repy',no++,'무엇이 달라졌나',diff?`<span class="rep-badge">${reportYmLabel(baseEntry.ym)} 말과 비교</span>`:'','is-soft',
      diff?`<p>${reportYmLabel(baseEntry.ym)} 말과 견주면 보유 종목 <b>${diff.trades}건</b>이 달라졌습니다.</p>${reportSplitBars(diff)}${strip}<p class="rep-note">숫자는 그 달에 바뀐 종목 수이고 점은 비교할 기록이 없는 달입니다. 거래 기록이 아니라 월말 보유를 견준 추정입니다.</p>`
          :`<p>비교할 앞선 종목 기록이 없어 변화를 계산하지 않았습니다.</p>${strip}`,
      diff?reportDiffHtml(diff,10):'<p class="rep-cap">다음 달 기록부터 변화가 쌓입니다.</p>',flip)); flip=!flip;
    const rz=reportRealizedYear(year,ownerF);
    const plc=reportPlChapter('repy',no,entry,ownerF,eBadge,flip,`<p>팔아서 확정한 실현손익은 ${rz.count?`${reportDiffAmt(rz.sum)} (기록 ${rz.count}건)`:'기록이 없습니다'}${rz.count?'입니다':''}.</p>`); if(plc){ pages.push(plc.replace(/얼마나 불었는가/g,'평가손익과 실현손익')); no++; flip=!flip; }
  }
  const dvc=reportDivChapter('repy',no,year,ownerF,todayKey,null,flip); if(dvc){ pages.push(dvc); no++; }
  if(entry){ const gc=reportGoalChapter('repy',no,entry,(lastEntry.src==='live'?'<span class="rep-badge is-now">오늘 기준 · 가구 전체</span>':`<span class="rep-badge">${Number(lastEntry.ym.slice(5))}월 말 기준 · 가구 전체</span>`)); if(gc) pages.push(gc); }
  reportMount('reporty',pages.join(''));
}
