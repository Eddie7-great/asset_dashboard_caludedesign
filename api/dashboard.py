"""
api/dashboard.py
Python 하이브리드 백엔드 – Vercel Serverless Function
라이브러리: yfinance, pykrx, pandas
모든 조회 실패 시 '미조회' 반환
"""
from http.server import BaseHTTPRequestHandler
from http.cookies import SimpleCookie
from urllib.parse import urlparse, parse_qs
import base64
import hashlib
import hmac
import json
import datetime
import math
import re
import traceback
import os
import time
from collections import Counter

UNAVAILABLE = '미조회'
SESSION_COOKIE = 'asset_dashboard_session'
SESSION_TTL_SECONDS = 8 * 60 * 60
MAX_TICKERS = 25
# 배당(type=dividend) 요청당 상한. script.js 의 PY_DIVIDEND_TICKER_LIMIT 과 같아야 한다 —
# 클라이언트가 더 크게 묶으면 요청 전체가 too_many_tickers 로 거부된다. 올려서 해결하지 않는다.
MAX_DIVIDEND_TICKERS = 20
MAX_QUERY_LENGTH = 2048
TICKER_PATTERN = re.compile(r'^[A-Z0-9.^=_-]{1,24}$')
ALLOWED_TYPES = {'rates', 'gold', 'price', 'dividend', 'health', 'benchmark', 'resolve', 'etf_holdings'}


def get_live_etf(code):
    # Shared parsers, bounded HTTP sources only: no KRX retries or browser tier here.
    import sys
    source_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts')
    if source_dir not in sys.path:
        sys.path.insert(0, source_dir)
    import collect_etf_holdings as source
    if not re.fullmatch(r'[A-Z0-9][A-Z0-9.\-]{0,15}', code):
        raise ValueError('invalid_etf')
    attempts = []
    started = time.monotonic()
    # 운용사/거래소 경로는 전체 바스켓을 주는 출처다. stockanalysis 만 응답이
    # 전체 개수를 밝힐 때 참이 되므로, 기본값을 True 로 두고 그 분기에서만 덮어쓴다.
    full = True
    if source.is_kr_code(code):
        rows, as_of = source.fetch_funetf(code)
        provider = 'FunETF'
        attempts.append({'source': provider, 'ok': bool(rows)})
        if not rows and code in source.TIME_PRODUCT_IDS and time.monotonic() - started < 30:
            rows, as_of = source.fetch_time(code)
            provider = 'provider:TIME'
            attempts.append({'source': provider, 'ok': bool(rows)})
        if not rows and time.monotonic() - started < 30:
            rows, _, as_of = source.fetch_zeroin(code, max_attempts=1)
            provider = 'zeroin'
            attempts.append({'source': provider, 'ok': bool(rows)})
    else:
        rows, as_of = source.fetch_proshares(code)
        provider = 'provider:ProShares'
        if not rows:
            rows, as_of = source.fetch_invesco(code)
            provider = 'provider:Invesco'
        if not rows:
            # as_of 를 반드시 함께 덮어쓴다 — 예전에는 직전 분기(Invesco)의 값이
            # 그대로 남아 stockanalysis 결과에 남의 기준일이 붙을 수 있었다.
            rows, as_of, full = source.fetch_stockanalysis(code)
            provider = 'stockanalysis'
    checked = datetime.datetime.now(datetime.timezone.utc).isoformat()
    if not rows:
        return {'success': False, 'code': code, 'checkedAt': checked, 'error': 'Holdings unavailable', 'attempts': attempts}
    return {'success': True, 'code': code, 'checkedAt': checked, 'attempts': attempts, 'entry': {
        'holdings': rows, 'asOf': as_of, 'source': provider,
        # 기준일만으로 완전성을 단정하지 않는다 — 날짜가 있어도 상위 N 개만 받은
        # 목록일 수 있으므로 '전체를 받았다는 근거'가 함께 있어야 full 이다.
        'coverage': 'full' if (as_of and full) else 'partial',
        'equityWeight': round(sum(row['w'] for row in rows), 4),
        'fetchedAt': checked, 'lastAttempt': checked, 'retained': False}}


