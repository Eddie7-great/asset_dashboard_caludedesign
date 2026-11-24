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
// 한 달의 자동이체 가상 금액(이미 기록된 달·건너뛴 달·종료 뒤는 뺀다) — renderCashFlow 의 예정 줄과 같은 규칙
function _cfAutoTransferMonthTotals(y, m, ownerOk){
  let atIn=0, atOut=0;
  const daysInMonth = new Date(y, m, 0).getDate();
  const ymKey = y+'-'+String(m).padStart(2,'0');
  (typeof autoTransferData!=='undefined'?autoTransferData:[]).forEach(at=>{
    if (!(at.amt || at.loan) || !at.cycle) return;
    if (!ownerOk(at.owner)) return;
    const monthlyCycle=['monthly','month-end','month-start'].includes(at.cycle);
    if (!monthlyCycle&&at.startMonth) {
      const [sy, sm] = at.startMonth.split('-').map(Number);
      if (y < sy || (y === sy && m < sm)) return;
    }
    if (!monthlyCycle&&at.endMonth) {
      const [ey, em] = at.endMonth.split('-').map(Number);
      if (y > ey || (y === ey && m > em)) return;
    }
    if (!monthlyCycle&&Array.isArray(at.skipMonths) && at.skipMonths.includes(ymKey)) return;
    const hasMaterialized = cfData.some(item=>{
      const idate=new Date(item.date);
      return idate.getFullYear()===y && idate.getMonth()+1===m && item.atId===at.id;
    });
    if (hasMaterialized) return;
    const hasLegacy = cfData.some(item=>{
      const idate=new Date(item.date);
      return idate.getFullYear()===y && idate.getMonth()+1===m &&
        item.isAuto===true && item.atId==null &&
        typeof item.desc==='string' && item.desc.includes(at.desc);
    });
    if (hasLegacy) return;
    let times = 0;
    if (monthlyCycle) times=_autoTransferMonthlyOccurrences(at,y,m).length;
    else if (at.cycle==='weekly') times=Math.floor(daysInMonth/7);
    else if (at.cycle==='daily') times=daysInMonth;
    const total = _effectiveAutoTransferAmt(at, y, m) * times;
    if (at.type==='수입') atIn+=total; else atOut+=total;
  });
  return {atIn, atOut};
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
let _cfXferEditYm = '';
let _cfXferFormOpen = false;
function cfXferOpen(ym){
  if (isMobileLayout()) return; // 모바일은 조회 전용
  const curYm=`${cfYear}-${String(cfMonth).padStart(2,'0')}`;
  const target=ym||curYm;
  const head=cfData.find(c=>c.xferRole==='in'&&c.xferMonth===target);
  _cfXferEditYm=head?target:'';
  _cfXferFormOpen=true;
  if(head){ const [y,m]=target.split('-').map(Number); cfYear=y; cfMonth=m; }
  renderCashFlow();
  const dateEl=document.getElementById('cf-xfer-date'), amtEl=document.getElementById('cf-xfer-amt');
  if(dateEl) dateEl.value=head?head.date:(curYm===_cfMonthKey()?_cfLocalDateKey(new Date()):`${curYm}-25`);
  if(amtEl){ amtEl.value=head?Number(head.amt).toLocaleString():''; amtEl.focus(); }
}
function cfXferClose(){ _cfXferFormOpen=false; _cfXferEditYm=''; renderCashFlow(); }
function cfXferSave(){
  if (isMobileLayout()) return;
  const date=document.getElementById('cf-xfer-date')?.value||'';
  const amt=parseInt(String(document.getElementById('cf-xfer-amt')?.value||'').replace(/,/g,''),10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){ alert('송금한 날짜를 입력하세요.'); return; }
  if(!(amt>0)){ alert('받은 금액을 입력하세요.'); return; }
  const ym=date.slice(0,7);
  const other=cfData.find(c=>c.xferRole==='in'&&c.xferMonth===ym);
  if(other && ym!==_cfXferEditYm && !confirm(`${Number(ym.slice(5))}월 송금 기록이 이미 있습니다. 새 값으로 바꿀까요?`)) return;
  // 고치면서 달을 옮겼으면 예전 달 묶음을 지운다(sync 가 out·est 도 함께 정리)
  if(_cfXferEditYm && _cfXferEditYm!==ym){ for(let k=cfData.length-1;k>=0;k--){ if(cfData[k].xferMonth===_cfXferEditYm) cfData.splice(k,1); } }
  const head=cfData.find(c=>c.xferRole==='in'&&c.xferMonth===ym);
  if(head){ head.date=date; head.amt=amt; }
  else cfData.push({date,type:'수입',cat:CF_XFER_CAT,desc:`${CF_XFER_FROM}가 보낸 남은 돈`,amt,owner:CF_XFER_TO,xferMonth:ym,xferRole:'in'});
  cfSpouseSync();
  _cfXferFormOpen=false; _cfXferEditYm='';
  cfYear=Number(ym.slice(0,4)); cfMonth=Number(ym.slice(5,7));
  saveCfData(); renderCashFlow(); saveExtDataToKV();
}
async function cfXferDelete(ym){
  if (isMobileLayout()) return;
  if(!confirm(`${Number(ym.slice(5))}월 부부 송금 기록을 지울까요? (아내 지출 추정 줄도 함께 지워집니다)`)) return;
  for(let k=cfData.length-1;k>=0;k--){ if(cfData[k].xferMonth===ym) cfData.splice(k,1); }
  _cfXferFormOpen=false; _cfXferEditYm='';
  saveCfData(); renderCashFlow(); await saveExtDataToKV();
}
// 이 달 부부 돈의 흐름 카드 — cfPersonMonth 값만 그린다(합계는 오른쪽 요약과 같은 규칙)
function cfCoupleFlowHtml(y, m){
  const ym=`${y}-${String(m).padStart(2,'0')}`;
  const me=cfPersonMonth(CF_XFER_TO, ym), wife=cfPersonMonth(CF_XFER_FROM, ym);
  const won=v=>'₩'+Math.round(Math.abs(v)).toLocaleString();
  const sg=(v,neg)=>v?`${neg?'-':'+'}${won(v)}`:'₩0';
  const sent=me.xferIn;
  const recorded=sent>0;
  const step=(label,val,cls='',extra='')=>`<div class="cf-flow-step${extra}"><span>${label}</span><b class="${cls}">${val}</b></div>`;
  const wifeLeft=wife.income+wife.dividend-wife.expense-wife.xferOut-wife.est;
  const meLeft=me.income+me.dividend+me.xferIn-me.expense;
  const wifeLane=`<div class="cf-flow-lane"><div class="cf-flow-who"><i style="background:${ownerColors[CF_XFER_FROM]}"></i>${CF_XFER_FROM}</div>`
    + step('월급 등 수입',sg(wife.income),'c-up')
    + (wife.expense?step('따로 기록한 지출',sg(wife.expense,true),'c-dn'):'')
    + (recorded
      ? step(`${CF_XFER_TO}에게 보낸 남은 돈 <small>${_cfEsc(String(wife.xferDate||'').slice(5).replace('-','/'))}</small>`,sg(wife.xferOut,true),'c-dn',' is-xfer')
        + step('쓴 돈 <small data-tip="지출 내역을 따로 적지 않으므로 월급에서 보낸 돈을 뺀 값을 아내 지출로 봅니다.">추정</small>',sg(wife.est,true),'c-dn')
      : `<div class="cf-flow-step is-missing"><span>${CF_XFER_TO}에게 보낸 돈</span><b>미기록</b></div>`)
    + (wife.dividend?step('배당 <small>증권 계좌에 남음</small>',sg(wife.dividend),'c-up'):'')
    + `<div class="cf-flow-step is-total"><span>${CF_XFER_FROM} 쪽에 남은 돈</span><b>${won(wifeLeft)}</b></div></div>`;
  const meLane=`<div class="cf-flow-lane"><div class="cf-flow-who"><i style="background:${ownerColors[CF_XFER_TO]}"></i>${CF_XFER_TO}</div>`
    + step('월급 등 수입',sg(me.income),'c-up')
    + step(`${CF_XFER_FROM}에게서 받은 돈`,recorded?sg(sent):'미기록',recorded?'c-up':'',recorded?' is-xfer':' is-missing')
    + (me.dividend?step('배당',sg(me.dividend),'c-up'):'')
    + step('지출',sg(me.expense,true),'c-dn')
    + `<div class="cf-flow-step is-total"><span>${CF_XFER_TO} 쪽에 남은 돈</span><b class="${meLeft>=0?'c-up':'c-dn'}">${meLeft<0?'-':''}${won(meLeft)}</b></div></div>`;
  const total=meLeft+wifeLeft;
  const actions=isMobileLayout()?'':(recorded
    ? `<button type="button" class="cf-xfer-btn" onclick="cfXferOpen('${ym}')">송금 수정</button>`
    : `<button type="button" class="cf-xfer-btn" onclick="cfXferOpen()">⇄ 송금 기록</button>`);
  const form=(_cfXferFormOpen&&!isMobileLayout())
    ? `<div class="cf-xfer-form"><span class="cf-xfer-form-title">${CF_XFER_FROM} → ${CF_XFER_TO} 송금</span>`
      + `<label>날짜 <input type="date" id="cf-xfer-date" class="form-input" data-no-comma="1"></label>`
      + `<label>받은 금액 <input type="text" id="cf-xfer-amt" class="form-input" inputmode="numeric" placeholder="0"></label>`
      + `<button type="button" class="btn-submit" onclick="cfXferSave()">저장</button>`
      + (_cfXferEditYm?`<button type="button" class="cf-xfer-btn" onclick="cfXferDelete('${_cfXferEditYm}')">삭제</button>`:'')
      + `<button type="button" class="cf-xfer-btn" onclick="cfXferClose()">취소</button></div>`
    : '';
  return `<div class="cb-label f-between cf-flow-head"><span>${m}월 우리 집 돈의 흐름</span>${actions}</div>`
    + form
    + `<div class="cf-flow">${wifeLane}<div class="cf-flow-arrow" aria-hidden="true"><i>➜</i>송금</div>${meLane}</div>`
    + `<div class="cf-flow-foot">부부 합계 남은 돈 <b class="${total>=0?'c-up':'c-dn'}">${total<0?'-':''}${won(total)}</b>`
    + `<span>송금은 집 안에서 통장만 옮긴 돈이라 부부 합계에서는 빼고 셉니다.${recorded?'':' 송금을 기록하기 전까지는 아내 월급 전체가 남은 돈으로 잡힙니다.'}</span></div>`;
}

function setCfOwner(owner, btn) {
  _cfOwner = owner;
  document.querySelectorAll('[id^="cf-owner-"]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const ownerInput=document.getElementById('cf-owner-input');if(ownerInput&&owner!=='전체')ownerInput.value=owner;
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
    const eps=Number(s.eps)||0;
    const months=[...new Set((Array.isArray(s.months)?s.months:[])
      .map(Number).filter(m=>Number.isInteger(m)&&m>=0&&m<12))];
    if(eps<=0||months.length===0) return;
    const rate = curRate(s.cur);
    const tkrNorm = String(s.tkr||'').toUpperCase().replace(/\.(KS|KQ)$/i,'');
    // 캐시/API에서 확인한 일정만 파괴적 stale 정리의 근거로 사용한다.
    // 정적 DB 폴백은 조회 실패 때도 나타날 수 있어 기존 행 삭제 근거로는 부족하다.
    if(s._divSource==='cache') scheduleKnownTickers.add(tkrNorm);
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

function addCashFlow() {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  const editIdx=parseInt(document.getElementById('cf-edit-index').value);
  const dt=document.getElementById('cf-date').value,typ=document.getElementById('cf-type').value;
  const cat=document.getElementById('cf-cat').value,des=document.getElementById('cf-desc').value.trim();
  const am=parseInt((document.getElementById('cf-amt').value||'').replace(/,/g,''));
  const owner=document.getElementById('cf-owner-input')?.value||(_cfOwner==='전체'?'':_cfOwner);
  if(!dt||!des||!am){alert('항목을 모두 입력해주세요.');return;}
  if(!OWNERS.includes(owner)){alert('소유주를 선택하세요.');return;}
  const newItem={date:dt,type:typ,cat:cat,desc:des,amt:am,owner};
  if(editIdx>-1){cfData[editIdx]=newItem;document.getElementById('cf-edit-index').value='-1';document.getElementById('btn-cf-submit').innerText='저장';}
  else cfData.push(newItem);
  document.getElementById('cf-desc').value='';document.getElementById('cf-amt').value='';saveCfData();renderCashFlow();saveExtDataToKV();
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
function editCF(idx){
  if (isMobileLayout()) return; // 모바일은 조회 전용
  if(cfData[idx]&&cfData[idx].xferRole) return cfXferOpen(cfData[idx].xferMonth);
  cfShowEntry(); // 접힌 폼을 펴서 수정 값을 보여 준다

  const item=cfData[idx];document.getElementById('cf-edit-index').value=idx;
  document.getElementById('cf-date').value=item.date;document.getElementById('cf-type').value=item.type;
  document.getElementById('cf-cat').value=item.cat;document.getElementById('cf-desc').value=item.desc;
  const ownerInput=document.getElementById('cf-owner-input');if(ownerInput&&OWNERS.includes(item.owner))ownerInput.value=item.owner;
  document.getElementById('cf-amt').value=item.amt;document.getElementById('btn-cf-submit').innerText='수정';
}
// 편집 상태 해제 — 폼 패널 바깥을 클릭했을 때 호출.
function resetCfForm() {
  const idxEl = document.getElementById('cf-edit-index');
  if (!idxEl || parseInt(idxEl.value || '-1') === -1) return;
  idxEl.value = '-1';
  const descEl = document.getElementById('cf-desc'); if (descEl) descEl.value = '';
  const amtEl = document.getElementById('cf-amt'); if (amtEl) amtEl.value = '';
  const dEl = document.getElementById('cf-date'); if (dEl) dEl.value = _cfLocalDateKey(new Date());
  const tEl = document.getElementById('cf-type'); if (tEl) tEl.value = '지출';
  const cEl = document.getElementById('cf-cat'); if (cEl && cEl.options.length) cEl.selectedIndex = 0;
  const oEl = document.getElementById('cf-owner-input'); if (oEl) oEl.value = _cfOwner==='전체'?'본인':_cfOwner;
  const btn = document.getElementById('btn-cf-submit'); if (btn) btn.innerText = '저장';
}
// 폼 바깥 클릭 시 편집 상태 자동 해제. mousedown 으로 잡되, 다른 행의 ✎/✕ 클릭은
// 자체 onclick 핸들러(editCF/deleteCF)에 위임하기 위해 .btn-action 클릭은 건너뛴다.
document.addEventListener('mousedown', (e) => {
  const idxEl = document.getElementById('cf-edit-index');
  if (!idxEl || parseInt(idxEl.value || '-1') === -1) return;
  const panel = document.getElementById('cf-input-panel');
  if (!panel) return;
  if (panel.contains(e.target)) return;
  if (e.target.closest && e.target.closest('.btn-action')) return;
  resetCfForm();
});

function updateCfTrendChart() {
  let labels=[],netData=[],bgColors=[];
  window.cfTrendDetails={in:[],out:[]};
  // 자동이체 월별 예상 금액 — 실체화·skip·종료 이후 제외 규칙은 _cfAutoTransferMonthTotals 한 곳
  const calcAutoTransferForMonth=(y,m)=>_cfAutoTransferMonthTotals(y,m,cfInScope);
  for(let i=5;i>=0;i--){
    let d=new Date(cfYear,cfMonth-1-i,1);let y=d.getFullYear();let m=d.getMonth()+1;
    labels.push(m + '월');let mIn=0,mOut=0;
    cfData.forEach(item=>{let idate=new Date(item.date);if(idate.getFullYear()===y&&idate.getMonth()+1===m&&cfRowCounts(item)){if(item.type==='수입')mIn+=item.amt;else mOut+=item.amt;}});
    // 자동이체 예상금액 포함 (실체화된 항목/skip/종료 이후는 calcAutoTransferForMonth에서 이미 제외됨)
    const atAmts = calcAutoTransferForMonth(y, m);
    mIn+=atAmts.atIn; mOut+=atAmts.atOut;
    let net=mIn-mOut;netData.push(net);window.cfTrendDetails.in.push(mIn);window.cfTrendDetails.out.push(mOut);bgColors.push(net>=0?cssVar('--up','#4ade80'):cssVar('--dn','#fb7185'));
  }
  if(window.cfTrendChartInst){window.cfTrendChartInst.data.labels=labels;window.cfTrendChartInst.data.datasets[0].data=netData;window.cfTrendChartInst.data.datasets[0].backgroundColor=bgColors;window.cfTrendChartInst.update();}
}

function renderCashFlow() {
  cfSpouseSyncAndSave();
  document.getElementById('cf-sel-year').value=cfYear;document.getElementById('cf-sel-month').value=cfMonth;
  // 소유주 열은 항상 표시 — 모드 전환 시 컬럼 폭이 재계산되며 인접 셀과 글자가 겹치는 현상 방지
  const thOwner = document.getElementById('cf-th-owner');
  if (thOwner) thOwner.style.display = '';
  const allMonth=cfData.filter(i=>{
    if(i.date==='미정'&&i.divKey){const p=i.divKey.split('_');return parseInt(p[p.length-2])===cfYear&&parseInt(p[p.length-1])===cfMonth;}
    const d=new Date(i.date);return d.getFullYear()===cfYear&&(d.getMonth()+1)===cfMonth;
  });
  // owner 필터: owner 필드가 있는 항목만 해당 소유주로 필터링 (기존 항목은 owner 없으면 전체에 표시)
  // 부부 범위만 보인다. 부부 합계에서 송금은 본인 쪽 한 줄만 '합계 제외'로 보이고 아내 쪽 줄은 숨긴다.
  const f=allMonth.filter(i=>cfInScope(i.owner)&&!(_cfOwner==='전체'&&i.xferRole==='out')).sort((a,b)=>{if(a.date==='미정')return 1;if(b.date==='미정')return -1;return new Date(b.date)-new Date(a.date);});
  let html='',tIn=0,tOut=0,expByCat=Object.create(null),incomeByCat=Object.create(null);
  f.forEach(i=>{
    const realIdx=cfData.findIndex(x=>x===i);
    const amount=Number(i.amt)||0;
    if(i.xferRole){
      // 송금 묶음 줄 — 수정·삭제는 송금 기록 창 하나로 한다
      const moving=cfIsXferMove(i), excluded=!cfRowCounts(i);
      if(!excluded){ if(i.type==='수입'){tIn+=amount;incomeByCat[i.cat]=(incomeByCat[i.cat]||0)+amount;}else{tOut+=amount;expByCat[i.cat]=(expByCat[i.cat]||0)+amount;} }
      const sgn=excluded?'':(i.type==='수입'?'+':'-'), col=excluded?'var(--t3)':(i.type==='수입'?'var(--up)':'var(--dn)');
      const typeCell=moving?`<span class="cf-xfer-tag">송금</span>`:`<span style="color:var(--dn);font-weight:700">지출</span>`;
      const who=moving&&excluded?'부부':(i.owner||'-');
      const desc=_cfEsc(i.desc)+(excluded?' <small style="color:var(--t3)">(합계 제외)</small>':(i.xferRole==='est'?' <small style="color:var(--t3)">(추정)</small>':''));
      html+=`<tr class="${excluded?'cf-row-muted':''}"><td class="text-left">${_cfEsc(i.date.substring(5).replace('-','/'))}</td><td class="text-left">${typeCell}</td><td class="text-left"><span style="font-size:var(--fs-cap);color:var(--t3);white-space:nowrap">${_cfEsc(who)}</span></td><td class="text-left">${_cfEsc(i.cat)}</td><td class="text-left">${desc}</td><td style="color:${col}" class="text-right">${sgn}₩${amount.toLocaleString()}</td><td class="text-right"><span style="font-size:var(--fs-cap);color:var(--t3)">매월 기록</span></td><td class="text-right" style="white-space:nowrap"><button class="btn-action" type="button" aria-label="부부 송금 수정" onclick="cfXferOpen('${_cfEsc(i.xferMonth)}')">✎</button><button class="btn-action" type="button" aria-label="부부 송금 삭제" onclick="cfXferDelete('${_cfEsc(i.xferMonth)}')">✕</button></td></tr>`;
      return;
    }
    if(i.type==='수입'){tIn+=amount;incomeByCat[i.cat]=(incomeByCat[i.cat]||0)+amount;}else{tOut+=amount;expByCat[i.cat]=(expByCat[i.cat]||0)+amount;}
    let cls=i.type==='수입'?'var(--up)':'var(--dn)',sign=i.type==='수입'?'+':'-';
    let fd=i.date==='미정'?'미정':i.date.substring(5).replace('-','/');
    // 주기 칸은 주기만 적는다 — '자동이체 · 매월 15일'은 칸 폭(88px)을 넘어 '자동이…'로 잘렸다(2026-11-24).
    // 자동이체라는 사실은 내용 칸의 [자동] 머리말과 마우스 설명(title)에 있다.
    const cycleDisp=i.isAuto?`<span class="cf-cycle-text" title="자동이체${i.cycleLabel?' · '+_cfEsc(i.cycleLabel):''}">${_cfEsc(i.cycleLabel||'자동이체')}</span>`:`<span class="cf-cycle-text">일회성</span>`;
    const ownerCell=`<td class="text-left"><span style="font-size:var(--fs-cap);color:var(--t3);white-space:nowrap">${_cfEsc(i.owner||'-')}</span></td>`;
    html+=`<tr><td class="text-left">${_cfEsc(fd)}</td><td class="text-left"><span style="color:${cls};font-weight:700">${_cfEsc(i.type)}</span></td>${ownerCell}<td class="text-left">${_cfEsc(i.cat)}</td><td class="text-left" data-overflow-tip="${_cfEsc(i.desc)}">${_cfEsc(i.desc)}</td><td style="color:${cls}" class="text-right">${sign}₩${amount.toLocaleString()}</td><td class="text-right">${cycleDisp}</td><td class="text-right" style="white-space:nowrap"><button class="btn-action" type="button" aria-label="현금흐름 수정" onclick="editCF(${realIdx})">✎</button><button class="btn-action" type="button" aria-label="현금흐름 삭제" onclick="deleteCF(${realIdx})">✕</button></td></tr>`;
  });
  // 자동이체 가상 행: 각 자동이체별로 해당 월의 실제/레거시 [자동] 항목이 없으면 예정 행 표시
  const daysInMonth=new Date(cfYear,cfMonth,0).getDate();
  const ymKey=cfYear+'-'+String(cfMonth).padStart(2,'0');
  autoTransferData.forEach(at=>{
    if(!(at.amt||at.loan)||!at.cycle)return;
    if(!cfInScope(at.owner))return;
    const monthlyCycle=['monthly','month-end','month-start'].includes(at.cycle);
    const monthlyOccurrences=monthlyCycle?_autoTransferMonthlyOccurrences(at,cfYear,cfMonth):[];
    if(monthlyCycle&&!monthlyOccurrences.length)return;
    // 최초 등록 월부터 표시
    if (!monthlyCycle&&at.startMonth) {
      const [sy, sm] = at.startMonth.split('-').map(Number);
      if (cfYear < sy || (cfYear === sy && cfMonth < sm)) return;
    }
    // 종료 월(취소 월) 이후에는 표시 안 함
    if (!monthlyCycle&&at.endMonth) {
      const [ey, em] = at.endMonth.split('-').map(Number);
      if (cfYear > ey || (cfYear === ey && cfMonth > em)) return;
    }
    // 특정 월 skip 설정
    if (!monthlyCycle&&Array.isArray(at.skipMonths) && at.skipMonths.includes(ymKey)) return;
    // 이미 해당 월 atId로 실체화된 cfData 항목이 있으면 가상 행 skip
    const hasMaterialized = cfData.some(item=>{
      const idate=new Date(item.date);
      return idate.getFullYear()===cfYear && idate.getMonth()+1===cfMonth && item.atId===at.id;
    });
    if (hasMaterialized) return;
    // 레거시 [자동] 항목 (atId 없음) 중복 방지
    const hasLegacyAuto = cfData.some(item=>{
      const idate=new Date(item.date);
      return idate.getFullYear()===cfYear && idate.getMonth()+1===cfMonth &&
        item.isAuto===true && item.atId==null &&
        typeof item.desc==='string' && item.desc.includes(at.desc);
    });
    if (hasLegacyAuto) return;
    let times=0;
    if(monthlyCycle)times=monthlyOccurrences.length;
    else if(at.cycle==='weekly')times=Math.floor(daysInMonth/7);
    else if(at.cycle==='daily')times=daysInMonth;
    const effAmt = _effectiveAutoTransferAmt(at, cfYear, cfMonth);
    const total=effAmt*times;
    if(at.type==='수입')tIn+=total;
    else{tOut+=total;expByCat[at.cat]=(expByCat[at.cat]||0)+total;}
    const atCls = at.type === '수입' ? 'var(--up)' : 'var(--dn)';
    const atSign = at.type === '수입' ? '+' : '-';
    const cycleLbl = _getCycleLabel(at);
    const safeAtId=Number.isSafeInteger(Number(at.id))?Number(at.id):0;
    const scheduledLabel=monthlyCycle&&monthlyOccurrences.length
      ? _cfLocalDateKey(monthlyOccurrences[0].date).substring(5).replace('-','/')
      : '-';
    const atOwnerCell = `<td class="text-left"><span style="font-size:var(--fs-cap);color:var(--t3);white-space:nowrap">${_cfEsc(at.owner||'미지정')}</span></td>`;
    html+=`<tr style="opacity:.75">
      <td class="text-left">${scheduledLabel}</td>
      <td class="text-left"><span style="color:${atCls};font-weight:700">${_cfEsc(at.type)}</span></td>
      ${atOwnerCell}<td class="text-left">${_cfEsc(at.cat||'-')}</td>
      <td class="text-left"><span style="color:var(--t3)">[예정]</span> ${_cfEsc(at.desc||'자동이체')}</td>
      <td style="color:${atCls}" class="text-right">${atSign}₩${total.toLocaleString()}</td>
      <td class="text-right"><span style="font-size:var(--fs-cap);color:var(--t3)">${_cfEsc(cycleLbl)}</span></td>
      <td class="text-right" style="white-space:nowrap">
        <button class="btn-action" title="이 달 금액 수정" onclick="editAutoTransferMonth(${safeAtId},${cfYear},${cfMonth})">✎</button>
        <button class="btn-action" title="이 달만 삭제" onclick="skipAutoTransferMonth(${safeAtId},${cfYear},${cfMonth})">✕</button>
      </td>
    </tr>`;
  });
  const emptyColspan = '8';
  document.getElementById('cf-table-body').innerHTML=html||`<tr><td colspan="${emptyColspan}" style="text-align:center;padding:20px">내역이 없습니다.</td></tr>`;
  const titleEl=document.getElementById('cf-widget-title-text');if(titleEl)titleEl.textContent=`수입/지출 구성 (${cfMonth}월)`;
  const compEl=document.getElementById('cf-comp-list');
  if(compEl)compEl.innerHTML=cfCompositionHtml(incomeByCat,expByCat,tIn,tOut);
  const flowEl=document.getElementById('cf-couple-flow');
  if(flowEl)flowEl.innerHTML=cfCoupleFlowHtml(cfYear,cfMonth);
  const sumEl=document.getElementById('cf-month-summary');
  if(sumEl)sumEl.innerHTML=cfMonthSummaryHtml(tIn,tOut,expByCat);
  updateCfTrendChart();
  if(_cfSection==='fixed')renderFixedCostView();
}

// '수입/지출 구성'(2026-11-23 개편) — 예전에는 수입·지출을 한 축의 Chart.js 가로 막대로 그려서
// 월급 막대 하나가 폭을 다 차지하고 지출 막대가 손톱만 했고, 눈금은 '₩5.0백만' 같은 낯선 단위였다.
// 이제 수입은 위 한 줄 숫자, 막대는 지출만 큰 순서로 그리고 금액(만 단위)·비율을 글자로 적는다.
// 이미 계산된 incomeByCat·expByCat 만 받는다(새 계산 없음). 색은 고정비 분포와 같은 cfColors.
function cfShortWon(v){
  const a=Math.abs(Math.round(v)), sign=v<0?'-':'';
  if(a>=100000000){ const e=Math.floor(a/100000000), m=Math.round((a%100000000)/10000); return sign+e+'억'+(m?' '+m.toLocaleString()+'만':''); }
  if(a>=10000) return sign+Math.round(a/10000).toLocaleString()+'만';
  return sign+'₩'+a.toLocaleString();
}
function cfCompositionHtml(incomeByCat, expByCat, tIn, tOut){
  const won=v=>'₩'+Math.round(v).toLocaleString();
  const savingCats=(typeof FIN_SAVING_CATS!=='undefined')?FIN_SAVING_CATS:['저축/투자'];
  const inc=Object.entries(incomeByCat||{}).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  const exp=Object.entries(expByCat||{}).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  if(!inc.length&&!exp.length) return '<div class="cf-comp-empty">이 달에 기록된 수입·지출이 없습니다.</div>';
  const incTxt=inc.slice(0,3).map(([c,v])=>`${_cfEsc(c)} ${cfShortWon(v)}`).join(' · ')+(inc.length>3?` 외 ${inc.length-3}`:'');
  const head=`<div class="cf-comp-head"><span>수입 <b class="c-up" title="${won(tIn)}">${cfShortWon(tIn)}</b>${incTxt?` <small>${incTxt}</small>`:''}</span>`
    +`<span>지출 <b title="${won(tOut)}">${cfShortWon(tOut)}</b></span></div>`;
  if(!exp.length) return head+'<div class="cf-comp-empty">이 달에 기록된 지출이 없습니다.</div>';
  const max=exp[0][1];
  const rows=exp.map(([c,v])=>{
    const saving=savingCats.includes(c);
    const pct=tOut>0?v/tOut*100:0;
    return `<div class="cf-comp-row${saving?' is-saving':''}" title="${_cfEsc(c)} ${won(v)} · 지출의 ${pct.toFixed(1)}%${saving?' · 자산 이동(소비 아님)':''}">`
      +`<span class="cf-comp-name">${_cfEsc(c)}</span>`
      +`<span class="cf-comp-track"><i style="width:${(v/max*100).toFixed(1)}%;background:${cfColors[c]||'var(--lab)'}"></i></span>`
      +`<b class="cf-comp-amt">${cfShortWon(v)}</b><span class="cf-comp-pct">${pct<1?'<1':Math.round(pct)}%</span></div>`;
  }).join('');
  const note=exp.some(([c])=>savingCats.includes(c))?'<div class="cf-comp-note">빗금 막대(저축/투자)는 자산으로 옮겨 간 돈이라 소비가 아닙니다.</div>':'';
  return head+'<div class="cf-comp-sub">지출 — 큰 순서</div>'+rows+note;
}

// 선택한 달의 요약 — 이미 계산된 값만 쓴다(새 계산 없음).
// 저축률은 '저축/투자' 지출을 소비에서 되돌린다. 그 카테고리는 자산 이동이라 순자산을
// 줄이지 않고, finMonthlyFixedCost·finNetWorthBridge 도 같은 이유로 제외한다.
// 그래서 순현금흐름(통장에 남은 돈)과 저축률(소득 중 안 쓴 비율)은 서로 다른 숫자다.
function cfMonthSummaryHtml(tIn, tOut, expByCat){
  const savingCats = (typeof FIN_SAVING_CATS!=='undefined') ? FIN_SAVING_CATS : ['저축/투자'];
  const savingOut = savingCats.reduce((sum,cat)=>sum+(expByCat[cat]||0),0);
  const net = tIn - tOut;
  const kept = tIn - (tOut - savingOut);                 // 소득 - 소비지출
  const rate = tIn>0 ? kept/tIn*100 : null;
  const scope = cfScopeLabel();
  const won = v => (v<0?'-₩':'₩') + Math.abs(Math.round(v)).toLocaleString();
  const fx = (typeof finMonthlyFixedCost==='function')
    ? finMonthlyFixedCost(_cfOwner==='전체'?null:_cfOwner) : {pendingCount:0,pendingMonthly:0};
  const pending = fx.pendingCount>0
    ? `<div class="cf-summary-pending"><span><b>자동이체 ${fx.pendingCount}건</b>이 고정비로 분류되지 않았습니다 (월 ${won(fx.pendingMonthly)}). 분류해야 월 필수지출과 현금 안전판이 맞게 나옵니다.</span>`
      + `<button type="button" onclick="switchCashFlowSection('fixed',document.getElementById('cf-section-tab-fixed'))">고정비 관리로</button></div>`
    : '';
  return `<div class="cb-label f-between" style="margin-bottom:2px"><span>${cfYear}년 ${cfMonth}월 요약</span>`
    + `<span style="font-size:var(--fs-cap);color:var(--t3);font-weight:600;letter-spacing:0">${_cfEsc(scope)}</span></div>`
    + `<div class="cf-summary-row"><span>총 수입</span><b class="c-up">${won(tIn)}</b></div>`
    + `<div class="cf-summary-row"><span>총 지출</span><b class="c-dn">-${won(tOut).replace('-','')}</b></div>`
    + (savingOut>0?`<div class="cf-summary-row"><span style="padding-left:9px;color:var(--t3);font-size:var(--fs-cap)">└ 저축/투자 (자산 이동)</span><b style="font-size:var(--fs-body);color:var(--t2)">${won(savingOut)}</b></div>`:'')
    + `<div class="cf-summary-row is-net"><span>순현금흐름</span><b class="${net>0?'c-up':(net<0?'c-dn':'')}">${net===0?'₩0':(net>0?'+':'')+won(net)}</b></div>`
    + `<div class="cf-summary-row"><span data-tip="소득에서 소비지출을 뺀 비율입니다. '저축/투자' 지출은 통장에서 빠져나가도 자산으로 옮겨 간 돈이라 소비에서 제외합니다 — 그래서 순현금흐름과 다를 수 있습니다.">저축률</span>`
    + `<b>${rate==null?'—':rate.toFixed(1)+'%'}</b></div>`
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
