#!/usr/bin/env python3
"""운용사 공식 보유명세 파일 → 구성종목.

해외 ETF 중 `1629`(NEXT FUNDS) · `SPYM`(State Street) · `DRAM`(Roundhill)은 공개 조회 소스가
상위 10종목(또는 3종목)만 돌려준다. stockanalysis 를 yfinance 앞으로 옮겨 GitHub Actions 에서
실제로 돌려 봤지만 세 펀드 모두 그대로였다(run 35073894717). funetf.co.kr 은 국내 상장 ETF
카탈로그라 해당 없다. 그래서 운용사가 공시하는 보유명세 파일 자체를 리포에 커밋해 쓴다.

**표준 라이브러리만 쓴다.** 수집기는 모듈 최상단에서 서드파티를 import 하지 않는 구조이고
CI 는 numpy/pandas 만 설치한다. xlsx 는 zipfile+ElementTree 로, CSV 는 csv 모듈로 읽는다
(openpyxl 을 쓰지 않는다).

index.json 에 `url` 이 있으면 커밋된 파일보다 운용사 사이트의 새 파일을 먼저 써 보고, 실패하면
커밋된 파일로 내려간다. 언제 받을지는 수집기가 상품의 리밸런싱·공시 주기로 정한다
(collect_etf_holdings.py 의 rebalance_due) — 매일 받지 않는다.
"""

import csv
import datetime
import json
import os
import re
import tempfile
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

from etf_common import UA, is_equity_row, merge_holdings, norm_holding_code

# 운용사 다운로드 응답 대기 상한. 국내 사이트가 막혀도 전체 배치가 오래 붙들리지
# 않도록 EXTERNAL_SOURCE_TIMEOUT(12s, collect_etf_holdings.py)과 같은 자리수로 둔다.
DOWNLOAD_TIMEOUT = 12
# 커밋된 파일과 같은 형식이어야 파서가 읽으므로 저장 확장자를 맞춘다.
_FORMAT_SUFFIX = {'nextfunds_xlsx': '.xlsx', 'spdr_xlsx': '.xlsx', 'roundhill_csv': '.csv'}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_DIR = os.path.join(ROOT, 'data', 'etf_sources')
INDEX_PATH = os.path.join(SOURCE_DIR, 'index.json')

# 파일의 비중이 순자산의 몇 %를 설명하는지 — 이것이 coverage='full' 의 근거다.
# 상위 N개 목록은 이 밴드에 들어올 수 없다. 현금 비중만큼의 여유를 준다.
WEIGHT_SUM_MIN = 97.0
WEIGHT_SUM_MAX = 103.0

# Bloomberg 식 거래소 접미사. 공백 뒤를 무조건 버리지 않고 이 목록에 한해서만 뗀다 —
# '005930 KS' → '005930', '285A JP' → '285A'(직접 보유 285A.T 의 cbStrip 결과와 일치).
EXCHANGE_SUFFIXES = {
    'KS', 'KQ', 'KP', 'JP', 'JT', 'TT', 'HK', 'CH', 'C1', 'C2', 'SS', 'SZ',
    'US', 'UN', 'UQ', 'UW', 'LN', 'GR', 'GY', 'FP', 'NA', 'IM', 'SM', 'SW',
    'AU', 'AT', 'CN', 'CT', 'BZ', 'IN', 'ID', 'SP',
}
_SUFFIX_RE = re.compile(r'^([0-9A-Z.\-]{1,10})\s+([A-Z0-9]{1,2})$')

# Roundhill 표의 스왑 행은 이름에 SWAP, 식별자에 TRS 가 붙고, 편입 직후에는 'SWP' 로만
# 적힌 행(이름도 식별자와 같음)이 섞여 나온다 — 셋 다 스왑이다.
_SWAP_RE = re.compile(r'\bSWAP\b|\bTRS\b|\bSWP\b', re.I)
_SWAP_TAIL_RE = re.compile(r'[\s,\-]*\b(?:SWAP|SWP)\b.*$', re.I)


def strip_exchange_suffix(code):
    """'005930 KS' → '005930'. 알려진 접미사가 아니면 원문 그대로."""
    s = str(code or '').strip().upper()
    m = _SUFFIX_RE.match(s)
    if m and m.group(2) in EXCHANGE_SUFFIXES:
        return m.group(1)
    return s


