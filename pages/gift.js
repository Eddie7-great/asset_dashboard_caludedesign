// 가족 증여 화면(gift2) — cobalt.js 에서 옮겨 온 화면 렌더러(2026-11-23, 동작 변경 없음).
// cobalt.js 보다 먼저 로드한다(CB_VIEWS 가 이 파일의 렌더 함수를 참조한다). 맨 위에서는 함수·상태 선언만 하고,
// cobalt.js 의 상수·상태는 함수 안에서만 쓴다 — 로드 때 쓰면 아직 없는 이름이라 오류가 난다(test_source_split.mjs).

// ───────────────────────── 페이지: 가족 증여 ─────────────────────────
// 좌: 자녀 정기증여(유기정기금 PV) / 우: 부부 증여 계획.
// 연령대·계획 구간은 입력 편의를 위한 시나리오이며 공제 자동 갱신일로 취급하지 않는다.
// 설정값은 KV ext_data.giftActual + localStorage 미러로 영속화한다.
//   { birth, years, rate, child:[월 이체액 ×4], marriage, spouse:[계획 총액 ×4],
//     childPrior:{confirmed,asOf,amount}, spousePrior:{confirmed,asOf,amount} }
window._giftActual = window._giftActual || (function(){
  try{
    const parsed=JSON.parse(localStorage.getItem('giftActual')||'{}')||{};
    return typeof _normalizeGiftActual==='function'?(_normalizeGiftActual(parsed)||{}):{};
  }catch(e){ return {}; }
})();

const CB_GIFT_SEG_COLORS  = ['#5b9bff','#4ecdc4','#f2a33c','#c084fc'];
const CB_GIFT_MINOR_LIMIT=_taxRuleValue('gift.minorLinealAscendantDeductionKrw',20_000_000);
const CB_GIFT_ADULT_LIMIT=_taxRuleValue('gift.adultLinealAscendantDeductionKrw',50_000_000);
const CB_GIFT_CHILD_SEGS  = [
  {label:'미성년 전기', ages:'0-9세',   a0:0,  limit:CB_GIFT_MINOR_LIMIT},
  {label:'미성년 후기', ages:'10-19세', a0:10, limit:CB_GIFT_MINOR_LIMIT},
  {label:'성년 전기',   ages:'20-29세', a0:20, limit:CB_GIFT_ADULT_LIMIT},
  {label:'성년 후기',   ages:'30-39세', a0:30, limit:CB_GIFT_ADULT_LIMIT},
];
const CB_GIFT_CHILD_DEFAULT  = [150000, 200000, 300000, 400000];
const CB_GIFT_SPOUSE_LIMIT=_taxRuleValue('gift.spouseDeductionKrw',600_000_000);
const CB_GIFT_SPOUSE_COLOR   = '#4ecdc4';
const CB_GIFT_GREY           = '#94a3c8';

