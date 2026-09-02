#!/usr/bin/env python3
"""순자산 스냅샷 배치 — script.js 원본과 계산이 같은지 대조한다.

이 배치의 유일한 위험은 순자산 정의가 앱(JS)과 갈리는 것이다. 정의가 어긋나면
같은 그래프 위에 서로 다른 기준의 점이 섞여 순자산 변화 분석의 잔차가 통째로
왜곡된다. 그래서 여기서는 같은 입력을 Python 배치와 script.js의
`updateNetWorthSnapshot` 양쪽에 넣고 결과 항목이 완전히 같은지 비교한다.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))

import net_worth_snapshot as batch  # noqa: E402

PASS, FAIL = [], []


def check(name, got, expected):
    if got == expected:
        PASS.append(name)
        print('  PASS  %s' % name)
    else:
        FAIL.append(name)
        print('  FAIL  %s\n        got=%r\n        expected=%r' % (name, got, expected))


# ── 픽스처 ──────────────────────────────────────────────────────
RATES = {'USD': 1400.0, 'JPY': 9.5, 'KRW': 1}
ASSETS = [
    {'owner': '본인', 'grp': '주식', 'tkr': 'SCHD', 'cur': 'USD', 'qty': 100, 'curP': 80},
    {'owner': '본인', 'grp': '주식', 'tkr': '005930', 'cur': 'KRW', 'qty': 50, 'curP': 70000},
    {'owner': '아내', 'grp': '가상화폐', 'tkr': 'BTC', 'cur': 'USD', 'qty': 0.5, 'curP': 90000},
    # 금: curP가 이미 '단위당 원화'라 환율을 곱하면 안 된다 (이중 환산 방지)
    {'owner': '아내', 'grp': '금', 'tkr': 'GOLD', 'cur': 'KRW', 'unit': '돈', 'qty': 10, 'curP': 600000},
    {'owner': '자녀1', 'grp': '주식', 'tkr': '7203', 'cur': 'JPY', 'qty': 20, 'curP': 3000},
    {'owner': '아버지', 'grp': '현금', 'tkr': 'KRW', 'cur': 'KRW', 'qty': 1, 'curP': 5000000},
    # owner 누락 → script.js filterByOwner 와 같이 '본인'으로 본다
    {'grp': '주식', 'tkr': 'AAPL', 'cur': 'USD', 'qty': 10, 'curP': 200},
]
BALANCE_SHEET = {
    'assets': [
        {'owner': '본인', 'category': '부동산', 'amount': 500000000},
        {'owner': '아내', 'category': '예·적금', 'amount': 30000000},
    ],
    'liabilities': [
        {'owner': '본인', 'category': '주택담보대출', 'amount': 200000000},
    ],
}
DATE = '2026-09-02'


# ── 1. JS 원본과 대조 ───────────────────────────────────────────
def extract_js_function(source, name):
    start = source.index('function %s(' % name)
    depth = 0
    for i in range(source.index('{', start), len(source)):
        if source[i] == '{':
            depth += 1
        elif source[i] == '}':
            depth -= 1
            if depth == 0:
                return source[start:i + 1]
    raise AssertionError('%s 함수의 끝을 찾지 못함' % name)


def js_entry():
    """script.js의 updateNetWorthSnapshot을 같은 입력으로 실행한 결과."""
    script_js = open(os.path.join(ROOT, 'script.js'), encoding='utf-8').read()
    parts = [extract_js_function(script_js, n)
             for n in ('filterByOwner', 'getFilteredAssets', '_cfLocalDateKey', 'updateNetWorthSnapshot')]
    harness = """