def _num(v):
    """'19.03%' / '0.2170' / '-2.42E-4' → float. 실패하면 None."""
    if v is None:
        return None
    s = str(v).replace(',', '').replace('%', '').replace(' ', '').strip()
    if not s:
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return f if f == f and abs(f) != float('inf') else None


# ── xlsx (zipfile + ElementTree) ────────────────────────────────
_NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
_RNS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
_COL_RE = re.compile(r'([A-Z]+)')


def xlsx_rows(path, sheet_name):
    """xlsx 의 한 시트 → [(행번호, {열문자: 값})]. 시트는 **이름으로** 고른다.

    1629 파일의 첫 시트는 '$MetaData' 라 인덱스로 고르면 엉뚱한 시트를 읽는다.
    """
    with zipfile.ZipFile(path) as z:
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            for si in ET.fromstring(z.read('xl/sharedStrings.xml')).iter(_NS + 'si'):
                shared.append(''.join(t.text or '' for t in si.iter(_NS + 't')))
        rels = {r.get('Id'): r.get('Target')
                for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        target = None
        for sh in ET.fromstring(z.read('xl/workbook.xml')).iter(_NS + 'sheet'):
            if sh.get('name') == sheet_name:
                target = rels.get(sh.get(_RNS + 'id'))
                break
        if not target:
            raise KeyError('시트 없음: %s' % sheet_name)
        target = target if target.startswith('xl/') else 'xl/' + target.lstrip('/')
        out = []
        for row in ET.fromstring(z.read(target)).iter(_NS + 'row'):
            cells = {}
            for c in row.iter(_NS + 'c'):
                col = _COL_RE.match(c.get('r') or 'A')
                v, inline = c.find(_NS + 'v'), c.find(_NS + 'is')
                if c.get('t') == 's' and v is not None:
                    val = shared[int(v.text)]
                elif inline is not None:
                    val = ''.join(t.text or '' for t in inline.iter(_NS + 't'))
                else:
                    val = v.text if v is not None else ''
                cells[col.group(1) if col else 'A'] = val or ''
            out.append((int(row.get('r') or len(out) + 1), cells))
        return out


def _cell(cells, col):
    # 엑셀이 셀 안의 줄바꿈을 _x000D_\n 으로 이스케이프한다 — 헤더 비교 전에 푼다.
    return str(cells.get(col, '')).replace('_x000D_', '').replace('　', ' ').strip()


# ── 운용사별 파서 ────────────────────────────────────────────────
# 각 파서 → (rows, asOf, complete). rows 는 [(티커, 이름, 비중%)] — 재정규화하지 않는다.

_JP_DATE_RE = re.compile(r'(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日')
_NEXTFUNDS_HEADERS = ('No.', '銘柄コード', 'ISINコード', '銘柄', 'Name', '株数', '評価金額', '純資産比率')


def parse_nextfunds_xlsx(path, want_code):
    """NEXT FUNDS 보유明細 xlsx. 비중은 **분수**(0.217 = 21.7%)다."""
    rows = xlsx_rows(path, '保有明細')
    by_no = {n: c for n, c in rows}
    head = by_no.get(1, {})
    if _cell(head, 'A').upper() != str(want_code).upper():
        raise ValueError('펀드 코드 불일치: %r != %r' % (_cell(head, 'A'), want_code))
    m = _JP_DATE_RE.search(_cell(by_no.get(2, {}), 'B'))
    if not m:
        raise ValueError('기준일을 찾지 못함')
    as_of = datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
    hdr = by_no.get(3, {})
    for col, want in zip('ABCDEFGH', _NEXTFUNDS_HEADERS):
        if want not in _cell(hdr, col):
            raise ValueError('헤더 불일치 %s열: %r' % (col, _cell(hdr, col)))
    out, max_no, total = [], 0, 0.0
    for n, c in rows:
        if n < 4:
            continue
        no = _num(_cell(c, 'A'))
        w = _num(_cell(c, 'H'))
        if no is None or w is None:
            continue
        max_no = max(max_no, int(no))
        total += w * 100
        code = strip_exchange_suffix(_cell(c, 'B'))
        name = _cell(c, 'E') or _cell(c, 'D')
        if not is_equity_row(code, name):
            continue
        out.append((norm_holding_code(code), name, w * 100))
    # No. 최대값이 데이터 행 수와 같아야 목록이 잘리지 않은 것이다.
    complete = bool(out) and max_no == len([1 for n, c in rows if n >= 4 and _num(_cell(c, 'A')) is not None]) \
        and WEIGHT_SUM_MIN <= total <= WEIGHT_SUM_MAX
    return out, as_of, complete


_SPDR_DATE_RE = re.compile(r'(\d{1,2})-([A-Za-z]{3})-(\d{4})')
_MONTHS = {m: i + 1 for i, m in enumerate(
    ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])}