def _session_secret():
    # 기존 AUTH_TOKEN은 bearer 인증에 재사용하지 않고 세션 서명 호환 키로만 쓴다.
    return os.environ.get('SESSION_SECRET') or os.environ.get('AUTH_TOKEN', '')


def _safe_equal(left, right):
    try:
        return hmac.compare_digest(str(left).encode('utf-8'), str(right).encode('utf-8'))
    except Exception:
        return False


def _verify_session_cookie(raw_cookie):
    secret = _session_secret()
    if not secret or not raw_cookie:
        return False
    try:
        cookie = SimpleCookie()
        cookie.load(raw_cookie)
        morsel = cookie.get(SESSION_COOKIE)
        if not morsel:
            return False
        value = morsel.value
        encoded, signature = value.split('.', 1)
        expected = base64.urlsafe_b64encode(
            hmac.new(secret.encode('utf-8'), encoded.encode('ascii'), hashlib.sha256).digest()
        ).decode('ascii').rstrip('=')
        if not _safe_equal(signature, expected):
            return False
        padded = encoded + '=' * (-len(encoded) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode('ascii')).decode('utf-8'))
        now = int(time.time())
        return (
            payload.get('v') == 1
            and isinstance(payload.get('iat'), int)
            and isinstance(payload.get('exp'), int)
            and payload['iat'] <= now + 60
            and payload['exp'] > now
            and payload['exp'] - payload['iat'] == SESSION_TTL_SECONDS
        )
    except Exception:
        return False


def _valid_bearer(raw_authorization):
    if not raw_authorization.startswith('Bearer '):
        return False
    supplied = raw_authorization[7:]
    token = os.environ.get('INTERNAL_API_TOKEN', '')
    return bool(token and _safe_equal(supplied, token))


def _auth_configured():
    return bool(_session_secret() or os.environ.get('INTERNAL_API_TOKEN', ''))


def _parse_tickers(raw, limit=MAX_TICKERS):
    if len(raw or '') > 1000:
        raise ValueError('invalid_tickers')
    result = []
    for item in (raw or '').split(','):
        ticker = item.strip().upper()
        if not ticker:
            continue
        if not TICKER_PATTERN.fullmatch(ticker):
            raise ValueError('invalid_ticker')
        if ticker not in result:
            result.append(ticker)
    if len(result) > limit:
        raise ValueError('too_many_tickers')
    return result

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

# ── KRX(pykrx) 사용 가능 여부 — pykrx 를 부르는 곳은 모두 이 관문을 거친다 ──
# KRX 는 이제 회원 로그인(KRX_ID/KRX_PW) 없는 조회를 거부한다. pykrx 는 그 실패를 삼키고
# 빈 DataFrame 을 돌려주므로 결과는 어차피 yfinance 로 채워지는데, 종목마다 실패하는 KRX
# 왕복이 1~1.4초씩 걸려 국내 17종목 배당 조회가 24초가 됐다(2026-11-20 운영 로그).
# 자격이 없으면 아예 부르지 않고, 자격이 있어도 프로세스당 한 번(10분 기억) 확인 호출로
# KRX 가 실제로 응답하는지 본다. 자격을 Vercel 환경변수에 넣으면(재배포) 코드 수정 없이 다시 켜진다.
KRX_PROBE_TICKER = '005930'      # 늘 상장된 대형주 — 로그인·응답 확인용
KRX_PROBE_WINDOW_DAYS = 14       # 연휴가 끼어도 거래일이 한 번은 들어가는 구간
KRX_PROBE_TTL_SECONDS = 600      # 확인 결과를 10분 기억(일시 장애로 프로세스 내내 막히지 않게)
_KRX_PROBE = {'ok': None, 'at': 0.0, 'skipLogged': False}


