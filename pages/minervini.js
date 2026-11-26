// ── 투자 분석 > 추세추종(trend2) — 미국 주식을 검색해 마크 미너비니 규칙으로 판단한다 ──
// 마크 미너비니의 책 두 권에 적힌 규칙을 내 종목의 일봉에 그대로 대어 본다.
//   《Trade Like a Stock Market Wizard》(2013) — 트렌드 템플릿 8조건 · 4단계 · VCP(변동성 수축 패턴) · 손절 규칙
//   《Think & Trade Like a Champion》(2017) — 한 번에 거는 위험(자산의 1.25~2.5%) · 손익비 · 진입 후 손절선 옮기기
// 규칙을 확인해 주는 도구이지 매수 신호가 아니다. 그대로 옮길 수 없는 것(시장 전체 순위 RS·실적)은 화면에 '대신'·'못 함'으로 밝힌다.
// 계산은 아래 순수 함수(mnvTemplate·mnvStage·mnvVcp·mnvRisk)뿐이고, 그리는 쪽은 그 결과를 옮긴다.

let _mnvRange = '1Y';
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
const MNV_BREAKOUT_VOL = 1.4;  // 돌파일 거래량이 50일 평균보다 40% 이상 많아야 '거래량 실린 돌파'
// 한 종목 상한 — 손절 폭이 아주 좁으면 위험 식이 자산의 절반 넘게 사라고 계산한다. 책의 숫자가 아니라 앱의 가정이며 화면에 그렇게 적는다.
const MNV_POS_CAP = 25;
const MNV_RS_MIN = 70;         // 상대강도 순위 70 이상, 되도록 80~90(트렌드 템플릿 8번)

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
function mnvTemplate(bars, ma, benchCloses, rsRank){
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
    Number.isFinite(rsRank)
      ? T(8, `상대강도 순위 ${MNV_RS_MIN} 이상`, rsRank>=MNV_RS_MIN, `${Math.round(rsRank)}점 · 상위 ${Math.max(1,100-Math.round(rsRank))}%`,
          `책: 상대강도 순위 ${MNV_RS_MIN} 이상, 되도록 80~90점대. 앱은 S&P 500 + 나스닥 100 약 520종목 안에서 같은 가중 식(최근 분기 40%·앞 세 분기 20%씩)으로 순위를 매긴다(시장 전체가 아니라 큰 회사들 안의 순위)`)
      : T(8, '상대강도 — 지수보다 강함(대체)', rsGap==null ? null : rsGap>0, rsGap==null ? '지수 자료 부족' : `지수보다 ${rsGap>=0?'+':''}${rsGap.toFixed(1)}%p`,
          `책은 상대강도 순위 ${MNV_RS_MIN} 이상을 쓴다. 이 종목은 종목 찾기 목록(S&P 500 + 나스닥 100) 밖이라 순위가 없어 지수와 견준다 — 책보다 쉬운 기준`),
  ];
  const known = checks.filter(x=>x.pass!=null).length, score = checks.filter(x=>x.pass===true).length;
  return {checks, score, known, fromLo, fromHi, hi52, lo52, months, rsGap, rsRank: Number.isFinite(rsRank) ? rsRank : null};
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

// 지수(S&P 500)도 종목과 같은 4단계로 본다 — 미너비니: 시장이 나쁘면 좋은 종목도 실패하기 쉽다(2026-11-26 사용자 결정: 추세추종 화면에 넣음)
function mnvIndexStage(bench){
  if (!Array.isArray(bench)) return null;
  const s = bench.slice(bench.lastIndexOf(null)+1).filter(Number.isFinite);
  if (s.length < 200 + 6*MNV_MONTH) return null;
  return mnvStage(s.map(c=>({c})), {50:chsSma(s,50), 200:chsSma(s,200)});
}
// 한 종목 분석 묶음(차트·표가 같이 쓴다)
function mnvAnalyze(data, row){
  const bars = data.bars, ma = mnvMas(bars), bk = mnvBenchKey(data.cur || (row&&row.cur));
  const bench = mnvAlignBench(bars, data.bench && data.bench[bk]);
  const stage = mnvStage(bars, ma);
  let vcp = mnvVcp(bars, ma);
  // 책: VCP 는 2단계 상승 추세 안에서만 본다 — 그 밖의 단계에서는 모양이 비슷해도 패턴으로 치지 않는다
  if (vcp.state!=='none' && (!stage || stage.stage!==2)) vcp = {...vcp, state:'none', reason:`되돌림 모양은 있지만 ${stage?stage.stage+'단계':'단계 미상'}라 VCP로 보지 않습니다(책: 2단계에서만)`};
  return {bars, ma, bk, bench, tpl:mnvTemplate(bars, ma, bench, row && row.rsRank), stage, vcp, mkt:mnvIndexStage(bench)};
}

