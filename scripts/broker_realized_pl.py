"""증권사 거래내역 → 세금 페이지(실현손익) 가져오기 JSON.

삼성증권(xlsx)·토스증권(PDF)·메리츠증권(PDF) 거래내역을 읽어 월·계좌·종목별 실현손익을
계산하고, 대시보드 세금 페이지의 '거래내역 가져오기' 가 받는 JSON 을 만든다.

    python3 scripts/broker_realized_pl.py 거래내역.zip --owner 본인 --out realized.json

- 표준 라이브러리만 쓴다(xlsx 는 zipfile+ElementTree, PDF 는 콘텐츠 스트림을 zlib 로 풀고
  ToUnicode CMap 으로 글자를 복원한다).
- 국내 종목은 이동평균법, 해외 종목은 원화 기준 선입선출(FIFO)로 계산한다.
- 해외 거래의 원화 환산은 **거래내역서 안에 적힌 환율만** 쓴다(토스 거래별 환율, 삼성·메리츠
  환전 거래). 가까운 날짜에 환율이 없으면(7일 초과) 메모에 '환율 추정'을 붙인다.
- 결과 JSON 과 원본 거래내역은 개인 금융 정보다 — 리포지토리에 커밋하지 않는다.
"""
import argparse
import bisect
import datetime as dt
import io
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
import zlib
from collections import defaultdict

# ───────────────────────── PDF 텍스트 추출 ─────────────────────────

_ESC = {'n': '\n', 'r': '\r', 't': '\t', 'b': '\b', 'f': '\f', '(': '(', ')': ')', '\\': '\\'}


def _unescape_literal(s):
    out = []
    i = 0
    while i < len(s):
        c = s[i]
        if c == '\\' and i + 1 < len(s):
            n = s[i + 1]
            if n in '01234567':
                j = i + 1
                d = ''
                while j < len(s) and len(d) < 3 and s[j] in '01234567':
                    d += s[j]
                    j += 1
                out.append(chr(int(d, 8) & 0xFF))
                i = j
                continue
            if n in '\r\n':
                i += 2
                continue
            out.append(_ESC.get(n, n))
            i += 2
            continue
        out.append(c)
        i += 1
    return ''.join(out)


_TOKEN_RE = re.compile(
    r'/([\w.+-]+)\s+[\d.]+\s+Tf'
    r'|([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm'
    r'|([-\d.]+)\s+([-\d.]+)\s+T[dD]'
    r'|(<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\))\s*Tj'
    r'|\[((?:\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>|[^\]\(<])*)\]\s*TJ'
    r'|\bBT\b',
    re.S)


def pdf_pages(data):
    """PDF 바이트 → 페이지별 [(y, x, text)] 목록. 좌표는 페이지 사용자 공간(회전 전) 기준."""
    objs = {int(m.group(1)): m.group(2)
            for m in re.finditer(rb'(\d+)\s+0\s+obj(.*?)endobj', data, re.S)}

    def stream(o):
        m = re.search(rb'stream\r?\n(.*?)endstream', o, re.S)
        if not m:
            return b''
        raw = m.group(1)
        if b'FlateDecode' in o:
            try:
                return zlib.decompressobj().decompress(raw)
            except zlib.error:
                return b''
        return raw

    cmaps = {}

    def cmap(font_id):
        if font_id in cmaps:
            return cmaps[font_id]
        o = objs.get(font_id, b'')
        t = re.search(rb'/ToUnicode\s+(\d+)\s+0\s+R', o)
        mp, width = {}, 1
        if t:
            s = stream(objs[int(t.group(1))]).decode('latin1')
            for blk in re.findall(r'beginbfchar(.*?)endbfchar', s, re.S):
                for a, c in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
                    mp[int(a, 16)] = bytes.fromhex(c).decode('utf-16-be', 'replace')
                    width = len(a) // 2
            for blk in re.findall(r'beginbfrange(.*?)endbfrange', s, re.S):
                for a, z, c in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
                    base, lo = int(c, 16), int(a, 16)
                    width = len(a) // 2
                    for code in range(lo, int(z, 16) + 1):
                        mp[code] = chr(base + code - lo)
        cmaps[font_id] = (mp, width)
        return cmaps[font_id]

    def page_ids(pid):
        o = objs[pid]
        if re.search(rb'/Type\s*/Pages', o):
            kids = re.search(rb'/Kids\s*\[([^\]]*)\]', o).group(1)
            out = []
            for k in re.findall(rb'(\d+)\s+0\s+R', kids):
                out += page_ids(int(k))
            return out
        return [pid]

    catalog = min(k for k, o in objs.items() if b'/Catalog' in o)
    root = int(re.search(rb'/Pages\s+(\d+)\s+0\s+R', objs[catalog]).group(1))
    pages = []
    for pid in page_ids(root):
        o = objs[pid]
        c = re.search(rb'/Contents\s*(\[[^\]]*\]|\d+\s+0\s+R)', o).group(1)
        ids = [int(x) for x in re.findall(rb'(\d+)\s+0\s+R', c)]
        if len(ids) == 1 and objs[ids[0]].strip().startswith(b'['):
            ids = [int(x) for x in re.findall(rb'(\d+)\s+0\s+R', objs[ids[0]])]
        rm = re.search(rb'/Resources\s+(\d+)\s+0\s+R', o)
        res = objs[int(rm.group(1))] if rm else o
        fm = re.search(rb'/Font\s*(\d+)\s+0\s+R', res)
        font_dict = objs[int(fm.group(1))] if fm else res
        fonts = {}
        for name, fid in re.findall(rb'/([\w.+-]+)\s+(\d+)\s+0\s+R', font_dict):
            if b'BaseFont' in objs.get(int(fid), b''):
                fonts[name.decode()] = int(fid)
        content = b'\n'.join(stream(objs[i]) for i in ids).decode('latin1')
        items = []
        cur = None
        x = y = 0.0

        def decode(s):
            mp, w = cmap(fonts[cur]) if cur in fonts else ({}, 1)
            text = ''
            for h, lit in re.findall(r'<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^\\)])*)\)', s, re.S):
                if h:
                    h = re.sub(r'\s', '', h)
                    for i in range(0, len(h) - 2 * w + 1, 2 * w):
                        text += mp.get(int(h[i:i + 2 * w], 16), '')
                elif lit is not None:
                    bb = _unescape_literal(lit).encode('latin1')
                    if w == 2:
                        for i in range(0, len(bb) - 1, 2):
                            text += mp.get(bb[i] * 256 + bb[i + 1], '')
                    else:
                        text += ''.join(mp.get(ch, chr(ch)) for ch in bb)
            return text

        for m in _TOKEN_RE.finditer(content):
            if m.group(1):
                cur = m.group(1)
            elif m.group(2):
                x, y = float(m.group(6)), float(m.group(7))
            elif m.group(8):
                x += float(m.group(8))
                y += float(m.group(9))
            elif m.group(10):
                items.append((y, x, decode(m.group(10))))
            elif m.group(11) is not None:
                items.append((y, x, decode(m.group(11))))
            else:  # BT
                x = y = 0.0
        pages.append(items)
    return pages


