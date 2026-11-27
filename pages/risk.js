// 리스크 진단 화면(risk2) — cobalt.js 에서 옮겨 온 화면 렌더러(2026-11-23, 동작 변경 없음).
// cobalt.js 보다 먼저 로드한다(CB_VIEWS 가 이 파일의 렌더 함수를 참조한다). 맨 위에서는 함수·상태 선언만 하고,
// cobalt.js 의 상수·상태는 함수 안에서만 쓴다 — 로드 때 쓰면 아직 없는 이름이라 오류가 난다(test_source_split.mjs).

// ───────────────────────── 페이지: 리스크 진단 ─────────────────────────
// 종목 집중도(ETF 룩스루) 패널 — 직접 보유(파랑) + ETF 간접 보유(주황) 스택 바
function cbLookThroughPanel(ownerFilter){
  const C_DIR = '#5b9bff', C_VIA = '#f2a33c';
  const lt = cbLookThrough(ownerFilter);
  const upC=(typeof cssVar==='function'?cssVar('--up','#178a52'):'#178a52'),
        wnC=(typeof cssVar==='function'?cssVar('--warn','#d97706'):'#d97706'),
        dnC=(typeof cssVar==='function'?cssVar('--dn','#cf3d5c'):'#cf3d5c');
  // ETF 간접 보유가 있는 종목은 모두 표시 + 나머지는 상위 직접 보유로 채움 (최대 12)
  const withVia = lt.list.filter(x=>x.via>0);
  const rest = lt.list.filter(x=>x.via<=0).slice(0, Math.max(0, 10-withVia.length));
  const shown = withVia.concat(rest).sort((a,b)=>b.tot-a.tot).slice(0,12);
  const mx = Math.max(...shown.map(x=>x.pct), 1);

  let body;
  if (!lt.list.length){
    body = '<div style="padding:16px;text-align:center;color:var(--dim);font-size:var(--fs-cap)">개별 주식 보유가 없습니다.</div>';
  } else {
    body = shown.map(x=>{
      const pctColor = x.pct>30 ? dnC : x.pct>20 ? wnC : 'var(--tx)';
      // 회사명 → 직접/간접 비중 → ETF별 간접 비중 순서로 줄바꿈한다.
      // 같은 ETF를 여러 계좌에서 보유한 경우 한 줄로 합쳐 표시하며 원화 금액은 노출하지 않는다.
      const etfMap = new Map();
      x.etfs.forEach(e=>{
        const key = (ownerFilter?'':String(e.owner||'')) + '::' + String(e.etf||'');
        const prev = etfMap.get(key) || { owner:e.owner||'', etf:e.etf||'', val:0 };
        prev.val += Number(e.val)||0;
        etfMap.set(key, prev);
      });
      const pctText = p => p>0 && p<0.01 ? '<0.01%' : p.toFixed(2)+'%';
      const ownerNames = Array.from(x.owners||[]).sort((a,b)=>{
        const ai=OWNERS.indexOf(a), bi=OWNERS.indexOf(b);
        return (ai<0?99:ai)-(bi<0?99:bi);
      });
      const tipLines = [
        x.title,
        ...(!ownerFilter && ownerNames.length ? [`소유주 ${ownerNames.join(' · ')}`] : []),
        `직접 보유 ${x.dPct.toFixed(1)}%`,
        `간접 보유 ${x.vPct.toFixed(1)}%`,
        ...Array.from(etfMap.values()).map(e=>{
          const prefix = ownerFilter ? '' : (e.owner ? e.owner+' · ' : '');
          return `· ${prefix}${e.etf} ${pctText(e.val/lt.nw*100)}`;
        }),
      ];
      const stockTip = cbEsc(tipLines.join('\n'));
      return `
      <div class="cb-lt-row">
        <span class="cb-lt-name">${cbEsc(x.title)}</span>
        <div class="cb-lt-bar">
          <div style="display:flex;gap:2px;height:100%">
            ${x.dPct>0?`<span class="cb-tip-block cb-risk-tip" data-tip="${stockTip}" style="display:block;height:100%;width:${Math.max(0.6,(x.dPct/mx*100)).toFixed(2)}%;background:${C_DIR};border-radius:3px"></span>`:''}
            ${x.vPct>0?`<span class="cb-tip-block cb-risk-tip" data-tip="${stockTip}" style="display:block;height:100%;width:${Math.max(0.6,(x.vPct/mx*100)).toFixed(2)}%;background:${C_VIA};border-radius:3px"></span>`:''}
          </div>
        </div>
        <span class="cb-num cb-lt-pct" style="color:${pctColor}">${x.pct.toFixed(1)}%</span>
        <span class="cb-lt-detail">${
          x.vPct>0 ? `직접 ${x.dPct.toFixed(1)}% + <span style="color:${C_VIA};font-weight:700">ETF ${x.vPct.toFixed(1)}%</span>` : '직접 보유만'
        }</span>
      </div>`;
    }).join('');
  }

  // 각주는 구성종목을 못 받은 ETF 이름만 나열한다 (사유·소스는 노출하지 않음).
  // lt.etfMiss 는 이미 소유주 필터가 적용된 '보유 중인데 데이터가 없는' ETF 목록이고,
  // 수집기의 failures 에 오른 ETF 는 JSON 에 항목이 없으므로 그대로 여기에 잡힌다.
  const notes = lt.etfMiss.length ? ['구성종목 미조회 ETF: ' + lt.etfMiss.map(cbEsc).join(', ')] : [];
  if(lt.etfUncertain?.length)notes.push('일부·지연 자료 포함: '+lt.etfUncertain.map(cbEsc).join(', ')+' · 표시 노출은 확인된 자료만 반영');

  return `
    <div class="cb-panel cb-risk-lt-panel" style="margin-top:12px;padding:15px 17px">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <span class="cb-panel-title"><span class="cb-risk-tip-wide" data-tip="보유 ETF의 구성종목 비중을 풀어서(룩스루) ETF 평가액 × 편입 비중으로 간접 보유분을 계산하고, 직접 보유분과 합산한 실질 종목 비중입니다. 개별 주식으로 직접 보유한 종목만 계산합니다.">종목 집중도 · ETF 룩스루</span> <span style="color:var(--dim)">· ${ownerFilter?cbEsc(ownerFilter)+' 투자자산 대비':'전체 투자자산 대비'}</span></span>
        <div style="display:flex;gap:12px;font-size:var(--fs-cap);color:var(--mut);margin-left:auto;flex-wrap:wrap">
          <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:${C_DIR}"></span>직접 보유</span>
          <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:${C_VIA}"></span>ETF 간접 보유</span>
        </div>
      </div>
      ${body}
      ${notes.length?`<div style="font-size:var(--fs-cap);color:var(--dim);margin-top:8px;line-height:1.6">${notes.map(t=>'※ '+t).join('<br>')}</div>`:''}
    </div>`;
}