// 증여 계획은 소유주별로 나뉜 값이 아니라 가구 공통 계획 하나다(자녀 한 명, 배우자 한 명).
// 그래서 소유주 탭은 금액을 다시 계산하지 않고 **그 소유주가 당사자인 계획만** 남긴다.
// 소유주 enum 이 본인/아내/자녀1/아버지로 고정이므로 당사자 판정이 확정적이다 —
// 부부 증여는 본인↔아내, 자녀 증여는 본인→자녀1 이다.
function cbGiftOwnerScope(owner){
  const o = String(owner||'전체');
  if (o==='전체' || o==='본인') return { child:true,  spouse:true,  key:o==='전체'?'all':'giver' };
  if (o==='아내')               return { child:false, spouse:true,  key:'spouse' };
  if (o==='자녀1')              return { child:true,  spouse:false, key:'child' };
  return { child:false, spouse:false, key:'none' };   // 등록된 증여 계획의 당사자가 아님
}
// ── 설정값 접근 ──────────────────────────────────────────────
function cbGiftCfg(){ return (window._giftActual = window._giftActual || {}); }
function cbGiftSave(){
  try{ localStorage.setItem('giftActual', JSON.stringify(cbGiftCfg())); }catch(e){}
  cbRenderGift();
  // 저장은 비동기라 try/catch 로는 실패를 잡을 수 없다. 실패 시 되돌리기·다시 그리기·안내는 saveExtDataToKV 가 맡는다.
  Promise.resolve(saveExtDataToKV()).catch(e=>console.error('[gift save]',e));
}
function cbGiftBirth(){ const b=cbGiftCfg().birth; return /^\d{4}-\d{2}$/.test(b||'') ? b : '2023-08'; }
function cbGiftMarriage(){ const m=cbGiftCfg().marriage; return /^\d{4}-\d{2}-\d{2}$/.test(m||'') ? m : '2020-05-30'; }
function cbGiftYears(){ const n=parseInt(cbGiftCfg().years,10); return (isFinite(n)&&n>=5&&n<=60) ? n : 40; }
function cbGiftRate(){ return _taxRuleValue('gift.annuityDiscountRate',0.03)*100; }
function cbGiftChildAmt(k){
  const arr = cbGiftCfg().child;
  const v = Array.isArray(arr) ? Number(arr[k]) : NaN;
  return (isFinite(v) && v>=0) ? v : CB_GIFT_CHILD_DEFAULT[k];
}
function cbGiftSpouseAmt(k){
  const arr = cbGiftCfg().spouse;
  const v = Array.isArray(arr) ? Number(arr[k]) : NaN;
  return (isFinite(v) && v>=0) ? v : 0;
}
function cbGiftSetBirth(v){ if(!/^\d{4}-\d{2}$/.test(v||'')) return; cbGiftCfg().birth=v; cbGiftSave(); }
function cbGiftSetMarriage(v){ if(!/^\d{4}-\d{2}-\d{2}$/.test(v||'')) return; cbGiftCfg().marriage=v; cbGiftSave(); }
function cbGiftSetYears(v){ const n=parseInt(v,10); if(!isFinite(n)) return; cbGiftCfg().years=Math.max(5,Math.min(60,n)); cbGiftSave(); }
function cbGiftSetChild(k, raw){
  const c=cbGiftCfg(); if(!Array.isArray(c.child)) c.child=CB_GIFT_CHILD_DEFAULT.slice();
  const v=parseFloat(String(raw||'').replace(/[^\d]/g,''));
  c.child[k] = (isFinite(v)&&v>0) ? Math.round(v) : 0; cbGiftSave();
}
function cbGiftSetSpouse(k, raw){
  const c=cbGiftCfg(); if(!Array.isArray(c.spouse)) c.spouse=[0,0,0,0];
  const v=parseFloat(String(raw||'').replace(/[^\d]/g,''));
  c.spouse[k] = (isFinite(v)&&v>0) ? Math.round(v) : 0; cbGiftSave();
}
// ── 증여 기록장 ──────────────────────────────────────────────
// 실제로 한 증여를 건별로 적어 두고, 확인 기준일 이전 10년의 합계를 대신 더해 준다(예전엔 그 합계를 손으로 한 줄 적었다).
// 기준일 '하나'에 대한 단순 합산이다 — 증여일마다의 10년 창을 각각 판정하지 않고, 공제·세액을 새로 계산하지도 않는다.
// 합계는 기존 '최근 10년 공제 검토'(cbGiftDeductionReview)의 입력으로만 쓰인다.
function cbGiftRecords(kind){
  const list=(Array.isArray(cbGiftCfg().records)?cbGiftCfg().records:[]).concat(cbGiftTransferRecords());
  return list.filter(r=>r&&(!kind||r.kind===kind)).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(a.id).localeCompare(String(b.id)));
}
// 증여로 연결한 자동이체(at.giftKind)가 만드는 기록 — 저장하지 않고 그때그때 만든다(auto:true, 화면에서 지울 수 없고 연결을 끊으면 사라진다).
// 이체일 판정은 현금 흐름과 같은 _autoTransferOccursOn, 금액은 _effectiveAutoTransferAmt(금액 변경 이력 반영)다 — 새 일정 규칙을 만들지 않는다.
// 오늘까지 도래한 이체만, giftFrom(없으면 시작 월) 이후·최근 10년 안에서만 센다. 실제로 이체됐는지는 은행 기록으로 확인할 몫이다.
function cbGiftTransferRecords(asOf){
  const list=typeof autoTransferData!=='undefined'&&Array.isArray(autoTransferData)?autoTransferData:[];
  if(typeof _autoTransferOccursOn!=='function') return [];
  const today=asOf||finLocalDateKey(new Date());
  const end=new Date(today+'T12:00:00'), floor=new Date(end.getFullYear()-10,end.getMonth(),end.getDate());
  const out=[];
  list.forEach(at=>{
    if(!at||at.type!=='지출'||(at.giftKind!=='child'&&at.giftKind!=='spouse')) return;
    const fromYm=at.giftFrom||at.startMonth; if(!/^\d{4}-\d{2}/.test(fromYm||'')) return;
    let d=new Date(Number(fromYm.slice(0,4)),Number(fromYm.slice(5,7))-1,1,12);
    if(d<floor) d=new Date(floor.getFullYear(),floor.getMonth(),floor.getDate(),12);
    // 앱에 자동이체를 등록한 달(startMonth)보다 실제 이체가 먼저 시작됐을 수 있으므로, 증여 집계는 사용자가 고른 시작 월을 따른다.
    const atG={...at,startMonth:fromYm.slice(0,7)};
    for(;d<=end;d.setDate(d.getDate()+1)){
      if(!_autoTransferOccursOn(atG,d)) continue;
      const key=finLocalDateKey(d), amt=Math.round(Number(_effectiveAutoTransferAmt(at,d.getFullYear(),d.getMonth()+1))||0);
      if(amt>0) out.push({id:`at-${at.id}-${key}`,kind:at.giftKind,date:key,amt,memo:`[자동이체] ${at.desc||''}`.trim(),auto:true,atId:at.id});
    }
  });
  return out;
}
// 증여 기록 → 현금 흐름 연동(2026-11-18 4차). 기록장에 잡힌 증여가 현금 흐름에도 지출로 있어야 한다.
//  1) 증여로 연결한 자동이체: 기록장 자동 기록(cbGiftTransferRecords)과 같은 이체일에 그 자동이체의 현금 흐름 줄이 없으면
//     자동이체 줄과 같은 모양으로 채운다(giftBackfill). 사용자가 지운 달(cfDeletedKeys 'auto:id:YYYY-MM')은 다시 넣지 않는다.
//     연결을 끊거나 시작 월을 늦추면 그 범위 밖의 채운 줄은 지운다 — 원래 현금 흐름이 만든 줄(giftBackfill 없음)은 건드리지 않는다.
//  2) 손으로 적은 기록: 기록마다 지출 한 줄(giftRecId, 본인 → 가족 계좌라 자산 이동 '저축/투자'), 기록을 지우면 그 줄도 지운다.
// 바뀐 것이 있으면 true — 저장은 부르는 쪽(cbGiftSave → saveExtDataToKV, cfData 포함)이 한다.
function cbGiftSyncCashflow(){
  if(typeof cfData==='undefined'||!Array.isArray(cfData)) return false;
  const today=finLocalDateKey(new Date()), before=cfData.length;
  const deleted=new Set(typeof cfDeletedKeys!=='undefined'&&Array.isArray(cfDeletedKeys)?cfDeletedKeys:[]);
  const ats=typeof autoTransferData!=='undefined'&&Array.isArray(autoTransferData)?autoTransferData:[];
  const auto=cbGiftTransferRecords(today);
  const wantKey=new Set(auto.map(r=>`${r.atId}|${r.date}`));
  let changed=false;
  // 범위 밖이 된 채운 줄 지우기
  for(let k=cfData.length-1;k>=0;k--){
    const c=cfData[k];
    if(c&&c.giftBackfill===true&&!wantKey.has(`${c.atId}|${c.date}`)){ cfData.splice(k,1); changed=true; }
  }
  auto.forEach(r=>{
    const at=ats.find(x=>String(x.id)===String(r.atId)); if(!at) return;
    const ym=r.date.slice(0,7), monthly=['monthly','month-end','month-start'].includes(at.cycle);
    if(cfData.some(c=>c&&String(c.atId)===String(at.id)&&(c.date===r.date||(monthly&&String(c.date||'').slice(0,7)===ym)))) return;
    if(deleted.has(`auto:${at.id}:${ym}`)) return;
    cfData.push({date:r.date,type:'지출',cat:at.cat||'기타',desc:'[자동] '+(at.desc||''),amt:r.amt,owner:at.owner||'미지정',isAuto:true,atId:at.id,scheduleMonth:ym,
      cycleLabel:typeof _getCycleLabel==='function'?_getCycleLabel(at):'',giftBackfill:true});
    changed=true;
  });
  const stored=Array.isArray(cbGiftCfg().records)?cbGiftCfg().records:[];
  const ids=new Set(stored.map(r=>String(r.id)));
  for(let k=cfData.length-1;k>=0;k--){
    const c=cfData[k];
    if(c&&c.giftRecId&&!ids.has(String(c.giftRecId))){ cfData.splice(k,1); changed=true; }
  }
  const LABEL={child:'자녀',spouse:'배우자'};
  stored.forEach(r=>{
    if(!r||!r.id||cfData.some(c=>c&&String(c.giftRecId)===String(r.id))) return;
    cfData.push({date:r.date,type:'지출',cat:'저축/투자',desc:`[증여] ${LABEL[r.kind]||''}${r.memo?' · '+r.memo:''}`.slice(0,240),amt:Number(r.amt)||0,owner:'본인',giftRecId:String(r.id)});
    changed=true;
  });
  if(changed&&typeof saveCfData==='function') saveCfData();
  return changed||cfData.length!==before;
}
// 증여 화면에서 지출 자동이체를 증여로 연결·해제한다(원본은 현금 흐름의 자동이체 그대로, 표식만 붙인다).
function cbGiftLinkTransfer(atId, field, value){
  if(typeof isMobileLayout==='function'&&isMobileLayout()) return;
  const at=(autoTransferData||[]).find(x=>String(x.id)===String(atId)); if(!at) return;
  if(field==='kind'){
    if(value==='child'||value==='spouse'){ at.giftKind=value; if(!at.giftFrom) at.giftFrom=(at.startMonth||finLocalDateKey(new Date())).slice(0,7); }
    else { delete at.giftKind; delete at.giftFrom; }
  } else if(field==='from'&&/^\d{4}-\d{2}$/.test(value||'')) at.giftFrom=value;
  if(typeof saveAutoTransfers==='function') saveAutoTransfers(false);
  cbGiftSyncCashflow();
  cbGiftSave();
}
// 증여로 셀 시작 월 — 연도·월 두 선택 목록(브라우저 월 달력은 직접 입력이 안 되고 과거로 넘기기 어렵다). 최근 10년까지.
function cbGiftFromPicker(at){
  const now=new Date(), cy=now.getFullYear(), cm=now.getMonth()+1;
  const cur=/^\d{4}-\d{2}$/.test(at.giftFrom||'')?at.giftFrom:`${cy}-${String(cm).padStart(2,'0')}`;
  const y=Number(cur.slice(0,4)), m=Number(cur.slice(5,7)), id=cbEsc(at.id);
  const years=[]; for(let k=cy;k>=cy-10;k--) years.push(k);
  const set=(yy,mm)=>`cbGiftLinkTransfer('${id}','from',${yy}+'-'+String(${mm}).padStart(2,'0'))`;
  return `<span class="cb-gift-link-from"><select class="cb-input cb-num" aria-label="증여 시작 연도" onchange="${set('this.value',`this.parentNode.querySelector('[data-gift-m]').value`)}">${years.map(k=>`<option value="${k}"${k===y?' selected':''}>${k}년</option>`).join('')}</select><select class="cb-input cb-num" data-gift-m aria-label="증여 시작 월" onchange="${set(`this.parentNode.querySelector('select').value`,'this.value')}">${Array.from({length:12},(_,i)=>i+1).map(k=>`<option value="${k}"${k===m?' selected':''}>${k}월</option>`).join('')}</select>부터</span>`;
}
function cbGiftTransferLinkHtml(kinds){
  const list=(typeof autoTransferData!=='undefined'&&Array.isArray(autoTransferData)?autoTransferData:[]).filter(at=>at&&at.type==='지출');
  if(!list.length) return '';
  const LABEL={child:'자녀 증여',spouse:'부부 증여'};
  const rows=list.slice().sort((a,b)=>(b.giftKind?1:0)-(a.giftKind?1:0)||String(a.desc||'').localeCompare(String(b.desc||''),'ko')).map(at=>`
    <div class="cb-gift-link-row${at.giftKind?' is-on':''}">
      <span class="cb-gift-link-name">${cbOwnerTag(at.owner)}<b>${cbEsc(at.desc||at.cat||'자동이체')}</b><small>${cbEsc(typeof _getCycleLabel==='function'?_getCycleLabel(at):'')} · ${cbKrw(typeof _effectiveAutoTransferAmt==='function'?_effectiveAutoTransferAmt(at,new Date().getFullYear(),new Date().getMonth()+1):(at.amt||0))}</small></span>
      <select class="cb-input" aria-label="${cbEsc(at.desc||'자동이체')} 증여 연결" onchange="cbGiftLinkTransfer('${cbEsc(at.id)}','kind',this.value)">
        <option value="">증여 아님</option>${kinds.map(k=>`<option value="${k}"${at.giftKind===k?' selected':''}>${LABEL[k]}</option>`).join('')}</select>
      ${at.giftKind?cbGiftFromPicker(at):'<span></span>'}
    </div>`).join('');
  return `<details class="cb-gift-link"${list.some(at=>at.giftKind)?' open':''}><summary>자동이체를 증여로 연결 <span>· 가족 계좌로 매달 보내는 이체를 고르면 이체일마다 기록장에 자동으로 더합니다</span></summary>${rows}</details>`;
}
// 기준일의 10년 전 같은 날(2월 29일은 28일로). 이 날부터 기준일까지를 '이전 10년'으로 본다(양 끝 포함 — 넓게 잡는 쪽이 안전하다).
function cbGiftWindowStart(asOf){
  const [y,m,d]=String(asOf).split('-').map(Number);
  const last=new Date(y-10,m,0).getDate();
  return `${y-10}-${String(m).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`;
}
function cbGiftLedgerSum(records, kind, asOf){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf||'')) return null;
  const from=cbGiftWindowStart(asOf);
  return (records||[]).filter(r=>r&&r.kind===kind&&r.date>=from&&r.date<=asOf).reduce((s,r)=>s+(Number(r.amt)||0),0);
}
function cbGiftAddRecord(){
  if(typeof isMobileLayout==='function'&&isMobileLayout()) return;   // 모바일은 조회 전용
  const val=id=>document.getElementById(id)?.value||'';
  const kind=val('cb-gift-rec-kind')==='spouse'?'spouse':'child', date=val('cb-gift-rec-date');
  const amt=Math.round(Number(val('cb-gift-rec-amt').replace(/[^\d]/g,'')));
  const err=document.getElementById('cb-gift-rec-error');
  const fail=msg=>{ if(err){err.textContent=msg;err.hidden=false;} };
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(new Date(date+'T12:00:00').getTime())) return fail('증여일을 입력해 주세요.');
  if(date>finLocalDateKey(new Date())) return fail('아직 오지 않은 날짜는 기록할 수 없습니다. 계획은 위의 계획 금액에 적어 주세요.');
  if(!(amt>0)) return fail('금액을 입력해 주세요.');
  const cfg=cbGiftCfg(); if(!Array.isArray(cfg.records)) cfg.records=[];
  if(cfg.records.length>=500) return fail('기록은 500건까지 저장할 수 있습니다.');
  cfg.records.push({id:finNewId(),kind,date,amt,memo:val('cb-gift-rec-memo').trim().slice(0,120)});
  cbGiftSyncCashflow();
  cbGiftSave();
}
function cbGiftDelRecord(id){
  if(typeof isMobileLayout==='function'&&isMobileLayout()) return;
  const cfg=cbGiftCfg(), list=Array.isArray(cfg.records)?cfg.records:[];
  const i=list.findIndex(r=>r&&String(r.id)===String(id)); if(i<0) return;
  if(typeof confirm==='function'&&!confirm('이 증여 기록을 삭제할까요?')) return;
  list.splice(i,1); cbGiftSyncCashflow(); cbGiftSave();
}
// 기록장 표 — 해마다 접는 묶음(올해만 펼침)이고, 같은 자동이체가 한 해에 만든 줄은 한 줄로 접는다.
// 금액은 기록을 그대로 더할 뿐이다(10년 합계는 위 cbGiftLedgerSum 이 따로 계산한다).
function cbGiftLedgerYearsHtml(rows,LABEL,inWindow,today){
  const years=[...new Set(rows.map(r=>String(r.date).slice(0,4)))].sort((a,b)=>b.localeCompare(a));
  const thisYear=String(today).slice(0,4), openDefault=years.includes(thisYear)?thisYear:years[0];
  const head='<div class="cb-gift-ledger-row is-head"><span>증여일</span><span>구분</span><span>금액</span><span>메모</span><span>10년 기간</span><span></span></div>';
  const windowCell=list=>{ const n=list.filter(inWindow).length;
    return n===list.length?'<span class="is-in">기간 안</span>':n===0?'<span class="is-out">기간 밖</span>':`<span class="is-in">일부 ${n}건</span>`; };
  const manualRow=r=>`<div class="cb-gift-ledger-row"><span class="cb-num">${cbEsc(r.date)}</span><span>${LABEL[r.kind]}</span><b class="cb-num">${cbKrw(r.amt)}</b><span class="cb-gift-ledger-memo-cell">${cbEsc(r.memo||'—')}</span>${windowCell([r])}<span><button type="button" class="btn-action cb-gift-ledger-del" aria-label="${cbEsc(r.date)} ${cbEsc(cbKrw(r.amt))} 기록 삭제" onclick="cbGiftDelRecord('${cbEsc(r.id)}')">✕</button></span></div>`;
  const autoRow=list=>{ const first=list[list.length-1].date, last=list[0].date, sum=list.reduce((s,r)=>s+(Number(r.amt)||0),0);
    return `<div class="cb-gift-ledger-row is-auto"><span class="cb-num">${cbEsc(first.slice(5))} ~ ${cbEsc(last.slice(5))}</span><span>${LABEL[list[0].kind]}</span><b class="cb-num">${cbKrw(sum)}</b><span class="cb-gift-ledger-memo-cell">${cbEsc(list[0].memo||'—')} · ${list.length}회</span>${windowCell(list)}<span><em class="cb-gift-auto-tag" data-tip="증여로 연결한 자동이체에서 만든 기록 ${list.length}건을 한 줄로 묶었습니다. 위 '자동이체를 증여로 연결'에서 해제하면 사라집니다.">자동</em></span></div>`; };
  return `<div class="cb-gift-ledger-table">${years.map(y=>{
    const ys=rows.filter(r=>String(r.date).startsWith(y));
    const autoGroups=new Map(), lines=[];
    ys.forEach(r=>{
      if(!r.auto){ lines.push({date:r.date,html:manualRow(r)}); return; }
      const k=`${r.atId}|${r.kind}`;
      if(!autoGroups.has(k)){ autoGroups.set(k,[]); lines.push({date:r.date,group:k}); }
      autoGroups.get(k).push(r);
    });
    const sum=ys.reduce((s,r)=>s+(Number(r.amt)||0),0);
    const open=Object.prototype.hasOwnProperty.call(_cbGiftYearOpen,y)?_cbGiftYearOpen[y]:y===openDefault;
    return `<details class="cb-gift-year"${open?' open':''} ontoggle="_cbGiftYearOpen['${y}']=this.open"><summary><span>${y}년</span><b class="cb-num">${cbKrw(sum)}</b><small>${ys.length}건</small></summary>${head}${lines.map(l=>l.html||autoRow(autoGroups.get(l.group))).join('')}</details>`;
  }).join('')}</div>`;
}
function cbGiftLedgerHtml(scope){
  const kinds=[scope.child?'child':null,scope.spouse?'spouse':null].filter(Boolean);
  if(!kinds.length) return '';
  const LABEL={child:'자녀 증여',spouse:'부부 증여'};
  const today=finLocalDateKey(new Date());
  const rows=cbGiftRecords().filter(r=>kinds.includes(r.kind));
  const asOfOf=kind=>cbGiftPrior(kind).asOf||today;
  const inWindow=r=>{ const asOf=asOfOf(r.kind); return r.date>=cbGiftWindowStart(asOf)&&r.date<=asOf; };
  const sums=kinds.map(kind=>{ const asOf=asOfOf(kind), n=rows.filter(r=>r.kind===kind).length;
    return `<div class="cb-gift-ledger-sum"><span>${LABEL[kind]} · ${cbEsc(asOf)} 이전 10년</span><b class="cb-num">${n?cbKrw(cbGiftLedgerSum(rows,kind,asOf)):'기록 없음'}</b><small>${n?`기록 ${n}건 중 기간 안 ${rows.filter(r=>r.kind===kind&&inWindow(r)).length}건`:'기록이 없으면 위에서 직접 입력한 합계를 씁니다'}</small></div>`; }).join('');
  return `<div class="cb-panel cb-gift-ledger">
      <div class="cb-panel-title"><span data-tip="실제로 한 증여를 건별로 적으면 확인 기준일 이전 10년 합계를 대신 더해 드립니다.">증여 기록장</span> <span style="color:var(--dim)">· 10년 합계를 자동으로 더합니다</span></div>
      <div class="cb-gift-ledger-sums">${sums}</div>
      <div class="cb-gift-ledger-form" role="group" aria-label="증여 기록 추가">
        <label>증여일<input type="date" id="cb-gift-rec-date" class="cb-input cb-num" max="${today}" value="${today}"></label>
        <label>구분<select id="cb-gift-rec-kind" class="cb-input">${kinds.map(k=>`<option value="${k}">${LABEL[k]}</option>`).join('')}</select></label>
        <label>금액(원)<input id="cb-gift-rec-amt" class="cb-input cb-num" inputmode="numeric" placeholder="0" oninput="cbGiftFmtInput(this)"></label>
        <label class="cb-gift-ledger-memo">메모<input id="cb-gift-rec-memo" class="cb-input" maxlength="120" placeholder="예: 계좌 이체"></label>
        <button type="button" class="cb-btn" onclick="cbGiftAddRecord()">기록 추가</button>
        <p id="cb-gift-rec-error" class="cb-gift-ledger-error" role="alert" hidden></p>
      </div>
      ${cbGiftTransferLinkHtml(kinds)}
      ${typeof finMobileNote==='function'?finMobileNote('증여 기록'):''}
      ${rows.length?cbGiftLedgerYearsHtml(rows,LABEL,inWindow,today)
        :'<div class="fin-empty">아직 기록이 없습니다. 지금까지 한 증여를 날짜와 금액으로 적어 두면 10년 합계를 자동으로 더합니다.</div>'}
      <p class="cb-gift-ledger-foot">합계는 입력한 금액을 확인 기준일 하나에 대해 단순히 더한 값입니다(기준일을 정하지 않았으면 오늘 기준). 증여일마다의 10년 기간을 각각 판정하지 않으며, 증여 당시 재산 평가액·증여세·신고 기한은 계산하지 않습니다. 같은 증여자에게서 받은 것만 적어 주세요.</p>
    </div>`;
}
function cbGiftPrior(kind){
  const key=kind==='spouse'?'spousePrior':'childPrior';
  const raw=cbGiftCfg()[key]||{};
  const amount=Number(raw.amount);
  const asOf=/^\d{4}-\d{2}-\d{2}$/.test(raw.asOf||'')?raw.asOf:'';
  // 기록장에 그 종류의 기록이 있으면 손으로 적은 합계 대신 기록 합계를 쓴다(저장된 수기 값은 지우지 않는다).
  const records=cbGiftRecords(kind==='spouse'?'spouse':'child');
  if(records.length){
    const sum=cbGiftLedgerSum(records,kind==='spouse'?'spouse':'child',asOf);
    return {confirmed:raw.confirmed===true,asOf,amount:sum==null?0:sum,amountKnown:sum!=null,fromLedger:true,count:records.length};
  }
  const hasAmount=Object.prototype.hasOwnProperty.call(raw,'amount')&&Number.isFinite(amount)&&amount>=0;
  const amountKnown=raw.amountKnown===true||(raw.amountKnown!==false&&hasAmount);
  return {confirmed:raw.confirmed===true,asOf,amount:amountKnown?amount:0,amountKnown};
}
function cbGiftSetPrior(kind, field, raw){
  const key=kind==='spouse'?'spousePrior':'childPrior';
  const cfg=cbGiftCfg(); if(!cfg[key]||typeof cfg[key]!=='object') cfg[key]={confirmed:false,asOf:''};
  if(field==='confirmed') cfg[key].confirmed=raw===true||raw==='true';
  else if(field==='asOf') cfg[key].asOf=/^\d{4}-\d{2}-\d{2}$/.test(raw||'')?raw:'';
  else if(field==='amount'){
    const digits=String(raw||'').replace(/[^\d]/g,'');
    if(digits===''){
      delete cfg[key].amount;
      cfg[key].amountKnown=false;
    }else{
      cfg[key].amount=Math.round(Number(digits));
      cfg[key].amountKnown=true;
    }
  }
  cbGiftSave();
}
// 최근 10년 실제 증여 합계와 기준일을 확인하기 전에는 공제 잔여·초과 여부를 반환하지 않는다.
function cbGiftDeductionReview(prior, plannedValue, limit){
  const planned=Math.max(0,Number(plannedValue)||0), cap=Math.max(0,Number(limit)||0);
  const ready=prior?.confirmed===true&&prior?.amountKnown===true&&/^\d{4}-\d{2}-\d{2}$/.test(prior?.asOf||'');
  if(!ready) return {ready:false,planned,limit:cap,prior:Math.max(0,Number(prior?.amount)||0),total:null,remaining:null,excess:null};
  const previous=Math.max(0,Number(prior.amount)||0), total=previous+planned;
  return {ready:true,planned,limit:cap,prior:previous,total,remaining:Math.max(0,cap-total),excess:Math.max(0,total-cap)};
}
// 금액 입력란 천 단위 콤마
function cbGiftFmtInput(el){
  const digits = el.value.replace(/[^\d]/g,'');
  el.value = digits ? Number(digits).toLocaleString('ko-KR') : '';
}