def group_lines(items, tol=2.0):
    """[(y,x,text)] → 위에서 아래로 [(y, [(x,text)...])]. 같은 줄은 x 순."""
    rows = []
    for y, x, t in sorted(items, key=lambda it: (-it[0], it[1])):
        if not t.strip():
            continue
        if rows and abs(rows[-1][0] - y) <= tol:
            rows[-1][1].append((x, t))
        else:
            rows.append([y, [(x, t)]])
    return [(y, sorted(cells)) for y, cells in rows]


# ───────────────────────── 공통 ─────────────────────────

def num(v):
    """'1,234.5' / '($ 1,234.5)' / '-12' → float. 빈 값은 0."""
    s = str(v or '').replace('\xa0', ' ').replace('$', '').replace(',', '')
    s = s.replace('(', '').replace(')', '').strip()
    if not s or s == '-':
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def text_width(t):
    """오른쪽 정렬 숫자의 끝 x 를 어림하기 위한 글자 폭(8pt 전후 본문 기준)."""
    w = 0.0
    for ch in t:
        w += 2.2 if ch in ',.' else (2.6 if ch in '-' else 4.4)
    return w


class Event:
    """정규화된 거래 1건. kind: buy | sell | reinvest | split_* | rename_* | xfer_out | xfer_in | cash_in_lieu | balance."""
    __slots__ = ('date', 'seq', 'broker', 'account', 'book', 'key', 'name', 'market', 'cur',
                 'kind', 'qty', 'amount', 'krw', 'fee', 'balance', 'bal_kind', 'lot_date',
                 'lot_price', 'counter', 'new_key', 'ratio', 'flags')

    def __init__(self, **kw):
        for s in self.__slots__:
            setattr(self, s, kw.get(s))
        if self.flags is None:
            self.flags = set()

    def __repr__(self):
        return f'<{self.date} {self.book} {self.kind} {self.key} q={self.qty} a={self.amount} krw={self.krw}>'


BROKER_LABEL = {'samsung': '삼성', 'toss': '토스', 'meritz': '메리츠'}


# ───────────────────────── 삼성증권 xlsx ─────────────────────────

_NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def xlsx_table(data):
    z = zipfile.ZipFile(io.BytesIO(data))
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in root.findall('m:si', _NS):
            shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % _NS['m'])))
    sheet = sorted(n for n in z.namelist() if n.startswith('xl/worksheets/sheet'))[0]
    rows = []
    for row in ET.fromstring(z.read(sheet)).findall('.//m:row', _NS):
        vals = []
        for c in row.findall('m:c', _NS):
            v = c.find('m:v', _NS)
            t = c.get('t')
            val = v.text if v is not None else ''
            if t == 's' and val:
                val = shared[int(val)]
            elif t == 'inlineStr':
                val = ''.join(tt.text or '' for tt in c.iter('{%s}t' % _NS['m']))
            vals.append(val or '')
        rows.append(vals)
    return rows


def samsung_account(title):
    if 'ISA' in title:
        return 'ISA'
    if '연금' in title:
        return '연금저축'
    return '일반'