// ── 그리기 ──
function mnvChartSvg(view){
  const {bars, off, cur, A} = view, n = bars.length, W = 1100, padL = 10, padR = 66;
  const pre = view.pre || 'chs', noRs = !!view.noRs;
  const P = {price:{y:14,h:330}, vol:{y:378,h:70}, rs:noRs ? {y:448,h:0} : {y:482,h:90}};
  const H = noRs ? 480 : 604, plotW = W-padL-padR, step = plotW/n, X = i => padL + (i+0.5)*step;
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
    ${noRs ? '' : panelLab(P.rs.y,`RS선 · ${mnvBenchName(A.bk)} 대비(첫날 100)`) + rsSvg}
    <line id="${pre}-cross" x1="0" x2="0" y1="${P.price.y}" y2="${P.rs.y+P.rs.h}" class="chs-cross" style="display:none"/>
    <rect x="${padL}" y="${P.price.y}" width="${plotW}" height="${P.rs.y+P.rs.h-P.price.y}" fill="transparent" onmousemove="chsHover(event,'${pre}')" onmouseleave="chsHover(null,'${pre}')" data-chart-hit="chs"/>
  </svg>`;
}

function mnvCheckIcon(p){ return p===true ? '<i class="mnv-ok" aria-label="통과">✓</i>' : p===false ? '<i class="mnv-no" aria-label="미통과">✕</i>' : '<i class="mnv-na" aria-label="판정 보류">–</i>'; }
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

// ── 최종 판단 — 신호등 다섯 개를 책의 순서대로 묶는다(2026-11-25 사용자 요청: 세부 지표 대신 신호등 + 매수·매도 한 단어) ──
// 판단 단어는 '미너비니 규칙으로 보면'의 뜻이다. 앱의 의견이나 투자 권유가 아니며, 화면에 그렇게 적는다.
const TRD_CHASE_PCT = 5;   // 피벗보다 5% 넘게 오른 뒤에는 쫓아 사지 않는다(돌파 매수의 일반 규칙)
const TRD_VERDICTS = {
  buy: {word:'매수', tone:'up'},
  wait:{word:'매수 대기', tone:'acc'},
  hold:{word:'관망', tone:'mid'},
  sell:{word:'매도 · 피하기', tone:'dn'},
};
// 실적 — stockanalysis.com 분기 표(전년 같은 분기 대비 EPS·매출 증가율). 미너비니는 추세가 좋은 종목 중 실적이 강한 것만 산다.
// 기준(2026-11-26 원문 대조): 분기 EPS·매출 전년 대비 +25% 이상, 3년 연평균 EPS·매출 +15% 이상,
// 3분기 연속 EPS·매출(·이익률) 증가율이 빨라지면 'Code 33' — 미너비니가 가장 반기는 실적.
const TRD_EPS_MIN = 25, TRD_REV_MIN = 25, TRD_ANNUAL_MIN = 15;
// 증가율이 3분기 연속 빨라졌나 — 최근이 앞에 오는 배열(g0 > g1 > g2 > g3)
function trdAccel3(vals){ return vals.length>=4 && vals.slice(0,4).every(Number.isFinite) && vals[0]>vals[1] && vals[1]>vals[2] && vals[2]>vals[3]; }
function trdEarnings(E){
  const q = E && Array.isArray(E.quarters) ? E.quarters.filter(x=>x && Number.isFinite(x.epsGrowth)) : [];
  if (q.length < 1) return {light:'n', text:'실적 자료를 받지 못함', ok:null};
  const [a, b] = q, accel = b && Number.isFinite(b.epsGrowth) ? a.epsGrowth > b.epsGrowth : null;
  const revOk = Number.isFinite(a.revGrowth) ? a.revGrowth >= TRD_REV_MIN : null;
  const an = E.annual || {}, annOk = [an.eps3y, an.rev3y].filter(Number.isFinite);
  const annualOk = annOk.length ? annOk.every(v=>v>=TRD_ANNUAL_MIN) : null;
  const margins = q.map(x=>x.margin);
  const code33 = trdAccel3(q.map(x=>x.epsGrowth)) && trdAccel3(q.map(x=>x.revGrowth)) && (margins.filter(Number.isFinite).length<4 || trdAccel3(margins));
  const pct = v => (v>=0?'+':'')+v.toFixed(0)+'%';
  const light = a.eps<=0 || a.epsGrowth<=0 ? 'r' : a.epsGrowth>=TRD_EPS_MIN && revOk!==false && annualOk!==false ? 'g' : 'y';
  const text = `분기 EPS ${pct(a.epsGrowth)}${Number.isFinite(a.revGrowth)?` · 매출 ${pct(a.revGrowth)}`:''}`
    + (Number.isFinite(an.eps3y) ? ` · 3년 연 ${pct(an.eps3y)}` : '')
    + (code33 ? ' · 3분기 연속 가속(Code 33)' : accel==null ? '' : accel ? ' · 빨라지는 중' : ' · 느려지는 중');
  return {light, text, ok: light==='g', bad: light==='r', q:a, accel, code33, annualOk};
}
function trdLights(A, close, E){
  const t = A.tpl, st = A.stage, v = A.vcp, ern = trdEarnings(E);
  const L = (key, name, light, text, tip) => ({key, name, light, text, tip});
  const chase = v.pivot && (v.state==='breakout' || v.state==='weak') ? (close/v.pivot-1)*100 : null;
  return [
    L('mkt','시장 흐름', !A.mkt ? 'n' : A.mkt.stage===2 ? 'g' : A.mkt.stage===4 ? 'r' : 'y', A.mkt ? `S&P 500 ${cbEsc(A.mkt.name)}` : '지수 자료 없음', '미너비니: 시장이 하락 단계면 좋은 종목도 실패하기 쉬워 새로 사지 않는다. 금리·달러(매크로)가 아니라 지수의 가격 흐름을 종목과 같은 4단계로 본다'),
    L('trend','추세', t.score===8 ? 'g' : t.score>=6 ? 'y' : 'r', `조건 8개 중 ${t.score}개 통과`, '트렌드 템플릿 — 이동평균 순서·52주 고저·지수 대비 강도. 8개 모두여야 통과'),
    L('stage','큰 흐름', !st ? 'n' : st.stage===2 ? 'g' : st.stage===4 ? 'r' : 'y', st ? st.name : '판정 보류', '1 바닥 · 2 상승 · 3 천장 · 4 하락. 2단계에서만 산다'),
    L('earn','실적', ern.light, ern.text, `초록 = 전년 같은 분기보다 EPS·매출 ${TRD_EPS_MIN}% 이상 + 3년 연평균 ${TRD_ANNUAL_MIN}% 이상. 3분기 연속 증가율이 빨라지면(Code 33) 미너비니가 가장 반기는 실적. 출처 stockanalysis.com`),
    t.rsRank!=null
      ? L('rs','시장보다 강한가', t.rsRank>=MNV_RS_MIN ? 'g' : t.rsRank>=50 ? 'y' : 'r', `상대강도 ${Math.round(t.rsRank)}점 · 상위 ${Math.max(1,100-Math.round(t.rsRank))}%`, `S&P 500 + 나스닥 100 약 520종목 안의 순위(최근 석 달에 무게). 책: ${MNV_RS_MIN}점 이상, 되도록 80~90점대`)
      : L('rs','시장보다 강한가', t.rsGap==null ? 'n' : t.rsGap>0 ? 'g' : t.rsGap>-5 ? 'y' : 'r', t.rsGap==null ? '지수 자료 없음' : `S&P 500보다 ${t.rsGap>=0?'+':''}${t.rsGap.toFixed(1)}%p`, '종목 찾기 목록 밖이라 순위가 없어 S&P 500 과 비교 — 책의 순위 기준보다 쉬움'),
    L('base','매수 자리', v.state==='breakout' ? 'g' : v.state==='forming'||v.state==='weak' ? 'y' : 'n',
      {breakout:'거래량 실린 돌파', weak:'돌파했지만 거래량 부족', forming:`자리 만드는 중 · 피벗까지 ${v.toPivot!=null?v.toPivot.toFixed(1):'—'}%`, none:'아직 없음'}[v.state], 'VCP — 흔들림이 갈수록 줄다가 고점(피벗)을 거래량 실어 넘는 자리'),
    L('chase','추격 위험', chase==null ? 'n' : chase>TRD_CHASE_PCT ? 'r' : 'g', chase==null ? '해당 없음' : chase>TRD_CHASE_PCT ? `피벗보다 ${chase.toFixed(1)}% 위 — 늦음` : `피벗에서 ${chase.toFixed(1)}% — 아직 안쪽`, `피벗보다 ${TRD_CHASE_PCT}% 넘게 오른 뒤에는 쫓아 사지 않는다`),
  ];
}
function trdVerdict(A, close, risk, E){
  const t = A.tpl, st = A.stage, v = A.vcp, lights = trdLights(A, close, E), ern = trdEarnings(E);
  const chased = lights.find(l=>l.key==='chase').light==='r';
  const s = st && st.stage, n = x => chsNum(x,'USD');
  let k, why;
  if (s===4 || s===3 || t.score<=3 || (ern.bad && t.score<8)){
    k = 'sell'; why = s===4 ? '하락 단계입니다. 규칙으로는 사지 않고, 갖고 있다면 정리를 검토하는 구간입니다.'
      : s===3 ? '오르던 흐름이 꺾이는 천장 단계입니다. 규칙으로는 새로 사지 않고 이익을 지키는 구간입니다.'
      : t.score<=3 ? `추세 조건을 ${t.score}개만 통과했습니다. 규칙으로는 사지 않는 종목입니다.`
      : '이익이 줄고 있고 추세 조건도 다 맞추지 못했습니다. 규칙으로는 사지 않는 종목입니다.';
  } else if (t.score===8 && s===2 && ern.bad){
    k = 'hold'; why = '차트는 좋지만 최근 분기 이익이 줄었습니다. 미너비니는 실적이 받쳐 주는 종목만 사므로 지켜봅니다.';
  } else if (t.score===8 && s===2 && v.state==='breakout' && !chased){
    k = 'buy'; why = `조건 8개를 모두 통과했고 피벗 $${n(v.pivot)}을 거래량을 싣고 넘었습니다. 손절선은 $${n(risk.stop)}(−${risk.riskPct.toFixed(1)}%)입니다.`;
  } else if (t.score===8 && s===2 && (v.state==='forming' || v.state==='weak')){
    k = 'wait'; why = v.state==='forming'
      ? `조건 8개를 모두 통과했습니다. $${n(v.pivot)}(피벗)을 거래량을 싣고 넘는 날이 매수 자리이고, 그 전에는 사지 않습니다.`
      : `피벗 $${n(v.pivot)}은 넘었지만 거래량이 평소 수준입니다. 거래량이 붙는지 확인한 뒤가 규칙에 맞습니다.`;
  } else {
    k = 'hold';
    const miss = t.checks.filter(x=>x.pass===false).map(x=>x.label);
    why = t.score<8 ? `추세 조건 중 ${miss.length}개(${miss.slice(0,2).join(' · ')}${miss.length>2?' 등':''})를 아직 못 맞췄습니다. 다 맞출 때까지 지켜봅니다.`
      : chased ? `좋은 종목이지만 이미 피벗보다 ${TRD_CHASE_PCT}% 넘게 올랐습니다. 쫓아 사지 않고 다음 자리를 기다립니다.`
      : '상승 추세는 맞지만 아직 매수 자리(VCP)가 보이지 않습니다. 자리가 생길 때까지 지켜봅니다.';
  }
  // 시장(지수)이 하락 단계면 사지 않는다 — 미너비니 자신의 시장 판단
  const mk = A.mkt && A.mkt.stage;
  if ((k==='buy'||k==='wait') && mk===4){ k = 'hold'; why = '종목은 규칙을 통과했지만 S&P 500 이 하락 단계(4단계)입니다. 미너비니는 시장이 나쁘면 좋은 종목도 실패하기 쉽다며 새로 사지 않습니다. 지수가 다시 오를 때까지 지켜봅니다.'; }
  else if (k==='buy' && mk===3) why += ' 다만 S&P 500 이 천장 단계라 평소보다 작게, 손절은 짧게 잡습니다.';
  if ((k==='buy'||k==='wait') && ern.ok===null) why += ' 실적은 확인하지 못했으니 따로 확인하세요.';
  else if ((k==='buy'||k==='wait') && ern.light==='g' && ern.code33) why += ' 실적도 3분기 연속 빨라지고 있습니다(Code 33).';
  else if ((k==='buy'||k==='wait') && ern.light==='y') why += ' 다만 실적 증가가 기준보다 약합니다 — 미너비니라면 더 강한 종목을 찾습니다.';
  // 장중에 보지 않아도 따라 할 수 있게 — 미리 걸어 둘 주문(2026-11-25 사용자 질문: 전일 종가 보고 진입해도 되나)
  const order = k==='wait' && v.state==='forming' ? {kind:'wait', pivot:v.pivot, stop:risk.stop}
    : k==='buy' ? {kind:'buy', maxBuy:v.pivot*(1+TRD_CHASE_PCT/100), stop:risk.stop} : null;
  return {key:k, ...TRD_VERDICTS[k], why, lights, order};
}


// ── 가치투자(value2)·매크로(macro2) 판정 — 스타일마다 따로 판단한다(2026-11-26 사용자 결정: 세 스타일은 서로 다른 질문이라 섞지 않는다).
// 가치 = 그레이엄·버핏·멍거(좋은 회사인가 · 비싸지 않은가), 매크로 = 소로스·드러켄밀러(지금 시장에서 공격해도 되나). 기준 숫자는 모두 잠정.
const TRD_MACRO = {hyJump:1.0, hyHigh:5.0, dxyFast:5, dxyWarm:2, fwd:0.25, bsWarm:0, bsFast:-3, valWarm:1.2, valHot:1.4};  // 숫자는 모두 앱 기준(원문에 없음)
const TRD_Q = {roe:15, netDebtFcf:2, marginBand:10, fcfYears:4};   // ROE 5년 모두 15%↑ · 순부채 ≤ FCF 2년('빚이 거의 없음') · 영업이익률 폭 10%p 안 · FCF 5년 중 4년 플러스 — 숫자는 앱 기준(원문은 '좋은 ROE·빚이 거의 없음')
const TRD_PE_BAND = 1.1;                                           // 자기 5년 중앙 PER 의 110% 이하면 '비싸지 않음' (앱 기준)
// 그레이엄 방어적 투자자 기준(《현명한 투자자》 14장): 유동비율 2↑ · 장기부채 < 운전자본 · 10년 흑자 · 20년 배당 · 10년 이익 3분의 1↑ 성장 · 3년 평균 이익 PER 15↓ · PER×PBR 22.5↓
const GRH = {curRatio:2, years:10, divYears:20, growth:33, pe:15, pepb:22.5};
function trdMacro(M){
  if (!M) return {light:'n', word:'자료 없음', items:[], size:1, text:'시장 자료를 받지 못해 크기 조정을 하지 않았습니다'};
  const it = (key, name, light, text, tip, lens, src=null) => ({key, name, light, text, tip, lens, src});
  const f = (v,d=2) => Number.isFinite(v) ? v.toFixed(d) : '—';
  const items = [];
  // 유동성 — 드러켄밀러: "시장을 움직이는 건 이익이 아니라 연준이다", "18개월 뒤를 그려 보라". 지난 변화가 아니라 시장이 예상하는 앞으로의 금리를 본다.
  if (M.fed && Number.isFinite(M.t2)){ const d = M.t2 - M.fed.now;
    items.push(it('fed','앞으로의 금리', d>TRD_MACRO.fwd ? 'r' : 'g', d<-TRD_MACRO.fwd ? `시장은 인하 예상 (2년물 ${f(M.t2)}% < 기준 ${f(M.fed.now)}%)` : d>TRD_MACRO.fwd ? `시장은 인상 예상 (2년물 ${f(M.t2)}% > 기준 ${f(M.fed.now)}%)` : `동결 예상 (2년물 ${f(M.t2)}% ≈ 기준 ${f(M.fed.now)}%)`, '2년물 국채금리는 앞으로 2년 기준금리에 대한 시장의 예상. 지금 기준금리보다 높으면 시장이 인상(돈 조이기)을 예상하는 것 — 빨강', 'liq')); }
  if (M.bs){ const d = (M.bs.now/M.bs.ago6m-1)*100;
    items.push(it('bs','연준이 푼 돈', d<=TRD_MACRO.bsFast ? 'r' : d<TRD_MACRO.bsWarm ? 'y' : 'g', `연준 자산 6개월 ${d>=0?'+':''}${f(d,1)}% (${d<0?'거둬들이는 중':'푸는 중'})`, `연준 대차대조표 크기. 줄이면(양적 긴축) 시중의 돈이 빠진다. 6개월 ${TRD_MACRO.bsFast}% 이하 빨강`, 'liq')); }
  // 금리·금리차·신용·달러 네 장은 FRED 일별 자료(/api/macro, 2026-11-26 사용자 결정 — DGS10·T10Y2Y·BAA10Y·DTWEXBGS).
  // 판정 기준(TRD_MACRO)은 그대로 두고 자료만 바꿨다. 10년 국채금리는 원래 판정 기준이 없어 참고값(회색)으로만 보인다.
  const src = id => M.series && M.series[id] ? M.series[id] : null;
  if (Number.isFinite(M.t10)) items.push(it('rate','미국 국채 금리', 'n', `10년물 ${f(M.t10)}%`, '미국 10년 만기 국채 금리. 판정 기준이 없어 신호등은 켜지 않습니다 — 가치투자 화면의 \'국채보다 나은가\' 비교에 씁니다', 'liq', src('DGS10')));
  if (M.curve && Number.isFinite(M.curve.now)){ const sp = M.curve.now, mn = M.curve.min12m;
    items.push(it('curve','장단기 금리차', sp<0 ? 'y' : Number.isFinite(mn) && mn<0 ? 'r' : 'g', sp<0 ? `역전 ${f(sp)}%p` : Number.isFinite(mn) && mn<0 ? `역전 뒤 다시 벌어짐 +${f(sp)}%p` : `정상 +${f(sp)}%p`, '10년물 − 2년물. 역전됐다가 다시 벌어질 때 경기 침체가 자주 왔다. 드러켄밀러: 주가가 30% 빠질 때는 거의 늘 침체가 있었다', 'eco', src('T10Y2Y'))); }
  if (M.credit && Number.isFinite(M.credit.now)){ const d = Number.isFinite(M.credit.ago3m) ? M.credit.now - M.credit.ago3m : null;
    items.push(it('credit','신용 위험', d==null ? 'n' : d>=TRD_MACRO.hyJump ? 'r' : M.credit.now>=TRD_MACRO.hyHigh ? 'y' : 'g', `회사채 가산금리 ${f(M.credit.now)}%${d==null ? '' : ` (3개월 ${d>=0?'+':''}${f(d)}%p)`}`, `Baa 등급 회사채 금리 − 10년 국채 금리. 돈을 빌려주는 쪽이 회사 빚에 얹는 웃돈. 3개월에 ${TRD_MACRO.hyJump}%p 넘게 뛰면 빨강, ${TRD_MACRO.hyHigh}% 이상이면 노랑(앱 기준)`, 'eco', src('BAA10Y'))); }
  if (M.dxy && Number.isFinite(M.dxy.now)){ const d = Number.isFinite(M.dxy.ago3m) && M.dxy.ago3m>0 ? (M.dxy.now/M.dxy.ago3m-1)*100 : null;
    items.push(it('dxy','달러', d==null ? 'n' : d>=TRD_MACRO.dxyFast ? 'r' : d>=TRD_MACRO.dxyWarm ? 'y' : 'g', `달러 지수 ${f(M.dxy.now)}${d==null ? '' : ` · 3개월 ${d>=0?'+':''}${f(d,1)}%`}`, `여러 나라 통화 대비 달러 값(무역 가중, 2006년 1월 = 100). 달러가 급히 오르면 세계 돈이 위험자산에서 빠지는 신호(달러 유동성). 3개월 +${TRD_MACRO.dxyFast}% 이상 빨강, +${TRD_MACRO.dxyWarm}% 이상 노랑(앱 기준)`, 'liq', src('DTWEXBGS'))); }
  if (M.pe && Number.isFinite(M.pe.now) && M.pe.med10y>0){ const x = M.pe.now/M.pe.med10y;
    items.push(it('val','시장 값', x>=TRD_MACRO.valHot ? 'r' : x>=TRD_MACRO.valWarm ? 'y' : 'g', `S&P 500 PER ${f(M.pe.now,1)}배 · 10년 중앙 ${f(M.pe.med10y,1)}배 (${f(x,2)}배)`, `드러켄밀러가 꼽은 세 렌즈 중 하나. 비쌀수록 같은 충격에 더 크게 빠진다. 10년 중앙의 ${TRD_MACRO.valWarm}배 노랑·${TRD_MACRO.valHot}배 빨강(앱 기준)`, 'val')); }
  if (M.spx){ const up = M.spx.ma200 > M.spx.ma200ago, above = M.spx.close > M.spx.ma200;
    items.push(it('spx','가격이 하는 말', above && up ? 'g' : !above && !up ? 'r' : 'y', `S&P 500 이 200일선 ${above?'위':'아래'} · 200일선 ${up?'오름':'내림'}`, '드러켄밀러: "주식시장과 경제를 혼동하지 말라". 지표가 좋아도 지수 자체가 내려가는 200일선 아래면 방어로 본다', 'val')); }
  const reds = items.filter(x=>x.light==='r').length, spxRed = items.some(x=>x.key==='spx' && x.light==='r');
  // 유동성이 첫째 — 앞으로의 금리와 연준 자산이 둘 다 빨강이면 다른 신호와 상관없이 방어
  const liqRed = ['fed','bs'].every(k=>items.some(x=>x.key===k && x.light==='r'));
  const light = reds>=3 || spxRed || liqRed ? 'r' : reds===2 ? 'y' : 'g';
  const size = light==='r' ? 0 : light==='y' ? 0.5 : 1;
  const word = {g:'공격해도 되는 시장', y:'조심할 시장', r:'새로 사지 않는 시장'}[light];
  const text = {g:'평소 크기로 삽니다', y:'새 매수는 절반 크기, 손절은 짧게', r:'새 매수를 멈추고 가진 종목은 손절 규칙만 지킵니다'}[light];
  return {light, word, items, size, reds, judged:items.filter(x=>x.light!=='n').length, liqRed, text, asOf:M.asOf};
}
function trdQuality(F){
  const ys = F && Array.isArray(F.years) ? F.years.slice(-5) : [];
  if (ys.length < 3) return {light:'n', checks:[], text:'재무 자료를 받지 못함', pass:0};
  const C = (label, pass, value, tip) => ({label, pass, value, tip});
  const roe = ys.map(y=>y.roe).filter(Number.isFinite), om = ys.map(y=>y.opMargin).filter(Number.isFinite), fcf = ys.map(y=>y.fcf).filter(Number.isFinite);
  const band = om.length ? Math.max(...om)-Math.min(...om) : null;
  const nd = Number.isFinite(F.netDebt) && Number.isFinite(F.fcfTtm) ? (F.netDebt<=0 ? 0 : F.fcfTtm>0 ? F.netDebt/F.fcfTtm : Infinity) : null;
  const checks = [
    C('이익을 꾸준히 잘 내나', roe.length ? roe.every(v=>v>=TRD_Q.roe) : null, roe.length ? `ROE 최저 ${Math.min(...roe).toFixed(0)}%` : '—', `버핏: "꾸준한 이익력이 입증된 회사", "좋은 자기자본이익률". 최근 ${ys.length}년 모두 ${TRD_Q.roe}% 이상(숫자는 앱 기준). 자사주를 많이 사면 ROE 가 부풀 수 있다`),
    C('빚이 거의 없나', nd==null ? null : nd<=TRD_Q.netDebtFcf, nd==null ? '—' : nd===0 ? '순현금' : !Number.isFinite(nd) ? '현금흐름 없음' : `현금흐름 ${nd.toFixed(1)}년치`, `버핏: "빚을 거의 쓰지 않고". 순부채를 한 해 잉여현금흐름으로 ${TRD_Q.netDebtFcf}년 안에 갚을 수 있나(숫자는 앱 기준)`),
    C('이익률이 안정적인가', band==null ? null : band<=TRD_Q.marginBand, band==null ? '—' : `영업이익률 폭 ${band.toFixed(0)}%p`, `영업이익률이 ${ys.length}년 동안 ${TRD_Q.marginBand}%p 안에서 움직임 — 가격 결정력의 흔적(멍거)`),
    C('실제 현금이 남나', fcf.length ? fcf.filter(v=>v>0).length >= Math.min(TRD_Q.fcfYears, fcf.length) : null, fcf.length ? `${fcf.length}년 중 ${fcf.filter(v=>v>0).length}년 플러스` : '—', '장부 이익이 아니라 잉여현금흐름(FCF)이 실제로 남는가'),
  ];
  const pass = checks.filter(c=>c.pass===true).length;
  const light = pass>=3 ? 'g' : pass===2 ? 'y' : 'r';
  return {light, checks, pass, text:`조건 4개 중 ${pass}개`};
}
// 가격은 화면을 그릴 때의 종가로 다시 잰다 — PER·시가총액은 주가가 움직이면 매일 바뀌므로 저장된 값을 쓰지 않는다(2026-11-26 사용자 지적).
function trdLive(F, close){
  if (!F) return null;
  const px = Number.isFinite(close) && close>0 ? close : F.price;
  const scale = Number.isFinite(F.price) && F.price>0 ? px/F.price : 1;
  const mcap = Number.isFinite(F.marketCap) ? F.marketCap*scale : null;
  const pe = F.eps>0 ? px/F.eps : null;
  const eps3 = Array.isArray(F.years) ? F.years.slice(-3).map(y=>y.eps).filter(Number.isFinite) : [];
  const eps3avg = eps3.length===3 ? eps3.reduce((a,b)=>a+b,0)/3 : null;
  return {px, mcap, pe, eps3avg, fy: Number.isFinite(F.fcfTtm) && mcap>0 ? F.fcfTtm/mcap*100 : null,
    gn: eps3avg>0 && F.bvps>0 ? Math.sqrt(GRH.pepb*eps3avg*F.bvps) : null};
}
function trdPrice(F, M, close){
  const L = trdLive(F, close);
  if (!L || !Number.isFinite(L.px)) return {light:'n', checks:[], text:'가격 자료를 받지 못함', pass:0};
  const C = (label, pass, value, tip) => ({label, pass, value, tip});
  const t10 = M && Number.isFinite(M.t10) ? M.t10 : null;
  const checks = [
    C('자기 과거보다 싼가', L.pe!=null && Number.isFinite(F.peMed5y) ? L.pe <= F.peMed5y*TRD_PE_BAND : null, L.pe!=null ? `PER ${L.pe.toFixed(0)}배 (5년 중앙 ${Number.isFinite(F.peMed5y)?F.peMed5y.toFixed(0):'—'}배)` : '—', `지금 주가 ÷ 최근 12개월 EPS 가 자기 5년 중앙 PER 의 ${Math.round(TRD_PE_BAND*100)}% 이하(앱 기준). 주가가 바뀌면 바로 다시 계산`),
    C('국채보다 나은가', L.fy==null || t10==null ? null : L.fy > t10, L.fy==null ? '—' : `주주 이익 ${L.fy.toFixed(1)}% · 국채 ${t10==null?'—':t10.toFixed(1)+'%'}`, '버핏의 주주 이익(이익 + 감가상각 − 경쟁력 유지 설비투자)을 잉여현금흐름으로 근사해 시가총액으로 나눈 값이 10년 국채금리보다 높은가. 성장 투자가 큰 회사는 실제보다 비싸 보인다'),
  ];
  const pass = checks.filter(c=>c.pass===true).length;
  const light = pass===2 ? 'g' : pass===1 ? 'y' : 'r';
  return {light, checks, pass, text:{g:'싼 편', y:'적당한 값', r:'비싼 편'}[light]};
}
// 그레이엄 — 버핏과 다른 질문: 틀려도 잃지 않을 만큼 싸고 튼튼한가. 자료가 10년이 안 되면 있는 만큼으로 재고 그렇게 적는다.
function trdGraham(F, close){
  const L = trdLive(F, close);
  if (!L || !Array.isArray(F.years) || F.years.length < 3) return {light:'n', checks:[], text:'재무 자료를 받지 못함', pass:0, years:0};
  const C = (label, pass, value, tip) => ({label, pass, value, tip});
  const eps = F.years.map(y=>y.eps).filter(Number.isFinite), n = eps.length;
  const short = n < GRH.years ? ` (${GRH.years}년 중 ${n}년치)` : '';
  const k = Math.min(3, Math.floor(n/2)), first = eps.slice(0,k), lastk = eps.slice(-k);
  const avg = a => a.reduce((x,y)=>x+y,0)/a.length;
  const growth = k>0 && avg(first)>0 ? (avg(lastk)/avg(first)-1)*100 : null;
  const pe3 = L.eps3avg>0 ? L.px/L.eps3avg : null, pb = F.bvps>0 ? L.px/F.bvps : null;
  const checks = [
    C('유동비율 2 이상', Number.isFinite(F.currentRatio) ? F.currentRatio>=GRH.curRatio : null, Number.isFinite(F.currentRatio) ? `${F.currentRatio.toFixed(1)}` : '—', '유동자산 ÷ 유동부채. 1년 안에 갚을 빚의 두 배 넘게 현금화할 자산이 있나'),
    C('장기부채 < 운전자본', Number.isFinite(F.ltDebt) && Number.isFinite(F.workingCapital) ? F.ltDebt < F.workingCapital : null, Number.isFinite(F.ltDebt) && Number.isFinite(F.workingCapital) ? `부채 $${F.ltDebt.toFixed(0)}억 · 운전자본 $${F.workingCapital.toFixed(0)}억` : '—', '장기부채가 운전자본(유동자산 − 유동부채)보다 작아야 한다'),
    C('적자가 없었나', n ? eps.every(v=>v>0) : null, `${eps.filter(v=>v>0).length}년 흑자${short}`, `원문: ${GRH.years}년 모두 흑자. 자료가 ${GRH.years}년보다 짧으면 있는 만큼만 본다`),
    C('배당을 꾸준히 줬나', Number.isFinite(F.divYears) ? F.divYears>=GRH.divYears : null, Number.isFinite(F.divYears) ? `${F.divYears}년 연속` : '—', `원문: ${GRH.divYears}년 끊기지 않은 배당`),
    C('이익이 자랐나', growth==null ? null : growth>=GRH.growth, growth==null ? '—' : `처음 ${k}년 → 최근 ${k}년 평균 ${growth>=0?'+':''}${growth.toFixed(0)}%${short}`, `원문: ${GRH.years}년 동안 3년 평균 이익이 3분의 1 이상 늘었나`),
    C(`PER ${GRH.pe}배 이하 (3년 평균 이익)`, pe3==null ? null : pe3<=GRH.pe, pe3==null ? '—' : `${pe3.toFixed(1)}배`, '한 해 이익이 아니라 최근 3년 평균 이익으로 잰 PER'),
    C(`PER × PBR ${GRH.pepb} 이하`, pe3==null || pb==null ? null : pe3*pb<=GRH.pepb, pe3==null || pb==null ? '—' : `${pe3.toFixed(1)} × ${pb.toFixed(1)} = ${(pe3*pb).toFixed(0)}`, `원문: PBR 1.5배 이하, 또는 PER × PBR 이 ${GRH.pepb} 이하`),
  ];
  const known = checks.filter(c=>c.pass!=null).length, pass = checks.filter(c=>c.pass===true).length, fail = known-pass;
  const light = known < 4 ? 'n' : fail===0 ? 'g' : fail===1 ? 'y' : 'r';
  return {light, checks, pass, known, years:n, gn:L.gn, text:`조건 ${checks.length}개 중 ${pass}개${short ? ' · 자료 '+n+'년' : ''}`};
}
// ── 화면(trend2) ──
const _trdEarn = {}, _trdFund = {};
let _trdMacro, _trdMacroBusy = false;
// 재무(5년 ROE·이익률·FCF, 순부채, PER) — /api/price?type=fundamentals. 시장 자료 — /api/macro(FRED 를 서버가 받아 둔 값). 실패하면 null(회색).
async function trdFetchJson(url){
  const r = await authFetch(url); const d = await r.json().catch(()=>null);
  return d && d.success ? d : null;
}
async function trdLoadMacro(){
  if (_trdMacro!==undefined || _trdMacroBusy) return;
  _trdMacroBusy = true;
  try { _trdMacro = await trdFetchJson('/api/macro'); } catch(e){ _trdMacro = null; }
  finally { _trdMacroBusy = false; }
  trdRerender();
}
// 분기 실적 — /api/price?type=earnings(stockanalysis 공개 표). 실패하면 null — 실적 불만 회색이 되고 다른 판단은 그대로다.
async function trdFetchEarnings(tkr){
  const r = await authFetch('/api/price?type=earnings&tkr=' + encodeURIComponent(tkr));
  const d = await r.json().catch(()=>null);
  return d && d.success && Array.isArray(d.quarters) ? d : null;
}
let _trdTkr = null, _trdQuery = '', _trdErr = null, _trdBusy = false, _trdView = null;
const _trdRecent = [];
const TRD_EXAMPLES = ['NVDA','AAPL','MSFT','AMZN','META','TSLA'];
async function trdSearch(q){
  q = String(q==null ? (document.getElementById('trd-q')||{}).value||'' : q).trim();
  _trdQuery = q; _trdErr = null;
  if (!q){ trdRerender(); return; }
  let tkr = q.toUpperCase();
  _trdBusy = true; trdRerender();
  try {
    // 티커 모양이 아니면(회사 이름) 종목 검색으로 티커를 찾는다
    if (!/^[A-Z][A-Z.\-]{0,5}$/.test(tkr)){
      const r = await authFetch('/api/get-stock?query=' + encodeURIComponent(q));
      const d = await r.json().catch(()=>null);
      const sym = d && String(d.symbol || d.ticker || d.code || '').toUpperCase();
      if (!sym) throw new Error('종목을 찾지 못했습니다');
      tkr = sym;
    }
    if (!/^[A-Z][A-Z.\-]{0,5}$/.test(tkr) || /\.(KS|KQ|T)$/.test(tkr)) throw new Error('미국 주식만 볼 수 있습니다');
    const ep = _trdEarn[tkr] ? null : trdFetchEarnings(tkr).then(e=>{ _trdEarn[tkr] = e; }).catch(()=>{ _trdEarn[tkr] = null; });
    const fp = _trdFund[tkr] ? null : trdFetchJson('/api/price?type=fundamentals&tkr=' + encodeURIComponent(tkr)).then(f=>{ _trdFund[tkr] = f; }).catch(()=>{ _trdFund[tkr] = null; });
    if (!_chsCache[tkr]) _chsCache[tkr] = await chsFetchBars(tkr, 'D');
    if (ep) await ep;
    if (fp) await fp;
    if (String(_chsCache[tkr].cur||'').toUpperCase()!=='USD') throw new Error('미국 주식(달러 종목)만 볼 수 있습니다');
    _trdTkr = tkr;
    const at = _trdRecent.indexOf(tkr); if (at>=0) _trdRecent.splice(at,1);
    _trdRecent.unshift(tkr); _trdRecent.length = Math.min(_trdRecent.length, 6);
  } catch(e){ _trdErr = (e&&e.message)||'조회 실패'; }
  finally { _trdBusy = false; }
  trdRerender();
}
function trdRangePick(r){ _mnvRange = MNV_RANGES[r] ? r : '1Y'; trdRerender(); cbRestoreFilterFocus('cb-trend2','data-trd-range',_mnvRange); }
function trdLightHtml(l){
  const on = c => `<i class="trd-lamp is-${c}${l.light===c?' is-on':''}"></i>`;
  const word = {g:'좋음', y:'보통', r:'나쁨', n:'해당 없음'}[l.light];
  return `<div class="trd-light is-${l.light}" data-tip="${cbEsc(l.tip)}">
    <span class="trd-lamps" aria-label="${word}">${on('g')}${on('y')}${on('r')}</span>
    <div class="trd-light-name">${cbEsc(l.name)}</div><div class="trd-light-text">${cbEsc(l.text)}</div></div>`;
}
// 같은 검색 상자·같은 종목을 추세추종·가치투자가 함께 쓴다. 숨은 화면의 내용은 비워 같은 id(trd-q·trd-tip)가 겹치지 않게 한다.
const TRD_PAGES = ['trend2','value2','macro2','screen2'];
function trdOnly(id){ TRD_PAGES.forEach(v=>{ if (v!==id){ const o = document.getElementById('cb-'+v); if (o) o.innerHTML = ''; } }); return document.getElementById('cb-'+id); }
function trdRerender(){ const v = _cobaltActive; if (v==='trend2') cbRenderTrend(); else if (v==='value2') cbRenderValue(); else if (v==='macro2') cbRenderMacro(); else if (v==='screen2') cbRenderScreen(); }
// 종목 상세는 종목 찾기 표에서 티커를 눌러 들어오므로 검색 카드를 두지 않는다(2026-11-26 사용자 요청) — 돌아가는 링크와 불러오기 상태·오류만.
function trdSearchHtml(){
  return `<button class="trd-back" onclick="switchView('screen2')">‹ 종목 찾기로</button>`
    + (_trdBusy ? `<p class="trd-err" role="status">불러오는 중…</p>` : '')
    + (_trdErr ? `<p class="trd-err" role="alert">${cbEsc(_trdErr)}</p>` : '');
}
function trdNumHtml(k, v, cls=''){ return `<div><span>${k}</span><b class="cb-num ${cls}">${v}</b></div>`; }
// 추세추종 — 마크 미너비니 규칙만
function cbRenderTrend(){
  const el = trdOnly('trend2'); if (!el) return;
  cbSetHead('고른 미국 주식을 마크 미너비니의 추세추종 규칙으로 신호등과 판단을 보여 줍니다 · 규칙 확인용(투자 권유 아님)');
  const search = trdSearchHtml();
  const data = _trdTkr && _chsCache[_trdTkr];
  if (!data){
    _trdView = null;
    el.innerHTML = search + `<div class="cb-panel">${cbEmptyHtml('고른 종목이 없습니다','종목 찾기 표에서 티커를 누르면 이 화면에서 자세히 봅니다.',[])}</div>` + trdNoteHtml();
    return;
  }
  const A = mnvAnalyze(data, {cur:'USD', rsRank: scrRsRank(_trdTkr)}), all = A.bars, last = all[all.length-1], prev = all[all.length-2];
  const risk = mnvRisk(A.vcp, last.c, 0, null), V = trdVerdict(A, last.c, risk, _trdEarn[_trdTkr]);
  const keep = Math.min(all.length, MNV_RANGES[_mnvRange][1]), off = all.length-keep;
  const ind = chsIndicators(all); MNV_MA.forEach(m=>{ ind.ma[m.n] = A.ma[m.n]; });
  _trdView = {bars:all.slice(off), allBars:all, ind, off, cur:'USD', avg:null, frame:'D', A, risk, maList:MNV_MA, pre:'trd', noRs:true};
  const chg = prev ? (last.c/prev.c-1)*100 : 0, d = chsDate(last.t), hasPivot = A.vcp.pivot && A.vcp.state!=='none';
  const ranges = `<div class="owner-tabs" role="group" aria-label="보이는 기간">${Object.entries(MNV_RANGES).map(([k,[lab]])=>`<button class="owner-btn${k===_mnvRange?' active':''}" data-trd-range="${k}" aria-pressed="${k===_mnvRange}" onclick="trdRangePick('${k}')">${lab}</button>`).join('')}</div>`;
  el.innerHTML = search + `
    <div class="cb-panel trd-hero is-${V.tone}">
      <div class="trd-verdict">
        <div class="trd-name">${cbEsc(_trdTkr)} <small>${d.m}월 ${d.d}일 종가 기준</small></div>
        <div class="trd-word"><i class="trd-dot"></i>${V.word}</div>
        <p class="trd-why">${cbEsc(V.why)}</p>
        ${V.order ? `<div class="trd-order"><b>${V.order.kind==='wait'?'오늘 밤 걸어 둘 주문':'다음 장에 산다면'}</b>${V.order.kind==='wait'
          ? `<span>$${chsNum(V.order.pivot,'USD')}에 닿으면 <em class="is-up">매수</em></span><span>산 뒤 $${chsNum(V.order.stop,'USD')} 아래로 내려가면 <em class="is-dn">매도</em></span>`
          : `<span>$${chsNum(V.order.maxBuy,'USD')}까지만 <em class="is-up">매수</em>(피벗 +${TRD_CHASE_PCT}%)</span><span>$${chsNum(V.order.stop,'USD')} 아래로 내려가면 <em class="is-dn">매도</em></span>`}<small>증권사의 감시·스톱 주문으로 걸어 두면 장중에 보지 않아도 됩니다 · 거래량 조건은 걸 수 없음</small></div>` : ''}
        <small class="trd-who">마크 미너비니의 규칙으로 본 판단 · 앱의 의견이나 투자 권유가 아닙니다</small>
      </div>
      <div class="trd-nums">
        ${trdNumHtml('지금 가격', `$${chsNum(last.c,'USD')} <em class="${chg>=0?'is-up':'is-dn'}">${chg>=0?'+':''}${chg.toFixed(2)}%</em>`)}
        ${trdNumHtml('피벗(살 자리)', hasPivot ? '$'+chsNum(A.vcp.pivot,'USD') : '없음', hasPivot?'is-up':'')}
        ${trdNumHtml('손절선', hasPivot ? `$${chsNum(risk.stop,'USD')} <em>−${risk.riskPct.toFixed(1)}%</em>` : '—', hasPivot?'is-dn':'')}
      </div>
    </div>
    <div class="trd-lights">${V.lights.map(trdLightHtml).join('')}</div>
    <div class="cb-panel chs-panel">
      <div class="chs-head"><div class="cb-panel-title">차트 <small class="trd-sub">50·150·200일선 · 살 자리(피벗)·손절선</small></div><div class="chs-tools">${ranges}</div></div>
      <div class="chs-plot cb-chart-scroll"><div class="chs-plot-inner">${mnvChartSvg(_trdView)}<div id="trd-tip" class="chs-tip" hidden></div></div></div>
    </div>
    <details class="cb-panel trd-more"><summary>판단 근거 자세히 — 추세 조건 8개</summary>
      <ol class="mnv-checks">${A.tpl.checks.map(x=>`<li class="${x.pass===true?'is-ok':x.pass===false?'is-no':'is-na'}">${mnvCheckIcon(x.pass)}<span data-tip="${cbEsc(x.tip)}">${x.label}</span><em class="cb-num">${x.value}</em></li>`).join('')}</ol>
    </details>` + trdNoteHtml();
}

// 가치투자 — 그레이엄·버핏·멍거. 타이밍(차트)은 보지 않는다.
const VAL_VERDICTS = {
  buy:{word:'매수 후보 · 버핏 기준', tone:'up'}, both:{word:'매수 후보 · 버핏·그레이엄 둘 다', tone:'up'}, graham:{word:'싼 회사 · 그레이엄 기준', tone:'acc'}, wait:{word:'기다림 · 비쌈', tone:'mid'},
  hold:{word:'관망', tone:'mid'}, avoid:{word:'피하기', tone:'dn'}, none:{word:'판정 보류', tone:'mid'},
};
// 두 사람의 판정을 따로 내고, 어느 쪽 기준으로 통과했는지 단어에 적는다(2026-11-26 원문 대조: 두 사람은 다른 질문을 한다).
function valVerdict(Q, P, G){
  G = G || {light:'n'};
  const buffett = Q.light==='g' && (P.light==='g' || P.light==='y'), graham = G.light==='g';
  let k, why;
  if (Q.light==='n' && G.light==='n'){ k='none'; why='재무 자료를 받지 못했거나 ETF·적자 회사라 이 기준으로 보지 않습니다.'; }
  else if (buffett && graham){ k='both'; why='훌륭한 회사이고(버핏), 틀려도 잃지 않을 만큼 싸고 튼튼합니다(그레이엄). 두 사람 모두 반길 드문 경우입니다.'; }
  else if (buffett){ k='buy'; why = P.light==='g' ? '훌륭한 회사가 싼 편입니다. 버핏·멍거가 가장 반기는 경우입니다.' : '훌륭한 회사가 적당한 값입니다. 버핏: "훌륭한 회사를 적당한 값에 사는 것이 적당한 회사를 훌륭한 값에 사는 것보다 훨씬 낫다".'; }
  else if (graham){ k='graham'; why='버핏 기준의 훌륭한 회사는 아니지만, 그레이엄의 안전마진 기준을 모두 통과했습니다. 그레이엄은 이런 종목을 여러 개 나눠 삽니다.'; }
  else if (Q.light==='g'){ k='wait'; why='훌륭한 회사지만 지금 값이 비쌉니다. 버핏은 값이 내려올 때까지 기다립니다 — 기다리는 데는 돈이 들지 않습니다.'; }
  else if (Q.light==='r' && G.light!=='y'){ k='avoid'; why='꾸준히 돈을 잘 버는 회사가 아니고, 그레이엄 기준으로도 안전마진이 없습니다.'; }
  else { k='hold'; why='버핏 기준으로는 회사가, 그레이엄 기준으로는 값이나 재무가 조금씩 모자랍니다. 더 나은 후보를 찾습니다.'; }
  if (P.light==='n' && k!=='none' && k!=='avoid') why += ' 가격 자료가 없어 값은 따로 확인하세요.';
  return {key:k, ...VAL_VERDICTS[k], why};
}
function cbRenderValue(){
  const el = trdOnly('value2'); if (!el) return;
  cbSetHead('고른 미국 주식이 그레이엄·버핏·멍거의 기준으로 좋은 회사인지, 값이 적당한지 봅니다 · 차트·타이밍은 보지 않음 · 규칙 확인용(투자 권유 아님)');
  trdLoadMacro();   // 10년 국채금리(현금 수익률과 비교)만 쓴다 — 시장 판단은 매크로 화면
  const search = trdSearchHtml();
  const data = _trdTkr && _chsCache[_trdTkr];
  if (!data){
    el.innerHTML = search + `<div class="cb-panel">${cbEmptyHtml('고른 종목이 없습니다','종목 찾기 표에서 티커를 누르면 이 화면에서 자세히 봅니다.',[])}</div>` + valNoteHtml();
    return;
  }
  const bars = data.bars, last = bars[bars.length-1], d = chsDate(last.t);
  const F = _trdFund[_trdTkr], Q = trdQuality(F), P = trdPrice(F, _trdMacro, last.c), G = trdGraham(F, last.c), W = valVerdict(Q, P, G);
  const t10 = _trdMacro && Number.isFinite(_trdMacro.t10) ? _trdMacro.t10 : null;
  const LV = trdLive(F, last.c) || {}, fy = LV.fy, gn = LV.gn;
  el.innerHTML = search + `
    <div class="cb-panel trd-hero is-${W.tone}">
      <div class="trd-verdict">
        <div class="trd-name">${cbEsc(_trdTkr)} <small>${d.m}월 ${d.d}일 종가 · 최근 재무 기준</small></div>
        <div class="trd-word"><i class="trd-dot"></i>${W.word}</div>
        <p class="trd-why">${cbEsc(W.why)}</p>
        <small class="trd-who">버핏·멍거와 그레이엄의 기준을 따로 숫자로 옮긴 판단 · PER·수익률은 ${d.m}월 ${d.d}일 종가로 다시 계산 · 해자·경영진은 직접 판단하세요 · 투자 권유가 아닙니다</small>
      </div>
      <div class="trd-nums">
        ${trdNumHtml('PER', LV.pe!=null ? `${LV.pe.toFixed(0)}배 <em>5년 중앙 ${F && Number.isFinite(F.peMed5y)?F.peMed5y.toFixed(0)+'배':'—'}</em>` : '—')}
        ${trdNumHtml('주주 이익 수익률', fy==null ? '—' : `${fy.toFixed(1)}% <em>국채 ${t10==null?'—':t10.toFixed(1)+'%'}</em>`, fy!=null && t10!=null ? (fy>t10?'is-up':'is-dn') : '')}
        ${trdNumHtml('그레이엄 적정가', gn==null ? '—' : `$${chsNum(gn,'USD')} <em>지금 $${chsNum(last.c,'USD')}</em>`, gn==null ? '' : last.c<gn ? 'is-up' : '')}
      </div>
    </div>
    <div class="trd-group-title"><b>버핏 · 멍거</b> <span>훌륭한 회사를 적당한 값에 — 회사가 먼저, 값은 그다음</span></div>
    <div class="trd-value">${trdValueCardHtml('훌륭한 회사인가', Q)}${trdValueCardHtml('적당한 값인가', P)}</div>
    <div class="trd-group-title"><b>그레이엄</b> <span>안전마진 — 틀려도 잃지 않을 만큼 싸고 튼튼한가</span></div>
    <div class="trd-value trd-value-one">${trdValueCardHtml('방어적 투자자 기준 7가지', G)}</div>
    <div class="cb-panel trd-direct">
      <div class="cb-panel-title">숫자로 못 보는 것 — 직접 판단</div>
      <ul><li><b>해자</b> 경쟁사가 따라오기 어려운 이유가 있나(브랜드·네트워크·비용·전환 비용)</li><li><b>경영진</b> 주주 돈을 아껴 쓰고 솔직한가(주주서한·자사주·인수 기록)</li><li><b>이해</b> 10년 뒤에도 이 사업이 어떻게 돈을 벌지 설명할 수 있나(멍거: 이해 못 하면 '너무 어려움' 상자에)</li></ul>
    </div>` + valNoteHtml();
}
function valNoteHtml(){
  return `<div class="cb-panel trd-note">
    <div class="cb-panel-title">판단 방법과 한계</div>
    <ul>
      <li>두 사람은 다른 질문을 합니다. <b>버핏·멍거</b> = 오래 들고 있을 만큼 훌륭한 회사인가, 그다음 값이 적당한가. <b>그레이엄</b> = 회사를 잘 몰라도, 틀려도 잃지 않을 만큼 싸고 튼튼한가. 판정 단어에 어느 쪽 기준인지 적습니다.</li>
      <li>버핏·멍거: ROE 5년 모두 ${TRD_Q.roe}% 이상 · 순부채 ≤ 잉여현금흐름 ${TRD_Q.netDebtFcf}년치 · 영업이익률 폭 ${TRD_Q.marginBand}%p 안 · 잉여현금흐름 5년 중 ${TRD_Q.fcfYears}년 플러스, 값은 PER ≤ 자기 5년 중앙의 ${Math.round(TRD_PE_BAND*100)}% · 주주 이익 수익률 > 10년 국채. 원문은 '좋은 ROE·빚이 거의 없음'이고 숫자는 앱 기준입니다.</li>
      <li>그레이엄: 《현명한 투자자》 14장의 숫자 그대로(유동비율 ${GRH.curRatio} · ${GRH.years}년 흑자 · ${GRH.divYears}년 배당 · 이익 3분의 1 성장 · 3년 평균 PER ${GRH.pe} · PER×PBR ${GRH.pepb}). 재무가 ${GRH.years}년보다 짧으면 있는 만큼으로 재고 그렇게 적습니다.</li>
      <li>PER·수익률·적정가는 화면을 열 때의 종가로 다시 계산합니다. 이익(EPS)은 분기 실적이 나올 때 바뀝니다.</li>
      <li>차트·타이밍은 보지 않습니다 — 가치투자자는 언제 오를지보다 무엇을 얼마에 사는지를 봅니다. 사고 나서 더 떨어질 수 있습니다.</li>
      <li>자사주를 많이 사는 회사(애플 등)는 자본이 작아져 ROE 가 크게 나옵니다.</li>
    </ul>
    <small class="fin-callout">출처: Benjamin Graham, 《The Intelligent Investor》 14장 · 버크셔 해서웨이 인수 기준(2001)·주주서한(1986 주주 이익, 1989) · 재무 SEC·stockanalysis.com. 지난 재무로 규칙을 확인한 결과이며 앞으로의 가격을 맞히지 않습니다.</small>
  </div>`;
}

// 매크로 — 소로스·드러켄밀러. 종목이 아니라 시장 전체를 본다.
const MAC_STANCE = {
  g:{word:'공격 — 주식 비중 평소대로', tone:'up', why:'나쁜 신호가 하나 이하이고 큰 경고가 없습니다. 드러켄밀러라면 주식 비중을 줄일 이유가 없는 환경입니다.'},
  y:{word:'조심 — 비중 줄이고 현금 늘림', tone:'mid', why:'나쁜 신호가 두 개 켜졌습니다. 새로 살 때 크기를 줄이고 현금을 조금 늘리는 구간입니다.'},
  r:{word:'방어 — 새 매수 멈춤', tone:'dn', why:'유동성이 조여지거나, 나쁜 신호가 여럿이거나, 시장 자체가 하락 추세입니다. 드러켄밀러라면 새로 사지 않고 현금을 늘립니다.'},
  n:{word:'판정 보류', tone:'mid', why:'시장 자료(FRED)를 받지 못했습니다.'},
};
// 카드 아래 한 줄 — 자료 날짜 · 직전 관측 대비 · 출처(2026-11-26 사용자 요청). 오래된 자료(7일 — 주간 공표인 달러 지수는 14일 — 넘게 새 관측 없음)는 표시한다.
function macSrcHtml(s){
  if (!s) return '';
  const [y,m,d] = String(s.date).split('-').map(Number);
  const days = Math.floor((Date.now() - Date.UTC(y,m-1,d)) / 86400000);
  const stale = days > (s.id==='DTWEXBGS' ? 14 : 7);   // 달러 지수(H.10)는 매주 월요일에 지난주 값을 한꺼번에 올려 평소에도 1주 남짓 늦다
  const pct = s.id==='DTWEXBGS', ch = Number(s.change);
  const chTxt = !Number.isFinite(ch) ? '' : pct
    ? ` · 직전 대비 ${ch>=0?'+':''}${ch.toFixed(2)} (${ch>=0?'+':''}${(s.prevValue>0 ? ch/s.prevValue*100 : 0).toFixed(2)}%)`
    : ` · 직전 대비 ${ch>=0?'+':''}${ch.toFixed(2)}%p`;
  return `<div class="mac-src${stale?' is-stale':''}"><span>${y}.${String(m).padStart(2,'0')}.${String(d).padStart(2,'0')} 자료${stale?' · 오래됨':''}</span><span>${chTxt.slice(3)}</span><span class="mac-src-id">${cbEsc(s.source || 'FRED · '+s.id)}</span></div>`;
}
function cbRenderMacro(){
  const el = trdOnly('macro2'); if (!el) return;
  cbSetHead('유동성·경제·시장 값으로 지금 시장이 공격해도 되는 환경인지 봅니다 · 드러켄밀러 방식의 근사 · 규칙 확인용(투자 권유 아님)');
  el.innerHTML = macBodyHtml();
}
function macBodyHtml(){
  trdLoadMacro();
  const MC = trdMacro(_trdMacro), S = MAC_STANCE[MC.light];
  const word = {g:'좋음', y:'보통', r:'나쁨', n:'모름'};
  const card = x => `<div class="trd-light mac-card is-${x.light}">
      <span class="trd-lamps" aria-label="${word[x.light]}">${['g','y','r'].map(c=>`<i class="trd-lamp is-${c}${x.light===c?' is-on':''}"></i>`).join('')}</span>
      <div class="trd-light-name">${cbEsc(x.name)}</div><div class="mac-val">${cbEsc(x.text)}</div>${macSrcHtml(x.src)}<div class="trd-light-text">${cbEsc(x.tip)}</div></div>`;
  // 드러켄밀러의 세 렌즈: "시장을 세 가지로 본다 — 밸류에이션, 유동성, 경제"
  const LENS = [['liq','유동성','가장 중요 — 시장을 움직이는 건 이익이 아니라 연준과 돈의 흐름'],['eco','경제','주가가 크게 빠질 때는 거의 늘 침체가 있었다'],['val','값과 가격','비싼지, 그리고 지수 자체가 무엇을 말하는지']];
  const cards = MC.items.length ? LENS.map(([k,name,sub])=>{ const xs = MC.items.filter(x=>x.lens===k); return xs.length ? `<div class="mac-lens"><div class="trd-group-title"><b>${name}</b> <span>${sub}</span></div><div class="mac-cards">${xs.map(card).join('')}</div></div>` : ''; }).join('')
    : `<div class="cb-panel">${cbEmptyHtml(_trdMacro===undefined?'시장 자료를 불러오는 중…':'시장 자료를 받지 못했습니다','미국 연준 경제 자료(FRED)에서 금리·신용·달러를 받습니다.',[])}</div>`;
  return `
    <div class="cb-panel trd-hero is-${S.tone}">
      <div class="trd-verdict">
        <div class="trd-name">미국 시장 <small>${MC.asOf ? cbEsc(MC.asOf)+' 기준' : ''}</small></div>
        <div class="trd-word"><i class="trd-dot"></i>${S.word}</div>
        <p class="trd-why">${cbEsc(S.why)}</p>
        <small class="trd-who">드러켄밀러의 세 렌즈를 지표로 근사한 판단 · 18개월 뒤를 그리는 상상력은 숫자로 못 옮깁니다 · 투자 권유가 아닙니다</small>
      </div>
      <div class="trd-nums">
        ${trdNumHtml('나쁜 신호', `${MC.reds||0}개 <em>${MC.judged||0}개 중</em>`, MC.reds>=2?'is-dn':'')}
        ${trdNumHtml('새 매수 크기', MC.light==='n' ? '—' : MC.size>=1 ? '평소대로' : MC.size>0 ? '절반' : '멈춤', MC.size>=1?'is-up':MC.size>0?'':'is-dn')}
        ${trdNumHtml('<span data-tip="나쁜 신호가 3개 이상이거나, 유동성 두 신호(금리·연준 돈)가 모두 빨강이거나, 지수가 200일선 아래로 꺾이면 방어로 봅니다">방어 기준</span>', '빨강 3개 이상')}
      </div>
    </div>
    ${cards}
    <div class="cb-panel trd-note">
      <div class="cb-panel-title">판단 방법과 한계</div>
      <ul>
        <li>드러켄밀러: "시장 전체를 움직이는 건 이익이 아니라 연준이다 · 중앙은행과 유동성의 움직임에 집중하라", "18개월 뒤를 그려 보라 — 지금에 투자하면 치인다". 그래서 유동성은 지난 변화가 아니라 시장이 예상하는 앞으로의 금리(2년물)와 연준이 푼 돈으로 봅니다 — 다만 지금은 FRED 4지표(10년 금리·금리차·회사채 가산금리·달러)만 받으므로 이 두 카드와 시장 값·200일선 카드는 나오지 않습니다.</li>
        <li><b>공격</b> = 빨강 0~1개. <b>조심</b> = 빨강 2개. <b>방어</b> = 유동성 둘(앞으로의 금리·연준 자산)이 모두 빨강, 빨강 3개 이상, 또는 S&amp;P 500 이 내려가는 200일선 아래.</li>
        <li>장단기 금리차·회사채 가산금리·달러·시장 값은 드러켄밀러의 말에서 직접 확인한 지표가 아니라 세 렌즈를 채우려고 앱이 고른 것이고, 기준 숫자(가산금리 3개월 +${TRD_MACRO.hyJump}%p 등)도 앱 기준입니다.</li>
        <li>FRED 자료는 미국 평일 장 마감 뒤 하루 한 번 확인하고, 새 관측일이 있을 때만 바꿉니다. 카드마다 자료 날짜를 적습니다 — 받지 못한 날은 마지막으로 받은 값과 그 날짜가 그대로 보입니다.</li>
        <li>이 화면은 종목을 고르지 않습니다. 매크로 투자자는 주식·채권·통화·원자재 사이에서 돈을 옮기는데, 이 앱은 주식 비중의 방향만 봅니다.</li>
      </ul>
      <small class="fin-callout">출처: Druckenmiller 1988 Barron's 인터뷰·2015 Lost Tree Club 강연. 자료: 미국 연준 FRED — DGS10(10년 국채 금리)·T10Y2Y(10년 − 2년)·BAA10Y(Baa 회사채 − 10년)·DTWEXBGS(무역 가중 달러 지수).</small>
    </div>`;
}

// 종목 찾기 — finviz 처럼 검색 없이 신호가 나온 종목을 표로(2026-11-26 사용자 요청).
// 수백 종목의 일봉·재무를 화면에서 받으면 너무 느리므로, 매일 아침 GitHub Actions 배치가 계산해 data/screener.json 에 커밋한다(ETF 구성종목과 같은 방식).
// 판정은 화면 함수와 같은 규칙(trdVerdict·valVerdict)을 배치가 그대로 돌린 결과다. 스타일은 섞지 않고 탭으로 나눈다.
let _scr, _scrBusy = false, _scrTab = 'trend', _scrSector = '전체', _scrCap = 'all', _scrSig = 'all';
// 시가총액 범위(2026-11-26 사용자 요청) — 단위는 screener.json 의 mcap 과 같은 '억 달러'. 경계는 흔히 쓰는 초대형 2,000억·대형 100억·중형 20억 달러.
const SCR_CAPS = [['all','전체',0,Infinity],['mega','초대형 · $2,000억 이상',2000,Infinity],['large','대형 · $100억~2,000억',100,2000],['mid','중형 · $20억~100억',20,100],['small','소형 · $20억 미만',0,20]];
const SCR_TABS = [['trend','추세추종 신호'],['value','가치투자 후보'],['both','둘 다 해당'],['macro','매크로 · 시장']];
async function scrLoad(){
  if (_scr!==undefined || _scrBusy) return;
  _scrBusy = true;
  try { const r = await fetch('data/screener.json', {cache:'no-cache'}); _scr = r.ok ? await r.json() : null; } catch(e){ _scr = null; }
  finally { _scrBusy = false; }
  trdRerender();
}
function scrPick(kind, v){ if (kind==='tab'){ _scrTab = v; _scrSig = 'all'; } else if (kind==='sector') _scrSector = v; else if (kind==='cap') _scrCap = SCR_CAPS.some(c=>c[0]===v) ? v : 'all'; else _scrSig = v; cbRenderScreen(); cbRestoreFilterFocus('cb-screen2', 'data-scr', kind+':'+v); }
async function scrOpen(t, view){ switchView(view); await trdSearch(t); }
const SCR_TREND_WORD = {buy:['매수','up'], wait:['매수 대기','acc']};
const SCR_VALUE_WORD = {both:['버핏·그레이엄','up'], buy:['버핏 기준','up'], graham:['그레이엄 기준','acc']};
// 종목 상세의 상대강도 순위 — 종목 찾기 배치가 약 520종목 안에서 매긴 값. 목록 밖 종목은 null(지수 비교로 대신)
function scrRsRank(t){ const r = _scr && Array.isArray(_scr.rows) ? _scr.rows.find(x=>x.t===t) : null; return r && r.trend && Number.isFinite(r.trend.rsRank) ? r.trend.rsRank : null; }
function scrRows(){
  const all = (_scr && Array.isArray(_scr.rows)) ? _scr.rows : [];
  const tOk = r => r.trend && SCR_TREND_WORD[r.trend.v], vOk = r => r.value && SCR_VALUE_WORD[r.value.v];
  let rows = all.filter(r => _scrTab==='trend' ? tOk(r) : _scrTab==='value' ? vOk(r) : tOk(r) && vOk(r));
  if (_scrSector!=='전체') rows = rows.filter(r => r.sector===_scrSector);
  const cap = SCR_CAPS.find(c=>c[0]===_scrCap);
  if (cap && cap[0]!=='all') rows = rows.filter(r => Number.isFinite(r.mcap) && r.mcap>=cap[2] && r.mcap<cap[3]);
  if (_scrSig!=='all') rows = rows.filter(r => { const v = _scrTab==='value' ? r.value.v : r.trend.v; return v===_scrSig || (_scrTab==='value' && v==='both'); });
  return {all, rows, tOk, vOk};
}
function cbRenderScreen(){
  const el = trdOnly('screen2'); if (!el) return;
  cbSetHead('검색하지 않아도 규칙상 매수 신호가 나온 미국 주식을 골라 보여 줍니다 · 스타일마다 따로 · 규칙 확인용(투자 권유 아님)');
  scrLoad();
  if (!_scr){
    // 종목 목록(스크리너 배치)이 아직 없어도 매크로 탭은 자기 자료(/api/macro)로 열린다 — 탭 줄이 없으면 시장 신호등에 갈 길이 없었다.
    const MCe = trdMacro(_trdMacro); trdLoadMacro();
    const tabsE = `<div class="sim-view-tabs scr-tabs" role="group" aria-label="투자 스타일">${SCR_TABS.map(([k,lab])=>`<button type="button" data-scr="tab:${k}" aria-pressed="${_scrTab===k}" class="cb-btn" onclick="scrPick('tab','${k}')">${lab}${k==='macro' && MCe.light!=='n' ? ` <em><i class="trd-mini is-${MCe.light}"></i></em>` : ''}</button>`).join('')}</div>`;
    el.innerHTML = `<div class="cb-panel scr-panel scr-panel-tabs"><div class="scr-top">${tabsE}</div></div>` + (_scrTab==='macro' ? macBodyHtml()
      : `<div class="cb-panel">${cbEmptyHtml(_scr===undefined?'종목 목록을 불러오는 중…':'종목 목록이 아직 없습니다','매일 아침 7:30(한국 시간) 미국 장 마감 자료로 다시 계산합니다.',[])}</div>`);
    return;
  }
  const {all, rows, tOk, vOk} = scrRows();
  const MC0 = trdMacro(_trdMacro);
  const cnt = {trend: all.filter(tOk).length, value: all.filter(vOk).length, both: all.filter(r=>tOk(r)&&vOk(r)).length, macro: MC0.light==='n' ? '' : `<i class="trd-mini is-${MC0.light}"></i>`};
  const sectors = ['전체', ...[...new Set(all.map(r=>r.sector).filter(Boolean))].sort((a,b)=>cbSectorName(a).localeCompare(cbSectorName(b),'ko'))];
  const tabs = `<div class="sim-view-tabs scr-tabs" role="group" aria-label="투자 스타일">${SCR_TABS.map(([k,lab])=>`<button type="button" data-scr="tab:${k}" aria-pressed="${_scrTab===k}" class="cb-btn" onclick="scrPick('tab','${k}')">${lab} <em>${cnt[k]}</em></button>`).join('')}</div>`;
  const sigOpts = _scrTab==='trend' ? [['all','전체'],['buy','매수'],['wait','매수 대기']] : _scrTab==='value' ? [['all','전체'],['buy','버핏 기준'],['graham','그레이엄 기준']] : [];
  const sig = sigOpts.length ? `<div class="owner-tabs" role="group" aria-label="신호">${sigOpts.map(([k,lab])=>`<button class="owner-btn${_scrSig===k?' active':''}" data-scr="sig:${k}" aria-pressed="${_scrSig===k}" onclick="scrPick('sig','${k}')">${lab}</button>`).join('')}</div>` : '';
  const sec = `<label class="scr-sector"><span>섹터</span><select class="cb-input" onchange="scrPick('sector',this.value)">${sectors.map(s=>`<option value="${cbEsc(s)}"${s===_scrSector?' selected':''}>${s==='전체'?'전체':cbEsc(cbSectorName(s))}</option>`).join('')}</select></label>`;
  const capSel = `<label class="scr-sector"><span>시가총액</span><select class="cb-input" onchange="scrPick('cap',this.value)">${SCR_CAPS.map(([k,lab])=>`<option value="${k}"${k===_scrCap?' selected':''}>${lab}</option>`).join('')}</select></label>`;
  const pct = (v,d=1) => Number.isFinite(v) ? `${v>=0?'+':''}${v.toFixed(d)}%` : '—';
  const chip = (w) => `<span class="scr-sig is-${w[1]}">${w[0]}</span>`;
  const T = _scrTab;
  if (T==='macro'){
    el.innerHTML = `<div class="cb-panel scr-panel scr-panel-tabs"><div class="scr-top">${tabs}</div></div>` + macBodyHtml();
    return;
  }
  const cols = T==='value'
    ? [['t','티커','text'],['name','회사','text'],['sector','섹터','text'],['price','가격'],['chg','등락'],['v','신호','text'],['pe','PER'],['peMed','5년 중앙 PER'],['fcfY','현금 수익률'],['roeMin','ROE 최저'],['mcap','시가총액']]
    : T==='trend'
    ? [['t','티커','text'],['name','회사','text'],['sector','섹터','text'],['price','가격'],['chg','등락'],['v','신호','text'],['toPivot','피벗까지'],['rs','상대강도'],['eps','EPS 성장'],['from52','52주 고점 대비'],['mcap','시가총액']]
    : [['t','티커','text'],['name','회사','text'],['sector','섹터','text'],['price','가격'],['chg','등락'],['v','추세추종','text'],['v2','가치투자','text'],['toPivot','피벗까지'],['pe','PER'],['fcfY','현금 수익률'],['mcap','시가총액']];
  const get = {t:r=>r.t, name:r=>r.name, sector:r=>cbSectorName(r.sector), price:r=>r.price, chg:r=>r.chg, mcap:r=>r.mcap,
    v:r=>T==='value'?r.value.v:r.trend.v, v2:r=>r.value&&r.value.v, toPivot:r=>r.trend&&r.trend.toPivot, rs:r=>r.trend&&r.trend.rsRank, eps:r=>r.trend&&r.trend.eps, from52:r=>r.trend&&r.trend.from52,
    pe:r=>r.value&&r.value.pe, peMed:r=>r.value&&r.value.peMed, fcfY:r=>r.value&&r.value.fcfY, roeMin:r=>r.value&&r.value.roeMin};
  const sorted = cbSortRows('scr', rows, get);
  const mc = v => !Number.isFinite(v) ? '—' : v>=1000 ? `$${(v/1000).toFixed(1)}조` : `$${v.toFixed(0)}억`;
  const cell = (r,k) => {
    const tv = r.trend||{}, vv = r.value||{};
    switch(k){
      case 't': return `<button class="scr-tkr" onclick="scrOpen('${cbEsc(r.t)}','${T==='value'?'value2':'trend2'}')">${cbEsc(r.t)}</button>`;
      case 'name': return `<span class="scr-name" title="${cbEsc(r.name)}">${cbEsc(r.name)}</span>`;
      case 'sector': return `<span class="scr-sec">${cbEsc(cbSectorName(r.sector))}</span>`;
      case 'price': return `$${chsNum(r.price,'USD')}`;
      case 'chg': return `<span style="${cbGainStyle(r.chg)}">${pct(r.chg,2)}</span>`;
      case 'v': return T==='value' ? chip(SCR_VALUE_WORD[vv.v]) : chip(SCR_TREND_WORD[tv.v]);
      case 'v2': return chip(SCR_VALUE_WORD[vv.v]);
      case 'toPivot': return tv.v==='wait' ? pct(tv.toPivot) : '<span class="scr-mut">돌파</span>';
      case 'rs': return Number.isFinite(tv.rsRank) ? `${Math.round(tv.rsRank)}점` : '—';
      case 'eps': return `<span style="${cbGainStyle(tv.eps)}">${pct(tv.eps,0)}</span>`;
      case 'from52': return pct(tv.from52);
      case 'pe': return Number.isFinite(vv.pe) ? vv.pe.toFixed(0)+'배' : '—';
      case 'peMed': return Number.isFinite(vv.peMed) ? vv.peMed.toFixed(0)+'배' : '—';
      case 'fcfY': return Number.isFinite(vv.fcfY) ? vv.fcfY.toFixed(1)+'%' : '—';
      case 'roeMin': return Number.isFinite(vv.roeMin) ? vv.roeMin.toFixed(0)+'%' : '—';
      case 'mcap': return mc(r.mcap);
    }
  };
  const asOf = _scr.asOf ? chsDate(Date.parse(_scr.asOf+'T00:00:00Z')/1000) : null;
  const MC = trdMacro(_trdMacro); trdLoadMacro();
  el.innerHTML = `
    <div class="cb-panel scr-panel">
      <div class="scr-top">
        ${tabs}
        <div class="scr-meta">${asOf?`${asOf.m}월 ${asOf.d}일 장 마감 기준 · `:''}${cbEsc(_scr.universe||'')} ${all.length}종목 중 <b>${rows.length}</b>개</div>
      </div>
      <div class="scr-filters">${sig}${sec}${capSel}
        ${MC.light!=='n' ? `<button class="scr-mac is-${MC.light}" data-scr="tab:macro" onclick="scrPick('tab','macro')" title="매크로 탭에서 자세히"><i class="trd-mini is-${MC.light}"></i>시장(매크로): ${MC.word} ›</button>` : ''}
      </div>
      <div class="cb-scroll scr-wrap"><table class="scr-table">
        <thead><tr>${cols.map(([k,lab,ty])=>`<th aria-sort="${cbAriaSort('scr',k)}"${ty==='text'?'':' class="is-num"'}>${cbSortBtn('scr',k,lab,ty||'num')}</th>`).join('')}</tr></thead>
        <tbody>${sorted.length ? sorted.map(r=>`<tr>${cols.map(([k,,ty])=>`<td${ty==='text'?'':' class="is-num cb-num"'}>${cell(r,k)}</td>`).join('')}</tr>`).join('')
          : `<tr><td colspan="${cols.length}">${cbEmptyHtml('조건에 맞는 종목이 없습니다','섹터나 신호를 바꿔 보세요.',[],{compact:true})}</td></tr>`}</tbody>
      </table></div>
      <small class="scr-foot">티커를 누르면 ${T==='value'?'가치투자':'추세추종'} 화면에서 자세히 봅니다 · ${T==='both'?'두 스타일이 각자 규칙으로 같은 종목을 골랐다는 뜻일 뿐, 둘을 섞은 점수가 아닙니다 · ':''}스타일 판정은 각 화면과 같은 규칙입니다</small>
    </div>
    <div class="cb-panel trd-note">
      <div class="cb-panel-title">이 목록은 어떻게 만드나</div>
      <ul>
        <li>대상: ${cbEsc(_scr.universe||'S&P 500 + 나스닥 100')}. 매일 아침 7:30(한국 시간) 미국 장 마감 일봉·최근 재무로 다시 계산합니다.</li>
        <li><b>추세추종 신호</b> = 추세추종 화면의 '매수'·'매수 대기'. <b>가치투자 후보</b> = 가치투자 화면의 '버핏 기준'(훌륭한 회사를 적당한 값에)·'그레이엄 기준'(방어적 투자자 7가지)·'둘 다'. 관망·피하기 종목은 목록에 넣지 않습니다.</li>
        <li>전 종목을 매일 볼 수 있는 대신, 장중 움직임과 당일 거래량은 반영하지 않습니다. 목록은 출발점일 뿐 — 종목 화면에서 근거를 확인하세요.</li>
      </ul>
    </div>`;
}
function trdMacroHtml(MC){
  const word = {g:'좋음', y:'보통', r:'나쁨', n:'모름'};
  const items = MC.items.length ? MC.items.map(x=>`<li class="is-${x.light}" data-tip="${cbEsc(x.tip)}"><i class="trd-mini is-${x.light}" aria-label="${word[x.light]}"></i><b>${cbEsc(x.name)}</b><span>${cbEsc(x.text)}</span></li>`).join('')
    : `<li class="is-n"><span>${_trdMacroBusy || _trdMacro===undefined ? '시장 자료를 불러오는 중…' : '시장 자료(FRED)를 받지 못했습니다'}</span></li>`;
  return `<section class="cb-panel trd-macro is-${MC.light}" aria-label="시장 신호등">
    <div class="trd-macro-head">
      <span class="trd-lamps">${['g','y','r'].map(c=>`<i class="trd-lamp is-${c}${MC.light===c?' is-on':''}"></i>`).join('')}</span>
      <div><div class="trd-macro-title">시장 신호등 <em>매크로 — 소로스 · 드러켄밀러</em></div>
      <div class="trd-macro-word">${MC.light==='n' ? '판정 보류' : MC.word}<small>${cbEsc(MC.text)}</small></div></div>
    </div>
    <ul class="trd-macro-items">${items}</ul>
  </section>`;
}
function trdValueCardHtml(title, R){
  const word = {g:'좋음', y:'보통', r:'나쁨', n:'모름'}[R.light];
  return `<div class="trd-light trd-vcard is-${R.light}">
    <div class="trd-vhead"><span class="trd-lamps" aria-label="${word}">${['g','y','r'].map(c=>`<i class="trd-lamp is-${c}${R.light===c?' is-on':''}"></i>`).join('')}</span><div class="trd-light-name">${title}</div><span class="trd-vsum">${cbEsc(R.text)}</span></div>
    ${R.checks.length ? `<ul class="trd-vchecks">${R.checks.map(c=>`<li data-tip="${cbEsc(c.tip)}">${mnvCheckIcon(c.pass)}<span>${c.label}</span><em class="cb-num">${cbEsc(c.value)}</em></li>`).join('')}</ul>` : `<div class="trd-light-text">ETF·적자 회사는 이 기준으로 보지 않습니다</div>`}
  </div>`;
}
function trdNoteHtml(){
  return `<div class="cb-panel trd-note">
    <div class="cb-panel-title">판단 방법과 한계</div>
    <ul>
      <li>생각하는 순서: <b>시장(지수)이 상승 단계인가 → 종목이 상승 추세인가 → 실적이 받쳐 주나 → 시장보다 강한가 → 살 자리가 왔나 → 늦지 않았나</b>.</li>
      <li><b>매수</b> = 추세 8개 통과 + 2단계 + 피벗을 거래량 실어 돌파 + 피벗에서 ${TRD_CHASE_PCT}% 안쪽. <b>매수 대기</b> = 8개 통과 + 2단계 + 자리 만드는 중. 지수가 4단계면 둘 다 <b>관망</b>. <b>매도·피하기</b> = 3·4단계, 조건 3개 이하, 또는 이익 감소 + 조건 미달.</li>
      <li>그대로 옮긴 것: 50·150·200일선과 52주 고저 조건, 상대강도 순위 ${MNV_RS_MIN}점, 2단계에서만 사기, 실적(분기 EPS·매출 +${TRD_EPS_MIN}%·3년 연 +${TRD_ANNUAL_MIN}%·Code 33), 손절 최대 −10%.</li>
      <li>대신한 것: 상대강도 순위는 시장 전체가 아니라 S&amp;P 500 + 나스닥 100 안의 순위 · 단계와 VCP 는 사람이 눈으로 보는 것을 규칙으로 근사 · 시장 판단은 지수의 단계만(주도주 수는 못 봄).</li>
      <li>못 하는 것: 실적 서프라이즈·전망 상향 · 장중 거래량 판단. 마감된 일봉(Yahoo)만 씁니다.</li>
    </ul>
    <small class="fin-callout">출처: Mark Minervini, 《Trade Like a Stock Market Wizard》(2013), 《Think &amp; Trade Like a Champion》(2017). 지난 가격으로 규칙을 확인한 결과이며 앞으로의 가격을 맞히지 않습니다.</small>
  </div>`;
}