// ── 계산 ────────────────────────────────────────────────────
// 유기정기금 현재가치 계수 — 월이율 i = 연 할인율/12, n개월 통상연금
function cbGiftPvFactor(months, ratePct){
  const i = (ratePct||0)/100/12;
  if (i <= 0) return months;
  return (1 - Math.pow(1+i, -months)) / i;
}
// 자녀 연령대별 계획 — 월 이체액 → 명목 총액 / PV / 법정 공제액과의 단순 규모 비교.
// 연령대가 바뀐다는 이유만으로 직전 10년 증여가 사라지는 것은 아니다.
function cbGiftChildPlan(){
  const rate = cbGiftRate();
  const f120 = cbGiftPvFactor(120, rate);
  return CB_GIFT_CHILD_SEGS.map((g,k)=>{
    const monthly = cbGiftChildAmt(k);
    const nominal = monthly * 120;
    const pv = monthly * f120;
    return { ...g, idx:k, color:CB_GIFT_SEG_COLORS[k], monthly, nominal, pv,
      usePct: g.limit>0 ? pv/g.limit*100 : 0 };
  });
}
// 부부 계획 구간별 총액 — 6억 공제액과의 단순 규모 비교(공제 갱신 계산 아님)
function cbGiftSpousePlan(){
  return [0,1,2,3].map(k=>({
    idx:k, label:(k+1)+'구간', years:(k*10)+'-'+(k*10+9)+'년',
    y0:k*10, total:cbGiftSpouseAmt(k), limit:CB_GIFT_SPOUSE_LIMIT,
    usePct: cbGiftSpouseAmt(k)/CB_GIFT_SPOUSE_LIMIT*100,
  }));
}
// 출생 연월 기준 만 나이(소수)
function cbGiftAgeNow(){
  const b = new Date(cbGiftBirth()+'-01');
  return (Date.now() - b.getTime()) / (365.25*86400000);
}

