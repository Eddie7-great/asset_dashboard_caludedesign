// 화면별로 나눈 소스 파일을 '원래 한 파일'처럼 읽는다.
//
// cobalt.js 의 화면 렌더러를 pages/*.js 로 옮겨도 테스트는 예전처럼 readSource('cobalt.js') 로
// 함수를 찾는다. 여기 적힌 순서는 index.html 의 실제 로드 순서와 같아야 한다 —
// test_source_split.mjs 가 둘을 대조한다.
import fs from 'node:fs'

const ROOT = new URL('../../', import.meta.url)

// 논리 파일 이름 → 실제 파일 목록(로드 순서). 목록에 없는 이름은 그 파일 하나를 읽는다.
export const SOURCE_PARTS = {
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
