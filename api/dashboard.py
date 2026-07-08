"""
api/dashboard.py
Python 하이브리드 백엔드 – Vercel Serverless Function
라이브러리: yfinance, pykrx, pandas
모든 조회 실패 시 '미조회' 반환
"""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import datetime
import re
import traceback
import os
from collections import Counter

UNAVAILABLE = '미조회'

# ── 라이브러리 임포트 (graceful fallback) ──────────────────────
# [중요] 로컬 환경에서 아래 라이브러리가 없을 경우 'pip install yfinance pykrx pandas' 실행 필요
try:
    import yfinance as yf # type: ignore
    YF_OK = True
except (ImportError, Exception):
    YF_OK = False

try:
    from pykrx import stock as krx # type: ignore
    PYKRX_OK = True
except (ImportError, Exception):
    PYKRX_OK = False

try:
    import pandas as pd # type: ignore
    PD_OK = True
except (ImportError, Exception):
    PD_OK = False

# ── 국내 전 종목 리스트 캐시 (메모리 절약형) ──────────────────
_KR_TICKER_CACHE = {} # { "종목명": "티커" }
_KR_CACHE_TIME = None

def _update_kr_ticker_cache():
    global _KR_TICKER_CACHE, _KR_CACHE_TIME
    if not PYKRX_OK: return
    try:
        now = datetime.datetime.now()
        if _KR_CACHE_TIME and (now - _KR_CACHE_TIME).total_seconds() < 3600*12:
            return # 12시간 이내면 캐시 사용
        
        d = prev_biz_day_str()
        new_cache = {}
        # 주식 & ETF 통합 검색을 위해 여러 시장 조회
        for mkt in ["KOSPI", "KOSDAQ", "KONEX"]:
            tickers = krx.get_market_ticker_list(d, market=mkt)
            for t in tickers:
                name = krx.get_market_ticker_name(t)
                if name: new_cache[name.replace(" ","").upper()] = t
                
        # ETF 리스트 추가
        try:
            etf_df = krx.get_etf_ticker_list(d)
            for t in etf_df:
                name = krx.get_etf_ticker_name(t)
                if name: new_cache[name.replace(" ","").upper()] = t
        except Exception as e:
            print('[dashboard.py] ETF 티커 캐시 갱신 실패:', e)

        if new_cache:
            _KR_TICKER_CACHE = new_cache
            _KR_CACHE_TIME = now
    except Exception as e:
        print("[Cache Update Error]", e)

def resolve_kr_ticker(name):
    if not name: return None
    _update_kr_ticker_cache()
    # 1. 완전 일치 (공백 제거)
    clean_name = name.replace(" ","").upper()
    if clean_name in _KR_TICKER_CACHE:
        return _KR_TICKER_CACHE[clean_name]
    # 2. 부분 일치 (필요 시 확장)
    for k, v in _KR_TICKER_CACHE.items():
        if clean_name in k or k in clean_name:
            return v
    return None


# ── 헬퍼: 직전 영업일 ────────────────────────────────────────────
def prev_biz_day_str():
    d = datetime.date.today()
    # 오늘이 주말이면 금요일로
    while d.weekday() >= 5:
        d -= datetime.timedelta(days=1)
    # 하루 더 뒤로 (전일 종가)
    d -= datetime.timedelta(days=1)
    while d.weekday() >= 5:
        d -= datetime.timedelta(days=1)
    return d.strftime('%Y%m%d')


def safe_last_close(ticker_yf, period='5d'):
    """yfinance 티커에서 마지막 종가 반환, 실패 시 None"""
    try:
        if not YF_OK:
            return None
        h = yf.Ticker(ticker_yf).history(period=period)
        if h is None or h.empty:
            return None
        closes = h['Close'].dropna()
        return float(closes.iloc[-1]) if len(closes) > 0 else None
    except Exception:
        return None


def safe_history(ticker_yf, period='1y'):
    try:
        if not YF_OK:
            return None
        h = yf.Ticker(ticker_yf).history(period=period)
        return h if h is not None and not h.empty else None
    except Exception:
        return None