// ── 자녀 차트 ────────────────────────────────────────────────
// 회색 = 표시 시작 시점부터의 누적 명목 이체액 / 색 = 현재 계획 구간 내 누적 PV
function cbGiftChildChartSvg(w,h){
  const plan = cbGiftChildPlan(), rate = cbGiftRate(), years = cbGiftYears();
  const by = parseInt(cbGiftBirth().slice(0,4),10);
  const a0 = Math.max(0, Math.round(cbGiftAgeNow()));   // 표시 시작 나이(만 나이 반올림)
  const ages = Array.from({length:years},(_,k)=>a0+k);

  // 연도별 값 산출
  let cumNom = 0;
  const rows = ages.map(a=>{
    const si = Math.floor(a/10);
    const seg = (si>=0 && si<plan.length) ? plan[si] : null;
    cumNom += seg ? seg.monthly*12 : 0;
    // 구간 내 누적 PV — 구간 시작과 표시 시작 중 늦은 쪽부터 경과한 개월 수
    let segPv = 0;
    if (seg){
      const from = Math.max(seg.a0, a0);
      segPv = seg.monthly * cbGiftPvFactor((a - from + 1)*12, rate);
    }
    return { year:by+a, age:a, seg, segPv, cumNom };
  });
  window._cbGiftChildHover = rows;

  const step = cbNiceStep(Math.max(cumNom*1.12, 1)/5);
  const maxV = Math.max(step, Math.ceil(cumNom*1.12/step)*step);
  const gridN = Math.round(maxV/step);
  const padL=60, padR=10, padT=12, padB=24;   // 왼쪽 눈금 '5,000만'이 잘리지 않는 폭
  const plotW=w-padL-padR, plotH=h-padT-padB;
  const X=k=>padL + k*(plotW/years);
  const Y=v=>padT + plotH - (v/maxV)*plotH;
  const slot=plotW/years, bw=Math.max(2, slot*0.72);
  let out='';
  out+=cbAmtGridSvg(Array.from({length:gridN+1},(_,g)=>step*g), Y, padL, w-padR);
  // 누적 명목(회색, 뒤) → 구간 누적 PV(구간색, 앞)
  rows.forEach((r,k)=>{
    const xc = X(k) + slot/2;
    const yN = Y(r.cumNom);
    out+=`<rect x="${(xc-bw/2).toFixed(1)}" y="${yN.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,padT+plotH-yN).toFixed(1)}" rx="1.5" fill="${CB_GIFT_GREY}" opacity="0.35"></rect>`;
    if (r.seg && r.segPv>0){
      const yP = Y(r.segPv);
      out+=`<rect x="${(xc-bw/2).toFixed(1)}" y="${yP.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,padT+plotH-yP).toFixed(1)}" rx="1.5" fill="${r.seg.color}" opacity="0.9"></rect>`;
    }
  });
  // X축 나이 라벨
  const stepX = Math.max(1, Math.round(years/5));
  for(let k=0;k<years;k+=stepX){
    out+=`<text x="${(X(k)+slot/2).toFixed(1)}" y="${h-6}" style="fill:var(--lab)" font-size="12" text-anchor="middle">${ages[k]}세</text>`;
  }
  out+=`<text x="${(X(years-1)+slot/2).toFixed(1)}" y="${h-6}" style="fill:var(--lab)" font-size="12" text-anchor="middle">${ages[years-1]}세</text>`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:auto" role="img" aria-label="자녀 연령대별 정기증여 계획. 회색은 전체 명목 누계, 색 막대는 계획 구간별 현재가치이며 세액 판정 차트가 아닙니다."><title>자녀 연령대별 정기증여 계획 · 세액 판정 아님</title>${out}</svg>`;
}

