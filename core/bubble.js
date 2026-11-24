// core/bubble.js — 비중 지도 — 실현손익 저장, 섹터 분류, Plotly 트리맵
// (2026-11-23 script.js 에서 그대로 옮겨 나눈 조각. 로드 순서는 index.html·scripts/tests/_source.mjs)
// ── 월별 수익/손실 기록 위젯 ──────────────────────────────
let monthlyPLData = [];
function saveMonthlyPL(){try{localStorage.setItem('monthlyPLData',JSON.stringify(monthlyPLData));}catch(e){}saveExtDataToKV();}
function loadMonthlyPL(){try{const d=localStorage.getItem('monthlyPLData');if(d)monthlyPLData=_normalizeMonthlyPLRows(JSON.parse(d));}catch(e){}}



// ── 버블 차트 (Plotly) ──────────────────────
let _bubbleOwner = '전체';
let _bubbleChart = null;

// ── view-bubble 용 Owner 스위처 ──
function setBubbleOwnerX(owner, btn) {
  _bubbleOwner = owner;
  document.querySelectorAll('[id^="sunburst-owner-"]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  try { if (typeof changeOwner === 'function' && currentOwner !== owner) { changeOwner(owner, null); } } catch(e){}
  // 타이틀 즉시 업데이트 (소유주별 포트폴리오 비중 차트)
  const mt = document.getElementById('main-title');
  if (mt) mt.textContent = (typeof navGroup==='function'&&navGroup('bubble')?.title)||'투자 분석';   // 구성(비중 지도)은 투자 분석 메뉴(2026-11-19)
  renderBubbleChart('weight');
}

// 개별 자산 → KRW 환산 가치 (부동산 제외, 전 자산군 공용)
function _bubbleItemValueKRW(i, usdRate) {
  if (i.grp === '금') {
    const gm = i.unit === '돈' ? 3.75 : (i.unit === 'kg' ? 1000 : 1);
    return (i.qty || 0) * gm * (window._GOLD_G_KRW || i.curP || 0);
  }
  const rate = i.cur === 'USD' ? usdRate : curRate(i.cur);
  return (i.qty || 0) * (i.curP || 0) * rate;
}

// ─────────────────────────────────────────────────────────────
// RBICS L1 섹터 + 자산군 카테고리 매핑 (버블 차트 2nd 레이어 전용)
// ─────────────────────────────────────────────────────────────
// Russell-FactSet RBICS L1 기준 (개별 종목), ETF는 Index/Sector 두 가지만.
// 섹터 hue — 같은 섹터는 모든 소유주에서 동일 색 계열을 유지한다.
const _SECTOR_HUES = {
  'Technology': 214,
  'Financial Services': 164,
  'Health Care': 126,
  'Consumer Discretionary': 322,
  'Consumer Staples': 72,
  'Energy': 20,
  'Communications Services': 272,
  'Industrial Services': 196,
  'Materials & Processing': 46,
  'Real Estate': 346,
  'Utilities': 98,
  // ETF 분류 (Index / Sector 두 가지만)
  'Index ETF': 232,
  'Sector ETF': 292,
  'Other': 218,
  // 비주식 자산군
  'Cash': 152,
  'Crypto': 30,
  'Gold': 48
};
// 섹터 표시 이름(한글). 내부 키(_gicsSector 반환값·_SECTOR_HUES·cbSectors 의 label·드릴다운 비교)는 영어 그대로 두고
// **화면에 찍는 자리에서만** 이 함수를 거친다 — 키를 바꾸면 색·드릴다운·필터 비교가 한꺼번에 어긋난다.
const SECTOR_KO = {
  'Technology': '기술',
  'Financial Services': '금융',
  'Health Care': '헬스케어',
  'Consumer Discretionary': '경기소비재',
  'Consumer Staples': '필수소비재',
  'Energy': '에너지',
  'Communications Services': '커뮤니케이션',
  'Industrial Services': '산업재',
  'Materials & Processing': '소재',
  'Real Estate': '부동산',
  'Utilities': '유틸리티',
  'Index ETF': '지수 ETF',
  'Sector ETF': '섹터 ETF',
  'Other': '기타',
  'Cash': '현금',
  'Crypto': '가상화폐',
  'Gold': '금'
};
function sectorKo(key){
  return Object.prototype.hasOwnProperty.call(SECTOR_KO, key) ? SECTOR_KO[key] : String(key == null ? '' : key);
}
// 트리맵 칸 글자: 좁은 칸에도 들어가도록 이름을 줄바꿈한다(한 줄 9자 안팎, 최대 3줄).
// 한 줄로 두면 'TIGER 미국S&P500' 같은 이름은 13px 로도 안 들어가 칸이 통째로 빈다.
function _bubbleWrapLabel(name){
  const text = String(name || '').trim();
  if (text.length <= 9) return text;
  const lines = [];
  let cur = '';
  text.split(/\s+/).forEach(word => {
    const parts = word.length > 9 ? (word.match(/.{1,8}/gu) || [word]) : [word];
    parts.forEach(part => {
      if (cur && (cur + ' ' + part).length <= 9) cur += ' ' + part;
      else { if (cur) lines.push(cur); cur = part; }
    });
  });
  if (cur) lines.push(cur);
  if (lines.length > 3) { lines.length = 3; lines[2] = lines[2].slice(0, 7) + '…'; }
  return lines.join('<br>');
}
// 색 구성 규칙은 세 테마가 공유하고, 배경에 맞춰 채도·명도만 바꾼다.
// sector는 기준 웨지, leaf는 같은 hue 안에서 종목별로 밝기만 부드럽게 달라진다.
const _BUBBLE_THEME_TONES = {
  light: { sectorSat:40, sectorLight:68, leafSat:32, leafSatRange:11, leafLight:72, leafLightRange:11 },
  dark:  { sectorSat:46, sectorLight:69, leafSat:42, leafSatRange:12, leafLight:65, leafLightRange:10 }
};
// 다크·네이비는 어두운 바탕이라 같은 톤을 쓴다.
function _bubbleThemeKey(){
  return isDarkTheme()?'dark':'light';
}
function _bubbleSectorColor(sector){
  const tone=_BUBBLE_THEME_TONES[_bubbleThemeKey()]||_BUBBLE_THEME_TONES.light;
  const hue=Number(_SECTOR_HUES[sector]??_SECTOR_HUES.Other);
  return _bubbleHslHex(hue,tone.sectorSat,tone.sectorLight);
}
// 소유주 웨지도 섹터와 같은 hue·테마 톤 생성기를 사용한다.
// 임의의 별도 팔레트를 섞지 않아 중심 링과 바깥 섹터 링이 한 차트처럼 이어진다.
const _BUBBLE_OWNER_SECTORS = {
  '전체': 'Index ETF',
  '본인': 'Technology',
  '아내': 'Consumer Discretionary',
  '자녀1': 'Financial Services',
  '아버지': 'Communications Services'
};
function _bubbleOwnerColor(owner){
  const tone=_BUBBLE_THEME_TONES[_bubbleThemeKey()]||_BUBBLE_THEME_TONES.light;
  const sector=_BUBBLE_OWNER_SECTORS[owner]||'Other';
  const hue=Number(_SECTOR_HUES[sector]??_SECTOR_HUES.Other);
  return _bubbleHslHex(hue,tone.sectorSat+3,tone.sectorLight-3);
}
function _bubbleOwnerFill(owner,panelColor){
  const theme=_bubbleThemeKey();
  const mixToPanel=theme==='light'?0.82:theme==='dark'?0.72:0.68;
  return _bubbleBlend(_bubbleOwnerColor(owner),panelColor,mixToPanel);
}
function _bubbleBlend(hex,target,amount){
  const parse=v=>{
    const s=String(v||'').trim();
    // 유리 테마의 판 색은 rgba(...) 다 — 투명도는 버리고 색만 섞는다.
    const rgb=s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if(rgb) return [Number(rgb[1]),Number(rgb[2]),Number(rgb[3])];
    const m=s.match(/^#([0-9a-f]{6})$/i); if(!m) return null;
    return [parseInt(m[1].slice(0,2),16),parseInt(m[1].slice(2,4),16),parseInt(m[1].slice(4,6),16)];
  };
  const a=parse(hex), b=parse(target); if(!a||!b) return hex;
  const mix=a.map((v,i)=>Math.round(v+(b[i]-v)*amount));
  return '#'+mix.map(v=>v.toString(16).padStart(2,'0')).join('');
}
function _bubbleHash(value){
  let h=2166136261;
  const s=String(value||'');
  for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); }
  return h>>>0;
}
function _bubbleHslHex(h,s,l){
  h=((Number(h)%360)+360)%360;
  s=Math.max(0,Math.min(100,s))/100;
  l=Math.max(0,Math.min(100,l))/100;
  const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2;
  const rgb=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
  return '#'+rgb.map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('');
}
// 섹터 hue는 거의 움직이지 않고 종목 키마다 주로 명도를 달리한다.
// 따라서 종목 수가 많아도 같은 섹터는 한 가족처럼 보이고, 재접속 시 색도 유지된다.
function _bubbleLeafColor(sector,key){
  const hash=_bubbleHash(`${sector}::${key}`);
  const base=Number(_SECTOR_HUES[sector]??_SECTOR_HUES.Other);
  const theme=_bubbleThemeKey();
  const tone=_BUBBLE_THEME_TONES[theme]||_BUBBLE_THEME_TONES.light;
  const hue=base+((hash%13)-6);
  const sat=tone.leafSat+((hash>>>8)%tone.leafSatRange);
  const light=tone.leafLight+((hash>>>16)%tone.leafLightRange);
  return _bubbleHslHex(hue,sat,light);
}

