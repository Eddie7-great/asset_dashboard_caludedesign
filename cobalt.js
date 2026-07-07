// =====================================================================
// cobalt.js — Claude Design "Cobalt Portfolio v2" 시안 8페이지 구현
// script.js(데이터 엔진)를 그대로 사용하고, 시안 레이아웃으로 렌더링한다.
// 페이지: 대시보드 / 성과 비교 / 가족 자산 / 리스크 진단 / 배당 관리
//        / 증여 플랜 / 양도소득세 / DCA 자동매수
// =====================================================================

/* global pfolioData, RATES, OWNERS, ownerColors, monthlyPLData, benchData,
   _gicsSector, _divpAggregateByYear, _divpComputeCagr, loadMonthlyPL,
   saveMonthlyPL, saveAssetsToKV, loadAssetsFromKV, saveExtDataToKV, cssVar,
   openAddModal, editItem, closeSidebar, fetchDivData, fetchDividendHistory,
   switchView, changeOwner, updateBenchmark, setTheme, isMobileLayout */

// ───────────────────────── 상태 ─────────────────────────
// 평가금액 표시 통화는 KRW 고정 (표시 통화 선택 UI 제거됨).
// 매수 단가·현재가 등 종목 단위 가격은 cbFmtNative로 해당 종목 통화(USD/JPY/KRW) 그대로 노출한다.
const _dispCur = 'KRW';
let _cobaltActive = null;
let _cdashQ = '', _cdashSel = null;
let _famKey = 'all', _famQ = '';
let _cbDivHistRequested = false;

// ───────────────────────── 상수 (시안 팔레트) ─────────────────────────
const CB_CLS = {
  crypto:{label:'크립토',   color:'#f2a33c'},
  us:    {label:'미국 주식', color:'#5b9bff'},
  kr:    {label:'한국 주식', color:'#4ecdc4'},
  jp:    {label:'일본 주식', color:'#c084fc'},
  gold:  {label:'금',       color:'#d4b24a'},
  cash:  {label:'현금',     color:'#56c596'},
};
const CB_VOL = { crypto:0.65, us:0.22, kr:0.26, jp:0.20, gold:0.15, cash:0 };
const CB_SEC_PALETTE = ['#5b9bff','#c084fc','#f2a33c','#4ecdc4','#fb7185','#8bd3ac','#94a3c8','#e8875a','#d4b24a','#56c596','#b48ead','#7aa2ff'];

const CB_VIEWS  = { cdash:cbRenderDash, perf2:cbRenderPerf, fam2:cbRenderFam, risk2:cbRenderRisk, divm:cbRenderDiv, gift2:cbRenderGift, tax2:cbRenderTax, dca2:cbRenderDca };
const CB_TITLES = { cdash:'대시보드', perf2:'성과 비교', fam2:'가족 자산', risk2:'리스크 진단', divm:'배당 관리', gift2:'증여 플랜', tax2:'양도소득세', dca2:'DCA 자동매수' };

// ───────────────────────── 헬퍼 ─────────────────────────
function cbStrip(t){ return String(t||'').toUpperCase().replace(/\.(KS|KQ|T)$/,''); }
function cbCls(i){
  if (i.grp === '가상화폐') return 'crypto';
  if (i.grp === '금') return 'gold';
  if (i.grp === '현금') return 'cash';
  if (i.cur === 'JPY') return 'jp';
  if (i.cur === 'USD') return 'us';
  return 'kr';
}
function cbRate(cur){ return RATES[cur] != null ? RATES[cur] : 1; }
function cbValKRW(i){ return (i.qty||0) * (i.curP||0) * cbRate(i.cur); }
function cbCostKRW(i){ return (i.qty||0) * (i.avgP||0) * cbRate(i.cur); }
function cbGainKRW(i){ return i.grp==='현금' ? 0 : cbValKRW(i) - cbCostKRW(i); }

function cbDisp(vKrw){
  const c = _dispCur, v = vKrw / cbRate(c);
  const s = c==='USD' ? '$' : c==='KRW' ? '₩' : '¥';
  return (v<0?'-':'') + s + Math.abs(Math.round(v)).toLocaleString(c==='USD'?'en-US':'ko-KR');
}
function cbSignDisp(vKrw){ return (vKrw>=0?'+':'') + cbDisp(vKrw); }
function cbKrw(n){ return (n<0?'-':'') + '₩' + Math.abs(Math.round(n)).toLocaleString('ko-KR'); }
function cbManwon(n){ return Math.round(n/10000).toLocaleString('ko-KR') + '만원'; }
function cbPct(r){ return (r>=0?'+':'') + (r*100).toFixed(Math.abs(r)<0.1?2:1) + '%'; }
function cbFmtNative(n, cur){
  if (cur==='USD') return '$' + Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
  if (cur==='JPY') return '¥' + Math.round(n).toLocaleString('ja-JP');
  return '₩' + Math.round(n).toLocaleString('ko-KR');
}
function cbEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function cbUpDn(v){ return 'color:' + (v>=0 ? 'var(--up)' : 'var(--dn)'); }
function cbOwnerColor(o){ return (typeof ownerColors!=='undefined' && ownerColors[o]) || '#8a97b0'; }

// 배당 정보 (script.js의 _divDataCache 사용)
function cbDivOf(i){
  const c = (window._divDataCache || {})[cbStrip(i.tkr)];
  if (!c || !(Number(c.annualDps) > 0)) return null;
  return c; // {eps, annualDps, yldNum, yld, cycle, months(0-index), cur, exDiv}
}
function cbDivIncomeKRW(i){
  const d = cbDivOf(i); if (!d) return 0;
  return d.annualDps * (i.qty||0) * cbRate(d.cur || i.cur);
}
function cbDivGrowth(i){
  try{
    const raw = (window._divHistoryRawCache || {})[cbStrip(i.tkr)];
    if (!raw || !Array.isArray(raw.events) || !raw.events.length) return null;
    const r = _divpComputeCagr(_divpAggregateByYear(raw.events));
    return r.cagr5 != null ? r.cagr5 : r.cagr3;
  }catch(e){ return null; }
}
function cbEnsureDivHist(){
  if (_cbDivHistRequested) return;
  _cbDivHistRequested = true;
  try{ if (typeof fetchDividendHistory === 'function') fetchDividendHistory().then(()=>cbRerender()).catch(()=>{}); }catch(e){}
}

// 종목 행 공통 뷰모델
function cbRow(i, idx){
  const cls = cbCls(i), cl = CB_CLS[cls];
  const nameFirst = (cls==='kr' || cls==='jp' || i.grp==='금' || i.grp==='현금');
  const title = nameFirst ? (i.name || i.tkr) : (i.tkr || i.name);
  const qtyFmt = i.grp==='현금' ? '예수금'
    : (Number(i.qty||0).toLocaleString(undefined,{maximumFractionDigits:4}) + (i.unit || '주'));
  const val = cbValKRW(i), cost = cbCostKRW(i), gain = cbGainKRW(i);
  return {
    i, idx, cls, cl, title,
    sub: (nameFirst ? (i.tkr||'') : (i.name||'')) + ' · ' + qtyFmt,
    chip: nameFirst ? String(i.name||i.tkr||'?').slice(0,2) : String(i.tkr||'?').slice(0,4),
    val, cost, gain,
    gainPct: (i.grp!=='현금' && cost>0) ? gain/cost : null,
  };
}
function cbAllRows(){ return (pfolioData||[]).filter(i=>(i.qty||0)>0).map((i,idx)=>cbRow(i,idx)).sort((a,b)=>b.val-a.val); }

// 섹터 집계 (주식만)
function cbSectors(){
  const eq = (pfolioData||[]).filter(i=>i.grp==='주식' && (i.qty||0)>0);
  const totals = {}; let total = 0;
  eq.forEach(i=>{ const v = cbValKRW(i); if(v<=0) return;
    const s = (typeof _gicsSector==='function' ? _gicsSector(i) : '기타') || '기타';
    totals[s] = (totals[s]||0) + v; total += v; });
  const list = Object.keys(totals).map((s,n)=>({label:s, v:totals[s], pct:total? totals[s]/total*100 : 0}))
    .sort((a,b)=>b.v-a.v);
  list.forEach((s,n)=>{ s.color = CB_SEC_PALETTE[n % CB_SEC_PALETTE.length]; });
  return { list, total };
}

