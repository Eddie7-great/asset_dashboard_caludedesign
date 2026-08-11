"""ETF 구성종목 수집 공용 유틸 — 코드 정규화 / 주식 판별 / 소스별 파서.

api/dashboard.py 의 서버리스 구현(_norm_holding_code, _kr_etf_holdings_naver,
_yf_etf_holdings, _sa_etf_holdings)에서 이식했다. 이제 이 로직은 브라우저 요청 경로가 아니라
GitHub Actions 배치에서만 돌아간다.
"""

import json
import re
import sys
import urllib.parse
import urllib.request

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')

# ── 주요 미국 종목 ISIN → 티커 매핑 ──────────────────────────────
# KRX ETF PDF(구성종목)는 해외 편입 종목을 ISIN(예: US67066G1040)으로 공시한다.
# ISIN은 상장 후 변하지 않는 식별자이므로 이 표는 '비중표'와 달리 갱신이 필요 없다 —
# 비중은 KRX 공시에서 실시간으로 받고, 여기서는 식별자만 티커로 되돌린다.
# (미등재 ISIN은 원문 그대로 통과 → 직접 보유 종목과 매칭되지 않을 뿐, 오류는 아님)
ISIN_TICKER = {
    'US0378331005': 'AAPL',  'US5949181045': 'MSFT',  'US67066G1040': 'NVDA',
    'US02079K3059': 'GOOGL', 'US02079K1079': 'GOOG',  'US0231351067': 'AMZN',
    'US30303M1027': 'META',  'US88160R1014': 'TSLA',  'US11135F1012': 'AVGO',
    'US64110L1061': 'NFLX',  'US22160K1051': 'COST',  'US0079031078': 'AMD',
    'US8725901040': 'TMU',   'US8725401090': 'TMUS',  'US17275R1023': 'CSCO',
    'US7134481081': 'PEP',   'US5324571083': 'LIN',   'US4612021034': 'INTU',
    'US7475251036': 'QCOM',  'US46120E6023': 'ISRG',  'US0311621009': 'AMGN',
    'US09857L1089': 'BKNG',  'US8825081040': 'TXN',   'US00724F1012': 'ADBE',
    'US4385161066': 'HON',   'US6974351057': 'PANW',  'US5951121038': 'MU',
    'US0530151036': 'ADP',   'US69608A1088': 'PLTR',  'US4581401001': 'INTC',
    'US0846707026': 'BRKB',  'US46625H1005': 'JPM',   'US5324991002': 'LLY',
    'US92826C8394': 'V',     'US30231G1022': 'XOM',   'US91324P1021': 'UNH',
    'US57636Q1040': 'MA',    'US9311421039': 'WMT',   'US4370761029': 'HD',
    'US7427181091': 'PG',    'US4781601046': 'JNJ',   'US00287Y1091': 'ABBV',
    'US1667641005': 'CVX',   'US1912161007': 'KO',    'US58933Y1055': 'MRK',
    'US92343V1044': 'VZ',    'US5398301094': 'LMT',   'US1101221083': 'BMY',
    'US7170811035': 'PFE',   'US09247X1019': 'BLK',   'US38141G1040': 'GS',
    'US1491231015': 'CAT',   'US0258161092': 'AXP',   'US89417E1091': 'TRV',
    'US79466L3024': 'CRM',   'US6174464486': 'MS',    'US3696043013': 'GE',
    'US0970231058': 'BA',    'US4592001014': 'IBM',   'US5801351017': 'MCD',
    'US6541061031': 'NKE',   'US2546871060': 'DIS',   'US00206R1023': 'T',
    'US92840M1027': 'VST',   'US21037T1097': 'CEG',   'US36828A1016': 'GEV',
    'US65339F1012': 'NEE',   'US26441C2044': 'DUK',   'US8425871071': 'SO',
    'US86800U3023': 'SMCI',  'US0420682058': 'ARM',   'US8740391003': 'TSM',
    'US0326541051': 'ADI',   'US5128071082': 'LRCX',  'US0382221051': 'AMAT',
    'US4824801009': 'KLAC',  'US5738741041': 'MRVL',  'US8716071076': 'SNPS',
    'US1273871087': 'CDNS',  'US22788C1053': 'CRWD',  'US81762P1021': 'NOW',
    'US90353T1007': 'UBER',  'US19260Q1076': 'COIN',  'US7707001027': 'HOOD',
    'US03831W1080': 'APP',   'US0404132054': 'ANET',
}

# 티커 변경/병기 별칭 — 원 티커로 못 찾으면 별칭으로 재시도
ETF_ALIAS = {'SPYM': 'SPLG', 'SPLG': 'SPYM'}

KR_ISIN_RE = re.compile(r'^KR7([0-9A-Z]{6})\d{3}$')
US_ISIN_RE = re.compile(r'^US[0-9A-Z]{9}\d$')

# 주식이 아닌 구성 자산 — 종목명으로 걸러낸다
NON_EQUITY_NAME_RE = re.compile(
    r'(원화\s*예금|설정\s*현금|예치금|현금성|KRW|USD\s*CASH|'
    r'선물|futures?|스왑|swap|옵션|option|'
    r'국고채|통안채|회사채|국채|BOND|T-?BILL|T-?NOTE|REPO|CD\d)', re.I)


