import type { ApiRequest, ApiResponse } from './_types';

const {
  authenticateRequest,
  checkLoginRateLimit,
  clearSessionCookie,
  configured,
  createSessionValue,
  safeEqual,
  sessionCookie,
} = require('./_auth.js');

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Cookie, Authorization');

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.status(200).json({ success: true });
  }

  if (req.method === 'GET') {
    const auth = authenticateRequest(req);
    if (!auth.ok) return res.status(auth.status).json({ authenticated: false });
    return res.status(200).json({ authenticated: true });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const contentType = Array.isArray(req.headers['content-type'])
    ? String(req.headers['content-type'][0] || '')
    : String(req.headers['content-type'] || '');
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }

  const expectedPassword = String(process.env.DASHBOARD_PASSWORD || '');
  if (!expectedPassword || !configured()) {
    console.error('[api/auth] authentication environment is not configured');
    return res.status(500).json({ error: 'Auth not configured' });
  }

  const limit = await checkLoginRateLimit(req);
  res.setHeader('RateLimit-Limit', '5');
  res.setHeader('RateLimit-Remaining', String(limit.remaining));
  if (limit.unavailable) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    return res.status(503).json({ success: false, error: 'Login temporarily unavailable' });
  }
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    return res.status(429).json({ success: false, error: 'Too many attempts' });
  }

  const supplied = req.body && typeof req.body.password === 'string' ? req.body.password : '';
  if (!supplied || supplied.length > 256 || !safeEqual(supplied, expectedPassword)) {
    return res.status(401).json({ success: false });
  }

  const session = createSessionValue();
  res.setHeader('Set-Cookie', sessionCookie(session.value));
  return res.status(200).json({ success: true, expiresAt: session.expiresAt });
}