SAMSUNG_FOREIGN_BUY = re.compile(r'^(미국|일본|홍콩|중국)\(.+\)(소수점)?주식매수$')
SAMSUNG_FOREIGN_SELL = re.compile(r'^(미국|일본|홍콩|중국)\(.+\)(소수점)?주식매도$')


def parse_samsung(data):
    rows = xlsx_table(data)
    title = rows[0][0] if rows and rows[0] else ''
    account = samsung_account(title)
    book = f'samsung:{account}'
    hdr = rows[1]
    col = {h: i for i, h in enumerate(hdr)}

    def g(r, name):
        i = col.get(name)
        return r[i] if i is not None and i < len(r) else ''

    events, fx = [], []
    body = [r for r in rows[2:] if r and re.match(r'^\d{4}-\d{2}-\d{2}$', r[0] or '')]
    body.reverse()  # 최신순 → 과거순
    for seq, r in enumerate(body):
        date = r[0]
        kind = g(r, '거래명').strip()
        name = g(r, '종목명').strip()
        cur = g(r, '통화코드').strip() or 'KRW'
        qty = num(g(r, '거래수량'))
        price = num(g(r, '거래단가'))
        bal = num(g(r, '잔고수량/펀드평가금액'))
        base = dict(date=date, seq=seq, broker='samsung', account=account, book=book,
                    key=name, name=name)
        if kind in ('외화매수', '외화매도', '시간외외화매수(통합증거금)') and cur in ('USD', 'JPY') and price > 0:
            fx.append((date, cur, price / (100.0 if cur == 'JPY' else 1.0)))
            continue
        if SAMSUNG_FOREIGN_BUY.match(kind) or SAMSUNG_FOREIGN_SELL.match(kind):
            frac = '소수점' in kind
            is_buy = kind.endswith('매수')
            gross = num(g(r, '외화거래금액'))
            net = num(g(r, '외화정산금액'))
            events.append(Event(**base, market='foreign', cur=cur, kind='buy' if is_buy else 'sell',
                                qty=qty, amount=net if net else gross, fee=abs(net - gross),
                                balance=bal, bal_kind='frac' if frac else 'main'))
            continue
        if kind == '재투자':
            # MMF 연말 결산: 이익을 분배하고 기준가를 1,000원으로 되돌린 뒤 분배금으로 좌수를 늘린다.
            # 분배금은 배당(분배)소득이라 매매손익이 아니다 — 원가를 결산 후 평가액으로 맞춘다.
            events.append(Event(**base, market='domestic', cur='KRW', kind='reinvest', qty=qty,
                                amount=num(g(r, '거래금액'))))
            continue
        if kind in ('매수', '매수_NXT', '매도', '매도_NXT') and cur in ('KRW', ''):
            gross = num(g(r, '거래금액'))
            fee = num(g(r, '수수료/Fee'))
            tax = num(g(r, '제세금/대출이자'))
            is_buy = kind in ('매수', '매수_NXT')
            amount = gross + fee if is_buy else gross - fee - tax
            events.append(Event(**base, market='domestic', cur='KRW', kind='buy' if is_buy else 'sell',
                                qty=qty, amount=amount, fee=fee + tax, balance=None if 'MMF' in name else bal,
                                bal_kind='main'))
            continue
        if kind == '청약입고':
            events.append(Event(**base, market='domestic', cur='KRW', kind='buy', qty=qty,
                                amount=qty * price, fee=0, balance=bal, bal_kind='main', flags={'청약'}))
            continue
        if kind in ('분할출고', '병합출고', '분할입고', '병합입고'):
            events.append(Event(**base, market='foreign' if cur != 'KRW' else 'domestic', cur=cur,
                                kind='split_out' if kind.endswith('출고') else 'split_in', qty=qty,
                                balance=bal, bal_kind='main'))
            continue
        if kind == '단수주입금':
            events.append(Event(**base, market='foreign', cur=cur, kind='cash_in_lieu', qty=0,
                                amount=num(g(r, '외화정산금액')) or qty))
            continue
        if kind in ('외화주식종목코드변경출고', '외화주식종목코드변경입고'):
            events.append(Event(**base, market='foreign', cur=cur,
                                kind='rename_out' if kind.endswith('출고') else 'rename_in', qty=qty,
                                balance=bal, bal_kind='main'))
            continue
        if kind == '소수점잔고전환입고':
            events.append(Event(**base, market='foreign', cur=cur, kind='frac_convert', qty=qty,
                                balance=bal, bal_kind='frac'))
            continue
        if kind in ('타사출고', '대체출고'):
            events.append(Event(**base, market='foreign' if cur != 'KRW' else 'domestic', cur=cur,
                                kind='xfer_out', qty=qty, counter=g(r, '상대계좌번호') or g(r, '상대계좌명'),
                                lot_price=price))
            continue
    return events, fx


# ───────────────────────── 토스증권 PDF ─────────────────────────

def _split_name_code(name):
    name = re.sub(r'^[A-Z]{2,5},\s*', '', name)  # '1주이벤트입고' 행의 'NGS, 팬오션(A028670)'
    m = re.match(r'^(.*?)\(([A-Z]{1,2}[0-9A-Z]{6,11})\)$', name)
    if m:
        return m.group(1).strip(), m.group(2)
    return name.strip(), ''