def _krx_credentials_set():
    # scripts/collect_etf_holdings.py 의 krx_available() 과 같은 기준.
    return bool(os.environ.get('KRX_ID') and os.environ.get('KRX_PW'))


def _krx_usable():
    """이 프로세스에서 pykrx(KRX) 조회가 쓸 만한지. 자격이 없으면 KRX 호출 0회."""
    if not PYKRX_OK:
        return False
    if not _krx_credentials_set():
        if not _KRX_PROBE['skipLogged']:
            print('[dashboard.py] KRX_ID/KRX_PW 미설정 — pykrx(KRX) 조회를 건너뛰고 yfinance 로 조회')
            _KRX_PROBE['skipLogged'] = True
        return False
    now = time.monotonic()
    if _KRX_PROBE['ok'] is not None and now - _KRX_PROBE['at'] < KRX_PROBE_TTL_SECONDS:
        return _KRX_PROBE['ok']
    ok = False
    try:
        end = datetime.date.today()
        start = end - datetime.timedelta(days=KRX_PROBE_WINDOW_DAYS)
        df = krx.get_market_ohlcv_by_date(start.strftime('%Y%m%d'), end.strftime('%Y%m%d'), KRX_PROBE_TICKER)
        ok = df is not None and not df.empty
    except Exception:
        ok = False
    if not ok:
        print(f'[dashboard.py] KRX 확인 호출 실패 — {KRX_PROBE_TTL_SECONDS}초 동안 pykrx(KRX) 조회를 건너뜀')
    _KRX_PROBE['ok'] = ok
    _KRX_PROBE['at'] = now
    return ok

# ── 국내 전 종목 리스트 캐시 (메모리 절약형) ──────────────────
_KR_TICKER_CACHE = {} # { "종목명": "티커" }
_KR_CACHE_TIME = None

def _update_kr_ticker_cache():
    global _KR_TICKER_CACHE, _KR_CACHE_TIME
    if not _krx_usable(): return
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


# ── 네이버 증권·업비트 시세 (앱의 api/stock-price.js · api/price.ts 와 같은 주소·같은 규칙) ──
# 배치(scripts/net_worth_snapshot.py)가 이 함수들을 그대로 쓴다 — 한쪽만 바꾸면 앱과 배치의 평가액이 갈린다.
NAVER_JSON_HEADERS = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json',
                      'Referer': 'https://m.stock.naver.com/'}
KRX_CLOSE_SETTLE_MIN = 15 * 60 + 40   # api/stock-price.js 의 KRX_CLOSE_SETTLE_MIN 과 같은 값
KST = datetime.timezone(datetime.timedelta(hours=9))


def _http_json(url, timeout=8, headers=None):
    import urllib.request
    req = urllib.request.Request(url, headers=headers or NAVER_JSON_HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8'))


def _num(v):
    try:
        n = float(str(v if v is not None else '').replace(',', ''))
    except ValueError:
        return None
    return n if math.isfinite(n) and n > 0 else None


def _signed(v):
    try:
        n = float(str(v if v is not None else '').replace(',', ''))
    except ValueError:
        return 0.0
    return n if math.isfinite(n) else 0.0


def _kst_now(now=None):
    if now is None:
        return datetime.datetime.now(KST)
    if now.tzinfo is None:
        now = now.replace(tzinfo=datetime.timezone.utc)
    return now.astimezone(KST)


def today_still_trading(now=None):
    """오늘(KST) 일별 줄이 아직 장중 가격인가 — 평일이고 15:40 전."""
    k = _kst_now(now)
    return k.weekday() < 5 and (k.hour * 60 + k.minute) < KRX_CLOSE_SETTLE_MIN


def pick_last_close(rows, now=None):
    """일별 시세 줄에서 '장이 끝난 마지막 거래일' 종가. stock-price.js pickLastClose 와 같은 결과."""
    items = []
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict):
            continue
        date = str(r.get('localTradedAt') or '')[:10]
        close = _num(r.get('closePrice'))
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}', date) and close:
            items.append((date, close, _signed(r.get('compareToPreviousClosePrice'))))
    items.sort(key=lambda x: x[0], reverse=True)
    today = _kst_now(now).strftime('%Y-%m-%d')
    trading = today_still_trading(now)
    done = [x for x in items if x[0] < today or (x[0] == today and not trading)]
    if not done:
        return None
    date, close, diff = done[0]
    prev = done[1][1] if len(done) > 1 else close - diff
    if not prev or prev <= 0:
        prev = close
    return {'price': close, 'prevClose': prev, 'change': close - prev, 'asOf': date}


