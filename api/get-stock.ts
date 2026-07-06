// api/get-stock.ts
// Vercel Serverless Function: 네이버 증권 HTML 스크래핑 기반 종목 검색
// axios + cheerio 사용 (외부 API 키 불필요)

import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import * as cheerio from 'cheerio';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
  'Referer': 'https://www.naver.com/',
};

interface StockResult {
  success: boolean;
  name: string;
  symbol: string;
  price: number;
  change?: string;
  changeRate?: string;
  currency: string;
}

// 네이버 통합검색 → 종목 정보 추출
async function searchNaver(query: string): Promise<StockResult | null> {
  const url = `https://search.naver.com/search.naver?query=${encodeURIComponent(query + ' 주가')}&where=nexearch`;
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 8000 });
    const $ = cheerio.load(data);

    let name = '', price = 0, symbol = '', change = '', changeRate = '', currency = 'KRW';

    // 시도 1: .stock_price_box (국내/ETF)
    const spb = $('.stock_price_box').first();
    if (spb.length) {
      name = spb.find('.stock_name, .name, .tit').first().text().trim();
      let codeRaw = spb.find('.stock_code, .code').first().text().trim();
      symbol = codeRaw.replace(/[^0-9]/g, ''); // 숫자만 남김 (6자리 코드)
      if (symbol.length > 6) symbol = symbol.substring(0, 6);
      const priceText = spb.find('.price_box .blind, .price, .num').first().text().trim();
      price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;
      change = spb.find('.change, .diff').first().text().trim();
      changeRate = spb.find('.rate, .percent').first().text().trim();
    }

    // 시도 2: data-* 속성 기반 주가 카드
    if (!price) {
      $('[data-template="stock"]').each((_: any, el: any) => {
        const el$ = $(el);
        const n = el$.find('.name, .tit, h3, h4').first().text().trim();
        const p = el$.find('.price, .num, [class*="price"]').first().text().trim();
        if (p) {
          name = name || n;
          price = parseFloat(p.replace(/[^0-9.]/g, '')) || 0;
        }
      });
    }

    // 시도 3: 네이버 증권 검색 API
    if (!price) {
      const apiUrl = `https://ac.finance.naver.com/ac?q=${encodeURIComponent(query)}&q_enc=UTF-8&target=stock,worldstock`;
      try {
        const { data: acData } = await axios.get(apiUrl, { headers: HEADERS, timeout: 5000 });
        if (acData && acData.items && acData.items[0] && acData.items[0][0]) {
          const item = acData.items[0][0];
          const itemName = item[0] || '';
          const itemCode = item[1] || '';
          if (itemCode) {
            return await fetchNaverFinance(itemCode, itemName);
          }
        }
      } catch (e) { console.warn('[get-stock] Naver 자동완성 조회 실패:', e); }
    }

    if (price && name) {
      const isKR = /^\d{6}$/.test(symbol);
      currency = isKR ? 'KRW' : 'USD';
      const fullSymbol = isKR ? symbol + '.KS' : symbol;
      return { success: true, name, symbol: fullSymbol || query, price, change, changeRate, currency };
    }

    return null;
  } catch (e: any) {
    console.error('[searchNaver] error:', e.message);
    return null;
  }
}

// 네이버 금융 종목 상세 페이지에서 현재가 가져오기
async function fetchNaverFinance(code: string, fallbackName: string): Promise<StockResult | null> {
  const isKR = /^\d{6}$/.test(code);
  const url = isKR
    ? `https://finance.naver.com/item/main.naver?code=${code}`
    : `https://finance.naver.com/world/sise.naver?symbol=${code}`;

  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 8000 });
    const $ = cheerio.load(data);

    let name = fallbackName || '';
    let price = 0;
    let change = '';
    let changeRate = '';

    if (isKR) {
      const nameEl = $('h2.h_nm').text().trim() || $('.wrap_company h2').text().trim();
      if (nameEl) name = nameEl;

      const priceEl = $('#_nowVal').text().trim() || $('.no_today .p1').first().text().trim();
      price = parseFloat(priceEl.replace(/[^0-9.]/g, '')) || 0;

      const diffEl = $('#_diff').text().trim() || $('.no_today .p2').first().text().trim();
      change = diffEl;
      const rateEl = $('#_rate').text().trim() || $('.no_today .p3').first().text().trim();
      changeRate = rateEl;

      return {
        success: true,
        name: name || fallbackName || code,
        symbol: code + '.KS',
        price,
        change,
        changeRate,
        currency: 'KRW',
      };
    } else {
      const nameEl = $('.wrap_company h2, .hd_info .h_nm').first().text().trim();
      if (nameEl) name = nameEl;
      const priceEl = $('.no_today .p1, #_nowVal').first().text().trim();
      price = parseFloat(priceEl.replace(/[^0-9.]/g, '')) || 0;

      return {
        success: true,
        name: name || fallbackName || code,
        symbol: code,
        price,
        change: '',
        changeRate: '',
        currency: 'USD',
      };
    }
  } catch (e: any) {
    console.error('[fetchNaverFinance] error:', e.message);
    return fallbackName ? { success: true, name: fallbackName, symbol: code, price: 0, currency: 'KRW' } : null;
  }
}