// ── 부부 차트 ────────────────────────────────────────────────
// 회색 = 전체 계획 누적 / teal = 입력한 계획 구간 내 누적. 계획 구간은 공제 갱신일이 아니다.
function cbGiftSpouseChartSvg(w,h){
  const plan = cbGiftSpousePlan(), years = cbGiftYears();
  const my = parseInt(cbGiftMarriage().slice(0,4),10);

  let cumAll = 0;
  const rows = Array.from({length:years},(_,k)=>{
    const si = Math.floor(k/10);
    const seg = (si>=0 && si<plan.length) ? plan[si] : null;
    const inYr = k - (si*10) + 1;                       // 구간 내 몇 년차인지 (1~10)
    const segCum = seg ? seg.total*(inYr/10) : 0;
    cumAll += seg ? seg.total/10 : 0;
    return { year:my+k, nth:k+1, seg, segCum, cumAll };
  });
  window._cbGiftSpouseHover = rows;

  const maxV = Math.max(CB_GIFT_SPOUSE_LIMIT, cumAll*1.12);
  const step = maxV/5;
  const padL=60, padR=10, padT=12, padB=24;   // 왼쪽 눈금 '5,000만'이 잘리지 않는 폭
  const plotW=w-padL-padR, plotH=h-padT-padB;
  const X=k=>padL + k*(plotW/years);
  const Y=v=>padT + plotH - (v/maxV)*plotH;
  const slot=plotW/years, bw=Math.max(2, slot*0.72);
  let out='';
  out+=cbAmtGridSvg(Array.from({length:6},(_,g)=>step*g), Y, padL, w-padR);
  rows.forEach((r,k)=>{
    const xc = X(k) + slot/2;
    const yA = Y(r.cumAll);
    out+=`<rect x="${(xc-bw/2).toFixed(1)}" y="${yA.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,padT+plotH-yA).toFixed(1)}" rx="1.5" fill="${CB_GIFT_GREY}" opacity="0.35"></rect>`;
    if (r.segCum>0){
      const yS = Y(r.segCum);
      out+=`<rect x="${(xc-bw/2).toFixed(1)}" y="${yS.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,padT+plotH-yS).toFixed(1)}" rx="1.5" fill="${CB_GIFT_SPOUSE_COLOR}" opacity="0.9"></rect>`;
    }
  });
  // 10년 구간 경계
  for(let k=10;k<years;k+=10){
    out+=`<line x1="${X(k).toFixed(1)}" x2="${X(k).toFixed(1)}" y1="${padT}" y2="${padT+plotH}" style="stroke:var(--bd2)" stroke-width="1" stroke-dasharray="3 4" opacity="0.7"></line>`;
  }
  const stepX = Math.max(1, Math.round(years/5));
  for(let k=0;k<years;k+=stepX){
    out+=`<text x="${(X(k)+slot/2).toFixed(1)}" y="${h-6}" style="fill:var(--lab)" font-size="12" text-anchor="middle">${my+k}</text>`;
  }
  out+=`<text x="${(X(years-1)+slot/2).toFixed(1)}" y="${h-6}" style="fill:var(--lab)" font-size="12" text-anchor="middle">${my+years-1}</text>`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:auto" role="img" aria-label="부부 증여 계획. 회색은 전체 계획 누계, 청록색은 입력한 계획 구간 누계이며 각 구간이 공제 갱신일을 뜻하지 않습니다."><title>부부 증여 계획 · 구간은 공제 갱신일 아님</title>${out}</svg>`;
}