def naver_last_close(code, now=None):
    try:
        rows = _http_json('https://m.stock.naver.com/api/stock/%s/price?pageSize=5&page=1' % code)
    except Exception as e:
        print('[naver] %s 일별 시세 실패: %s' % (code, type(e).__name__))
        return None
    return pick_last_close(rows, now)


def naver_market_index(category, code):
    try:
        d = _http_json('https://m.stock.naver.com/front-api/marketIndex/productDetail?category=%s&reutersCode=%s'
                       % (category, code))
    except Exception as e:
        print('[naver] %s 실패: %s' % (code, type(e).__name__))
        return None
    return d.get('result') if isinstance(d, dict) and d.get('isSuccess') else None


def naver_gold_close(result):
    """금: 장중(OPEN)에는 '전일' 종가, 마감 뒤에는 오늘 종가. price.ts naverGoldClose 와 같다."""
    if not isinstance(result, dict):
        return None
    if str(result.get('marketStatus') or '').upper() == 'OPEN':
        for info in result.get('marketIndexTotalInfos') or []:
            if isinstance(info, dict) and info.get('code') == 'lastClosePrice':
                return _num(info.get('value'))
        return None
    return _num(result.get('closePrice'))


def naver_fx():
    """하나은행 고시 매매기준율. 세 통화를 모두 받았을 때만 돌려준다(한 통화만 다른 출처로 섞지 않는다)."""
    usd = _num((naver_market_index('exchange', 'FX_USDKRW') or {}).get('closePrice'))
    jpy100 = _num((naver_market_index('exchange', 'FX_JPYKRW') or {}).get('closePrice'))
    aud = _num((naver_market_index('exchange', 'FX_AUDKRW') or {}).get('closePrice'))
    if usd and jpy100 and aud:
        return {'usd_krw': usd, 'jpy100_krw': jpy100, 'aud_krw': aud}
    return None


def crypto_krw(sym):
    """가상화폐 원화 시세: 업비트 → 빗썸. (price, prevClose, source) 또는 None. price.ts cryptoKrwQuote 와 같은 순서."""
    try:
        d = _http_json('https://api.upbit.com/v1/ticker?markets=KRW-%s' % sym, timeout=6,
                       headers={'Accept': 'application/json'})
        row = d[0] if isinstance(d, list) and d else {}
        price = _num(row.get('trade_price'))
        if price:
            return price, _num(row.get('prev_closing_price')) or price, 'upbit'
    except Exception as e:
        print('[upbit] %s 실패: %s' % (sym, type(e).__name__))
    try:
        d = _http_json('https://api.bithumb.com/public/ticker/%s_KRW' % sym, timeout=6,
                       headers={'Accept': 'application/json'})
        data = d.get('data') if isinstance(d, dict) and d.get('status') == '0000' else {}
        price = _num((data or {}).get('closing_price'))
        if price:
            return price, _num(data.get('prev_closing_price')) or price, 'bithumb'
    except Exception as e:
        print('[bithumb] %s 실패: %s' % (sym, type(e).__name__))
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


