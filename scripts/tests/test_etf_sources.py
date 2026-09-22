"""운용사 공식 보유명세 파일 파서 — 리포에 커밋한 파일 자체를 픽스처로 쓴다.

공개 조회 소스가 1629·SPYM 은 상위 10종목, DRAM 은 3종목만 준다(GitHub Actions 실측).
그래서 운용사 공시 파일을 고정 자료로 넣었고, 여기서 그 파일이 실제로 무엇을 내놓는지
숫자로 못 박는다 — 파일을 갱신하다 형식이 바뀌면 조용히 부분 목록으로 되돌아가지 않도록.
"""
import datetime
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import collect_etf_holdings as collector
import etf_sources

SRC = Path(etf_sources.SOURCE_DIR)


def weights(holdings):
    return {h['t']: h['w'] for h in holdings}


class NextFundsTests(unittest.TestCase):
    """NEXT FUNDS 1629 — 비중이 분수(0.217 = 21.7%)이고 첫 시트가 $MetaData 다."""

    def setUp(self):
        self.h, self.as_of, self.full, self.label = etf_sources.fetch_local_source('1629', verbose=False)

    def test_full_basket_with_real_date(self):
        self.assertEqual(len(self.h), 126)
        self.assertEqual(self.as_of, '2026-08-31')
        self.assertTrue(self.full)
        self.assertEqual(self.label, 'NEXT FUNDS')

    def test_weights_are_not_renormalised(self):
        # 원값 유지 — 100%로 맞추지 않는다. 나머지 0.15%는 현금이다.
        self.assertAlmostEqual(sum(h['w'] for h in self.h), 99.85, places=1)
        self.assertAlmostEqual(weights(self.h)['8058'], 21.7026, places=3)

    def test_ticker_matches_frontend_cbstrip_result(self):
        # 직접 보유는 '8058.T' 로 들어오고 cbStrip 이 '8058' 로 정규화한다.
        self.assertIn('8058', weights(self.h))
        self.assertEqual(self.h[0]['n'], 'MITSUBISHI CORPORATION')

    def test_wrong_fund_code_is_rejected(self):
        with self.assertRaises(ValueError):
            etf_sources.parse_nextfunds_xlsx(str(SRC / '1629_brd_data.xlsx'), '9999')


class SpdrTests(unittest.TestCase):
    """State Street SPYM — 데이터 뒤에 A열만 채운 면책 문구 행이 붙는다."""

    def setUp(self):
        self.h, self.as_of, self.full, self.label = etf_sources.fetch_local_source('SPYM', verbose=False)

    def test_full_basket_with_real_date(self):
        self.assertEqual(len(self.h), 503)     # 508 데이터 행 - 비주식 4행 - 비중 0 자리표시자 1행
        self.assertEqual(self.as_of, '2026-09-14')
        self.assertTrue(self.full)
        self.assertAlmostEqual(weights(self.h)['NVDA'], 7.7834, places=3)

    def test_disclaimer_rows_do_not_become_holdings(self):
        # 행 수를 세어 자르지 않고 '비중이 숫자인 행'만 받는다.
        self.assertTrue(all(h['w'] > 0 for h in self.h))
        self.assertTrue(all(len(h['t']) <= 12 for h in self.h))

    def test_zero_weight_placeholder_rows_are_dropped(self):
        # 'CONTRA HOLOGIC INCORPO'(합병 대기 자리표시자)는 비중 3e-06% 라 반올림하면 0 이다.
        self.assertNotIn('2602335D', weights(self.h))

    def test_money_market_futures_and_placeholders_are_excluded(self):
        w = weights(self.h)
        self.assertNotIn('ESZ6', w)            # S+P500 EMINI FUT DEC26
        self.assertNotIn('-', w)               # US DOLLAR · CONTRA WALGREENS (티커 '-')
        self.assertFalse([t for t in w if 'MONEY' in t.upper()])
        self.assertLess(sum(h['w'] for h in self.h), 100)

    def test_wrong_ticker_is_rejected(self):
        with self.assertRaises(ValueError):
            etf_sources.parse_spdr_xlsx(str(SRC / 'spym_holdings.xlsx'), 'SPY')


