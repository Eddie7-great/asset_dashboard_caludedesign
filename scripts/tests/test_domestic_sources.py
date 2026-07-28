#!/usr/bin/env python3
"""국내 ETF 공통·운용사 공식 구성종목 파서 단위 테스트."""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from collect_etf_holdings import (  # noqa: E402
    kr_isin_from_short_code,
    parse_tiger_pdf_html,
    parse_zeroin_holdings_html,
)

TIGER_SAMPLE = """
<tr data-tot-cnt="5">
  <td>NVDA US EQUITY</td><td>NVIDIA Corp</td><td>501.25</td>
  <td>152,251,950</td><td>8.32</td><td>1.99</td>
</tr>
<tr data-tot-cnt="5">
  <td>BRK/B US EQUITY</td><td>Berkshire Hathaway Inc</td><td>2</td>
  <td>1,000</td><td>1.25</td><td>-</td>
</tr>
<tr data-tot-cnt="5">
  <td>005930 KS EQUITY</td><td>삼성전자</td><td>3</td>
  <td>300,000</td><td>2.50</td><td>0.10</td>
</tr>
<tr data-tot-cnt="5">
  <td>USD CURNCY</td><td>미국 달러</td><td>1</td>
  <td>100</td><td>0.20</td><td>-</td>
</tr>
<tr data-tot-cnt="5">
  <td>NQ1 INDEX</td><td>NASDAQ 100 E-MINI FUTURE</td><td>1</td>
  <td>100</td><td>3.00</td><td>-</td>
</tr>
"""

ZEROIN_SAMPLE = """
<script type="application/ld+json">
{"dateModified": "2026-07-27"}
</script>
<table><tbody>
<tr><td>1</td><td>삼성전자</td><td>005930</td><td>32.78%</td><td>1</td><td>1</td><td>유가증권</td></tr>
<tr><td>2</td><td>NVIDIA Corp</td><td>221NAS@NVDA</td><td>8.33%</td><td>1</td><td>1</td><td>NASDAQ</td></tr>
<tr><td>3</td><td>Berkshire Hathaway</td><td>221NYS@BRK/B</td><td>1.25%</td><td>1</td><td>1</td><td>NYSE</td></tr>
<tr><td>-</td><td>설정현금액</td><td>CASH00000001</td><td>현금성</td><td>1</td><td>1</td><td>-</td></tr>
<tr><td>4</td><td>KRX금현물</td><td>KRD040200002</td><td>100.00%</td><td>1</td><td>1</td><td>일반상품</td></tr>
</tbody></table>
"""

fails = []


def check(cond, label):
    print(('  PASS  ' if cond else '  FAIL  ') + label)
    if not cond:
        fails.append(label)


def main():
    print('\n[한국 ETF ISIN]')
    check(kr_isin_from_short_code('133690') == 'KR7133690008',
          '133690 → KR7133690008')
    check(kr_isin_from_short_code('138530') == 'KR7138530001',
          '138530 → KR7138530001')
    check(kr_isin_from_short_code('0117V0') is None,
          '숫자가 아닌 단축코드는 계산하지 않는다')

    holdings = parse_tiger_pdf_html(TIGER_SAMPLE)
    by = {h['t']: h for h in holdings}

    print('\n[공식 PDF HTML 파싱]')
    check(len(holdings) == 3, '주식 3행만 추출')
    check(by.get('NVDA', {}).get('w') == 8.32, '미국 티커와 비중 유지')
    check(by.get('BRK.B', {}).get('w') == 1.25, 'Bloomberg 클래스 표기 정규화')
    check(by.get('005930', {}).get('w') == 2.50, '국내 단축코드 유지')
    check('USD' not in by and 'NQ1' not in by, '통화·선물 행 제외')
    check(round(sum(h['w'] for h in holdings), 2) == 12.07,
          '비중을 재정규화하지 않는다')

    zeroin, eq, as_of = parse_zeroin_holdings_html(ZEROIN_SAMPLE)
    by = {h['t']: h for h in zeroin}

    print('\n[ZEROIN 공통 구성종목 HTML 파싱]')
    check(len(zeroin) == 3, '국내·해외 주식 3행만 추출')
    check(by.get('005930', {}).get('w') == 32.78, '국내 단축코드 유지')
    check(by.get('NVDA', {}).get('w') == 8.33, '해외 시장접두어 제거')
    check(by.get('BRK.B', {}).get('w') == 1.25, '해외 클래스 표기 정규화')
    check('CASH00000001' not in by and 'KRD040200002' not in by,
          '현금·금 현물 제외')
    check(eq == 42.36, '주식 비중 합계 계산')
    check(as_of == '2026-07-27', '공시 기준일 추출')

    print('\n%d개 항목 · 실패 %d건' % (len(holdings) + len(zeroin), len(fails)))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