_SPDR_HEADERS = ('Name', 'Ticker', 'Identifier', 'SEDOL', 'Weight')


def parse_spdr_xlsx(path, want_ticker):
    """State Street(SPDR) holdings xlsx. 비중은 이미 퍼센트다.

    데이터 뒤에 A열만 채운 면책 문구 행이 붙는다 — 비중이 숫자로 읽히는 행만 받는다.
    행 수를 세어 자르지 않는다(면책 문구 개수가 바뀌면 깨진다).
    """
    rows = xlsx_rows(path, 'holdings')
    by_no = {n: c for n, c in rows}
    ticker_row = _cell(by_no.get(2, {}), 'B')
    if ticker_row.upper() != str(want_ticker).upper():
        raise ValueError('티커 불일치: %r != %r' % (ticker_row, want_ticker))
    m = _SPDR_DATE_RE.search(_cell(by_no.get(3, {}), 'B'))
    if not m or m.group(2).lower() not in _MONTHS:
        raise ValueError('기준일을 찾지 못함')
    as_of = datetime.date(int(m.group(3)), _MONTHS[m.group(2).lower()], int(m.group(1))).isoformat()
    hdr_no = next((n for n, c in rows if _cell(c, 'A') == 'Name' and _cell(c, 'B') == 'Ticker'), None)
    if hdr_no is None:
        raise ValueError('헤더 행을 찾지 못함')
    for col, want in zip('ABCDE', _SPDR_HEADERS):
        if _cell(by_no[hdr_no], col) != want:
            raise ValueError('헤더 불일치 %s열: %r' % (col, _cell(by_no[hdr_no], col)))
    out, total = [], 0.0
    for n, c in rows:
        if n <= hdr_no:
            continue
        w = _num(_cell(c, 'E'))
        if w is None:
            continue                     # 면책 문구 행 · 빈 행
        total += w
        code = strip_exchange_suffix(_cell(c, 'B'))
        name = _cell(c, 'A')
        if not is_equity_row(code, name):
            continue                     # MMF · E-MINI 선물 · 티커가 '-' 인 자리표시자
        out.append((norm_holding_code(code), name, w))
    return out, as_of, bool(out) and WEIGHT_SUM_MIN <= total <= WEIGHT_SUM_MAX


_ROUNDHILL_HEADERS = ('Date', 'Account', 'StockTicker', 'CUSIP', 'SecurityName', 'Weightings')


def _previous_weekday(day):
    day -= datetime.timedelta(days=1)
    while day.weekday() >= 5:
        day -= datetime.timedelta(days=1)
    return day


def _merge_named_swaps(rows):
    """[(티커, 이름, 식별자, 비중%)] → ([(코드, 이름, 비중%)], 표 전체 비중 합계).

    **기초자산이 명시된 스왑(TRS)을 그 종목의 노출로 센다.** 추론이 아니다 — 스왑 행의
    식별자 첫 토큰이 기초자산의 CUSIP/SEDOL 이고, 그 값이 같은 표의 현물 주식 행 식별자와
    일치한다(595112103→MU, 6771720→005930, 6450267→000660).
    QLD 금지 규칙은 바스켓 내용을 **알 수 없어서** 둔 것이라 여기에 해당하지 않는다.
    현물 행에 없는 기초자산(BTMTQT8 = 비상장 CXMT)은 식별자를 코드로 남긴다 —
    어떤 직접 보유와도 매칭되지 않으므로 허위 룩스루를 만들 수 없다.
    합계는 현금·국채·Cash&Other 까지 포함한 값이다(완전한 목록인지 판단하는 근거).
    """
    cash, swaps, total = [], [], 0.0
    for ticker, name, ident, w in rows:
        total += w
        if _SWAP_RE.search(name) or _SWAP_RE.search(ident):
            swaps.append((ident, name, w))
            continue
        if ident.upper().startswith('CASH'):
            continue
        code = strip_exchange_suffix(ticker)
        if not is_equity_row(code, name):
            continue                     # MMF · 미국채 · Cash&Other
        cash.append((norm_holding_code(code), name, w, ident.upper()))

    by_ident = {c[3]: (c[0], c[1]) for c in cash if c[3]}
    out = [(c[0], c[1], c[2]) for c in cash]
    for ident, name, w in swaps:
        under = ident.split()[0].upper() if ident.split() else ''
        hit = by_ident.get(under)
        if hit:
            out.append((hit[0], hit[1], w))
            continue
        code = norm_holding_code(under)
        if not code:
            continue
        out.append((code, _SWAP_TAIL_RE.sub('', name).strip(' -,') or code, w))
    return out, total


