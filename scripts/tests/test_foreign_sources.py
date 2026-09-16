"""해외 ETF 수집 — 출처 우선순위와 완전성/기준일 판정.

yfinance 는 funds_data.top_holdings 를 쓰므로 정의상 상위 10종목만 준다.
이게 stockanalysis 보다 먼저 시도되면 성공하는 순간 체인이 끊겨 전체 바스켓을
영영 받지 못하고, 룩스루 간접 노출이 통째로 축소된다(실제로 DRAM 이 3종목,
SPYM·1629 가 10종목으로 굳었다). 그래서 순서를 여기서 고정한다.
"""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import collect_etf_holdings as collector
import etf_common


FULL = [{'t': 'NVDA', 'n': 'NVIDIA', 'w': 8.0}, {'t': 'AAPL', 'n': 'Apple', 'w': 6.0}]
TOP10 = [{'t': 'NVDA', 'n': 'NVIDIA', 'w': 8.0}]


class ForeignSourceOrderTests(unittest.TestCase):
    def test_stockanalysis_is_tried_before_yfinance(self):
        with patch.object(collector, 'fetch_proshares', return_value=([], None)), \
             patch.object(collector, 'fetch_invesco', return_value=([], None)), \
             patch.object(collector, 'fetch_stockanalysis', return_value=(FULL, '2026-09-15', True)) as sa, \
             patch.object(collector, 'fetch_yfinance', return_value=TOP10) as yf:
            holdings, eq, as_of, source, full = collector.collect_one('DRAM', 'Roundhill Memory ETF')
        self.assertEqual(source, 'stockanalysis')
        self.assertEqual(len(holdings), 2)
        self.assertEqual(as_of, '2026-09-15')
        self.assertTrue(full)
        sa.assert_called_once_with('DRAM')
        yf.assert_not_called()   # 전체 바스켓을 받았으면 부분 출처는 부르지 않는다

    def test_yfinance_still_serves_as_fallback(self):
        with patch.object(collector, 'fetch_proshares', return_value=([], None)), \
             patch.object(collector, 'fetch_invesco', return_value=([], None)), \
             patch.object(collector, 'fetch_stockanalysis', return_value=([], None, False)), \
             patch.object(collector, 'fetch_yfinance', return_value=TOP10):
            holdings, eq, as_of, source, full = collector.collect_one('DRAM', 'Roundhill Memory ETF')
        self.assertEqual(source, 'yfinance')
        self.assertEqual(len(holdings), 1)
        self.assertIsNone(as_of)
        self.assertFalse(full)   # 상위 N 개 목록은 절대 full 이 아니다

    def test_alias_also_prefers_the_complete_source(self):
        with patch.object(collector, 'fetch_proshares', return_value=([], None)), \
             patch.object(collector, 'fetch_invesco', return_value=([], None)), \
             patch.object(collector, 'ETF_ALIAS', {'SPYM': 'SPLG'}), \
             patch.object(collector, 'fetch_stockanalysis',
                          side_effect=[([], None, False), (FULL, '2026-09-15', True)]), \
             patch.object(collector, 'fetch_yfinance', side_effect=[[], TOP10]) as yf:
            holdings, eq, as_of, source, full = collector.collect_one('SPYM', 'SPDR Portfolio S&P 500')
        self.assertEqual(source, 'alias:SPLG')
        self.assertEqual(as_of, '2026-09-15')
        self.assertTrue(full)
        # 별칭 단계에서도 stockanalysis 가 먼저다 — yfinance 는 원본 티커에서 한 번만 불린다
        self.assertEqual(yf.call_count, 1)

    def test_domestic_chain_is_untouched(self):
        with patch.object(collector, 'fetch_funetf', return_value=(FULL, '2026-09-15')):
            holdings, eq, as_of, source, full = collector.collect_one('133690', 'TIGER 미국나스닥100')
        self.assertEqual(source, 'FunETF')
        self.assertTrue(full)


