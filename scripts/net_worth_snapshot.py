#!/usr/bin/env python3
"""순자산 일별 스냅샷 기록 배치 (GitHub Actions).

앱(script.js `updateNetWorthSnapshot`)은 브라우저를 열어야만 그날 스냅샷을 남긴다.
며칠 들어가지 않으면 그 날짜는 영구히 빈칸이 되고, 순자산 추이의 기간 버튼
(1M/3M/6M/1Y/전체)이 전부 같은 구간을 보여주게 된다. 이 배치가 매일 같은 계산을
대신 수행해 기록의 공백을 없앤다.

**계산 규칙은 `script.js`의 `updateNetWorthSnapshot`과 어긋나면 안 된다.**
정의가 갈리면 순자산 변화 분석의 잔차가 통째로 왜곡된다(과거 schemaV 사고와 같은 종류).
`scripts/tests/test_net_worth_snapshot.py`가 아래 규칙을 JS 원본과 대조해 고정한다:

  - 평가액 = qty × curP × RATES[cur]. 단 금(`grp=='금'`)은 환율을 곱하지 않는다
    (curP가 이미 '단위당 원화'이므로 곱하면 이중 환산이 된다)
  - total = 투자자산 + 기타자산(balanceSheet.assets) − 부채(balanceSheet.liabilities)
  - 소유주 판정은 `owner or '본인'` (script.js `filterByOwner`와 동일)
  - schemaV=2를 찍고 portfolioByOwner·netByOwner를 함께 남긴다
  - 같은 날짜 항목이 있으면 교체하고, 365건을 넘으면 오래된 것부터 버린다

시세 조회는 `api/dashboard.py`의 함수를 그대로 import해서 쓴다(중복 구현 금지).
다만 종목의 시장 판정은 `get_prices()`의 `isdigit()` 규칙 대신 자산에 저장된
`grp`/`cur`를 따른다 — KRX 단축코드에는 `0117V0` 같은 영숫자 코드가 있어서
숫자 여부로 판정하면 미국 주식으로 오인한다(CLAUDE.md의 'KR ticker shape' 규칙).

KV 쓰기는 `api/kv.ts`와 같은 낙관적 동시성(CAS) 프로토콜을 쓴다. 개정번호가 어긋나면
다시 읽어 재시도하며, 사용자가 앱에서 저장 중이어도 그 저장을 덮어쓰지 않는다.
"""
import datetime
import importlib.util
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# script.js의 OWNERS와 같은 순서·같은 목록이어야 한다 (script.js:209).
OWNERS = ['본인', '아내', '자녀1', '아버지']
MAX_HISTORY = 365
KST = datetime.timezone(datetime.timedelta(hours=9))

# api/kv.ts의 쓰기 Lua 스크립트와 동일 — 개정번호가 기대값과 같을 때만 쓰고 1 올린다.
CAS_WRITE_SCRIPT = "\n".join([
    "local current = redis.call('GET', KEYS[2])",
    "if not current then current = '0' end",
    "if current ~= ARGV[1] then return {0, current} end",
    "local next_revision = tostring(tonumber(current) + 1)",
    "redis.call('SET', KEYS[1], ARGV[2])",
    "redis.call('SET', KEYS[2], next_revision)",
    "return {1, next_revision}",
])
CAS_READ_SCRIPT = "\n".join([
    "local value = redis.call('GET', KEYS[1])",
    "local revision = redis.call('GET', KEYS[2])",
    "if not revision then revision = '0' end",
    "return {value, revision}",
])


def log(msg):
    print('[net-worth] ' + msg, flush=True)


# ── api/dashboard.py 재사용 ─────────────────────────────────────
def load_dashboard_module():
    """api/dashboard.py를 모듈로 로드한다 (시세 조회 로직의 단일 소스)."""
    path = os.path.join(ROOT, 'api', 'dashboard.py')
    spec = importlib.util.spec_from_file_location('dashboard_api', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ── KV (Upstash REST 직접 호출) ─────────────────────────────────
def kv_env():
    url = os.environ.get('KV_REST_API_URL', '').rstrip('/')
    token = os.environ.get('KV_REST_API_TOKEN', '')
    if not url or not token:
        raise RuntimeError('KV_REST_API_URL / KV_REST_API_TOKEN 미설정')
    return url, token


def kv_command(command, timeout=20):
    url, token = kv_env()
    req = urllib.request.Request(
        url,
        data=json.dumps(command).encode('utf-8'),
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = json.loads(r.read().decode('utf-8', 'replace'))
    if not isinstance(body, dict) or 'result' not in body:
        raise RuntimeError('KV 응답 형식 오류')
    return body['result']


def kv_read(key):
    """값과 개정번호를 한 번에 읽는다 (api/kv.ts GET과 같은 스크립트)."""
    result = kv_command(['EVAL', CAS_READ_SCRIPT, '2', key, '__revision__:' + key])
    if not isinstance(result, list) or len(result) < 2:
        raise RuntimeError('KV 읽기 형식 오류: ' + repr(result)[:120])
    raw, revision = result[0], str(result[1])
    if not re.fullmatch(r'(0|[1-9][0-9]*)', revision):
        raise RuntimeError('KV 개정번호 형식 오류: ' + revision[:40])
    value = None
    if isinstance(raw, str) and raw:
        value = json.loads(raw)
    elif isinstance(raw, (dict, list)):
        value = raw
    return value, int(revision)


def kv_write_cas(key, value, expected_revision):
    """개정번호가 맞을 때만 쓴다. 성공하면 True, 충돌하면 False."""
    payload = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    result = kv_command([
        'EVAL', CAS_WRITE_SCRIPT, '2', key, '__revision__:' + key,
        str(expected_revision), payload,
    ])
    ok = isinstance(result, list) and len(result) >= 1 and str(result[0]) == '1'
    if not ok:
        log('KV 개정번호 충돌 — 현재 %s, 기대 %s' % (
            (result[1] if isinstance(result, list) and len(result) > 1 else '?'), expected_revision))
    return ok


def normalize_assets(raw):
    """KV assets는 배열 또는 {소유주: [...]} 두 형태를 모두 허용한다 (ETF 배치와 동일)."""
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)]
    if isinstance(raw, dict):
        flat = []
        for owner, items in raw.items():
            if isinstance(items, list):
                for item in items:
                    if isinstance(item, dict):
                        item.setdefault('owner', owner)
                        flat.append(item)
        return flat
    return []


