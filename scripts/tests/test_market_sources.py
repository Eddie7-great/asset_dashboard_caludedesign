#!/usr/bin/env python3
"""시세 단일 기준(2026-11-23) — 네트워크 없이 검증한다.

  python3 scripts/tests/test_market_sources.py

앱(api/stock-price.js · api/price.ts · script.js)과 배치(api/dashboard.py → scripts/net_worth_snapshot.py)는
같은 출처·같은 규칙을 써야 한다. 한쪽만 바뀌면 같은 날 같은 종목이 앱과 순자산 기록에서 다른 값이 된다.
  - 국내 주식·ETF: 네이버 일별 시세의 '직전 종가' (평일 KST 15:40 전에는 오늘 줄을 건너뛴다)
  - 환율: 네이버(하나은행 고시) USD·JPY(100엔)·AUD — 셋 다 받았을 때만
  - 금: 네이버 국내 금(KRX, 원/g) — 장중에는 전일 종가
  - 가상화폐: 업비트 원화 → 빗썸 원화, 종목 통화로 바꿀 때는 같은 환율로 나눈다
아래 날짜표는 scripts/tests/test_price_fallbacks.mjs 의 stock-price 검사와 같다.
"""

import datetime
import importlib.util
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
SPEC = importlib.util.spec_from_file_location('dashboard_market_test', ROOT / 'api' / 'dashboard.py')
dashboard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dashboard)
import net_worth_snapshot as batch  # noqa: E402

fails = []


def check(label, ok, detail=''):
    print(('  PASS  ' if ok else '  FAIL  ') + label + ('' if ok else '  → ' + str(detail)))
    if not ok:
        fails.append(label)


UTC = datetime.timezone.utc
ROWS = [
    {'localTradedAt': '2026-11-23', 'closePrice': '72,000', 'compareToPreviousClosePrice': '800'},
    {'localTradedAt': '2026-11-20', 'closePrice': '71,200', 'compareToPreviousClosePrice': '1,200'},
    {'localTradedAt': '2026-11-19', 'closePrice': '70,000', 'compareToPreviousClosePrice': '-500'},
]
at = lambda iso: datetime.datetime.fromisoformat(iso).replace(tzinfo=UTC)

print('[국내 직전 종가 — stock-price.js pickLastClose 와 같은 표]')
r = dashboard.pick_last_close(ROWS, at('2026-11-23T01:00:00'))
check('장중(KST 10:00)에는 전 거래일 종가', r == {'price': 71200, 'prevClose': 70000, 'change': 1200, 'asOf': '2026-11-20'}, r)
r = dashboard.pick_last_close(ROWS, at('2026-11-23T07:00:00'))
check('15:40 뒤(KST 16:00)에는 오늘 종가', r['price'] == 72000 and r['prevClose'] == 71200, r)
r = dashboard.pick_last_close(ROWS[1:], at('2026-11-22T01:00:00'))
check('주말에는 금요일 종가', r['price'] == 71200 and r['asOf'] == '2026-11-20', r)
r = dashboard.pick_last_close(ROWS[:1], at('2026-11-23T07:00:00'))
check('한 줄뿐이면 등락으로 전일 종가를 되짚는다', r['prevClose'] == 71200, r)
check('형식이 어긋나면 None', dashboard.pick_last_close('oops') is None and dashboard.pick_last_close([{'x': 1}]) is None)

print('\n[금 — price.ts naverGoldClose 와 같은 규칙]')
gold = {'closePrice': '156,560', 'marketStatus': 'OPEN',
        'marketIndexTotalInfos': [{'code': 'lastClosePrice', 'value': '153,090'}]}
check('장중에는 전일 종가', dashboard.naver_gold_close(gold) == 153090)
check('마감 뒤에는 오늘 종가', dashboard.naver_gold_close(dict(gold, marketStatus='CLOSE')) == 156560)

print('\n[환율 — 셋 다 받았을 때만, 아니면 yfinance]')
idx = {'FX_USDKRW': '1,345.20', 'FX_JPYKRW': '846.57', 'FX_AUDKRW': '894.29'}
saved = (dashboard.naver_market_index, dashboard.safe_last_close)
dashboard.naver_market_index = lambda cat, code: {'closePrice': idx[code]} if code in idx else None
rates = dashboard.get_rates()['rates']
check('하나은행 고시 그대로', rates['usd_krw'] == 1345.2 and rates['jpy100_krw'] == 846.57 and rates['aud_krw'] == 894.29
      and rates['source'] == 'naver', rates)