// ── 렌더 ────────────────────────────────────────────────────
function cbRenderGift(){
  const el = document.getElementById('cb-gift2'); if(!el) return;
  // 이미 연결해 둔 자동이체·적어 둔 기록이 현금 흐름에 빠져 있으면 채운다(재무 기록을 불러온 뒤에만, 바뀐 것이 있을 때만 저장).
  if(window._kvLoadState?.ext==='ready'&&!(typeof isMobileLayout==='function'&&isMobileLayout())&&cbGiftSyncCashflow())
    Promise.resolve(saveExtDataToKV()).catch(e=>console.error('[gift cashflow sync]',e));
  const years = cbGiftYears(), rate = cbGiftRate();
  const child = cbGiftChildPlan(), spouse = cbGiftSpousePlan();
  const childPvT  = child.reduce((s,g)=>s+g.pv,0);
  const spouseT   = spouse.reduce((s,g)=>s+g.total,0);
  const childPrior=cbGiftPrior('child'), spousePrior=cbGiftPrior('spouse');
  const childAge=Math.max(0,Math.floor(cbGiftAgeNow()));
  const childCurrent=child[Math.max(0,Math.min(child.length-1,Math.floor(childAge/10)))]||child[0];
  const childLimit=childAge<20?CB_GIFT_MINOR_LIMIT:CB_GIFT_ADULT_LIMIT;
  const childReview=cbGiftDeductionReview(childPrior,childCurrent?.pv||0,childLimit);
  const spouseReview=cbGiftDeductionReview(spousePrior,spouse[0]?.total||0,CB_GIFT_SPOUSE_LIMIT);
  const num = 'font-family:var(--font-num)';

  // 같은 메뉴 가족(실현손익·세금 ↔ 가족 증여)은 소유주 선택을 공유한다 —
  // 탭을 옮길 때 소유주 탭이 사라지지도, 선택이 풀리지도 않는다.
  const giftScope = cbGiftOwnerScope(_cbTaxOwner);
  cbSetHead('자녀 정기증여와 부부 증여 계획 · 금액은 가구 공통이며 소유주 탭은 당사자인 계획만 추립니다',
    cbOwnerBtns(_cbTaxOwner,'cbTaxOwner'));

  // 입력 필드 (라벨 + 인풋)
  const field = (label, input) => `<label class="cb-gift-field" style="flex:1;min-width:132px;display:flex;flex-direction:column;gap:5px">
      <span style="font-size:var(--fs-cap);color:var(--lab);font-weight:600">${label}</span>${input}</label>`;
  const moneyInput = (val, onch) => `<input class="cb-input cb-num" value="${val?Number(val).toLocaleString('ko-KR'):''}" placeholder="0"
      inputmode="numeric" oninput="cbGiftFmtInput(this)" onchange="${onch}" style="padding:7px 9px;width:100%;box-sizing:border-box;text-align:right" />`;
  const priorFields=(kind,prior)=>`<div role="group" aria-label="최근 10년 실제 증여 내역" style="margin-top:12px;padding:10px 11px;border:1px solid var(--bd);border-radius:8px;background:var(--inner)">
      <label style="display:flex;align-items:center;gap:7px;font-size:var(--fs-cap);font-weight:700;color:var(--lab)"><input type="checkbox" ${prior.confirmed?'checked':''} onchange="cbGiftSetPrior('${kind}','confirmed',this.checked)"> 같은 증여자로부터 받은 최근 10년 실제 증여 내역을 확인했습니다</label>
      <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:8px">
        ${field('확인 기준일',`<input type="date" class="cb-input cb-num" value="${cbEsc(prior.asOf)}" onchange="cbGiftSetPrior('${kind}','asOf',this.value)" style="padding:7px 9px;width:100%;box-sizing:border-box" />`)}
        ${prior.fromLedger
          ? field('기준일 이전 10년 실제 증여 합계',`<output class="cb-input cb-num cb-gift-ledger-out" data-tip="아래 증여 기록장의 기록 ${prior.count}건에서 더한 값입니다. 기록을 모두 지우면 직접 입력으로 돌아갑니다.">${prior.amountKnown?cbKrw(prior.amount):'기준일을 정하면 계산'} · 기록장</output>`)
          : field('기준일 이전 10년 실제 증여 합계',moneyInput(prior.amountKnown?String(prior.amount):'',`cbGiftSetPrior('${kind}','amount',this.value)`))}
      </div>
    </div>`;
  const reviewBox=(review,planLabel)=>review.ready
    ? `<div role="status" style="margin-top:10px;padding:9px 11px;border-left:3px solid ${review.excess>0?'var(--warn)':'var(--up)'};background:var(--inner);font-size:var(--fs-cap);line-height:1.6;color:var(--mut)"><b style="color:${review.excess>0?'var(--warn)':'var(--up)'}">최근 10년 공제 검토</b> · 기존 ${cbKrw(review.prior)} + ${planLabel} ${cbKrw(review.planned)} = ${cbKrw(review.total)}<br>${review.excess>0?`공제액 단순 초과 ${cbKrw(review.excess)}`:`공제 잔여 추정 ${cbKrw(review.remaining)}`} · 신고가 필요 없다는 판정이 아니며 증여일별 10년 누계를 다시 확인해야 합니다.</div>`
    : `<div role="status" style="margin-top:10px;padding:9px 11px;border-left:3px solid var(--warn);background:var(--inner);font-size:var(--fs-cap);line-height:1.6;color:var(--mut)"><b style="color:var(--warn)">판정 보류</b> · 확인 체크와 기준일, 최근 10년 실제 증여 합계가 갖춰져야 공제 잔여액을 계산합니다. 0원이어도 직접 확인 후 입력하세요.</div>`;

  // 구간 진행 행 (좌: 라벨/바, 우: 금액/부제)
  const segRow = (color, title, sub, mainVal, subVal, pct) => `
    <div style="padding:9px 0;border-bottom:1px solid var(--bd)">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px">
        <span style="font-size:var(--fs-cap);font-weight:700">${title} <span style="color:var(--lab);font-weight:500">${sub}</span></span>
        <span class="cb-num" style="font-size:var(--fs-body);font-weight:800;white-space:nowrap">${mainVal}</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
        <span style="flex:1;height:6px;border-radius:3px;background:var(--inner);overflow:hidden;display:block">
          <span style="display:block;height:100%;border-radius:3px;width:${Math.max(pct>0?1.5:0,Math.min(100,pct)).toFixed(1)}%;background:${pct>=100?'var(--warn)':'var(--mut)'};transition:width .25s"></span>
        </span>
      </div>
      <div style="text-align:right;font-size:var(--fs-cap);color:var(--dim);margin-top:4px">${subVal}</div>
    </div>`;

  // 화면 순서는 결과 요약(합계·판정) → 구간 막대 → 그래프 → '계획 수정'(접힘) → 실제 증여 확인란이다.
  // 예전에는 입력칸이 맨 위라 결과를 보려면 한 화면을 내려가야 했다. 입력 id·저장 함수는 그대로다.
  // 금액이 전부 0 인 계획은 빈 막대·빈 그래프 대신 한 줄 안내를 띄우고 수정란을 펴 둔다.
  const giftEditBox=(kind,inner,empty)=>`<details class="cb-gift-edit"${(_cbGiftEditOpen[kind]||empty)?' open':''} ontoggle="_cbGiftEditOpen.${kind}=this.open"><summary>계획 수정 <small>기간·금액을 바꾸면 위 결과가 바로 다시 계산됩니다</small></summary>${inner}</details>`;
  const giftEmptyNote='<div class="cb-gift-empty-plan" role="status">아직 입력한 계획 금액이 없습니다. 아래 \'계획 수정\'에서 금액을 넣으면 구간별 규모와 그래프가 나타납니다.</div>';
  const childSettings=`
        <div class="cb-gift-settings" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:13px">
          ${field('자녀 출생 연월', `<input type="month" class="cb-input cb-num" value="${cbGiftBirth()}" onchange="cbGiftSetBirth(this.value)" style="padding:7px 9px;width:100%;box-sizing:border-box" />`)}
          ${field('표시 기간(년)', `<input type="number" class="cb-input cb-num" value="${years}" min="5" max="60" onchange="cbGiftSetYears(this.value)" style="padding:7px 9px;width:100%;box-sizing:border-box" />`)}
          ${field('<span data-tip="상속세 및 증여세법 시행규칙의 현재 유기정기금 평가 이자율입니다. 규칙 버전에서 자동 적용됩니다.">법정 할인율(%)</span>', `<input type="number" class="cb-input cb-num" value="${rate}" readonly aria-readonly="true" style="padding:7px 9px;width:100%;box-sizing:border-box" />`)}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
          ${child.map(g=>field(`${g.label} (${g.ages})`, moneyInput(g.monthly, `cbGiftSetChild(${g.idx}, this.value)`))).join('')}
        </div>
        <div style="font-size:var(--fs-cap);color:var(--dim);margin-top:6px">연령대는 월 이체액 시나리오를 나누기 위한 표시일 뿐 <b>공제 자동 갱신일이 아닙니다.</b> 각 금액은 10년 계약을 가정한 현재가치(PV)입니다.</div>
`;
  const childBody=`
        <div style="margin-top:10px">
          ${child.map(g=>segRow(g.color, g.label, '('+g.ages+')',
              cbKrw(g.pv)+' <span style="font-size:var(--fs-cap);color:var(--lab);font-weight:600">PV</span>',
              `명목 ${cbKrw(g.nominal)} · 공제액 대비 계획 규모 ${Math.min(100,g.usePct).toFixed(1)}% · 갱신 판정 아님`,
              g.usePct)).join('')}
        </div>

        <div style="position:relative;margin-top:12px" onmouseleave="cbGiftHide()">
          ${cbGiftChildChartSvg(560,300)}
          <div style="position:absolute;left:9.64%;right:1.79%;top:0;bottom:24px;display:flex">
            ${Array.from({length:years},(_,k)=>`<div style="flex:1;cursor:crosshair" onmousemove="cbGiftChildHover(event,${k})"></div>`).join('')}
          </div>
        </div>
`;
  const spouseSettings=`
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:13px">
          ${field('차트 계획 기준일', `<input type="date" class="cb-input cb-num" value="${cbGiftMarriage()}" onchange="cbGiftSetMarriage(this.value)" style="padding:7px 9px;width:100%;box-sizing:border-box" />`)}
          ${field('표시 기간(년)', `<input type="number" class="cb-input cb-num" value="${years}" min="5" max="60" onchange="cbGiftSetYears(this.value)" style="padding:7px 9px;width:100%;box-sizing:border-box" />`)}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
          ${spouse.map(g=>field(`${g.idx*10+1}-${(g.idx+1)*10}년 계획 총액`, moneyInput(g.total, `cbGiftSetSpouse(${g.idx}, this.value)`))).join('')}
        </div>
        <div style="font-size:var(--fs-cap);color:var(--dim);margin-top:6px">계획 구간은 차트 구분일 뿐 <b>공제 자동 갱신일이 아닙니다.</b> 실제 공제는 증여일마다 직전 10년 누계로 판단합니다.</div>
`;
  const spouseBody=`
        <div style="margin-top:10px">
          ${spouse.map(g=>segRow(CB_GIFT_SPOUSE_COLOR, g.label, '('+g.years+')',
              cbKrw(g.total), `공제액 대비 계획 규모 ${g.usePct.toFixed(1)}% · 갱신 판정 아님`, g.usePct)).join('')}
        </div>

        <div style="position:relative;margin-top:12px" onmouseleave="cbGiftHide()">
          ${cbGiftSpouseChartSvg(560,300)}
          <div style="position:absolute;left:9.64%;right:1.79%;top:0;bottom:24px;display:flex">
            ${Array.from({length:years},(_,k)=>`<div style="flex:1;cursor:crosshair" onmousemove="cbGiftSpouseHover(event,${k})"></div>`).join('')}
          </div>
        </div>
`;

  el.innerHTML = `
    <div class="cb-gift-row">

      ${giftScope.child||giftScope.spouse?'':`<div class="cb-panel cb-gift-panel cb-gift-empty" role="status">${cbEsc(_cbTaxOwner)} 님이 당사자인 증여 계획이 없습니다. 이 화면은 본인·아내 사이의 부부 증여와 본인이 자녀1에게 하는 자녀 증여만 다룹니다.</div>`}
      ${!giftScope.child?'':`
      <!-- ── 자녀 증여 ── -->
      <div class="cb-panel cb-gift-panel">
        <div style="font-size:var(--fs-card);font-weight:800">자녀 증여</div>
        <div style="font-size:var(--fs-cap);color:var(--lab);margin-top:3px">각 증여일 이전 10년 누계 기준 · 미성년 2천만원·성년 5천만원 공제액 참고 · ${years}년 계획</div>


        <div style="margin-top:14px;padding-top:13px;border-top:1px dashed var(--bd2);text-align:center">
          <div style="font-size:var(--fs-cap);color:var(--lab)">전체 계획 PV 단순합계 <span data-tip="서로 다른 시점의 계획 현재가치를 합한 참고값이며 최근 10년 과세가액이 아닙니다.">(세액 판정 아님)</span></div>
          <div style="${num};font-size:var(--fs-kpi);font-weight:800;margin-top:3px">${cbKrw(childPvT)}</div>
        </div>
        ${reviewBox(childReview,`${childAge}세 기준 향후 10년 계획 PV`)}
        ${childPvT>0?childBody:giftEmptyNote}
        ${giftEditBox('child',childSettings,!(childPvT>0))}
        ${priorFields('child',childPrior)}


      </div>`}
      ${!giftScope.spouse?'':`
      <!-- ── 부부 증여 ── -->
      <div class="cb-panel cb-gift-panel">
        <div style="font-size:var(--fs-card);font-weight:800">부부 증여</div>
        <div style="font-size:var(--fs-cap);color:var(--lab);margin-top:3px">각 증여일 이전 10년 누계 기준 · 배우자 공제액 6억원 참고 · ${years}년 계획</div>


        <div style="margin-top:14px;padding-top:13px;border-top:1px dashed var(--bd2);text-align:center">
          <div style="font-size:var(--fs-cap);color:var(--lab)">전체 계획 총액 <span style="color:var(--dim)">(여러 10년 구간 단순합계)</span></div>
          <div style="${num};font-size:var(--fs-kpi);font-weight:800;margin-top:3px">${cbKrw(spouseT)}</div>
        </div>
        ${reviewBox(spouseReview,'향후 첫 10년 계획')}
        ${spouseT>0?spouseBody:giftEmptyNote}
        ${giftEditBox('spouse',spouseSettings,!(spouseT>0))}
        ${priorFields('spouse',spousePrior)}

      </div>`}
    </div>
    ${cbGiftLedgerHtml(giftScope)}
    <div style="font-size:var(--fs-cap);color:var(--dim);margin-top:10px;line-height:1.6">
      ※ 공제는 고정된 연령대·결혼 후 10년 구간마다 자동으로 새로 생기는 것이 아니라, 원칙적으로 각 증여일 이전 10년 동안 동일인에게 받은 증여를 합산해 검토합니다.
      이 화면은 입력한 최근 10년 합계와 계획 금액을 비교하는 참고용이며 실제 신고·증여 실행 전 세무 전문가 확인이 필요합니다.
      할인율(상속세 및 증여세법 시행규칙상 현재 연 3.0%)과 공제액은 규칙 버전에서 관리하며 변경될 수 있습니다.
    </div>
    ${typeof assetTaxRuleDisclosureHtml==='function'?assetTaxRuleDisclosureHtml('gift',new Date().getFullYear()):''}`;
}