// 네이버 자동완성 API → 종목 코드 획득 후 상세 조회
async function searchByNaverAC(query: string): Promise<StockResult | null> {
  const url = `https://ac.finance.naver.com/ac?q=${encodeURIComponent(query)}&q_enc=UTF-8&target=stock,worldstock&_callback=`;
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 6000 });
    let json: any = data;
    if (typeof data === 'string') {
      const m = data.match(/\((.*)\)/s);
      if (m) { try { json = JSON.parse(m[1]); } catch(e) { json = null; } }
      else { try { json = JSON.parse(data); } catch(e) { json = null; } }
    }
    if (!json || !json.items) return null;

    const allItems: any[] = [...(json.items[0] || []), ...(json.items[1] || [])];
    if (!allItems.length) return null;

    const best = allItems[0];
    const code = best[1] || '';
    const itemName = best[0] || '';
    if (!code) return null;

    return await fetchNaverFinance(code, itemName);
  } catch (e: any) {
    console.error('[searchByNaverAC] error:', e.message);
    return null;
  }
}

// 미국 주식 네이버 검색
async function searchUSStock(ticker: string): Promise<StockResult | null> {
  const exchanges = ['NASDAQ', 'NYSE', 'AMEX'];
  for (const exch of exchanges) {
    try {
      const url = `https://finance.naver.com/world/sise.naver?symbol=${ticker}:${exch}`;
      const { data } = await axios.get(url, { headers: HEADERS, timeout: 6000 });
      const $ = cheerio.load(data);

      const name = $('h2.h_nm, .wrap_company h2').first().text().trim();
      const priceText = $('.today .num, #_nowVal, .no_today .p1').first().text().trim();
      const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;

      if (price > 0) {
        return {
          success: true,
          name: name || ticker,
          symbol: ticker,
          price,
          change: '',
          changeRate: '',
          currency: 'USD',
        };
      }
    } catch (e) { console.warn('[get-stock] 거래소 후보 조회 실패, 다음 후보 시도:', e); }
  }
  return null;
}