check('USD/JPY 는 두 고시로 계산', rates['usd_jpy'] == round(1345.2 / 8.4657, 2), rates)
br = batch.fetch_rates(dashboard)
check('배치 RATES 도 같은 값', br['USD'] == 1345.2 and abs(br['JPY'] - 8.4657) < 1e-9 and br['AUD'] == 894.29, br)
del idx['FX_AUDKRW']
dashboard.safe_last_close = lambda sym, period='5d': {'KRW=X': 1400.0, 'JPY=X': 140.0, 'AUDKRW=X': 900.0}.get(sym)
rates = dashboard.get_rates()['rates']
check('한 통화라도 못 받으면 섞지 않고 전부 다른 출처', rates['source'] == 'yfinance' and rates['usd_krw'] == 1400.0, rates)
dashboard.naver_market_index, dashboard.safe_last_close = saved

print('\n[가상화폐 — 업비트 원화를 종목 통화로]')
saved = (dashboard.crypto_krw, dashboard.safe_last_close, dashboard.naver_last_close)
dashboard.crypto_krw = lambda sym: (83500000.0, 83000000.0, 'upbit')
dashboard.safe_last_close = lambda sym, period='5d': 62000.0
rates = {'KRW': 1.0, 'USD': 1345.2}
p = batch.market_price(dashboard, {'grp': '가상화폐', 'tkr': 'BTC', 'cur': 'USD'}, rates)
check('달러 종목: 원화 ÷ 같은 환율 → 표시 원화가 업비트가와 같다', round(p * 1345.2) == 83500000, p)
p = batch.market_price(dashboard, {'grp': '가상화폐', 'tkr': 'BTC', 'cur': 'KRW'}, rates)
check('원화 종목: 그대로', p == 83500000.0, p)
dashboard.crypto_krw = lambda sym: None
check('원화 시세 실패 + 달러 종목 → Yahoo 달러', batch.market_price(dashboard, {'grp': '가상화폐', 'tkr': 'BTC', 'cur': 'USD'}, rates) == 62000.0)
check('원화 시세 실패 + 원화 종목 → 달러 값을 넣지 않는다',
      batch.market_price(dashboard, {'grp': '가상화폐', 'tkr': 'BTC', 'cur': 'KRW'}, rates) is None)
res = dashboard.get_prices(['BTC'])['result']['BTC']
check('get_prices 는 실패 시 달러로 표시', res == {'price': 62000.0, 'cur': 'USD'}, res)
dashboard.crypto_krw = lambda sym: (83500000.0, 83000000.0, 'bithumb')
res = dashboard.get_prices(['BTC'])['result']['BTC']
check('get_prices 는 원화로 표시(화면이 종목 통화로 바꾼다)', res == {'price': 83500000.0, 'cur': 'KRW', 'source': 'bithumb'}, res)

print('\n[국내 — 배치도 네이버 직전 종가가 먼저]')
dashboard.naver_last_close = lambda code, now=None: {'price': 71200, 'prevClose': 70000, 'change': 1200, 'asOf': '2026-11-20'}
p = batch.market_price(dashboard, {'grp': '주식', 'tkr': '005930.KS', 'cur': 'KRW'}, rates)
check('네이버 값', p == 71200.0, p)
res = dashboard.get_prices(['005930'])['result']['005930']
check('get_prices 도 네이버 값', res == {'price': 71200, 'cur': 'KRW'}, res)
dashboard.naver_last_close = lambda code, now=None: None
p = batch.market_price(dashboard, {'grp': '주식', 'tkr': '005930', 'cur': 'KRW'}, rates)
check('네이버 실패 → Yahoo .KS', p == 62000.0, p)
dashboard.crypto_krw, dashboard.safe_last_close, dashboard.naver_last_close = saved

print('\n[같은 상수]')
js = (ROOT / 'api' / 'stock-price.js').read_text(encoding='utf-8')
check('15:40 기준이 양쪽에 같다', 'const KRX_CLOSE_SETTLE_MIN = 15 * 60 + 40;' in js
      and dashboard.KRX_CLOSE_SETTLE_MIN == 15 * 60 + 40)

if fails:
    print('\nFAIL %d건' % len(fails))
    sys.exit(1)
print('\nPASS 시세 단일 기준')