def parse_toss(data):
    """토스 거래내역서: 원화 표(국내) + 달러 표(해외, 원화행 아래 ($ …) 행)."""
    events, fx = [], []
    seq = 0
    section = None
    for items in pdf_pages(data):
        lines = group_lines(items)
        for idx, (y, cells) in enumerate(lines):
            texts = [t.replace('\xa0', ' ').strip() for _, t in cells]
            joined = ' '.join(texts)
            if '원화 거래내역' in joined:
                section = 'KRW'
                continue
            if '달러 거래내역' in joined:
                section = 'USD'
                continue
            if not re.match(r'^\d{4}\.\d{2}\.\d{2}$', texts[0]):
                # 종목명 줄바꿈("(US74347R2067)") → 직전 이벤트 이름에 붙인다
                if len(cells) == 1 and 160 < cells[0][0] < 300 and events and events[-1].seq == seq - 1 \
                        and re.match(r'^\([A-Z0-9]{6,12}\)$', texts[0]):
                    ev = events[-1]
                    base, code = _split_name_code(ev.name + texts[0])
                    ev.name = base
                    ev.key = base
                continue
            date = texts[0].replace('.', '-')
            kind = texts[1]
            # 이름: x 165~290 사이 텍스트(환율 숫자 제외)
            name_parts = [t for x, t in cells if 165 < x < 290 and not re.match(r'^[\d,.]+$', t.replace('\xa0', ''))]
            name = ' '.join(p.replace('\xa0', ' ') for p in name_parts).strip()
            nums = [(x, t) for x, t in cells if x >= 290 and re.match(r'^-?[\d,.]+$', t.replace('\xa0', '').strip())]
            if section == 'USD':
                # 환율, 수량, 거래대금, 정산금액, 단가, 수수료, 제세금, 변제, 잔고, 잔액
                vals = [num(t) for _, t in nums]
                if len(vals) < 10:
                    continue
                rate, qty, gross, settle, price, fee, tax, _rep, bal, _cash = vals[-10:]
                usd = None
                nxt = lines[idx + 1][1] if idx + 1 < len(lines) else []
                usd_vals = [num(t) for _, t in nxt if '$' in t]
                if len(usd_vals) >= 6:
                    usd = usd_vals
                if rate > 0 and kind in ('구매', '판매', '환전외화입금', '환전원화입금', '환전원화출금', '환전외화출금'):
                    fx.append((date, 'USD', rate))
            else:
                vals = [num(t) for _, t in nums]
                if len(vals) < 10:
                    continue
                qty, gross, settle, price, fee, tax_a, tax_b, _rep, bal, _cash = vals[-10:]
                tax = tax_a + tax_b
                rate, usd = 1.0, None
            base_name, code = _split_name_code(name)
            market = 'domestic' if section == 'KRW' else 'foreign'
            base = dict(date=date, seq=seq, broker='toss', account='일반', book='toss:일반', key=base_name,
                        name=base_name, market=market, cur='KRW' if section == 'KRW' else 'USD',
                        balance=bal, bal_kind='main')
            ev = None
            if kind == '구매':
                ev = Event(**base, kind='buy', qty=qty, amount=(usd[0] + usd[3]) if usd else gross + fee,
                           krw=gross + fee, fee=fee)
            elif kind == '판매':
                ev = Event(**base, kind='sell', qty=qty, amount=(usd[0] - usd[3] - usd[4]) if usd else gross - fee - tax,
                           krw=gross - fee - tax, fee=fee + tax)
            elif kind.endswith('이벤트입고'):
                ev = Event(**base, kind='buy', qty=qty, amount=(qty * usd[2]) if usd else qty * price,
                           krw=qty * price, fee=0, flags={'이벤트 입고분 포함'})
            elif kind in ('주식분할출고', '주식분할입고'):
                ev = Event(**base, kind='split_out' if kind.endswith('출고') else 'split_in', qty=qty)
            elif kind == '타사대체출고':
                ev = Event(**base, kind='xfer_out', qty=qty, counter='타사')
            if ev is not None:
                ev.seq = seq
                events.append(ev)
                seq += 1
    return events, fx


# ───────────────────────── 메리츠증권 PDF ─────────────────────────

def _meritz_field(cells, lo, hi, right=True):
    for x, t in cells:
        edge = x + text_width(t.strip()) if right else x
        if lo <= edge <= hi:
            return t.strip()
    return ''


