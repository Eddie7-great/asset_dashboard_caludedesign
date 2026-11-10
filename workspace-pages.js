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
