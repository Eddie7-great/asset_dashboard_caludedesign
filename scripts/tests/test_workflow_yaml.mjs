// GitHub Actions 워크플로가 YAML 로 파싱되는지 확인한다.
//
// 왜 필요한가: 워크플로 파일이 파싱되지 않으면 GitHub 은 잡을 하나도 만들지 못하고
// 런을 즉시 실패시킨다. npm test 는 멀쩡히 통과하는데 그 통과를 아무도 확인하지 못하는
// 상태가 되며, 실행 목록에서도 그냥 빨간 점 하나로만 보인다.
// 실제로 `run: python -m pip install ... --only-binary=:all: numpy pandas` 한 줄이
// 품질 게이트를 통째로 멈춰 세운 적이 있다 — 따옴표 없는 평문 스칼라에는
// 콜론+공백(': ')이 들어갈 수 없는데 `--only-binary=:all:` 뒤의 공백이 정확히 그것이다.
//
// 외부 YAML 파서를 devDependency 로 들이지 않고, 실제로 사고를 낸 패턴만 정확히 막는다.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const dir = resolve(root, '.github', 'workflows')
const files = readdirSync(dir).filter(n => /\.ya?ml$/.test(n)).sort()

assert.ok(files.length > 0, '.github/workflows 에 워크플로가 있어야 한다')

// 인라인 스칼라 값에 ': ' 가 있으면 YAML 은 그 지점부터 매핑으로 읽으려다 실패한다.
// 블록 스칼라(`key: |` / `key: >`)와 따옴표로 감싼 값은 안전하므로 제외한다.
const INLINE_SCALAR = /^\s*(?:- )?([A-Za-z0-9_-]+):[ \t]+(\S.*)$/
const problems = []

for (const name of files) {
  const lines = readFileSync(resolve(dir, name), 'utf8').split('\n')
  let blockIndent = null   // 블록 스칼라 본문 안에 있는 동안의 기준 들여쓰기
  lines.forEach((line, i) => {
    if (!line.trim()) return
    const indent = line.length - line.trimStart().length
    if (blockIndent !== null) {
      if (indent > blockIndent) return   // 블록 스칼라 본문 — 내용은 통째로 문자열이다
      blockIndent = null
    }
    if (line.trim().startsWith('#')) return
    const m = line.match(INLINE_SCALAR)
    if (!m) return
    const value = m[2].trim()
    if (/^[|>][-+0-9]*$/.test(value)) { blockIndent = indent; return }  // 블록 스칼라 시작
    if (/^(['"]).*\1$/.test(value)) return                              // 따옴표로 감싼 값
    if (value.includes(': ') || /:$/.test(value)) {
      problems.push(`${name}:${i + 1}  ${m[1]}: 값에 ': ' 가 있어 평문 스칼라로 파싱되지 않는다\n    ${line.trim()}`)
    }
  })
}

assert.deepEqual(
  problems, [],
  `워크플로 YAML 파싱 오류 — 해당 값을 블록 스칼라(| )나 따옴표로 감싸야 한다:\n  ${problems.join('\n  ')}`,
)

console.log(`PASS: 워크플로 YAML 인라인 스칼라 검사 (${files.length}개 파일)`)