# ── 1. 환율 ─────────────────────────────────────────────────────
def get_rates():
    r = {'usd_krw': UNAVAILABLE, 'usd_jpy': UNAVAILABLE, 'jpy100_krw': UNAVAILABLE}

    # USD/KRW
    v = safe_last_close('KRW=X')
    if v:
        r['usd_krw'] = round(v, 2)

    # USD/JPY
    v = safe_last_close('JPY=X')
    if v:
        r['usd_jpy'] = round(v, 2)

    # JPY100/KRW (계산)
    u = r.get('usd_krw')
    j = r.get('usd_jpy')
    if isinstance(u, (int, float)) and isinstance(j, (int, float)) and j > 0:
        r['jpy100_krw'] = round(u / j * 100, 2)

    return {'success': True, 'rates': r}


# ── 2. 금 시세 ──────────────────────────────────────────────────
def get_gold(unit='g'):
    """
    한국 금거래소 기준가 = 국제 금 시세(USD/oz) × USD/KRW ÷ 31.1035
    단위: g / 돈(3.75g) / kg(1000g)
    """
    info = {'price': UNAVAILABLE, 'unit': unit,
            'price_per_g': UNAVAILABLE, 'source': 'yfinance GC=F + KRW=X'}

    gold_usd_oz = safe_last_close('GC=F')   # COMEX 금 선물 (USD/oz)
    usd_krw = safe_last_close('KRW=X')

    if gold_usd_oz and usd_krw:
        ppg = gold_usd_oz * usd_krw / 31.1035   # KRW per gram
        info['price_per_g'] = round(ppg)
        if unit == '돈':
            info['price'] = round(ppg * 3.75)    # 1돈 = 3.75g
        elif unit == 'kg':
            info['price'] = round(ppg * 1000)    # 1kg = 1000g
        else:
            info['price'] = round(ppg)            # g
    else:
        if gold_usd_oz:
            info['gold_usd_oz'] = round(gold_usd_oz, 2)
        info['error'] = 'USD/KRW 또는 금 시세 조회 실패'

    return {'success': True, 'gold': info}


# ── 3. 자산 종가 (한국주식 / 미국주식 / 암호화폐) ──────────────
CRYPTO_TICKERS = {
    'BTC', 'ETH', 'XRP', 'SOL', 'BNB', 'DOGE', 'ADA', 'AVAX',
    'MATIC', 'DOT', 'LINK', 'UNI', 'ATOM', 'LTC', 'TRX'
}

def get_prices(tickers):
    result = {}
    for tkr in tickers:
        tkr = tkr.strip()
        if not tkr:
            continue
        try:
            # 티커가 숫자가 아닌 긴 이름인 경우 해결 시도
            if len(tkr) > 10 and not tkr.isdigit():
                resolved = resolve_kr_ticker(tkr)
                if resolved:
                    tkr = resolved
            
            is_kr = tkr.isdigit() and len(tkr) == 6
            is_crypto = tkr.upper() in CRYPTO_TICKERS

            if is_kr:
                # 한국 주식 – pykrx 우선, yfinance fallback
                price = UNAVAILABLE
                if PYKRX_OK:
                    try:
                        d = prev_biz_day_str()
                        df = krx.get_market_ohlcv_by_date(d, d, tkr)
                        if not df.empty:
                            price = int(df['종가'].iloc[-1])
                    except Exception:
                        pass
                if price == UNAVAILABLE:
                    v = safe_last_close(tkr + '.KS')
                    if v:
                        price = round(v)
                    else:
                        v2 = safe_last_close(tkr + '.KQ')
                        if v2:
                            price = round(v2)
                result[tkr] = {'price': price, 'cur': 'KRW'}

            elif is_crypto:
                price = safe_last_close(tkr + '-USD')
                result[tkr] = {
                    'price': round(price, 4) if price else UNAVAILABLE,
                    'cur': 'USD'
                }

            else:
                # 미국 주식
                price = safe_last_close(tkr)
                result[tkr] = {
                    'price': round(price, 4) if price else UNAVAILABLE,
                    'cur': 'USD'
                }

        except Exception as e:
            result[tkr] = {'price': UNAVAILABLE, 'error': str(e)}

    return {'success': True, 'result': result}


