import type { ApiRequest, ApiResponse } from './_types';

const { authenticateRequest, sendAuthFailure, safeEqual } = require('./_auth.js');

// 종목 찾기 > 매크로(시장 신호등) 자료 — 미국 연준 FRED 의 일별 지표 4개(2026-11-26 사용자 결정).
//  - 받는 곳은 공개 CSV 다운로드 주소 하나뿐이다(API 키 없음, HTML 을 읽지 않음, 지표마다 한 번씩 — 여러 개를 한 번에 부르면 zip 이 온다).
//  - 브라우저는 FRED 를 부르지 않는다. 화면은 이 함수의 GET(로그인 세션)으로 KV 에 저장된 값만 읽는다.
//  - 새로 받는 일은 Vercel 예약 실행(vercel.json crons, 미국 평일 장 마감 뒤 하루 한 번)만 한다 — Authorization: Bearer CRON_SECRET.
//  - 받은 최신 관측일이 저장된 날짜와 같으면 KV 를 다시 쓰지 않는다. 받기에 실패하면 마지막 정상 값을 그대로 둔다.
// 처음 네 개(2026-11-26 사용자 지정) + 빈칸 채우기 다섯 카드용 여섯 개(같은 날 사용자 선택): 2년물·기준금리(앞으로의 금리),
// 연준 총자산(주 1회), S&P 500(200일선), 삼의 법칙(월 1회), VIX.
export const FRED_SERIES = ['DGS10', 'T10Y2Y', 'BAA10Y', 'DTWEXBGS', 'DGS2', 'DFF', 'WALCL', 'SP500', 'SAHMREALTIME', 'VIXCLS'] as const;
// 자료가 '오래됐다'고 볼 날 수 — 공표 주기가 다르다(달러 지수·연준 자산은 주 1회, 삼의 법칙은 다음 달 초에 지난달 값).
export const STALE_DAYS: Record<string, number> = { DTWEXBGS: 14, WALCL: 14, SAHMREALTIME: 75 };
export const FRED_CSV_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
export const CACHE_KEY = 'macro_fred';
export const CHECK_KEY = 'macro_fred_checked';
// 마지막 실행 기록(서버 전용) — 지표마다 받았는지·FRED 가 준 최신 날짜·오류. Hobby 로그는 1시간만 남고 성공 실행은 흔적이 없어
// 2026-11-27·28 두 번의 예약 실행이 왜 아무것도 바꾸지 않았는지 알 수 없었다.
export const RUN_KEY = 'macro_fred_lastrun';
const HISTORY_DAYS = 400;          // 12개월 최저·3개월 전 값을 재려고 13개월 남짓 보관
const FETCH_TIMEOUT_MS = 8000;
// 빨리 실패한 지표(5xx·연결 끊김)만 1초 뒤 한 번 더 받는다 — 첫 시도가 이 시간 안에 끝났을 때만(함수 제한 20초 안에 들도록).
const RETRY_WITHIN_MS = 6000, RETRY_DELAY_MS = 1000;
const CLOSE_HOUR_ET = 16;          // 뉴욕 시간 16시(장 마감) 이후에만 확인

type Obs = [string, number];
export interface SeriesEntry { id: string; date: string; value: number; prevDate: string | null; prevValue: number | null; fetchedAt: string; obs: Obs[] }
export interface MacroCache { v: 1; series: Record<string, SeriesEntry>; updatedAt: string }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// CSV 한 장을 [날짜, 값] 목록으로. 머리줄이 observation_date 로 시작하지 않으면(HTML 오류 페이지 등) 거부한다.
// 값이 빈칸이거나 '.'(휴일)인 줄은 건너뛴다.
export function parseFredCsv(text: string, id: string): Obs[] {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  const head = (lines[0] || '').trim().split(',');
  if (head[0] !== 'observation_date') throw new Error('fred_bad_header');
  if (head.length !== 2 || head[1] !== id) throw new Error('fred_bad_series');
  const out: Obs[] = [];
  for (const line of lines.slice(1)) {
    const [d, raw] = line.trim().split(',');
    if (!d || !DATE_RE.test(d)) continue;
    const s = String(raw ?? '').trim();
    if (!s || s === '.') continue;
    const v = Number(s);
    if (!Number.isFinite(v)) continue;
    out.push([d, v]);
  }
  out.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  if (!out.length) throw new Error('fred_no_rows');
  return out;
}

