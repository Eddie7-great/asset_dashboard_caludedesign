"""운용사 공식 보유명세 파일 파서 — 리포에 커밋한 파일 자체를 픽스처로 쓴다.

공개 조회 소스가 1629·SPYM 은 상위 10종목, DRAM 은 3종목만 준다(GitHub Actions 실측).
그래서 운용사 공시 파일을 고정 자료로 넣었고, 여기서 그 파일이 실제로 무엇을 내놓는지
숫자로 못 박는다 — 파일을 갱신하다 형식이 바뀌면 조용히 부분 목록으로 되돌아가지 않도록.
"""
import contextlib
import datetime
import io
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

# index.json 에 운용사 다운로드 주소가 등록돼 있으므로, 테스트 중에는 실제 다운로드를 막고
# 커밋된 파일만 읽게 한다(DownloadTests 는 안쪽 patch 로 응답을 직접 넣는다).
_NO_NETWORK = patch.object(etf_sources, '_download_source', return_value=None)


def setUpModule():
    _NO_NETWORK.start()


def tearDownModule():
    _NO_NETWORK.stop()


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
        self.assertEqual(self.as_of, '2026-10-28')
        self.assertTrue(self.full)
        self.assertAlmostEqual(weights(self.h)['NVDA'], 7.8044, places=3)

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