// 카드마다 판정 한 단어 — 새 기준을 만들지 않는다. 규칙 카드는 mk() 의 lvl, 보조 진단은
// toneHigh·toneLow 가 고른 색(--up/--warn/--dn)을 그대로 읽고, 그 밖(--lab, 구성종목 확인 전)은 판정 보류다.
function cbRiskVerdict(entry){
  const V={bad:{key:'bad',label:'경고',rank:0},warn:{key:'warn',label:'주의',rank:1},ok:{key:'ok',label:'양호',rank:2},hold:{key:'hold',label:'보류',rank:3}};
  const c=entry&&entry.card||{};
  // 단일 종목 집중도가 ETF 구성 미확인으로 '확인 필요'를 단 경우는 양호가 아니라 보류다(양호 묶음에 접혀 숨지 않게).
  if(entry&&entry.kind==='primary') return c.lvl===2?V.bad:c.lvl===1?V.warn:c.status==='확인 필요'?V.hold:V.ok;
  const t=String(c.tone||'');
  if(t.includes('--dn')) return V.bad;
  if(t.includes('--warn')) return V.warn;
  if(t.includes('--up')) return V.ok;
  return V.hold;
}

// 같은 것을 두 번 재던 카드 세 쌍을 한 장으로 합친다(2026-11-23, 사용자 결정). 판정 기준·점수·계산은 그대로이고 화면에서만 묶는다.
// host = 남는 카드(규칙 카드는 제목, 보조 진단은 id), sub = 그 안에 한 줄로 들어가는 카드.
const CB_RISK_MERGE=[
  {host:'섹터 집중도', sub:'top2-sectors', label:'상위 2개 합계'},
  {host:'환노출 (원화 기준)', sub:'fx-shock', label:'환율 −10% 시'},
  {host:'etf-overlap', sub:'etf-cross-overlap', label:'ETF끼리 겹침', title:'ETF 겹침', hostLabel:'직접 보유 종목과 겹침'},
];
function cbRiskEntryKey(entry){ return entry.kind==='primary'?entry.card.title:entry.card.id; }
// 합친 카드의 판정: 경고·주의가 하나라도 있으면 그중 나쁜 것, 아니면 보류가 있으면 보류(양호로 덮지 않는다), 둘 다 양호면 양호.
function cbRiskMergeVerdict(list){
  const real=list.filter(v=>v&&(v.key==='bad'||v.key==='warn')).sort((a,b)=>a.rank-b.rank);
  if(real.length) return real[0];
  return list.find(v=>v&&v.key==='hold')||list[0];
}
// entries 는 verdict 가 붙은 카드 목록. host 에 sub 를 붙이고 sub 는 목록에서 뺀다(둘 중 하나가 없으면 그대로 둔다).
function cbRiskMergeEntries(entries){
  const byKey=new Map(entries.map(e=>[cbRiskEntryKey(e),e])), drop=new Set();
  CB_RISK_MERGE.forEach(m=>{
    const h=byKey.get(m.host), sub=byKey.get(m.sub);
    if(!h||!sub) return;
    h.subs=(h.subs||[]).concat([{...sub,label:m.label}]);
    if(m.title) h.title=m.title;
    if(m.hostLabel) h.hostLabel=m.hostLabel;
    h.verdict=cbRiskMergeVerdict([h.verdict,sub.verdict]);
    drop.add(sub);
  });
  return entries.filter(e=>!drop.has(e));
}
// 리스크 점검 항목은 한 줄 목록이다(2026-11-24 사용자 결정 — 카드 격자가 점수 카드보다 길어졌다).
// 줄 = 판정 점 · 항목 · 판정 · 값 · 게이지(cbRiskMeterHtml 그대로, 눈금 숫자·방향 포함) · 설명. 값·판정·기준은 카드 때와 같다.
// 합친 부 항목(CB_RISK_MERGE)은 설명 아래 '└ 라벨 판정 값' 한 줄이고, 그 설명은 말풍선에 둔다.
function cbRiskSubHtml(sub){
  const c=sub.card, tip=[c.tip,c.detail].filter(Boolean).join(' · ');
  // 부 항목은 설명 칸 안이 아니라 본 항목 아래 줄 — 이름·판정·값이 위 줄과 같은 칼럼에 선다(2026-11-24 사용자 요청)
  return `<span class="cb-risk-sub-name"${tip?` data-tip="${cbEsc(tip)}"`:''}>└ ${cbEsc(sub.label)}</span><span class="cb-risk-verdict cb-risk-sub-verdict is-${sub.verdict.key}">${sub.verdict.label}</span><b class="cb-risk-sub-val cb-num" style="color:${c.tone}">${cbEsc(c.value)}</b>`;
}
function cbRiskRowHtml(entry){
  const c=entry.card, insight=entry.kind==='insight', v=entry.verdict;
  const title=entry.title||c.title, value=insight?c.value:c.valFmt, tone=insight?c.tone:c.color;
  const msg=String((insight?c.detail:c.msg)||'').replace(/<[^>]*>/g,'');
  const desc=[entry.hostLabel,msg].filter(Boolean).join(' · ');
  const meter=insight?cbRiskMeterHtml(c.meter, c.id==='effective-holdings'?'개':'%', tone)
    :(c.fxMix?cbFxMixHtml(c.fxMix,c.meter):cbRiskMeterHtml(c.meter, c.title==='자산군 분산'?'개':'%', tone));
  const subs=(entry.subs||[]).map(cbRiskSubHtml).join('');
  return `<div class="cb-risk-row is-${v.key}" role="listitem">
      <i class="cb-risk-dot" aria-hidden="true"></i>
      <span class="cb-risk-row-name"${c.tip?` data-tip="${cbEsc(c.tip)}"`:''}>${cbEsc(title)}</span>
      <span class="cb-risk-verdict is-${v.key}">${v.label}</span>
      <b class="cb-risk-row-val cb-num" style="color:${tone}">${cbEsc(value)}</b>
      <div class="cb-risk-row-meter">${meter}</div>
      <div class="cb-risk-row-desc"><span>${cbEsc(desc)}</span></div>${subs}
    </div>`;
}
// 양호 항목은 목록 아래 작은 칩 한 줄 — 이름·값만, 설명은 말풍선(사용자 결정 2026-11-24)
function cbRiskOkChipHtml(entry){
  const c=entry.card, insight=entry.kind==='insight';
  const title=entry.title||c.title, value=insight?c.value:c.valFmt;
  const msg=String((insight?c.detail:c.msg)||'').replace(/<[^>]*>/g,'');
  const subs=(entry.subs||[]).map(s=>`${s.label} ${s.card.value}`).join(' · ');
  const tip=[msg,subs].filter(Boolean).join(' · ');
  return `<li class="cb-risk-ok-chip"${tip?` data-tip="${cbEsc(tip)}"`:''}>${cbEsc(title)} <b class="cb-num">${cbEsc(value)}</b></li>`;
}

