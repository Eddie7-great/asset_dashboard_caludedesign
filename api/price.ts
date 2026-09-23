import type { ApiRequest, ApiResponse } from './_types';

const { authenticateRequest, sendAuthFailure } = require('./_auth.js');

const MAX_TICKERS = 25;
const MAX_TICKER_LENGTH = 24;
const MAX_CONCURRENCY = 5;
const ALLOWED_TYPES = new Set([
  'price', 'dividend', 'dividend_history', 'splits', 'ohlcv',
]);

function singleQuery(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function parseTickerList(value: string | string[] | undefined): string[] {
  const raw = singleQuery(value);
  if (raw.length > 1000) throw new Error('invalid_tickers');
  const tickers = Array.from(new Set(raw.split(',').map(t => t.trim().toUpperCase()).filter(Boolean)));
  if (tickers.length > MAX_TICKERS) throw new Error('too_many_tickers');
  if (tickers.some(t => t.length > MAX_TICKER_LENGTH || !/^[A-Z0-9.^=_-]+$/.test(t))) {
    throw new Error('invalid_ticker');
  }
  return tickers;
}

async function mapWithConcurrency<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, items.length) }, run));
}

function trustedInternalOrigin(): string | null {
  const raw = String(
    process.env.INTERNAL_API_ORIGIN
    || process.env.VERCEL_URL
    || process.env.VERCEL_PROJECT_PRODUCTION_URL
    || '',
  ).trim();
  if (!raw) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

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
async function yahooScrapePrevClose(symbol: string): Promise<{ price: number; prevClose: number } | null> {
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
    return { price: parseFloat(price.toFixed(4)), prevClose: parseFloat(prevClose.toFixed(4)) };
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
export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie, Authorization');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = authenticateRequest(req);
  if (!auth.ok) return sendAuthFailure(res, auth);

  const type = singleQuery(req.query.type) || 'price';
  if (!ALLOWED_TYPES.has(type)) return res.status(400).json({ error: 'Invalid type' });
  let tickers: string[];
  try {
    tickers = parseTickerList(req.query.tickers);
  } catch {
    return res.status(400).json({ error: 'Invalid tickers' });
  }

  try {
    // ── 배당 정보 (Yahoo Finance chart events=div) ─────────────
    //   - KR 단축코드(6자리 알파뉴메릭)는 Python `api/dashboard?type=dividend` (pykrx)로 우회
    //   - US/기타 티커는 Yahoo 사용
    //   - 응답: { success, result:{ [tkr]: { dps, yld, cycle, months, cur } }, usdRate }
    if (type === 'dividend') {
      const divTickers = tickers;
      if (!divTickers.length) return res.status(200).json({ success: true, result: {} });
      const fxRates = await getExchangeRates();
      const usdRate = fxRates?.['KRW'] ?? 1380;
      const KR_RE = /^[0-9][0-9A-Z]{5}$/i;

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
          const origin = trustedInternalOrigin();
          const internalToken = String(process.env.INTERNAL_API_TOKEN || '');
          const requestCookie = Array.isArray(req.headers.cookie)
            ? String(req.headers.cookie[0] || '')
            : String(req.headers.cookie || '');
          if (!origin || (!internalToken && !requestCookie)) {
            console.error('[price] internal dashboard origin/auth is not configured');
            return null;
          }
          const internalHeaders: Record<string, string> = { 'User-Agent': 'asset-dashboard/1.0' };
          if (internalToken) internalHeaders.Authorization = `Bearer ${internalToken}`;
          else internalHeaders.Cookie = requestCookie;
          const r = await fetchWithTimeout(`${origin}/api/dashboard?type=dividend&tickers=${encodeURIComponent(rawSym)}`, {
            headers: internalHeaders
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
      const verifiedTickers: string[] = [];
      await mapWithConcurrency(divTickers, async (raw) => {
        const tkr = raw.trim().toUpperCase().replace(/\.(KS|KQ)$/, '');
        if (!tkr) return;
        let info: any = null;
        if (KR_RE.test(tkr)) {
          // 1차: pykrx, 2차: Yahoo fallback (ETF 분배금 커버 위해)
          info = await pykrxDiv(tkr);
          if (!info || !(Number(info.dps) > 0)) {
            const yhInfo = await yahooDiv(tkr);
            if (yhInfo) info = yhInfo;
          }
        } else {
          info = await yahooDiv(tkr);
        }
        // 유효한 배당/분배 데이터만 반환
        if (info) {
          verifiedTickers.push(raw);
          if (Number(info.dps) > 0) result[tkr] = info;
        }
      });

      return res.status(200).json({ success: true, result, usdRate, verifiedTickers });
    }

    // ── 배당 이력 (raw events) — YoC/CAGR/DRIP 위젯용 ──────────
    //   Yahoo Finance chart events=div, range=10y 로 종목별 원본 지급 내역 반환
    //   응답: { success, result:{ [tkr]: { events:[{date,amount}], cur } } }
    if (type === 'dividend_history') {
      const histTickers = tickers;
      if (!histTickers.length) return res.status(200).json({ success: true, result: {} });

      async function yahooHist(rawSym: string) {
        const upper = rawSym.trim().toUpperCase();
        const krMatch = upper.match(/^([0-9A-Z]{6})(\.(KS|KQ))?$/i);
        const symbols = krMatch
          ? (krMatch[2] ? [upper] : [`${krMatch[1]}.KS`,`${krMatch[1]}.KQ`])
          : [upper];
        for (const sym of symbols) {
          try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=10y&events=div`;
            const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (!r.ok) continue;
            const d = await r.json();
            const result = d?.chart?.result?.[0];
            if (!result) continue;
            const currency = (result.meta?.currency || (krMatch ? 'KRW' : 'USD')).toUpperCase();
            const divEvents = result.events?.dividends || {};
            const events = Object.values(divEvents)
              .map((e: any) => {
                const dt = new Date(e.date * 1000);
                return { date: dt.toISOString().slice(0, 10), amount: Number(e.amount || 0) };
              })
              .filter(e => e.amount > 0)
              .sort((a, b) => a.date.localeCompare(b.date));
            return { events, cur: currency };
          } catch (e) {}
        }
        return null;
      }

      const result: Record<string, any> = {};
      const verifiedTickers: string[] = [];
      await mapWithConcurrency(histTickers, async (raw) => {
        const requested = raw.trim().toUpperCase();
        const tkr = requested.replace(/\.(KS|KQ)$/, '');
        if (!tkr) return;
        const info = await yahooHist(requested);
        if (info) {
          result[tkr] = info;
          verifiedTickers.push(requested);
        }
      });
      return res.status(200).json({ success: true, result, verifiedTickers });
    }

    // ── 액면분할·병합 이력 ─────────────────────────────────────
    //   Yahoo Finance chart events=split, range=5y
    //   응답: { success, result:{ [tkr]: [{date,num,den,ratio}] }, verifiedTickers }
    //
    //   num/den 은 Yahoo 의 numerator/denominator 를 그대로 옮긴 값이다.
    //   2:1 분할이면 num=2,den=1 → 수량 ×2, 단가 ÷2. 1:10 병합이면 num=1,den=10
    //   → 수량 ×0.1, 단가 ×10. 클라이언트가 취득원가(수량×단가)를 보존하는 데 쓴다.
    //   verifiedTickers 는 종목 단위 확인 근거다 — HTTP 200 만으로 확인 완료로 적지
    //   않는다. 응답에 없는 종목은 '분할 없음'이 아니라 '미확인'이다.
    if (type === 'splits') {
      if (!tickers.length) return res.status(200).json({ success: true, result: {}, verifiedTickers: [] });

      async function yahooSplits(rawSym: string) {
        const upper = rawSym.trim().toUpperCase();
        const krMatch = upper.match(/^([0-9A-Z]{6})(\.(KS|KQ))?$/i);
        const symbols = krMatch
          ? (krMatch[2] ? [upper] : [`${krMatch[1]}.KS`, `${krMatch[1]}.KQ`])
          : [upper];
        for (const sym of symbols) {
          try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5y&events=split`;
            const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (!r.ok) continue;
            const d = await r.json();
            const result = d?.chart?.result?.[0];
            if (!result) continue;
            const splitEvents = result.events?.splits || {};
            const events = Object.values(splitEvents)
              .map((e: any) => {
                const num = Number(e.numerator || 0);
                const den = Number(e.denominator || 0);
                const seconds = Number(e.date || 0);
                if (!(num > 0) || !(den > 0) || !(seconds > 0)) return null;
                return {
                  date: new Date(seconds * 1000).toISOString().slice(0, 10),
                  num,
                  den,
                  ratio: num / den,
                };
              })
              .filter((e: any) => e && e.ratio !== 1)
              .sort((a: any, b: any) => a.date.localeCompare(b.date));
            return events;
          } catch (e) {}
        }
        return null;
      }

      const result: Record<string, any> = {};
      const verifiedTickers: string[] = [];
      await mapWithConcurrency(tickers, async (raw) => {
        const requested = raw.trim().toUpperCase();
        const tkr = requested.replace(/\.(KS|KQ)$/, '');
        if (!tkr) return;
        const events = await yahooSplits(requested);
        // 빈 배열도 '분할 없음'을 서버가 확인한 결과이므로 verified 다. null 만 미확인.
        if (events) {
          result[tkr] = events;
          verifiedTickers.push(requested);
        }
      });
      return res.status(200).json({ success: true, result, verifiedTickers });
    }

    // ── OHLCV 시계열 (추세 분석 어드바이저 전용) ───────────────
    //   ?type=ohlcv&tkr=TSLA&range=1y
    //   - Yahoo Finance v8/chart 에서 OHLCV 전체 + ^GSPC / ^KS11 종가 동봉
    //   - KR 6자 코드는 .KS → .KQ 폴백, JP 4자.T 는 그대로
    //   - 섹터 ETF 심볼도 함께 반환 (클라이언트가 추가 호출하여 상대강도 계산)
    if (type === 'ohlcv') {
      const rawTkr = singleQuery(req.query.tkr).trim().toUpperCase();
      const range = singleQuery(req.query.range) || '1y';
      if (!rawTkr || rawTkr.length > MAX_TICKER_LENGTH || !/^[A-Z0-9.^=_-]+$/.test(rawTkr)) {
        return res.status(400).json({ success: false, error: 'Invalid ticker' });
      }
      if (!new Set(['1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max']).has(range)) {
        return res.status(400).json({ success: false, error: 'Invalid range' });
      }

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
        const adj = result.indicators?.adjclose?.[0]?.adjclose || [];
        const session = meta.currentTradingPeriod?.regular;
        const bars: Array<{t:number;o:number;h:number;l:number;c:number;v:number;adj:number|null;complete:boolean}> = [];
        for (let i = 0; i < ts.length; i++) {
          const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i];
          if (o == null || h == null || l == null || c == null) continue;
          const complete = Number.isFinite(session?.start) && Number.isFinite(session?.end)
            ? ts[i]<session.start || Date.now()/1000>=session.end
            : ts[i]<Math.floor(Date.now()/86400000)*86400;
          bars.push({ t: ts[i], o, h, l, c, v: v ?? 0, adj: Number.isFinite(adj[i]) && adj[i]>0 ? adj[i] : null, complete });
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

    // KRX 단축코드는 숫자 6자리만이 아니다 — 0117V0 처럼 영숫자도 발급된다.
    // \d{6} 으로 재면 그런 코드가 해외 티커로 분류돼 Yahoo 에 맨코드로 나가 조회가
    // 통째로 실패한다. 판정 형태는 CLAUDE.md 의 KR ticker shape(^[0-9A-Z]{6}$)를 따른다.
    const KR_CODE_RE = /^[0-9A-Z]{6}(\.KS|\.KQ)?$/;
    const krRaw = tickers.filter(t => KR_CODE_RE.test(t));
    const krTickers = krRaw.map(t => t.replace(/\.(KS|KQ)$/, ''));
    const foreignTickers = tickers.filter(t => !KR_CODE_RE.test(t));
    const quoteResults: Record<string,{price:number;prevClose:number}> = {};

    // 해외주식 & 가상화폐: Yahoo Finance
    await mapWithConcurrency(foreignTickers, async(rawTkr) => {
        const yahooSym = cryptoYahooMap[rawTkr] ?? rawTkr;
        const q = await yahooScrapePrevClose(yahooSym);
        if (q) {
          quoteResults[rawTkr] = { price: q.price, prevClose: q.prevClose };
          console.log(`[Yahoo] ${rawTkr} (${yahooSym}): ${q.price}`);
        } else {
          console.warn(`[Yahoo] ${rawTkr}: 시세 조회 실패`);
        }
    });

    // 국내주식: Yahoo Finance (.KS → .KQ 순서)
    if (krTickers.length > 0) {
      await mapWithConcurrency(krTickers, async(tkr6) => {
          let q = await yahooScrapePrevClose(tkr6 + '.KS');
          if (!q) q = await yahooScrapePrevClose(tkr6 + '.KQ');
          if (q) {
            quoteResults[tkr6] = { price: q.price, prevClose: q.prevClose };
            const original = krRaw.find(t => t.replace(/\.(KS|KQ)$/, '') === tkr6);
            if (original && original !== tkr6) quoteResults[original] = { price: q.price, prevClose: q.prevClose };
            console.log(`[Yahoo KR] ${tkr6}: ₩${q.price}`);
          } else {
            console.warn(`[Yahoo KR] ${tkr6}: 시세 조회 실패`);
          }
      });
    }

    return res.status(200).json({
      success: true,
      rates: { USD: currentUSD, JPY: currentJPY, USDJPY: currentUSDJPY, GOLD_G_KRW: goldPriceG_KRW },
      quotes: quoteResults,
    });

  } catch (error: any) {
    console.error('[price.ts] Global Error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
