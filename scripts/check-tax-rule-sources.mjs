#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { load as loadHtml } from 'cheerio'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MANIFEST_FILE = path.join(ROOT, 'tax-rules.js')
const ALLOWED_HOSTS = new Set(['law.go.kr', 'www.law.go.kr', 'nts.go.kr', 'www.nts.go.kr'])
const MAX_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 5
const REQUEST_TIMEOUT_MS = 10_000
const RETRIES = 2
const CONCURRENCY = 3

const args = process.argv.slice(2)
const network = args.includes('--network')
const explicitlyOffline = args.includes('--offline')
const reportAt = args.indexOf('--report')
const reportPath = reportAt >= 0 ? args[reportAt + 1] : null
if (network && explicitlyOffline) throw new Error('--network와 --offline은 함께 사용할 수 없습니다.')
if (reportAt >= 0 && !reportPath) throw new Error('--report 다음에 파일 경로가 필요합니다.')

function loadManifest() {
  const source = fs.readFileSync(MANIFEST_FILE, 'utf8')
  const context = { console, Date, Intl, Map, Object }
  vm.createContext(context)
  vm.runInContext(source, context, { filename: MANIFEST_FILE })
  return context.ASSET_TAX_RULES
}

function invariant(condition, message, errors) {
  if (!condition) errors.push(message)
}

function validOfficialUrl(raw) {
  let url
  try { url = new URL(raw) } catch { return false }
  return url.protocol === 'https:'
    && ALLOWED_HOSTS.has(url.hostname.toLowerCase())
    && !url.username && !url.password
    && (!url.port || url.port === '443')
}

function dateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null
}

function localDateInSeoul(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

function validateManifest(manifest) {
  const errors = []
  const warnings = []
  invariant(manifest && typeof manifest === 'object', '매니페스트 객체가 없습니다.', errors)
  invariant(manifest?.schemaVersion === 1, 'schemaVersion은 1이어야 합니다.', errors)
  invariant(/^kr-tax-gift-\d{4}\.\d+$/.test(manifest?.manifestVersion || ''), 'manifestVersion 형식이 잘못됐습니다.', errors)
  invariant(manifest?.jurisdiction === '대한민국', '관할 국가가 대한민국이 아닙니다.', errors)
  invariant(manifest?.timezone === 'Asia/Seoul', '시간대는 Asia/Seoul이어야 합니다.', errors)

  const sources = Array.isArray(manifest?.sources) ? manifest.sources : []
  const sourceIds = new Set()
  for (const source of sources) {
    invariant(/^[a-z0-9-]+$/.test(source?.id || ''), `출처 ID가 잘못됐습니다: ${source?.id || '(없음)'}`, errors)
    invariant(!sourceIds.has(source?.id), `출처 ID가 중복됩니다: ${source?.id}`, errors)
    sourceIds.add(source?.id)
    invariant(validOfficialUrl(source?.url), `공식 출처 URL 허용 범위를 벗어납니다: ${source?.id}`, errors)
    invariant(Array.isArray(source?.expected) && source.expected.length > 0, `출처 확인 문구가 없습니다: ${source?.id}`, errors)
    for (const marker of source?.expected || []) invariant(typeof marker === 'string' && marker.trim().length >= 2, `출처 확인 문구가 너무 짧습니다: ${source?.id}`, errors)
  }

  const periods = Array.isArray(manifest?.periods) ? [...manifest.periods] : []
  periods.sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)))
  invariant(periods.length > 0, '규칙 기간이 없습니다.', errors)
  for (let i = 0; i < periods.length; i++) {
    const period = periods[i]
    invariant(dateKey(period.effectiveFrom) && dateKey(period.effectiveTo), `적용 기간 날짜가 잘못됐습니다: ${period.id}`, errors)
    invariant(period.effectiveFrom <= period.effectiveTo, `적용 기간 시작·종료가 뒤집혔습니다: ${period.id}`, errors)
    if (i > 0) invariant(periods[i - 1].effectiveTo < period.effectiveFrom, `규칙 기간이 겹칩니다: ${periods[i - 1].id} / ${period.id}`, errors)
    invariant(dateKey(period.verifiedAt), `사람 검토일이 없습니다: ${period.id}`, errors)
    if (!period.archived) invariant(dateKey(period.nextReviewAt), `다음 검토일이 없습니다: ${period.id}`, errors)
    for (const sourceId of period.sourceIds || []) invariant(sourceIds.has(sourceId), `없는 출처를 참조합니다: ${period.id} → ${sourceId}`, errors)
    for (const disclosure of Object.values(period.disclosures || {})) {
      for (const sourceId of disclosure.sourceIds || []) invariant(sourceIds.has(sourceId), `없는 공개 출처를 참조합니다: ${period.id} → ${sourceId}`, errors)
      invariant(Array.isArray(disclosure.assumptions) && disclosure.assumptions.length > 0, `계산 가정이 없습니다: ${period.id}`, errors)
      invariant(Array.isArray(disclosure.exclusions) && disclosure.exclusions.length > 0, `제외 항목이 없습니다: ${period.id}`, errors)
    }
  }

  const active = periods.filter(period => !period.archived)
  invariant(active.length === 1, '활성 규칙 기간은 정확히 하나여야 합니다.', errors)
  let reviewState = 'invalid'
  if (active.length === 1 && dateKey(active[0].nextReviewAt)) {
    const today = localDateInSeoul()
    const due = active[0].nextReviewAt
    const remaining = Math.ceil((new Date(`${due}T23:59:59+09:00`) - new Date(`${today}T00:00:00+09:00`)) / 86_400_000)
    reviewState = remaining < 0 ? 'stale' : remaining <= 7 ? 'due' : 'verified'
    if (reviewState === 'stale') errors.push(`사람 검토기한이 지났습니다: ${due}`)
    else if (reviewState === 'due') warnings.push(`사람 검토기한이 ${remaining}일 남았습니다: ${due}`)
  }
  return { errors, warnings, reviewState }
}

