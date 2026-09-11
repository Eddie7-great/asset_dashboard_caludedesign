#!/usr/bin/env python3
"""보유 ETF 구성종목 수집 → data/etf_holdings.json.

GitHub Actions가 영구 이력을 수집한다. ETF 페이지의 인증 API는 이 모듈의 제한된
HTTP 어댑터를 재사용하며 원장이나 이력 파일을 쓰지 않는다.

수집 우선순위
  1순위  FunETF 전체 PDF 구성종목 → KRX 내부 JSON API (국내 ETF)
  2순위  운용사 공식 어댑터(지원 운용사) / ZEROIN(그 외 국내 ETF)
  3순위  네이버(국내) / yfinance·stockanalysis(해외)
  4순위  Playwright 헤드리스 브라우저 (앞선 소스가 모두 실패한 ETF만)

사용법
  python scripts/collect_etf_holdings.py                 # KV 보유 ETF 전체 수집
  python scripts/collect_etf_holdings.py --tickers 133690,QQQ
  python scripts/collect_etf_holdings.py --smoke 133690  # 스모크 테스트(행 수 부족하면 exit 1)
  python scripts/collect_etf_holdings.py --dry-run       # 파일을 쓰지 않고 요약만 출력
"""

import argparse
import datetime
import http.cookiejar
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from etf_common import (  # noqa: E402
    ETF_ALIAS, UA, NON_EQUITY_NAME_RE, fetch_naver, fetch_stockanalysis, fetch_yfinance,
    http_json, is_equity_row, is_kr_code, merge_holdings,
    norm_holding_code, parse_krx_pdf,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(ROOT, 'data', 'etf_holdings.json')

KRX_URL = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd'
# Referer 는 정확히 이 경로여야 한다 — pykrx(website/comm/webio.py Post.__init__)가
# 로그인 세션 없이 보내는 요청도 이 값을 쓴다. 루트 경로(data.krx.co.kr/)로는 400이 난다.
KRX_HEADERS = {'Referer': 'https://data.krx.co.kr/contents/MDC/MDI/outerLoader/index.cmd',
               'X-Requested-With': 'XMLHttpRequest'}
# bld 값은 추측하지 않았다 — pykrx/website/krx/etx/core.py 에서 확인:
#   ETF_전종목기본종목 → MDCSTAT04601, PDF(Portfolio Deposit File)[13108] → MDCSTAT05001
BLD_ETF_MASTER = 'dbms/MDC/STAT/standard/MDCSTAT04601'
BLD_ETF_PDF = 'dbms/MDC/STAT/standard/MDCSTAT05001'

# 스모크 기준. KRX·ZEROIN은 133690에 100종목 내외를 주지만 일부 대체 소스는 상위 N개만
# 줄 수 있어, "정상인데 수가 적은" 경우와 "파싱이 깨진" 경우를 구분한다.
SMOKE_HARD_MIN = 5    # 이하이면 명백히 깨진 것 → job 실패 (요구사항: "1~2줄만 나오면 멈추고 보고")
SMOKE_EXPECT_ROWS = 30  # 이하이면 경고만 — 데이터는 쓸 수 있으나 소스가 상위 일부만 준 상태
SMOKE_CACHE_MAX_AGE_DAYS = 35  # ETF 리밸런싱 주기를 감안한 일시 장애 허용 범위
ZEROIN_RETRY_DELAYS = (2,)  # 최초 요청 포함 최대 2회. 순간 장애만 흡수하고 runner 차단은 빨리 포기
EXTERNAL_SOURCE_TIMEOUT = 12  # 차단된 국내 사이트 때문에 전체 배치가 30분을 소진하지 않게 제한


# ── KRX ─────────────────────────────────────────────────────────
# 두 번의 raw urllib 시도(스킴, Referer)가 모두 KRX 로부터 400 Bad Request 를 받았다.
# 더 이상 요청 헤더를 추측하지 않고, 실제로 배포·검증된 pykrx 의 내부 요청 계층
# (pykrx.website.krx.etx.core — requests.Session 기반)을 그대로 재사용한다.
# 이 모듈은 pykrx 의 비공개 내부 경로라 향후 버전에서 구조가 바뀔 수 있으므로,
# 가져오기/호출이 실패하면 기존 raw urllib 경로로 자동 폴백한다.
#
# core.py 의 저수준 fetch() 는 wrap.py 의 공개 함수(get_etf_portfolio_deposit_file)와 달리
# COMPST_ISU_CD 를 [3:9] 로 자르지 않는다 — 그 절단은 wrap.py 가 core.py 결과를 받은 뒤
# 추가로 하는 후처리라서, core.py 를 직접 쓰면 US ISIN(US67066G1040)이 안 망가진 채로 온다.
try:
    from pykrx.website.krx.etx.core import ETF_전종목기본종목 as _PykrxEtfMaster
    from pykrx.website.krx.etx.core import PDF as _PykrxPdf
except Exception:
    _PykrxEtfMaster = None
    _PykrxPdf = None


def krx_available():
    """KRX 회원 로그인 자격이 있는지.

    KRX 는 이제 이 API 들에 회원 로그인을 요구한다 (pykrx 1.2.8 README:
    "환경변수가 설정되지 않으면 KRX 로그인이 실패하고 인증이 필요한 데이터를 조회할 수 없습니다").
    자격 없이 호출하면 400 Bad Request 만 돌아오므로, 아예 시도하지 않고 다음 소스로 넘어간다.
    KRX_ID/KRX_PW 를 나중에 넣으면 코드 수정 없이 이 경로가 다시 1순위가 된다.
    """
    return bool(os.environ.get('KRX_ID') and os.environ.get('KRX_PW'))


_isin_map = None


def krx_isin_map():
    """단축코드(6자리) → 표준코드(12자리 ISIN). 실행당 1회만 받아 캐싱한다.

    KRX 로그인 자격이 없으면 빈 맵을 돌려준다 — 이 목록은 KRX PDF 조회에만 쓰이고,
    ETF 판별은 로컬 data/stocks.json 이 담당하므로 없어도 수집이 진행된다.
    """
    global _isin_map
    if _isin_map is not None:
        return _isin_map
    _isin_map = {}
    if not krx_available():
        return _isin_map
    rows = None
    if _PykrxEtfMaster is not None:
        try:
            rows = _PykrxEtfMaster().fetch().to_dict('records')
            print('[krx master] pykrx 응답 %d행' % len(rows), file=sys.stderr)
        except Exception as e:
            print('[krx master] pykrx %s: %s' % (type(e).__name__, e), file=sys.stderr)
    if rows is None:
        try:
            j = http_json(KRX_URL, data={'bld': BLD_ETF_MASTER}, headers=KRX_HEADERS, timeout=30)
            rows = j.get('output') or j.get('OutBlock_1') or []
            print('[krx master] http 응답 %d행' % len(rows), file=sys.stderr)
        except Exception as e:
            print('[krx master] http %s: %s' % (type(e).__name__, e), file=sys.stderr)
            rows = []
    for row in rows:
        srt = str(row.get('ISU_SRT_CD') or '').strip()
        isin = str(row.get('ISU_CD') or '').strip()
        name = str(row.get('ISU_ABBRV') or '').strip()
        if srt and isin:
            _isin_map[srt] = {'isin': isin, 'name': name}
    print('[krx master] ISIN 맵 %d건 구축' % len(_isin_map), file=sys.stderr)
    return _isin_map


def recent_biz_days(n=5):
    out, d = [], datetime.date.today()
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.strftime('%Y%m%d'))
        d -= datetime.timedelta(days=1)
    return out


