import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from collect_etf_holdings import parse_proshares_holdings


def row(code='NVDA', weight='0.50%', exposure='--', name='NVIDIA CORP'):
    return '<tr>'+''.join('<td>'+v+'</td>' for v in (weight, code, name, exposure, '$100', '1', '2379504'))+'</tr>'


def page(rows, date='9/08/2026'):
    return '<section id="Holdings">as of '+date+'<table id="holdings"><thead>Exposure Weight Ticker Market Value</thead><tbody>'+rows+'</tbody></table></section>'


class ProSharesTests(unittest.TestCase):
    def test_original_weights_and_non_equity(self):
        rows = row()*100 + row('--', '25%', '10000', 'INDEX SWAP') + row('IQMM', '--', name='PROSHARES GENIUS MNY MKT ETF') + row('--', '--', name='NET OTHER ASSETS')
        holdings, date = parse_proshares_holdings(page(rows))
        self.assertEqual(date, '2026-09-08')
        self.assertEqual(holdings, [{'t': 'NVDA', 'n': 'NVIDIA CORP', 'w': 50.0}])

    def test_reject_truncation_invalid_dates_and_weights(self):
        for text in (page(row()*10), page(row()*100).replace('</table>', ''), page(row()*100, '2/30/2026'), page(row()*99+row(weight='NaN')), page(row()*99+row(weight='--'))):
            self.assertEqual(parse_proshares_holdings(text), ([], None))


if __name__ == '__main__':
    unittest.main()
