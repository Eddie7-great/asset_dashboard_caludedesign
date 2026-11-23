#!/usr/bin/env python3
"""KRX(pykrx) 관문 `_krx_usable()` — 네트워크 없이 검증한다.

  python3 scripts/tests/test_dashboard_krx_gate.py

배경: KRX 는 회원 로그인(KRX_ID/KRX_PW) 없는 조회를 거부한다. pykrx 는 그 실패를 삼키고
빈 DataFrame 을 돌려주므로 결과는 어차피 yfinance 쪽에서 정해지는데, 종목마다 실패하는
KRX 왕복이 1~1.4초씩 걸려 국내 17종목 배당 조회가 24초가 됐다(2026-11-20 운영 로그).
관문은 (1) 자격이 없으면 KRX 를 한 번도 부르지 않고, (2) 자격이 있어도 프로세스당 확인 호출
한 번(10분 기억)으로 KRX 가 응답하지 않으면 건너뛴다. 건너뛴 결과는 'pykrx 가 빈 값을 준'
예전 경로와 같아야 한다 — 이 테스트는 두 경로를 같은 입력으로 돌려 결과를 대조한다.
"""

import ast
import datetime
import importlib.util
import os
import pathlib
import sys

try:
    import pandas as pd
except ImportError:
    # CI 에서는 quality.yml 이 pandas 를 설치한다. 조용히 SKIP 하면 회귀가 방치된다.
    if os.environ.get('CI'):
        print('FAIL KRX 관문 — CI 에서 pandas 가 설치되지 않았다')
        sys.exit(1)
    print('SKIP KRX 관문 (pandas 미설치 — 로컬 전용)')
    sys.exit(0)

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE_PATH = ROOT / 'api' / 'dashboard.py'
SPEC = importlib.util.spec_from_file_location('dashboard_krx_gate_test', SOURCE_PATH)
dashboard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dashboard)

fails = []


def check(label, ok, detail=''):
    print(('  PASS  ' if ok else '  FAIL  ') + label + (f' — {detail}' if detail and not ok else ''))
    if not ok:
        fails.append(label)


# ── 가짜 pykrx / yfinance ───────────────────────────────────────
KRX_PRICE = 60000.0
KRX_DIV = 2.5   # %


class FakeKrx:
    """mode: down = 모두 빈 값(로그인 없는 운영), probe_only = 확인 호출만 성공하고 종목별은
    빈 값(= 예전 운영 경로를 강제로 태움), up = 정상, raise = 예외(JSON 아님)."""

    def __init__(self, mode):
        self.mode = mode
        self.calls = []

    def _fail(self):
        if self.mode == 'raise':
            raise ValueError('Expecting value: line 1 column 1 (char 0)')

    def get_market_ohlcv_by_date(self, start, end, ticker):
        self.calls.append(('ohlcv', ticker))
        self._fail()
        if self.mode == 'up' or (self.mode == 'probe_only' and ticker == dashboard.KRX_PROBE_TICKER):
            return pd.DataFrame({'종가': [KRX_PRICE]})
        return pd.DataFrame()

    def get_market_fundamental(self, start, end, ticker):
        self.calls.append(('fundamental', ticker))
        self._fail()
        if self.mode == 'up':
            return pd.DataFrame({'DIV': [KRX_DIV]})
        return pd.DataFrame()

    def get_etf_ohlcv_by_date(self, start, end, ticker):
        self.calls.append(('etf_ohlcv', ticker))
        self._fail()
        return pd.DataFrame()

    def get_market_ticker_list(self, d, market=None):
        self.calls.append(('ticker_list', market))
        self._fail()
        return []

    def get_market_ticker_name(self, ticker):
        self.calls.append(('ticker_name', ticker))
        return ''

    def get_etf_ticker_list(self, d):
        self.calls.append(('etf_ticker_list', d))
        self._fail()
        return []

    def get_etf_ticker_name(self, ticker):
        self.calls.append(('etf_ticker_name', ticker))
        return ''


class FakeTicker:
    def __init__(self, series):
        self.dividends = series


class FakeYf:
    def __init__(self, table):
        self.table = table
        self.calls = []

    def Ticker(self, sym):
        self.calls.append(sym)
        return FakeTicker(self.table.get(sym, pd.Series(dtype=float)))


TODAY = datetime.date.today()


def months_ago(k, day):
    y, m = TODAY.year, TODAY.month - k
    while m <= 0:
        m += 12
        y -= 1
    return datetime.date(y, m, day)


def div_series(dates, amount, tz=None):
    idx = pd.DatetimeIndex([pd.Timestamp(d) for d in dates])
    if tz:
        idx = idx.tz_localize(tz)
    return pd.Series([float(amount)] * len(dates), index=idx)


