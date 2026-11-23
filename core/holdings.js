// core/holdings.js — 보유 목록 — 소유주 전환, 보유 목록 표, 추가·수정 창, 매수·매도 창
// (2026-11-23 script.js 에서 그대로 옮겨 나눈 조각. 로드 순서는 index.html·scripts/tests/_source.mjs)
// =============================================
// changeOwner - 메인 렌더링
// =============================================
function changeOwner(owner, btn) {
  currentOwner=owner;
  // 메인 owner 탭(#owner-tabs-container)만 갱신 — cashflow/bubble 등 별도 owner 바의 활성 상태는
  // 사용자가 해당 바 버튼을 직접 클릭했을 때만 변경되도록 격리한다 (수동 새로고침 시 소유주 이동 방지)
  if (btn){document.querySelectorAll('#owner-tabs-container .owner-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');}
  else{document.querySelectorAll('#owner-tabs-container .owner-btn').forEach(b=>{if(b.innerText===owner)b.classList.add('active');else b.classList.remove('active');});}

  // 소유주명 타이틀 반영 (현재 활성 뷰에 따라 타이틀 업데이트)
  const dispOwnerTitle = owner==='전체' ? '통합' : owner;
  const mainTitleEl = document.getElementById('main-title');
  if (mainTitleEl) {
    const activeViewEl = document.querySelector('.view-section.active');
    if (activeViewEl && activeViewEl.id==='view-holdings') mainTitleEl.textContent = dispOwnerTitle + ' 자산 내역';
  }

  // holdings 소유주 필터 동기화
  const hof = document.getElementById('holdings-owner-filter');
  if (hof) hof.value = owner;

  renderPortfolio(owner);
  syncDivHistory();

  // [프리미엄 개선] 버블 차트 자산 마인드맵 동기화
  _bubbleOwner = owner;
  if(typeof renderBubbleChart==='function'){
    const activeView = document.querySelector('.view-section.active');
    if(activeView && activeView.id==='view-bubble') renderBubbleChart('weight');
  }
}

// =============================================
// 포트폴리오 테이블
// =============================================
function makeEditable(el,owner,tkr,field,isCash=false,itemIdx=-1) {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  if(el.querySelector('input')||el.querySelector('select'))return;
  // 인덱스 기반 조회 우선 (중복 티커 지원)
  const item = (itemIdx >= 0 && pfolioData[itemIdx]) ? pfolioData[itemIdx] : pfolioData.find(i=>i.tkr===tkr&&i.owner===owner);
  if(!item)return;
  const originalHTML=el.innerHTML;
  const originalValue=item[field]; // 원래 값 저장 (ESC 복원용)
  const input=document.createElement('input');
  input.type='text';
  input.setAttribute('inputmode','decimal');   // 입력 중 쉼표(전역 처리가 붙는다) — 저장은 쉼표를 뗀다
  input.className='editable-input';
  input.style.cssText='width:'+(isCash?'110px':'80px')+';min-width:60px;max-width:120px;padding:3px 5px;font-size:var(--fs-cap);border:1px solid var(--acc);border-radius:4px;background:var(--modal-bg);color:var(--t1);font-family:var(--font-num);display:inline-block;box-sizing:border-box';
  if(item.grp==='현금'&&field==='qty') input.style.width='110px';
  input.value = (item.grp==='가상화폐'&&field==='avgP') ? Math.round(item.avgP) : item[field];
  let cancelled=false;
  let isSaving=false;
  const save=async()=>{
    if(cancelled||isSaving)return;
    isSaving=true;
    const rawVal=input.value.replace(/,/g,'');
    const newValue=parseFloat(rawVal);
    if(!isNaN(newValue)&&newValue!==originalValue){
      item[field]=newValue;
      if(isCash){item.curP=1;item.avgP=1;}
      // 수량·매입가를 직접 고쳤으면 그 값이 오늘 기준이다 — 이전 분할을 다시 곱하지 않는다.
      if(field==='qty'||field==='avgP') item.splitCheckedAt=finLocalDateKey(new Date());
      syncDivHistory();changeOwner(currentOwner, null);await saveAssetsToKV();
    } else {el.innerHTML=originalHTML;}
  };
  input.onblur=save;
  input.onkeydown=e=>{
    if(e.key==='Enter'){input.blur();}
    if(e.key==='Escape'){
      cancelled=true;
      el.innerHTML=originalHTML; // 원래 표시로 복원 (blur 이후 save 무시됨)
    }
  };
  el.innerHTML='';el.appendChild(input);input.focus();input.select();
}

// 보유 목록 화면 상태 — 자산군 탭·검색·시세 미조회만 보기. 메모리에만 두고 저장하지 않는다.
let _holdingsTab='주식', _holdingsQ='', _holdingsStaleOnly=false;
const HOLDINGS_TABS=['주식','가상화폐','금','현금'];
// 표시 필터 — 행을 숨길 뿐 그룹 합계·숫자 카드 계산에는 영향을 주지 않는다.
function holdingsRowMatches(i){
  if(_holdingsStaleOnly && !i._priceStale) return false;
  const q=(_holdingsQ||'').trim().toLowerCase();
  if(!q) return true;
  return [i.name,i.tkr,i.broker,i.acc,i.owner].some(v=>String(v||'').toLowerCase().includes(q));
}
function setHoldingsTab(g){
  if(!HOLDINGS_TABS.includes(g)) return;
  _holdingsTab=g; renderPortfolio(currentOwner);
  document.querySelector(`#portfolio-tables .holdings-tab[data-grp="${g}"]`)?.focus();
}
function holdingsSearch(v){
  _holdingsQ=String(v||''); renderPortfolio(currentOwner);
  const inp=document.getElementById('holdings-search');
  if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}