# ── 4. 배당 정보 ────────────────────────────────────────────────
def get_dividends(tickers):
    result = {}
    for tkr in tickers:
        tkr = tkr.strip()
        if not tkr:
            continue
        try:
            # KRX 단축코드는 숫자 6자리 또는 알파뉴메릭 6자리 (예: 0117V0, 00104K)
            t_up = tkr.upper()
            is_kr = len(t_up) == 6 and all(c.isdigit() or ('A' <= c <= 'Z') for c in t_up)

            if is_kr:
                if PYKRX_OK:
                    try:
                        d = prev_biz_day_str()
                        # 1) 배당수익률 & 현재가 → 연간 DPS 추정
                        df_f = krx.get_market_fundamental(d, d, tkr)
                        yld = 0.0
                        if not df_f.empty and 'DIV' in df_f.columns:
                            yld = float(df_f['DIV'].iloc[-1])
                        df_p = krx.get_market_ohlcv_by_date(d, d, tkr)
                        price = float(df_p['종가'].iloc[-1]) if not df_p.empty else 0
                        annual_dps = round(price * yld / 100) if yld > 0 and price > 0 else 0

                        # 2) 최근 2년 배당 이력 → cycle 및 months 도출
                        #    pykrx.stock.get_index_fundamental 에는 dividend 가 없으므로
                        #    get_market_ohlcv_by_date 로는 확인 불가. 대신 개별 배당 이력은
                        #    krx.get_index_price_deposit / stock_index_dividend 로도 제공되지 않음.
                        #    → yfinance .KS/.KQ 티커를 보조 수단으로 사용해 월별 지급 이력 확보.
                        cycle = '-'
                        months = []
                        pay_day_kr = None
                        if YF_OK:
                            try:
                                for suf in ('.KS', '.KQ'):
                                    ytkr = f'{tkr}{suf}'
                                    yt = yf.Ticker(ytkr)
                                    divs = yt.dividends
                                    if divs is not None and not divs.empty:
                                        recent = divs[divs.index >= (datetime.datetime.now() - datetime.timedelta(days=400))]
                                        if not recent.empty:
                                            ms = sorted({int(d.month)-1 for d in recent.index})
                                            months = ms[:12]
                                            if len(ms) >= 10: cycle = '월배당'
                                            elif len(ms) >= 3: cycle = '분기'
                                            elif len(ms) == 2: cycle = '반기'
                                            elif len(ms) == 1: cycle = '연간'
                                            # yfinance에서 annual_dps 재확인 (pykrx DIV 부재 시)
                                            if annual_dps == 0:
                                                annual_dps = round(float(recent.sum()))
                                                if price > 0 and annual_dps > 0:
                                                    yld = round(annual_dps/price*100, 2)
                                            # 최빈 지급일(day-of-month)
                                            pay_days_kr = [d.day for d in recent.index]
                                            if pay_days_kr:
                                                pay_day_kr = int(Counter(pay_days_kr).most_common(1)[0][0])
                                            break
                            except Exception:
                                pass
                        # cycle 미상이면 연간으로 가정 (한국 주식 관행: 연 1회 기말배당)
                        if cycle == '-' and annual_dps > 0:
                            cycle = '연간'
                            months = [11]   # 12월 기말 가정

                        if annual_dps > 0 or yld > 0:
                            result[tkr] = {
                                'dps': annual_dps,
                                'yld': round(yld, 2),
                                'cycle': cycle,
                                'months': months,
                                'cur': 'KRW',
                                'payDay': pay_day_kr
                            }
                            continue
                    except Exception:
                        pass
                result[tkr] = {'dps': UNAVAILABLE, 'yld': UNAVAILABLE, 'cycle': '-', 'months': [], 'cur': 'KRW'}

            else:
                if YF_OK:
                    try:
                        t = yf.Ticker(tkr)
                        info = t.fast_info
                        div_yield = getattr(info, 'dividend_yield', None) or 0
                        divs = t.dividends
                        dps = 0.0
                        months = []
                        cycle = '-'
                        pay_day_us = None
                        if divs is not None and not divs.empty:
                            recent = divs[divs.index >= (datetime.datetime.now() - datetime.timedelta(days=400))]
                            if not recent.empty:
                                dps = round(float(recent.sum()), 4)
                                ms = sorted({int(d.month)-1 for d in recent.index})
                                months = ms[:12]
                                if len(ms) >= 10: cycle = '월배당'
                                elif len(ms) >= 3: cycle = '분기'
                                elif len(ms) == 2: cycle = '반기'
                                elif len(ms) == 1: cycle = '연간'
                                pay_days_us = [d.day for d in recent.index]
                                if pay_days_us:
                                    pay_day_us = int(Counter(pay_days_us).most_common(1)[0][0])
                        result[tkr] = {
                            'dps': dps,
                            'yld': round(float(div_yield) * 100, 2),
                            'cycle': cycle,
                            'months': months,
                            'cur': 'USD',
                            'payDay': pay_day_us
                        }
                        continue
                    except Exception:
                        pass
                result[tkr] = {'dps': UNAVAILABLE, 'yld': UNAVAILABLE, 'cycle': '-', 'months': [], 'cur': 'USD'}

        except Exception as e:
            result[tkr] = {'dps': UNAVAILABLE, 'error': str(e)}

    return {'success': True, 'result': result}


