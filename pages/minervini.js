// ── 투자 분석 > 차트 공부 > 추세추종(미너비니) 보기 ──
// 마크 미너비니의 책 두 권에 적힌 규칙을 내 종목의 일봉에 그대로 대어 본다.
//   《Trade Like a Stock Market Wizard》(2013) — 트렌드 템플릿 8조건 · 4단계 · VCP(변동성 수축 패턴) · 손절 규칙
//   《Think & Trade Like a Champion》(2017) — 한 번에 거는 위험(자산의 1.25~2.5%) · 손익비 · 진입 후 손절선 옮기기
// 규칙을 확인해 주는 도구이지 매수 신호가 아니다. 그대로 옮길 수 없는 것(시장 전체 순위 RS·실적)은 화면에 '대신'·'못 함'으로 밝힌다.
// 계산은 아래 순수 함수(mnvTemplate·mnvStage·mnvVcp·mnvRisk)뿐이고, 그리는 쪽은 그 결과를 옮긴다.

let _chsLens = 'basic', _mnvRange = '1Y';
const MNV_MA = [
  {n:50,  label:'50일선',  cls:'mm50'},
  {n:150, label:'150일선', cls:'mm150'},
  {n:200, label:'200일선', cls:'mm200'},
];
const MNV_RANGES = {'6M':['6개월',126], '1Y':['1년',252], '2Y':['2년',504]};
const MNV_MONTH = 21;          // 1개월 ≈ 21거래일(200일선 기울기를 재는 간격)
const MNV_YEAR = 252;          // 52주 ≈ 252거래일
const MNV_MAX_STOP = 10;       // 최대 손절 −10%(책: "손실을 10% 넘게 두지 않는다 · 평균 손실은 6~7%")
const MNV_DEF_STOP = 7;        // 패턴이 없을 때 쓰는 일반 손절 폭(평균 손실 6~7% 의 위쪽)
const MNV_RISK_PCTS = [1.25, 2.5]; // 한 번에 거는 위험 = 자산의 1.25~2.5%(Think & Trade Like a Champion)
const MNV_BREAKOUT_VOL = 1.4;
// 한 종목 상한 — 손절 폭이 아주 좁으면 위험 식이 자산의 절반 넘게 사라고 계산한다. 책의 숫자가 아니라 앱의 가정이며 화면에 그렇게 적는다.
const MNV_POS_CAP = 25;  // 돌파일 거래량이 50일 평균보다 40% 이상 많아야 '거래량 실린 돌파'

function mnvBenchKey(cur){ return String(cur||'').toUpperCase()==='KRW' ? 'kospi' : 'spy'; }
function mnvBenchName(k){ return k==='kospi' ? 'KOSPI' : 'S&P 500'; }
// 지수 종가를 종목 봉 날짜에 맞춘다 — 같은 날(UTC 일) 값, 없으면 직전 값.
function mnvAlignBench(bars, bench){
  const list = (Array.isArray(bench) ? bench : []).filter(b=>b && Number.isFinite(b.c) && b.c>0).sort((a,b)=>a.t-b.t);
  if (!list.length) return null;
  const out = []; let j = 0, last = null;
  bars.forEach(b=>{
    const day = Math.floor(b.t/86400);
    while (j < list.length && Math.floor(list[j].t/86400) <= day){ last = list[j].c; j++; }
    out.push(last);
  });
  return out.some(v=>v!=null) ? out : null;
}
// 분기 수익률 가중 — IBD 상대강도 식(최근 분기 40% · 앞 세 분기 20%씩)을 한 종목에 적용한 값
function mnvWeightedPerf(closes, i){
  if (i < MNV_YEAR) return null;
  const q = k => { const a = closes[i-63*(k-1)], b = closes[i-63*k]; return a!=null && b>0 ? a/b-1 : null; };
  const r = [q(1),q(2),q(3),q(4)];
  if (r.some(v=>v==null)) return null;
  return 0.4*r[0] + 0.2*r[1] + 0.2*r[2] + 0.2*r[3];
}
// 200일선이 몇 개월째 오르는지 — 21거래일 간격으로 거슬러 올라가며 계속 올랐던 달 수
function mnvRisingMonths(ma, i){
  let k = 0;
  while (i-(k+1)*MNV_MONTH >= 0 && ma[i-k*MNV_MONTH]!=null && ma[i-(k+1)*MNV_MONTH]!=null && ma[i-k*MNV_MONTH] > ma[i-(k+1)*MNV_MONTH]) k++;
  return k;
}
function mnvMas(bars){
  const c = bars.map(b=>b.c), ma = {};
  MNV_MA.forEach(m=>{ ma[m.n] = chsSma(c, m.n); });
  ma.vol50 = chsSma(bars.map(b=>b.v||0), 50);
  return ma;
}