// 리스크 규칙 진단 (시안 로직 이식)
function cbRisk(){
  const rows = cbAllRows();
  const nw = rows.reduce((s,r)=>s+r.val,0) || 1;
  const byCls = {}; rows.forEach(r=>{ byCls[r.cls]=(byCls[r.cls]||0)+r.val; });
  const pctOf = v => v/nw*100;
  const nonCash = rows.filter(r=>r.cls!=='cash');
  const top = nonCash[0];
  const topPct = top ? pctOf(top.val) : 0;
  const cryptoPct = pctOf(byCls.crypto||0), cashPct = pctOf(byCls.cash||0);
  const fxPct = pctOf(rows.filter(r=>r.i.cur && r.i.cur!=='KRW').reduce((s,r)=>s+r.val,0));
  const vol = rows.reduce((s,r)=>s+(r.val/nw)*(CB_VOL[r.cls]||0),0)*100;
  const secs = cbSectors().list;
  const topSec = secs[0] || {label:'—', pct:0};
  const clsCount = Object.keys(byCls).length;
  // 테마별 CSS 토큰을 실제 hex로 해석 — 라이트/다크/네이비 모두에서 가시성 확보 (+'26' 알파 결합 가능)
  const upC=(typeof cssVar==='function'?cssVar('--up','#178a52'):'#178a52'),
        wnC=(typeof cssVar==='function'?cssVar('--warn','#d97706'):'#d97706'),
        dnC=(typeof cssVar==='function'?cssVar('--dn','#cf3d5c'):'#cf3d5c');
  const mk=(title,val,valFmt,thWarn,thBad,msgs,invert)=>{
    let lvl=0;
    if(invert){ if(val<thBad) lvl=2; else if(val<thWarn) lvl=1; }
    else { if(val>thBad) lvl=2; else if(val>thWarn) lvl=1; }
    const color=[upC,wnC,dnC][lvl];
    return { title, valFmt, status:['양호','주의','경고'][lvl], color,
      fill: Math.max(4, Math.min(100, Math.round(invert ? Math.min(100, val/(thWarn*2)*100) : val))),
      msg: msgs[lvl], lvl };
  };
  const topName = top ? top.title : '—';
  const cards = [
    mk('단일 종목 집중도', topPct, topPct.toFixed(1)+'%', 20, 30,
      ['최대 종목 비중 20% 이하로 분산이 잘 되어 있습니다.','최대 종목 '+topName+' 비중이 20%를 넘습니다. 부분 익절을 고려하세요.','단일 종목 의존도가 30%를 초과합니다. 급락 시 타격이 큽니다.']),
    mk('크립토 비중', cryptoPct, cryptoPct.toFixed(1)+'%', 20, 35,
      ['크립토 비중이 관리 가능한 수준입니다.','크립토가 20%를 넘습니다. 일반 권고(5–15%)보다 높습니다.','크립토가 35%를 초과해 변동성을 지배합니다.']),
    mk('섹터 집중도', topSec.pct, Math.round(topSec.pct)+'%', 35, 50,
      ['주식 섹터 분산이 양호합니다.','최대 섹터 '+topSec.label+' 비중이 35%를 넘습니다.',topSec.label+' 편중이 50%를 초과합니다. 섹터 분산이 시급합니다.']),
    mk('추정 연 변동성', vol, vol.toFixed(1)+'%', 22, 32,
      ['전체 변동성이 균형 잡힌 범위입니다.','변동성이 다소 높습니다. 안전자산 확대를 검토하세요.','변동성이 매우 높습니다. 하락장 손실 폭이 클 수 있습니다.']),
    mk('현금 완충 비중', cashPct, cashPct.toFixed(1)+'%', 5, 3,
      ['비상 대응 가능한 현금을 확보하고 있습니다.','현금이 5% 미만입니다. 조정장 매수 여력이 제한적입니다.','현금 3% 미만 — 유동성 리스크가 있습니다.'], true),
    mk('환노출 (원화 기준)', fxPct, fxPct.toFixed(1)+'%', 60, 80,
      ['외화 노출이 적정 범위입니다.','자산의 60% 이상이 외화입니다. 환율 하락 리스크에 유의하세요.','외화 편중이 심합니다. 환헤지나 원화 자산 확대를 검토하세요.']),
    mk('자산군 분산', clsCount, clsCount+'개', 3, 2,
      [clsCount+'개 자산군에 분산되어 있습니다.','자산군이 3개 이하입니다. 분산 폭을 넓혀보세요.','자산군 다양성이 부족합니다.'], true),
  ];
  const score = Math.max(5, Math.min(98, 100 - cards.reduce((s,c)=>s+c.lvl*10,0)));
  return { score, grade: score>=75?'안정적':score>=50?'주의 필요':'고위험',
    color: score>=75?upC:score>=50?wnC:dnC,
    warns: cards.filter(c=>c.lvl>0).length,
    vol, fxPct, cashPct, cards };
}

// ───────────────────────── SVG 빌더 ─────────────────────────
function cbDonutSvg(segs, size){
  const stroke=size*0.16, r=size/2-stroke/2, c=2*Math.PI*r; let off=0;
  let arcs='';
  (segs||[]).forEach(s=>{
    const len=c*s.pct/100;
    arcs+=`<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${stroke}" stroke-dasharray="${len} ${c-len}" stroke-dashoffset="${-off}"></circle>`;
    off+=len;
  });
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" style="stroke:var(--grid)" stroke-width="${stroke}"></circle>${arcs}</svg>`;
}
function cbRingSvg(score, size, color){
  const stroke=10, r=size/2-stroke/2, c=2*Math.PI*r, len=c*score/100;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" style="stroke:var(--grid)" stroke-width="${stroke}"></circle>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${len} ${c-len}"></circle></svg>`;
}
function cbMultiLineSvg(seriesArr, w, h){
  const valid = seriesArr.filter(s=>s.data.some(v=>v!=null));
  const all = valid.flatMap(s=>s.data).filter(v=>v!=null);
  if (!all.length) return `<div style="height:${h}px;display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:12px">벤치마크 데이터 로딩 중… (전일 종가 갱신을 눌러주세요)</div>`;
  const mn=Math.min(...all,0), mx=Math.max(...all,0), pad=(mx-mn)*0.12||1, lo=mn-pad, hi=mx+pad;
  const y=v=>h-((v-lo)/(hi-lo))*h;
  let out='';
  [0,25,50,75,100].forEach(g=>{ out+=`<line x1="0" x2="${w}" y1="${h*g/100}" y2="${h*g/100}" style="stroke:var(--grid)" stroke-width="1"></line>`; });
  out+=`<line x1="0" x2="${w}" y1="${y(0)}" y2="${y(0)}" style="stroke:var(--bd2)" stroke-width="1" stroke-dasharray="4 4"></line>`;
  valid.forEach(s=>{
    const pts=s.data.map((v,i)=>({v,i})).filter(p=>p.v!=null);
    if(pts.length<2) return;
    const dx=w/(s.data.length-1);
    const d='M'+pts.map(p=>(p.i*dx).toFixed(1)+','+y(p.v).toFixed(1)).join(' L');
    out+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.bold?2.6:1.8}" stroke-linejoin="round" opacity="${s.bold?1:0.85}" ${s.dash?'stroke-dasharray="5 5"':''}></path>`;
  });
  out+=`<text x="4" y="12" style="fill:var(--lab)" font-size="11" font-family="IBM Plex Mono">+${hi.toFixed(0)}%</text>`;
  out+=`<text x="4" y="${h-5}" style="fill:var(--lab)" font-size="11" font-family="IBM Plex Mono">${lo>=0?'+':''}${lo.toFixed(0)}%</text>`;
  return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block">${out}</svg>`;
}