# 국내 17종목(확인용 005930 은 넣지 않는다 — 종목별 호출과 확인 호출을 구분하려고).
KR = ['000660', '035420', '051910', '006400', '005380', '000270', '068270', '035720', '105560',
      '055550', '012330', '066570', '003550', '017670', '032830', '096770', '0117V0']
QUARTERLY, MONTHLY, KOSDAQ_ANNUAL = '000660', '0117V0', '035720'
Q_DATES = [months_ago(k, 15) for k in (1, 4, 7, 10)]
M_DATES = [months_ago(k, 3) for k in range(1, 13)]
A_DATES = [months_ago(5, 20)]


def yf_table(tz=None):
    return {
        f'{QUARTERLY}.KS': div_series(Q_DATES, 361, tz),
        f'{MONTHLY}.KS': div_series(M_DATES, 50, tz),
        # .KS 에는 없고 .KQ 에만 있는 코스닥 종목 — 두 번째 접미사로 찾는다
        f'{KOSDAQ_ANNUAL}.KQ': div_series(A_DATES, 1200, tz),
    }


ENV_KEYS = ('KRX_ID', 'KRX_PW')
SAVED_ENV = {k: os.environ.get(k) for k in ENV_KEYS}
SAVED_ATTRS = {k: getattr(dashboard, k, None) for k in ('krx', 'yf', 'PYKRX_OK', 'YF_OK', 'safe_last_close')}


def setup(mode, creds, table=None):
    for k in ENV_KEYS:
        os.environ.pop(k, None)
    if creds:
        # 더미 값 — 실제 자격이 아니다. 관문은 값이 있는지만 본다.
        os.environ['KRX_ID'] = 'test-id'
        os.environ['KRX_PW'] = 'test-pw'
    dashboard._KRX_PROBE.update(ok=None, at=0.0)
    fake_krx, fake_yf = FakeKrx(mode), FakeYf(table if table is not None else yf_table())
    dashboard.krx, dashboard.yf = fake_krx, fake_yf
    dashboard.PYKRX_OK = True
    dashboard.YF_OK = True
    return fake_krx, fake_yf


def ticker_calls(fake_krx):
    return [c for c in fake_krx.calls if c[1] != dashboard.KRX_PROBE_TICKER]