// ① 트렌드 템플릿 8조건 — pass 는 true/false, 자료가 모자라면 null(판정 보류)
function mnvTemplate(bars, ma, benchCloses){
  const i = bars.length-1, c = bars[i] ? bars[i].c : null;
  const m50 = ma[50][i], m150 = ma[150][i], m200 = ma[200][i];
  const pct = v => (v>=0?'+':'')+v.toFixed(1)+'%';
  const span = bars.slice(-MNV_YEAR), full52 = bars.length >= MNV_YEAR;
  const lo52 = Math.min(...span.map(b=>b.l)), hi52 = Math.max(...span.map(b=>b.h));
  const fromLo = (c/lo52-1)*100, fromHi = (c/hi52-1)*100;
  const months = mnvRisingMonths(ma[200], i);
  const has200m = m200!=null && ma[200][i-MNV_MONTH]!=null;
  const closes = bars.map(b=>b.c);
  const sp = mnvWeightedPerf(closes, i), bp = benchCloses ? mnvWeightedPerf(benchCloses, i) : null;
  const rsGap = sp!=null && bp!=null ? (sp-bp)*100 : null;
  const T = (id, label, pass, value, tip) => ({id, label, pass, value, tip});
  const checks = [
    T(1, '가격이 150일선·200일선 위', m150==null||m200==null ? null : c>m150 && c>m200,
      m200==null ? '봉 부족' : `150일선 ${pct((c/m150-1)*100)} · 200일선 ${pct((c/m200-1)*100)}`, '긴 평균보다 비싸게 거래된다 = 큰 흐름이 위쪽'),
    T(2, '150일선이 200일선 위', m150==null||m200==null ? null : m150>m200,
      m200==null ? '봉 부족' : `차이 ${pct((m150/m200-1)*100)}`, '중기 평균이 장기 평균보다 높다'),
    T(3, '200일선이 1개월 이상 오름', has200m ? months>=1 : null,
      !has200m ? '봉 부족' : months>=1 ? `${months}개월째 오름` : `한 달 전보다 ${pct((m200/ma[200][i-MNV_MONTH]-1)*100)}`, '책: 최소 1개월, 되도록 4~5개월 이상'),
    T(4, '50일선이 150일선·200일선 위', m50==null||m150==null||m200==null ? null : m50>m150 && m50>m200,
      m200==null ? '봉 부족' : `150일선보다 ${pct((m50/m150-1)*100)}`, '짧은 평균 > 중기 > 장기 순서로 놓임'),
    T(5, '가격이 50일선 위', m50==null ? null : c>m50, m50==null ? '봉 부족' : pct((c/m50-1)*100), '최근 두 달 반 평균보다 위'),
    T(6, '52주 저점보다 30% 이상 높음', full52 ? fromLo>=30 : null, full52 ? `저점 대비 ${pct(fromLo)}` : '1년치 봉 부족', '책: 크게 오른 종목은 저점의 2~4배인 경우가 많다'),
    T(7, '52주 고점과 25% 이내', full52 ? fromHi>=-25 : null, full52 ? `고점 대비 ${pct(fromHi)}` : '1년치 봉 부족', '고점에 가까울수록 좋다'),
    T(8, '상대강도 — 지수보다 강함(대체)', rsGap==null ? null : rsGap>0, rsGap==null ? '지수 자료 부족' : `지수보다 ${rsGap>=0?'+':''}${rsGap.toFixed(1)}%p`,
      '책은 IBD 상대강도 순위 70 이상(되도록 80~90)을 쓴다. 앱은 시장 전체 순위를 낼 수 없어, 같은 가중 식(최근 분기 40%·앞 세 분기 20%씩)을 지수와 견준다'),
  ];
  const known = checks.filter(x=>x.pass!=null).length, score = checks.filter(x=>x.pass===true).length;
  return {checks, score, known, fromLo, fromHi, hi52, lo52, months, rsGap};
}

// ② 4단계 — 200일선의 한 달 기울기와 가격 위치로 근사한다(책의 1 바닥 · 2 상승 · 3 천장 · 4 하락)
const MNV_STAGES = {
  1:{name:'1단계 · 바닥 다지기', tone:'mid', text:'200일선이 평평하고 가격이 그 위아래를 오갑니다. 책: 사지 않고 지켜보는 구간'},
  2:{name:'2단계 · 상승', tone:'up', text:'200일선이 오르고 가격이 그 위에 있습니다. 책: 이 단계에서만 산다'},
  3:{name:'3단계 · 천장', tone:'warn', text:'오르던 200일선이 꺾이거나 가격이 그 아래로 내려오기 시작했습니다. 책: 팔 준비를 하는 구간'},
  4:{name:'4단계 · 하락', tone:'dn', text:'200일선이 내리고 가격이 그 아래에 있습니다. 책: 절대 사지 않는 구간'},
};
function mnvStage(bars, ma){
  const i = bars.length-1, c = bars[i].c, m50 = ma[50][i], m200 = ma[200][i];
  if (m200==null || ma[200][i-MNV_MONTH]==null) return null;
  const slope = (m200/ma[200][i-MNV_MONTH]-1)*100;               // 200일선 한 달 변화(%)
  const prior = ma[200][i-6*MNV_MONTH], before = prior!=null ? (ma[200][i-MNV_MONTH]/prior-1)*100 : 0; // 그 전 다섯 달
  let s;
  if (slope>0 && c>m200 && m50!=null && m50>m200) s = 2;
  else if (slope<0 && c<m200 && (m50==null || m50<m200)) s = 4;
  else if (before > 2) s = 3;         // 오르던 장기선이 멈추거나 가격이 내려옴
  else s = 1;
  return {stage:s, slope, ...MNV_STAGES[s]};
}

