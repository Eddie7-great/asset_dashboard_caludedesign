// 레이아웃·복원력 가드 — npm test 로는 잡히지 않던 두 종류의 사고를 정적으로 막는다.
//
// 왜 필요한가: 두 버그 모두 `npm test` 가 초록인 상태로 배포됐고, 실제 브라우저를
// 좁은 폭으로 열어 보거나 네트워크를 끊어 보기 전에는 드러나지 않았다.
//   1) 인라인 style 의 고정 폭 → 미디어쿼리가 덮을 수 없어 좁은 화면에서 요소가 잘렸다.
//      가족 증여 페이지에서는 금액이 '200,000' → '200' 으로 읽히는 상태였다.
//   2) CDN 라이브러리를 가드 없이 쓰면 로드 실패 시 initDashboard 가 통째로 멈추고
//      그 아래 KV 로드까지 실행되지 않아 앱 전체가 빈 화면이 된다(실제로 두 번 났다).
//
// 외부 의존성을 들이지 않고, 실제로 사고를 낸 패턴만 정확히 겨냥한다.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const read = (n) => readFileSync(resolve(root, n), 'utf8')

const RENDER_FILES = ['cobalt.js', 'finance.js', 'script.js']

// ── 1) 반응형이 필요한 폭 제약을 인라인 style 에 두지 않는다 ──────────────
//
// 의도된 가로 스크롤 표(.cb-tblwrap 안쪽의 min-width:640/826/990/1110px 등)는
// 클래스가 없는 내부 div 라 아래 두 규칙에 걸리지 않는다 — 일부러 그렇게 좁혔다.
{
  const problems = []
  for (const file of RENDER_FILES) {
    read(file).split('\n').forEach((line, i) => {
      const at = `${file}:${i + 1}`

      // (a) 고정 열 수 그리드 — 구성원별 보유 5열이 390px 화면에서 카드를 뭉갰다
      for (const m of line.matchAll(/style="[^"]*grid-template-columns:\s*repeat\(\s*([3-9])\s*,/g)) {
        problems.push(`${at}  인라인 ${m[1]}열 그리드 — 클래스로 빼고 style.css 에서 미디어쿼리로 열 수를 줄여라`)
      }

      // (b) 패널에 건 큰 min-width — 가족 증여 패널 430px 이 뷰포트를 넘겨 금액을 잘랐다
      for (const m of line.matchAll(/<[^<>]*class="[^"]*\bcb-panel\b[^"]*"[^<>]*style="[^"]*min-width:\s*(\d{3,})px/g)) {
        if (Number(m[1]) >= 360) {
          problems.push(`${at}  cb-panel 에 인라인 min-width:${m[1]}px — 클래스로 빼고 모바일에서 풀어라`)
        }
      }
    })
  }
  assert.deepEqual(
    problems, [],
    `반응형이 필요한 폭 제약이 인라인 style 에 있다. 미디어쿼리가 덮을 수 없어 좁은 화면에서 잘린다:\n  ${problems.join('\n  ')}`,
  )
}

