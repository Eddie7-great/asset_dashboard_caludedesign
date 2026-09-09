"""ETF quality and dated history regressions; no network or account access."""
import copy
import datetime
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import collect_etf_holdings as c
from etf_common import parse_krx_pdf, is_equity_row, norm_holding_code

def snapshot(day='2026-09-07', weight=5, source='provider:TIME', coverage='full'):
    return {'asOf': day, 'source': source, 'coverage': coverage,
            'holdings': [{'t': 'NVDA', 'n': 'NVIDIA', 'w': weight}], 'name': 'TIME 액티브'}

for name in ['S&P500 EMINI FUT SEPT2026', 'NASDAQ E-MINI INDEX', 'First American Government Obligations', 'ProShares GENIUS Money Market ETF']:
    assert not is_equity_row('ESU6', name), name
assert norm_holding_code('005930.KQ') == '005930'
assert norm_holding_code('BRK/B') == 'BRK.B'
assert norm_holding_code('005935') != norm_holding_code('005930')

# KRX publishes foreign rows with quantities but no valuation/weight. Do not accept only the domestic leg.
krx = [{'COMPST_ISU_CD': '005930', 'COMPST_ISU_NM': '삼성전자', 'COMPST_RTO': '4.2', 'VALU_AMT': '42'},
       {'COMPST_ISU_CD': 'US0378331005', 'COMPST_ISU_NM': 'Apple', 'COMPST_RTO': '-', 'VALU_AMT': '-'}]
assert parse_krx_pdf(krx) == ([], 0.0)
assert c.clean_snapshot({'holdings':[{'t':'ESU6','n':'EMINI FUT SEPT2026','w':8}]}) is None
assert c.clean_snapshot({'holdings':[{'t':'X','n':'Equity','w':float('nan')}]}) is None

time_html='''<div id="constituentItems"><input id="pdfDate" value="2026-09-09"><table>
<tr><td>AAPL US EQUITY</td><td>Apple</td><td>1</td><td>100</td><td>6.2</td></tr>
<tr><td>ESU6 INDEX</td><td>EMINI FUT SEPT2026</td><td>1</td><td>10</td><td>2.0</td></tr></table></div>'''
h,date=c.parse_time_holdings(time_html)
assert date=='2026-09-09' and len(h)==1 and h[0]['w']==6.2
invesco={'effectiveBusinessDate':'2026-09-04','effectiveDate':'2026-09-07','totalNumberOfHoldings':3,'holdings':[
    {'ticker':'ASML','issuerName':'ASML','securityTypeName':'American Depository Receipt - NY','percentageOfTotalNetAssets':.69},
    {'ticker':'AAPL','issuerName':'Apple','securityTypeName':'Common Stock','percentageOfTotalNetAssets':7.4},
    {'ticker':'NQU6','issuerName':'E-Mini Index Future','securityTypeName':'Index Future','percentageOfTotalNetAssets':.12}]}
h,date=c.parse_invesco_holdings(invesco)
assert date=='2026-09-04' and len(h)==2 and round(sum(x['w'] for x in h),2)==8.09
assert c.parse_invesco_holdings({**invesco,'totalNumberOfHoldings':4})[0]==[]

old=snapshot(); new=snapshot('2026-09-08',6)
c.preserve_history(new,old)
assert [s['asOf'] for s in new['history']]==['2026-09-07','2026-09-08']
corrected=snapshot('2026-09-08',7); c.preserve_history(corrected,new)
assert len(corrected['history'])==2 and corrected['history'][-1]['holdings'][0]['w']==7
for i in range(45):
    next_entry=snapshot((datetime.date(2026,9,9)+datetime.timedelta(days=i)).isoformat(),i+1)
    c.preserve_history(next_entry,corrected);corrected=next_entry
assert len(corrected['history'])==30
original=copy.deepcopy(old)
with patch.object(c,'load_previous',return_value={'etfs':{'426020':old}}),patch.object(c,'collect_one',return_value=([],0,None,None)):
    doc=c.run([('426020','TIME 액티브','426020')],dry_run=True)
    assert doc['etfs']['426020']['retained'] and doc['etfs']['426020']['asOf']=='2026-09-07'
assert old==original, 'Do not mutate the previous snapshot'
with patch.object(c,'load_previous',return_value={'etfs':{'426020':old}}),patch.object(c,'collect_one',return_value=([{'t':'NVDA','n':'NVIDIA','w':3}],3,'2026-09-01','provider:TIME')):
    doc=c.run([('426020','TIME 액티브','426020')],dry_run=True)
    assert doc['etfs']['426020']['asOf']=='2026-09-07', 'Do not regress to an older provider date'
print('PASS ETF source validation, futures exclusions, same-date corrections, bounded history, retained snapshots')
