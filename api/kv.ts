import type { ApiRequest, ApiResponse } from './_types';

const { authenticateRequest, sendAuthFailure } = require('./_auth.js');

const KV_URL = String(process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
const KV_TOKEN = String(process.env.KV_REST_API_TOKEN || '');
const ALLOWED_KEYS = new Set(['assets', 'ext_data', 'data_freshness']);
const MAX_VALUE_BYTES = 1_000_000;
const MAX_REQUEST_BYTES = MAX_VALUE_BYTES + 2048;

const READ_SCRIPT = [
  "local value = redis.call('GET', KEYS[1])",
  "local revision = redis.call('GET', KEYS[2])",
  "if not revision then revision = '0' end",
  'if not value then return {false, revision} end',
  'return {value, revision}',
].join('\n');

const CAS_SCRIPT = [
  "local current = redis.call('GET', KEYS[2])",
  "if not current then current = '0' end",
  "if current ~= ARGV[1] then return {0, current} end",
  'local next_revision = tostring(tonumber(current) + 1)',
  "redis.call('SET', KEYS[1], ARGV[2])",
  "redis.call('SET', KEYS[2], next_revision)",
  'return {1, next_revision}',
].join('\n');

function revisionKey(key: string): string {
  return `__revision__:${key}`;
}

function queryValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function parseRevision(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : (typeof value === 'string' ? value : '');
  if (!/^(0|[1-9]\d*)$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function kvCommand(command: unknown[]): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(KV_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`kv_upstream_${response.status}`);
    const data = await response.json();
    if (!data || !Object.prototype.hasOwnProperty.call(data, 'result')) {
      throw new Error('kv_upstream_invalid');
    }
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Cookie, Authorization');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = authenticateRequest(req);
  if (!auth.ok) return sendAuthFailure(res, auth);

  if (!KV_URL || !KV_TOKEN) {
    console.error('[api/kv] KV environment is not configured');
    return res.status(500).json({ error: 'KV not configured' });
  }

  const key = queryValue(req.query.key);
  if (!ALLOWED_KEYS.has(key)) return res.status(400).json({ error: 'Invalid key' });

  const contentLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return res.status(413).json({ error: 'Payload too large' });
  }

  try {
    if (req.method === 'GET') {
      const result = await kvCommand(['EVAL', READ_SCRIPT, '2', key, revisionKey(key)]);
      if (!Array.isArray(result) || result.length < 2) throw new Error('kv_read_invalid');
      const revision = parseRevision(result[1]);
      if (revision === null) throw new Error('kv_revision_invalid');
      return res.status(200).json({ result: result[0] ?? null, revision });
    }

    const contentType = queryValue(req.headers['content-type']);
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      return res.status(415).json({ error: 'Content-Type must be application/json' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (typeof body.value !== 'string') return res.status(400).json({ error: 'Invalid value' });
    if (Buffer.byteLength(body.value, 'utf8') > MAX_VALUE_BYTES) {
      return res.status(413).json({ error: 'Payload too large' });
    }
    const expectedRevision = parseRevision(body.expectedRevision);
    if (expectedRevision === null) {
      return res.status(428).json({ error: 'expectedRevision required' });
    }

    const result = await kvCommand([
      'EVAL', CAS_SCRIPT, '2', key, revisionKey(key), String(expectedRevision), body.value,
    ]);
    if (!Array.isArray(result) || result.length < 2) throw new Error('kv_write_invalid');
    const currentRevision = parseRevision(result[1]);
    if (currentRevision === null) throw new Error('kv_revision_invalid');
    if (Number(result[0]) !== 1) {
      return res.status(409).json({ error: 'Conflict', revision: currentRevision });
    }
    return res.status(200).json({ result: 'OK', revision: currentRevision });
  } catch (error) {
    console.error('[api/kv] upstream operation failed', error);
    return res.status(502).json({ error: 'Storage unavailable' });
  }
}