function isoDay(t: number): string { return new Date(t).toISOString().slice(0, 10); }

export function startDate(now: number): string { return isoDay(now - HISTORY_DAYS * 86400000); }

export async function fetchSeries(id: string, now: number, fetchImpl: typeof fetch = fetch): Promise<Obs[]> {
  const url = `${FRED_CSV_URL}?id=${encodeURIComponent(id)}&cosd=${startDate(now)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetchImpl(url, { headers: { 'User-Agent': 'asset-dashboard/1.0', Accept: 'text/csv' }, signal: controller.signal });
    if (!r.ok) throw new Error(`fred_http_${r.status}`);
    return parseFredCsv(await r.text(), id);
  } catch (e: any) {
    throw controller.signal.aborted ? new Error('fred_timeout') : e;
  } finally { clearTimeout(timer); }
}

// 오류를 기록에 남길 짧은 글로 — 네트워크 오류는 원인 코드(ECONNRESET 등)를 붙인다.
export function errorText(e: any): string {
  const msg = String(e && e.message || e || 'error');
  const c = e && e.cause && (e.cause.code || e.cause.message);
  return (c ? `${msg} (${c})` : msg).slice(0, 160);
}

// 뉴욕 기준 날짜·요일·시각 — 주말이나 장 마감 전에는 확인하지 않는다.
export function easternClock(now: number): { day: string; weekday: string; hour: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(now)).map(p => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, weekday: String(parts.weekday), hour: Number(parts.hour) };
}

export function entryFrom(id: string, obs: Obs[], fetchedAt: string): SeriesEntry {
  const last = obs[obs.length - 1], prev = obs.length > 1 ? obs[obs.length - 2] : null;
  const cut = isoDay(Date.parse(last[0] + 'T00:00:00Z') - HISTORY_DAYS * 86400000);
  return { id, date: last[0], value: last[1], prevDate: prev ? prev[0] : null, prevValue: prev ? prev[1] : null, fetchedAt, obs: obs.filter(o => o[0] >= cut) };
}

// 저장된 자료와 새로 받은 자료를 합친다 — 최신 관측일이 더 새로울 때만 그 지표를 바꾼다(같으면 그대로, 더 오래된 응답은 무시).
export function mergeCache(cache: MacroCache | null, fetched: Record<string, Obs[] | Error>, nowIso: string) {
  const series: Record<string, SeriesEntry> = { ...(cache && cache.series || {}) };
  const report: Record<string, { status: 'updated' | 'unchanged' | 'failed'; date: string | null; value: number | null; latest?: string; error?: string }> = {};
  let changed = false;
  for (const id of FRED_SERIES) {
    const got = fetched[id], old = series[id];
    if (!got || got instanceof Error) {
      report[id] = { status: 'failed', date: old ? old.date : null, value: old ? old.value : null, error: got instanceof Error ? got.message : 'missing' };
      continue;
    }
    const latest = got[got.length - 1][0];
    if (old && old.date >= latest) { report[id] = { status: 'unchanged', date: old.date, value: old.value, latest }; continue; }
    series[id] = entryFrom(id, got, nowIso);
    report[id] = { status: 'updated', date: series[id].date, value: series[id].value, latest };
    changed = true;
  }
  return { changed, cache: { v: 1, series, updatedAt: changed ? nowIso : (cache ? cache.updatedAt : nowIso) } as MacroCache, report };
}

// ── KV(Upstash) — api/kv.ts 와 같은 저장소. 화면용 allowlist 키가 아니라 서버만 쓰는 별도 키다. ──
async function kvCommand(command: unknown[], fetchImpl: typeof fetch = fetch): Promise<any> {
  const url = String(process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
  const token = String(process.env.KV_REST_API_TOKEN || '');
  if (!url || !token) throw new Error('kv_not_configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const r = await fetchImpl(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: controller.signal });
    if (!r.ok) throw new Error(`kv_upstream_${r.status}`);
    const data: any = await r.json();
    if (!data || !Object.prototype.hasOwnProperty.call(data, 'result')) throw new Error('kv_upstream_invalid');
    return data.result;
  } finally { clearTimeout(timer); }
}

export async function readCache(fetchImpl: typeof fetch = fetch): Promise<MacroCache | null> {
  const raw = await kvCommand(['GET', CACHE_KEY], fetchImpl);
  if (typeof raw !== 'string' || !raw) return null;
  try { const c = JSON.parse(raw); return c && c.series && typeof c.series === 'object' ? c : null; } catch { return null; }
}

// 한 번 확인 — 예약 실행이 부른다. force 는 검증 스크립트용(HTTP 로는 켤 수 없다).
export async function refreshFredCache(opts: { now?: number; force?: boolean; fetchImpl?: typeof fetch; retryDelayMs?: number } = {}) {
  const now = opts.now ?? Date.now(), f = opts.fetchImpl || fetch;
  const clock = easternClock(now);
  if (!opts.force) {
    if (clock.weekday === 'Sat' || clock.weekday === 'Sun') return { ok: true, skipped: 'weekend', day: clock.day };
    if (clock.hour < CLOSE_HOUR_ET) return { ok: true, skipped: 'before_close', day: clock.day };
    const last = await kvCommand(['GET', CHECK_KEY], f);
    if (last === clock.day) return { ok: true, skipped: 'already_checked', day: clock.day };
  }
  const cache = await readCache(f);
  const fetched: Record<string, Obs[] | Error> = {};
  const t0 = Date.now(), wait = opts.retryDelayMs ?? RETRY_DELAY_MS;
  const fetchAll = (ids: readonly string[]) => Promise.all(ids.map(async id => {
    try { fetched[id] = await fetchSeries(id, now, f); } catch (e: any) { fetched[id] = new Error(errorText(e)); }
  }));
  await fetchAll(FRED_SERIES);
  const retry = FRED_SERIES.filter(id => fetched[id] instanceof Error && (fetched[id] as Error).message !== 'fred_timeout');
  const retried = retry.length > 0 && Date.now() - t0 < RETRY_WITHIN_MS;
  if (retried) { await new Promise(r => setTimeout(r, wait)); await fetchAll(retry); }
  const nowIso = new Date(now).toISOString();
  const merged = mergeCache(cache, fetched, nowIso);
  if (merged.changed) await kvCommand(['SET', CACHE_KEY, JSON.stringify(merged.cache)], f);
  if (!opts.force) await kvCommand(['SET', CHECK_KEY, clock.day], f);
  const run = runRecord(merged.report, { at: new Date().toISOString(), day: clock.day, force: !!opts.force, ms: Date.now() - t0, cacheUpdated: merged.changed, retried: retried ? retry : [] });
  console.log('[Macro FRED refresh]', runSummary(run));
  // 기록 쓰기가 실패해도 자료 갱신은 끝난 것으로 본다(기록은 원인 찾기용일 뿐).
  try { await kvCommand(['SET', RUN_KEY, JSON.stringify(run)], f); } catch (e: any) { console.warn('[Macro FRED run record]', errorText(e)); }
  return { ok: true, day: clock.day, cacheUpdated: merged.changed, report: merged.report };
}

type Report = ReturnType<typeof mergeCache>['report'];
// 실행 기록 — 지표마다 결과·저장된 날짜·FRED 가 준 최신 날짜·오류만(값·비밀값은 담지 않는다).
export function runRecord(report: Report, meta: { at: string; day: string; force: boolean; ms: number; cacheUpdated: boolean; retried: string[] }) {
  const counts = { updated: 0, unchanged: 0, failed: 0 };
  const series: Record<string, { status: string; date: string | null; latest?: string; error?: string }> = {};
  for (const id of FRED_SERIES) {
    const x = report[id]; if (!x) continue;
    counts[x.status] += 1;
    series[id] = { status: x.status, date: x.date, ...(x.latest ? { latest: x.latest } : {}), ...(x.error ? { error: x.error } : {}) };
  }
  return { v: 1, ...meta, ...counts, series };
}

// 로그 한 줄 — '갱신 3 · 그대로 7 · 실패 0' 과 실패한 지표의 오류.
export function runSummary(run: ReturnType<typeof runRecord>): string {
  const fails = Object.entries(run.series).filter(([, x]) => x.status === 'failed').map(([id, x]) => `${id}:${x.error}`);
  return `day=${run.day} updated=${run.updated} unchanged=${run.unchanged} failed=${run.failed} ms=${run.ms}`
    + (run.retried.length ? ` retried=${run.retried.join(',')}` : '') + (fails.length ? ` errors=${fails.join(' ')}` : '');
}

// ── 화면에 줄 모양 — 신호등 판정에 필요한 값만 미리 계산한다(판정 기준은 화면의 trdMacro 그대로). ──
function valueOnOrBefore(obs: Obs[], day: string): number | null {
  let v: number | null = null;
  for (const o of obs) { if (o[0] <= day) v = o[1]; else break; }
  return v;
}
function monthsBefore(day: string, n: number): string {
  const d = new Date(day + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - n); return isoDay(d.getTime());
}
// S&P 500 200일선 — 마지막 200개 관측(거래일) 평균과, 20거래일 전의 같은 평균(오르는 중인지).
const MA_DAYS = 200, MA_LOOKBACK = 20;
function spx200(e: SeriesEntry | undefined) {
  const xs = e && Array.isArray(e.obs) ? e.obs.map(o => o[1]) : [];
  if (xs.length < MA_DAYS + MA_LOOKBACK) return null;
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  return { close: xs[xs.length - 1], ma200: avg(xs.slice(-MA_DAYS)), ma200ago: avg(xs.slice(-MA_DAYS - MA_LOOKBACK, -MA_LOOKBACK)) };
}
export function macroPayload(cache: MacroCache | null) {
  const S = cache && cache.series || {};
  const pub = (id: string) => {
    const e = S[id]; if (!e || !DATE_RE.test(e.date) || !Number.isFinite(e.value)) return null;
    return { id, date: e.date, value: e.value, prevDate: e.prevDate, prevValue: e.prevValue,
      change: Number.isFinite(e.prevValue as number) ? +(e.value - (e.prevValue as number)).toFixed(4) : null,
      fetchedAt: e.fetchedAt, source: `FRED · ${id}`, staleDays: STALE_DAYS[id] || 7 };
  };
  const series: Record<string, any> = {};
  for (const id of FRED_SERIES) { const p = pub(id); if (p) series[id] = p; }
  const ids = Object.keys(series);
  if (!ids.length) return { success: false, error: 'no_cache' };
  const ago3m = (id: string) => { const e = S[id]; return e ? valueOnOrBefore(e.obs || [], monthsBefore(e.date, 3)) : null; };
  const min12m = (id: string) => { const e = S[id]; if (!e) return null; const cut = monthsBefore(e.date, 12); const xs = (e.obs || []).filter(o => o[0] >= cut).map(o => o[1]); return xs.length ? Math.min(...xs) : null; };
  return {
    success: true, source: 'FRED', asOf: ids.map(id => series[id].date).sort().pop(), updatedAt: cache!.updatedAt, series,
    t10: series.DGS10 ? series.DGS10.value : null,
    curve: series.T10Y2Y ? { now: series.T10Y2Y.value, min12m: min12m('T10Y2Y') } : null,
    credit: series.BAA10Y ? { now: series.BAA10Y.value, ago3m: ago3m('BAA10Y') } : null,
    dxy: series.DTWEXBGS ? { now: series.DTWEXBGS.value, ago3m: ago3m('DTWEXBGS') } : null,
    t2: series.DGS2 ? series.DGS2.value : null,
    fed: series.DFF ? { now: series.DFF.value } : null,
    bs: series.WALCL ? { now: series.WALCL.value, ago6m: valueOnOrBefore(S.WALCL.obs || [], monthsBefore(S.WALCL.date, 6)) } : null,
    spx: spx200(S.SP500),
    sahm: series.SAHMREALTIME ? { now: series.SAHMREALTIME.value } : null,
    vix: series.VIXCLS ? { now: series.VIXCLS.value } : null,
  };
}

function isCronRequest(req: ApiRequest): boolean {
  const expected = String(process.env.CRON_SECRET || '');
  if (!expected) return false;
  const h = req.headers && req.headers.authorization;
  const auth = Array.isArray(h) ? String(h[0] || '') : String(h || '');
  return auth.startsWith('Bearer ') && safeEqual(auth.slice(7), expected);
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie, Authorization');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }

  if (isCronRequest(req)) {
    try { return res.status(200).json(await refreshFredCache()); }
    catch (e: any) { console.error('[Macro FRED refresh]', e && e.message || e); return res.status(502).json({ ok: false, error: 'refresh_failed' }); }
  }

  const auth = authenticateRequest(req);
  if (!auth.ok) return sendAuthFailure(res, auth);
  try { return res.status(200).json(macroPayload(await readCache())); }
  catch (e: any) { console.error('[Macro cache read]', e && e.message || e); return res.status(502).json({ success: false, error: 'cache_unavailable' }); }
}