def is_kr_code(t):
    return len(t) == 6 and all(c.isdigit() or ('A' <= c <= 'Z') for c in t)


def norm_holding_code(code_s):
    """구성종목 코드 정규화 → 매칭 가능한 티커. 주식이 아니면 None.

    KRX raw JSON 의 COMPST_ISU_CD 를 그대로 받는다 (pykrx 래퍼처럼 [3:9] 로 자르지 않는다 —
    자르면 US ISIN 이 US67066G1040 → '066G10' 으로 망가져 해외 편입 종목을 매칭할 수 없다).
    """
    if not code_s:
        return None
    code_s = str(code_s).strip().upper()
    if is_kr_code(code_s):
        return code_s
    m = KR_ISIN_RE.match(code_s)           # KR7005930003 → 005930
    if m:
        return m.group(1)
    if US_ISIN_RE.match(code_s):           # US67066G1040 → NVDA (미등재 ISIN은 원문 유지)
        return ISIN_TICKER.get(code_s, code_s)
    if code_s.startswith('KR'):            # KRD010010001(원화현금)·채권 ISIN 등 비종목
        return None
    base = re.sub(r'\.(O|OQ|N|K|A)$', '', code_s)   # 로이터형 접미사 제거
    if re.fullmatch(r'[A-Z0-9.\-]{1,12}', base):
        return base
    return None


def is_equity_row(code_s, name):
    """주식 행인지 판별. 현금·채권·파생은 버린다."""
    if NON_EQUITY_NAME_RE.search(str(name or '')):
        return False
    return norm_holding_code(code_s) is not None


def _to_float(v):
    try:
        f = float(str(v).replace(',', '').replace('%', '').strip())
        return f if f == f else None      # NaN 방지
    except Exception:
        return None


def merge_holdings(rows):
    """[(tkr, name, weight)] → 티커별 비중 합산 후 내림차순.

    비중은 100%로 재정규화하지 않는다 — ETF 순자산 대비 원래 비중을 그대로 쓴다.
    (그래야 "이 ETF는 주식이 절반뿐"이라는 사실이 룩스루에 정직하게 반영된다)

    종목 정규화 규칙:
      · 삼성전자(005930)와 삼성전자우(005935)는 별개 종목으로 유지 — 권리·가격이 다르다
      · Alphabet GOOGL/GOOG 도 통합하지 않는다 — 보유한 클래스와 정확히 매칭돼야 한다
      · 동일 티커가 여러 행으로 공시되는 경우만 합산한다
    """
    agg = {}
    for tkr, name, w in rows:
        if not tkr or w is None or w <= 0:
            continue
        cur = agg.get(tkr)
        if cur:
            cur['w'] += w
        else:
            agg[tkr] = {'t': tkr, 'n': (name or tkr), 'w': w}
    out = sorted(agg.values(), key=lambda x: -x['w'])
    for h in out:
        h['w'] = round(h['w'], 4)
    return out


def http_json(url, data=None, headers=None, timeout=20):
    """urllib 기반 JSON 요청. data 가 dict 면 form-urlencoded POST."""
    hdr = {'User-Agent': UA, 'Accept': 'application/json, text/plain, */*'}
    hdr.update(headers or {})
    body = None
    if data is not None:
        body = urllib.parse.urlencode(data).encode('utf-8')
        hdr.setdefault('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8')
    req = urllib.request.Request(url, data=body, headers=hdr)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8', 'replace'))


# ── KRX PDF 응답 파서 (1순위) ───────────────────────────────────
def parse_krx_pdf(output):
    """KRX MDCSTAT05001 output 배열 → (holdings, equityWeight).

    컬럼: COMPST_ISU_CD / COMPST_ISU_NM / COMPST_ISU_CU1_SHRS / VALU_AMT / COMPST_AMT / COMPST_RTO

    비중은 COMPST_RTO 를 쓴다. 금액 기반 산출은 **응답 전체에 쓸 만한 COMPST_RTO 가 하나도 없을 때만**
    폴백으로 쓴다 — 개별 행의 0 을 금액으로 메우면 실제로 비중 0 인 종목에 없는 비중을 지어내게 된다.
    (금액 폴백도 전체 COMPST_AMT 합계 대비라 ETF 순자산 기준이며, 100%로 재정규화하는 것이 아니다)
    """
    rows = list(output or [])
    if not rows:
        return [], 0.0

    # KRX/pykrx 버전에 따라 비중 키가 COMPST_RTO 또는 COMPST_RTIO로 온다.
    # 양쪽을 모두 허용하되, 응답에 실제 양수 비중이 없을 때만 금액 기반 폴백을 쓴다.
    def row_ratio(row):
        for key in ('COMPST_RTO', 'COMPST_RTIO'):
            value = _to_float(row.get(key))
            if value is not None:
                return value
        return None

    def row_amount(row):
        for key in ('COMPST_AMT', 'VALU_AMT'):
            value = _to_float(row.get(key))
            if value is not None:
                return value
        return None

    has_rto = any((row_ratio(r) or 0) > 0 for r in rows)
    total_amt = 0.0
    if not has_rto:
        for r in rows:
            v = row_amount(r)
            if v and v > 0:
                total_amt += v

    picked = []
    for r in rows:
        code = str(r.get('COMPST_ISU_CD') or '').strip().upper()
        name = str(r.get('COMPST_ISU_NM') or '').strip()
        if not is_equity_row(code, name):
            continue
        if has_rto:
            w = row_ratio(r)
        else:
            amt = row_amount(r)
            w = (amt / total_amt * 100) if (amt and amt > 0 and total_amt > 0) else None
        if w is None or w <= 0:
            continue
        picked.append((norm_holding_code(code), name or code, w))

    holdings = merge_holdings(picked)
    equity_weight = round(sum(h['w'] for h in holdings), 2)
    return holdings, equity_weight


