// api/stock-price.js
// ------------------------------------------------------------------
// 네이버 금융 스크래핑 기반 국내 종목(ETF 포함) 실시간 현재가 API.
//  - 쿼리:
//      /api/stock-price?ticker=069500      → 단일 조회
//      /api/stock-price?tickers=069500,360750,133690  → 복수 조회
//  - 티커는 반드시 6자리 문자열로 처리(앞의 '0' 유지).
//  - 외부 API 키 불필요 (axios + cheerio).
// ------------------------------------------------------------------

const axios = require('axios');
const cheerio = require('cheerio');
const { authenticateRequest, sendAuthFailure } = require('./_auth.js');

const NAVER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
  'Referer': 'https://finance.naver.com/',
};

// 간단한 메모리 캐시 (서버 인스턴스 기준 20초)
const CACHE = new Map();
const CACHE_TTL_MS = 20 * 1000;
const MAX_CACHE_ENTRIES = 200;
const MAX_TICKERS = 20;
const MAX_CONCURRENCY = 5;

function cacheSet(ticker, value) {
  const now = Date.now();
  for (const [key, entry] of CACHE) {
    if (!entry || now - entry.ts >= CACHE_TTL_MS) CACHE.delete(key);
  }
  CACHE.delete(ticker);
  CACHE.set(ticker, value);
  while (CACHE.size > MAX_CACHE_ENTRIES) {
    const oldest = CACHE.keys().next().value;
    if (oldest == null) break;
    CACHE.delete(oldest);
  }
}

async function mapWithConcurrency(items, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, items.length) }, run));
  return results;
}

/**
 * 티커를 6자리 문자열로 정규화.
 *  - KRX 단축코드는 숫자 6자리(예: 069500) 또는 알파뉴메릭 6자리(예: 0117V0, 00104K).
 *  - 숫자/문자열 모두 허용하며 앞의 '0'을 유지.
 *  - 대소문자는 대문자로 통일.
 *  - 잘못된 형식은 null 반환.
 */
function normalizeTicker(raw) {
  if (raw == null) return null;
  // 숫자 타입으로 들어와도 문자열 처리 (앞 0 유실 방지)
  let s = String(raw).trim().toUpperCase();
  // .KS / .KQ 접미사 제거
  s = s.replace(/\.(KS|KQ)$/i, '');
  // 이미 6자리 알파뉴메릭이면 그대로 반환
  if (/^[0-9A-Z]{6}$/.test(s)) return s;
  // 숫자 1~5자리 → zero-pad
  if (/^\d+$/.test(s) && s.length > 0 && s.length < 6) return s.padStart(6, '0');
  return null;
}

/**
 * 숫자 문자열 → Number. '12,345.67' 같은 쉼표 제거.
 */
