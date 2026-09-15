import sys
import datetime
import io
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import collect_etf_holdings as collector
from etf_common import norm_holding_code


class LiveFallbackTests(unittest.TestCase):
    def test_domestic_live_falls_back_once_and_reports_sources(self):
        import ast, os, re, time
        api = Path(__file__).resolve().parents[2] / 'api/dashboard.py'
        tree = ast.parse(api.read_text(encoding='utf-8'))
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'get_live_etf')
        ctx = {'__file__':str(api),'os':os,'re':re,'time':time,'datetime':datetime}
        exec(compile(ast.Module(body=[function],type_ignores=[]),str(api),'exec'),ctx)
        rows=[{'t':'NVDA','n':'NVIDIA','w':8}]
        with patch.object(collector,'fetch_funetf',return_value=([],None)),patch.object(collector,'fetch_zeroin',return_value=(rows,8,'2026-09-14')) as fallback:
            result=ctx['get_live_etf']('133690')
            self.assertTrue(result['success'])
            self.assertEqual(result['entry']['source'],'zeroin')
            self.assertEqual(result['entry']['holdings'][0]['w'],8)
            fallback.assert_called_once_with('133690',max_attempts=1)
            self.assertEqual(result['attempts'],[{'source':'FunETF','ok':False},{'source':'zeroin','ok':True}])


class FunEtfTests(unittest.TestCase):
    isin = 'KR7133690008'

    def rows(self):
        return [dict(etfCd=self.isin, total=5, viewGrp='Y', ticker=t, citmNm=n, evP=w) for t,n,w in [('NVDA US','NVIDIA',8.7),('KR US','Kroger',.05),('BRK/B US','Berkshire Class B',1.2),('', '원화현금',2),('ESU6','NASDAQ FUTURES',4)]]

    def test_weights_and_stock_identifiers(self):
        h = collector.parse_funetf_holdings(self.rows(), self.isin)
        self.assertEqual({x['t']:x['w'] for x in h}, {'NVDA':8.7,'KR':.05,'BRK.B':1.2})
        self.assertEqual(norm_holding_code('KRC'),'KRC')
        self.assertIsNone(norm_holding_code('KRD010010001'))

    def test_reject_incomplete_invalid_and_wrong_fund(self):
        self.assertEqual(collector.parse_funetf_holdings(self.rows()[:-1],self.isin),[])
        for value in (None,float('nan'),-1):
            rows=self.rows();rows[0]['evP']=value
            self.assertEqual(collector.parse_funetf_holdings(rows,self.isin),[])
        self.assertEqual(collector.parse_funetf_holdings(self.rows(),'OTHER'),[])

    def test_failure_falls_back_without_losing_krx(self):
        with patch.object(collector,'fetch_funetf',return_value=([],None)), patch.object(collector,'fetch_krx',return_value=([{'t':'NVDA','n':'NVIDIA','w':8}],8,'2026-09-09')):
            self.assertEqual(collector.collect_one('133690','Fund')[3],'krx')

    def test_mixed_basket_excludes_monetary_stabilization_bonds(self):
        rows=self.rows()
        rows[3].update(ticker=None,grpItmNo='KR310102GG17',citmNm='통화안정증권02550-2701-01',evP=8.37)
        result=collector.parse_funetf_holdings(rows,self.isin)
        self.assertEqual({h['t']:h['w'] for h in result},{'NVDA':8.7,'KR':.05,'BRK.B':1.2})

    def test_composition_date_uses_korean_day_on_utc_servers(self):
        class Clock(datetime.datetime):
            @classmethod
            def now(cls,tz=None):
                return cls(2026,9,10,23,tzinfo=datetime.timezone.utc).astimezone(tz)
        for date,expected in [('20260911',3),('20260912',0)]:
            html=('<input name="itemId" value="'+self.isin+'"><script>let etfPdfYmd="'+date+'";</script>').encode()
            with patch.object(collector,'_funetf_catalog',{'133690':self.isin}),patch.object(collector.datetime,'datetime',Clock),patch.object(collector.urllib.request,'urlopen',return_value=io.BytesIO(html)),patch.object(collector,'http_json',return_value=self.rows()):
                rows,_=collector.fetch_funetf('133690')
                self.assertEqual(len(rows),expected)

    def test_only_public_product_fields_are_serialized(self):
        parser=collector._FunEtfFormParser()
        parser.feed('<input name="itemId" value="'+self.isin+'"><input name="_csrf" value="private"><input name="roleType" value="ROLE_ANONYMOUS">')
        self.assertEqual(parser.params,{'itemId':self.isin})


if __name__=='__main__':
    unittest.main()