class TemaSwapTests(unittest.TestCase):
    """Tema DRAM — 기초자산이 명시된 스왑을 그 종목의 노출로 센다."""

    def setUp(self):
        self.h, self.as_of, self.full, self.label = etf_sources.fetch_local_source('DRAM', verbose=False)
        self.w = weights(self.h)

    def test_pdf_is_read_without_a_third_party_library(self):
        self.assertEqual(self.as_of, '2026-09-15')
        self.assertTrue(self.full)
        self.assertEqual(len(self.h), 15)

    def test_named_underlying_swaps_merge_into_the_cash_equity_row(self):
        # 근거는 이름 추측이 아니라 운용사가 쓴 식별자다 —
        # 595112103(MU CUSIP) / 6771720(삼성 SEDOL) / 6450267(하이닉스 SEDOL).
        self.assertAlmostEqual(self.w['MU'], 25.34, places=2)       # 현물 0.42 + 스왑 15.63+9.29
        self.assertAlmostEqual(self.w['005930'], 25.02, places=2)   # 현물 19.03 + 스왑 5.99
        self.assertAlmostEqual(self.w['000660'], 22.82, places=2)   # 현물 17.30 + 스왑 5.52

    def test_unlisted_underlying_keeps_its_identifier(self):
        # CXMT 는 비상장이라 현물 행이 없다. 식별자를 코드로 남기면 어떤 직접 보유와도
        # 매칭되지 않으므로 허위 룩스루를 만들 수 없고, 노출 비중만 정직하게 올라간다.
        self.assertAlmostEqual(self.w['BTMTQT8'], 4.65, places=2)
        self.assertEqual([h['n'] for h in self.h if h['t'] == 'BTMTQT8'], ['CXMT CORPORATION'])

    def test_collateral_and_cash_are_excluded(self):
        for absent in ('FGXXX', '912797VP9', '912797UK1', 'CASHKRW', 'KRW'):
            self.assertNotIn(absent, self.w, absent)

    def test_gross_exposure_may_exceed_100_percent(self):
        # 국채·MMF 담보 위에 스왑을 얹은 펀드라 총 노출이 순자산을 조금 넘는다.
        # 100%로 재정규화하지 않는다 — 그게 사실이다.
        self.assertAlmostEqual(sum(h['w'] for h in self.h), 100.19, places=2)

    def test_exchange_suffixes_are_stripped_only_for_known_venues(self):
        self.assertIn('285A', self.w)          # '285A JP' → 직접 보유 285A.T 와 맞물린다
        self.assertIn('2408', self.w)          # '2408 TT'
        self.assertEqual(etf_sources.strip_exchange_suffix('005930 KS'), '005930')
        self.assertEqual(etf_sources.strip_exchange_suffix('FOO ZZ'), 'FOO ZZ')
        self.assertEqual(etf_sources.strip_exchange_suffix('NVDA'), 'NVDA')

    def test_share_classes_stay_separate(self):
        self.assertIn('005935', self.w)        # 삼성전자우
        self.assertIn('SKHY', self.w)          # SK하이닉스 미국 예탁증권


class ChainPositionTests(unittest.TestCase):
    """파일은 '완전한 원격 출처' 뒤, '부분 출처' 앞이다."""

    def test_fresh_full_remote_basket_still_wins(self):
        full = [{'t': 'NVDA', 'n': 'NVIDIA', 'w': 8.0}]
        with patch.object(collector, 'fetch_proshares', return_value=([], None)), \
             patch.object(collector, 'fetch_invesco', return_value=([], None)), \
             patch.object(collector, 'fetch_stockanalysis', return_value=(full, '2026-09-16', True)):
            _, _, as_of, source, complete = collector.collect_one('DRAM', 'Tema DRAM')
        self.assertEqual(source, 'stockanalysis')
        self.assertEqual(as_of, '2026-09-16')
        self.assertTrue(complete)

    def test_file_beats_partial_remote_lists(self):
        top10 = [{'t': 'NVDA', 'n': 'NVIDIA', 'w': 8.0}]
        with patch.object(collector, 'fetch_proshares', return_value=([], None)), \
             patch.object(collector, 'fetch_invesco', return_value=([], None)), \
             patch.object(collector, 'fetch_stockanalysis', return_value=(top10, '2026-09-16', False)), \
             patch.object(collector, 'fetch_yfinance', return_value=top10) as yf:
            holdings, eq, as_of, source, complete = collector.collect_one('SPYM', 'SPDR Portfolio S&P 500')
        self.assertEqual(source, 'file:State Street')
        self.assertEqual(len(holdings), 503)
        self.assertTrue(complete)
        yf.assert_not_called()

    def test_unregistered_code_falls_through_untouched(self):
        self.assertEqual(etf_sources.fetch_local_source('QQQ', verbose=False), ([], None, False, None))


