#!/usr/bin/env python3
import base64
import hashlib
import hmac
import importlib.util
import json
import os
import pathlib
import time


ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('dashboard_security_test', ROOT / 'api' / 'dashboard.py')
dashboard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dashboard)

saved = {name: os.environ.get(name) for name in ('SESSION_SECRET', 'AUTH_TOKEN', 'INTERNAL_API_TOKEN')}
try:
    os.environ['SESSION_SECRET'] = 'python-cross-runtime-session-secret'
    os.environ.pop('AUTH_TOKEN', None)
    os.environ.pop('INTERNAL_API_TOKEN', None)

    now = int(time.time())
    payload = {'v': 1, 'iat': now, 'exp': now + dashboard.SESSION_TTL_SECONDS}
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(',', ':')).encode('utf-8')
    ).decode('ascii').rstrip('=')
    signature = base64.urlsafe_b64encode(
        hmac.new(os.environ['SESSION_SECRET'].encode('utf-8'), encoded.encode('ascii'), hashlib.sha256).digest()
    ).decode('ascii').rstrip('=')
    cookie = f'{dashboard.SESSION_COOKIE}={encoded}.{signature}'

    assert dashboard._verify_session_cookie(cookie)
    assert not dashboard._verify_session_cookie(cookie + 'tampered')
    assert dashboard._auth_configured()
    os.environ['AUTH_TOKEN'] = 'removed-legacy-token'
    os.environ['INTERNAL_API_TOKEN'] = 'python-internal-token'
    assert not dashboard._valid_bearer('Bearer removed-legacy-token')
    assert dashboard._valid_bearer('Bearer python-internal-token')
    assert dashboard._parse_tickers('AAPL,005930.KS,AAPL') == ['AAPL', '005930.KS']

    try:
        dashboard._parse_tickers(','.join(f'T{i:02d}' for i in range(dashboard.MAX_TICKERS + 1)))
        raise AssertionError('ticker cap was not enforced')
    except ValueError:
        pass

    try:
        dashboard._parse_tickers('AAPL,<script>')
        raise AssertionError('ticker validation was not enforced')
    except ValueError:
        pass

    print('PASS Python session and input security')
finally:
    for name, value in saved.items():
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value