function holdingsToggleStale(on){
  _holdingsStaleOnly=!!on; renderPortfolio(currentOwner);
  document.getElementById('holdings-stale-only')?.focus();
}
// opts.kpisOnly: 숫자 카드 HTML 만 돌려준다(계좌별 보기가 같은 카드를 쓴다, 2026-11-19). DOM·상태를 건드리기 전에 돌아가고 계좌 필터는 '전체'로 본다.
function renderPortfolio(owner, opts) {
  const kpisOnly=!!(opts&&opts.kpisOnly);
  const brokerF=kpisOnly?'전체':_holdingsBrokerFilter;
  const items=getFilteredAssets(owner);
  const groups={'주식':[],'가상화폐':[],'금':[],'현금':[]};
  items.forEach(i=>{if(groups[i.grp])groups[i.grp].push(i);});
  // 주식 증권사·계좌 필터: 옵션은 주식 종목에서만 수집
  const stockCombos=[];
  const _stockSeen=new Set();
  groups['주식'].forEach(i=>{
    const key=(i.broker||'')+_BROKER_ACC_SEP+(i.acc||'');
    if(!_stockSeen.has(key)){_stockSeen.add(key);stockCombos.push({broker:i.broker||'',acc:i.acc||'',key});}
  });
  stockCombos.sort((a,b)=>{const br=a.broker.localeCompare(b.broker);return br!==0?br:a.acc.localeCompare(b.acc);});
  if(!kpisOnly&&_holdingsBrokerFilter!=='전체'&&!_stockSeen.has(_holdingsBrokerFilter))_holdingsBrokerFilter='전체';
  const brokerFilterHtml=`<label class="holdings-broker-filter-inline">`
    +`<span>계좌</span>`
    +`<select id="holdings-broker-filter" class="form-input" onchange="applyHoldingsBrokerFilter()">`
    +`<option value="전체"${_holdingsBrokerFilter==='전체'?' selected':''}>전체</option>`
    +stockCombos.map(c=>`<option value="${holdingsEsc(c.key)}"${_holdingsBrokerFilter===c.key?' selected':''}>${holdingsEsc(c.broker||'(미지정)')} / ${holdingsEsc(c.acc||'(미지정)')}</option>`).join('')
    +`</select></label>`;
  let html='',totalPfolioValue=0;
  const grpStats={};
  const _mobileHoldings=typeof isMobileLayout==='function'&&isMobileLayout();
  const showOwner=owner==='전체';
  // [2] 가상화폐 포함 전체 원화 환산
  items.forEach(i=>{
    let val=0;
    if(i.grp==='금'){const gm=i.unit==='돈'?3.75:(i.unit==='kg'?1000:1);val=i.qty*gm*(window._GOLD_G_KRW||i.curP);}
    else{val=i.qty*i.curP*(RATES[i.cur]||1);}
    totalPfolioValue+=val;
  });
  ['주식','가상화폐','금','현금'].forEach(grpName=>{
    let grpItems=groups[grpName];
    // 주식 그룹만 선택된 증권사·계좌 조합으로 필터링
    // 휴대폰에는 계좌 필터가 없으므로 PC 에서 고른 필터가 휴대폰 숫자 카드를 몰래 줄이지 않게 '전체'로 본다
    if(grpName==='주식'&&brokerF!=='전체'&&_holdingsBrokerFilter!=='전체'&&!_mobileHoldings){
      const _si=_holdingsBrokerFilter.indexOf(_BROKER_ACC_SEP);
      const fb=_holdingsBrokerFilter.slice(0,_si),fa=_holdingsBrokerFilter.slice(_si+_BROKER_ACC_SEP.length);
      grpItems=grpItems.filter(i=>(i.broker||'')===fb&&(i.acc||'')===fa);
    }
    // 정렬: 소유주 → 증권사 → 계좌 → 종목명 오름차순 (자산군은 섹션 자체가 분리)
    grpItems.sort((a,b)=>{
      const oa=OWNERS.indexOf(a.owner), ob=OWNERS.indexOf(b.owner);
      const ow=(oa<0?99:oa)-(ob<0?99:ob); if(ow!==0)return ow;
      const br=(a.broker||'').localeCompare(b.broker||'','ko'); if(br!==0)return br;
      const ac=(a.acc||'').localeCompare(b.acc||'','ko'); if(ac!==0)return ac;
      return (a.name||a.tkr||'').localeCompare(b.name||b.tkr||'','ko');
    });
    let grpTotal=0,grpInvest=0,grpKnownTotal=0,grpKnownCount=0,rowsHtml='';
    const colspan=grpName==='현금' ? (showOwner?6:5) : (showOwner?11:10);
    if(grpItems.length===0){rowsHtml=`<tr><td colspan="${colspan}" style="text-align:center;padding:30px;color:var(--t3)">등록된 자산 내역이 없습니다.</td></tr>`;}
    else{
      grpItems.forEach(i=>{
        const _rowStart=rowsHtml.length;
        const _wCls=x=>typeof cbCls==='function'?cbCls(x):'';
        const pIdx=pfolioData.indexOf(i); // 중복 티커 대비 인덱스 기반
        let ownerTag=showOwner?`<td class="text-left holdings-owner-cell"><span class="holdings-owner"><span class="holdings-owner-dot" style="background:${ownerColors[i.owner]||'#8a97b0'}"></span>${holdingsEsc(i.owner||'미지정')}</span></td>`:'';
        const brokerCell=getHoldingsBrokerCellHtml(i);
        let mgmtBtns=`<span class="holdings-actions"><button class="btn-action" type="button" aria-label="${holdingsEsc(i.name||i.tkr||'자산')} 수정" onclick="event.stopPropagation();editItem('','',${pIdx})">✎</button><button class="btn-action holdings-del" type="button" aria-label="${holdingsEsc(i.name||i.tkr||'자산')} 삭제" onclick="event.stopPropagation();deleteItem('','',${pIdx})">✕</button></span>`;

        if(grpName==='현금'){
          // [8] 현금: 정렬, 검정폰트, 클릭편집
          // 환율은 반드시 RATES 를 거친다. 지원 통화가 아니면 1:1 이 되어 평가액이 수백 배 어긋나므로
          // curRateKnown 으로 확인하고, 확인되지 않으면 시세 미확인으로 표시한다.
          const krwRate=RATES[i.cur]||1;
          i._priceStale=!curRateKnown(i.cur);
          const cashKRW=Math.round(i.qty*krwRate);
          const symCur=curSymbol(i.cur);
          const fBal=symCur+(Number(i.qty)||0).toLocaleString();
          const fKRW='₩'+cashKRW.toLocaleString();
          grpTotal+=cashKRW;grpInvest+=cashKRW;
          // [8] 클릭으로 잔액 수정
          const fBalEdit=`<button type="button" class="editable-val editable-val-button" aria-label="잔액 수정" onclick="makeEditable(this,'','','qty',true,${pIdx})">${fBal}</button>`;
          // [9] 자산명 + 통화 배지 나란히
          rowsHtml+=`<tr ${portfolioSortData({...portfolioSortKeys(i),dca:null,valKRW:cashKRW})}>${ownerTag}<td class="text-left holdings-tooltip-cell">${brokerCell}</td><td class="text-left holdings-tooltip-cell">${getHoldingsAssetCellHtml(i.name,i.cur,i)}</td><td style="text-align:right;font-weight:600;color:var(--t1)">${fBalEdit}</td><td class="holdings-val-cell">${fKRW}<!--w:${cashKRW}:cash--></td><td class="mgmt-cell">${mgmtBtns}</td></tr>`;

        } else if(grpName==='금'){
          // [7] 금: g기준 실시간 원화, 헤더 수정
          const gm=i.unit==='돈'?3.75:(i.unit==='kg'?1000:1);
          const goldG=window._GOLD_G_KRW||i.curP;
          const curPKRW=Math.round(goldG*gm);
          const avgPKRW=Math.round(i.avgP);
          const current=i.qty*curPKRW;
          const invest=i.costUnknown?0:i.qty*avgPKRW;
          const {profit, pct:profitPct}=i.costUnknown?{profit:0,pct:0}:calcProfit(current, invest);
          if(!i.costUnknown){grpInvest+=invest;grpKnownTotal+=current;grpKnownCount++;}
          grpTotal+=current;
          const cCls=profit>0?'c-up':(profit<0?'c-dn':''),sign=profit>0?'+':'';
          const fQty=`<button type="button" class="editable-val editable-val-button" aria-label="수량 수정" onclick="makeEditable(this,'','','qty',false,${pIdx})">${(Number(i.qty)||0).toLocaleString()}</button> <span style="font-size:var(--fs-cap);color:var(--t3)">${holdingsEsc(i.unit||'g')}</span>`;
          const fAvg=i.costUnknown?'<span class="cost-unknown-badge">취득가 미상</span>':`₩<button type="button" class="editable-val editable-val-button" aria-label="평균단가 수정" onclick="makeEditable(this,'','','avgP',false,${pIdx})">${avgPKRW.toLocaleString()}</button>`;
          // [7] 현재가 괄호 뒤 제거
          const fCurP='₩'+curPKRW.toLocaleString();
          const fAmt=fmtMoney(current);
          // [7] 수익금에 (₩)
          const fProfit=i.costUnknown?'<span class="cost-unknown-note">산정 제외</span>':(profit<0?'-':'+')+' ₩'+Math.round(Math.abs(profit)).toLocaleString();
          const fProfitPct=i.costUnknown?'<span class="cost-unknown-note">—</span>':sign+profitPct.toFixed(2)+'%';
          rowsHtml+=`<tr ${portfolioSortData({...portfolioSortKeys(i),qty:i.qty,avgP:i.costUnknown?null:avgPKRW,curP:curPKRW,valKRW:current,profit:i.costUnknown?null:profit,profitPct:i.costUnknown?null:profitPct})}>${ownerTag}<td class="text-left holdings-tooltip-cell">${brokerCell}</td><td class="text-left holdings-tooltip-cell">${getHoldingsAssetCellHtml(i.name,'',i,pIdx)}</td><td class="dca-cell">${getDcaMergedCellHtml(i,_mobileHoldings?null:pIdx)}</td><td>${fQty}</td><td>${fAvg}</td><td>${fCurP}</td><td class="holdings-val-cell">${fAmt}<!--w:${current}:${_wCls(i)}--></td><td class="${cCls}">${fProfit}</td><td class="${cCls}">${fProfitPct}</td><td class="mgmt-cell">${mgmtBtns}</td></tr>`;

        } else if(grpName==='가상화폐'){
          // 가상화폐: avgP/curP를 저장통화 기준으로 KRW 환산
          // cur='USD'이면 USD → KRW 변환 (기존 avgP가 KRW로 저장된 경우와 USD로 저장된 경우 모두 처리)
          const _cRate = curRate(i.cur);
          // avgP가 USD 단위라면 환산, KRW 단위라면 그대로 (safeguard: avgP > 1000이고 curP > 100이면 USD 기준 가능성)
          const _avgIsUSD = i.cur==='USD' && i.avgP > 0 && i.avgP < 10000000;
          const avgPKRW = _avgIsUSD ? Math.round(i.avgP * _cRate) : Math.round(i.avgP);
          const curPKRW=Math.round(i.curP * _cRate);
          const current=i.qty*curPKRW;
          const invest=i.qty*avgPKRW;
          const {profit, pct:profitPct}=calcProfit(current, invest);
          grpInvest+=invest;grpKnownTotal+=current;grpKnownCount++;grpTotal+=current;
          const cCls=profit>0?'c-up':(profit<0?'c-dn':''),sign=profit>0?'+':'';
          const fQty=`<button type="button" class="editable-val editable-val-button" aria-label="수량 수정" onclick="makeEditable(this,'','','qty',false,${pIdx})">${(Number(i.qty)||0).toLocaleString(undefined,{maximumFractionDigits:6})}</button> <span style="font-size:var(--fs-cap);color:var(--t3)">개</span>`;
          const fAvg=`₩<button type="button" class="editable-val editable-val-button" aria-label="평균단가 수정" onclick="makeEditable(this,'','','avgP',false,${pIdx})">${avgPKRW.toLocaleString()}</button>`;
          const fCurP='₩'+curPKRW.toLocaleString();
          const fAmt=fmtMoney(current);
          const fProfit=(profit<0?'-':'+')+' ₩'+Math.round(Math.abs(profit)).toLocaleString();
          rowsHtml+=`<tr ${portfolioSortData({...portfolioSortKeys(i),qty:i.qty,avgP:avgPKRW,curP:curPKRW,valKRW:current,profit,profitPct})}>${ownerTag}<td class="text-left holdings-tooltip-cell">${brokerCell}</td><td class="text-left holdings-tooltip-cell">${getHoldingsAssetCellHtml(i.name,i.tkr,i,pIdx)}</td><td class="dca-cell">${getDcaMergedCellHtml(i,_mobileHoldings?null:pIdx)}</td><td>${fQty}</td><td>${fAvg}</td><td>${fCurP}</td><td class="holdings-val-cell">${fAmt}<!--w:${current}:${_wCls(i)}--></td><td class="${cCls}">${fProfit}</td><td class="${cCls}">${sign+profitPct.toFixed(2)}%</td><td class="mgmt-cell">${mgmtBtns}</td></tr>`;

        } else {
          // 주식 (국내/해외)
          const rate=RATES[i.cur]||1;
          const dec=i.cur==='JPY'?1:curMeta(i.cur).cashDecimals;
          const sym=curSymbol(i.cur);
          const invest=i.qty*i.avgP*rate, current=i.qty*i.curP*rate;
          const {profit, pct:profitPct}=calcProfit(current, invest);
          grpInvest+=invest;grpKnownTotal+=current;grpKnownCount++;grpTotal+=current;
          const cCls=profit>0?'c-up':(profit<0?'c-dn':''),sign=profit>0?'+':'';
          const fQty=`<button type="button" class="editable-val editable-val-button" aria-label="수량 수정" onclick="makeEditable(this,'','','qty',false,${pIdx})">${(Number(i.qty)||0).toLocaleString()}</button> <span style="font-size:var(--fs-cap);color:var(--t3)">주</span>`;
          const fAvg=`${sym}<button type="button" class="editable-val editable-val-button" aria-label="평균단가 수정" onclick="makeEditable(this,'','','avgP',false,${pIdx})">${(Number(i.avgP)||0).toLocaleString(undefined,{minimumFractionDigits:dec,maximumFractionDigits:dec})}</button>`;
          const staleTag=i._priceStale?`<span class="price-stale-tag" title="현재가 조회 실패 - 평균단가 기준" style="font-size:var(--fs-cap);background:#F59E0B22;color:#F59E0B;border:1px solid #F59E0B44;padding:1px 4px;border-radius:4px;margin-left:4px">미조회</span>`:'';
          const fCurP=sym+(Number(i.curP)||0).toLocaleString(undefined,{minimumFractionDigits:dec,maximumFractionDigits:dec})+staleTag;
          const fAmt=fmtMoney(current);
          const fProfit=(profit<0?'-':'+')+' ₩'+Math.round(Math.abs(profit)).toLocaleString();
          // [5] 국내주식 티커에 .KS/.KQ 표시 (숫자 + 알파뉴메릭 6자리 모두 지원)
          const tkrStripped=normTkr(i.tkr);
          const isKR=/^[0-9A-Z]{6}$/.test(tkrStripped)&&i.cur==='KRW';
          const dispTkr=isKR?tkrStripped+(i.market==='KOSDAQ'?'.KQ':'.KS'):i.tkr;
          rowsHtml+=`<tr ${portfolioSortData({...portfolioSortKeys(i),qty:i.qty,avgP:i.avgP*rate,curP:i.curP*rate,valKRW:current,profit,profitPct})}>${ownerTag}<td class="text-left holdings-tooltip-cell">${brokerCell}</td><td class="text-left holdings-tooltip-cell">${getHoldingsAssetCellHtml(i.name,dispTkr,i,pIdx)}</td><td class="dca-cell">${getDcaMergedCellHtml(i,_mobileHoldings?null:pIdx)}</td><td>${fQty}</td><td>${fAvg}</td><td>${fCurP}</td><td class="holdings-val-cell">${fAmt}<!--w:${current}:${_wCls(i)}--></td><td class="${cCls}">${fProfit}</td><td class="${cCls}">${sign+profitPct.toFixed(2)}%</td><td class="mgmt-cell">${mgmtBtns}</td></tr>`;
        }
        // 검색·시세 미조회 필터는 행만 숨긴다(합계는 위에서 이미 더했다). 현금은 이 시점에 _priceStale 이 정해진다.
        if(!holdingsRowMatches(i)) rowsHtml=rowsHtml.slice(0,_rowStart);
      });
      if(!rowsHtml) rowsHtml=`<tr><td colspan="${colspan}" style="text-align:center;padding:30px;color:var(--t3)">검색 조건에 맞는 자산이 없습니다.</td></tr>`;
    }
    grpStats[grpName]={count:grpItems.length,total:grpTotal,invest:grpInvest,known:grpKnownTotal,knownCount:grpKnownCount};
    let grpProfit=grpKnownTotal-grpInvest,grpProfitPct=grpInvest>0?(grpProfit/grpInvest)*100:0;
    let gCls=grpProfit>0?'c-up':(grpProfit<0?'c-dn':''),gSign=grpProfit>0?'+':'';
    if(grpName==='현금'||grpItems.length===0){gCls='';gSign='';}
    // 테이블 헤더: 자산군별로 다르게
    let theadHtml='';
    const ownerTh=showOwner?portfolioSortHeader(grpName,'owner','소유주','text-left holdings-owner-head'):'';
    if(grpName==='현금'){
      theadHtml=`<tr>${ownerTh}${portfolioSortHeader(grpName,'acct','증권사 / 계좌','text-left')}${portfolioSortHeader(grpName,'name','종목','text-left holdings-asset-head')}<th>보유금액</th>${portfolioSortHeader(grpName,'valKRW','평가액')}<th class="mgmt-head"><span class="mgmt-head-grid"><span></span><span class="mgmt-head-label">관리</span></span></th></tr>`;
    } else if(grpName==='금'){
      theadHtml=`<tr>${ownerTh}${portfolioSortHeader(grpName,'acct','거래소 / 계좌','text-left')}${portfolioSortHeader(grpName,'name','종목','text-left holdings-asset-head')}${portfolioSortHeader(grpName,'dca','적립식','dca-head')}${portfolioSortHeader(grpName,'qty','수량')}${portfolioSortHeader(grpName,'avgP','평균단가')}${portfolioSortHeader(grpName,'curP','현재가')}${portfolioSortHeader(grpName,'valKRW','평가액')}${portfolioSortHeader(grpName,'profit','평가손익')}${portfolioSortHeader(grpName,'profitPct','수익률')}<th class="mgmt-head"><span class="mgmt-head-grid"><span></span><span class="mgmt-head-label">관리</span></span></th></tr>`;
    } else {
      const brokerLabel=grpName==='가상화폐'?'거래소':'증권사';
      theadHtml=`<tr>${ownerTh}${portfolioSortHeader(grpName,'acct',brokerLabel+' / 계좌','text-left')}${portfolioSortHeader(grpName,'name','종목','text-left holdings-asset-head')}${portfolioSortHeader(grpName,'dca','적립식','dca-head')}${portfolioSortHeader(grpName,'qty','수량')}${portfolioSortHeader(grpName,'avgP','평균단가')}${portfolioSortHeader(grpName,'curP','현재가')}${portfolioSortHeader(grpName,'valKRW','평가액')}${portfolioSortHeader(grpName,'profit','평가손익')}${portfolioSortHeader(grpName,'profitPct','수익률')}<th class="mgmt-head"><span class="mgmt-head-grid"><span></span><span class="mgmt-head-label">관리</span></span></th></tr>`;
    }
    // 주식/가상화폐/금 표 컬럼 폭 동일화: 동일 colgroup + table-layout:fixed → 세 표가 세로로 줄 맞음
    const _isFixed=grpName!=='현금';
    let colgroupHtml='';
    if(_isFixed){
      const ownerCol=showOwner?'<col style="width:6.5%">':'';
      // 순서: [소유주] 증권사/계좌 · 종목 · 적립식 · 수량 · 평균단가 · 현재가 · 평가액 · 평가손익 · 수익률 · 관리
      // 증권사/계좌·종목·적립식은 두 줄(윗줄·아랫줄)이라 한 줄일 때보다 좁아도 잘리지 않는다.
      // 'DCA 주기'·'회당 금액' 두 칸을 '적립식' 한 칸으로 합쳐 얻은 폭을 종목 칸에 준다(15% → 19%).
      // 숫자 글꼴(Manrope)은 한글 글꼴의 숫자보다 넓다 — 평가액 칸은 아랫줄 비중 막대까지 들어가게 둔다.
      const widths=showOwner
        ?['9.5%','19.5%','8%','6%','9%','9.5%','10%','10%','6.5%','5.5%']
        :['12%','21%','8%','6%','9%','9%','12%','9.5%','7%','6.5%'];
      colgroupHtml='<colgroup>'+ownerCol+widths.map(w=>`<col style="width:${w}">`).join('')+'</colgroup>';
    }
    const _fixedCls=_isFixed?' pt-table-fixed':'';
    const grpProfitText=grpItems.length===0||grpName==='현금'?'-':(grpKnownCount===0?'산정 제외':gSign+'₩'+Math.abs(Math.round(grpProfit)).toLocaleString()+' ('+gSign+grpProfitPct.toFixed(2)+'%)');
    // 자산군 탭 — 지금 탭의 표만 보인다. 머리 줄은 더 이상 접고 펴지 않는다(탭이 그 역할).
    html+=`<section class="pt-group holdings-group" id="holdings-panel-${grpName}" role="tabpanel" aria-labelledby="holdings-tab-${grpName}"${grpName===_holdingsTab?'':' hidden'}><div class="pt-group-header f-between"><div class="pt-group-title f-row">${grpName}<span class="holdings-group-count">${grpItems.length}종목</span></div><div class="pt-group-stats f-row"><span>원화 기준 · 총 평가 <strong>₩${Math.round(grpTotal).toLocaleString()}</strong></span><span class="${gCls}">수익 ${grpProfitText}</span></div></div><div class="pt-table-wrap"><table class="pt-table${_fixedCls}" data-grp="${grpName}">${colgroupHtml}<thead>${theadHtml}</thead><tbody>${rowsHtml}</tbody></table></div></section>`;
  });
  // 숫자 카드 — 위 그룹 합계를 더할 뿐 새 계산은 없다. 현금은 평가액에만 들어가고 손익에서 빠진다.
  const sumOf=k=>HOLDINGS_TABS.reduce((t,g)=>t+(grpStats[g]?.[k]||0),0);
  // 평가액 칸 비중: 분모는 아래 '평가액' 숫자 카드와 같은 합계(검색·필터로 숨기기 전), 막대 길이는 가장 큰 평가액 대비.
  {
    const _wTotal=sumOf('total');
    const _wMax=Math.max(0,...Array.from(html.matchAll(/<!--w:([^:>]*):/g),m=>Number(m[1])||0));
    html=html.replace(/<!--w:([^:>]*):([a-z]*)-->/g,(_,v,cls)=>holdingsWeightHtml(Number(v),_wTotal,_wMax,cls));
  }
  const investNonCash=HOLDINGS_TABS.filter(g=>g!=='현금').reduce((t,g)=>t+(grpStats[g]?.invest||0),0);
  const knownNonCash=HOLDINGS_TABS.filter(g=>g!=='현금').reduce((t,g)=>t+(grpStats[g]?.known||0),0);
  const profitAll=knownNonCash-investNonCash;
  const staleCount=items.filter(i=>i._priceStale).length;
  const money=v=>'₩'+Math.round(Math.abs(v)).toLocaleString();
  const kpis=`<div class="holdings-kpis">`
    +`<div class="holdings-kpi"><span>평가액</span><b>${money(sumOf('total'))}</b><small>${items.length}개 자산</small></div>`
    +`<div class="holdings-kpi"><span>매입금액</span><b>${money(investNonCash)}</b><small>현금 제외 · 평균단가 × 수량</small></div>`
    +`<div class="holdings-kpi"><span>평가손익</span><b class="${profitAll>0?'c-up':profitAll<0?'c-dn':''}">${profitAll<0?'-':profitAll>0?'+':''}${money(profitAll)}</b><small>${investNonCash>0?(profitAll>=0?'+':'')+(profitAll/investNonCash*100).toFixed(2)+'% · 매입금액 대비':'매입금액 없음'}</small></div>`
    +`<div class="holdings-kpi${staleCount?' is-warn':''}"><span>시세 미조회</span><b>${staleCount}개</b><small>${staleCount?'직전 값으로 계산 중':'모두 수신'}</small></div>`
    +`</div>`;
  if(kpisOnly) return kpis;
  const tabs=`<div class="holdings-tabs" role="tablist" aria-label="자산군">`
    +HOLDINGS_TABS.map(g=>`<button type="button" role="tab" class="holdings-tab" id="holdings-tab-${g}" data-grp="${g}" aria-controls="holdings-panel-${g}" aria-selected="${g===_holdingsTab}" tabindex="${g===_holdingsTab?0:-1}" onclick="setHoldingsTab('${g}')">${g}<span>${grpStats[g]?.count||0}</span></button>`).join('')
    +`</div>`;
  const toolbar=`<div class="holdings-toolbar">`
    +`<label class="holdings-search"><span class="sr-only">보유 자산 검색</span><input type="search" id="holdings-search" placeholder="종목명·티커·계좌 검색" value="${holdingsEsc(_holdingsQ)}" oninput="holdingsSearch(this.value)"></label>`
    +(_holdingsTab==='주식'?brokerFilterHtml:'')
    +`<label class="holdings-stale-toggle"><input type="checkbox" id="holdings-stale-only"${_holdingsStaleOnly?' checked':''} onchange="holdingsToggleStale(this.checked)">시세 미조회만</label>`
    +`<button type="button" class="holdings-add-btn" onclick="openAddModal('${_holdingsTab}')">＋ ${_holdingsTab} 추가</button>`
    +`</div>`;
  // 휴대폰은 조회 전용 카드 목록이다 — 같은 숫자 카드를 넘겨 그 위에 두고, 탭·목록은 cbAssetMobile 이 그린다
  if(_mobileHoldings&&typeof cbAssetMobile==='function'){cbAssetMobile(kpis);return;}
  document.getElementById('portfolio-tables').innerHTML=kpis+`<div class="holdings-card"><div class="holdings-head">${tabs}${toolbar}</div>${html}</div>`;
  // 머리글 정렬은 다시 그린 표에도 그대로(상태는 화면을 옮길 때만 지운다).
  Object.entries(_sortState).forEach(([g,st])=>applyPortfolioSort(document.getElementById('holdings-panel-'+g)?.querySelector('table'),st));
}