function normalizedText(html) {
  const $ = loadHtml(html)
  // 국가법령정보센터의 일부 조문 표는 이미지 대체 텍스트나 SVG 텍스트로만
  // 노출된다. 의미 있는 접근성 텍스트를 본문에 보존한 뒤 장식 요소를 제거한다.
  $('img[alt]').each((_, element) => {
    const alt = $(element).attr('alt')
    if (alt) $(element).after(` ${alt} `)
  })
  $('script,style,noscript,form,nav,header,footer,[aria-hidden="true"],.blind,.sr-only').remove()
  return $.root().text().normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function normalizedMarker(marker) {
  return String(marker).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function errorCode(error) {
  const name = String(error?.name || '')
  const message = String(error?.message || '')
  if (name === 'AbortError' || /timeout/i.test(message)) return 'timeout'
  if (/maximum response size/i.test(message)) return 'response_too_large'
  if (/content type/i.test(message)) return 'invalid_content_type'
  if (/redirect/i.test(message)) return 'invalid_redirect'
  if (/HTTP \d+/.test(message)) return message.match(/HTTP (\d+)/)?.[1] ? `http_${message.match(/HTTP (\d+)/)[1]}` : 'http_error'
  return 'network_error'
}

async function readBounded(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  if (!contentType.includes('text/html') && !contentType.includes('text/plain')) throw new Error('invalid content type')
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error('maximum response size exceeded')
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BYTES) {
      await reader.cancel()
      throw new Error('maximum response size exceeded')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

async function fetchOfficial(rawUrl) {
  let current = new URL(rawUrl)
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    if (!validOfficialUrl(current.href)) throw new Error('invalid redirect target')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let response
    try {
      response = await fetch(current, {
        redirect: 'manual', signal: controller.signal,
        headers: { 'user-agent': 'asset-dashboard-tax-rule-watch/1.0 (+https://github.com/Eddie7-great/asset_dashboard_caludedesign)' },
      })
    } finally {
      clearTimeout(timer)
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location || redirect === MAX_REDIRECTS) throw new Error('invalid redirect chain')
      current = new URL(location, current)
      continue
    }
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`)
      error.retryable = response.status === 429 || response.status >= 500
      throw error
    }
    return { html: await readBounded(response), finalUrl: current.href }
  }
  throw new Error('invalid redirect chain')
}

async function checkSource(source) {
  let lastError
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const { html, finalUrl } = await fetchOfficial(source.url)
      const text = normalizedText(html)
      const missingExpected = source.expected.filter(marker => !text.includes(normalizedMarker(marker)))
      return {
        id: source.id,
        state: missingExpected.length ? 'changed' : 'ok',
        missingExpected,
        observedDigest: `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`,
        finalHost: new URL(finalUrl).hostname.toLowerCase(),
        errorCode: null,
      }
    } catch (error) {
      lastError = error
      const retryable = error?.retryable === true || ['AbortError', 'TypeError'].includes(error?.name)
      if (!retryable || attempt === RETRIES) break
      await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)))
    }
  }
  return { id: source.id, state: 'unavailable', missingExpected: [], observedDigest: null, finalHost: null, errorCode: errorCode(lastError) }
}

async function mapLimited(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  async function run() {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

const manifest = loadManifest()
const validation = validateManifest(manifest)
const sourceResults = network && validation.errors.length === 0
  ? await mapLimited(manifest.sources, CONCURRENCY, checkSource)
  : []
const summary = sourceResults.reduce((out, result) => {
  out[result.state] = (out[result.state] || 0) + 1
  return out
}, { ok: 0, changed: 0, unavailable: 0 })
const report = {
  schemaVersion: 1,
  manifestVersion: manifest?.manifestVersion || null,
  checkedAt: new Date().toISOString(),
  mode: network ? 'network' : 'offline',
  reviewState: validation.reviewState,
  validation: { errors: validation.errors, warnings: validation.warnings },
  summary,
  sources: sourceResults,
}

if (reportPath) {
  const absolute = path.resolve(reportPath)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

for (const warning of validation.warnings) console.warn(`[WARN] ${warning}`)
for (const error of validation.errors) console.error(`[ERROR] ${error}`)
if (network) {
  for (const result of sourceResults) console.log(`[${result.state.toUpperCase()}] ${result.id}${result.errorCode ? ` (${result.errorCode})` : ''}`)
  console.log(`공식 출처 확인: 정상 ${summary.ok} · 변경 의심 ${summary.changed} · 접속 실패 ${summary.unavailable}`)
} else {
  console.log(`규칙 매니페스트 확인: ${manifest.manifestVersion} · ${validation.reviewState}`)
}

const sourceFailure = sourceResults.some(result => result.state !== 'ok')
if (validation.errors.length || sourceFailure) process.exitCode = 1
