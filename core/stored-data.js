// core/stored-data.js — 저장값 정리 — 불러온 값의 형식 검사(_normalize*), 대출 상환 일정
// (2026-11-23 script.js 에서 그대로 옮겨 나눈 조각. 로드 순서는 index.html·scripts/tests/_source.mjs)
const CF_DEFAULT = [
  {date:'2026-03-27',type:'지출',cat:'식비',desc:'점심식사',amt:24500},
  {date:'2026-03-26',type:'지출',cat:'주거/통신',desc:'인터넷 요금',amt:38000},
  {date:'2026-03-25',type:'수입',cat:'급여',desc:'3월 정기 급여',amt:4500000},
  {date:'2026-03-24',type:'지출',cat:'교통/차량',desc:'주유',amt:70000},
  {date:'2026-02-15',type:'지출',cat:'식비',desc:'회식',amt:50000},
  {date:'2026-01-20',type:'지출',cat:'문화/생활',desc:'가족 나들이',amt:150000},
  {date:'2025-12-25',type:'지출',cat:'기타',desc:'크리스마스 선물',amt:200000},
  {date:'2025-11-15',type:'수입',cat:'기타',desc:'연말정산 환급금',amt:350000}
];
const _STORED_TEXT_LIMIT=160;
function _boundedStoredText(value,max=_STORED_TEXT_LIMIT){
  const text=String(value==null?'':value)
    .replace(/[\u0000-\u001f\u007f<>]/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,Math.max(0,Number(max)||0));
  return /^(?:__proto__|prototype|constructor)$/i.test(text)?'':text;
}
function _safeStoredNumber(value,{min=-Number.MAX_SAFE_INTEGER,max=Number.MAX_SAFE_INTEGER,fallback=0}={}){
  const parsed=Number(value);
  if(!Number.isFinite(parsed))return fallback;
  return Math.min(max,Math.max(min,parsed));
}
function _safeStoredId(value){
  const parsed=Number(value);
  return Number.isSafeInteger(parsed)&&parsed>0?parsed:null;
}
function _isStoredDateKey(value,allowMonth=false){
  const text=String(value||'');
  const match=text.match(allowMonth?/^(\d{4})-(\d{2})$/:/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match)return false;
  const year=Number(match[1]),month=Number(match[2]),day=allowMonth?1:Number(match[3]);
  const date=new Date(Date.UTC(year,month-1,day));
  return year>=1900&&year<=2200&&date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
}
function _normalizeStoredOwner(value,{allowAll=false}={}){
  const owner=_boundedStoredText(value,24);
  return OWNERS.includes(owner)||(allowAll&&owner==='전체')?owner:'미지정';
}
function _normalizeCfRows(rows){
  if(!Array.isArray(rows))return [];
  return rows.slice(0,10000).map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))return null;
    const rawDate=String(item.date||'');
    const date=rawDate==='미정'?'미정':(_isStoredDateKey(rawDate)?rawDate:'미정');
    const row={
      date,
      type:item.type==='수입'?'수입':'지출',
      cat:_boundedStoredText(item.cat||'기타',48)||'기타',
      desc:_boundedStoredText(item.desc,240),
      amt:_safeStoredNumber(item.amt,{min:0,max:1_000_000_000_000}),
      owner:_normalizeStoredOwner(item.owner),
    };
    const atId=_safeStoredId(item.atId);
    if(atId!==null)row.atId=atId;
    if(item.isAuto===true)row.isAuto=true;
    const scheduleMonth=String(item.scheduleMonth||'');
    if(_isStoredDateKey(scheduleMonth,true))row.scheduleMonth=scheduleMonth;
    const cycleLabel=_boundedStoredText(item.cycleLabel,48);
    if(cycleLabel)row.cycleLabel=cycleLabel;
    const divKey=_boundedStoredText(item.divKey,220);
    if(divKey)row.divKey=divKey;
    if(item.dateStatus==='pending')row.dateStatus='pending';
    // 증여 연동(2026-11-18 4차): 기록장 수기 기록에서 만든 줄(giftRecId), 증여 연결 자동이체의 지난 달을 채운 줄(giftBackfill)
    const giftRecId=_boundedStoredText(item.giftRecId,60);
    if(giftRecId)row.giftRecId=giftRecId;
    if(item.giftBackfill===true)row.giftBackfill=true;
    // 부부 송금(2026-11-23): 아내 → 본인 송금 한 건이 만드는 줄(in·out)과 아내 지출 추정 줄(est). 같은 달 묶음 키는 xferMonth
    const xferMonth=String(item.xferMonth||'');
    if(/^\d{4}-\d{2}$/.test(xferMonth)&&['in','out','est'].includes(item.xferRole)){row.xferMonth=xferMonth;row.xferRole=item.xferRole;}
    return row;
  }).filter(Boolean);
}
// ── 대출 상환 일정(2026-11-18 4차) ──
// 고정비의 '대출납입금' 자동이체에 상환 조건(at.loan = {method, principal, rate, months, start})을 붙이면
// 매달 납입액을 이 일정에서 꺼낸다(_effectiveAutoTransferAmt 가 위임 — 금액의 단일 출처는 그대로 하나다).
// 월 이자 = 직전 잔액 × 연 금리 ÷ 12(원 단위 반올림). 은행의 일할 계산과 몇 원~몇 천 원 다를 수 있는 추정값이고,
// 금리가 바뀌면 바뀐 금리로 처음부터 다시 계산한다(변동금리의 과거 이력은 담지 않는다).
const LOAN_METHOD_LABEL={annuity:'원리금균등',principal:'원금균등',bullet:'만기일시'};
const _loanScheduleCache=new Map();
function _loanMonthIndex(loan,y,m){ const [sy,sm]=String(loan&&loan.start||'').split('-').map(Number); return (y-sy)*12+(m-sm); }
function _loanYm(start,i){ const [sy,sm]=String(start).split('-').map(Number); const t=sy*12+(sm-1)+i; return `${Math.floor(t/12)}-${String(t%12+1).padStart(2,'0')}`; }
function loanSchedule(loan){
  const P=Number(loan&&loan.principal), n=Math.round(Number(loan&&loan.months)), rate=Number(loan&&loan.rate);
  if(!loan||!(P>0)||!(n>=1)||n>600||!(rate>=0)||!/^\d{4}-\d{2}$/.test(String(loan.start||''))) return [];
  const method=LOAN_METHOD_LABEL[loan.method]?loan.method:'annuity';
  const key=[method,P,rate,n,loan.start].join('|');
  if(_loanScheduleCache.has(key)) return _loanScheduleCache.get(key);
  const r=rate/100/12;
  const fixed=Math.round(r>0?P*r/(1-Math.pow(1+r,-n)):P/n);   // 원리금균등: 매달 같은 납입액
  const even=Math.round(P/n);                                   // 원금균등: 매달 같은 원금
  const rows=[]; let bal=P;
  for(let i=0;i<n;i++){
    const interest=Math.round(bal*r), last=i===n-1;
    let principal=last?bal:(method==='annuity'?fixed-interest:(method==='principal'?even:0));
    principal=Math.max(0,Math.min(bal,principal));
    bal-=principal;
    rows.push({month:_loanYm(loan.start,i),payment:interest+principal,interest,principal,balance:bal});
  }
  if(_loanScheduleCache.size>200) _loanScheduleCache.clear();
  _loanScheduleCache.set(key,rows);
  return rows;
}
function loanPaymentFor(loan,y,m){ const i=_loanMonthIndex(loan,y,m); if(!(i>=0)) return 0; const row=loanSchedule(loan)[i]; return row?row.payment:0; }
// 그 달 기준 상태 — 납입 전(before)·상환 중(active, 그 달 납입 뒤 잔액·남은 횟수)·상환 끝(done)
function loanStatusFor(loan,y,m){
  const rows=loanSchedule(loan); if(!rows.length) return null;
  const i=_loanMonthIndex(loan,y,m), end=rows[rows.length-1].month;
  if(i<0) return {phase:'before',row:null,remaining:rows.length,balance:Number(loan.principal),end};
  if(i>=rows.length) return {phase:'done',row:null,remaining:0,balance:0,end};
  return {phase:'active',row:rows[i],remaining:rows.length-i-1,balance:rows[i].balance,end};
}
function _normalizeLoanTerms(loan){
  if(!loan||typeof loan!=='object'||Array.isArray(loan)) return null;
  const principal=_safeStoredNumber(loan.principal,{min:0,max:1_000_000_000_000});
  const rate=_safeStoredNumber(loan.rate,{min:0,max:30});
  const months=Math.round(_safeStoredNumber(loan.months,{min:0,max:600}));
  const start=_isStoredDateKey(loan.start,true)?String(loan.start):'';
  if(!(principal>0)||!(months>=1)||!start) return null;
  return {method:LOAN_METHOD_LABEL[loan.method]?loan.method:'annuity',principal,rate,months,start};
}
function _normalizeAutoTransfers(rows){
  if(!Array.isArray(rows))return [];
  const allowedCycles=new Set(['daily','weekly','monthly','month-end','month-start','quarterly','yearly']);
  return rows.slice(0,2000).map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))return null;
    const id=_safeStoredId(item.id);
    if(id===null)return null;
    const cycle=allowedCycles.has(item.cycle)?item.cycle:'monthly';
    const row={
      id,
      owner:_normalizeStoredOwner(item.owner),
      type:item.type==='수입'?'수입':'지출',
      cat:_boundedStoredText(item.cat||'기타',48)||'기타',
      desc:_boundedStoredText(item.desc,240),
      amt:_safeStoredNumber(item.amt,{min:0,max:1_000_000_000_000}),
      cycle,
      dayOfMonth:Math.round(_safeStoredNumber(item.dayOfMonth,{min:1,max:31,fallback:1})),
      dayOfWeek:Math.round(_safeStoredNumber(item.dayOfWeek,{min:0,max:6,fallback:1})),
      isFixedCost:typeof item.isFixedCost==='boolean'?item.isFixedCost:undefined,
      businessDayRule:item.businessDayRule==='exact'?'exact':'next',
      lastApplied:_isStoredDateKey(item.lastApplied,true)?String(item.lastApplied):'',
      startMonth:_isStoredDateKey(item.startMonth,true)?String(item.startMonth):'',
      endMonth:_isStoredDateKey(item.endMonth,true)?String(item.endMonth):'',
      amountChanges:Array.isArray(item.amountChanges)?item.amountChanges.slice(0,240).map(change=>{
        if(!change||!_isStoredDateKey(change.from,true))return null;
        return {from:String(change.from),amt:_safeStoredNumber(change.amt,{min:0,max:1_000_000_000_000})};
      }).filter(Boolean):[],
      skipMonths:Array.isArray(item.skipMonths)?[...new Set(item.skipMonths.filter(month=>_isStoredDateKey(month,true)).map(String))].slice(0,240):[],
      // 증여 연결(2026-11-18 3차): 가족 계좌로 보내는 지출 자동이체를 증여로 집계한다. giftFrom(YYYY-MM)부터의 이체만 센다.
      giftKind:item.giftKind==='child'||item.giftKind==='spouse'?item.giftKind:'',
      giftFrom:_isStoredDateKey(item.giftFrom,true)?String(item.giftFrom).slice(0,7):'',
      // 대출 상환 조건(2026-11-18 4차) — 있으면 매달 금액을 상환 일정이 정한다
      loan:_normalizeLoanTerms(item.loan),
    };
    if(row.isFixedCost===undefined)delete row.isFixedCost;
    if(!row.giftKind){delete row.giftKind;delete row.giftFrom;}
    if(!row.loan)delete row.loan;
    return row;
  }).filter(Boolean);
}
function _normalizeMonthlyPLRows(rows){
  if(!Array.isArray(rows))return [];
  return rows.slice(0,5000).map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))return null;
    const id=_safeStoredId(item.id);
    if(id===null||!_isStoredDateKey(item.month,true))return null;
    const storedOwner=_boundedStoredText(item.owner,24);
    const normalizedOwner=OWNERS.includes(storedOwner)||(storedOwner==='전체')?storedOwner:'';
    const row={
      id,
      month:String(item.month),
      amt:_safeStoredNumber(item.amt,{min:-1_000_000_000_000,max:1_000_000_000_000}),
      memo:_boundedStoredText(item.memo,240),
      // 레거시 기록의 소유주 누락은 특정 납세자로 꾸미지 않고 별도 추정 버킷에 남긴다.
      owner:normalizedOwner,
      category:item.category==='domestic'?'domestic':'foreign',
      account:['일반','ISA','연금저축'].includes(item.account)?item.account:'일반',
    };
    const ruleSetId=_safeStoredToken(item.ruleSetId,'');
    if(ruleSetId)row.ruleSetId=ruleSetId;
    return row;
  }).filter(Boolean);
}
function _safeStoredToken(value,fallback=''){
  const token=String(value==null?'':value).trim();
  return /^[A-Za-z0-9._-]{1,80}$/.test(token)?token:fallback;
}
function _normalizeAssetHistoryRows(rows){
  if(!Array.isArray(rows))return [];
  return rows.slice(-240).map(item=>{
    if(!item||typeof item!=='object'||!_isStoredDateKey(item.date,true))return null;
    return {
      date:String(item.date),
      totalAssets:_safeStoredNumber(item.totalAssets,{min:0,max:1_000_000_000_000_000}),
      totalLiab:_safeStoredNumber(item.totalLiab,{min:0,max:1_000_000_000_000_000}),
      netAssets:_safeStoredNumber(item.netAssets,{min:-1_000_000_000_000_000,max:1_000_000_000_000_000}),
    };
  }).filter(Boolean);
}
function _normalizeGoalRows(rows){
  if(!Array.isArray(rows))return [];
  const links=new Set(['investment','net','crypto','us','kr','jp','gold','cash','manual']);
  return rows.slice(0,500).map((item,index)=>{
    if(!item||typeof item!=='object'||Array.isArray(item))return null;
    const name=_boundedStoredText(item.name,160);
    if(!name)return null;
    return {
      id:_safeStoredToken(item.id,`legacy-goal-${index}`),
      name,
      targetAmount:_safeStoredNumber(item.targetAmount,{min:0,max:1_000_000_000_000_000}),
      targetDate:_isStoredDateKey(item.targetDate)?String(item.targetDate):'',
      linkClass:links.has(item.linkClass)?item.linkClass:'investment',
      currentAmount:_safeStoredNumber(item.currentAmount,{min:0,max:1_000_000_000_000_000}),
    };
  }).filter(Boolean);
}
function _normalizeOwnerAmountMap(value){
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  return Object.fromEntries(OWNERS.map(owner=>[
    owner,
    _safeStoredNumber(source[owner],{min:-1_000_000_000_000_000,max:1_000_000_000_000_000}),
  ]));
}
// 월간 결산 보관(reportArchive) — 매일 도는 배치(scripts/net_worth_snapshot.py)만 쓴다. 앱은 읽고, 저장할 때 받은 값을 그대로 다시 싣는다.
// 형식이 어긋난 달은 버린다(화면이 숫자를 지어내지 않도록). 숫자가 아닌 값은 0 이 아니라 그 항목째로 뺀다.
function _normalizeReportArchive(raw){
  const out={};
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return out;
  const num=v=>Number.isFinite(Number(v))?Number(v):null;
  const numMap=m=>{const o={};if(m&&typeof m==='object'&&!Array.isArray(m))Object.keys(m).slice(0,12).forEach(k=>{const n=num(m[k]);if(n!==null)o[_boundedStoredText(k,24)]=n;});return o;};
  Object.keys(raw).filter(ym=>/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)).sort().slice(-240).forEach(ym=>{
    const e=raw[ym];
    if(!e||typeof e!=='object'||!_isStoredDateKey(e.date)||String(e.date).slice(0,7)!==ym)return;
    const total=num(e.total); if(total===null)return;
    const row={ym,date:String(e.date),schemaV:1,total,byOwner:numMap(e.byOwner),cls:{},pl:{},goals:[]};
    if(e.cls&&typeof e.cls==='object')Object.keys(e.cls).slice(0,8).forEach(k=>{row.cls[_boundedStoredText(k,24)]=numMap(e.cls[k]);});
    if(e.pl&&typeof e.pl==='object')Object.keys(e.pl).slice(0,8).forEach(k=>{const c=num(e.pl[k]?.cost),g=num(e.pl[k]?.gain);if(c!==null&&g!==null)row.pl[_boundedStoredText(k,24)]={cost:c,gain:g};});
    if(Array.isArray(e.holdings))row.holdings=e.holdings.slice(0,400).map(h=>{
      if(!h||typeof h!=='object')return null;
      const q=num(h.q),c=num(h.c),v=num(h.v); if(q===null||c===null||v===null)return null;
      return {o:_boundedStoredText(h.o,24),b:_boundedStoredText(h.b,60),a:_boundedStoredText(h.a,60),t:_boundedStoredText(h.t,40),n:_boundedStoredText(h.n,120),g:_boundedStoredText(h.g,12),q,c,v,u:h.u===true};
    }).filter(Boolean);
    if(Array.isArray(e.goals))row.goals=e.goals.slice(0,50).map(g=>{
      if(!g||typeof g!=='object')return null;
      const now=num(g.now),target=num(g.target); if(now===null||target===null)return null;
      return {name:_boundedStoredText(g.name,80),now,target};
    }).filter(Boolean);
    out[ym]=row;
  });
  return out;
}
function _normalizeNetWorthRows(rows){
  if(!Array.isArray(rows))return [];
  return rows.slice(-1000).map(item=>{
    if(!item||typeof item!=='object'||!_isStoredDateKey(item.date))return null;
    const total=Number(item.total);
    if(!Number.isFinite(total))return null;
    const owns=key=>Object.prototype.hasOwnProperty.call(item,key);
    const row={
      date:String(item.date),
      total:_safeStoredNumber(total,{min:-1_000_000_000_000_000,max:1_000_000_000_000_000}),
    };
    const schemaV=Number(item.schemaV);
    if(owns('schemaV')&&Number.isInteger(schemaV)&&schemaV>=1&&schemaV<=100)row.schemaV=schemaV;
    if(owns('portfolio'))row.portfolio=_safeStoredNumber(item.portfolio,{min:0,max:1_000_000_000_000_000});
    if(owns('nonInvestmentAssets'))row.nonInvestmentAssets=_safeStoredNumber(item.nonInvestmentAssets,{min:0,max:1_000_000_000_000_000});
    if(owns('liabilities'))row.liabilities=_safeStoredNumber(item.liabilities,{min:0,max:1_000_000_000_000_000});
    if(owns('portfolioByOwner'))row.portfolioByOwner=_normalizeOwnerAmountMap(item.portfolioByOwner);
    if(owns('netByOwner'))row.netByOwner=_normalizeOwnerAmountMap(item.netByOwner);
    return row;
  }).filter(Boolean);
}
function _normalizeBalanceSheet(value){
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const normalizeRows=(rows,kind)=>Array.isArray(rows)?rows.slice(0,1000).map((item,index)=>{
    if(!item||typeof item!=='object'||Array.isArray(item))return null;
    const name=_boundedStoredText(item.name,160);
    if(!name)return null;
    return {
      id:_safeStoredToken(item.id,`legacy-${kind}-${index}`),
      owner:_normalizeStoredOwner(item.owner),
      category:_boundedStoredText(item.category||'기타',80)||'기타',
      name,
      amount:_safeStoredNumber(item.amount,{min:0,max:1_000_000_000_000_000}),
      note:_boundedStoredText(item.note,240),
    };
  }).filter(Boolean):[];
  return {
    assets:normalizeRows(source.assets,'asset'),
    liabilities:normalizeRows(source.liabilities,'liability'),
    cashTargetMonths:_safeStoredNumber(source.cashTargetMonths,{min:1,max:36,fallback:6}),
  };
}
function _normalizeTargetAlloc(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const source=value.groups&&typeof value.groups==='object'&&!Array.isArray(value.groups)?value.groups:{};
  const defaults={crypto:5,us:35,kr:25,jp:5,gold:10,cash:20};
  const groups={};
  Object.entries(defaults).forEach(([key,fallback])=>{
    groups[key]=_safeStoredNumber(source[key],{min:0,max:100,fallback});
  });
  return {groups,threshold:_safeStoredNumber(value.threshold,{min:1,max:20,fallback:5})};
}
function _normalizeGiftActual(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const normalizeAmounts=items=>Array.from({length:4},(_,index)=>
    _safeStoredNumber(Array.isArray(items)?items[index]:0,{min:0,max:1_000_000_000_000})
  );
  const normalizePrior=prior=>{
    const source=prior&&typeof prior==='object'&&!Array.isArray(prior)?prior:{};
    const hasAmount=Object.prototype.hasOwnProperty.call(source,'amount')
      && source.amount!==''&&source.amount!==null
      && Number.isFinite(Number(source.amount))&&Number(source.amount)>=0;
    const amountKnown=source.amountKnown===true||(source.amountKnown!==false&&hasAmount);
    const normalized={
      confirmed:source.confirmed===true,
      asOf:_isStoredDateKey(source.asOf)?String(source.asOf):'',
      amountKnown,
    };
    if(amountKnown)normalized.amount=_safeStoredNumber(source.amount,{min:0,max:1_000_000_000_000});
    return normalized;
  };
  return {
    birth:_isStoredDateKey(value.birth,true)?String(value.birth):'',
    years:_safeStoredNumber(value.years,{min:5,max:60,fallback:40}),
    rate:_safeStoredNumber(value.rate,{min:0,max:20,fallback:3}),
    child:normalizeAmounts(value.child),
    marriage:_isStoredDateKey(value.marriage)?String(value.marriage):'',
    spouse:normalizeAmounts(value.spouse),
    childPrior:normalizePrior(value.childPrior),
    spousePrior:normalizePrior(value.spousePrior),
    // 증여 기록장(2026-11-10): 실제로 한 증여를 건별로 적는다. 형식이 틀린 행은 버린다.
    records:(Array.isArray(value.records)?value.records:[]).slice(0,500).map((item,index)=>{
      if(!item||typeof item!=='object'||Array.isArray(item))return null;
      const amt=Math.round(_safeStoredNumber(item.amt,{min:0,max:1_000_000_000_000}));
      if(!_isStoredDateKey(item.date)||!(amt>0)||!['child','spouse'].includes(item.kind))return null;
      return {id:_safeStoredToken(item.id,`gift-${index}`),kind:item.kind,date:String(item.date),amt,memo:_boundedStoredText(item.memo,120)};
    }).filter(Boolean),
  };
}