def fetch_krx(code):
    """KRX PDF(구성종목). → (holdings, equityWeight, asOf) / 실패 시 ([], 0, None).

    당일 미공시·휴장 대비로 최근 영업일을 역순으로 훑는다.
    KRX 로그인 자격이 없으면 조용히 건너뛴다(ZEROIN 등 다음 소스가 받는다).
    """
    if not krx_available():
        return [], 0.0, None
    ent = krx_isin_map().get(code)
    if not ent:
        print('[krx pdf] %s: ISIN 맵에 없음 (마스터 조회 자체가 비었을 가능성)' % code, file=sys.stderr)
        return [], 0.0, None
    print('[krx pdf] %s → ISIN %s (%s)' % (code, ent['isin'], ent.get('name')), file=sys.stderr)
    dumped = False
    for d in recent_biz_days(5):
        rows = None
        if _PykrxPdf is not None:
            try:
                rows = _PykrxPdf().fetch(d, ent['isin']).to_dict('records')
                print('[krx pdf] pykrx %s %s: 원본 %d행' % (code, d, len(rows)), file=sys.stderr)
            except Exception as e:
                print('[krx pdf] pykrx %s %s: %s: %s' % (code, d, type(e).__name__, e), file=sys.stderr)
        if rows is None:
            try:
                j = http_json(KRX_URL, data={'bld': BLD_ETF_PDF, 'trdDd': d, 'isuCd': ent['isin']},
                              headers=KRX_HEADERS, timeout=25)
                rows = j.get('output') or j.get('OutBlock_1') or []
                print('[krx pdf] http %s %s: 원본 %d행' % (code, d, len(rows)), file=sys.stderr)
            except Exception as e:
                print('[krx pdf] http %s %s: %s: %s' % (code, d, type(e).__name__, e), file=sys.stderr)
                continue
        # 파서가 105행 전부를 걸러내는 원인을 모른다 — 실제 필드명/값을 한 번 그대로 찍어본다.
        # (추측 대신 실측: 해외 편입 종목이 많은 ETF라 코드 필드 포맷이 다를 가능성이 크다)
        if rows and not dumped:
            print('[krx pdf] %s %s: 원본 첫 3행 실제 필드 → %s'
                  % (code, d, json.dumps(rows[:3], ensure_ascii=False, default=str)), file=sys.stderr)
            dumped = True
        holdings, eq = parse_krx_pdf(rows)
        print('[krx pdf] %s %s: 파싱 후 주식 %d행 (equityWeight %.1f%%)'
              % (code, d, len(holdings), eq), file=sys.stderr)
        if holdings:
            return holdings, eq, '%s-%s-%s' % (d[:4], d[4:6], d[6:])
    return [], 0.0, None


# ── 2순위 · 국내 ETF 공통 구성종목 ───────────────────────────────
ZEROIN_HOLDINGS_URL = 'https://etf.zeroin.co.kr/etf/{code}/holdings'


class _HtmlTableRowsParser(HTMLParser):
    """단순 HTML 표의 ``<tr><td>…`` 셀을 행 배열로 바꾼다."""

    def __init__(self):
        super().__init__()
        self.rows = []
        self._row = None
        self._cell = None

    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'tr':
            self._row = []
        elif tag.lower() == 'td' and self._row is not None:
            self._cell = []

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == 'td' and self._row is not None and self._cell is not None:
            self._row.append(' '.join(''.join(self._cell).split()))
            self._cell = None
        elif tag.lower() == 'tr' and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None
            self._cell = None


def parse_zeroin_holdings_html(text):
    """ZEROIN 전체 구성종목 표 → (주식 구성종목, 주식비중, 기준일).

    표의 종목코드는 국내 주식이면 6자리, 해외 주식이면
    ``시장식별자@티커``(예: ``221NAS@NVDA``) 형식이다. 현금·금·채권·파생은
    공용 주식 판별기로 제외한다.
    """
    parser = _HtmlTableRowsParser()
    parser.feed(text or '')
    picked = []
    for cells in parser.rows:
        if len(cells) < 4:
            continue
        name, raw_code = cells[1].strip(), cells[2].strip().upper()
        base = raw_code.rsplit('@', 1)[-1].replace('/', '.')
        ticker = norm_holding_code(base)
        if not ticker or not is_equity_row(ticker, name):
            continue
        try:
            weight = float(cells[3].replace(',', '').replace('%', '').strip())
        except Exception:
            continue
        if weight > 0:
            picked.append((ticker, name or ticker, weight))

    holdings = merge_holdings(picked)
    as_of = None
    m = re.search(r'"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})"', text or '')
    if m:
        as_of = m.group(1)
    return holdings, round(sum(x['w'] for x in holdings), 2), as_of


