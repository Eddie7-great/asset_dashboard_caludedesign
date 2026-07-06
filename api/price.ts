import type { VercelRequest, VercelResponse } from '@vercel/node';

// 삭제된 API 키: FINNHUB_KEY, KIS_APP_KEY, KIS_APP_SECRET
// 이제 모든 시세는 Yahoo Finance (무료, 키 불필요)로 조회
// 실시간 시세 X → 마지막 거래일 종가(EOD) 기준

// ── 타임아웃 가드 달린 fetch ──────────────────────────────────
// 외부 API가 응답 없이 멈추면 Vercel maxDuration(30s) 전체를 잡아먹어 504가 난다.
// 넉넉한 기본값(10s)으로 정상 응답엔 영향 없고, 행(hang) 시에만 abort → 기존 catch/폴백으로 흐른다.
async function fetchWithTimeout(url: string, options: any = {}, timeoutMs = 10000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Yahoo Finance 마지막 거래일 종가 조회 ─────────────────────
async function yahooScrapePrevClose(symbol: string): Promise<{ price: number; prevClose: number; change1D: number } | null> {
  try {
    const encodedSym = encodeURIComponent(symbol);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSym}?interval=1d&range=5d`;
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    const d = await res.json();
    const closes = (d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter((v: any) => v != null);
    if (closes.length < 1) return null;
    // 마지막 거래일 종가
    const prevClose = closes.length >= 2 ? closes[closes.length - 2] : closes[closes.length - 1];
    const price = closes[closes.length - 1];
    const change1D = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
    return { price: parseFloat(price.toFixed(4)), prevClose: parseFloat(prevClose.toFixed(4)), change1D: parseFloat(change1D.toFixed(2)) };
  } catch (e) { console.error(`[Yahoo Scrape] ${symbol}:`, e); return null; }
}

// ── 섹터 → 대표 ETF (추세 분석 어드바이저의 상대강도 비교용) ────
const SECTOR_ETF_MAP: Record<string, string> = {
  // US GICS → US sector ETFs
  'Information Technology':'XLK', 'Communication Services':'XLC', 'Consumer Discretionary':'XLY',
  'Financials':'XLF', 'Health Care':'XLV', 'Energy':'XLE', 'Industrials':'XLI',
  'Materials':'XLB', 'Real Estate':'XLRE', 'Utilities':'XLU', 'Consumer Staples':'XLP',
  'ETF-Broad':'SPY', 'ETF-Tech':'QQQ', 'ETF-Small':'IWM', 'ETF-Dividend':'SCHD',
  'ETF-Income':'JEPI', 'Crypto':'BTC-USD',
  // KR WICS → KR sector/style ETFs (KRX 코드, .KS suffix는 호출 시 부여)
  'IT-반도체':'091160', 'IT-전자부품':'091160', 'IT-소프트웨어':'157490', 'IT-플랫폼':'157490',
  'IT-게임':'157490', '자동차':'091180', '자동차부품':'091180',
  '바이오':'091990', '금융-은행':'140700', '금융-보험':'140700', '금융-증권':'140700',
  '화학':'117460', '화학-배터리':'305720', '소재-비철금속':'117460', '소재-철강':'117460',
  '운송-항공':'140710', '운송-해운':'140710', '통신':'140710',
  '유틸리티':'140710', '필수소비재':'266390', '복합기업':'069500',
  'ETF-해외지수':'SPY', 'ETF-국내지수':'069500', 'ETF-배당':'SCHD',
};

// ── GICS 섹터 매핑 (해외주식) ──────────────────────────────────
const GICS_MAP: Record<string, string> = {
  NVDA:'Information Technology', AAPL:'Information Technology', MSFT:'Information Technology',
  GOOGL:'Communication Services', META:'Communication Services', NFLX:'Communication Services',
  AMZN:'Consumer Discretionary', TSLA:'Consumer Discretionary', NKE:'Consumer Discretionary',
  JPM:'Financials', BAC:'Financials', WFC:'Financials', GS:'Financials', V:'Financials', MA:'Financials',
  JNJ:'Health Care', PFE:'Health Care', UNH:'Health Care', ABBV:'Health Care', MRK:'Health Care',
  XOM:'Energy', CVX:'Energy', COP:'Energy',
  CAT:'Industrials', BA:'Industrials', HON:'Industrials', GE:'Industrials',
  BHP:'Materials', FCX:'Materials', NEM:'Materials',
  AMT:'Real Estate', PLD:'Real Estate', O:'Real Estate', XLRE:'Real Estate',
  NEE:'Utilities', DUK:'Utilities', SO:'Utilities',
  PG:'Consumer Staples', KO:'Consumer Staples', PEP:'Consumer Staples', WMT:'Consumer Staples',
  VOO:'ETF-Broad', SPY:'ETF-Broad', QQQ:'ETF-Tech', IWM:'ETF-Small', VTI:'ETF-Broad',
  SCHD:'ETF-Dividend', VYM:'ETF-Dividend', JEPI:'ETF-Income', JEPQ:'ETF-Income',
  BTC:'Crypto', ETH:'Crypto', XRP:'Crypto', SOL:'Crypto', BNB:'Crypto',
};

// WICS 섹터 매핑 (국내주식, 6자리 코드)
const WICS_MAP: Record<string, string> = {
  '005930':'IT-반도체', '000660':'IT-반도체', '009150':'IT-전자부품',
  '035420':'IT-소프트웨어', '035720':'IT-플랫폼', '251270':'IT-게임', '293490':'IT-게임',
  '005380':'자동차', '000270':'자동차', '012330':'자동차부품', '161390':'자동차부품',
  '068270':'바이오', '207940':'바이오', '196170':'바이오', '145020':'바이오', '214150':'바이오',
  '055550':'금융-은행', '105560':'금융-은행', '086790':'금융-은행',
  '032830':'금융-보험', '000810':'금융-보험',
  '006800':'금융-증권', '039490':'금융-증권', '016360':'금융-증권',
  '051910':'화학', '006400':'화학-배터리', '373220':'화학-배터리', '247540':'화학-배터리',
  '010130':'소재-비철금속', '005490':'소재-철강', '004020':'소재-철강',
  '003490':'운송-항공', '011200':'운송-해운',
  '017670':'통신', '030200':'통신', '032640':'통신',
  '015760':'유틸리티', '033780':'필수소비재', '271560':'필수소비재',
  '028260':'복합기업',
  '360750':'ETF-해외지수', '069500':'ETF-국내지수', '133690':'ETF-해외지수',
  '229200':'ETF-국내지수', '455050':'ETF-배당',
};

export function getSectorForTicker(tkr: string): string {
  const t = tkr.replace(/\.(KS|KQ)$/, '').toUpperCase();
  if (WICS_MAP[t]) return WICS_MAP[t];
  if (GICS_MAP[t]) return GICS_MAP[t];
  return '기타';
}

// ── ExchangeRate 조회 (무료 fallback 우선) ────────────────────
async function getExchangeRates(): Promise<Record<string,number>|null> {
  const EXCHANGE_KEY = process.env.EXCHANGE_KEY || '';
  // 1차: ExchangeRate-API (유료 키 있을 때)
  if (EXCHANGE_KEY) {
    try {
      const res = await fetchWithTimeout(`https://v6.exchangerate-api.com/v6/${EXCHANGE_KEY}/latest/USD`);
      if (res.ok) {
        const d = await res.json();
        if (d.result === 'success') return d.conversion_rates as Record<string,number>;
      }
    } catch (e) { console.error('[ExchangeRate-API]', e); }
  }
  // 2차: open.er-api.com (무료, 키 불필요)
  try {
    const res = await fetchWithTimeout('https://open.er-api.com/v6/latest/USD');
    if (res.ok) {
      const d = await res.json();
      if (d.result === 'success' && d.rates) return d.rates as Record<string,number>;
    }
  } catch (e) { console.error('[open.er-api fallback]', e); }
  return null;
}