// Yahoo Finance 검색 API 폴백 — 티커/회사명으로 모든 종목 커버
// https://query2.finance.yahoo.com/v1/finance/search?q=<query>
async function searchYahoo(query: string): Promise<StockResult | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=5&newsCount=0`;
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': HEADERS['User-Agent'],
        'Accept': 'application/json',
      },
      timeout: 7000,
    });
    const quotes = data?.quotes || [];
    if (!quotes.length) return null;

    const queryUpper = query.toUpperCase();
    const US_EXCHANGES = new Set(['NMS','NYQ','PCX','NGM','BTS','NCM','ASE','AMEX','NASDAQ','NYSE']);

    // 점수 기반 우선순위: 정확한 티커 일치 > US 거래소 > EQUITY/ETF 여부
    const scored = quotes.map((q: any) => {
      const sym = String(q.symbol || '').toUpperCase();
      const exch = String(q.exchange || '').toUpperCase();
      let score = 0;
      if (sym === queryUpper) score += 100;          // 정확한 티커 매치
      if (US_EXCHANGES.has(exch)) score += 50;       // US 거래소 우선
      if (q.quoteType === 'ETF') score += 10;        // ETF
      if (q.quoteType === 'EQUITY') score += 8;      // 주식
      return { q, score };
    });
    scored.sort((a: any, b: any) => b.score - a.score);
    const hit = scored[0]?.q;
    if (!hit || !hit.symbol) return null;

    const symbol = String(hit.symbol).toUpperCase();
    const name = hit.shortname || hit.longname || symbol;
    const exchange = (hit.exchange || '').toUpperCase();
    const isKR = /\.(KS|KQ)$/i.test(symbol) || exchange === 'KSC' || exchange === 'KOE';
    const isJP = /\.T$/i.test(symbol) || exchange === 'JPX' || exchange === 'OSA' || exchange === 'TYO' || exchange === 'FKA' || exchange === 'SFX';
    const currency = isKR ? 'KRW' : (isJP ? 'JPY' : 'USD');

    // 가격은 chart API 로 최근 종가 조회
    let price = 0;
    try {
      const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
      const { data: cdata } = await axios.get(chartUrl, {
        headers: { 'User-Agent': HEADERS['User-Agent'] },
        timeout: 6000,
      });
      const res = cdata?.chart?.result?.[0];
      const closes = (res?.indicators?.quote?.[0]?.close || []).filter((v: any) => Number.isFinite(v));
      if (closes.length) price = Number(closes[closes.length - 1]) || 0;
      if (!price) price = Number(res?.meta?.regularMarketPrice) || 0;
    } catch (e) { console.warn('[get-stock] 차트 가격 조회 실패:', e); }

    return {
      success: true,
      name,
      symbol,
      price,
      change: '',
      changeRate: '',
      currency,
    };
  } catch (e: any) {
    console.error('[searchYahoo] error:', e.message);
    return null;
  }
}

// 일본 주식 Yahoo Finance 직접 조회 (4자리 코드 → .T 추가)
async function searchJapanStock(code: string): Promise<StockResult | null> {
  const symbol = /\.T$/i.test(code) ? code.toUpperCase() : `${code}.T`;
  try {
    let price = 0;
    let name = '';
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const { data: cdata } = await axios.get(chartUrl, {
      headers: { 'User-Agent': HEADERS['User-Agent'] },
      timeout: 7000,
    });
    const res = cdata?.chart?.result?.[0];
    const closes = (res?.indicators?.quote?.[0]?.close || []).filter((v: any) => Number.isFinite(v));
    if (closes.length) price = Number(closes[closes.length - 1]) || 0;
    if (!price) price = Number(res?.meta?.regularMarketPrice) || 0;
    name = res?.meta?.longName || res?.meta?.shortName || symbol;
    if (!price) return null;
    return { success: true, name, symbol, price, change: '', changeRate: '', currency: 'JPY' };
  } catch (e: any) {
    console.error('[searchJapanStock] error:', e.message);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers['authorization'];
  const expectedToken = process.env.AUTH_TOKEN;
  if (expectedToken && (!authHeader || authHeader !== `Bearer ${expectedToken}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 클라이언트는 query / q 둘 다 사용할 수 있음 (하위 호환)
  const query = (((req.query.q as string) || (req.query.query as string) || '').trim());
  if (!query) {
    return res.status(400).json({ success: false, error: '검색어를 입력하세요.' });
  }

  try {
    const hasKorean = /[가-힣]/.test(query);
    const isKrCode = /^\d{5,6}$/.test(query);
    const isJpCode = /^\d{4}$/.test(query) || /\.T$/i.test(query);

    // 0. 일본 주식 코드 (4자리 숫자 또는 .T 접미사)
    if (isJpCode) {
      const jpResult = await searchJapanStock(query);
      if (jpResult && jpResult.price > 0) return res.status(200).json(jpResult);
      // Yahoo 폴백 (일본 회사명 검색)
      const yhResult = await searchYahoo(query);
      if (yhResult && yhResult.price > 0) return res.status(200).json(yhResult);
      return res.status(404).json({ success: false, error: `일본 종목 ${query}을(를) 찾을 수 없습니다.` });
    }

    // 1. 6자리 국내 종목코드
    if (isKrCode) {
      const result = await fetchNaverFinance(query.padStart(6, '0'), '');
      if (result && result.price > 0) return res.status(200).json(result);
      // Yahoo 폴백
      const yhResult = await searchYahoo(query);
      if (yhResult && yhResult.price > 0) return res.status(200).json(yhResult);
      return res.status(404).json({ success: false, error: `종목코드 ${query}을(를) 찾을 수 없습니다.` });
    }

    // 2. 한글 종목명 → 네이버 자동완성 API 우선
    if (hasKorean) {
      const acResult = await searchByNaverAC(query);
      if (acResult && acResult.price > 0) return res.status(200).json(acResult);

      const searchResult = await searchNaver(query);
      if (searchResult && searchResult.price > 0) return res.status(200).json(searchResult);

      return res.status(404).json({
        success: false,
        error: `"${query}" 검색 결과가 없습니다. 종목코드(6자리)나 영문 티커로 다시 시도해보세요.`,
      });
    }

    // 3. 영문 티커/회사명 → .T 접미사이면 일본 주식 직접 조회
    if (/\.T$/i.test(query)) {
      const jpResult = await searchJapanStock(query);
      if (jpResult && jpResult.price > 0) return res.status(200).json(jpResult);
    }

    // 3b. Yahoo Finance 검색 (US 및 기타 글로벌 종목 커버)
    // price=0이어도 심볼이 유효하면 반환 (레버리지 ETF 등 일시적 가격 조회 실패 허용)
    const yhResult = await searchYahoo(query);
    if (yhResult && yhResult.success) return res.status(200).json(yhResult);

    // 3c. 네이버 미국 주식 (백업)
    const upperQ = query.toUpperCase();
    const usResult = await searchUSStock(upperQ);
    if (usResult && usResult.price > 0) return res.status(200).json(usResult);

    // 4. 국내 ETF일 수 있음 → 네이버 AC
    const acResult2 = await searchByNaverAC(query);
    if (acResult2 && acResult2.price > 0) return res.status(200).json(acResult2);

    return res.status(404).json({
      success: false,
      error: `"${query}" 검색 결과가 없습니다. 정확한 티커 심볼이나 종목코드로 다시 시도해보세요.`,
    });

  } catch (error: any) {
    console.error('[get-stock] Error:', error.message);
    return res.status(500).json({
      success: false,
      error: '검색 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    });
  }
}
