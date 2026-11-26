// core/cashflow.js — 현금 흐름 — 월별 현금 흐름 화면과 입력
// (2026-11-23 script.js 에서 그대로 옮겨 나눈 조각. 로드 순서는 index.html·scripts/tests/_source.mjs)
// =============================================
// 캐시플로우
// =============================================
let currentCfDate=new Date(),cfYear=currentCfDate.getFullYear(),cfMonth=currentCfDate.getMonth()+1;
let _cfOwner = '전체';
let _cfSection = 'monthly';
let _cfShowExcluded = false;

// ── 부부 현금 흐름(2026-11-23, 사용자 결정) ──
// 현금 흐름 화면은 맞벌이 부부(본인·아내)만 다룬다. 자녀1·아버지 기록은 지우지 않고(결산 리포트 배당 장이 쓴다)
// 이 화면에서만 뺀다. '전체' 탭은 화면에 '부부 합계'로 보인다(내부 값은 '전체' 그대로 — 다른 화면과 소유주를 잇는다).
// 아내는 월급을 받아 쓰고 남은 돈을 본인에게 보낸다. 아내의 지출 내역은 모르므로 송금 한 건을 기록하면 세 줄이 생긴다:
//   in  — 본인 수입 '부부 송금' (사용자가 적은 금액·날짜, 이 묶음의 기준)
//   out — 아내 지출 '부부 송금' (in 과 같은 금액·날짜)
//   est — 아내 지출 '아내 지출(추정)' = 아내 수입(배당 제외) − 아내가 따로 기록한 지출 − 보낸 돈 (0 미만이면 줄 없음)
// in·out 은 집 안에서 통장만 옮긴 돈이라 부부 합계에서는 세지 않고, 본인·아내 탭에서만 센다. 두 줄의 합이 0 이라
// 순현금흐름을 쓰는 다른 계산(순자산 브리지 등)은 그대로 맞고, est 가 아내 월급만큼 남은 돈이 부풀지 않게 막는다.
const CF_OWNERS = ['본인','아내'];
const CF_XFER_FROM = '아내', CF_XFER_TO = '본인';
const CF_XFER_CAT = '부부 송금';
const CF_XFER_EST_CAT = '아내 지출(추정)';
function cfInScope(owner){ return _cfOwner==='전체' ? CF_OWNERS.includes(owner) : owner===_cfOwner; }
function cfScopeLabel(){ return _cfOwner==='전체' ? '부부 합계' : _cfOwner; }
function cfIsXferMove(item){ return !!item && (item.xferRole==='in'||item.xferRole==='out'); }
// 이 탭의 합계에 넣는 줄인가 — 소유주 범위 안이고, 부부 합계에서는 송금(in·out)을 뺀다
function cfRowCounts(item, owner=_cfOwner){
  if(!item) return false;
  const inScope = owner==='전체' ? CF_OWNERS.includes(item.owner) : item.owner===owner;
  if(!inScope) return false;
  return !(owner==='전체' && cfIsXferMove(item));
}
function _cfRowYm(item){
  if(!item) return '';
  if(item.date==='미정'&&item.divKey){const p=item.divKey.split('_');const y=parseInt(p[p.length-2]),m=parseInt(p[p.length-1]);return y&&m?`${y}-${String(m).padStart(2,'0')}`:'';}
  return /^\d{4}-\d{2}/.test(String(item.date||'')) ? String(item.date).slice(0,7) : '';
}
// 자동이체 하나의 한 달 가상 금액(이미 기록된 달·건너뛴 달·종료 뒤는 0) — renderCashFlow 의 예정 줄과 같은 규칙.
// 한 달 합계(_cfAutoTransferMonthTotals)와 아내 월급 입력(cfWifePaySources)이 같은 판정을 쓰도록 한 곳에 둔다.
function _cfAutoTransferMonthAmount(at, y, m){
  if (!at || !(at.amt || at.loan) || !at.cycle) return 0;
  const daysInMonth = new Date(y, m, 0).getDate();
  const ymKey = y+'-'+String(m).padStart(2,'0');
  const monthlyCycle=['monthly','month-end','month-start'].includes(at.cycle);
  if (!monthlyCycle&&at.startMonth) {
    const [sy, sm] = at.startMonth.split('-').map(Number);
    if (y < sy || (y === sy && m < sm)) return 0;
  }
  if (!monthlyCycle&&at.endMonth) {
    const [ey, em] = at.endMonth.split('-').map(Number);
    if (y > ey || (y === ey && m > em)) return 0;
  }
  if (!monthlyCycle&&Array.isArray(at.skipMonths) && at.skipMonths.includes(ymKey)) return 0;
  const hasMaterialized = cfData.some(item=>{
    const idate=new Date(item.date);
    return idate.getFullYear()===y && idate.getMonth()+1===m && item.atId===at.id;
  });
  if (hasMaterialized) return 0;
  const hasLegacy = cfData.some(item=>{
    const idate=new Date(item.date);
    return idate.getFullYear()===y && idate.getMonth()+1===m &&
      item.isAuto===true && item.atId==null &&
      typeof item.desc==='string' && item.desc.includes(at.desc);
  });
  if (hasLegacy) return 0;
  let times = 0;
  if (monthlyCycle) times=_autoTransferMonthlyOccurrences(at,y,m).length;
  else if (at.cycle==='weekly') times=Math.floor(daysInMonth/7);
  else if (at.cycle==='daily') times=daysInMonth;
  return _effectiveAutoTransferAmt(at, y, m) * times;
}
// 한 달의 자동이체 가상 금액 합계(소유주 조건 ownerOk) — 수입·지출, 카테고리별
function _cfAutoTransferMonthTotals(y, m, ownerOk){
  let atIn=0, atOut=0;
  const inByCat=Object.create(null), outByCat=Object.create(null);
  (typeof autoTransferData!=='undefined'?autoTransferData:[]).forEach(at=>{
    if (!at || !ownerOk(at.owner)) return;
    const total = _cfAutoTransferMonthAmount(at, y, m);
    if(!total) return;
    const cat=at.cat||'기타';
    if (at.type==='수입'){ atIn+=total; inByCat[cat]=(inByCat[cat]||0)+total; }
    else { atOut+=total; outByCat[cat]=(outByCat[cat]||0)+total; }
  });
  return {atIn, atOut, inByCat, outByCat};
}
// 한 달 합계 — 월별 내역의 합계·수입/지출 구성·선택 달 요약·순현금흐름 추이·저축률 추이가 모두 이 한 곳을 쓴다(2026-11-25).
// 예전에는 추이 그래프가 따로 더해서 날짜 '미정' 배당 줄을 빠뜨렸고(같은 달 순현금흐름이 요약과 달랐다),
// 구성 목록의 수입 내역에는 예정된 수입 자동이체가 빠져 '수입 합계'와 카테고리 합이 맞지 않았다.
function cfMonthTotals(y, m){
  const ym=y+'-'+String(m).padStart(2,'0');
  let tIn=0, tOut=0;
  const incomeByCat=Object.create(null), expByCat=Object.create(null);
  cfData.forEach(item=>{
    if(_cfRowYm(item)!==ym||!cfRowCounts(item)) return;
    const amt=Number(item.amt)||0;
    if(item.type==='수입'){ tIn+=amt; incomeByCat[item.cat]=(incomeByCat[item.cat]||0)+amt; }
    else { tOut+=amt; expByCat[item.cat]=(expByCat[item.cat]||0)+amt; }
  });
  const at=_cfAutoTransferMonthTotals(y,m,cfInScope);
  tIn+=at.atIn; tOut+=at.atOut;
  Object.entries(at.inByCat).forEach(([c,v])=>{ incomeByCat[c]=(incomeByCat[c]||0)+v; });
  Object.entries(at.outByCat).forEach(([c,v])=>{ expByCat[c]=(expByCat[c]||0)+v; });
  return {tIn, tOut, incomeByCat, expByCat};
}
// 저축률 — 소득에서 소비지출을 뺀 비율. '저축/투자'(FIN_SAVING_CATS) 지출은 자산 이동이라 소비에서 되돌린다.
// 선택 달 요약과 저축률 추이가 같은 정의를 쓰도록 한 곳에 둔다. 수입이 0 인 달은 내지 않는다(null).
function cfSavingRate(t){
  const savingCats=(typeof FIN_SAVING_CATS!=='undefined')?FIN_SAVING_CATS:['저축/투자'];
  const savingOut=savingCats.reduce((sum,cat)=>sum+(t.expByCat[cat]||0),0);
  const kept=t.tIn-(t.tOut-savingOut);
  return {savingOut, kept, rate:t.tIn>0?kept/t.tIn*100:null};
}
// 한 사람의 한 달 — 기록된 줄 + 자동이체 예정. 송금·추정 줄은 따로 센다.
function cfPersonMonth(owner, ym){
  const [y,m]=ym.split('-').map(Number);
  const r={owner,income:0,dividend:0,expense:0,xferIn:0,xferOut:0,est:0,xferDate:''};
  cfData.forEach(item=>{
    if(!item||item.owner!==owner||_cfRowYm(item)!==ym) return;
    const amt=Number(item.amt)||0;
    if(item.xferRole==='in'){r.xferIn+=amt;r.xferDate=item.date;return;}
    if(item.xferRole==='out'){r.xferOut+=amt;r.xferDate=item.date;return;}
    if(item.xferRole==='est'){r.est+=amt;return;}
    if(item.type==='수입'){ if(item.cat==='배당금') r.dividend+=amt; else r.income+=amt; }
    else r.expense+=amt;
  });
  const at=_cfAutoTransferMonthTotals(y,m,o=>o===owner);
  r.income+=at.atIn; r.expense+=at.atOut;
  return r;
}
// 아내 지출 추정액 — 배당은 증권 계좌에 남으므로 빼고 계산한다
function cfSpouseEstimate(ym, sent){
  const w=cfPersonMonth(CF_XFER_FROM, ym);
  return Math.max(0, Math.round(w.income - w.expense - (Number(sent)||0)));
}
// 송금 묶음을 맞춘다: in 줄이 기준. out·est 를 만들거나 고치고, in 이 없는 out·est 는 지운다. 바뀐 것이 있으면 true.
function cfSpouseSync(){
  if(typeof cfData==='undefined'||!Array.isArray(cfData)) return false;
  let changed=false;
  const ins=new Map();
  cfData.forEach(c=>{ if(c&&c.xferRole==='in'&&!ins.has(c.xferMonth)) ins.set(c.xferMonth,c); });
  for(let k=cfData.length-1;k>=0;k--){
    const c=cfData[k];
    if(!c||!c.xferRole) continue;
    const head=ins.get(c.xferMonth);
    if(!head || (c.xferRole==='in'&&c!==head)){ cfData.splice(k,1); changed=true; }
  }
  ins.forEach((head,ym)=>{
    const amt=Number(head.amt)||0;
    let out=cfData.find(c=>c.xferRole==='out'&&c.xferMonth===ym);
    if(!out){ out={date:head.date,type:'지출',cat:CF_XFER_CAT,desc:`${CF_XFER_TO}에게 송금(남은 돈)`,amt,owner:CF_XFER_FROM,xferMonth:ym,xferRole:'out'}; cfData.push(out); changed=true; }
    else if(out.amt!==amt||out.date!==head.date||out.owner!==CF_XFER_FROM){ out.amt=amt; out.date=head.date; out.owner=CF_XFER_FROM; changed=true; }
    const estAmt=cfSpouseEstimate(ym, amt);
    const ei=cfData.findIndex(c=>c.xferRole==='est'&&c.xferMonth===ym);
    if(estAmt<=0){ if(ei>-1){ cfData.splice(ei,1); changed=true; } }
    else if(ei<0){ cfData.push({date:head.date,type:'지출',cat:CF_XFER_EST_CAT,desc:'월급 − 보낸 돈 (지출 내역 미기록)',amt:estAmt,owner:CF_XFER_FROM,xferMonth:ym,xferRole:'est'}); changed=true; }
    else { const e=cfData[ei]; if(e.amt!==estAmt||e.date!==head.date){ e.amt=estAmt; e.date=head.date; changed=true; } }
  });
  return changed;
}
// 화면 렌더 전에 맞추고, 바뀌었으면 저장(재무 기록을 다 읽은 뒤에만).
// 저장이 실패하면 saveExtDataToKV 가 되돌린 뒤 이 화면을 다시 그리고, 그 렌더가 다시 맞추고 저장하면 끝없이 돈다 —
// 저장 중에는 다시 저장하지 않고, 한 번 실패하면 이 세션에서는 자동 저장을 멈춘다(사용자 저장 때 함께 실린다).
let _cfSpouseSaveBusy=false, _cfSpouseSaveFailed=false;
function cfSpouseSyncAndSave(){
  if(!cfSpouseSync()) return false;
  saveCfData();
  if(_cfSpouseSaveBusy||_cfSpouseSaveFailed) return true;
  if(window._kvLoadState?.ext!=='ready' || typeof saveExtDataToKV!=='function') return true;
  _cfSpouseSaveBusy=true;
  Promise.resolve(saveExtDataToKV()).then(r=>{ if(r&&r.ok===false) _cfSpouseSaveFailed=true; })
    .catch(()=>{ _cfSpouseSaveFailed=true; }).finally(()=>{ _cfSpouseSaveBusy=false; });
  return true;
}
async function cfXferDelete(ym){
  if (isMobileLayout()) return;
  if(!confirm(`${Number(ym.slice(5))}월 부부 송금 기록을 지울까요? (아내 지출 추정 줄도 함께 지워집니다)`)) return false;
  for(let k=cfData.length-1;k>=0;k--){ if(cfData[k].xferMonth===ym) cfData.splice(k,1); }
  saveCfData(); renderCashFlow(); await saveExtDataToKV();
  return true;
}

