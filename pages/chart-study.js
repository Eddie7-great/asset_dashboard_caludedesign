// ── 투자 분석 > 차트 공부(chart2, 2026-11-25 시안) ──
// 내 종목의 일봉(Yahoo, /api/price?type=ohlcv) 위에 이동평균 20·60·120일·거래량·RSI(14)·MACD(12,26,9)를 그리고,
// 지표마다 '지금 무엇을 말하는지'를 쉬운 말로 적는다. 공부용이다 — 매매 신호로 쓰지 않는다는 문구를 유지한다.
// 계산은 아래 순수 함수(chsSma·chsEma·chsRsi·chsMacd·chsReadings)만 쓰고, 그리는 쪽은 그 결과를 그대로 옮긴다.
// 장중 봉(complete:false)은 버린다 — 앱의 다른 시세와 같은 '직전 종가' 기준이다.

let _chsTkr = null, _chsRange = '6M', _chsOwner = '전체', _chsFrame = 'D';
const _chsCache = {}, _chsErr = {};
let _chsLoading = null, _chsView = null;
// 봉 단위(2026-11-25 사용자 요청) — 일봉·주봉·월봉은 Yahoo 가 그 단위로 준 봉 그대로, 년봉은 월봉을 해마다 묶는다.
// 지표의 '기간'은 봉 개수다: 주봉의 20선 = 20주 평균, RSI(14) = 최근 14주. 일봉 캐시 키는 티커 그대로(리스크 화면과 공유).
// unit = 봉 하나의 이름(일·주·개월·년), perYear = 1년에 봉이 몇 개인지(고점 찾는 구간), ranges = 보이는 봉 수.
const CHS_FRAMES = {
  D:{label:'일봉', unit:'일', interval:'1d', range:'2y', perYear:252, ranges:{'3M':['3개월',63],'6M':['6개월',126],'1Y':['1년',252]}, def:'6M',
     subs:['약 한 달','약 석 달','약 반년','약 10개월']},
  W:{label:'주봉', unit:'주', interval:'1wk', range:'10y', perYear:52, ranges:{'1Y':['1년',52],'3Y':['3년',156],'5Y':['5년',260]}, def:'3Y',
     subs:['약 5개월','약 1년 2개월','약 2년 3개월','약 4년']},
  M:{label:'월봉', unit:'개월', interval:'1mo', range:'max', perYear:12, ranges:{'5Y':['5년',60],'10Y':['10년',120],'ALL':['전체',9999]}, def:'10Y',
     subs:['약 1년 8개월','5년','10년','약 17년']},
  Y:{label:'년봉', unit:'년', interval:'1mo', range:'max', perYear:1, ranges:{'ALL':['전체',9999]}, def:'ALL',
     subs:['','','','']},
};
// 200선(2026-11-25 사용자 요청) — 가장 긴 흐름선. 색은 무채색(--ma-200)이라 오름·내림 봉 색과 겹치지 않는다.
const CHS_MA_N = [20,60,120,200];
function chsFrame(){ return CHS_FRAMES[_chsFrame] || CHS_FRAMES.D; }
// 이동평균 이름표 — 봉 단위를 따른다(20일선·20주선·20개월선·20년선)
function chsMaList(frame){
  const f = CHS_FRAMES[frame] || CHS_FRAMES.D;
  return CHS_MA_N.map((n,k)=>({n, label:`${n}${f.unit}선`, sub:f.subs[k], cls:'ma'+n}));
}
// 예전 이름 그대로 — 일봉 기준(리스크 화면·테스트가 쓰지 않아도 남겨 둔다)
const CHS_MA = chsMaList('D');

