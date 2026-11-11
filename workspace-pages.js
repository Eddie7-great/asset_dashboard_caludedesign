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

// ───────────────────────── 월간 결산 (투자 분석 > report2) ─────────────────────────
// 조회 전용. 새 계산을 만들지 않는다 — 월말 금액은 저장된 일별 기록(finSnapshotInvestment·finSnapshotOwnerInvestment),
// 구성·손익은 cbRow(finRows), 배당은 배당 엔진이 채운 divHistoryOf(세후), 목표는 finGoalCurrent 의 값을 읽어 한 달 단위로 묶는다.
// 과거 달을 골라도 구성·손익·목표는 오늘 보유 기준이므로 장마다 '○월 말 기록' / '오늘 기준' 배지로 구분한다.
let _reportOwner='전체', _reportYm=null;
function reportOwner(o){ _reportOwner=o; cbRenderReport(); cbRestoreFilterFocus('cb-head-widgets','data-owner',o); }
function reportMonth(ym){ _reportYm=ym; cbRenderReport(); document.getElementById('rep-month')?.focus(); }
// 월말 값 목록: 그달의 마지막 기록. 기록이 없는 달은 만들지 않는다(지어내지 않는다).
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
// 기본 달: 이미 끝난 달 가운데 가장 최근. 끝난 달 기록이 없으면 가장 최근 달.
function reportDefaultYm(months, todayKey){
  if(!months.length) return null;
  const cur=String(todayKey).slice(0,7), done=months.filter(m=>m.ym<cur);
  return (done.length?done[done.length-1]:months[months.length-1]).ym;
}
function reportYmLabel(ym){ const [y,m]=String(ym).split('-'); return `${y}년 ${Number(m)}월`; }
function reportData(ownerF, ym, todayKey){
  const months=reportMonthEnds(window._netWorthHistory, ownerF);
  const pick=months.some(m=>m.ym===ym)?ym:reportDefaultYm(months,todayKey);
  const idx=months.findIndex(m=>m.ym===pick), cur=idx>=0?months[idx]:null, prev=idx>0?months[idx-1]:null;
  const yearFirst=cur?months.find(m=>m.ym.slice(0,4)===cur.ym.slice(0,4)):null;
  const rows=finRows(ownerF), total=rows.reduce((s,r)=>s+r.val,0);
  const clsMap=new Map(), ownMap=new Map();
  rows.forEach(r=>{ clsMap.set(r.cls,(clsMap.get(r.cls)||0)+r.val); const o=r.i.owner||'—'; ownMap.set(o,(ownMap.get(o)||0)+r.val); });
  const share=(map)=>Array.from(map.entries()).map(([k,v])=>({k,v,p:total>0?v/total*100:0})).sort((a,b)=>b.v-a.v);
  // 현금과 취득가 미상은 손익에서 뺀다(보유 목록 숫자 카드와 같은 기준).
  const inv=rows.filter(r=>r.i.grp!=='현금'&&!r.i.costUnknown&&r.gainPct!=null);
  const cost=inv.reduce((s,r)=>s+r.cost,0), gain=inv.reduce((s,r)=>s+r.gain,0);
  const ranked=inv.slice().sort((a,b)=>b.gainPct-a.gainPct);
  const top=ranked.slice(0,3), bottom=ranked.length>3?ranked.slice(-Math.min(3,ranked.length-3)):[];
  const year=cur?cur.ym.slice(0,4):String(todayKey).slice(0,4);
  const divs=(typeof divHistoryYears==='function'&&divHistoryYears().map(String).includes(year))?divHistoryOf(year,ownerF||'전체').map(v=>Number(v)||0):null;
  const goals=(Array.isArray(goalData)?goalData:[]).map(g=>{
    const now=Math.max(0,Number(finGoalCurrent(g))||0), target=Number(g.targetAmount)||0;
    return {name:g.name||'목표',now,target,p:target>0?Math.min(100,now/target*100):0};
  });
  return {months,cur,prev,yearFirst,rows,total,byCls:share(clsMap),byOwner:share(ownMap),cost,gain,gainPct:cost>0?gain/cost:null,top,bottom,year,divs,goals,
    prevAdjacent:!!(cur&&prev&&reportYmNext(prev.ym)===cur.ym)};
}
function reportYmNext(ym){ const [y,m]=ym.split('-').map(Number); return m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,'0')}`; }
function reportTrendSvg(months, curYm){
  const upto=months.filter(m=>m.ym<=curYm).slice(-12);
  if(upto.length<2) return '';
  const w=520,h=190,pad=14,vals=upto.map(m=>m.v),mn=Math.min(...vals),mx=Math.max(...vals),span=mx-mn||1;
  const pts=upto.map((m,i)=>[pad+i*(w-2*pad)/(upto.length-1),h-30-(m.v-mn)/span*(h-30-pad)]);
  const d=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  const a=upto[0],z=upto[upto.length-1];
  return `<svg class="rep-trend" viewBox="0 0 ${w} ${h}" role="img" aria-label="${reportYmLabel(a.ym)} 말부터 ${reportYmLabel(z.ym)} 말까지 월말 투자자산 추이">
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${pts.map((p,i)=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${i===pts.length-1?5.5:2.8}" fill="currentColor"/>`).join('')}
    <text x="${pts[0][0]}" y="${h-6}" font-size="12" fill="currentColor">${Number(a.ym.slice(5))}월</text>
    <text x="${pts[pts.length-1][0]}" y="${h-6}" font-size="12" fill="currentColor" text-anchor="end">${Number(z.ym.slice(5))}월</text></svg>`;
}
function cbRenderReport(){
  const el=document.getElementById('cb-report2'); if(!el) return;
  const ownerF=finOwnerF(_reportOwner), todayKey=finLocalDateKey(new Date());
  const D=reportData(ownerF,_reportYm,todayKey), who=ownerF?cbEsc(ownerF):'가족 전체';
  const monthSel=D.months.length?`<label class="rep-month-pick" for="rep-month">결산 달<select id="rep-month" onchange="reportMonth(this.value)">${D.months.slice().reverse().map(m=>`<option value="${m.ym}"${D.cur&&m.ym===D.cur.ym?' selected':''}>${reportYmLabel(m.ym)}</option>`).join('')}</select></label>`:'';
  cbSetHead('한 달을 다섯 장으로 돌아봅니다 · 조회 전용이며 기록·보유 자산을 바꾸지 않습니다',cbOwnerBtns(_reportOwner,'reportOwner')+monthSel);
  if(!D.cur){
    el.innerHTML=`<div class="cb-panel"><div class="fin-empty">${who}의 월말 기록이 아직 없습니다. 투자자산 기록은 매일 자동으로 쌓이며, 한 달이 지나면 이 화면에서 결산을 볼 수 있습니다.</div></div>`;
    return;
  }
  const mLabel=reportYmLabel(D.cur.ym), mShort=Number(D.cur.ym.slice(5))+'월';
  const recBadge=`<span class="rep-badge">${mShort} 말 기록</span>`, nowBadge=`<span class="rep-badge is-now">오늘 기준</span>`;
  const diff=(v)=>`<b class="${v<0?'rep-dn':'rep-up'}">${v>0?'+':''}${cbDisp(v)}</b>`;
  const sign=(p,d=1)=>(p>0?'+':'')+p.toFixed(d)+'%';
  const chapter=(no,title,badge,cls,prose,figure,flip)=>`<section class="rep-chapter cb-panel ${cls||''}${flip?' is-flip':''}" aria-labelledby="rep-h${no}">
      <div class="rep-prose"><p class="rep-no">${no}장</p><h2 id="rep-h${no}">${title} ${badge}</h2>${prose}</div>
      <div class="rep-figure">${figure}</div></section>`;
  // 1장 — 얼마인가
  const prevLine=D.prev
    ? `${D.prevAdjacent?'한 달 전':reportYmLabel(D.prev.ym)+' 말'}보다 ${diff(D.cur.v-D.prev.v)} ${D.cur.v-D.prev.v<0?'줄었습니다':'늘었습니다'}.`
    : '이 달이 첫 기록이라 비교할 앞 달이 없습니다.';
  const yLine=(D.yearFirst&&D.yearFirst.ym!==D.cur.ym)?` ${D.cur.ym.slice(0,4)}년 첫 기록(${Number(D.yearFirst.ym.slice(5))}월 말)보다는 ${diff(D.cur.v-D.yearFirst.v)}입니다.`:'';
  const c1=chapter(1,'얼마인가',recBadge,'is-ink',
    `<p>${mLabel} 말 ${who}의 투자자산은 <b>${cbDisp(D.cur.v)}</b>입니다. ${prevLine}${yLine}</p><p class="rep-note">새로 넣은 돈과 값이 오른 몫이 함께 들어 있어 수익률이 아닙니다. 마지막 기록일은 ${cbEsc(D.cur.date)}입니다.</p>`,
    `<p class="rep-fig">${cbDisp(D.cur.v)}</p>${reportTrendSvg(D.months,D.cur.ym)||'<p class="rep-note">월말 기록이 두 달 이상 쌓이면 추이 선을 그립니다.</p>'}<p class="rep-cap">월말 투자자산 · 기록이 있는 달만</p>`);
  // 2장 — 어디에 있는가
  const bar=(label,width,shown,color,amount)=>`<div class="rep-bar"><span>${cbEsc(label)}</span><i style="--p:${Math.max(0,Math.min(100,width)).toFixed(1)}%;--c:${color}"></i><b>${shown.toFixed(1)}%</b><em>${cbDisp(amount)}</em></div>`;
  const maxCls=Math.max(1,...D.byCls.map(x=>x.p));
  const cash=D.byCls.find(x=>x.k==='cash');
  const c2=D.rows.length?chapter(2,'어디에 있는가',nowBadge,'',
    `<p>${D.byCls.slice(0,2).map(x=>`${cbEsc((CB_CLS[x.k]||{}).label||x.k)} <b>${x.p.toFixed(0)}%</b>`).join(', ')} 순으로 큽니다.${cash?` 현금은 <b>${cash.p.toFixed(0)}%</b>입니다.`:''}</p>${ownerF?'':`<p>소유주별로는 ${D.byOwner.map(o=>`${cbEsc(o.k)} <b>${o.p.toFixed(0)}%</b>`).join(', ')}입니다.</p>`}<p class="rep-note">지난달 말의 구성은 기록에 없어 오늘 보유한 자산으로 보여 줍니다.</p>`,
    `<div class="rep-bars">${D.byCls.map(x=>bar((CB_CLS[x.k]||{}).label||x.k,x.p/maxCls*100,x.p,(CB_CLS[x.k]||{}).color||'var(--acc)',x.v)).join('')}</div><p class="rep-cap">자산군별 비중과 평가액</p>`,true):'';
  // 3장 — 얼마나 불었는가
  const rank=[...D.top,...D.bottom], maxPct=Math.max(0.0001,...rank.map(r=>Math.abs(r.gainPct)));
  const c3=rank.length?chapter(3,'얼마나 불었는가',nowBadge,'',
    `<p>넣은 돈 대비 지금까지의 평가손익은 ${diff(D.gain)}${D.gainPct==null?'':` (<b>${sign(D.gainPct*100)}</b>)`}입니다.</p><p class="rep-note">현금과 취득가를 모르는 자산은 뺐습니다. 팔아서 확정한 손익은 세금·증여 화면에 따로 있습니다.</p>`,
    `<div class="rep-bars">${rank.map(r=>`<div class="rep-bar"><span>${cbEsc(r.title)}</span><i style="--p:${(Math.abs(r.gainPct)/maxPct*100).toFixed(1)}%;--c:${r.gainPct<0?'var(--dn)':'var(--up)'}"></i><b class="${r.gainPct<0?'rep-dn':'rep-up'}">${sign(r.gainPct*100,0)}</b><em>${cbDisp(r.gain)}</em></div>`).join('')}</div><p class="rep-cap">수익률 위 ${D.top.length}종목${D.bottom.length?`과 아래 ${D.bottom.length}종목`:''}</p>`):'';
  // 4장 — 배당 (배당 화면과 같은 세후 값)
  let c4='';
  if(D.divs){
    const mi=Number(D.cur.ym.slice(5))-1, sum=D.divs.reduce((s,v)=>s+v,0), mxD=Math.max(1,...D.divs);
    c4=chapter(4,'배당',`<span class="rep-badge is-now">${D.year}년 추정</span>`,'',
      sum>0?`<p>${mShort} 배당은 세금을 뗀 뒤 <b>${cbDisp(D.divs[mi])}</b>, ${D.year}년 한 해는 <b>${cbDisp(sum)}</b>쯤입니다.</p><p class="rep-note">과거 지급 주기와 오늘 보유 수량으로 계산한 추정이며 확정된 지급이 아닙니다. 값은 배당 화면과 같습니다.</p>`
           :`<p>${D.year}년에 잡힌 배당이 없습니다.</p><p class="rep-note">배당 정보를 아직 불러오지 못했다면 배당 화면에서 다시 확인해 주세요.</p>`,
      `<div class="rep-months" role="img" aria-label="${D.year}년 월별 배당">${D.divs.map((v,i)=>`<i class="${i===mi?'is-cur':''}" style="--h:${(v/mxD*100).toFixed(1)}%" title="${i+1}월"></i>`).join('')}</div><div class="rep-months-l" aria-hidden="true">${D.divs.map((_,i)=>`<span class="${i===mi?'is-cur':''}">${i+1}</span>`).join('')}</div><p class="rep-cap">월별 배당(세후 추정) · 진한 막대가 ${mShort}</p>`,true);
  }
  // 5장 — 목표까지 (목표는 가구 공통)
  const done=D.goals.filter(g=>g.p>=100).length;
  const c5=D.goals.length?chapter(5,'목표까지','<span class="rep-badge is-now">오늘 기준 · 가구 전체</span>','is-ink',
    `<p>목표 ${D.goals.length}개 가운데 <b>${done}개</b>를 채웠습니다.</p><p class="rep-note">목표는 가족이 함께 쓰는 값이라 소유주를 바꿔도 같습니다. 고치려면 투자 계획 &gt; 목표로 갑니다.</p>`,
    `<div class="rep-goals">${D.goals.map(g=>`<div><h3><span>${cbEsc(g.name)}</span><span>${g.p.toFixed(0)}%</span></h3><i style="--p:${g.p.toFixed(1)}%"></i><p>${g.p>=100?'목표 금액을 채웠습니다.':`${cbDisp(g.now)} / ${cbDisp(g.target)}`}</p></div>`).join('')}</div>`):'';
  el.innerHTML=`<div class="rep">
    <header class="rep-cover"><p class="rep-kicker">${who} · 월간 결산</p><h1>${mLabel}</h1>
      <p>얼마인지, 어디에 있는지, 얼마나 불었는지, 배당은 얼마나 들어오는지, 목표까지 얼마나 남았는지 차례로 봅니다.</p></header>
    ${c1}${c2}${c3}${c4}${c5}
    <footer class="rep-colophon">1장은 저장된 일별 기록의 월말 값이고, 나머지 장은 오늘 보유한 자산으로 계산합니다. 숫자는 각 화면(성과·보유 목록·배당·목표)과 같은 계산을 씁니다.</footer></div>`;
}