class ValidationTests(unittest.TestCase):
    """검증에 걸리면 조용히 기존 체인으로 폴백한다 — 지금보다 나빠지지 않는다."""

    def _with_file(self, name, content):
        tmp = Path(tempfile.mkdtemp())
        (tmp / name).write_bytes(content)
        shutil.copy(SRC / 'index.json', tmp / 'index.json')
        return tmp

    def test_corrupt_file_falls_back(self):
        tmp = self._with_file('spym_holdings.xlsx', b'not a zip file at all')
        try:
            with patch.object(etf_sources, 'SOURCE_DIR', str(tmp)), \
                 patch.object(etf_sources, 'INDEX_PATH', str(tmp / 'index.json')):
                self.assertEqual(etf_sources.fetch_local_source('SPYM', verbose=False),
                                 ([], None, False, None))
        finally:
            shutil.rmtree(tmp)

    def test_missing_file_falls_back(self):
        tmp = self._with_file('placeholder.txt', b'')
        try:
            with patch.object(etf_sources, 'SOURCE_DIR', str(tmp)), \
                 patch.object(etf_sources, 'INDEX_PATH', str(tmp / 'index.json')):
                self.assertEqual(etf_sources.fetch_local_source('DRAM', verbose=False),
                                 ([], None, False, None))
        finally:
            shutil.rmtree(tmp)

    def test_every_registered_source_parses(self):
        for code in etf_sources.load_index():
            holdings, as_of, complete, _ = etf_sources.fetch_local_source(code, verbose=False)
            self.assertTrue(holdings, code)
            self.assertTrue(as_of, code)
            self.assertTrue(complete, code)

    def test_index_entries_point_at_committed_files(self):
        for code, spec in etf_sources.load_index().items():
            self.assertIn(spec['format'], etf_sources.PARSERS, code)
            self.assertTrue((SRC / spec['file']).is_file(), code)


class DownloadTests(unittest.TestCase):
    """url 이 등록된 소스는 매 수집 때 새 파일을 먼저 시도하고, 실패하면 커밋된
    파일로 조용히 내려간다 — SPYM·DRAM 처럼 일일 공시라 고정 파일이 낡는 상품용.

    fetch_local_source 는 load_index() 를 인자 없이 호출하므로(내부에서 INDEX_PATH
    기본값을 쓴다), index.json 내용 자체를 바꿔 보려면 load_index 를 patch 하는 쪽이
    INDEX_PATH 전역을 patch 하는 것보다 안전하다 — 후자는 함수 정의 시점에 이미
    바인딩된 기본 인자라 patch 가 반영되지 않는다.
    """

    def _spec_with_url(self, url='https://example.invalid/spym.xlsx'):
        return {'SPYM': {
            'file': 'spym_holdings.xlsx', 'format': 'spdr_xlsx', 'label': 'State Street',
            'expect': {'id': 'SPYM', 'minRows': 400}, 'url': url,
        }}

    def test_successful_download_is_used(self):
        real_bytes = (SRC / 'spym_holdings.xlsx').read_bytes()
        with patch.object(etf_sources, 'load_index', return_value=self._spec_with_url()), \
             patch.object(etf_sources, '_download_source', return_value=real_bytes) as dl:
            holdings, as_of, complete, label = etf_sources.fetch_local_source('SPYM', verbose=False)
        dl.assert_called_once_with('https://example.invalid/spym.xlsx')
        self.assertEqual(len(holdings), 503)
        self.assertEqual(as_of, '2026-09-14')
        self.assertTrue(complete)
        self.assertEqual(label, 'State Street')

    def test_download_failure_falls_back_to_committed_file(self):
        with patch.object(etf_sources, 'load_index', return_value=self._spec_with_url()), \
             patch.object(etf_sources, '_download_source', return_value=None):
            holdings, as_of, complete, label = etf_sources.fetch_local_source('SPYM', verbose=False)
        # 다운로드가 실패해도 커밋된 파일로 내려가 지금과 같은 결과를 낸다.
        self.assertEqual(len(holdings), 503)
        self.assertEqual(as_of, '2026-09-14')
        self.assertTrue(complete)

    def test_downloaded_file_failing_validation_falls_back_to_committed_file(self):
        with patch.object(etf_sources, 'load_index', return_value=self._spec_with_url()), \
             patch.object(etf_sources, '_download_source', return_value=b'not a valid xlsx file'):
            holdings, as_of, complete, label = etf_sources.fetch_local_source('SPYM', verbose=False)
        # 다운로드는 됐지만 파싱/검증에 실패 → 커밋된 파일로 내려간다.
        self.assertEqual(len(holdings), 503)
        self.assertEqual(as_of, '2026-09-14')

    def test_no_url_never_attempts_download(self):
        # 등록에 url 이 없으면(지금의 1629·DRAM처럼) 다운로드 코드 경로를 아예 타지 않는다.
        with patch.object(etf_sources, '_download_source') as dl:
            etf_sources.fetch_local_source('1629', verbose=False)
        dl.assert_not_called()