function cbRenderRisk(){
  const el = document.getElementById('cb-risk2'); if(!el) return;
  cbEnsureEtfHoldings();
  // 소유주 필터 — cbRisk/cbLookThrough 가 이미 ownerFilter 를 받으므로 점수·카드·룩스루가 함께 갱신된다
  const ownerF = (_cbRiskOwner && _cbRiskOwner!=='전체') ? _cbRiskOwner : null;
  const r = cbRisk(ownerF);
  const insights = cbRiskInsights(ownerF,r);
  // 행 수를 고정하면(예전 4행) 카드를 하나 추가했을 때 화면에서 조용히 사라진다.
  const gridRows=Math.max(Math.ceil(r.cards.length/2),Math.ceil(insights.length/2));
  const riskGridCards=Array.from({length:gridRows},(_,row)=>[
    ...r.cards.slice(row*2,row*2+2).map(card=>({kind:'primary',card})),
    ...insights.slice(row*2,row*2+2).map(card=>({kind:'insight',card})),
  ]).flat()
    // 확인할 것이 먼저 — 경고 → 주의 → 양호 → 보류 순. 같은 단계 안에서는 기존 교차 순서를 유지한다.
    .map((entry,idx)=>({...entry,idx,verdict:cbRiskVerdict(entry)}));
  // 겹치는 세 쌍을 합친 뒤(16→13장) 확인할 것 → 양호 순. 양호 카드는 아래 접힘 묶음으로 보낸다.
  const mergedCards=cbRiskMergeEntries(riskGridCards)
    .sort((a,b)=>a.verdict.rank-b.verdict.rank||a.idx-b.idx);
  const okCards=mergedCards.filter(e=>e.verdict.key==='ok'), mainCards=mergedCards.filter(e=>e.verdict.key!=='ok');
  cbSetHead('규칙 기반 자동 점검', cbOwnerBtns(_cbRiskOwner,'cbRiskOwner'));
  const counts=['bad','warn','hold','ok'].map(k=>{
    const n=mergedCards.filter(e=>e.verdict.key===k).length, lab={bad:'경고',warn:'주의',hold:'보류',ok:'양호'}[k];
    return n?`<span class="is-${k}">${lab} ${n}</span>`:'';
  }).filter(Boolean).join('');
  el.innerHTML = `
    <div class="cb-risk-overview">
      <div class="cb-panel cb-risk-score-card">
        <div style="position:relative;width:136px;height:136px;display:flex;align-items:center;justify-content:center">
          ${cbRingSvg(r.score,136,r.color,r.provisional)}
          <div style="position:absolute;text-align:center">
            <div style="font-family:var(--font-ui);font-size:34px;font-weight:800;color:${r.provisional?'var(--lab)':r.color}">${r.score}</div>
            <div data-tip="0~100점 척도이며 점수가 높을수록 안정적입니다. 위험 신호마다 감점되어 0점까지 내려갈 수 있습니다." style="font-size:var(--fs-cap);color:var(--lab)">/ 100</div>
          </div>
        </div>
        <div style="font-size:var(--fs-card);font-weight:800;margin-top:10px;color:${r.provisional?'var(--lab)':r.color}">${r.grade}</div>
        <div style="font-size:var(--fs-cap);color:var(--mut);text-align:center;line-height:1.6;margin-top:6px">${r.provisional?'ETF 구성 자료 확인 전 잠정 점수입니다.':r.warns===0?'모든 점검 항목이 양호합니다.':r.warns+'개 항목에서 주의·경고가 발견되었습니다.'}</div>
        <div class="cb-risk-priorities"><b data-tip="선택 소유주 기준 규칙 점검입니다. 손실 확률 예측이 아닙니다.">먼저 확인할 항목</b>${r.cards.filter(c=>c.lvl>0).slice().sort((a,b)=>b.lvl-a.lvl).slice(0,3).map(c=>`<p><strong>${cbEsc(c.title)}</strong><span>${cbSentenceHtml(c.msg)}</span></p>`).join('')||'<p>현재 규칙에서 감지된 주의 항목이 없습니다.</p>'}</div>
        <div style="width:100%;margin-top:auto;padding-top:12px;border-top:1px solid var(--bd);display:flex;flex-direction:column;gap:6px;align-self:stretch">
          <div style="display:flex;justify-content:space-between;font-size:var(--fs-cap)"><span style="color:var(--mut)"><span data-tip="자산군별 역사적 변동성의 보유비중 가중평균이며, 레버리지·인버스 상품은 노출 배수만큼 키워 반영합니다. 1년간 수익률이 오르내리는 폭의 추정치입니다. 종목별 실제 변동성이나 종목 간 상관관계는 반영하지 않습니다.">추정 연 변동성</span></span><span style="font-weight:700">${r.vol.toFixed(1)}%</span></div>
          <div style="display:flex;justify-content:space-between;font-size:var(--fs-cap)"><span style="color:var(--mut)"><span data-tip="원화가 아닌 통화(USD·JPY)로 표시된 자산의 비중. 환율 변동에 노출됩니다.">환노출</span></span><span style="font-weight:700">${r.fxPct.toFixed(1)}%</span></div>
          <div style="display:flex;justify-content:space-between;font-size:var(--fs-cap)"><span style="color:var(--mut)">현금 비중</span><span style="font-weight:700">${r.cashPct.toFixed(1)}%</span></div>
        </div>
      </div>
      <section class="cb-panel cb-risk-list-panel" aria-label="리스크 점검 항목">
        <div class="cb-risk-list-title"><b>점검 항목</b><span class="cb-risk-counts">${counts}</span></div>
        ${mainCards.length?`<div class="cb-risk-list-head" aria-hidden="true"><span></span><span>항목</span><span class="c">판정</span><span class="r">값</span><span>위치 <small>(눈금 = 주의·위험)</small></span><span>설명</span></div>
        <div class="cb-risk-list" role="list">${mainCards.map(cbRiskRowHtml).join('')}</div>`:'<p class="cb-risk-all-ok">확인할 항목이 없습니다. 모든 점검 항목이 양호합니다.</p>'}
        ${okCards.length?`<div class="cb-risk-ok-line"><b>양호 ${okCards.length}</b><ul>${okCards.map(cbRiskOkChipHtml).join('')}</ul></div>`:''}
      </section>
    </div>
    <div class="cb-risk-extra">${cbDrawdownCardHtml(ownerF)}${cbStressCardHtml()}</div>
    ${cbVolCorrCardHtml(ownerF)}
    ${cbLookThroughPanel(ownerF)}`;
}
function cbRiskOwner(o){ _cbRiskOwner=o; cbRenderRisk(); cbRestoreFilterFocus('cb-head-widgets','data-owner',o); }