try:
    print('\n[자격 없음 — KRX 를 부르지 않는다]')
    krx_a, yf_a = setup('down', creds=False)
    skipped = dashboard.get_dividends(list(KR))
    check('국내 17종목 배당 조회에 KRX 호출 0회', krx_a.calls == [], str(krx_a.calls[:4]))
    check('yfinance 는 종목마다 조회한다', all(f'{t}.KS' in yf_a.calls for t in KR))
    check('응답 모양 그대로({success, result})', skipped.get('success') is True and set(skipped['result']) == set(KR))

    print('\n[결과는 예전 경로(pykrx 빈 응답 → yfinance)와 같다]')
    krx_b, _ = setup('probe_only', creds=True)
    legacy = dashboard.get_dividends(list(KR))
    check('예전 경로를 실제로 탔다(종목마다 KRX 2회)', len(ticker_calls(krx_b)) == 2 * len(KR), str(len(krx_b.calls)))
    check('건너뛴 결과 == 예전 경로 결과', skipped == legacy)

    q = skipped['result'][QUARTERLY]
    check('분기 배당 종목 값', q == {
        'dps': 1444, 'yld': 0.0, 'cycle': '분기',
        'months': sorted({d.month - 1 for d in Q_DATES}), 'cur': 'KRW', 'payDay': 15,
    }, str(q))
    m = skipped['result'][MONTHLY]
    check('월배당 ETF 값', m['dps'] == 600 and m['cycle'] == '월배당' and m['months'] == list(range(12))
          and m['payDay'] == 3 and m['yld'] == 0.0, str(m))
    a = skipped['result'][KOSDAQ_ANNUAL]
    check('코스닥(.KQ) 연 1회 값', a == {
        'dps': 1200, 'yld': 0.0, 'cycle': '연간', 'months': [A_DATES[0].month - 1], 'cur': 'KRW', 'payDay': 20,
    }, str(a))
    check('배당 이력이 없는 종목은 지금처럼 미조회',
          skipped['result']['051910'] == {'dps': '미조회', 'yld': '미조회', 'cycle': '-', 'months': [], 'cur': 'KRW'})

    # yfinance 0.2.x 는 배당 날짜에 시간대를 붙여 준다(Asia/Seoul). 그 모양에서도 두 경로가 같아야 한다.
    setup('down', creds=False, table=yf_table('Asia/Seoul'))
    skipped_tz = dashboard.get_dividends(list(KR))
    setup('probe_only', creds=True, table=yf_table('Asia/Seoul'))
    legacy_tz = dashboard.get_dividends(list(KR))
    check('시간대가 붙은 yfinance 배당에서도 두 경로 결과가 같다', skipped_tz == legacy_tz)

    print('\n[자격은 있으나 KRX 가 응답하지 않음 — 확인 호출 한 번]')
    krx_c, _ = setup('down', creds=True)
    broken = dashboard.get_dividends(list(KR))
    check('17종목에 KRX 호출 1회(확인 호출)', len(krx_c.calls) == 1, str(krx_c.calls[:4]))
    check('결과는 자격 없음과 같다', broken == skipped)
    dashboard.get_dividends(list(KR))
    check('10분 안의 다음 요청은 다시 확인하지 않는다', len(krx_c.calls) == 1, str(len(krx_c.calls)))
    dashboard._KRX_PROBE['at'] -= dashboard.KRX_PROBE_TTL_SECONDS + 1
    dashboard.get_dividends(list(KR))
    check('10분이 지나면 한 번 다시 확인한다', len(krx_c.calls) == 2, str(len(krx_c.calls)))

    krx_r, _ = setup('raise', creds=True)
    raised = dashboard.get_dividends(list(KR))
    check('확인 호출이 예외를 던져도 1회로 끝난다', len(krx_r.calls) == 1, str(len(krx_r.calls)))
    check('예외 때 결과도 자격 없음과 같다', raised == skipped)

    print('\n[자격이 있고 KRX 가 정상 — 기존 pykrx 경로 그대로]')
    krx_d, _ = setup('up', creds=True)
    live = dashboard.get_dividends(list(KR))
    check('종목마다 fundamental·ohlcv 를 부른다', len(ticker_calls(krx_d)) == 2 * len(KR), str(len(krx_d.calls)))
    lq = live['result'][QUARTERLY]
    check('DPS = round(가격 × DIV / 100), 수익률은 KRX 값',
          lq['dps'] == round(KRX_PRICE * KRX_DIV / 100) and lq['yld'] == KRX_DIV and lq['cycle'] == '분기', str(lq))

    print('\n[시세 보완·종목명 찾기도 같은 관문]')
    krx_e, _ = setup('down', creds=False)
    seen = []
    dashboard.safe_last_close = lambda sym, period='5d': (seen.append(sym) or 70000.0)
    prices = dashboard.get_prices(list(KR[:5]))
    check('국내 시세 보완에 KRX 호출 0회', krx_e.calls == [], str(krx_e.calls[:4]))
    check('yfinance(.KS) 값으로 채운다', seen == [f'{t}.KS' for t in KR[:5]]
          and all(prices['result'][t] == {'price': 70000, 'cur': 'KRW'} for t in KR[:5]))
    dashboard.safe_last_close = SAVED_ATTRS['safe_last_close']
    check('종목명 찾기(type=resolve)도 KRX 호출 0회',
          dashboard.resolve_kr_ticker('없는종목이름') is None and krx_e.calls == [], str(krx_e.calls[:4]))

    print('\n[구조 — 관문을 우회하는 pykrx 호출이 없다]')
    tree = ast.parse(SOURCE_PATH.read_text(encoding='utf-8'))
    bypass, ungated = [], []
    for fn in tree.body:
        if not isinstance(fn, ast.FunctionDef):
            continue
        nodes = list(ast.walk(fn))
        uses_krx = any(isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) and n.value.id == 'krx'
                       for n in nodes)
        gated = any(isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == '_krx_usable'
                    for n in nodes)
        if fn.name != '_krx_usable':
            bypass += [fn.name for n in nodes if isinstance(n, ast.If)
                       and any(isinstance(x, ast.Name) and x.id == 'PYKRX_OK' for x in ast.walk(n.test))]
            if uses_krx and not gated:
                ungated.append(fn.name)
    check('`if PYKRX_OK` 로 직접 분기하는 곳은 _krx_usable 안뿐', not bypass, str(bypass))
    check('krx 를 쓰는 함수는 모두 _krx_usable() 을 거친다', not ungated, str(ungated))
    check('배당 상한 상수 MAX_DIVIDEND_TICKERS = 20', dashboard.MAX_DIVIDEND_TICKERS == 20)
finally:
    for k, v in SAVED_ENV.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    for k, v in SAVED_ATTRS.items():
        if v is not None:
            setattr(dashboard, k, v)

if fails:
    print(f'\nFAIL {len(fails)}건: {fails}')
    sys.exit(1)
print('\nPASS KRX 관문 — 로그인 없으면 국내 조회가 KRX 를 종목마다 부르지 않는다')
