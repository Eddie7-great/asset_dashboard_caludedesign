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
    const alpha = (!e.isBench && rv!=null && spSel!=null) ? rv-spSel : null;
    return { e, vals: CB_PERF_TFS.map(t=>g(t)), alpha, mdd: mddOf(sel.data[e.key]) };
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
            <span><span data-tip="같은 기간 S&P 500 수익률 대비 차이 (포트폴리오 − S&P 500)">S&amp;P 대비</span></span>
            <span><span data-tip="Max Drawdown — 선택 기간 중 고점 대비 최대 하락폭. 낙폭이 작을수록 하락장 방어력이 좋았다는 뜻입니다.">MDD</span></span>
          </div>
          ${sortedRows.map(r=>`
            <div class="cb-perf-detail-row${r.e.isBench?' is-bench':''}" role="button" tabindex="0" onclick="cbPerfSelToggle('${cbEsc(r.e.key)}')" style="${selKey===r.e.key?'background:var(--accSoft)':(selKey?'opacity:.55':'')}">
              <span class="cb-perf-detail-name">${swatch(r.e,11)}${cbEsc(r.e.label)}</span>
              ${cbPerfBarHtml(r.vals[tfIdx], perfBarMax, r.e.color)}
              ${r.vals.map((v,k)=>`<span class="cb-num" style="${csR(v)}"><span class="cb-perf-value${CB_PERF_TFS[k]===tf?' is-active':''}">${fmtR(v)}</span></span>`).join('')}
              <span class="cb-num" style="${csR(r.alpha)}"><span class="cb-perf-value">${r.alpha==null?'—':fmtR(r.alpha)}</span></span>
              <span class="cb-num" style="${r.mdd==null||r.mdd>=0?'color:var(--lab)':'color:var(--dn)'}"><span class="cb-perf-value">${r.mdd==null?'—':r.mdd.toFixed(1)+'%'}</span></span>
            </div>`).join('')}
        </div>
      </div>
      <div class="cb-perf-detail-note">※ 소유주별 라인은 <b>현재 보유 종목·비중을 기간 시작일부터 그대로 들고 있었다고 가정</b>한 가중 수익률(백캐스트)입니다. 기간 중 매수·매도 시점이 반영되지 않으므로 실제 실현 수익률과 다르며, S&amp;P 대비·MDD도 같은 가정 위에 있습니다. 데이터가 비어 있으면 사이드바의 "새로고침"을 눌러주세요.</div>
    </div>`;
  cbScrollChartsToLatest(el);
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
    t.style.cssText = 'position:fixed;z-index:9999;display:none;pointer-events:none;background:var(--tipbg);color:var(--tiptx);border:1px solid var(--tipbd);border-radius:9px;padding:9px 11px;box-shadow:0 12px 30px rgba(0,0,0,.36);font-size:var(--fs-cap);min-width:158px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;box-sizing:border-box;letter-spacing:0';
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