// 개별 종목 → RBICS L1 섹터 추정 (주식 전용). 영문 섹터명 반환.
// 티커 whitelist + 한/영 종목명 키워드 매칭 → 1차 미스 시 확장 키워드로 2차 추론.
function _gicsSector(item) {
  const nameU = (item.name || '').toUpperCase();
  const name = item.name || '';
  const tStrip = (item.tkr || '').toUpperCase().replace(/\.(KS|KQ|T)$/, '');

  // 1) ETF 우선 분류 (국내/해외 ETF 네이밍 규칙 + 대표 티커) → Index ETF / Sector ETF 두 가지만
  //    국내 종목은 stocks.json의 시장구분을 최우선으로 사용한다. 브랜드명이 상품명에
  //    직접 드러나지 않는 TIME 같은 ETF도 이름 추정에 의존하지 않고 정확히 분류된다.
  //    짧은 브랜드(ACE/SOL/PLUS)는 단어 경계로 제한해 오탐 방지
  //    (예: "SPACE Exploration"의 ACE, "SOLAR"의 SOL 이 ETF로 잘못 분류되지 않도록)
  const krMeta = window._krStocksDB && window._krStocksDB.byCode
    ? window._krStocksDB.byCode.get(tStrip)
    : null;
  const isKrEtf = !!(krMeta && String(krMeta.market || '').toUpperCase() === 'ETF');
  const isETF = isKrEtf
    || /ETF|TIGER|KODEX|KINDEX|ARIRANG|KBSTAR|HANARO|KOSEF|TIMEFOLIO/.test(nameU)
    || /^TIME\s+(미국|글로벌|차이나|일본|인도|유럽|나스닥|S&P|코스피|코스닥|KOSPI|KOSDAQ|\d)/i.test(name)
    || /(^|\s)(ACE|SOL|PLUS|RISE)(\s|\d|$)/.test(nameU)
    || /QQQ|NASDAQ\s*100|S&P\s*500|PROSHARES|DIREXION/i.test(name)
    || ['SPY','SPYM','SPLG','IVV','VOO','QQQ','QQQM','DIA','IWM','VTI','VEA','VWO','EFA','AGG','BND','TLT','GLD','SLV',
        'SCHD','VYM','JEPI','JEPQ','DVY','HDV','NOBL',
        // 섹터/테마/광범위 시장 ETF (자주 보유 — 룩스루 대상 확대)
        'SMH','SOXX','XLK','XLF','XLE','XLV','XLY','XLI','XLP','XLU','XLB','XLC','VGT','VUG','VTV','SCHG','SCHX','RSP','MOAT','SPMO',
        'IEFA','IEMG','ACWI','ARKK','ARKG','IJH','IJR','VIG','VONG','QUAL',
        // 레버리지/인버스 지수 ETF (지수 추종)
        'QLD','TQQQ','SQQQ','QID','UPRO','SPXU','SSO','SDS','SOXL','SOXS','UDOW','SDOW','TNA','TZA','FNGU',
        // KR 지수 ETF 대표 코드 (KODEX 200 / RISE 200TR / KODEX 200TR)
        '069500','361580','278530'].includes(tStrip);
  if (isETF) {
    // 지수/시장 전체 추종 → Index ETF (레버리지/인버스 지수 ETF 포함)
    if (/지수|S&P|SP500|나스닥|NASDAQ|다우|DOW|KOSPI\s*200|코스피\s*200|KOSDAQ|코스닥|ALL[-\s]?WORLD|WORLD|TOTAL\s*MARKET|미국\s*전체|전\s*세계|\s200|QQQ|러셀|RUSSELL/i.test(name)
        || ['SPY','SPYM','SPLG','IVV','VOO','QQQ','QQQM','DIA','VTI','IWM','VEA','VWO','EFA',
            'QLD','TQQQ','SQQQ','QID','UPRO','SPXU','SSO','SDS','UDOW','SDOW','TNA','TZA',
            '069500','361580','278530'].includes(tStrip)) return 'Index ETF';
    // 그 외 모든 ETF (배당, 섹터, 채권, 원자재 등) → Sector ETF
    return 'Sector ETF';
  }

  // 2) 대표 티커 / 주요 종목명 키워드 → RBICS L1
  // Technology (반도체 포함, 소프트웨어/하드웨어/IT 인프라 전반)
  if (['NVDA','AMD','INTC','QCOM','AVGO','MU','AMAT','LRCX','KLAC','SMCI','TXN','TSM','ARM','ASML','MRVL','MCHP','ADI','ON','WDC','STX','NXPI','GFS','ONTO','ALAB','CRDO',
       'AAPL','MSFT','CRM','ORCL','ADBE','CSCO','PLTR','NOW','IBM','ANET','SNOW','PANW','CRWD','DDOG','FTNT','ZS','OKTA','NET','SHOP','U','TEAM','WDAY','HUBS','MDB','TWLO','APP','DELL','HPQ','HPE','INTU','ADSK','CDNS','SNPS','ROP','FICO'].includes(tStrip)
      || ['005930','000660','000990','066570'].includes(tStrip)
      || /반도체|파운드리|웨이퍼|DRAM|낸드|NAND|칩|메모리|소프트웨어|전자|테크|IT|소프트|시스템|솔루션|클라우드|디스플레이|OLED|LED|SW|테크놀로지|하드웨어|로봇|AI|인공지능|빅데이터|보안|사이버|정보기술|전산|네트워크|통신장비/i.test(name)) return 'Technology';

  // Financial Services
  if (['JPM','BAC','C','WFC','V','MA','AXP','GS','MS','BLK','SCHW','BRK.B','BRKB','COF','SOFI','HOOD','COIN','UPST','AFRM','PYPL','SQ','XYZ','ALLY','DFS','ICE','CME','SPGI','MCO','KKR','APO','BX','ARES','PGR','TRV','MET','PRU','AIG','ALL','CB','MMC','AON','USB','PNC','TFC','FITB'].includes(tStrip)
      || /금융|은행|지주|카드|증권|보험|캐피탈|핀테크|홀딩스|인베스트|저축|선물|자산운용/i.test(name)
      || ['055550','105560','086790','316140','071050','032830','088350','138930','024110'].includes(tStrip)) return 'Financial Services';

  // Health Care
  if (['JNJ','UNH','LLY','PFE','MRK','ABBV','TMO','ABT','DHR','AMGN','GILD','BMY','CVS','ISRG','REGN','VRTX','MRNA','BNTX','HIMS','DXCM','MDT','SYK','BSX','ZTS','ELV','CI','HCA','MCK','IQV','BIIB','HUM','CNC','GEHC','IDXX','RMD','A','WST','ALNY','NBIX','VEEV'].includes(tStrip)
      || /헬스|바이오|제약|의료|병원|진단|생명과학|제네릭|백신|신약|메디|의약품|의료기기|임플란트|치료제/i.test(name)
      || ['068270','207940','326030','196170','128940','302440','091990','145020','196300'].includes(tStrip)) return 'Health Care';

  // Consumer Discretionary
  if (['TSLA','AMZN','HD','NKE','MCD','LOW','SBUX','BKNG','TJX','F','GM','TM','CMG','LULU','RIVN','LCID','ABNB','MAR','HLT','RCL','CCL','NCLH','EBAY','ETSY','DKNG','YUM','DRI','ORLY','AZO','ROST','DECK','GRMN','EXPE','DASH','CVNA','W','BABA','PDD','JD','NIO','LI','XPEV'].includes(tStrip)
      || /자동차|현대차|기아|유통|백화점|의류|호텔|면세|레저|화장품|뷰티|패션|커머스|리조트|카지노|가구|인테리어|완구|여행|화장/i.test(name)
      || ['005380','000270','012330','282330','035250','272210','161390','090430','161890'].includes(tStrip)) return 'Consumer Discretionary';

  // Energy
  if (['XOM','CVX','COP','SLB','OXY','EOG','PSX','MPC','VLO','ET','KMI','WMB','OKE','LNG','DVN','FANG','HES','HAL','BKR','TRGP','CTRA','MRO','APA'].includes(tStrip)
      || /에너지|정유|석유|오일|가스|친환경|태양광|풍력|수소|원전|태양|ESS|신재생|셰일/i.test(name)
      || ['096770','010950','011170','267250','009830'].includes(tStrip)) return 'Energy';

  // Communications Services
  if (['GOOGL','GOOG','META','NFLX','DIS','CMCSA','T','VZ','TMUS','EA','TTWO','SPOT','PINS','ROKU','SKM','LUMN','WBD','PARA','FOXA','FOX','OMC','IPG','MTCH','SE','SNAP','RBLX','BIDU','LYV','NWSA','TME'].includes(tStrip)
      || /커뮤니케이션|미디어|엔터|통신|네이버|카카오|하이브|스튜디오|플랫폼|콘텐츠|방송|광고|신문|영상|웹툰|노래|게임|ENTERTAINMENT|MEDIA|TELECOM|BROADCAST/i.test(name)
      || ['035420','035720','017670','030200','032640','352820','251270','259960'].includes(tStrip)) return 'Communications Services';

  // Consumer Staples
  if (['PG','KO','PEP','WMT','COST','KMB','CL','MO','PM','MDLZ','CLX','GIS','TGT','KHC','STZ','KDP','HSY','SYY','ADM','KR','DG','DLTR','MNST','KVUE','EL','CHD','K','HRL','TSN'].includes(tStrip)
      || /식품|음료|담배|필수소비재|농산|사료|생필품|라면|제과|유제품|주류|곡류|정육/i.test(name)
      || ['097950','271560','280360','004170','139480','005300'].includes(tStrip)) return 'Consumer Staples';

  // Industrial Services
  if (['UNP','BA','CAT','LMT','GE','MMM','HON','DE','RTX','ETN','CSX','NSC','UPS','FDX',
       'RKLB','ASTS','LUNR','ACHR','JOBY','NOC','GD','LHX','TDG','HWM','AXON','PH','EMR','ROK','CMI','PCAR','WM','RSG','GEV','PWR','URI','FAST','ODFL','CARR','OTIS','JCI'].includes(tStrip)
      || /산업|조선|항공|방산|기계|중공업|건설|전기|물류|운송|해운|운송|육상|항공기|터미널|우주|로켓|위성|발사체|드론/i.test(name)
      || ['329180','042660','010140','028050','047810','064350','034020','204320'].includes(tStrip)) return 'Industrial Services';

  // Materials & Processing
  if (['LIN','APD','SHW','FCX','ECL','DD','NEM','NUE','ALB','SQM','CTVA','DOW','LYB','PPG','VMC','MLM','FMC','MOS','CF','STLD','RS','IP'].includes(tStrip)
      || /소재|화학|철강|비철|금속|배터리|이차전지|2차전지|양극재|음극재|전해질|리튬|니켈|시멘트|유리|섬유|펄프|제지|비료/i.test(name)
      || ['051910','005490','010130','004020','006400','373220'].includes(tStrip)) return 'Materials & Processing';

  // Real Estate
  if (['AMT','PLD','CCI','EQIX','SPG','O','VICI','WELL','PSA','DLR','SBAC','EXR','AVB','EQR','VTR','ARE','WY','IRM','CBRE','CSGP','INVH'].includes(tStrip)
      || /리츠|부동산|REIT|오피스|물류센터|리테일|매장|건물|토지/i.test(name)) return 'Real Estate';

  // Utilities
  if (['NEE','DUK','SO','AEP','D','EXC','SRE','XEL','CEG','VST','ED','PEG','ETR','WEC','ES','AEE','DTE','PCG','EIX','FE','PPL','AWK'].includes(tStrip)
      || /유틸리티|전력|가스공사|한국전력|수도|상수도|하수도/i.test(name)
      || ['015760','036460'].includes(tStrip)) return 'Utilities';

  return 'Other';
}