# ── 시세 ────────────────────────────────────────────────────────
def strip_ticker(t):
    return re.sub(r'\.(KS|KQ|T)$', '', str(t or '').strip().upper())


def fetch_rates(api):
    """RATES = {USD, JPY, KRW:1}. script.js가 /api/dashboard?type=rates로 받는 값과 같다."""
    rates = {'KRW': 1.0}
    payload = api.get_rates().get('rates', {})
    usd = payload.get('usd_krw')
    jpy100 = payload.get('jpy100_krw')
    if isinstance(usd, (int, float)) and usd > 0:
        rates['USD'] = float(usd)
    if isinstance(jpy100, (int, float)) and jpy100 > 0:
        rates['JPY'] = float(jpy100) / 100.0   # 프런트의 RATES.JPY는 1엔당 원화
    return rates


def fetch_gold_per_gram(api):
    info = api.get_gold('g').get('gold', {})
    ppg = info.get('price_per_g')
    return float(ppg) if isinstance(ppg, (int, float)) and ppg > 0 else None


def market_price(api, item):
    """자산 한 건의 현재가(종목 통화 기준). 실패하면 None.

    시장 판정은 저장된 grp/cur를 따른다 — 티커가 숫자인지로 나누면
    KRX 영숫자 단축코드(0117V0 등)를 미국 주식으로 오인한다.
    """
    tkr = strip_ticker(item.get('tkr'))
    if not tkr:
        return None
    grp = item.get('grp')
    cur = (item.get('cur') or 'KRW').upper()

    if grp == '가상화폐':
        return api.safe_last_close(tkr + '-USD')

    if cur == 'KRW':
        # 국내 주식·ETF — pykrx 우선, 실패 시 .KS → .KQ 폴백 (api/dashboard.py와 같은 순서)
        if getattr(api, 'PYKRX_OK', False):
            try:
                day = api.prev_biz_day_str()
                df = api.krx.get_market_ohlcv_by_date(day, day, tkr)
                if df is not None and not df.empty:
                    return float(df['종가'].iloc[-1])
            except Exception:
                pass
        return api.safe_last_close(tkr + '.KS') or api.safe_last_close(tkr + '.KQ')

    if cur == 'JPY':
        return api.safe_last_close(tkr + '.T')

    return api.safe_last_close(tkr)


def refresh_prices(api, assets, rates, gold_per_gram):
    """자산의 curP를 최신 종가로 채운다. 조회 실패 종목은 KV에 저장된 값을 그대로 쓴다.

    실패분을 0으로 만들면 그날 순자산이 통째로 꺼져 추이에 가짜 급락이 생긴다.
    저장된 값(직전 종가)을 유지하고 실패 건수만 돌려준다.
    """
    stale = []
    for item in assets:
        grp = item.get('grp')
        if grp == '현금':
            continue                      # 예수금은 curP가 곧 잔액이라 조회 대상이 아니다
        if grp == '금':
            if gold_per_gram:
                unit = item.get('unit') or 'g'
                factor = 3.75 if unit == '돈' else (1000.0 if unit == 'kg' else 1.0)
                item['curP'] = gold_per_gram * factor
            else:
                stale.append(item.get('name') or item.get('tkr') or '금')
            continue
        price = None
        try:
            price = market_price(api, item)
        except Exception as e:
            log('시세 조회 실패 %s: %s' % (item.get('tkr'), type(e).__name__))
        if price and price > 0:
            item['curP'] = float(price)
        else:
            stale.append(item.get('name') or item.get('tkr') or '?')
    return stale


