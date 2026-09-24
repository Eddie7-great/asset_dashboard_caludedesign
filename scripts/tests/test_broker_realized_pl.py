#!/usr/bin/env python3
"""증권사 거래내역 → 실현손익 계산기(scripts/broker_realized_pl.py) 단위 테스트.

실제 거래내역은 개인 금융 정보라 리포에 두지 않는다 — 여기 있는 거래는 전부 손으로 만든 값이다.
"""
import io
import os
import sys
import zipfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE)))

import broker_realized_pl as B  # noqa: E402

PASS, FAIL = [], []


def check(name, got, expected):
    if got == expected:
        PASS.append(name)
        print('  PASS  %s' % name)
    else:
        FAIL.append(name)
        print('  FAIL  %s\n        got=%r\n        expected=%r' % (name, got, expected))


def ev(date, kind, key='AAA', book='meritz:일반', broker='meritz', market='foreign', cur='USD', seq=0, **kw):
    return B.Event(date=date, seq=seq, broker=broker, account='일반', book=book, key=key, name=kw.pop('name', key),
                   market=market, cur=cur, kind=kind, **kw)


def fx_table(rates):
    fx = B.FxTable()
    for d, r in rates.items():
        fx.add_doc(d, 'USD', r)
    return fx


def run(events, fx):
    rep = defaultdict(list)
    return B.compute(events, fx, rep), rep


print('해외 선입선출(원화 기준)')
fx = fx_table({'2025-01-02': 1000, '2025-02-03': 1100, '2025-03-03': 1200})
realized, rep = run([
    ev('2025-01-02', 'buy', qty=10, amount=100.0, seq=0),   # lot1: 10주 × $10 × 1000 = 100,000원
    ev('2025-02-03', 'buy', qty=10, amount=200.0, seq=1),   # lot2: 10주 × $20 × 1100 = 220,000원
    ev('2025-03-03', 'sell', qty=15, amount=450.0, seq=2),  # $450 × 1200 = 540,000원
], fx)
check('FIFO 는 먼저 산 lot 부터 원가로 쓴다', round(realized[0]['pl']), 540000 - 100000 - 110000)
check('원가 부족 없음', rep['short'], [])

print('국내 이동평균')
realized, _ = run([
    ev('2025-01-02', 'buy', market='domestic', cur='KRW', qty=10, amount=100000, seq=0),
    ev('2025-01-03', 'buy', market='domestic', cur='KRW', qty=10, amount=300000, seq=1),
    ev('2025-01-04', 'sell', market='domestic', cur='KRW', qty=5, amount=120000, seq=2),
], B.FxTable())
check('평균단가 20,000원으로 5주 원가 100,000원', round(realized[0]['pl']), 20000)

realized, _ = run([
    ev('2025-06-02', 'buy', key='MMF', market='domestic', cur='KRW', qty=1000, amount=1010, seq=0),
    ev('2025-12-26', 'reinvest', key='MMF', market='domestic', cur='KRW', qty=20, amount=20, seq=1),
    ev('2026-01-05', 'sell', key='MMF', market='domestic', cur='KRW', qty=510, amount=510.5, seq=2),
], B.FxTable())
check('MMF 결산 재투자 뒤에는 원가를 결산 기준가로 맞춰 가짜 손실을 만들지 않는다', round(realized[0]['pl'], 2), 0.5)

print('같은 날 매수·매도 순서')
realized, rep = run([
    ev('2025-01-02', 'sell', qty=5, amount=60.0, seq=0, balance=-5, bal_kind='main'),
    ev('2025-01-02', 'buy', qty=5, amount=50.0, seq=1, balance=0, bal_kind='main'),
], fx_table({'2025-01-02': 1000}))
check('원장 순서가 매도→매수여도 매수를 먼저 처리한다', round(realized[0]['pl']), 10000)
check('잔고는 원장 순서상 마지막 행으로 대사한다', rep['balance'], [])

print('분할·병합')
realized, _ = run([
    ev('2025-01-02', 'buy', qty=2, amount=200.0, seq=0),
    ev('2025-02-03', 'split_out', qty=2, seq=1),
    ev('2025-02-03', 'split_in', qty=8, seq=2),
    ev('2025-03-03', 'sell', qty=8, amount=240.0, seq=3),
], fx_table({'2025-01-02': 1000, '2025-02-03': 1000, '2025-03-03': 1000}))
check('4:1 분할 후 전량 매도 — 총원가 유지', round(realized[0]['pl']), 40000)
check('분할 비율', B._split_ratio(7, 21), 3)
check('병합 비율은 내림(단수주는 현금정산)', B._split_ratio(432, 21), 1 / 20)

realized, rep = run([
    ev('2025-01-02', 'buy', qty=7, amount=70.0, seq=0),
    ev('2025-02-03', 'split_out', qty=7, seq=1),
    ev('2025-02-03', 'split_in', qty=3, seq=2),
    ev('2025-02-05', 'cash_in_lieu', qty=0, amount=9.0, seq=3),
], fx_table({'2025-01-02': 1000, '2025-02-03': 1000, '2025-02-05': 1000}))
# 7주(원가 70,000원) → 3.5주: 단수 0.5주의 원가는 70,000 × 0.5/3.5 = 10,000원
check('1:2 병합 단수주 0.5주를 현금정산 매도로 계산', (round(realized[0]['qty'], 6), round(realized[0]['pl'])),
      (0.5, 9000 - 10000))