// ── 지표 계산(순수 함수) ──
function chsSma(values, n){
  const out = Array(values.length).fill(null); let sum = 0;
  for (let i = 0; i < values.length; i++){
    sum += values[i];
    if (i >= n) sum -= values[i-n];
    if (i >= n-1) out[i] = sum / n;
  }
  return out;
}
// 지수이동평균 — 첫 값은 처음 n개의 단순평균에서 시작한다(일반적인 정의).
function chsEma(values, n){
  const out = Array(values.length).fill(null); const k = 2/(n+1);
  let prev = null, start = values.findIndex(v=>v!=null);
  if (start < 0 || values.length - start < n) return out;
  let seed = 0; for (let i = start; i < start+n; i++) seed += values[i];
  prev = seed / n; out[start+n-1] = prev;
  for (let i = start+n; i < values.length; i++){ prev = values[i]*k + prev*(1-k); out[i] = prev; }
  return out;
}
// RSI(와일더 방식) — 오른 날 폭의 평균 ÷ 내린 날 폭의 평균으로 0~100.
function chsRsi(closes, n=14){
  const out = Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++){ const d = closes[i]-closes[i-1]; if (d>0) gain+=d; else loss-=d; }
  gain/=n; loss/=n;
  out[n] = loss===0 ? 100 : 100 - 100/(1+gain/loss);
  for (let i = n+1; i < closes.length; i++){
    const d = closes[i]-closes[i-1];
    gain = (gain*(n-1) + Math.max(d,0)) / n;
    loss = (loss*(n-1) + Math.max(-d,0)) / n;
    out[i] = loss===0 ? 100 : 100 - 100/(1+gain/loss);
  }
  return out;
}
function chsMacd(closes, fast=12, slow=26, sig=9){
  const ef = chsEma(closes, fast), es = chsEma(closes, slow);
  const macd = closes.map((_,i)=>ef[i]!=null&&es[i]!=null ? ef[i]-es[i] : null);
  const signal = chsEma(macd, sig);
  const hist = macd.map((m,i)=>m!=null&&signal[i]!=null ? m-signal[i] : null);
  return {macd, signal, hist};
}
// 마지막으로 짧은 선(a)이 긴 선(b)을 넘은 곳 — {kind:'golden'|'dead', ago:거래일 수} 또는 null
function chsLastCross(a, b){
  for (let i = a.length-1; i > 0; i--){
    if (a[i]==null||b[i]==null||a[i-1]==null||b[i-1]==null) break;
    const now = a[i]-b[i], before = a[i-1]-b[i-1];
    if (now>0 && before<=0) return {kind:'golden', ago:a.length-1-i, at:i};
    if (now<0 && before>=0) return {kind:'dead', ago:a.length-1-i, at:i};
  }
  return null;
}
function chsIndicators(bars){
  const closes = bars.map(b=>b.c);
  const ma = {}; CHS_MA_N.forEach(n=>{ ma[n] = chsSma(closes, n); });
  return {closes, ma, rsi:chsRsi(closes,14), macd:chsMacd(closes)};
}
// 지금 읽기 — 마지막 봉 기준. 판정 단어는 화면 색(오름 --up · 내림 --dn · 보통 --lab)과 함께 쓴다.
function chsReadings(bars, ind, avg, frame='D'){
  const i = bars.length-1; if (i < 1) return [];
  const c = bars[i].c, out = [], F = CHS_FRAMES[frame] || CHS_FRAMES.D, u = F.unit, MA = chsMaList(frame);
  const ago = k => k===0 ? ({D:'오늘',W:'이번 주',M:'이번 달',Y:'올해'})[frame] : frame==='D' ? `${k}거래일 전` : `${k}${u} 전`;
  // ① 추세 — 가격이 이동평균선(20·60·120·200) 위·아래 몇 개
  const ab = MA.map(m=>ind.ma[m.n][i]==null ? null : c > ind.ma[m.n][i]);
  const known = ab.filter(v=>v!=null), above = known.filter(Boolean).length;
  const cross = chsLastCross(ind.ma[20], ind.ma[60]);
  const trendTone = known.length && above===known.length ? 'up' : above===0&&known.length ? 'dn' : 'mid';
  const trendWord = trendTone==='up' ? '오름 추세' : trendTone==='dn' ? '내림 추세' : '엇갈림';
  const trendText = known.length
    ? `가격이 ${MA.map((m,k)=>ab[k]==null?null:`${m.label} ${ab[k]?'위':'아래'}`).filter(Boolean).join(' · ')}`
    : '봉이 적어 이동평균을 아직 못 그립니다';
  out.push({key:'trend', title:'추세 · 이동평균', tone:trendTone, word:trendWord, text:trendText,
    note: cross ? `${MA[0].label}이 ${MA[1].label}을 ${cross.kind==='golden'?'위로 뚫음(골든크로스)':'아래로 뚫음(데드크로스)'} · ${ago(cross.ago)}` : `최근 ${MA[0].label}·${MA[1].label} 교차 없음`});
  // ② RSI
  const r = ind.rsi[i];
  if (r!=null){
    const tone = r>=70 ? 'dn' : r<=30 ? 'up' : 'mid';
    out.push({key:'rsi', title:'과열·침체 · RSI(14)', tone, word:r>=70?'과열권':r<=30?'침체권':'보통',
      value:r.toFixed(0), text: r>=70 ? `최근 14${u} 동안 오른 힘이 내린 힘보다 훨씬 셉니다` : r<=30 ? `최근 14${u} 동안 내린 힘이 오른 힘보다 훨씬 셉니다` : '오른 힘과 내린 힘이 비슷한 범위입니다',
      note:'70 이상 과열 · 30 이하 침체 — 강한 추세에서는 오래 머물 수 있음'});
  }
  // ③ MACD
  const m = ind.macd.macd[i], s = ind.macd.signal[i], h = ind.macd.hist[i], hp = ind.macd.hist[i-1];
  if (m!=null && s!=null){
    const upSide = m > s, growing = hp!=null && Math.abs(h) > Math.abs(hp);
    out.push({key:'macd', title:'힘 · MACD', tone:upSide?'up':'dn', word:upSide?'오름 힘 우세':'내림 힘 우세',
      text:`MACD가 시그널선 ${upSide?'위':'아래'} · 막대가 ${growing?'커지는':'작아지는'} 중`,
      note: m>0 ? `0선 위 — 짧은 평균(12${u})이 긴 평균(26${u})보다 높음` : `0선 아래 — 짧은 평균(12${u})이 긴 평균(26${u})보다 낮음`});
  }
  // ④ 내 평균 매입가·고점
  // 고점 — 최근 1년(봉 perYear 개). 년봉은 봉 하나가 1년이라 전체 기간의 최고가를 쓴다.
  const hiSpan = frame==='Y' ? bars : bars.slice(-F.perYear), hiWord = frame==='Y' ? '전체 기간' : '최근 1년';
  const hi = Math.max(...hiSpan.map(b=>b.h));
  const fromHi = hi>0 ? (c/hi-1)*100 : null;
  if (avg && avg.price>0){
    const pct = (c/avg.price-1)*100;
    out.push({key:'avg', title:'내 평균 매입가', tone:pct>=0?'up':'dn', word:(pct>=0?'+':'')+pct.toFixed(1)+'%',
      text:`지금 가격이 내 평균 매입가보다 ${Math.abs(pct).toFixed(1)}% ${pct>=0?'높습니다':'낮습니다'}`,
      note: fromHi!=null ? `${hiWord} 고점보다 ${fromHi.toFixed(1)}%` : ''});
  } else if (fromHi!=null){
    out.push({key:'avg', title:'고점과의 거리', tone:fromHi>-5?'up':'mid', word:fromHi.toFixed(1)+'%', text:`${hiWord} 가장 높았던 가격과의 거리`, note:''});
  }
  return out;
}

