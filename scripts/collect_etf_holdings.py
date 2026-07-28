#!/usr/bin/env python3
"""보유 ETF 구성종목 수집 → data/etf_holdings.json.

GitHub Actions 배치 전용이다. 브라우저에서 외부 사이트를 직접 부르면 CORS 로 막히므로
수집은 전부 CI 에서 하고, 대시보드는 커밋된 JSON 만 읽는다.

수집 우선순위
  1순위  KRX 내부 JSON API (국내 ETF)  — bld 값은 pykrx 소스에서 확인한 것
  2순위  네이버 증권(국내) / yfinance·stockanalysis(해외) / 운용사 어댑터
  3순위  Playwright 헤드리스 브라우저 (1·2순위 실패 ETF만)

사용법
  python scripts/collect_etf_holdings.py                 # KV 보유 ETF 전체 수집
  python scripts/collect_etf_holdings.py --tickers 133690,QQQ
  python scripts/collect_etf_holdings.py --smoke 133690  # 스모크 테스트(행 수 부족하면 exit 1)
  python scripts/collect_etf_holdings.py --dry-run       # 파일을 쓰지 않고 요약만 출력
"""

import argparse
import datetime
import json
import os
import re
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from etf_common import (  # noqa: E402
    ETF_ALIAS, UA, fetch_naver, fetch_stockanalysis, fetch_yfinance,
    http_json, is_kr_code, merge_holdings, parse_krx_pdf,
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

# 스모크 기준. KRX 는 133690 에 100종목 내외를 주지만 네이버 등 대체 소스는 상위 N개만
# 줄 수 있어, "정상인데 수가 적은" 경우와 "파싱이 깨진" 경우를 구분한다.
SMOKE_HARD_MIN = 5    # 이하이면 명백히 깨진 것 → job 실패 (요구사항: "1~2줄만 나오면 멈추고 보고")
SMOKE_EXPECT_ROWS = 30  # 이하이면 경고만 — 데이터는 쓸 수 있으나 소스가 상위 일부만 준 상태


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
    KRX 로그인 자격이 없으면 조용히 건너뛴다(네이버 등 다음 소스가 받는다).
    """
    if not krx_available():
        return [], 0.0, None
    ent = krx_isin_map().get(code)
    if not ent:
        print('[krx pdf] %s: ISIN 맵에 없음 (마스터 조회 자체가 비었을 가능성)' % code, file=sys.stderr)
        return [], 0.0, None
    print('[krx pdf] %s → ISIN %s (%s)' % (code, ent['isin'], ent.get('name')), file=sys.stderr)
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
        holdings, eq = parse_krx_pdf(rows)
        print('[krx pdf] %s %s: 파싱 후 주식 %d행 (equityWeight %.1f%%)'
              % (code, d, len(holdings), eq), file=sys.stderr)
        if holdings:
            return holdings, eq, '%s-%s-%s' % (d[:4], d[4:6], d[6:])
    return [], 0.0, None


# ── 2순위 · 운용사 내부 API 어댑터 ───────────────────────────────
# 브랜드 → callable(code) -> [{'t','n','w'}]
# 각 운용사의 자산구성 XHR 엔드포인트는 실제 Network 탭 관찰이 필요해 아직 비어 있다.
# 추측한 URL 을 넣으면 죽은 코드가 되므로, 첫 수집 실행의 failures 를 근거로 채운다.
PROVIDER_ADAPTERS = {}

BRAND_RE = re.compile(r'^(TIGER|KODEX|RISE|PLUS|TIME|ACE|SOL|KOSEF|HANARO|KBSTAR|ARIRANG)', re.I)


def brand_of(name):
    m = BRAND_RE.match((name or '').strip())
    return m.group(1).upper() if m else None


def fetch_provider(code, name):
    fn = PROVIDER_ADAPTERS.get(brand_of(name) or '')
    if not fn:
        return []
    try:
        return fn(code) or []
    except Exception as e:
        print('[provider] %s: %s' % (code, type(e).__name__), file=sys.stderr)
        return []


# ── 3순위 · Playwright ──────────────────────────────────────────
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
            if not is_overseas_etf(raw):      # 원본 티커로 판별 (예: 1617.T)
                continue
            seen.add(code)
            targets.append((code, item.get('name') or code, raw))
    return targets


# ── 수집 ────────────────────────────────────────────────────────
def collect_one(code, name, lookup=None):
    """→ (holdings, equityWeight, asOf, source) / 실패 시 ([], 0, None, None).

    code   : 접미사를 뗀 코드 — JSON 키이자 프런트 cbStrip() 결과와 일치해야 한다
    lookup : 외부 조회용 원본 티커. 야후는 일본 종목을 '1617.T' 로만 인식하므로
             접미사를 뗀 '1617' 로 조회하면 실패한다. 미지정이면 code 를 쓴다.
    """
    today = datetime.date.today().isoformat()
    lookup = lookup or code

    if is_kr_code(code):
        h, eq, as_of = fetch_krx(code)
        if h:
            return h, eq, as_of, 'krx'
        h = fetch_provider(code, name)
        if h:
            return h, round(sum(x['w'] for x in h), 2), today, 'provider'
        h = fetch_naver(code)
        if h:
            return h, round(sum(x['w'] for x in h), 2), today, 'naver'
    else:
        h = fetch_yfinance(lookup)
        if h:
            return h, round(sum(x['w'] for x in h), 2), today, 'yfinance'
        h = fetch_stockanalysis(lookup)
        if h:
            return h, round(sum(x['w'] for x in h), 2), today, 'stockanalysis'
        alias = ETF_ALIAS.get(lookup) or ETF_ALIAS.get(code)
        if alias:
            h = fetch_yfinance(alias) or fetch_stockanalysis(alias)
            if h:
                return h, round(sum(x['w'] for x in h), 2), today, 'alias:' + alias

    h = fetch_browser_tier(code, name)        # 3순위
    if h:
        return h, round(sum(x['w'] for x in h), 2), today, 'browser'
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


def run(targets, dry_run=False):
    prev = load_previous()
    etfs, failures = {}, []

    for code, name, lookup in targets:
        holdings, eq, as_of, source = collect_one(code, name, lookup)
        if holdings:
            etfs[code] = {'name': name, 'asOf': as_of, 'source': source,
                          'equityWeight': eq, 'holdings': holdings}
            print('  %-8s %-28s %4d종목  주식비중 %5.1f%%  (%s, %s)'
                  % (code, name[:28], len(holdings), eq, source, as_of))
        else:
            old = prev['etfs'].get(code)
            if old and old.get('holdings'):
                # 수집 실패 + 직전 데이터 있음 → 직전 스냅샷 유지 (asOf 가 곧 stale 표시)
                etfs[code] = old
                print('  %-8s %-28s 수집 실패 → 직전 스냅샷 유지 (%s)' % (code, name[:28], old.get('asOf')))
            else:
                failures.append(name or code)
                print('  %-8s %-28s 수집 실패' % (code, name[:28]))

    doc = {'asOf': datetime.date.today().isoformat(), 'etfs': etfs, 'failures': failures}
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
    print('  KRX 로그인 자격: %s' % ('있음' if krx_available() else '없음 → 네이버 등 대체 소스 사용'))
    holdings, eq, as_of, source = collect_one(code, name)
    print('  구성종목 %d개 · 주식비중 %.1f%% · 기준일 %s · 소스 %s'
          % (len(holdings), eq, as_of, source))
    for h in holdings[:5]:
        print('    %-12s %-28s %6.2f%%' % (h['t'], h['n'][:28], h['w']))
    if len(holdings) < SMOKE_HARD_MIN:
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