def fetch_zeroin(code):
    """운용사와 무관하게 국내 상장 ETF의 전체 구성종목을 받는다."""
    url = ZEROIN_HOLDINGS_URL.format(code=urllib.parse.quote(str(code).strip()))
    headers = {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://etf.zeroin.co.kr/',
    }
    attempts = len(ZEROIN_RETRY_DELAYS) + 1
    last_as_of = None
    for attempt in range(1, attempts + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=EXTERNAL_SOURCE_TIMEOUT) as r:
                text = r.read().decode('utf-8', 'replace')
            holdings, eq, as_of = parse_zeroin_holdings_html(text)
            last_as_of = as_of or last_as_of
            print('[zeroin] %s: 주식 %d행 (equityWeight %.1f%%, %s) [%d/%d]'
                  % (code, len(holdings), eq, as_of, attempt, attempts), file=sys.stderr)
            if holdings:
                return holdings, eq, as_of
        except Exception as e:
            print('[zeroin] %s: %s: %s [%d/%d]'
                  % (code, type(e).__name__, e, attempt, attempts), file=sys.stderr)
        if attempt < attempts:
            time.sleep(ZEROIN_RETRY_DELAYS[attempt - 1])
    return [], 0.0, last_as_of


# ── 3순위 · 운용사 내부 API 어댑터 ───────────────────────────────
SOL_FUND_CODES = {
    # SOL 공식 상품 페이지의 fund_cd. 공식 API는 STOCK_CODE(ISIN)와 WT_DISP(비중)를 함께 준다.
    '433330': '210930',
}
SOL_PDF_URL = 'https://www.soletf.com/api/fund/pdfList?fund_cd={fund_cd}&work_dt={date}'
SOL_DETAIL_URL = 'https://www.soletf.com/ko/fund/etf/{fund_cd}?tabIndex=3'


def parse_sol_pdf_json(rows):
    """SOL 공식 pdfList JSON → 정규화된 주식 구성종목."""
    picked = []
    for item in rows or []:
        if not isinstance(item, dict):
            continue
        raw_code = str(item.get('STOCK_CODE') or '').strip().upper()
        name = str(item.get('SEC_NM') or '').strip()
        ticker = norm_holding_code(raw_code)
        if not ticker or not is_equity_row(raw_code, name):
            continue
        try:
            weight = float(str(item.get('WT_DISP') or '').replace(',', '').replace('%', '').strip())
        except Exception:
            continue
        if weight > 0:
            picked.append((ticker, name or ticker, weight))
    return merge_holdings(picked)


def fetch_sol(code):
    """SOL 공식 API에서 최근 공시일의 전체 PDF 구성종목을 받는다."""
    fund_cd = SOL_FUND_CODES.get(str(code).strip())
    if not fund_cd:
        return [], None
    headers = {'Referer': SOL_DETAIL_URL.format(fund_cd=fund_cd)}
    for d in recent_biz_days(5):
        try:
            rows = http_json(SOL_PDF_URL.format(fund_cd=fund_cd, date=d),
                             headers=headers, timeout=EXTERNAL_SOURCE_TIMEOUT)
            holdings = parse_sol_pdf_json(rows)
            print('[sol] %s (%s) %s: 공식 PDF %d행 추출'
                  % (code, fund_cd, d, len(holdings)), file=sys.stderr)
            if holdings:
                return holdings, '%s-%s-%s' % (d[:4], d[4:6], d[6:])
        except urllib.error.URLError as e:
            print('[sol] %s %s: %s: %s'
                  % (code, d, type(e).__name__, e), file=sys.stderr)
            # 같은 호스트의 날짜만 바꿔 재요청해도 연결 차단은 풀리지 않는다.
            break
        except Exception as e:
            print('[sol] %s %s: %s: %s'
                  % (code, d, type(e).__name__, e), file=sys.stderr)
    return [], None


TIGER_DETAIL_URL = (
    'https://investments.miraeasset.com/tigeretf/ko/product/search/detail/'
    'index.do?ksdFund={ksd_fund}'
)
TIGER_PDF_URL = (
    'https://investments.miraeasset.com/tigeretf/ko/product/search/detail/'
    'pdfListAjax.ajax'
)


def kr_isin_from_short_code(code):
    """6자리 숫자 단축코드 → 한국 ETF ISIN.

    한국 ETF ISIN은 ``KR7 + 단축코드 + 00 + ISO 6166 체크숫자`` 형식이다.
    예: 133690 → KR7133690008.
    """
    code = str(code or '').strip()
    if not re.fullmatch(r'\d{6}', code):
        return None
    stem = 'KR7' + code + '00'
    digits = ''.join(str(ord(c) - 55) if c.isalpha() else c for c in stem)
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch) * (2 if i % 2 else 1)
        total += n // 10 + n % 10
    return stem + str((10 - total % 10) % 10)


def parse_tiger_pdf_html(text):
    """TIGER 공식 구성종목 HTML → 정규화된 주식 구성종목."""
    parser = _HtmlTableRowsParser()
    parser.feed(text or '')
    totals = [int(n) for n in re.findall(r'data-tot-cnt=["\'](\d+)', text or '')]
    if totals and len(parser.rows) < max(totals):
        return []
    picked = []
    for cells in parser.rows:
        if len(cells) < 5:
            continue
        raw_code, name = cells[0].strip().upper(), cells[1].strip()
        # Bloomberg 식별자 예: "NVDA US EQUITY", "005930 KS EQUITY".
        # CURNCY·FUTURE 등은 이름 휴리스틱에 맡기지 않고 자산 유형으로 먼저 제외한다.
        if not re.search(r'\bEQUITY\b', raw_code):
            continue
        base = raw_code.split()[0].replace('/', '.')
        ticker = norm_holding_code(base)
        if not ticker or not is_equity_row(ticker, name):
            continue
        try:
            weight = float(cells[4].replace(',', '').replace('%', '').strip())
        except Exception:
            return []
        if not math.isfinite(weight):
            return []
        if weight > 0:
            picked.append((ticker, name or ticker, weight))
    return merge_holdings(picked)