// ③ VCP — 베이스(최근 65주 안 가장 높은 곳부터 지금까지) 안의 되돌림이 갈수록 얕아지는지,
// 마지막 되돌림에서 거래량이 줄었는지, 마지막 되돌림의 고점(피벗)을 거래량을 싣고 넘었는지.
// 패턴은 사람이 눈으로 판단하는 것이라 이 판정은 근사다 — 화면에 그렇게 적는다.
function mnvSwings(bars, from, k=4){
  const out = [];
  for (let i = from; i < bars.length; i++){
    let hi = true, lo = true;
    for (let j = Math.max(from, i-k); j <= Math.min(bars.length-1, i+k); j++){
      if (j===i) continue;
      if (bars[j].h > bars[i].h) hi = false;
      if (bars[j].l < bars[i].l) lo = false;
    }
    if (hi) out.push({i, kind:'H', p:bars[i].h});
    if (lo) out.push({i, kind:'L', p:bars[i].l});
  }
  return out;
}
function mnvContractions(bars, start){
  // 시작 고점에서 출발해 '고점 → 그 뒤 가장 낮은 곳 → 다음 고점' 을 차례로 잡는다
  const sw = mnvSwings(bars, start), out = [];
  let hiI = start, hiP = bars[start].h;
  const highs = sw.filter(s=>s.kind==='H' && s.i>start);
  let h = 0;
  while (true){
    // 다음 고점 후보: 지금 고점 이후, 사이의 저점에서 3% 이상 되오른 첫 스윙 고점
    let lowI = -1, lowP = Infinity, next = null;
    for (let i = hiI+1; i < bars.length; i++){
      if (bars[i].l < lowP){ lowP = bars[i].l; lowI = i; }
      const cand = highs.find(s=>s.i===i);
      if (cand && lowI>=0 && cand.i>lowI && cand.p >= lowP*1.03){ next = cand; break; }
    }
    if (lowI < 0) break;
    const depth = (hiP-lowP)/hiP*100;
    if (depth >= 1.5) out.push({hiI, hiP, lowI, lowP, depth, open:!next});
    if (!next || ++h > 12) break;
    hiI = next.i; hiP = next.p;
  }
  return out;
}
function mnvVcp(bars, ma){
  const n = bars.length, i = n-1;
  if (n < 60) return {state:'none', reason:'봉이 모자랍니다'};
  const vol50 = ma.vol50[i];
  // 베이스 시작 = 최근 65주(325거래일) 안 가장 높은 곳. 그 고점이 최근 10거래일 안이면 이미 위로 뚫고 있는 중 —
  // 그 전 베이스(10거래일 전까지)를 찾아 돌파 여부를 본다.
  const lookStart = Math.max(0, n-325);
  const argmax = (a,b) => { let m=a; for (let j=a; j<=b; j++) if (bars[j].h > bars[m].h) m=j; return m; };
  let end = i, top = argmax(lookStart, i), fresh = false;
  if (top >= n-10){ fresh = true; end = n-11; if (end-lookStart < 20) return {state:'none', reason:'신고가 구간 — 아직 베이스가 없습니다'}; top = argmax(lookStart, end); }
  const baseLen = end - top;
  if (baseLen < 15) return {state:'none', reason:'베이스가 3주보다 짧습니다'};
  const sub = bars.slice(0, end+1);
  const ct = mnvContractions(sub, top);
  if (ct.length < 2) return {state:'none', reason:`되돌림이 ${ct.length}번뿐입니다(2번 이상 필요)`, contractions:ct, top, baseWeeks:Math.round(baseLen/5)};
  const depths = ct.map(x=>x.depth);
  const shrinking = depths.every((d,k)=>k===0 || d < depths[k-1]*1.05);
  const last = ct[ct.length-1], first = ct[0];
  const pivot = last.open ? Math.max(...sub.slice(last.hiI).map(b=>b.h)) : last.hiP;
  const lastVol = (()=>{ const s = sub.slice(last.hiI, end+1); return s.reduce((a,b)=>a+(b.v||0),0)/Math.max(1,s.length); })();
  const volDry = vol50>0 ? lastVol < vol50 : null;
  const base = {contractions:ct, depths, top, pivot, stopLow:last.lowP, baseWeeks:Math.round(baseLen/5), volDry, lastVolPct: vol50>0 ? (lastVol/vol50-1)*100 : null, first:first.depth, lastDepth:last.depth};
  if (first.depth > 60) return {state:'none', reason:`첫 되돌림이 ${first.depth.toFixed(0)}%로 너무 깊습니다(책: 60% 넘게 빠진 베이스는 대개 실패)`, ...base};
  if (!shrinking) return {state:'none', reason:`되돌림이 갈수록 작아지지 않습니다(${depths.map(d=>d.toFixed(0)+'%').join(' → ')})`, ...base};
  if (last.depth > 15) return {state:'none', reason:`마지막 되돌림이 ${last.depth.toFixed(0)}%로 아직 넓습니다(보통 10% 안쪽으로 좁혀진다)`, ...base};
  const c = bars[i].c, todayVolX = vol50>0 ? (bars[i].v||0)/vol50 : null;
  if (c > pivot){
    // 최근 10거래일 안에 피벗을 넘은 첫날의 거래량
    let bi = i; for (let j = i; j > Math.max(end, i-10); j--) if (bars[j].c > pivot && bars[j-1].c <= pivot){ bi = j; break; }
    const bx = vol50>0 ? (bars[bi].v||0)/(ma.vol50[bi]||vol50) : null;
    const withVol = bx!=null && bx >= MNV_BREAKOUT_VOL;
    return {state: withVol ? 'breakout' : 'weak', breakIdx:bi, breakVolX:bx, fresh, ...base,
      reason: withVol ? `피벗을 거래량 ${((bx-1)*100).toFixed(0)}% 늘며 넘었습니다` : `피벗은 넘었지만 거래량이 평소 수준입니다(책: 거래량이 실려야 한다)`};
  }
  return {state:'forming', todayVolX, ...base, toPivot:(pivot/c-1)*100,
    reason:`피벗까지 ${((pivot/c-1)*100).toFixed(1)}% 남음`};
}

