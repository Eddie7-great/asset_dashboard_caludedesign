// 화면별 파일 나누기(2026-11-23)의 안전장치.
//
// 브라우저는 index.html 의 <script> 를 적힌 순서대로 실행하고, 모든 파일이 같은 전역 이름 공간을 쓴다.
// 그래서 파일을 나누면 생기는 오류는 세 가지뿐이다 — 이 테스트가 셋 다 막는다.
//   1) 테스트가 읽는 순서(_source.mjs)와 실제 로드 순서가 다르다.
//   2) 두 파일이 같은 이름을 let/const 로 선언한다 → 뒤 파일이 'already been declared' 로 통째로 멈춘다.
//   3) 먼저 로드되는 화면 파일이 '로드하는 순간' 아직 없는 cobalt.js 의 let/const 를 쓴다 → ReferenceError.
//      (함수 안에서 쓰는 것은 괜찮다 — 함수는 모든 파일이 로드된 뒤에 불린다.)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { SOURCE_PARTS, readSource } from './_source.mjs'

const html = readSource('index.html')
const local = [...html.matchAll(/<script defer src="([^"?:]+\.js)(?:\?v=\d+)?"><\/script>/g)].map(m => m[1])

// 1) 로드 순서: 나눈 조각은 index.html 에서 같은 순서로, 사이에 다른 파일 없이 이어진다.
for (const [name, parts] of Object.entries(SOURCE_PARTS)) {
  const at = local.indexOf(parts[0])
  assert.ok(at >= 0, `${parts[0]} 가 index.html 에 없다`)
  assert.deepEqual(local.slice(at, at + parts.length), parts, `${name} 조각의 로드 순서가 _source.mjs 와 다르다`)
  assert.equal(parts[parts.length - 1], name, `${name} 본체는 조각 중 마지막에 로드한다(CB_VIEWS 가 앞 조각의 함수를 참조한다)`)
}
// pages/ 에 있는 파일은 빠짐없이 등록돼 있어야 한다(파일만 만들고 로드를 잊는 일 방지).
const pageFiles = fs.readdirSync(new URL('../../pages/', import.meta.url)).filter(n => n.endsWith('.js')).map(n => 'pages/' + n)
const listed = Object.values(SOURCE_PARTS).flat()
for (const f of pageFiles) assert.ok(listed.includes(f), `${f} 가 _source.mjs 에 없다`)

// 각 파일의 맨 위(top-level) 선언을 모은다.
const parse = (file) => ts.createSourceFile(file, fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const lexicalNames = (sf) => {
  const out = []
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st) && (st.declarationList.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) out.push(d.name.text)
    } else if (ts.isClassDeclaration(st) && st.name) out.push(st.name.text)
  }
  return out
}

// 2) 같은 let/const 이름을 두 파일이 선언하지 않는다(로드하는 모든 로컬 스크립트 대상).
const owner = new Map()
for (const file of local) {
  for (const n of lexicalNames(parse(file))) {
    assert.ok(!owner.has(n), `${n} 가 ${owner.get(n)} 와 ${file} 에 함께 선언돼 있다`)
    owner.set(n, file)
  }
}

// 3) 앞 조각의 '로드 때 실행되는 코드'가 뒤에 로드되는 파일의 let/const 를 쓰지 않는다.
const loadTimeIds = (sf) => {
  const ids = new Set()
  const walk = (node) => {
    if (ts.isFunctionLike(node)) return   // 함수 몸통은 나중에 불린다
    if (ts.isIdentifier(node)) ids.add(node.text)
    ts.forEachChild(node, walk)
  }
  for (const st of sf.statements) if (!ts.isFunctionDeclaration(st)) walk(st)
  return ids
}
for (const parts of Object.values(SOURCE_PARTS)) {
  parts.forEach((file, i) => {
    const later = new Set(local.slice(local.indexOf(file) + 1).flatMap(f => lexicalNames(parse(f))))
    const bad = [...loadTimeIds(parse(file))].filter(n => later.has(n))
    assert.deepEqual(bad, [], `${file} 가 로드 때 뒤 파일의 이름을 쓴다: ${bad.join(', ')}`)
  })
}

// 옮긴 화면 렌더러가 실제로 그 조각에 있고 cobalt.js 에는 남지 않았다(중복 정의 방지).
const moved = {
  'pages/performance.js': ['cbRenderPerf'],
  'pages/family.js': ['cbRenderFam'],
  'pages/risk.js': ['cbRenderRisk'],
  'pages/dividend.js': ['cbRenderDiv'],
  'pages/gift.js': ['cbRenderGift', 'cbGiftPrior', 'cbGiftLedgerHtml'],
  'pages/tax.js': ['cbRenderTax', 'cbTaxImportPlan', 'cbTaxHoldCandidates'],
  'pages/dca.js': ['cbRenderDca', 'cbDcaEdit', 'cbDcaEditPlan'],
}
const cobaltOnly = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8')   // 조각을 잇지 않은 cobalt.js 본체만
for (const [file, fns] of Object.entries(moved)) {
  const src = fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8')
  for (const fn of fns) {
    assert.match(src, new RegExp(`\\nfunction ${fn}\\(`), `${fn} 는 ${file} 에 있다`)
    assert.doesNotMatch(cobaltOnly, new RegExp(`\\nfunction ${fn}\\(`), `${fn} 가 cobalt.js 에도 남아 있다`)
  }
}

console.log('PASS 화면별 파일 나누기: 로드 순서·이름 충돌·로드 때 참조')