# ── 네이버 증권 (국내 2순위) ────────────────────────────────────
def fetch_naver(code):
    """m.stock.naver.com etfAnalysis — 응답 스키마가 바뀔 수 있어 JSON 트리를 관대하게 탐색."""
    try:
        data = http_json('https://m.stock.naver.com/api/stock/%s/etfAnalysis' % code, timeout=12)
    except Exception as e:
        print('[naver] %s: %s: %s' % (code, type(e).__name__, e), file=sys.stderr)
        return []

    def _w(d):
        for k, v in d.items():
            if not re.search(r'(weight|percent|ratio)', k, re.I):
                continue
            f = _to_float(v)
            if f is not None and 0 < f <= 100:
                return f
        return None

    def _code(d):
        for key in ('itemCode', 'stockCode', 'code', 'reutersCode', 'symbolCode'):
            v = d.get(key)
            if v:
                return str(v).strip().upper()
        return None

    def _name(d):
        for key in ('itemName', 'stockName', 'name', 'stockEndItemName'):
            v = d.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
        return None

    best, stack = [], [data]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            stack.extend(node.values())
        elif isinstance(node, list):
            rows = []
            for it in node:
                if not isinstance(it, dict):
                    continue
                w = _w(it)
                if w is None:
                    continue
                c, n = _code(it), _name(it)
                if not (c or n):
                    continue
                if not is_equity_row(c or '', n):
                    continue
                rows.append((norm_holding_code(c or '') or (n or ''), n or c, w))
            if len(rows) > len(best):
                best = rows
            stack.extend(node)
    result = merge_holdings(best)
    print('[naver] %s: 원시 응답에서 주식 행 %d개 추출' % (code, len(result)), file=sys.stderr)
    return result


# ── yfinance / stockanalysis (해외) ─────────────────────────────
def fetch_yfinance(sym):
    try:
        import yfinance as yf
    except Exception:
        return []
    try:
        fd = yf.Ticker(sym).funds_data
        th = fd.top_holdings if fd is not None else None
        if th is None or th.empty:
            return []
        wcol = 'Holding Percent' if 'Holding Percent' in th.columns else None
        raw = []
        for s, row in th.iterrows():
            w = _to_float(row[wcol]) if wcol else None
            if w is None or w <= 0:
                continue
            nm = row.get('Name') if hasattr(row, 'get') else None
            raw.append((str(s).strip().upper(), str(nm) if nm else str(s), w))
        if not raw:
            return []
        scale = 100 if max(r[2] for r in raw) <= 1.5 else 1
        return merge_holdings([(t, n, w * scale) for t, n, w in raw])
    except Exception:
        return []


def fetch_stockanalysis(sym):
    s = (sym or '').strip().upper()
    if not s:
        return []
    try:
        data = http_json('https://stockanalysis.com/api/symbol/e/%s/holdings' % s, timeout=12)
    except Exception:
        return []

    def _w(d):
        for k, v in d.items():
            if not re.search(r'(percent|weight|portfolio|allocation)', k, re.I):
                continue
            f = _to_float(v)
            if f is not None and 0 < f <= 100:
                return f
        return None

    def _sym(d):
        for key in ('symbol', 's', 'ticker', 'code'):
            v = d.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip().upper()
        return None

    def _name(d):
        for key in ('name', 'n', 'companyName', 'title'):
            v = d.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
        return None

    best, stack = [], [data]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            stack.extend(node.values())
        elif isinstance(node, list):
            rows = []
            for it in node:
                if not isinstance(it, dict):
                    continue
                w = _w(it)
                if w is None:
                    continue
                tk, nm = _sym(it), _name(it)
                if not (tk or nm):
                    continue
                if not is_equity_row(tk or '', nm):
                    continue
                rows.append((tk or (nm or ''), nm or tk, w))
            if len(rows) > len(best):
                best = rows
    if not best:
        return []
    scale = 100 if max(r[2] for r in best) <= 1.5 else 1
    return merge_holdings([(re.sub(r'\.(US|USD)$', '', t), n, w * scale) for t, n, w in best])