# ── 1. 환율 ─────────────────────────────────────────────────────
def get_rates():
    r = {'usd_krw': UNAVAILABLE, 'usd_jpy': UNAVAILABLE, 'jpy100_krw': UNAVAILABLE,
         'aud_krw': UNAVAILABLE, 'source': UNAVAILABLE}

    # 1차: 네이버 증권(하나은행 고시) — 앱의 /api/price 와 같은 출처
    fx = naver_fx()
    if fx:
        r['usd_krw'] = round(fx['usd_krw'], 2)
        r['jpy100_krw'] = round(fx['jpy100_krw'], 2)
        r['aud_krw'] = round(fx['aud_krw'], 2)
        r['usd_jpy'] = round(fx['usd_krw'] / (fx['jpy100_krw'] / 100.0), 2)
        r['source'] = 'naver'
        return {'success': True, 'rates': r}

    # 2차: yfinance. AUD/KRW 를 못 받으면 '미조회'로 두고 절대 1로 대체하지 않는다
    # (1로 대체하면 A$1 = ₩1 로 계산돼 평가액이 약 950배 어긋난 채 조용히 표시된다).
    v = safe_last_close('KRW=X')
    if v:
        r['usd_krw'] = round(v, 2)
    v = safe_last_close('JPY=X')
    if v:
        r['usd_jpy'] = round(v, 2)
    v = safe_last_close('AUDKRW=X')
    if v:
        r['aud_krw'] = round(v, 2)
    u = r.get('usd_krw')
    j = r.get('usd_jpy')
    if isinstance(u, (int, float)) and isinstance(j, (int, float)) and j > 0:
        r['jpy100_krw'] = round(u / j * 100, 2)
    r['source'] = 'yfinance'
    return {'success': True, 'rates': r}


# ── 2. 금 시세 ──────────────────────────────────────────────────
def get_gold(unit='g'):
    """
    KRX 금시장 1g(99.99%) 가격(네이버 증권). 실패 시 국제 시세(USD/oz) × USD/KRW ÷ 31.1035
    단위: g / 돈(3.75g) / kg(1000g)
    """
    info = {'price': UNAVAILABLE, 'unit': unit,
            'price_per_g': UNAVAILABLE, 'source': 'naver KRX gold'}

    # 1차: 네이버 증권 '국내 금'(KRX 금시장 99.99%, 원/g) — 앱의 /api/price 와 같은 출처
    ppg = naver_gold_close(naver_market_index('metals', 'M04020000'))
    gold_usd_oz = usd_krw = None
    if not ppg:
        # 2차: 국제 시세(COMEX 금 선물 USD/oz) × USD/KRW ÷ 31.1035
        info['source'] = 'yfinance GC=F + KRW=X'
        gold_usd_oz = safe_last_close('GC=F')
        usd_krw = safe_last_close('KRW=X')
        if gold_usd_oz and usd_krw:
            ppg = gold_usd_oz * usd_krw / 31.1035   # KRW per gram

    if ppg:
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
            
            # KRX 단축코드는 숫자 6자리만이 아니다 — 0117V0 처럼 영숫자도 발급된다.
            # isdigit() 으로 재면 그런 코드를 미국 주식으로 오인해 yfinance 로 보내고
            # 조회가 통째로 실패한다. get_dividends 와 같은 규칙을 쓴다.
            t_up = tkr.upper()
            is_kr = len(t_up) == 6 and all(c.isdigit() or ('A' <= c <= 'Z') for c in t_up)
            is_crypto = t_up in CRYPTO_TICKERS

            if is_kr:
                # 한국 주식 – pykrx 우선, yfinance fallback
                price = UNAVAILABLE
                # 1차: 네이버 일별 시세의 직전 종가 (앱 /api/stock-price 와 같은 규칙)
                nv = naver_last_close(t_up)
                if nv:
                    price = round(nv['price'])
                if price == UNAVAILABLE and _krx_usable():
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
                # 업비트 원화가 먼저(빗썸 폴백) — 원화로 돌려주고 화면이 종목 통화로 바꾼다
                ck = crypto_krw(t_up)
                if ck:
                    result[tkr] = {'price': round(ck[0], 4), 'cur': 'KRW', 'source': ck[2]}
                else:
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
            print('[get_prices] source error:', type(e).__name__)
            result[tkr] = {'price': UNAVAILABLE, 'error': 'source_unavailable'}

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
                try:
                    # 1) 배당수익률 & 현재가 → 연간 DPS 추정 (KRX 를 쓸 수 있을 때만)
                    #    _krx_usable() 이 거짓이면 pykrx 가 빈 응답을 준 것과 같은 상태(가격 0·수익률 0)로
                    #    아래 yfinance 경로를 탄다 — 예전 운영(로그인 없는 KRX 가 빈 값을 주던 때)과 결과가 같다.
                    #    yfinance 경로를 pykrx 분기 밖에 두므로 pykrx 미설치·예외 때도 '미조회'로 끝나지 않는다.
                    yld = 0.0
                    price = 0
                    if _krx_usable():
                        try:
                            d = prev_biz_day_str()
                            df_f = krx.get_market_fundamental(d, d, tkr)
                            if not df_f.empty and 'DIV' in df_f.columns:
                                yld = float(df_f['DIV'].iloc[-1])
                            df_p = krx.get_market_ohlcv_by_date(d, d, tkr)
                            price = float(df_p['종가'].iloc[-1]) if not df_p.empty else 0
                        except Exception:
                            yld = 0.0
                            price = 0
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
            print('[get_dividends] source error:', type(e).__name__)
            result[tkr] = {'dps': UNAVAILABLE, 'error': 'source_unavailable'}

    return {'success': True, 'result': result}