def parse_roundhill_csv(path, want_ticker):
    """Roundhill 전 상품 보유명세 CSV(FilepointRoundhill.40RU.RU_Holdings_MMDDYYYY.csv).

    한 파일에 모든 Roundhill 펀드가 들어 있어 `Account` 로 거른다. 사이트의 보유명세 PDF 는
    브라우저가 이 CSV 로 즉석 생성하는 것이라 같은 자료다.
    `Date` 열은 그 보유가 적용되는 **다음 거래일**이다(금요일 장 마감 기준 파일의 Date 는
    월요일) — 기준일은 그 직전 평일이다. 거래소 휴일은 저장소의 다른 평일 규칙처럼 반영하지 않는다.
    """
    with open(path, encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        missing = [h for h in _ROUNDHILL_HEADERS if h not in (reader.fieldnames or [])]
        if missing:
            raise ValueError('헤더 불일치: %s 없음' % ', '.join(missing))
        want = str(want_ticker or '').strip().upper()
        mine = [r for r in reader if (r.get('Account') or '').strip().upper() == want]
    if not mine:
        raise ValueError('펀드 행 없음: %r' % want_ticker)
    dates = {(r.get('Date') or '').strip() for r in mine}
    if len(dates) != 1:
        raise ValueError('적용일이 섞여 있음: %r' % sorted(dates))
    try:
        effective = datetime.datetime.strptime(dates.pop(), '%m/%d/%Y').date()
    except ValueError:
        raise ValueError('기준일을 찾지 못함')
    rows = []
    for r in mine:
        w = _num(r.get('Weightings'))
        if w is None:
            continue
        rows.append(((r.get('StockTicker') or '').strip(), (r.get('SecurityName') or '').strip(),
                     (r.get('CUSIP') or '').strip(), w))
    out, total = _merge_named_swaps(rows)
    # 표가 순자산 100%를 설명하면(현금·국채·Cash&Other 포함) 잘리지 않은 전체 목록이다.
    return out, _previous_weekday(effective).isoformat(), bool(out) and WEIGHT_SUM_MIN <= total <= WEIGHT_SUM_MAX


PARSERS = {
    'nextfunds_xlsx': parse_nextfunds_xlsx,
    'spdr_xlsx': parse_spdr_xlsx,
    'roundhill_csv': parse_roundhill_csv,
}


def load_index(path=INDEX_PATH):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f).get('sources') or {}
    except Exception:
        return {}


def _download_source(url, timeout=DOWNLOAD_TIMEOUT):
    """URL → 바이트. 실패하면 조용히 None(호출부가 커밋된 파일로 폴백)."""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.read()
    except (urllib.error.URLError, ValueError, OSError):
        return None


def _parse_and_validate(parser, path, expect, code):
    """파일 하나를 파싱하고 검증한다. 실패하면 예외를 던진다(호출부가 잡는다)."""
    rows, as_of, complete = parser(path, expect.get('id') or code)
    # 반올림 후 0.0000% 인 행은 버린다 — SPDR 표의 'CONTRA …'(합병 대기 자리표시자)처럼
    # 티커는 있지만 경제적 노출이 없는 행이 구성종목 목록에 섞이는 것을 막는다.
    holdings = [h for h in merge_holdings(rows) if h['w'] > 0]
    min_rows = int(expect.get('minRows') or 1)
    if len(holdings) < min_rows:
        raise ValueError('행 수 부족: %d < %d' % (len(holdings), min_rows))
    if not as_of:
        raise ValueError('기준일 없음')
    datetime.date.fromisoformat(as_of)
    return holdings, as_of, complete