// ── 2) CDN 라이브러리는 반드시 typeof 가드를 거친다 ──────────────────────
//
// index.html 의 외부 <script src> 를 읽어 아래 표와 대조한다.
// 새 CDN 을 추가했다면 전역 이름을 이 표에 등록하고 사용부에 가드를 넣어야 한다.
{
  const CDN_GLOBALS = [
    { match: /chart\.?js/i, global: 'Chart', use: /new Chart\s*\(/g },
    { match: /plotly/i, global: 'Plotly', use: /\bPlotly\.[A-Za-z]/g },
  ]
  const html = read('index.html')
  const js = RENDER_FILES.map(read).join('\n')

  const srcs = [...html.matchAll(/<script[^>]*\ssrc="(https:\/\/[^"]+)"/g)].map((m) => m[1])
  assert.ok(srcs.length > 0, 'index.html 에서 외부 스크립트를 찾지 못했다 — 이 검사가 무력화됐는지 확인하라')

  const unknown = srcs.filter((u) => !CDN_GLOBALS.some((e) => e.match.test(u)))
  assert.deepEqual(
    unknown, [],
    `표에 없는 CDN 라이브러리가 추가됐다. scripts/tests/test_layout_guards.mjs 의 CDN_GLOBALS 에 전역 이름을 등록하고, 사용부를 typeof 가드로 감싸라:\n  ${unknown.join('\n  ')}`,
  )

  // 전역이 '어딘가에서' 가드되는 것으로는 부족하다 — 실제 사고 두 건 모두 일부만 가드된
  // 상태였다(최상위 블록은 막고 initDashboard 안은 안 막음). 사용 지점마다, 그 지점을 감싼
  // 함수 안에 가드가 있는지 본다.
  const unguarded = []
  for (const file of RENDER_FILES) {
    const src = read(file)
    const lines = src.split('\n')
    for (const { global: g, use } of CDN_GLOBALS.filter((e) => srcs.some((u) => e.match.test(u)))) {
      for (const m of src.matchAll(use)) {
        const at = src.slice(0, m.index).split('\n').length      // 1-indexed
        // 이 줄을 감싼 최상위 함수의 시작 줄을 찾는다
        let start = 0
        for (let i = at - 1; i >= 0; i--) {
          if (/^(?:async\s+)?function\s+[A-Za-z_$]/.test(lines[i])) { start = i; break }
        }
        const scope = lines.slice(start, at).join('\n')
        const guard = new RegExp(`typeof\\s+${g}\\s*[=!]==\\s*['"]undefined['"]`)
        // 같은 줄에서 인라인으로 가드하는 형태도 인정한다
        if (!guard.test(scope) && !guard.test(lines[at - 1])) {
          unguarded.push(`${file}:${at}  ${lines[at - 1].trim().slice(0, 56)}`)
        }
      }
    }
  }
  assert.deepEqual(
    unguarded, [],
    `CDN 전역을 가드 없이 쓰고 있다. 로드 실패 시 그 함수가 통째로 중단되고 뒤따르는 로직(KV 로드 등)까지 멈춘다. 해당 함수 앞머리에 typeof 가드를 넣어라:\n  ${unguarded.join('\n  ')}`,
  )
}

// ── 3) 키보드 활성화는 위임 하나로 처리한다 ──────────────────────────────
//
// role="button" + tabindex 요소마다 인라인 onkeydown 을 복사해 붙이면(네 벌까지 늘었었다)
// 새로 추가하는 곳에서 빠뜨리기 쉽고, 위임과 함께 두면 이중 실행되어 토글이 두 번 뒤집힌다.
{
  assert.match(
    read('script.js'),
    /addEventListener\('keydown'[\s\S]{0,400}\[role="button"\]\[tabindex="0"\][\s\S]{0,300}\.click\(\)/,
    'Enter·Space 활성화를 문서 위임으로 처리해야 한다',
  )
  for (const file of RENDER_FILES) {
    const hits = [...read(file).matchAll(/\sonkeydown="[^"]*(?:Enter|' ')[^"]*"/g)]
    assert.deepEqual(
      hits.map((m) => m[0].slice(0, 60)), [],
      `${file} 에 인라인 onkeydown 이 남아 있다 — 위임과 이중 실행되어 선택이 두 번 뒤집힌다. role="button" tabindex="0" 만 남겨라`,
    )
  }

  // 클릭만 가능한 요소가 새로 생기지 않게 한다 (button·a 등 기본 요소는 제외).
  const orphans = []
  for (const file of RENDER_FILES) {
    const src = read(file)
    for (const m of src.matchAll(/<(\w+)((?:[^<>]|\$\{[^}]*\})*?onclick="([^"]*)"(?:[^<>]|\$\{[^}]*\})*?)>/g)) {
      const [tag, attrs] = [m[1].toLowerCase(), m[2]]
      if (['button', 'a', 'input', 'select', 'textarea', 'label'].includes(tag)) continue
      if (attrs.includes('role="button"') && attrs.includes('tabindex="0"')) continue
      // 전파만 막는 래퍼는 활성화 대상이 아니다 — 누를 것이 없다.
      if (/^\s*event\.stopPropagation\(\)\s*;?\s*$/.test(m[3])) continue
      orphans.push(`${file}:${src.slice(0, m.index).split('\n').length}  <${tag} onclick="${m[3].slice(0, 34)}…`)
    }
  }
  assert.deepEqual(
    orphans, [],
    `마우스로만 쓸 수 있는 요소가 있다. role="button" tabindex="0" 을 달면 키보드 활성화는 위임이 처리한다:\n  ${orphans.join('\n  ')}`,
  )
}

console.log('PASS: 레이아웃 폭 제약·CDN 가드·키보드 활성화 정적 검사')
