// 양도소득세 화면(tax2)·실현손익 기록·보유 반영 창·거래내역 가져오기 — cobalt.js 에서 옮겨 온 화면 렌더러(2026-11-23, 동작 변경 없음).
// cobalt.js 보다 먼저 로드한다(CB_VIEWS 가 이 파일의 렌더 함수를 참조한다). 맨 위에서는 함수·상태 선언만 하고,
// cobalt.js 의 상수·상태는 함수 안에서만 쓴다 — 로드 때 쓰면 아직 없는 이름이라 오류가 난다(test_source_split.mjs).

// ───────────────────────── 페이지: 양도소득세 ─────────────────────────
let _cbTaxDraft = { m:String(new Date().getMonth()+1), k:'domestic', acc:'일반', owner:'', pl:'', memo:'' }; // 구분 디폴트 = 국내주식
let _cbTaxYear = null;   // 조회 연도(문자열). null이면 올해.
let _cbTaxOwner = '전체'; // 소유주 필터 ('전체' 또는 소유주명)
let _cbTaxMonthFilter = null; // 차트 클릭으로 하단 내역을 거르는 월(1~12)
// 실현손익 내역의 달 묶음 펼침(2026-11-24) — null 이면 기본(기록이 있는 가장 최근 달만 펼침). 화면을 옮기면 cbResetViewState 가 되돌린다.
let _cbTaxMonthOpen = null;
let _cbTaxEditId = null; // 수정 중인 실현손익 기록 ID
const CB_TAX_ACCTS = ['일반','연금저축','ISA'];
const CB_TAX_FGN_DED=_taxRuleValue('capitalGains.foreignStockBasicDeductionKrw',2_500_000);
const CB_TAX_ISA_DED=_taxRuleValue('isa.generalExemptionKrw',2_000_000);
function cbTaxAcctOf(t){ return CB_TAX_ACCTS.indexOf(t.account)>=0 ? t.account : '일반'; }
function cbTaxTreatment(t){
  const account=cbTaxAcctOf(t);
  const when=t?.month||new Date();
  const isaRate=_taxRuleValue('isa.separateTaxCombinedRate',0.099,when);
  const foreignRate=_taxRuleValue('capitalGains.foreignStockCombinedRate',0.22,when);
  if (account==='연금저축') return {
    label:'과세이연', tone:'deferred',
    tip:'계좌 안의 매매차익은 매도 시 과세하지 않고 연금 수령 시점까지 과세를 미룹니다.'
  };
  if (account==='ISA') return {
    label:`${(isaRate*100).toFixed(1)}% 참고`, tone:'separate',
    tip:`실제 ISA는 계좌 유지기간 전체 손익을 만기·해지 때 정산합니다. 이 행은 ${isaRate*100}% 연간 현금흐름 참고 분류입니다.`
  };
  if (t.category==='domestic') return {
    label:'비과세', tone:'exempt',
    tip:'일반계좌 국내 상장주식의 소액주주 장내 양도차익 기준입니다.'
  };
  return {
    label:`${(foreignRate*100).toFixed(0)}% 대상`, tone:'taxable',
    tip:`일반계좌 해외주식은 연간 손익통산과 기본공제 후 지방소득세 포함 ${(foreignRate*100).toFixed(0)}% 세율을 적용하는 일반 사례입니다.`
  };
}
// 기본공제와 ISA 비과세 한도는 가구 합산이 아니라 소유주별로 적용한 뒤 세액만 더한다.
// owner가 없는 구버전 기록은 어느 사람의 공제를 써야 하는지 알 수 없으므로 별도 추정 버킷으로 둔다.
function cbTaxSummary(list, ownerOf, ownerHints=[], when){
  const ruleWhen=when||(list||[]).find(row=>row?.month)?.month||new Date();
  const foreignDeduction=_taxRuleValue('capitalGains.foreignStockBasicDeductionKrw',CB_TAX_FGN_DED,ruleWhen);
  const isaExemption=_taxRuleValue('isa.generalExemptionKrw',CB_TAX_ISA_DED,ruleWhen);
  const foreignRate=_taxRuleValue('capitalGains.foreignStockCombinedRate',0.22,ruleWhen);
  const isaRate=_taxRuleValue('isa.separateTaxCombinedRate',0.099,ruleWhen);
  const resolve=typeof ownerOf==='function'
    ? ownerOf
    : t=>(t&&t.owner&&t.owner!=='전체'?String(t.owner):null);
  const buckets=new Map();
  const ensure=(key,label,isLegacy=false)=>{
    if(!buckets.has(key)) buckets.set(key,{key,label,isLegacy,genFgn:0,genDom:0,isaNet:0,penNet:0});
    return buckets.get(key);
  };
  (ownerHints||[]).filter(Boolean).forEach(owner=>ensure('owner:'+owner,String(owner),false));
  (list||[]).forEach(t=>{
    if(!t) return;
    const owner=resolve(t);
    const row=owner?ensure('owner:'+owner,String(owner),false):ensure('__legacy__','소유주 미지정',true);
    const amount=Number(t.amt)||0, account=cbTaxAcctOf(t);
    if(account==='일반'){
      if(t.category==='domestic') row.genDom+=amount;
      else row.genFgn+=amount;
    } else if(account==='ISA') row.isaNet+=amount;
    else if(account==='연금저축') row.penNet+=amount;
  });
  const details=Array.from(buckets.values()).map(row=>{
    const genBase=Math.max(0,row.genFgn-foreignDeduction);
    const isaBase=Math.max(0,row.isaNet-isaExemption);
    const genDue=Math.round(genBase*foreignRate), isaDue=Math.round(isaBase*isaRate);
    return {...row,genBase,isaBase,genDue,isaDue,totalDue:genDue+isaDue,
      deductionRoom:Math.max(0,foreignDeduction-row.genFgn),
      deductionUsed:Math.max(0,Math.min(foreignDeduction,row.genFgn))};
  });
  const total=field=>details.reduce((sum,row)=>sum+(Number(row[field])||0),0);
  const legacy=details.find(row=>row.isLegacy)||null;
  return {
    buckets:details, legacy, legacyDue:legacy?.totalDue||0,
    knownDue:details.filter(row=>!row.isLegacy).reduce((sum,row)=>sum+row.totalDue,0),
    genFgn:total('genFgn'),genDom:total('genDom'),genBase:total('genBase'),genDue:total('genDue'),
    isaNet:total('isaNet'),isaBase:total('isaBase'),isaDue:total('isaDue'),penNet:total('penNet'),
    totalDue:total('totalDue'),deductionRoom:total('deductionRoom'),deductionUsed:total('deductionUsed'),
    foreignDeduction,isaExemption,foreignRate,isaRate,
    deductionGroups:details.length
  };
}
// ── 손실 상계 여력·소유주별 해외 기본공제(2026-11-24 사용자 결정) ──
// 새 세율·공제는 만들지 않는다 — cbTaxSummary 의 소유주별 genFgn·genBase 와 규칙값(tax-rules.js)만 쓴다.
// 손실 상계는 같은 사람의 해외 이익과만 되므로 소유주마다 min(평가손실, 공제 초과 과세표준) × 세율을 더한 최대치다.
function cbTaxHarvestPlan(buckets, candidates, rate){
  const base=new Map((buckets||[]).filter(b=>!b.isLegacy).map(b=>[b.label,Number(b.genBase)||0]));
  const lossBy=new Map();
  (candidates||[]).forEach(x=>{const o=x&&x.i&&x.i.owner; const l=Math.abs(Number(x&&x.loss)||0); if(o&&l>0) lossBy.set(o,(lossBy.get(o)||0)+l);});
  let loss=0, save=0;
  lossBy.forEach((l,o)=>{ loss+=l; save+=Math.round(Math.min(l, base.get(o)||0)*(Number(rate)||0)); });
  return {loss, save, count:(candidates||[]).filter(x=>Math.abs(Number(x&&x.loss)||0)>0).length};
}
// 부양가족으로 보는 소유주 — 자녀1 은 본인 연말정산의 부양가족이다(사용자 설명 2026-11-24).
// 해외주식 양도소득금액(이익)이 연 소득금액 기준(tax-rules.js dependent.basicDeductionIncomeLimitKrw)을 넘으면
// 다음 해 연말정산에서 부양가족 기본공제를 받지 못할 수 있으므로, 그 줄은 250만 공제가 아니라 이 기준으로 잰다.
const CB_TAX_DEPENDENT_OWNERS=['자녀1'];
function cbTaxOwnerDeductionRows(buckets, owners, deduction, dependentLimit, rate){
  const by=new Map((buckets||[]).filter(b=>!b.isLegacy).map(b=>[b.label,b]));
  return (owners||[]).map(owner=>{
    const gain=Number(by.get(owner)?.genFgn)||0;
    const dependent=CB_TAX_DEPENDENT_OWNERS.includes(owner)&&Number(dependentLimit)>0;
    const cap=dependent?Number(dependentLimit):Number(deduction)||0;
    const over=Math.max(0,gain-cap), room=Math.max(0,cap-Math.max(0,gain));
    const taxOver=Math.max(0,gain-(Number(deduction)||0));
    return {owner, gain, cap, dependent, over, room, used:cap>0?Math.max(0,Math.min(1,gain/cap)):0, due:Math.round(taxOver*(Number(rate)||0))};
  });
}
function cbTaxOwnerDeductionHtml(rows){
  const body=(rows||[]).map(r=>{
    const msg=r.dependent
      ? (r.over>0
          ? `부양가족 소득 기준 <b style="color:var(--dn)">${cbKrw(r.over)} 초과</b> — 다음 해 연말정산에서 부양가족 공제를 못 받을 수 있음`
          : `부양가족 소득 기준까지 <b style="color:var(--up)">${cbKrw(r.room)}</b> — 넘으면 다음 해 연말정산 부양가족 공제 제외`)
      : (r.over>0
          ? `공제 초과 <b style="color:var(--dn)">${cbKrw(r.over)}</b> · 예상 세액 ${cbKrw(r.due)}`
          : `남은 공제 <b style="color:var(--up)">${cbKrw(r.room)}</b> — 이만큼 이익을 실현해도 양도세 0`);
    return `<div class="cb-tax-od-row${r.dependent?' is-dependent':''}">
        <div class="cb-tax-od-head">${cbOwnerTag(r.owner)}<span class="cb-tax-od-tag">${r.dependent?'부양가족 기준 '+cbKrw(r.cap):'기본공제 '+cbKrw(r.cap)}</span><span class="cb-tax-od-gain">실현 ${r.gain?((r.gain>0?'+':'')+cbKrw(r.gain)):cbKrw(0)}</span></div>
        <div class="cb-tax-od-track"><i class="${r.over>0?'is-over':''}" style="width:${(r.used*100).toFixed(1)}%"></i></div>
        <div class="cb-tax-od-msg">${msg}</div>
      </div>`;
  }).join('');
  const depTip='연말정산 부양가족 기본공제는 그 사람의 연간 소득금액 합계가 기준 이하일 때만 됩니다. 해외주식을 팔아 생긴 양도소득금액(이익)이 여기에 들어갑니다. 이자·배당 등 다른 소득과 근로소득 기준(총급여)은 이 앱이 모르므로 함께 확인하세요.';
  return `<div class="cb-panel cb-tax-owner-ded">
      <div class="cb-panel-title">소유주별 해외 기본공제</div>
      <div class="cb-tax-od-sub">기본공제는 사람마다 따로 · 가족끼리 나눠 쓸 수 없음${(rows||[]).some(r=>r.dependent)?` · <span data-tip="${cbEsc(depTip)}">자녀는 부양가족 소득 기준으로</span>`:''}</div>
      <div class="cb-tax-od-list">${body||'<div class="fin-empty">소유주가 없습니다.</div>'}</div>
    </div>`;
}
function cbNiceStep(raw){
  raw = Math.max(raw||1, 1);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw/p;
  return (n<=1?1:n<=2?2:n<=5?5:10) * p;
}
function cbTaxAxisLab(v){
  if (v===0) return '0';
  const a = Math.abs(v);
  const sign = v>0 ? '+' : '−';
  if (a>=100000000) return sign+(a/100000000).toFixed(a%100000000?1:0)+'억';
  return sign+Math.round(a/10000).toLocaleString('ko-KR')+'만';
}
// 금액(손익이 아닌 절대 금액) 눈금 — 양수에 + 를 붙이지 않는다. 손익 축(세금 그래프)만 cbTaxAxisLab 을 쓴다.
// 예전에는 투자자산 추이·배당·증여 그래프가 cbTaxAxisLab 을 빌려 써서 '+3.6억'처럼 손익으로 읽혔다.
// step(눈금 간격)이 0.1억(1,000만)으로 나눠떨어지지 않으면 '1억 500만'처럼 만 원까지 적는다 — 소수 한 자리 억으로만 적으면
// 500만 간격 눈금이 1.05억·1.1억·1.15억 → '1.1억' 세 번으로 겹쳐 보였다(2026-11-23). step 을 모르면 값 자체로 판단한다.
function cbAmtAxisLab(v, step){
  if (v===0) return '0';
  const a = Math.abs(v), sign = v<0 ? '−' : '';
  if (a>=100000000) {
    const eok = Math.floor(a/100000000), man = Math.round((a-eok*100000000)/10000);
    if (man===0) return sign+eok+'억';
    if (man===10000) return sign+(eok+1)+'억';
    const fine = Number.isFinite(step)&&step>0 ? Math.round(step/10000)%1000!==0 : man%1000!==0;
    return fine ? sign+eok+'억 '+man.toLocaleString('ko-KR')+'만' : sign+(a/100000000).toFixed(1)+'억';
  }
  return sign+Math.round(a/10000).toLocaleString('ko-KR')+'만';
}
// 금액 그래프 공통 뼈대: 가로 눈금선 + 왼쪽 금액 라벨. values = 눈금 값 배열, Y = 값→y 좌표, x1~x2 = 그림 영역 좌우.
// 눈금 라벨이 들어갈 왼쪽 여백(px) — '1억 2,500만'처럼 긴 라벨이 잘리지 않게 글자 폭을 어림해 넓힌다(12px 글자: 한글 12 · 그 밖 7.5).
function cbAmtAxisPad(values, min, fmt){
  const lab = fmt || cbAmtAxisLab;
  const step = values.length>1 ? Math.abs(values[1]-values[0]) : undefined;
  const w = Math.max(0, ...values.map(v=>[...String(lab(v, step))].reduce((s,ch)=>s+(/[가-힣]/.test(ch)?12:ch===' '?3.5:7.5),0)));
  return Math.max(min||0, Math.ceil(w+12));
}
function cbAmtGridSvg(values, Y, x1, x2, fmt){
  const lab = fmt || cbAmtAxisLab;
  const step = values.length>1 ? Math.abs(values[1]-values[0]) : undefined;
  return values.map(v=>{
    const yy = Y(v);
    return `<line x1="${x1}" x2="${x2}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" style="stroke:var(--grid)" stroke-width="1"></line>`
      + `<text x="${x1-7}" y="${(yy+3.5).toFixed(1)}" style="fill:var(--lab)" font-size="12" text-anchor="end">${lab(v, step)}</text>`;
  }).join('');
}
// lo~hi 를 step 간격으로 나눈 눈금 값 배열(부동소수 오차로 마지막 눈금이 빠지지 않게 여유를 둔다).
function cbAxisTicks(lo, hi, step){
  const out=[]; for(let v=lo; v<=hi+step*0.01; v+=step) out.push(v); return out;
}
// 월별 실현손익 막대(국내/해외, 왼쪽 눈금) 위에 해외 누적선 + 해외 기본공제(250만) 기준선(오른쪽 눈금)을 겹친 한 칸 + hover 상세
// when: 화면이 보고 있는 연도 — 세율·공제 규칙과 hover 의 'N년 규칙' 표기가 같은 해를 가리키게 한다.
function cbTaxChartSvg(w,h,list,when){
  const agg={}, mgf={}, misa={};
  const ruleWhen=when||(list||[]).find(row=>row?.month)?.month||new Date();
  const ruleYear=ruleWhen instanceof Date ? ruleWhen.getFullYear() : Number(String(ruleWhen).slice(0,4));
  const ownerOf=t=>(t&&t.owner&&t.owner!=='전체'?String(t.owner):null);
  let maxM=0;
  list.forEach(t=>{ const m=parseInt(String(t.month).split('-')[1]||'0'); if(!m) return;
    const amt=t.amt||0;
    agg[m+'-'+(t.category==='domestic'?'d':'f')]=(agg[m+'-'+(t.category==='domestic'?'d':'f')]||0)+amt;
    const acc=cbTaxAcctOf(t);
    if(acc==='일반' && t.category!=='domestic') mgf[m]=(mgf[m]||0)+amt;
    else if(acc==='ISA') misa[m]=(misa[m]||0)+amt;
    if(m>maxM) maxM=m; });
  // 국내·해외·전체 누적 손익과 예상 세액을 월별로 함께 갱신한다.
  let cf=0, ci=0, cpDom=0, cpFgn=0; const cum=[];
  window._cbTaxHover=[];
  for(let m=1;m<=12;m++){
    cf+=mgf[m]||0; ci+=misa[m]||0;
    cpDom+=agg[m+'-d']||0;
    cpFgn+=agg[m+'-f']||0;
    const cp=cpDom+cpFgn;
    const through=(list||[]).filter(t=>parseInt(String(t.month).split('-')[1]||'0')<=m);
    const taxSummary=cbTaxSummary(through,ownerOf,[],ruleWhen);
    const tax=taxSummary.totalDue;
    cum[m]={fgn:cf, isa:ci, domProfit:cpDom, fgnProfit:cpFgn, profit:cp, tax};
    cum[m].legacyTax=taxSummary.legacyDue;
    window._cbTaxHover[m]={m, dom:agg[m+'-d']||0, fgn:agg[m+'-f']||0, cumDomProfit:cpDom, cumFgnProfit:cpFgn, cumProfit:cp, tax, legacyTax:taxSummary.legacyDue, year:ruleYear};
  }
  const vals=Object.values(agg);
  const DED=_taxRuleValue('capitalGains.foreignStockBasicDeductionKrw',CB_TAX_FGN_DED,ruleWhen),
        wn=(typeof cssVar==='function'?cssVar('--warn','#d97706'):'#d97706'),
        acc3=(typeof cssVar==='function'?cssVar('--acc3','#7c3aed'):'#7c3aed'),
        dn=(typeof cssVar==='function'?cssVar('--dn','#cf3d5c'):'#cf3d5c');
  // 한 카드 안에 위·아래 두 줄로 나눠 그린다(사용자 결정 2026-11-23 — 예전 2026-11-17 '한 칸 겹치기'를 대신한다).
  // 겹쳐 그리면 눈금이 두 개(왼쪽=월별, 오른쪽=누적)라 공제선(오른쪽 250만)이 왼쪽 +125만 높이에 놓여 막대와 비교되는 착시가 생겼다.
  // 위 줄 = 해외 누적손익 vs 기본공제(계단선 — 누적은 매도한 달에만 바뀌므로 곡선으로 잇지 않는다. 곡선은 0 아래로 파이는 없는 값을 그렸다),
  // 아래 줄 = 월별 실현손익 막대(국내·해외). 두 줄이 같은 1~12월 가로 위치를 쓰고 눈금은 각자 하나다.
  // 선은 세금을 정하는 해외 누적 하나만 그린다. 전체·국내 누적과 예상 세액은 마우스 설명에만 남긴다.
  const padL=70, padR=24, gapMid=34;
  const plotW=w-padL-padR;
  const xMid=m=>padL+(m-0.5)/12*plotW, xL=m=>padL+(m-1)/12*plotW, xR=m=>padL+m/12*plotW;
  const top1=30, avail=h-top1-gapMid-24, h1=Math.round(avail*0.55), bot1=top1+h1, top2=bot1+gapMid, bot2=h-24;
  let out='';
  const fgnProfitVals=maxM?cum.slice(1,maxM+1).map(c=>c.fgnProfit):[0];
  // 눈금 하나로 한 줄을 그린다 — 양수 바닥(minPos)은 기록이 없을 때 같은 라벨이 반복되지 않게 한다.
  const panel=(vs,minPos,yTop,yBot)=>{
    const pos=Math.max(minPos,...vs.filter(v=>v>0)), neg=Math.max(0,...vs.filter(v=>v<0).map(v=>-v));
    const step=cbNiceStep(Math.max(pos,neg)/4);
    const nUp=Math.max(1,Math.ceil(pos/step)), nDown=Math.ceil(neg/step);
    const unitH=(yBot-yTop)/(nUp+nDown), y0=yTop+nUp*unitH;
    for(let k=-nDown;k<=nUp;k++){
      const yy=y0-k*unitH;
      out+=`<line x1="${padL}" x2="${w-padR}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" style="stroke:${k===0?'var(--bd2)':'var(--grid)'}" stroke-width="${k===0?1.4:1}"></line>`;
      out+=`<text x="${padL-6}" y="${(yy+4).toFixed(1)}" style="fill:var(--lab)" font-size="12" text-anchor="end">${cbTaxAxisLab(k*step)}</text>`;
    }
    return v=>y0-(v/step)*unitH;
  };
  // ① 위 줄 — 해외 누적손익 vs 기본공제
  out+=`<text x="${padL}" y="${top1-12}" style="fill:var(--tx)" font-size="12" font-weight="700">① 해외 누적 실현손익 vs 기본공제 <tspan style="fill:var(--lab)" font-weight="400">· 계단선 — 매도한 달에만 바뀝니다</tspan></text>`;
  const YC=panel(fgnProfitVals,DED*1.2,top1,bot1);
  const yd=YC(DED);
  out+=`<line x1="${padL}" x2="${w-padR}" y1="${yd.toFixed(1)}" y2="${yd.toFixed(1)}" stroke="${wn}" stroke-width="1.8" stroke-dasharray="7 5"></line>`;
  out+=`<text x="${padL+6}" y="${(yd-6).toFixed(1)}" fill="${wn}" font-size="12" font-weight="700">1인당 해외 기본공제 ${cbKrw(DED)}</text>`;
  if(maxM>=1){
    const fgnColor=CB_CLS.us.color;
    // 계단: 그 달 칸 전체에 그 달 말 누적값을 그리고 다음 달 경계에서 수직으로 바뀐다.
    let step='';
    for(let m=1;m<=maxM;m++){
      const yy=YC(cum[m].fgnProfit).toFixed(1);
      step+= m===1 ? `M${xL(1).toFixed(1)},${yy}` : ` V${yy}`;
      step+=` H${xR(m).toFixed(1)}`;
    }
    // 공제선을 넘은 부분만 칠한다 — 계단 아래 면을 공제선 위쪽 영역으로 잘라 낸다.
    if(Math.max(...fgnProfitVals)>DED){
      const clipId='cb-tax-over-'+Math.round(w)+'-'+Math.round(h);
      out+=`<clipPath id="${clipId}"><rect x="${padL}" y="${top1}" width="${plotW}" height="${Math.max(0,yd-top1).toFixed(1)}"></rect></clipPath>`;
      out+=`<path d="${step} V${yd.toFixed(1)} H${xL(1).toFixed(1)} Z" fill="${wn}" opacity=".2" clip-path="url(#${clipId})"></path>`;
    }
    out+=`<path class="cb-tax-cum-step" d="${step}" fill="none" stroke="${fgnColor}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"></path>`;
    // 점은 해외 매도가 있었던 달에만 — 값이 바뀐 곳
    for(let m=1;m<=maxM;m++) if(agg[m+'-f']) out+=`<circle cx="${xMid(m).toFixed(1)}" cy="${YC(cum[m].fgnProfit).toFixed(1)}" r="3.6" fill="${fgnColor}"></circle>`;
    // 끝점 이름표 — 마지막 등록 월의 누적 금액(공제 초과분 함께)
    const lastV=cum[maxM].fgnProfit, lx=xR(maxM), lyv=YC(lastV);
    const overTxt=lastV>DED?` · 공제 ${cbKrw(lastV-DED)} 초과`:'';
    const anchorEnd=lx>w-padR-220;
    out+=`<text class="cb-tax-end-label" x="${(anchorEnd?lx-4:lx+6).toFixed(1)}" y="${Math.max(top1+12,lyv-8).toFixed(1)}" style="fill:var(--tx)" font-size="12" font-weight="800" text-anchor="${anchorEnd?'end':'start'}">누적 ${(lastV>0?'+':'')+cbKrw(lastV)}${overTxt}</text>`;
  }
  // ② 아래 줄 — 월별 실현손익 막대 (국내 → 해외 순)
  out+=`<text x="${padL}" y="${top2-12}" style="fill:var(--tx)" font-size="12" font-weight="700">② 월별 실현손익 <tspan style="fill:var(--lab)" font-weight="400">· 그 달에 확정된 손익</tspan></text>`;
  const YB=panel(vals,40000,top2,bot2);
  const bw=(plotW/12)/2-5;
  for(let m=1;m<=12;m++){
    const xf=xL(m)+5;
    [['d',CB_CLS.kr.color,0],['f',CB_CLS.us.color,1]].forEach(cfg=>{
      const v=agg[m+'-'+cfg[0]]||0; if(!v) return;
      const yTop=YB(Math.max(0,v)), yBot=YB(Math.min(0,v));
      out+=`<rect x="${(xf+cfg[2]*(bw+3)).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1,yBot-yTop).toFixed(1)}" rx="2" style="fill:${cfg[1]}"></rect>`;
    });
    out+=`<text x="${xMid(m).toFixed(1)}" y="${h-6}" style="fill:var(--lab)" font-size="12" text-anchor="middle">${m}월</text>`;
  }
  // hover/클릭 히트영역 — hover 시 월 음영, 클릭 시 하단 내역 필터
  for(let m=1;m<=12;m++){
    const x0=padL+(m-1)/12*plotW;
    const monthLabel=`${m}월 실현손익 필터${_cbTaxMonthFilter===m?' 선택됨':''}. 국내 ${cbKrw(agg[m+'-d']||0)}, 해외 ${cbKrw(agg[m+'-f']||0)}, 누적 예상 세액 ${cbKrw(cum[m].tax)}`;
    out+=`<rect class="cb-tax-month-hit" x="${x0.toFixed(1)}" y="${top1}" width="${(plotW/12).toFixed(1)}" height="${bot2-top1}" fill="${_cbTaxMonthFilter===m?'var(--accSoft)':'transparent'}" tabindex="0" focusable="true" role="button" aria-label="${cbEsc(monthLabel)}" onfocus="this.style.fill='var(--accSoft)'" onblur="this.style.fill='${_cbTaxMonthFilter===m?'var(--accSoft)':'transparent'}'" onmousemove="this.style.fill='var(--accSoft)';cbTaxHover(event,${m})" onmouseleave="this.style.fill='${_cbTaxMonthFilter===m?'var(--accSoft)':'transparent'}';cbTaxHide()" onclick="cbTaxMonthPick(${m})"></rect>`;
  }
  // 균일 스케일(meet) + width:100%/height:auto 로 종횡비 유지 → 텍스트가 가로로 늘어나지 않는다.
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:auto" role="group" aria-label="월별 실현손익과 소유주별 누적 예상 세액. 각 월을 선택하면 해당 내역을 필터합니다."><title>월별 실현손익과 소유주별 누적 예상 세액</title>${out}</svg>`;
}
// 차트 hover — 해당 월 실현손익/누적 손익/예상 세액 상세 (body 레벨 고정 툴팁 재사용)
function cbTaxHover(ev, m){
  const r=(window._cbTaxHover||[])[m]; if(!r) return;
  const t=_cbPerfTipEl();
  const year=r.year||new Date().getFullYear();
  const foreignRate=_taxRuleValue('capitalGains.foreignStockCombinedRate',0.22,year);
  const foreignDeduction=_taxRuleValue('capitalGains.foreignStockBasicDeductionKrw',2_500_000,year);
  const isaRate=_taxRuleValue('isa.separateTaxCombinedRate',0.099,year);
  const isaExemption=_taxRuleValue('isa.generalExemptionKrw',2_000_000,year);
  const line=(lab,val,style='')=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:18px;padding:1.5px 0">
    <span style="color:var(--mut)">${lab}</span><span class="cb-num" style="font-weight:700;${style}">${val}</span></div>`;
  t.innerHTML = `<div class="cb-tip-fit"><div style="font-size:var(--fs-cap);color:var(--lab);margin-bottom:5px;font-weight:700">${m}월 실현손익 · 누적 추이</div>
    ${line('<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:2px;background:'+CB_CLS.kr.color+'"></span>국내주식</span>', (r.dom>0?'+':'')+cbKrw(r.dom), cbUpDn(r.dom))}
    ${line('<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:2px;background:'+CB_CLS.us.color+'"></span>해외주식</span>', (r.fgn>0?'+':'')+cbKrw(r.fgn), cbUpDn(r.fgn))}
    <div style="border-top:1px solid var(--bd);margin:5px 0 4px"></div>
    ${line('국내 누적손익', (r.cumDomProfit>0?'+':'')+cbKrw(r.cumDomProfit), cbUpDn(r.cumDomProfit))}
    ${line('해외 누적손익', (r.cumFgnProfit>0?'+':'')+cbKrw(r.cumFgnProfit), cbUpDn(r.cumFgnProfit))}
    ${line('전체 누적손익', (r.cumProfit>0?'+':'')+cbKrw(r.cumProfit), cbUpDn(r.cumProfit))}
    ${line('누적 예상 세액', cbKrw(r.tax), 'color:var(--dn)')}
    ${r.legacyTax?line('소유주 미지정 추정세액', cbKrw(r.legacyTax), 'color:var(--warn)'):''}
    <div class="cb-tip-note">${year}년 규칙 · 소유주별 해외 일반 ${(foreignRate*100).toFixed(1)}% (공제 ${cbKrw(foreignDeduction)}) + ISA 연간 참고 ${(isaRate*100).toFixed(1)}% (공제 가정 ${cbKrw(isaExemption)})을 계산한 뒤 합산 · 국내 소액주주 장내 양도차익 비과세 가정</div></div>`;
  t.style.display='block';
  const rc=t.getBoundingClientRect(); const pad=16;
  let x=ev.clientX+pad, y=ev.clientY+pad;
  if(x+rc.width>window.innerWidth-8) x=ev.clientX-rc.width-pad;
  if(y+rc.height>window.innerHeight-8) y=ev.clientY-rc.height-pad;
  t.style.left=Math.max(8,x)+'px';
  t.style.top=Math.max(8,y)+'px';
}
function cbTaxHide(){ const t=document.getElementById('cb-perf-tip'); if(t) t.style.display='none'; }
function cbSortTaxEntries(list, ownerOf){
  const taxOwnerRank = t => {
    const i=OWNERS.indexOf(ownerOf(t));
    return i<0 ? 99 : i;
  };
  // 내역은 월을 최우선으로 묶고, 같은 월 안에서 국내 → 해외 → 소유주 → 등록 순으로 정렬한다.
  return [...list].sort((a,b)=>
    String(a.month).localeCompare(String(b.month))
    || ((a.category==='domestic'?0:1)-(b.category==='domestic'?0:1))
    || (taxOwnerRank(a)-taxOwnerRank(b))
    || (Number(a.id||0)-Number(b.id||0)));
}
// 실현손익 내역을 달마다 묶는다(2026-11-24, 사용자 요청 — 한 해 기록이 길게 늘어져 스크롤이 너무 내려갔다).
// 최근 달이 위. 묶음 머리줄의 합계·누적은 이미 정렬·누적한 값(sorted·annualCumulative)을 더하고 읽을 뿐 새 계산이 없다.
// 펼침: 사용자가 바꾼 적이 없으면 가장 최근 달만, 수정 중인 기록의 달과 차트로 고른 달은 늘 펼친다.
function cbTaxMonthGroups(sorted, cumulative){
  const by=new Map();
  sorted.forEach(t=>{ const m=parseInt(String(t.month).split('-')[1]||'0'); if(!by.has(m)) by.set(m,[]); by.get(m).push(t); });
  const months=[...by.keys()].sort((a,b)=>b-a);
  const editMonth=_cbTaxEditId!=null?parseInt(String((sorted.find(t=>Number(t.id)===Number(_cbTaxEditId))||{}).month||'').split('-')[1]||'0'):null;
  return months.map((m,i)=>{
    const rows=by.get(m), sum=f=>rows.filter(f).reduce((a,t)=>a+(Number(t.amt)||0),0);
    const dom=sum(t=>t.category==='domestic'), frn=sum(t=>t.category!=='domestic');
    const last=rows[rows.length-1];
    const open=m===_cbTaxMonthFilter||m===editMonth||(_cbTaxMonthOpen?_cbTaxMonthOpen.has(m):i===0);
    return {m,rows,dom,frn,total:dom+frn,cum:(cumulative&&cumulative.get(last))||0,open};
  });
}
function cbTaxMonthToggle(m, open){
  if(!_cbTaxMonthOpen){
    _cbTaxMonthOpen=new Set();
    document.querySelectorAll('#cb-tax2 details.cb-tax-month[open]').forEach(d=>_cbTaxMonthOpen.add(Number(d.dataset.taxMonth)));
  }
  if(open) _cbTaxMonthOpen.add(Number(m)); else _cbTaxMonthOpen.delete(Number(m));
}
function cbTaxCumulativeByEntry(list, ownerOf){
  let annualTotal = 0;
  const cumulative = new Map();
  cbSortTaxEntries(list,ownerOf).forEach(entry=>{
    annualTotal += Number(entry.amt)||0;
    cumulative.set(entry,annualTotal);
  });
  return cumulative;
}
function cbRenderTax(){
  const el = document.getElementById('cb-tax2'); if(!el) return;
  try{ loadMonthlyPL(); }catch(e){}
  const nowY = String(new Date().getFullYear());
  const years = Array.from(new Set([
    ...(monthlyPLData||[]).map(t=>String(t.month||'').slice(0,4)).filter(y=>/^\d{4}$/.test(y)),
    nowY
  ])).sort((a,b)=>b.localeCompare(a));
  const year = (_cbTaxYear && years.includes(_cbTaxYear)) ? _cbTaxYear : nowY;
  // 소유주 필터 — 소유주가 지정되지 않은 레거시 기록(owner 없음/'전체')은 '전체' 탭에서만 집계
  if (_cbTaxOwner!=='전체' && OWNERS.indexOf(_cbTaxOwner)<0) _cbTaxOwner = '전체';
  const ownerOf = t => (t.owner && t.owner!=='전체') ? t.owner : null;
  const list = (monthlyPLData||[]).filter(t=>String(t.month||'').startsWith(year))
    .filter(t=>_cbTaxOwner==='전체' || ownerOf(t)===_cbTaxOwner);
  const ownerSuffix = _cbTaxOwner==='전체' ? ' · 소유주별 합산' : ' · '+cbEsc(_cbTaxOwner);
  const taxSummary=cbTaxSummary(list,ownerOf,_cbTaxOwner==='전체'?[]:[_cbTaxOwner],year);
  const {genFgn,genDom,genBase,genDue,isaNet,isaBase,isaDue,penNet,totalDue}=taxSummary;
  const deductionCap=taxSummary.deductionGroups*taxSummary.foreignDeduction;
  const pct=value=>`${Number((Number(value)||0)*100).toFixed(2).replace(/\.00$/,'').replace(/(\.\d)0$/,'$1')}%`;
  const kospiSecuritiesRate=_taxRuleValue('capitalGains.kospiSecuritiesTransactionRate',0.0005,year);
  const kospiRuralRate=_taxRuleValue('capitalGains.kospiRuralSpecialTaxRate',0.0015,year);
  const kospiTotalRate=_taxRuleValue('capitalGains.kospiTotalTransactionRate',0.002,year);
  const kosdaqTotalRate=_taxRuleValue('capitalGains.kosdaqTotalTransactionRate',0.002,year);
  const pensionMinRate=_taxRuleValue('pension.pensionReceiptMinRate',0.033,year);
  const pensionMaxRate=_taxRuleValue('pension.pensionReceiptMaxRate',0.055,year);
  const pensionWithdrawalRate=_taxRuleValue('pension.otherIncomeWithdrawalRate',0.165,year);
  const taxBreakdown=taxSummary.buckets
    .filter(row=>row.genFgn||row.isaNet||row.totalDue)
    .map(row=>`${cbEsc(row.label)} ${cbKrw(row.totalDue)}`).join(' · ');
  // 해외 일반계좌 절세 여력 — 현재 실현손익에서 기본공제까지 추가로 확정할 수 있는 순이익과
  // 보유 중인 해외 일반계좌 미실현 손실 후보를 함께 보여준다.
  const deductionRoom = taxSummary.deductionRoom;
  const deductionUsePct = deductionCap>0?Math.max(0,Math.min(100,taxSummary.deductionUsed/deductionCap*100)):0;
  const harvestCandidates = (pfolioData||[])
    .filter(i=>i && i.grp==='주식' && (i.qty||0)>0 && cbCls(i)!=='kr'
      && (i.acc||'일반')==='일반'
      && (_cbTaxOwner==='전체' || i.owner===_cbTaxOwner))
    .map(i=>({ i, loss:cbGainKRW(i) }))
    .filter(x=>x.loss<0)
    .sort((a,b)=>a.loss-b.loss);
  const harvestTotal = harvestCandidates.reduce((s,x)=>s+Math.abs(x.loss),0);
  const harvest = cbTaxHarvestPlan(taxSummary.buckets, harvestCandidates, taxSummary.foreignRate);
  const dependentLimit = _taxRuleValue('dependent.basicDeductionIncomeLimitKrw', null, year);
  // 부양가족(자녀1)의 남은 250만 공제는 '세금 없이'는 맞지만, 실현하면 부양가족 소득 기준(100만)에 걸릴 수 있다 — 합계에 든 몫을 밝힌다.
  const depRoom = dependentLimit>0 ? taxSummary.buckets.filter(b=>!b.isLegacy&&CB_TAX_DEPENDENT_OWNERS.includes(b.label)).reduce((s,b)=>s+(Number(b.deductionRoom)||0),0) : 0;
  const depRoomNote = depRoom>0 ? `<div class="cb-tax-half-note" style="margin-top:3px">그중 ${CB_TAX_DEPENDENT_OWNERS.map(cbEsc).join('·')} 몫 ${cbKrw(depRoom)} — 실현하면 부양가족 공제에 영향(오른쪽 카드)</div>` : '';
  const ownerDedRows = cbTaxOwnerDeductionRows(taxSummary.buckets, _cbTaxOwner==='전체'?OWNERS:[_cbTaxOwner], taxSummary.foreignDeduction, dependentLimit, taxSummary.foreignRate);
  const historyList = _cbTaxMonthFilter
    ? list.filter(t=>parseInt(String(t.month).split('-')[1]||'0')===_cbTaxMonthFilter)
    : list;
  const sorted = cbSortTaxEntries(historyList, ownerOf);
  // 월 필터를 선택해도 누계는 해당 월부터 다시 시작하지 않고 조회 연도 전체 기록을 기준으로 유지한다.
  const annualCumulative = cbTaxCumulativeByEntry(list, ownerOf);
  const row2 = (lab,val,style='') => `<div style="display:flex;justify-content:space-between;font-size:var(--fs-cap)"><span style="color:var(--mut)">${lab}</span><span style="font-weight:700;${style}">${val}</span></div>`;
  const acctOpts = _cbTaxDraft.k==='foreign' ? ['일반'] : CB_TAX_ACCTS;
  if (acctOpts.indexOf(_cbTaxDraft.acc)<0) _cbTaxDraft.acc = acctOpts[0];
  // 기록 폼의 소유주 기본값 = 현재 선택된 소유주 탭 ('전체' 탭이면 첫 소유주)
  const draftOwner = (OWNERS.indexOf(_cbTaxDraft.owner)>=0) ? _cbTaxDraft.owner
    : (_cbTaxOwner!=='전체' ? _cbTaxOwner : OWNERS[0]);
  // 다시 그릴 때(소유주 탭·연도·월 필터) 고른 보유 반영이 지금 입력 줄의 소유주·시장과 맞지 않으면 지운다 — 다른 매도 기록에 따라붙지 않게.
  if (_cbTaxHold && !cbTaxHoldValidFor(draftOwner, _cbTaxDraft.k||'domestic')) _cbTaxHold=null;
  // 소유주 탭·조회 연도는 메인 제목 라인(글로벌 헤더) 우측으로
  cbSetHead(
    '계좌(일반·연금저축·ISA)별 실현손익과 예상 세액 · 매도 확정 손익 기준',
    `${cbOwnerBtns(_cbTaxOwner,'cbTaxOwner')}
     <label style="display:flex;align-items:center;gap:7px;font-size:var(--fs-cap);color:var(--lab);font-weight:600">조회 연도
       <select class="cb-input" onchange="cbTaxYear(this.value)" style="padding:6px 9px">${years.map(y=>`<option value="${y}" ${y===year?'selected':''}>${y}년</option>`).join('')}</select>
     </label>`
  );
  el.innerHTML = `
    <!-- 상단 요약: 기존 5개를 압축하고 해외 기본공제 사용률을 추가 -->
    <div class="cb-tax-summary-grid">
      <div class="cb-panel cb-tax-summary-card" style="--card-tone:var(--dn)">
        <div style="font-size:var(--fs-cap);letter-spacing:.06em;color:var(--lab);font-weight:800">${year}년 세액 참고 합계<span class="cb-tax-card-sub">${ownerSuffix.replace(/^ · /,'')}</span></div>
        <div style="flex:1;display:flex;align-items:center">
          <div style="font-family:var(--font-ui);font-size:var(--fs-title);font-weight:800;color:var(${totalDue>0?'--dn':'--lab'})">${cbKrw(totalDue)}</div>
        </div>
        <div style="font-size:var(--fs-cap);color:var(--dim);padding-top:8px;line-height:1.5">해외 예상 ${cbKrw(genDue)}<br>ISA 연간 현금흐름 참고 ${cbKrw(isaDue)}<br>${taxBreakdown||'과세 대상 기록 없음'}<br>해외주식 신고 ${parseInt(year)+1}년 5월</div>
      </div>
      <div class="cb-panel cb-tax-summary-card" style="--card-tone:${CB_CLS.us.color}">
        <div style="font-size:var(--fs-cap);letter-spacing:.06em;color:var(--lab);font-weight:800;margin-bottom:8px">일반 · 해외주식 <span style="color:var(--dim);font-weight:500">· 양도소득세</span></div>
        <div style="display:flex;flex-direction:column;gap:5px;flex:1">
          ${row2('실현손익 합계', (genFgn>0?'+':'')+cbKrw(genFgn), cbUpDn(genFgn))}
          ${row2(`<span data-tip="일반적인 해외주식 양도차익에서 소유주별 연 ${cbKrw(taxSummary.foreignDeduction)} 공제">기본공제</span>`, taxSummary.deductionGroups>1?`인별 ${cbKrw(taxSummary.foreignDeduction)} × ${taxSummary.deductionGroups}`:'−'+cbKrw(taxSummary.foreignDeduction))}
          ${row2('<span data-tip="소유주별 실현손익에서 각자의 기본공제를 뺀 과세표준 합계">과세표준 합계</span>', cbKrw(genBase))}
          ${row2('세율', `${pct(taxSummary.foreignRate)} <span style="color:var(--dim);font-weight:400">(지방세 포함)</span>`)}
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:auto;padding-top:6px;border-top:1px solid var(--bd)"><span style="font-weight:700;font-size:var(--fs-cap)">예상 세액</span><span style="font-family:var(--font-ui);font-size:var(--fs-card);font-weight:800;color:var(${genDue>0?'--dn':'--lab'})">${cbKrw(genDue)}</span></div>
        </div>
      </div>
      <div class="cb-tax-ded-col">
      <div class="cb-panel cb-tax-summary-card cb-tax-half-card" style="--card-tone:var(--warn)">
        <div style="font-size:var(--fs-cap);letter-spacing:.06em;color:var(--lab);font-weight:800">해외 기본공제 사용률</div>
        <div class="cb-tax-deduction-value">
          <div style="font-family:var(--font-ui);font-size:var(--fs-card);font-weight:800;color:var(--warn)">${deductionUsePct.toFixed(1)}%</div>
          <span class="cb-tax-deduction-remain">잔여 공제 ${cbKrw(deductionRoom)}</span>
        </div>
        <div class="cb-tax-deduction-track"><span style="width:${deductionUsePct.toFixed(2)}%"></span></div>
      </div>
      <div class="cb-panel cb-tax-summary-card cb-tax-half-card" style="--card-tone:var(--dn)">
        <div style="font-size:var(--fs-cap);letter-spacing:.06em;color:var(--lab);font-weight:800"><span data-tip="해외 일반계좌 종목의 지금 평가손실입니다. 같은 해에 팔아 손실을 확정하면 그 사람의 해외 실현이익과 상계됩니다. 세액 감소는 소유주마다 '손실'과 '공제 초과 과세표준' 중 작은 쪽 × 세율로 잡은 최대치입니다.">손실 상계 여력</span><span class="cb-tax-card-sub">해외 평가손실</span></div>
        <div class="cb-tax-deduction-value">
          <div style="font-family:var(--font-ui);font-size:var(--fs-card);font-weight:800;color:${harvest.loss>0?'var(--dn)':'var(--lab)'}">${harvest.loss>0?'−'+cbKrw(harvest.loss):cbKrw(0)}</div>
          <span class="cb-tax-deduction-remain">${harvest.count}종목</span>
        </div>
        <div class="cb-tax-half-note">${harvest.loss>0?(harvest.save>0?`연말 전 팔면 세액 최대 <b style="color:var(--up)">${cbKrw(harvest.save)}</b> 감소`:'공제 안이라 팔아도 줄어드는 세금 없음'):'평가손실 종목 없음'}</div>
      </div>
      </div>
      <div class="cb-panel cb-tax-summary-card" style="--card-tone:${CB_CLS.kr.color}">
        <div style="font-size:var(--fs-cap);letter-spacing:.06em;color:var(--lab);font-weight:800;margin-bottom:8px">일반 · 국내주식 <span class="cb-tax-card-sub">소액주주 비과세</span></div>
        <div style="display:flex;flex-direction:column;gap:5px;flex:1">
          ${row2('실현손익 합계', (genDom>0?'+':'')+cbKrw(genDom), cbUpDn(genDom))}
          ${row2('<span data-tip="종목당 보유액 50억원 미만·지분율 기준 미만인 일반 투자자">소액주주</span> 장내 양도차익', '<span style="color:var(--up);font-weight:700">비과세</span>')}
          ${row2(`<span data-tip="매도 대금에 부과되는 부담(손익과 무관). ${year}년 코스피 증권거래세 ${pct(kospiSecuritiesRate)} + 농어촌특별세 ${pct(kospiRuralRate)}, 코스닥 증권거래세 ${pct(kosdaqTotalRate)}">거래세·농특세 참고</span>`, `코스피 ${pct(kospiTotalRate)} · 코스닥 ${pct(kosdaqTotalRate)}`)}
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:auto;padding-top:6px;border-top:1px solid var(--bd)"><span style="font-weight:700;font-size:var(--fs-cap)">예상 양도세액</span><span style="font-family:var(--font-ui);font-size:var(--fs-card);font-weight:800;color:var(--lab)">${cbKrw(0)}</span></div>
        </div>
      </div>
      <div class="cb-panel cb-tax-summary-card" style="--card-tone:var(--purple,#c084fc)">
        <div style="font-size:var(--fs-cap);letter-spacing:.06em;color:var(--lab);font-weight:800;margin-bottom:8px">ISA 계좌 <span class="cb-tax-card-sub">만기 정산 전 연간 참고</span></div>
        <div style="display:flex;flex-direction:column;gap:5px;flex:1">
          ${row2('연간 입력 순소득', (isaNet>0?'+':'')+cbKrw(isaNet), cbUpDn(isaNet))}
          ${row2(`<span data-tip="실제 일반형 비과세 한도 ${cbKrw(taxSummary.isaExemption)}는 계좌 유지기간 전체 최종 순소득에 한 번 적용됩니다. 이 화면은 연간 참고 가정입니다.">참고 비과세 가정</span>`, taxSummary.deductionGroups>1?`인별 ${cbKrw(taxSummary.isaExemption)}`:'−'+cbKrw(taxSummary.isaExemption))}
          ${row2('연간 참고 과세표준', cbKrw(isaBase))}
          ${row2('참고율', `${pct(taxSummary.isaRate)} <span style="color:var(--dim);font-weight:400">(지방세 포함)</span>`)}
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:auto;padding-top:6px;border-top:1px solid var(--bd)"><span style="font-weight:700;font-size:var(--fs-cap)">연간 현금흐름 참고세액</span><span style="font-family:var(--font-ui);font-size:var(--fs-card);font-weight:800;color:var(${isaDue>0?'--dn':'--lab'})">${cbKrw(isaDue)}</span></div>
        </div>
      </div>
      <div class="cb-panel cb-tax-summary-card" style="--card-tone:var(--up)">
        <div style="font-size:var(--fs-cap);letter-spacing:.06em;color:var(--lab);font-weight:800;margin-bottom:8px">연금저축 계좌 <span class="cb-tax-card-sub">과세이연</span></div>
        <div style="display:flex;flex-direction:column;gap:5px;flex:1">
          ${row2('순이익', (penNet>0?'+':'')+cbKrw(penNet), cbUpDn(penNet))}
          ${row2('계좌 내 매매차익', '<b style="color:var(--up)">매도 시 과세 없음</b>')}
          ${row2('연금 수령', `연금소득세 ${pct(pensionMinRate)}~${pct(pensionMaxRate)}`)}
          ${row2('<span data-tip="중도 인출은 그해 양도세 계산에서 빠집니다.">중도 인출</span>', `기타소득세 ${pct(pensionWithdrawalRate)}`)}
        </div>
      </div>
    </div>
    ${taxSummary.legacy?`<div class="cb-panel" role="note" style="margin-top:10px;padding:10px 13px;border-left:3px solid var(--warn);font-size:var(--fs-cap);color:var(--mut);line-height:1.55"><b style="color:var(--warn)">소유주 미지정 기록 별도 추정</b> · 해외 일반 ${cbKrw(taxSummary.legacy.genFgn)}, ISA ${cbKrw(taxSummary.legacy.isaNet)}, 예상세액 ${cbKrw(taxSummary.legacyDue)}. 어느 사람의 공제를 사용했는지 알 수 없어 하나의 별도 버킷으로 계산했습니다. 기록을 수정해 실제 소유주를 지정하세요.</div>`:''}
    <!-- 월별 실현손익 + 누적 손익·예상 세액 추이 (마우스 오버 시 월별 상세) -->
    ${cbTaxSavingPanelHtml(year)}
    <div class="cb-panel" style="margin-top:12px;padding:16px 18px 10px">
      <div style="display:flex;gap:14px;margin-bottom:8px;font-size:var(--fs-cap);color:var(--mut);flex-wrap:wrap">
        <span class="cb-panel-title"><span data-tip="달에 마우스를 올리면 국내·전체 누적과 예상 세액까지 보입니다. 달을 누르면(Enter) 아래 내역이 그 달만 보입니다.">${year}년 월별 실현손익 · 누적 추이</span> <span style="color:var(--dim)">· 달을 누르면 내역 필터</span></span>
        <span style="display:flex;align-items:center;gap:5px;margin-left:auto"><span style="width:10px;height:10px;border-radius:2px;background:${CB_CLS.kr.color}"></span>국내주식</span>
        <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:${CB_CLS.us.color}"></span>해외주식</span>
        <span style="display:flex;align-items:center;gap:5px"><span style="width:14px;height:3px;border-radius:2px;background:${CB_CLS.us.color}"></span>해외 누적손익</span>
        <span style="display:flex;align-items:center;gap:5px"><span style="width:14px;height:0;border-top:2px dashed var(--warn)"></span>해외 기본공제</span>
      </div>
      <div class="cb-chart-scroll">${cbTaxChartSvg(1120,420,list,year)}</div>
    </div>
    <!-- 하단: 좁아진 실현손익 내역 + 연말 절세 여력 -->
    <div class="cb-tax-bottom-grid">
      <div class="cb-panel cb-tax-history-panel" style="padding:14px 16px;min-width:0">
        <!-- 제목 · 입력 줄 · 월 필터 · 거래내역 가져오기를 한 줄에 — 폭이 모자라면 입력 줄이 다음 줄로 내려간다 -->
        <div class="cb-tax-hist-top">
          <div class="cb-panel-title"><span data-tip="매도로 확정된 손익을 귀속 월별로 적습니다. 세금 계산은 이 기록을 씁니다.">실현손익 기록</span></div>
          <div class="cb-tax-entry-form">
          <label><span class="sr-only">귀속 월</span><select id="cb-tax-m" class="cb-input">${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${String(i+1)===_cbTaxDraft.m?'selected':''}>${i+1}월</option>`).join('')}</select></label>
          <label><span class="sr-only">시장</span><select id="cb-tax-k" class="cb-input" onchange="cbTaxKindChange(this.value)"><option value="domestic" ${_cbTaxDraft.k==='domestic'?'selected':''}>국내주식</option><option value="foreign" ${_cbTaxDraft.k==='foreign'?'selected':''}>해외주식</option></select></label>
          <label><span class="sr-only">계좌</span><select id="cb-tax-acc" class="cb-input">${acctOpts.map(a=>`<option value="${a}" ${a===_cbTaxDraft.acc?'selected':''}>${a}</option>`).join('')}</select></label>
          <label><span class="sr-only">소유주</span><select id="cb-tax-owner" class="cb-input" onchange="cbTaxHoldRecheck()">${OWNERS.map(o=>`<option value="${cbEsc(o)}" ${o===draftOwner?'selected':''}>${cbEsc(o)}</option>`).join('')}</select></label>
          <label><span class="sr-only">실현손익(원)</span><input id="cb-tax-pl" class="cb-input" value="${cbEsc(String(_cbTaxDraft.pl||'').replace(/,/g,'').replace(/^-?\d+$/,v=>(v.startsWith('-')?'-':'')+Math.abs(parseInt(v,10)).toLocaleString('ko-KR')))}" placeholder="실현손익(원)" inputmode="numeric" data-no-comma="1" oninput="handlePLAmtInput(this)" style="flex:1;min-width:118px" /></label>
          <label class="cb-tax-memo-field"><span class="sr-only">메모</span><input id="cb-tax-memo" class="cb-input" value="${cbEsc(_cbTaxDraft.memo||'')}" placeholder="메모" /></label>
          ${_cbTaxEditId==null?`<button type="button" class="cb-tax-hold-btn${_cbTaxHold?' is-set':''}" id="cb-tax-hold-btn" aria-haspopup="dialog" onclick="cbTaxHoldOpen()" data-tip="고르면 저장할 때 그 종목의 보유 수량을 함께 줄입니다(보유 목록의 매도와 같은 계산 — 평균단가는 그대로, 전량이면 삭제 확인). 실현손익은 이 줄 하나만 남습니다.">${cbTaxHoldLabel()}</button>`:''}
          <button onclick="cbTaxAdd()" class="cb-btn" style="font-size:var(--fs-cap)">${_cbTaxEditId!=null?'수정 저장':'기록'}</button>
          ${_cbTaxEditId!=null?'<button onclick="cbTaxCancelEdit()" class="cb-btn" style="font-size:var(--fs-cap);color:var(--mut)">취소</button>':''}
          </div>
          <span class="cb-tax-hist-tools">
            ${_cbTaxMonthFilter?`<button class="cb-btn" onclick="cbTaxMonthPick(${_cbTaxMonthFilter})" style="padding:4px 9px;font-size:var(--fs-cap)">${_cbTaxMonthFilter}월 내역 · 전체 보기 ×</button>`:''}
            <button class="cb-btn cb-tax-import" onclick="document.getElementById('cb-tax-import-file')?.click()" data-tip="증권사 거래내역으로 계산한 실현손익 파일(JSON)을 불러옵니다. 파일에 적힌 소유주·연도의 기존 기록은 교체되고, 다른 소유주·연도 기록은 그대로 둡니다." style="padding:4px 9px;font-size:var(--fs-cap)">거래내역 가져오기</button>
            <input id="cb-tax-import-file" class="cb-tax-import" type="file" accept=".json,application/json" hidden onchange="cbTaxImportFile(this)" />
          </span>
        </div>
        ${typeof finMobileNote==='function'?finMobileNote('실현손익 기록과 거래내역 가져오기'):''}
        <div style="overflow-x:auto"><div style="min-width:800px">
          <div class="cb-thead cb-tax-hist-head">
            <span>월</span><span>소유주</span><span>시장</span><span>계좌</span><span><span data-tip="계좌 유형과 시장에 따라 이 실현손익에 적용되는 대표 세제 방식">세제 구분</span></span><span class="cb-tax-memo-head">메모</span><span>실현손익</span><span><span data-tip="조회 연도의 기록을 월·시장·소유주·등록 순으로 합산한 누적 실현손익">연간 누적손익</span></span>
            <span><span class="cb-tax-head-grid"><span></span><span>관리</span></span></span>
          </div>
          ${cbTaxMonthGroups(sorted, annualCumulative).map(g=>`
            <details class="cb-tax-month" data-tax-month="${g.m}"${g.open?' open':''} ontoggle="cbTaxMonthToggle(${g.m},this.open)">
              <summary class="cb-tax-month-sum">
                <span class="cb-tax-month-name">${g.m}월</span>
                <span class="cb-tax-month-count">${g.rows.length}건</span>
                <span class="cb-tax-month-split">${g.dom?`국내 <b class="cb-num" style="${cbGainStyle(g.dom)}">${(g.dom>0?'+':'')+cbKrw(g.dom)}</b>`:''}${g.dom&&g.frn?' · ':''}${g.frn?`해외 <b class="cb-num" style="${cbGainStyle(g.frn)}">${(g.frn>0?'+':'')+cbKrw(g.frn)}</b>`:''}</span>
                <span class="cb-num cb-tax-month-total" style="${cbGainStyle(g.total)}">${(g.total>0?'+':'')+cbKrw(g.total)}</span>
                <span class="cb-num cb-tax-month-cum" style="${cbGainStyle(g.cum)}">${g.cum>=0?'+':''}${cbKrw(g.cum)}</span>
              </summary>
              ${g.rows.map(t=>{ const taxId=Number(t.id), treatment=cbTaxTreatment(t), cumulative=annualCumulative.get(t)||0; return `
            <div class="cb-tax-hist-row">
              <span style="color:var(--mut)">${parseInt(String(t.month).split('-')[1]||'0')}월</span>
              <span>${cbOwnerTag(ownerOf(t))}</span>
              <span style="font-weight:800;color:${t.category==='domestic'?'var(--acc2)':'var(--warn)'}">${t.category==='domestic'?'국내':'해외'}</span>
              <span style="color:var(--mut)">${cbEsc(cbTaxAcctOf(t))}</span>
              <span><span class="cb-tax-treatment is-${treatment.tone}" data-tip="${cbEsc(treatment.tip)}">${cbEsc(treatment.label)}</span></span>
              <span class="cb-tax-memo-cell" data-overflow-tip="${cbEsc(t.memo||'')}" data-overflow-watch>${cbEsc(t.memo||'—')}</span>
              <span class="cb-num" style="font-weight:700;${cbGainStyle(t.amt)}">${(t.amt>0?'+':'')+cbKrw(t.amt||0)}</span>
              <span class="cb-num" style="font-weight:800;${cbGainStyle(cumulative)}">${cumulative>=0?'+':''}${cbKrw(cumulative)}</span>
              <span class="cb-tax-actions">
                <button class="btn-action" title="수정" onclick="cbTaxEdit(${taxId})">✎</button>
                <button class="btn-action" title="삭제" style="color:var(--dn)" onclick="cbTaxDel(${taxId})">✕</button>
              </span>
            </div>`;}).join('')}
            </details>`).join('') || '<div style="padding:16px;text-align:center;color:var(--dim);font-size:var(--fs-cap)">기록된 실현손익이 없습니다.</div>'}
        </div></div>
      </div>
      <div class="cb-tax-saving-row">
      <div class="cb-panel cb-tax-saving-panel" style="padding:15px 16px;min-width:0">
        <div class="cb-panel-title">연말 절세 여력${ownerSuffix}</div>
        <div style="font-size:var(--fs-cap);color:var(--dim);margin-top:3px">해외 일반계좌 · ${year}년 실현손익 기준</div>
        <div style="margin-top:14px">
          <div style="font-size:var(--fs-cap);color:var(--mut)">세금 없이 추가 실현 가능한 순이익</div>
          <div style="font-family:var(--font-ui);font-size:var(--fs-title);font-weight:800;color:${deductionRoom>0?'var(--up)':'var(--lab)'};margin-top:2px">${cbKrw(deductionRoom)}</div>
          ${depRoomNote}
        </div>
        <div style="margin-top:11px">
          <div style="display:flex;justify-content:space-between;font-size:var(--fs-cap);color:var(--mut)"><span>기본공제 사용률</span><b>${deductionUsePct.toFixed(1)}%</b></div>
          <div style="height:7px;border-radius:5px;background:var(--inner);overflow:hidden;margin-top:5px"><div style="height:100%;width:${deductionUsePct}%;background:${deductionUsePct>=100?'var(--dn)':'var(--acc)'}"></div></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:13px;padding-top:11px;border-top:1px solid var(--bd)">
          ${row2('해외 일반 실현손익', (genFgn>0?'+':'')+cbKrw(genFgn), cbUpDn(genFgn))}
          ${row2('공제 초과 과세표준', cbKrw(genBase), genBase>0?'color:var(--dn)':'color:var(--lab)')}
          ${row2('미실현 손실 후보 합계', harvestTotal>0?'−'+cbKrw(harvestTotal):cbKrw(0), harvestTotal>0?'color:var(--dn)':'color:var(--lab)')}
        </div>
        <div style="font-size:var(--fs-cap);color:var(--lab);font-weight:800;margin-top:14px">손실 상계 후보 TOP 3</div>
        <div style="display:flex;flex-direction:column;gap:5px;margin-top:7px">
          ${harvestCandidates.slice(0,3).map(x=>`
            <div style="display:flex;align-items:center;gap:7px;font-size:var(--fs-cap)">
              <i class="cb-owner-dot" style="background:${cbOwnerColor(x.i.owner)}"></i>
              <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--mut)">${cbEsc(x.i.name||x.i.tkr)}${_cbTaxOwner==='전체'?` · ${cbEsc(x.i.owner)}`:''}</span>
              <b class="cb-num" style="color:var(--dn);flex-shrink:0">−${cbKrw(Math.abs(x.loss))}</b>
            </div>`).join('') || '<div style="font-size:var(--fs-cap);color:var(--dim)">현재 미실현 손실 후보가 없습니다.</div>'}
        </div>
        <div style="font-size:var(--fs-cap);color:var(--dim);line-height:1.55;margin-top:auto;padding-top:12px">손실 상계 후보는 해외 일반계좌의 현재 평가손실만 표시합니다. 실제 매도 전 수수료·환율·세법 적용 여부를 확인하세요.</div>
      </div>
      ${cbTaxOwnerDeductionHtml(ownerDedRows)}
      </div>
    </div>
    ${typeof assetTaxRuleDisclosureHtml==='function'?assetTaxRuleDisclosureHtml('capitalGains',year):''}
    ${typeof assetTaxRuleDisclosureHtml==='function'?assetTaxRuleDisclosureHtml('taxSaving',year):''}`;
}
// ── 연말 절세 체크(2026-11-23, 사용자 결정) ──
// 연금저축·퇴직연금(IRP) 세액공제 대상 납입 한도를 얼마나 채웠는지. 한도는 tax-rules.js(pensionCredit) 한 곳에서만 읽고,
// 납입액은 사람이 입력한다(앱은 계좌별 올해 납입을 모른다). 공제율·환급액은 계산하지 않는다. ISA 는 납입액만 적는다(한도 규칙 없음).
// 순수 함수: 연금저축은 자기 한도까지만, 합산은 합산 한도까지만 공제 대상. 남은 여력 = 합산 한도 − 공제 대상(연금저축은 자기 한도 안에서).
function cbPensionCreditPlan(pension, irp, caps){
  const p=Math.max(0,Number(pension)||0), r=Math.max(0,Number(irp)||0);
  const capP=Math.max(0,Number(caps&&caps.pension)||0), capT=Math.max(0,Number(caps&&caps.total)||0);
  const pCredit=Math.min(p,capP), credited=Math.min(pCredit+r,capT), left=Math.max(0,capT-credited);
  return {credited,left,pensionRoom:Math.min(Math.max(0,capP-p),left),irpRoom:left,
    overPension:Math.max(0,p-capP),overTotal:Math.max(0,pCredit+r-capT),pct:capT>0?credited/capT*100:0};
}
// 전체 탭은 가족 네 명을 모두 보인다(2026-11-24, 사용자 요청 — 예전에는 본인·아내 + 연금·ISA 계좌 보유자만 보여 자녀가 빠졌다).
function cbTaxSavingOwners(year){
  return _cbTaxOwner==='전체' ? OWNERS.slice() : [_cbTaxOwner];
}
function cbTaxSavingRow(year, owner){ return ((((window._taxSaving||{}).years||{})[year]||{})[owner])||{pension:0,irp:0,isa:0}; }
// 한 사람 줄의 막대·설명 — 처음 그릴 때와 입력하는 동안(cbTaxSavingInput) 같은 함수를 쓴다
function cbTaxSavingMeterHtml(owner, v, capP, capT){
  const money=x=>cbKrw(x), plan=cbPensionCreditPlan(v.pension,v.irp,{pension:capP,total:capT});
  const room=plan.left<=0?'<span class="cb-tax-ts-done">공제 대상 한도를 모두 채웠습니다</span>'
    :`남은 여력 <b class="cb-num">${money(plan.left)}</b> · 연금저축으로는 최대 ${money(plan.pensionRoom)}`;
  const over=[plan.overPension>0?`연금저축 ${money(plan.overPension)}은 연금저축 한도 밖`:'',plan.overTotal>0?`합산 ${money(plan.overTotal)}은 합산 한도 밖`:''].filter(Boolean).join(' · ');
  return `<div class="cb-tax-ts-bar" role="img" aria-label="${cbEsc(owner)} 공제 대상 ${money(plan.credited)} / ${money(capT)}"><i style="width:${Math.min(100,plan.pct).toFixed(1)}%"></i><em style="left:${(capP/capT*100).toFixed(1)}%" title="연금저축 한도 ${money(capP)}"></em></div>
        <small><b class="cb-num">${money(plan.credited)}</b> / ${money(capT)} · ${room}${over?` · <span class="cb-tax-ts-over">${over}</span>`:''}</small>`;
}
function cbTaxSavingPanelHtml(year){
  const capP=_taxRuleValue('pensionCredit.pensionSavingsCapKrw',null,year), capT=_taxRuleValue('pensionCredit.combinedCapKrw',null,year);
  const now=new Date(), thisYear=String(now.getFullYear())===String(year);
  const dec31=new Date(Number(year),11,31), daysLeft=Math.ceil((dec31-new Date(now.getFullYear(),now.getMonth(),now.getDate()))/86400000);
  const mobile=typeof isMobileLayout==='function'&&isMobileLayout();
  const money=v=>cbKrw(v);
  const status=mobile?'':`<span class="cb-tax-ts-status" id="cb-tax-ts-status" role="status" aria-live="polite">입력하면 자동으로 저장됩니다</span>`;
  const head=`<div class="cb-tax-ts-head"><span class="cb-panel-title"><span data-tip="연금저축은 연 ${capP!=null?money(capP):'—'}까지, 연금저축과 퇴직연금(IRP 등)을 합쳐 연 ${capT!=null?money(capT):'—'}까지 세액공제 대상입니다. 그해 12월 31일까지 넣은 돈만 칩니다. 납입액은 증권사 앱에서 확인해 적어 주세요.">연말 절세 체크 · 연금계좌 세액공제</span></span><span class="cb-tax-ts-side">${status}${thisYear&&daysLeft>=0?`<b class="cb-tax-ts-dday">${daysLeft===0?'오늘 마감':`12월 31일까지 ${daysLeft}일`}</b>`:''}</span></div>`;
  if(capP==null||capT==null) return `<div class="cb-panel cb-tax-ts">${head}<p class="cb-tax-ts-note">${cbEsc(year)}년은 검증된 한도 규칙이 없어 표시하지 않습니다.</p></div>`;
  // 머리줄 한 번 + 사람마다 한 줄(입력 칸 위 작은 이름표를 줄마다 되풀이하지 않는다). 휴대폰은 조회 전용이라 이름표를 값 옆에 둔다.
  const colHead=`<div class="cb-tax-ts-row cb-tax-ts-colhead" aria-hidden="true"><span>소유주</span><span>연금저축</span><span>퇴직연금(IRP)</span><span>ISA(참고)</span><span>세액공제 대상 · 막대 끝 = 합산 한도 ${money(capT)}</span></div>`;
  const rows=cbTaxSavingOwners(year).map(owner=>{
    const v=cbTaxSavingRow(year,owner);
    const input=(k,label,val)=>mobile?`<span class="cb-tax-ts-val"><small>${label}</small><b class="cb-num">${money(val)}</b></span>`
      :`<input class="cb-tax-ts-input" type="text" inputmode="numeric" data-ts-owner="${cbEsc(owner)}" data-ts-key="${k}" data-ts-year="${cbEsc(year)}" value="${val?Number(val).toLocaleString('ko-KR'):''}" placeholder="0" aria-label="${cbEsc(owner)} ${year}년 ${label} 납입액(원)" oninput="cbTaxSavingInput(this)" onchange="cbTaxSavingInput(this,true)">`;
    return `<div class="cb-tax-ts-row" data-ts-row="${cbEsc(owner)}">
      <span class="cb-tax-ts-owner">${cbOwnerTag(owner)}</span>
      ${input('pension','연금저축',v.pension)}${input('irp','퇴직연금(IRP)',v.irp)}${input('isa','ISA(참고)',v.isa)}
      <div class="cb-tax-ts-meter">${cbTaxSavingMeterHtml(owner,v,capP,capT)}</div>
    </div>`;
  }).join('');
  return `<div class="cb-panel cb-tax-ts">${head}
    <div class="cb-tax-ts-list">${mobile?'':colHead}${rows}</div>
    <p class="cb-tax-ts-note">막대의 세로선은 연금저축 한도(${money(capP)}), 끝은 합산 한도(${money(capT)})입니다. 세액공제율과 환급액은 소득에 따라 달라 계산하지 않습니다. ISA 는 납입액만 적어 둡니다.</p>
    ${mobile&&typeof finMobileNote==='function'?finMobileNote('연금계좌 납입액 입력'):''}
  </div>`;
}
// 저장 버튼 없이 입력하면 저장한다(2026-11-24, 사용자 요청). 치는 동안은 그 줄 막대만 바로 고치고(화면 전체를 다시 그리면
// 입력 칸 포커스가 사라진다), 0.8초 쉬거나 칸을 벗어나면(change) 저장한다. 저장 경로·검사는 예전 '저장' 버튼과 같다.
const _cbTaxSavingTimers={};
function _cbTaxSavingStatus(text, tone){
  const el=document.getElementById('cb-tax-ts-status'); if(!el) return;
  el.textContent=text; el.dataset.tone=tone||'';
}
function _cbTaxSavingRead(owner){
  const read=k=>{ const el=[...document.querySelectorAll('[data-ts-owner][data-ts-key]')].find(x=>x.dataset.tsOwner===owner&&x.dataset.tsKey===k); return el?String(el.value||'').replace(/[,\s]/g,''):''; };
  return {pension:read('pension'),irp:read('irp'),isa:read('isa')};
}
function cbTaxSavingInput(el, now){
  if(typeof isMobileLayout==='function'&&isMobileLayout()) return;
  const owner=el?.dataset?.tsOwner, year=el?.dataset?.tsYear;
  if(!OWNERS.includes(owner)||!/^\d{4}$/.test(String(year))) return;
  const raw=_cbTaxSavingRead(owner);
  const bad=Object.values(raw).some(v=>v!==''&&!(/^\d+$/.test(v)));
  const box=document.querySelector(`[data-ts-row="${CSS.escape(owner)}"] .cb-tax-ts-meter`);
  const capP=_taxRuleValue('pensionCredit.pensionSavingsCapKrw',null,year), capT=_taxRuleValue('pensionCredit.combinedCapKrw',null,year);
  if(!bad&&box&&capP!=null&&capT!=null) box.innerHTML=cbTaxSavingMeterHtml(owner,{pension:Number(raw.pension)||0,irp:Number(raw.irp)||0},capP,capT);
  clearTimeout(_cbTaxSavingTimers[owner]);
  if(bad){ _cbTaxSavingStatus('숫자(원)만 적어 주세요 — 저장하지 않았습니다','warn'); return; }
  _cbTaxSavingStatus('저장 대기 중…','');
  if(now) cbTaxSavingSave(owner,year);
  else _cbTaxSavingTimers[owner]=setTimeout(()=>cbTaxSavingSave(owner,year),800);
}
async function cbTaxSavingSave(owner, year){
  if(typeof isMobileLayout==='function'&&isMobileLayout()) return;
  clearTimeout(_cbTaxSavingTimers[owner]);
  if(window._kvLoadState?.ext!=='ready'){ _cbTaxSavingStatus('재무 기록을 불러온 뒤에 저장할 수 있습니다','warn'); showSaveError('재무 기록을 불러온 뒤에 저장할 수 있습니다.'); return; }
  if(!OWNERS.includes(owner)||!/^\d{4}$/.test(String(year))) return;
  const raw=_cbTaxSavingRead(owner);
  if(Object.values(raw).some(v=>v!==''&&!(/^\d+$/.test(v)))){ _cbTaxSavingStatus('숫자(원)만 적어 주세요 — 저장하지 않았습니다','warn'); return; }
  const row={pension:Number(raw.pension)||0,irp:Number(raw.irp)||0,isa:Number(raw.isa)||0};
  const prev=cbTaxSavingRow(year,owner);
  if(prev.pension===row.pension&&prev.irp===row.irp&&prev.isa===row.isa){ _cbTaxSavingStatus('저장됨','ok'); return; }
  const next=JSON.parse(JSON.stringify(window._taxSaving||{years:{}}));
  next.years=next.years||{}; next.years[year]=next.years[year]||{};
  if(row.pension||row.irp||row.isa) next.years[year][owner]=row; else delete next.years[year][owner];
  window._taxSaving=_normalizeTaxSaving(next);
  _cbTaxSavingStatus('저장 중…','');
  const res=await saveExtDataToKV();   // 실패하면 저장 경로가 마지막 원격 상태로 되돌리고 다시 그린다
  if(res&&res.ok===false) _cbTaxSavingStatus('저장하지 못했습니다','warn');
  else _cbTaxSavingStatus(`저장됨 · ${new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}`,'ok');
}
function cbTaxYear(y){ _cbTaxYear = y; cbRenderTax(); }
// 소유주 탭 — 요약 카드·차트·내역이 모두 list 파생이라 필터만 바꾸면 전부 갱신된다
// 세금·증여 가족의 두 화면이 같은 소유주 상태를 쓰므로, 지금 열린 화면을 다시 그린다
// (투자 계획 가족의 finPlanOwner 와 같은 방식).
function cbTaxOwner(o){
  _cbTaxOwner = o; _cbTaxDraft.owner = '';
  if (document.getElementById('view-gift2')?.classList.contains('active')) cbRenderGift();
  else cbRenderTax();
  if (typeof cbRestoreFilterFocus==='function') cbRestoreFilterFocus('cb-head-widgets','data-owner',o);
}
function cbTaxMonthPick(m){
  const month = Number(m);
  _cbTaxMonthFilter = (_cbTaxMonthFilter===month ? null : month);
  cbTaxHide();
  cbRenderTax();
  requestAnimationFrame(()=>document.querySelector('#cb-tax2 .cb-tax-history-panel')?.scrollIntoView({block:'nearest',behavior:'smooth'}));
}
// 구분(국내/해외) 변경 → 해외주식은 일반 계좌만 노출 (해외 상장 주식은 ISA·연금저축에서 직접 매매 불가)
function cbTaxKindChange(v){
  _cbTaxDraft.k = v;
  cbTaxHoldRecheck();
  _cbTaxDraft.pl = document.getElementById('cb-tax-pl')?.value || '';
  _cbTaxDraft.memo = document.getElementById('cb-tax-memo')?.value || '';
  _cbTaxDraft.m = document.getElementById('cb-tax-m')?.value || _cbTaxDraft.m;
  _cbTaxDraft.owner = document.getElementById('cb-tax-owner')?.value || _cbTaxDraft.owner;
  const sel = document.getElementById('cb-tax-acc'); if(!sel) return;
  const opts = v==='foreign' ? ['일반'] : CB_TAX_ACCTS;
  const cur = sel.value;
  sel.innerHTML = opts.map(a=>`<option value="${a}"${a===cur?' selected':''}>${a}</option>`).join('');
  if (opts.indexOf(cur)<0) sel.value = opts[0];
  _cbTaxDraft.acc = sel.value;
}
function cbTaxAdd(){
  if (typeof isMobileLayout==='function' && isMobileLayout()) return;
  const m = document.getElementById('cb-tax-m')?.value || '1';
  const k = document.getElementById('cb-tax-k')?.value || 'domestic';
  let acc = document.getElementById('cb-tax-acc')?.value || '일반';
  if (k==='foreign') acc = '일반'; // 해외주식은 일반 계좌만
  const raw = (document.getElementById('cb-tax-pl')?.value || '').replace(/,/g,'').trim();
  const memo = (document.getElementById('cb-tax-memo')?.value || '').trim();
  let owner = document.getElementById('cb-tax-owner')?.value || '';
  if (OWNERS.indexOf(owner)<0) owner = (_cbTaxOwner!=='전체' ? _cbTaxOwner : OWNERS[0]);
  const pl = parseFloat(raw);
  if (raw==='' || isNaN(pl)) { alert('실현손익 금액을 입력하세요.'); return; }
  // 보유 반영(선택): 같은 매도 계산(tradeApplyPlan, 실현손익 줄은 만들지 않음)으로 보유 수량을 먼저 확인한다 — 틀리면 아무것도 저장하지 않는다.
  // 종목·수량은 '보유 반영' 선택 창이 고른 _cbTaxHold 다. 고른 뒤 목록이 바뀌었으면(열쇠 불일치) 저장하지 않는다.
  let hold=null;
  if (_cbTaxEditId==null && _cbTaxHold){
    const item=pfolioData[_cbTaxHold.idx];
    const qty=Number(_cbTaxHold.qty);
    if(!item||cbTaxHoldKey(item)!==_cbTaxHold.key){ _cbTaxHold=null; cbTaxHoldPaint(); alert('보유 반영 종목을 찾지 못했습니다. 보유 반영을 다시 골라 주세요.'); return; }
    if(window._kvLoadState?.assets!=='ready'||window._kvLoadState?.ext!=='ready'){ alert('데이터를 아직 불러오지 못해 보유 수량을 바꿀 수 없습니다.'); return; }
    if(item.owner!==owner){ alert('보유 반영 종목의 소유주와 실현손익의 소유주가 다릅니다.'); return; }
    const plan=tradeApplyPlan(item,{side:'sell',qty,date:finLocalDateKey(new Date()),today:finLocalDateKey(new Date()),skipPl:true});
    if(!plan.ok){ alert(plan.error); return; }
    if(plan.remove&&!confirm(`${item.name||item.tkr} 전량 매도입니다. 보유 목록에서 삭제할까요?`+(item.dca?'\n(적립식 매수 규칙도 함께 삭제됩니다)':''))) return;
    hold={item,plan};
  }
  try{ loadMonthlyPL(); }catch(e){}
  const year = (_cbTaxYear && /^\d{4}$/.test(_cbTaxYear)) ? _cbTaxYear : String(new Date().getFullYear());
  const ruleSetId=typeof assetTaxRulesFor==='function'?(assetTaxRulesFor(year)?.id||''):'';
  const entry = { id:_cbTaxEditId!=null?_cbTaxEditId:Date.now(), month:`${year}-${String(m).padStart(2,'0')}`, amt:pl, memo, owner, category:k, account:acc, ruleSetId };
  if (hold && !entry.memo) entry.memo = `${hold.item.name||hold.item.tkr||'종목'} ${Number(_cbTaxHold.qty).toLocaleString(undefined,{maximumFractionDigits:8})}${hold.item.unit||'주'} 매도`.slice(0,240);
  if (_cbTaxEditId!=null){
    const idx=monthlyPLData.findIndex(r=>Number(r.id)===Number(_cbTaxEditId));
    if(idx>=0) monthlyPLData[idx]=entry;
    else monthlyPLData.push(entry);
  } else {
    monthlyPLData.push(entry);
  }
  _cbTaxEditId = null;
  _cbTaxHold = null;
  _cbTaxDraft = { m, k, acc, owner, pl:'', memo:'' };
  saveMonthlyPL();
  if (hold){
    const idx=pfolioData.indexOf(hold.item);
    if(idx>=0){
      if(hold.plan.remove) pfolioData.splice(idx,1);
      else pfolioData[idx]={...hold.item,qty:hold.plan.next.qty,avgP:hold.plan.next.avgP,splitCheckedAt:finLocalDateKey(new Date())};
      if(typeof syncDivHistory==='function') syncDivHistory();
      saveAssetsToKV();
    }
  }
  cbRenderTax();
}
// ── 보유 반영 선택 창(2026-11-20, 사용자 결정: 버튼 + 종목 선택 창) ──
// 입력 줄에는 글자 길이만큼의 버튼만 두고(예전 드롭다운은 가장 긴 종목명만큼 넓어져 입력 줄이 두 줄이 됐다),
// 누르면 입력 줄에서 고른 소유주·시장(국내 = 원화 종목, 해외 = 그 밖)의 보유 주식만 보여 준다. 고른 값은 메모리 _cbTaxHold 뿐이다.
let _cbTaxHold=null, _cbTaxHoldPick=null;
function cbTaxHoldKey(i){ return [i.owner||'',i.tkr||'',i.broker||'',i.acc||'',i.name||''].join('|'); }
function cbTaxHoldCandidates(owner, kind){
  return (pfolioData||[]).map((i,idx)=>({i,idx}))
    .filter(x=>x.i&&x.i.grp==='주식'&&(Number(x.i.qty)||0)>0&&x.i.owner===owner&&((kind==='foreign')===((x.i.cur||'KRW')!=='KRW')));
}
function cbTaxHoldLabel(){
  const item=_cbTaxHold&&pfolioData[_cbTaxHold.idx];
  if(!item) return '<span>보유 반영</span><b>안 함</b>';
  const unit=item.unit||'주';
  return `<span>보유 반영</span><b>${cbEsc(item.name||item.tkr||'종목')} ${Number(_cbTaxHold.qty).toLocaleString(undefined,{maximumFractionDigits:8})}${cbEsc(unit)}</b>`;
}
function cbTaxHoldPaint(){
  const b=document.getElementById('cb-tax-hold-btn'); if(!b) return;
  b.innerHTML=cbTaxHoldLabel();
  b.classList.toggle('is-set',!!_cbTaxHold);
}
// 고른 보유 반영이 이 소유주·시장의 보유 주식으로 아직 그대로 있는가(같은 행 열쇠까지).
function cbTaxHoldValidFor(owner, kind){
  const item=_cbTaxHold&&pfolioData[_cbTaxHold.idx];
  return !!item&&cbTaxHoldKey(item)===_cbTaxHold.key&&cbTaxHoldCandidates(owner,kind).some(x=>x.i===item);
}
// 소유주·시장을 바꿔 고른 종목이 더는 맞지 않으면 선택을 지운다.
function cbTaxHoldRecheck(){
  if(!_cbTaxHold) return;
  const owner=document.getElementById('cb-tax-owner')?.value, kind=document.getElementById('cb-tax-k')?.value||'domestic';
  if(!cbTaxHoldValidFor(owner,kind)){ _cbTaxHold=null; cbTaxHoldPaint(); }
}
function cbTaxHoldOpen(){
  if(typeof isMobileLayout==='function'&&isMobileLayout()) return;
  const owner=document.getElementById('cb-tax-owner')?.value||'', kind=document.getElementById('cb-tax-k')?.value||'domestic';
  _cbTaxHoldPick=_cbTaxHold?{..._cbTaxHold}:null;
  document.getElementById('tax-hold-sub').textContent=`${owner} · ${kind==='foreign'?'해외주식':'국내주식'} 보유 종목에서 고릅니다`;
  document.getElementById('tax-hold-q').value='';
  document.getElementById('tax-hold-qty').value=_cbTaxHold?String(_cbTaxHold.qty):'';
  const err=document.getElementById('tax-hold-error'); err.textContent=''; err.hidden=true;
  cbTaxHoldList();
  const modal=document.getElementById('tax-hold-modal');
  window._taxHoldReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  modal.classList.add('active'); modal.setAttribute('aria-hidden','false');
  requestAnimationFrame(()=>document.getElementById('tax-hold-q')?.focus());
}
function cbTaxHoldList(){
  const owner=document.getElementById('cb-tax-owner')?.value||'', kind=document.getElementById('cb-tax-k')?.value||'domestic';
  const q=(document.getElementById('tax-hold-q')?.value||'').trim().toLowerCase();
  const rows=cbTaxHoldCandidates(owner,kind).filter(x=>!q||[x.i.name,x.i.tkr,x.i.broker,x.i.acc].join(' ').toLowerCase().includes(q));
  const box=document.getElementById('tax-hold-list'); if(!box) return;
  box.innerHTML=rows.map(x=>{
    const unit=x.i.unit||'주', picked=_cbTaxHoldPick&&_cbTaxHoldPick.idx===x.idx;
    return `<label class="tax-hold-row${picked?' is-picked':''}"><input type="radio" name="tax-hold-pick" value="${x.idx}"${picked?' checked':''} onchange="cbTaxHoldPick(${x.idx})">`
      +`<span class="tax-hold-name"><b>${cbEsc(x.i.name||x.i.tkr||'종목')}</b><small>${cbEsc(cbStrip(x.i.tkr||''))} · ${cbEsc(x.i.broker||'')} / ${cbEsc(x.i.acc||'')}</small></span>`
      +`<span class="tax-hold-qty">보유 ${Number(x.i.qty).toLocaleString(undefined,{maximumFractionDigits:8})}${cbEsc(unit)}</span></label>`;
  }).join('')||`<p class="tax-hold-empty">${q?'검색어에 맞는 종목이 없습니다.':'이 소유주·시장의 보유 주식이 없습니다. 입력 줄의 소유주·시장을 확인하세요.'}</p>`;
}
function cbTaxHoldPick(idx){
  const item=pfolioData[idx]; if(!item) return;
  _cbTaxHoldPick={idx,key:cbTaxHoldKey(item)};
  document.querySelectorAll('#tax-hold-list .tax-hold-row').forEach(r=>r.classList.toggle('is-picked',r.querySelector('input')?.value===String(idx)));
}
function cbTaxHoldAll(){
  const item=_cbTaxHoldPick&&pfolioData[_cbTaxHoldPick.idx];
  if(item) document.getElementById('tax-hold-qty').value=String(Number(item.qty));
}
// 고른 종목·수량을 확인해 버튼에 반영한다. 보유보다 많은 수량은 받지 않는다(저장 때 같은 매도 계산이 다시 확인한다).
function cbTaxHoldError(m){ const err=document.getElementById('tax-hold-error'); if(err){ err.textContent=m||''; err.hidden=!m; } }
function cbTaxHoldApply(){
  const fail=cbTaxHoldError;
  const item=_cbTaxHoldPick&&pfolioData[_cbTaxHoldPick.idx];
  if(!item||cbTaxHoldKey(item)!==_cbTaxHoldPick.key){ fail('매도한 종목을 고르세요.'); return; }
  const qty=Number(String(document.getElementById('tax-hold-qty')?.value||'').replace(/,/g,''));
  if(!(qty>0)) { fail('매도 수량을 입력하세요.'); return; }
  if(qty>(Number(item.qty)||0)+1e-9) { fail('보유 수량보다 많이 줄일 수 없습니다.'); return; }
  _cbTaxHold={idx:_cbTaxHoldPick.idx,key:_cbTaxHoldPick.key,qty};
  cbTaxHoldClose(); cbTaxHoldPaint();
}
function cbTaxHoldClear(){ _cbTaxHold=null; cbTaxHoldClose(); cbTaxHoldPaint(); }
function cbTaxHoldClose(){
  const modal=document.getElementById('tax-hold-modal');
  if(!modal?.classList.contains('active')) return;
  modal.classList.remove('active'); modal.setAttribute('aria-hidden','true');
  _cbTaxHoldPick=null;
  const back=window._taxHoldReturnFocus; window._taxHoldReturnFocus=null;
  if(back&&document.contains(back)) back.focus();
}
function cbTaxEdit(id){
  if (typeof isMobileLayout==='function' && isMobileLayout()) return;
  try{ loadMonthlyPL(); }catch(e){}
  const r=monthlyPLData.find(x=>Number(x.id)===Number(id)); if(!r) return;
  _cbTaxEditId=Number(r.id);
  _cbTaxHold=null;   // 수정 중인 기록에는 보유 반영이 없다
  _cbTaxYear=String(r.month||'').slice(0,4)||_cbTaxYear;
  _cbTaxDraft={
    m:String(parseInt(String(r.month||'').split('-')[1]||'1')),
    k:r.category==='domestic'?'domestic':'foreign',
    acc:cbTaxAcctOf(r),
    owner:r.owner||'',
    pl:String(r.amt==null?'':r.amt),
    memo:r.memo||''
  };
  cbRenderTax();
  requestAnimationFrame(()=>document.getElementById('cb-tax-pl')?.focus());
}
function cbTaxCancelEdit(){
  _cbTaxEditId=null;
  _cbTaxHold=null;
  _cbTaxDraft={ m:String(new Date().getMonth()+1), k:'domestic', acc:'일반', owner:'', pl:'', memo:'' };
  cbRenderTax();
}
// ── 거래내역 가져오기 ──
// scripts/broker_realized_pl.py 가 증권사 거래내역으로 만든 JSON 을 받는다. 파일에 적힌
// 소유주 × 연도의 기록만 통째로 교체한다 — 같은 매도를 손으로 넣어 둔 기록과 이중 합산되지 않게 하고,
// 다른 소유주·다른 연도·소유주 미지정 레거시 기록은 건드리지 않는다. 한 행이라도 틀리면 전부 거부한다.
const CB_TAX_IMPORT_FORMAT='asset-dashboard/realized-pl';
const CB_TAX_IMPORT_MAX_ROWS=5000; // _normalizeMonthlyPLRows 상한과 같다
let _cbTaxImportBusy=false;
function cbTaxImportPlan(payload, existing, ruleIdFor, idStart){
  const fail=msg=>({errors:[msg]});
  if(!payload||typeof payload!=='object'||Array.isArray(payload)) return fail('JSON 형식이 아닙니다.');
  if(payload.format!==CB_TAX_IMPORT_FORMAT||payload.version!==1) return fail('세금 페이지용 거래내역 파일이 아닙니다.');
  const owner=String(payload.owner||'');
  if(OWNERS.indexOf(owner)<0) return fail(`소유주를 알 수 없습니다: ${owner||'(없음)'}`);
  const years=Array.isArray(payload.years)?[...new Set(payload.years.map(String))]:[];
  if(!years.length||years.some(y=>!/^\d{4}$/.test(y))) return fail('연도 목록이 올바르지 않습니다.');
  const rows=Array.isArray(payload.rows)?payload.rows:[];
  if(!rows.length) return fail('가져올 기록이 없습니다.');
  const current=Array.isArray(existing)?existing:[];
  let nextId=Math.max(Number(idStart)||0, ...current.map(t=>Number(t&&t.id)||0))+1;
  const errors=[], added=[];
  rows.forEach((r,i)=>{
    const where=`${i+1}번째 기록`;
    const month=String(r&&r.month||'');
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||years.indexOf(month.slice(0,4))<0){ errors.push(`${where}: 귀속 월(${month||'없음'})이 연도 목록 밖입니다.`); return; }
    const amt=Number(r.amt);
    if(!Number.isFinite(amt)){ errors.push(`${where}: 실현손익 금액이 숫자가 아닙니다.`); return; }
    if(r.category!=='domestic'&&r.category!=='foreign'){ errors.push(`${where}: 시장 구분이 올바르지 않습니다.`); return; }
    if(CB_TAX_ACCTS.indexOf(r.account)<0||(r.category==='foreign'&&r.account!=='일반')){ errors.push(`${where}: 계좌 구분이 올바르지 않습니다.`); return; }
    const entry={ id:nextId++, month, amt:Math.round(amt), memo:String(r.memo||'').slice(0,240), owner, category:r.category, account:r.account };
    const ruleSetId=typeof ruleIdFor==='function'?ruleIdFor(month.slice(0,4)):'';
    if(ruleSetId) entry.ruleSetId=ruleSetId;
    added.push(entry);
  });
  if(errors.length) return {errors};
  const normalized=_normalizeMonthlyPLRows(added);
  if(normalized.length!==added.length) return fail('저장 형식으로 바꿀 수 없는 기록이 있습니다.');
  const inScope=t=>!!t&&t.owner===owner&&years.indexOf(String(t.month||'').slice(0,4))>=0;
  const removed=current.filter(inScope);
  const next=current.filter(t=>!inScope(t)).concat(normalized);
  if(next.length>CB_TAX_IMPORT_MAX_ROWS) return fail(`기록이 ${CB_TAX_IMPORT_MAX_ROWS.toLocaleString('ko-KR')}건을 넘어 저장할 수 없습니다.`);
  return {errors:[], owner, years:years.slice().sort(), added:normalized, removed, next};
}
async function cbTaxImportFile(input){
  const file=input&&input.files&&input.files[0];
  if(input) input.value='';
  if(!file||_cbTaxImportBusy) return;
  if(typeof isMobileLayout==='function'&&isMobileLayout()) return;
  // 원격 재무 데이터를 못 불러온 상태에서 쓰면 빈 기본값으로 실제 기록을 덮는다 — 메모리를 바꾸기 전에 멈춘다.
  const notReady=()=>window._kvLoadState?.ext!=='ready';
  if(notReady()){ showSaveError('⚠️ 재무 데이터를 정상적으로 불러온 뒤에 가져올 수 있습니다. 데이터 상태에서 다시 확인해 주세요.'); return; }
  let payload;
  try{ payload=JSON.parse(await file.text()); }catch(e){ alert('JSON 파일을 읽지 못했습니다.'); return; }
  try{ loadMonthlyPL(); }catch(e){}
  const before=monthlyPLData.slice();
  const plan=cbTaxImportPlan(payload, before,
    y=>typeof assetTaxRulesFor==='function'?(assetTaxRulesFor(y)?.id||''):'', Date.now());
  if(plan.errors.length){ alert('가져오지 못했습니다.\n\n'+plan.errors.slice(0,5).join('\n')+(plan.errors.length>5?`\n… 외 ${plan.errors.length-5}건`:'')); return; }
  const span=plan.years.length>1?`${plan.years[0]}~${plan.years[plan.years.length-1]}년`:`${plan.years[0]}년`;
  if(!confirm(`${span} ${plan.owner}의 실현손익 기록을 거래내역 기준으로 교체합니다.\n\n기존 기록 ${plan.removed.length}건 삭제 · 새 기록 ${plan.added.length}건 추가\n다른 소유주·다른 연도의 기록은 그대로 둡니다.`)) return;
  if(notReady()){ showSaveError('⚠️ 재무 데이터를 정상적으로 불러온 뒤에 가져올 수 있습니다.'); return; }
  _cbTaxImportBusy=true;
  monthlyPLData=plan.next;
  try{ localStorage.setItem('monthlyPLData',JSON.stringify(monthlyPLData)); }catch(e){}
  let result;
  try{ result=await saveExtDataToKV(); }catch(e){ result={ok:false}; }
  _cbTaxImportBusy=false;
  if(!result?.ok){
    monthlyPLData=before;
    try{ localStorage.setItem('monthlyPLData',JSON.stringify(before)); }catch(e){}
    if(!result?.blocked) showSaveError('⚠️ 저장하지 못해 가져오기를 취소했습니다. 기존 기록은 그대로입니다.');
    cbRenderTax();
    return;
  }
  _cbTaxEditId=null; _cbTaxMonthFilter=null;
  _cbTaxYear=plan.added.map(t=>t.month.slice(0,4)).sort().pop()||_cbTaxYear;
  if(_cbTaxOwner!=='전체'&&_cbTaxOwner!==plan.owner) _cbTaxOwner=plan.owner;
  cbRenderTax();
}
function cbTaxDel(id){
  if (typeof isMobileLayout==='function' && isMobileLayout()) return;
  if(!confirm('삭제하시겠습니까?')) return;
  try{ loadMonthlyPL(); }catch(e){}
  monthlyPLData = monthlyPLData.filter(r=>Number(r.id)!==Number(id));
  if(Number(_cbTaxEditId)===Number(id)) _cbTaxEditId=null;
  saveMonthlyPL();
  cbRenderTax();
}