// 버블 차트 2nd 레이어 카테고리
// 주식 → WICS 기준 분류(국내/해외 모두 영문 섹터명), 그 외 자산군 그대로
function _bubbleCategory(item) {
  const g = item.grp || '';
  if (g === '현금') return 'Cash';
  if (g === '가상화폐') return 'Crypto';
  if (g === '금') return 'Gold';
  return _gicsSector(item);
}

// leaf 라벨 규칙: 해외 주식 = 티커, 국내 주식 = 국문명, 기타 자산군 = 이름
function _bubbleLeafLabel(item) {
  const g = item.grp || '';
  const tStrip = normTkr(item.tkr);
  if (g === '현금' || g === '금') return item.name || item.tkr || g;
  if (g === '가상화폐') return tStrip || item.name || '';
  // 주식: 한국·일본은 종목명, 해외는 티커
  const isKR = (item.cur === 'KRW')
    || /\.(KS|KQ)$/i.test(item.tkr || '')
    || /^\d{6}$/.test(tStrip);
  const isJP = (item.cur === 'JPY') || /\.T$/i.test(item.tkr || '');
  if (isKR || isJP) return item.name || item.tkr || '';
  return tStrip || item.name || '';
}

function _renderBubbleMobileWeights(container, itemsAug, totalVal) {
  const fmt = v => typeof cbDisp === 'function' ? cbDisp(v) : '₩' + Math.round(v).toLocaleString();
  const showOwner = _bubbleOwner === '전체';
  const rows = [...itemsAug].sort((a, b) => b.val - a.val);
  const html = rows.map((x, idx) => {
    const w = (x.val / totalVal) * 100;
    const color = _bubbleSectorColor(x.sector);
    const ownerTag = showOwner ? `<span style="font-size:var(--fs-cap);color:var(--acc);font-weight:700;background:var(--inner-bg);padding:1px 6px;border-radius:8px;flex-shrink:0">${_cfEsc(x.raw.owner || '-')}</span>` : '';
    const name = _cfEsc(x.raw.name || x.raw.tkr || '-');
    return `<div class="bubble-weight-item" style="padding:5px 2px;border-bottom:1px solid var(--border-light)">
      <div style="display:flex;align-items:center;gap:6px;min-width:0">
        ${ownerTag}
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fs-cap);font-weight:600;color:var(--t1)">${name}</span>
        <span class="bubble-weight-pct" style="flex-shrink:0;font-size:var(--fs-cap);font-weight:800;color:var(--t1);font-family:var(--font-ui)">${w.toFixed(1)}%</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
        <div style="flex:1;height:6px;border-radius:3px;background:var(--inner-bg);overflow:hidden">
          <div style="height:100%;width:${Math.max(w, 0.5).toFixed(1)}%;background:${color};border-radius:3px"></div>
        </div>
        <span style="flex-shrink:0;font-size:var(--fs-cap);color:var(--t3);font-family:var(--font-ui)">${fmt(x.val)}</span>
      </div>
    </div>`;
  }).join('');
  container.innerHTML = `<div style="padding:4px 2px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;padding:2px 2px 8px">
      <span class="bubble-weight-title">종목별 비중 <small>${rows.length}종목</small></span>
      <span style="font-size:var(--fs-cap);font-weight:800;color:var(--t1);font-family:var(--font-ui)">${fmt(totalVal)}</span>
    </div><div class="bubble-weight-grid">${html}</div></div>`;
}