// ── 이 달 돈의 흐름 — 생키 다이어그램(2026-11-26 사용자 결정) ──
// 예전 '우리 집 돈의 흐름' 두 칸 카드를 대신해 가로 전체를 쓴다. 왼쪽 들어온 돈(급여·배당) → 두 통장 → 오른쪽 나간 돈·남은 돈.
// 값은 cfPersonMonth(기록 + 자동이체 예정)와 같은 줄들을 카테고리로 나눈 것뿐이고 새 계산이 없다. 아내 지출은 기록이 없어
// '월급 − 보낸 돈'(cfSpouseEstimate)으로 추정한 한 덩어리다. 소유주 탭과 상관없이 늘 부부 둘을 그린다(흐름 자체가 두 사람 사이다).
// 휴대폰은 좁아 띠를 읽을 수 없으므로 같은 값을 목록으로 보인다(cfSankeyListHtml).
const CF_FLOW_REST_COLOR='#3f63c9';   // 남은 돈 — 지출 카테고리 색(cfColors)과 겹치지 않는 남색(적립식과 같은 값)
const CF_FLOW_SMALL_SHARE=0.025;      // 들어온 돈의 2.5% 미만인 본인 지출 카테고리는 '그 밖 N개'로 묶는다(두 개 이상일 때만)
// 한 사람의 한 달 카테고리별 금액(type '수입'|'지출') — 송금·추정 줄은 빼고, 자동이체 예정은 넣는다(cfPersonMonth 와 같은 범위)
function _cfPersonByCat(owner, ym, type){
  const [y,m]=ym.split('-').map(Number);
  const o=Object.create(null);
  cfData.forEach(c=>{
    if(!c||c.owner!==owner||c.xferRole||_cfRowYm(c)!==ym) return;
    if((c.type==='수입')!==(type==='수입')) return;
    o[c.cat]=(o[c.cat]||0)+(Number(c.amt)||0);
  });
  const at=_cfAutoTransferMonthTotals(y,m,ow=>ow===owner);
  Object.entries(type==='수입'?at.inByCat:at.outByCat).forEach(([k,v])=>{ o[k]=(o[k]||0)+v; });
  return o;
}
// 들어온 돈 이름 — 급여뿐이면 '본인 급여', 다른 수입이 섞이면 '본인 수입'
function _cfIncomeLabel(owner, ym){
  const cats=Object.entries(_cfPersonByCat(owner,ym,'수입')).filter(([k,v])=>k!=='배당금'&&v>0).map(([k])=>k);
  return `${owner} ${cats.length&&cats.every(k=>k==='급여')?'급여':'수입'}`;
}
function cfSankeyData(ym){
  const savingCats=(typeof FIN_SAVING_CATS!=='undefined')?FIN_SAVING_CATS:['저축/투자'];
  const me=cfPersonMonth(CF_XFER_TO,ym), wf=cfPersonMonth(CF_XFER_FROM,ym);
  const N={}, L=[];
  const node=(id,col,v,label,color,extra)=>{ if(v>0) N[id]=Object.assign({id,col,v,label,color},extra||{}); };
  const link=(s,t,v)=>{ if(v>0&&N[s]&&N[t]) L.push({s,t,v}); };
  const wIn=wf.income+wf.dividend, mIn=me.income+me.dividend+me.xferIn;
  const wLeft=wIn-wf.expense-wf.xferOut-wf.est, meLeft=mIn-me.expense;
  // 들어온 돈보다 나간 돈이 많으면 그만큼을 '모아 둔 돈에서' 꺼낸 것으로 그린다(통장 양쪽 굵기를 맞춘다)
  const wDraw=Math.max(0,-wLeft), mDraw=Math.max(0,-meLeft);
  node('sMe',0,me.income,_cfIncomeLabel(CF_XFER_TO,ym),ownerColors[CF_XFER_TO]);
  node('sDiv',0,me.dividend+wf.dividend,'배당금',cfColors['배당금']);
  node('sWife',0,wf.income,_cfIncomeLabel(CF_XFER_FROM,ym),ownerColors[CF_XFER_FROM]);
  node('sDraw',0,wDraw+mDraw,'모아 둔 돈에서','var(--dn)');
  node('aWife',1,wIn+wDraw,`${CF_XFER_FROM} 통장`,ownerColors[CF_XFER_FROM]);
  node('aMe',2,mIn+mDraw,`${CF_XFER_TO} 통장`,ownerColors[CF_XFER_TO]);
  link('sWife','aWife',wf.income); link('sDiv','aWife',wf.dividend); link('sDraw','aWife',wDraw);
  link('sMe','aMe',me.income); link('sDiv','aMe',me.dividend); link('aWife','aMe',me.xferIn); link('sDraw','aMe',mDraw);
  node('eWest',3,wf.est,CF_XFER_EST_CAT,cfColors[CF_XFER_EST_CAT],{est:true}); link('aWife','eWest',wf.est);
  Object.entries(_cfPersonByCat(CF_XFER_FROM,ym,'지출')).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{
    node('w:'+k,3,v,`${CF_XFER_FROM} ${k}`,cfColors[k]||cfColors['기타'],{hatch:savingCats.includes(k)}); link('aWife','w:'+k,v);
  });
  const tot=Math.max(1, me.income+wf.income+me.dividend+wf.dividend);
  const mCats=Object.entries(_cfPersonByCat(CF_XFER_TO,ym,'지출')).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  let small=mCats.filter(([k,v])=>v/tot<CF_FLOW_SMALL_SHARE&&!savingCats.includes(k));
  if(small.length<2) small=[];
  mCats.filter(x=>!small.includes(x)).forEach(([k,v])=>{
    node('m:'+k,3,v,k,cfColors[k]||cfColors['기타'],{hatch:savingCats.includes(k)}); link('aMe','m:'+k,v);
  });
  if(small.length){
    const v=small.reduce((s,[,x])=>s+x,0);
    node('mSmall',3,v,`그 밖 ${small.length}개`,cfColors['기타'],{tip:small.map(([k,x])=>`${k} ${cfShortWon(x)}`).join(' · ')}); link('aMe','mSmall',v);
  }
  node('wRest',3,Math.max(0,wLeft),`${CF_XFER_FROM} 남은 돈`,CF_FLOW_REST_COLOR); link('aWife','wRest',Math.max(0,wLeft));
  node('rest',3,Math.max(0,meLeft),'남은 돈',CF_FLOW_REST_COLOR,{bold:true}); link('aMe','rest',Math.max(0,meLeft));
  return {N,L,tot,me,wf,meLeft,wLeft,ym};
}
// 세로로 늘어선 이름표가 겹치지 않게 민다 — items:[{cy,hh}] (가운데 y·높이), 위에서부터 밀고 바닥을 넘으면 위로 올린다
function _cfSpreadLabels(items, top, bottom){
  const s=items.slice().sort((a,b)=>a.cy-b.cy);
  let prev=top;
  s.forEach(it=>{ it.top=Math.max(it.cy-it.hh/2, prev); prev=it.top+it.hh+2; });
  let over=prev-2-bottom;
  for(let i=s.length-1;i>=0&&over>0;i--){
    const it=s[i], next=i<s.length-1?s[i+1].top-2:bottom;
    const want=Math.min(it.top, next-it.hh);
    over-=Math.max(0,it.top-want); it.top=want;
  }
  return items;
}
let _cfSkSeq=0;
function cfSankeySvg(d, W, H){
  const {N,L,tot}=d;
  const ids=Object.keys(N);
  if(!ids.length) return '';
  const cols=[[],[],[],[]];
  ids.forEach(id=>cols[N[id].col].push(id));
  // 오른쪽 열 순서: 아내 쪽 먼저(위), 본인 카테고리 큰 순서, 그 밖, 아내 남은 돈, 남은 돈(맨 아래)
  const rank=id=>id==='rest'?4:id==='wRest'?3:id==='mSmall'?2:(id==='eWest'||id.startsWith('w:'))?0:1;
  cols[3].sort((a,b)=>rank(a)-rank(b)||N[b].v-N[a].v);
  const nw=12, padT=8, padB=8, lab=W>=1000?170:150, padL=W>=1000?110:96;
  const span=W-padL-lab-nw, X=[padL, padL+span*0.33, padL+span*0.62, W-lab-nw];
  const gap=[16,0,0,6], avail=H-padT-padB;
  const sums=cols.map(c=>c.reduce((s,id)=>s+N[id].v,0));
  const k=Math.min(...cols.map((c,i)=>c.length?(avail-gap[i]*(c.length-1))/sums[i]:Infinity));
  cols.forEach((c,i)=>{ let y=padT; c.forEach(id=>{ const n=N[id]; n.x=X[i]; n.y=y; n.h=Math.max(1.5,n.v*k); y+=n.h+gap[i]; }); });
  // 아내 통장은 아내 급여 높이에 맞춘다(없으면 바닥)
  if(N.aWife) N.aWife.y=Math.min(N.sWife?N.sWife.y:H, H-padB-N.aWife.h);
  const Ls=L.map(l=>Object.assign({},l));
  ids.forEach(id=>{ let y=N[id].y; Ls.filter(l=>l.s===id).sort((a,b)=>N[a.t].y-N[b.t].y).forEach(l=>{ l.sy=y; y+=l.v*k; }); });
  ids.forEach(id=>{ let y=N[id].y; Ls.filter(l=>l.t===id).sort((a,b)=>N[a.s].y-N[b.s].y).forEach(l=>{ l.ty=y; y+=l.v*k; }); });
  const uid='cfsk'+(++_cfSkSeq);
  const won=v=>'₩'+Math.round(v).toLocaleString();
  const ins=cols[0].map(id=>`${N[id].label} ${cfShortWon(N[id].v)}`).join(', ');
  const outs=cols[3].map(id=>`${N[id].label} ${cfShortWon(N[id].v)}`).join(', ');
  let s=`<svg class="cf-sankey-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${_cfEsc(`${Number(d.ym.slice(5))}월 돈의 흐름 — 들어온 돈: ${ins}. 나간 돈과 남은 돈: ${outs}`)}">`
    +`<defs><pattern id="${uid}h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="rgba(255,255,255,.6)"/></pattern>`;
  Ls.forEach((l,i)=>{ s+=`<linearGradient id="${uid}g${i}"><stop offset="0" stop-color="${N[l.s].color}"/><stop offset="1" stop-color="${N[l.t].color}"/></linearGradient>`; });
  s+='</defs>';
  Ls.forEach((l,i)=>{
    const a=N[l.s], b=N[l.t], h=l.v*k, x0=a.x+nw, x1=b.x, mx=(x0+x1)/2;
    s+=`<path class="cf-sk-link" d="M${x0},${l.sy.toFixed(1)}C${mx},${l.sy.toFixed(1)} ${mx},${l.ty.toFixed(1)} ${x1},${l.ty.toFixed(1)}L${x1},${(l.ty+h).toFixed(1)}C${mx},${(l.ty+h).toFixed(1)} ${mx},${(l.sy+h).toFixed(1)} ${x0},${(l.sy+h).toFixed(1)}Z" fill="url(#${uid}g${i})"><title>${_cfEsc(`${a.label} → ${b.label} ${won(l.v)}`)}</title></path>`;
    if(l.s==='aWife'&&l.t==='aMe') s+=`<text class="cf-sk-xfer" x="${mx}" y="${((l.sy+l.ty)/2+h/2+4).toFixed(1)}" text-anchor="middle">송금 ${cfShortWon(l.v)}</text>`;
  });
  ids.forEach(id=>{ const n=N[id]; s+=`<rect x="${n.x}" y="${n.y.toFixed(1)}" width="${nw}" height="${n.h.toFixed(1)}" rx="2" fill="${n.color}"/>`+(n.hatch?`<rect x="${n.x}" y="${n.y.toFixed(1)}" width="${nw}" height="${n.h.toFixed(1)}" fill="url(#${uid}h)"/>`:''); });
  // 이름표 — 왼쪽 열은 막대 왼쪽, 가운데 두 통장은 막대 오른쪽(띠 위라 글자 둘레를 바탕색으로 두른다), 오른쪽 열은 막대 오른쪽.
  // 막대가 낮으면(24px 미만) 이름과 금액을 한 줄로 적고, 위아래 이름표가 겹치지 않게 민다.
  const tip=n=>n.tip?`<title>${_cfEsc(n.tip)}</title>`:'';
  [0,1,2,3].forEach(ci=>{
    const items=cols[ci].map(id=>{ const n=N[id]; const one=n.h<24&&ci!==1&&ci!==2; return {n,one,cy:n.y+n.h/2,hh:one?15:30}; });
    _cfSpreadLabels(items, 0, H);
    items.forEach(({n,one,top})=>{
      const lx=ci===0?n.x-8:n.x+nw+7, anc=ci===0?'end':'start', inside=ci===1||ci===2?' is-in':'';
      const pct=ci===3?` · ${Math.round(n.v/tot*100)}%`:'';
      if(one) s+=`<text class="cf-sk-l${n.bold?' is-b':''}" x="${lx}" y="${(top+12).toFixed(1)}" text-anchor="${anc}">${_cfEsc(n.label)} <tspan class="cf-sk-v">${cfShortWon(n.v)}</tspan>${tip(n)}</text>`;
      else s+=`<text class="cf-sk-l${n.bold?' is-b':''}${inside}" x="${lx}" y="${(top+12).toFixed(1)}" text-anchor="${anc}">${_cfEsc(n.label)}${tip(n)}</text>`
        +`<text class="cf-sk-v${inside}" x="${lx}" y="${(top+27).toFixed(1)}" text-anchor="${anc}">${cfShortWon(n.v)}${pct}</text>`;
    });
  });
  return s+'</svg>';
}
// 휴대폰 — 같은 값을 '들어온 돈 / 나간 돈·남은 돈' 두 목록으로(막대 길이 = 들어온 돈 대비)
function cfSankeyListHtml(d){
  const ids=Object.keys(d.N);
  const row=n=>`<div class="cf-sk-row"><span class="cf-sk-name"><i style="background:${n.color}"></i>${_cfEsc(n.label)}</span>`
    +`<span class="cf-sk-track"><i class="${n.hatch?'is-saving':''}" style="width:${Math.min(100,n.v/d.tot*100).toFixed(1)}%;background:${n.color}"></i></span>`
    +`<b>${cfShortWon(n.v)}</b></div>`;
  const list=(col,title)=>{ const r=ids.filter(id=>d.N[id].col===col); return r.length?`<div class="cf-sk-list-head">${title}</div>`+r.map(id=>row(d.N[id])).join(''):''; };
  const xfer=d.me.xferIn>0?`<div class="cf-sk-list-xfer">${CF_XFER_FROM} → ${CF_XFER_TO} 송금 <b>${cfShortWon(d.me.xferIn)}</b></div>`:'';
  return `<div class="cf-sk-list">${list(0,'들어온 돈')}${xfer}${list(3,'나간 돈 · 남은 돈')}</div>`;
}
let _cfFlowRO=null, _cfFlowW=0;
function cfFlowCardHtml(y, m, W){
  const ym=`${y}-${String(m).padStart(2,'0')}`;
  const d=cfSankeyData(ym);
  const mobile=isMobileLayout();
  const btns=mobile?'':`<div class="cf-flow-actions"><button type="button" class="cf-entry-open" onclick="cfEntryOpen('in')">＋ 수입</button><button type="button" class="cf-entry-open" onclick="cfEntryOpen('out')">－ 지출</button></div>`;
  const head=`<div class="cf-flow-head"><span class="cb-label">${m}월 우리 집 돈의 흐름</span>${btns}</div>`;
  if(!Object.keys(d.N).length) return head+(typeof cbEmptyHtml==='function'
    ? cbEmptyHtml(`${m}월 기록이 없습니다`,'월급·생활비처럼 들어오고 나간 돈을 적으면 이 달 돈이 어디로 갔는지 그려집니다.',mobile?[]:[{label:'＋ 수입',onclick:"cfEntryOpen('in')"},{label:'－ 지출',onclick:"cfEntryOpen('out')"}],{compact:true})
    : '<div class="fin-empty">이 달 기록이 없습니다.</div>');
  const n3=Object.values(d.N).filter(n=>n.col===3).length;
  const H=Math.max(300, Math.min(480, 26*n3+60));
  const body=mobile?cfSankeyListHtml(d):`<div class="cf-sankey">${cfSankeySvg(d, Math.max(640, Math.round(W||1150)), H)}</div>`;
  const missing=d.wf.income>0&&!(d.me.xferIn>0)
    ? `<p class="cf-flow-warn">${m}월 송금이 아직 없어 ${CF_XFER_FROM} 월급 전체가 남은 돈으로 잡힙니다 — ＋ 수입 › ${CF_XFER_FROM} 월급·송금에서 적으세요.</p>`:'';
  const note=mobile
    ? `${CF_XFER_FROM} 지출은 기록이 없어 월급 − 보낸 돈으로 추정합니다. 송금은 통장만 옮긴 돈이라 부부 합계에서 빼고 셉니다.`
    : `띠 굵기 = 금액 · 띠에 마우스를 올리면 정확한 금액 · ${CF_XFER_FROM} 지출은 기록이 없어 <b>월급 − 보낸 돈</b>으로 추정 · 들어온 돈의 2.5% 미만 항목은 '그 밖'으로 묶음 · 송금은 집 안에서 통장만 옮긴 돈이라 부부 합계(아래 요약)에서는 빼고 셉니다.`;
  return head+body+missing+`<p class="cf-flow-note">${note}</p>`;
}
// 생키는 카드의 실제 폭으로 그린다(좌표계 폭 = 표시 폭 → 글자가 줄거나 커지지 않는다). 폭이 바뀌면 다시 그린다.
function cfFlowRender(){
  const el=document.getElementById('cf-couple-flow');
  if(!el) return;
  let W=0;
  if(el.clientWidth){
    const cs=typeof getComputedStyle==='function'?getComputedStyle(el):null;
    W=el.clientWidth-(cs?(parseFloat(cs.paddingLeft)||0)+(parseFloat(cs.paddingRight)||0):28);
  }
  _cfFlowW=el.clientWidth||0;
  el.innerHTML=cfFlowCardHtml(cfYear,cfMonth,W);
  if(!_cfFlowRO&&typeof ResizeObserver!=='undefined'){
    _cfFlowRO=new ResizeObserver(()=>{ const w=el.clientWidth; if(w&&Math.abs(w-_cfFlowW)>=4) cfFlowRender(); });
    _cfFlowRO.observe(el);
  }
}

