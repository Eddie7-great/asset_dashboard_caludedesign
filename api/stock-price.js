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

  try {
    const data = await fetchNaverPrice(ticker);
    CACHE.set(ticker, { ts: now, data });
    return data;
  } catch (e) {
    const errData = {
      success: false,
      ticker,
      error: e && e.message ? e.message : 'scrape_failed',
    };
    // 오류는 짧게만 캐시 (5초) — 네트워크 일시 오류 감안
    CACHE.set(ticker, { ts: now - (CACHE_TTL_MS - 5000), data: errData });
    return errData;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const authHeader = req.headers['authorization'];
  const expectedToken = process.env.AUTH_TOKEN;
  if (expectedToken && (!authHeader || authHeader !== `Bearer ${expectedToken}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const q = req.query || {};
    // 단일 조회 (ticker=) 또는 복수 조회 (tickers=069500,360750)
    const rawList = [];
    if (q.tickers) rawList.push(...String(q.tickers).split(','));
    if (q.ticker) rawList.push(String(q.ticker));

    const tickers = Array.from(
      new Set(rawList.map(normalizeTicker).filter(Boolean))
    );

    if (tickers.length === 0) {
      res.status(400).json({
        success: false,
        error: 'ticker(6자리) 또는 tickers 파라미터가 필요합니다.',
      });
      return;
    }

    // 단일 조회 → 평탄한 응답, 복수 조회 → { result: { ticker: data } }
    if (tickers.length === 1) {
      const data = await fetchWithCache(tickers[0]);
      res.status(data.success ? 200 : 502).json(data);
      return;
    }

    const results = await Promise.all(tickers.map((t) => fetchWithCache(t)));
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
    res.status(500).json({
      success: false,
      error: e && e.message ? e.message : 'internal_error',
    });
  }
};

// Vercel Node.js Serverless Function 설정
module.exports.config = {
  maxDuration: 15,
};