// =============================================
// 자산 추가/수정/삭제 모달
// =============================================
function openAddModal(grp) {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  document.getElementById('edit-mode-owner').value='';
  document.getElementById('edit-mode-tkr').value='';
  document.getElementById('edit-mode-idx').value='';
  document.getElementById('modal-title').innerText=grp+' 자산 추가';
  const srch=document.getElementById('add-search');
  srch.value='';srch.dataset.tkr='';srch.dataset.name='';
  document.getElementById('search-dropdown').style.display='none';
  // 검색 결과 패널 초기화
  const ssr=document.getElementById('stock-search-result');if(ssr)ssr.style.display='none';
  const sse=document.getElementById('stock-search-error');if(sse)sse.style.display='none';
  const ssl=document.getElementById('stock-search-loading');if(ssl)ssl.style.display='none';
  window._stockSearchResult=null;
  document.getElementById('add-qty').value='';
  document.getElementById('add-avgp').value='';
  const unknownCost=document.getElementById('add-cost-unknown');if(unknownCost)unknownCost.checked=false;
  toggleCostUnknown();
  document.getElementById('add-cash-amt').value='';
  const cn=document.getElementById('add-cash-name');if(cn)cn.value='';
  const gn=document.getElementById('add-gold-name');if(gn)gn.value='금';
  document.getElementById('add-dca').checked=false;
  document.getElementById('wrap-dca-detail').style.display='none';
  document.getElementById('add-dca-amt').value='';
  const _amtRdio=document.getElementById('dca-mode-amount');if(_amtRdio)_amtRdio.checked=true;
  const _qtyInp=document.getElementById('add-dca-qty');if(_qtyInp)_qtyInp.value='';
  toggleDcaMode();
  document.getElementById('add-grp').value=grp;
  // [1] 현재 소유주가 특정인이면 소유주 select 고정, 전체면 전체 표시
  const ownerSel=document.getElementById('add-owner');
  if(currentOwner!=='전체'){
    ownerSel.innerHTML=`<option value="${currentOwner}">${currentOwner}</option>`;
  } else {
    ownerSel.innerHTML=OWNERS.map(o=>`<option value="${o}">${o}</option>`).join('');
  }
  const brokerSel=document.getElementById('add-broker'),accSel=document.getElementById('add-account');
  let brokers=[],accs=[];
  if(grp==='주식'){brokers=['증권사 선택','메리츠증권','삼성증권','키움증권','NH투자증권','토스증권','미래에셋증권','기타'];accs=['일반','ISA','연금저축','증여계좌'];}
  else if(grp==='가상화폐'){brokers=['거래소 선택','업비트','빗썸','코인원','바이낸스','기타'];accs=['일반'];}
  else if(grp==='금'){brokers=['기관 선택','KB증권','종로금거래소','한국금거래소','기타'];accs=['금현물','실물보관'];}
  else if(grp==='현금'){brokers=['은행 선택','국민은행','신한은행','하나은행','우리은행','토스뱅크','기타'];accs=['입출금','CMA','파킹통장'];}
  brokerSel.innerHTML=brokers.map(b=>`<option value="${b}">${b}</option>`).join('');
  accSel.innerHTML=accs.map(a=>`<option value="${a}">${a}</option>`).join('');
  const modal=document.getElementById('add-modal');
  window._addModalReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  modal.classList.add('active');
  modal.setAttribute('aria-hidden','false');
  toggleModalFields();
  requestAnimationFrame(()=>document.getElementById('add-search')?.focus());
}
function closeAddModal(){
  const modal=document.getElementById('add-modal');
  if(!modal?.classList.contains('active')) return;
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden','true');
  const returnFocus=window._addModalReturnFocus;
  window._addModalReturnFocus=null;
  if(returnFocus&&document.contains(returnFocus)) returnFocus.focus();
}

