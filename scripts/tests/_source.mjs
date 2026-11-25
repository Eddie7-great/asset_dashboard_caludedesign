// 화면별로 나눈 소스 파일을 '원래 한 파일'처럼 읽는다.
//
// cobalt.js 의 화면 렌더러를 pages/*.js 로, script.js 를 core/*.js 로 옮겨도 테스트는 예전처럼 readSource('cobalt.js')·readSource('script.js') 로
// 함수를 찾는다. 여기 적힌 순서는 index.html 의 실제 로드 순서와 같아야 한다 —
// test_source_split.mjs 가 둘을 대조한다.
import fs from 'node:fs'

const ROOT = new URL('../../', import.meta.url)

// 논리 파일 이름 → 실제 파일 목록(로드 순서). 목록에 없는 이름은 그 파일 하나를 읽는다.
export const SOURCE_PARTS = {
  // script.js 는 2026-11-23 에 이어진 조각 14개로 나눴다 — 순서대로 이으면 예전 한 파일과 같다.
  'script.js': [
    'core/data.js',
    'core/dividend.js',
    'core/stored-data.js',
    'core/transfers.js',
    'core/ui-shell.js',
    'core/stock-search.js',
    'core/holdings.js',
    'core/cashflow.js',
    'core/live-prices.js',
    'core/ext-data.js',
    'core/auth-boot.js',
    'core/startup.js',
    'core/bubble.js',
    'script.js',
  ],
  'cobalt.js': [
    'pages/performance.js',
    'pages/family.js',
    'pages/risk.js',
    'pages/dividend.js',
    'pages/gift.js',
    'pages/tax.js',
    'pages/dca.js',
    'cobalt.js',
  ],
}

const readOne = (rel) => fs.readFileSync(new URL(rel, ROOT), 'utf8')

export function readSource(rel) {
  const name = String(rel).replace(/^(?:\.\.\/)+/, '').replace(/^\.\//, '')
  const parts = SOURCE_PARTS[name]
  return parts ? parts.map(readOne).join('\n') : readOne(name)
}

// 종목 한 줄의 원화 금액 — 단일 출처(core/data.js)의 함수 묶음을 vm 컨텍스트에 그대로 싣는다.
// (2026-11-25 숫자 일관성 점검: 화면마다 식을 따로 두지 않으므로 테스트도 원본 함수를 쓴다.)
// 컨텍스트에는 RATES 가 있어야 한다.
export function assetValueSource() {
  const src = readOne('core/data.js')
  const pick = (re, label) => { const m = src.match(re); if (!m) throw new Error(`core/data.js 에서 ${label} 을(를) 찾지 못함`); return m[0] }
  return [
    pick(/const CRYPTO_KRW_AVG_THRESHOLD = [^;]+;/, 'CRYPTO_KRW_AVG_THRESHOLD'),
    pick(/function curRate\(cur\)\{[\s\S]*?\n\}/, 'curRate'),
    pick(/function assetAvgNative\(i\)\{[\s\S]*?\n\}/, 'assetAvgNative'),
    pick(/function assetValueKRW\(i\)\{[^\n]*\}/, 'assetValueKRW'),
    pick(/function assetCostKRW\(i\)\{[^\n]*\}/, 'assetCostKRW'),
    pick(/function assetGainKRW\(i\)\{[^\n]*\}/, 'assetGainKRW'),
  ].join('\n')
}
