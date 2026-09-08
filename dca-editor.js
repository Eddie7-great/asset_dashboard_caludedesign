let _dcaEditingItem=null,_dcaDraft=null,_dcaBusy=false,_dcaMessage='';
function cbDcaCanSave(){
  if(window._kvLoadState?.assets==='ready'&&window._kvLoadState?.ext==='ready')return true;
  showSaveError('자산과 재무계획을 모두 불러온 뒤 규칙을 저장할 수 있습니다.');return false;
}
function cbDcaEdit(idx){
  if(isMobileLayout()||_dcaBusy)return;
  const item=pfolioData[idx];if(!item||!['주식','가상화폐'].includes(item.grp))return;
  _dcaEditingItem=item;_dcaMessage='';
  _dcaDraft={dca:item.dca!==false,dcaCycle:item.dcaCycle||'매월',dcaMode:item.dcaMode||'amount',dcaAmt:item.dcaAmt||'',dcaCur:item.dcaCur||'KRW',dcaQty:item.dcaQty||'',dcaDay:item.dcaDay||1,dcaDays:[...(item.dcaDays||[1])]};
  cbRenderDca();document.getElementById('dca-rule-amount')?.focus();
}
function cbDcaCancel(){if(_dcaBusy)return;_dcaEditingItem=null;_dcaDraft=null;_dcaMessage='';cbRenderDca();}
function cbDcaDraft(key,value){if(_dcaDraft)_dcaDraft[key]=value;}
function cbDcaEditorHtml(ownerF){
  if(isMobileLayout())return finMobileNote('적립식 매수 규칙');
  const eligible=(pfolioData||[]).map((i,idx)=>({i,idx})).filter(x=>['주식','가상화폐'].includes(x.i.grp)&&(!ownerF||x.i.owner===ownerF));
  const item=eligible.some(x=>x.i===_dcaEditingItem)?_dcaEditingItem:null,d=item?_dcaDraft:null;
  return `<section class="cb-panel fin-section dca-editor"><div class="fin-section-head"><span>적립식 매수 계획</span><small>규칙과 일정만 관리 · 실제 주문은 증권사에서 실행하세요</small></div><label class="dca-asset-picker" for="dca-rule-asset">보유 종목 선택<select id="dca-rule-asset" ${_dcaBusy?'disabled':''} onchange="if(this.value!=='')cbDcaEdit(Number(this.value))"><option value="">규칙을 추가·수정할 종목</option>${eligible.map(x=>`<option value="${x.idx}" ${x.i===item?'selected':''}>${cbEsc([x.i.owner,x.i.name||x.i.tkr,x.i.broker,x.i.acc].filter(Boolean).join(' · '))}</option>`).join('')}</select></label>
    ${d&&item?`<form id="dca-rule-form" onsubmit="event.preventDefault();cbDcaSave()"><fieldset ${_dcaBusy?'disabled':''}><legend>${cbEsc(item.owner)} · ${cbEsc(item.name||item.tkr)}</legend><div class="compact-form-grid">
      <label>매수 기준<select id="dca-rule-mode" onchange="cbDcaDraft('dcaMode',this.value);cbRenderDca()"><option value="amount" ${d.dcaMode==='amount'?'selected':''}>금액</option><option value="qty" ${d.dcaMode==='qty'?'selected':''}>수량</option></select></label>
      <label>${d.dcaMode==='qty'?'회당 수량':'회당 금액'}<input id="dca-rule-amount" type="number" data-no-comma="1" min="0.000001" max="1000000000000" step="any" required value="${cbEsc(d.dcaMode==='qty'?d.dcaQty:d.dcaAmt)}" oninput="cbDcaDraft('${d.dcaMode==='qty'?'dcaQty':'dcaAmt'}',this.value)"></label>
      ${d.dcaMode==='amount'?`<label>금액 통화<select onchange="cbDcaDraft('dcaCur',this.value)">${['KRW','USD','JPY'].map(c=>`<option ${d.dcaCur===c?'selected':''}>${c}</option>`).join('')}</select></label>`:''}
      <label>주기<select id="dca-rule-cycle" onchange="cbDcaDraft('dcaCycle',this.value);cbRenderDca()">${['매월','매주','매일'].map(c=>`<option ${d.dcaCycle===c?'selected':''}>${c}</option>`).join('')}</select></label>
      ${d.dcaCycle==='매월'?`<label>매월 일자<input id="dca-rule-day" type="number" data-no-comma="1" min="1" max="31" step="1" required value="${cbEsc(d.dcaDay)}" oninput="cbDcaDraft('dcaDay',this.value)"></label>`:''}
      <label>규칙 상태<select onchange="cbDcaDraft('dca',this.value==='true')"><option value="true" ${d.dca?'selected':''}>활성</option><option value="false" ${!d.dca?'selected':''}>일시 중지</option></select></label>
      </div>${d.dcaCycle==='매주'?`<div class="dca-weekdays" role="group" aria-label="매수 요일">${['일','월','화','수','목','금','토'].map((day,i)=>`<label><input type="checkbox" value="${i}" ${d.dcaDays.includes(i)?'checked':''} onchange="cbDcaDraft('dcaDays',Array.from(this.closest('.dca-weekdays').querySelectorAll(':checked')).map(x=>Number(x.value)))">${day}</label>`).join('')}</div>`:''}<div class="fin-form-actions"><button class="primary" type="submit">${_dcaBusy?'저장 중…':'규칙 저장'}</button><button type="button" onclick="cbDcaCancel()">취소</button></div></fieldset></form>`:''}
    <p class="dca-message" role="status">${cbEsc(_dcaMessage||(!eligible.length?'자산 관리에서 주식·가상화폐를 등록하면 계획을 만들 수 있습니다.':''))}</p></section>`;
}
function cbDcaValidate(d){
  if(!['amount','qty'].includes(d.dcaMode)||!['매월','매주','매일'].includes(d.dcaCycle)||!['KRW','USD','JPY'].includes(d.dcaCur))return '규칙의 기준·주기·통화를 확인해 주세요.';
  const value=Number(d.dcaMode==='qty'?d.dcaQty:d.dcaAmt);
  if(!Number.isFinite(value)||value<=0||value>1e12)return '회당 금액 또는 수량을 0보다 큰 숫자로 입력해 주세요.';
  if(d.dcaCycle==='매월'&&(!Number.isInteger(Number(d.dcaDay))||Number(d.dcaDay)<1||Number(d.dcaDay)>31))return '매월 일자는 1~31 사이 정수로 입력해 주세요.';
  if(d.dcaCycle==='매주'&&(!d.dcaDays.length||d.dcaDays.some(n=>!Number.isInteger(n)||n<0||n>6)))return '매수 요일을 하나 이상 선택해 주세요.';
  return '';
}
async function cbDcaSave(){
  if(isMobileLayout()||_dcaBusy||!_dcaDraft||!cbDcaCanSave())return;
  const item=_dcaEditingItem;
  if(!pfolioData.includes(item)){_dcaMessage='자산 목록이 변경되었습니다. 종목을 다시 선택해 주세요.';cbRenderDca();return;}
  const d=_dcaDraft,error=cbDcaValidate(d);
  if(error){_dcaMessage=error;cbRenderDca();return;}
  const patch={dca:!!d.dca,dcaCycle:d.dcaCycle,dcaMode:d.dcaMode,dcaCur:d.dcaCur,dcaAmt:Number(d.dcaAmt)||0,dcaQty:Number(d.dcaQty)||0,dcaDay:Number(d.dcaDay)||1,dcaDays:[...d.dcaDays]};
  const previous=Object.fromEntries(Object.keys(patch).map(k=>[k,item[k]]));
  Object.assign(item,patch);_dcaBusy=true;_dcaMessage='';cbRenderDca();
  let result;
  try{result=await saveAssetsToKV();}catch(e){result={ok:false};}
  _dcaBusy=false;
  if(result?.ok){_dcaDraft=null;_dcaEditingItem=null;_dcaMessage='적립식 규칙을 저장했습니다.';}
  else {Object.assign(item,previous);_dcaMessage='저장하지 못했습니다. 입력값은 유지했습니다. 데이터 상태를 확인한 뒤 다시 시도해 주세요.';}
  cbRenderDca();
}