class RoundhillSwapTests(unittest.TestCase):
    """Roundhill DRAM — 기초자산이 명시된 스왑을 그 종목의 노출로 센다.

    커밋된 dram_holdings.csv 는 운용사 전 상품 CSV(Holdings_10292026)에서 DRAM 행만 남긴 것이다.
    """

    def setUp(self):
        self.h, self.as_of, self.full, self.label = etf_sources.fetch_local_source('DRAM', verbose=False)
        self.w = weights(self.h)

    def test_csv_is_read_with_its_real_date(self):
        # Date 열(10/30)은 다음 거래일이다 — 기준일은 그 직전 평일, 즉 파일명의 날짜(10/29)다.
        self.assertEqual(self.as_of, '2026-10-29')
        self.assertTrue(self.full)
        self.assertEqual(len(self.h), 13)
        self.assertEqual(self.label, 'Roundhill')

    def test_named_underlying_swaps_merge_into_the_cash_equity_row(self):
        # 근거는 이름 추측이 아니라 운용사가 쓴 식별자다 —
        # 595112103(MU CUSIP) / 6771720(삼성 SEDOL) / 6450267(하이닉스 SEDOL).
        self.assertAlmostEqual(self.w['MU'], 27.10, places=2)       # 현물 2.92 + 스왑 12.99+11.19
        self.assertAlmostEqual(self.w['005930'], 25.24, places=2)   # 현물 18.44 + 스왑 6.80
        self.assertAlmostEqual(self.w['000660'], 22.23, places=2)   # 현물 16.17 + 스왑 6.06

    def test_unlisted_underlying_keeps_its_identifier(self):
        # CXMT 는 비상장이라 현물 행이 없다. 식별자를 코드로 남기면 어떤 직접 보유와도
        # 매칭되지 않으므로 허위 룩스루를 만들 수 없고, 노출 비중만 정직하게 올라간다.
        self.assertAlmostEqual(self.w['BTMTQT8'], 4.65, places=2)
        self.assertEqual([h['n'] for h in self.h if h['t'] == 'BTMTQT8'], ['CXMT CORPORATION'])

    def test_collateral_and_cash_are_excluded(self):
        for absent in ('FGXXX', '912797VP9', '912797VA2', 'CASHKRW', 'KRW', 'CNY', 'CASH&OTHER'):
            self.assertNotIn(absent, self.w, absent)

    def test_gross_exposure_is_not_renormalised(self):
        # 국채·MMF 담보 위에 스왑을 얹은 펀드라 총 노출이 순자산 근처이거나 넘을 수 있다.
        # 100%로 재정규화하지 않는다 — 그게 사실이다.
        self.assertAlmostEqual(sum(h['w'] for h in self.h), 99.87, places=2)

    def test_exchange_suffixes_are_stripped_only_for_known_venues(self):
        self.assertIn('285A', self.w)          # '285A JP' → 직접 보유 285A.T 와 맞물린다
        self.assertIn('2408', self.w)          # '2408 TT'
        self.assertIn('603986', self.w)        # '603986 C1'
        self.assertEqual(etf_sources.strip_exchange_suffix('005930 KS'), '005930')
        self.assertEqual(etf_sources.strip_exchange_suffix('FOO ZZ'), 'FOO ZZ')
        self.assertEqual(etf_sources.strip_exchange_suffix('NVDA'), 'NVDA')

    def test_share_classes_stay_separate(self):
        self.assertIn('005935', self.w)        # 삼성전자우
        self.assertIn('SKHY', self.w)          # SK하이닉스 미국 예탁증권

    def _csv(self, body):
        tmp = Path(tempfile.mkdtemp())
        path = tmp / 'h.csv'
        path.write_text('Date,Account,StockTicker,CUSIP,SecurityName,Shares,Price,MarketValue,Weightings\n'
                        + body, encoding='utf-8')
        self.addCleanup(shutil.rmtree, tmp)
        return str(path)

    def test_monday_effective_date_maps_back_to_friday(self):
        path = self._csv('10/26/2026,DRAM,MU,595112103,Micron Technology Inc,1,1,1,99.00%\n'
                         '10/26/2026,DRAM,Cash&Other,Cash&Other,Cash & Other,1,1,1,1.00%\n')
        _, as_of, complete = etf_sources.parse_roundhill_csv(path, 'DRAM')
        self.assertEqual(as_of, '2026-10-23')
        self.assertTrue(complete)

    def test_swp_rows_without_names_are_swaps_too(self):
        # 편입 직후 파일에는 이름 없이 '6283601 SWP' 로만 적힌 스왑 행이 섞여 나온다.
        path = self._csv('10/30/2026,DRAM,2408 TT,6283601,Nanya Technology Corp,1,1,1,2.00%\n'
                         '10/30/2026,DRAM,6283601 SWP,6283601 SWP,6283601 SWP,1,1,1,0.21%\n'
                         '10/30/2026,DRAM,Cash&Other,Cash&Other,Cash & Other,1,1,1,97.79%\n')
        holdings, _, _ = etf_sources.parse_roundhill_csv(path, 'DRAM')
        self.assertEqual(holdings, [('2408', 'Nanya Technology Corp', 2.0), ('2408', 'Nanya Technology Corp', 0.21)])

    def test_other_funds_rows_are_rejected(self):
        path = self._csv('10/30/2026,CHAT,MU,595112103,Micron Technology Inc,1,1,1,100.00%\n')
        with self.assertRaises(ValueError):
            etf_sources.parse_roundhill_csv(path, 'DRAM')

    def test_html_not_found_page_is_rejected(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp)
        (tmp / 'h.csv').write_text('<!doctype html>\n<html><body>404</body></html>\n', encoding='utf-8')
        with self.assertRaises(ValueError):
            etf_sources.parse_roundhill_csv(str(tmp / 'h.csv'), 'DRAM')


