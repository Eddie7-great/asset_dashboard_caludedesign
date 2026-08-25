import { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  // 로그인 응답에는 인증 토큰이 포함되므로 저장·스니핑을 방지한다.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  const expectedPassword = process.env.DASHBOARD_PASSWORD;
  const authToken = process.env.AUTH_TOKEN;

  if (!expectedPassword || !authToken) {
    return res.status(500).json({ error: '서버 환경변수가 설정되지 않았습니다' });
  }

  if (password === expectedPassword) {
    return res.status(200).json({ success: true, token: authToken });
  } else {
    return res.status(401).json({ success: false });
  }
}