function editItem(owner,tkr,idx=-1) {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  // 인덱스 기반 조회 우선 (중복 티커·다계좌 지원)
  const resolvedIdx=(idx>=0&&pfolioData[idx])?idx:pfolioData.findIndex(i=>i.tkr===tkr&&i.owner===owner);
  const item=pfolioData[resolvedIdx];if(!item)return;
  // [2] broker/acc 먼저 세팅 후 openAddModal 호출
  const savedBroker=item.broker, savedAcc=item.acc;
  openAddModal(item.grp);
  document.getElementById('edit-mode-owner').value=owner;
  document.getElementById('edit-mode-tkr').value=tkr;
  document.getElementById('edit-mode-idx').value=resolvedIdx;
  document.getElementById('modal-title').innerText='자산 정보 수정';
  // 소유주 복원
  const ownerSel=document.getElementById('add-owner');
  ownerSel.innerHTML=OWNERS.map(o=>`<option value="${o}">${o}</option>`).join('');
  ownerSel.value=item.owner;
  document.getElementById('add-grp').value=item.grp;
  // [2] broker 복원: select에 없으면 option 추가
  const brokerSel=document.getElementById('add-broker');
  if(![...brokerSel.options].find(o=>o.value===savedBroker)){
    const opt=document.createElement('option');opt.value=savedBroker;opt.text=savedBroker;brokerSel.appendChild(opt);
  }
  brokerSel.value=savedBroker;
  // [2] acc 복원
  const accSel=document.getElementById('add-account');
  if(![...accSel.options].find(o=>o.value===savedAcc)){
    const opt=document.createElement('option');opt.value=savedAcc;opt.text=savedAcc;accSel.appendChild(opt);
  }
  accSel.value=savedAcc;
  // 시장 세팅
  const mkt=(item.market==='KOSPI'||item.market==='KOSDAQ')?'KR':(item.market||'US');
  const mktEl=document.getElementById('add-market');if(mktEl)mktEl.value=mkt;
  const curEl=document.getElementById('add-currency-stock');if(curEl)curEl.value=item.cur||'USD';
  updateAvgpDecimalMode();
  const dec = item.cur === 'JPY' ? 1 : curMeta(item.cur).cashDecimals;
  document.getElementById('add-qty').value=item.qty.toLocaleString();
  const unitSel=document.getElementById('add-unit');
  if(unitSel)unitSel.value=item.unit||'g';
  document.getElementById('add-avgp').value=(Math.round(item.avgP*100)/100||item.avgP).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:dec});
  document.getElementById('add-dca').checked=!!item.dca;
  document.getElementById('add-dca-cycle').value=item.dcaCycle||'매월';
  document.getElementById('add-dca-amt').value=item.dcaAmt||0;
  const dcaCurEl2=document.getElementById('add-dca-cur');
  if(dcaCurEl2)dcaCurEl2.value=item.dcaCur||'KRW';
  // dcaMode / dcaQty 복원
  const savedMode = item.dcaMode || 'amount';
  const modeEl = document.getElementById(savedMode === 'qty' ? 'dca-mode-qty' : 'dca-mode-amount');
  if (modeEl) modeEl.checked = true;
  const qtyEl = document.getElementById('add-dca-qty');
  if (qtyEl) qtyEl.value = item.dcaQty || '';
  // 요일 체크박스 복원
  document.querySelectorAll('.dca-dow').forEach(c=>{
    c.checked=Array.isArray(item.dcaDays)&&item.dcaDays.includes(parseInt(c.value));
  });
  if(document.getElementById('add-dca-day'))document.getElementById('add-dca-day').value=item.dcaDay||1;
  if(item.dca){toggleDcaDay();toggleDcaMode();}
  if(item.grp==='현금'){
    document.getElementById('add-cash-amt').value=item.qty;
    document.getElementById('add-currency').value=item.cur;
    const cashNameEl=document.getElementById('add-cash-name');
    if(cashNameEl)cashNameEl.value=item.name||'';
  }
  toggleModalFields();
  if(item.grp==='금'){
    const goldNameEl=document.getElementById('add-gold-name');
    if(goldNameEl)goldNameEl.value=item.name||'금';
    const unknownCost=document.getElementById('add-cost-unknown');
    if(unknownCost)unknownCost.checked=!!item.costUnknown;
    if(!item.costUnknown) document.getElementById('add-avgp').value=(Math.round(item.avgP*100)/100||item.avgP).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:dec});
    toggleCostUnknown();
  }
  // [2] 종목명/티커 복원: toggleModalFields → onMarketChange 가 srch 를 초기화하므로 반드시 이후에 복원
  const srch=document.getElementById('add-search');
  const tkrStripped=normTkr(item.tkr);
  const isKrTkr=/^[0-9A-Z]{6}$/i.test(tkrStripped)&&item.cur==='KRW';
  const dispTkrEdit=isKrTkr?tkrStripped+(item.market==='KOSDAQ'?'.KQ':'.KS'):item.tkr;
  if(item.grp!=='금'&&item.grp!=='현금'){
    srch.value=item.name+' ('+dispTkrEdit+')';
    srch.dataset.tkr=item.tkr;srch.dataset.name=item.name;srch.dataset.market=mkt;
  }
  if(item.dca){document.getElementById('wrap-dca-detail').style.display='block';document.getElementById('row-qty-price').style.display='none';}
}

