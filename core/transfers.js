// core/transfers.js — 자동이체·고정비 — 현금 흐름 원장, 자동이체 일정·금액, 고정비 관리 화면
// (2026-11-23 script.js 에서 그대로 옮겨 나눈 조각. 로드 순서는 index.html·scripts/tests/_source.mjs)
let cfData = _normalizeCfRows(CF_DEFAULT);
try { const _s=localStorage.getItem('cfData'); if(_s){const _d=JSON.parse(_s);if(Array.isArray(_d))cfData=_normalizeCfRows(_d);} } catch(e){}
function saveCfData(){try{localStorage.setItem('cfData',JSON.stringify(cfData));}catch(e){}}
let cfDeletedKeys = [];
try {
  const _s=localStorage.getItem('cfDeletedKeys');
  if(_s){const _d=JSON.parse(_s);if(Array.isArray(_d))cfDeletedKeys=[...new Set(_d.map(key=>_boundedStoredText(key,220)).filter(Boolean))].slice(0,5000);}
} catch(e){}
function saveCfDeletedKeys(){try{localStorage.setItem('cfDeletedKeys',JSON.stringify(cfDeletedKeys));}catch(e){}}
function cfDeletionKey(item){
  if (!item) return '';
  if (item.divKey) return `div:${item.divKey}`;
  if (item.atId && item.date && item.date!=='미정') return `auto:${item.atId}:${String(item.date).slice(0,7)}`;
  return '';
}
function rememberCfDeletion(item){
  const key = cfDeletionKey(item);
  if (key && !cfDeletedKeys.includes(key)){
    cfDeletedKeys.push(key);
    saveCfDeletedKeys();
  }
  if (item && item.atId && item.date && item.date!=='미정'){
    const ym = String(item.date).slice(0,7);
    const at = autoTransferData.find(x=>x.id===item.atId);
    if (at){
      if (!Array.isArray(at.skipMonths)) at.skipMonths=[];
      if (!at.skipMonths.includes(ym)) at.skipMonths.push(ym);
      saveAutoTransfers(false);
    }
  }
  return key;
}
const cfColors = {'교통/차량':'#4ecdc4','교육':'#f472b6','급여':'#5b9bff','기타':'#94a3c8','문화/생활':'#c084fc','식비':'#f2a33c','의료/건강':'#fb7185','저축/투자':'#56c596','주거/통신':'#e8875a','배당금':'#4ade80','대출납입금':'#fb7185','관리비':'#e8875a','세금':'#e05572','부부 송금':'#94a3c8','아내 지출(추정)':'#f2a33c'};
// 자동이체 등록 데이터: {id, owner, type, cat, desc, amt, cycle, dayOfWeek, dayOfMonth,
// isFixedCost:true|false|undefined(기존 데이터 검토 필요), startMonth, endMonth, lastApplied}
let autoTransferData = [];
try { const s=localStorage.getItem('autoTransferData'); if(s) autoTransferData=_normalizeAutoTransfers(JSON.parse(s)); } catch(e){}

