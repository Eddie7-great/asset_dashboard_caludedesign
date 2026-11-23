// 구성원별 보유 화면(fam2) — cobalt.js 에서 옮겨 온 화면 렌더러(2026-11-23, 동작 변경 없음).
// cobalt.js 보다 먼저 로드한다(CB_VIEWS 가 이 파일의 렌더 함수를 참조한다). 맨 위에서는 함수·상태 선언만 하고,
// cobalt.js 의 상수·상태는 함수 안에서만 쓴다 — 로드 때 쓰면 아직 없는 이름이라 오류가 난다(test_source_split.mjs).

// ───────────────────────── 페이지: 가족 자산 ─────────────────────────
function cbRenderFam(){
  const el = document.getElementById('cb-fam2'); if(!el) return;
  const rows = cbAllRows();
  const nw = rows.reduce((s,r)=>s+r.val,0) || 1;
  const gainAbs = rows.reduce((s,r)=>s+r.gain,0);
  const byOwner = {}; rows.forEach(r=>{ const o=r.i.owner||'—'; (byOwner[o]=byOwner[o]||{v:0,g:0,n:0}); byOwner[o].v+=r.val; byOwner[o].g+=r.gain; byOwner[o].n++; });
  const cards = [{name:'전체',key:'all',color:'#8a97b0',v:nw,g:gainAbs,n:rows.length}]
    .concat(OWNERS.map(o=>({name:o,key:o,color:cbOwnerColor(o),v:(byOwner[o]||{v:0}).v,g:(byOwner[o]||{g:0}).g,n:(byOwner[o]||{n:0}).n})));
  const base = _famKey==='all' ? rows : rows.filter(r=>r.i.owner===_famKey);
  const q=(_famQ||'').trim().toLowerCase();
  const filtered = q ? base.filter(r=>((r.i.tkr||'')+' '+(r.i.name||'')+' '+r.cl.label+' '+(r.i.owner||'')).toLowerCase().includes(q)) : base;
  const held = cbSortOwnerNameVal(filtered);
  const famMixOwners = OWNERS.filter(owner=>_famKey==='all'||owner===_famKey).map(owner=>{
    const ownerRows=rows.filter(r=>r.i.owner===owner);
    const total=ownerRows.reduce((s,r)=>s+r.val,0);
    const segments=Object.entries(CB_CLS).map(([key,meta])=>({
      key,label:meta.label,color:meta.color,
      value:ownerRows.filter(r=>r.cls===key).reduce((s,r)=>s+r.val,0)
    })).filter(x=>x.value>0);
    return {owner,total,segments};
  });
  const famMixClasses = Object.entries(CB_CLS).map(([key,meta])=>({
    key,label:meta.label,color:meta.color,
    value:base.filter(r=>r.cls===key).reduce((s,r)=>s+r.val,0)
  })).filter(x=>x.value>0);

  // 조회 전용 페이지 — 수정은 "자산 내역"에서만 (내역 우측 수정 버튼 제거됨)
  cbSetHead('소유주별 보유 내역 · 자산군 구성',cbOwnerBtns(_famKey==='all'?'전체':_famKey,'cbFamOwner'));
  el.innerHTML = `
    <div class="cb-fam-card-grid">
      ${cards.map(f=>`
        <div class="cb-panel cb-fam-card" role="button" tabindex="0" aria-pressed="${_famKey===f.key}" data-fam-key="${cbEsc(f.key)}" onclick="cbFamPick(this.dataset.famKey)" style="${_famKey===f.key?`border-color:${f.color};box-shadow:0 0 0 1px ${f.color}`:''}">
          <div class="cb-fam-card-head">
            <span class="cb-fam-card-ico" style="background:${f.color}26;color:${f.color}">${cbEsc(f.name.slice(0,1))}</span>
            <span class="cb-fam-card-name">${cbEsc(f.name)}</span>
          </div>
          <div class="cb-fam-card-val">${cbDisp(f.v)}</div>
          <div class="cb-fam-card-gain" style="${cbUpDn(f.g)}">${cbSignDisp(f.g)}</div>
          <div class="cb-fam-card-track"><i style="background:${f.color};width:${Math.round(f.v/nw*100)}%"></i></div>
          <div class="cb-fam-card-foot">전체 ${(f.v/nw*100).toFixed(1)}% · ${f.n}종목</div>
        </div>`).join('')}
    </div>
    <div class="cb-family-detail-grid">
    <div class="cb-panel cb-table-panel cb-family-table-panel" style="padding:14px 16px">
      <div class="cb-family-table-toolbar" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div class="cb-panel-title">${_famKey==='all'?'전체 투자자산':cbEsc(_famKey)+' 투자자산'} · ${held.length}종목</div>
        <div style="display:flex;align-items:center;gap:7px;background:var(--inner);border:1px solid var(--bd2);border-radius:9px;padding:6px 11px;width:220px">
          <span style="color:var(--dim);font-size:var(--fs-cap)">⌕</span>
          <input value="${cbEsc(_famQ)}" oninput="cbFamSearch(this.value)" placeholder="티커·종목명 검색…" style="background:transparent;border:none;color:var(--tx);font-family:var(--font-ui);font-size:var(--fs-cap);width:100%;outline:none" />
        </div>
      </div>
      <!-- 칸 폭은 .cb-family-head/.cb-family-row 격자(workspace-ui.css). 소유주 · 계좌 · 종목 순서는 보유 목록과 같다. -->
      <div class="cb-tblwrap"><div class="cb-family-table">
      <div class="cb-thead cb-family-head">
        <span>${cbSortBtn('fam','owner','소유주','text')}</span><span>${cbSortBtn('fam','acct','계좌','text')}</span><span>${cbSortBtn('fam','name','종목','text')}</span>
        <span class="r">${cbSortBtn('fam','qty','수량')}</span>
        <span class="r">${cbSortBtn('fam','avg','<span data-tip="보유 수량 전체의 평균 매수 단가(가중평균) · 정렬은 원화 환산 기준">평단가</span>')}</span>
        <span class="r">${cbSortBtn('fam','cur','<span data-tip="정렬은 원화 환산 기준">현재가</span>')}</span><span class="r">${cbSortBtn('fam','val','평가액')}</span><span class="r">${cbSortBtn('fam','gain','평가손익')}</span><span class="r">${cbSortBtn('fam','pct','수익률')}</span>
      </div>
      ${cbSortRows('fam',held,cbHoldingSortGetters()).map(r=>`
        <div class="cb-hrow cb-family-row">
          <span>${cbOwnerTag(r.i.owner)}</span>
          <span>${cbAccountCell(r.i)}</span>
          <div class="cb-family-asset">
            ${cbFlagCell(r, 26, 15)}
            <div class="cb-asset-inline cb-tip-block" data-overflow-tip="${cbEsc([r.title,r.subTitle].filter(Boolean).join(' · '))}">
              <span class="cb-asset-name" data-overflow-watch>${cbEsc(r.title)}</span>
              ${r.subTitle?`<span class="cb-asset-ticker" data-overflow-watch>${cbEsc(r.subTitle)}</span>`:''}
            </div>
          </div>
          <span class="cb-num r cap">${r.i.grp==='현금'?'예수금':cbEsc(Number(r.i.qty||0).toLocaleString(undefined,{maximumFractionDigits:4})+(r.i.grp==='가상화폐'?'개':r.i.unit||'주'))}</span>
          <span class="cb-num r cap">${r.i.grp==='현금'?'—':cbFmtNative(cbAvgNative(r.i),r.i.cur)}</span>
          <span class="cb-num r cap">${r.i.grp==='현금'?'—':cbFmtNative(r.i.curP,r.i.cur)}</span>
          <span class="cb-num r b">${cbDisp(r.val)}</span>
          <span class="cb-num r cap sb" style="${cbGainStyle(r.gain,r.i.grp==='현금'||r.i.costUnknown)}">${r.i.grp==='현금'||r.i.costUnknown?'—':cbSignDisp(r.gain)}</span>
          <span class="cb-num r cap sb" style="${cbGainStyle(r.gainPct,r.gainPct==null)}">${r.gainPct==null?'—':cbPct(r.gainPct)}</span>
        </div>`).join('')}
      </div></div>
    </div>
    <div class="cb-panel cb-family-mix-card">
      <div class="cb-insight-title">소유주별 자산군 구성</div>
      <div style="font-size:var(--fs-cap);color:var(--dim);line-height:1.5;margin-top:3px">소유주마다 자산군이 차지하는 비중</div>
      <div class="cb-family-mix-list">
        ${famMixOwners.map(m=>`
          <button type="button" class="cb-family-mix-owner${_famKey===m.owner?' is-active':''}" onclick="cbFamPick('${cbEsc(m.owner)}')">
            <span class="cb-family-mix-head"><b><i style="background:${cbOwnerColor(m.owner)}"></i>${cbEsc(m.owner)}</b><span>${m.total>0?cbDisp(m.total):'—'}</span></span>
            <span class="cb-family-mix-track">
              ${m.total>0?m.segments.map(seg=>`<i data-tip="${cbEsc(`${m.owner} · ${seg.label} ${(seg.value/m.total*100).toFixed(1)}%`)}" style="width:${(seg.value/m.total*100).toFixed(2)}%;background:${seg.color}"></i>`).join(''):'<i style="width:100%;background:var(--bd)"></i>'}
            </span>
          </button>`).join('')}
      </div>
      <div class="cb-family-mix-legend">
        ${famMixClasses.map(seg=>`<span><i style="background:${seg.color}"></i>${cbEsc(seg.label)}</span>`).join('')}
      </div>
    </div>
    </div>`;
}
function cbFamOwner(owner){cbFamPick(owner==='전체'?'all':owner);}
function cbFamPick(k){ _famKey=k; cbRenderFam(); cbRestoreFilterFocus('cb-fam2','data-fam-key',k); }
function cbFamSearch(v){ _famQ=v; cbRenderFam();
  const inp=document.querySelector('#cb-fam2 input'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