class CoverageEvidenceTests(unittest.TestCase):
    """coverage 는 출처 이름이 아니라 '전부 받았다는 근거'로 정해진다."""

    def test_partial_source_never_reports_full_coverage(self):
        self.assertFalse(collector.collect_one.__doc__ is None)
        with patch.object(collector, 'fetch_proshares', return_value=([], None)), \
             patch.object(collector, 'fetch_invesco', return_value=([], None)), \
             patch.object(collector, 'fetch_stockanalysis', return_value=(FULL, '2026-09-15', False)), \
             patch.object(collector, 'fetch_yfinance', return_value=[]):
            *_, full = collector.collect_one('DRAM', 'Roundhill Memory ETF')
        # 기준일이 있어도 전체 개수 근거가 없으면 full 이 아니다
        self.assertFalse(full)


class StockAnalysisParseTests(unittest.TestCase):
    def _fetch(self, payload):
        with patch.object(etf_common, 'http_json', return_value=payload):
            return etf_common.fetch_stockanalysis('DRAM')

    def test_reads_date_and_declared_count(self):
        holdings, as_of, full = self._fetch({
            'date': '2026-09-15', 'count': 2,
            'data': [{'symbol': 'NVDA', 'name': 'NVIDIA', 'percent': 8.0},
                     {'symbol': 'AAPL', 'name': 'Apple', 'percent': 6.0}]})
        self.assertEqual(len(holdings), 2)
        self.assertEqual(as_of, '2026-09-15')
        self.assertTrue(full)

    def test_missing_count_stays_incomplete(self):
        holdings, as_of, full = self._fetch({
            'date': '2026-09-15',
            'data': [{'symbol': 'NVDA', 'name': 'NVIDIA', 'percent': 8.0}]})
        self.assertEqual(len(holdings), 1)
        self.assertEqual(as_of, '2026-09-15')
        self.assertFalse(full)

    def test_count_mismatch_stays_incomplete(self):
        _, _, full = self._fetch({
            'count': 500,
            'data': [{'symbol': 'NVDA', 'name': 'NVIDIA', 'percent': 8.0}]})
        self.assertFalse(full)

    def test_missing_date_stays_undated(self):
        _, as_of, _ = self._fetch({'data': [{'symbol': 'NVDA', 'name': 'NVIDIA', 'percent': 8.0}]})
        self.assertIsNone(as_of)

    def test_future_and_malformed_dates_are_rejected(self):
        for bad in ('2999-01-01', 'yesterday', '', None, True, '1990-01-01'):
            self.assertIsNone(etf_common._sa_date(bad), bad)
        self.assertEqual(etf_common._sa_date('2026-09-15T00:00:00Z'), '2026-09-15')

    def test_non_equity_and_placeholder_rows_are_dropped_but_still_counted(self):
        # 현금·머니마켓·자리표시자 행은 보유에서 빠지되,
        # 응답이 밝힌 전체 개수와의 대조에는 포함된다(그래야 완전성 판정이 맞는다).
        holdings, _, full = self._fetch({
            'count': 3,
            'data': [{'symbol': 'NVDA', 'name': 'NVIDIA', 'percent': 8.0},
                     {'symbol': 'XYZ', 'name': 'GOLDMAN SACHS MONEY MARKET', 'percent': 2.0},
                     {'symbol': '--', 'name': 'NET OTHER ASSETS', 'percent': 1.0}]})
        self.assertEqual([h['t'] for h in holdings], ['NVDA'])
        self.assertTrue(full)

    def test_placeholder_ticker_is_not_a_stock(self):
        # 운용사 표에서 현금·기타자산 행의 코드 칸에 '--' 가 자주 온다.
        from etf_common import norm_holding_code
        for placeholder in ('--', '-', '.', 'N/A', ''):
            self.assertIsNone(norm_holding_code(placeholder), placeholder)
        self.assertEqual(norm_holding_code('BRK/B'), 'BRK.B')
        self.assertEqual(norm_holding_code('0117V0'), '0117V0')

    def test_upstream_failure_returns_empty_triple(self):
        with patch.object(etf_common, 'http_json', side_effect=OSError('boom')):
            self.assertEqual(etf_common.fetch_stockanalysis('DRAM'), ([], None, False))
        self.assertEqual(etf_common.fetch_stockanalysis(''), ([], None, False))


if __name__ == '__main__':
    unittest.main(verbosity=1)