function renderBubbleChart(mode) {
  const container = document.getElementById('sunburst-container');
  if (!container) return;
  const listFallback = isMobileLayout() || typeof Plotly === 'undefined';
  container.classList.toggle('bubble-list-fallback', listFallback);

  if (!window._bubbleRetry) window._bubbleRetry = 0;
  const rect = container.getBoundingClientRect();
  // 모바일은 HTML 리스트 폴백이라 컨테이너 크기 불필요 — 0크기 재시도 게이트 통과
  if (!listFallback && (rect.width < 10 || rect.height < 10)) {
    const vbActive = !!document.querySelector('#view-bubble.active');
    if (vbActive && window._bubbleRetry < 30) {
      window._bubbleRetry++;
      if (window._bubbleRetry > 5 && !container.style.minHeight) container.style.minHeight = '520px';
      setTimeout(() => renderBubbleChart(mode), 200);
    } else {
      window._bubbleRetry = 0;
    }
    return;
  }
  window._bubbleRetry = 0;

  // 드릴 상태 추적 — 재렌더(소유주 변경/모드 변경) 시 root 로 리셋되어 Plotly.react 의 초기 root 와 동기화
  container._bubbleCurrentRoot = '__TOTAL__';

  const filterOwner = _bubbleOwner === '전체' ? null : _bubbleOwner;
  const usdRate = curRate('USD');

  // ── 부동산 제외 · 소유주 필터 적용 ──
  const baseItems = pfolioData
    .filter(i => i && i.grp !== '부동산' && (!filterOwner || i.owner === filterOwner))
    .map(i => ({ raw: i, val: _bubbleItemValueKRW(i, usdRate) }))
    .filter(x => Number.isFinite(x.val) && x.val > 0);

  if (baseItems.length === 0) {
    try { if (typeof Plotly !== 'undefined') Plotly.purge(container); } catch (e) {}
    container.innerHTML = '<div style="color:var(--t3);text-align:center;padding:60px;font-family:var(--font-ui);font-weight:700" data-bubble-empty="1">표시할 자산이 없습니다.</div>';
    return;
  }
  if (container.querySelector('[data-bubble-empty]')) {
    try { if (typeof Plotly !== 'undefined') Plotly.purge(container); } catch (e) {}
    container.innerHTML = '';
  }

  const totalVal = baseItems.reduce((s, x) => s + x.val, 0) || 1;
  const isDark = isDarkTheme();
  const textColor = cssVar('--t1',isDark?'#e7e9ee':'#18213a');
  const panelColor = cssVar('--modal-bg',isDark?'#15181e':'#ffffff');

  // ── 계층 구축: ROOT → (전체 모드일 때) owner → grp → name ──
  // Plotly sunburst 는 ids / labels / parents / values 배열로 트리를 받는다.
  // root 라벨은 트리맵 위 경로 막대(pathbar)의 첫 칸이다 — 드릴다운 중 '어디에 있는지'를 알려 준다.
  const rootId = '__TOTAL__';
  const rootDisplay = filterOwner ? `${filterOwner} 포트폴리오` : '전체';
  const ids = [rootId];
  const labels = [rootDisplay];
  const parents = [''];
  const values = [totalVal];
  const colors = ['rgba(0,0,0,0)'];
  const customdata = [{ kind: 'root', owner: '', name: rootDisplay, weight: 100, value: totalVal }];

  // 동일 소유주+티커(DCA 중복 포함)를 하나의 leaf로 병합
  const _mergeMap = new Map();
  baseItems.forEach(({ raw, val }) => {
    const key = `${raw.owner || ''}::${raw.grp || ''}::${(raw.tkr || raw.name || '').toUpperCase().replace(/\.(KS|KQ)$/, '')}`;
    if (_mergeMap.has(key)) {
      _mergeMap.get(key).val += val;
      if (!raw.dca) _mergeMap.get(key).raw = raw; // 보유 항목을 대표 항목으로 우선
    } else {
      _mergeMap.set(key, { raw, val });
    }
  });
  // 각 종목에 대한 2nd 레이어 카테고리(섹터/자산군) 사전 계산 & 집계
  const itemsAug = Array.from(_mergeMap.values()).map(({ raw, val }) => ({
    raw, val, sector: _bubbleCategory(raw)
  }));

  // ── 모바일: Plotly 대신 종목별 비중 리스트 + 섹터 비중표 ──
  if (listFallback) {
    try { Plotly.purge(container); } catch (e) {}
    _renderBubbleMobileWeights(container, itemsAug, totalVal);
    _renderBubbleSectorTable(itemsAug, totalVal, isDark);
    return;
  }

  const ownerAgg = {};
  const secAggByOwner = {};
  itemsAug.forEach(({ raw, val, sector }) => {
    const o = raw.owner || '기타';
    ownerAgg[o] = (ownerAgg[o] || 0) + val;
    if (!secAggByOwner[o]) secAggByOwner[o] = {};
    secAggByOwner[o][sector] = (secAggByOwner[o][sector] || 0) + val;
  });

  const ownerKeys = Object.keys(ownerAgg).sort((a, b) => ownerAgg[b] - ownerAgg[a]);
  const ownersForLayer = filterOwner ? [filterOwner] : ownerKeys;

  ownersForLayer.forEach((owner, oi) => {
    const ownerVal = ownerAgg[owner] || 0;
    const ownerWeight = (ownerVal / totalVal) * 100;
    let parentIdForSec;
    if (!filterOwner) {
      const oid = `O::${owner}`;
      ids.push(oid);
      labels.push(owner);
      parents.push(rootId);
      values.push(ownerVal);
      // 소유주 링은 섹터 팔레트의 같은 hue를 쓰되 테마 패널색과 섞어 옅게 채운다.
      // 소유주 구분은 유지하면서 바깥 섹터·종목 링보다 시각적 우선순위가 낮게 보인다.
      colors.push(_bubbleOwnerFill(owner,panelColor));
      customdata.push({ kind: 'owner', owner, name: owner, weight: ownerWeight, value: ownerVal });
      parentIdForSec = oid;
    } else {
      parentIdForSec = rootId;
    }

    // 2nd 레이어: GICS 섹터 or 자산군 (현금/가상화폐/금)
    const secMap = secAggByOwner[owner] || {};
    const secKeys = Object.keys(secMap).sort((a, b) => secMap[b] - secMap[a]);
    secKeys.forEach((sector) => {
      const secVal = secMap[sector];
      const secWeight = (secVal / totalVal) * 100;
      const gid = `G::${owner}::${sector}`;
      const secColor = _bubbleSectorColor(sector);
      ids.push(gid);
      labels.push(sectorKo(sector));   // 화면 이름만 한글 — id·색·비교 키는 영어 그대로
      parents.push(parentIdForSec);
      values.push(secVal);
      colors.push(_bubbleBlend(secColor,panelColor,isDark?0.10:0.06));
      customdata.push({ kind: 'grp', owner, name: sectorKo(sector), weight: secWeight, value: secVal });

      // 3rd 레이어: 개별 종목(leaf)
      const leafItems = itemsAug
        .filter(x => (x.raw.owner || '기타') === owner && x.sector === sector)
        .sort((a, b) => b.val - a.val);
      leafItems.forEach((x, li) => {
        const i = x.raw;
        const val = x.val;
        const weight = (val / totalVal) * 100;
        const displayName = _bubbleLeafLabel(i);
        const leafId = `L::${owner}::${sector}::${i.tkr || i.name}::${li}`;
        ids.push(leafId);
        // 트리맵은 칸 안에 이름을 쓴다(면적이 작으면 Plotly 가 글자를 숨긴다 — uniformtext)
        labels.push(displayName);
        parents.push(gid);
        values.push(val);
        colors.push(_bubbleLeafColor(sector,`${owner}::${i.tkr||i.name}::${li}`));
        customdata.push({
          kind: 'leaf',
          owner: i.owner || owner,
          grp: i.grp,
          sector,
          name: i.name || displayName,
          displayName,
          tkr: i.tkr || '',
          weight,
          value: val
        });
      });
    });
  });

  // 호버 툴팁 전용 텍스트 — 실제 평가액은 여기서만 노출 (슬라이스 내부에는 노출되지 않음)
  const fmtKRW = (v) => '₩' + Math.round(v || 0).toLocaleString('ko-KR');
  const hoverText = customdata.map(d => {
    if (d.kind === 'root') {
      return `<b>${_cfEsc(d.name)}</b><br><span style="opacity:.8">전체 비중 100.00%</span><br><span style="opacity:.9">평가액 ${fmtKRW(d.value)}</span>`;
    }
    if (d.kind === 'owner') {
      return `<b>${_cfEsc(d.owner)}</b><br><span style="opacity:.8">전체 비중 ${d.weight.toFixed(2)}%</span><br><span style="opacity:.9">평가액 ${fmtKRW(d.value)}</span>`;
    }
    if (d.kind === 'grp') {
      return `<b>${_cfEsc(d.owner)} · ${_cfEsc(d.name)}</b><br><span style="opacity:.8">전체 비중 ${d.weight.toFixed(2)}%</span><br><span style="opacity:.9">평가액 ${fmtKRW(d.value)}</span>`;
    }
    // 종목명(국문 또는 영문) 과 티커를 한 줄에 괄호로 병기
    const tkrPart = d.tkr ? ` <span style="opacity:.7">(${_cfEsc(d.tkr)})</span>` : '';
    const secLine = d.sector ? `<br><span style="opacity:.75">${_cfEsc(sectorKo(d.sector))}</span>` : '';
    return `<b>${_cfEsc(d.owner)} · ${_cfEsc(d.name)}${tkrPart}</b>${secLine}<br><span style="opacity:.8">비중 ${d.weight.toFixed(2)}%</span><br><span style="opacity:.9">평가액 ${fmtKRW(d.value)}</span>`;
  });

  // 사각형 면적 그림(트리맵) — 원형(선버스트)과 같은 계층·같은 색이지만 작은 조각의 이름이
  // 잘리지 않고 면적으로 크기를 바로 비교할 수 있다. 바깥 리더라인 라벨·가운데 라벨이 필요 없다.
  const trace = {
    type: 'treemap',
    ids, labels, parents, values,
    branchvalues: 'total',
    marker: {
      colors,
      line: {
        color: _bubbleThemeKey()==='light'?'rgba(255,255,255,.95)':'rgba(13,14,18,.9)',
        width: 2
      }
    },
    tiling: { packing: 'squarify', pad: 3 },
    pathbar: { visible: true, side: 'top', thickness: 30, textfont: { family: "'Manrope','Noto Sans KR',sans-serif", size: 14, color: textColor } },
    // 이름은 굵게, 비중은 다음 줄 — 한 줄에 같은 굵기로 이어 쓰면 작은 칸에서 둘이 구분되지 않는다.
    textinfo: 'label+percent root',
    // 종목 칸은 줄바꿈한 이름을 쓰고(좁은 칸에도 들어가게), 비중 2% 미만의 작은 칸은 이름만 쓴다 —
    // 두 줄(이름+비중)이 안 들어가 칸이 통째로 비는 것보다 이름이라도 보이는 편이 낫다. 비중은 호버에 있다.
    text: labels.map((label, i) => customdata[i].kind === 'leaf' ? _bubbleWrapLabel(label) : label),
    texttemplate: customdata.map(d => (d.kind === 'leaf' && d.weight < 2) ? '<b>%{text}</b>' : '<b>%{text}</b><br>%{percentRoot:.1%}'),
    textposition: 'top left',
    // 섹터·종목 칸은 두 테마 모두 밝은 파스텔이라 글자가 항상 진해야 읽히고, 소유주·전체 칸은
    // 패널색과 섞은 옅은 바탕(다크에서는 어두움)이라 테마 글자색을 쓴다 — 칸마다 글자색을 따로 준다.
    textfont: {
      family: "'Manrope','Noto Sans KR',sans-serif",
      size: 16,
      color: customdata.map(d => (d.kind === 'root' || d.kind === 'owner') ? textColor : '#18213a')
    },
    hovertext: hoverText,
    hoverinfo: 'text',
    customdata
  };

  const layout = {
    margin: { t: 6, l: 4, r: 4, b: 4 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: "'Manrope','Noto Sans KR',sans-serif", color: textColor, size: 13 },
    showlegend: false,
    // uniformtext 는 모든 칸의 글자를 '가장 빡빡한 칸'에 맞춘 한 크기로 그린다 — minsize 가 곧 실제 글자 크기의
    // 바닥이다(10 일 때 화면 전체가 10px 로 내려앉았다). 13px 로도 안 들어가는 칸은 숨기고 호버로 확인한다.
    uniformtext: { minsize: 13, mode: 'hide' },
    hoverlabel: {
      bgcolor: cssVar('--tipbg',isDark?'#f4f7fb':'#18213a'),
      bordercolor: cssVar('--tipbd',isDark?'#ffffff':'#31405e'),
      font: {
        family: "'Manrope','Noto Sans KR',sans-serif",
        size: 13,
        color: cssVar('--tiptx',isDark?'#111827':'#f8fafc')
      }
    },
    transition: { duration: 450, easing: 'cubic-in-out' }
  };

  try {
    Plotly.react(container, [trace], layout, {
      responsive: true,
      displayModeBar: false,
      displaylogo: false
    });
  } catch (e) {
    console.error('[Hologram-Bubble] render failed:', e);
    container.innerHTML = '<div style="color:var(--t3);text-align:center;padding:40px">차트 렌더링 실패</div>';
  }

  // 우측 섹터 비중표 렌더링 (현재 필터 기준 합계)
  _renderBubbleSectorTable(itemsAug, totalVal, isDark);

}