function parseNumber(text) {
  if (!text) return 0;
  const cleaned = String(text).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 네이버 금융 종목 상세 페이지에서 현재가/전일종가/등락 정보를 스크래핑.
 * 국내 상장 주식/ETF는 동일한 item/main.naver 페이지 레이아웃을 사용한다.
 */
async function fetchNaverPrice(ticker) {
  const url = `https://finance.naver.com/item/main.naver?code=${ticker}`;
  const { data } = await axios.get(url, {
    headers: NAVER_HEADERS,
    timeout: 8000,
    // 네이버는 euc-kr로 내려주는 페이지가 있으므로 text 그대로 받는다.
    responseType: 'text',
    transformResponse: [(d) => d],
  });

  const $ = cheerio.load(data);

  // 종목명
  let name =
    $('div.wrap_company h2 a').first().text().trim() ||
    $('div.wrap_company h2').first().text().trim() ||
    '';

  // 현재가
  let priceText =
    $('p.no_today .blind').first().text().trim() ||
    $('#_nowVal').first().text().trim() ||
    $('p.no_today em').first().text().trim();
  const price = parseNumber(priceText);

  // 전일 종가 (no_exday 첫번째 blind)
  let prevCloseText = $('table.no_info td').first().find('.blind').first().text().trim();
  if (!prevCloseText) {
    prevCloseText = $('table.no_info td').eq(0).find('span.blind').first().text().trim();
  }
  const prevClose = parseNumber(prevCloseText);

  // 등락액
  const diffText =
    $('p.no_exday em').first().find('.blind').first().text().trim() ||
    $('#_diff').first().text().trim();
  const change = parseNumber(diffText);

  // 등락률
  const rateText =
    $('p.no_exday em').eq(1).find('.blind').first().text().trim() ||
    $('#_rate').first().text().trim();
  const changeRate = parseNumber(rateText);

  if (!price) {
    return {
      success: false,
      ticker,
      error: '현재가를 찾을 수 없습니다.',
    };
  }

  return {
    success: true,
    ticker,            // 6자리 문자열 (앞의 '0' 유지)
    symbol: ticker,    // 호환용 필드
    name,
    price,             // 현재가 (KRW)
    prevClose: prevClose || price,
    change,
    changeRate,
    currency: 'KRW',
    source: 'naver-finance',
    fetchedAt: Date.now(),
  };
}

/**
 * 캐시 래퍼 – 동일 티커 20초 내 재조회 차단.
 */
async function fetchWithCache(ticker) {
  const now = Date.now();
  const hit = CACHE.get(ticker);
  if (hit && now - hit.ts < CACHE_TTL_MS) return hit.data;
  if (hit) CACHE.delete(ticker);

  try {
    const data = await fetchNaverPrice(ticker);
    cacheSet(ticker, { ts: now, data });
    return data;
  } catch (e) {
    console.error('[stock-price] scrape failed', ticker, e);
    const errData = {
      success: false,
      ticker,
      error: 'price_unavailable',
    };
    // 오류는 짧게만 캐시 (5초) — 네트워크 일시 오류 감안
    cacheSet(ticker, { ts: now - (CACHE_TTL_MS - 5000), data: errData });
    return errData;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie, Authorization');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = authenticateRequest(req);
  if (!auth.ok) return sendAuthFailure(res, auth);

  try {
    const q = req.query || {};
    // 단일 조회 (ticker=) 또는 복수 조회 (tickers=069500,360750)
    const rawList = [];
    const rawTickers = q.tickers ? String(q.tickers) : '';
    const rawTicker = q.ticker ? String(q.ticker) : '';
    if (rawTickers.length + rawTicker.length > 600) {
      return res.status(400).json({ success: false, error: 'Invalid tickers' });
    }
    if (rawTickers) rawList.push(...rawTickers.split(','));
    if (rawTicker) rawList.push(rawTicker);
    if (rawList.length > MAX_TICKERS) {
      return res.status(400).json({ success: false, error: 'Too many tickers' });
    }

    const normalized = rawList.map(normalizeTicker);
    if (normalized.some(ticker => !ticker)) {
      return res.status(400).json({ success: false, error: 'Invalid tickers' });
    }
    const tickers = Array.from(new Set(normalized));

    if (tickers.length === 0) {
      res.status(400).json({
        success: false,
        error: 'ticker(6자리) 또는 tickers 파라미터가 필요합니다.',
      });
      return;
    }
    if (tickers.length > MAX_TICKERS) {
      return res.status(400).json({ success: false, error: 'Too many tickers' });
    }

    // 단일 조회 → 평탄한 응답, 복수 조회 → { result: { ticker: data } }
    if (tickers.length === 1) {
      const data = await fetchWithCache(tickers[0]);
      res.status(data.success ? 200 : 502).json(data);
      return;
    }

    const results = await mapWithConcurrency(tickers, fetchWithCache);
    const result = {};
    results.forEach((r) => {
      if (r && r.ticker) result[r.ticker] = r;
    });

    res.status(200).json({
      success: true,
      count: tickers.length,
      result,
    });
  } catch (e) {
    console.error('[stock-price] handler failed', e);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
};

// Vercel Node.js Serverless Function 설정
module.exports.config = {
  maxDuration: 15,
};