class MonthlyDisclosureThresholdTests(unittest.TestCase):
    """snapshot_stale 은 etfQuality(JS)와 같은 35평일 임계값을 disclosure='monthly'에 쓴다.

    1629(NEXT FUNDS)는 월 1회만 공시하므로 5평일 규칙으로는 매달 대부분의 날짜가
    지연으로 찍힌다 — 공시 주기 자체를 모델에 넣어 해결한다.
    """

    def test_monthly_disclosure_uses_wider_limit(self):
        today = datetime.date(2026, 9, 22)
        entry = {'asOf': '2026-08-31', 'disclosure': 'monthly', 'name': 'NEXT FUNDS'}
        self.assertFalse(collector.snapshot_stale(entry, today), '16평일 경과는 월간 기준으로 지연이 아니다')

    def test_same_date_without_disclosure_flag_is_stale(self):
        today = datetime.date(2026, 9, 22)
        entry = {'asOf': '2026-08-31', 'name': 'NEXT FUNDS'}
        self.assertTrue(collector.snapshot_stale(entry, today), 'disclosure 표식이 없으면 일반 5평일 규칙을 쓴다')

    def test_monthly_disclosure_still_flags_two_missed_cycles(self):
        today = datetime.date(2026, 9, 22)
        entry = {'asOf': '2026-06-30', 'disclosure': 'monthly', 'name': 'NEXT FUNDS'}
        self.assertTrue(collector.snapshot_stale(entry, today), '두 달 이상 갱신이 없으면 월간 기준도 지연이다')

    def test_threshold_matches_frontend_etfquality(self):
        js = Path(__file__).resolve().parents[2] / 'etf-explorer.js'
        m = __import__('re').search(r'ETF_MONTHLY_DISCLOSURE_LIMIT_WEEKDAYS=(\d+)', js.read_text(encoding='utf-8'))
        self.assertIsNotNone(m, 'etf-explorer.js에서 상수를 찾지 못함')
        self.assertEqual(collector.ETF_MONTHLY_DISCLOSURE_LIMIT_WEEKDAYS, int(m.group(1)),
                          'etfQuality(JS)와 snapshot_stale(Python)의 임계값이 어긋나면 같은 화면이 서로 다른 기준으로 판정한다')


class DisclosureStampingTests(unittest.TestCase):
    """수집기는 index.json의 disclosure를 스냅샷 엔트리에 옮겨 적어야 프런트가 읽을 수 있다."""

    def test_run_stamps_disclosure_from_index_for_file_sourced_etf(self):
        holdings = [{'t': 'A', 'n': 'A', 'w': 10.0}]
        with patch.object(collector, 'is_kr_code', return_value=False), \
             patch.object(collector, 'fetch_proshares', return_value=([], None)), \
             patch.object(collector, 'fetch_invesco', return_value=([], None)), \
             patch.object(collector, 'fetch_stockanalysis', return_value=([], None, False)), \
             patch.object(collector, 'fetch_local_source', return_value=(holdings, '2026-08-31', True, 'NEXT FUNDS')), \
             patch.object(collector, 'load_index', return_value={'1629': {'disclosure': 'monthly'}}), \
             patch.object(collector, 'load_previous', return_value={'etfs': {}}):
            doc = collector.run([('1629', 'NEXT FUNDS 종합리츠', None)], dry_run=True)
        self.assertEqual(doc['etfs']['1629'].get('disclosure'), 'monthly')

    def test_run_omits_disclosure_when_not_registered(self):
        holdings = [{'t': 'A', 'n': 'A', 'w': 10.0}]
        with patch.object(collector, 'is_kr_code', return_value=False), \
             patch.object(collector, 'fetch_proshares', return_value=([], None)), \
             patch.object(collector, 'fetch_invesco', return_value=([], None)), \
             patch.object(collector, 'fetch_stockanalysis', return_value=([], None, False)), \
             patch.object(collector, 'fetch_local_source', return_value=(holdings, '2026-09-14', True, 'State Street')), \
             patch.object(collector, 'load_index', return_value={}), \
             patch.object(collector, 'load_previous', return_value={'etfs': {}}):
            doc = collector.run([('SPYM', 'SPDR Portfolio S&P 500', None)], dry_run=True)
        self.assertNotIn('disclosure', doc['etfs']['SPYM'])


if __name__ == '__main__':
    unittest.main(verbosity=1)