function deleteItem(owner,tkr,idx=-1) {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  if(confirm('해당 자산을 삭제하시겠습니까?')){
    // 인덱스 기반 조회 우선 (중복 티커·다계좌 지원)
    if(!(idx>=0&&pfolioData[idx])) idx=pfolioData.findIndex(i=>i.tkr===tkr&&i.owner===owner);
    if(idx>-1){pfolioData.splice(idx,1);syncDivHistory();changeOwner(currentOwner, null);saveAssetsToKV();}
  }
}

function submitAddModal() {
  if (isMobileLayout()) return; // 모바일은 조회 전용

  const ownerMode=document.getElementById('edit-mode-owner').value;
  const tkrMode=document.getElementById('edit-mode-tkr').value;
  const owner=document.getElementById('add-owner').value;
  const grp=document.getElementById('add-grp').value;
  const broker=document.getElementById('add-broker').value;
  const acc=document.getElementById('add-account').value;
  // [3] 시장 정보는 hidden input 또는 검색 dataset에서
  const srch=document.getElementById('add-search');
  const market=srch.dataset.market || document.getElementById('add-market').value || 'US';
  let selectedTkr=srch.dataset.tkr||'';
  let selectedName=srch.dataset.name||'';
  const searchRaw=srch.value.trim();
  if(!selectedTkr&&searchRaw){
    const pm=searchRaw.match(/\(([^)]+)\)$/);
    if(pm){selectedTkr=pm[1];selectedName=searchRaw.replace(/\s*\([^)]+\)$/,'').trim();}
    else{selectedTkr=searchRaw.toUpperCase();selectedName=searchRaw;}
  }
  let qty=parseFloat((document.getElementById('add-qty').value||'').replace(/,/g,''))||0;
  // 단위: 금은 select, 주식=주, 코인=개
  let unit='주';
  if(grp==='금'){unit=document.getElementById('add-unit').value||'g';}
  else if(grp==='가상화폐'){unit='개';}
  const costUnknown=grp==='금'&&!!document.getElementById('add-cost-unknown')?.checked;
  let avgPRaw=parseFloat((document.getElementById('add-avgp').value||'').replace(/,/g,''))||0;
  let cur='KRW';
  if(grp==='현금'){cur=document.getElementById('add-currency').value;}
  else if(grp==='금'){cur='KRW';} // 금은 항상 원화 기준 (이중환율 방지)
  else{const cs=document.getElementById('add-currency-stock');cur=cs?cs.value:(market==='US'||market==='CRYPTO'?'USD':'KRW');}
  // [4] 가상화폐 avgP는 KRW 그대로 저장
  let avgP = avgPRaw;
  if(costUnknown) avgP=0;
  const isDca=document.getElementById('add-dca').checked;
  const dcaCycle=document.getElementById('add-dca-cycle').value;
  const dcaAmt=parseInt((document.getElementById('add-dca-amt').value||'').replace(/,/g,''))||0;
  const dcaCurEl=document.getElementById('add-dca-cur');
  const dcaCur=dcaCurEl?dcaCurEl.value:'KRW';
  const dcaMode=document.querySelector('input[name="dca-mode"]:checked')?.value||'amount';
  const dcaQty=parseFloat((document.getElementById('add-dca-qty').value||'').replace(/,/g,''))||0;
  const dcaDays=dcaCycle==='매주'?Array.from(document.querySelectorAll('.dca-dow:checked')).map(c=>parseInt(c.value)):[];
  const dcaDayVal=dcaCycle==='매월'?parseInt(document.getElementById('add-dca-day').value)||1:undefined;
  if(grp==='현금'){qty=parseFloat((document.getElementById('add-cash-amt').value||'').replace(/,/g,''))||0;unit='';avgP=1;}
  if(!searchRaw&&grp!=='현금'&&grp!=='금'){alert('종목명을 입력하세요.');return;}
  let tkr=selectedTkr||searchRaw.toUpperCase();
  let name=selectedName||searchRaw;
  // 시장 저장: KR → KOSPI로 저장 (price.ts 호환)
  let savedMarket=market;
  if(market==='KR'){savedMarket='KOSPI';}
  if(grp==='현금'){
    tkr=cur+'_'+Date.now();  // 중복 방지용 유니크 키
    // 자산명: 입력값 우선, 없으면 기본값
    const cashName=document.getElementById('add-cash-name');
    name=(cashName&&cashName.value.trim())||name||cur+' 예수금';
    // 수정 모드에서는 기존 tkr 유지
    if(ownerMode&&tkrMode)tkr=tkrMode;
  }
  if(grp==='금'){
    tkr=(ownerMode&&tkrMode)?tkrMode:'GOLD_'+Date.now();
    const goldName=document.getElementById('add-gold-name');
    name=(goldName&&goldName.value.trim())||'금';
    savedMarket='GOLD';
  }
  const editingItem=(ownerMode&&tkrMode)?pfolioData.find(i=>i.tkr===tkrMode&&i.owner===ownerMode):null;
  const goldUnitFactor=unit==='돈'?3.75:(unit==='kg'?1000:1);
  const initialCurP=costUnknown
    ? ((editingItem&&editingItem.curP>0)?editingItem.curP:(window._GOLD_G_KRW||0)*goldUnitFactor)
    : avgP;
  // splitCheckedAt: 사용자가 지금 값을 입력했으므로 오늘이 분할 기준일이다. 빠뜨리면
  // 수정할 때마다 기준일이 사라져 등록 전 분할까지 자동 반영 대상이 된다.
  const newData={grp,owner,broker,acc,name,tkr,qty,unit,avgP,curP:initialCurP,cur,market:savedMarket,costUnknown,dca:isDca,dcaCycle,dcaAmt,dcaCur,dcaMode,dcaQty,dcaDays,dcaDay:dcaDayVal,splitCheckedAt:finLocalDateKey(new Date())};
  if(ownerMode&&tkrMode){
    // 수정 모드: 편집 시작 시 기록한 인덱스를 owner/tkr로 재검증 후 사용, 무효하면 폴백
    const savedIdx=parseInt(document.getElementById('edit-mode-idx').value);
    const idx=(Number.isInteger(savedIdx)&&pfolioData[savedIdx]&&pfolioData[savedIdx].tkr===tkrMode&&pfolioData[savedIdx].owner===ownerMode)
      ?savedIdx
      :pfolioData.findIndex(i=>i.tkr===tkrMode&&i.owner===ownerMode);
    if(idx>-1)pfolioData[idx]=newData;
  }
  else pfolioData.push(newData);
  syncDivHistory();changeOwner(currentOwner, null);closeAddModal();saveAssetsToKV();
}