# ── 5. ETF 구성종목 (룩스루) ────────────────────────────────────
def _is_kr_code(t):
    return len(t) == 6 and all(c.isdigit() or ('A' <= c <= 'Z') for c in t)

def _parse_krx_pdf(df):
    """pykrx PDF DataFrame → [{'tkr','name','weight'}]. 실패/빈 프레임은 []."""
    out = []
    if df is None or df.empty:
        return out
    total_amt = 0.0
    if '금액' in df.columns:
        try:
            total_amt = float(df['금액'].sum())
        except Exception:
            total_amt = 0.0
    for code, row in df.iterrows():
        code_s = str(code).strip().upper()
        if not _is_kr_code(code_s):
            continue  # 원화현금·선물 등 비종목 행 제외
        w = None
        if '비중' in df.columns:
            try:
                v = float(row['비중'])
                if v == v and v > 0:  # NaN 방지
                    w = v
            except Exception:
                pass
        if w is None and total_amt > 0 and '금액' in df.columns:
            try:
                w = float(row['금액']) / total_amt * 100
            except Exception:
                pass
        if w is None or w <= 0:
            continue
        name = None
        try:
            name = krx.get_market_ticker_name(code_s)
        except Exception:
            pass
        out.append({'tkr': code_s, 'name': name if isinstance(name, str) and name else code_s,
                    'weight': round(w, 2)})
    return out


def _yf_top_holdings(sym):
    """yfinance funds_data.top_holdings → [{'tkr','name','weight'}]. 해외 ETF + KR ETF(.KS/.KQ) 폴백용."""
    if not YF_OK or not sym:
        return []
    try:
        fd = yf.Ticker(sym).funds_data
        th = fd.top_holdings if fd is not None else None
    except Exception as e:
        print('[etf_holdings yfinance]', sym, e)
        return []
    if th is None or th.empty:
        return []
    wcol = 'Holding Percent' if 'Holding Percent' in th.columns else None
    raw = []
    for s, row in th.iterrows():
        try:
            w = float(row[wcol]) if wcol else None
        except Exception:
            w = None
        if w is None or w != w or w <= 0:
            continue
        nm = row.get('Name') if hasattr(row, 'get') else None
        raw.append((str(s).strip().upper(), str(nm) if nm else str(s), w))
    if not raw:
        return []
    scale = 100 if max(r[2] for r in raw) <= 1.5 else 1  # 소수(0.31)면 %로 환산
    return [{'tkr': s, 'name': n, 'weight': round(w * scale, 2)} for s, n, w in raw]