let _bubbleDrilledSector = null;
// 마지막 렌더 컨텍스트 — 우측 패널 토글 시 다시 사용
let _bubbleLastCtx = null;

function _renderBubbleSectorTable(itemsAug, totalVal, isDark) {
  const tbl = document.getElementById('bubble-sector-table');
  if (!tbl) return;
  // 컨텍스트 보존 (드릴 토글 시 재사용)
  _bubbleLastCtx = { itemsAug, totalVal, isDark };

  if (!itemsAug || !itemsAug.length || !totalVal) {
    tbl.innerHTML = '';
    _bubbleDrilledSector = null;
    _applyBubbleDrillState(false);
    return;
  }
  const sectorTotals = {};
  itemsAug.forEach(x => {
    sectorTotals[x.sector] = (sectorTotals[x.sector] || 0) + x.val;
  });
  const rows = Object.entries(sectorTotals).sort((a, b) => b[1] - a[1]);

  // 현재 데이터에 드릴된 섹터가 더 이상 존재하지 않으면 자동 해제
  if (_bubbleDrilledSector && !sectorTotals[_bubbleDrilledSector]) {
    _bubbleDrilledSector = null;
    _applyBubbleDrillState(false);
  }

  const headerColor = 'var(--t3)';
  const rowBg = 'var(--inner-bg)';
  const rowBgSel = 'var(--acc-soft)';
  const rowBorder = 'var(--border-light)';
  const rowBorderSel = 'var(--acc)';
  const textPrimary = 'var(--t1)';
  const fmtKRW = (v) => '₩' + Math.round(v).toLocaleString('ko-KR');
  const html = [
    `<div style="font-family:var(--font-ui);font-size:var(--fs-cap);letter-spacing:.08em;color:${headerColor};font-weight:700;padding:2px 8px 10px;">섹터 구성</div>`,
    `<div style="display:flex;flex-direction:column;gap:5px;">`
  ];
  rows.forEach(([sec, val]) => {
    const pct = (val / totalVal * 100);
    const pctStr = pct >= 10 ? pct.toFixed(1) : pct.toFixed(2);
    const c = _bubbleSectorColor(sec);
    const isSel = _bubbleDrilledSector === sec;
    const safeSec = _cfEsc(sec);
    const detailHtml = isSel ? _renderBubbleLeavesPanel(sec, itemsAug, isDark, true) : '';
    html.push(`
      <div style="border-radius:8px;background:${isSel ? rowBgSel : rowBg};border:1px solid ${isSel ? rowBorderSel : rowBorder};overflow:hidden;transition:background .15s ease, border-color .15s ease;">
      <button type="button" data-bubble-sector="${safeSec}" onclick="handleBubbleSectorClick(this.dataset.bubbleSector)" style="position:relative;padding:8px 10px;cursor:pointer;overflow:hidden;border:0;background:transparent;width:100%;text-align:left;color:inherit;font:inherit;">
        <div style="position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--border-light);pointer-events:none;"></div>
        <div style="position:absolute;left:0;bottom:0;height:3px;width:${Math.min(100, pct)}%;background:${c};pointer-events:none;"></div>
        <div style="position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;pointer-events:none;">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
            <span style="width:8px;height:8px;border-radius:3px;background:${c};flex-shrink:0;"></span>
            <span style="font-family:var(--font-ui);font-size:var(--fs-cap);font-weight:700;color:${textPrimary};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_cfEsc(sectorKo(sec))}</span>
          </div>
          <div style="display:flex;align-items:baseline;gap:8px;flex-shrink:0;">
            <span style="font-family:var(--font-ui);font-size:var(--fs-body);font-weight:800;color:${textPrimary};letter-spacing:0;">${pctStr}%</span>
          </div>
        </div>
        <div style="position:relative;font-family:var(--font-ui);font-size:var(--fs-cap);color:${headerColor};margin-top:2px;letter-spacing:0;pointer-events:none;">${fmtKRW(val)}</div>
      </button>
      ${detailHtml}
      </div>
    `);
  });
  html.push(`</div>`);
  tbl.innerHTML = html.join('');

  // 드릴 상태 동기화 (컨텍스트 변경 후 leaves 패널 컨텐츠 재생성)
  if (_bubbleDrilledSector) {
    _applyBubbleDrillState(true);
  } else {
    _applyBubbleDrillState(false);
  }
}