// ── 수입·지출 기록 창(2026-11-26 사용자 결정) ──
// 예전 '수입·지출 기록' 입력 칸과 송금 기록 상자를 없애고, 생키 카드 오른쪽 위 [＋ 수입] [－ 지출] 두 버튼이 이 창을 연다.
//   수입 = [내 수입 | N월 아내 월급·송금]   지출 = [한 번 | 자동이체 (매달)]
// 새 기록의 소유주는 본인이다 — 아내 몫은 월급과 보낸 돈만 적고 차액은 '아내 지출(추정)' 한 줄(cfSpouseSync)이 맡는다.
// 수입 자동이체(매달 반복)는 새로 만들지 않는다(사용자 결정) — 이미 등록된 것은 그대로 돈다.
const CF_IN_CATS=['급여','배당금','기타'];
const CF_OUT_CATS=['식비','문화/생활','교통/차량','주거/통신','관리비','교육','의료/건강','대출납입금','세금','저축/투자','기타'];
let _cfEntry=null;   // {kind:'in'|'out', tab:'mine'|'wife'|'once'|'auto', editIdx, ym, xferYm}
let _cfEntryReturnFocus=null, _cfEntryDownOutside=false;
function _cfEntryNum(id){ return parseInt(String(document.getElementById(id)?.value||'').replace(/[^\d]/g,''),10)||0; }
function _cfEntryVal(id){ return String(document.getElementById(id)?.value||'').trim(); }
function _cfPrevYm(ym){ const [y,m]=ym.split('-').map(Number); const d=new Date(y,m-2,1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function _cfDefaultDate(ym){ return ym===_cfMonthKey()?_cfLocalDateKey(new Date()):`${ym}-01`; }
function cfEntryOpen(kind, tab, editIdx){
  if (isMobileLayout()) return; // 모바일은 조회 전용
  const modal=document.getElementById('cf-entry-modal');
  if(!modal) return;
  const k=kind==='in'?'in':'out';
  const t=k==='in'?(tab==='wife'?'wife':'mine'):(tab==='auto'?'auto':'once');
  const ym=`${cfYear}-${String(cfMonth).padStart(2,'0')}`;
  _cfEntry={kind:k,tab:t,editIdx:Number.isInteger(editIdx)&&cfData[editIdx]?editIdx:-1,ym,xferYm:''};
  if(!modal.classList.contains('active')) _cfEntryReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  cfEntryRender();
  modal.classList.add('active'); modal.setAttribute('aria-hidden','false');
  requestAnimationFrame(()=>document.querySelector('#cf-entry-fields input:not([type=hidden]),#cf-entry-fields select')?.focus());
}
function cfEntryTab(tab){
  if(!_cfEntry||_cfEntry.editIdx>-1) return;
  _cfEntry.tab=tab; cfEntryRender();
  document.querySelector(`#cf-entry-tabs [data-tab="${tab}"]`)?.focus();
}
function cfEntryClose(){
  const modal=document.getElementById('cf-entry-modal');
  if(!modal?.classList.contains('active')) return;
  modal.classList.remove('active'); modal.setAttribute('aria-hidden','true');
  _cfEntry=null;
  const back=_cfEntryReturnFocus; _cfEntryReturnFocus=null;
  if(back&&document.contains(back)) back.focus();
}
if(typeof document!=='undefined'&&typeof document.addEventListener==='function'){
  // 바깥(어두운 바탕)을 누르면 닫는다 — 안에서 누른 채 끌고 나와 바깥에서 뗀 경우는 닫지 않는다(입력 중 글자 선택 보호)
  document.addEventListener('pointerdown',e=>{_cfEntryDownOutside=!!e.target&&e.target.id==='cf-entry-modal';},true);
  document.addEventListener('click',e=>{if(e.target&&e.target.id==='cf-entry-modal'&&_cfEntryDownOutside)cfEntryClose();_cfEntryDownOutside=false;});
}
function _cfCatOptions(list, sel){
  const opts=list.includes(sel)||!sel?list:[...list,sel];   // 목록에 없는 예전 카테고리는 수정할 때 그대로 둔다
  return opts.map(c=>`<option${c===sel?' selected':''}>${_cfEsc(c)}</option>`).join('');
}
function cfEntryFieldsHtml(){
  const e=_cfEntry, t=e.tab;
  const item=e.editIdx>-1?cfData[e.editIdx]:null;
  const amtStr=v=>v>0?Math.round(v).toLocaleString():'';
  if(t==='wife'){
    const ym=e.ym, prev=_cfPrevYm(ym);
    const w=cfPersonMonth(CF_XFER_FROM,ym), wPrev=cfPersonMonth(CF_XFER_FROM,prev);
    const head=cfData.find(c=>c.xferRole==='in'&&c.xferMonth===ym);
    const prevHead=cfData.find(c=>c.xferRole==='in'&&c.xferMonth===prev);
    e.xferYm=head?ym:'';
    const pay=w.income||wPrev.income, sent=head?Number(head.amt):(prevHead?Number(prevHead.amt):0);
    const filled=(!w.income&&wPrev.income)||(!head&&prevHead);
    let date=head?head.date:'';
    if(!date&&prevHead){ const [yy,mm]=ym.split('-').map(Number); const day=Math.min(Number(String(prevHead.date).slice(8,10))||25,new Date(yy,mm,0).getDate()); date=`${ym}-${String(day).padStart(2,'0')}`; }
    if(!date) date=ym===_cfMonthKey()?_cfLocalDateKey(new Date()):`${ym}-25`;
    return `<p class="cf-entry-lead">월급과 나에게 보낸 돈만 적으면 차액은 '${CF_XFER_FROM} 지출'로 한 줄 처리합니다.${filled?' 지난달 값을 미리 채웠습니다.':''}</p>`
      +`<div class="form-group f-col"><label class="form-label" for="cf-w-pay">${CF_XFER_FROM} 월급</label><input type="text" class="form-input" id="cf-w-pay" inputmode="numeric" placeholder="0" value="${amtStr(pay)}" oninput="cfWifePreview()"></div>`
      +`<div class="form-row"><div class="form-group f-col"><label class="form-label" for="cf-w-sent">나에게 보낸 돈</label><input type="text" class="form-input" id="cf-w-sent" inputmode="numeric" placeholder="0" value="${amtStr(sent)}" oninput="cfWifePreview()"></div>`
      +`<div class="form-group f-col"><label class="form-label" for="cf-w-date">보낸 날</label><input type="date" class="form-input" id="cf-w-date" data-no-comma="1" value="${_cfEsc(date)}" onchange="cfWifePreview()"></div></div>`
      +`<div class="cf-entry-result" id="cf-w-result" role="status" aria-live="polite"></div>`;
  }
  if(t==='auto'){
    return `<div class="form-row"><div class="form-group f-col"><label class="form-label" for="cf-e-cat">카테고리</label><select class="form-input" id="cf-e-cat">${_cfCatOptions(CF_OUT_CATS,'주거/통신')}</select></div>`
      +`<div class="form-group f-col"><label class="form-label" for="cf-e-amt">금액</label><input type="text" class="form-input" id="cf-e-amt" inputmode="numeric" placeholder="0"></div></div>`
      +`<div class="form-group f-col"><label class="form-label" for="cf-e-desc">내용</label><input type="text" class="form-input" id="cf-e-desc" placeholder="예: 인터넷·휴대폰"></div>`
      +`<div class="form-row"><div class="form-group f-col"><label class="form-label" for="cf-e-cycle">주기</label><select class="form-input" id="cf-e-cycle" onchange="cfEntryCycle()"><option value="monthly" selected>매월</option><option value="month-end">매월말</option><option value="weekly">매주</option><option value="daily">매일</option></select></div>`
      +`<div class="form-group f-col" id="cf-e-dom-group"><label class="form-label" for="cf-e-dom">결제일</label><input type="number" class="form-input" id="cf-e-dom" min="1" max="31" value="25" data-no-comma="1"></div>`
      +`<div class="form-group f-col" id="cf-e-dow-group" hidden><label class="form-label" for="cf-e-dow">요일</label><select class="form-input" id="cf-e-dow">${['일','월','화','수','목','금','토'].map((d,i)=>`<option value="${i}"${i===1?' selected':''}>${d}</option>`).join('')}</select></div></div>`
      +`<div class="cf-entry-checks"><label class="cf-fixed-check"><input type="checkbox" id="cf-e-fixed" checked> 고정비에 포함</label>`
      +`<label class="cf-fixed-check" data-tip="가족 계좌로 보내는 이체라면 체크하세요. 세금·증여 > 가족 증여의 '자동이체를 증여로 연결' 목록에 이 항목만 나타납니다."><input type="checkbox" id="cf-e-gift"> 증여 이체</label></div>`;
  }
  const income=t==='mine';
  const cat=item?item.cat:(income?'급여':'식비');
  const owner=item&&item.owner&&item.owner!==CF_XFER_TO?`<p class="cf-entry-lead">${_cfEsc(item.owner)} 기록입니다 — 소유주는 그대로 둡니다.</p>`:'';
  return owner
    +`<div class="form-row"><div class="form-group f-col"><label class="form-label" for="cf-e-date">날짜</label><input type="date" class="form-input" id="cf-e-date" data-no-comma="1" value="${_cfEsc(item&&item.date!=='미정'?item.date:_cfDefaultDate(e.ym))}"></div>`
    +`<div class="form-group f-col"><label class="form-label" for="cf-e-cat">카테고리</label><select class="form-input" id="cf-e-cat">${_cfCatOptions(income?CF_IN_CATS:CF_OUT_CATS,cat)}</select></div></div>`
    +`<div class="form-group f-col"><label class="form-label" for="cf-e-desc">내용</label><input type="text" class="form-input" id="cf-e-desc" placeholder="${income?'예: 월급':'예: 장보기'}" value="${_cfEsc(item?item.desc:'')}"></div>`
    +`<div class="form-group f-col"><label class="form-label" for="cf-e-amt">금액</label><input type="text" class="form-input" id="cf-e-amt" inputmode="numeric" placeholder="0" value="${item?amtStr(Number(item.amt)):''}"></div>`;
}
function cfEntryRender(){
  const e=_cfEntry; if(!e) return;
  const editing=e.editIdx>-1;
  const title=document.getElementById('cf-entry-title');
  if(title) title.textContent=(e.kind==='in'?'수입':'지출')+(editing?' 수정':' 기록');
  const tabs=document.getElementById('cf-entry-tabs');
  if(tabs){
    const defs=e.kind==='in'?[['mine','내 수입'],['wife',`${Number(e.ym.slice(5))}월 ${CF_XFER_FROM} 월급·송금`]]:[['once','한 번'],['auto','자동이체 (매달)']];
    tabs.hidden=editing;
    tabs.innerHTML=defs.map(([k,l])=>`<button type="button" class="cb-btn" data-tab="${k}" aria-pressed="${e.tab===k}" onclick="cfEntryTab('${k}')">${l}</button>`).join('');
  }
  const f=document.getElementById('cf-entry-fields');
  if(f) f.innerHTML=cfEntryFieldsHtml();
  const err=document.getElementById('cf-entry-error'); if(err){ err.hidden=true; err.textContent=''; }
  const del=document.getElementById('cf-entry-del'); if(del) del.hidden=!(e.tab==='wife'&&e.xferYm);
  if(e.tab==='wife') cfWifePreview();
}
function cfEntryCycle(){
  const c=document.getElementById('cf-e-cycle')?.value;
  const dom=document.getElementById('cf-e-dom-group'), dow=document.getElementById('cf-e-dow-group');
  if(dom) dom.hidden=c!=='monthly';
  if(dow) dow.hidden=c!=='weekly';
}
// 아내 지출(자동) 미리 보기 — 저장할 때 cfSpouseEstimate 가 내는 값과 같은 식(월급 − 따로 적은 아내 지출 − 보낸 돈)
function cfWifePreview(){
  const box=document.getElementById('cf-w-result'); if(!box||!_cfEntry) return;
  const date=_cfEntryVal('cf-w-date'), ym=/^\d{4}-\d{2}/.test(date)?date.slice(0,7):_cfEntry.ym;
  const pay=_cfEntryNum('cf-w-pay'), sent=_cfEntryNum('cf-w-sent');
  const other=cfPersonMonth(CF_XFER_FROM,ym).expense;
  const est=Math.max(0,pay-other-sent);
  box.innerHTML=`<span>${CF_XFER_FROM} 지출 (자동)</span><b>₩${est.toLocaleString()}</b>`
    +(other>0?`<small>따로 적어 둔 ${CF_XFER_FROM} 지출 ₩${Math.round(other).toLocaleString()}을 빼고 계산합니다.</small>`:'')
    +(pay>0&&sent>pay-other?`<small class="is-warn">보낸 돈이 월급보다 많아 ${CF_XFER_FROM} 지출을 0으로 봅니다.</small>`:'');
}
// 아내 월급이 그 달 어디에 기록돼 있는가 — 기록 줄(배당·송금 제외)과 그 달에 돌 자동이체(수입)
function cfWifePaySources(ym){
  const [y,m]=ym.split('-').map(Number);
  const rows=[];
  cfData.forEach((c,i)=>{ if(c&&c.owner===CF_XFER_FROM&&c.type==='수입'&&c.cat!=='배당금'&&!c.xferRole&&_cfRowYm(c)===ym) rows.push(i); });
  const ats=(typeof autoTransferData!=='undefined'?autoTransferData:[]).filter(at=>at&&at.owner===CF_XFER_FROM&&at.type==='수입'&&_cfAutoTransferMonthAmount(at,y,m)>0);
  const total=rows.reduce((s,i)=>s+(Number(cfData[i].amt)||0),0)+ats.reduce((s,at)=>s+_cfAutoTransferMonthAmount(at,y,m),0);
  return {rows,ats,total};
}
// 자동이체의 한 달을 기록 줄로 바꾼다(그 달만 금액이 다를 때) — editAutoTransferMonth 의 '이 달만' 과 같은 모양
function _cfMaterializeAutoTransfer(at, y, m, amt){
  const occ=['monthly','month-end','month-start'].includes(at.cycle)?_autoTransferMonthlyOccurrences(at,y,m):[];
  const date=occ.length?_cfLocalDateKey(occ[0].date):`${y}-${String(m).padStart(2,'0')}-${String(Math.min(at.dayOfMonth||1,new Date(y,m,0).getDate())).padStart(2,'0')}`;
  return {date,type:at.type,cat:at.cat,desc:'[자동] '+(at.desc||''),amt,owner:at.owner,isAuto:true,atId:at.id,cycleLabel:_getCycleLabel(at)};
}
function cfWifeSave(fail){
  const pay=_cfEntryNum('cf-w-pay'), sent=_cfEntryNum('cf-w-sent'), date=_cfEntryVal('cf-w-date');
  if(!(pay>0)) return fail(`${CF_XFER_FROM} 월급을 입력하세요.`);
  if(!(sent>0)) return fail('나에게 보낸 돈을 입력하세요.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('보낸 날을 입력하세요.');
  const ym=date.slice(0,7), [y,m]=ym.split('-').map(Number);
  const src=cfWifePaySources(ym);
  if(pay!==src.total&&src.rows.length+src.ats.length>1)
    return fail(`${m}월 ${CF_XFER_FROM} 수입이 여러 줄(합계 ₩${Math.round(src.total).toLocaleString()})로 기록돼 있어 한 칸으로 고칠 수 없습니다. ${CF_XFER_FROM} 탭의 상세 내역에서 고쳐 주세요.`);
  const editYm=_cfEntry.xferYm;
  const other=cfData.find(c=>c.xferRole==='in'&&c.xferMonth===ym);
  if(other&&ym!==editYm&&!confirm(`${m}월 송금 기록이 이미 있습니다. 새 값으로 바꿀까요?`)) return;
  // 1) 월급 — 그 달 수입이 한 곳(기록 줄 하나 또는 자동이체 하나)이면 그 금액을 고치고, 없으면 새 줄을 만든다
  if(pay!==src.total){
    if(src.rows.length===1) cfData[src.rows[0]].amt=pay;
    else if(src.ats.length===1) cfData.push(_cfMaterializeAutoTransfer(src.ats[0],y,m,pay));
    else cfData.push({date,type:'수입',cat:'급여',desc:`${CF_XFER_FROM} 월급`,amt:pay,owner:CF_XFER_FROM});
  }
  // 2) 송금 — in 줄이 묶음의 기준이고 out·est 는 cfSpouseSync 가 맞춘다. 고치면서 달을 옮겼으면 예전 달 묶음을 지운다.
  if(editYm&&editYm!==ym){ for(let k=cfData.length-1;k>=0;k--){ if(cfData[k].xferMonth===editYm) cfData.splice(k,1); } }
  const head=cfData.find(c=>c.xferRole==='in'&&c.xferMonth===ym);
  if(head){ head.date=date; head.amt=sent; }
  else cfData.push({date,type:'수입',cat:CF_XFER_CAT,desc:`${CF_XFER_FROM}가 보낸 남은 돈`,amt:sent,owner:CF_XFER_TO,xferMonth:ym,xferRole:'in'});
  cfSpouseSync();
  cfYear=y; cfMonth=m;
  cfEntryClose();
  saveCfData(); renderCashFlow(); saveExtDataToKV();
}
async function cfEntryDeleteXfer(){
  const ym=_cfEntry?.xferYm; if(!ym) return;
  if(await cfXferDelete(ym)) cfEntryClose();
}
function cfEntrySave(){
  if (isMobileLayout()||!_cfEntry) return;
  const errEl=document.getElementById('cf-entry-error');
  const fail=msg=>{ if(errEl){ errEl.textContent=msg; errEl.hidden=false; } };
  const t=_cfEntry.tab;
  if(t==='wife') return cfWifeSave(fail);
  const cat=_cfEntryVal('cf-e-cat'), desc=_cfEntryVal('cf-e-desc'), amt=_cfEntryNum('cf-e-amt');
  if(!desc) return fail('내용을 입력하세요.');
  if(!(amt>0)) return fail('금액을 입력하세요.');
  if(t==='auto'){
    const cycle=_cfEntryVal('cf-e-cycle')||'monthly';
    const dom=Math.min(31,Math.max(1,parseInt(_cfEntryVal('cf-e-dom'),10)||1));
    const dow=parseInt(_cfEntryVal('cf-e-dow'),10)||0;
    cfEntryClose();
    addAutoTransfer({type:'지출',cat,desc,amt,cycle,dom,dow,owner:CF_XFER_TO,
      isFixedCost:!!document.getElementById('cf-e-fixed')?.checked,isGift:!!document.getElementById('cf-e-gift')?.checked});
    return;
  }
  const date=_cfEntryVal('cf-e-date');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('날짜를 입력하세요.');
  const type=t==='mine'?'수입':'지출';
  const idx=_cfEntry.editIdx;
  if(idx>-1){
    const prev=cfData[idx];
    if(!prev) return fail('고치려던 기록을 찾지 못했습니다. 창을 닫고 다시 시도하세요.');
    // 자동이체의 '이 달만' 기록은 연결(atId·isAuto)을 지켜야 예정 줄이 다시 생겨 두 번 세지 않는다
    const keep={};
    ['atId','isAuto','scheduleMonth','cycleLabel'].forEach(k=>{ if(prev[k]!=null) keep[k]=prev[k]; });
    cfData[idx]=Object.assign(keep,{date,type,cat,desc,amt,owner:prev.owner||CF_XFER_TO});
  } else cfData.push({date,type,cat,desc,amt,owner:CF_XFER_TO});
  cfYear=Number(date.slice(0,4)); cfMonth=Number(date.slice(5,7));
  cfEntryClose();
  saveCfData(); renderCashFlow(); saveExtDataToKV();
}

function setCfOwner(owner, btn) {
  _cfOwner = owner;
  document.querySelectorAll('[id^="cf-owner-"]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const fixedOwner=document.getElementById('cf-fixed-owner');if(fixedOwner&&owner!=='전체')fixedOwner.value=owner;
  renderCfDivPanel();
  renderCashFlow();
  renderFixedCostView();
}

function renderCfDivPanel() {
  const el = document.getElementById('cf-div-panel');
  if (!el) return;
  const year = String(cfYear);
  if (!window.divHistory || !window.divHistory[year]) { el.innerHTML = ''; el.style.display = 'none'; return; }
  const owners = _cfOwner === '전체' ? CF_OWNERS : [_cfOwner];
  const monthly = Array(12).fill(0);
  owners.forEach(ow => {
    const od = window.divHistory[year][ow];
    if (!od) return;
    od.forEach((v, i) => { monthly[i] += (v || 0); });
  });
  const total = monthly.reduce((s, v) => s + v, 0);
  if (total === 0) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  const maxV = Math.max(...monthly, 1);
  const nowM = new Date().getMonth();
  const bars = monthly.map((v, i) => {
    const pct = (v / maxV * 100).toFixed(1);
    const isNow = i === nowM && String(cfYear) === String(new Date().getFullYear());
    return `<div style="display:flex;flex-direction:column;align-items:center;flex:1;gap:2px">
      <div style="width:100%;background:var(--inner-bg);border-radius:3px;height:36px;display:flex;align-items:flex-end">
        <div style="width:100%;height:${pct}%;background:${isNow?'var(--acc)':'var(--acc3)'};border-radius:3px;min-height:${v>0?'3px':'0'}"></div>
      </div>
      <div style="font-size:var(--fs-cap);color:var(--t3)">${i+1}월</div>
      ${v > 0 ? `<div style="font-size:var(--fs-cap);color:var(--t2);white-space:nowrap">₩${(v/10000).toFixed(0)}만</div>` : ''}
    </div>`;
  }).join('');
  el.innerHTML = `
    <div class="card-title" style="margin-bottom:6px">${cfScopeLabel()} ${year}년 배당 수입 <span style="font-size:var(--fs-cap);font-weight:normal;color:var(--acc)">₩${Math.round(total).toLocaleString()}</span></div>
    <div style="display:flex;gap:2px;align-items:flex-end;padding:4px 0">${bars}</div>`;
}

function initCfDropdowns() {
  const yrSel=document.getElementById('cf-sel-year'),moSel=document.getElementById('cf-sel-month');
  let yHtml='',mHtml='';
  for(let y=2024;y<=2030;y++)yHtml+=`<option value="${y}">${y}년</option>`;
  for(let m=1;m<=12;m++)mHtml+=`<option value="${m}">${m}월</option>`;
  yrSel.innerHTML=yHtml;moSel.innerHTML=mHtml;
}

function changeCfDate(){cfYear=parseInt(document.getElementById('cf-sel-year').value);cfMonth=parseInt(document.getElementById('cf-sel-month').value);renderCashFlow();}

// divKey에서 정규화된 키 추출 (티커 suffix 제거, 월 leading zero 제거)
function _normDivKey(divKey) {
  if (!divKey) return null;
  const parts = divKey.split('_');
  if (parts.length < 5) return divKey;
  // 형식: div_TICKER_OWNER_YR_MO
  const tkrNorm = parts[1].toUpperCase().replace(/\.(KS|KQ)$/i,'');
  const yr = parts[parts.length - 2];
  const mo = String(parseInt(parts[parts.length - 1], 10)); // leading zero 제거
  const ownerParts = parts.slice(2, -2).join('_');
  return `div_${tkrNorm}_${ownerParts}_${yr}_${mo}`;
}

// 배당 중복 항목 정리: 동일 desc+owner+년+월인 배당금 항목 중 최신 1개만 유지
function cleanupDuplicateDivEntries() {
  const seen = new Map();
  const toRemove = new Set();
  cfData.forEach((entry, idx) => {
    if (entry.type !== '수입' || entry.cat !== '배당금') return;
    // divKey 있는 항목은 정규화된 divKey 기준으로 중복 처리
    if (entry.divKey) {
      const key = _normDivKey(entry.divKey);
      if (seen.has(key)) {
        const prevIdx = seen.get(key);
        const prev = cfData[prevIdx];
        const entryResolved = entry.date !== '미정';
        const prevResolved = prev.date !== '미정';
        if (entryResolved && !prevResolved) {
          // 현재 항목이 확정일, 이전이 미정 → 이전 제거
          toRemove.add(prevIdx); seen.set(key, idx);
        } else if (!entryResolved && prevResolved) {
          // 이전이 확정일, 현재가 미정 → 현재 제거
          toRemove.add(idx);
        } else if (entryResolved && prevResolved) {
          // 둘 다 확정일: 더 나중 날짜 유지
          const dt = new Date(entry.date), prevDt = new Date(prev.date);
          if (dt > prevDt) { toRemove.add(prevIdx); seen.set(key, idx); }
          else toRemove.add(idx);
        } else {
          // 둘 다 미정: 먼저 등록된 것(idx가 낮은 것) 유지
          toRemove.add(idx);
        }
      } else {
        seen.set(key, idx);
      }
      return;
    }
    // divKey 없는 레거시 항목: desc/owner/연/월 기준
    const dt = new Date(entry.date);
    const yr = isNaN(dt.getFullYear()) ? 0 : dt.getFullYear();
    const mo = isNaN(dt.getMonth()) ? -1 : dt.getMonth();
    const key = `${entry.desc||''}_${entry.owner||''}_${yr}_${mo}`;
    if (seen.has(key)) {
      const prevIdx = seen.get(key);
      const prev = cfData[prevIdx];
      const prevDate = new Date(prev.date);
      if (dt > prevDate || (dt.getTime() === prevDate.getTime() && entry.divKey && !prev.divKey)) {
        toRemove.add(prevIdx);
        seen.set(key, idx);
      } else {
        toRemove.add(idx);
      }
    } else {
      seen.set(key, idx);
    }
  });
  if (toRemove.size > 0) {
    cfData = cfData.filter((_, idx) => !toRemove.has(idx));
    saveCfData();
  }
  // 2차 정리: divKey가 없는 배당금 항목 중 같은 (desc, owner, 연, 월) 조합이 여러 날짜로 존재하는 경우
  const seen2 = new Map();
  const toRemove2 = new Set();
  cfData.forEach((entry, idx) => {
    if (entry.type !== '수입' || entry.cat !== '배당금' || entry.divKey) return;
    const dt = new Date(entry.date);
    const yr2 = isNaN(dt.getFullYear()) ? 0 : dt.getFullYear();
    const mo2 = isNaN(dt.getMonth()) ? -1 : dt.getMonth();
    const key2 = `${entry.desc||''}_${entry.owner||''}_${yr2}_${mo2}`;
    if (seen2.has(key2)) {
      const prevIdx = seen2.get(key2);
      const prev = cfData[prevIdx];
      const prevDt = new Date(prev.date);
      if (dt > prevDt) { toRemove2.add(prevIdx); seen2.set(key2, idx); }
      else toRemove2.add(idx);
    } else {
      seen2.set(key2, idx);
    }
  });
  if (toRemove2.size > 0) {
    cfData = cfData.filter((_, idx) => !toRemove2.has(idx));
    saveCfData();
  }
  // 3차 정리: owner 없는 레거시 배당 항목이 divKey 있는 항목과 같은 desc+년+월이면 레거시 제거
  const divKeyMonthSet = new Set();
  cfData.forEach(e => {
    if (!e.divKey || e.type !== '수입' || e.cat !== '배당금') return;
    const dt = e.date === '미정' ? null : new Date(e.date);
    const eyr = dt ? dt.getFullYear() : parseInt(e.divKey.split('_').slice(-2)[0]);
    const emo = dt ? dt.getMonth() : parseInt(e.divKey.split('_').slice(-1)[0]) - 1;
    divKeyMonthSet.add(`${e.desc}_${eyr}_${emo}`);
  });
  const toRemove3 = new Set();
  cfData.forEach((entry, idx) => {
    if (entry.divKey || entry.type !== '수입' || entry.cat !== '배당금') return;
    const dt2 = new Date(entry.date);
    if (isNaN(dt2)) return;
    const key3 = `${entry.desc}_${dt2.getFullYear()}_${dt2.getMonth()}`;
    if (divKeyMonthSet.has(key3)) toRemove3.add(idx);
  });
  if (toRemove3.size > 0) {
    cfData = cfData.filter((_, idx) => !toRemove3.has(idx));
    saveCfData();
  }
}

// 자동 배당 기록의 날짜 — 공시된 지급일(payDates)이 그 달에 있으면 그 날, 아니면 최빈 지급일을 영업일로(divPayDateFor, 배당 화면·일정과 같은 규칙)
function _divPayDateStr(yr,mo0,payDay,payDates){
  const hit=typeof divPayDateFor==='function'?divPayDateFor({payDay,payDates},yr,mo0):null;
  const d=hit?hit.date:(typeof divPayBusinessDay==='function'?divPayBusinessDay(yr,mo0,payDay):new Date(yr,mo0,Math.min(payDay,new Date(yr,mo0+1,0).getDate())));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
// 미정 배당 항목을 확정일로 업데이트 (fetchDivData 후 호출)
function resolvePendingDivDates() {
  let changed = false;
  cfData.forEach(entry => {
    if (entry.dateStatus !== 'pending' || !entry.divKey) return;
    const parts = entry.divKey.split('_'); // div_TKR_OWNER_YR_MO1
    if (parts.length < 5) return;
    const tkr = parts[1];
    const entryYr = parseInt(parts[parts.length - 2]);
    const entryMo1 = parseInt(parts[parts.length - 1]);
    if (!entryYr || !entryMo1) return;
    const cached = window._divDataCache?.[tkr] || DIV_INFO_DB?.[tkr];
    const payDay = (cached && typeof cached.payDay === 'number' && cached.payDay > 0) ? cached.payDay : null;
    if (!payDay) return;
    entry.date = _divPayDateStr(entryYr, entryMo1-1, payDay, cached.payDates);
    delete entry.dateStatus;
    changed = true;
  });
  if (changed) { saveCfData(); renderCashFlow(); }
}

// 10. 배당 수입 자동 등록 (등록된 배당주에서 계좌 유형별 자동 생성, 연간 세금 반영)
async function autoAddDividendCashFlow(silent=false) {
  const beforeCleanup=JSON.stringify(cfData);
  cleanupDuplicateDivEntries();
  let changed=JSON.stringify(cfData)!==beforeCleanup;
  const divStocks = getDivStocks();
  // 현재 캐시플로우 뷰의 선택 연/월 기준으로 생성 (cfYear/cfMonth가 없으면 오늘 기준)
  const yr = (typeof cfYear !== 'undefined' ? cfYear : new Date().getFullYear());
  const mo = (typeof cfMonth !== 'undefined' ? cfMonth - 1 : new Date().getMonth()); // 0-based
  let added = 0;
  const cycleMap = {'월배당':'월배당','분기':'분기배당','반기':'반기배당','연간':'연간배당'};

  // ISA 200만원 공제는 월·종목·계좌마다 따로 적용하면 안 된다. 현재 보유 전체의
  // 연간 예상 배당을 한 번에 세금 엔진에 넣고, 계산된 세후 비율을 이번 달 지급액에 적용한다.
  const annualLots=[];
  const scheduleKnownTickers=new Set();
  divStocks.forEach(s => {
    // 금액·지급월은 배당 화면과 같은 단일 출처(core/dividend.js divPerPaymentDps·divPayMonthsOf).
    // 내장 배당표(_divSource 'db', 고정값)로는 금액을 만들지 않는다 — 배당 화면에 없는 배당이 기록되던 원인이다.
    if(s._divSource==='db') return;
    const eps=divPerPaymentDps(s);
    const reported=(Array.isArray(s.months)?s.months:[]).map(Number).filter(m=>Number.isInteger(m)&&m>=0&&m<12);
    const months=divPayMonthsOf(s);
    if(eps<=0||months.length===0) return;
    const rate = curRate(s.cur);
    const tkrNorm = String(s.tkr||'').toUpperCase().replace(/\.(KS|KQ)$/i,'');
    // 캐시/API에서 확인한 일정만 파괴적 stale 정리의 근거로 사용한다. 지급월을 받지 못해 주기로 짐작한 일정
    // (reported 가 빈 경우)은 '이 달은 지급 없음'의 근거가 아니다.
    if(s._divSource==='cache'&&reported.length) scheduleKnownTickers.add(tkrNorm);
    const cycleLabel = cycleMap[s.cycle]||s.cycle||'배당';
    const holdings = pfolioData.filter(i => {
      const t6 = String(i.tkr||'').toUpperCase().replace(/\.(KS|KQ)$/i,'');
      return (t6 === tkrNorm || i.tkr === s.tkr) && Number(i.qty)>0;
    });
    holdings.forEach(item => {
      if(!item.owner) return;
      const payout=Number(item.qty)*eps*rate;
      if(!(payout>0)) return;
      const taxInfo=getAccountDivTaxInfo(item.acc);
      annualLots.push({
        owner:item.owner,
        acc:item.acc,
        gross:payout*months.length,
        ref:{s,tkrNorm,cycleLabel,months,payout,taxInfo}
      });
    });
  });

  // divKey는 기존 6-part 형식을 유지하되 같은 소유주·종목·계좌유형의 복수 계좌는
  // 한 항목으로 합산한다. 이 방식은 기존 삭제 키와 호환되면서 두 번째 계좌 누락을 막는다.
  const monthlyGroups=new Map();
  const deletedManagedKeys=new Set();
  allocateDividendTax(annualLots).list.forEach(entry=>{
    const ref=entry.ref;
    if(!ref.months.includes(mo)) return;
    const owner=entry.owner;
    const accType=entry.info.type;
    const divKey=`div_${ref.tkrNorm}_${owner}_${accType}_${yr}_${mo+1}`;
    const legacyDivKey=`div_${ref.tkrNorm}_${owner}_${yr}_${mo+1}`;
    const legacyNorm=_normDivKey(legacyDivKey);
    const wasDeleted=cfDeletedKeys.some(key=>{
      if(typeof key!=='string'||!key.startsWith('div:')) return false;
      const raw=key.slice(4);
      if(raw===divKey) return true;
      return raw.split('_').length===5&&_normDivKey(raw)===legacyNorm;
    });
    if(wasDeleted){deletedManagedKeys.add(divKey);return;}
    const netRatio=entry.gross>0?entry.net/entry.gross:1;
    const netPayout=ref.payout*netRatio;
    const existing=monthlyGroups.get(divKey);
    if(existing){ existing.net+=netPayout; return; }
    const payDay=(typeof ref.s.payDay==='number'&&ref.s.payDay>0)?ref.s.payDay:null;
    monthlyGroups.set(divKey,{
      divKey,owner,net:netPayout,payDay,
      dateStr:payDay?_divPayDateStr(yr,mo,payDay,ref.s.payDates):'미정',
      desc:`${ref.s.name} ${ref.cycleLabel} 수입 (${ref.taxInfo.label})`
    });
  });

  monthlyGroups.forEach(group=>{
    const net=Math.round(group.net);
    if(net<=0) return;
    const existingIdx=cfData.findIndex(i=>i.divKey===group.divKey);
    if(existingIdx>=0){
      const current=cfData[existingIdx];
      let rowChanged=false;
      if(current.desc!==group.desc){current.desc=group.desc;rowChanged=true;}
      if(Number(current.amt)!==net){current.amt=net;rowChanged=true;}
      // 확정 지급일은 변경도 반영하되, 확인된 날짜를 미정으로 되돌리지는 않는다.
      if(group.payDay&&(current.date!==group.dateStr||current.dateStatus==='pending')){
        current.date=group.dateStr;
        delete current.dateStatus;
        rowChanged=true;
      }
      if(rowChanged){changed=true;added++;}
      return;
    }
    const row={date:group.dateStr,type:'수입',cat:'배당금',desc:group.desc,amt:net,owner:group.owner,divKey:group.divKey};
    if(!group.payDay) row.dateStatus='pending';
    cfData.push(row);
    changed=true;
    added++;
  });

  // 현재 연·월에 앱이 만든 6-part 자동 배당 중 더 이상 계산되지 않는 행을 제거한다.
  // 자산 원장에서 보유/계좌유형 소멸이 확정됐거나 해당 종목의 정상 배당 일정이 있을 때만
  // 제거해, 배당 API 실패·부분 응답을 '배당 없음'으로 오인해 정상 행을 지우지 않게 한다.
  const beforeStaleCleanup=cfData.length;
  cfData=cfData.filter(entry=>{
    if(entry.type!=='수입'||entry.cat!=='배당금'||!entry.divKey) return true;
    const parts=entry.divKey.split('_');
    const isManaged=parts.length===6&&parts[0]==='div'&&['ISA','연금','일반'].includes(parts[3]);
    if(!isManaged||String(parts[4])!==String(yr)||String(parseInt(parts[5],10))!==String(mo+1)) return true;
    if(monthlyGroups.has(entry.divKey)) return true;
    if(deletedManagedKeys.has(entry.divKey)) return false;
    const rowTicker=String(parts[1]||'').toUpperCase().replace(/\.(KS|KQ)$/i,'');
    const stillHeld=pfolioData.some(item=>{
      const itemTicker=String(item.tkr||'').toUpperCase().replace(/\.(KS|KQ)$/i,'');
      return Number(item.qty)>0&&itemTicker===rowTicker&&item.owner===parts[2]
        &&getAccountDivTaxInfo(item.acc).type===parts[3];
    });
    return stillHeld&&!scheduleKnownTickers.has(rowTicker);
  });
  if(cfData.length!==beforeStaleCleanup) changed=true;
  // 레거시 combined entry(div_TKR_OWNER_YR_MO; 5 parts) 정리 — 새 account-aware entry로 대체된 항목 제거
  const accAwareKeys = new Set();
  cfData.forEach(e => {
    if (!e.divKey) return;
    const p = e.divKey.split('_');
    // div_TKR_OWNER_ACCTYPE_YR_MO → 6 parts
    if (p.length === 6) accAwareKeys.add(`${p[1]}_${p[2]}_${p[4]}_${p[5]}`);
  });
  if (accAwareKeys.size > 0) {
    const before = cfData.length;
    cfData = cfData.filter(e => {
      if (!e.divKey) return true;
      const p = e.divKey.split('_');
      if (p.length === 5) {
        const k = `${p[1]}_${p[2]}_${p[3]}_${p[4]}`;
        if (accAwareKeys.has(k)) return false;
      }
      return true;
    });
    if (cfData.length !== before) changed=true;
  }
  // 레거시 no-divKey 항목 정리 — divKey 없는 배당금 항목 중 같은 종목명+소유주+년+월에
  // 새 account-aware entry가 있으면 제거 (예: "삼성전자 분기배당 수입" 구 항목)
  const noDivKeyBefore = cfData.length;
  const accAwareNameOwnerSet = new Set();
  cfData.forEach(e => {
    if (!e.divKey) return;
    const p = e.divKey.split('_');
    if (p.length === 6) {
      const tkrNorm2 = p[1];
      const s2 = divStocks.find(d => String(d.tkr||'').toUpperCase().replace(/\.(KS|KQ)$/i,'') === tkrNorm2);
      if (s2) accAwareNameOwnerSet.add(`${s2.name}_${p[2]}_${p[4]}_${p[5]}`);
    }
  });
  if (accAwareNameOwnerSet.size > 0) {
    cfData = cfData.filter(e => {
      if (e.divKey || e.type !== '수입' || e.cat !== '배당금') return true;
      const dt2 = e.date === '미정' ? null : new Date(e.date);
      if (!dt2 || isNaN(dt2)) return true;
      const ey2 = String(dt2.getFullYear()), em2 = String(dt2.getMonth() + 1);
      for (const k of accAwareNameOwnerSet) {
        const [kName,,kYr,kMo] = k.split('_');
        const kOwner = k.split('_')[1];
        if (e.desc && e.desc.includes(kName) && (e.owner === kOwner || !e.owner) && ey2 === kYr && em2 === kMo) return false;
      }
      return true;
    });
    if (cfData.length !== noDivKeyBefore) changed=true;
  }
  // 레거시 배당금 entry desc 보강:
  // divKey 없거나 5-part 인 배당금 항목 중 세금 라벨이 없는 경우, pfolioData 에서
  // 종목/소유주 매칭하여 계좌 타입 기반 세금 라벨 부착 + 6-part divKey 부여.
  let enriched = 0;
  cfData.forEach(e => {
    if (e.type !== '수입' || e.cat !== '배당금') return;
    const has6Part = e.divKey && e.divKey.split('_').length === 6;
    if (has6Part) return;
    // 이미 신규 포맷 세금 라벨(괄호 안 ',' 포함)이 있으면 skip
    if (/\([^)]*,\s*[^)]+\)\s*$/.test(e.desc||'')) return;
    if (!e.owner || !e.date || e.date === '미정') return;
    // desc 가 종목명으로 시작하는 경우만 매칭 (부분 일치 오탐 방지)
    const match = pfolioData.find(p =>
      p.grp === '주식' && p.qty > 0 && p.owner === e.owner &&
      p.name && e.desc && e.desc.startsWith(p.name)
    );
    if (!match) return;
    const taxInfo = getAccountDivTaxInfo(match.acc);
    // 끝의 괄호 그룹 제거 후 신규 라벨 부착
    const newDesc = (e.desc.replace(/\s*\([^)]*\)\s*$/, '') + ` (${taxInfo.label})`).trim();
    if (newDesc !== e.desc) {
      e.desc = newDesc;
      enriched++;
    }
    // 6-part divKey 부여 (다음 실행 시 정리/업데이트 로직과 호환)
    const dt = new Date(e.date);
    if (!isNaN(dt)) {
      const tkrNorm = String(match.tkr||'').toUpperCase().replace(/\.(KS|KQ)$/i,'');
      e.divKey = `div_${tkrNorm}_${e.owner}_${taxInfo.type}_${dt.getFullYear()}_${dt.getMonth()+1}`;
    }
  });
  if (enriched > 0) changed=true;
  if(changed) globalThis._cfRemoteDirty=true;
  if(changed||globalThis._cfRemoteDirty===true){
    if(changed){saveCfData();renderCashFlow();}
    // 실패 시 dirty를 유지해 다음 호출이 무변경이어도 원격 저장을 다시 시도한다.
    const saved=typeof saveExtDataToKV==='function'?await saveExtDataToKV():{ok:true,skipped:true};
    if(saved?.ok!==false) globalThis._cfRemoteDirty=false;
    if(added>0&&!silent) alert(`${added}건의 배당 수입이 자동 등록되었습니다.`);
    return {ok:saved?.ok!==false,changed,added,enriched,saved,retried:!changed};
  }
  return {ok:true,changed:false,added:0,enriched:0};
}

async function deleteCF(idx){
  if (isMobileLayout()) return; // 모바일은 조회 전용
  if(cfData[idx]&&cfData[idx].xferRole) return cfXferDelete(cfData[idx].xferMonth);
  if(confirm('내역을 삭제하시겠습니까?')){
    const item=cfData[idx];
    rememberCfDeletion(item);
    cfData.splice(idx,1);
    saveCfData();
    renderCashFlow();
    await saveExtDataToKV();
  }
}
// 내역의 ✎ — 같은 기록 창을 수정 모드로 연다. 송금 묶음 줄(in·out·est)은 '아내 월급·송금' 탭으로 연다.
function editCF(idx){
  if (isMobileLayout()) return; // 모바일은 조회 전용
  const item=cfData[idx];
  if(!item) return;
  if(item.xferRole) return cfEntryOpen('in','wife');
  const income=item.type==='수입';
  cfEntryOpen(income?'in':'out', income?'mine':'once', idx);
}

// ── 수입이 어떻게 나뉘었나 — 6개월 누적 막대(2026-11-26 사용자 결정) ──
// 예전 '순현금흐름 추이'(Chart.js 막대)와 '저축률 추이' 두 카드를 대신한다. 달마다 cfMonthTotals 한 곳의 값을
// 쓴 돈 · 아내 지출(추정) · 보낸 돈(아내 탭) · 저축/투자 · 남은 돈으로 나눌 뿐 새 계산이 없다. 위 숫자는 cfSavingRate 의 저축률,
// 아래 숫자는 순현금흐름(수입 − 지출)이다 — 선택 달 요약과 같은 값.
function cfStackRows(y, m){
  const rows=[];
  for(let i=5;i>=0;i--){
    const d=new Date(y,m-1-i,1), yy=d.getFullYear(), mm=d.getMonth()+1;
    const t=cfMonthTotals(yy,mm), r=cfSavingRate(t);
    const est=t.expByCat[CF_XFER_EST_CAT]||0, xfer=t.expByCat[CF_XFER_CAT]||0;
    rows.push({y:yy,m:mm,tIn:t.tIn,tOut:t.tOut,sv:r.savingOut,est,xfer,spend:Math.max(0,t.tOut-r.savingOut-est-xfer),
      left:t.tIn-t.tOut,kept:r.kept,rate:r.rate});
  }
  return rows;
}
function cfStackHtml(rows){
  const segs=[['spend','쓴 돈',cfColors['기타']],['est',CF_XFER_EST_CAT,cfColors[CF_XFER_EST_CAT]],
    ['xfer',`${CF_XFER_TO}에게 보낸 돈`,ownerColors[CF_XFER_TO]],['sv','저축/투자',cfColors['저축/투자'],true],['left','남은 돈',CF_FLOW_REST_COLOR]];
  const used=segs.filter(([k])=>rows.some(r=>(k==='left'?r.left:r[k])>0));
  const won=v=>'₩'+Math.round(v).toLocaleString();
  const withIn=rows.filter(r=>r.tIn>0);
  const sumIn=withIn.reduce((s,r)=>s+r.tIn,0), sumKept=withIn.reduce((s,r)=>s+r.kept,0);
  const avg=sumIn>0?`<span class="cf-stack-avg">6개월 저축률 <b>${(sumKept/sumIn*100).toFixed(1)}%</b></span>`:'';
  const cols=rows.map((r,i)=>{
    const last=i===rows.length-1, base=Math.max(r.tIn,r.tOut);
    const label=r.rate==null?'—':r.rate<0?'적자':`${Math.round(r.rate)}%`;
    const net=r.tIn||r.tOut?`${r.left>0?'+':''}${cfShortWon(r.left)}`:'—';
    if(!base) return `<div class="cf-stack-col is-none${last?' is-on':''}" title="${r.y}년 ${r.m}월 · 기록 없음"><b>—</b><span class="cf-stack-bar"></span><small>${r.m}월</small><em>—</em></div>`;
    const bars=used.slice().reverse().map(([k,l,c,hatch])=>{
      const v=Math.max(0,k==='left'?r.left:r[k]);
      if(!v) return '';
      const of=r.tIn>0?` (수입의 ${Math.round(v/r.tIn*100)}%)`:'';
      return `<i class="${hatch?'is-saving':''}" style="height:${(v/base*100).toFixed(2)}%;background:${c}" title="${r.m}월 ${l} ${won(v)}${of}"></i>`;
    }).join('');
    const tip=r.rate==null?`${r.y}년 ${r.m}월 · 수입 기록 없음`:r.rate<0?`${r.y}년 ${r.m}월 · 수입 ${won(r.tIn)}보다 ${won(-r.kept)} 더 씀 (저축률 ${Math.round(r.rate).toLocaleString()}%)`:`${r.y}년 ${r.m}월 · 수입 ${won(r.tIn)} · 저축률 ${r.rate.toFixed(1)}%`;
    return `<div class="cf-stack-col${last?' is-on':''}${r.rate!=null&&r.rate<0?' is-neg':''}" title="${tip}"><b>${label}</b><span class="cf-stack-bar">${bars}</span><small>${r.m}월</small><em class="${r.left<0?'c-dn':''}">${net}</em></div>`;
  }).join('');
  const aria=rows.map(r=>`${r.m}월 ${r.rate==null?'수입 없음':r.rate<0?'적자':'저축률 '+Math.round(r.rate)+'%'}`).join(', ');
  return `<div class="cb-label f-between cf-stack-head"><span data-tip="막대 하나가 그 달 수입 100%입니다(지출이 수입보다 많으면 지출 100%). 위 숫자는 저축률 — 저축/투자는 자산으로 옮겨 간 돈이라 소비에서 빼고 셉니다. 아래 숫자는 그 달 남은 돈(순현금흐름)입니다.">수입이 어떻게 나뉘었나 (6개월)</span>${avg}</div>`
    +`<div class="cf-stack-chart" role="img" aria-label="최근 6개월 수입 나눔 — ${aria}">${cols}</div>`
    +`<div class="cf-stack-legend">${used.map(([,l,c,hatch])=>`<span><i class="${hatch?'is-saving':''}" style="background:${c}"></i>${_cfEsc(l)}</span>`).join('')}</div>`
    +`<p class="cf-stack-note">위 = 저축률(저축/투자 + 남은 돈 ÷ 수입) · 아래 = 남은 돈(순현금흐름)</p>`;
}

function renderCashFlow() {
  cfSpouseSyncAndSave();
  document.getElementById('cf-sel-year').value=cfYear;document.getElementById('cf-sel-month').value=cfMonth;
  // 상세 내역은 한 사람 것만 보인다(2026-11-26 사용자 결정) — 아내 몫은 월급·송금 두 숫자로만 적으므로 평소에는 본인 기록이고,
  // 아내 탭에서만 아내 줄(월급·송금·지출 추정)을 보인다. 그래서 소유주 칸이 없다.
  const listOwner=_cfOwner===CF_XFER_FROM?CF_XFER_FROM:CF_XFER_TO;
  const ym=cfYear+'-'+String(cfMonth).padStart(2,'0');
  const f=cfData.filter(i=>i&&i.owner===listOwner&&_cfRowYm(i)===ym).sort((a,b)=>{if(a.date==='미정')return 1;if(b.date==='미정')return -1;return new Date(b.date)-new Date(a.date);});
  // 합계는 cfMonthTotals 한 곳 — 아래 표 그리기는 줄만 만든다(합계를 따로 더하지 않는다)
  const {tIn,tOut,expByCat}=cfMonthTotals(cfYear,cfMonth);
  let html='';
  f.forEach(i=>{
    const realIdx=cfData.findIndex(x=>x===i);
    const amount=Number(i.amt)||0;
    if(i.xferRole){
      // 송금 묶음 줄 — ✎ 는 '아내 월급·송금' 창, ✕ 는 묶음 전체를 지운다
      const moving=cfIsXferMove(i), excluded=!cfRowCounts(i);
      const sgn=excluded?'':(i.type==='수입'?'+':'-'), col=excluded?'var(--t3)':(i.type==='수입'?'var(--up)':'var(--dn)');
      const typeCell=moving?`<span class="cf-xfer-tag">송금</span>`:`<span style="color:var(--dn);font-weight:700">지출</span>`;
      const desc=_cfEsc(i.desc)+(excluded?' <small style="color:var(--t3)">(합계 제외)</small>':(i.xferRole==='est'?' <small style="color:var(--t3)">(추정)</small>':''));
      html+=`<tr class="${excluded?'cf-row-muted':''}"><td class="text-left">${_cfEsc(i.date.substring(5).replace('-','/'))}</td><td class="text-left">${typeCell}</td><td class="text-left" data-overflow-tip="${_cfEsc(i.cat)}">${_cfEsc(i.cat)}</td><td class="text-left" data-overflow-tip="${_cfEsc(i.desc)}">${desc}</td><td style="color:${col}" class="text-right">${sgn}₩${amount.toLocaleString()}</td><td class="text-right"><span style="font-size:var(--fs-cap);color:var(--t3)">매월 기록</span></td><td class="text-right" style="white-space:nowrap"><button class="btn-action" type="button" aria-label="${CF_XFER_FROM} 월급·송금 수정" onclick="cfEntryOpen('in','wife')">✎</button><button class="btn-action" type="button" aria-label="부부 송금 삭제" onclick="cfXferDelete('${_cfEsc(i.xferMonth)}')">✕</button></td></tr>`;
      return;
    }
    let cls=i.type==='수입'?'var(--up)':'var(--dn)',sign=i.type==='수입'?'+':'-';
    let fd=i.date==='미정'?'미정':i.date.substring(5).replace('-','/');
    // 주기 칸은 주기만 적는다 — '자동이체 · 매월 15일'은 칸 폭(88px)을 넘어 '자동이…'로 잘렸다(2026-11-24).
    // 자동이체라는 사실은 내용 칸의 [자동] 머리말과 마우스 설명(title)에 있다.
    const cycleDisp=i.isAuto?`<span class="cf-cycle-text" title="자동이체${i.cycleLabel?' · '+_cfEsc(i.cycleLabel):''}">${_cfEsc(i.cycleLabel||'자동이체')}</span>`:`<span class="cf-cycle-text">일회성</span>`;
    html+=`<tr><td class="text-left">${_cfEsc(fd)}</td><td class="text-left"><span style="color:${cls};font-weight:700">${_cfEsc(i.type)}</span></td><td class="text-left">${_cfEsc(i.cat)}</td><td class="text-left" data-overflow-tip="${_cfEsc(i.desc)}">${_cfEsc(i.desc)}</td><td style="color:${cls}" class="text-right">${sign}₩${amount.toLocaleString()}</td><td class="text-right">${cycleDisp}</td><td class="text-right" style="white-space:nowrap"><button class="btn-action" type="button" aria-label="현금흐름 수정" onclick="editCF(${realIdx})">✎</button><button class="btn-action" type="button" aria-label="현금흐름 삭제" onclick="deleteCF(${realIdx})">✕</button></td></tr>`;
  });
  // 자동이체 가상 행: 각 자동이체별로 해당 월의 실제/레거시 [자동] 항목이 없으면 예정 행 표시(금액은 한 달 합계와 같은 _cfAutoTransferMonthAmount)
  autoTransferData.forEach(at=>{
    if(!at||at.owner!==listOwner) return;
    const total=_cfAutoTransferMonthAmount(at,cfYear,cfMonth);
    if(!total) return;
    const monthlyCycle=['monthly','month-end','month-start'].includes(at.cycle);
    const monthlyOccurrences=monthlyCycle?_autoTransferMonthlyOccurrences(at,cfYear,cfMonth):[];
    const atCls = at.type === '수입' ? 'var(--up)' : 'var(--dn)';
    const atSign = at.type === '수입' ? '+' : '-';
    const cycleLbl = _getCycleLabel(at);
    const safeAtId=Number.isSafeInteger(Number(at.id))?Number(at.id):0;
    const scheduledLabel=monthlyOccurrences.length
      ? _cfLocalDateKey(monthlyOccurrences[0].date).substring(5).replace('-','/')
      : '-';
    html+=`<tr style="opacity:.75">
      <td class="text-left">${scheduledLabel}</td>
      <td class="text-left"><span style="color:${atCls};font-weight:700">${_cfEsc(at.type)}</span></td>
      <td class="text-left">${_cfEsc(at.cat||'-')}</td>
      <td class="text-left"><span style="color:var(--t3)">[예정]</span> ${_cfEsc(at.desc||'자동이체')}</td>
      <td style="color:${atCls}" class="text-right">${atSign}₩${total.toLocaleString()}</td>
      <td class="text-right"><span style="font-size:var(--fs-cap);color:var(--t3)">${_cfEsc(cycleLbl)}</span></td>
      <td class="text-right" style="white-space:nowrap">
        <button class="btn-action" title="이 달 금액 수정" onclick="editAutoTransferMonth(${safeAtId},${cfYear},${cfMonth})">✎</button>
        <button class="btn-action" title="이 달만 삭제" onclick="skipAutoTransferMonth(${safeAtId},${cfYear},${cfMonth})">✕</button>
      </td>
    </tr>`;
  });
  document.getElementById('cf-table-body').innerHTML=html||`<tr class="cf-empty-row"><td colspan="7">${typeof cbEmptyHtml==='function'?cbEmptyHtml(`${cfMonth}월 ${listOwner} 기록이 없습니다`,listOwner===CF_XFER_FROM?`${CF_XFER_FROM} 몫은 ＋ 수입 › ${CF_XFER_FROM} 월급·송금에서 월급과 보낸 돈만 적습니다.`:'월급·생활비처럼 들어오고 나간 돈을 적으면 흐름과 저축률이 계산됩니다. 매달 같은 지출은 자동이체로 한 번만 등록하세요.',listOwner===CF_XFER_FROM?[{label:`${CF_XFER_FROM} 월급·송금 적기`,onclick:"cfEntryOpen('in','wife')"}]:[{label:'＋ 수입',onclick:"cfEntryOpen('in')"},{label:'－ 지출',onclick:"cfEntryOpen('out')"}],{compact:true}):'내역이 없습니다.'}</td></tr>`;
  const listTitle=document.getElementById('cf-detail-title');
  if(listTitle) listTitle.innerHTML=`상세 내역 · ${_cfEsc(listOwner)}`+(listOwner===CF_XFER_TO?` <small>${CF_XFER_FROM} 몫은 ＋ 수입 › ${CF_XFER_FROM} 월급·송금에서</small>`:'');
  const sumTitle=document.getElementById('cf-sum-title');
  if(sumTitle) sumTitle.textContent=`${cfMonth}월 요약 · ${cfScopeLabel()}`;
  cfFlowRender();
  const sumEl=document.getElementById('cf-month-summary');
  if(sumEl)sumEl.innerHTML=cfMonthSummaryHtml(tIn,tOut,expByCat);
  const stackEl=document.getElementById('cf-stack');
  if(stackEl)stackEl.innerHTML=cfStackHtml(cfStackRows(cfYear,cfMonth));
  if(_cfSection==='fixed')renderFixedCostView();
}

// 짧은 금액 — 단일 구현 shortWon(core/data.js)의 별칭(배당 막대 위 금액과 같은 모양).
function cfShortWon(v){ return shortWon(v); }

// 선택한 달의 요약 — 이미 계산된 값만 쓴다(새 계산 없음).
// 저축률은 '저축/투자' 지출을 소비에서 되돌린다. 그 카테고리는 자산 이동이라 순자산을
// 줄이지 않고, finMonthlyFixedCost·finNetWorthBridge 도 같은 이유로 제외한다.
// 그래서 순현금흐름(통장에 남은 돈)과 저축률(소득 중 안 쓴 비율)은 서로 다른 숫자다.
function cfMonthSummaryHtml(tIn, tOut, expByCat){
  const {savingOut, rate} = cfSavingRate({tIn,tOut,expByCat});   // 6개월 누적 막대의 저축률과 같은 정의
  const net = tIn - tOut;
  const won = v => (v<0?'-₩':'₩') + Math.abs(Math.round(v)).toLocaleString();
  const fx = (typeof finMonthlyFixedCost==='function')
    ? finMonthlyFixedCost(_cfOwner==='전체'?null:_cfOwner) : {pendingCount:0,pendingMonthly:0};
  const pending = fx.pendingCount>0
    ? `<div class="cf-summary-pending"><span><b>자동이체 ${fx.pendingCount}건</b>이 고정비로 분류되지 않았습니다 (월 ${won(fx.pendingMonthly)}). 분류해야 월 필수지출과 현금 안전판이 맞게 나옵니다.</span>`
      + `<button type="button" onclick="switchCashFlowSection('fixed',document.getElementById('cf-section-tab-fixed'))">고정비 관리로</button></div>`
    : '';
  // 제목('N월 요약 · 부부 합계')과 달 이동 ◀ ▶ 는 카드 머리줄(#cf-sum-title)에 있다 — renderCashFlow 가 채운다
  return `<div class="cf-summary-row"><span>총 수입</span><b class="c-up">${won(tIn)}</b></div>`
    + `<div class="cf-summary-row"><span>총 지출</span><b class="c-dn">-${won(tOut).replace('-','')}</b></div>`
    + (savingOut>0?`<div class="cf-summary-row"><span style="padding-left:9px;color:var(--t3);font-size:var(--fs-cap)">└ 저축/투자 (자산 이동)</span><b style="font-size:var(--fs-body);color:var(--t2)">${won(savingOut)}</b></div>`:'')
    + `<div class="cf-summary-row is-net"><span>순현금흐름</span><b class="${net>0?'c-up':(net<0?'c-dn':'')}">${net===0?'₩0':(net>0?'+':'')+won(net)}</b></div>`
    + `<div class="cf-summary-row"><span data-tip="소득에서 소비지출을 뺀 비율입니다. '저축/투자' 지출은 통장에서 빠져나가도 자산으로 옮겨 간 돈이라 소비에서 제외합니다 — 그래서 순현금흐름과 다를 수 있습니다.">저축률</span>`
    + `<b${rate!=null&&rate<0?` class="c-dn" title="저축률 ${Math.round(rate).toLocaleString()}% — 수입보다 지출이 커 비율 대신 적자로 표시"`:''}>${rate==null?'—':rate<0?'적자':rate.toFixed(1)+'%'}</b></div>`
    + `<div class="cf-summary-rate-track"><i style="width:${rate==null?0:Math.max(0,Math.min(100,rate)).toFixed(1)}%"></i></div>`
    + pending
    + `<div class="cf-summary-note">이 달에 기록된 내역과 예정된 자동이체를 합산한 값입니다. 수입이 없는 달은 저축률을 내지 않습니다.</div>`;
}

function prevCfMonth(){cfMonth--;if(cfMonth<1){cfMonth=12;cfYear--;}renderCashFlow();}
function nextCfMonth(){cfMonth++;if(cfMonth>12){cfMonth=1;cfYear++;}renderCashFlow();}

let _cfDetailReturnFocus = null;
function closeCfDetails(){
  const parent=document.getElementById('cfDetailModal');
  if(!parent)return;
  parent.classList.remove('active');
  parent.setAttribute('aria-hidden','true');
  if(_cfDetailReturnFocus?.focus)_cfDetailReturnFocus.focus();
  _cfDetailReturnFocus=null;
}