_URL_DATE_TOKEN = '{MMDDYYYY}'


def source_urls(spec, today=None):
    """등록된 다운로드 주소 → 시도할 URL 목록(앞이 우선).

    `{MMDDYYYY}` 자리표시자가 있으면(Roundhill 처럼 파일명에 기준일이 들어가는 운용사)
    오늘부터 `urlLookbackDays` 일 거슬러 평일 후보를 만든다 — 운용사 사이트도 같은 방식으로
    최신 파일을 찾는다. 아직 안 올라온 날짜는 404 페이지가 돌아와 검증에서 걸러진다.
    """
    url = spec.get('url')
    if not url:
        return []
    if _URL_DATE_TOKEN not in url:
        return [url]
    today = today or datetime.date.today()
    days = max(1, int(spec.get('urlLookbackDays') or 7))
    out = []
    for i in range(days):
        day = today - datetime.timedelta(days=i)
        if day.weekday() < 5:
            out.append(url.replace(_URL_DATE_TOKEN, day.strftime('%m%d%Y')))
    return out


def fetch_local_source(code, verbose=True, today=None):
    """→ (holdings, asOf, complete, label). 등록·검증 실패는 조용히 ([], None, False, None).

    검증에 하나라도 걸리면 기존 수집 체인으로 폴백한다 — 지금보다 나빠지지 않는다.

    `url` 이 등록돼 있으면 운용사 사이트에서 새 파일을 내려받아 먼저 써 본다. 다운로드·파싱·
    검증 중 하나라도 실패하면 리포에 커밋된 파일로 내려간다 — url 이 없거나 깨져도 지금보다
    나빠지지 않는다. 검증 기준(식별자·기준일·헤더·비중 합계·행 수)은 다운로드본과 커밋된
    파일에 동일하게 적용한다. 언제 부를지는 수집기가 리밸런싱·공시 주기로 정한다.
    """
    spec = load_index().get(str(code).upper()) or load_index().get(str(code))
    if not spec:
        return [], None, False, None
    parser = PARSERS.get(spec.get('format'))
    if not parser:
        return [], None, False, None
    expect = spec.get('expect') or {}
    label = spec.get('label') or 'file'

    urls = source_urls(spec, today)
    failure = None
    for url in urls:
        raw = _download_source(url)
        if not raw:
            failure = '다운로드 실패', url
            continue
        suffix = _FORMAT_SUFFIX.get(spec.get('format'), '')
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(raw)
                tmp_path = tmp.name
            holdings, as_of, complete = _parse_and_validate(parser, tmp_path, expect, code)
            if verbose:
                print('[file] %s: %s %d종목 (기준일 %s, 주식비중 %.2f%%, %s, 다운로드)'
                      % (code, label, len(holdings), as_of,
                         sum(h['w'] for h in holdings), '전체' if complete else '부분'))
            return holdings, as_of, complete, label
        except Exception as e:
            failure = '다운로드본 사용 불가', e
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
    if failure and verbose:
        # 조용히 넘어가면 Actions 로그만 봐서는 등록한 주소가 살아 있는지 알 수 없다.
        tried = ', 주소 %d개 시도' % len(urls) if len(urls) > 1 else ''
        print('[file] %s: %s → 커밋된 파일로 폴백 (%s%s)' % (code, failure[0], failure[1], tried))

    path = os.path.join(SOURCE_DIR, spec.get('file') or '')
    if not os.path.isfile(path):
        return [], None, False, None
    try:
        holdings, as_of, complete = _parse_and_validate(parser, path, expect, code)
    except Exception as e:
        if verbose:
            print('[file] %s: 공식 보유명세 파일 사용 불가 → 기존 체인으로 폴백 (%s)' % (code, e))
        return [], None, False, None
    if verbose:
        print('[file] %s: %s %d종목 (기준일 %s, 주식비중 %.2f%%, %s)'
              % (code, label, len(holdings), as_of,
                 sum(h['w'] for h in holdings), '전체' if complete else '부분'))
    return holdings, as_of, complete, label


if __name__ == '__main__':
    import sys
    for arg in (sys.argv[1:] or sorted(load_index())):
        fetch_local_source(arg)