// ───────────────────────── 페이지: 대시보드 ─────────────────────────
function cbRenderDash(){
  cbEnsureDivHist();
  const el = document.getElementById('cb-cdash'); if(!el) return;
  const rows = cbAllRows();
  const nw = rows.reduce((s,r)=>s+r.val,0);
  const gainAbs = rows.reduce((s,r)=>s+r.gain,0);
  const costTot = rows.reduce((s,r)=>s+r.cost,0) || 1;
  const divAnnual = rows.reduce((s,r)=>s+cbDivIncomeKRW(r.i),0);
  const risk = cbRisk();

  // 자산 배분
  const byCls={}; rows.forEach(r=>{ byCls[r.cls]=(byCls[r.cls]||0)+r.val; });
  const alloc = Object.keys(CB_CLS).filter(k=>byCls[k]).map(k=>({
    label:CB_CLS[k].label, color:CB_CLS[k].color,
    pct: nw? byCls[k]/nw*100 : 0 }));

  // 섹터
  const secs = cbSectors().list.slice(0,6);
  const topSec = secs[0];
  const sectorNote = !topSec ? '주식 자산이 없습니다'
    : topSec.pct>=50 ? '⚠ '+topSec.label+' 편중이 심합니다 (50%+)'
    : topSec.pct>=35 ? topSec.label+' 비중이 높은 편입니다' : '섹터 분산이 양호합니다';

  // 검색 필터
  const q=(_cdashQ||'').trim().toLowerCase();
  const held = q ? rows.filter(r=>((r.i.tkr||'')+' '+(r.i.name||'')+' '+r.cl.label+' '+(r.i.owner||'')).toLowerCase().includes(q)) : rows;

  // 선택 종목
  const sel = rows.find(r=>String(r.idx)===String(_cdashSel)) || held[0] || null;
  if (sel && _cdashSel==null) _cdashSel = sel.idx;

  let selHtml='';
  if (sel){
    const d = cbDivOf(sel.i);
    const g = cbDivGrowth(sel.i);
    const sector = sel.i.grp==='주식' ? (typeof _gicsSector==='function'? _gicsSector(sel.i):'—') : sel.cl.label;
    const divBox = d ? `
      <div style="display:flex;flex-direction:column;gap:5px;font-size:11.5px">
        <div style="display:flex;justify-content:space-between"><span style="color:var(--mut)">연간 배당수입</span><span style="font-weight:700;color:var(--up)">${cbDisp(cbDivIncomeKRW(sel.i))}</span></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--mut)"><span data-tip="현재 주가 대비 연간 배당금 비율">시가 수익률</span> / <span data-tip="Yield on Cost — 내 평단가 대비 연간 배당금 비율. 오래 보유할수록 높아집니다.">YoC</span></span><span style="font-weight:700">${(d.yldNum||0).toFixed(2)}% / ${sel.i.avgP>0?((d.annualDps/sel.i.avgP)*100).toFixed(2):'—'}%</span></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--mut)"><span data-tip="최근 배당 이력 기준 주당 배당금의 연평균 성장률(CAGR)">배당성장률</span></span><span style="font-weight:700;${g!=null?cbUpDn(g):''}">${g!=null?(g>=0?'+':'')+g.toFixed(1)+'%':'—'}</span></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--mut)">주당 배당 · 주기</span><span class="cb-num" style="font-weight:700">${cbFmtNative(d.annualDps,d.cur||sel.i.cur)} · ${cbEsc(d.cycle||'—')}</span></div>
      </div>`
      : `<div style="font-size:11.5px;color:var(--mut);line-height:1.55">무배당 자산 — 수익은 가격 변동에서만 발생합니다.</div>`;
    selHtml = `
      <div style="margin-top:10px;padding-top:11px;border-top:1px solid var(--bd);display:flex;gap:16px;flex-wrap:wrap">
        <div style="flex:1;min-width:260px">
          <div style="font-size:14.5px;font-weight:800">${cbEsc(sel.i.name||sel.i.tkr)} <span style="font-size:11px;color:var(--lab);font-weight:500">${cbEsc(sel.i.tkr)} · ${sel.cl.label} · ${cbEsc(sel.i.owner)} · ${cbEsc(sel.i.broker||'—')}</span></div>
          <div style="display:flex;gap:18px;margin-top:9px;flex-wrap:wrap">
            <div><div style="font-size:10px;color:var(--lab)">평가액</div><div style="font-size:15px;font-weight:700">${cbDisp(sel.val)}</div></div>
            <div><div style="font-size:10px;color:var(--lab)"><span data-tip="보유 수량 전체의 평균 매수 단가">평단가</span></div><div class="cb-num" style="font-size:15px;font-weight:700">${cbFmtNative(sel.i.avgP,sel.i.cur)}</div></div>
            <div><div style="font-size:10px;color:var(--lab)">평가손익</div><div style="font-size:15px;font-weight:700;${cbUpDn(sel.gain)}">${sel.i.grp==='현금'?'—':cbSignDisp(sel.gain)}</div></div>
            <div><div style="font-size:10px;color:var(--lab)">섹터</div><div style="font-size:13px;font-weight:600;margin-top:2px">${cbEsc(sector)}</div></div>
          </div>
        </div>
        <div style="width:252px;flex-shrink:0;background:var(--inner);border:1px solid var(--bd2);border-radius:10px;padding:11px 13px">
          <div style="font-size:10px;letter-spacing:.08em;color:var(--lab);margin-bottom:7px">배당 정보</div>${divBox}
        </div>
      </div>`;
  }

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
      <div>
        <div style="font-size:10.5px;letter-spacing:.14em;color:var(--lab);font-weight:600">가족 순자산 · <span data-tip="주식·크립토·금·현금 전체 평가액 합계. 전일 종가 및 최근 고시 환율 기준입니다.">전일 종가 기준</span></div>
        <div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:34px;font-weight:800;letter-spacing:-.02em;margin-top:1px">${cbDisp(nw)}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:600;padding:4px 10px;border-radius:16px;background:var(--upSoft);${cbUpDn(gainAbs)}"><span data-tip="현재 평가액 − 총 매입원가">평가손익</span> ${cbSignDisp(gainAbs)} · ${cbPct(gainAbs/costTot)}</span>
        <span style="font-size:12px;font-weight:600;padding:4px 10px;border-radius:16px;background:var(--accSoft);color:var(--tx)">연 배당 ${cbDisp(divAnnual)}</span>
        <span style="font-size:12px;font-weight:600;padding:4px 10px;border-radius:16px;background:var(--accSoft);color:var(--tx);cursor:pointer" onclick="switchView('risk2',document.getElementById('menu-risk2'))">리스크 ${risk.score}점</span>
      </div>
      <button onclick="openAddModal('주식')" class="cb-btn" style="margin-left:auto">＋ 종목 추가</button>
    </div>

    <div style="display:flex;gap:12px;margin-top:14px;align-items:stretch;flex-wrap:wrap">
      <div class="cb-panel" style="width:212px;flex-shrink:0;padding:14px">
        <div style="font-size:10.5px;letter-spacing:.08em;color:var(--lab);margin-bottom:9px">자산 배분</div>
        <div style="display:flex;justify-content:center;margin-bottom:10px">${cbDonutSvg(alloc,116)}</div>
        ${alloc.map(c=>`
          <div style="display:flex;align-items:center;gap:8px;padding:3.5px 0;font-size:11.5px">
            <span style="width:8px;height:8px;border-radius:2px;background:${c.color}"></span>
            <span style="flex:1;color:var(--mut)">${c.label}</span>
            <span style="font-weight:700">${c.pct.toFixed(1)}%</span>
          </div>`).join('')}
      </div>

      <div class="cb-panel" style="width:236px;flex-shrink:0;padding:14px">
        <div style="font-size:10.5px;letter-spacing:.08em;color:var(--lab);margin-bottom:11px"><span data-tip="보유 주식을 섹터로 분류해 편중도를 점검합니다.">섹터</span> 집중도 <span style="color:var(--dim)">· 주식 기준</span></div>
        ${secs.map(s=>`
          <div style="padding:5px 0">
            <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px">
              <span style="color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px">${cbEsc(s.label)}</span>
              <span style="font-weight:700">${s.pct.toFixed(1)}%</span>
            </div>
            <div style="height:6px;border-radius:3px;background:var(--inner);overflow:hidden"><div style="height:100%;border-radius:3px;background:${s.color};width:${Math.round(s.pct)}%"></div></div>
          </div>`).join('') || '<div style="font-size:11px;color:var(--dim)">주식 자산이 없습니다</div>'}
        <div style="font-size:10.5px;color:var(--dim);margin-top:8px;line-height:1.5">${sectorNote}</div>
      </div>

      <div class="cb-panel" style="flex:1;min-width:340px;padding:14px 16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;gap:8px;flex-wrap:wrap">
          <div style="font-size:10.5px;letter-spacing:.08em;color:var(--lab)">보유 자산 · ${held.length}</div>
          <div style="display:flex;align-items:center;gap:7px;background:var(--inner);border:1px solid var(--bd2);border-radius:9px;padding:6px 11px;width:220px">
            <span style="color:var(--dim);font-size:12px">⌕</span>
            <input value="${cbEsc(_cdashQ)}" oninput="cbDashSearch(this.value)" placeholder="티커·종목명 검색…" style="background:transparent;border:none;color:var(--tx);font-family:'Noto Sans KR',sans-serif;font-size:12px;width:100%;outline:none" />
          </div>
        </div>
        ${held.map(r=>`
          <div class="cb-hrow" onclick="cbDashPick(${r.idx})" style="display:flex;align-items:center;gap:10px;padding:7px 9px;cursor:pointer;${String(r.idx)===String(_cdashSel)?'background:var(--accSoft);box-shadow:inset 0 0 0 1px var(--bd2)':''}">
            <span class="cb-num" style="width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;background:${r.cl.color}22;color:${r.cl.color};flex-shrink:0">${cbEsc(r.chip)}</span>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(r.title)}</span>
                <span style="font-size:9.5px;font-weight:700;color:var(--lab);background:var(--accSoft);padding:1px 5px;border-radius:4px;flex-shrink:0">${cbEsc(r.i.cur||'KRW')}</span>
              </div>
              <div style="font-size:10.5px;color:var(--lab);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(r.sub)}</div>
            </div>
            <span style="display:flex;align-items:center;gap:5px;width:62px;font-size:11px;color:var(--mut);flex-shrink:0"><span style="width:7px;height:7px;border-radius:50%;background:${cbOwnerColor(r.i.owner)}"></span>${cbEsc(r.i.owner)}</span>
            <span class="cb-num" style="width:96px;text-align:right;font-size:12px;font-weight:600;flex-shrink:0">${r.i.grp==='현금'?'—':cbFmtNative(r.i.curP,r.i.cur)}</span>
            <span style="width:96px;text-align:right;font-size:12.5px;font-weight:700;flex-shrink:0">${cbDisp(r.val)}</span>
            <span style="width:60px;text-align:right;font-size:12px;font-weight:600;flex-shrink:0;${r.gainPct==null?'color:var(--lab)':cbUpDn(r.gainPct)}">${r.gainPct==null?'—':cbPct(r.gainPct)}</span>
            <span class="cb-edit" onclick="event.stopPropagation();editItem('${cbEsc(r.i.owner)}','${cbEsc(r.i.tkr)}',${r.idx})">✎</span>
          </div>`).join('')}
        ${selHtml}
      </div>
    </div>`;
}
function cbDashSearch(v){ _cdashQ=v; cbRenderDash();
  // 검색 입력 포커스 유지
  const inp=document.querySelector('#cb-cdash input'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
function cbDashPick(idx){ _cdashSel=idx; cbRenderDash(); }

// ───────────────────────── 페이지: 성과 비교 ─────────────────────────
function cbLastVal(arr){ if(!Array.isArray(arr)) return null; for(let k=arr.length-1;k>=0;k--){ if(arr[k]!=null) return arr[k]; } return null; }
function cbRenderPerf(){
  const el = document.getElementById('cb-perf2'); if(!el) return;
  const fmtR = v => v==null ? '—' : (v>=0?'+':'')+Number(v).toFixed(1)+'%';
  const csR = v => v==null ? 'color:var(--lab)' : cbUpDn(v);
  const oc = (typeof BENCH_OWNER_COLORS!=='undefined') ? BENCH_OWNER_COLORS : {};
  const entities = [
    ...OWNERS.map(o=>({key:o,label:o,color:oc[o]||cbOwnerColor(o),isBench:false,bold:false})),
    {key:'S&P 500',label:'S&P 500',color:'#4ade80',isBench:true},
    {key:'KOSPI',label:'KOSPI',color:'#f2a33c',isBench:true},
  ].filter(e=>{
    // 데이터가 하나라도 있는 엔티티만
    return ['1M','3M','6M','1Y'].some(tf=>cbLastVal((benchData[tf]||{data:{}}).data[e.key])!=null) || e.isBench;
  });
  const y1 = benchData['1Y'] || {labels:[],data:{}};
  const spY1 = cbLastVal(y1.data['S&P 500']);
  const cards = entities.map(e=>({ ...e, ret: cbLastVal(y1.data[e.key]) }));
  const seriesArr = entities.map(e=>({ data:(y1.data[e.key]||[]), color:e.color, bold:!e.isBench, dash:e.isBench }));
  const rows = entities.map(e=>{
    const g = tf => cbLastVal((benchData[tf]||{data:{}}).data[e.key]);
    const yv = g('1Y');
    const alpha = (!e.isBench && yv!=null && spY1!=null) ? yv-spY1 : null;
    return { e, m1:g('1M'), m3:g('3M'), m6:g('6M'), y1:yv, alpha };
  });

  el.innerHTML = `
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><div class="cb-title">벤치마크 대비 성과</div><div style="font-size:11.5px;color:var(--lab)">최근 1년 · 시작점 0% 정규화 · <span data-tip="S&P 500(^GSPC)·KOSPI(^KS11) 실지수 대비 소유주별 포트폴리오 수익률. 전일 확정 종가 기준입니다.">전일 종가 기준</span></div></div>
    <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
      ${cards.map(p=>`
        <div class="cb-panel" style="flex:1;min-width:130px;padding:12px 14px;border-top:3px solid ${p.color}">
          <div style="display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--mut)"><span style="width:8px;height:8px;border-radius:2px;background:${p.color}"></span>${cbEsc(p.label)}</div>
          <div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:23px;font-weight:800;margin-top:3px;${csR(p.ret)}">${fmtR(p.ret)}</div>
        </div>`).join('')}
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px 8px">
      <div style="display:flex;gap:14px;margin-bottom:8px;flex-wrap:wrap">
        ${entities.map(p=>`<span style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--mut)"><span style="width:13px;height:3px;border-radius:2px;background:${p.color}"></span>${cbEsc(p.label)}</span>`).join('')}
      </div>
      ${cbMultiLineSvg(seriesArr, 1100, 210)}
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--dim);padding:4px 2px 6px">${(y1.labels||[]).map(l=>`<span>${cbEsc(l)}</span>`).join('')}</div>
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px">
      <div style="display:flex;font-size:10.5px;color:var(--dim);padding:0 8px 7px;border-bottom:1px solid var(--bd)">
        <span style="flex:1">구분</span><span style="width:84px;text-align:right">1개월</span><span style="width:84px;text-align:right">3개월</span><span style="width:84px;text-align:right">6개월</span><span style="width:84px;text-align:right">1년</span><span style="width:104px;text-align:right"><span data-tip="같은 기간 S&P 500 수익률을 얼마나 웃돌았는지 (포트폴리오 − 벤치마크)">초과수익</span>(1년)</span>
      </div>
      ${rows.map(r=>`
        <div style="display:flex;align-items:center;padding:9px 8px;border-bottom:1px solid var(--bd);font-size:12.5px">
          <span style="flex:1;display:flex;align-items:center;gap:7px;font-weight:700"><span style="width:8px;height:8px;border-radius:2px;background:${r.e.color}"></span>${cbEsc(r.e.label)}</span>
          <span style="width:84px;text-align:right;font-weight:600;${csR(r.m1)}">${fmtR(r.m1)}</span>
          <span style="width:84px;text-align:right;font-weight:600;${csR(r.m3)}">${fmtR(r.m3)}</span>
          <span style="width:84px;text-align:right;font-weight:600;${csR(r.m6)}">${fmtR(r.m6)}</span>
          <span style="width:84px;text-align:right;font-weight:600;${csR(r.y1)}">${fmtR(r.y1)}</span>
          <span style="width:104px;text-align:right;font-weight:700;${csR(r.alpha)}">${r.alpha==null?'—':fmtR(r.alpha)}</span>
        </div>`).join('')}
      <div style="font-size:10.5px;color:var(--dim);margin-top:9px">※ 소유주별 라인은 각 소유주 보유 종목의 가중 수익률입니다. 데이터가 비어 있으면 사이드바의 "전일 종가 갱신"을 눌러주세요.</div>
    </div>`;
}

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
  const held = q ? base.filter(r=>((r.i.tkr||'')+' '+(r.i.name||'')+' '+r.cl.label+' '+(r.i.owner||'')).toLowerCase().includes(q)) : base;

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <div class="cb-title">가족 자산 현황</div>
      <div style="font-size:11.5px;color:var(--lab)">카드 클릭 시 해당 구성원만 필터링</div>
      <button onclick="openAddModal('주식')" class="cb-btn" style="margin-left:auto;padding:8px 14px;font-size:12px">＋ 종목 추가</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:12px">
      ${cards.map(f=>`
        <div class="cb-panel" onclick="cbFamPick('${cbEsc(f.key)}')" style="cursor:pointer;padding:12px;${_famKey===f.key?`border-color:${f.color};box-shadow:0 0 0 1px ${f.color}`:''}">
          <div style="display:flex;align-items:center;gap:7px">
            <span style="width:23px;height:23px;border-radius:50%;background:${f.color}26;color:${f.color};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800">${cbEsc(f.name.slice(0,1))}</span>
            <span style="font-size:12.5px;font-weight:700">${cbEsc(f.name)}</span>
          </div>
          <div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:17px;font-weight:800;margin-top:8px">${cbDisp(f.v)}</div>
          <div style="font-size:11px;font-weight:600;margin-top:1px;${cbUpDn(f.g)}">${cbSignDisp(f.g)}</div>
          <div style="height:4px;border-radius:2px;background:var(--inner);margin-top:8px;overflow:hidden"><div style="height:100%;background:${f.color};width:${Math.round(f.v/nw*100)}%"></div></div>
          <div style="font-size:10px;color:var(--lab);margin-top:4px">전체 ${(f.v/nw*100).toFixed(1)}% · ${f.n}종목</div>
        </div>`).join('')}
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;gap:8px;flex-wrap:wrap">
        <div style="font-size:10.5px;letter-spacing:.08em;color:var(--lab)">${_famKey==='all'?'전체 보유 자산':cbEsc(_famKey)+' 보유 자산'} · ${held.length}종목</div>
        <div style="display:flex;align-items:center;gap:7px;background:var(--inner);border:1px solid var(--bd2);border-radius:9px;padding:6px 11px;width:220px">
          <span style="color:var(--dim);font-size:12px">⌕</span>
          <input value="${cbEsc(_famQ)}" oninput="cbFamSearch(this.value)" placeholder="티커·종목명 검색…" style="background:transparent;border:none;color:var(--tx);font-family:'Noto Sans KR',sans-serif;font-size:12px;width:100%;outline:none" />
        </div>
      </div>
      ${held.map(r=>`
        <div class="cb-hrow" style="display:flex;align-items:center;gap:10px;padding:7px 9px">
          <span class="cb-num" style="width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;background:${r.cl.color}22;color:${r.cl.color};flex-shrink:0">${cbEsc(r.chip)}</span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px"><span style="font-size:13px;font-weight:700">${cbEsc(r.title)}</span><span style="font-size:9.5px;font-weight:700;color:var(--lab);background:var(--accSoft);padding:1px 5px;border-radius:4px">${cbEsc(r.i.cur||'KRW')}</span></div>
            <div style="font-size:10.5px;color:var(--lab)">${cbEsc(r.sub)} · ${cbEsc(r.i.broker||'—')}${r.i.acc?' · '+cbEsc(r.i.acc):''}</div>
          </div>
          <span style="display:flex;align-items:center;gap:5px;width:62px;font-size:11px;color:var(--mut)"><span style="width:7px;height:7px;border-radius:50%;background:${cbOwnerColor(r.i.owner)}"></span>${cbEsc(r.i.owner)}</span>
          <span class="cb-num" style="width:104px;text-align:right;font-size:12px">${r.i.grp==='현금'?'—':cbFmtNative(r.i.curP,r.i.cur)}</span>
          <span style="width:100px;text-align:right;font-size:12.5px;font-weight:700">${cbDisp(r.val)}</span>
          <span style="width:60px;text-align:right;font-size:12px;font-weight:600;${r.gainPct==null?'color:var(--lab)':cbUpDn(r.gainPct)}">${r.gainPct==null?'—':cbPct(r.gainPct)}</span>
          <span class="cb-edit" onclick="editItem('${cbEsc(r.i.owner)}','${cbEsc(r.i.tkr)}',${r.idx})">✎</span>
        </div>`).join('')}
    </div>`;
}
function cbFamPick(k){ _famKey=k; cbRenderFam(); }
function cbFamSearch(v){ _famQ=v; cbRenderFam();
  const inp=document.querySelector('#cb-fam2 input'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }

// ───────────────────────── 페이지: 리스크 진단 ─────────────────────────
function cbRenderRisk(){
  const el = document.getElementById('cb-risk2'); if(!el) return;
  const r = cbRisk();
  el.innerHTML = `
    <div style="display:flex;align-items:baseline;gap:10px"><div class="cb-title">리스크 진단</div><div style="font-size:11.5px;color:var(--lab)">규칙 기반 자동 점검</div></div>
    <div style="display:flex;gap:12px;margin-top:12px;flex-wrap:wrap">
      <div class="cb-panel" style="width:246px;flex-shrink:0;padding:18px;display:flex;flex-direction:column;align-items:center">
        <div style="position:relative;width:136px;height:136px;display:flex;align-items:center;justify-content:center">
          ${cbRingSvg(r.score,136,r.color)}
          <div style="position:absolute;text-align:center">
            <div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:34px;font-weight:800;color:${r.color}">${r.score}</div>
            <div style="font-size:10px;color:var(--lab)">/ 100</div>
          </div>
        </div>
        <div style="font-size:14.5px;font-weight:800;margin-top:10px;color:${r.color}">${r.grade}</div>
        <div style="font-size:11.5px;color:var(--mut);text-align:center;line-height:1.6;margin-top:6px">${r.warns===0?'모든 점검 항목이 양호합니다.':r.warns+'개 항목에서 주의·경고가 발견되었습니다.'}</div>
        <div style="width:100%;margin-top:13px;padding-top:12px;border-top:1px solid var(--bd);display:flex;flex-direction:column;gap:6px">
          <div style="display:flex;justify-content:space-between;font-size:11.5px"><span style="color:var(--mut)"><span data-tip="자산군별 역사적 변동성의 보유비중 가중평균. 1년간 수익률이 오르내리는 폭의 추정치입니다.">추정 연 변동성</span></span><span style="font-weight:700">${r.vol.toFixed(1)}%</span></div>
          <div style="display:flex;justify-content:space-between;font-size:11.5px"><span style="color:var(--mut)"><span data-tip="원화가 아닌 통화(USD·JPY)로 표시된 자산의 비중. 환율 변동에 노출됩니다.">환노출</span></span><span style="font-weight:700">${r.fxPct.toFixed(1)}%</span></div>
          <div style="display:flex;justify-content:space-between;font-size:11.5px"><span style="color:var(--mut)">현금 비중</span><span style="font-weight:700">${r.cashPct.toFixed(1)}%</span></div>
        </div>
      </div>
      <div style="flex:1;min-width:340px;display:grid;grid-template-columns:1fr 1fr;gap:10px;align-content:start">
        ${r.cards.map(c=>`
          <div class="cb-panel" style="padding:13px 15px">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
              <div style="display:flex;align-items:center;gap:8px"><span style="font-size:12.5px;font-weight:700">${c.title}</span><span style="font-size:10px;font-weight:800;padding:1px 8px;border-radius:16px;background:${c.lvl===0?'var(--upSoft)':c.color+'26'};color:${c.color}">${c.status}</span></div>
              <div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:16px;font-weight:800;color:${c.color}">${c.valFmt}</div>
            </div>
            <div style="font-size:11px;color:var(--mut);margin-top:4px;line-height:1.55">${c.msg}</div>
            <div style="height:5px;border-radius:3px;background:var(--inner);margin-top:8px;overflow:hidden"><div style="height:100%;width:${c.fill}%;background:${c.color}"></div></div>
          </div>`).join('')}
      </div>
    </div>`;
}

// ───────────────────────── 페이지: 배당 관리 ─────────────────────────
function cbRenderDiv(){
  cbEnsureDivHist();
  const el = document.getElementById('cb-divm'); if(!el) return;
  const rows = cbAllRows().filter(r=>cbDivOf(r.i));
  // 같은 소유주+티커(다계좌) 취합
  const merged = new Map();
  rows.forEach(r=>{
    const key = r.i.owner + '::' + cbStrip(r.i.tkr);
    if (merged.has(key)){ const m = merged.get(key); m.qty += (r.i.qty||0); m.cost += r.cost; }
    else merged.set(key, { i:r.i, cl:r.cl, cls:r.cls, title:r.title, chip:r.chip, qty:(r.i.qty||0), cost:r.cost, idx:r.idx });
  });
  const list = Array.from(merged.values()).map(m=>{
    const d = cbDivOf(m.i);
    const incomeKRW = d.annualDps * m.qty * cbRate(d.cur || m.i.cur);
    const g = cbDivGrowth(m.i);
    return { ...m, d, incomeKRW, g,
      yoc: m.i.avgP>0 ? d.annualDps/m.i.avgP*100 : null };
  }).sort((a,b)=>b.incomeKRW-a.incomeKRW);

  const divAnnual = list.reduce((s,x)=>s+x.incomeKRW,0);
  const divCost = list.reduce((s,x)=>s+x.cost,0) || 1;
  const avgG = divAnnual ? list.reduce((s,x)=>s+(x.g||0)*x.incomeKRW,0)/divAnnual : 0;

  // 월별 캘린더 (months는 0-index)
  const monthAmt = Array(12).fill(0);
  list.forEach(x=>{
    const ms = (x.d.months && x.d.months.length) ? x.d.months : [2,5,8,11];
    const per = x.incomeKRW / ms.length;
    ms.forEach(m=>{ const mi=((m%12)+12)%12; monthAmt[mi]+=per; });
  });
  const mxM = Math.max(...monthAmt, 0.001);

  el.innerHTML = `
    <div style="display:flex;align-items:baseline;gap:10px"><div class="cb-title">배당 관리</div><div style="font-size:11.5px;color:var(--lab)"><span data-tip="Yield on Cost — 내 평단가 대비 연간 배당금 비율. 배당성장 + 장기보유의 효과를 보여줍니다.">YoC</span>는 평단가 기준입니다</div></div>
    <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:150px;background:var(--upSoft);border:1px solid var(--bd);border-radius:12px;padding:12px 14px"><div style="font-size:11px;color:var(--mut)">연간 배당 수입</div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;color:var(--up);margin-top:2px">${cbDisp(divAnnual)}</div></div>
      <div class="cb-panel" style="flex:1;min-width:150px;padding:12px 14px"><div style="font-size:11px;color:var(--lab)">월평균</div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;margin-top:2px">${cbDisp(divAnnual/12)}</div></div>
      <div class="cb-panel" style="flex:1;min-width:150px;padding:12px 14px"><div style="font-size:11px;color:var(--lab)">평균 <span data-tip="배당 지급 종목 전체의 매입원가 대비 배당수입 비율">YoC</span></div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;margin-top:2px">${(divAnnual/divCost*100).toFixed(2)}%</div></div>
      <div class="cb-panel" style="flex:1;min-width:150px;padding:12px 14px"><div style="font-size:11px;color:var(--lab)">평균 <span data-tip="지급 종목들의 주당 배당금 연평균 성장률(CAGR)을 배당수입 비중으로 가중평균한 값">배당성장률</span></div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;color:var(--up);margin-top:2px">${(avgG>=0?'+':'')+avgG.toFixed(1)}%</div></div>
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px">
      <div style="font-size:10.5px;letter-spacing:.08em;color:var(--lab);margin-bottom:10px">월별 배당 캘린더 (예상)</div>
      <div style="display:flex;align-items:flex-end;gap:8px;height:118px">
        ${monthAmt.map((v,i)=>`
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end">
            <div style="font-size:9.5px;color:var(--up);font-weight:700">${v>0?cbDisp(v):''}</div>
            <div style="width:100%;max-width:38px;border-radius:5px 5px 2px 2px;background:var(--up);opacity:.85;height:${Math.round(v/mxM*100)}%;min-height:2px"></div>
            <div style="font-size:10px;color:var(--lab)">${i+1}</div>
          </div>`).join('')}
      </div>
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px;overflow-x:auto">
      <div style="display:flex;font-size:10.5px;color:var(--dim);padding:0 8px 7px;border-bottom:1px solid var(--bd);min-width:820px">
        <span style="flex:1">종목</span><span style="width:62px">소유주</span><span style="width:86px;text-align:right">주당 배당(연)</span><span style="width:70px;text-align:right"><span data-tip="현재 주가 대비 연간 배당금 비율">시가수익률</span></span><span style="width:64px;text-align:right"><span data-tip="Yield on Cost — 평단가 대비 배당수익률">YoC</span></span><span style="width:78px;text-align:right"><span data-tip="배당 이력 기준 주당 배당금 연평균 성장률(CAGR)">배당성장</span></span><span style="width:96px;text-align:right">연간 수입</span><span style="width:64px;text-align:right">주기</span><span style="width:100px;text-align:right"><span data-tip="이 날짜 전까지 매수해야 다음 배당을 받을 수 있는 기준일">배당락</span></span>
      </div>
      ${list.map(x=>`
        <div style="display:flex;align-items:center;padding:9px 8px;border-bottom:1px solid var(--bd);font-size:12.5px;min-width:820px">
          <div style="flex:1;display:flex;align-items:center;gap:8px;min-width:0">
            <span class="cb-num" style="width:27px;height:27px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:8.5px;font-weight:800;background:${x.cl.color}22;color:${x.cl.color};flex-shrink:0">${cbEsc(x.chip)}</span>
            <div style="min-width:0"><div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(x.title)}</div><div style="font-size:10px;color:var(--lab)">${cbEsc((x.cls==='kr'||x.cls==='jp')?x.i.tkr:(x.i.name||''))}</div></div>
          </div>
          <span style="width:62px;display:flex;align-items:center;gap:4px;font-size:11px;color:var(--mut)"><span style="width:6px;height:6px;border-radius:50%;background:${cbOwnerColor(x.i.owner)}"></span>${cbEsc(x.i.owner)}</span>
          <span class="cb-num" style="width:86px;text-align:right;font-size:11.5px">${cbFmtNative(x.d.annualDps, x.d.cur||x.i.cur)}</span>
          <span style="width:70px;text-align:right;font-weight:600">${(x.d.yldNum||0).toFixed(2)}%</span>
          <span style="width:64px;text-align:right;font-weight:800;color:var(--up)">${x.yoc!=null?x.yoc.toFixed(2)+'%':'—'}</span>
          <span style="width:78px;text-align:right;font-weight:700;${x.g!=null?cbUpDn(x.g):'color:var(--lab)'}">${x.g!=null?(x.g>=0?'+':'')+x.g.toFixed(1)+'%':'—'}</span>
          <span style="width:96px;text-align:right;font-weight:700">${cbDisp(x.incomeKRW)}</span>
          <span style="width:64px;text-align:right;color:var(--mut);font-size:11.5px">${cbEsc(x.d.cycle||'—')}</span>
          <span style="width:100px;text-align:right;color:var(--mut);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(x.d.exDiv||'—')}</span>
        </div>`).join('') || '<div style="padding:20px;text-align:center;color:var(--dim);font-size:12px">배당 지급 종목이 없거나 배당 정보를 아직 불러오지 못했습니다.</div>'}
    </div>`;
}

