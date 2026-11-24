// 적립식 매수 화면(dca2)·적립식 설정 창 — cobalt.js 에서 옮겨 온 화면 렌더러(2026-11-23, 동작 변경 없음).
// cobalt.js 보다 먼저 로드한다(CB_VIEWS 가 이 파일의 렌더 함수를 참조한다). 맨 위에서는 함수·상태 선언만 하고,
// cobalt.js 의 상수·상태는 함수 안에서만 쓴다 — 로드 때 쓰면 아직 없는 이름이라 오류가 난다(test_source_split.mjs).

// ───────────────────────── 페이지: DCA 자동매수 ─────────────────────────
// 규칙 등록·수정은 적립식 설정 창(cbDcaEdit — 이 화면 줄의 '수정'과 보유 목록 적립식 칸이 같은 창)과 종목 편집 모달이 맡는다.
function cbDcaPerMonthKRW(i){
  const amtKrw = (i.dcaMode==='qty')
    ? (i.dcaQty||0)*(i.curP||0)*cbRate(i.cur)
    : (i.dcaAmt||0)*cbRate(i.dcaCur||'KRW');
  if (i.dcaCycle==='매주'){
    const weeklyDays=Array.isArray(i.dcaDays)&&i.dcaDays.length ? i.dcaDays.length : 1;
    return amtKrw*4.33*weeklyDays;
  }
  if (i.dcaCycle==='매일') return amtKrw*(i.grp==='가상화폐'?30.44:21.7);
  return amtKrw;
}
function cbDcaDayLabel(i){
  if (i.dcaCycle==='매월') return (i.dcaDay!=null && i.dcaDay!=='') ? i.dcaDay+'일' : '—';
  if (i.dcaCycle==='매주'){
    const D=['일','월','화','수','목','금','토'];
    return Array.isArray(i.dcaDays)&&i.dcaDays.length ? i.dcaDays.map(d=>D[d]||'').join('·')+'요일' : '—';
  }
  return '매영업일';
}
function cbDcaPerOrderKRW(i){
  if (!i) return 0;
  if (i.dcaMode==='qty') return (i.dcaQty||0)*(i.curP||0)*cbRate(i.cur);
  return (i.dcaAmt||0)*cbRate(i.dcaCur||'KRW');
}
function cbDcaExpectedQty(i){
  if (!i) return 0;
  if (i.dcaMode==='qty') return Number(i.dcaQty)||0;
  const priceKRW=(i.curP||0)*cbRate(i.cur);
  return priceKRW>0 ? cbDcaPerOrderKRW(i)/priceKRW : 0;
}
function cbDcaDateAt(value){
  const raw=value instanceof Date ? new Date(value) : (value ? new Date(String(value).length===10?String(value)+'T12:00:00':value) : new Date());
  if (isNaN(raw.getTime())) return new Date();
  raw.setHours(12,0,0,0);
  return raw;
}
function cbDcaDateKey(value){
  return finLocalDateKey(value instanceof Date?value:cbDcaDateAt(value));
}
function cbDcaMarket(i){
  if (typeof _getDcaMarket==='function') return _getDcaMarket(i);
  if (i.grp==='가상화폐') return 'CRYPTO';
  return i.cur==='USD'?'US':i.cur==='JPY'?'JP':'KR';
}
function cbDcaIsHoliday(i,date){
  const market=cbDcaMarket(i);
  if (typeof _isDcaHoliday==='function') return _isDcaHoliday(date,market);
  return market!=='CRYPTO' && (date.getDay()===0||date.getDay()===6);
}
function cbDcaScheduledOn(i,date){
  if (!i || !i.dca) return false;
  if (typeof dcaHasRule==='function' && !dcaHasRule(i)) return false;   // 금액 미입력 규칙은 일정이 없다(일정 탭·10일 목록 공통)
  const cycle=i.dcaCycle||'매월';
  if (cycle==='매일') return !cbDcaIsHoliday(i,date);
  if (cycle==='매주'){
    const days=Array.isArray(i.dcaDays)&&i.dcaDays.length ? i.dcaDays : [i.dcaDay!=null?Number(i.dcaDay):1];
    return days.includes(date.getDay()) && !cbDcaIsHoliday(i,date);
  }
  const day=Math.max(1,Math.min(31,Number(i.dcaDay)||1));
  const wanted=cbDcaDateKey(date);
  // 월말 휴장으로 다음 달에 밀린 주문까지 찾기 위해 현재 달과 직전 달을 함께 검사한다.
  for (const monthOffset of [0,-1]){
    const base=new Date(date.getFullYear(),date.getMonth()+monthOffset,day,12,0,0,0);
    if (base.getDate()!==day) continue;
    for(let j=0;j<7 && cbDcaIsHoliday(i,base);j++) base.setDate(base.getDate()+1);
    if (cbDcaDateKey(base)===wanted) return true;
  }
  return false;
}
// 앞으로 N일의 매수 예정일을 날짜별로 묶는다 — 판정은 cbDcaScheduledOn(휴장일 이월 포함) 그대로다.
// 실제 체결이 아니라 규칙상 예정일이며, 금액은 회당 원화 환산(cbDcaPerOrderKRW)이다.
function cbDcaUpcoming(list, asOf, days=10){
  const start=cbDcaDateAt(asOf), out=[];
  for(let n=0;n<days;n++){
    const d=new Date(start); d.setDate(start.getDate()+n);
    const hits=(list||[]).filter(x=>cbDcaScheduledOn(x.i,d));
    if(!hits.length) continue;
    out.push({key:cbDcaDateKey(d),date:new Date(d),items:hits,amount:hits.reduce((s,x)=>s+cbDcaPerOrderKRW(x.i),0)});
  }
  return out;
}
function cbDcaScheduleSummary(i, asOf){
  const today=cbDcaDateAt(asOf);
  const todayKey=cbDcaDateKey(today);
  const monthEnd=new Date(today.getFullYear(),today.getMonth()+1,0,12,0,0,0);
  const horizon=new Date(today); horizon.setDate(horizon.getDate()+370);
  let nextDate='', remainingCount=0;
  for(let d=new Date(today);d<=horizon;d.setDate(d.getDate()+1)){
    const key=cbDcaDateKey(d);
    // 이 앱은 증권사의 실제 체결 데이터를 받지 않는다. 일정은 규칙만으로 정하고 과거 체결 기록에 기대지 않는다.
    if (key<todayKey || !cbDcaScheduledOn(i,d)) continue;
    if (!nextDate) nextDate=key;
    if (d<=monthEnd) remainingCount++;
    if (nextDate && d>monthEnd) break;
  }
  return {
    nextDate,
    remainingCount,
    remainingAmount:remainingCount*cbDcaPerOrderKRW(i),
    expectedQty:cbDcaExpectedQty(i)
  };
}
function cbDcaIsUsDst(value){
  const d=cbDcaDateAt(value);
  const year=d.getFullYear();
  const march1=new Date(year,2,1,12,0,0,0);
  const dstStart=new Date(year,2,1+((7-march1.getDay())%7)+7,12,0,0,0);
  const nov1=new Date(year,10,1,12,0,0,0);
  const dstEnd=new Date(year,10,1+((7-nov1.getDay())%7),12,0,0,0);
  return d>=dstStart && d<dstEnd;
}
function cbDcaBrokerTiming(i, asOf){
  const broker=String(i&&i.broker||'').replace(/\s+/g,'');
  const market=cbDcaMarket(i||{});
  if (market==='CRYPTO') return {label:'상시 자동주문',note:'거래소 점검 제외'};
  if (broker.includes('메리츠') && market==='US'){
    const orderTime=cbDcaIsUsDst(asOf)?'21:30':'22:30';
    return {label:orderTime+' 주문',note:'D+1 영업일 체결·배분'};
  }
  if (broker.includes('삼성') && market==='KR') return {label:'오전 장중',note:'미체결 시 당일 재주문'};
  if (broker.includes('삼성') && market==='US') return {label:'미국장 기준시간',note:'미체결 시 당일 재주문'};
  if (broker.includes('토스') && market==='US') return {label:'당일 자동주문',note:'체결 시각 유동'};
  if (broker.includes('토스') && market==='KR') return {label:'국내장 자동주문',note:'체결 시각 유동'};
  if (market==='US') return {label:'미국장 자동주문',note:'증권사 앱 확인'};
  if (market==='KR') return {label:'국내장 자동주문',note:'증권사 앱 확인'};
  return {label:'시장 기준 자동주문',note:'증권사 앱 확인'};
}
function cbDcaNextLabel(dateKey){
  if (!dateKey) return '—';
  const d=cbDcaDateAt(dateKey);
  const D=['일','월','화','수','목','금','토'];
  return `${d.getMonth()+1}.${String(d.getDate()).padStart(2,'0')} (${D[d.getDay()]})`;
}
function cbDcaRuleLabel(i){
  const cycle=i.dcaCycle||'매월';
  if (cycle==='매일') return '매영업일';
  return cycle+' '+cbDcaDayLabel(i);
}
function cbRenderDca(){
  const el = document.getElementById('cb-dca2'); if(!el) return;
  const ownerF = (_cbDcaOwner && _cbDcaOwner!=='전체') ? _cbDcaOwner : null;
  // 조회 전용(2026-11-20 8차, 사용자 결정) — 켜 둔 규칙만 보인다. 중단한 규칙은 빠지고(보유 목록 칸도 '—'),
  // 드물게 남은 '금액 미입력'(켜짐 + 금액 0)은 고치도록 주황 글자로 남긴다. 등록·수정·켜기/끄기는 보유 목록의 적립식 칸(cbDcaEdit)이 맡는다.
  const items = (pfolioData||[]).map((i,idx)=>({i,idx}))
    .filter(x=>{ const st=dcaState(x.i); return st==='on'||st==='incomplete'; })
    .filter(x=>!ownerF || x.i.owner===ownerF);
  // 내역 정렬: 소유주 → 계좌 → 국기(상장국) → 종목명 오름차순
  items.forEach(x=>{ x.r = cbRow(x.i, x.idx); });
  const oi = o => { const k = OWNERS.indexOf(o); return k<0 ? 99 : k; };
  items.sort((a,b)=>
    (oi(a.i.owner) - oi(b.i.owner))
    || String(a.i.broker||'').localeCompare(String(b.i.broker||''), 'ko')
    || cbCtryLabel(a.r).localeCompare(cbCtryLabel(b.r), 'ko')
    || String(a.r.title||'').localeCompare(String(b.r.title||''), 'ko'));
  const active = items.filter(x=>dcaState(x.i)==='on');   // 금액 미입력(incomplete)은 활성·일정·합계에서 뺀다(0원 매수가 일정에 뜨지 않게)
  const incomplete = items.length - active.length;
  const monthly = active.reduce((s,x)=>s+cbDcaPerMonthKRW(x.i),0);
  const daily = monthly / 21.7; // 월평균 영업일 기준 일평균
  items.forEach(x=>{
    x.schedule=cbDcaScheduleSummary(x.i);
    x.timing=cbDcaBrokerTiming(x.i,x.schedule.nextDate||new Date());
  });
  const remainingCount=active.reduce((s,x)=>s+x.schedule.remainingCount,0);
  const remainingAmount=active.reduce((s,x)=>s+x.schedule.remainingAmount,0);
  const dcaAllocMap = new Map();
  active.forEach(x=>{
    const ticker=cbStrip(x.i.tkr);
    const key=(x.i.owner||'—')+'::'+(ticker||x.r.title);
    const prev=dcaAllocMap.get(key)||{
      owner:x.i.owner||'—',ticker,title:x.r.title||ticker||'—',cls:x.r.cls,amount:0
    };
    prev.amount+=cbDcaPerMonthKRW(x.i);
    dcaAllocMap.set(key,prev);
  });
  // 월 환산 배분은 켜 둔 규칙 전부를 보인다(2026-11-24 사용자 요청 — 예전 TOP 5 는 나머지를 숨겼다).
  const dcaAlloc=Array.from(dcaAllocMap.values()).sort((a,b)=>b.amount-a.amount);
  // 계획만 저장하며 실제 주문이나 보유수량은 변경하지 않는다.
  cbSetHead('적립식 매수 일정 · 조회 전용이며 규칙 등록·수정은 보유 목록의 적립식 칸에서 합니다 · 실제 체결은 증권사에서 확인하세요',
    cbOwnerBtns(_cbDcaOwner,'cbDcaOwner'));
  el.innerHTML = `
    <div class="cb-dca-summary-grid">
      <div class="cb-panel cb-dca-summary-card"><div class="cb-dca-summary-label">진행 중 규칙</div><div class="cb-dca-summary-value">${active.length}<span>개</span></div>${incomplete?`<div class="cb-dca-summary-sub">금액 미입력 ${incomplete}개는 빼고 셉니다</div>`:''}</div>
      <div class="cb-panel cb-dca-summary-card"><div class="cb-dca-summary-label"><span data-tip="활성 규칙의 월 적립식 매수 합계를 월평균 영업일(21.7일)로 나눈 하루 평균 매수 금액">일평균 적립식 매수 합계</span></div><div class="cb-dca-summary-value">${cbDisp(daily)}</div></div>
      <div class="cb-panel cb-dca-summary-card"><div class="cb-dca-summary-label"><span data-tip="켜 둔(활성) 규칙만 월 기준으로 환산해 더한 금액">월 적립식 매수 합계</span></div><div class="cb-dca-summary-value">${cbDisp(monthly)}</div></div>
      <div class="cb-panel cb-dca-summary-card"><div class="cb-dca-summary-label">연간 적립 예상</div><div class="cb-dca-summary-value">${cbDisp(monthly*12)}</div></div>
      <div class="cb-panel cb-dca-summary-card cb-dca-remaining-card">
        <div class="cb-dca-summary-label"><span data-tip="오늘 이후 이번 달에 남아 있는 활성 DCA 예정일을 시장 휴장일 기준으로 계산합니다. 실제 체결 여부는 증권사 앱에서 확인해야 합니다.">이번 달 남은 매수</span></div>
        <div class="cb-dca-summary-value">${remainingCount}<span>회</span><em class="cb-dca-summary-amt">${remainingCount?cbDisp(remainingAmount)+' 예정':'이번 달 일정 완료'}</em></div>
      </div>
    </div>
    ${(()=>{
      const up=cbDcaUpcoming(active);
      if(!active.length) return '';
      const WD=['일','월','화','수','목','금','토'];
      return `<section class="cb-panel cb-dca-upcoming" aria-label="앞으로 10일 매수 일정">
        <div class="cb-dca-upcoming-head"><span class="cb-panel-title">앞으로 10일 매수 일정</span><small>규칙상 예정일 · 휴장일은 다음 거래일로 이월 · 실제 체결은 증권사에서 확인</small></div>
        ${up.length?(()=>{
          // 10일을 빈 날까지 모두 칸으로 그려 카드 폭을 채운다 — 예정이 있는 날만 강조한다.
          const byKey=new Map(up.map(d=>[d.key,d])), start=cbDcaDateAt();
          const cells=Array.from({length:10},(_,n)=>{const d=new Date(start); d.setDate(start.getDate()+n); return {d,hit:byKey.get(cbDcaDateKey(d))};});
          return `<ol class="cb-dca-upcoming-list">${cells.map(({d,hit},n)=>{
            const wd=d.getDay(), head=`<b>${d.getMonth()+1}/${d.getDate()} <span>(${WD[wd]})</span>${n===0?'<small>오늘</small>':''}</b>`;
            const cls=[hit?'is-hit':'is-empty',(wd===0||wd===6)?'is-weekend':''].filter(Boolean).join(' ');
            return hit
              ?`<li class="${cls}">${head}${hit.items.map(x=>`<span class="cb-dca-upcoming-item"><i style="background:${cbOwnerColor(x.i.owner)}"></i>${cbEsc(cbStrip(x.i.tkr)||x.r.title)}</span>`).join('')}<em>${cbDisp(hit.amount)}</em></li>`
              :`<li class="${cls}" aria-label="${d.getMonth()+1}월 ${d.getDate()}일 예정 없음">${head}<span class="cb-dca-upcoming-none">—</span></li>`;
          }).join('')}</ol>`;
        })():'<div class="cb-dca-upcoming-empty">10일 안에 예정된 매수가 없습니다.</div>'}
      </section>`;
    })()}
    <div class="cb-dca-detail-grid">
    <div class="cb-panel cb-table-panel" style="padding:14px 16px">
      <div class="cb-dca-table-toolbar"><span class="cb-panel-title">적립식 규칙 <span style="color:var(--dim)">· ${items.length}개</span></span><button type="button" class="cf-fixed-dca-link" onclick="switchView('holdings')">보유 목록에서 수정 ›</button></div>
      <div class="cb-thead cb-dca-head">
        <span>${cbSortBtn('dca','owner','소유주','text')}</span><span>${cbSortBtn('dca','name','종목','text')}</span><span class="cb-mobile-secondary">${cbSortBtn('dca','order','<span data-tip="정렬은 원화 환산 기준">회당 금액</span>')}</span><span>${cbSortBtn('dca','cycle','주기','text')}</span><span>${cbSortBtn('dca','next','다음 매수','text')}</span><span class="cb-mobile-secondary"><span data-tip="증권사 공식 안내와 시장 기준을 반영한 대략적인 주문·처리 시점입니다. 실제 체결은 증권사 앱에서 확인하세요.">예상 처리</span></span><span class="cb-mobile-secondary">${cbSortBtn('dca','qty','<span data-tip="현재가 기준으로 이번 한 회차에 매수될 것으로 예상되는 수량">예상 수량</span>')}</span><span class="cb-mobile-secondary">${cbSortBtn('dca','acct','계좌','text')}</span><span>${cbSortBtn('dca','monthly','월 환산')}</span>
      </div>
      ${cbSortRows('dca',items,{
        owner:x=>cbOwnerRank(x.i.owner), name:x=>x.r.title||'', order:x=>cbDcaPerOrderKRW(x.i), cycle:x=>cbDcaRuleLabel(x.i),
        next:x=>x.i.dca&&x.schedule.nextDate?x.schedule.nextDate:null, qty:x=>x.schedule.expectedQty>0?x.schedule.expectedQty:null,
        acct:x=>x.i.broker||null, monthly:x=>cbDcaPerMonthKRW(x.i),
      }).map(x=>{
        const r=x.r;
        const amtLabel = !dcaHasRule(x.i) ? '<span class="dca-amount is-missing">금액 미입력</span>' : x.i.dcaMode==='qty'
          ? (Number(x.i.dcaQty)||0).toLocaleString(undefined,{maximumFractionDigits:4})+'주'
          : cbFmtNative(x.i.dcaAmt||0, x.i.dcaCur||'KRW');
        return `
        <div class="cb-dca-row">
          <span>${cbOwnerTag(x.i.owner)}</span>
          <div class="cb-dca-asset">
            ${cbFlagCell(r, 27, 15)}
            <span class="cb-asset-inline cb-tip-block" data-overflow-tip="${cbEsc([r.title,r.subTitle].filter(Boolean).join(' · '))}">
              <span class="cb-asset-name" data-overflow-watch>${cbEsc(r.title)}</span>
              ${r.subTitle?`<span class="cb-asset-ticker" data-overflow-watch>${cbEsc(r.subTitle)}</span>`:''}
            </span>
          </div>
          <span class="cb-mobile-secondary" style="font-weight:700">${amtLabel}</span>
          <span style="color:var(--mut);font-size:var(--fs-cap)">${cbEsc(cbDcaRuleLabel(x.i))}</span>
          <span style="color:${x.i.dca?'var(--acc)':'var(--dim)'};font-weight:700;white-space:nowrap" aria-label="${x.i.dca&&x.schedule.nextDate?'다음 매수일 '+cbEsc(x.schedule.nextDate):'다음 매수일 없음'}">${x.i.dca?cbDcaNextLabel(x.schedule.nextDate):'—'}</span>
          <span class="cb-mobile-secondary cb-dca-timing-cell cb-tip-block" data-tip="예상 처리 시점입니다. 실제 주문·체결 여부는 ${cbEsc(x.i.broker||'증권사')} 앱에서 확인하세요."><b>${cbEsc(x.timing.label)}</b><small>${cbEsc(x.timing.note)}</small></span>
          <span class="cb-mobile-secondary" style="color:var(--mut);font-size:var(--fs-cap)">${x.schedule.expectedQty>0?x.schedule.expectedQty.toLocaleString(undefined,{maximumFractionDigits:x.i.grp==='가상화폐'?6:4})+(x.i.grp==='가상화폐'?'개':'주'):'—'}</span>
          <span class="cb-mobile-secondary" style="color:var(--mut);font-size:var(--fs-cap);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(x.i.broker||'—')}</span>
          <span style="font-weight:600">${cbDisp(cbDcaPerMonthKRW(x.i))}/월</span>
        </div>`;}).join('') || '<div style="padding:16px;text-align:center;color:var(--dim);font-size:var(--fs-cap)">진행 중인 적립식 규칙이 없습니다. 자산 관리 › 보유 목록의 적립식 칸을 눌러 규칙을 등록하거나 다시 켜세요.</div>'}
    </div>
    <div class="cb-panel cb-dca-allocation-card">
      <div class="cb-insight-title">월 환산 매수 배분${dcaAlloc.length?` <span class="cb-dca-allocation-count">${dcaAlloc.length}종목</span>`:''}</div>
      <div class="cb-dca-allocation-total"><span>활성 규칙 월 합계</span><b>${cbDisp(monthly)}</b></div>
      <div class="cb-dca-allocation-list">
        ${dcaAlloc.map((x,rank)=>{
          const share=monthly>0?x.amount/monthly*100:0;
          const label=cbDcaAllocLabel(x);
          return `<div class="cb-dca-allocation-row">
            <div class="cb-dca-allocation-head">
              <span class="cb-dca-allocation-rank">${rank+1}</span>
              <span class="cb-dca-allocation-name cb-tip-block" data-overflow-tip="${cbEsc(label)}" data-overflow-watch>${cbEsc(label)}</span>
              <b>${share.toFixed(1)}%</b>
            </div>
            <div class="cb-dca-allocation-meta"><span>${ownerF?'':cbEsc(x.owner)+' · '}${cbDisp(x.amount)}/월</span></div>
            <div class="cb-dca-allocation-track"><i style="width:${share.toFixed(2)}%;background:${cbOwnerColor(x.owner)}"></i></div>
          </div>`;
        }).join('') || '<div class="cb-insight-empty">활성화된 DCA 규칙이 없습니다.</div>'}
      </div>
    </div>
    </div>`;
}
// 배분 목록의 종목 이름 — 미국은 '티커 · 이름', 한국·일본은 '이름 · 티커'(2026-11-24 사용자 요청).
// 한국·일본 티커는 숫자 코드라 이름이 먼저여야 읽힌다. 이름과 티커가 같으면 한 번만 쓴다.
function cbDcaAllocLabel(x){
  const t=String((x&&x.ticker)||''), n=String((x&&x.title)||'');
  const parts=(x&&(x.cls==='kr'||x.cls==='jp'))?[n,t]:[t,n];
  return parts.filter((v,k)=>v&&(k===0||v!==parts[0])).join(' · ')||'—';
}
function cbDcaOwner(o){ _cbDcaOwner=o; cbRenderDca(); }
// 적립식 규칙 저장 가드 — 설정 창(cbDcaEditSave)이 쓴다. (적립식 매수 화면의 켜기/끄기 토글은 2026-11-20 8차에
// 화면을 조회 전용으로 바꾸며 지웠다.) 자산 원장과 재무계획을 둘 다 불러온 뒤에만 저장한다(빈 기본값으로 덮어쓰지 않도록).
let _dcaBusy=false;
function cbDcaCanSave(){
  if(window._kvLoadState?.assets==='ready'&&window._kvLoadState?.ext==='ready')return true;
  showSaveError('자산과 재무계획을 모두 불러온 뒤 규칙을 저장할 수 있습니다.');return false;
}
// ── 적립식 설정 창(2026-11-20, 사용자 결정: 작은 설정 창) ── 보유 목록의 적립식 칸과 이 화면의 줄이 같은 창을 연다.
// 바꾸는 것은 적립식 필드뿐이고(수량·평균단가·분할 기준일은 그대로), 저장은 기존 경로(saveAssetsToKV, CAS)다.
// 두 원격 로드가 ready 일 때만 저장하고(cbDcaCanSave), 휴대폰은 조회 전용이다.
const DCA_EDIT_FIELDS=['dca','dcaCycle','dcaAmt','dcaCur','dcaMode','dcaQty','dcaDays','dcaDay'];
let _dcaEdit=null;
// 창을 연 뒤 목록이 다시 그려지거나 행이 지워져도 같은 종목인지 확인하는 열쇠(인덱스만 믿지 않는다)
function cbDcaEditKey(i){ return [i.owner||'',i.grp||'',i.tkr||'',i.broker||'',i.acc||'',i.name||''].join('|'); }
// 창을 채울 값 — 저장된 규칙 그대로. 규칙이 없으면 주기는 모으기(소수점 미국 주식) 종목이면 '매일', 아니면 '매월'.
function cbDcaEditDefaults(i){
  const rule=dcaHasRule(i), mode=i.dcaMode==='qty'?'qty':'amount';
  const days=Array.isArray(i.dcaDays)&&i.dcaDays.length?i.dcaDays.map(Number):[1];
  return {
    on: rule ? !!i.dca : true,
    cycle: (rule||i.dca) ? (['매일','매주','매월'].includes(i.dcaCycle)?i.dcaCycle:'매월') : (dcaFractionalUs(i)?'매일':'매월'),
    mode, amt: Number(i.dcaAmt)>0?Number(i.dcaAmt):'', cur: i.dcaCur==='USD'?'USD':'KRW',
    qty: Number(i.dcaQty)>0?Number(i.dcaQty):'', days, day: Math.max(1,Math.min(31,Math.round(Number(i.dcaDay)||1))),
  };
}
// 입력값 → 저장할 적립식 필드(순수 함수). 켜려면 금액(또는 수량)이 있어야 하고, 매주는 요일이 하나 이상이어야 한다.
// 꺼 둔 채 저장하면 규칙만 보관된다(중단 상태 — 나중에 켜기만 하면 재개).
function cbDcaEditPlan(form){
  const num=v=>Number(String(v==null?'':v).replace(/,/g,'').trim());
  const on=!!form.on, cycle=['매일','매주','매월'].includes(form.cycle)?form.cycle:'매월', mode=form.mode==='qty'?'qty':'amount';
  const amt=num(form.amt)||0, qty=num(form.qty)||0;
  if(!Number.isFinite(amt)||!Number.isFinite(qty)||amt<0||qty<0) return {ok:false,error:'금액·수량은 0 이상의 숫자로 입력하세요.'};
  const days=[...new Set((form.days||[]).map(Number).filter(d=>Number.isInteger(d)&&d>=0&&d<=6))].sort((a,b)=>a-b);
  if(on&&mode==='amount'&&!(amt>0)) return {ok:false,error:'매수를 켜려면 1회 매수 금액을 입력하세요.'};
  if(on&&mode==='qty'&&!(qty>0)) return {ok:false,error:'매수를 켜려면 1회 매수 수량을 입력하세요.'};
  if(cycle==='매주'&&!days.length) return {ok:false,error:'매주 매수는 요일을 하나 이상 고르세요.'};
  return {ok:true,patch:{dca:on,dcaCycle:cycle,dcaMode:mode,dcaAmt:Math.round(amt),dcaCur:form.cur==='USD'?'USD':'KRW',dcaQty:qty,
    dcaDays:cycle==='매주'?days:[],dcaDay:Math.max(1,Math.min(31,Math.round(Number(form.day)||1)))}};
}
function cbDcaEdit(idx){
  if(typeof isMobileLayout==='function'&&isMobileLayout()) return;
  const item=(pfolioData||[])[idx]; if(!item||item.grp==='현금') return;
  if(typeof closeAddModal==='function') closeAddModal();
  if(typeof closeTradeModal==='function') closeTradeModal();
  const d=cbDcaEditDefaults(item), $=id=>document.getElementById(id);
  _dcaEdit={idx,key:cbDcaEditKey(item),mode:d.mode};
  const unit=item.unit||(item.grp==='가상화폐'?'개':'주');
  $('dca-edit-title').textContent=`${item.name||item.tkr||'종목'} 적립식 설정`;
  $('dca-edit-now').innerHTML=`<span>${cbEsc(item.owner||'')} · ${cbEsc(item.broker||'')} / ${cbEsc(item.acc||'')}</span>`
    +`<span>보유 <b>${(Number(item.qty)||0).toLocaleString(undefined,{maximumFractionDigits:8})}${cbEsc(unit)}</b> · 지금 <b>${DCA_STATE_LABEL[dcaState(item)]}</b></span>`;
  const daySel=$('dca-edit-day');
  if(daySel&&!daySel.options.length) daySel.innerHTML=Array.from({length:31},(_,k)=>`<option value="${k+1}">${k+1}일</option>`).join('');
  $('dca-edit-on').checked=d.on;
  $('dca-edit-cycle').value=d.cycle;
  daySel.value=String(d.day);
  document.querySelectorAll('.dca-edit-dow').forEach(c=>{c.checked=d.days.includes(Number(c.value));});
  $('dca-edit-amt').value=d.amt===''?'':Number(d.amt).toLocaleString();
  $('dca-edit-cur').value=d.cur;
  $('dca-edit-qty').value=d.qty===''?'':String(d.qty);
  $('dca-edit-qty-label').textContent=`1회 매수 수량 (${unit})`;
  const err=$('dca-edit-error'); err.textContent=''; err.hidden=true;
  cbDcaEditMode(d.mode); cbDcaEditSync();
  const modal=$('dca-modal');
  window._dcaEditReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  modal.classList.add('active'); modal.setAttribute('aria-hidden','false');
  requestAnimationFrame(()=>$('dca-edit-on')?.focus());
}
function cbDcaEditSync(){
  const cycle=document.getElementById('dca-edit-cycle')?.value, on=document.getElementById('dca-edit-on')?.checked;
  const day=document.getElementById('dca-edit-day-wrap'), dows=document.getElementById('dca-edit-dows'), st=document.getElementById('dca-edit-state');
  if(day) day.hidden=cycle!=='매월';
  if(dows) dows.hidden=cycle!=='매주';
  if(st) st.textContent=on?'저장하면 적립식 일정·합계에 들어갑니다':'끈 채 저장하면 규칙만 보관됩니다(중단)';
}
function cbDcaEditMode(mode){
  mode=mode==='qty'?'qty':'amount';
  if(_dcaEdit) _dcaEdit.mode=mode;
  document.getElementById('dca-edit-mode-amount')?.setAttribute('aria-pressed',String(mode==='amount'));
  document.getElementById('dca-edit-mode-qty')?.setAttribute('aria-pressed',String(mode==='qty'));
  const a=document.getElementById('dca-edit-amt-wrap'), q=document.getElementById('dca-edit-qty-wrap');
  if(a) a.hidden=mode!=='amount';
  if(q) q.hidden=mode!=='qty';
}
function cbDcaEditClose(){
  const modal=document.getElementById('dca-modal');
  if(!modal?.classList.contains('active')) return;
  modal.classList.remove('active'); modal.setAttribute('aria-hidden','true');
  _dcaEdit=null;
  const back=window._dcaEditReturnFocus; window._dcaEditReturnFocus=null;
  if(back&&document.contains(back)) back.focus();
}
async function cbDcaEditSave(){
  if(!_dcaEdit||_dcaBusy) return;
  if(typeof isMobileLayout==='function'&&isMobileLayout()) return;
  const $=id=>document.getElementById(id), err=$('dca-edit-error');
  const fail=m=>{err.textContent=m; err.hidden=!m;};
  const item=(pfolioData||[])[_dcaEdit.idx];
  if(!item||cbDcaEditKey(item)!==_dcaEdit.key){ fail('목록이 바뀌어 이 종목을 찾지 못했습니다. 창을 닫고 다시 열어 주세요.'); return; }
  const plan=cbDcaEditPlan({on:$('dca-edit-on').checked,cycle:$('dca-edit-cycle').value,mode:_dcaEdit.mode,amt:$('dca-edit-amt').value,
    cur:$('dca-edit-cur').value,qty:$('dca-edit-qty').value,day:$('dca-edit-day').value,
    days:Array.from(document.querySelectorAll('.dca-edit-dow:checked')).map(c=>c.value)});
  if(!plan.ok){ fail(plan.error); return; }
  if(!cbDcaCanSave()) return;
  const before={}; DCA_EDIT_FIELDS.forEach(k=>{ before[k]=Array.isArray(item[k])?item[k].slice():item[k]; });
  Object.assign(item,plan.patch); _dcaBusy=true;
  let result;
  try{ result=await saveAssetsToKV(); }catch(e){ result={ok:false}; }
  _dcaBusy=false;
  if(!result?.ok){
    // 저장 경로가 마지막 정상 상태로 되돌리면 이 객체는 목록에서 빠진다. 충돌(409)처럼 그대로 남은 경우만 직접 되돌린다.
    if((pfolioData||[]).includes(item)) DCA_EDIT_FIELDS.forEach(k=>{ item[k]=before[k]; });
    fail('저장하지 못했습니다 — 적립식 설정을 되돌렸습니다.');
    cbDcaEditRefresh();
    return;
  }
  cbDcaEditClose();
  cbDcaEditRefresh();
}
// 보유 목록(레거시 화면)은 저장 래퍼의 cbRerender 가 다시 그리지 않으므로 여기서 그린다.
function cbDcaEditRefresh(){
  if(document.getElementById('view-holdings')?.classList.contains('active')&&typeof renderPortfolio==='function') renderPortfolio(currentOwner);
  // 고정비 표의 적립식 줄(✎)에서 연 경우 — 고정비 합계를 다시 그린다
  if(document.getElementById('view-cashflow')?.classList.contains('active')&&typeof renderFixedCostView==='function') renderFixedCostView();
}