// ④ 위험 관리 — 피벗에서 산다고 할 때 손절선·손익비·한 번에 살 수 있는 금액(자산 대비)
function mnvRisk(vcp, close, equityKrw, avg){
  const hasPivot = vcp && (vcp.state==='forming' || vcp.state==='breakout' || vcp.state==='weak');
  const entry = hasPivot ? Math.max(vcp.pivot, vcp.state==='forming' ? vcp.pivot : close) : close;
  let stop, basis;
  if (hasPivot && vcp.stopLow < entry && (1-vcp.stopLow/entry)*100 <= MNV_MAX_STOP){ stop = vcp.stopLow; basis = 'pattern'; }
  else if (hasPivot){ stop = entry*(1-MNV_MAX_STOP/100); basis = 'cap'; }
  else { stop = entry*(1-MNV_DEF_STOP/100); basis = 'default'; }
  const riskPct = (1-stop/entry)*100;
  const targets = [2,3].map(k=>({k, price: entry*(1+k*riskPct/100)}));
  const sizes = equityKrw>0 ? MNV_RISK_PCTS.map(r=>{ const raw = r/riskPct*100, pct = Math.min(raw, MNV_POS_CAP); return {r, pct, capped: raw>MNV_POS_CAP, krw: equityKrw*pct/100}; }) : [];
  const fromAvg = avg && avg.price>0 ? (close/avg.price-1)*100 : null;
  return {entry, stop, riskPct, basis, targets, sizes, fromAvg, overMax: fromAvg!=null && fromAvg <= -MNV_MAX_STOP};
}

// 한 종목 분석 묶음(차트·표가 같이 쓴다)
function mnvAnalyze(data, row){
  const bars = data.bars, ma = mnvMas(bars), bk = mnvBenchKey(data.cur || (row&&row.cur));
  const bench = mnvAlignBench(bars, data.bench && data.bench[bk]);
  const stage = mnvStage(bars, ma);
  let vcp = mnvVcp(bars, ma);
  // 책: VCP 는 2단계 상승 추세 안에서만 본다 — 그 밖의 단계에서는 모양이 비슷해도 패턴으로 치지 않는다
  if (vcp.state!=='none' && (!stage || stage.stage!==2)) vcp = {...vcp, state:'none', reason:`되돌림 모양은 있지만 ${stage?stage.stage+'단계':'단계 미상'}라 VCP로 보지 않습니다(책: 2단계에서만)`};
  return {bars, ma, bk, bench, tpl:mnvTemplate(bars, ma, bench), stage, vcp};
}

// ── 내 종목 한눈에 — 일봉을 둘씩 차례로 받는다(리스크 화면과 같은 캐시) ──
let _mnvQueue = null;
function mnvLoadAll(list){
  if (_mnvQueue) return;
  const todo = list.map(r=>r.tkr).filter(t=>!_chsCache[t] && !_chsErr[t]);
  if (!todo.length) return;
  _mnvQueue = todo.slice();
  let pending = null;
  const kick = () => { if (pending) return; pending = setTimeout(()=>{ pending = null; if (_cobaltActive==='chart2' && _chsLens==='mnv') cbRenderChart(); }, 250); };
  const worker = async () => {
    while (_mnvQueue && _mnvQueue.length){
      const t = _mnvQueue.shift();
      if (_chsCache[t]) continue;
      try { _chsCache[t] = await chsFetchBars(t, 'D'); } catch(e){ _chsErr[t] = (e&&e.message)||'조회 실패'; }
      kick();
    }
  };
  Promise.all([worker(), worker()]).finally(()=>{ _mnvQueue = null; kick(); });
}