// ───────────────────────── 페이지: 증여 플랜 ─────────────────────────
// 실제 증여액(구간별 입력) — KV ext_data.giftActual + localStorage 미러로 영속화
window._giftActual = window._giftActual || (function(){
  try{ return JSON.parse(localStorage.getItem('giftActual')||'{}') || {}; }catch(e){ return {}; }
})();
function cbGiftActualOf(idx){
  const v = Number((window._giftActual||{})[idx]);
  return (isFinite(v) && v>0) ? v : 0;
}
function cbGiftSetActual(idx, raw){
  const v = parseFloat(String(raw||'').replace(/[^\d]/g,''));
  window._giftActual = window._giftActual || {};
  window._giftActual[idx] = (isFinite(v) && v>0) ? Math.round(v) : 0;
  try{ localStorage.setItem('giftActual', JSON.stringify(window._giftActual)); }catch(e){}
  try{ saveExtDataToKV(); }catch(e){}
  cbRenderGift();
}
function cbGiftFmtInput(el){
  const digits = el.value.replace(/[^\d]/g,'');
  el.value = digits ? Number(digits).toLocaleString('ko-KR') : '';
}
function cbGiftSegs(){
  const r = Math.pow(1.03, 1/12);
  const pvf = (1 - Math.pow(1.03, -10)) / (1 - 1/r);
  return [
    {label:'미성년 전기', ages:'0~9세',  a0:0,  limit:20000000},
    {label:'미성년 후기', ages:'10~19세', a0:10, limit:20000000},
    {label:'성년 전기',   ages:'20~29세', a0:20, limit:50000000},
    {label:'성년 후기',   ages:'30~39세', a0:30, limit:50000000},
  ].map((g,i)=>{ const M=g.limit/pvf, nominal=M*120; return {...g, idx:i, monthly:M, nominal, extra:nominal-g.limit, actual:cbGiftActualOf(i)}; });
}
function cbGiftChartSvg(w,h){
  const segs = cbGiftSegs();
  const wn = (typeof cssVar==='function'?cssVar('--warn','#d97706'):'#d97706');
  const maxY = segs.reduce((s,g)=>s+g.nominal,0)*1.08;
  const X=a=>a/40*w, Y=v=>h-18-(v/maxY)*(h-30);
  let cum=0; const lumpPts=[[0,0]];
  segs.forEach(g=>{ lumpPts.push([g.a0,cum]); cum+=g.limit; lumpPts.push([g.a0,cum]); });
  lumpPts.push([40,cum]);
  const lumpD='M'+lumpPts.map(p=>X(p[0]).toFixed(1)+','+Y(p[1]).toFixed(1)).join(' L');
  let cumA=0; const annPts=[[0,0]];
  segs.forEach(g=>{ annPts.push([g.a0,cumA]); cumA+=g.nominal; annPts.push([g.a0+10,cumA]); });
  annPts.push([40,cumA]);
  const annD='M'+annPts.map(p=>X(p[0]).toFixed(1)+','+Y(p[1]).toFixed(1)).join(' L');
  let out='';
  [0,10,20,30,40].forEach(a=>{
    out+=`<line x1="${X(a)}" x2="${X(a)}" y1="0" y2="${h-18}" style="stroke:var(--grid)" stroke-width="1"></line>`;
    out+=`<text x="${X(a)+3}" y="${h-5}" style="fill:var(--lab)" font-size="11" font-family="Noto Sans KR">${a}세</text>`;
  });
  // 구간별 비과세 한도(누적) — 경고색 굵은 점선 + 눈에 띄는 라벨 (가시성 개선)
  let c2=0;
  segs.forEach((g,i)=>{ c2+=g.limit;
    out+=`<line x1="${X(g.a0)}" x2="${X(g.a0+10)}" y1="${Y(c2)}" y2="${Y(c2)}" stroke="${wn}" stroke-width="2" stroke-dasharray="7 5" opacity="0.95"></line>`;
    out+=`<text x="${X(g.a0)+4}" y="${Y(c2)-6}" fill="${wn}" font-size="11.5" font-weight="700" font-family="Noto Sans KR">한도 누적 ${Math.round(c2/10000).toLocaleString()}만</text>`;
  });
  // 실제 증여 누적 추이 (구간 내 선형 증가로 표현)
  let cumR=0; const actPts=[[0,0]]; let anyActual=false;
  segs.forEach(g=>{ actPts.push([g.a0,cumR]); if(g.actual>0) anyActual=true; cumR+=g.actual; actPts.push([g.a0+10,cumR]); });
  actPts.push([40,cumR]);
  if (anyActual){
    const actD='M'+actPts.map(p=>X(p[0]).toFixed(1)+','+Y(p[1]).toFixed(1)).join(' L');
    out+=`<path d="${actD}" fill="none" style="stroke:var(--acc3)" stroke-width="2.6" stroke-linejoin="round"></path>`;
    out+=`<text x="${w-4}" y="${Math.max(14, Y(cumR)+16)}" style="fill:var(--acc3)" font-size="12" font-weight="700" text-anchor="end" font-family="Noto Sans KR">실제 증여 ${Math.round(cumR/10000).toLocaleString()}만원</text>`;
  }
  out+=`<path d="${lumpD}" fill="none" style="stroke:var(--acc)" stroke-width="2.2" stroke-linejoin="round"></path>`;
  out+=`<path d="${annD}" fill="none" style="stroke:var(--up)" stroke-width="2.6" stroke-linejoin="round"></path>`;
  out+=`<text x="${w-4}" y="${Y(cumA)-8}" style="fill:var(--up)" font-size="12" font-weight="700" text-anchor="end" font-family="Noto Sans KR">명목 ${Math.round(cumA/10000).toLocaleString()}만원</text>`;
  return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block">${out}</svg>`;
}
function cbRenderGift(){
  const el = document.getElementById('cb-gift2'); if(!el) return;
  const segs = cbGiftSegs();
  const wn = (typeof cssVar==='function'?cssVar('--warn','#d97706'):'#d97706');
  const lumpT = segs.reduce((s,g)=>s+g.limit,0), annT = segs.reduce((s,g)=>s+g.nominal,0);
  const actT = segs.reduce((s,g)=>s+g.actual,0);
  const actPct = lumpT ? actT/lumpT*100 : 0;
  el.innerHTML = `
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><div class="cb-title">자녀 증여 플랜</div><div style="font-size:11.5px;color:var(--lab)"><span data-tip="일정 기간 동안 정기적으로 나누어 주는 증여. 미래 지급분을 연 3% 할인율로 현재가치 평가하므로, 같은 비과세 한도로 더 많은 금액을 이체할 수 있습니다.">유기정기금</span> 방식 · 연 3.0% 할인율 적용</div></div>
    <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
      <div class="cb-panel" style="flex:1;min-width:190px;padding:12px 14px"><div style="font-size:11px;color:var(--lab)">일시금 한도 합계 (0~39세)</div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;margin-top:2px">${cbManwon(lumpT)}</div></div>
      <div style="flex:1;min-width:190px;background:var(--upSoft);border:1px solid var(--bd);border-radius:12px;padding:12px 14px"><div style="font-size:11px;color:var(--mut)">유기정기금 이체 가능 총액</div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;color:var(--up);margin-top:2px">${cbManwon(annT)}</div></div>
      <div class="cb-panel" style="flex:1;min-width:190px;padding:12px 14px"><div style="font-size:11px;color:var(--lab)">할인율 효과 (추가 이체분)</div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;color:var(--up);margin-top:2px">+${cbManwon(annT-lumpT)}</div></div>
      <div class="cb-panel" style="flex:1;min-width:190px;padding:12px 14px;border-top:3px solid var(--acc3)"><div style="font-size:11px;color:var(--lab)">실제 증여 누적 / 총 한도</div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;margin-top:2px">${cbManwon(actT)} <span style="font-size:12px;color:var(--lab);font-weight:600">(${actPct.toFixed(1)}%)</span></div></div>
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px">
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px"><div style="font-size:10.5px;letter-spacing:.08em;color:var(--lab)">실제 증여 진행 현황</div><div style="font-size:10.5px;color:var(--dim)">구간별로 실제 증여(이체)한 금액을 입력하면 비과세 한도 대비 진행률을 추적합니다</div></div>
      ${segs.map(g=>{
        const pct = g.limit ? g.actual/g.limit*100 : 0;
        const over = g.actual > g.limit;
        const remain = g.limit - g.actual;
        const barColor = over ? wn : 'var(--acc3)';
        return `
        <div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--bd);flex-wrap:wrap">
          <span style="width:150px;font-size:12.5px;font-weight:700;flex-shrink:0">${g.label} <span style="font-size:10.5px;color:var(--lab);font-weight:500">${g.ages}</span></span>
          <span style="display:flex;align-items:center;gap:5px;flex-shrink:0">
            <input class="cb-input cb-num" value="${g.actual?g.actual.toLocaleString('ko-KR'):''}" placeholder="0"
              inputmode="numeric" style="width:130px;text-align:right;padding:6px 8px"
              oninput="cbGiftFmtInput(this)" onchange="cbGiftSetActual(${g.idx}, this.value)" />
            <span style="font-size:11px;color:var(--lab)">원</span>
          </span>
          <div style="flex:1;min-width:160px">
            <div style="height:9px;border-radius:5px;background:var(--inner);overflow:hidden;border:1px solid var(--bd)">
              <div style="height:100%;border-radius:5px;background:${barColor};width:${Math.max(g.actual>0?2:0, Math.min(100, Math.round(pct)))}%;transition:width .25s"></div>
            </div>
          </div>
          <span style="width:64px;text-align:right;font-weight:800;font-size:12.5px;color:${over?wn:'var(--tx)'}">${pct.toFixed(1)}%</span>
          <span style="width:150px;text-align:right;font-size:11px;color:${over?wn:'var(--mut)'}">${over?'한도 초과 +'+cbManwon(g.actual-g.limit):'잔여 한도 '+cbManwon(remain)}</span>
        </div>`;}).join('')}
      <div style="display:flex;align-items:center;gap:12px;padding:10px 0 2px;flex-wrap:wrap">
        <span style="width:150px;font-size:12.5px;font-weight:800;flex-shrink:0">전체 (0~39세)</span>
        <span class="cb-num" style="width:140px;text-align:right;font-weight:800;font-size:12.5px;flex-shrink:0">${cbKrw(actT)}</span>
        <div style="flex:1;min-width:160px">
          <div style="height:9px;border-radius:5px;background:var(--inner);overflow:hidden;border:1px solid var(--bd)">
            <div style="height:100%;border-radius:5px;background:var(--up);width:${Math.max(actT>0?2:0, Math.min(100, Math.round(actPct)))}%;transition:width .25s"></div>
          </div>
        </div>
        <span style="width:64px;text-align:right;font-weight:800;font-size:12.5px">${actPct.toFixed(1)}%</span>
        <span style="width:150px;text-align:right;font-size:11px;color:var(--mut)">잔여 한도 ${cbManwon(Math.max(0,lumpT-actT))}</span>
      </div>
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px 8px">
      <div style="display:flex;gap:14px;margin-bottom:8px;font-size:11px;color:var(--mut);flex-wrap:wrap">
        <span style="display:flex;align-items:center;gap:5px"><span style="width:13px;height:3px;background:var(--acc)"></span>일시금 증여 (한도 그대로)</span>
        <span style="display:flex;align-items:center;gap:5px"><span style="width:13px;height:3px;background:var(--up)"></span>유기정기금 월 이체 (할인율 반영)</span>
        <span style="display:flex;align-items:center;gap:5px"><span style="width:13px;height:3px;background:var(--acc3)"></span>실제 증여 누적</span>
        <span style="display:flex;align-items:center;gap:5px"><span style="width:13px;height:0;border-top:2px dashed ${wn}"></span>구간별 비과세 한도 (누적)</span>
      </div>
      ${cbGiftChartSvg(1100,230)}
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px">
      <div style="display:flex;font-size:10.5px;color:var(--dim);padding:0 8px 7px;border-bottom:1px solid var(--bd)">
        <span style="flex:1">구간</span><span style="width:110px;text-align:right"><span data-tip="10년 단위로 재적용되는 증여세 비과세 한도 (미성년 2,000만원 / 성년 5,000만원)">비과세 한도</span></span><span style="width:110px;text-align:right">월 이체액</span><span style="width:130px;text-align:right">10년 명목 이체 총액</span><span style="width:110px;text-align:right">추가 이체분</span>
      </div>
      ${segs.map(g=>`
        <div style="display:flex;align-items:center;padding:10px 8px;border-bottom:1px solid var(--bd);font-size:12.5px">
          <span style="flex:1;font-weight:700">${g.label} <span style="font-size:10.5px;color:var(--lab);font-weight:500">${g.ages}</span></span>
          <span style="width:110px;text-align:right;font-weight:600">${cbManwon(g.limit)}</span>
          <span class="cb-num" style="width:110px;text-align:right;font-size:12px">${cbKrw(g.monthly)}/월</span>
          <span style="width:130px;text-align:right;font-weight:700">${cbManwon(g.nominal)}</span>
          <span style="width:110px;text-align:right;font-weight:700;color:var(--up)">+${cbManwon(g.extra)}</span>
        </div>`).join('')}
      <div style="font-size:10.5px;color:var(--dim);margin-top:9px;line-height:1.6">※ 상속세 및 증여세법 기준 참고용 시뮬레이션입니다. 실제 신고 시 세무 전문가 확인이 필요합니다. 할인율(기획재정부령 고시 연 3.0%)은 변경될 수 있습니다. 실제 이체 기록 관리가 필요하면 "현금 흐름" 페이지를 사용하세요.</div>
    </div>`;
}