// ── 금 시세: Yahoo Finance → gold-api.com → open.er-api 폴백 ──
async function getGoldPriceKRW(usdRate: number): Promise<number|null> {
  // 1차: Yahoo Finance (GC=F 금 선물, 키 불필요)
  try {
    const res = await fetchWithTimeout(
      'https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1d&range=1d',
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (res.ok) {
      const d = await res.json();
      const usdPerOz = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (usdPerOz && usdPerOz > 2000) {
        const krwPerG = Math.round((usdPerOz / 31.1034768) * usdRate);
        console.log(`[Gold Yahoo] $${usdPerOz}/oz → ₩${krwPerG}/g`);
        return krwPerG;
      }
    }
  } catch (e) { console.error('[Gold Yahoo]', e); }

  // 2차: gold-api.com
  try {
    const res = await fetchWithTimeout('https://www.gold-api.com/price/XAU', { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const d = await res.json();
      const usdPerOz = d?.price ?? d?.XAU?.price ?? d?.data?.price;
      if (usdPerOz && usdPerOz > 2000) {
        const krwPerG = Math.round((usdPerOz / 31.1034768) * usdRate);
        console.log(`[Gold gold-api.com] $${usdPerOz}/oz → ₩${krwPerG}/g`);
        return krwPerG;
      }
    }
  } catch (e) { console.error('[Gold gold-api.com]', e); }

  // 3차: open.er-api.com XAU 기준 환율
  try {
    const res = await fetchWithTimeout('https://open.er-api.com/v6/latest/XAU');
    if (res.ok) {
      const d = await res.json();
      const usdPerOz = d?.rates?.USD;
      if (usdPerOz && usdPerOz > 2000) {
        const krwPerG = Math.round((usdPerOz / 31.1034768) * usdRate);
        console.log(`[Gold open.er-api] $${usdPerOz}/oz → ₩${krwPerG}/g`);
        return krwPerG;
      }
    }
  } catch (e) { console.error('[Gold open.er-api]', e); }

  console.error('[Gold] 모든 소스 실패');
  return null;
}

// ── 메인 핸들러 ──────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const authHeader = req.headers['authorization'];
  const expectedToken = process.env.AUTH_TOKEN;
  if (expectedToken && (!authHeader || authHeader !== `Bearer ${expectedToken}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const type = (req.query.type as string) || 'price';
  const tickersStr = (req.query.tickers as string) || '';
  const tickers = tickersStr ? tickersStr.split(',').filter(Boolean) : [];

  try {
    // ── F&G (공포/탐욕 지수) ──────────────────────────────────
    if (type === 'fng') {
      let fngUS = 50, fngCrypto = 50;
      // VIX → Yahoo Finance (키 불필요)
      try {
        const vix = await yahooScrapePrevClose('^VIX');
        if (vix) fngUS = Math.round(Math.max(5, Math.min(95, 100 - ((vix.price - 10) / 30) * 85)));
      } catch(e) { console.warn('[fng] VIX 조회 실패, 기본값 50 사용:', e); }
      // 크립토 FNG → alternative.me (키 불필요)
      try {
        const r = await fetchWithTimeout('https://api.alternative.me/fng/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (r.ok) { const d = await r.json(); if (d?.data?.[0]?.value) fngCrypto = parseInt(d.data[0].value); }
      } catch(e) { console.warn('[fng] 크립토 F&G 조회 실패, 기본값 50 사용:', e); }
      return res.status(200).json({ success: true, us: fngUS, crypto: fngCrypto });
    }

    // ── 배당 정보 (Yahoo Finance chart events=div) ─────────────
    //   - KR 단축코드(6자리 알파뉴메릭)는 Python `api/dashboard?type=dividend` (pykrx)로 우회
    //   - US/기타 티커는 Yahoo 사용
    //   - 응답: { success, result:{ [tkr]: { dps, yld, cycle, months, cur } }, usdRate }
    if (type === 'dividend') {
      const divTickers = (req.query.tickers as string || '').split(',').filter(Boolean);
      if (!divTickers.length) return res.status(200).json({ success: true, result: {} });
      const fxRates = await getExchangeRates();
      const usdRate = fxRates?.['KRW'] ?? 1380;
      const KR_RE = /^[0-9A-Z]{6}$/i;

      // 월배열에서 cycle/ months 도출
      const deriveCycle = (months: number[]): { cycle: string; months: number[] } => {
        const uniq = Array.from(new Set(months)).sort((a,b)=>a-b);
        if (uniq.length >= 10) return { cycle:'월배당', months:[0,1,2,3,4,5,6,7,8,9,10,11] };
        if (uniq.length >= 3)  return { cycle:'분기',   months: uniq.slice(0,4) };
        if (uniq.length === 2) return { cycle:'반기',   months: uniq };
        if (uniq.length === 1) return { cycle:'연간',   months: uniq };
        return { cycle:'-', months:[] };
      };

      // Yahoo Finance 배당 조회
      async function yahooDiv(rawSym: string) {
        const isKrCode = KR_RE.test(rawSym);
        const sym = isKrCode ? `${rawSym}.KS` : rawSym;
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2y&events=div`;
          const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (!r.ok) return null;
          const d = await r.json();
          const result = d?.chart?.result?.[0];
          if (!result) return null;
          const currency = (result.meta?.currency || (isKrCode ? 'KRW' : 'USD')).toUpperCase();
          const price = Number(result.meta?.regularMarketPrice || 0);
          const divEvents = result.events?.dividends || {};
          const divList = Object.values(divEvents)
            .map((e: any) => ({ date: new Date(e.date*1000), amount: Number(e.amount||0) }))
            .filter(e => e.amount > 0)
            .sort((a,b) => b.date.getTime() - a.date.getTime());
          // 최근 12개월 지급 합
          const cutoff = Date.now() - 370*24*3600*1000;
          const recent = divList.filter(e => e.date.getTime() >= cutoff);
          const annualDps = recent.reduce((s,e)=>s+e.amount, 0) || 0;
          const yld = price > 0 && annualDps > 0 ? (annualDps / price * 100) : 0;
          const months = recent.map(e => e.date.getMonth());
          const { cycle, months: canonicalMonths } = deriveCycle(months);
          // 최빈 지급일(day-of-month) 계산 — 이력 없으면 null
          const payDay: number | null = (() => {
            if (!divList.length) return null;
            const freq = new Map<number,number>();
            divList.forEach(e => { const d = e.date.getDate(); freq.set(d, (freq.get(d)||0)+1); });
            return [...freq.entries()].sort((a,b)=>b[1]-a[1])[0][0];
          })();
          return {
            dps: currency === 'KRW' ? Math.round(annualDps) : parseFloat(annualDps.toFixed(4)),
            yld: parseFloat(yld.toFixed(2)),
            cycle,
            months: canonicalMonths,
            cur: currency,
            payDay: payDay ?? undefined,
            source: 'yahoo'
          };
        } catch (e) { return null; }
      }

      // KR 단축코드 배당은 pykrx 기반 백엔드로 우회 (가능한 경우)
      async function pykrxDiv(rawSym: string) {
        try {
          const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
          const r = await fetchWithTimeout(`${origin}/api/dashboard?type=dividend&tickers=${encodeURIComponent(rawSym)}`, {
            headers: { 'User-Agent': 'asset-dashboard/1.0' }
          });
          if (!r.ok) return null;
          const d = await r.json();
          if (!d?.success || !d?.result?.[rawSym]) return null;
          const info = d.result[rawSym];
          // 숫자형 dps 가 > 0 인 경우만 유효 (문자열 '미조회'/'N/A' 등은 무효)
          const dpsNum = Number(info.dps);
          if (!Number.isFinite(dpsNum) || dpsNum <= 0) return null;
          return {
            dps: dpsNum,
            yld: Number(info.yld) || 0,
            cycle: info.cycle || '-',
            months: info.months || [],
            cur: info.cur || 'KRW',
            payDay: typeof info.payDay === 'number' ? info.payDay : undefined,
            source: 'pykrx'
          };
        } catch (e) { return null; }
      }

      const result: Record<string, any> = {};
      await Promise.all(divTickers.map(async (raw) => {
        const tkr = raw.trim().toUpperCase().replace(/\.(KS|KQ)$/, '');
        if (!tkr) return;
        let info: any = null;
        if (KR_RE.test(tkr)) {
          // 1차: pykrx, 2차: Yahoo fallback (ETF 분배금 커버 위해)
          info = await pykrxDiv(tkr);
          if (!info || !(Number(info.dps) > 0)) {
            const yhInfo = await yahooDiv(tkr);
            if (yhInfo && Number(yhInfo.dps) > 0) info = yhInfo;
          }
        } else {
          info = await yahooDiv(tkr);
        }
        // 유효한 배당/분배 데이터만 반환
        if (info && Number(info.dps) > 0) result[tkr] = info;
      }));

      return res.status(200).json({ success: true, result, usdRate });
    }

    // ── 배당 이력 (raw events) — YoC/CAGR/DRIP 위젯용 ──────────
    //   Yahoo Finance chart events=div, range=10y 로 종목별 원본 지급 내역 반환
    //   응답: { success, result:{ [tkr]: { events:[{date,amount}], cur } } }
    if (type === 'dividend_history') {
      const histTickers = (req.query.tickers as string || '').split(',').filter(Boolean);
      if (!histTickers.length) return res.status(200).json({ success: true, result: {} });
      const KR_RE = /^[0-9A-Z]{6}$/i;

      async function yahooHist(rawSym: string) {
        const isKrCode = KR_RE.test(rawSym);
        const sym = isKrCode ? `${rawSym}.KS` : rawSym;
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=10y&events=div`;
          const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (!r.ok) return null;
          const d = await r.json();
          const result = d?.chart?.result?.[0];
          if (!result) return null;
          const currency = (result.meta?.currency || (isKrCode ? 'KRW' : 'USD')).toUpperCase();
          const divEvents = result.events?.dividends || {};
          const events = Object.values(divEvents)
            .map((e: any) => {
              const dt = new Date(e.date * 1000);
              return { date: dt.toISOString().slice(0, 10), amount: Number(e.amount || 0) };
            })
            .filter(e => e.amount > 0)
            .sort((a, b) => a.date.localeCompare(b.date));
          return { events, cur: currency };
        } catch (e) { return null; }
      }

      const result: Record<string, any> = {};
      await Promise.all(histTickers.map(async (raw) => {
        const tkr = raw.trim().toUpperCase().replace(/\.(KS|KQ)$/, '');
        if (!tkr) return;
        const info = await yahooHist(tkr);
        if (info && info.events.length > 0) result[tkr] = info;
      }));
      return res.status(200).json({ success: true, result });
    }

    // ── 섹터 조회 ───────────────────────────────────────────
    if (type === 'sector') {
      const t = (req.query.tkr as string) || '';
      return res.status(200).json({ sector: getSectorForTicker(t) });
    }

    // ── OHLCV 시계열 (추세 분석 어드바이저 전용) ───────────────
    //   ?type=ohlcv&tkr=TSLA&range=1y
    //   - Yahoo Finance v8/chart 에서 OHLCV 전체 + ^GSPC / ^KS11 종가 동봉
    //   - KR 6자 코드는 .KS → .KQ 폴백, JP 4자.T 는 그대로
    //   - 섹터 ETF 심볼도 함께 반환 (클라이언트가 추가 호출하여 상대강도 계산)
    if (type === 'ohlcv') {
      const rawTkr = String(req.query.tkr || '').trim().toUpperCase();
      const range = String(req.query.range || '1y');
      if (!rawTkr) return res.status(400).json({ success: false, error: 'tkr required' });

      const KR_RE = /^[0-9A-Z]{6}$/i;
      // Yahoo 심볼 후보 (KR 단축코드면 .KS 시도, 실패 시 .KQ)
      async function fetchOhlcv(sym: string) {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${encodeURIComponent(range)}`;
        const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r.ok) return null;
        const d = await r.json();
        const result = d?.chart?.result?.[0];
        if (!result) return null;
        const ts: number[] = result.timestamp || [];
        const q = result.indicators?.quote?.[0] || {};
        const meta = result.meta || {};
        const bars: Array<{t:number;o:number;h:number;l:number;c:number;v:number}> = [];
        for (let i = 0; i < ts.length; i++) {
          const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i];
          if (o == null || h == null || l == null || c == null) continue;
          bars.push({ t: ts[i], o, h, l, c, v: v ?? 0 });
        }
        return {
          symbol: sym,
          currency: (meta.currency || 'USD').toUpperCase(),
          exchangeName: meta.exchangeName || '',
          regularMarketPrice: Number(meta.regularMarketPrice ?? 0),
          bars,
        };
      }

      // 1) 타깃 OHLCV (KR 단축코드는 .KS → .KQ 폴백)
      let primary: Awaited<ReturnType<typeof fetchOhlcv>> = null;
      let normalizedSym = rawTkr;
      if (KR_RE.test(rawTkr)) {
        normalizedSym = rawTkr + '.KS';
        primary = await fetchOhlcv(normalizedSym);
        if (!primary || !primary.bars.length) {
          normalizedSym = rawTkr + '.KQ';
          primary = await fetchOhlcv(normalizedSym);
        }
      } else {
        primary = await fetchOhlcv(rawTkr);
      }
      if (!primary || !primary.bars.length) {
        return res.status(404).json({ success: false, error: 'no data', symbol: rawTkr });
      }

      // 2) 섹터 ETF (가능하면) 결정
      const sectorName = getSectorForTicker(rawTkr);
      let sectorEtf = SECTOR_ETF_MAP[sectorName] || '';
      // 자기 자신이 섹터 ETF면 비교 의미 없음 → 비움
      const bareTkr = rawTkr.replace(/\.(KS|KQ)$/, '');
      if (sectorEtf && sectorEtf === bareTkr) sectorEtf = '';

      // 3) 벤치마크/섹터 ETF 종가는 병렬 호출
      const benchSyms: Array<{key:'spy'|'kospi'|'sector'; sym:string}> = [
        { key:'spy',   sym:'%5EGSPC' },     // ^GSPC (URL 인코딩)
        { key:'kospi', sym:'%5EKS11' },     // ^KS11
      ];
      let sectorEtfYahoo = '';
      if (sectorEtf) {
        // KR 코드면 .KS 부여 (KOSDAQ ETF는 드물어 1차만)
        sectorEtfYahoo = KR_RE.test(sectorEtf) ? sectorEtf + '.KS' : sectorEtf;
        benchSyms.push({ key:'sector', sym: encodeURIComponent(sectorEtfYahoo) });
      }
      const benchRes = await Promise.all(benchSyms.map(async (b) => {
        try {
          const u = `https://query1.finance.yahoo.com/v8/finance/chart/${b.sym}?interval=1d&range=${encodeURIComponent(range)}`;
          const r = await fetchWithTimeout(u, { headers: { 'User-Agent':'Mozilla/5.0' } });
          if (!r.ok) return { key: b.key, bars: [] as Array<{t:number;c:number}> };
          const d = await r.json();
          const rr = d?.chart?.result?.[0];
          if (!rr) return { key: b.key, bars: [] };
          const ts: number[] = rr.timestamp || [];
          const cl: (number|null)[] = rr.indicators?.quote?.[0]?.close || [];
          const out: Array<{t:number;c:number}> = [];
          for (let i = 0; i < ts.length; i++) {
            if (cl[i] == null) continue;
            out.push({ t: ts[i], c: cl[i] as number });
          }
          return { key: b.key, bars: out };
        } catch { return { key: b.key, bars: [] as Array<{t:number;c:number}> }; }
      }));
      const benchMap: Record<string, Array<{t:number;c:number}>> = {};
      benchRes.forEach(b => { benchMap[b.key] = b.bars; });

      return res.status(200).json({
        success: true,
        symbol: normalizedSym,
        rawTicker: rawTkr,
        currency: primary.currency,
        exchangeName: primary.exchangeName,
        regularMarketPrice: primary.regularMarketPrice,
        sector: sectorName,
        sectorEtf: sectorEtf || null,
        sectorEtfSymbol: sectorEtfYahoo || null,
        bars: primary.bars,
        benchmarkClose: {
          spy: benchMap['spy'] || [],
          kospi: benchMap['kospi'] || [],
          sector: benchMap['sector'] || [],
        },
      });
    }

    // ── 검색 (get-stock.js로 이전됨) ───────────────────────
    if (type === 'search' || type === 'krsearch') {
      return res.status(200).json({ result: [] });
    }

    // ── 거시 투자 지표 ─────────────────────────────────────
    if (type === 'macro') {
      const macro: Record<string, number | null> = {};

      // 1. F&G US → Python API(alternative.me)에서 실제 값 수신, 여기서는 null
      macro.fngUS = null;

      // 2. F&G Crypto (alternative.me)
      try {
        const r = await fetchWithTimeout('https://api.alternative.me/fng/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (r.ok) { const d = await r.json(); macro.fngCrypto = parseInt(d?.data?.[0]?.value) || null; }
      } catch(e) { macro.fngCrypto = null; }

      // 3. DXY (Yahoo Finance DX-Y.NYB)
      try {
        const r = await fetchWithTimeout('https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&range=5d',
          { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (r.ok) {
          const d = await r.json();
          const cur = d?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
          macro.dxy = cur ? parseFloat(cur.toFixed(2)) : null;
          const closes = (d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter((v:any) => v != null);
          if (closes.length >= 2) macro.dxyChange = parseFloat(((closes[closes.length-1]/closes[closes.length-2]-1)*100).toFixed(2));
        }
      } catch(e) { console.error('[Macro DXY]', e); }

      // 4. 미 국채 수익률 커브 10Y-2Y (Treasury.gov)
      try {
        const now2 = new Date();
        const ym = `${now2.getFullYear()}${String(now2.getMonth()+1).padStart(2,'0')}`;
        const r = await fetchWithTimeout(
          `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/${ym}?type=daily_treasury_yield_curve&field_tdr_date_value_month=${ym}&download=true`
        );
        if (r.ok) {
          const csv = await r.text();
          const lines = csv.trim().split('\n').filter((l:string) => l.trim());
          if (lines.length >= 2) {
            const headers = lines[0].split(',').map((h:string) => h.trim().replace(/"/g,''));
            const last = lines[lines.length-1].split(',').map((v:string) => v.trim().replace(/"/g,''));
            const i2 = headers.findIndex((h:string) => h.includes('2 Yr'));
            const i10 = headers.findIndex((h:string) => h.includes('10 Yr'));
            if (i2 >= 0 && i10 >= 0) {
              const y2 = parseFloat(last[i2]), y10 = parseFloat(last[i10]);
              if (!isNaN(y2) && !isNaN(y10) && y2 > 0 && y10 > 0) {
                macro.yield2Y = y2; macro.yield10Y = y10;
                macro.yieldSpread = parseFloat((y10 - y2).toFixed(2));
              }
            }
          }
        }
      } catch(e) { console.error('[Macro Yield]', e); }

      // 5. S&P500 vs 200MA (SPY Yahoo Finance)
      try {
        const r = await fetchWithTimeout('https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=1y',
          { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (r.ok) {
          const d = await r.json();
          const cl = (d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter((v:any) => v != null);
          if (cl.length >= 50) {
            const slice = cl.slice(-Math.min(200, cl.length));
            const ma200 = slice.reduce((a:number,b:number)=>a+b,0)/slice.length;
            const cur = cl[cl.length-1];
            macro.sp500 = parseFloat(cur.toFixed(2));
            macro.sp500MA200 = parseFloat(ma200.toFixed(2));
            macro.sp500VsMA = parseFloat(((cur-ma200)/ma200*100).toFixed(2));
          }
        }
      } catch(e) { console.error('[Macro SP500]', e); }

      // 6. KOSPI vs 200MA (^KS11 Yahoo Finance)
      try {
        const r = await fetchWithTimeout('https://query1.finance.yahoo.com/v8/finance/chart/%5EKS11?interval=1d&range=1y',
          { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (r.ok) {
          const d = await r.json();
          const cl = (d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter((v:any) => v != null);
          if (cl.length >= 50) {
            const slice = cl.slice(-Math.min(200, cl.length));
            const ma200 = slice.reduce((a:number,b:number)=>a+b,0)/slice.length;
            const cur = cl[cl.length-1];
            macro.kospi = Math.round(cur);
            macro.kospiMA200 = Math.round(ma200);
            macro.kospiVsMA = parseFloat(((cur-ma200)/ma200*100).toFixed(2));
          }
        }
      } catch(e) { console.error('[Macro KOSPI]', e); }

      // 7. BTC 도미넌스 (CoinGecko 무료)
      try {
        const r = await fetchWithTimeout('https://api.coingecko.com/api/v3/global',
          { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (r.ok) {
          const d = await r.json();
          const pct = d?.data?.market_cap_percentage?.btc;
          macro.btcDominance = pct ? parseFloat(pct.toFixed(1)) : null;
        }
      } catch(e) { console.error('[Macro BTC Dom]', e); }

      return res.status(200).json({ success: true, macro });
    }

    // ── GNews 뉴스 피드 ──────────────────────────────────────
    if (type === 'news') {
      const GNEWS_API_KEY = process.env.GNEWS_API_KEY || '';
      if (!GNEWS_API_KEY) return res.status(200).json({ success: false, error: 'No GNews API key', articles: [] });
      const categories = [
        { cat: '증시', q: 'stock market investing S&P500' },
        { cat: '경제', q: 'global economy macro finance' },
        { cat: '원자재', q: 'commodities gold oil price' },
        { cat: '암호화폐', q: 'bitcoin cryptocurrency market' },
        { cat: '기술주', q: 'tech stocks NASDAQ semiconductor' },
      ];
      const articles: Array<{cat:string;title:string;link:string;timeStr:string}> = [];
      await Promise.all(categories.map(async (c) => {
        try {
          const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(c.q)}&lang=en&max=3&sortby=publishedAt&token=${GNEWS_API_KEY}`;
          const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (!r.ok) return;
          const d = await r.json();
          const items: any[] = d.articles || [];
          items.slice(0, 2).forEach((a: any) => {
            const pubDate = new Date(a.publishedAt || Date.now());
            const diff = Math.floor((Date.now() - pubDate.getTime()) / 1000);
            let timeStr = '방금 전';
            if (diff > 86400) timeStr = `${Math.floor(diff/86400)}일 전`;
            else if (diff > 3600) timeStr = `${Math.floor(diff/3600)}시간 전`;
            else if (diff > 60) timeStr = `${Math.floor(diff/60)}분 전`;
            articles.push({ cat: c.cat, title: a.title || '', link: a.url || '#', timeStr });
          });
        } catch(e) { console.error(`[GNews ${c.cat}]`, e); }
      }));
      return res.status(200).json({ success: true, articles });
    }

    // ── 히트맵 (Yahoo Finance로 섹터 ETF 조회) ─────────────
    if (type === 'heatmap') {
      const usSectors = [
        {tkr:'XLK',name:'Technology',marketCap:4200},{tkr:'XLV',name:'Healthcare',marketCap:2100},
        {tkr:'XLF',name:'Financials',marketCap:2300},{tkr:'XLY',name:'Cons Disc',marketCap:1600},
        {tkr:'XLP',name:'Cons Staples',marketCap:1000},{tkr:'XLE',name:'Energy',marketCap:900},
        {tkr:'XLI',name:'Industrials',marketCap:1400},{tkr:'XLB',name:'Materials',marketCap:500},
        {tkr:'XLRE',name:'Real Estate',marketCap:400},{tkr:'XLU',name:'Utilities',marketCap:400},
      ];
      const fetchS = async(tkr:string) => {
        const q = await yahooScrapePrevClose(tkr);
        return {'1D': q ? parseFloat(q.change1D.toFixed(2)) : 0, '5D':0,'1M':0,'3M':0,'6M':0,'YTD':0};
      };
      const [usR, krR] = await Promise.all([
        Promise.all(usSectors.map(async s => ({...s, returns: await fetchS(s.tkr)}))),
        Promise.all([{tkr:'EWY',name:'Korea ETF',marketCap:500}].map(async s => ({...s, returns: await fetchS(s.tkr)}))),
      ]);
      return res.status(200).json({ success: true, heatmap: {us: usR, kr: krR} });
    }

    // ── 일반 시세 (마지막 거래일 종가) ───────────────────────
    // 환율 조회
    const fxRates = await getExchangeRates();
    let currentUSD = 1380, currentJPY = 9.2, currentUSDJPY = 150;
    if (fxRates) {
      currentUSD = fxRates['KRW'] ?? 1380;
      const jpyPerUsd = fxRates['JPY'] ?? 150;
      currentUSDJPY = jpyPerUsd;
      currentJPY = currentUSD / jpyPerUsd;
    }
    console.log(`[Rates] USD/KRW=${currentUSD}`);

    // 금 시세
    const goldPriceG_KRW = (await getGoldPriceKRW(currentUSD)) ?? 150_000;
    console.log(`[Gold] ₩${goldPriceG_KRW}/g`);

    // 가상화폐: Yahoo Finance 심볼 (BTC-USD 등)
    const cryptoYahooMap: Record<string,string> = {
      BTC:'BTC-USD', ETH:'ETH-USD', XRP:'XRP-USD',
      SOL:'SOL-USD', BNB:'BNB-USD', DOGE:'DOGE-USD',
      ADA:'ADA-USD', AVAX:'AVAX-USD',
    };

    const krRaw = tickers.filter(t => /^\d{6}(\.KS|\.KQ)?$/.test(t));
    const krTickers = krRaw.map(t => t.replace(/\.(KS|KQ)$/, ''));
    const foreignTickers = tickers.filter(t => !/^\d{6}(\.KS|\.KQ)?$/.test(t));
    const quoteResults: Record<string,{price:number;prevClose:number}> = {};

    // 해외주식 & 가상화폐: Yahoo Finance
    await Promise.all(
      foreignTickers.map(async(rawTkr) => {
        const yahooSym = cryptoYahooMap[rawTkr] ?? rawTkr;
        const q = await yahooScrapePrevClose(yahooSym);
        if (q) {
          quoteResults[rawTkr] = { price: q.price, prevClose: q.prevClose };
          console.log(`[Yahoo] ${rawTkr} (${yahooSym}): ${q.price}`);
        } else {
          console.warn(`[Yahoo] ${rawTkr}: 시세 조회 실패`);
        }
      })
    );

    // 국내주식: Yahoo Finance (.KS → .KQ 순서)
    if (krTickers.length > 0) {
      await Promise.all(
        krTickers.map(async(tkr6, idx) => {
          let q = await yahooScrapePrevClose(tkr6 + '.KS');
          if (!q) q = await yahooScrapePrevClose(tkr6 + '.KQ');
          if (q) {
            quoteResults[tkr6] = { price: q.price, prevClose: q.prevClose };
            if (krRaw[idx] && krRaw[idx] !== tkr6) quoteResults[krRaw[idx]] = { price: q.price, prevClose: q.prevClose };
            console.log(`[Yahoo KR] ${tkr6}: ₩${q.price}`);
          } else {
            console.warn(`[Yahoo KR] ${tkr6}: 시세 조회 실패`);
          }
        })
      );
    }

    return res.status(200).json({
      success: true,
      rates: { USD: currentUSD, JPY: currentJPY, USDJPY: currentUSDJPY, GOLD_G_KRW: goldPriceG_KRW },
      quotes: quoteResults,
    });

  } catch (error: any) {
    console.error('[price.ts] Global Error:', error);
    return res.status(500).json({ success: false, error: String(error?.message || error) });
  }
}