// ── 그리기 ──
function mnvChartSvg(view){
  const {bars, off, cur, A} = view, n = bars.length, W = 1100, padL = 10, padR = 66;
  const P = {price:{y:14,h:330}, vol:{y:378,h:70}, rs:{y:482,h:90}};
  const H = 604, plotW = W-padL-padR, step = plotW/n, X = i => padL + (i+0.5)*step;
  const sl = arr => arr ? arr.slice(off) : [];
  const vcp = A.vcp, risk = view.risk;
  let lo = Math.min(...bars.map(b=>b.l)), hi = Math.max(...bars.map(b=>b.h));
  MNV_MA.forEach(m=>sl(A.ma[m.n]).forEach(v=>{ if(v!=null){ lo=Math.min(lo,v); hi=Math.max(hi,v); } }));
  if (risk && risk.stop>lo*0.85) lo = Math.min(lo, risk.stop);
  const padY = (hi-lo)*0.06 || hi*0.02; lo-=padY; hi+=padY;
  const Yp = v => P.price.y + (hi-v)/(hi-lo)*P.price.h;
  const pTicks = chsTicks(lo,hi,5), pStep = pTicks.length>1 ? pTicks[1]-pTicks[0] : 1;
  const pFmt = v => v.toLocaleString('ko-KR',{maximumFractionDigits: pStep>=1 ? 0 : pStep>=0.1 ? 1 : 2});
  const grid = (ticks, Y, fmt) => ticks.map(v=>`<line x1="${padL}" x2="${W-padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="chs-grid"/><text x="${W-padR+8}" y="${(Y(v)+4).toFixed(1)}" class="chs-ax">${fmt(v)}</text>`).join('');
  const bw = Math.max(1, Math.min(7, step*0.62)), hollow = bw >= 4;
  // VCP 되돌림 — 고점에서 저점까지 옅은 상자 + 깊이 글자
  const ctBoxes = (vcp && vcp.contractions || []).map((c,k)=>{
    const a = c.hiI-off, b = c.lowI-off; if (b < 0) return '';
    const x1 = X(Math.max(0,a))-step/2, x2 = X(b)+step/2;
    return `<rect x="${x1.toFixed(1)}" y="${Yp(c.hiP).toFixed(1)}" width="${(x2-x1).toFixed(1)}" height="${(Yp(c.lowP)-Yp(c.hiP)).toFixed(1)}" class="mnv-ct"/>`
      + `<text x="${((x1+x2)/2).toFixed(1)}" y="${(Yp(c.lowP)+15).toFixed(1)}" class="mnv-ct-lab" text-anchor="middle">T${k+1} −${c.depth.toFixed(0)}%</text>`;
  }).join('');
  const hasPivot = vcp && vcp.pivot && vcp.state!=='none';
  const hline = (v, cls, lab, anchorRight) => `<line x1="${padL}" x2="${W-padR}" y1="${Yp(v).toFixed(1)}" y2="${Yp(v).toFixed(1)}" class="${cls}"/><text x="${anchorRight?W-padR-6:padL+6}" y="${(Yp(v)-6).toFixed(1)}" class="${cls}-lab" text-anchor="${anchorRight?'end':'start'}">${lab}</text>`;
  const pivotLine = hasPivot ? hline(vcp.pivot, 'mnv-pivot', `피벗 ${chsNum(vcp.pivot,cur)}`, true) : '';
  const stopLine = risk && hasPivot ? hline(risk.stop, 'mnv-stop', `손절선 ${chsNum(risk.stop,cur)} (−${risk.riskPct.toFixed(1)}%)`, false) : '';
  const avgIn = view.avg && view.avg.price>=lo && view.avg.price<=hi;
  const avgLine = avgIn ? `<line x1="${padL}" x2="${W-padR}" y1="${Yp(view.avg.price).toFixed(1)}" y2="${Yp(view.avg.price).toFixed(1)}" class="chs-avg"/><text x="${padL+6}" y="${(Yp(view.avg.price)-6).toFixed(1)}" class="chs-avg-lab">내 평균 매입가 ${chsNum(view.avg.price,cur)}</text>` : '';
  const candles = bars.map((b,i)=>{
    const up = b.c >= b.o, x = X(i), y1 = Yp(Math.max(b.o,b.c)), y2 = Yp(Math.min(b.o,b.c)), cls = up ? 'chs-up' : 'chs-dn';
    return `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${Yp(b.h).toFixed(1)}" y2="${Yp(b.l).toFixed(1)}" class="${cls} chs-wick"/>`
      + `<rect x="${(x-bw/2).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1,y2-y1).toFixed(1)}" class="${cls}${up&&hollow?' is-hollow':''}"/>`;
  }).join('');
  const maLines = MNV_MA.map(m=>`<path d="${chsPath(sl(A.ma[m.n]),X,Yp)}" class="chs-ma ${m.cls}"/>`).join('');
  // 거래량 + 50일 평균 거래량 선, 돌파일은 진하게
  const vmax = Math.max(1, ...bars.map(b=>b.v||0));
  const Yv = v => P.vol.y + P.vol.h - (v/vmax)*P.vol.h;
  const bIdx = vcp && vcp.breakIdx!=null ? vcp.breakIdx-off : -1;
  const vol = bars.map((b,i)=>`<rect x="${(X(i)-bw/2).toFixed(1)}" y="${Yv(b.v||0).toFixed(1)}" width="${bw.toFixed(1)}" height="${(P.vol.y+P.vol.h-Yv(b.v||0)).toFixed(1)}" class="${b.c>=b.o?'chs-up':'chs-dn'} chs-vol${i===bIdx?' is-break':''}"/>`).join('');
  const vAvg = `<path d="${chsPath(sl(A.ma.vol50),X,Yv)}" class="mnv-vavg"/>`;
  // RS선 — 종목 ÷ 지수, 보이는 첫날을 100 으로
  let rsSvg = `<text x="${padL+4}" y="${P.rs.y+P.rs.h/2}" class="chs-zone">지수 자료가 없어 RS선을 그릴 수 없습니다</text>`;
  if (A.bench){
    const rs = bars.map((b,i)=>{ const bv = A.bench[i+off]; return bv>0 ? b.c/bv : null; });
    const base = rs.find(v=>v!=null);
    const rsn = rs.map(v=>v==null||!base ? null : v/base*100);
    const vals = rsn.filter(v=>v!=null), rlo = Math.min(...vals), rhi = Math.max(...vals), pad = (rhi-rlo)*0.08||1;
    const Yr = v => P.rs.y + (rhi+pad-v)/(rhi-rlo+2*pad)*P.rs.h;
    const rTicks = chsTicks(rlo-pad, rhi+pad, 3);
    const lastI = rsn.length-1, isHigh = rsn[lastI]!=null && rsn[lastI] >= rhi*0.995;
    rsSvg = grid(rTicks, Yr, v=>v.toFixed(0)) + `<path d="${chsPath(rsn,X,Yr)}" class="mnv-rs"/>`
      + (isHigh ? `<circle cx="${X(lastI).toFixed(1)}" cy="${Yr(rsn[lastI]).toFixed(1)}" r="4" class="mnv-rs-dot"/><text x="${(X(lastI)-8).toFixed(1)}" y="${(Yr(rsn[lastI])-8).toFixed(1)}" class="mnv-rs-lab" text-anchor="end">RS선 기간 최고</text>` : '');
  }
  const keys = bars.map(b=>chsTickKey(chsDate(b.t), 'D'));
  const changes = keys.filter((k,i)=>i>0 && k!==keys[i-1]).length, every = Math.max(1, Math.ceil(changes/12)); let k = 0;
  const xTicks = bars.map((b,i)=>{
    if (i===0 || keys[i]===keys[i-1] || (k++ % every)) return '';
    return `<line x1="${X(i).toFixed(1)}" x2="${X(i).toFixed(1)}" y1="${P.price.y}" y2="${P.rs.y+P.rs.h}" class="chs-vgrid"/><text x="${X(i).toFixed(1)}" y="${H-8}" class="chs-ax" text-anchor="middle">${chsTickLabel(chsDate(b.t),'D')}</text>`;
  }).join('');
  const panelLab = (y, t) => `<text x="${padL+4}" y="${y-8}" class="chs-plab">${t}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="chs-svg" role="img" aria-label="일봉 차트 — 가격·50·150·200일선·VCP·거래량·RS선">
    ${xTicks}${grid(pTicks, Yp, pFmt)}
    ${ctBoxes}${avgLine}${candles}${maLines}${pivotLine}${stopLine}
    ${panelLab(P.vol.y,'거래량 · 선은 50일 평균')}${vol}${vAvg}
    ${panelLab(P.rs.y,`RS선 · ${mnvBenchName(A.bk)} 대비(첫날 100)`)}${rsSvg}
    <line id="chs-cross" x1="0" x2="0" y1="${P.price.y}" y2="${P.rs.y+P.rs.h}" class="chs-cross" style="display:none"/>
    <rect x="${padL}" y="${P.price.y}" width="${plotW}" height="${P.rs.y+P.rs.h-P.price.y}" fill="transparent" onmousemove="chsHover(event)" onmouseleave="chsHover(null)" data-chart-hit="chs"/>
  </svg>`;
}

