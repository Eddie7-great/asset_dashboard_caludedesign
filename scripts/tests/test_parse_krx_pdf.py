#!/usr/bin/env python3
"""KRX PDF 파서 단위 테스트 — 네트워크 없이 픽스처로 검증한다.

  python3 scripts/tests/test_parse_krx_pdf.py
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from etf_common import norm_holding_code, parse_krx_pdf  # noqa: E402

FIXTURE = os.path.join(HERE, 'fixtures', 'krx_pdf_sample.json')

fails = []


def check(cond, label):
    print(('  PASS  ' if cond else '  FAIL  ') + label)
    if not cond:
        fails.append(label)


def main():
    with open(FIXTURE, encoding='utf-8') as f:
        rows = json.load(f)['output']
    holdings, equity_weight = parse_krx_pdf(rows)
    by = {h['t']: h for h in holdings}

    print('\n[코드 정규화]')
    check(norm_holding_code('KR7005930003') == '005930', 'KR ISIN → 6자리 단축코드')
    check(norm_holding_code('US67066G1040') == 'NVDA', 'US ISIN → 티커 (매핑표)')
    check(norm_holding_code('US99999X9999') == 'US99999X9999', '미등재 US ISIN → 원문 유지')
    check(norm_holding_code('MSFT.O') == 'MSFT', '로이터 접미사 제거')
    check(norm_holding_code('KRD010010001') is None, '원화예금 코드 → None')

    print('\n[비종목 행 제외]')
    check(not any(h['t'] == 'KRD010010001' for h in holdings), '원화예금 행 제외')
    check(not any('선물' in h['n'] for h in holdings), '선물 행 제외')
    check(not any('국고채' in h['n'] for h in holdings), '국고채 행 제외')
    check(not any(h['t'] == '373220' for h in holdings), '비중 0 행 제외')

    print('\n[주식 행 보존]')
    check('NVDA' in by and 'AAPL' in by, '해외 편입 종목이 티커로 들어온다')
    check('000660' in by, '국내 편입 종목 유지')
    check('MSFT' in by, '로이터형 티커 유지')
    check('US99999X9999' in by, '미등재 ISIN도 버리지 않는다')

    print('\n[종목 정규화 규칙]')
    check('005935' in by and by['005935']['w'] == 1.20, '삼성전자우는 별개 종목으로 유지')
    check(by.get('005930', {}).get('w') == 17.0, '동일 티커 중복 행은 합산 (16.53 + 0.47)')

    print('\n[비중 재정규화 금지]')
    check(by['NVDA']['w'] == 8.91, 'COMPST_RTO 원값 그대로 (재정규화 없음)')
    expected = round(17.0 + 1.20 + 2.95 + 8.91 + 7.12 + 0.35 + 5.30, 2)
    check(equity_weight == expected, 'equityWeight = 주식 비중 합 %.2f%% (100%% 아님)' % expected)
    check(equity_weight < 100, 'equityWeight < 100 — 현금·채권·선물이 빠진 사실이 드러난다')

    print('\n[KRX 변경 필드 호환]')
    alt_rows = [
        {'COMPST_ISU_CD': '005930', 'COMPST_ISU_NM': '삼성전자',
         'COMPST_RTO': '-', 'COMPST_RTIO': '60.0'},
        {'COMPST_ISU_CD': '000660', 'COMPST_ISU_NM': 'SK하이닉스',
         'COMPST_RTO': '-', 'COMPST_RTIO': '40.0'},
    ]
    alt_holdings, alt_weight = parse_krx_pdf(alt_rows)
    check(len(alt_holdings) == 2 and alt_weight == 100.0,
          'COMPST_RTIO 비중 필드도 정상 파싱')
    amount_rows = [
        {'COMPST_ISU_CD': '005930', 'COMPST_ISU_NM': '삼성전자',
         'COMPST_AMT': '-', 'VALU_AMT': '750'},
        {'COMPST_ISU_CD': '000660', 'COMPST_ISU_NM': 'SK하이닉스',
         'COMPST_AMT': '-', 'VALU_AMT': '250'},
    ]
    amount_holdings, amount_weight = parse_krx_pdf(amount_rows)
    check([h['w'] for h in amount_holdings] == [75.0, 25.0] and amount_weight == 100.0,
          'COMPST_AMT가 없으면 VALU_AMT로 비중 산출')

    print('\n[정렬]')
    check(all(holdings[i]['w'] >= holdings[i + 1]['w'] for i in range(len(holdings) - 1)),
          '비중 내림차순 정렬')

    print('\n%d개 항목 · 실패 %d건' % (len(holdings), len(fails)))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
