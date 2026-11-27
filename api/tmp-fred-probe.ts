import type { ApiRequest, ApiResponse } from './_types';
import { FRED_SERIES, FRED_CSV_URL, fetchSeries } from './macro';

// 임시 진단(병합하지 않는다): Vercel 함수 안에서 FRED CSV 를 받을 수 있는지 지표마다 결과만 돌려준다.
// KV·비밀값을 쓰지 않고 공개 자료만 읽는다. 확인이 끝나면 지운다.
export default async function handler(_req: ApiRequest, res: ApiResponse) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const now = Date.now();
  const rows = await Promise.all(FRED_SERIES.map(async id => {
    const t0 = Date.now();
    try {
      const obs = await fetchSeries(id, now);
      return { id, ok: true, ms: Date.now() - t0, rows: obs.length, last: obs[obs.length - 1] };
    } catch (e: any) {
      return { id, ok: false, ms: Date.now() - t0, error: String(e && e.message || e), cause: String(e && e.cause && (e.cause.code || e.cause.message) || '') };
    }
  }));
  let raw: any = null;
  try {
    const r = await fetch(`${FRED_CSV_URL}?id=DGS10&cosd=2026-11-15`, { headers: { 'User-Agent': 'asset-dashboard/1.0', Accept: 'text/csv' } });
    raw = { status: r.status, server: r.headers.get('server'), type: r.headers.get('content-type'), head: (await r.text()).slice(0, 160) };
  } catch (e: any) { raw = { error: String(e && e.message || e), cause: String(e && e.cause && (e.cause.code || e.cause.message) || '') }; }
  return res.status(200).json({ at: new Date(now).toISOString(), region: process.env.VERCEL_REGION || null, rows, raw });
}
