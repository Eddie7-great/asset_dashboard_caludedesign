import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import collect_etf_holdings as source
spec = importlib.util.spec_from_file_location('live_dashboard', ROOT / 'api/dashboard.py')
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)

class LiveTests(unittest.TestCase):
    def test_original_weight_and_date(self):
        with patch.object(source, 'fetch_funetf', return_value=([{'t':'NVDA','n':'NVIDIA','w':8.7}], '2026-09-10')):
            result = api.get_live_etf('133690')
        self.assertTrue(result['success'])
        self.assertEqual(result['entry']['equityWeight'], 8.7)
        self.assertEqual(result['entry']['asOf'], '2026-09-10')

    def test_unavailable_and_invalid(self):
        with patch.object(source, 'fetch_funetf', return_value=([], None)):
            self.assertFalse(api.get_live_etf('133690')['success'])
        for code in ('', 'QQQ,QLD', '../private', 'https://example.com'):
            with self.assertRaises(ValueError): api.get_live_etf(code)

if __name__ == '__main__': unittest.main()