# ── 순자산 계산 (script.js updateNetWorthSnapshot 과 동일 규칙) ──
def asset_value_krw(item, rates):
    qty = float(item.get('qty') or 0)
    cur_price = float(item.get('curP') or 0)
    if item.get('grp') == '금':
        return qty * cur_price          # 금의 curP는 이미 단위당 원화 — 환율을 곱하지 않는다
    rate = rates.get((item.get('cur') or 'KRW').upper(), 1)
    return qty * cur_price * float(rate)


def owner_of(item):
    return item.get('owner') or '본인'   # script.js filterByOwner 와 같은 기본값


def sum_amounts(rows, owner=None):
    total = 0.0
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        if owner is not None and (row.get('owner') or '본인') != owner:
            continue
        try:
            total += float(row.get('amount') or 0)
        except (TypeError, ValueError):
            continue
    return total


def build_entry(assets, balance_sheet, rates, date_str):
    bs = balance_sheet if isinstance(balance_sheet, dict) else {}
    portfolio = sum(asset_value_krw(a, rates) for a in assets)
    non_investment = sum_amounts(bs.get('assets'))
    liabilities = sum_amounts(bs.get('liabilities'))

    portfolio_by_owner = {}
    net_by_owner = {}
    for owner in OWNERS:
        owned = sum(asset_value_krw(a, rates) for a in assets if owner_of(a) == owner)
        portfolio_by_owner[owner] = round(owned)
        net_by_owner[owner] = round(
            portfolio_by_owner[owner]
            + sum_amounts(bs.get('assets'), owner)
            - sum_amounts(bs.get('liabilities'), owner)
        )
    return {
        'date': date_str,
        'schemaV': 2,
        'total': round(portfolio + non_investment - liabilities),
        'portfolio': round(portfolio),
        'nonInvestmentAssets': round(non_investment),
        'liabilities': round(liabilities),
        'portfolioByOwner': portfolio_by_owner,
        'netByOwner': net_by_owner,
    }


def merge_history(history, entry):
    """같은 날짜는 교체, 나머지는 날짜 오름차순 + 최근 365건만 유지."""
    rows = [h for h in (history or []) if isinstance(h, dict) and h.get('date')]
    rows = [h for h in rows if h.get('date') != entry['date']]
    rows.append(entry)
    rows.sort(key=lambda h: str(h.get('date')))
    if len(rows) > MAX_HISTORY:
        rows = rows[-MAX_HISTORY:]
    return rows


# ── 실행 ────────────────────────────────────────────────────────
def run_once(api, date_str, dry_run=False):
    assets_raw, _ = kv_read('assets')
    assets = normalize_assets(assets_raw)
    if not assets:
        raise RuntimeError('KV assets가 비어 있습니다 — 스냅샷을 남기지 않습니다')

    rates = fetch_rates(api)
    if 'USD' not in rates:
        raise RuntimeError('USD 환율 조회 실패 — 평가액을 신뢰할 수 없어 중단합니다')
    gold_per_gram = fetch_gold_per_gram(api)
    stale = refresh_prices(api, assets, rates, gold_per_gram)
    if stale:
        log('시세 미확보 %d종목(저장된 직전 값 사용): %s' % (len(stale), ', '.join(stale[:8])))

    # ext_data는 읽고-계산하고-쓰는 사이에 사용자가 바꿀 수 있다. CAS로 재시도한다.
    for attempt in range(1, 4):
        ext, revision = kv_read('ext_data')
        if not isinstance(ext, dict):
            raise RuntimeError('KV ext_data 형식 오류 — 스냅샷을 남기지 않습니다')
        entry = build_entry(assets, ext.get('balanceSheet'), rates, date_str)
        ext['netWorthHistory'] = merge_history(ext.get('netWorthHistory'), entry)
        if dry_run:
            log('[dry-run] 기록하지 않음 · %s 순자산 %s원' % (entry['date'], f"{entry['total']:,}"))
            return entry
        if kv_write_cas('ext_data', ext, revision):
            log('기록 완료 %s · 순자산 %s원 (투자 %s / 기타 %s / 부채 %s) · 이력 %d건' % (
                entry['date'], f"{entry['total']:,}", f"{entry['portfolio']:,}",
                f"{entry['nonInvestmentAssets']:,}", f"{entry['liabilities']:,}",
                len(ext['netWorthHistory'])))
            return entry
        if attempt < 3:
            time.sleep(2 * attempt)
    raise RuntimeError('KV 개정번호 충돌이 3회 반복돼 기록하지 못했습니다')


def main():
    dry_run = '--dry-run' in sys.argv
    # 날짜는 반드시 KST 기준 — 러너는 UTC라서 그대로 쓰면 하루 밀린다
    # (script.js `_cfLocalDateKey`가 남기는 로컬 날짜와 어긋나면 같은 날이 두 건이 된다).
    date_str = datetime.datetime.now(KST).strftime('%Y-%m-%d')
    log('시작 · 기준일 %s (KST)%s' % (date_str, ' · dry-run' if dry_run else ''))
    api = load_dashboard_module()
    if not getattr(api, 'YF_OK', False):
        log('yfinance를 불러오지 못했습니다')
        return 1
    try:
        run_once(api, date_str, dry_run=dry_run)
    except Exception as e:
        log('실패: %s: %s' % (type(e).__name__, e))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