// ── 차트 hover ───────────────────────────────────────────────
function _cbGiftTipLine(lab, val, style){
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:18px;padding:1.5px 0">
    <span style="color:var(--mut)">${lab}</span><span class="cb-num" style="font-weight:700;${style||''}">${val}</span></div>`;
}
function _cbGiftTipShow(ev, html){
  const t = _cbPerfTipEl();
  t.innerHTML = html; t.style.display = 'block';
  const rc = t.getBoundingClientRect(), pad = 16;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + rc.width > window.innerWidth - 8) x = ev.clientX - rc.width - pad;
  if (y + rc.height > window.innerHeight - 8) y = ev.clientY - rc.height - pad;
  t.style.left = Math.max(8, x) + 'px';
  t.style.top  = Math.max(8, y) + 'px';
}
function cbGiftChildHover(ev, k){
  const r = (window._cbGiftChildHover||[])[k]; if(!r) return;
  const segName = r.seg ? r.seg.label : '계획 기간 종료';
  const segColor = r.seg ? r.seg.color : 'var(--lab)';
  _cbGiftTipShow(ev, `<div style="font-size:var(--fs-cap);color:var(--lab);margin-bottom:5px;font-weight:700">${r.year}년 · ${r.age}세 <span style="color:${segColor}">${segName}</span></div>
    ${_cbGiftTipLine('월 이체액', r.seg?cbKrw(r.seg.monthly):'—')}
    ${_cbGiftTipLine('계획 구간 누적 (PV)', cbKrw(Math.round(r.segPv)))}
    ${_cbGiftTipLine('연령 기준 공제액 참고', r.seg?cbKrw(r.seg.limit):'—')}
    ${_cbGiftTipLine('누적 이체 (명목)', cbKrw(Math.round(r.cumNom)))}
    <div style="font-size:var(--fs-cap);color:var(--dim);margin-top:4px">연령대 경계는 공제 갱신일이 아닙니다.</div>`);
}
function cbGiftSpouseHover(ev, k){
  const r = (window._cbGiftSpouseHover||[])[k]; if(!r) return;
  _cbGiftTipShow(ev, `<div style="font-size:var(--fs-cap);color:var(--lab);margin-bottom:5px;font-weight:700">${r.year}년<br>${r.nth}년차</div>
    ${_cbGiftTipLine('계획 구간 누적', cbKrw(Math.round(r.segCum)))}
    ${_cbGiftTipLine('전체 누적', cbKrw(Math.round(r.cumAll)))}
    ${_cbGiftTipLine('배우자 공제액 참고', cbKrw(CB_GIFT_SPOUSE_LIMIT))}
    <div style="font-size:var(--fs-cap);color:var(--dim);margin-top:4px">계획 구간은 공제 갱신일이 아닙니다.</div>`);
}
function cbGiftHide(){ const t = document.getElementById('cb-perf-tip'); if(t) t.style.display = 'none'; }

let _cbGiftYearOpen = {}; // 증여 기록장 연도 묶음 펼침 — 기본은 올해만 펼친다
let _cbGiftEditOpen = { child:false, spouse:false }; // '계획 수정' 펼침 상태 — 입력 뒤 재렌더에도 접히지 않게 메모리에만 둔다