// ── 종목 목록·평균 매입가 ──
function chsApiTkr(t){ return String(t||'').trim().toUpperCase().replace(/\.(KS|KQ)$/,''); }
function chsHoldings(ownerF){
  const map = new Map();
  (pfolioData||[]).forEach(i=>{
    if (!i || i.grp!=='주식' || !(Number(i.qty)>0) || !String(i.tkr||'').trim()) return;
    if (ownerF && i.owner!==ownerF) return;
    const k = chsApiTkr(i.tkr);
    const row = map.get(k) || {tkr:k, name:i.name||k, cur:i.cur||'KRW', qty:0, cost:0, val:0, owners:new Set(), ref:i};
    const q = Number(i.qty)||0, avg = assetAvgNative(i);
    if (avg>0 && (i.cur||'KRW')===row.cur){ row.qty += q; row.cost += q*avg; }
    row.val += assetValueKRW(i); row.owners.add(i.owner);
    map.set(k, row);
  });
  return [...map.values()].sort((a,b)=>b.val-a.val);
}
function chsAvg(row){ return row && row.qty>0 && row.cost>0 ? {price:row.cost/row.qty, owners:[...row.owners]} : null; }

// ── 시세 받기 ──
// 2년 일봉 한 종목 — 리스크 화면의 '실제 흔들림' 카드도 같은 캐시(_chsCache)를 함께 쓴다. 끝나지 않은 봉은 버린다.
// 봉의 기간 열쇠 — 같은 주(월요일)·달·해에 든 봉은 같은 열쇠. Yahoo 주·월봉은 이번 기간 봉 뒤에 오늘 줄을
// 하나 더 붙여 줄 때가 있어 같은 열쇠끼리 합친다(시가는 앞, 종가는 뒤, 고가·저가는 넓게, 거래량은 더함).
function chsPeriodKey(t, frame){
  const d = new Date(t*1000), y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (frame==='Y') return String(y);
  if (frame==='M') return y+'-'+m;
  if (frame==='W'){ const dow = (d.getUTCDay()+6)%7; return String(Math.floor(t/86400) - dow); }
  return String(Math.floor(t/86400));
}
function chsMergeBars(bars, frame){
  const out = [];
  bars.forEach(b=>{
    const k = chsPeriodKey(b.t, frame), last = out[out.length-1];
    if (last && last._k===k){ last.h = Math.max(last.h,b.h); last.l = Math.min(last.l,b.l); last.c = b.c; last.v = (last.v||0)+(b.v||0); last.tEnd = b.t; }
    else out.push({_k:k, t:b.t, tEnd:b.t, o:b.o, h:b.h, l:b.l, c:b.c, v:b.v||0});
  });
  return out.map(({_k, ...b})=>b);
}
// 마지막 봉이 아직 끝나지 않은 기간(이번 주·이번 달·올해)인지 — 화면에 '진행 중'으로 적는다. 일봉은 서버가 이미 장중 봉을 뺐다.
function chsInProgress(bar, frame, now=new Date()){
  if (!bar || frame==='D') return false;
  return chsPeriodKey(bar.t, frame) === chsPeriodKey(Math.floor(now.getTime()/1000), frame);
}
async function chsFetchBars(tkr, frame='D'){
  const F = CHS_FRAMES[frame] || CHS_FRAMES.D;
  const r = await authFetch(`/api/price?type=ohlcv&tkr=${encodeURIComponent(tkr)}&range=${F.range}${F.interval!=='1d'?'&interval='+F.interval:''}`);
  const d = await r.json();
  let bars = (d&&d.success&&Array.isArray(d.bars) ? d.bars : [])
    .filter(b=>b && b.complete!==false && [b.o,b.h,b.l,b.c].every(v=>Number.isFinite(v)&&v>0));
  if (frame!=='D') bars = chsMergeBars(bars, frame);
  const need = frame==='D' ? 30 : frame==='Y' ? 2 : 10;
  if (bars.length < need) throw new Error(`${F.label}이 ${need}개보다 적습니다`);
  // 지수 종가(^GSPC·^KS11)도 함께 둔다 — 추세추종 보기의 RS선·상대강도(pages/minervini.js)가 쓴다
  const bench = d && d.benchmarkClose && typeof d.benchmarkClose==='object' ? {spy:d.benchmarkClose.spy||[], kospi:d.benchmarkClose.kospi||[]} : {};
  return {bars, cur:String(d.currency||'').toUpperCase(), symbol:d.symbol||tkr, bench, at:Date.now()};
}
function chsCacheKey(tkr, frame){ return frame==='D' ? tkr : frame+':'+tkr; }
async function chsLoad(tkr, frame=_chsFrame){
  const key = chsCacheKey(tkr, frame);
  if (!tkr || _chsCache[key] || _chsLoading===key) return;
  _chsLoading = key; delete _chsErr[key];
  // 년봉은 월봉(같은 조회)을 해마다 묶는다 — 월봉 캐시가 있으면 다시 받지 않는다
  try {
    if (frame==='Y'){
      const monthly = _chsCache[chsCacheKey(tkr,'M')] || (_chsCache[chsCacheKey(tkr,'M')] = await chsFetchBars(tkr,'M'));
      const yearly = chsMergeBars(monthly.bars, 'Y');
      if (yearly.length < 2) throw new Error('년봉이 2개보다 적습니다');
      _chsCache[key] = {...monthly, bars:yearly};
    } else _chsCache[key] = await chsFetchBars(tkr, frame);
  }
  catch(e){ _chsErr[key] = (e&&e.message)||'조회 실패'; }
  finally { if (_chsLoading===key) _chsLoading = null; }
  if (_cobaltActive==='chart2') cbRenderChart();
}