print('증권사 간 이관')
realized, rep = run([
    ev('2024-01-02', 'buy', key='T', book='toss:일반', broker='toss', qty=3, amount=30.0, krw=39000, seq=0),
    ev('2025-01-10', 'xfer_out', key='T', book='toss:일반', broker='toss', qty=3, seq=1),
    ev('2025-01-11', 'xfer_in', key='TT', qty=3, lot_price=10.0, lot_date='2025-01-10', counter='토스증권(주)', seq=0),
    ev('2025-02-03', 'sell', key='TT', qty=3, amount=60.0, seq=1),
], fx_table({'2025-01-10': 1400, '2025-02-03': 1500}))
check('토스에서 온 주식은 토스 원가(원화)를 그대로 가져간다', round(realized[0]['pl']), 90000 - 39000)

realized, _ = run([
    ev('2025-02-10', 'xfer_in', qty=2, lot_price=100.0, lot_date='2023-04-28', counter='삼성증권(투자자)', seq=0),
    ev('2025-03-03', 'sell', qty=2, amount=300.0, seq=1),
], fx_table({'2023-04-28': 1300, '2025-03-03': 1400}))
check('입고 행의 원 매수일·단가로 원가를 세운다', round(realized[0]['pl']), 420000 - 260000)

print('환율')
fx = fx_table({'2025-01-02': 1000})
fx.base['USD'] = {'2025-01-02': 990, '2025-01-03': 995}
check('같은 날 거래내역서 환율이 공개 환율보다 먼저', fx.rate('USD', '2025-01-02'), (1000, False))
check('거래내역서가 없는 날은 공개 환율', fx.rate('USD', '2025-01-03'), (995, False))
check('7일 안에 없으면 가장 가까운 값을 추정으로', fx.rate('USD', '2025-02-20'), (995, True))

print('출력 행')
rows = B.build_rows([
    dict(date='2025-03-03', book='meritz:일반', broker='meritz', account='일반', key='AAPL', name='애플',
         market='foreign', qty=2, pl=1000.4, flags=set()),
    dict(date='2025-03-20', book='meritz:일반', broker='meritz', account='일반', key='AAPL', name='애플',
         market='foreign', qty=3, pl=-200.2, flags={'이벤트 입고분 포함'}),
    dict(date='2025-03-05', book='samsung:ISA', broker='samsung', account='ISA', key='(001)X MMF', name='(001)X MMF',
         market='domestic', qty=1000, pl=12, flags=set()),
])
check('같은 달·계좌·종목은 한 줄로 합친다', len(rows), 2)
check('해외 행', rows[1], {'month': '2025-03', 'amt': 800, 'category': 'foreign', 'account': '일반',
                         'memo': '애플(AAPL) · 메리츠 · 5주 매도 · 선입선출 · 이벤트 입고분 포함'})
check('MMF 는 좌 단위', rows[0]['memo'], 'X MMF · 삼성 · 1,000좌 매도 · 이동평균')

print('삼성 xlsx 파서')


def _xlsx(rows):
    def cell(v):
        return '<c t="inlineStr"><is><t>%s</t></is></c>' % v
    body = ''.join('<row>%s</row>' % ''.join(cell(v) for v in r) for r in rows)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr('xl/worksheets/sheet1.xml',
                   '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                   '<sheetData>%s</sheetData></worksheet>' % body)
    return buf.getvalue()


HDR = ['거래일자', '거래명', '거래수량', '거래금액', '제세금/대출이자', '현금잔액', '상대계좌명', '변제금액', '통화코드',
       '외화정산금액', '거래번호', '종목명', '거래단가', '정산금액', '수수료/Fee', '잔고수량/펀드평가금액', '상대계좌번호',
       '신용/대출금', '외화거래금액', '외화예수금액', '처리점']


def srow(**kw):
    return [kw.get(h, '') for h in HDR]


data = _xlsx([
    ['0000 [ ISA(중개형) ] 홍길동'], HDR,
    srow(거래일자='2025-01-03', 거래명='매도', 거래수량='1', 거래금액='12,000', **{'제세금/대출이자': '24', '수수료/Fee': '2'},
         종목명='테스트'),
    srow(거래일자='2025-01-02', 거래명='외화매수', 통화코드='USD', 거래단가='1,450.5', 종목명='USD'),
    srow(거래일자='2025-01-02', 거래명='매수', 거래수량='1', 거래금액='10,000', **{'수수료/Fee': '1'}, 종목명='테스트'),
])
events, fx_rows = B.parse_samsung(data)
check('계좌 제목으로 ISA 판별', {e.account for e in events}, {'ISA'})
check('최신순 원장을 과거순으로 뒤집는다', [e.kind for e in events], ['buy', 'sell'])
check('매수 원가는 수수료 포함, 매도는 수수료·세금 차감', [e.amount for e in events], [10001.0, 11974.0])
check('외화매수 행은 환율로 쓴다', fx_rows, [('2025-01-02', 'USD', 1450.5)])

print('PDF 문자열 복원')
check('8진수·제어문자 이스케이프', B._unescape_literal(r'\b\f\101\(x\)'), '\b\fA(x)')
check('같은 높이의 글자는 한 줄로', B.group_lines([(100.0, 50, 'b'), (100.5, 10, 'a'), (80, 10, 'c')]),
      [(100.5, [(10, 'a'), (50, 'b')]), (80, [(10, 'c')])])

print('\n%d개 항목 · 실패 %d건' % (len(PASS) + len(FAIL), len(FAIL)))
sys.exit(1 if FAIL else 0)