def get_etf_holdings(tkr):
    """ETF 구성종목과 비중(%) 반환 — KR ETF는 pykrx PDF(최근 영업일 재시도), 해외/폴백은 yfinance funds_data.
    응답: {'success': bool, 'tkr': ..., 'holdings': [{'tkr','name','weight'}], 'source': ...}
    비중은 % 단위(0~100). 현금 등 비종목 행은 제외한다."""
    t_up = (tkr or '').strip().upper().replace('.KS', '').replace('.KQ', '')
    if not t_up:
        return {'success': False, 'error': 'ticker required', 'holdings': []}
    holdings = []
    source = None
    is_kr = _is_kr_code(t_up)

    # 1) 국내 상장 ETF → pykrx PDF. 최신 일자 미발행/휴장 대비 최근 영업일들로 재시도.
    if is_kr and PYKRX_OK:
        dates = [None]  # None = pykrx가 자동으로 최근 영업일 선택
        try:
            d = datetime.date.today()
            for _ in range(7):
                d -= datetime.timedelta(days=1)
                if d.weekday() < 5:
                    dates.append(d.strftime('%Y%m%d'))
        except Exception:
            pass
        for dt in dates:
            try:
                df = krx.get_etf_portfolio_deposit_file(t_up) if dt is None \
                    else krx.get_etf_portfolio_deposit_file(t_up, dt)
                parsed = _parse_krx_pdf(df)
                if parsed:
                    holdings = parsed
                    source = 'pykrx'
                    break
            except Exception as e:
                print('[etf_holdings pykrx]', t_up, dt, e)

    # 2) 해외 ETF, 또는 국내 ETF가 pykrx로 안 잡힐 때 → yfinance funds_data 폴백
    if not holdings and YF_OK:
        if is_kr:
            for suf in ('.KS', '.KQ'):
                holdings = _yf_top_holdings(t_up + suf)
                if holdings:
                    source = 'yfinance'
                    break
        else:
            holdings = _yf_top_holdings(t_up)
            if holdings:
                source = 'yfinance'

    return {'success': bool(holdings), 'tkr': t_up, 'holdings': holdings, 'source': source}


# ── 6. 헬스체크 ─────────────────────────────────────────────────
def get_health():
    return {
        'success': True,
        'python': True,
        'libs': {
            'yfinance': YF_OK,
            'pykrx': PYKRX_OK,
            'pandas': PD_OK
        }
    }