// ── 실제 가격으로 본 흔들림(2026-11-25 시안) — 변동성(추정 vs 실제)과 종목끼리 함께 움직인 정도(상관관계) ──
// 일봉은 차트 공부와 같은 2년 일봉·같은 캐시(_chsCache)를 쓴다. 주식·ETF 상위 8종목만(조회 수를 묶어 둔다).
const CB_CORR_TOP = 8;
const _cbCorrInflight = new Set();
// 일별 로그수익률 표준편차 × √252 — 최근 252거래일(약 1년).
function cbRealVol(bars){
  const c=(bars||[]).slice(-253).map(b=>b.c).filter(v=>v>0);
  if(c.length<40) return null;
  const r=c.slice(1).map((v,i)=>Math.log(v/c[i]));
  const m=r.reduce((s,v)=>s+v,0)/r.length;
  return Math.sqrt(r.reduce((s,v)=>s+(v-m)*(v-m),0)/(r.length-1))*Math.sqrt(252);
}
// 누적 %(성과 그래프 시리즈) → 실제 연 변동성. 지금 보유를 1년 들고 있었다고 본 값이다(성과 그래프와 같은 가정).
function cbRealVolFromCum(cum){
  const idx=(cum||[]).filter(Number.isFinite).map(v=>1+v/100).filter(v=>v>0);
  if(idx.length<40) return null;
  const r=idx.slice(1).map((v,i)=>Math.log(v/idx[i]));
  const m=r.reduce((s,v)=>s+v,0)/r.length;
  return Math.sqrt(r.reduce((s,v)=>s+(v-m)*(v-m),0)/(r.length-1))*Math.sqrt(252);
}
// 주간 종가(그 주 마지막 거래일) — 한국·미국은 장 시간이 달라 같은 날짜로 맞대면 상관이 낮게 나온다. 주 단위로 묶어 그 어긋남을 줄인다.
function cbWeeklyCloses(bars){
  const m=new Map();
  (bars||[]).forEach(b=>{ const d=new Date(b.t*1000); const k=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-((d.getUTCDay()+6)%7))).toISOString().slice(0,10); m.set(k,b.c); });
  return m;
}
// 두 종목의 최근 52주 주간 수익률 상관계수(-1~1). 겹치는 주가 20주보다 적으면 null.
function cbCorrPair(wa, wb){
  const keys=[...wa.keys()].filter(k=>wb.has(k)).sort().slice(-53);
  if(keys.length<21) return null;
  const ra=[], rb=[];
  for(let i=1;i<keys.length;i++){ ra.push(Math.log(wa.get(keys[i])/wa.get(keys[i-1]))); rb.push(Math.log(wb.get(keys[i])/wb.get(keys[i-1]))); }
  const ma=ra.reduce((s,v)=>s+v,0)/ra.length, mb=rb.reduce((s,v)=>s+v,0)/rb.length;
  let sab=0,saa=0,sbb=0; ra.forEach((v,i)=>{ const x=v-ma,y=rb[i]-mb; sab+=x*y; saa+=x*x; sbb+=y*y; });
  return saa>0&&sbb>0 ? sab/Math.sqrt(saa*sbb) : null;
}
function cbCorrEnsure(tkrs){
  if(typeof _chsCache==='undefined'||typeof chsFetchBars!=='function') return;
  const need=tkrs.filter(t=>!_chsCache[t]&&!_chsErr[t]&&!_cbCorrInflight.has(t));
  if(!need.length) return;
  need.forEach(t=>_cbCorrInflight.add(t));
  (async()=>{
    for(let k=0;k<need.length;k+=2){
      await Promise.all(need.slice(k,k+2).map(async t=>{
        try{ _chsCache[t]=await chsFetchBars(t); }catch(e){ _chsErr[t]=(e&&e.message)||'조회 실패'; }
        finally{ _cbCorrInflight.delete(t); }
      }));
    }
    const box=document.getElementById('cb-volcorr');
    if(box&&_cobaltActive==='risk2') box.outerHTML=cbVolCorrCardHtml((_cbRiskOwner&&_cbRiskOwner!=='전체')?_cbRiskOwner:null);
  })();
}
function cbCorrCellStyle(v){
  if(v==null) return 'background:var(--inner)';
  const a=Math.round(8+Math.min(1,Math.abs(v))*62);
  return `background:color-mix(in srgb, ${v>=0?'var(--acc)':'var(--warn)'} ${a}%, transparent)`;
}
function cbVolCorrCardHtml(ownerF){
  const list=(typeof chsHoldings==='function'?chsHoldings(ownerF):[]).slice(0,CB_CORR_TOP);
  const head=`<div class="cb-vc-head"><div class="cb-panel-title"><span data-tip="리스크 점수의 '추정 연 변동성'은 자산군 평균값입니다. 이 카드는 실제 일봉으로 지난 1년 동안 얼마나 오르내렸는지, 종목끼리 얼마나 함께 움직였는지를 잽니다.">실제 가격으로 본 흔들림</span> <small>· 지난 1년 · 주식·ETF 상위 ${CB_CORR_TOP}종목</small></div></div>`;
  if(list.length<2) return `<div class="cb-panel cb-vc-card" id="cb-volcorr">${head}<p class="cb-dd-empty">주식·ETF가 두 종목 이상일 때 그립니다.</p></div>`;
  cbCorrEnsure(list.map(r=>r.tkr));
  const ready=list.filter(r=>_chsCache[r.tkr]);
  const pending=list.filter(r=>!_chsCache[r.tkr]&&!_chsErr[r.tkr]).length, failed=list.filter(r=>_chsErr[r.tkr]);
  const key=ownerF||'전체', sel=(typeof benchData!=='undefined'&&benchData['1Y'])||{data:{}};
  const est=cbRisk(ownerF).vol, real=cbRealVolFromCum(sel.data[key]);
  const spx=cbRealVolFromCum(sel.data['S&P 500']), ksp=cbRealVolFromCum(sel.data['KOSPI']);
  const estOf=r=>{ const lev=cbLeveragedInverseMeta(r.ref); return (CB_VOL[cbCls(r.ref)]||0)*(lev?lev.mult:1)*100; };
  const name=r=>{ const us=cbCls(r.ref)==='us'; return us?r.tkr:(r.name||r.tkr); };
  const volRows=list.map(r=>({r, est:estOf(r), real:_chsCache[r.tkr]?cbRealVol(_chsCache[r.tkr].bars):null}));
  const vmax=Math.max(40,...volRows.map(x=>Math.max(x.est,(x.real||0)*100)));
  const bar=(v,cls)=>v==null?'':`<i class="${cls}" style="width:${Math.min(100,v/vmax*100).toFixed(1)}%"></i>`;
  const weekly=new Map(ready.map(r=>[r.tkr,cbWeeklyCloses(_chsCache[r.tkr].bars)]));
  const pairs=[]; ready.forEach((a,i)=>ready.slice(i+1).forEach(b=>{ const c=cbCorrPair(weekly.get(a.tkr),weekly.get(b.tkr)); if(c!=null) pairs.push({a,b,c}); }));
  const hi=pairs.slice().sort((x,y)=>y.c-x.c)[0], lo=pairs.slice().sort((x,y)=>x.c-y.c)[0];
  const avg=pairs.length?pairs.reduce((s,p)=>s+p.c,0)/pairs.length:null;
  const corrOf=(a,b)=>a===b?1:(pairs.find(p=>(p.a===a&&p.b===b)||(p.a===b&&p.b===a))||{}).c;
  const pctTxt=v=>v==null?'—':v.toFixed(0)+'%';
  return `<div class="cb-panel cb-vc-card" id="cb-volcorr">${head}
    <div class="cb-vc-body">
      <div class="cb-vc-vol">
        <div class="cb-vc-sum">
          <div><small>점수에 쓰는 추정</small><b>${est.toFixed(0)}%</b><em>자산군 평균</em></div>
          <div><small>실제 1년</small><b>${pctTxt(real==null?null:real*100)}</b><em>${real==null?'성과 자료 받은 뒤':'지금 보유 가정 일봉'}</em></div>
          <div><small>비교</small><b class="cb-vc-bench">S&amp;P ${pctTxt(spx==null?null:spx*100)} · KOSPI ${pctTxt(ksp==null?null:ksp*100)}</b><em>같은 기간 지수</em></div>
        </div>
        <div class="cb-vc-vhead" aria-hidden="true"><span>종목</span><span>연 변동성 <small><i class="est"></i>추정 <i class="real"></i>실제</small></span><span class="r">실제</span></div>
        ${volRows.map(x=>`<div class="cb-vc-vrow"><span class="cb-vc-name" title="${cbEsc(x.r.name)}">${cbEsc(name(x.r))}</span><span class="cb-vc-bars">${bar(x.est,'est')}${bar(x.real==null?null:x.real*100,'real')}</span><b class="cb-num r">${x.real==null?(_chsErr[x.r.tkr]?'—':'…'):(x.real*100).toFixed(0)+'%'}</b></div>`).join('')}
      </div>
      <div class="cb-vc-corr">
        <div class="cb-vc-corr-title"><b>함께 움직인 정도</b><small>주간 수익률 상관 · 1 = 똑같이 · 0 = 따로 · −1 = 반대로 · 진할수록 같이 움직임</small></div>
        ${ready.length>=2?`<div class="cb-vc-grid" style="grid-template-columns:minmax(64px,auto) repeat(${ready.length},minmax(0,1fr))" role="table" aria-label="종목 간 상관계수">
          <span></span>${ready.map(r=>`<span class="cb-vc-col" title="${cbEsc(r.name)}">${cbEsc(name(r))}</span>`).join('')}
          ${ready.map(a=>`<span class="cb-vc-rowh" title="${cbEsc(a.name)}">${cbEsc(name(a))}</span>${ready.map(b=>{ const v=corrOf(a,b); return a===b?'<span class="cb-vc-cell is-self">—</span>':`<span class="cb-vc-cell cb-tip-block" style="${cbCorrCellStyle(v)}" data-tip="${cbEsc(name(a))} · ${cbEsc(name(b))} 상관 ${v==null?'자료 부족':v.toFixed(2)}">${v==null?'·':(Math.abs(v)<0.05?0:v).toFixed(1)}</span>`; }).join('')}`).join('')}
        </div>
        <div class="cb-vc-notes">${hi?`<p><b>가장 같이 움직임</b> ${cbEsc(name(hi.a))} · ${cbEsc(name(hi.b))} <span class="cb-num">${hi.c.toFixed(2)}</span></p>`:''}${lo?`<p><b>가장 따로 움직임</b> ${cbEsc(name(lo.a))} · ${cbEsc(name(lo.b))} <span class="cb-num">${lo.c.toFixed(2)}</span></p>`:''}${avg!=null?`<p><b>평균</b> <span class="cb-num">${avg.toFixed(2)}</span> — ${avg>=.6?'대부분 같은 방향이라 함께 빠질 때 분산 효과가 작습니다':avg>=.3?'어느 정도 같이 움직입니다':'종목끼리 꽤 따로 움직입니다'}</p>`:''}</div>`
        :`<p class="cb-dd-empty" role="status">${pending?`일봉을 받는 중… (${ready.length}/${list.length})`:'일봉을 받지 못해 그릴 수 없습니다.'}</p>`}
      </div>
    </div>
    <p class="cb-vc-foot">각 종목의 거래 통화 기준(환율 효과 제외) · 한국·미국은 장 시간이 달라 주 단위로 맞댐${failed.length?` · 일봉 못 받음: ${failed.map(r=>cbEsc(name(r))).join(', ')}`:''}${pending&&ready.length>=2?` · ${pending}종목 받는 중`:''}</p>
  </div>`;
}

