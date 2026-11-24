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
    <div class="cb-panel" style="margin-top:12px;padding:15px 17px">
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
let _cbRiskOkOpen=false;   // '양호' 묶음 펼침 — 화면을 옮기면 접힌다(cbResetViewState)
function cbRiskEntryKey(entry){ return entry.kind==='primary'?entry.card.title:entry.card.id; }
// 합친 카드의 판정: 경고·주의가 하나라도 있으면 그중 나쁜 것, 아니면 보류가 있으면 보류(양호로 덮지 않는다), 둘 다 양호면 양호.
// 리스크 카드 격자에 빈 칸을 남기지 않는다(사용자 결정 2026-11-23). 넓은 화면은 12칸 격자에서
// 한 줄 칸 수를 고른다 — 4·3 으로 나눠떨어지면 그 수, 아니면 4 이고 마지막 줄 카드가 남는 폭을 나눠 갖는다.
// 돌려주는 값은 카드마다 12칸 중 차지하는 폭(3·4·6·12).
// 2026-11-24(사용자 요청): 한 줄에 최대 3장 — 4장을 놓으면 카드가 약 210px 로 좁아져 제목이 두 줄이 되고
// '낮을수록 안전'이 눈금 숫자에 붙었다. 3장씩 채우고, 남는 1장은 혼자 한 줄을 다 쓰지 않게 마지막 두 줄을 2장씩으로 나눈다.
function cbRiskFillSpans(n){
  if(!(n>0)) return [];
  const rows=[];
  let left=n;
  while(left>0){
    if(left===4){ rows.push(2,2); break; }
    const k=Math.min(3,left); rows.push(k); left-=k;
  }
  return rows.flatMap(k=>Array(k).fill(12/k));
}
// 2칸 화면(1200px 이하)에서는 홀수 개일 때 마지막 카드가 한 줄을 다 쓴다.
function cbRiskFillGrid(entries,cardHtml){
  const spans=cbRiskFillSpans(entries.length), odd=entries.length%2===1;
  return entries.map((e,i)=>cardHtml(e,` cb-risk-span-${spans[i]}${odd&&i===entries.length-1?' is-odd-last':''}`)).join('');
}
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
function cbRiskSubHtml(sub){
  const c=sub.card;
  return `<div class="cb-risk-sub" style="--risk-tone:${c.tone}">
      <div class="cb-risk-sub-head"><span${c.tip?` data-tip="${cbEsc(c.tip)}"`:''}>${cbEsc(sub.label)}</span><span class="cb-risk-verdict is-${sub.verdict.key}">${sub.verdict.label}</span><b class="cb-num">${cbEsc(c.value)}</b></div>
      ${cbRiskMeterHtml(c.meter,'%',c.tone)}
      <small>${cbEsc(c.detail)}</small>
    </div>`;
}
// 양호 카드는 펼쳐도 게이지 없이 '이름 · 값 · 한 줄 설명' 목록이다(사용자 결정 2026-11-23 — 카드 7장은 난잡했다).
// 값·설명은 카드에 있던 것 그대로이고 합친 부 카드는 '라벨 값'으로 뒤에 붙인다.
function cbRiskOkRowHtml(entry){
  const c=entry.card, insight=entry.kind==='insight';
  const title=entry.title||c.title, value=insight?c.value:c.valFmt, msg=insight?c.detail:c.msg, tip=c.tip;
  const subs=(entry.subs||[]).map(s=>`<span class="cb-risk-ok-sub">${cbEsc(s.label)} <b class="cb-num">${cbEsc(s.card.value)}</b></span>`).join('');
  return `<li><span class="cb-risk-ok-name"${tip?` data-tip="${cbEsc(tip)}"`:''}>${cbEsc(title)}</span><b class="cb-risk-ok-val cb-num">${cbEsc(value)}</b><span class="cb-risk-ok-msg" data-overflow-tip="${cbEsc(String(msg||'').replace(/<[^>]*>/g,''))}"><span data-overflow-watch>${cbEsc(String(msg||'').replace(/<[^>]*>/g,''))}${subs}</span></span></li>`;
}
function cbRiskOkToggle(open){ _cbRiskOkOpen=!!open; }

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
  const cardHtml=(entry,fill='')=>{
          const card=entry.card, subs=(entry.subs||[]).map(cbRiskSubHtml).join('');
          // 두 종류 카드를 한 모양으로: 머리줄 = 제목·판정(왼쪽) + 값(오른쪽), 그 아래 설명, 게이지·부 카드는 카드 바닥(.cb-risk-foot).
          if(entry.kind==='insight') { const foot=cbRiskMeterHtml(card.meter, card.id==='effective-holdings'?'개':'%', card.tone)+subs; return `
            <div class="cb-panel cb-risk-insight-card${subs?' has-sub':''}${fill}" style="--risk-tone:${card.tone}">
              <div class="cb-risk-insight-head"><div class="cb-risk-insight-title"><span${card.tip?` data-tip="${cbEsc(card.tip)}"`:''}>${cbEsc(entry.title||card.title)}</span><span class="cb-risk-verdict is-${entry.verdict.key}">${entry.verdict.label}</span></div><div class="cb-risk-insight-value">${cbEsc(card.value)}</div></div>
              ${entry.hostLabel?`<div class="cb-risk-host-label">${cbEsc(entry.hostLabel)}</div>`:''}
              <div class="cb-risk-insight-detail cb-tip-block" data-overflow-tip="${cbEsc(card.detail)}">
                <span data-overflow-watch>${cbEsc(card.detail)}</span>
              </div>${foot?`<div class="cb-risk-foot">${foot}</div>`:''}
            </div>`; }
          const c=card;
          const foot=(c.fxMix?cbFxMixHtml(c.fxMix,c.meter):cbRiskMeterHtml(c.meter, c.title==='자산군 분산'?'개':'%', c.color))+subs;
          return `
            <div class="cb-panel cb-risk-primary-card${subs?' has-sub':''}${fill}">
              <div class="cb-risk-primary-head">
                <div class="cb-risk-primary-title"><span${c.tip?` data-tip="${cbEsc(c.tip)}"`:''}>${c.title}</span><span style="background:${c.lvl===0?'var(--upSoft)':c.color+'26'};color:${c.color}">${c.status}</span></div>
                <div class="cb-risk-primary-value" style="color:${c.color}">${c.valFmt}</div>
              </div>
              <div class="cb-risk-primary-message">${cbSentenceHtml(c.msg)}</div>
              ${foot?`<div class="cb-risk-foot">${foot}</div>`:''}
            </div>`;
  };
  const okFold=okCards.length?`<details class="cb-risk-ok-fold"${_cbRiskOkOpen||!mainCards.length?' open':''} ontoggle="cbRiskOkToggle(this.open)">
        <summary><b>양호 ${okCards.length}개</b><span>문제없는 점검 항목 · 이름과 값은 펼쳐서 확인</span><em aria-hidden="true"><i class="is-closed">펼치기 ▾</i><i class="is-open">접기 ▴</i></em></summary>
        <ul class="cb-risk-ok-list">${okCards.map(cbRiskOkRowHtml).join('')}</ul>
      </details>`:'';
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
        <div class="cb-risk-priorities"><b>먼저 확인할 항목</b>${r.cards.filter(c=>c.lvl>0).slice().sort((a,b)=>b.lvl-a.lvl).slice(0,3).map(c=>`<p><strong>${cbEsc(c.title)}</strong><span>${cbSentenceHtml(c.msg)}</span></p>`).join('')||'<p>현재 규칙에서 감지된 주의 항목이 없습니다.</p>'}<small>선택 소유주 기준 규칙 점검 · 손실 확률 예측이 아닙니다</small></div>
        <div style="width:100%;margin-top:auto;padding-top:12px;border-top:1px solid var(--bd);display:flex;flex-direction:column;gap:6px;align-self:stretch">
          <div style="display:flex;justify-content:space-between;font-size:var(--fs-cap)"><span style="color:var(--mut)"><span data-tip="자산군별 역사적 변동성의 보유비중 가중평균이며, 레버리지·인버스 상품은 노출 배수만큼 키워 반영합니다. 1년간 수익률이 오르내리는 폭의 추정치입니다. 종목별 실제 변동성이나 종목 간 상관관계는 반영하지 않습니다.">추정 연 변동성</span></span><span style="font-weight:700">${r.vol.toFixed(1)}%</span></div>
          <div style="display:flex;justify-content:space-between;font-size:var(--fs-cap)"><span style="color:var(--mut)"><span data-tip="원화가 아닌 통화(USD·JPY)로 표시된 자산의 비중. 환율 변동에 노출됩니다.">환노출</span></span><span style="font-weight:700">${r.fxPct.toFixed(1)}%</span></div>
          <div style="display:flex;justify-content:space-between;font-size:var(--fs-cap)"><span style="color:var(--mut)">현금 비중</span><span style="font-weight:700">${r.cashPct.toFixed(1)}%</span></div>
        </div>
      </div>
      <div class="cb-risk-cards-col">
        ${mainCards.length?`<div class="cb-risk-card-grid">${cbRiskFillGrid(mainCards,cardHtml)}</div>`:''}
        ${okFold}
      </div>
    </div>
    ${cbLookThroughPanel(ownerF)}`;
}
function cbRiskOwner(o){ _cbRiskOwner=o; cbRenderRisk(); cbRestoreFilterFocus('cb-head-widgets','data-owner',o); }