def parse_meritz(data):
    """메리츠 거래내역 증명서: 거래 1건 = 윗줄(일자·적요·수량·금액) + 아랫줄(종목코드·종목명·단가·잔고)."""
    events, fx = [], []
    records = []
    for items in pdf_pages(data):
        lines = group_lines(items)
        cur = None
        for y, cells in lines:
            first = cells[0][1].strip()
            if re.match(r'^\d{4}\.\d{2}\.\d{2}$', first) and cells[0][0] < 40:
                cur = {'top': cells, 'bottom': [], 'extra': []}
                records.append(cur)
            elif cur is not None and not cur['bottom']:
                if cells[0][0] < 40 and not first.startswith('조회'):
                    cur['bottom'] = cells          # 처리지점으로 시작하는 아랫줄
                elif 160 < cells[0][0] < 280:
                    cur['extra'].append(' '.join(t.strip() for _, t in cells))  # 두 줄로 접힌 긴 종목명
    seq = 0
    for rec in records:
        top, bot = rec['top'], rec['bottom']
        date = top[0][1].strip().replace('.', '-')
        kind = ' '.join(t.strip() for x, t in top if 95 < x < 165).strip()
        counter = ' '.join(t.strip() for x, t in top if 165 <= x < 265).strip()
        qty = num(_meritz_field(top, 295, 312))
        fee = num(_meritz_field(top, 330, 346))
        amount = num(_meritz_field(top, 418, 437))
        lot_date = _meritz_field(top, 685, 735, right=False)
        code = ' '.join(t.strip() for x, t in bot if 110 <= x < 168).strip()
        name = ' '.join(rec['extra'] + [t.strip() for x, t in bot if 168 <= x < 268]).strip()
        price = num(_meritz_field(bot, 295, 312))
        tax = num(_meritz_field(bot, 330, 346))
        bot_amount = num(_meritz_field(bot, 380, 437))
        bal_txt = _meritz_field(bot, 612, 640)
        bal = num(bal_txt) if bal_txt else None
        ticker = code.split('.')[0] if code else ''
        base = dict(date=date, seq=seq, broker='meritz', account='일반', book='meritz:일반', key=ticker or name,
                    name=name, market='foreign', cur='USD')
        seq += 1
        k = kind.replace(' ', '')
        if kind in ('시간외환전매수(자동)', '환전외화매도(자체)', '환전외화매수(자체)') and amount > 0 and bot_amount > 0:
            fx.append((date, 'USD', bot_amount / amount))
            continue
        if kind == '해외주식매수대금':
            events.append(Event(**base, kind='buy', qty=qty, amount=amount + fee, fee=fee))
        elif kind == '해외주식매도대금':
            events.append(Event(**base, kind='sell', qty=qty, amount=amount - fee - tax, fee=fee + tax))
        elif kind in ('해외주식매수', '해외주식매도'):
            events.append(Event(**base, kind='balance', qty=0, balance=bal, bal_kind='main'))
        elif kind == '해외주식 매수':
            events.append(Event(**base, kind='buy', qty=qty, amount=amount + fee, fee=fee, balance=bal, bal_kind='main'))
        elif kind == '해외주식 매도':
            events.append(Event(**base, kind='sell', qty=qty, amount=amount - fee - tax, fee=fee + tax, balance=bal,
                                bal_kind='main'))
        elif k == '타사대체입고':
            events.append(Event(**base, kind='xfer_in', qty=qty, lot_date=lot_date.replace('.', '-') if lot_date else date,
                                lot_price=price, counter=counter, balance=bal, bal_kind='main'))
        elif k in ('대체출고', '타사대체출고'):
            events.append(Event(**base, kind='xfer_out', qty=qty, counter=counter, balance=bal, bal_kind='main'))
        elif k in ('액면병합출고', '액면분할출고'):
            events.append(Event(**base, kind='split_out', qty=qty))
        elif k in ('액면병합입고', '액면분할입고'):
            events.append(Event(**base, kind='split_in', qty=qty, balance=bal, bal_kind='main'))
        elif k == '액면병합입금':
            events.append(Event(**base, kind='cash_in_lieu', qty=0, amount=amount or bot_amount))
    return events, fx


# ───────────────────────── 환율 ─────────────────────────