// ── 고점 대비 하락(2026-11-25 시안) ──
// 성과 화면과 같은 벤치마크 시리즈(benchData['1Y'] — 지금 보유 종목을 1년 내내 들고 있었다고 가정한 누적 %)를
// 지수(1 + %/100)로 바꿔 고점 대비 몇 % 아래인지를 날마다 잰다. 넣고 뺀 돈이 섞이지 않는 가격 기준이라
// '지금 들고 있는 것이 지난 1년 동안 얼마나 깊이, 얼마나 오래 빠졌나'를 보여 준다. 새 시세 조회는 없다.
function cbDrawdownSeries(cum){
  const out=[]; let peak=null;
  (cum||[]).forEach(v=>{
    if(!Number.isFinite(v)){ out.push(null); return; }
    const idx=1+v/100; peak=peak==null?idx:Math.max(peak,idx);
    out.push(peak>0?(idx/peak-1)*100:null);
  });
  return out;
}
// 가장 깊은 하락과 그 뒤 고점 회복까지 걸린 거래일. 아직 회복 전이면 recoverDays=null.
function cbDrawdownStats(dd){
  const pts=(dd||[]).map((v,i)=>({v,i})).filter(p=>p.v!=null);
  if(pts.length<2) return null;
  let worst=pts[0]; pts.forEach(p=>{ if(p.v<worst.v) worst=p; });
  let start=worst.i; while(start>0&&dd[start-1]!=null&&dd[start-1]<0) start--;
  let rec=null; for(let i=worst.i+1;i<dd.length;i++){ if(dd[i]!=null&&dd[i]>=-1e-9){ rec=i; break; } }
  const now=pts[pts.length-1].v;
  return {max:worst.v, at:worst.i, start, fallDays:worst.i-start, recoverDays:rec==null?null:rec-worst.i, now};
}
function cbDrawdownCardHtml(ownerF){
  const key=ownerF||'전체', sel=benchData['1Y']||{labels:[],data:{}};
  const own=cbDrawdownSeries(sel.data[key]);
  const st=cbDrawdownStats(own);
  const head=`<div class="cb-dd-head"><div class="cb-panel-title"><span data-tip="성과 화면의 1년 그래프와 같은 가정입니다 — 지금 보유 종목·비중을 1년 내내 들고 있었다고 보고, 고점에서 몇 % 아래였는지를 날마다 그렸습니다. 넣고 뺀 돈은 섞이지 않습니다.">고점 대비 하락</span> <small>· 지금 보유 그대로 지난 1년</small></div></div>`;
  if(!st) return `<div class="cb-panel cb-dd-card">${head}<p class="cb-dd-empty">성과 자료(1년)를 받은 뒤에 그립니다. 사이드바의 새로고침을 눌러 보세요.</p></div>`;
  const bench=[['S&P 500',false],['KOSPI',true]].map(([k,dash])=>({k,dash,dd:cbDrawdownSeries(sel.data[k])})).filter(b=>b.dd.some(v=>v!=null));
  const W=560,H=200,pl=44,pr=12,pt=10,pb=24, n=own.length;
  const lo=Math.min(-5,...own.filter(v=>v!=null),...bench.flatMap(b=>b.dd.filter(v=>v!=null)));
  const step=lo<-40?20:lo<-20?10:5, bottom=Math.floor(lo/step)*step;
  const X=i=>pl+(n<=1?0:i/(n-1))*(W-pl-pr), Y=v=>pt+(v/bottom)*(H-pt-pb);
  const path=dd=>dd.map((v,i)=>v==null?'':`${i&&dd[i-1]!=null?'L':'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const ticks=[]; for(let v=0;v>=bottom;v-=step) ticks.push(v);
  const labels=sel.labels||[], lastM={}; const xt=labels.map((l,i)=>{ const m=String(l).slice(0,2); if(lastM.m===m||i===0) {lastM.m=m;return '';} lastM.m=m; return Number(m)%3===1?`<text x="${X(i).toFixed(1)}" y="${H-6}" class="cb-dd-ax" text-anchor="middle">${Number(m)}월</text>`:''; }).join('');
  const color=key==='전체'?'var(--acc)':cbOwnerColor(key);
  const area=`M${X(0)},${Y(0)} `+own.map((v,i)=>v==null?'':`L${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('')+` L${X(n-1)},${Y(0)} Z`;
  const bst=bench.map(b=>({k:b.k,dash:b.dash,st:cbDrawdownStats(b.dd)}));
  const fmt=v=>v==null?'—':`${v.toFixed(1)}%`;
  const dateOf=i=>{ const l=String(labels[i]||''); return l?`${Number(l.slice(0,2))}월 ${Number(l.slice(3,5))}일`:''; };
  return `<div class="cb-panel cb-dd-card">${head}
    <div class="cb-dd-stats">
      <div><small>가장 깊었던 하락</small><b class="cb-num" style="color:var(--dn)">${fmt(st.max)}</b><em>${dateOf(st.at)} · 고점에서 ${st.fallDays}거래일 만에</em></div>
      <div><small>회복까지</small><b class="cb-num">${st.recoverDays==null?'아직 회복 전':st.recoverDays+'거래일'}</b><em>${st.recoverDays==null?'바닥 이후 고점을 다시 넘지 못함':'바닥에서 고점을 다시 넘을 때까지'}</em></div>
      <div><small>지금 고점 대비</small><b class="cb-num" style="${st.now<-0.05?'color:var(--dn)':'color:var(--up)'}">${st.now<-0.05?fmt(st.now):'고점'}</b><em>${bst.map(b=>`${b.k} 최대 ${fmt(b.st&&b.st.max)}`).join(' · ')}</em></div>
    </div>
    <div class="cb-dd-legend"><span><i style="background:${color}"></i>${cbEsc(key==='전체'?'가구 전체':key)}</span>${bench.map(b=>`<span>${cbPerfSwatch({key:b.k,label:b.k,color:CB_PERF_BENCH_COLOR[b.k],isBench:true,dash:b.dash},16)}${b.k}</span>`).join('')}</div>
    <svg viewBox="0 0 ${W} ${H}" class="cb-dd-svg" role="img" aria-label="고점 대비 하락 그래프 — 가장 깊은 하락 ${fmt(st.max)}">
      ${ticks.map(v=>`<line x1="${pl}" x2="${W-pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" style="stroke:var(--grid)"/><text x="${pl-6}" y="${(Y(v)+4).toFixed(1)}" class="cb-dd-ax" text-anchor="end">${v}%</text>`).join('')}
      ${xt}
      ${bench.map(b=>`<path d="${path(b.dd)}" fill="none" stroke="${CB_PERF_BENCH_COLOR[b.k]}" stroke-width="1.4"${b.dash?' stroke-dasharray="5 4"':''}/>`).join('')}
      <path d="${area}" fill="${color}" fill-opacity=".16"/>
      <path d="${path(own)}" fill="none" stroke="${color}" stroke-width="2"/>
      <circle cx="${X(st.at).toFixed(1)}" cy="${Y(st.max).toFixed(1)}" r="4" fill="${color}" stroke="var(--modal-bg)" stroke-width="2"/>
      <text x="${Math.min(W-pr-4,X(st.at)+8).toFixed(1)}" y="${(Y(st.max)+4).toFixed(1)}" class="cb-dd-lab"${X(st.at)>W-120?' text-anchor="end"':''}>${fmt(st.max)}</text>
    </svg>
    <small class="cb-dd-note">지금 보유를 과거에 그대로 들고 있었다고 가정한 값입니다(실제 계좌 기록 아님) · 1년 안의 고점 기준</small>
  </div>`;
}

// ── 스트레스 테스트(2026-11-25 시안) ──
// '이런 일이 생기면 지금 자산이 얼마가 되나'를 자산군별 가정 하나씩으로 계산한다. 예측이 아니라 가정의 산수다.
// 레버리지·인버스는 노출 배수만큼(cbLeveragedInverseMeta) 키우고 인버스는 방향을 뒤집는다.
// 환율 가정은 원화가 아닌 자산 + 가상화폐·금(국제 가격이 달러)에 곱한다.
const CB_STRESS_KEYS=[['us','미국 주식'],['kr','한국 주식'],['jp','일본 주식'],['crypto','가상화폐'],['gold','금'],['fx','원/달러 환율']];
const CB_STRESS_PRESETS=[
  {id:'mild',label:'가벼운 조정',s:{us:-10,kr:-10,jp:-10,crypto:-20,gold:0,fx:0}},
  {id:'crash',label:'큰 하락',s:{us:-30,kr:-30,jp:-30,crypto:-60,gold:5,fx:10}},
  {id:'krw',label:'원화 강세',s:{us:0,kr:0,jp:0,crypto:0,gold:0,fx:-10}},
  {id:'coin',label:'코인만 반토막',s:{us:0,kr:0,jp:0,crypto:-50,gold:0,fx:0}},
];
let _cbStress={id:'crash',s:{...CB_STRESS_PRESETS[1].s}};
function cbStressRun(items, s){
  const by={}, owners={}; let before=0, after=0;
  (items||[]).forEach(i=>{
    const v=assetValueKRW(i); if(!(v>0)) return;
    const cls=cbCls(i), lev=cls==='crypto'||cls==='gold'||cls==='cash'?null:cbLeveragedInverseMeta(i);
    const shock=(Number(s[cls])||0)/100*(lev?(lev.kind==='인버스'?-lev.mult:lev.mult):1);
    const fxHit=(i.cur&&i.cur!=='KRW')||cls==='crypto'||cls==='gold';
    const nv=Math.max(0,v*(1+shock)*(fxHit?1+(Number(s.fx)||0)/100:1));
    before+=v; after+=nv;
    const b=by[cls]||(by[cls]={cls,before:0,after:0}); b.before+=v; b.after+=nv;
    const o=owners[i.owner]||(owners[i.owner]={owner:i.owner,before:0,after:0}); o.before+=v; o.after+=nv;
  });
  return {before, after, diff:after-before, pct:before>0?(after/before-1)*100:0,
    byCls:Object.values(by).sort((a,b)=>(a.after-a.before)-(b.after-b.before)),
    byOwner:OWNERS.map(o=>owners[o]).filter(Boolean)};
}
function cbStressPreset(id){ const p=CB_STRESS_PRESETS.find(x=>x.id===id); if(!p) return; _cbStress={id,s:{...p.s}}; cbRenderRisk(); }
function cbStressSet(k,v){ _cbStress.id='custom'; _cbStress.s[k]=Math.max(-100,Math.min(300,Number(String(v).replace(/[^0-9.-]/g,''))||0)); const box=document.getElementById('cb-stress-result'); if(box) box.innerHTML=cbStressResultHtml(); document.querySelectorAll('[data-stress-preset]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false');}); }
function cbStressResultHtml(){
  const ownerF=(_cbRiskOwner&&_cbRiskOwner!=='전체')?_cbRiskOwner:null;
  const items=(pfolioData||[]).filter(i=>i&&(Number(i.qty)||0)>0&&(!ownerF||i.owner===ownerF));
  const r=cbStressRun(items,_cbStress.s);
  const maxAbs=Math.max(1,...r.byCls.map(b=>Math.abs(b.after-b.before)));
  const clsName=c=>(CB_CLS[c]&&CB_CLS[c].label)||c;
  return `<div class="cb-stress-hero"><small>지금 투자자산 ${cbKrw(r.before)} →</small><b class="cb-num">${cbKrw(r.after)}</b><em class="cb-num" style="${r.diff<0?'color:var(--dn)':r.diff>0?'color:var(--up)':''}">${r.diff>0?'+':''}${cbKrw(r.diff)} (${r.pct>0?'+':''}${r.pct.toFixed(1)}%)</em></div>
    <div class="cb-stress-bars">${r.byCls.filter(b=>Math.abs(b.after-b.before)>=1).map(b=>{const d=b.after-b.before;return `<div class="cb-stress-bar"><span><i style="background:${(CB_CLS[b.cls]||{}).color||'var(--lab)'}"></i>${clsName(b.cls)}</span><div class="cb-stress-track"><i class="${d<0?'is-dn':'is-up'}" style="width:${(Math.abs(d)/maxAbs*100).toFixed(1)}%"></i></div><b class="cb-num" style="${d<0?'color:var(--dn)':'color:var(--up)'}">${d>0?'+':''}${shortWon(d)}</b></div>`;}).join('')||'<p class="cb-dd-empty">이 가정에서는 바뀌는 자산이 없습니다.</p>'}</div>
    ${!ownerF&&r.byOwner.length>1?`<div class="cb-stress-owners">${r.byOwner.map(o=>{const d=o.after-o.before;return `<span>${cbOwnerTag(o.owner)} <b class="cb-num" style="${d<0?'color:var(--dn)':d>0?'color:var(--up)':''}">${d>0?'+':''}${shortWon(d)}</b> <small>${o.before>0?((o.after/o.before-1)*100).toFixed(1):'0.0'}%</small></span>`;}).join('')}</div>`:''}`;
}
function cbStressCardHtml(){
  return `<div class="cb-panel cb-stress-card">
    <div class="cb-dd-head"><div class="cb-panel-title"><span data-tip="자산군마다 가정한 변화율을 지금 평가액에 곱한 결과입니다. 레버리지·인버스는 배수만큼 키우고, 환율 가정은 외화 자산·가상화폐·금에 함께 곱합니다. 예측이 아닙니다.">스트레스 테스트</span> <small>· 이런 일이 생기면</small></div></div>
    <div class="owner-tabs cb-stress-presets" role="group" aria-label="가정 고르기">${CB_STRESS_PRESETS.map(p=>`<button class="owner-btn${_cbStress.id===p.id?' active':''}" data-stress-preset="${p.id}" aria-pressed="${_cbStress.id===p.id}" onclick="cbStressPreset('${p.id}')">${p.label}</button>`).join('')}</div>
    <div class="cb-stress-inputs">${CB_STRESS_KEYS.map(([k,l])=>`<label><span>${l}</span><span class="cb-stress-in"><input class="cb-input" inputmode="decimal" data-neg="1" data-no-comma="1" value="${_cbStress.s[k]}" oninput="cbStressSet('${k}',this.value)"><em>%</em></span></label>`).join('')}</div>
    <div id="cb-stress-result" aria-live="polite">${cbStressResultHtml()}</div>
    <small class="cb-dd-note">환율 +10% = 원화 약세(1달러가 10% 더 비싸짐) — 외화 자산의 원화 값이 오릅니다 · 위기 때 원화가 약해지는 일이 많아 해외 자산이 손실을 일부 메웁니다</small>
  </div>`;
}