// ── 그리기 ──
function chsNum(v, cur){
  if (v==null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const dig = (cur==='KRW'||cur==='JPY') ? 0 : a>=1000 ? 0 : a>=100 ? 1 : 2;
  return v.toLocaleString('ko-KR',{minimumFractionDigits:dig, maximumFractionDigits:dig});
}
function chsNiceStep(raw){
  if (!(raw>0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw/p;
  return (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*p;
}
function chsTicks(lo, hi, count){
  const step = chsNiceStep((hi-lo)/Math.max(1,count));
  const out = []; for (let v = Math.ceil(lo/step)*step; v <= hi+step*1e-6; v += step) out.push(+v.toFixed(10));
  return out;
}
function chsDate(t){ const d = new Date(t*1000); return {y:d.getUTCFullYear(), m:d.getUTCMonth()+1, d:d.getUTCDate()}; }
function chsPath(vals, X, Y){
  let d = '', pen = false;
  vals.forEach((v,i)=>{ if (v==null){ pen=false; return; } d += (pen?'L':'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); pen = true; });
  return d;
}
// 날짜 눈금 — 봉 단위마다 다른 간격: 일봉 = 달이 바뀌는 첫 봉(1년이면 두 달마다), 주봉 = 분기, 월봉·년봉 = 해.
function chsTickKey(d, frame){ return frame==='D' ? d.y*12+d.m : frame==='W' ? d.y*4+Math.floor((d.m-1)/3) : d.y; }
function chsTickLabel(d, frame){ return frame==='D'||frame==='W' ? `${d.m===1||frame==='W'&&d.m<=3?d.y+'년 ':''}${d.m}월` : `${d.y}년`; }
function chsChartSvg(view){
  const {bars, ind, off, cur, avg} = view, frame = view.frame || 'D', F = CHS_FRAMES[frame] || CHS_FRAMES.D, CHS_MA = chsMaList(frame);
  const n = bars.length, W = 1100, padL = 10, padR = 66;
  const P = {price:{y:14,h:290}, vol:{y:312,h:52}, rsi:{y:396,h:86}, macd:{y:514,h:100}};
  const H = 646, plotW = W-padL-padR, step = plotW/n;
  const X = i => padL + (i+0.5)*step;
  const sl = arr => arr.slice(off);
  const ma = CHS_MA.map(m=>({...m, vals:sl(ind.ma[m.n])}));
  // 가격 칸 — 고가·저가와 보이는 이동평균·평균 매입가를 모두 담는 범위
  let lo = Math.min(...bars.map(b=>b.l)), hi = Math.max(...bars.map(b=>b.h));
  ma.forEach(m=>m.vals.forEach(v=>{ if(v!=null){ lo=Math.min(lo,v); hi=Math.max(hi,v); } }));
  const avgIn = !!(avg && avg.price>=lo*0.75 && avg.price<=hi*1.25);
  view.avgShown = avgIn;
  if (avgIn){ lo=Math.min(lo,avg.price); hi=Math.max(hi,avg.price); }
  const padY = (hi-lo)*0.06 || hi*0.02; lo-=padY; hi+=padY;
  const Yp = v => P.price.y + (hi-v)/(hi-lo)*P.price.h;
  const pTicks = chsTicks(lo,hi,5), pStep = pTicks.length>1 ? pTicks[1]-pTicks[0] : 1;
  const pFmt = v => v.toLocaleString('ko-KR',{maximumFractionDigits: pStep>=1 ? 0 : pStep>=0.1 ? 1 : 2});
  const grid = (ticks, Y, fmt) => ticks.map(v=>`<line x1="${padL}" x2="${W-padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="chs-grid"/><text x="${W-padR+8}" y="${(Y(v)+4).toFixed(1)}" class="chs-ax">${fmt(v)}</text>`).join('');
  const bw = Math.max(1, Math.min(9, step*0.62)), hollow = bw >= 5;
  const candles = bars.map((b,i)=>{
    const up = b.c >= b.o, x = X(i), y1 = Yp(Math.max(b.o,b.c)), y2 = Yp(Math.min(b.o,b.c));
    const cls = up ? 'chs-up' : 'chs-dn';
    return `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${Yp(b.h).toFixed(1)}" y2="${Yp(b.l).toFixed(1)}" class="${cls} chs-wick"/>`
      + `<rect x="${(x-bw/2).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1,y2-y1).toFixed(1)}" class="${cls}${up&&hollow?' is-hollow':''}"/>`;
  }).join('');
  const maLines = ma.map(m=>`<path d="${chsPath(m.vals,X,Yp)}" class="chs-ma ${m.cls}"/>`).join('');
  const avgLine = avgIn ? `<line x1="${padL}" x2="${W-padR}" y1="${Yp(avg.price).toFixed(1)}" y2="${Yp(avg.price).toFixed(1)}" class="chs-avg"/><text x="${padL+6}" y="${(Yp(avg.price)-6).toFixed(1)}" class="chs-avg-lab">내 평균 매입가 ${chsNum(avg.price,cur)}</text>` : '';
  // 거래량
  const vmax = Math.max(1, ...bars.map(b=>b.v||0));
  const Yv = v => P.vol.y + P.vol.h - (v/vmax)*P.vol.h;
  const vol = bars.map((b,i)=>`<rect x="${(X(i)-bw/2).toFixed(1)}" y="${Yv(b.v||0).toFixed(1)}" width="${bw.toFixed(1)}" height="${(P.vol.y+P.vol.h-Yv(b.v||0)).toFixed(1)}" class="${b.c>=b.o?'chs-up':'chs-dn'} chs-vol"/>`).join('');
  // RSI
  const rsi = sl(ind.rsi), Yr = v => P.rsi.y + (100-v)/100*P.rsi.h;
  const rsiBand = `<rect x="${padL}" y="${Yr(100).toFixed(1)}" width="${plotW}" height="${(Yr(70)-Yr(100)).toFixed(1)}" class="chs-band is-hot"/><rect x="${padL}" y="${Yr(30).toFixed(1)}" width="${plotW}" height="${(Yr(0)-Yr(30)).toFixed(1)}" class="chs-band is-cold"/>`;
  const rsiLines = [70,30].map(v=>`<line x1="${padL}" x2="${W-padR}" y1="${Yr(v)}" y2="${Yr(v)}" class="chs-ref"/><text x="${W-padR+8}" y="${Yr(v)+4}" class="chs-ax">${v}</text>`).join('')
    + `<text x="${W-padR-6}" y="${Yr(100)+13}" class="chs-zone" text-anchor="end">과열</text><text x="${W-padR-6}" y="${Yr(0)-5}" class="chs-zone" text-anchor="end">침체</text>`;
  // MACD
  const mc = sl(ind.macd.macd), sg = sl(ind.macd.signal), hs = sl(ind.macd.hist);
  const mAbs = Math.max(1e-9, ...[...mc,...sg,...hs].filter(v=>v!=null).map(Math.abs));
  const Ym = v => P.macd.y + P.macd.h/2 - v/mAbs*(P.macd.h/2)*0.92;
  const hist = hs.map((v,i)=>v==null?'':`<rect x="${(X(i)-bw/2).toFixed(1)}" y="${Math.min(Ym(v),Ym(0)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.abs(Ym(v)-Ym(0)).toFixed(1)}" class="${v>=0?'chs-up':'chs-dn'} chs-hist"/>`).join('');
  // 날짜 눈금 — 봉 단위마다 다른 간격(chsTickKey), 눈금이 12개를 넘으면 건너뛴다
  const keys = bars.map(b=>chsTickKey(chsDate(b.t), frame));
  const changes = keys.filter((k,i)=>i>0 && k!==keys[i-1]).length;
  const every = Math.max(1, Math.ceil(changes/12)); let k = 0;
  const xTicks = bars.map((b,i)=>{
    if (i===0 || keys[i]===keys[i-1]) return '';
    if ((k++ % every)) return '';
    const d = chsDate(b.t);
    return `<line x1="${X(i).toFixed(1)}" x2="${X(i).toFixed(1)}" y1="${P.price.y}" y2="${P.macd.y+P.macd.h}" class="chs-vgrid"/><text x="${X(i).toFixed(1)}" y="${H-8}" class="chs-ax" text-anchor="middle">${chsTickLabel(d, frame)}</text>`;
  }).join('');
  // 진행 중인 마지막 봉(이번 주·달·해)은 옅은 바탕으로 표시한다
  const prog = view.inProgress ? `<rect x="${(X(n-1)-step/2).toFixed(1)}" y="${P.price.y}" width="${step.toFixed(1)}" height="${P.macd.y+P.macd.h-P.price.y}" class="chs-prog"/>` : '';
  const panelLab = (y, t) => `<text x="${padL+4}" y="${y-8}" class="chs-plab">${t}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="chs-svg" role="img" aria-label="${F.label} 차트 — 가격·이동평균·거래량·RSI·MACD">
    ${prog}${xTicks}
    ${grid(pTicks, Yp, pFmt)}
    ${avgLine}${candles}${maLines}
    ${panelLab(P.vol.y+2,'')}${vol}
    ${panelLab(P.rsi.y,'RSI(14) · 과열·침체')}${rsiBand}${rsiLines}<path d="${chsPath(rsi,X,Yr)}" class="chs-rsi"/>
    ${panelLab(P.macd.y,'MACD(12,26,9) · 힘')}<line x1="${padL}" x2="${W-padR}" y1="${Ym(0)}" y2="${Ym(0)}" class="chs-ref"/><text x="${W-padR+8}" y="${Ym(0)+4}" class="chs-ax">0</text>${hist}<path d="${chsPath(mc,X,Ym)}" class="chs-macd"/><path d="${chsPath(sg,X,Ym)}" class="chs-signal"/>
    <line id="chs-cross" x1="0" x2="0" y1="${P.price.y}" y2="${P.macd.y+P.macd.h}" class="chs-cross" style="display:none"/>
    <rect x="${padL}" y="${P.price.y}" width="${plotW}" height="${P.macd.y+P.macd.h-P.price.y}" fill="transparent" onmousemove="chsHover(event)" onmouseleave="chsHover(null)" data-chart-hit="chs"/>
  </svg>`;
}
function chsHover(evt){
  const v = _chsView, tip = document.getElementById('chs-tip'), line = document.getElementById('chs-cross');
  if (!v || !tip || !line) return;
  if (!evt){ tip.hidden = true; line.style.display = 'none'; return; }
  const svg = evt.currentTarget.ownerSVGElement || evt.currentTarget.closest('svg');
  const rect = svg.getBoundingClientRect(), scale = 1100/rect.width;
  const x = (evt.clientX-rect.left)*scale, n = v.bars.length, step = (1100-10-66)/n;
  const i = Math.max(0, Math.min(n-1, Math.floor((x-10)/step)));
  const cx = 10+(i+0.5)*step; line.setAttribute('x1',cx); line.setAttribute('x2',cx); line.style.display='';
  const b = v.bars[i], g = i+v.off, prev = v.allBars[g-1], d = chsDate(b.t), cur = v.cur, frame = v.frame || 'D';
  const dateLab = frame==='Y' ? `${d.y}년` : frame==='M' ? `${d.y}년 ${d.m}월` : frame==='W' ? `${d.y}년 ${d.m}월 ${d.d}일 주` : `${d.y}년 ${d.m}월 ${d.d}일`;
  const progLab = v.inProgress && i===v.bars.length-1 ? ' · 진행 중' : '';
  const chg = prev ? (b.c/prev.c-1)*100 : null;
  const row = (k,val,cls='') => `<div><span>${k}</span><b class="cb-num ${cls}">${val}</b></div>`;
  tip.innerHTML = `<div class="chs-tip-date">${dateLab}${progLab}</div>`
    + row('시가', chsNum(b.o,cur)) + row('고가', chsNum(b.h,cur)) + row('저가', chsNum(b.l,cur))
    + row('종가', chsNum(b.c,cur)+(chg==null?'':` <em class="${chg>=0?'is-up':'is-dn'}">${chg>=0?'+':''}${chg.toFixed(2)}%</em>`))
    + row('거래량', (b.v||0).toLocaleString('ko-KR'))
    + (v.maList||chsMaList(frame)).map(m=>row(m.label, chsNum(v.ind.ma[m.n][g],cur))).join('')
    + row('RSI', v.ind.rsi[g]==null?'—':v.ind.rsi[g].toFixed(0))
    + row('MACD', v.ind.macd.macd[g]==null?'—':chsNum(v.ind.macd.macd[g],cur==='KRW'||cur==='JPY'?'USD':cur));
  tip.hidden = false;
  const box = tip.parentElement.getBoundingClientRect(), px = evt.clientX-box.left;
  tip.style.left = (px > box.width*0.6 ? px - tip.offsetWidth - 14 : px + 14) + 'px';
}
function chsOwner(o){ _chsOwner = o; cbRenderChart(); }
function chsPick(t){ _chsTkr = t; cbRenderChart(); }
function chsRangePick(r){ _chsRange = chsFrame().ranges[r] ? r : chsFrame().def; cbRenderChart(); cbRestoreFilterFocus('cb-chart2','data-chs-range',_chsRange); }
// 봉 단위 바꾸기 — 보이는 기간은 그 단위의 기본값으로 돌린다(일봉 6개월 · 주봉 3년 · 월봉 10년 · 년봉 전체)
function chsFramePick(f){ if (!CHS_FRAMES[f]) return; _chsFrame = f; _chsRange = CHS_FRAMES[f].def; cbRenderChart(); cbRestoreFilterFocus('cb-chart2','data-chs-frame',f); }

// '읽는 법'은 항목마다 한 줄 요약(2026-11-25 사용자 요청 — 예전 두 문단 펼침은 장황했다)
const CHS_GUIDE = [
  ['판단 기준', '추세 = 가격이 이동평균선 넷보다 모두 위면 오름, 모두 아래면 내림, 섞이면 엇갈림 · 과열·침체 = RSI 70 이상·30 이하 · 힘 = MACD 선이 시그널선 위면 오름 우세'],
  ['기간·숫자', '기간은 봉 개수(주봉의 20선 = 20주 평균) · 20·60·120·200, 14, 12·26·9 는 널리 쓰는 기본값'],
  ['봉', '한 봉 = 하루·한 주·한 달·한 해 · 몸통은 시가→종가, 꼬리는 최고·최저 · 빈 막대 오름, 찬 막대 내림'],
  ['이동평균선', '최근 N개 봉 종가의 평균 · 가격이 선 위면 평균보다 비싸게 거래 중 · 짧은 선이 긴 선을 위로 뚫으면 골든크로스, 아래로 뚫으면 데드크로스'],
  ['거래량', '그 봉 동안 거래된 주식 수 · 많을수록 그 움직임에 무게가 실림'],
  ['RSI(14)', '최근 14개 봉의 오른 폭 대 내린 폭(0~100) · 강한 추세에서는 70 위에 오래 머물기도 함'],
  ['MACD', '12개·26개 봉 평균의 차이(MACD)와 그 9개 평균(시그널선) · 막대가 커지면 그쪽 힘이 세지는 중'],
];

function cbRenderChart(){
  const el = document.getElementById('cb-chart2'); if (!el) return;
  if (_chsOwner!=='전체' && OWNERS.indexOf(_chsOwner)<0) _chsOwner = '전체';
  const ownerF = _chsOwner==='전체' ? null : _chsOwner;
  const list = chsHoldings(ownerF), F = chsFrame(), frame = CHS_FRAMES[_chsFrame] ? _chsFrame : 'D';
  if (!F.ranges[_chsRange]) _chsRange = F.def;
  if (!_chsTkr || !list.some(r=>r.tkr===_chsTkr)) _chsTkr = list[0] ? list[0].tkr : null;
  cbSetHead('내 종목의 봉 차트(일·주·월·년)로 추세·과열·힘을 읽는 연습 · 공부용(매매 신호 아님)', cbOwnerBtns(_chsOwner,'chsOwner'));
  if (!list.length){
    el.innerHTML = `<div class="cb-panel">${cbEmptyHtml(`${ownerF?cbEsc(ownerF)+'의 ':''}차트를 볼 주식·ETF가 없습니다`,'보유 목록에 종목을 등록하면 그 종목의 봉 차트와 지표를 여기서 볼 수 있습니다.',[CB_EMPTY_ADD])}</div>`;
    return;
  }
  const row = list.find(r=>r.tkr===_chsTkr), key = chsCacheKey(_chsTkr, frame), data = _chsCache[key];
  const lensOn = typeof mnvBody==='function' && _chsLens==='mnv';
  if (!lensOn && !data && !_chsErr[key]) chsLoad(_chsTkr, frame);
  const sel = `<label class="chs-pick"><span class="sr-only">종목</span><select class="cb-input" onchange="chsPick(this.value)">${list.map(r=>`<option value="${cbEsc(r.tkr)}"${r.tkr===_chsTkr?' selected':''}>${cbEsc(r.name)}${r.name!==r.tkr?' · '+cbEsc(r.tkr):''}</option>`).join('')}</select></label>`;
  const frames = `<div class="owner-tabs chs-frames" role="group" aria-label="봉 단위">${Object.entries(CHS_FRAMES).map(([k,f])=>`<button class="owner-btn${k===frame?' active':''}" data-chs-frame="${k}" aria-pressed="${k===frame}" onclick="chsFramePick('${k}')">${f.label}</button>`).join('')}</div>`;
  const rangeKeys = Object.keys(F.ranges);
  // 년봉은 '전체' 하나뿐이지만 그대로 그린다. 봉 단위 버튼은 맨 오른쪽에 둔다 — 기간 버튼 수가 바뀌어도 누른 자리에서 움직이지 않게
  const ranges = `<div class="owner-tabs" role="group" aria-label="보이는 기간">${rangeKeys.map(k=>`<button class="owner-btn${k===_chsRange?' active':''}" data-chs-range="${k}" aria-pressed="${k===_chsRange}" onclick="chsRangePick('${k}')">${F.ranges[k][0]}</button>`).join('')}</div>`;
  // 보는 법 — 기본 지표 / 추세추종(미너비니, pages/minervini.js). 화면 안의 종류 전환이라 밑줄형 탭이다.
  const lens = typeof mnvBody==='function' ? `<div class="sim-view-tabs chs-lens" role="group" aria-label="보는 법">${[['basic','기본 지표'],['mnv','추세추종 · 미너비니']].map(([k,t])=>`<button class="cb-btn" data-chs-lens="${k}" aria-pressed="${(_chsLens==='mnv'?'mnv':'basic')===k}" onclick="chsLensPick('${k}')">${t}</button>`).join('')}</div>` : '';
  if (lensOn){
    const m = mnvBody(list, row, ownerF);
    el.innerHTML = `${lens}<div class="cb-panel chs-panel">
      <div class="chs-head"><div class="cb-panel-title">${cbFlagCell({cls:cbCls(row.ref),i:row.ref},24,14)}${cbEsc(row.name)}${row.name!==row.tkr?` <span class="chs-tkr">${cbEsc(row.tkr)}</span>`:''}</div><div class="chs-tools">${sel}${m.tools}</div></div>
      ${m.body}
    </div>${m.below}`;
    return;
  }
  let body;
  if (!data){
    body = _chsErr[key]
      ? `<div class="chs-msg">${F.label}을 받지 못했습니다(${cbEsc(_chsErr[key])}). <button class="cb-btn" onclick="delete _chsErr['${cbEsc(key)}'];cbRenderChart()">다시 시도</button></div>`
      : `<div class="chs-msg" role="status">${F.label}을 받는 중…</div>`;
    _chsView = null;
  } else {
    const all = data.bars, ind = chsIndicators(all), keep = Math.min(all.length, F.ranges[_chsRange][1]);
    const off = all.length - keep, bars = all.slice(off), cur = data.cur || row.cur;
    const avg = row.cur===cur ? chsAvg(row) : null;
    const last = all[all.length-1], prev = all[all.length-2], chg = prev ? (last.c/prev.c-1)*100 : 0, d = chsDate(last.t);
    const inProgress = chsInProgress(last, frame);
    _chsView = {bars, allBars:all, ind, off, cur, avg, frame, inProgress};
    const reads = chsReadings(all, ind, avg, frame);
    const svg = chsChartSvg(_chsView);
    const MA = chsMaList(frame);
    const when = frame==='D' ? `${d.m}월 ${d.d}일 종가` : inProgress ? `이번 ${frame==='W'?'주':frame==='M'?'달':'해'} 진행 중 · 전 봉 대비` : '마지막 봉 종가 · 전 봉 대비';
    const fewBars = [...MA.filter(m=>all.length<m.n).map(m=>m.label), ...(all.length<=14?['RSI(14)']:[]), ...(all.length<34?['MACD']:[])];
    body = `<div class="chs-top">
        <div class="chs-price"><b class="cb-num">${chsNum(last.c,cur)}</b> <span class="chs-cur">${cbEsc(cur)}</span> <em class="cb-num ${chg>=0?'is-up':'is-dn'}">${chg>=0?'+':''}${chg.toFixed(2)}%</em><small>${when} · Yahoo ${F.label}</small></div>
        <div class="chs-legend" aria-label="범례">${MA.map(m=>`<span><i class="chs-sw ${m.cls}"></i>${m.label}${m.sub?` <small>${m.sub}</small>`:''}</span>`).join('')}${_chsView.avgShown?'<span><i class="chs-sw is-avg"></i>내 평균 매입가</span>':avg?`<span class="chs-avg-off">내 평균 매입가 ${chsNum(avg.price,cur)} — 이 기간 가격 범위 밖</span>`:''}</div>
      </div>
      ${fewBars.length||inProgress?`<p class="chs-note">${inProgress?`마지막 봉(옅은 바탕)은 아직 끝나지 않은 이번 ${frame==='W'?'주':frame==='M'?'달':'해'}입니다 — 끝날 때까지 모양이 바뀝니다. `:''}${fewBars.length?`${F.label}이 ${all.length}개뿐이라 ${fewBars.join('·')}은 그릴 수 없습니다.`:''}</p>`:''}
      <div class="chs-plot cb-chart-scroll"><div class="chs-plot-inner">${svg}<div id="chs-tip" class="chs-tip" hidden></div></div></div>
      <div class="chs-reads">${reads.map(r=>`<div class="chs-read is-${r.tone}"><div class="chs-read-head"><span>${r.title}</span>${r.value?`<b class="cb-num">${r.value}</b>`:''}</div><div class="chs-read-word">${r.word}</div><p>${r.text}</p>${r.note?`<small>${r.note}</small>`:''}</div>`).join('')}</div>`;
  }
  el.innerHTML = `${lens}<div class="cb-panel chs-panel">
      <div class="chs-head"><div class="cb-panel-title">${cbFlagCell({cls:cbCls(row.ref),i:row.ref},24,14)}${cbEsc(row.name)}${row.name!==row.tkr?` <span class="chs-tkr">${cbEsc(row.tkr)}</span>`:''}</div><div class="chs-tools">${sel}${ranges}${frames}</div></div>
      ${body}
    </div>
    <div class="cb-panel chs-guide">
      <div class="cb-panel-title">읽는 법</div>
      <dl class="chs-guide-list">${CHS_GUIDE.map(([t,line])=>`<div><dt>${t}</dt><dd>${line}</dd></div>`).join('')}</dl>
      <small class="fin-callout">공부용 — 지난 가격을 요약한 것이라 매매 신호가 아닙니다. Yahoo Finance 가격(배당·분할 보정 전)이라 증권사 화면과 조금 다를 수 있습니다.</small>
    </div>`;
}