class FxTable:
    """통화별 일자 → 원화 환율(JPY 는 1엔당). 거래내역서 환율 + 공개 일별 환율(FRED, 선택)."""

    def __init__(self):
        self.base = {}   # 통화 → {일자: 공개 일별 환율}
        self.doc = {}    # 통화 → {일자: [거래내역서 환율...]}

    def add_doc(self, date, cur, rate):
        if rate > 0:
            self.doc.setdefault(cur, {}).setdefault(date, []).append(rate)

    def load_fred_csv(self, path):
        """datasets/exchange-rates daily.csv (Date,Country,Exchange rate) — 원/달러, 엔/달러."""
        krw, jpy = {}, {}
        with open(path, encoding='utf-8') as fh:
            for line in fh:
                parts = line.strip().split(',')
                if len(parts) != 3:
                    continue
                d, country, v = parts
                try:
                    val = float(v)
                except ValueError:
                    continue
                if country == 'South Korea':
                    krw[d] = val
                elif country == 'Japan':
                    jpy[d] = val
        usd_tbl = self.base.setdefault('USD', {})
        jpy_tbl = self.base.setdefault('JPY', {})
        for d, v in krw.items():
            usd_tbl[d] = v
            if d in jpy and jpy[d] > 0:
                jpy_tbl[d] = v / jpy[d]

    def rate(self, cur, date):
        """(환율, 추정 여부). 같은 날 거래내역서 환율 → 같은 날 공개 환율 → 7일 안의 가장 가까운 이전 환율.

        거래내역서 환율(국내 증권사가 그날 실제 적용한 값)을 먼저 쓴다. 공개 일별 환율(FRED)은 뉴욕
        정오 기준이라 미국 휴장일에는 비어 있고, 그날 서울 환율과 1% 넘게 벌어질 때가 있다.
        """
        if cur == 'KRW':
            return 1.0, False
        doc = self.doc.get(cur, {})
        base = self.base.get(cur, {})
        target = dt.date.fromisoformat(date)
        for back in range(0, 8):
            d = (target - dt.timedelta(days=back)).isoformat()
            if d in doc:
                vals = sorted(doc[d])
                return vals[len(vals) // 2], False
            if d in base:
                return base[d], False
        # 가까운 환율이 없다 — 양방향으로 가장 가까운 값을 쓰고 추정으로 표시한다
        pool = {d: v for d, v in base.items()}
        for d, v in doc.items():
            pool[d] = sorted(v)[len(v) // 2]
        if not pool:
            raise ValueError(f'{cur} 환율이 없습니다: {date}')
        keys = sorted(pool)
        i = bisect.bisect_left(keys, date)
        cands = [keys[j] for j in (i - 1, i) if 0 <= j < len(keys)]
        best = min(cands, key=lambda d: abs((dt.date.fromisoformat(d) - target).days))
        return pool[best], True


# ───────────────────────── 손익 계산 ─────────────────────────

EPS = 1e-6


class Holding:
    def __init__(self, market):
        self.market = market
        self.lots = []        # 해외: [수량, 원화원가, 취득일]
        self.qty = 0.0        # 국내: 이동평균
        self.cost = 0.0
        self.main = 0.0       # 잔고 대사용(삼성 소수점 잔고는 따로 센다)
        self.frac = 0.0
        self.flags = set()    # 이벤트 입고처럼 매도 손익 메모에 남길 원가 출처
        self.pending_fraction = 0.0

    def total_qty(self):
        return sum(l[0] for l in self.lots) if self.market == 'foreign' else self.qty

    def add(self, qty, krw, date):
        if self.market == 'foreign':
            self.lots.append([qty, krw, date])
        else:
            self.qty += qty
            self.cost += krw

    def remove(self, qty):
        """qty 만큼 원가를 떼어 (원가, 부족수량, 떼어낸 lot 목록) 반환. 해외 FIFO, 국내 이동평균."""
        if self.market == 'foreign':
            need, cost, taken = qty, 0.0, []
            while need > EPS and self.lots:
                lot = self.lots[0]
                take = min(lot[0], need)
                part = lot[1] * (take / lot[0]) if lot[0] > 0 else 0.0
                cost += part
                taken.append([take, part, lot[2]])
                lot[0] -= take
                lot[1] -= part
                need -= take
                if lot[0] <= EPS:
                    self.lots.pop(0)
            return cost, max(0.0, need), taken
        take = min(self.qty, qty)
        cost = self.cost * (take / self.qty) if self.qty > 0 else 0.0
        self.qty -= take
        self.cost -= cost
        if self.qty <= EPS:
            self.qty, self.cost = 0.0, 0.0
        return cost, max(0.0, qty - take), [[take, cost, None]]

    def scale(self, ratio):
        if self.market == 'foreign':
            for lot in self.lots:
                lot[0] *= ratio
        else:
            self.qty *= ratio
        self.main *= ratio
        self.frac *= ratio


def _split_ratio(out_qty, in_qty):
    if out_qty <= 0 or in_qty <= 0:
        return None
    if in_qty >= out_qty:  # 분할
        r = in_qty / out_qty
        return round(r) if abs(r - round(r)) < 0.02 else r
    return 1.0 / int(out_qty // in_qty)  # 병합: 1:N (N = 내림, 단수주는 현금 정산)


def compute(events, fx, report):
    """이벤트(날짜순) → 실현손익 목록 [{date, book, broker, account, key, name, market, qty, pl, flags}]."""
    books = defaultdict(dict)
    realized = []
    pending_xfer = []  # 다른 증권사로 나간 lot (토스 → 메리츠)
    # 같은 날 안의 순서는 원장마다 다르다(삼성은 같은 날 매수·매도가 뒤섞여 잔고가 음수로 찍힌다).
    # 현금 계좌는 공매도가 없으므로 같은 날·같은 계좌에서는 입고·매수를 먼저, 매도·출고를 나중에 둔다.
    phase = {'split_out': 0, 'split_in': 0, 'rename_out': 0, 'rename_in': 0, 'reinvest': 0, 'xfer_in': 1, 'frac_convert': 1,
             'buy': 1, 'sell': 3, 'cash_in_lieu': 3, 'xfer_out': 4, 'balance': 5}
    order = sorted(events, key=lambda e: (e.date, {'samsung': 0, 'toss': 1, 'meritz': 2}[e.broker],
                                          phase.get(e.kind, 2), e.seq))
    # 잔고 대사는 하루 처리가 끝난 뒤, 그날 그 종목에서 원장 순서상 마지막 행의 잔고와 비교한다
    # (중간 행의 잔고는 원장의 행 순서를 따라가므로 음수까지 찍힌다).
    day_bal = {}
    for e in order:
        if e.balance is None or e.kind in ('split_out', 'rename_out'):
            continue
        if e.broker == 'samsung' and e.market == 'domestic' and not e.balance:
            continue  # 삼성 국내 행은 잔고를 0 으로 비워 두는 경우가 많다 — 보고된 값만 대사
        k = (e.date, e.book, e.key, e.bal_kind)
        if k not in day_bal or e.seq > day_bal[k].seq:
            day_bal[k] = e
    by_date = defaultdict(list)
    for k, e in day_bal.items():
        by_date[k[0]].append(e)

    def reconcile(date):
        for e in by_date.get(date, []):
            h = books[e.book].get(e.key)
            if h is None:
                continue
            mine = h.frac if e.bal_kind == 'frac' else (h.main if e.broker == 'samsung' else h.total_qty())
            if abs(mine - e.balance) > max(1e-4, abs(e.balance) * 1e-6):
                report['balance'].append((e.date, e.book, e.name, e.kind, round(mine, 6), e.balance))

    i = 0
    while i < len(order):
        e = order[i]
        book = books[e.book]
        h = book.get(e.key)
        if h is None:
            h = book[e.key] = Holding(e.market)
        if e.kind == 'buy':
            if e.krw is not None:
                krw, est = e.krw, False
            else:
                rate, est = fx.rate(e.cur, e.date)
                krw = e.amount * rate
            h.add(e.qty, krw, e.date)
            h.flags |= set(e.flags) - {'청약'}
            if e.bal_kind == 'frac':
                h.frac += e.qty
            else:
                h.main += e.qty
            if est:
                report['fx_estimated'].append((e.date, e.book, e.name, 'buy'))
        elif e.kind == 'sell':
            if e.krw is not None:
                proceeds, est = e.krw, False
            else:
                rate, est = fx.rate(e.cur, e.date)
                proceeds = e.amount * rate
            cost, short, _ = h.remove(e.qty)
            flags = set(e.flags) | h.flags
            if h.total_qty() <= EPS:
                h.flags = set()
            if est:
                flags.add('환율 추정')
            if short > EPS:
                flags.add('원가 일부 없음')
                report['short'].append((e.date, e.book, e.name, round(short, 6)))
            if e.bal_kind == 'frac':
                h.frac -= e.qty
            else:
                h.main -= e.qty
            realized.append(dict(date=e.date, book=e.book, broker=e.broker, account=e.account, key=e.key,
                                 name=e.name, market=e.market, qty=e.qty, pl=proceeds - cost, flags=flags))
        elif e.kind == 'reinvest':
            h.add(e.qty, e.amount, e.date)
            if e.market == 'domestic' and e.qty > 0 and h.qty > 0:
                h.cost = h.qty * (e.amount / e.qty)  # 결산 후 기준가 × 전체 좌수
        elif e.kind in ('split_out', 'split_in', 'rename_out', 'rename_in'):
            # 같은 날 짝(출고/입고)을 찾는다
            pair_kind = {'split_out': 'split_in', 'split_in': 'split_out',
                         'rename_out': 'rename_in', 'rename_in': 'rename_out'}[e.kind]
            j = next((k for k in range(i + 1, min(i + 12, len(order)))
                      if order[k].kind == pair_kind and order[k].book == e.book and order[k].date == e.date
                      and (e.kind.startswith('rename') or order[k].key == e.key)), None)
            if j is None:
                report['unpaired'].append((e.date, e.book, e.name, e.kind))
                i += 1
                continue
            other = order.pop(j)
            out_e, in_e = (e, other) if e.kind.endswith('out') else (other, e)
            if e.kind.startswith('rename'):
                src = book.pop(out_e.key, None)
                if src is not None:
                    book[in_e.key] = src
            else:
                ratio = _split_ratio(out_e.qty, in_e.qty)
                total = h.total_qty()
                if ratio and total > EPS:
                    h.scale(ratio)
                    if ratio < 1:
                        # 병합 단수주 — 현금 정산분을 뒤에 오는 cash_in_lieu 가 매도로 처리한다
                        whole = int(h.total_qty() + EPS)
                        frac = h.total_qty() - whole
                        h.pending_fraction = frac if frac > EPS else 0.0
                    h.main = in_e.balance if in_e.balance is not None else h.main
        elif e.kind == 'cash_in_lieu':
            frac = h.pending_fraction
            rate, est = fx.rate(e.cur, e.date)
            cost, _, _ = h.remove(frac) if frac > EPS else (0.0, 0, [])
            h.pending_fraction = 0.0
            realized.append(dict(date=e.date, book=e.book, broker=e.broker, account=e.account, key=e.key,
                                 name=e.name, market=e.market, qty=frac, pl=e.amount * rate - cost,
                                 flags={'단수주 현금정산'}))
        elif e.kind == 'frac_convert':
            h.frac -= e.qty
            h.main += e.qty
        elif e.kind == 'xfer_out':
            cost, short, taken = h.remove(e.qty)
            h.main -= e.qty
            if short > EPS:
                report['short'].append((e.date, e.book, e.name, round(short, 6)))
            if e.broker == 'toss':
                pending_xfer.append(dict(date=e.date, qty=e.qty, lots=taken, name=e.name))
        elif e.kind == 'xfer_in':
            match = None
            if '토스' in (e.counter or ''):
                match = next((p for p in pending_xfer if abs(p['qty'] - e.qty) < EPS), None)
            if match:
                pending_xfer.remove(match)
                for q, c, d in match['lots']:
                    h.add(q, c, d)
            else:
                rate, est = fx.rate(e.cur, e.lot_date or e.date)
                h.add(e.qty, e.qty * e.lot_price * rate, e.lot_date or e.date)
                if est:
                    report['fx_estimated'].append((e.date, e.book, e.name, 'xfer_in'))
            h.main += e.qty
        if i + 1 >= len(order) or order[i + 1].date != e.date:
            reconcile(e.date)
        i += 1
    report['open'] = {bk: {k: round(h.total_qty(), 6) for k, h in b.items() if h.total_qty() > EPS}
                      for bk, b in books.items()}
    return realized


# ───────────────────────── 출력 ─────────────────────────

def display_name(r):
    name = re.sub(r'^(USD|JPY|HKD|CNY)\s+|^\(\d{3}\)', '', r['name']).strip()
    if r['broker'] == 'meritz' and r['key'] and r['key'] != r['name']:
        return f"{name}({r['key']})"
    return name


def _qty_text(q, name):
    unit = '좌' if 'MMF' in name else '주'
    txt = f'{q:,.6f}'.rstrip('0').rstrip('.')
    return f'{txt}{unit}'


def build_rows(realized):
    groups = {}
    for r in realized:
        k = (r['date'][:7], r['account'], r['market'], r['broker'], r['key'])
        g = groups.setdefault(k, {'pl': 0.0, 'qty': 0.0, 'flags': set(), 'name': display_name(r), 'n': 0})
        g['pl'] += r['pl']
        g['qty'] += r['qty']
        g['flags'] |= r['flags']
        g['n'] += 1
    rows = []
    for (month, account, market, broker, _key), g in sorted(groups.items()):
        method = '이동평균' if market == 'domestic' else '선입선출'
        parts = [g['name'], BROKER_LABEL[broker], _qty_text(g['qty'], g['name']) + ' 매도', method]
        parts += sorted(g['flags'])
        rows.append({'month': month, 'amt': int(round(g['pl'])), 'memo': ' · '.join(parts)[:240],
                     'category': market, 'account': account})
    return rows


def load_inputs(zip_path):
    events, fx_rows, sources = [], [], []
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            name = info.filename
            if not info.flag_bits & 0x800:
                try:
                    name = name.encode('cp437').decode('cp949')
                except (UnicodeEncodeError, UnicodeDecodeError):
                    pass
            data = z.read(info)
            if name.lower().endswith('.xlsx'):
                ev, fx = parse_samsung(data)
                broker = 'samsung'
            elif name.lower().endswith('.pdf'):
                if b'TossProductSans' in data or '토스' in name:
                    ev, fx = parse_toss(data)
                    broker = 'toss'
                else:
                    ev, fx = parse_meritz(data)
                    broker = 'meritz'
            else:
                continue
            events += ev
            fx_rows += fx
            sources.append((name, broker, len(ev)))
    return events, fx_rows, sources


def run(zip_path, owner, fx_csv=None):
    events, fx_rows, sources = load_inputs(zip_path)
    fx = FxTable()
    if fx_csv:
        fx.load_fred_csv(fx_csv)
    for f in fx_rows:
        fx.add_doc(*f)
    report = defaultdict(list)
    realized = compute(events, fx, report)
    rows = build_rows(realized)
    years = sorted({r['month'][:4] for r in rows})
    payload = {
        'format': 'asset-dashboard/realized-pl',
        'version': 1,
        'owner': owner,
        'years': years,
        'generatedAt': dt.datetime.now().isoformat(timespec='seconds'),
        'method': '국내 이동평균법 · 해외 선입선출(원화 환산: 거래일 환율)',
        'rows': rows,
    }
    return payload, report, sources, realized


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('zip', help='증권사 거래내역 파일들을 담은 zip')
    ap.add_argument('--owner', default='본인')
    ap.add_argument('--fx-csv', help='일별 환율 CSV(datasets/exchange-rates data/daily.csv). 없으면 거래내역서 환율만 쓴다')
    ap.add_argument('--out', help='가져오기 JSON 저장 경로(없으면 stdout)')
    args = ap.parse_args(argv)
    payload, report, sources, _ = run(args.zip, args.owner, args.fx_csv)
    text = json.dumps(payload, ensure_ascii=False, indent=1)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as fh:
            fh.write(text)
    else:
        print(text)
    err = sys.stderr
    print(f'읽은 파일 {len(sources)}개, 기록 {len(payload["rows"])}줄, 연도 {", ".join(payload["years"])}', file=err)
    print(f'원가 부족 매도 {len(report["short"])}건 · 짝 없는 분할/코드변경 {len(report["unpaired"])}건 · '
          f'환율 추정 {len(report["fx_estimated"])}건 · 잔고 불일치 {len(report["balance"])}건', file=err)
    for b in report['balance']:
        print('  잔고 불일치', b, file=err)
    return 0


if __name__ == '__main__':
    sys.exit(main())