# ── 5. ETF 구성종목 실시간 조회 (type=etf_holdings → 파일 맨 위 get_live_etf) ──
# ETF 탐색 화면 진입·재조회 때 보유 ETF만 조회한다. 서버리스 제한시간 안에 끝나도록
# 제한된 HTTP 소스(국내 FunETF 우선, 해외 운용사 → stockanalysis)만 쓰고, KRX 재시도나
# 브라우저 단계는 쓰지 않는다. 긴 재시도와 영구 이력은 GitHub Actions
# (.github/workflows/etf-holdings.yml → scripts/collect_etf_holdings.py)가 맡아
# data/etf_holdings.json 을 커밋한다.


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
        idx_syms = ['^GSPC', '^KS11']
        # 시장 달력이 다른 종목은 구간 선두가 NaN 으로 남고, ffill 은 선행 NaN 을 채우지 못한다.
        # (1년 구간 첫 날이 미국 휴장일이면 그 행은 KOSPI 때문에 살아남고 US 종목은 전부 NaN)
        # 아래 drop_cols 가 '한 칸이라도 NaN 이면 폐기'였던 탓에 그런 날 하나 때문에 US 종목이
        # 통째로 버려졌고, 미국 종목만 보유한 소유주는 resolved 가 비어 포트폴리오 라인이
        # 아예 사라졌다(혼합 보유자는 국내 종목이 남아 라인이 보이므로 증상이 한 명에게만 나타났다).
        # 선행 구멍만 뒤에서 메워 달력 차이를 흡수한다. 지수는 건드리지 않으므로 아래 dropna 가
        # 여전히 선두 행을 정리하고, 구간별 base 는 '첫 유효값' 기준이라 안전하다.
        _data_cols = [c for c in close_df.columns if c not in idx_syms]
        if _data_cols:
            close_df[_data_cols] = close_df[_data_cols].bfill()
        # 다운로드 실패·이력 부족 종목 컬럼 제거 — 한 종목의 NaN이 dropna로
        # 전체 행을 삭제하는 것을 방지 (지수 ^GSPC/^KS11 은 유지)
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
        # 보완할 종목이 있을 때만 KRX 확인(_krx_usable)을 부른다 — 쓰지 않을 확인 호출을 하지 않는다.
        if tkrs_list:
            kr_missing = []
            for t in tkrs_list:
                base = _kr_base(t)
                if base and _resolve_col(t, close_df.columns) is None:
                    kr_missing.append(base)
            kr_missing = list(dict.fromkeys(kr_missing))
            if kr_missing and _krx_usable():
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
            # 구간의 모든 거래일을 보낸다(1년 ≈ 250점). 예전에는 6등분한 점(1년 = 7점)만 보내
            # 곡선이 뭉개지고, 화면이 같은 시리즈로 계산하는 MDD 가 실제 낙폭보다 작게 나왔다.
            # JS 폴백(script.js _jsBenchmarkFallback)도 같은 규칙이다 — 한쪽만 바꾸지 않는다.
            indices = list(range(n))
                
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