// ───────────────────────── 페이지: 양도소득세 ─────────────────────────
let _cbTaxDraft = { m:String(new Date().getMonth()+1), k:'foreign', pl:'' };
function cbTaxChartSvg(w,h,list){
  const agg={};
  list.forEach(t=>{ const m=parseInt(String(t.month).split('-')[1]||'0'); if(!m) return;
    const k=m+'-'+(t.category==='domestic'?'d':'f'); agg[k]=(agg[k]||0)+(t.amt||0); });
  const vals=Object.values(agg);
  const mx=Math.max(...vals.map(Math.abs),1);
  const y0=h/2, sc=(h/2-16)/mx, bw=w/12/2-8;
  let out=`<line x1="0" x2="${w}" y1="${y0}" y2="${y0}" style="stroke:var(--bd2)" stroke-width="1"></line>`;
  for(let m=1;m<=12;m++){
    const xf=(m-1)/12*w+6;
    [['f','var(--acc)',0],['d','#4ecdc4',1]].forEach(cfg=>{
      const v=agg[m+'-'+cfg[0]]||0; if(!v) return;
      const bh=Math.abs(v)*sc;
      out+=`<rect x="${xf+cfg[2]*(bw+3)}" y="${v>0?y0-bh:y0}" width="${bw}" height="${bh}" rx="2" style="fill:${cfg[1]}" opacity=".9"></rect>`;
    });
    out+=`<text x="${xf+bw}" y="${h-3}" style="fill:var(--lab)" font-size="10" text-anchor="middle" font-family="Noto Sans KR">${m}월</text>`;
  }
  return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block">${out}</svg>`;
}
function cbRenderTax(){
  const el = document.getElementById('cb-tax2'); if(!el) return;
  try{ loadMonthlyPL(); }catch(e){}
  const year = new Date().getFullYear();
  const list = (monthlyPLData||[]).filter(t=>String(t.month||'').startsWith(String(year)));
  const fgn = list.filter(t=>t.category!=='domestic').reduce((s,t)=>s+(t.amt||0),0);
  const dom = list.filter(t=>t.category==='domestic').reduce((s,t)=>s+(t.amt||0),0);
  const base = Math.max(0, fgn-2500000), due = Math.round(base*0.22);
  const sorted = [...list].sort((a,b)=>String(a.month).localeCompare(String(b.month)));
  el.innerHTML = `
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><div class="cb-title">양도소득세 계산 (${year}년 실현손익)</div><div style="font-size:11.5px;color:var(--lab)">매도 확정 손익만 기록합니다</div></div>
    <div style="display:flex;gap:12px;margin-top:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:420px">
        <div class="cb-panel" style="padding:14px 16px 8px">
          <div style="display:flex;gap:14px;margin-bottom:8px;font-size:11px;color:var(--mut)">
            <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:var(--acc)"></span>해외주식</span>
            <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:#4ecdc4"></span>국내주식</span>
          </div>
          ${cbTaxChartSvg(1100,190,list)}
        </div>
        <div class="cb-panel" style="margin-top:12px;padding:14px 16px">
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
            <select id="cb-tax-m" class="cb-input">${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${String(i+1)===_cbTaxDraft.m?'selected':''}>${i+1}월</option>`).join('')}</select>
            <select id="cb-tax-k" class="cb-input"><option value="foreign" ${_cbTaxDraft.k==='foreign'?'selected':''}>해외주식</option><option value="domestic" ${_cbTaxDraft.k==='domestic'?'selected':''}>국내주식</option></select>
            <input id="cb-tax-pl" class="cb-input" value="${cbEsc(_cbTaxDraft.pl)}" placeholder="실현손익 (원, 손실은 -)" style="flex:1;min-width:160px" />
            <button onclick="cbTaxAdd()" class="cb-btn" style="padding:8px 14px;font-size:12px">기록</button>
          </div>
          <div style="display:flex;font-size:10.5px;color:var(--dim);padding:0 8px 6px;border-bottom:1px solid var(--bd)">
            <span style="width:52px">월</span><span style="width:80px">시장</span><span style="width:70px">소유주</span><span style="flex:1;text-align:right">실현손익</span><span style="width:44px"></span>
          </div>
          ${sorted.map(t=>`
            <div style="display:flex;align-items:center;padding:7px 8px;border-bottom:1px solid var(--bd);font-size:12.5px">
              <span style="width:52px;color:var(--mut)">${parseInt(String(t.month).split('-')[1]||'0')}월</span>
              <span style="width:80px;font-weight:600">${t.category==='domestic'?'국내주식':'해외주식'}</span>
              <span style="width:70px;color:var(--mut);font-size:11px">${cbEsc(t.owner||'전체')}</span>
              <span class="cb-num" style="flex:1;text-align:right;font-weight:700;font-size:12px;${cbUpDn(t.amt||0)}">${(t.amt>=0?'+':'')+cbKrw(t.amt||0)}</span>
              <span class="cb-del" onclick="cbTaxDel(${t.id})" style="width:44px;text-align:right">삭제</span>
            </div>`).join('') || '<div style="padding:16px;text-align:center;color:var(--dim);font-size:12px">기록된 실현손익이 없습니다.</div>'}
        </div>
      </div>
      <div style="width:290px;flex-shrink:0;display:flex;flex-direction:column;gap:10px">
        <div class="cb-panel" style="padding:15px 16px">
          <div style="font-size:11px;letter-spacing:.06em;color:var(--lab);margin-bottom:10px">해외주식 양도소득세</div>
          <div style="display:flex;flex-direction:column;gap:8px;font-size:12px">
            <div style="display:flex;justify-content:space-between"><span style="color:var(--mut)">실현손익 합계</span><span style="font-weight:700;${cbUpDn(fgn)}">${(fgn>=0?'+':'')+cbKrw(fgn)}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:var(--mut)"><span data-tip="해외주식 양도차익에서 연 250만원까지는 세금을 물리지 않는 기본공제액">기본공제</span></span><span style="font-weight:700">−2,500,000원</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:var(--mut)"><span data-tip="실현손익 합계에서 기본공제를 뺀, 실제 세율이 적용되는 금액">과세표준</span></span><span style="font-weight:700">${cbKrw(base)}</span></div>
            <div style="display:flex;justify-content:space-between;padding-top:8px;border-top:1px solid var(--bd)"><span style="color:var(--mut)">세율</span><span style="font-weight:700">22% <span style="color:var(--dim);font-weight:400">(지방세 포함)</span></span></div>
            <div style="display:flex;justify-content:space-between;align-items:baseline"><span style="font-weight:700">예상 납부세액</span><span style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:21px;font-weight:800;color:var(--dn)">${cbKrw(due)}</span></div>
          </div>
          <div style="font-size:10.5px;color:var(--dim);margin-top:9px;line-height:1.6">신고·납부 기한: ${year+1}년 5월 (예정신고 기준). 손실은 같은 해 이익과 통산됩니다.</div>
        </div>
        <div class="cb-panel" style="padding:15px 16px">
          <div style="font-size:11px;letter-spacing:.06em;color:var(--lab);margin-bottom:8px">국내주식</div>
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px"><span style="color:var(--mut)">실현손익 합계</span><span style="font-weight:700;${cbUpDn(dom)}">${(dom>=0?'+':'')+cbKrw(dom)}</span></div>
          <div style="font-size:11.5px;color:var(--mut);line-height:1.6"><span data-tip="종목당 보유액 50억원 미만·지분율 기준 미만인 일반 투자자">소액주주</span>의 상장주식 장내 매도 차익은 <b style="color:var(--up)">비과세</b>입니다. 증권거래세(0.15%)만 매도 시 원천 징수됩니다.</div>
        </div>
      </div>
    </div>`;
}
function cbTaxAdd(){
  if (typeof isMobileLayout==='function' && isMobileLayout()) return;
  const m = document.getElementById('cb-tax-m')?.value || '1';
  const k = document.getElementById('cb-tax-k')?.value || 'foreign';
  const raw = (document.getElementById('cb-tax-pl')?.value || '').replace(/,/g,'').trim();
  const pl = parseFloat(raw);
  _cbTaxDraft = { m, k, pl:'' };
  if (raw==='' || isNaN(pl)) { alert('실현손익 금액을 입력하세요.'); return; }
  try{ loadMonthlyPL(); }catch(e){}
  const year = new Date().getFullYear();
  monthlyPLData.push({ id:Date.now(), month:`${year}-${String(m).padStart(2,'0')}`, amt:pl, memo:'', owner:'전체', category:k });
  saveMonthlyPL();
  cbRenderTax();
}
function cbTaxDel(id){
  if (typeof isMobileLayout==='function' && isMobileLayout()) return;
  if(!confirm('삭제하시겠습니까?')) return;
  try{ loadMonthlyPL(); }catch(e){}
  monthlyPLData = monthlyPLData.filter(r=>r.id!==id);
  saveMonthlyPL();
  cbRenderTax();
}

// ───────────────────────── 페이지: DCA 자동매수 ─────────────────────────
let _cbDcaDraft = { idx:'', amt:'', cycle:'매월', day:'' };
function cbDcaPerMonthKRW(i){
  const amtKrw = (i.dcaMode==='qty')
    ? (i.dcaQty||0)*(i.curP||0)*cbRate(i.cur)
    : (i.dcaAmt||0)*cbRate(i.dcaCur||'KRW');
  if (i.dcaCycle==='매주') return amtKrw*4.33;
  if (i.dcaCycle==='매일') return amtKrw*21.7; // 월평균 영업일
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
function cbRenderDca(){
  const el = document.getElementById('cb-dca2'); if(!el) return;
  const items = (pfolioData||[]).map((i,idx)=>({i,idx}))
    .filter(x=>(x.i.dcaAmt>0)||(x.i.dcaMode==='qty'&&x.i.dcaQty>0));
  const active = items.filter(x=>x.i.dca);
  const monthly = active.reduce((s,x)=>s+cbDcaPerMonthKRW(x.i),0);
  const opts = (pfolioData||[]).map((i,idx)=>({i,idx})).filter(x=>x.i.grp!=='현금' && (x.i.qty||0)>=0);
  el.innerHTML = `
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><div class="cb-title"><span data-tip="Dollar Cost Averaging — 시점을 나눠 일정 금액을 기계적으로 매수해 평균 단가를 관리하는 적립식 투자법">DCA</span> 자동매수</div><div style="font-size:11.5px;color:var(--lab)">등록된 규칙에 따라 기계적으로 매수합니다</div></div>
    <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:170px;background:var(--accSoft);border:1px solid var(--bd);border-radius:12px;padding:12px 14px"><div style="font-size:11px;color:var(--mut)">월 자동매수 합계 (활성 기준)</div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;margin-top:2px">${cbDisp(monthly)}</div></div>
      <div class="cb-panel" style="flex:1;min-width:170px;padding:12px 14px"><div style="font-size:11px;color:var(--lab)">활성 규칙</div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;margin-top:2px">${active.length}<span style="font-size:13px;color:var(--lab)"> / ${items.length}</span></div></div>
      <div class="cb-panel" style="flex:1;min-width:170px;padding:12px 14px"><div style="font-size:11px;color:var(--lab)">연간 적립 예상</div><div style="font-family:'Manrope','Noto Sans KR',sans-serif;font-size:22px;font-weight:800;margin-top:2px">${cbDisp(monthly*12)}</div></div>
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px">
      <div style="font-size:10.5px;letter-spacing:.08em;color:var(--lab);margin-bottom:10px">새 규칙 등록 <span style="color:var(--dim)">· 계좌는 선택한 보유 종목의 증권사/거래소를 따릅니다</span></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select id="cb-dca-asset" class="cb-input" style="min-width:190px">
          <option value="">종목 선택…</option>
          ${opts.map(x=>`<option value="${x.idx}" ${String(x.idx)===String(_cbDcaDraft.idx)?'selected':''}>[${cbEsc(x.i.owner)}] ${cbEsc(x.i.name||x.i.tkr)} (${cbEsc(x.i.tkr)})</option>`).join('')}
        </select>
        <input id="cb-dca-amt" class="cb-input" value="${cbEsc(_cbDcaDraft.amt)}" placeholder="회당 금액 (원)" style="width:140px" />
        <select id="cb-dca-cycle" class="cb-input">
          <option ${_cbDcaDraft.cycle==='매월'?'selected':''}>매월</option><option ${_cbDcaDraft.cycle==='매주'?'selected':''}>매주</option><option ${_cbDcaDraft.cycle==='매일'?'selected':''}>매일</option>
        </select>
        <input id="cb-dca-day" class="cb-input" value="${cbEsc(_cbDcaDraft.day)}" placeholder="이체일 (예: 25 또는 월)" style="width:150px" />
        <button onclick="cbDcaAdd()" class="cb-btn" style="padding:8px 16px;font-size:12px">등록</button>
      </div>
    </div>
    <div class="cb-panel" style="margin-top:12px;padding:14px 16px;overflow-x:auto">
      <div style="display:flex;font-size:10.5px;color:var(--dim);padding:0 8px 7px;border-bottom:1px solid var(--bd);min-width:760px">
        <span style="flex:1">종목</span><span style="width:100px;text-align:right">회당 금액</span><span style="width:64px;text-align:right">주기</span><span style="width:110px;text-align:right">이체일</span><span style="width:120px;text-align:right">계좌</span><span style="width:110px;text-align:right">월 환산</span><span style="width:66px;text-align:center">활성</span><span style="width:44px"></span>
      </div>
      ${items.map(x=>{
        const r=cbRow(x.i,x.idx);
        const amtLabel = x.i.dcaMode==='qty'
          ? (x.i.dcaQty||0).toLocaleString(undefined,{maximumFractionDigits:4})+'주'
          : cbFmtNative(x.i.dcaAmt||0, x.i.dcaCur||'KRW');
        return `
        <div style="display:flex;align-items:center;padding:9px 8px;border-bottom:1px solid var(--bd);font-size:12.5px;min-width:760px;${x.i.dca?'':'opacity:.45'}">
          <div style="flex:1;display:flex;align-items:center;gap:8px;min-width:0">
            <span class="cb-num" style="width:27px;height:27px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:8.5px;font-weight:800;background:${r.cl.color}22;color:${r.cl.color};flex-shrink:0">${cbEsc(r.chip)}</span>
            <span style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(r.title)} <span style="font-size:10px;color:var(--lab);font-weight:500">${cbEsc(x.i.owner)}</span></span>
          </div>
          <span style="width:100px;text-align:right;font-weight:700">${amtLabel}</span>
          <span style="width:64px;text-align:right;color:var(--mut)">${cbEsc(x.i.dcaCycle||'매월')}</span>
          <span style="width:110px;text-align:right;color:var(--mut)">${cbDcaDayLabel(x.i)}</span>
          <span style="width:120px;text-align:right;color:var(--mut);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cbEsc(x.i.broker||'—')}</span>
          <span style="width:110px;text-align:right;font-weight:600">${cbDisp(cbDcaPerMonthKRW(x.i))}/월</span>
          <span style="width:66px;display:flex;justify-content:center">
            <span onclick="cbDcaToggle(${x.idx})" style="width:34px;height:19px;border-radius:10px;cursor:pointer;position:relative;transition:background .15s;background:${x.i.dca?'var(--up)':'var(--bd2)'}"><span style="position:absolute;top:2px;width:15px;height:15px;border-radius:50%;background:#fff;transition:left .15s;left:${x.i.dca?'17px':'2px'}"></span></span>
          </span>
          <span class="cb-del" onclick="cbDcaDel(${x.idx})" style="width:44px;text-align:right">삭제</span>
        </div>`;}).join('') || '<div style="padding:16px;text-align:center;color:var(--dim);font-size:12px">등록된 DCA 규칙이 없습니다.</div>'}
    </div>`;
}
function cbDcaAdd(){
  if (typeof isMobileLayout==='function' && isMobileLayout()) return;
  const idx = document.getElementById('cb-dca-asset')?.value;
  const amtRaw = (document.getElementById('cb-dca-amt')?.value||'').replace(/,/g,'').trim();
  const cycle = document.getElementById('cb-dca-cycle')?.value || '매월';
  const dayRaw = (document.getElementById('cb-dca-day')?.value||'').trim();
  _cbDcaDraft = { idx, amt:amtRaw, cycle, day:dayRaw };
  const item = pfolioData[parseInt(idx)];
  const amt = parseFloat(amtRaw);
  if (!item){ alert('종목을 선택하세요.'); return; }
  if (isNaN(amt) || amt<=0){ alert('회당 금액을 입력하세요.'); return; }
  item.dca = true; item.dcaMode='amount'; item.dcaAmt=amt; item.dcaCur='KRW'; item.dcaCycle=cycle;
  if (cycle==='매월'){ item.dcaDay = parseInt(dayRaw)||1; item.dcaDays = undefined; }
  else if (cycle==='매주'){
    const D=['일','월','화','수','목','금','토'];
    const di = D.findIndex(d=>dayRaw.includes(d));
    item.dcaDays=[di>=0?di:1]; item.dcaDay=undefined;
  }
  try{ saveAssetsToKV(); }catch(e){}
  _cbDcaDraft = { idx:'', amt:'', cycle:'매월', day:'' };
  cbRenderDca();
}
function cbDcaToggle(idx){
  const item=pfolioData[idx]; if(!item) return;
  item.dca=!item.dca;
  try{ saveAssetsToKV(); }catch(e){}
  cbRenderDca();
}
function cbDcaDel(idx){
  if(!confirm('DCA 규칙을 삭제하시겠습니까?')) return;
  const item=pfolioData[idx]; if(!item) return;
  item.dca=false; delete item.dcaAmt; delete item.dcaQty; delete item.dcaMode; delete item.dcaCycle; delete item.dcaDay; delete item.dcaDays; delete item.dcaCur;
  try{ saveAssetsToKV(); }catch(e){}
  cbRenderDca();
}

// ───────────────────────── 라우팅 통합 ─────────────────────────
function cbRerender(){
  if (_cobaltActive && CB_VIEWS[_cobaltActive]){
    try{ CB_VIEWS[_cobaltActive](); }catch(e){ console.error('[cobalt render]', e); }
  }
  const fn=document.getElementById('feed-note');
  if (fn) fn.textContent = '전일 종가 연동 · ' + new Date().toLocaleTimeString('ko-KR',{hour:'numeric',minute:'2-digit'});
}

const _cbOrigSwitchView = switchView;
switchView = function(id, btn){
  if (id === 'dashboard'){ id='cdash'; btn = btn || document.getElementById('menu-dashboard'); }
  if (!CB_VIEWS[id]){ _cobaltActive=null; return _cbOrigSwitchView(id, btn); }
  _cobaltActive = id;
  try{ if (typeof closeSidebar==='function') closeSidebar(); }catch(e){}
  document.querySelectorAll('.menu-btn').forEach(b=>b.classList.remove('active'));
  const mbtn = btn || document.getElementById('menu-' + (id==='cdash' ? 'dashboard' : id));
  if (mbtn && mbtn.classList) mbtn.classList.add('active');
  document.querySelectorAll('.view-section').forEach(v=>v.classList.remove('active'));
  const v = document.getElementById('view-'+id); if(v) v.classList.add('active');
  const title = document.getElementById('main-title'); if (title) title.textContent = CB_TITLES[id];
  ['owner-tabs-container','cf-owner-bar','bubble-owner-bar','analysis-owner-bar'].forEach(x=>{
    const e=document.getElementById(x); if(e) e.style.display='none';
  });
  try{ CB_VIEWS[id](); }catch(e){ console.error('[cobalt render]', e); }
};

// 데이터 변경/갱신 시 활성 Cobalt 페이지 재렌더
const _cbOrigChangeOwner = changeOwner;
changeOwner = function(owner, btn, isRefresh){
  _cbOrigChangeOwner(owner, btn, isRefresh);
  cbRerender();
};
// 자산 내역에서 추가/수정/삭제 → KV 저장이 일어나면 활성 Cobalt 페이지(대시보드 등)에 즉시 반영
const _cbOrigSaveAssets = saveAssetsToKV;
saveAssetsToKV = async function(){
  const r = await _cbOrigSaveAssets();
  cbRerender();
  return r;
};
// 초기 KV 로드 완료 시에도 대시보드 재렌더 (시세 갱신 실패 시에도 보유 자산은 표시)
const _cbOrigLoadAssets = loadAssetsFromKV;
loadAssetsFromKV = async function(){
  const r = await _cbOrigLoadAssets();
  cbRerender();
  return r;
};
const _cbOrigFetchDivData = fetchDivData;
fetchDivData = async function(){
  await _cbOrigFetchDivData();
  cbRerender();
};
const _cbOrigUpdateBenchmark = updateBenchmark;
updateBenchmark = function(tf, btn){
  _cbOrigUpdateBenchmark(tf, btn);
  if (_cobaltActive === 'perf2') cbRerender();
};
// 테마 전환 시 활성 Cobalt 페이지 재렌더 — 인라인으로 해석된 테마 색(hex)을 새 테마 기준으로 다시 계산
const _cbOrigSetTheme = setTheme;
setTheme = function(mode){
  _cbOrigSetTheme(mode);
  cbRerender();
};