// 우측 종목 패널 — 특정 섹터 내 leaf 종목들을 비중 큰 순으로 노출 (스크롤 없이 자동 압축)
function _renderBubbleLeavesPanel(sector, itemsAug, isDark, returnHtml = false) {
  const tbl = document.getElementById('bubble-leaves-table');
  if (!tbl && !returnHtml) return;
  const inSector = (itemsAug || []).filter(x => x.sector === sector);
  const secTotal = inSector.reduce((s, x) => s + x.val, 0) || 1;
  inSector.sort((a, b) => b.val - a.val);

  const accent = _bubbleSectorColor(sector);
  const headerColor = 'var(--t3)';
  const rowBg = 'var(--inner-bg)';
  const rowBorder = 'var(--border-light)';
  const textPrimary = 'var(--t1)';
  const fmtKRW = (v) => '₩' + Math.round(v).toLocaleString('ko-KR');

  // 행 수에 따라 패딩/폰트 자동 압축 — 스크롤 없이 모두 보이게
  const n = inSector.length;
  const compact = n > 14;
  const veryCompact = n > 22;
  const padY = veryCompact ? 3 : compact ? 5 : 7;
  const fontSize = veryCompact ? .68 : compact ? .72 : .76;
  const subSize = veryCompact ? .58 : compact ? .62 : .65;
  const gap = veryCompact ? 2 : compact ? 3 : 4;

  const html = [
    `<div class="bubble-inline-leaves" style="padding:4px 8px 9px;border-top:1px solid ${rowBorder};">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:2px 2px 7px;">
      <div style="font-family:var(--font-ui);font-size:var(--fs-cap);letter-spacing:.08em;color:${headerColor};font-weight:700;">${_cfEsc(sectorKo(sector))}</div>
      <button type="button" data-bubble-sector="${_cfEsc(sector)}" onclick="handleBubbleSectorClick(this.dataset.bubbleSector)" style="font-family:var(--font-ui);font-size:var(--fs-cap);color:${accent};cursor:pointer;font-weight:700;border:0;background:transparent;padding:4px;">닫기</button>
    </div>`,
    `<div style="display:flex;flex-direction:column;gap:${gap}px;">`
  ];
  inSector.forEach((x) => {
    const i = x.raw;
    const val = x.val;
    const pctSec = (val / secTotal * 100);
    const pctStr = pctSec >= 10 ? pctSec.toFixed(1) : pctSec.toFixed(2);
    const name = _cfEsc(_bubbleLeafLabel(i));
    const tkr = normTkr(i.tkr);
    const sub = (tkr && tkr !== _bubbleLeafLabel(i)) ? _cfEsc(tkr) : '';
    html.push(`
      <div style="position:relative;padding:${padY}px 10px;border-radius:6px;background:${rowBg};border:1px solid ${rowBorder};overflow:hidden;">
        <div style="position:relative;display:flex;align-items:center;justify-content:space-between;gap:6px;">
          <div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1;">
            <span style="width:6px;height:6px;border-radius:2px;background:${accent};flex-shrink:0;"></span>
            <span style="font-size:${fontSize}rem;font-weight:600;color:${textPrimary};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}${sub ? ` <span style=\"opacity:.55;font-weight:500;\">${sub}</span>` : ''}</span>
          </div>
          <span style="font-size:${fontSize}rem;font-weight:700;color:${textPrimary};flex-shrink:0;">${pctStr}%</span>
        </div>
        <div style="position:relative;font-size:${subSize}rem;color:${headerColor};margin-top:1px;letter-spacing:.3px;">${fmtKRW(val)}</div>
      </div>
    `);
  });
  html.push(`</div></div>`);
  const out = html.join('');
  if (returnHtml) return out;
  tbl.innerHTML = out;
}

// 드릴 ON/OFF 시 패널 폭/투명도 토글 — CSS transition 으로 슬라이드 애니메이션
function _applyBubbleDrillState(drilled) {
  const lp = document.getElementById('bubble-leaves-panel');
  const lt = document.getElementById('bubble-leaves-table');
  if (!lp) return;
  lp.style.flexBasis = '0';
  lp.style.maxWidth = '0';
  lp.style.padding = '0';
  if (drilled) { if (lt) requestAnimationFrame(() => { lt.style.opacity = '1'; }); }
  else if (lt) lt.style.opacity = '0';
  // 차트 영역 폭이 바뀌면 트리맵을 다시 배치한다
  setTimeout(() => {
    try {
      const c = document.getElementById('sunburst-container');
      if (c && typeof Plotly !== 'undefined') Plotly.Plots.resize(c);
    } catch (e) {}
  }, 380);
}

// 섹터 행 클릭 핸들러 — 같은 섹터 재클릭 시 닫기, 그 외 새로 열기
window.handleBubbleSectorClick = function(sector) {
  if (!sector) return;
  if (_bubbleDrilledSector === sector) {
    _bubbleDrilledSector = null;
  } else {
    _bubbleDrilledSector = sector;
  }
  if (_bubbleLastCtx) {
    _renderBubbleSectorTable(_bubbleLastCtx.itemsAug, _bubbleLastCtx.totalVal, _bubbleLastCtx.isDark);
  }
};