# ── Vercel Python Serverless Handler ───────────────────────────
class handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): pass

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Vary', 'Cookie, Authorization')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        auth_header = self.headers.get('Authorization', '')
        if not _auth_configured():
            print('[dashboard.py] authentication environment is not configured')
            self._send_json({'error': 'Auth not configured'}, 500)
            return
        if not (_valid_bearer(auth_header) or _verify_session_cookie(self.headers.get('Cookie', ''))):
            self._send_json({'error': 'Unauthorized'}, 401)
            return

        parsed = urlparse(self.path)
        if len(parsed.query) > MAX_QUERY_LENGTH:
            self._send_json({'success': False, 'error': 'Query too large'}, 400)
            return
        params = parse_qs(parsed.query)
        qtype  = params.get('type', [''])[0]
        if qtype not in ALLOWED_TYPES:
            self._send_json({'success': False, 'error': 'Invalid type'}, 400)
            return
        try:
            if qtype == 'etf_holdings':
                data = get_live_etf(params.get('ticker', [''])[0].strip())
            elif qtype == 'rates': data = get_rates()
            elif qtype == 'gold':
                unit = params.get('unit', ['g'])[0]
                if unit not in {'g', '돈', 'kg'}:
                    raise ValueError('invalid_unit')
                data = get_gold(unit)
            elif qtype == 'price':
                data = get_prices(_parse_tickers(params.get('tickers', [''])[0]))
            elif qtype == 'dividend':
                data = get_dividends(_parse_tickers(params.get('tickers', [''])[0], MAX_DIVIDEND_TICKERS))
            elif qtype == 'health': data = get_health()
            elif qtype == 'benchmark':
                benchmark_tickers = _parse_tickers(params.get('p_tkrs', [''])[0], 20)
                raw_weights = params.get('p_weights', [''])[0]
                if len(raw_weights) > 1000:
                    raise ValueError('invalid_weights')
                weights = [float(item) for item in raw_weights.split(',') if item]
                if len(benchmark_tickers) != len(weights) or any(
                    not math.isfinite(weight) or weight < 0 or weight > 1e18 for weight in weights
                ):
                    raise ValueError('invalid_weights')
                data = get_benchmark(
                    ','.join(benchmark_tickers),
                    ','.join(str(weight) for weight in weights),
                )
            elif qtype == 'resolve':
                name = params.get('name', [''])[0].strip()
                if not name or len(name) > 80 or any(ord(char) < 32 for char in name):
                    raise ValueError('invalid_name')
                data = {'success': True, 'name': name, 'code': resolve_kr_ticker(name)}
            else: data = {'success': False, 'error': 'Invalid type'}
        except ValueError:
            self._send_json({'success': False, 'error': 'Invalid request'}, 400)
            return
        except Exception as e:
            # 스택트레이스는 서버 로그로만 남기고 클라이언트 응답에는 포함하지 않음(내부 경로/구현 노출 방지)
            print('[dashboard.py] handler error:\n' + traceback.format_exc())
            self._send_json({'success': False, 'error': 'Internal server error'}, 500)
            return
        self._send_json(data)