class ChainPositionTests(unittest.TestCase):
    """파일은 '완전한 원격 출처' 뒤, '부분 출처' 앞이다."""

    def test_fresh_full_remote_basket_still_wins(self):
        full = [{'t': 'NVDA', 'n': 'NVIDIA', 'w': 8.0}]
        with patch.object(collector, 'fetch_proshares', return_value=([], None)), \
             patch.object(collector, 'fetch_invesco', return_value=([], None)), \
             patch.object(collector, 'fetch_stockanalysis', return_value=(full, '2026-09-16', True)):
            _, _, as_of, source, complete = collector.collect_one('DRAM', 'Roundhill Memory ETF')
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
    """url 이 등록된 소스는 새 파일을 먼저 시도하고, 실패하면 커밋된 파일로 내려간다.
    언제 시도할지는 수집기가 리밸런싱·공시 주기로 정한다(RebalanceScheduleTests).

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
        self.assertEqual(as_of, '2026-10-28')
        self.assertTrue(complete)
        self.assertEqual(label, 'State Street')

    def test_download_failure_falls_back_to_committed_file(self):
        with patch.object(etf_sources, 'load_index', return_value=self._spec_with_url()), \
             patch.object(etf_sources, '_download_source', return_value=None):
            holdings, as_of, complete, label = etf_sources.fetch_local_source('SPYM', verbose=False)
        # 다운로드가 실패해도 커밋된 파일로 내려가 지금과 같은 결과를 낸다.
        self.assertEqual(len(holdings), 503)
        self.assertEqual(as_of, '2026-10-28')
        self.assertTrue(complete)

    def test_download_failure_is_logged(self):
        # 수집 로그만 보고도 등록한 주소가 죽었는지 알 수 있어야 한다.
        out = io.StringIO()
        with patch.object(etf_sources, 'load_index', return_value=self._spec_with_url()), \
             patch.object(etf_sources, '_download_source', return_value=None), \
             contextlib.redirect_stdout(out):
            etf_sources.fetch_local_source('SPYM', verbose=True)
        self.assertIn('SPYM: 다운로드 실패 → 커밋된 파일로 폴백', out.getvalue())
        self.assertIn('https://example.invalid/spym.xlsx', out.getvalue())

    def test_downloaded_file_failing_validation_falls_back_to_committed_file(self):
        with patch.object(etf_sources, 'load_index', return_value=self._spec_with_url()), \
             patch.object(etf_sources, '_download_source', return_value=b'not a valid xlsx file'):
            holdings, as_of, complete, label = etf_sources.fetch_local_source('SPYM', verbose=False)
        # 다운로드는 됐지만 파싱/검증에 실패 → 커밋된 파일로 내려간다.
        self.assertEqual(len(holdings), 503)
        self.assertEqual(as_of, '2026-10-28')

    def test_no_url_never_attempts_download(self):
        # 등록에 url 이 없으면 다운로드 코드 경로를 아예 타지 않는다.
        spec = self._spec_with_url()
        del spec['SPYM']['url']
        with patch.object(etf_sources, 'load_index', return_value=spec), \
             patch.object(etf_sources, '_download_source') as dl:
            etf_sources.fetch_local_source('SPYM', verbose=False)
        dl.assert_not_called()

    def _dated_spec(self):
        return {'DRAM': {
            'file': 'dram_holdings.csv', 'format': 'roundhill_csv', 'label': 'Roundhill',
            'expect': {'id': 'DRAM', 'minRows': 10}, 'urlLookbackDays': 7,
            'url': 'https://example.invalid/Holdings_{MMDDYYYY}.csv',
        }}

    def test_dated_url_tries_weekdays_from_today_backwards(self):
        urls = etf_sources.source_urls(self._dated_spec()['DRAM'], datetime.date(2026, 11, 2))  # 월요일
        self.assertEqual([u.rsplit('_', 1)[1] for u in urls],
                         ['11022026.csv', '10302026.csv', '10292026.csv', '10282026.csv', '10272026.csv'])

    def test_dated_url_skips_not_found_pages_and_uses_the_newest_valid_file(self):
        real = (SRC / 'dram_holdings.csv').read_bytes()
        html = b'<!doctype html><html><body>not found</body></html>'
        with patch.object(etf_sources, 'load_index', return_value=self._dated_spec()), \
             patch.object(etf_sources, '_download_source', side_effect=[html, real]) as dl:
            holdings, as_of, complete, label = etf_sources.fetch_local_source(
                'DRAM', verbose=False, today=datetime.date(2026, 10, 30))
        self.assertEqual([c.args[0].rsplit('_', 1)[1] for c in dl.call_args_list], ['10302026.csv', '10292026.csv'])
        self.assertEqual(as_of, '2026-10-29')
        self.assertTrue(complete)

    def test_dated_url_falls_back_after_every_candidate_fails(self):
        out = io.StringIO()
        with patch.object(etf_sources, 'load_index', return_value=self._dated_spec()), \
             patch.object(etf_sources, '_download_source', return_value=None) as dl, \
             contextlib.redirect_stdout(out):
            holdings, as_of, _, _ = etf_sources.fetch_local_source('DRAM', today=datetime.date(2026, 10, 30))
        self.assertEqual(dl.call_count, 5)
        self.assertEqual(as_of, '2026-10-29')   # 커밋된 파일
        self.assertIn('DRAM: 다운로드 실패 → 커밋된 파일로 폴백', out.getvalue())
        self.assertIn('주소 5개 시도', out.getvalue())


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


class RebalanceScheduleTests(unittest.TestCase):
    """리밸런싱·공시 주기가 등록된 상품은 매일 받지 않는다.

    분기(SPYM·DRAM): 3·6·9·12월 셋째 금요일 + 7일과 전월 마지막 평일 중 늦은 날짜 이후 자료가
    있으면 생략(분기 + 월 1회 점검). 월간 공시(1629): 전월 마지막 평일.
    etf-explorer.js 의 etfQuarterlyRebalanceDue 와 같은 날짜표를 쓴다(test_etf_explorer.mjs).
    """

    D = staticmethod(datetime.date.fromisoformat)
    QUARTERLY = {'rebalance': 'quarterly'}

    def test_quarterly_rebalance_due_table(self):
        table = {'2026-09-24': '2026-06-26', '2026-09-25': '2026-09-25', '2026-10-30': '2026-09-25',
                 '2026-12-28': '2026-12-25', '2027-01-05': '2026-12-25'}
        for today, due in table.items():
            self.assertEqual(collector.quarterly_rebalance_due(self.D(today)).isoformat(), due, today)

    def test_collection_due_adds_a_monthly_check(self):
        due = lambda spec, today: collector.collection_due(spec, self.D(today)).isoformat()
        self.assertEqual(due(self.QUARTERLY, '2026-10-30'), '2026-09-30')   # 9/25 리밸런싱보다 월말이 늦다
        self.assertEqual(due(self.QUARTERLY, '2026-11-03'), '2026-10-30')   # 10/31 은 토요일
        self.assertEqual(due(self.QUARTERLY, '2026-12-28'), '2026-12-25')   # 12월 리밸런싱이 월말 점검보다 늦다
        self.assertEqual(due({'disclosure': 'monthly'}, '2026-10-30'), '2026-09-30')
        self.assertIsNone(collector.collection_due({}, self.D('2026-10-30')), '주기가 없으면 매 평일 수집')

    def test_only_a_complete_snapshot_after_the_due_date_skips_collection(self):
        due = self.D('2026-09-30')
        full = {'asOf': '2026-10-29', 'coverage': 'full', 'holdings': [{'t': 'A', 'n': 'A', 'w': 1}]}
        self.assertTrue(collector.collection_not_due(full, due))
        self.assertFalse(collector.collection_not_due({**full, 'asOf': '2026-09-14'}, due))
        self.assertFalse(collector.collection_not_due({**full, 'coverage': 'partial'}, due))
        self.assertFalse(collector.collection_not_due({**full, 'retained': True}, due))
        self.assertFalse(collector.collection_not_due(None, due))
        self.assertFalse(collector.collection_not_due(full, None))

    def _run(self, previous, due):
        holdings = [{'t': 'MU', 'n': 'Micron', 'w': 27.1}]
        with patch.object(collector, 'collect_one',
                          return_value=(holdings, 27.1, '2026-10-29', 'file:Roundhill', True)) as one, \
             patch.object(collector, 'collection_due', return_value=self.D(due)), \
             patch.object(collector, 'load_index', return_value={'DRAM': dict(self.QUARTERLY)}), \
             patch.object(collector, 'load_previous', return_value={'etfs': previous}), \
             contextlib.redirect_stdout(io.StringIO()):
            doc = collector.run([('DRAM', 'Roundhill Memory ETF', None)], dry_run=True)
        return doc, one

    def test_run_keeps_a_current_snapshot_without_any_request(self):
        prev = {'DRAM': {'name': 'Roundhill Memory ETF', 'asOf': '2026-10-29', 'source': 'file:Roundhill',
                         'coverage': 'full', 'equityWeight': 27.1, 'retained': False, 'lastAttempt': '2026-10-30',
                         'rebalance': 'quarterly', 'holdings': [{'t': 'MU', 'n': 'Micron', 'w': 27.1}],
                         'history': [{'asOf': '2026-10-29', 'source': 'file:Roundhill', 'coverage': 'full',
                                      'holdings': [{'t': 'MU', 'n': 'Micron', 'w': 27.1}]}]}}
        doc, one = self._run(prev, '2026-09-30')
        one.assert_not_called()
        self.assertEqual(doc['etfs']['DRAM'], prev['DRAM'], '생략한 날은 스냅샷을 한 글자도 바꾸지 않는다')
        self.assertFalse(doc['etfs']['DRAM']['retained'], '실패가 아니므로 이전 자료 유지 표시를 켜지 않는다')
        self.assertEqual(doc['summary']['complete'], 1)

    def test_run_collects_once_the_due_date_passes(self):
        prev = {'DRAM': {'name': 'Roundhill Memory ETF', 'asOf': '2026-09-15', 'source': 'file:Tema',
                         'coverage': 'full', 'holdings': [{'t': 'MU', 'n': 'Micron', 'w': 25.3}]}}
        doc, one = self._run(prev, '2026-09-30')
        one.assert_called_once()
        self.assertEqual(doc['etfs']['DRAM']['asOf'], '2026-10-29')
        self.assertEqual(doc['etfs']['DRAM']['rebalance'], 'quarterly', '프런트가 읽도록 주기를 옮겨 적는다')

    def test_quarterly_snapshot_is_fresh_until_the_next_rebalance_settles(self):
        entry = {'asOf': '2026-09-28', 'rebalance': 'quarterly', 'name': 'SPDR Portfolio S&P 500'}
        stale = lambda e, today: collector.snapshot_stale(e, self.D(today))
        self.assertFalse(stale(entry, '2026-12-24'), '리밸런싱 이후 자료면 석 달 가까이 지나도 지연이 아니다')
        self.assertFalse(stale(entry, '2027-01-01'), '12월 기준일(12/25) 뒤 5평일까지는 기다린다')
        self.assertTrue(stale(entry, '2027-01-04'), '12월 리밸런싱 뒤 새 자료가 없으면 지연')
        self.assertTrue(stale({**entry, 'asOf': '2026-09-14'}, '2026-10-30'), '9월 리밸런싱 전 자료는 지연')
        self.assertFalse(stale({**entry, 'asOf': '2026-09-14'}, '2026-09-30'), '기준일(9/25) 뒤 5평일 이내')

    def test_every_etf_gets_a_cycle(self):
        # 등록값이 우선이고, 없으면 이름으로 — 액티브는 주 1회, 그 외 지수형은 분기 + 월 1회 점검.
        self.assertEqual(collector.schedule_for({'disclosure': 'monthly'}, 'NEXT FUNDS'), {'disclosure': 'monthly'})
        self.assertEqual(collector.schedule_for({}, 'TIME 미국S&P500액티브'), {'rebalance': 'weekly'})
        self.assertEqual(collector.schedule_for({}, 'Fidelity Active Fund'), {'rebalance': 'weekly'})
        self.assertEqual(collector.schedule_for({}, 'TIGER 미국나스닥100'), {'rebalance': 'quarterly'})
        self.assertEqual(collector.schedule_for({}, 'RISE 200TR'), {'rebalance': 'quarterly'})

    def test_weekly_cycle_is_due_from_monday(self):
        weekly = {'rebalance': 'weekly'}
        self.assertEqual(collector.collection_due(weekly, self.D('2026-10-30')).isoformat(), '2026-10-26')  # 금
        self.assertEqual(collector.collection_due(weekly, self.D('2026-11-03')).isoformat(), '2026-11-02')  # 화

    def test_weekly_snapshot_is_stale_after_seven_weekdays(self):
        entry = {'asOf': '2026-10-20', 'rebalance': 'weekly', 'name': 'TIME 미국S&P500액티브'}
        self.assertFalse(collector.snapshot_stale(entry, self.D('2026-10-29')), '7평일 — 주 1회 주기 안')
        self.assertTrue(collector.snapshot_stale(entry, self.D('2026-10-30')), '8평일 — 지연')

    def test_never_collected_etf_is_retried_once_per_cycle(self):
        due = self.D('2026-09-30')
        self.assertTrue(collector.needs_collection(None, due, None), '시도한 적 없으면 받는다')
        self.assertTrue(collector.needs_collection(None, due, '2026-09-29'), '기준일 전 시도는 다시')
        self.assertFalse(collector.needs_collection(None, due, '2026-10-02'), '같은 기준일 안에서는 재시도 안 함')

    def _run_missing(self, previous, due='2026-09-30', collected=None):
        result = collected or ([], 0.0, None, None, False)
        with patch.object(collector, 'collect_one', return_value=result) as one, \
             patch.object(collector, 'collection_due', return_value=self.D(due)), \
             patch.object(collector, 'load_index', return_value={}), \
             patch.object(collector, 'load_previous', return_value=previous), \
             contextlib.redirect_stdout(io.StringIO()):
            doc = collector.run([('BMNU', 'T-REX 2X Long BMNR Daily Target', None)], dry_run=True)
        return doc, one

    def test_run_records_and_respects_failed_attempts(self):
        doc, one = self._run_missing({'etfs': {}})
        one.assert_called_once()
        self.assertIn('BMNU', doc['attempts'], '못 받은 ETF 는 시도일을 남긴다')
        self.assertEqual(doc['failures'], ['T-REX 2X Long BMNR Daily Target'])
        doc, one = self._run_missing({'etfs': {}, 'attempts': {'BMNU': '2026-10-01'}})
        one.assert_not_called()
        self.assertEqual(doc['failures'], ['T-REX 2X Long BMNR Daily Target'], '생략해도 미조회로 남는다')
        self.assertEqual(doc['attempts'], {'BMNU': '2026-10-01'})

    def test_attempt_record_is_dropped_once_collected(self):
        holdings = [{'t': 'BMNR', 'n': 'BitMine', 'w': 100.0}]
        doc, _ = self._run_missing({'etfs': {}, 'attempts': {'BMNU': '2026-09-01'}},
                                   collected=(holdings, 100.0, '2026-10-29', 'provider', True))
        self.assertNotIn('attempts', doc)
        self.assertEqual(doc['etfs']['BMNU']['rebalance'], 'quarterly')

    def test_due_codes_lists_only_what_this_run_must_fetch(self):
        prev = {'etfs': {
            'QQQ': {'name': 'Invesco QQQ', 'asOf': '2026-10-28', 'coverage': 'full', 'holdings': [{'t': 'A', 'n': 'A', 'w': 1}]},
            '426020': {'name': 'TIME 미국S&P500액티브', 'asOf': '2026-10-23', 'coverage': 'full',
                       'holdings': [{'t': 'A', 'n': 'A', 'w': 1}]},
        }}
        with patch.object(collector, 'load_previous', return_value=prev), \
             patch.object(collector, 'load_index', return_value={}):
            codes = collector.due_codes([('QQQ', 'Invesco QQQ', None), ('426020', 'TIME 미국S&P500액티브', None),
                                         ('NEW', 'New Fund', None)], today=self.D('2026-10-30'))
        # QQQ: 10/28 ≥ 기준일 9/30 → 생략 / 액티브: 10/23 < 이번 주 월요일 10/26 → 받음 / 처음 보는 ETF → 받음
        self.assertEqual(codes, ['426020', 'NEW'])

    def test_constants_match_frontend_etfquality(self):
        js = (Path(__file__).resolve().parents[2] / 'etf-explorer.js').read_text(encoding='utf-8')
        for name in ('ETF_REBALANCE_SETTLE_DAYS', 'ETF_REBALANCE_GRACE_WEEKDAYS', 'ETF_WEEKLY_LIMIT_WEEKDAYS'):
            m = __import__('re').search(name + r'=(\d+)', js)
            self.assertIsNotNone(m, name)
            self.assertEqual(getattr(collector, name), int(m.group(1)), name)


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