function mnvCheckIcon(p){ return p===true ? '<i class="mnv-ok" aria-label="통과">✓</i>' : p===false ? '<i class="mnv-no" aria-label="미통과">✕</i>' : '<i class="mnv-na" aria-label="판정 보류">–</i>'; }
function mnvTemplateCard(tpl){
  const tone = tpl.score===8 ? 'up' : tpl.score>=6 ? 'warn' : 'dn';
  return `<div class="cb-panel mnv-card mnv-tpl">
    <div class="mnv-card-head"><span class="cb-panel-title" data-tip="《Trade Like a Stock Market Wizard》의 트렌드 템플릿 — 8개를 모두 만족해야 2단계 상승 종목으로 본다">트렌드 템플릿</span><b class="mnv-score is-${tone}">${tpl.score}<small> / 8</small></b></div>
    <ol class="mnv-checks">${tpl.checks.map(x=>`<li class="${x.pass===true?'is-ok':x.pass===false?'is-no':'is-na'}">${mnvCheckIcon(x.pass)}<span data-tip="${cbEsc(x.tip)}">${x.label}</span><em class="cb-num">${x.value}</em></li>`).join('')}</ol>
    <small class="mnv-foot">${tpl.score===8?'8개 모두 통과 — 책이 말하는 매수 후보의 최소 조건을 갖췄습니다(조건일 뿐 신호는 아닙니다).':tpl.known<8?'자료가 모자란 항목은 판정 보류(–)입니다.':`${8-tpl.score}개 미통과 — 책의 기준으로는 아직 매수 후보가 아닙니다.`}</small>
  </div>`;
}
function mnvStageCard(st){
  const steps = [1,2,3,4].map(s=>`<span class="mnv-stage-step${st&&st.stage===s?' is-on is-'+MNV_STAGES[s].tone:''}">${s}</span>`).join('');
  return `<div class="cb-panel mnv-card">
    <div class="mnv-card-head"><span class="cb-panel-title" data-tip="1 바닥 → 2 상승 → 3 천장 → 4 하락. 앱은 200일선의 한 달 기울기와 가격·50일선 위치로 근사한다">단계</span></div>
    <div class="mnv-stage-bar">${steps}</div>
    ${st ? `<div class="mnv-big is-${st.tone}">${st.name}</div><p class="mnv-text">${st.text}</p><small class="mnv-foot">200일선 한 달 변화 ${st.slope>=0?'+':''}${st.slope.toFixed(1)}%</small>`
         : '<p class="mnv-text">200일선을 그릴 만큼 봉이 없어 판정을 보류합니다.</p>'}
  </div>`;
}
function mnvVcpCard(v, cur){
  const word = {breakout:'돌파', weak:'돌파 · 거래량 부족', forming:'형성 중', none:'패턴 아님'}[v.state];
  const tone = {breakout:'up', weak:'warn', forming:'acc', none:'mid'}[v.state];
  const depths = v.depths ? v.depths.map(d=>d.toFixed(0)+'%').join(' → ') : '—';
  const row = (k,val) => `<div><span>${k}</span><b class="cb-num">${val}</b></div>`;
  return `<div class="cb-panel mnv-card">
    <div class="mnv-card-head"><span class="cb-panel-title" data-tip="변동성 수축 패턴 — 되돌림이 갈수록 얕아지고(예: 25% → 12% → 5%) 거래량이 마르다가, 마지막 되돌림의 고점(피벗)을 거래량을 싣고 넘는 모양. 사람이 눈으로 보는 패턴이라 앱의 판정은 근사다">VCP · 변동성 수축</span></div>
    <div class="mnv-big is-${tone}">${word}</div>
    <p class="mnv-text">${cbEsc(v.reason||'')}</p>
    <div class="mnv-kv">
      ${row('되돌림', v.depths ? `${depths} <small>(${v.depths.length}T)</small>` : '—')}
      ${row('베이스 길이', v.baseWeeks ? `${v.baseWeeks}주` : '—')}
      ${row('마지막 구간 거래량', v.lastVolPct==null ? '—' : `50일 평균 ${v.lastVolPct>=0?'+':''}${v.lastVolPct.toFixed(0)}%${v.volDry?' · 마름':''}`)}
      ${row('피벗', v.pivot ? chsNum(v.pivot,cur) : '—')}
    </div>
  </div>`;
}
function mnvRiskCard(r, cur, owner, v){
  const row = (k,val,cls='') => `<div><span>${k}</span><b class="cb-num ${cls}">${val}</b></div>`;
  const basis = {pattern:'마지막 되돌림의 저점', cap:'저점이 10%보다 멀어 −10% 상한', default:`패턴이 없어 일반 손절 −${MNV_DEF_STOP}%`}[r.basis];
  return `<div class="cb-panel mnv-card">
    <div class="mnv-card-head"><span class="cb-panel-title" data-tip="《Trade Like a Stock Market Wizard》: 손실은 10%를 넘기지 않고 평균 6~7%. 《Think & Trade Like a Champion》: 한 번에 거는 위험은 자산의 1.25~2.5%, 이익은 위험의 2배 이상을 노린다">위험 관리</span></div>
    <div class="mnv-kv">
      ${row(r.basis==='default'?'기준 가격(지금)':'진입(피벗)', chsNum(r.entry,cur))}
      ${row('손절선', `${chsNum(r.stop,cur)} <small>−${r.riskPct.toFixed(1)}%</small>`, 'is-dn')}
      ${row('손익비 2배 · 3배', r.targets.map(t=>chsNum(t.price,cur)).join(' · '), 'is-up')}
      ${r.sizes.map(s=>row(`위험 ${s.r}% 기준 매수 한도`, `${cbKrw(s.krw)} <small>자산의 ${s.pct.toFixed(0)}%${s.capped?' · 상한':''}</small>`)).join('')}
    </div>
    <small class="mnv-foot">손절선 근거: ${basis}${r.sizes.length?` · 자산 = ${cbEsc(owner)} 투자자산`:''}${r.sizes.some(s=>s.capped)?` · 한 종목 ${MNV_POS_CAP}% 상한은 앱의 가정(책의 숫자 아님)`:''}</small>
    ${r.fromAvg!=null ? `<div class="mnv-hold${r.overMax?' is-dn':''}">내 평균 매입가 대비 <b class="cb-num">${r.fromAvg>=0?'+':''}${r.fromAvg.toFixed(1)}%</b>${r.overMax?' — 책의 최대 손절선(−10%)을 이미 넘었습니다':''}</div>` : ''}
  </div>`;
}
function mnvOverviewHtml(list){
  const score = r => _chsCache[r.tkr] ? mnvAnalyze(_chsCache[r.tkr], r).tpl.score : -1;
  const sorted = list.slice().sort((a,b)=>score(b)-score(a));
  const rows = sorted.map(r=>{
    const d = _chsCache[r.tkr];
    if (!d) return `<tr><td>${cbEsc(r.name)}</td><td colspan="5" class="mnv-ov-wait">${_chsErr[r.tkr] ? '받지 못함' : '받는 중…'}</td></tr>`;
    const A = mnvAnalyze(d, r), sel = r.tkr===_chsTkr;
    const vw = {breakout:'돌파', weak:'돌파(거래량 부족)', forming:`형성 중 · 피벗까지 ${A.vcp.toPivot!=null?A.vcp.toPivot.toFixed(1)+'%':''}`, none:'—'}[A.vcp.state];
    return `<tr class="${sel?'is-sel':''}" role="button" tabindex="0" onclick="chsPick('${cbEsc(r.tkr)}')" data-sort-tpl="${A.tpl.score}">
      <td><span class="mnv-ov-name">${cbEsc(r.name)}</span>${r.name!==r.tkr?` <small>${cbEsc(r.tkr)}</small>`:''}</td>
      <td><span class="mnv-dots" aria-label="${A.tpl.score}/8">${A.tpl.checks.map(x=>`<i class="${x.pass===true?'is-ok':x.pass===false?'is-no':'is-na'}"></i>`).join('')}</span> <b class="cb-num">${A.tpl.score}/8</b></td>
      <td>${A.stage ? `<span class="mnv-stage-chip is-${A.stage.tone}">${A.stage.stage}단계</span>` : '—'}</td>
      <td>${vw}</td>
      <td class="cb-num">${A.tpl.fromHi!=null&&isFinite(A.tpl.fromHi) ? A.tpl.fromHi.toFixed(1)+'%' : '—'}</td>
      <td class="cb-num ${A.tpl.rsGap>0?'is-up':A.tpl.rsGap<0?'is-dn':''}">${A.tpl.rsGap==null?'—':(A.tpl.rsGap>=0?'+':'')+A.tpl.rsGap.toFixed(1)+'%p'}</td>
    </tr>`;
  });
  const done = list.filter(r=>_chsCache[r.tkr]).map(r=>mnvAnalyze(_chsCache[r.tkr], r));
  const pass = done.filter(a=>a.tpl.score===8).length;
  return `<div class="cb-panel mnv-ov">
    <div class="mnv-card-head"><span class="cb-panel-title">내 종목 한눈에</span><small>트렌드 템플릿 8개 모두 통과 <b>${pass}</b> / ${list.length}종목 · 줄을 누르면 위 차트로</small></div>
    <div class="cb-scroll"><table class="mnv-ov-table">
      <thead><tr><th>종목</th><th>트렌드 템플릿</th><th>단계</th><th>VCP</th><th>52주 고점 대비</th><th>지수 대비(대체 RS)</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>
  </div>`;
}
const MNV_SCOPE = [
  ['그대로', 'up', [
    ['트렌드 템플릿 1~7번', '50·150·200일 이동평균, 52주 고저 — 책의 숫자 그대로'],
    ['손절 규칙', '최대 −10%, 평균 6~7% · 마지막 되돌림 저점 아래'],
    ['위험·금액 계산', '한 번에 자산의 1.25~2.5% 위험, 손익비 2~3배'],
  ]],
  ['대신(근사)', 'warn', [
    ['상대강도(8번)', '책은 IBD 시장 전체 순위(70 이상). 앱은 같은 가중 식으로 S&P 500·KOSPI 와만 비교'],
    ['단계 1~4', '책은 차트를 보고 판단. 앱은 200일선 기울기·가격 위치로 근사'],
    ['VCP', '사람이 눈으로 보는 패턴. 앱은 되돌림 깊이·거래량 규칙으로 근사 — 꼭 차트로 다시 확인'],
  ]],
  ['못 함', 'dn', [
    ['실적(SEPA)', 'EPS·매출 성장, 실적 서프라이즈, 이익률 — 앱에 자료가 없음'],
    ['시장 상황', '지수 자체의 추세·주도주 수 — 앱이 판단하지 않음'],
    ['장중 판단', '돌파 당일 장중 거래량 — 앱은 마감된 일봉만 씀'],
  ]],
];
function mnvScopeHtml(){
  return `<div class="cb-panel chs-guide mnv-scope">
    <div class="cb-panel-title">어디까지 따라 하나</div>
    <div class="mnv-scope-grid">${MNV_SCOPE.map(([t,tone,items])=>`<div class="mnv-scope-col"><div class="mnv-scope-head is-${tone}">${t}</div><dl>${items.map(([a,b])=>`<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl></div>`).join('')}</div>
    <small class="fin-callout">출처: Mark Minervini, 《Trade Like a Stock Market Wizard》(2013, 트렌드 템플릿·단계·VCP·손절), 《Think &amp; Trade Like a Champion》(2017, 위험 크기·손익비). 규칙에 맞는지 확인하는 공부용 도구이며 매수 신호가 아닙니다.</small>
  </div>`;
}

// 추세추종 보기 본문 — cbRenderChart 가 부른다
function mnvBody(list, row, ownerF){
  const data = _chsCache[_chsTkr];
  if (!data && !_chsErr[_chsTkr]) chsLoad(_chsTkr, 'D');
  mnvLoadAll(list);
  const ranges = `<div class="owner-tabs" role="group" aria-label="보이는 기간">${Object.entries(MNV_RANGES).map(([k,[lab]])=>`<button class="owner-btn${k===_mnvRange?' active':''}" data-mnv-range="${k}" aria-pressed="${k===_mnvRange}" onclick="mnvRangePick('${k}')">${lab}</button>`).join('')}</div>`;
  if (!data){
    _chsView = null;
    return {tools:ranges, body: _chsErr[_chsTkr] ? `<div class="chs-msg">일봉을 받지 못했습니다(${cbEsc(_chsErr[_chsTkr])}).</div>` : `<div class="chs-msg" role="status">일봉을 받는 중…</div>`, below: mnvOverviewHtml(list) + mnvScopeHtml()};
  }
  const A = mnvAnalyze(data, row), all = A.bars, keep = Math.min(all.length, MNV_RANGES[_mnvRange][1]), off = all.length-keep;
  const cur = data.cur || row.cur, avg = row.cur===cur ? chsAvg(row) : null, last = all[all.length-1], prev = all[all.length-2];
  const equity = (pfolioData||[]).filter(i=>i && (!ownerF || i.owner===ownerF)).reduce((s,i)=>s+(assetValueKRW(i)||0),0);
  const risk = mnvRisk(A.vcp, last.c, equity, avg);
  const ind = chsIndicators(all); MNV_MA.forEach(m=>{ ind.ma[m.n] = A.ma[m.n]; });
  _chsView = {bars:all.slice(off), allBars:all, ind, off, cur, avg, frame:'D', A, risk, maList:MNV_MA};
  const chg = prev ? (last.c/prev.c-1)*100 : 0, d = chsDate(last.t);
  const body = `<div class="chs-top">
      <div class="chs-price"><b class="cb-num">${chsNum(last.c,cur)}</b> <span class="chs-cur">${cbEsc(cur)}</span> <em class="cb-num ${chg>=0?'is-up':'is-dn'}">${chg>=0?'+':''}${chg.toFixed(2)}%</em><small>${d.m}월 ${d.d}일 종가 · Yahoo 일봉 · 비교 지수 ${mnvBenchName(A.bk)}</small></div>
      <div class="chs-legend" aria-label="범례">${MNV_MA.map(m=>`<span><i class="chs-sw ${m.cls}"></i>${m.label}</span>`).join('')}<span><i class="chs-sw mnv-sw-ct"></i>VCP 되돌림</span><span><i class="chs-sw mnv-sw-pivot"></i>피벗</span><span><i class="chs-sw mnv-sw-stop"></i>손절선</span></div>
    </div>
    <div class="chs-plot cb-chart-scroll"><div class="chs-plot-inner">${mnvChartSvg(_chsView)}<div id="chs-tip" class="chs-tip" hidden></div></div></div>
    <div class="mnv-grid">${mnvTemplateCard(A.tpl)}<div class="mnv-col">${mnvStageCard(A.stage)}${mnvVcpCard(A.vcp, cur)}</div>${mnvRiskCard(risk, cur, ownerF||'가족 전체', A.vcp)}</div>`;
  return {tools:ranges, body, below: mnvOverviewHtml(list) + mnvScopeHtml()};
}
function mnvRangePick(r){ _mnvRange = MNV_RANGES[r] ? r : '1Y'; cbRenderChart(); cbRestoreFilterFocus('cb-chart2','data-mnv-range',_mnvRange); }
function chsLensPick(l){ _chsLens = l==='mnv' ? 'mnv' : 'basic'; cbRenderChart(); cbRestoreFilterFocus('cb-chart2','data-chs-lens',_chsLens); }