function _cfLocalDateKey(date){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

// 공휴일은 _krHolidaySet(연도) 하나로만 판정한다. 예전에는 2026년 목록을 따로
// 하드코딩했지만 계산기가 그 22일을 모두 산출했고, 오히려 하드코딩 쪽이 추석
// 대체공휴일(2026-09-28)을 빠뜨리고 있었다. 연도가 바뀌어도 손댈 필요가 없다.
function _isKrBankBusinessDay(date){
  const dow=date.getDay();
  return dow!==0 && dow!==6 && !_isKrPublicHoliday(date);
}

function _nextKrBankBusinessDay(date){
  const result=new Date(date.getFullYear(),date.getMonth(),date.getDate());
  for(let guard=0;guard<14&&!_isKrBankBusinessDay(result);guard++) result.setDate(result.getDate()+1);
  return result;
}

function _normalizeAutoTransferSchedules(list=autoTransferData){
  let changed=false;
  (Array.isArray(list)?list:[]).forEach(at=>{
    if(at&&at.cycle==='month-start'){
      at.cycle='monthly';
      at.dayOfMonth=1;
      changed=true;
    }
  });
  return changed;
}

function _autoTransferScheduledDate(at,y,m){
  const lastDay=new Date(y,m,0).getDate();
  const day=at&&at.cycle==='month-end' ? lastDay : Math.min(Math.max(1,Number(at&&at.dayOfMonth)||1),lastDay);
  const nominal=new Date(y,m-1,day);
  return at&&at.businessDayRule==='exact' ? nominal : _nextKrBankBusinessDay(nominal);
}

function _autoTransferMonthlyOccurrences(at,y,m){
  if(!at||!['monthly','month-end','month-start'].includes(at.cycle))return [];
  const result=[];
  for(const offset of [0,-1]){
    const nominal=new Date(y,m-1+offset,1);
    const ny=nominal.getFullYear(),nm=nominal.getMonth()+1;
    if(!_autoTransferActiveInMonth(at,ny,nm))continue;
    const actual=_autoTransferScheduledDate(at,ny,nm);
    if(actual.getFullYear()===y&&actual.getMonth()+1===m)result.push({date:actual,scheduleMonth:`${ny}-${String(nm).padStart(2,'0')}`});
  }
  return result;
}

_normalizeAutoTransferSchedules();

function saveAutoTransfers(syncRemote=true){
  try{localStorage.setItem('autoTransferData',JSON.stringify(autoTransferData));}catch(e){}
  if(syncRemote && typeof saveExtDataToKV==='function') saveExtDataToKV();
}

/** 월별 유효 자동이체 금액 – amountChanges 타임라인을 반영 */
function _effectiveAutoTransferAmt(at, y, m) {
  if (!at) return 0;
  // 대출 상환 조건이 있으면 그 달 납입액(원리금균등·원금균등·만기일시)이 금액이다
  if (at.loan) return loanPaymentFor(at.loan, y, m);
  let amt = at.amt || 0;
  if (Array.isArray(at.amountChanges) && at.amountChanges.length) {
    // from 이 (y,m) 이하인 최신 변경분 적용
    const sorted = at.amountChanges.slice().sort((a,b)=>{
      const [ay,amo] = (a.from||'0-0').split('-').map(Number);
      const [by,bmo] = (b.from||'0-0').split('-').map(Number);
      return ay!==by ? ay-by : amo-bmo;
    });
    for (const ch of sorted) {
      if (!ch || !ch.from) continue;
      const [cy, cm] = ch.from.split('-').map(Number);
      if (y > cy || (y === cy && m >= cm)) amt = ch.amt;
    }
  }
  return amt;
}

function applyAutoTransfers() {
  const today = new Date();
  const ym = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0');
  let changed = false;
  autoTransferData.forEach(at => {
    const monthlyCycle=['monthly','month-end','month-start'].includes(at.cycle);
    const scheduledDate=monthlyCycle?_autoTransferScheduledDate(at,today.getFullYear(),today.getMonth()+1):today;
    const scheduledKey=_cfLocalDateKey(scheduledDate);
    if (at.lastApplied === ym) {
      // 구버전이 월초·지정일 자동이체를 페이지를 연 날짜로 저장한 경우,
      // 연결된 현재 월 행을 실제 예정일로 1회 교정한다.
      if(monthlyCycle){
        const legacy=cfData.find(item=>item.atId===at.id&&item.isAuto===true&&String(item.date||'').slice(0,7)===ym);
        if(legacy&&legacy.date!==scheduledKey){legacy.date=scheduledKey;legacy.scheduleMonth=ym;changed=true;}
      }
      return;
    }
    // 시작 월 이전이면 적용 금지 (4월 등록 자동이체가 3월 이하로 소급되지 않도록)
    if (at.startMonth) {
      const [sy, sm] = at.startMonth.split('-').map(Number);
      if (today.getFullYear() < sy || (today.getFullYear() === sy && (today.getMonth()+1) < sm)) return;
    }
    // 종료 월 이후면 적용 금지
    if (at.endMonth) {
      const [ey, em] = at.endMonth.split('-').map(Number);
      if (today.getFullYear() > ey || (today.getFullYear() === ey && (today.getMonth()+1) > em)) return;
    }
    let shouldApply = false;
    if (monthlyCycle && _cfLocalDateKey(today)>=scheduledKey) shouldApply = true;
    else if (at.cycle === 'weekly' || at.cycle === 'daily') shouldApply = true;
    if (shouldApply) {
      const dateStr = monthlyCycle?scheduledKey:_cfLocalDateKey(today);
      const effAmt = _effectiveAutoTransferAmt(at, today.getFullYear(), today.getMonth()+1);
      cfData.push({date:dateStr, type:at.type, cat:at.cat, desc:'[자동] '+at.desc, amt:effAmt, owner:at.owner||'미지정', isAuto:true, atId:at.id, scheduleMonth:ym, cycleLabel:_getCycleLabel(at)});
      at.lastApplied = ym;
      changed = true;
    }
  });
  if (changed) { saveAutoTransfers(false); saveCfData(); renderCashFlow(); saveExtDataToKV(); }
}

function _getCycleLabel(at) {
  let s = CYCLE_LABEL[at.cycle]||at.cycle||'자동';
  if (at.cycle==='weekly') s += ' '+DOW_LABELS[at.dayOfWeek||1]+'요일';
  if (at.cycle==='monthly') s += ' '+at.dayOfMonth+'일';
  return s;
}

function addAutoTransfer() {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  const type = document.getElementById('cf-type').value;
  const cat = document.getElementById('cf-cat').value;
  const desc = document.getElementById('cf-desc').value.trim();
  const amt = parseFloat((document.getElementById('cf-amt').value||'').replace(/,/g,''))||0;
  const cycle = document.getElementById('at-cycle').value;
  const dom = parseInt(document.getElementById('at-dom').value)||1;
  const dow = parseInt(document.getElementById('at-dow').value)||1;
  const owner = document.getElementById('cf-owner-input')?.value || (_cfOwner==='전체'?'':_cfOwner);
  const isFixedCost = !!document.getElementById('cf-fixed-flag')?.checked;
  // '증여 이체' 체크 — 가족 증여 화면의 '자동이체를 증여로 연결' 목록에는 이 표식이 있는 지출만 나타난다
  const isGift = type==='지출' && !!document.getElementById('cf-gift-flag')?.checked;
  if (!desc||!amt) { alert('내용과 금액을 입력하세요.'); return; }
  if (!OWNERS.includes(owner)) { alert('소유주를 선택하세요.'); return; }
  const today = new Date();
  const ym = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0');
  const at = {id:Date.now(), owner, type, cat, desc, amt, cycle, dayOfMonth:dom, dayOfWeek:dow, isFixedCost, businessDayRule:'next', lastApplied:'', startMonth: ym};
  if (isGift) at.isGift = true;
  autoTransferData.push(at);
  saveAutoTransfers(false);
  // 이미 도래한 월간 일정만 실제 예정일로 상세 내역에 추가한다.
  const monthlyCycle=['monthly','month-end'].includes(cycle);
  const scheduledDate=monthlyCycle?_autoTransferScheduledDate(at,today.getFullYear(),today.getMonth()+1):today;
  if(!monthlyCycle||_cfLocalDateKey(today)>=_cfLocalDateKey(scheduledDate)){
    const dateStr=monthlyCycle?_cfLocalDateKey(scheduledDate):_cfLocalDateKey(today);
    cfData.push({date:dateStr, type, cat, desc: '[자동] ' + desc, amt, owner, isAuto:true, atId:at.id, scheduleMonth:ym, cycleLabel:_getCycleLabel(at)});
    at.lastApplied=ym;
  }
  saveCfData();
  saveExtDataToKV();
  renderCashFlow();
  const descEl=document.getElementById('cf-desc');if(descEl)descEl.value='';
  const amtEl=document.getElementById('cf-amt');if(amtEl)amtEl.value='';
  const fixedEl=document.getElementById('cf-fixed-flag');if(fixedEl)fixedEl.checked=false;
  const giftEl=document.getElementById('cf-gift-flag');if(giftEl)giftEl.checked=false;
  renderFixedCostView();
}

function deleteAutoTransfer(id) {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  if (!confirm('해당 자동이체 설정을 삭제하시겠습니까?\n(연결된 [자동] 내역도 리스트에서 함께 사라집니다.)')) return;
  // 자동이체에 연결된 id(Date.now())가 있는 cfData [자동] 항목 제거
  const at = autoTransferData.find(a => a.id === id);
  autoTransferData = autoTransferData.filter(a => a.id !== id);
  if (at) {
    // desc/cat/type이 일치하는 [자동] cfData 제거 (동일 설명으로 생성된 과거 자동 기록 제거)
    cfData = cfData.filter(c => !(
      c.isAuto === true &&
      c.type === at.type &&
      c.cat === at.cat &&
      typeof c.desc === 'string' &&
      c.desc.includes(at.desc)
    ));
    saveCfData();
  }
  saveAutoTransfers(false);
  saveExtDataToKV();
  if (typeof renderCashFlow === 'function') renderCashFlow();
}

/** 자동이체 취소 (현재 달까지는 유지, 다음 달부터 중단) */

/** 특정 달의 자동이체 예상 행을 실체화하여 수정 폼 열기 (해당 월만) */
function editAutoTransferMonth(atId, y, m) {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  const at = autoTransferData.find(x => x.id === atId);
  if (!at) return;
  // 사용자에게 적용 범위 확인 – 기본: "이 달부터 이후 전부"
  const choice = confirm(
    `이 자동이체의 금액/내용을 수정합니다.\n\n` +
    `[확인] → ${y}년 ${m}월부터 이후 모든 달에 반영\n` +
    `[취소] → ${y}년 ${m}월에만 예외적으로 반영\n`
  );
  if (choice) { editAutoTransferFromMonth(atId, y, m); return; }
  // 단일월 예외 수정: 해당 월 행을 실체화 후 편집 폼 오픈
  const daysInMonth = new Date(y, m, 0).getDate();
  let times=0;
  const monthlyCycle=['monthly','month-end','month-start'].includes(at.cycle);
  const monthlyOccurrences=monthlyCycle?_autoTransferMonthlyOccurrences(at,y,m):[];
  if(monthlyCycle)times=monthlyOccurrences.length;
  else if(at.cycle==='weekly')times=Math.floor(daysInMonth/7);
  else if(at.cycle==='daily')times=daysInMonth;
  const effAmt = _effectiveAutoTransferAmt(at, y, m);
  const total = effAmt * times;
  let day = 1;
  if (at.cycle==='monthly') day = Math.min(at.dayOfMonth||1, daysInMonth);
  else if (at.cycle==='month-end') day = daysInMonth;
  const dateStr = monthlyOccurrences.length
    ? _cfLocalDateKey(monthlyOccurrences[0].date)
    : `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const newEntry = {
    date: dateStr, type: at.type, cat: at.cat,
    desc: '[자동] ' + (at.desc||''), amt: total, owner:at.owner||'미지정',
    isAuto: true, atId: at.id, cycleLabel: _getCycleLabel(at)
  };
  cfData.push(newEntry);
  saveCfData();
  renderCashFlow();
  const newIdx = cfData.length - 1;
  if (typeof editCF === 'function') editCF(newIdx);
}

/** 특정 달부터 금액을 변경 (이후 모든 달에 자동 반영) */
function editAutoTransferFromMonth(atId, y, m) {
  const at = autoTransferData.find(x => x.id === atId);
  if (!at) return;
  if (at.loan) { alert('대출 상환 조건으로 금액을 계산하는 항목입니다. 현금 흐름 > 고정비 관리에서 ✎ 로 조건을 고치세요.'); return; }
  const curAmt = _effectiveAutoTransferAmt(at, y, m);
  const input = prompt(
    `${y}년 ${m}월부터 적용할 새로운 금액(원)을 입력하세요.\n현재 금액: ₩${curAmt.toLocaleString()}`,
    String(curAmt)
  );
  if (input === null) return;
  const newAmt = parseFloat((input||'').replace(/[^0-9.]/g,''));
  if (isNaN(newAmt) || newAmt < 0) { alert('유효한 숫자를 입력하세요.'); return; }
  if (!Array.isArray(at.amountChanges)) at.amountChanges = [];
  const fromKey = `${y}-${String(m).padStart(2,'0')}`;
  // 같은 from 키가 이미 있으면 덮어쓰기
  const existing = at.amountChanges.find(c=>c.from===fromKey);
  if (existing) existing.amt = newAmt;
  else at.amountChanges.push({from:fromKey, amt:newAmt});
  // (y,m) 이후로 이미 실체화된 cfData 항목의 금액도 업데이트 (해당 at.id 기준)
  cfData.forEach(c=>{
    if (c.atId !== atId) return;
    const cd = new Date(c.date);
    if (cd.getFullYear() > y || (cd.getFullYear()===y && cd.getMonth()+1 >= m)) {
      c.amt = newAmt;
    }
  });
  saveAutoTransfers(false);
  saveCfData();
  saveExtDataToKV();
  renderCashFlow();
  alert(`${y}년 ${m}월부터 ₩${newAmt.toLocaleString()} 로 변경되었습니다.`);
}

/** 특정 달만 자동이체 적용 건너뛰기 (skipMonths) */
function skipAutoTransferMonth(atId, y, m) {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  // 이 달만 vs 이 달부터 전부 선택
  const choice = confirm(
    `이 자동이체를 삭제합니다.\n\n` +
    `[확인] → ${y}년 ${m}월부터 이후 전부 삭제 (영구 중단)\n` +
    `[취소] → ${y}년 ${m}월에만 이번 한 달 건너뛰기\n`
  );
  if (choice) { deleteAutoTransferFromMonth(atId, y, m); return; }
  const at = autoTransferData.find(x => x.id === atId);
  if (!at) return;
  if (!Array.isArray(at.skipMonths)) at.skipMonths = [];
  const ymKey = `${y}-${String(m).padStart(2,'0')}`;
  if (!at.skipMonths.includes(ymKey)) at.skipMonths.push(ymKey);
  cfData = cfData.filter(c => !(
    c.atId === atId &&
    new Date(c.date).getFullYear() === y &&
    new Date(c.date).getMonth()+1 === m
  ));
  saveAutoTransfers(false);
  saveCfData();
  saveExtDataToKV();
  renderCashFlow();
}

/** 특정 달부터 자동이체 완전 중단 (이후 모든 달 삭제/미표시) */
function deleteAutoTransferFromMonth(atId, y, m) {
  const at = autoTransferData.find(x => x.id === atId);
  if (!at) return;
  // 시작월 이전을 끝으로 설정하면 전체 삭제
  const [sy, sm] = (at.startMonth||'').split('-').map(Number);
  if (sy && (y < sy || (y===sy && m <= sm))) {
    autoTransferData = autoTransferData.filter(x=>x.id!==atId);
    cfData = cfData.filter(c=>c.atId !== atId);
  } else {
    // endMonth = (y,m-1) → (y,m) 부터는 표시/적용 안됨
    const em = m - 1;
    if (em <= 0) at.endMonth = `${y-1}-12`;
    else at.endMonth = `${y}-${String(em).padStart(2,'0')}`;
    // (y,m) 이후 실체화된 cfData 제거
    cfData = cfData.filter(c=>{
      if (c.atId !== atId) return true;
      const cd = new Date(c.date);
      return !(cd.getFullYear() > y || (cd.getFullYear()===y && cd.getMonth()+1 >= m));
    });
  }
  saveAutoTransfers(false);
  saveCfData();
  saveExtDataToKV();
  renderCashFlow();
  alert(`${y}년 ${m}월부터 이 자동이체가 중단됩니다.`);
}

function renderAutoTransfers() {
  const tbody = document.getElementById('at-table-body'); if (!tbody) return;
  if (!autoTransferData.length) { tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:16px;color:var(--t3)">등록된 자동이체가 없습니다.</td></tr>'; return; }
  const _now = new Date();
  tbody.innerHTML = autoTransferData.map(at => {
    let cycleStr = CYCLE_LABEL[at.cycle]||at.cycle;
    if (at.cycle==='weekly') cycleStr += ' '+DOW_LABELS[at.dayOfWeek||1]+'요일';
    if (at.cycle==='monthly') cycleStr += ' '+at.dayOfMonth+'일';
    return `<tr>
      <td class="text-left">${at.type==='수입'?'<span style="color:var(--up)">수입</span>':'<span style="color:var(--dn)">지출</span>'}</td>
      <td class="text-left">${_cfEsc(at.cat)}</td>
      <td class="text-left">${_cfEsc(at.desc)}</td>
      <td style="text-align:right;font-family:var(--font-num)">₩${Math.round(_effectiveAutoTransferAmt(at,_now.getFullYear(),_now.getMonth()+1)).toLocaleString()}</td>
      <td class="text-left">${_cfEsc(cycleStr)}</td>
      <td><button class="btn-action" type="button" aria-label="${_cfEsc(at.desc)} 자동이체 삭제" onclick="deleteAutoTransfer(${Number(at.id)||0})">✕</button></td>
    </tr>`;
  }).join('');
}

function toggleAtCycleFields() {
  const cycle = document.getElementById('at-cycle')?.value;
  const domRow = document.getElementById('at-dom-row');
  const dowRow = document.getElementById('at-dow-row');
  if(domRow) domRow.style.display = cycle==='monthly'?'':'none';
  if(dowRow) dowRow.style.display = cycle==='weekly'?'':'none';
}

function toggleCfMode() {
  const isAuto = document.getElementById('cfmode-auto')?.checked;
  // 날짜 vs 주기 필드
  const dateGrp = document.getElementById('cf-date-group');
  const cycleGrp = document.getElementById('cf-cycle-group');
  const fixedFlag = document.getElementById('cf-fixed-flag-group');
  if(dateGrp) dateGrp.style.display = isAuto?'none':'';
  if(cycleGrp) cycleGrp.style.display = isAuto?'':'none';
  if(fixedFlag) fixedFlag.style.display = isAuto?'flex':'none';
  const giftFlag = document.getElementById('cf-gift-flag-group');
  if(giftFlag) giftFlag.style.display = isAuto?'flex':'none';
  // 주기 관련 필드 표시
  toggleAtCycleFields();
}

// 입력 폼 펼침/접힘 — 폼은 기본으로 접혀 있고, 버튼을 누르거나 내역을 수정할 때만 편다.
// 저장·편집 로직(submitCfEntry/editCF/resetCfForm)은 그대로이며 여기서는 보이기만 바꾼다.
function cfShowEntry(){
  const body=document.getElementById('cf-entry-body'), close=document.getElementById('cf-entry-close');
  if(body) body.hidden=false;
  if(close) close.hidden=false;
}
function cfOpenEntry(kind){
  if (isMobileLayout()) return; // 모바일은 조회 전용
  if (typeof resetCfForm==='function') resetCfForm();
  const auto=kind==='auto';
  const radio=document.getElementById(auto?'cfmode-auto':'cfmode-oneshot');
  if(radio && !radio.checked){ radio.checked=true; toggleCfMode(); }
  const typeEl=document.getElementById(auto?'at-type':'cf-type');
  if(typeEl && !auto) typeEl.value=kind==='in'?'수입':'지출';
  cfShowEntry();
  document.getElementById(auto?'at-amt':'cf-amt')?.focus();
}
function cfCloseEntry(){
  if (typeof resetCfForm==='function') resetCfForm();
  const body=document.getElementById('cf-entry-body'), close=document.getElementById('cf-entry-close');
  if(body) body.hidden=true;
  if(close) close.hidden=true;
}

function submitCfEntry() {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  const isAuto = document.getElementById('cfmode-auto')?.checked;
  if(isAuto) {
    addAutoTransfer();
  } else {
    addCashFlow();
  }
}

function _cfEsc(value) { return escHtml(value); }

function _cfMonthKey(date=new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
}

function switchCashFlowSection(section, btn) {
  _cfSection = section === 'fixed' ? 'fixed' : 'monthly';
  const monthly = document.getElementById('cf-monthly-section');
  const fixed = document.getElementById('cf-fixed-section');
  if (monthly) { monthly.style.display = _cfSection === 'monthly' ? '' : 'none'; monthly.classList.toggle('cf-section-hidden', _cfSection !== 'monthly'); }
  if (fixed) fixed.style.display = _cfSection === 'fixed' ? 'flex' : 'none';
  document.querySelectorAll('.cf-section-tab').forEach(tab => {
    const active = tab === btn || tab.id === `cf-section-tab-${_cfSection}`;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (_cfSection === 'fixed') renderFixedCostView();
  else requestAnimationFrame(()=>{
    if(window.cfTrendChartInst) window.cfTrendChartInst.resize();
  });
}

function _autoTransferActiveInMonth(at, y, m) {
  if (!at) return false;
  const ym = `${y}-${String(m).padStart(2,'0')}`;
  if (at.startMonth && ym < at.startMonth) return false;
  if (at.endMonth && ym > at.endMonth) return false;
  if (Array.isArray(at.skipMonths) && at.skipMonths.includes(ym)) return false;
  return true;
}

function _autoTransferMonthlyEquivalent(at, y, m) {
  const amount = _effectiveAutoTransferAmt(at, y, m);
  if (at.cycle === 'daily') return amount * 365 / 12;
  if (at.cycle === 'weekly') return amount * 52 / 12;
  if (at.cycle === 'quarterly') return amount / 3;
  if (at.cycle === 'yearly') return amount / 12;
  return amount;
}

function _fixedCostCycleText(at) {
  if (at.cycle === 'weekly') return `매주 ${DOW_LABELS[Number(at.dayOfWeek)||0]}요일`;
  if (at.cycle === 'month-start') return '매월초';
  if (at.cycle === 'month-end') return '매월말';
  if (at.cycle === 'daily') return '매일';
  if (at.cycle === 'quarterly') return '분기';
  if (at.cycle === 'yearly') return '매년';
  return `매월 ${Math.max(1,Math.min(31,Number(at.dayOfMonth)||1))}일`;
}

function _autoTransferOccursOn(at, date) {
  const y=date.getFullYear(),m=date.getMonth()+1,day=date.getDate();
  if (['monthly','month-end','month-start'].includes(at.cycle)) {
    const wanted=_cfLocalDateKey(date);
    return _autoTransferMonthlyOccurrences(at,y,m).some(row=>_cfLocalDateKey(row.date)===wanted);
  }
  if (!_autoTransferActiveInMonth(at,y,m)) return false;
  if (at.cycle === 'daily') return true;
  if (at.cycle === 'weekly') return date.getDay() === (Number(at.dayOfWeek)||0);
  if (at.cycle === 'yearly') {
    const startMonth=Number(String(at.startMonth||'').slice(5,7))||1;
    return m===startMonth && day===Math.min(Number(at.dayOfMonth)||1,new Date(y,m,0).getDate());
  }
  if (at.cycle === 'quarterly') {
    const startMonth=Number(String(at.startMonth||'').slice(5,7))||1;
    return ((m-startMonth+12)%3===0) && day===Math.min(Number(at.dayOfMonth)||1,new Date(y,m,0).getDate());
  }
  return day === Math.min(Number(at.dayOfMonth)||1,new Date(y,m,0).getDate());
}

function _nextFixedCostDate(at, fromDate=new Date()) {
  const cursor=new Date(fromDate.getFullYear(),fromDate.getMonth(),fromDate.getDate());
  for(let offset=0;offset<=370;offset++){
    const d=new Date(cursor);d.setDate(cursor.getDate()+offset);
    if(_autoTransferOccursOn(at,d)) return d;
  }
  return null;
}

function _fixedCostOwnerMatches(at) {
  return cfInScope(at && at.owner);
}

function _fixedCostIncomeForMonth(y,m) {
  const materializedIds=new Set();
  let income=0;
  cfData.forEach(item=>{
    const d=new Date(item.date);
    if(d.getFullYear()!==y||d.getMonth()+1!==m||item.type!=='수입') return;
    if(!cfRowCounts(item)) return;
    income+=Number(item.amt)||0;
    if(item.atId) materializedIds.add(item.atId);
  });
  autoTransferData.forEach(at=>{
    if(at.type!=='수입'||materializedIds.has(at.id)||!_fixedCostOwnerMatches(at)||!_autoTransferActiveInMonth(at,y,m)) return;
    income+=_autoTransferMonthlyEquivalent(at,y,m);
  });
  return income;
}

// 합산된(included) 고정비를 카테고리로 접어 비중을 낸다. 이미 표에서 도는
// _autoTransferMonthlyEquivalent 를 그대로 가중치로 쓴다 — 새 계산 없음.
function _fixedCostDistribution(included, y, m) {
  const byCat = new Map();
  included.forEach(at => {
    const cat = at.cat || '기타';
    const amt = _autoTransferMonthlyEquivalent(at, y, m);
    byCat.set(cat, (byCat.get(cat) || 0) + amt);
  });
  const total = [...byCat.values()].reduce((s, v) => s + v, 0);
  return [...byCat.entries()]
    .map(([cat, amount]) => ({ cat, amount, pct: total > 0 ? amount / total * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);
}
// 색은 cfColors(월별 현금흐름 차트와 같은 정의) 를 그대로 쓴다 — 카테고리별 색이
// 화면마다 달라지지 않는다. 차트 라이브러리 없이 .sim-stack(100% 누적 막대) 패턴을
// 재사용한다.
function _fixedCostDistributionHtml(included, y, m) {
  const dist = _fixedCostDistribution(included, y, m);
  if (!dist.length) return '<p class="cf-fixed-dist-empty">합산된 고정비가 없어 분포를 표시할 수 없습니다.</p>';
  const bar = `<div class="sim-stack" role="img" aria-label="카테고리별 고정비 비중">${dist.map(d =>
    `<span style="width:${d.pct.toFixed(2)}%;background:${cfColors[d.cat] || '#94a3c8'}" title="${_cfEsc(d.cat)} ${d.pct.toFixed(1)}%"></span>`
  ).join('')}</div>`;
  const legend = `<div class="cf-fixed-dist-legend">${dist.map(d =>
    `<div class="cf-fixed-dist-item"><i style="background:${cfColors[d.cat] || '#94a3c8'}"></i><span>${_cfEsc(d.cat)}</span><b>₩${Math.round(d.amount).toLocaleString()}</b><small>${d.pct.toFixed(1)}%</small></div>`
  ).join('')}</div>`;
  return bar + legend;
}
// ── 적립식 매수 묶음(2026-11-18 4차, 사용자 결정: 별도 묶음) ──
// 고정비 합계(월 고정비 카드·분포·수입 대비 비율)에는 넣지 않고 옆에 따로 보여 준다.
// 대상·금액은 현금 안전판(finCashSafety 의 dca)과 같다: 켜 둔(i.dca) 적립식 규칙의 월 환산(cbDcaPerMonthKRW). 새 계산 없음.
function _fixedCostDcaGroup(ownerF){
  const mine=(pfolioData||[]).filter(i=>i&&dcaHasRule(i)&&(!ownerF||ownerF==='전체'||i.owner===ownerF));
  const perMonth=i=>typeof cbDcaPerMonthKRW==='function'?cbDcaPerMonthKRW(i):0;
  const rows=mine.filter(i=>dcaState(i)==='on').map(i=>({owner:i.owner||'',name:i.name||i.tkr||'',tkr:i.tkr||'',
    label:typeof cbDcaRuleLabel==='function'?cbDcaRuleLabel(i):(i.dcaCycle||''),monthly:perMonth(i)}))
    .sort((a,b)=>b.monthly-a.monthly||String(a.name).localeCompare(String(b.name),'ko'));
  return {rows,total:rows.reduce((s,r)=>s+r.monthly,0)};
}
function _fixedCostDcaHtml(group, savingCount){
  const won=v=>`₩${Math.round(v).toLocaleString()}`;
  const tag=o=>typeof cbOwnerTag==='function'?cbOwnerTag(o):`<span>${_cfEsc(o)}</span>`;
  const list=group.rows.map(r=>`<div class="cf-fixed-dca-row">${tag(r.owner)}<span class="cf-fixed-dca-name" title="${_cfEsc(r.name)}">${_cfEsc(r.name)}</span><span class="cf-fixed-dca-rule">${_cfEsc(r.label)}</span><b>${won(r.monthly)}</b></div>`).join('');
  const dup=savingCount?`<p class="cf-fixed-dca-warn">고정비에 '저축/투자' 자동이체가 ${savingCount}건 있습니다. 증권계좌로 보내는 그 돈으로 적립식 매수를 한다면, 월 고정비 카드의 '+ 적립식' 합계에는 같은 돈이 두 번 들어갑니다.</p>`:'';
  // 합계가 종목 목록보다 먼저다(2026-11-20 8차, 사용자 결정) — 목록이 길어도 합계가 카드 위에서 바로 보인다. 중단한 규칙은 세지도 적지도 않는다.
  return `<div class="cf-fixed-dca-head"><div class="cb-label">적립식 매수 <small>고정비와 별도</small></div><button type="button" class="cf-fixed-dca-link" onclick="switchView('holdings')">보유 목록에서 수정 ›</button></div>
    <div class="cf-fixed-dca-total"><span>적립식 월 합계</span><b>${won(group.total)}</b></div>
    <p class="cf-fixed-dca-sub">매수 규칙의 월 환산액입니다. 고정비 합계·분포·수입 대비 비율에는 넣지 않습니다.</p>
    <div class="cf-fixed-dca-list">${list}</div>${dup}`;
}
function renderFixedCostView() {
  const body=document.getElementById('cf-fixed-table-body');
  if(!body) return;
  const now=new Date(), y=now.getFullYear(),m=now.getMonth()+1;
  const ownerExpenses=autoTransferData.filter(at=>at.type==='지출'&&_fixedCostOwnerMatches(at));
  const excluded=ownerExpenses.filter(at=>at.isFixedCost===false);
  const visible=ownerExpenses.filter(at=>at.isFixedCost!==false||_cfShowExcluded);
  const included=visible.filter(at=>at.isFixedCost===true&&_autoTransferActiveInMonth(at,y,m));
  const pending=visible.filter(at=>at.isFixedCost==null);
  const monthly=included.reduce((sum,at)=>sum+_autoTransferMonthlyEquivalent(at,y,m),0);
  const annual=monthly*12;
  const income=_fixedCostIncomeForMonth(y,m);
  const ratio=income>0?monthly/income*100:null;
  const nextList=included.map(at=>({at,date:_nextFixedCostDate(at,now)})).filter(x=>x.date).sort((a,b)=>a.date-b.date);
  const next=nextList[0];
  const monthlyEl=document.getElementById('cf-fixed-monthly');if(monthlyEl)monthlyEl.textContent=`₩${Math.round(monthly).toLocaleString()}`;
  const annualEl=document.getElementById('cf-fixed-annual');if(annualEl)annualEl.textContent=`₩${Math.round(annual).toLocaleString()}`;
  const ratioEl=document.getElementById('cf-fixed-ratio');if(ratioEl)ratioEl.textContent=ratio==null?'-':`${ratio.toFixed(1)}%`;
  const ratioNote=document.getElementById('cf-fixed-ratio-note');if(ratioNote)ratioNote.textContent=income>0?`이번 달 수입 ₩${Math.round(income).toLocaleString()} 기준`:'이번 달 수입 내역이 없습니다';
  const nextEl=document.getElementById('cf-fixed-next');if(nextEl)nextEl.textContent=next?`₩${Math.round(_effectiveAutoTransferAmt(next.at,next.date.getFullYear(),next.date.getMonth()+1)).toLocaleString()}`:'-';
  const nextNote=document.getElementById('cf-fixed-next-note');if(nextNote)nextNote.textContent=next?`${next.date.getMonth()+1}월 ${next.date.getDate()}일 · ${next.at.owner||'미지정'} · ${next.at.desc}`:'예정된 결제가 없습니다';
  const monthNote=document.getElementById('cf-fixed-monthly-note');if(monthNote)monthNote.textContent=`${cfScopeLabel()} · ${included.length}개 항목`;
  const review=document.getElementById('cf-fixed-review-note');if(review)review.textContent=pending.length?`기존 자동이체 ${pending.length}건은 소유주와 고정비 여부를 확인해야 합계에 반영됩니다.`:'분류가 완료된 고정비만 합산합니다.';
  const badge=document.getElementById('cf-fixed-pending-badge');if(badge){badge.style.display=pending.length?'inline-flex':'none';badge.textContent=String(pending.length);}
  const excludedToggle=document.getElementById('cf-fixed-excluded-toggle');if(excludedToggle){excludedToggle.style.display=excluded.length?'':'none';excludedToggle.textContent=_cfShowExcluded?`제외 항목 숨기기`:`제외 항목 ${excluded.length}건`;excludedToggle.classList.toggle('active',_cfShowExcluded);}
  const distEl=document.getElementById('cf-fixed-dist');if(distEl)distEl.innerHTML=_fixedCostDistributionHtml(included,y,m);
  // 적립식 매수 — 별도 묶음. 월 고정비 카드에는 '+ 적립식 = 합계' 한 줄만 덧붙인다(카드 값은 그대로 고정비)
  const dcaGroup=_fixedCostDcaGroup(_cfOwner);
  const savingCount=included.filter(at=>(typeof FIN_SAVING_CATS!=='undefined'?FIN_SAVING_CATS:['저축/투자']).includes(at.cat)).length;
  const dcaSum=document.getElementById('cf-fixed-dca-sum');
  if(dcaSum){ dcaSum.hidden=!dcaGroup.rows.length; dcaSum.textContent=dcaGroup.rows.length?`+ 적립식 ₩${Math.round(dcaGroup.total).toLocaleString()} = ₩${Math.round(monthly+dcaGroup.total).toLocaleString()}`:''; }
  const dcaEl=document.getElementById('cf-fixed-dca');
  if(dcaEl){ dcaEl.hidden=!dcaGroup.rows.length&&!dcaGroup.paused; dcaEl.innerHTML=dcaEl.hidden?'':_fixedCostDcaHtml(dcaGroup,savingCount); }

  const rows=visible.slice().sort((a,b)=>{
    const ap=a.isFixedCost===true?0:(a.isFixedCost==null?1:2),bp=b.isFixedCost===true?0:(b.isFixedCost==null?1:2);
    return ap-bp||String(a.owner||'').localeCompare(String(b.owner||''),'ko')||String(a.desc||'').localeCompare(String(b.desc||''),'ko');
  });
  body.innerHTML=rows.length?rows.map(at=>{
    const isPending=at.isFixedCost==null;
    const isExcluded=at.isFixedCost===false;
    const active=_autoTransferActiveInMonth(at,y,m);
    const monthlyAmt=_autoTransferMonthlyEquivalent(at,y,m);
    const owner=at.owner||'미지정';
    const safeId=Number.isSafeInteger(Number(at.id))?Number(at.id):0;
    const ownerCell=isPending&&!OWNERS.includes(at.owner)
      ?`<select class="cf-fixed-inline-owner" aria-label="${_cfEsc(at.desc)} 소유주" onchange="setAutoTransferOwner(${safeId},this.value)"><option value="">미지정</option>${OWNERS.map(o=>`<option value="${o}">${o}</option>`).join('')}</select>`
      :`<span class="cf-fixed-owner"><i style="background:${ownerColors[owner]||'#8a97b0'}"></i>${_cfEsc(owner)}</span>`;
    const state=isExcluded?'<span class="cf-fixed-state is-ended">제외</span>':(isPending?'<span class="cf-fixed-state is-pending">분류 필요</span>':(!active?'<span class="cf-fixed-state is-ended">종료</span>':'<span class="cf-fixed-state is-included">합산</span>'));
    // 증여 이체 표식은 그 줄에만 작은 글자로 보인다(2026-11-24, 사용자 요청) — 표에서 켜고 끄는 버튼은 없앴다.
    // 표식은 고정비 등록·수정 폼의 '증여 이체' 체크로 붙이고 뗀다(✎ 수정).
    const giftTag=_autoTransferIsGift(at)?'<span class="cf-fixed-state is-gift" title="증여 이체 — 가족 증여 화면에서 연결할 수 있습니다">증여</span>':'';
    const actions=(isExcluded
      ?`<button class="btn-action" onclick="restoreFixedCost(${safeId})" title="고정비 검토 대상으로 복원">↺</button>`
      :isPending
      ?`<button class="btn-action" onclick="includeFixedCost(${safeId})" title="고정비로 포함">✓</button><button class="btn-action" onclick="editFixedCost(${safeId})" title="확인 후 수정">✎</button><button class="btn-action" onclick="excludeFixedCost(${safeId})" title="고정비에서 제외">✕</button>`
      :`<button class="btn-action" onclick="editFixedCost(${safeId})" title="수정">✎</button><button class="btn-action" onclick="excludeFixedCost(${safeId})" title="고정비에서 제외">✕</button>`);
    // 대출 상환 조건이 있으면 바로 아래 줄(항목 칸부터 끝까지)에 방식·금리·잔여·잔액 — 좁은 항목 칸에 넣으면 잘린다
    const loanRow=at.loan?`<tr class="cf-fixed-loan-row"><td colspan="2"></td><td colspan="5" class="text-left"><small class="cf-fixed-loan-note">${_cfEsc(_loanStatusText(at.loan,y,m))}</small></td></tr>`:'';
    return `<tr class="${isPending?'cf-fixed-row-pending':''}${isExcluded?' cf-fixed-row-excluded':''}${at.loan?' has-loan':''}"><td class="text-left">${ownerCell}</td><td class="text-left cf-fixed-secondary">${_cfEsc(at.cat||'-')}</td><td class="text-left"><span class="cf-fixed-item"><span class="cf-fixed-item-name" title="${_cfEsc(at.desc||'')}">${_cfEsc(at.desc||'-')}</span>${state}${giftTag}</span></td><td class="text-left">${_cfEsc(_fixedCostCycleText(at))}</td><td class="text-right">${isPending?'-':`₩${Math.round(monthlyAmt).toLocaleString()}`}</td><td class="text-right cf-fixed-secondary">${isPending?'-':`₩${Math.round(monthlyAmt*12).toLocaleString()}`}</td><td class="text-right cf-fixed-actions">${actions}</td></tr>${loanRow}`;
  }).join(''):'<tr><td colspan="7" class="cf-fixed-empty">등록된 고정비가 없습니다.</td></tr>';
}

function toggleFixedCostScheduleFields() {
  const cycle=document.getElementById('cf-fixed-cycle')?.value;
  const day=document.getElementById('cf-fixed-day-group');
  const dow=document.getElementById('cf-fixed-dow-group');
  if(day)day.style.display=cycle==='monthly'?'':'none';
  if(dow)dow.style.display=cycle==='weekly'?'':'none';
}

// ── 고정비 등록 폼의 대출 상환 조건(2026-11-18 4차) ──
// 카테고리가 '대출납입금'이면 조건 칸이 보이고, 원금을 적으면 금액 칸은 이번 달 계산 납입액(읽기 전용)이 된다.
// 첫 납입 월은 연도·월 선택 목록이다(오래된 대출은 브라우저 월 달력으로 과거 이동이 어렵다 — 증여 시작 월과 같은 이유).
function _fixedLoanFillMonthPickers(ym){
  const ySel=document.getElementById('cf-fixed-loan-y'), mSel=document.getElementById('cf-fixed-loan-m');
  if(!ySel||!mSel) return;
  const now=new Date(), [vy,vm]=String(ym||_cfMonthKey()).split('-').map(Number);
  const years=[]; for(let yy=now.getFullYear()+2;yy>=now.getFullYear()-40;yy--) years.push(yy);
  if(vy&&!years.includes(vy)) years.push(vy);
  ySel.innerHTML=years.map(yy=>`<option value="${yy}"${yy===vy?' selected':''}>${yy}년</option>`).join('');
  mSel.innerHTML=Array.from({length:12},(_,i)=>i+1).map(mm=>`<option value="${mm}"${mm===vm?' selected':''}>${mm}월</option>`).join('');
}
// 폼 값 → {loan|null, error}. 원금이 비어 있으면 대출 조건 없이(금액 칸 그대로) 저장한다.
function _fixedLoanFromForm(){
  if(document.getElementById('cf-fixed-cat')?.value!=='대출납입금') return {loan:null};
  const raw=String(document.getElementById('cf-fixed-loan-principal')?.value||'').replace(/,/g,'').trim();
  if(!raw) return {loan:null};
  const principal=Number(raw);
  const rate=Number(document.getElementById('cf-fixed-loan-rate')?.value);
  const term=Number(document.getElementById('cf-fixed-loan-term')?.value);
  const unit=Number(document.getElementById('cf-fixed-loan-term-unit')?.value)||12;
  const months=Math.round(term*unit);
  const yy=Number(document.getElementById('cf-fixed-loan-y')?.value), mm=Number(document.getElementById('cf-fixed-loan-m')?.value);
  if(!(principal>0)) return {loan:null,error:'대출 원금을 숫자로 입력하세요.'};
  if(!Number.isFinite(rate)||rate<0||rate>30||String(document.getElementById('cf-fixed-loan-rate')?.value||'').trim()==='') return {loan:null,error:'연 금리를 0~30% 사이로 입력하세요.'};
  if(!(months>=1&&months<=600)) return {loan:null,error:'대출 기간을 1개월~50년 사이로 입력하세요.'};
  if(!(yy>=1900&&mm>=1&&mm<=12)) return {loan:null,error:'첫 납입 월을 고르세요.'};
  const method=document.getElementById('cf-fixed-loan-method')?.value;
  return {loan:_normalizeLoanTerms({method,principal,rate,months,start:`${yy}-${String(mm).padStart(2,'0')}`})};
}
function _loanYmKo(ym){ const [yy,mm]=String(ym||'').split('-').map(Number); return yy&&mm?`${yy}년 ${mm}월`:''; }
function _loanStatusText(loan,y,m){
  const st=loanStatusFor(loan,y,m); if(!st) return '';
  const head=`${LOAN_METHOD_LABEL[loan.method]||''} · 연 ${Number(loan.rate).toLocaleString(undefined,{maximumFractionDigits:2})}%`;
  if(st.phase==='before') return `${head} · ${_loanYmKo(loan.start)} 납입 시작 · ${loan.months}개월`;
  if(st.phase==='done') return `${head} · 상환 끝(${_loanYmKo(st.end)})`;
  return `${head} · 잔여 ${st.remaining}개월 · 잔액 ₩${Math.round(st.balance).toLocaleString()}`;
}
function fixedCostLoanPreview(){
  const out=document.getElementById('cf-fixed-loan-preview'), amt=document.getElementById('cf-fixed-amt');
  const {loan,error}=_fixedLoanFromForm();
  const usesLoan=!!loan;
  if(amt){ amt.readOnly=usesLoan; amt.classList.toggle('is-computed',usesLoan); }
  if(!out) return;
  if(!loan){ out.textContent=error&&String(document.getElementById('cf-fixed-loan-principal')?.value||'').trim()?error:'원금을 비워 두면 금액 칸에 적은 값으로 매달 같은 금액을 기록합니다.'; return; }
  const now=new Date(), y=now.getFullYear(), m=now.getMonth()+1;
  const rows=loanSchedule(loan), st=loanStatusFor(loan,y,m);
  const shown=st.phase==='active'?st.row:(st.phase==='before'?rows[0]:null);
  if(amt) amt.value=shown?Math.round(shown.payment).toLocaleString():'0';
  const label=st.phase==='active'?'이번 달 납입':(st.phase==='before'?'첫 달 납입':'상환 끝');
  out.textContent=shown
    ?`${label} ₩${shown.payment.toLocaleString()} (이자 ₩${shown.interest.toLocaleString()} · 원금 ₩${shown.principal.toLocaleString()}) · 만기 ${_loanYmKo(st.end)} · ${_loanStatusText(loan,y,m).split(' · ').slice(2).join(' · ')} — 월 이자 = 잔액 × 연 금리 ÷ 12 로 계산한 추정값입니다.`
    :`${_loanYmKo(st.end)}에 상환이 끝난 대출입니다. 이후 달에는 기록하지 않습니다.`;
}
function toggleFixedCostLoanFields(){
  const isLoan=document.getElementById('cf-fixed-cat')?.value==='대출납입금';
  const box=document.getElementById('cf-fixed-loan'); if(box) box.hidden=!isLoan;
  const ySel=document.getElementById('cf-fixed-loan-y'); if(isLoan&&ySel&&!ySel.options.length) _fixedLoanFillMonthPickers();
  const cycle=document.getElementById('cf-fixed-cycle');
  if(cycle){ if(isLoan) cycle.value='monthly'; cycle.disabled=isLoan; toggleFixedCostScheduleFields(); }
  if(isLoan) fixedCostLoanPreview();
  else { const amt=document.getElementById('cf-fixed-amt'); if(amt){ amt.readOnly=false; amt.classList.remove('is-computed'); } }
}
function _fixedLoanFillForm(loan){
  const set=(id,v)=>{const el=document.getElementById(id); if(el) el.value=v;};
  set('cf-fixed-loan-method',loan?loan.method:'annuity');
  set('cf-fixed-loan-principal',loan?Math.round(loan.principal).toLocaleString():'');
  set('cf-fixed-loan-rate',loan?String(loan.rate):'');
  const byYears=loan&&loan.months%12===0;
  set('cf-fixed-loan-term',loan?String(byYears?loan.months/12:loan.months):'');
  set('cf-fixed-loan-term-unit',loan&&!byYears?'1':'12');
  _fixedLoanFillMonthPickers(loan?loan.start:_cfMonthKey());
}

function resetFixedCostForm() {
  const edit=document.getElementById('cf-fixed-edit-id');if(edit)edit.value='';
  const title=document.getElementById('cf-fixed-form-title');if(title)title.textContent='고정비 등록';
  const submit=document.getElementById('cf-fixed-submit');if(submit)submit.textContent='등록';
  const cancel=document.getElementById('cf-fixed-cancel');if(cancel)cancel.style.display='none';
  const desc=document.getElementById('cf-fixed-desc');if(desc)desc.value='';
  const amt=document.getElementById('cf-fixed-amt');if(amt)amt.value='';
  const cycle=document.getElementById('cf-fixed-cycle');if(cycle)cycle.value='monthly';
  const day=document.getElementById('cf-fixed-day');if(day)day.value='25';
  const start=document.getElementById('cf-fixed-start');if(start)start.value=_cfMonthKey();
  const owner=document.getElementById('cf-fixed-owner');if(owner)owner.value=_cfOwner==='전체'?'본인':_cfOwner;
  const gift=document.getElementById('cf-fixed-gift');if(gift)gift.checked=false;
  const catSel=document.getElementById('cf-fixed-cat');
  if(catSel){catSel.querySelectorAll('option[data-temp]').forEach(o=>o.remove());if(catSel.selectedIndex<0)catSel.selectedIndex=0;}
  _fixedLoanFillForm(null);
  toggleFixedCostLoanFields();
  toggleFixedCostScheduleFields();
}

function submitFixedCost() {
  if(isMobileLayout())return;
  const id=Number(document.getElementById('cf-fixed-edit-id')?.value)||0;
  const owner=document.getElementById('cf-fixed-owner')?.value;
  const cat=document.getElementById('cf-fixed-cat')?.value||'기타';
  const desc=document.getElementById('cf-fixed-desc')?.value.trim();
  const {loan,error:loanError}=_fixedLoanFromForm();
  if(loanError){alert(loanError);return;}
  const now=new Date(), nowY=now.getFullYear(), nowM=now.getMonth()+1;
  const loanRows=loan?loanSchedule(loan):[];
  // 대출이면 금액은 상환 일정이 정한다(이번 달, 아직 시작 전이면 첫 달 납입액) — 다른 경로의 `!at.amt` 확인을 통과하도록 같이 적어 둔다
  const amt=loan?(loanPaymentFor(loan,nowY,nowM)||(loanRows[0]?loanRows[0].payment:0)):Number((document.getElementById('cf-fixed-amt')?.value||'').replace(/,/g,''));
  const cycle=loan?'monthly':(document.getElementById('cf-fixed-cycle')?.value||'monthly');
  const day=Math.max(1,Math.min(31,Number(document.getElementById('cf-fixed-day')?.value)||1));
  const dow=Number(document.getElementById('cf-fixed-dow')?.value)||0;
  let start=document.getElementById('cf-fixed-start')?.value||_cfMonthKey();
  const isGift=!!document.getElementById('cf-fixed-gift')?.checked;
  if(!OWNERS.includes(owner)){alert('소유주를 선택하세요.');return;}
  if(!desc||(!loan&&(!amt||amt<0))){alert('항목과 금액을 입력하세요.');return;}
  // 첫 납입이 앱 시작 월보다 늦으면 그 달부터 센다. 만기 뒤에는 기록하지 않는다.
  const maturity=loanRows.length?loanRows[loanRows.length-1].month:'';
  if(loan&&loan.start>start) start=loan.start;
  const existing=autoTransferData.find(at=>at.id===id);
  if(existing){
    const changeFrom=_cfMonthKey();
    const oldMaturity=existing.loan?(loanSchedule(existing.loan).slice(-1)[0]||{}).month:'';
    Object.assign(existing,{owner,type:'지출',cat,desc,cycle,dayOfMonth:day,dayOfWeek:dow,startMonth:start,isFixedCost:true,businessDayRule:existing.businessDayRule||'next'});
    _setAutoTransferGift(existing,isGift);
    if(loan){
      existing.loan=loan; existing.amt=amt; existing.endMonth=maturity;
      // 이번 달부터 이미 기록된 이 자동이체의 현금 흐름 줄을 상환 일정 값으로 맞춘다(지난 달 기록은 그대로)
      let cfChanged=false;
      cfData.forEach(c=>{
        if(c.atId!==id||!c.isAuto) return;
        const k=String(c.date||'').slice(0,7); if(k<changeFrom) return;
        const [cy,cm]=k.split('-').map(Number); const v=loanPaymentFor(loan,cy,cm);
        if(c.amt!==v){ c.amt=v; cfChanged=true; }
      });
      if(cfChanged) saveCfData();
    }else{
      // 대출 조건을 지우면 그 만기로 잡아 둔 종료 월도 푼다
      if(existing.loan&&existing.endMonth===oldMaturity) existing.endMonth='';
      delete existing.loan;
      if(start>changeFrom){
        existing.amt=amt;
        existing.amountChanges=(existing.amountChanges||[]).filter(ch=>ch.from<start);
      }else{
        existing.amountChanges=(existing.amountChanges||[]).filter(ch=>ch.from<changeFrom);
        existing.amountChanges.push({from:changeFrom,amt});
      }
    }
  }else{
    const row={id:Date.now(),owner,type:'지출',cat,desc,amt,cycle,dayOfMonth:day,dayOfWeek:dow,startMonth:start,endMonth:maturity,lastApplied:'',isFixedCost:true,businessDayRule:'next'};
    if(loan) row.loan=loan;
    if(isGift) row.isGift=true;
    autoTransferData.push(row);
  }
  saveAutoTransfers();
  resetFixedCostForm();
  renderFixedCostView();
  renderCashFlow();
}

function editFixedCost(id) {
  if(isMobileLayout())return;
  const at=autoTransferData.find(x=>x.id===id);if(!at)return;
  document.getElementById('cf-fixed-edit-id').value=String(id);
  document.getElementById('cf-fixed-owner').value=OWNERS.includes(at.owner)?at.owner:(_cfOwner==='전체'?'본인':_cfOwner);
  // 목록에 없는 카테고리(예: 월별 화면에서 등록한 '저축/투자')는 선택지를 잠시 더해 그대로 보존한다 — 없으면 '기타'로 바뀌어 저장된다
  const catSel=document.getElementById('cf-fixed-cat');
  if(at.cat&&![...catSel.options].some(o=>o.value===at.cat)){const o=document.createElement('option');o.textContent=at.cat;o.dataset.temp='1';catSel.appendChild(o);}
  catSel.value=at.cat||'기타';
  document.getElementById('cf-fixed-desc').value=at.desc||'';
  const now=new Date();
  document.getElementById('cf-fixed-amt').value=Number(_effectiveAutoTransferAmt(at,now.getFullYear(),now.getMonth()+1)||0).toLocaleString();
  document.getElementById('cf-fixed-cycle').value=['monthly','month-end','weekly'].includes(at.cycle)?at.cycle:'monthly';
  document.getElementById('cf-fixed-day').value=at.dayOfMonth||1;
  document.getElementById('cf-fixed-dow').value=String(at.dayOfWeek||0);
  document.getElementById('cf-fixed-start').value=at.startMonth||_cfMonthKey();
  const giftEl=document.getElementById('cf-fixed-gift');if(giftEl)giftEl.checked=_autoTransferIsGift(at);
  // 대출 상환 조건이 있으면 채우고, 없으면 빈 칸 — 기존 대출납입금은 여기서 조건을 적어 다시 등록한다(같은 자동이체 id)
  _fixedLoanFillForm(at.loan||null);
  toggleFixedCostLoanFields();
  document.getElementById('cf-fixed-form-title').textContent='고정비 수정';
  document.getElementById('cf-fixed-submit').textContent='수정';
  document.getElementById('cf-fixed-cancel').style.display='';
  toggleFixedCostScheduleFields();
  document.getElementById('cf-fixed-desc').focus();
}

// '증여 이체' 표식(isGift) — 가족 증여 화면의 연결 목록은 이 표식이 있는 지출 자동이체만 보여 준다.
// 예전에 증여로 연결해 둔 것(giftKind)은 표식이 없어도 증여 이체로 본다(저장값 정리도 같은 규칙, _normalizeAutoTransfers).
function _autoTransferIsGift(at){ return !!at&&at.type==='지출'&&(at.isGift===true||at.giftKind==='child'||at.giftKind==='spouse'); }
// 표식을 끄면 증여 연결(giftKind·giftFrom)도 함께 푼다 — 목록에서 사라진 이체가 기록장에 계속 더해지지 않게.
function _setAutoTransferGift(at,on){
  if(!at) return;
  if(on&&at.type==='지출'){ at.isGift=true; return; }
  delete at.isGift; delete at.giftKind; delete at.giftFrom;
}
function setAutoTransferOwner(id,owner) {
  if(isMobileLayout())return;
  const at=autoTransferData.find(x=>x.id===id);if(!at||!OWNERS.includes(owner))return;
  at.owner=owner;
  saveAutoTransfers();
  renderFixedCostView();
}

function includeFixedCost(id) {
  if(isMobileLayout())return;
  const at=autoTransferData.find(x=>x.id===id);if(!at)return;
  if(!OWNERS.includes(at.owner)){alert('먼저 소유주를 선택하세요.');return;}
  at.isFixedCost=true;
  saveAutoTransfers();
  renderFixedCostView();
}

function excludeFixedCost(id) {
  if(isMobileLayout())return;
  const at=autoTransferData.find(x=>x.id===id);if(!at)return;
  at.isFixedCost=false;
  saveAutoTransfers();
  resetFixedCostForm();
  renderFixedCostView();
}

function restoreFixedCost(id) {
  if(isMobileLayout())return;
  const at=autoTransferData.find(x=>x.id===id);if(!at)return;
  delete at.isFixedCost;
  saveAutoTransfers();
  renderFixedCostView();
}

function toggleExcludedFixedCosts() {
  _cfShowExcluded=!_cfShowExcluded;
  renderFixedCostView();
}

// 경제 캘린더/뉴스 데이터는 제거됨 (메뉴 삭제)