def fetch_tiger(code):
    """미래에셋 TIGER 공식 사이트 → (구성종목, 실제 공시 기준일)."""
    ksd_fund = kr_isin_from_short_code(code)
    if not ksd_fund:
        return [], None
    detail_url = TIGER_DETAIL_URL.format(ksd_fund=ksd_fund)
    base_headers = {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
    }
    ajax_headers = {
        'User-Agent': UA,
        'Accept': 'text/html, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Referer': detail_url,
        'X-Requested-With': 'XMLHttpRequest',
    }

    # 2026년 사이트 개편 뒤 목록 API를 세션 없이 직접 호출하면 403을 반환한다.
    # 실제 웹 페이지와 동일하게 상세 페이지를 먼저 열어 JSESSIONID를 받은 다음,
    # 기준일·정렬·페이징 값을 모두 포함해 목록을 요청한다.
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )
    try:
        req = urllib.request.Request(detail_url, headers=base_headers)
        with opener.open(req, timeout=25) as r:
            r.read(1)
    except Exception as e:
        print('[tiger] %s: 세션 초기화 %s: %s'
              % (code, type(e).__name__, e), file=sys.stderr)
        return [], None

    last_error = None
    for d in recent_biz_days(5):
        body = urllib.parse.urlencode({
            'ksdFund': ksd_fund,
            'pageIndex': '1',
            'firstIndex': '0',
            'listCnt': '500',
            'fixDate': '%s.%s.%s' % (d[:4], d[4:6], d[6:]),
            'prfPrd': 'Week01',
            'order': 'SRD',
        }).encode('utf-8')
        try:
            req = urllib.request.Request(TIGER_PDF_URL, data=body, headers=ajax_headers)
            with opener.open(req, timeout=25) as r:
                text = r.read().decode('utf-8', 'replace')
            total = max([int(n) for n in re.findall(r'data-tot-cnt=["\'](\d+)', text)] or [0])
            if total > 2500:
                return [], None
            seen_pages = {text}
            for offset in range(500, total, 500):
                params = dict(urllib.parse.parse_qsl(body.decode('utf-8')))
                params.update(firstIndex=str(offset), pageIndex=str(offset // 500 + 1))
                page_req = urllib.request.Request(TIGER_PDF_URL, data=urllib.parse.urlencode(params).encode('utf-8'), headers=ajax_headers)
                with opener.open(page_req, timeout=25) as r:
                    page = r.read().decode('utf-8', 'replace')
                if page in seen_pages:
                    return [], None  # The server ignored pagination; don't count the first page twice.
                seen_pages.add(page)
                text += page
            holdings = parse_tiger_pdf_html(text)
            print('[tiger] %s (%s) %s: 공식 PDF %d행 추출'
                  % (code, ksd_fund, d, len(holdings)), file=sys.stderr)
            if holdings:
                return holdings, '%s-%s-%s' % (d[:4], d[4:6], d[6:])
        except Exception as e:
            last_error = e
            print('[tiger] %s %s: %s: %s'
                  % (code, d, type(e).__name__, e), file=sys.stderr)
    if last_error is None:
        print('[tiger] %s: 최근 5영업일 공식 PDF가 비었습니다.' % code, file=sys.stderr)
    return [], None


# 브랜드 → callable(code) -> ([{'t','n','w'}], asOf)
PROVIDER_ADAPTERS = {
    'TIGER': fetch_tiger,
    'SOL': fetch_sol,
}

BRAND_RE = re.compile(r'^(TIGER|KODEX|RISE|PLUS|TIME|ACE|SOL|KOSEF|HANARO|KBSTAR|ARIRANG)', re.I)


def brand_of(name):
    m = BRAND_RE.match((name or '').strip())
    return m.group(1).upper() if m else None


def fetch_provider(code, name):
    fn = PROVIDER_ADAPTERS.get(brand_of(name) or '')
    if not fn:
        return [], None
    try:
        result = fn(code)
        if isinstance(result, tuple) and len(result) == 2:
            return result
        return result or [], None
    except Exception as e:
        print('[provider] %s: %s' % (code, type(e).__name__), file=sys.stderr)
        return [], None


# Official product identifiers are links published in each manager's product page.
TIME_PRODUCT_IDS = {'426020': '5', '426030': '2'}
INVESCO_CUSIPS = {'QQQ': '46090E103'}


def fetch_time(code):
    product = TIME_PRODUCT_IDS.get(code)
    if not product:
        return [], None
    url = 'https://timeetf.co.kr/m11_view.php?idx=' + product
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=EXTERNAL_SOURCE_TIMEOUT) as res:
            text = res.read().decode('utf-8', 'replace')
        return parse_time_holdings(text)
    except Exception as e:
        print('[time] %s: %s' % (code, type(e).__name__), file=sys.stderr)
        return [], None


def parse_time_holdings(text):
    # Only the full constituent table; the page also has two historical top-ten lists.
    section = re.search(r'id="constituentItems"[\s\S]*?</table>', text or '')
    date = re.search(r'id="pdfDate"[^>]*value="(\d{4}-\d{2}-\d{2})"', section.group(0) if section else '')
    if not section or not date:
        return [], None
    return parse_tiger_pdf_html(section.group(0)), date.group(1)


def parse_invesco_holdings(data):
    raw = data.get('holdings') or []
    # Do not label a paginated/truncated response as the entire fund.
    if not raw or len(raw) < int(data.get('totalNumberOfHoldings') or len(raw)):
        return [], None
    picked = []
    for row in raw:
        code = norm_holding_code(row.get('ticker'))
        name = row.get('issuerName') or ''
        kind = str(row.get('securityTypeName') or '')
        if not code or not is_equity_row(code, name + ' ' + kind):
            continue
        if not re.search(r'stock|equity|deposit[ao]ry|reit', kind, re.I):
            continue
        try:
            weight = float(row['percentageOfTotalNetAssets'])
        except (TypeError, ValueError, KeyError):
            return [], None
        if not math.isfinite(weight):
            return [], None
        picked.append((code, name, weight))
    date = data.get('effectiveBusinessDate') or data.get('effectiveDate')
    return merge_holdings(picked), date


def fetch_invesco(code):
    cusip = INVESCO_CUSIPS.get(code)
    if not cusip:
        return [], None
    url = ('https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/' + cusip
           + '/holdings/fund?idType=cusip&productType=ETF')
    try:
        return parse_invesco_holdings(http_json(url, headers={'Referer': 'https://www.invesco.com/'},
                                               timeout=EXTERNAL_SOURCE_TIMEOUT))
    except Exception as e:
        print('[invesco] %s: %s' % (code, type(e).__name__), file=sys.stderr)
        return [], None


# ── 4순위 · Playwright ──────────────────────────────────────────
# 브랜드 → {'url': '...{code}...', 'table': 'CSS 셀렉터'}
# 위와 같은 이유로 비어 있다. 레지스트리가 비면 이 티어는 통째로 건너뛴다.
BROWSER_SOURCES = {}


def fetch_via_browser(url, table_selector, timeout_ms=20000):
    """페이지 로드 → 테이블 렌더 대기 → DOM 에서 (코드, 종목명, 비중) 추출."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return []
    rows = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_context(user_agent=UA).new_page()
            page.goto(url, wait_until='domcontentloaded', timeout=timeout_ms)
            page.wait_for_selector('%s tbody tr' % table_selector, timeout=timeout_ms)
            rows = page.eval_on_selector_all(
                '%s tbody tr' % table_selector,
                'els => els.map(tr => Array.from(tr.querySelectorAll("td,th")).map(td => td.innerText.trim()))')
            browser.close()
    except Exception as e:
        print('[browser] %s: %s' % (url, type(e).__name__), file=sys.stderr)
        return []
    return rows


def fetch_browser_tier(code, name):
    src = BROWSER_SOURCES.get(brand_of(name) or '')
    if not src:
        return []
    cells = fetch_via_browser(src['url'].format(code=code), src['table'])
    parsed = []
    for row in cells:
        # 각 행에서 6자리 코드/티커 한 칸과 마지막 숫자 칸(비중)을 찾는다
        code_cell = next((c for c in row if is_kr_code(c.upper()) or re.fullmatch(r'[A-Z.]{1,6}', c.upper())), None)
        weight = None
        for c in reversed(row):
            try:
                v = float(c.replace('%', '').replace(',', ''))
                if 0 < v <= 100:
                    weight = v
                    break
            except Exception:
                continue
        nm = next((c for c in row if len(c) > 1 and not re.fullmatch(r'[\d.,%\-]+', c)), None)
        if code_cell and weight:
            parsed.append((code_cell.upper(), nm or code_cell, weight))
    return merge_holdings(parsed)


# ── 수집 대상 (KV 보유 종목) ─────────────────────────────────────
def kv_assets():
    url = os.environ.get('KV_REST_API_URL', '').rstrip('/')
    token = os.environ.get('KV_REST_API_TOKEN', '')
    if not url or not token:
        print('[kv] KV_REST_API_URL / KV_REST_API_TOKEN 미설정', file=sys.stderr)
        return []
    try:
        req = urllib.request.Request(url + '/get/assets',
                                     headers={'Authorization': 'Bearer ' + token})
        with urllib.request.urlopen(req, timeout=20) as r:
            body = json.loads(r.read().decode('utf-8', 'replace'))
        raw = body.get('result')
        if isinstance(raw, str):
            raw = json.loads(raw)
    except Exception as e:
        print('[kv] %s: %s' % (type(e).__name__, e), file=sys.stderr)
        return []
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):                       # {소유주: [자산...]} 형태도 지원
        flat = []
        for owner, items in raw.items():
            if isinstance(items, list):
                for it in items:
                    if isinstance(it, dict):
                        it.setdefault('owner', owner)
                        flat.append(it)
        return flat
    return []


def strip_ticker(t):
    return re.sub(r'\.(KS|KQ|T)$', '', str(t or '').strip().upper())


def is_overseas_etf(sym):
    """해외 ETF 판별 — 이름 휴리스틱 대신 yfinance 펀드 데이터 접근 가능 여부로 본다."""
    try:
        import yfinance as yf
        fd = yf.Ticker(sym).funds_data
        return fd is not None and fd.top_holdings is not None and not fd.top_holdings.empty
    except Exception:
        return False


_kr_etf_master = None


def kr_etf_master():
    """국내 ETF 단축코드 → 종목명. 로컬 data/stocks.json 의 시장구분=='ETF' 행을 쓴다.

    KRX 전종목 API 는 이제 회원 로그인을 요구하므로 ETF 판별을 여기에 의존할 수 없다.
    이 파일은 이미 프런트 자동완성(window._krStocksDB)용으로 커밋돼 있어 추가 요청이 없고,
    이름 휴리스틱(브랜드 정규식)보다 정확하다.
    """
    global _kr_etf_master
    if _kr_etf_master is not None:
        return _kr_etf_master
    _kr_etf_master = {}
    try:
        with open(os.path.join(ROOT, 'data', 'stocks.json'), encoding='utf-8') as f:
            for row in json.load(f):
                if not isinstance(row, dict) or row.get('시장구분') != 'ETF':
                    continue
                code = str(row.get('종목코드') or '').strip().upper()
                if code:
                    _kr_etf_master[code] = str(row.get('종목명') or '').strip()
    except Exception as e:
        print('[etf master] %s: %s' % (type(e).__name__, e), file=sys.stderr)
    return _kr_etf_master


def resolve_targets(explicit=None):
    """수집 대상 [(code, name)] 결정."""
    if explicit:
        out = []
        for t in explicit:
            raw = str(t or '').strip().upper()
            c = strip_ticker(raw)
            if not c:
                continue
            out.append((c, kr_etf_master().get(c) or c, raw))
        return out

    master = kr_etf_master()
    previous = load_previous().get('etfs', {})
    targets, seen = [], set()
    for item in kv_assets():
        if not isinstance(item, dict) or item.get('grp') != '주식':
            continue
        try:
            if float(item.get('qty') or 0) <= 0:
                continue
        except Exception:
            continue
        raw = str(item.get('tkr') or '').strip().upper()
        code = strip_ticker(raw)
        if not code or code in seen:
            continue
        if is_kr_code(code):
            if code not in master:            # 로컬 ETF 목록에 있으면 국내 ETF
                continue
            seen.add(code)
            targets.append((code, master.get(code) or item.get('name') or code, code))
        else:
            marked_etf = str(item.get('market') or item.get('marketType') or item.get('type') or '').upper() == 'ETF'
            # A temporary Yahoo failure must not drop a previously collected, still-held ETF.
            if not (marked_etf or code in previous or code in INVESCO_CUSIPS or is_overseas_etf(raw)):
                continue
            seen.add(code)
            targets.append((code, item.get('name') or code, raw))
    return targets


# ── 수집 ────────────────────────────────────────────────────────
def parse_proshares_holdings(text):
    """Read the complete issuer table, retaining original physical-stock weights.

    Swap/index exposure rows are not direct stock positions. Reject changed or
    truncated table schemas instead of marking a silently shortened list full.
    """
    section = re.search(r'<section\b[^>]*id="Holdings"[^>]*>(.*?)</section>', text, re.S | re.I)
    if not section:
        return [], None
    table = re.search(r'<table\b[^>]*id="holdings"[^>]*>(.*?)</table>', section[1], re.S | re.I)
    date = re.search(r'as of\s+(\d{1,2})/(\d{1,2})/(\d{4})', section[1], re.I)
    if not table or not date or not all(s in table[1] for s in ('Exposure Weight', 'Ticker', 'Market Value')):
        return [], None
    try:
        as_of = datetime.date(int(date[3]), int(date[1]), int(date[2]))
        if as_of > datetime.date.today():
            return [], None
        parser = _HtmlTableRowsParser()
        parser.feed(table[1])
        picked = []
        for cells in parser.rows:
            if len(cells) != 7:
                return [], None
            weight, code, name, exposure, market, shares, sedol = cells
            # Physical positions have market value; derivative notionals are
            # separately published and must never enter stock look-through.
            if code in ('--', '—', '-', '') or exposure not in ('--', '—', '-', '') or re.search(r'MNY\s+MKT|MONEY\s+MARKET', name, re.I) or not is_equity_row(code, name):
                continue
            ticker = norm_holding_code(code)
            w = float(weight.replace('%', '').replace(',', ''))
            if not math.isfinite(w) or w < 0 or not market.startswith('$'):
                return [], None
            if w > 0:
                picked.append((ticker, name, w))
        # QLD is a broad Nasdaq portfolio; a top-ten response is incomplete.
        if len(picked) < 90:
            return [], None
        return merge_holdings(picked), as_of.isoformat()
    except (ValueError, TypeError):
        return [], None


def fetch_proshares(code):
    if code != 'QLD':
        return [], None
    try:
        req = urllib.request.Request('https://www.proshares.com/our-etfs/leveraged-and-inverse/qld', headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=EXTERNAL_SOURCE_TIMEOUT) as response:
            return parse_proshares_holdings(response.read().decode('utf-8'))
    except Exception as exc:
        print('[proshares] %s: %s' % (code, exc), file=sys.stderr)
        return [], None


class _FunEtfFormParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.params = {}

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'input' and a.get('name') in ('itemId', 'fundCd', 'repFundCd', 'gijunYmd', 'kodexPdfYmd'):
            self.params[a['name']] = a.get('value', '')


def parse_funetf_holdings(rows, isin):
    """Full dated PDF basket only: preserve published weights, reject gaps.

    The UI's monthly zeroinstock top holdings are deliberately not used.
    """
    if not isinstance(rows, list) or not rows:
        return []
    picked = []
    for row in rows:
        if not isinstance(row, dict) or row.get('etfCd') != isin or row.get('total') != len(rows):
            return []
        name = str(row.get('citmNm') or '')
        if NON_EQUITY_NAME_RE.search(name) or re.search(r'현금|예금|통화안정증권|MNY\s*MKT', name, re.I) or row.get('viewGrp') == 'N':
            continue
        try:
            w = float(row['evP'])
        except (KeyError, ValueError, TypeError):
            return []
        if not math.isfinite(w) or w < 0:
            return []
        if not w:
            continue
        raw_ticker = str(row.get('ticker') or '').strip()
        raw_ticker = re.sub(r'\s+(US|KS|KQ|JP|HK|CH|TT|LN|GR|FP)$', '', raw_ticker, flags=re.I)
        ticker = norm_holding_code(raw_ticker.replace('/', '.') or row.get('grpItmNo'))
        if not ticker or not is_equity_row(ticker, name):
            return []
        picked.append((ticker, name, w))
    return merge_holdings(picked)


_funetf_catalog = None


def fetch_funetf(code):
    global _funetf_catalog
    try:
        if _funetf_catalog is None:
            catalog = http_json('https://www.funetf.co.kr/api/public/quickSearch/etf', timeout=EXTERNAL_SOURCE_TIMEOUT)
            _funetf_catalog = {r['itemId'][3:9]: r['itemId'] for r in catalog if isinstance(r, dict) and r.get('nation') == 'KR' and re.fullmatch(r'KR7[0-9A-Z]{6}\d{3}', str(r.get('itemId', '')))}
        isin = _funetf_catalog.get(code)
        if not isin:
            return [], None
        url = 'https://www.funetf.co.kr/product/etf/view/' + isin
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=EXTERNAL_SOURCE_TIMEOUT) as response:
            html = response.read().decode('utf-8')
        parser = _FunEtfFormParser()
        parser.feed(html)
        date = re.search(r'(?:let|const|var)\s+etfPdfYmd\s*=\s*[\"\'](\d{8})[\"\']', html)
        if not date or parser.params.get('itemId') != isin:
            return [], None
        as_of = datetime.datetime.strptime(date[1], '%Y%m%d').date()
        korea_today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date()
        if as_of > korea_today:
            return [], None
        parser.params['etfPdfYmd'] = date[1]
        rows = http_json('https://www.funetf.co.kr/api/public/product/view/etfpdf?' + urllib.parse.urlencode(parser.params), headers={'Referer': url}, timeout=EXTERNAL_SOURCE_TIMEOUT)
        holdings = parse_funetf_holdings(rows, isin)
        return holdings, as_of.isoformat() if holdings else None
    except Exception as exc:
        print('[funetf] %s: %s' % (code, exc), file=sys.stderr)
        return [], None


def collect_one(code, name, lookup=None):
    """→ (holdings, equityWeight, asOf, source) / 실패 시 ([], 0, None, None).

    code   : 접미사를 뗀 코드 — JSON 키이자 프런트 cbStrip() 결과와 일치해야 한다
    lookup : 외부 조회용 원본 티커. 야후는 일본 종목을 '1617.T' 로만 인식하므로
             접미사를 뗀 '1617' 로 조회하면 실패한다. 미지정이면 code 를 쓴다.
    """
    today = datetime.date.today().isoformat()
    lookup = lookup or code

    if is_kr_code(code):
        h, as_of = fetch_funetf(code)
        if h:
            return h, round(sum(x['w'] for x in h), 2), as_of, 'FunETF'
        h, eq, as_of = fetch_krx(code)
        if h:
            return h, eq, as_of, 'krx'
        h, as_of = fetch_time(code)
        if h:
            return h, round(sum(x['w'] for x in h), 2), as_of, 'provider:TIME'
        h, as_of = fetch_provider(code, name)
        if h:
            return h, round(sum(x['w'] for x in h), 2), as_of, 'provider'
        h, eq, as_of = fetch_zeroin(code)
        if h:
            return h, eq, as_of, 'zeroin'
        h = fetch_naver(code)
        if h:
            return h, round(sum(x['w'] for x in h), 2), None, 'naver'
    else:
        h, as_of = fetch_proshares(code)
        if h:
            return h, round(sum(x['w'] for x in h), 2), as_of, 'provider:ProShares'
        h, as_of = fetch_invesco(code)
        if h:
            return h, round(sum(x['w'] for x in h), 2), as_of, 'provider:Invesco'
        h = fetch_yfinance(lookup)
        if h:
            return h, round(sum(x['w'] for x in h), 2), None, 'yfinance'
        h = fetch_stockanalysis(lookup)
        if h:
            return h, round(sum(x['w'] for x in h), 2), None, 'stockanalysis'
        alias = ETF_ALIAS.get(lookup) or ETF_ALIAS.get(code)
        if alias:
            h = fetch_yfinance(alias) or fetch_stockanalysis(alias)
            if h:
                return h, round(sum(x['w'] for x in h), 2), None, 'alias:' + alias

    h = fetch_browser_tier(code, name)        # 4순위
    if h:
        return h, round(sum(x['w'] for x in h), 2), None, 'browser'
    return [], 0.0, None, None


def load_previous():
    try:
        with open(OUT_PATH, encoding='utf-8') as f:
            prev = json.load(f)
        if isinstance(prev, dict) and isinstance(prev.get('etfs'), dict):
            return prev
    except Exception:
        pass
    return {'etfs': {}}


def clean_snapshot(entry):
    """Legacy snapshots may contain futures/cash misclassified as stocks."""
    if not isinstance(entry, dict):
        return None
    rows = entry.get('holdings') or []
    clean = merge_holdings([(norm_holding_code(h.get('t')), h.get('n', ''), h.get('w'))
                            for h in rows if isinstance(h, dict)
                            and isinstance(h.get('w'), (int, float))
                            and is_equity_row(norm_holding_code(h.get('t')), h.get('n', ''))])
    if not clean:
        return None
    result = {**entry, 'holdings': clean, 'equityWeight': round(sum(h['w'] for h in clean), 4)}
    if len(clean) != len(rows) or not entry.get('coverage'):
        result['coverage'] = 'partial'
    return result


def dated_snapshot(entry):
    if not entry or not entry.get('asOf'):
        return None
    try:
        datetime.date.fromisoformat(entry['asOf'])
    except (ValueError, TypeError):
        return None
    return {k: entry.get(k) for k in ('asOf', 'source', 'coverage', 'holdings')}


def preserve_history(entry, old):
    # One observation per source/date. Same-date corrections replace the old record.
    # Partial lists are retained too, but the UI never calls absent rows exits.
    snapshots = {}
    for raw in (old or {}).get('history', []) + [old, entry]:
        s = dated_snapshot(clean_snapshot(raw))
        if s:
            snapshots[(s['asOf'], s['source'])] = s
    entry['history'] = sorted(snapshots.values(), key=lambda x: (x['asOf'], x['source'] or ''))[-30:]
    return entry


def snapshot_stale(entry, today):
    try:
        day = datetime.date.fromisoformat(entry.get('asOf') or '')
    except (ValueError, TypeError):
        return True
    if day > today:
        return True
    age = sum((day + datetime.timedelta(days=i)).weekday() < 5 for i in range(1, (today-day).days+1))
    active = entry.get('active') or re.search(r'액티브|\bACTIVE\b', entry.get('name') or '', re.I)
    return age > (2 if active else 5)


def run(targets, dry_run=False):
    prev = load_previous()
    etfs, failures = {}, []
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date().isoformat()
    summary = {'complete': 0, 'partial': 0, 'retained': 0, 'missing': 0}

    for code, name, lookup in targets:
        old = clean_snapshot(prev['etfs'].get(code))
        holdings, eq, as_of, source = collect_one(code, name, lookup)
        if holdings and old and as_of and old.get('asOf') and as_of < old['asOf']:
            holdings = []  # A stale provider response must not roll the fund backwards.
        if holdings:
            coverage = 'full' if source in ('krx', 'zeroin', 'provider', 'provider:TIME', 'provider:Invesco', 'provider:ProShares', 'FunETF') else 'partial'
            etfs[code] = {'name': name, 'asOf': as_of, 'source': source,
                          'equityWeight': eq, 'holdings': holdings, 'coverage': coverage,
                          'fetchedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                          'lastAttempt': today, 'retained': False,
                          'active': bool(re.search(r'액티브|\bACTIVE\b', name, re.I))}
            summary['complete' if coverage == 'full' else 'partial'] += 1
            print('  %-8s %-28s %4d종목  주식비중 %5.1f%%  (%s, %s)'
                  % (code, name[:28], len(holdings), eq, source, as_of))
        else:
            if old and old.get('holdings'):
                # 수집 실패 + 직전 데이터 있음 → 직전 스냅샷 유지 (asOf 가 곧 stale 표시)
                etfs[code] = {**old, 'lastAttempt': today, 'retained': True}
                summary['retained'] += 1
                print('  %-8s %-28s 수집 실패 → 직전 스냅샷 유지 (%s)' % (code, name[:28], old.get('asOf')))
            else:
                failures.append(name or code)
                summary['missing'] += 1
                print('  %-8s %-28s 수집 실패' % (code, name[:28]))
        if code in etfs:
            preserve_history(etfs[code], old)

    stale_count = sum(snapshot_stale(e, datetime.date.fromisoformat(today)) for e in etfs.values())
    doc = {'asOf': today, 'etfs': etfs, 'failures': failures, 'summary': {**summary, 'staleOrUndated': stale_count}, 'schemaVersion': 2}
    print('품질 요약: 전체 %d / 일부 %d / 이전 유지 %d / 미조회 %d' % tuple(summary.values()))
    print('기준일 지연·미확인: %d' % stale_count)
    if summary['partial'] or summary['retained'] or summary['missing'] or stale_count:
        print('::warning::ETF 일부 자료가 불완전하거나 이전 자료입니다. ETF 탐색 화면의 기준일과 수집 상태를 확인하세요.')
    print('\n수집 %d / 실패 %d' % (len(etfs), len(failures)))
    if dry_run:
        print('(--dry-run: 파일을 쓰지 않음)')
        return doc
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write('\n')
    print('→ %s' % os.path.relpath(OUT_PATH, ROOT))
    return doc


def smoke(code):
    """수집 경로가 살아 있는지 확인. 행 수가 기준 미만이면 실패시킨다.

    KRX 하나만 보지 않고 실제 수집과 같은 폴백 사슬(collect_one)을 그대로 태운다 —
    어느 소스든 정상 데이터를 주면 통과다. KRX 만 검사하면 자격 없이도 동작하는
    네이버 경로가 살아 있는데 job 이 실패해버린다.
    """
    name = kr_etf_master().get(code) or code
    print('스모크 테스트: %s (%s)' % (code, name))
    print('  KRX 로그인 자격: %s' % ('있음' if krx_available() else '없음 → ZEROIN 등 대체 소스 사용'))
    holdings, eq, as_of, source = collect_one(code, name)
    print('  구성종목 %d개 · 주식비중 %.1f%% · 기준일 %s · 소스 %s'
          % (len(holdings), eq, as_of, source))
    for h in holdings[:5]:
        print('    %-12s %-28s %6.2f%%' % (h['t'], h['n'][:28], h['w']))
    if len(holdings) < SMOKE_HARD_MIN:
        old = load_previous().get('etfs', {}).get(code)
        old_holdings = old.get('holdings') if isinstance(old, dict) else None
        try:
            old_date = datetime.date.fromisoformat(str(old.get('asOf')))
            old_age = (datetime.date.today() - old_date).days
        except Exception:
            old_age = SMOKE_CACHE_MAX_AGE_DAYS + 1
        if (isinstance(old_holdings, list) and len(old_holdings) >= SMOKE_HARD_MIN
                and 0 <= old_age <= SMOKE_CACHE_MAX_AGE_DAYS):
            print('\n경고: 실시간 수집 경로가 모두 실패했습니다. 빈 데이터로 덮어쓰지 않고 '
                  '직전 정상 스냅샷 %d행(%s, %d일 전)을 검증해 이번 실행을 계속합니다.'
                  % (len(old_holdings), old.get('asOf'), old_age))
            return 0
        print('\n실패: %d행은 정상 범위가 아닙니다(최소 %d행). 수집 경로를 점검해야 합니다.'
              % (len(holdings), SMOKE_HARD_MIN), file=sys.stderr)
        return 1
    if len(holdings) < SMOKE_EXPECT_ROWS:
        print('\n경고: %d행 — 소스가 상위 일부만 제공하는 것으로 보입니다(기대 %d행 이상). '
              '데이터는 사용하되 룩스루가 과소 집계될 수 있습니다.'
              % (len(holdings), SMOKE_EXPECT_ROWS))
    print('\n통과')
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tickers', help='쉼표로 구분한 수집 대상 (미지정 시 KV 보유 ETF)')
    ap.add_argument('--smoke', metavar='CODE', help='단일 국내 ETF 스모크 테스트')
    ap.add_argument('--dry-run', action='store_true', help='파일을 쓰지 않고 요약만 출력')
    args = ap.parse_args()

    if args.smoke:
        return smoke(args.smoke.strip())

    explicit = [t for t in (args.tickers or '').split(',') if t.strip()] or None
    targets = resolve_targets(explicit)
    if not targets:
        print('수집 대상 ETF가 없습니다.', file=sys.stderr)
        return 0
    print('수집 대상 %d종목' % len(targets))
    run(targets, dry_run=args.dry_run)
    return 0


if __name__ == '__main__':
    sys.exit(main())
