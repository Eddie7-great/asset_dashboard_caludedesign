#!/usr/bin/env python3
"""벤치마크 종가 컬럼 정리 로직 — 네트워크 없이 검증한다.

  python3 scripts/tests/test_benchmark_columns.py

배경: ffill 은 선행 NaN 을 채우지 못한다. 1년 구간의 첫 날이 미국 휴장일이면
그 행은 KOSPI 덕분에 살아남고 US 종목만 NaN 이 되는데, 예전 drop_cols 는
'한 칸이라도 NaN 이면 폐기'라서 그 날 하루 때문에 US 종목 컬럼을 통째로 버렸다.
그 결과 미국 종목만 보유한 소유주(자녀1)는 포트폴리오 라인이 통째로 사라졌고,
국내 종목을 섞어 가진 소유주는 라인이 남아 증상이 한 명에게만 보였다.
"""

import os
import sys

try:
    import numpy as np
    import pandas as pd
except ImportError:
    print('SKIP 벤치마크 컬럼 정리 (pandas/numpy 미설치)')
    sys.exit(0)

HERE = os.path.dirname(os.path.abspath(__file__))
DASHBOARD = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'api', 'dashboard.py')

# get_benchmark 안의 컬럼 정리 구간만 실제 소스에서 떼어내 실행한다
# (테스트가 사본을 들고 있으면 원본이 바뀌어도 통과해 버린다).
src = open(DASHBOARD, encoding='utf-8').read()
_start = src.index('        close_df.ffill(inplace=True)')
_end = src.index('        close_df.dropna(inplace=True)') + len('        close_df.dropna(inplace=True)')
BLOCK = '\n'.join(line[8:] for line in src[_start:_end].split('\n'))

fails = []


def check(label, close_df, tickers, expect_resolved):
    ns = {'close_df': close_df.copy(), 'pd': pd}
    exec(BLOCK, ns)  # noqa: S102 — 검증 대상이 프로덕션 소스 그 자체다
    df = ns['close_df']
    resolved = [t for t in tickers if t in df.columns]
    ok = bool(resolved) == expect_resolved
    print(('  PASS  ' if ok else '  FAIL  ') + label + f' (resolved={resolved or "없음"})')
    if not ok:
        fails.append(label)


DATES = pd.bdate_range('2025-09-01', periods=250)
N = len(DATES)


def series(a, b):
    return pd.Series(np.linspace(a, b, N), index=DATES)


gspc, ks11 = series(5000, 5800), series(2500, 2900)
amzn, msft, ls_electric = series(200, 260), series(430, 510), series(250000, 207500)

print('\n[시장 달력이 다른 종목]')
# 첫 날 + 중간 며칠이 미국 휴장 — KOSPI 는 거래하므로 행은 살아남는다
g, a, m = gspc.copy(), amzn.copy(), msft.copy()
for d in (DATES[0], DATES[40], DATES[120]):
    g[d] = np.nan
    a[d] = np.nan
    m[d] = np.nan

check('미국 종목만 보유해도 라인이 살아남는다',
      pd.DataFrame({'^GSPC': g, '^KS11': ks11, 'AMZN': a, 'MSFT': m}),
      ['AMZN', 'MSFT'], True)
check('국내·해외 혼합 보유도 그대로',
      pd.DataFrame({'^GSPC': g, '^KS11': ks11, 'AMZN': a, 'MSFT': m, '010120.KS': ls_electric}),
      ['AMZN', 'MSFT', '010120.KS'], True)

print('\n[기존 동작 유지]')
check('결측 없는 정상 구간',
      pd.DataFrame({'^GSPC': gspc, '^KS11': ks11, 'AMZN': amzn, 'MSFT': msft}),
      ['AMZN', 'MSFT'], True)
check('조회 자체가 실패한 종목은 계속 폐기한다',
      pd.DataFrame({'^GSPC': gspc, '^KS11': ks11, 'DEADTKR': pd.Series([np.nan] * N, index=DATES)}),
      ['DEADTKR'], False)

recent = amzn.copy()
recent[:180] = np.nan
check('최근 상장 종목(앞부분 결측)도 라인을 유지한다',
      pd.DataFrame({'^GSPC': gspc, '^KS11': ks11, 'NEWCO': recent}),
      ['NEWCO'], True)

print(f"\n5개 항목 · 실패 {len(fails)}건")
sys.exit(1 if fails else 0)
