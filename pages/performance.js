// 성과 비교 화면(perf2) — cobalt.js 에서 옮겨 온 화면 렌더러(2026-11-23, 동작 변경 없음).
// cobalt.js 보다 먼저 로드한다(CB_VIEWS 가 이 파일의 렌더 함수를 참조한다). 맨 위에서는 함수·상태 선언만 하고,
// cobalt.js 의 상수·상태는 함수 안에서만 쓴다 — 로드 때 쓰면 아직 없는 이름이라 오류가 난다(test_source_split.mjs).

// ───────────────────────── 페이지: 성과 비교 ─────────────────────────
function cbLastVal(arr){ if(!Array.isArray(arr)) return null; for(let k=arr.length-1;k>=0;k--){ if(arr[k]!=null) return arr[k]; } return null; }
let _cbPerfVerifyPromise = null;
function cbVerifyPerfOwnersOnOpen(){
  if (_cbPerfVerifyPromise || typeof fetchBenchmarkData !== 'function') return;
  const investedOwners = new Set((pfolioData||[])
    .filter(i=>i && i.qty>0 && (i.grp==='주식' || i.grp==='가상화폐' || i.grp==='금'))
    .map(i=>i.owner));
  const missing = OWNERS.filter(owner=>
    investedOwners.has(owner) &&
    !CB_PERF_TFS.some(tf=>cbLastVal(((benchData[tf]||{}).data||{})[owner])!=null)
  );
  if (!missing.length) return;
  _cbPerfVerifyPromise = Promise.allSettled(missing.map(owner=>fetchBenchmarkData(owner)))
    .finally(()=>{
      _cbPerfVerifyPromise = null;
      if (_cobaltActive==='perf2') cbRenderPerf();
    });
}
// 비교 지수 색 — 테마와 상관없이 읽히는 회색 두 단계. 소유주 색(ownerColors)과 겹치지 않는다.
const CB_PERF_BENCH_COLOR = { 'S&P 500':'#9aa3b5', 'KOSPI':'#7d8799' };
// 범례·카드·설명 상자의 선 모양 견본(그래프의 선 종류와 같다)
function cbPerfSwatch(e, w){
  return e.dash
    ? `<span style="width:${w}px;height:0;border-top:2px dashed ${e.color};flex-shrink:0"></span>`
    : `<span style="width:${w}px;height:${e.isBench?2:3}px;border-radius:2px;background:${e.color};flex-shrink:0"></span>`;
}
function cbRenderPerf(){
  const el = document.getElementById('cb-perf2'); if(!el) return;
  const fmtR = v => v==null ? '—' : (v>=0?'+':'')+Number(v).toFixed(1)+'%';
  const csR = v => v==null ? 'color:var(--lab)' : cbUpDn(v);
  if (CB_PERF_TFS.indexOf(_cbPerfTf)<0) _cbPerfTf='1Y';
  // 비교 기준(S&P 500·KOSPI)을 소유주보다 먼저 둔다(사용자 결정 2026-11-25) — 카드·범례·말풍선·표가 이 순서를 따른다.
  // 색은 그대로: 소유주는 앱 공통 소유주 색의 굵은 실선, 비교 지수는 회색 가는 선(KOSPI 는 점선).
  // 그래프는 배열 순서대로 그리므로 지수 선이 먼저(아래) 깔리고 소유주 선이 위에 온다.
  const entities = [
    {key:'S&P 500',label:'S&P 500',color:CB_PERF_BENCH_COLOR['S&P 500'],isBench:true,dash:false},
    {key:'KOSPI',label:'KOSPI',color:CB_PERF_BENCH_COLOR.KOSPI,isBench:true,dash:true},
    ...OWNERS.map(o=>({key:o,label:o,color:cbOwnerColor(o),isBench:false,dash:false})),
  ];
  const tf = _cbPerfTf;
  const sel = benchData[tf] || {labels:[],data:{}};
  const spSel = cbLastVal(sel.data['S&P 500']);
  if (_cbPerfSel && !entities.some(e=>e.key===_cbPerfSel)) _cbPerfSel = null;
  const selKey = _cbPerfSel;
  const cards = entities.map(e=>({ ...e, ret: cbLastVal(sel.data[e.key]) }));
  // 클릭 강조: 선택된 소유주/벤치마크 라인은 굵게, 나머지는 흐리게
  // 선 종류: 소유주 = 굵은 실선, S&P 500 = 가는 회색 실선, KOSPI = 가는 회색 점선
  const seriesArr = entities.map(e=>({ data:(sel.data[e.key]||[]), color:e.color, isBench:!!e.isBench, label:e.label,
    bold: !e.isBench || e.key===selKey, dash:!!e.dash, dim: !!(selKey && e.key!==selKey) }));
  // 범례·카드·표의 색 스와치도 선 종류를 그대로 반영
  const swatch = (e, w) => cbPerfSwatch(e, w);
  // 차트 hover 데이터 (body 레벨 고정 툴팁 — 위젯 overflow 로 잘리지 않음)
  window._cbPerfHover = { labels: sel.labels||[], entities: entities.map(e=>({key:e.key,label:e.label,color:e.color,isBench:!!e.isBench,dash:!!e.dash})), data: sel.data||{} };
  // MDD (Max Drawdown): 선택 기간 시리즈에서 고점 대비 최대 낙폭
  const mddOf = arr => { let peak=1, mdd=0, seen=false;
    (arr||[]).forEach(v=>{ if(v==null) return; seen=true; const x=1+v/100; if(x>peak) peak=x; const dd=x/peak-1; if(dd<mdd) mdd=dd; });
    return seen ? mdd*100 : null; };
  const rows = entities.map(e=>{
    const g = t => cbLastVal((benchData[t]||{data:{}}).data[e.key]);
    const rv = g(tf);
    // S&P 500 대비 = 이 줄 수익률 − S&P 500 수익률. KOSPI 도 같은 식으로 적는다(2026-11-25 사용자 요청 — 예전엔 지수 줄이 모두 '—').
    // S&P 500 자기 줄은 비교 기준이라 '기준'으로 적는다.
    const isBase = e.key==='S&P 500';
    const alpha = (!isBase && rv!=null && spSel!=null) ? rv-spSel : null;
    return { e, vals: CB_PERF_TFS.map(t=>g(t)), alpha, isBase, mdd: mddOf(sel.data[e.key]) };
  });
  // 하단 표: 비교 지수 두 줄(S&P 500 → KOSPI)을 맨 위에 고정하고, 소유주는 선택 기간 수익률 높은 순(값 없는 줄은 끝).
  // 막대는 그 기간 수익률을 0 기준 좌우로 그린다.
  const tfIdx = CB_PERF_TFS.indexOf(tf);
  const sortedRows = rows.slice().sort((a,b)=>{
    if (a.e.isBench!==b.e.isBench) return a.e.isBench?-1:1;
    if (a.e.isBench) return 0;
    const av=a.vals[tfIdx], bv=b.vals[tfIdx];
    if (av==null) return bv==null?0:1;
    if (bv==null) return -1;
    return bv-av;
  });
  const perfBarMax = Math.max(1, ...rows.map(r=>Math.abs(r.vals[tfIdx]||0)));
  const labels = sel.labels||[];
  const N = labels.length;
  const padLpct = (CB_PERF_PAD.l/1100*100).toFixed(2), padRpct = (CB_PERF_PAD.r/1100*100).toFixed(2);

  // 소제목·기간 버튼은 메인 제목 라인(글로벌 헤더)으로
  cbSetHead(
    `${CB_PERF_TF_LABEL[tf]} · 기간 첫날을 0%로 맞춤 · <span data-tip="S&P 500(^GSPC)·KOSPI(^KS11) 실지수 대비 소유주별 포트폴리오 수익률. 전일 확정 종가 기준입니다.">전일 종가 기준</span> · <span data-tip="지금 보유한 종목과 비중을 기간 시작일부터 그대로 들고 있었다고 가정해 되짚은 값입니다. 기간 중 매수·매도 시점은 반영되지 않으므로 실제 실현 수익률과 다릅니다. 실제로 기록된 금액 추이는 아래 &lsquo;투자자산 추이&rsquo; 카드에서 확인하세요."><b>지금 보유 종목을 그 기간 내내 들고 있었다고 가정</b></span>`,
    `<div class="owner-tabs" style="display:inline-flex;gap:3px;flex-wrap:wrap">
      ${CB_PERF_TFS.map(t=>`<button class="owner-btn${t===tf?' active':''}" data-perf-tf="${t}" onclick="cbPerfTf('${t}')" aria-pressed="${t===tf}">${t}</button>`).join('')}
    </div>`
  );

  el.innerHTML = `
    ${cbTwrCardHtml()}
    <div class="cb-perf-card-grid">
      ${cards.map(p=>`
        <div class="cb-panel cb-perf-card" role="button" tabindex="0" onclick="cbPerfSelToggle('${cbEsc(p.key)}')" style="border-top-color:${p.color};${selKey===p.key?`box-shadow:0 0 0 1.5px ${p.color}`:(selKey?'opacity:.5':'')}">
          <div class="cb-perf-card-name">${swatch(p,13)}${cbEsc(p.label)}</div>
          <div class="cb-perf-card-value" style="${csR(p.ret)}">${fmtR(p.ret)}</div>
        </div>`).join('')}
    </div>
    <div class="cb-panel cb-perf-chart-panel">
      <div class="cb-perf-legend">
        ${entities.map(p=>`<span class="cb-perf-legend-item" role="button" tabindex="0" onclick="cbPerfSelToggle('${cbEsc(p.key)}')"${selKey&&selKey!==p.key?' style="opacity:.4"':''}>${swatch(p,13)}${cbEsc(p.label)}</span>`).join('')}
        <span class="cb-perf-legend-hint">카드/범례 클릭 시 해당 라인 강조 · 그래프를 <span class="cb-hint-mouse">가리키면</span><span class="cb-hint-touch">누르면</span> 그날 수익률</span>
      </div>
      <!-- 휴대폰은 줄이는 대신 옆으로 밀어 본다(.cb-chart-scroll + .cb-perf-plot 최소 폭) — 1100 좌표계를 390px 에 줄이면 눈금·이름표가 4px 가 된다 -->
      <div class="cb-chart-scroll"><div class="cb-perf-plot">
      <div style="position:relative" onmouseleave="cbPerfHide()">
        ${cbMultiLineSvg(seriesArr, 1100, 220)}
        <div style="position:absolute;top:0;bottom:0;left:${padLpct}%;right:${padRpct}%">
          <div id="cb-perf-guide" style="position:absolute;top:0;bottom:0;width:0;border-left:1px dashed var(--acc);display:none;pointer-events:none"></div>
          ${N>0 ? labels.map((_,i)=>{
            const c = N>1 ? i/(N-1)*100 : 50, wc = N>1 ? 100/(N-1) : 100;
            const lft = Math.max(0, c-wc/2), rgt = Math.min(100, c+wc/2);
            return `<div data-chart-hit="perf:${i}" style="position:absolute;top:0;bottom:0;left:${lft}%;width:${(rgt-lft)}%;cursor:crosshair;touch-action:pan-x pan-y" onmousemove="cbPerfHover(event,${i})"></div>`;
          }).join('') : ''}
        </div>
      </div>
      <div class="cb-perf-xaxis" style="margin-left:${padLpct}%;margin-right:${padRpct}%">${cbPerfTickIdx(N).map(i=>`<span style="left:${(N>1?i/(N-1)*100:50).toFixed(2)}%">${cbEsc(labels[i])}</span>`).join('')}</div>
      </div></div>
    </div>
    ${typeof finInvestTrendCard==='function'?finInvestTrendCard():''}
    <div class="cb-panel cb-perf-detail-panel" style="margin-top:12px;padding:16px 18px">
      <div class="cb-perf-detail-grid">
        <!-- 한 표(6줄): 비교 지수 두 줄이 위, 소유주는 선택 기간 수익률 순 — 예전에는 좌우 두 표(S&P·본인·자녀1 | KOSPI·아내·아버지)라 순위를 눈으로 맞춰야 했다 -->
        <div class="cb-perf-detail-table">
          <div class="cb-perf-detail-head">
            <span>구분</span>
            <span class="cb-perf-bar-head">${tf} 수익률</span>
            ${CB_PERF_TFS.map(t=>`<span style="${t===tf?'color:var(--acc);font-weight:800':''}">${t}</span>`).join('')}
            <span><span data-tip="같은 기간 S&P 500 수익률과의 차이 (이 줄 − S&P 500). KOSPI 줄은 두 지수의 차이입니다.">S&amp;P 500 대비</span></span>
            <span><span data-tip="Max Drawdown — 선택 기간 중 고점 대비 최대 하락폭. 낙폭이 작을수록 하락장 방어력이 좋았다는 뜻입니다.">MDD</span></span>
          </div>
          ${sortedRows.map(r=>`
            <div class="cb-perf-detail-row${r.e.isBench?' is-bench':''}" role="button" tabindex="0" onclick="cbPerfSelToggle('${cbEsc(r.e.key)}')" style="${selKey===r.e.key?'background:var(--accSoft)':(selKey?'opacity:.55':'')}">
              <span class="cb-perf-detail-name">${swatch(r.e,11)}${cbEsc(r.e.label)}</span>
              ${cbPerfBarHtml(r.vals[tfIdx], perfBarMax, r.e.color)}
              ${r.vals.map((v,k)=>`<span class="cb-num" style="${csR(v)}"><span class="cb-perf-value${CB_PERF_TFS[k]===tf?' is-active':''}">${fmtR(v)}</span></span>`).join('')}
              <span class="cb-num" style="${r.isBase?'color:var(--lab)':csR(r.alpha)}"><span class="cb-perf-value">${r.isBase?'기준':(r.alpha==null?'—':fmtR(r.alpha))}</span></span>
              <span class="cb-num" style="${r.mdd==null||r.mdd>=0?'color:var(--lab)':'color:var(--dn)'}"><span class="cb-perf-value">${r.mdd==null?'—':r.mdd.toFixed(1)+'%'}</span></span>
            </div>`).join('')}
        </div>
      </div>
      <div class="cb-perf-detail-note">※ 소유주별 라인은 <b>현재 보유 종목·비중을 기간 시작일부터 그대로 들고 있었다고 가정</b>한 가중 수익률(백캐스트)입니다. 기간 중 매수·매도 시점이 반영되지 않으므로 실제 실현 수익률과 다르며, S&amp;P 500 대비·MDD도 같은 가정 위에 있습니다. 데이터가 비어 있으면 사이드바의 "새로고침"을 눌러주세요.</div>
    </div>
    ${cbFxEffectCardHtml()}`;
  cbScrollChartsToLatest(el);
}
// ── 환율 효과(2026-11-25 시안) — 외화 주식의 원화 손익 = 평가손익(보유 목록과 같은 값) + 환율 효과 ──
// 보유 목록의 평가손익은 매입금액도 '오늘 환율'로 바꿔 계산해 환율로 번(잃은) 돈이 빠져 있다. 매수 평균 환율(avgFx)을 적은 종목만
// 환율 효과 = 수량 × 평균단가 × (오늘 환율 − 매수 환율) 을 더해 원화로 실제 늘어난 돈을 보인다. 평가손익 숫자 자체는 바꾸지 않는다.
function cbFxEffectRows(items){
  return (items||[]).filter(i=>i&&i.grp==='주식'&&!i.costUnknown&&(Number(i.qty)||0)>0&&String(i.cur||'KRW').toUpperCase()!=='KRW')
    .map(i=>{
      const gain=assetGainKRW(i), fx0=Number(i.avgFx)>0?Number(i.avgFx):null, now=curRate(i.cur);
      const fx=fx0==null?null:(Number(i.qty)||0)*assetAvgNative(i)*(now-fx0);
      return {i, gain, fx0, now, fx, total:fx==null?null:gain+fx};
    })
    .sort((a,b)=>(b.fx!=null)-(a.fx!=null)||Math.abs(b.total??b.gain)-Math.abs(a.total??a.gain));
}
function cbFxEffectCardHtml(){
  const rows=cbFxEffectRows(pfolioData);
  if(!rows.length) return '';
  const known=rows.filter(r=>r.fx!=null), missing=rows.length-known.length;
  const sum=k=>known.reduce((s,r)=>s+r[k],0);
  const g=sum('gain'), f=sum('fx'), t=g+f;
  const sgn=v=>(v>0?'+':v<0?'−':'')+cbKrw(Math.abs(v));
  const fxTxt=(r)=>{ const u=avgFxUnitOf(r.i.cur), fmt=v=>(v*u).toLocaleString('ko-KR',{maximumFractionDigits:u>1?2:1}); return `${fmt(r.fx0)} → ${fmt(r.now)}`; };
  const max=Math.max(1,...known.map(r=>Math.abs(r.gain)+Math.abs(r.fx)));
  const seg=(v,cls)=>v?`<i class="${cls}${v<0?' is-neg':''}" style="width:${(Math.abs(v)/max*100).toFixed(1)}%"></i>`:'';
  return `<div class="cb-panel cb-fx-card">
    <div class="cb-fx-head"><div class="cb-panel-title"><span data-tip="보유 목록의 평가손익은 매입금액도 오늘 환율로 바꿔 계산하므로 환율이 오르내려 생긴 손익이 빠져 있습니다. 매수 평균 환율을 적은 종목만 그 몫을 따로 셉니다. 보유 목록 숫자는 바꾸지 않습니다.">환율 효과</span> <small>· 외화 주식 · 원화로 본 손익 = 평가손익 + 환율 효과</small></div></div>
    ${known.length?`<div class="cb-fx-sum">
      <div><small>평가손익 <em>보유 목록과 같은 값</em></small><b style="${cbGainStyle(g)}">${sgn(g)}</b></div>
      <span class="cb-fx-op">+</span>
      <div><small>환율 효과 <em>매수 때보다 환율 변화</em></small><b style="${cbGainStyle(f)}">${sgn(f)}</b></div>
      <span class="cb-fx-op">=</span>
      <div><small>원화로 본 손익</small><b style="${cbGainStyle(t)}">${sgn(t)}</b></div>
    </div>
    <div class="cb-fx-list">
      <div class="cb-fx-row cb-fx-rhead" aria-hidden="true"><span>소유주</span><span>종목</span><span>매수 → 오늘 환율</span><span class="cb-fx-bars-h"><i class="price"></i>주가 <i class="fx"></i>환율</span><span class="r">평가손익</span><span class="r">환율 효과</span><span class="r">합계</span></div>
      ${known.map(r=>`<div class="cb-fx-row">
        <span>${cbOwnerTag(r.i.owner)}</span>
        <span class="cb-fx-name" title="${cbEsc(r.i.name||r.i.tkr)}">${cbFlagCell({cls:cbCls(r.i),i:r.i},22,13)}${cbEsc(cbCls(r.i)==='us'?cbStrip(r.i.tkr):(r.i.name||r.i.tkr))}</span>
        <span class="cb-num cb-fx-rate">${fxTxt(r)}</span>
        <span class="cb-fx-bars">${seg(r.gain,'price')}${seg(r.fx,'fx')}</span>
        <span class="cb-num r" style="${cbGainStyle(r.gain)}">${sgn(r.gain)}</span>
        <span class="cb-num r" style="${cbGainStyle(r.fx)}">${sgn(r.fx)}</span>
        <b class="cb-num r" style="${cbGainStyle(r.total)}">${sgn(r.total)}</b>
      </div>`).join('')}
    </div>`:`<p class="cb-fx-empty">매수 평균 환율을 적은 외화 주식이 없습니다. 보유 목록에서 종목을 ✎ 수정해 '매수 평균 환율'을 적으면 여기서 나눠 보입니다.</p>`}
    ${missing?`<p class="cb-fx-note">매수 환율 미입력 ${missing}종목은 합계에서 뺐습니다 — 보유 목록 ✎ 수정에서 적을 수 있습니다.</p>`:''}
    <p class="cb-fx-note">엔화는 100엔당 원. 매수·매도 입력 창으로 더 산 몫은 입력한 날 환율로 평균냅니다. 세금 계산(해외주식 양도세)은 거래일 환율 기준이라 이 숫자와 다를 수 있습니다.</p>
  </div>`;
}
// 휴대폰은 그래프를 옆으로 밀어 본다 — 처음에는 가장 궁금한 최신 구간(오른쪽 끝, 선 끝 이름표)을 보여 준다.
// 넓은 화면은 넘치지 않으므로(scrollWidth == clientWidth) 아무 일도 하지 않는다.
function cbScrollChartsToLatest(root){
  (root||document).querySelectorAll('.cb-chart-scroll').forEach(box=>{
    if (box.scrollWidth > box.clientWidth + 1) box.scrollLeft = box.scrollWidth;
  });
}
function cbPerfTf(t){ _cbPerfTf = t; cbRenderPerf(); cbRestoreFilterFocus('cb-head-widgets','data-perf-tf',t); }
// 소유주/벤치마크 카드·범례·표 행 클릭 → 해당 라인 강조 (재클릭 시 해제)
function cbPerfSelToggle(k){ _cbPerfSel = (_cbPerfSel===k ? null : k); cbRenderPerf(); }
function _cbPerfTipEl(){
  let t = document.getElementById('cb-perf-tip');
  if(!t){
    t = document.createElement('div'); t.id = 'cb-perf-tip'; t.className = 'cb-chart-tip';
    t.style.cssText = 'position:fixed;z-index:9999;display:none;pointer-events:none;background:var(--tipbg);color:var(--tiptx);border:1px solid var(--tipbd);border-radius:var(--r-md);padding:9px 11px;box-shadow:var(--tipshadow);font-size:var(--fs-cap);min-width:158px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;box-sizing:border-box;letter-spacing:0';
    document.body.appendChild(t);
  }
  return t;
}
// 성과 표의 선택 기간 막대 — 가운데가 0, 오른쪽 이익·왼쪽 손실. 길이는 표 안 최대 절댓값 대비(새 계산 없이 표의 값만 쓴다).
function cbPerfBarHtml(v, maxAbs, color){
  if (v==null || !Number.isFinite(Number(v))) return '<span class="cb-perf-bar" aria-hidden="true"></span>';
  const half = Math.min(50, Math.abs(v)/(maxAbs||1)*50);
  const left = v>=0 ? 50 : 50-half;
  return `<span class="cb-perf-bar" aria-hidden="true"><i style="left:${left.toFixed(2)}%;width:${half.toFixed(2)}%;background:${color}"></i></span>`;
}
function cbPerfHover(ev, idx){
  const d = window._cbPerfHover; if(!d) return;
  const t = _cbPerfTipEl();
  const body = d.entities.map(e=>{
    const v = (d.data[e.key]||[])[idx];
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:18px;padding:1.5px 0">
      <span style="display:flex;align-items:center;gap:5px;color:var(--mut)">${cbPerfSwatch(e,13)}${cbEsc(e.label)}</span>
      <span class="cb-num" style="font-weight:700;${v==null?'color:var(--lab)':cbUpDn(v)}">${v==null?'—':(v>=0?'+':'')+Number(v).toFixed(1)+'%'}</span></div>`;
  }).join('');
  t.innerHTML = `<div style="font-size:var(--fs-cap);color:var(--lab);margin-bottom:5px;font-weight:700">${cbEsc(d.labels[idx]||'')}</div>${body}`;
  t.style.display = 'block';
  const r = t.getBoundingClientRect(); const pad = 16;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - pad;
  t.style.left = Math.max(8, x) + 'px';
  t.style.top = Math.max(8, y) + 'px';
  const g = document.getElementById('cb-perf-guide');
  if (g){ const N = d.labels.length; g.style.left = (N>1 ? idx/(N-1)*100 : 50) + '%'; g.style.display = 'block'; }
}
function cbPerfHide(){
  const t = document.getElementById('cb-perf-tip'); if(t) t.style.display = 'none';
  const g = document.getElementById('cb-perf-guide'); if(g) g.style.display = 'none';
}

// ── 진짜 내 수익률 카드(2026-11-25 시안) ──
// 계산은 reportTwrSeries(workspace-pages.js). 비교 지수는 같은 달의 월말 값으로 월 수익률을 만든다(benchData['1Y']).
// benchData 의 날짜는 'MM/DD'(연도 없음)라 끝에서부터 거꾸로 읽으며 달이 커지면 한 해 앞으로 본다.
let _cbTwrOwner='전체';
function cbBenchMonthEnds(sel, todayKey){
  const labels=(sel&&sel.labels)||[], out={};
  if(!labels.length) return out;
  const today=String(todayKey||finLocalDateKey(new Date()));
  let y=Number(today.slice(0,4)), lastM=Number(String(labels[labels.length-1]).slice(0,2));
  if(lastM>Number(today.slice(5,7))) y--;
  const yms=Array(labels.length); let m0=lastM;
  for(let i=labels.length-1;i>=0;i--){ const m=Number(String(labels[i]).slice(0,2)); if(m>m0) y--; m0=m; yms[i]=`${y}-${String(m).padStart(2,'0')}`; }
  ['S&P 500','KOSPI'].forEach(k=>{
    const arr=(sel.data||{})[k]||[], ends={};
    yms.forEach((ym,i)=>{ if(Number.isFinite(arr[i])) ends[ym]=arr[i]; });
    out[k]=ends;
  });
  return out;
}
function cbBenchMonthReturn(ends, ym){
  const a=ends&&ends[reportPrevYm(ym)], b=ends&&ends[ym];
  return Number.isFinite(a)&&Number.isFinite(b)?(1+b/100)/(1+a/100)-1:null;
}
function cbTwrOwner(o){ _cbTwrOwner=o; cbRenderPerf(); cbRestoreFilterFocus('cb-perf2','data-twr-owner',o); }
function cbTwrCardHtml(){
  if(typeof reportTwrSeries!=='function') return '';
  const ownerF=_cbTwrOwner==='전체'?null:_cbTwrOwner, todayKey=finLocalDateKey(new Date());
  const series=reportTwrSeries(reportTimeline(ownerF,todayKey),ownerF,reportLastYms(todayKey,12));
  const ok=series.filter(m=>!m.none);
  const ends=cbBenchMonthEnds(benchData['1Y'],todayKey);
  const benchCum={}; ['S&P 500','KOSPI'].forEach(k=>{ let c=1, any=false; ok.forEach(m=>{ const r=cbBenchMonthReturn(ends[k],m.ym); if(r!=null){ c*=1+r; any=true; } }); benchCum[k]=any?c-1:null; });
  const pct=v=>v==null?'—':`${v>=0?'+':''}${(v*100).toFixed(1)}%`;
  const tone=v=>v==null?'color:var(--lab)':v>=0?'color:var(--up)':'color:var(--dn)';
  const ownerBtns=['전체',...OWNERS].map(o=>`<button class="owner-btn${_cbTwrOwner===o?' active':''}" data-twr-owner="${cbEsc(o)}" aria-pressed="${_cbTwrOwner===o}" onclick="cbTwrOwner('${cbEsc(o)}')">${cbEsc(o)}</button>`).join('');
  const head=`<div class="fin-section-head"><span><span data-tip="달마다 '값이 오르내린 몫'을 '월초 금액 + 그 달 넣은 돈의 절반'으로 나눈 수익률을 이어 곱했습니다(시간가중). 돈을 더 넣어서 커진 몫은 빼므로 지수와 같은 잣대로 견줄 수 있습니다.">진짜 내 수익률</span> <span style="color:var(--dim);font-weight:500">· 넣은 돈을 뺀 실제 기록 · 월말 기준</span></span><div class="owner-tabs" role="group" aria-label="소유주">${ownerBtns}</div></div>`;
  if(!ok.length) return `<div class="cb-panel fin-section cb-twr-card">${head}<p class="cb-twr-empty">월말 종목 기록이 두 달 이상 쌓이면 보입니다 — 2026년 10월부터 매일 자동 기록이 남기고 있습니다.</p></div>`;
  const color=ownerF?cbOwnerColor(ownerF):'var(--acc)';
  // 누적 선: 0 에서 시작해 달마다 한 점
  const pts=[{ym:reportPrevYm(ok[0].ym),cum:0,b:{'S&P 500':0,'KOSPI':0}}];
  const bc={'S&P 500':1,'KOSPI':1};
  ok.forEach(m=>{ const b={}; ['S&P 500','KOSPI'].forEach(k=>{ const r=cbBenchMonthReturn(ends[k],m.ym); if(r!=null) bc[k]*=1+r; b[k]=r==null?null:bc[k]-1; }); pts.push({ym:m.ym,cum:m.cum,b}); });
  const W=1100,H=200,pl=52,pr=96,pt=12,pb=26;
  const vals=pts.flatMap(p=>[p.cum,p.b['S&P 500'],p.b.KOSPI]).filter(v=>v!=null);
  const hi=Math.max(0.02,...vals), lo=Math.min(-0.02,...vals), stepRaw=(hi-lo)/4;
  const step=[0.01,0.02,0.05,0.1,0.2,0.5].find(s=>s>=stepRaw)||1;
  const top=Math.ceil(hi/step)*step, bottom=Math.floor(lo/step)*step;
  const X=i=>pl+(pts.length<=1?0:i/(pts.length-1))*(W-pl-pr), Y=v=>pt+(top-v)/(top-bottom)*(H-pt-pb);
  const ticks=[]; for(let v=bottom;v<=top+1e-9;v+=step) ticks.push(v);
  const line=(get,attrs)=>{ let d=''; pts.forEach((p,i)=>{ const v=get(p); if(v==null) return; d+=(d?'L':'M')+X(i).toFixed(1)+','+Y(v).toFixed(1); }); return d?`<path d="${d}" fill="none" ${attrs}/>`:''; };
  const lastI=pts.length-1;
  const endLab=(v,txt,cls)=>v==null?'':`<text x="${X(lastI)+8}" y="${(Y(v)+4).toFixed(1)}" class="cb-twr-end ${cls||''}">${txt} ${pct(v)}</text>`;
  const svg=`<svg viewBox="0 0 ${W} ${H}" class="cb-twr-svg" role="img" aria-label="진짜 내 수익률 누적 ${pct(ok[ok.length-1].cum)}">
    ${ticks.map(v=>`<line x1="${pl}" x2="${W-pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" style="stroke:var(--grid)"${Math.abs(v)<1e-9?' stroke-width="1.5"':''}/><text x="${pl-7}" y="${(Y(v)+4).toFixed(1)}" class="cb-twr-ax" text-anchor="end">${v>0?'+':''}${Math.round(v*100)}%</text>`).join('')}
    ${pts.map((p,i)=>`<text x="${X(i).toFixed(1)}" y="${H-6}" class="cb-twr-ax" text-anchor="middle">${Number(p.ym.slice(5))}월</text>`).join('')}
    ${line(p=>p.b['S&P 500'],`stroke="${CB_PERF_BENCH_COLOR['S&P 500']}" stroke-width="1.5"`)}
    ${line(p=>p.b.KOSPI,`stroke="${CB_PERF_BENCH_COLOR.KOSPI}" stroke-width="1.5" stroke-dasharray="5 4"`)}
    ${line(p=>p.cum,`stroke="${color}" stroke-width="2.4"`)}
    ${pts.map((p,i)=>`<circle cx="${X(i).toFixed(1)}" cy="${Y(p.cum).toFixed(1)}" r="3.5" fill="${color}" stroke="var(--modal-bg)" stroke-width="1.5"><title>${Number(p.ym.slice(5))}월 말 · 누적 ${pct(p.cum)}</title></circle>`).join('')}
    ${endLab(pts[lastI].cum,ownerF?cbEsc(ownerF):'가구','is-own')}${endLab(pts[lastI].b['S&P 500'],'S&P')}${endLab(pts[lastI].b.KOSPI,'KOSPI')}
  </svg>`;
  const last=ok[ok.length-1];
  return `<div class="cb-panel fin-section cb-twr-card">${head}
    <div class="cb-twr-stats">
      <div><small>누적 수익률 · ${ok.length}개월</small><b class="cb-num" style="${tone(last.cum)}">${pct(last.cum)}</b><em>${Number(ok[0].ym.slice(5))}월부터 ${Number(last.ym.slice(5))}월${last.live?'(오늘)':''}까지</em></div>
      <div><small>같은 기간 S&amp;P 500</small><b class="cb-num" style="${tone(benchCum['S&P 500'])}">${pct(benchCum['S&P 500'])}</b><em>${benchCum['S&P 500']!=null&&last.cum!=null?`차이 ${pct(last.cum-benchCum['S&P 500']).replace('%','%p')}`:''}</em></div>
      <div><small>같은 기간 KOSPI</small><b class="cb-num" style="${tone(benchCum.KOSPI)}">${pct(benchCum.KOSPI)}</b><em>${benchCum.KOSPI!=null&&last.cum!=null?`차이 ${pct(last.cum-benchCum.KOSPI).replace('%','%p')}`:''}</em></div>
      <div><small>이 기간 새로 넣은 돈</small><b class="cb-num">${cbSignDisp(ok.reduce((t,m)=>t+m.flow,0))}</b><em>수익률 계산에서 뺀 돈</em></div>
    </div>
    <div class="cb-twr-legend"><span><i style="background:${color}"></i>${ownerF?cbEsc(ownerF):'가구 전체'}</span><span>${cbPerfSwatch({key:'S&P 500',label:'S&P 500',color:CB_PERF_BENCH_COLOR['S&P 500'],isBench:true,dash:false},16)}S&amp;P 500</span><span>${cbPerfSwatch({key:'KOSPI',label:'KOSPI',color:CB_PERF_BENCH_COLOR.KOSPI,isBench:true,dash:true},16)}KOSPI</span></div>
    <div class="cb-chart-scroll"><div class="cb-twr-plot">${svg}</div></div>
    <div class="cb-twr-months">${series.map(m=>m.none?`<div class="is-none"><small>${Number(m.ym.slice(5))}월</small><b>—</b></div>`:`<div${m.live?' class="is-live"':''}><small>${Number(m.ym.slice(5))}월${m.live?' · 진행 중':''}</small><b class="cb-num" style="${tone(m.r)}">${pct(m.r)}</b><em>넣은 돈 ${shortWon(m.flow)}</em></div>`).join('')}</div>
    <small class="fin-callout">아래 '지금 보유 가정' 그래프와 달리 실제로 가졌던 종목·금액의 기록입니다 · 넣은 날짜를 몰라 달 중간에 넣었다고 봅니다(수정 디츠 방식) · 종목 기록이 없는 달은 '—'이고 건너뜁니다</small>
  </div>`;
}
