const crypto = require('node:crypto');

const SESSION_COOKIE = 'asset_dashboard_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_ATTEMPT_LIMIT = 5;
const FALLBACK_LIMIT_ENTRIES = 500;

// Serverless 인스턴스별 보조 제한기. Upstash가 설정되어 있으면 전역 제한기를 우선 사용한다.
const fallbackAttempts = new Map();

function firstHeader(value) {
  return Array.isArray(value) ? value[0] : (value || '');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sessionSecret() {
  // 무중단 마이그레이션: 기존 배포의 AUTH_TOKEN은 브라우저 bearer로는 절대
  // 허용하지 않고, SESSION_SECRET이 아직 없을 때 서버 내부 HMAC 키로만 쓴다.
  return String(process.env.SESSION_SECRET || process.env.AUTH_TOKEN || '');
}

function configured() {
  return sessionSecret().length > 0;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function sign(encodedPayload) {
  return crypto.createHmac('sha256', sessionSecret()).update(encodedPayload).digest('base64url');
}

function createSessionValue(nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!configured()) throw new Error('auth_not_configured');
  const payload = base64UrlJson({ v: 1, iat: nowSeconds, exp: nowSeconds + SESSION_TTL_SECONDS });
  return { value: `${payload}.${sign(payload)}`, expiresAt: (nowSeconds + SESSION_TTL_SECONDS) * 1000 };
}

// Max-Age 를 붙이지 않아 브라우저를 닫으면 쿠키도 사라지는 '세션 쿠키'로 발급한다.
// 유효기간이 없어지는 것은 아니다 — 서명 payload 의 exp(SESSION_TTL_SECONDS)를
// verifySessionValue 가 그대로 강제하므로 서버 측 만료는 유지된다.
// maxAge 를 명시하면(로그아웃의 0) 그 값을 그대로 사용한다.
function sessionCookie(value, maxAge = null) {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
  ];
  if (maxAge !== null && maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

function clearSessionCookie() {
  return sessionCookie('', 0);
}

function parseCookies(req) {
  const raw = firstHeader(req && req.headers && req.headers.cookie);
  const cookies = Object.create(null);
  for (const part of String(raw).split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

function verifySessionValue(value, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!configured() || typeof value !== 'string') return false;
  const dot = value.indexOf('.');
  if (dot < 1 || value.indexOf('.', dot + 1) !== -1) return false;
  const encodedPayload = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!safeEqual(signature, sign(encodedPayload))) return false;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    return payload && payload.v === 1
      && Number.isInteger(payload.iat)
      && Number.isInteger(payload.exp)
      && payload.iat <= nowSeconds + 60
      && payload.exp > nowSeconds
      && payload.exp - payload.iat === SESSION_TTL_SECONDS;
  } catch {
    return false;
  }
}

function hasValidSessionCookie(req) {
  return verifySessionValue(parseCookies(req)[SESSION_COOKIE]);
}

function hasValidInternalBearer(req) {
  const expected = String(process.env.INTERNAL_API_TOKEN || '');
  if (!expected) return false;
  const authorization = firstHeader(req && req.headers && req.headers.authorization);
  if (!authorization.startsWith('Bearer ')) return false;
  return safeEqual(authorization.slice(7), expected);
}

function authenticateRequest(req) {
  if (!configured()) return { ok: false, status: 500, error: 'Auth not configured' };
  if (hasValidSessionCookie(req) || hasValidInternalBearer(req)) return { ok: true, status: 200 };
  return { ok: false, status: 401, error: 'Unauthorized' };
}

function sendAuthFailure(res, result) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(result.status || 401).json({ error: result.error || 'Unauthorized' });
}

function requestIp(req) {
  const forwarded = firstHeader(req && req.headers && (
    req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.headers['x-real-ip']
  ));
  return String(forwarded).split(',')[0].trim() || 'unknown';
}

function rateLimitKey(req) {
  const digest = crypto.createHash('sha256').update(requestIp(req)).digest('hex').slice(0, 24);
  return `auth:login:${digest}`;
}

function useFallbackRateLimit(key, now = Date.now()) {
  for (const [entryKey, entry] of fallbackAttempts) {
    if (entry.resetAt <= now) fallbackAttempts.delete(entryKey);
  }
  if (!fallbackAttempts.has(key) && fallbackAttempts.size >= FALLBACK_LIMIT_ENTRIES) {
    const oldest = fallbackAttempts.keys().next().value;
    if (oldest) fallbackAttempts.delete(oldest);
  }
  const current = fallbackAttempts.get(key);
  const entry = current && current.resetAt > now
    ? { count: current.count + 1, resetAt: current.resetAt }
    : { count: 1, resetAt: now + LOGIN_WINDOW_SECONDS * 1000 };
  fallbackAttempts.delete(key);
  fallbackAttempts.set(key, entry);
  return {
    allowed: entry.count <= LOGIN_ATTEMPT_LIMIT,
    remaining: Math.max(0, LOGIN_ATTEMPT_LIMIT - entry.count),
    retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

async function useUpstashRateLimit(key) {
  const url = String(process.env.KV_REST_API_URL || '');
  const token = String(process.env.KV_REST_API_TOKEN || '');
  if (!url || !token) return null;
  const script = [
    "local n = redis.call('INCR', KEYS[1])",
    "if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end",
    "local ttl = redis.call('TTL', KEYS[1])",
    'return {n, ttl}',
  ].join('\n');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['EVAL', script, '1', key, String(LOGIN_WINDOW_SECONDS)]),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('rate_limit_upstream_failed');
    const body = await response.json();
    const count = Number(body && body.result && body.result[0]);
    const ttl = Number(body && body.result && body.result[1]);
    if (!Number.isFinite(count) || !Number.isFinite(ttl)) throw new Error('rate_limit_response_invalid');
    return {
      allowed: count <= LOGIN_ATTEMPT_LIMIT,
      remaining: Math.max(0, LOGIN_ATTEMPT_LIMIT - count),
      retryAfter: Math.max(1, ttl > 0 ? Math.ceil(ttl) : LOGIN_WINDOW_SECONDS),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkLoginRateLimit(req) {
  const key = rateLimitKey(req);
  const distributedConfigured = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  try {
    const distributed = await useUpstashRateLimit(key);
    if (distributed) return distributed;
  } catch (error) {
    console.error('[auth] distributed rate limiter unavailable; login denied', error);
    return { allowed: false, unavailable: true, remaining: 0, retryAfter: 30 };
  }
  if (distributedConfigured) return { allowed: false, unavailable: true, remaining: 0, retryAfter: 30 };
  return useFallbackRateLimit(key);
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  LOGIN_ATTEMPT_LIMIT,
  authenticateRequest,
  checkLoginRateLimit,
  clearSessionCookie,
  configured,
  createSessionValue,
  hasValidSessionCookie,
  safeEqual,
  sendAuthFailure,
  sessionCookie,
  verifySessionValue,
};