# ── 7. 벤치마크 실제 데이터 (S&P500, KOSPI 기간별 수익률) ─────
def get_benchmark(p_tkrs=None, p_weights=None):
    """S&P 500, KOSPI(KODEX 200), and Portfolio 기간별(5D,1M,3M,6M,YTD,1Y) 시계열 반환"""
    result = {}
    unresolved = []  # 어떤 컬럼에도 해석되지 않은 보유 티커(라인 누락 진단용)
    
    tkrs_list = []
    weights_list = []
    if p_tkrs and p_weights:
        tkrs_list = [t for t in p_tkrs.split(',') if t]
        try:
            weights_list = [float(w) for w in p_weights.split(',') if w]
        except Exception:
            weights_list = []

    # 매칭 보정 (길이가 다르면 portfolio 계산 포기)
    if len(tkrs_list) != len(weights_list):
        tkrs_list = []
        weights_list = []

    if not YF_OK:
        return {'success': False, 'benchmark': {}}

    # KR 6자리 코드(.KS/.KQ)는 시장 구분이 잘못 저장될 수 있어(예: KOSDAQ을 .KS로 전달).
    # 두 접미사를 모두 내려받아 살아남는 쪽으로 해석한다. get_prices의 .KS→.KQ 폴백과 동일 의도.
    def _kr_base(sym):
        m = re.match(r'^([0-9A-Z]{6})\.(KS|KQ)$', sym)
        return m.group(1) if m else None

    def _resolve_col(tkr, cols):
        if tkr in cols:
            return tkr
        base = _kr_base(tkr)
        if base:
            for suf in ('.KS', '.KQ', '.KR'):  # .KR = pykrx 폴백으로 보완한 합성 컬럼
                if base + suf in cols:
                    return base + suf
        return None

    # S&P 500 index (^GSPC) + KOSPI index (^KS11) — 실제 지수 사용.
    # KR 종목은 .KS/.KQ 두 변형을 모두 내려받는다(잘못된 접미사는 NaN → drop_cols가 제거).
    all_symbols = ['^GSPC', '^KS11']
    for _t in tkrs_list:
        _base = _kr_base(_t)
        if _base:
            all_symbols += [_base + '.KS', _base + '.KQ']
        else:
            all_symbols.append(_t)
    all_symbols = list(dict.fromkeys(all_symbols))  # 순서 보존 중복 제거

    try:
        df_all = yf.download(all_symbols, period='1y', group_by='ticker', auto_adjust=True, progress=False)

        close_df = pd.DataFrame()
        for sym in all_symbols:
            if len(all_symbols) == 1:
                if 'Close' in df_all: close_df[sym] = df_all['Close']
            else:
                if sym in df_all and 'Close' in df_all[sym]:
                    close_df[sym] = df_all[sym]['Close']

        # 라벨/날짜 샘플링이 소유주 종목(365일 거래되는 코인 등)에 좌우되지 않도록
        # 지수(^GSPC/^KS11)가 실제 거래한 날의 행만 남긴다 (주말·코인 전용일 제거)
        idx_present = [c for c in ['^GSPC', '^KS11'] if c in close_df.columns]
        if idx_present:
            close_df = close_df[close_df[idx_present].notna().any(axis=1)]

        close_df.ffill(inplace=True)
        # 다운로드 실패·이력 부족 종목 컬럼 제거 — 한 종목의 NaN이 dropna로
        # 전체 행을 삭제하는 것을 방지 (지수 ^GSPC/^KS11 은 유지)
        idx_syms = ['^GSPC', '^KS11']
        drop_cols = [c for c in close_df.columns
                     if c not in idx_syms and close_df[c].isna().any()]
        if drop_cols:
            close_df.drop(columns=drop_cols, inplace=True)
        close_df.dropna(inplace=True)

        if close_df.empty:
            return {'success': False, 'benchmark': {}}

        # 오늘(intraday) 제외 — 종가가 확정되지 않은 당일 bar 제거
        today_date = datetime.datetime.now().date()
        close_df = close_df[close_df.index.date < today_date]
        if close_df.empty or len(close_df) < 2:
            return {'success': False, 'benchmark': {}}

        # 국내 종목/ETF는 yfinance 커버리지가 불안정(특히 국내 ETF) → yfinance로 못 받은 KR 코드는
        # pykrx 과거시세로 보완한다(주식: get_market_ohlcv_by_date, ETF: get_etf_ohlcv_by_date).
        # get_prices의 pykrx 우선 패턴을 시계열로 확장. 실패 시 기존 동작으로 안전 강등.
        if PYKRX_OK and tkrs_list:
            kr_missing = []
            for t in tkrs_list:
                base = _kr_base(t)
                if base and _resolve_col(t, close_df.columns) is None:
                    kr_missing.append(base)
            kr_missing = list(dict.fromkeys(kr_missing))
            if kr_missing:
                start_s = close_df.index[0].strftime('%Y%m%d')
                end_s = close_df.index[-1].strftime('%Y%m%d')
                for base in kr_missing:
                    try:
                        ser = None
                        for _fetch in (krx.get_market_ohlcv_by_date, krx.get_etf_ohlcv_by_date):
                            try:
                                dfk = _fetch(start_s, end_s, base)
                            except Exception:
                                dfk = None
                            if dfk is not None and not dfk.empty and '종가' in dfk.columns:
                                s = dfk['종가']
                                s = s[s > 0]
                                if not s.empty:
                                    ser = s
                                    break
                        if ser is not None:
                            close_df[base + '.KR'] = ser.reindex(close_df.index).ffill()
                    except Exception as e:
                        print('[Benchmark pykrx fallback]', base, e)

        # 진단: 끝까지 어떤 컬럼에도 해석되지 않은 보유 티커 수집(라인 누락 원인 노출)
        if tkrs_list:
            unresolved = [t for t in tkrs_list if _resolve_col(t, close_df.columns) is None]
            if unresolved:
                print('[Benchmark] 해석 실패 티커:', unresolved)

        last_dt = close_df.index[-1]
        
        # YTD 보정
        this_year_start = datetime.datetime(last_dt.year, 1, 1)
        ytd_base_candidates = close_df.index[close_df.index < pd.Timestamp(this_year_start)]
        ytd_base_dt = ytd_base_candidates[-1] if not ytd_base_candidates.empty else close_df.index[0]

        periods_dates = {
            '5D': last_dt - datetime.timedelta(days=7),
            '1M': last_dt - datetime.timedelta(days=30),
            '3M': last_dt - datetime.timedelta(days=90),
            '6M': last_dt - datetime.timedelta(days=180),
            'YTD': ytd_base_dt,
            '1Y': close_df.index[0]
        }

        for period_key, start_dt in periods_dates.items():
            period_df = close_df[close_df.index >= pd.Timestamp(start_dt)]
            if len(period_df) < 2: continue
                
            n = len(period_df)
            step = max(1, n // 6)
            indices = list(range(0, n, step))
            if indices[-1] != n - 1: indices.append(n - 1)
                
            # 포트폴리오: 구간당 1회 (생존 컬럼, 가중치, base) 해석 — 인덱스마다 재탐색 방지.
            # KOSDAQ은 .KQ, yfinance 미수록 KR은 pykrx(.KR) 컬럼으로 폴백한다.
            # base는 구간 첫 유효값(non-NaN & >0) — pykrx 보완 컬럼의 선두 NaN/최근 상장도 안전 처리.
            resolved = []
            if tkrs_list and weights_list:
                for tkr, weight in zip(tkrs_list, weights_list):
                    col = _resolve_col(tkr, period_df.columns)
                    if col is not None:
                        valid = period_df[col].dropna()
                        valid = valid[valid > 0]
                        if not valid.empty:
                            resolved.append((col, weight, float(valid.iloc[0])))

            labels, sp_data, kospi_data, portfolio_data = [], [], [], []

            for idx in indices:
                dt = period_df.index[idx]
                labels.append(dt.strftime('%m/%d'))

                if '^GSPC' in period_df.columns:
                    base_sp = period_df['^GSPC'].iloc[0]
                    val_sp = period_df['^GSPC'].iloc[idx]
                    sp_data.append(round((val_sp / base_sp - 1) * 100, 2) if base_sp else 0)
                else: sp_data.append(0)

                if '^KS11' in period_df.columns:
                    base_kp = period_df['^KS11'].iloc[0]
                    val_kp = period_df['^KS11'].iloc[idx]
                    kospi_data.append(round((val_kp / base_kp - 1) * 100, 2) if base_kp else 0)
                else: kospi_data.append(0)

                # 해석된 종목이 하나도 없으면 portfolio를 빈 배열로 둬(가짜 0% 방지)
                # 프론트가 해당 소유주 라인을 생략하게 한다.
                if resolved:
                    total_base_val = 0
                    total_cur_val = 0
                    for col, weight, base in resolved:
                        v_p = period_df[col].iloc[idx]
                        if pd.notna(v_p) and base > 0:
                            total_base_val += weight
                            total_cur_val += weight * (v_p / base)
                    portfolio_data.append(round((total_cur_val / total_base_val - 1) * 100, 2) if total_base_val > 0 else 0)

            result[period_key] = {
                'labels': labels,
                'sp500': sp_data,
                'kospi': kospi_data,
                'portfolio': portfolio_data
            }

    except Exception as e:
        print("[Benchmark Error]", e)

    return {'success': True, 'benchmark': result, 'unresolved': unresolved}


# ── 8. 뉴스 (Google News RSS) ──────────────────
# ── 종목별 펀더멘털 (PER / PBR / ROE / 성장률 / 1Y·3Y 수익률 / 목표가) ─────
# Portfolio Advisor 용 — yfinance Ticker.info + 3년 history 한 번 호출.
# 필드별 try/except, 실패 시 None. 배치 호출은 직렬 (yfinance rate-limit 보호).
_FUND_FIELDS = ['trailingPE', 'priceToBook', 'dividendYield', 'returnOnEquity',
                'revenueGrowth', 'earningsGrowth', 'targetMeanPrice', 'currentPrice']

def _get_one_fundamental(sym):
    out = {k: None for k in _FUND_FIELDS}
    out['return1y'] = None
    out['return3y'] = None
    if not YF_OK or not sym:
        return out
    try:
        t = yf.Ticker(sym)
    except Exception:
        return out
    # Ticker.info — 일부 필드는 None 또는 NaN 가능, 필드별 try
    try:
        info = t.info or {}
    except Exception:
        info = {}
    for k in _FUND_FIELDS:
        try:
            v = info.get(k)
            if v is None:
                continue
            if isinstance(v, (int, float)):
                if v != v or v == float('inf') or v == float('-inf'):  # NaN/inf
                    continue
                out[k] = float(v)
            else:
                # 가끔 문자열로 오는 경우 float 변환 시도
                try:
                    out[k] = float(v)
                except Exception:
                    pass
        except Exception:
            pass
    # 3년 history → 1Y/3Y 수익률 (한 번 호출)
    try:
        h = t.history(period='3y')
        if h is not None and not h.empty:
            closes = h['Close'].dropna()
            if len(closes) >= 2:
                last = float(closes.iloc[-1])
                first = float(closes.iloc[0])
                if first > 0:
                    out['return3y'] = last / first - 1
                # 1Y: 마지막 ~252거래일 전
                if len(closes) > 252:
                    one_y_ago = float(closes.iloc[-252])
                    if one_y_ago > 0:
                        out['return1y'] = last / one_y_ago - 1
                else:
                    # 1년치 데이터 부족 — 전체 기간 환산 (252거래일 가정)
                    if first > 0:
                        out['return1y'] = (last / first) ** (252 / max(1, len(closes) - 1)) - 1
            # currentPrice 보조 (info에 없을 때)
            if out['currentPrice'] is None and len(closes) > 0:
                out['currentPrice'] = float(closes.iloc[-1])
    except Exception:
        pass
    return out


def get_fundamentals(tickers):
    """배치 펀더멘털 조회 — 직렬, 청크 길이는 호출자 측에서 제한."""
    data = {}
    for raw in (tickers or []):
        sym = (raw or '').strip()
        if not sym:
            continue
        try:
            data[sym] = _get_one_fundamental(sym)
        except Exception:
            data[sym] = {k: None for k in (_FUND_FIELDS + ['return1y', 'return3y'])}
    return {'success': True, 'data': data}


# ── Vercel Python Serverless Handler ───────────────────────────
class handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): pass

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        auth_header = self.headers.get('Authorization', '')
        expected_token = os.environ.get('AUTH_TOKEN', '')
        if expected_token and auth_header != f'Bearer {expected_token}':
            self._send_json({'error': 'Unauthorized'}, 401)
            return

        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        qtype  = params.get('type', [''])[0]
        try:
            if qtype == 'rates': data = get_rates()
            elif qtype == 'gold': data = get_gold(params.get('unit', ['g'])[0])
            elif qtype == 'price': data = get_prices([t.strip() for t in params.get('tickers', [''])[0].split(',') if t.strip()])
            elif qtype == 'dividend': data = get_dividends([t.strip() for t in params.get('tickers', [''])[0].split(',') if t.strip()])
            elif qtype == 'health': data = get_health()
            elif qtype == 'benchmark': data = get_benchmark(params.get('p_tkrs',[''])[0], params.get('p_weights',[''])[0])
            elif qtype == 'fundamentals':
                single = params.get('ticker', [''])[0].strip()
                batch_raw = params.get('tickers', [''])[0]
                tlist = [t.strip() for t in batch_raw.split(',') if t.strip()] if batch_raw else ([single] if single else [])
                tlist = tlist[:8]  # 30s maxDuration 보호 — 최대 8개
                data = get_fundamentals(tlist)
            elif qtype == 'etf_holdings':
                data = get_etf_holdings(params.get('tkr', [''])[0])
            elif qtype == 'resolve':
                name = params.get('name', [''])[0]
                data = {'success': True, 'name': name, 'code': resolve_kr_ticker(name)}
            else: data = {'success': False, 'error': 'Invalid type'}
        except Exception as e:
            # 스택트레이스는 서버 로그로만 남기고 클라이언트 응답에는 포함하지 않음(내부 경로/구현 노출 방지)
            print('[dashboard.py] handler error:\n' + traceback.format_exc())
            data = {'success': False, 'error': str(e)}
        self._send_json(data)