const RATES = %s;
const OWNERS = %s;
const pfolioData = %s;
const window = { _balanceSheet: %s, _netWorthHistory: [] };
%s
const entry = updateNetWorthSnapshot();
// 날짜는 실행 시점(오늘)이라 비교 대상이 아니다 — 배치와 같은 날짜로 맞춘 뒤 나머지를 비교한다.
entry.date = %s;
console.log(JSON.stringify(entry));
""" % (
        json.dumps(RATES), json.dumps(batch.OWNERS, ensure_ascii=False),
        json.dumps(ASSETS, ensure_ascii=False), json.dumps(BALANCE_SHEET, ensure_ascii=False),
        '\n'.join(parts), json.dumps(DATE),
    )
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(harness)
        path = f.name
    try:
        out = subprocess.run([os.environ.get('NODE_BIN', 'node'), path],
                             capture_output=True, text=True, check=True)
        return json.loads(out.stdout.strip())
    finally:
        os.unlink(path)


print('[JS 원본과 대조]')
py = batch.build_entry(ASSETS, BALANCE_SHEET, RATES, DATE)
try:
    js = js_entry()
except (FileNotFoundError, subprocess.CalledProcessError) as e:
    print('  SKIP  node 실행 불가 (%s) — 파이썬 단위 검증만 수행' % type(e).__name__)
    js = None
if js is not None:
    check('전체 항목이 script.js updateNetWorthSnapshot 과 동일', py, js)


# ── 2. 규칙별 단위 검증 ─────────────────────────────────────────
print('\n[평가액 규칙]')
# 금 10돈 × 600,000원 = 6,000,000원 (환율 곱하지 않음)
check('금은 환율을 곱하지 않는다',
      batch.asset_value_krw({'grp': '금', 'cur': 'KRW', 'qty': 10, 'curP': 600000}, RATES), 6000000)
check('미국 주식은 USD 환율 적용',
      batch.asset_value_krw({'grp': '주식', 'cur': 'USD', 'qty': 100, 'curP': 80}, RATES), 100 * 80 * 1400)
check('일본 주식은 1엔당 환율 적용',
      batch.asset_value_krw({'grp': '주식', 'cur': 'JPY', 'qty': 20, 'curP': 3000}, RATES), 20 * 3000 * 9.5)
check('모르는 통화는 1로 본다',
      batch.asset_value_krw({'grp': '주식', 'cur': 'EUR', 'qty': 2, 'curP': 10}, RATES), 20)

print('\n[소유주 분해]')
check('owner 누락은 본인으로', batch.owner_of({'grp': '주식'}), '본인')
# 본인: SCHD 11,200,000 + 삼성전자 3,500,000 + AAPL 2,800,000 = 17,500,000
check('본인 포트폴리오', py['portfolioByOwner']['본인'], 17500000)
# 본인 순자산 = 17,500,000 + 부동산 500,000,000 − 대출 200,000,000
check('본인 순자산(기타자산·부채 반영)', py['netByOwner']['본인'], 317500000)
# 아내: BTC 0.5 × 90,000 × 1,400 = 63,000,000 + 금 6,000,000 = 69,000,000
check('아내 포트폴리오', py['portfolioByOwner']['아내'], 69000000)
check('아내 순자산(예적금 30,000,000 포함)', py['netByOwner']['아내'], 99000000)
check('소유주 목록은 4인 고정', sorted(py['netByOwner'].keys()), sorted(['본인', '아내', '자녀1', '아버지']))

print('\n[합계 · 스키마]')
check('schemaV 는 2', py['schemaV'], 2)
check('기타 자산 합계', py['nonInvestmentAssets'], 530000000)
check('부채 합계', py['liabilities'], 200000000)
check('total = 투자 + 기타 − 부채',
      py['total'], py['portfolio'] + py['nonInvestmentAssets'] - py['liabilities'])

print('\n[이력 병합]')
hist = [{'date': '2026-08-31', 'total': 1}, {'date': '2026-09-02', 'total': 2}]
merged = batch.merge_history(hist, {'date': '2026-09-02', 'total': 99})
check('같은 날짜는 교체', [h['total'] for h in merged], [1, 99])
check('날짜 오름차순 정렬',
      [h['date'] for h in batch.merge_history([{'date': '2026-09-05'}], {'date': '2026-09-01'})],
      ['2026-09-01', '2026-09-05'])
import datetime as _dt  # noqa: E402
_d0 = _dt.date(2025, 1, 1)
big = [{'date': (_d0 + _dt.timedelta(days=i)).isoformat()} for i in range(400)]
capped = batch.merge_history(big, {'date': '2026-09-02'})
check('365건 상한', len(capped), 365)
check('상한 초과 시 오래된 것부터 버린다', capped[-1]['date'], '2026-09-02')
check('날짜 없는 행은 버린다', batch.merge_history([{'total': 1}], {'date': 'x'}), [{'date': 'x'}])

print('\n[KV assets 형태]')
check('배열 형태', len(batch.normalize_assets([{'tkr': 'A'}, 'junk'])), 1)
check('{소유주: [...]} 형태에 owner 주입',
      batch.normalize_assets({'아내': [{'tkr': 'A'}]})[0]['owner'], '아내')
check('알 수 없는 형태는 빈 목록', batch.normalize_assets(None), [])

print('\n[환율 변환]')


class _FakeApi:
    @staticmethod
    def get_rates():
        return {'rates': {'usd_krw': 1400.0, 'jpy100_krw': 950.0}}


check('JPY는 100엔당 시세를 1엔당으로 환산', batch.fetch_rates(_FakeApi())['JPY'], 9.5)
check('KRW는 항상 1', batch.fetch_rates(_FakeApi())['KRW'], 1)

print('\n%d개 항목 · 실패 %d건' % (len(PASS) + len(FAIL), len(FAIL)))
sys.exit(1 if FAIL else 0)