// =============================================
// 매수·매도 입력 — 보유 목록에서 종목명을 누르면 열린다
// =============================================
// 수량·평균단가만 바꾼다(예수금은 건드리지 않는다 — 수수료·세금·환전 때문에 실제 잔액과 어긋난다).
// 주식 매도는 세금·증여 > 실현손익 기록에 한 줄을 남긴다. 가상화폐·금 매도는 남기지 않는다
// (그 화면은 주식 양도세 계산이라 넣으면 해외주식 22%로 잘못 계산된다).
// 해외 종목의 실현손익은 자동 계산하지 않는다 — 매수 당시 환율 기록이 없어 원화 금액을 알 수 없다(사용자 결정).
function tradeApplyPlan(item, t){
  const fail=error=>({ok:false,error});
  if(!item||!['주식','가상화폐','금'].includes(item.grp)) return fail('매수·매도를 입력할 수 없는 자산입니다.');
  const side=t&&t.side==='sell'?'sell':'buy';
  const qty=Number(t&&t.qty), price=Number(t&&t.price);
  const date=String((t&&t.date)||''), today=String((t&&t.today)||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('거래일을 선택하세요.');
  if(today&&date>today) return fail('미래 날짜는 입력할 수 없습니다.');
  if(!Number.isFinite(qty)||qty<=0) return fail('수량을 입력하세요.');
  const held=Number(item.qty)||0, avg=Number(item.avgP)||0;
  const r8=v=>Math.round(v*1e8)/1e8;
  if(side==='buy'){
    if(item.costUnknown) return fail('취득가 미상 자산은 평균단가를 계산할 수 없습니다. ✎ 수정에서 직접 고쳐 주세요.');
    if(!Number.isFinite(price)||price<=0) return fail('매수 단가를 입력하세요.');
    const nextQty=r8(held+qty);
    return {ok:true,side,next:{qty:nextQty,avgP:(held*avg+qty*price)/nextQty},remove:false,pl:null};
  }
  if(qty>held+1e-9) return fail('보유 수량보다 많이 팔 수 없습니다.');
  const nextQty=r8(held-qty), remove=nextQty<=1e-9;
  let pl=null;
  // skipPl: 같은 매도를 실현손익 기록에 이미 적어 둔 경우(세금 화면 직접 입력·거래내역 가져오기) — 보유 수량만 줄이고 새 줄을 만들지 않는다
  if(item.grp==='주식'&&!(t&&t.skipPl)){
    const domestic=item.cur==='KRW';
    const typed=(t.realizedKrw===''||t.realizedKrw==null)?NaN:Number(t.realizedKrw);
    let amt;
    if(Number.isFinite(typed)) amt=typed;
    else if(domestic&&Number.isFinite(price)&&price>0) amt=(price-avg)*qty;
    else return fail(domestic?'매도 단가 또는 실현손익을 입력하세요.':'해외 종목은 증권사 앱의 실현손익(원화)을 직접 입력하세요.');
    if(!OWNERS.includes(item.owner)) return fail('소유주가 지정되지 않은 자산입니다.');
    const accType=getAccountDivTaxInfo(item.acc).type;
    const account=!domestic?'일반':accType==='ISA'?'ISA':accType==='연금'?'연금저축':'일반';
    const ruleSetId=typeof assetTaxRulesFor==='function'?(assetTaxRulesFor(date.slice(0,4))?.id||''):'';
    const memo=`${item.name||item.tkr||'종목'} ${qty.toLocaleString(undefined,{maximumFractionDigits:8})}${item.unit||'주'} 매도`
      +(Number.isFinite(price)&&price>0?` @${price.toLocaleString(undefined,{maximumFractionDigits:4})}`:'');
    pl={id:Number(t.id)||Date.now(),month:date.slice(0,7),amt:Math.round(amt),memo:memo.slice(0,240),owner:item.owner,category:domestic?'domestic':'foreign',account,ruleSetId};
  }
  return {ok:true,side,next:{qty:remove?0:nextQty,avgP:avg},remove,pl};
}
let _tradeItem=null,_tradeSide='buy',_tradePlTouched=false;
function _tradeNum(id){const raw=String(document.getElementById(id)?.value||'').replace(/,/g,'').trim();return raw===''?NaN:Number(raw);}
function _tradeInput(){
  const plRaw=String(document.getElementById('trade-pl')?.value||'').replace(/,/g,'').trim();
  const foreign=_tradeItem&&_tradeItem.grp==='주식'&&_tradeItem.cur!=='KRW';
  // 국내 종목은 사용자가 손익 칸을 직접 고쳤을 때만 그 값을 쓴다(아니면 단가로 계산).
  return {side:_tradeSide,qty:_tradeNum('trade-qty'),price:_tradeNum('trade-price'),date:document.getElementById('trade-date')?.value||'',
    today:_cfLocalDateKey(new Date()),realizedKrw:(foreign||_tradePlTouched)?plRaw:'',skipPl:!!document.getElementById('trade-pl-skip')?.checked};
}
// 이 종목의 매도가 실현손익 기록에 이미 있는지(같은 소유주 · 메모에 종목명이나 티커). 판정이 아니라 안내용이다.
function tradeExistingPlRows(item, rows){
  if(!item||item.grp!=='주식') return [];
  const keys=[item.name,String(item.tkr||'').replace(/\.(KS|KQ|T)$/i,'')].map(v=>String(v||'').trim().toLowerCase()).filter(v=>v.length>=2);
  return (rows||[]).filter(r=>r&&r.owner===item.owner&&keys.some(k=>String(r.memo||'').toLowerCase().includes(k)));
}
function openTradeModal(idx){
  if(isMobileLayout()) return; // 모바일은 조회 전용
  const item=pfolioData[idx]; if(!item||item.grp==='현금') return;
  closeAddModal();
  _tradeItem=item;_tradePlTouched=false;
  const today=_cfLocalDateKey(new Date());
  const d=document.getElementById('trade-date');d.value=today;d.max=today;
  ['trade-qty','trade-price','trade-pl'].forEach(id=>{document.getElementById(id).value='';});
  const skip=document.getElementById('trade-pl-skip'); if(skip) skip.checked=false;
  const unit=item.unit||(item.grp==='가상화폐'?'개':'주');
  document.getElementById('trade-title').textContent=`${item.name||item.tkr} 매수·매도`;
  document.getElementById('trade-qty-label').textContent=`수량 (${unit})`;
  document.getElementById('trade-price-label').textContent=item.grp==='주식'?`단가 (${item.cur||'KRW'})`:'단가 (평균단가와 같은 단위)';
  document.getElementById('trade-now').innerHTML=`<span>${escHtml(item.owner||'')} · ${escHtml(item.broker||'')} / ${escHtml(item.acc||'')}</span>`
    +`<span>보유 <b>${(Number(item.qty)||0).toLocaleString(undefined,{maximumFractionDigits:8})}${escHtml(unit)}</b> · 평균단가 <b>${item.costUnknown?'미상':(Number(item.avgP)||0).toLocaleString(undefined,{maximumFractionDigits:4})}</b></span>`;
  const modal=document.getElementById('trade-modal');
  window._tradeModalReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  modal.classList.add('active');modal.setAttribute('aria-hidden','false');
  tradeSetSide('buy');
  requestAnimationFrame(()=>document.getElementById('trade-qty')?.focus());
}
// 창 바깥(어두운 바탕)을 누르면 닫는다 — 안에서 누른 채 끌고 나와 바깥에서 뗀 경우는 닫지 않는다(입력 중 텍스트 선택 보호).
let _tradeDownOutside=false;
if(typeof document!=='undefined'&&typeof document.addEventListener==='function'){
  document.addEventListener('pointerdown',e=>{_tradeDownOutside=!!e.target&&e.target.id==='trade-modal';},true);
  document.addEventListener('click',e=>{if(e.target&&e.target.id==='trade-modal'&&_tradeDownOutside)closeTradeModal();_tradeDownOutside=false;});
}
function closeTradeModal(){
  const modal=document.getElementById('trade-modal');
  if(!modal?.classList.contains('active')) return;
  modal.classList.remove('active');modal.setAttribute('aria-hidden','true');
  _tradeItem=null;
  const back=window._tradeModalReturnFocus;window._tradeModalReturnFocus=null;
  if(back&&document.contains(back)) back.focus();
}
function tradeSetSide(side){
  _tradeSide=side==='sell'?'sell':'buy';
  document.getElementById('trade-side-buy')?.setAttribute('aria-pressed',_tradeSide==='buy'?'true':'false');
  document.getElementById('trade-side-sell')?.setAttribute('aria-pressed',_tradeSide==='sell'?'true':'false');
  const item=_tradeItem, wrap=document.getElementById('trade-pl-wrap'), note=document.getElementById('trade-pl-note');
  const showPl=!!item&&_tradeSide==='sell'&&item.grp==='주식';
  if(wrap) wrap.hidden=!showPl;
  const match=document.getElementById('trade-pl-match');
  if(match){
    const found=showPl?tradeExistingPlRows(item,typeof monthlyPLData!=='undefined'?monthlyPLData:[]):[];
    match.hidden=!found.length;
    match.textContent=found.length?`실현손익 기록에 이 종목 매도가 ${found.length}건 있습니다(${found.slice(0,2).map(r=>`${String(r.month).slice(0,7)} ${r.memo}`).join(', ')}). 같은 매도라면 위 칸에 체크해 중복 기록을 막으세요.`:'';
  }
  if(note&&item) note.textContent=item.cur==='KRW'
    ?'(매도 단가 − 평균단가) × 수량으로 채웁니다. 수수료·세금을 뺀 실제 금액으로 고칠 수 있습니다. 세금·증여 > 실현손익 기록에 등록됩니다.'
    :'해외 종목은 매수 당시 환율 기록이 없어 자동 계산하지 않습니다. 증권사 앱의 실현손익(원화)을 적어 주세요. 세금·증여 > 실현손익 기록에 등록됩니다.';
  tradePreview();
}
function tradePlTouched(){_tradePlTouched=String(document.getElementById('trade-pl')?.value||'').trim()!=='';tradePreview();}
function tradePreview(){
  const box=document.getElementById('trade-preview'), err=document.getElementById('trade-error');
  if(!box||!_tradeItem) return;
  if(err){err.hidden=true;err.textContent='';}
  const item=_tradeItem, input=_tradeInput();
  const plan=tradeApplyPlan(item,input);
  const fmt=v=>Number(v).toLocaleString(undefined,{maximumFractionDigits:4});
  // 국내 종목 매도: 손익 칸을 직접 고치지 않았으면 계산값을 보여 준다
  const plEl=document.getElementById('trade-pl');
  if(plEl) plEl.disabled=!!input.skipPl;
  if(plEl&&_tradeSide==='sell'&&item.grp==='주식'&&item.cur==='KRW'&&!_tradePlTouched&&!input.skipPl&&document.activeElement!==plEl)
    plEl.value=plan.ok&&plan.pl?plan.pl.amt.toLocaleString():'';
  if(!plan.ok){box.innerHTML=`<span class="trade-preview-wait">${Number.isFinite(input.qty)&&input.qty>0?escHtml(plan.error):'수량과 단가를 입력하면 반영 결과를 미리 보여 줍니다.'}</span>`;return;}
  const unit=escHtml(item.unit||(item.grp==='가상화폐'?'개':'주'));
  let html=plan.remove
    ?`<div><span>반영 후</span><b>전량 매도 — 보유 목록에서 삭제</b></div>`
    :`<div><span>반영 후 수량</span><b>${fmt(item.qty)} → ${fmt(plan.next.qty)}${unit}</b></div><div><span>반영 후 평균단가</span><b>${item.costUnknown?'미상':fmt(item.avgP)+' → '+fmt(plan.next.avgP)}</b></div>`;
  if(plan.pl) html+=`<div><span>실현손익 기록</span><b class="${plan.pl.amt>0?'c-up':plan.pl.amt<0?'c-dn':''}">${plan.pl.amt>0?'+':plan.pl.amt<0?'-':''}₩${Math.abs(plan.pl.amt).toLocaleString()} · ${plan.pl.month.slice(5)}월 · ${plan.pl.category==='domestic'?'국내':'해외'} · ${escHtml(plan.pl.account)}</b></div>`;
  else if(_tradeSide==='sell'&&input.skipPl&&item.grp==='주식') html+=`<div><span>실현손익 기록</span><b>추가 안 함 (이미 기록함)</b></div>`;
  else if(_tradeSide==='sell') html+=`<div><span>실현손익 기록</span><b>등록 안 함 (세금 화면은 주식만 다룹니다)</b></div>`;
  box.innerHTML=html;
}
function submitTrade(){
  if(isMobileLayout()) return; // 모바일은 조회 전용
  const err=document.getElementById('trade-error');
  const showErr=m=>{if(err){err.textContent=m;err.hidden=false;}};
  const item=_tradeItem, idx=pfolioData.indexOf(item);
  if(!item||idx<0){closeTradeModal();return;}
  // 원장·재무기록 둘 다 불러온 뒤에만 — 한쪽만 저장되면 수량과 실현손익이 어긋난다
  if(window._kvLoadState?.assets!=='ready'||window._kvLoadState?.ext!=='ready'){showErr('데이터를 아직 불러오지 못해 저장할 수 없습니다. 데이터 상태에서 다시 확인해 주세요.');return;}
  const plan=tradeApplyPlan(item,_tradeInput());
  if(!plan.ok){showErr(plan.error);return;}
  if(plan.remove&&!confirm('전량 매도입니다. 이 종목을 보유 목록에서 삭제할까요?'+(item.dca?'\n(적립식 매수 규칙도 함께 삭제됩니다)':''))) return;
  if(plan.remove) pfolioData.splice(idx,1);
  // splitCheckedAt: 지금 수량·단가를 사용자가 확인했으므로 오늘이 분할 기준일이다
  else pfolioData[idx]={...item,qty:plan.next.qty,avgP:plan.next.avgP,splitCheckedAt:_cfLocalDateKey(new Date())};
  if(plan.pl){monthlyPLData.push(plan.pl);saveMonthlyPL();}
  closeTradeModal();
  syncDivHistory();changeOwner(currentOwner,null);saveAssetsToKV();
}
