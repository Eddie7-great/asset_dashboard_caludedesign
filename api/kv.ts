import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Upstash Redis(KV) 프록시 ──────────────────────────────────
// 토큰을 클라이언트(script.js)에 노출하지 않기 위한 서버측 프록시.
// 환경변수 필요: KV_REST_API_URL, KV_REST_API_TOKEN (Vercel Settings → Environment Variables)
//   GET  /api/kv?key=<key>            → Upstash GET /get/<key>   → {result: <string|null>}
//   POST /api/kv?key=<key> {value}    → Upstash POST /set/<key>  → {result: "OK"}
// 응답 형태는 Upstash 원형({result:...})을 그대로 전달 → 프론트 파싱 로직 변경 불필요.

const KV_URL = process.env.KV_REST_API_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!KV_URL || !KV_TOKEN) {
    console.error('[api/kv] KV_REST_API_URL / KV_REST_API_TOKEN 환경변수가 설정되지 않았습니다');
    return res.status(500).json({ error: 'KV not configured' });
  }

  // 키 화이트리스트(영숫자·_·:·-)로 경로 주입 방지
  const key = String(req.query.key || '');
  if (!key || !/^[A-Za-z0-9_:.-]{1,128}$/.test(key)) {
    return res.status(400).json({ error: 'invalid key' });
  }

  const auth = { Authorization: `Bearer ${KV_TOKEN}` };

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: auth });
      if (!r.ok) console.warn('[api/kv] GET 비정상 응답', r.status, key);
      const data = await r.json();
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      // 프론트는 {value:<string>} 형태로 보냄(객체는 미리 JSON.stringify 됨)
      const body: any = req.body || {};
      const bodyValue = typeof body.value === 'undefined' || body.value === null ? '' : String(body.value);
      const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: auth,
        body: bodyValue,
      });
      if (!r.ok) console.warn('[api/kv] SET 비정상 응답', r.status, key);
      const data = await r.json();
      return res.status(200).json(data);
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e: any) {
    console.error('[api/kv]', e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
