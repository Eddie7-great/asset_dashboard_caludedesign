// 배당 관리 화면(divm) — cobalt.js 에서 옮겨 온 화면 렌더러(2026-11-23, 동작 변경 없음).
// cobalt.js 보다 먼저 로드한다(CB_VIEWS 가 이 파일의 렌더 함수를 참조한다). 맨 위에서는 함수·상태 선언만 하고,
// cobalt.js 의 상수·상태는 함수 안에서만 쓴다 — 로드 때 쓰면 아직 없는 이름이라 오류가 난다(test_source_split.mjs).

// ───────────────────────── 페이지: 배당 관리 ─────────────────────────
// 배당 캘린더 Y축 금액 라벨 (만/억 + 소액은 천 단위)
function cbDivAxisLab(v){
  if (v===0) return '0';
  if (Math.abs(v)>=10000) return cbAmtAxisLab(v);
  return Math.round(v/1000).toLocaleString('ko-KR')+'천';
}
function cbAddDivMonthDetail(detailMaps, monthIndex, item, amount){
  if (!detailMaps[monthIndex] || !(amount>0)) return;
  const owner = item.i?.owner || '미지정';
  const assetKey = cbStrip(item.tkr) || item.title || item.i?.name || '미지정';
  const key = `${owner}::${assetKey}`;
  const title = item.title || item.i?.name || assetKey;
  const ticker = cbStrip(item.tkr);
  const prev = detailMaps[monthIndex].get(key) || { owner, title, ticker, amount:0 };
  prev.amount += amount;
  detailMaps[monthIndex].set(key, prev);
}
// 배당 지급월이 API 응답에 없을 때의 폴백. 주기를 알면 주기대로(연 1회는 12월) 잡고,
// 주기까지 미상일 때만 분기 가정으로 내려간다. 월별 막대와 '다가오는 배당'이 서로 다른
// 일정을 그리지 않도록 두 곳이 반드시 이 함수 하나만 쓴다.
function cbDefaultDivMonths(cycle){
  const byCycle = typeof _defaultMonthsForCycle==='function' ? _defaultMonthsForCycle(cycle) : null;
  return (byCycle && byCycle.length) ? byCycle : [2,5,8,11];
}
// 배당 이력에서 특정 연도의 지급액을 월별로 집계 (현재 보유수량·계좌별 세제 기준 환산)
function cbDivMonthlyForYear(list, year, netBasis=false){
  const monthAmt = Array(12).fill(0);
  const detailMaps = Array.from({length:12},()=>new Map());
  const cur = String(new Date().getFullYear());
  if (year===cur){
    // 올해 이후 → 예상: 연 배당을 지급 주기 월에 균등 배분
    list.forEach(x=>{
      const ms = (x.d.months && x.d.months.length) ? x.d.months : cbDefaultDivMonths(x.d.cycle);
      const per = x.incomeKRW / ms.length;
      ms.forEach(m=>{
        const mi=((m%12)+12)%12;
        monthAmt[mi]+=per;
        cbAddDivMonthDetail(detailMaps,mi,x,per);
      });
    });
    return {
      monthAmt,
      monthDetails:detailMaps.map(map=>Array.from(map.values()).sort((a,b)=>b.amount-a.amount)),
      actual:false
    };
  }
  // 과거 연도 → 지급 이력(주당 배당 × 현재 계좌별 보유수량). 세후 선택 시
  // 모든 종목을 먼저 연간 합산한 뒤 ISA 공제를 소유주별 한 번만 적용한다.
  const raw = window._divHistoryRawCache || {};
  const taxEntries=[];
  let covered=0;
  list.forEach(x=>{
    const h = raw[cbStrip(x.i.tkr)];
    if (!h || !Array.isArray(h.events)) return;
    const events=h.events.filter(ev=>String(ev.date||'').slice(0,4)===year);
    if(!events.length) return;
    covered++;
    const rate=cbRate(h.cur || x.d?.cur || x.i.cur);
    const lots=(x.taxLots&&x.taxLots.length)
      ? x.taxLots
      : [{owner:x.i.owner,acc:x.i.acc,qty:x.qty||0}];
    lots.forEach(lot=>{
      const qty=Number(lot.qty)||0;
      const gross=events.reduce((sum,ev)=>sum+(Number(ev.amount)||0)*qty*rate,0);
      if(gross>0) taxEntries.push({owner:lot.owner||x.i.owner,acc:lot.acc,gross,ref:{item:x,events,qty,rate}});
    });
  });
  const allocated=cbDivTaxAllocate(taxEntries).list;
  allocated.forEach(entry=>{
    const ref=entry.ref;
    const ratio=netBasis&&entry.gross>0?entry.net/entry.gross:1;
    ref.events.forEach(ev=>{
      const mi=parseInt(String(ev.date).slice(5,7),10)-1;
      if(mi<0||mi>11) return;
      const amount=(Number(ev.amount)||0)*ref.qty*ref.rate*ratio;
      monthAmt[mi]+=amount;
      cbAddDivMonthDetail(detailMaps,mi,ref.item,amount);
    });
  });
  return {
    monthAmt,
    monthDetails:detailMaps.map(map=>Array.from(map.values()).sort((a,b)=>b.amount-a.amount)),
    actual:true,
    coverage:{covered,total:list.length}
  };
}
function cbUpcomingDividendSchedule(list, days=90, asOf=null){
  const start=asOf?new Date(asOf):new Date();
  if (Number.isNaN(start.getTime())) return [];
  start.setHours(0,0,0,0);
  const end=new Date(start);
  end.setDate(end.getDate()+Math.max(1,Number(days)||90));
  const events=[];
  (list||[]).forEach(x=>{
    const months=Array.from(new Set((x.d?.months&&x.d.months.length?x.d.months:cbDefaultDivMonths(x.d?.cycle))
      .map(Number).filter(m=>Number.isInteger(m)&&m>=0&&m<12)));
    const exactDay=Number(x.d?.payDay);
    const hasExactDay=Number.isInteger(exactDay)&&exactDay>=1&&exactDay<=31;
    const perAmount=months.length?x.incomeKRW/months.length:0;
    if(!Number.isFinite(perAmount)||perAmount<=0)return;
    for(let offset=0;offset<=Math.ceil((end-start)/86400000/28)+1;offset++){
      const cursor=new Date(start.getFullYear(),start.getMonth()+offset,1);
      const month=cursor.getMonth();
      if(!months.includes(month)) continue;
      const lastDay=new Date(cursor.getFullYear(),month+1,0).getDate();
      const day=hasExactDay?Math.min(exactDay,lastDay):1;
      const date=new Date(cursor.getFullYear(),month,day);
      if(hasExactDay ? date<start||date>end : new Date(cursor.getFullYear(),month,lastDay)<start||date>end) continue;
      events.push({
        date,
        dateLabel:hasExactDay?`${month+1}월 ${day}일경`:`${month+1}월 예정`,
        exact:false,
        boundary:!hasExactDay&&(date<start||new Date(cursor.getFullYear(),month,lastDay)>end),
        owner:x.i?.owner||'—',
        ticker:cbStrip(x.tkr||x.i?.tkr),
        title:x.title||x.i?.name||x.tkr||'—',
        amount:perAmount
      });
    }
  });
  return events.sort((a,b)=>a.date-b.date||b.amount-a.amount);
}
function cbDivTipEl(){
  let tip=document.getElementById('cb-div-bar-tip');
  if(!tip){
    tip=document.createElement('div');
    tip.id='cb-div-bar-tip';
    tip.className='table-float-tip cb-dividend-tip';
    tip.setAttribute('role','tooltip');
    document.body.appendChild(tip);
  }
  return tip;
}
function cbDivBarHover(ev, monthIndex){
  const data=window._cbDivBarData;
  if(!data) return;
  const details=(data.monthDetails&&data.monthDetails[monthIndex])||[];
  const total=(data.monthAmt&&data.monthAmt[monthIndex])||0;
  const tip=cbDivTipEl();
  const showOwner=!_cbDivOwner||_cbDivOwner==='전체';
  const rows=details.length
    ? details.map(d=>{
        const ticker=d.ticker&&d.ticker!==d.title?` <span class="cb-div-tip-ticker">(${cbEsc(d.ticker)})</span>`:'';
        const owner=showOwner
          ? `<span class="cb-div-tip-owner"><i style="background:${cbOwnerColor(d.owner)}"></i>${cbEsc(d.owner||'미지정')}</span>`
          : '';
        return `<div class="cb-div-tip-row${showOwner?' has-owner':''}">${owner}<span class="cb-div-tip-name">${cbEsc(d.title)}${ticker}</span><b>${cbKrw(d.amount)}</b></div>`;
      }).join('')
    : '<div style="opacity:.72">종목별 내역이 없습니다.</div>';
  tip.innerHTML=`<div class="cb-div-tip-title">${monthIndex+1}월 · ${cbKrw(total)}</div>${rows}`;
  tip.style.display='block';
  const rect=tip.getBoundingClientRect();
  let left=ev.clientX+12, top=ev.clientY-rect.height-12;
  if(left+rect.width>window.innerWidth-10) left=ev.clientX-rect.width-12;
  if(top<10) top=ev.clientY+12;
  tip.style.left=Math.max(10,left)+'px';
  tip.style.top=Math.max(10,Math.min(top,window.innerHeight-rect.height-10))+'px';
}
function cbDivBarHide(){
  const tip=document.getElementById('cb-div-bar-tip');
  if(tip) tip.style.display='none';
}
// 월별 배당 캘린더 SVG — Y축 금액 + X축 '월' 라벨
// nowMonth: 올해 예상 그래프일 때 이번 달 번호(0~11). 이번 달부터 남은 달은 빗금으로 그린다 — 단, 올해 값은
// 12달 모두 '과거 지급 패턴 × 현재 보유'의 추정이므로 지난 달을 '받은 금액'이라고 부르지 않는다. -1 이면 구분하지 않는다.
function cbDivCalendarSvg(monthAmt, monthDetails, w, h, nowMonth=-1){
  const upC = (typeof cssVar==='function'?cssVar('--up','#178a52'):'#178a52');
  const maxRaw = Math.max(...monthAmt, 1);
  const step = cbNiceStep(maxRaw/4);
  const maxV = Math.max(step, Math.ceil(maxRaw/step)*step);
  const padL=58, padR=14, padT=18, padB=26;
  const plotW=w-padL-padR, plotH=h-padT-padB;
  const Y=v=> padT + plotH - (v/maxV)*plotH;
  let out='';
  out+=cbAmtGridSvg(cbAxisTicks(0,maxV,step), Y, padL, w-padR, cbDivAxisLab);
  const slot=plotW/12, bw=Math.min(40, slot-12);
  if(nowMonth>=0) out+=`<defs><pattern id="cb-div-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${upC}" fill-opacity=".28"></rect><rect width="3" height="6" fill="${upC}"></rect></pattern></defs>`;
  for(let m=0;m<12;m++){
    const v=monthAmt[m]||0, xc=padL + slot*m + slot/2, yTop=Y(v);
    if(v>0){
      const selected=_cbDivMonthFilter===m;
      const dimmed=_cbDivMonthFilter!=null&&!selected;
      const monthLabel=`${m+1}월 배당 ${cbKrw(v)}${selected?', 선택됨':''}. 선택하면 해당 월 종목 내역을 표시합니다.`;
      out+=`<rect x="${(xc-bw/2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${(padT+plotH-yTop).toFixed(1)}" rx="3" fill="${nowMonth>=0&&m>=nowMonth?'url(#cb-div-hatch)':upC}" opacity="${dimmed?'0.32':'0.88'}" stroke="${selected?'var(--tx)':'transparent'}" stroke-width="${selected?'2':'0'}" style="cursor:pointer" tabindex="0" focusable="true" role="button" aria-label="${cbEsc(monthLabel)}" onfocus="this.setAttribute('stroke','var(--tx)');this.setAttribute('stroke-width','2')" onblur="this.setAttribute('stroke','${selected?'var(--tx)':'transparent'}');this.setAttribute('stroke-width','${selected?'2':'0'}')" onmousemove="cbDivBarHover(event,${m})" onmouseleave="cbDivBarHide()" onclick="cbDivMonthPick(${m})"></rect>`;
      out+=`<text x="${xc.toFixed(1)}" y="${(yTop-5).toFixed(1)}" style="fill:var(--up)" font-size="12" font-weight="700" text-anchor="middle">${cbKrw(v)}</text>`;
    }
    out+=m===nowMonth
      ? `<text x="${xc.toFixed(1)}" y="${h-8}" style="fill:var(--acc)" font-size="12" font-weight="800" text-anchor="middle">${m+1}월 · 이번 달</text>`
      : `<text x="${xc.toFixed(1)}" y="${h-8}" style="fill:var(--lab)" font-size="12" text-anchor="middle">${m+1}월</text>`;
  }
  // 균일 스케일(meet) + width:100%/height:auto 로 종횡비 유지 → 텍스트가 가로로 늘어나지 않는다.
  const annual=monthAmt.reduce((sum,value)=>sum+(Number(value)||0),0);
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:auto" role="group" aria-label="월별 배당 캘린더. 연간 합계 ${cbEsc(cbKrw(annual))}. 배당이 있는 달을 선택해 종목별 내역을 확인할 수 있습니다."><title>월별 배당 캘린더 · 연간 합계 ${cbEsc(cbKrw(annual))}</title>${out}</svg>`;
}
function cbRenderDiv(){
  cbEnsureDivHist();
  const el = document.getElementById('cb-divm'); if(!el) return;
  const ownerF = (_cbDivOwner && _cbDivOwner!=='전체') ? _cbDivOwner : null;
  const netBasis = _cbDivBasis==='net';
  const allRows = cbAllRows().filter(r=>cbDivOf(r.i));
  let rows = ownerF ? allRows.filter(r=>r.i.owner===ownerF) : allRows;

  // 세후 계산은 계좌 단위 세율이 필요하므로 다계좌 취합 '전' 행으로 배분한다.
  // 소유주별 금융소득 게이지는 소유주 필터와 무관하게 가구 전체를 보여준다.
  const divKeyOf = r => r.i.owner + '::' + cbStrip(r.i.tkr);
  const alloc = cbDivTaxAllocate(allRows.map(r=>({
    owner:r.i.owner, acc:r.i.acc, gross:cbDivIncomeKRW(r.i), key:divKeyOf(r)
  })));
  const netByKey = new Map();
  alloc.list.forEach(e=>{
    const cur = netByKey.get(e.key) || {gross:0, net:0, tax:0};
    cur.gross+=e.gross; cur.net+=e.net; cur.tax+=e.tax;
    netByKey.set(e.key, cur);
  });

  // 같은 소유주+티커(다계좌) 취합
  const merged = new Map();
  rows.forEach(r=>{
    const key = divKeyOf(r);
    const lot={owner:r.i.owner,acc:r.i.acc,qty:(r.i.qty||0)};
    if (merged.has(key)){ const m = merged.get(key); m.qty += lot.qty; m.cost += r.cost; m.taxLots.push(lot); if(r.i.acc) m.accts.add(r.i.acc); }
    else merged.set(key, { key, i:r.i, cl:r.cl, cls:r.cls, title:r.title, tkr:r.tkr, chip:r.chip, qty:lot.qty, cost:r.cost, idx:r.idx, accts:new Set(r.i.acc?[r.i.acc]:[]), taxLots:[lot] });
  });
  const list = cbSortDividendRows(Array.from(merged.values()).map(m=>{
    const d = cbDivOf(m.i);
    const grossKRW = d.annualDps * m.qty * cbRate(d.cur || m.i.cur);
    const tx = netByKey.get(m.key) || {gross:grossKRW, net:grossKRW, tax:0};
    const netKRW = tx.net;
    const growth = cbDivGrowthInfo(m.i);
    const g = growth.value;
    const rate = cbRate(m.i.cur);
    const avgNative = (m.qty>0 && rate>0) ? m.cost/(m.qty*rate) : cbAvgNative(m.i);
    const accountInfos=Array.from(m.accts.size?m.accts:new Set([m.i.acc])).map(acc=>cbDivTaxInfo(acc));
    const taxTip=Array.from(new Set(accountInfos.map(info=>info.label))).join(' · ');
    const taxZeroLabel=Array.from(new Set(accountInfos.map(info=>info.type==='연금'?'과세이연':info.type==='ISA'?'공제 적용':'비과세'))).join('·');
    // incomeKRW 는 현재 표시 기준을 따른다 — 캘린더·TOP3·집중도가 모두 이 값을 쓴다.
    const incomeKRW = netBasis ? netKRW : grossKRW;
    const netRatio = grossKRW>0 ? netKRW/grossKRW : 1;
    return { ...m, d, incomeKRW, grossKRW, netKRW, taxKRW:tx.tax, taxTip, taxZeroLabel, netRatio, g, growth, avgNative,
      yoc: avgNative>0 ? (d.annualDps*(netBasis?netRatio:1))/avgNative*100 : null };
  }));

  const divAnnual = list.reduce((s,x)=>s+x.incomeKRW,0);
  const divCost = list.reduce((s,x)=>s+x.cost,0) || 1;
  // 평균 배당성장률 — 배당 이력으로 CAGR 이 산출된 종목만 배당수입 가중평균한다.
  // (전체 배당수입으로 나누면 이력이 없는 종목이 분모만 키워 0쪽으로 희석된다)
  const gList = list.filter(x=>x.g!=null);
  const rawHistoryList = list.filter(x=>x.growth.status!=='missing');
  const insufficientHistoryList = list.filter(x=>x.growth.status==='insufficient');
  const missingHistoryList = list.filter(x=>x.growth.status==='missing');
  const gBase = gList.reduce((s,x)=>s+x.incomeKRW,0);
  const avgG = gBase>0 ? gList.reduce((s,x)=>s+x.g*x.incomeKRW,0)/gBase : null;
  const growthHistoryTip = [
    `성장률 산출 ${gList.length}종목.`,
    insufficientHistoryList.length
      ? `원본 이력은 있으나 완결연도 2개 미만: ${insufficientHistoryList.map(x=>x.title||x.tkr).join(', ')}.`
      : '',
    missingHistoryList.length
      ? `원본 이력 조회 미확보: ${missingHistoryList.map(x=>x.title||x.tkr).join(', ')}.`
      : ''
  ].filter(Boolean).join(' ');
  const top3Div = [...list].sort((a,b)=>b.incomeKRW-a.incomeKRW).slice(0,3);
  const top3DivShare = divAnnual>0
    ? top3Div.reduce((s,x)=>s+x.incomeKRW,0)/divAnnual*100
    : 0;

  // 조회 연도 목록 (배당 이력 연도 + 올해)
  const nowY = String(new Date().getFullYear());
  const raw = window._divHistoryRawCache || {};
  const yrSet = new Set([nowY]);
  list.forEach(x=>{ const h=raw[cbStrip(x.i.tkr)]; if(h&&Array.isArray(h.events)) h.events.forEach(ev=>{ const y=String(ev.date||'').slice(0,4); if(/^\d{4}$/.test(y)) yrSet.add(y); }); });
  const years = Array.from(yrSet).sort((a,b)=>b.localeCompare(a));
  const year = (_cbDivYear && years.includes(_cbDivYear)) ? _cbDivYear : nowY;
  const cal = cbDivMonthlyForYear(list, year, netBasis);
  // 올해 예상 그래프에서만 이번 달 위치를 표시한다(지난 연도는 지급 이력 재구성, 내년은 전부 앞으로라 구분할 것이 없다).
  const divNowMonth = (!cal.actual && year===nowY) ? new Date().getMonth() : -1;
  const calTotal = cal.monthAmt.reduce((s,v)=>s+v,0);
  const upcomingDividends=cbUpcomingDividendSchedule(list,90);
  const upcomingDividendTotal=upcomingDividends.reduce((s,x)=>s+x.amount,0);
  const upcomingDividendShown=upcomingDividends.slice(0,8);
  window._cbDivBarData = { monthAmt:cal.monthAmt, monthDetails:cal.monthDetails };
  const selectedDetails = _cbDivMonthFilter==null ? null : (cal.monthDetails[_cbDivMonthFilter]||[]);
  const selectedTickers = selectedDetails ? new Set(selectedDetails.map(d=>cbStrip(d.ticker||d.title))) : null;
  const visibleList = selectedTickers
    ? list.filter(x=>selectedTickers.has(cbStrip(x.tkr||x.title)))
    : list;

  // 소유주 버튼·표시 기준·조회 연도는 메인 제목 라인(글로벌 헤더) 우측으로
  const basisLabel = netBasis ? '세후' : '세전';
  const divRuleRate=_taxRuleValue('dividend.generalWithholdingCombinedRate',0.154,year);
  const isaRuleRate=_taxRuleValue('isa.separateTaxCombinedRate',0.099,year);
  const isaRuleExempt=_taxRuleValue('isa.generalExemptionKrw',2_000_000,year);
  const divTaxTip=`${year}년 규칙 기준입니다. 일반계좌 원천징수 ${(divRuleRate*100).toFixed(1)}%, ISA는 유지기간 전체 순소득에서 ${Math.round(isaRuleExempt).toLocaleString()}원 공제 후 초과분 ${(isaRuleRate*100).toFixed(1)}%를 정산합니다. 화면 ISA 세액은 연간 현금흐름 참고치이며, 연금·IRP는 계좌 안에서 과세이연으로 계산합니다.`;
  cbSetHead(
    `<span data-tip="Yield on Cost — 내 평단가 대비 연간 배당금 비율. 배당성장 + 장기보유의 효과를 보여줍니다.">YoC</span>는 평단가(가중평균) 기준 · 현재 <b>${basisLabel}</b> 표시`,
    `<div class="owner-tabs" style="display:inline-flex;gap:3px">
       <button class="owner-btn${netBasis?'':' active'}" data-div-basis="gross" onclick="cbDivBasis('gross')" aria-pressed="${!netBasis}">세전</button>
       <button class="owner-btn${netBasis?' active':''}" data-div-basis="net" onclick="cbDivBasis('net')" aria-pressed="${netBasis}">세후</button>
     </div>
     ${cbOwnerBtns(_cbDivOwner,'cbDivOwner')}
     <label style="display:flex;align-items:center;gap:6px;font-size:var(--fs-cap);color:var(--lab);font-weight:600">연도
       <select class="cb-input" data-div-year="1" onchange="cbDivYear(this.value)" style="padding:6px 9px">${years.map(y=>`<option value="${y}" ${y===year?'selected':''}>${y}년</option>`).join('')}</select>
     </label>`
  );
  el.innerHTML = `
    <div class="cb-div-summary-grid">
      <div class="cb-panel cb-div-summary-card"><div class="cb-div-summary-head"><div class="cb-div-summary-title">연간 배당 수입</div></div><div class="cb-div-summary-value" style="color:var(--up)">${cbDisp(divAnnual)}</div></div>
      <div class="cb-panel cb-div-summary-card"><div class="cb-div-summary-head"><div class="cb-div-summary-title">월평균</div></div><div class="cb-div-summary-value">${cbDisp(divAnnual/12)}</div></div>
      <div class="cb-panel cb-div-summary-card"><div class="cb-div-summary-head"><div class="cb-div-summary-title">평균 <span data-tip="배당 지급 종목 전체의 매입원가 대비 배당수입 비율">YoC</span></div></div><div class="cb-div-summary-value">${(divAnnual/divCost*100).toFixed(2)}%</div></div>
      <div class="cb-panel cb-div-summary-card">
        <div class="cb-div-summary-head"><div class="cb-div-summary-title">평균 <span data-tip="지급 종목들의 주당 배당금 연평균 성장률(CAGR)을 배당수입 비중으로 가중평균한 값. 완결연도 배당 이력이 2개 이상인 종목만 계산에 포함합니다.">배당성장률</span></div>
        <div class="cb-div-history-status" data-tip="${cbEsc(growthHistoryTip)}">${avgG==null&&rawHistoryList.length===0?'이력 조회 중':`산출 ${gList.length}/${list.length} · 원본 ${rawHistoryList.length}/${list.length}`}</div></div>
        <div class="cb-div-summary-value" style="${avgG==null?'color:var(--lab)':cbUpDn(avgG)}">${avgG==null?'—':(avgG>=0?'+':'')+avgG.toFixed(1)+'%'}</div>
      </div>
      <div class="cb-panel cb-div-summary-card">
        <div class="cb-div-summary-head"><div class="cb-div-summary-title"><span data-tip="연간 예상 배당금 중 배당 수입이 큰 상위 3개 종목이 차지하는 비중입니다. 낮을수록 배당원이 잘 분산되어 있습니다.">배당 집중도</span></div>
        <div class="cb-div-history-status">상위 3종목 합계</div></div>
        <div class="cb-div-summary-value">${top3DivShare.toFixed(1)}%</div>
      </div>
      <div class="cb-panel cb-div-summary-card cb-div-top3-card">
        <div class="cb-div-summary-title"><span data-tip="연간 예상 배당 수입 기여도가 큰 상위 3개 종목과 각 종목의 배당 수입 비중입니다.">상위 배당원 TOP 3</span></div>
        <div class="cb-div-top3-list">
          ${top3Div.map((x,rank)=>{
            const label=[ownerF?'':x.i.owner, x.title||'종목명 미확인'].filter(Boolean).join(' · ');
            const share=divAnnual>0?x.incomeKRW/divAnnual*100:0;
            return `<div class="cb-div-top3-row">
              <span class="cb-div-top3-rank">${rank+1}</span>
              <span class="cb-div-top3-name cb-tip-block" data-overflow-tip="${cbEsc(label)}" data-overflow-watch>${cbEsc(label||'—')}</span>
              <span class="cb-div-top3-metrics"><b>${cbDisp(x.incomeKRW)}</b><span>(${share.toFixed(1)}%)</span></span>
            </div>`;
          }).join('') || '<div style="font-size:var(--fs-cap);color:var(--dim)">배당 종목 없음</div>'}
        </div>
      </div>
    </div>
    <div class="cb-panel cb-fin-income-panel">
      <div class="fin-section-head">
        <span><span data-tip="실제 기준은 개인별 과세대상 이자·배당 합계입니다. 이 화면은 앱에 입력된 일반계좌 배당만 집계하므로 법적 대상 판정이 아닌 부분 근접도입니다.">입력된 일반계좌 배당 기준 금융소득 근접도</span> <span style="color:var(--dim);font-weight:500">· 소유주별 · 부분 집계</span></span>
        <small>기준 ${cbDisp(CB_FIN_INCOME_THRESHOLD)} · 이 앱에 없는 예적금 이자는 미포함</small>
      </div>
      <div class="cb-fin-income-grid">
        ${alloc.owners.filter(o=>o.gross>0).sort((a,b)=>OWNERS.indexOf(a.owner)-OWNERS.indexOf(b.owner)).map(o=>{
          const pct=Math.min(100,o.comprehensivePct);
          const over=o.comprehensiveOver>0;
          const near=!over&&o.comprehensivePct>=80;
          return `<div class="cb-fin-income-card${over?' is-over':near?' is-near':''}">
            <div class="cb-fin-income-head"><b><i style="background:${cbOwnerColor(o.owner)}"></i>${cbEsc(o.owner)}</b><span>${o.comprehensivePct.toFixed(0)}%</span></div>
            <div class="cb-fin-income-track"><i style="width:${pct}%"></i></div>
            <div class="cb-fin-income-meta">일반 ${cbDisp(o.general)}${o.isa>0?` · ISA ${cbDisp(o.isa)}`:''}${o.pension>0?` · 연금 ${cbDisp(o.pension)}`:''}</div>
            <div class="cb-fin-income-note">${over?`⚠ 입력 배당만으로 기준 초과 ${cbDisp(o.comprehensiveOver)} — 전체 금융소득 확인 필요`:near?'입력 배당이 기준에 근접했습니다 — 전체 금융소득을 확인하세요.':`입력 배당 기준 잔여 ${cbDisp(Math.max(0,CB_FIN_INCOME_THRESHOLD-o.general))}`}</div>
          </div>`;
        }).join('') || '<div class="fin-empty">배당 지급 종목이 없습니다.</div>'}
      </div>
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px 8px">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        <span class="cb-panel-title">${year}년 월별 배당 캘린더 · ${basisLabel} ${cal.actual?`<span style="color:var(--up)" data-tip="과거 주당 지급 이력에 현재 보유수량·계좌 세제·현재 환율을 적용한 재구성 값입니다.">· 지급 이력 기반 ${cal.coverage.covered}/${cal.coverage.total}</span>`:'<span style="color:var(--dim)">· 예상</span>'}</span>
        ${divNowMonth>=0?'<span class="cb-div-hatch-legend"><i aria-hidden="true"></i>이번 달부터 남은 달 · 12달 모두 추정</span>':''}
        <span style="margin-left:auto;font-size:var(--fs-cap);color:var(--mut)">${year}년 합계 <b style="color:var(--up)">${cbDisp(calTotal)}</b></span>
      </div>
      <div class="cb-chart-scroll">${cbDivCalendarSvg(cal.monthAmt, cal.monthDetails, 1100, 300, divNowMonth)}</div>
    </div>
    <div class="cb-div-detail-grid">
    <div class="cb-panel cb-table-panel cb-div-history-panel" style="padding:14px 16px">
      <div class="cb-div-table-toolbar" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="cb-panel-title">배당 종목 내역</span>
        ${_cbDivMonthFilter!=null?`<button class="cb-btn" onclick="cbDivMonthPick(${_cbDivMonthFilter})" style="margin-left:auto;padding:4px 9px;font-size:var(--fs-cap)">${_cbDivMonthFilter+1}월 ${cal.actual?'지급':'예상'} 종목 · 전체 보기 ×</button>`:''}
      </div>
      <!-- 칸 폭은 .cb-div-head/.cb-div-row 격자(workspace-ui.css)가 정한다 — 한 칸만 flex:1 이고 나머지가 고정 폭이면
           표가 1110px 를 넘어 오른쪽 세 칸(배당성장·주기·배당락)이 화면 밖으로 밀렸다. 머리글 '종목'은 국기 칸부터 두 칸을 덮는다. -->
      <div class="cb-thead cb-div-head">
        <span>${cbSortBtn('div','owner','소유주','text')}</span><span class="cb-div-c-name">${cbSortBtn('div','name','종목','text')}</span><span class="r">${cbSortBtn('div','income',`연간 수입 · ${basisLabel}`)}</span><span class="r cb-mobile-secondary">${cbSortBtn('div','tax',`<span data-tip="${cbEsc(divTaxTip)}">배당세</span>`)}</span><span class="r">${cbSortBtn('div','qty','보유 주수')}</span><span class="r cb-mobile-secondary">${cbSortBtn('div','dps','<span data-tip="정렬은 원화 환산 기준">주당 배당(연)</span>')}</span><span class="r">${cbSortBtn('div','share','<span data-tip="현재 선택된 소유주의 연간 예상 배당 수입에서 해당 종목이 차지하는 비중">배당 비중</span>')}</span><span class="r cb-mobile-secondary">${cbSortBtn('div','yld','<span data-tip="현재 주가 대비 연간 배당금 비율">시가수익률</span>')}</span><span class="r cb-mobile-secondary">${cbSortBtn('div','yoc','<span data-tip="Yield on Cost — 평단가 대비 배당수익률">YoC</span>')}</span><span class="r cb-mobile-secondary">${cbSortBtn('div','growth','<span data-tip="배당 이력 기준 주당 배당금 연평균 성장률(CAGR)">배당성장</span>')}</span><span class="r cb-mobile-secondary">${cbSortBtn('div','cycle','주기','text')}</span><span class="r cb-mobile-secondary">${cbSortBtn('div','ex','<span data-tip="이 날짜 전까지 매수해야 다음 배당을 받을 수 있는 기준일">배당락</span>','text')}</span>
      </div>
      ${cbSortRows('div',visibleList,{
        owner:x=>cbOwnerRank(x.i.owner), name:x=>x.title||'', income:x=>x.incomeKRW, share:x=>x.incomeKRW, tax:x=>x.taxKRW,
        qty:x=>Number(x.qty)||0, dps:x=>(Number(x.d.annualDps)||0)*cbRate(x.d.cur||x.i.cur), yld:x=>x.d.yldNum??null,
        yoc:x=>x.yoc, growth:x=>x.g, cycle:x=>x.d.cycle&&x.d.cycle!=='-'?x.d.cycle:null, ex:x=>x.d.exDiv&&x.d.exDiv!=='-'?x.d.exDiv:null,
      }).map(x=>`
        <div class="cb-div-row">
          <span>${cbOwnerTag(x.i.owner)}</span>
          <span class="cb-div-c-flag">${cbFlagSvg(x,15)}</span>
          <div class="cb-div-c-asset">
            <span class="cb-asset-inline cb-tip-block" data-overflow-tip="${cbEsc([x.title,x.tkr].filter(Boolean).join(' · '))}">
              <span class="cb-asset-name" data-overflow-watch>${cbEsc(x.title)}</span>
              ${x.tkr?`<span class="cb-asset-ticker" data-overflow-watch>${cbEsc(x.tkr)}</span>`:''}
            </span>
          </div>
          <span class="r b">${cbDisp(x.incomeKRW)}</span>
          <span class="cb-num cb-mobile-secondary r cap" style="${x.taxKRW>0?'color:var(--dn)':'color:var(--lab)'}" data-tip="${cbEsc(Array.from(x.accts).join('+')||'계좌 미지정')} · ${cbEsc(x.taxTip)}">${x.taxKRW>0?'−'+cbDisp(x.taxKRW):cbEsc(x.taxZeroLabel)}</span>
          <span class="cb-num r cap sb">${Number(x.qty||0).toLocaleString(undefined,{maximumFractionDigits:4})}주</span>
          <span class="cb-num cb-mobile-secondary r cap">${cbFmtNative(x.d.annualDps, x.d.cur||x.i.cur)}</span>
          <span class="r b mut">${divAnnual>0?(x.incomeKRW/divAnnual*100).toFixed(1)+'%':'—'}</span>
          <span class="cb-mobile-secondary r sb">${(x.d.yldNum||0).toFixed(2)}%</span>
          <span class="cb-mobile-secondary r cb-div-c-yoc">${x.yoc!=null?x.yoc.toFixed(2)+'%':'—'}</span>
          <span class="cb-mobile-secondary r b" ${x.g==null?`data-tip="${cbEsc(x.growth.status==='insufficient'
            ? `원본 배당 이력 ${x.growth.events}건 확보. 완결연도 ${x.growth.years}개로 성장률 산출에는 2개 이상이 필요합니다.`
            : '배당 원본 이력을 아직 확보하지 못했습니다.')}"`:''} style="${x.g!=null?cbUpDn(x.g):'color:var(--lab)'}">${x.g!=null?(x.g>=0?'+':'')+x.g.toFixed(1)+'%':'—'}</span>
          <span class="cb-mobile-secondary r cap mut">${x.d.source==='naver'&&(!x.d.cycle||x.d.cycle==='-')?'<span data-tip="네이버 증권에서 연간 배당금만 확인한 종목입니다. 지급 주기·지급월은 받지 못해 분기 지급으로 가정해 나눴습니다.">추정</span>':cbEsc(x.d.cycle||'—')}</span>
          <span class="cb-mobile-secondary r cap mut cb-div-c-ex">${cbEsc(x.d.exDiv||'—')}</span>
        </div>`).join('') || '<div style="padding:20px;text-align:center;color:var(--dim);font-size:var(--fs-cap)">배당 지급 종목이 없거나 배당 정보를 아직 불러오지 못했습니다.</div>'}
    </div>
    <div class="cb-panel cb-div-upcoming-card">
      <div class="cb-insight-title">향후 90일 배당 일정</div>
      <div class="cb-div-upcoming-total"><span>예상 수입 합계</span><b>${cbDisp(upcomingDividendTotal)}</b></div>
      <div class="cb-div-upcoming-list">
        ${upcomingDividendShown.map(x=>{
          const label=[x.ticker,x.title].filter(Boolean).join(' · ');
          return `<div class="cb-div-upcoming-row">
            <div class="cb-div-upcoming-date${x.exact?'':' is-estimated'}">${cbEsc(x.dateLabel)}</div>
            <div class="cb-div-upcoming-main">
              <span class="cb-div-upcoming-name cb-tip-block" data-overflow-tip="${cbEsc(label)}" data-overflow-watch>${cbEsc(label)}</span>
              <span>${ownerF?'':cbEsc(x.owner)+' · '}${cbDisp(x.amount)}</span>
            </div>
          </div>`;
        }).join('') || '<div class="cb-insight-empty">향후 90일 내 예상 배당이 없습니다.</div>'}
      </div>
      ${upcomingDividends.length>upcomingDividendShown.length?`<div class="cb-insight-more">외 ${upcomingDividends.length-upcomingDividendShown.length}건</div>`:''}
      <div class="cb-div-upcoming-note">과거 지급 패턴과 현재 보유량 기준의 세전 추정입니다. 확정 공시 일정이 아니며 실제 지급일·금액은 달라질 수 있습니다. ‘월 예정’은 기간과 겹치는 달을 포함하므로 일부는 90일 밖에 지급될 수 있습니다.</div>
    </div>
    </div>
    ${typeof assetTaxRuleDisclosureHtml==='function'?assetTaxRuleDisclosureHtml('dividend',year):''}`;
}
function cbDivMonthPick(m){
  const month=Number(m);
  _cbDivMonthFilter=(_cbDivMonthFilter===month?null:month);
  cbDivBarHide();
  cbRenderDiv();
  requestAnimationFrame(()=>document.querySelector('#cb-divm .cb-div-history-panel')?.scrollIntoView({behavior:'smooth',block:'start'}));
}
function cbDivOwner(o){ _cbDivOwner=o; _cbDivMonthFilter=null; cbRenderDiv(); cbRestoreFilterFocus('cb-head-widgets','data-owner',o); }
function cbDivYear(y){ _cbDivYear=y; _cbDivMonthFilter=null; cbRenderDiv(); cbRestoreFilterFocus('cb-head-widgets','data-div-year','1'); }
// 세전/세후 전환 — 카드·캘린더·종목표·TOP3 가 모두 같은 기준을 따른다.
function cbDivBasis(b){ _cbDivBasis = (b==='net'?'net':'gross'); cbDivBarHide(); cbRenderDiv(); cbRestoreFilterFocus('cb-head-widgets','data-div-basis',_cbDivBasis); }
