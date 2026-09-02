#!/usr/bin/env node
// 한눈에 보기(cbRenderSnap) — 요약 페이지가 대시보드·재무상태표·배당 관리와 같은 수치를 쓰는지 검증한다.
// 이 페이지는 새로 계산하는 값이 없어야 한다: 자산 구성은 cbAllRows, 순자산은 finNwSeries,
// 배당 월 분포는 cbDivMonthlyForYear 를 그대로 통과시킨 결과여야 한다.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const cobaltSource = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8')
const financeSource = fs.readFileSync(new URL('../../finance.js', import.meta.url), 'utf8')
const styleSource = fs.readFileSync(new URL('../../style.css', import.meta.url), 'utf8')
const indexSource = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} 함수를 찾을 수 없음`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`${name} 함수의 닫는 괄호를 찾을 수 없음`)
}

// ── 라우팅 배선 (index.html + cobalt.js) ─────────────────────────────
assert.match(indexSource, /<div id="view-snap" class="view-section"><div class="cb-scroll" id="cb-snap"><\/div><\/div>/, '한눈에 보기 뷰 컨테이너')
assert.match(indexSource, /<button class="menu-btn" id="menu-snap" onclick="switchView\('snap',this\)"/, '요약 그룹 사이드바 버튼')
const summaryGroup = indexSource.slice(indexSource.indexOf('id="menu-items-summary"'), indexSource.indexOf('data-menu-group="analysis"'))
assert.ok(summaryGroup.includes('id="menu-snap"'), '한눈에 보기는 요약 메뉴 그룹에 있어야 한다')
assert.match(cobaltSource, /CB_VIEWS\s*=\s*\{[^}]*snap:cbRenderSnap/, 'CB_VIEWS 등록')
assert.match(cobaltSource, /CB_TITLES\s*=\s*\{[^}]*snap:'한눈에 보기'/, 'CB_TITLES 등록')

// ── 렌더 컨텍스트 ────────────────────────────────────────────────────
const today = new Date()
const dayKey = offset => {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const container = { innerHTML: '' }
const head = { sub: null, widgets: null }
const ctx = {
  document: { getElementById: id => (id === 'cb-snap' ? container : null) },
  window: {
    _divDataCache: {
      // 분기 배당(3·6·9·12월) 미국 주식
      SCHD: { annualDps: 1, yldNum: 3.5, cycle: '분기', months: [2, 5, 8, 11], cur: 'USD' },
      // 연 1회(12월) 국내 주식
      '005930': { annualDps: 1000, yldNum: 2.1, cycle: '연간', months: [11], cur: 'KRW' },
    },
    _netWorthHistory: [
      { date: dayKey(20), schemaV: 2, total: 100_000_000, netByOwner: { 본인: 60_000_000, 아내: 40_000_000 } },
      { date: dayKey(10), schemaV: 2, total: 90_000_000, netByOwner: { 본인: 50_000_000, 아내: 40_000_000 } },
      { date: dayKey(1), schemaV: 2, total: 120_000_000, netByOwner: { 본인: 70_000_000, 아내: 50_000_000 } },
    ],
    _balanceSheet: { assets: [], liabilities: [], cashTargetMonths: 6 },
  },
  OWNERS: ['본인', '아내', '자녀1', '아버지'],
  ownerColors: { 본인: '#5b9bff', 아내: '#4ecdc4' },
  RATES: { USD: 1000, JPY: 10, KRW: 1 },
  pfolioData: [
    { owner: '본인', grp: '주식', tkr: 'SCHD', name: 'Schwab US Dividend', cur: 'USD', qty: 100, curP: 80, avgP: 60 },
    { owner: '본인', grp: '주식', tkr: '005930', name: '삼성전자', cur: 'KRW', qty: 100, curP: 70_000, avgP: 60_000 },
    { owner: '아내', grp: '가상화폐', tkr: 'BTC', name: '비트코인', cur: 'USD', qty: 0.1, curP: 90_000, avgP: 50_000 },
    { owner: '아내', grp: '현금', tkr: 'KRW', name: '예수금', cur: 'KRW', qty: 1, curP: 5_000_000, avgP: 0 },
  ],
  _cbSnapOwner: '전체',
  _cbSnapTf: '1M',
  _finNwTf: '6M',
  console,
  // 페이지가 직접 만들지 않고 위임하는 것들 — 호출 여부만 본다.
  cbEnsureDivHist: () => {},
  finEnsureState: () => {},
  cbSetHead: (sub, widgets) => { head.sub = sub; head.widgets = widgets },
  cbDivGrowthInfo: () => ({ value: null, status: 'missing', years: 0, events: 0 }),
  cbDivTaxAllocate: () => { throw new Error('요약 페이지는 세전만 다루므로 세금 엔진을 호출하면 안 된다') },
}
ctx.window.OWNERS = ctx.OWNERS
vm.createContext(ctx)

for (const name of [
  'cbStrip', 'cbRate', 'cbAvgNative', 'cbValKRW', 'cbCostKRW', 'cbGainKRW', 'cbDisp', 'cbSignDisp',
  'cbKrw', 'cbPct', 'cbEsc', 'cbUpDn', 'cbOwnerColor', 'cbCls', 'cbRow', 'cbAllRows', 'cbOwnerBtns',
  'cbDivOf', 'cbDivIncomeKRW', 'cbAddDivMonthDetail', 'cbDivMonthlyForYear', 'cbSmoothPath',
  'cbNiceStep', 'cbTaxAxisLab', 'cbSnapDivList', 'cbSnapMonthBars', 'cbRenderSnap',
]) vm.runInContext(extractFunction(cobaltSource, name), ctx)
for (const name of [
  'finRows', 'finSum', 'finBalanceTotals', 'finSnapshotKind', 'finSnapshotNumber', 'finSnapshotNet',
  'finSnapshotOwnerNet', 'finNwSeries', 'finNwStats', 'finNwChartSvg',
  'finNwCoverage', 'finNwCoverageNote',
]) vm.runInContext(extractFunction(financeSource, name), ctx)
// 상수는 소스에서 그대로 가져온다 — 테스트에 복사해 두면 팔레트·아이콘이 바뀌어도 눈치채지 못한다.
function extractConst(source, name) {
  const start = source.search(new RegExp(`^const ${name}\\s*=`, 'm'))
  assert.notEqual(start, -1, `${name} 상수를 찾을 수 없음`)
  let depth = 0
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') depth--
    else if (source[i] === ';' && depth === 0) return source.slice(start, i + 1)
  }
  throw new Error(`${name} 상수의 끝을 찾을 수 없음`)
}
vm.runInContext("const _dispCur='KRW';", ctx)
for (const name of ['CB_CLS', 'CB_SNAP_ICON', 'CB_LINE_PAD']) vm.runInContext(extractConst(cobaltSource, name), ctx)
vm.runInContext(extractConst(financeSource, 'FIN_NW_TFS'), ctx)

// ── 전체 보기 ────────────────────────────────────────────────────────
ctx.cbRenderSnap()
const all = container.innerHTML

// 자산군 비중: 미국 8,000,000 / 한국 7,000,000 / 가상화폐 9,000,000 / 현금 5,000,000 = 29,000,000
assert.ok(all.includes('₩29,000,000'), '히어로 금액은 보유 자산 평가액 합계')
assert.ok(all.includes('31.0<i>%</i>'), '가상화폐 9,000,000 / 29,000,000 = 31.0%')
assert.ok(all.includes('27.6<i>%</i>'), '미국 주식 8,000,000 / 29,000,000 = 27.6%')
const stackBlock = all.match(/class="cb-snap-stack"[\s\S]*?<\/div>/)[0]
assert.equal(
  [...stackBlock.matchAll(/width:([\d.]+)%/g)].reduce((s, m) => s + Number(m[1]), 0).toFixed(1),
  '100.0',
  '누적 막대 폭 합계는 100%',
)
assert.ok(all.includes('소유주별 비중'), '전체 보기에서는 소유주 분해를 함께 보여준다')

// 순자산 추이: 1M 스냅샷 3건, 100,000,000 → 120,000,000
assert.ok(all.includes('<b>3일</b>'), '선택 기간 스냅샷 건수')
assert.ok(all.includes('+₩20,000,000'), '기간 증감 = 마지막 − 처음')
assert.ok(all.includes('>-10.0%<'), 'MDD: 고점 100,000,000 → 90,000,000 = −10%')
// 픽스처의 기록은 20일치뿐이라 1M(30일)을 채우지 못한다 — 그 사실을 화면이 밝혀야 한다.
// (이걸 숨기면 기간 버튼을 눌러도 MDD가 안 변하는 게 고장으로 보인다)
assert.match(all, /선택한 기간\(30일\)보다 기록이 짧습니다[\s\S]*?\(20일\)/, '기록 부족 안내')

// 배당: SCHD 100주 × $1 × 1,000원 = 100,000 / 삼성전자 100주 × 1,000원 = 100,000
assert.ok(all.includes('₩200,000'), '연 배당(세전) 합계')
assert.ok(all.includes('₩16,667'), '월평균 = 연 배당 / 12')
assert.ok(all.includes('0.69%'), '자산 대비 = 200,000 / 29,000,000')
assert.ok(all.includes('배당 지급 2종목'), '배당 종목 수는 소유주+티커 단위')
const monthBars = [...all.matchAll(/class="cb-snap-month-track"><i style="height:([\d.]+)%/g)].map(m => Number(m[1]))
assert.equal(monthBars.length, 12, '월별 막대는 12개')
// 12월 = SCHD 분기분 25,000 + 삼성전자 100,000 = 125,000 (최대), 3·6·9월은 25,000
assert.equal(monthBars[11], 100, '최대 지급월(12월)이 100%')
assert.equal(monthBars[2], 20, '3월 25,000 / 125,000')
assert.equal(monthBars[0], 0, '지급월이 아닌 달은 막대 없음')

// ── 소유주 필터 ──────────────────────────────────────────────────────
// 페이지가 보여주는 모든 수치는 소유주 탭을 따라야 한다 (가구 합계가 새어 나오면 안 된다).
ctx._cbSnapOwner = '아내'
ctx.cbRenderSnap()
const wife = container.innerHTML
assert.ok(wife.includes('₩14,000,000'), '아내 자산 = 가상화폐 9,000,000 + 현금 5,000,000')
assert.ok(!wife.includes('₩29,000,000'), '소유주 탭에서 가구 합계가 남아 있으면 안 된다')
assert.ok(!wife.includes('소유주별 비중'), '소유주 탭에서는 소유주 분해를 숨긴다')
assert.ok(wife.includes('+₩10,000,000'), '아내 순자산 40,000,000 → 50,000,000')
assert.ok(wife.includes('배당 정보를 불러온 종목이 없습니다'), '아내는 배당 종목이 없다')
assert.ok(/한눈에 보기[\s\S]*/.test(String(head.sub || '')) || String(head.sub).includes('아내'), '헤더 소제목에 현재 범위를 표시')
assert.ok(String(head.widgets).includes("cbSnapOwner('아내')"), '소유주 버튼은 페이지 전용 핸들러를 쓴다')

// ── XSS ──────────────────────────────────────────────────────────────
ctx._cbSnapOwner = '전체'
ctx.pfolioData.push({ owner: '본인', grp: '주식', tkr: 'EVIL', name: '<img src=x onerror=alert(1)>', cur: 'USD', qty: 1, curP: 1, avgP: 1 })
ctx.window._divDataCache.EVIL = { annualDps: 5, yldNum: 1, cycle: '연간', months: [0], cur: 'USD' }
ctx.cbRenderSnap()
assert.ok(!container.innerHTML.includes('<img src=x'), '종목명은 이스케이프해서 넣는다')
assert.ok(container.innerHTML.includes('&lt;img src=x'), '이스케이프된 형태로 표시')

// ── 스타일 ───────────────────────────────────────────────────────────
// 3테마(라이트/다크/네이비)가 CSS 변수로 갈리므로 새 카드도 색을 하드코딩하면 안 된다.
const snapCss = styleSource.split('\n').filter(line => line.includes('.cb-snap'))
assert.ok(snapCss.length > 20, '한눈에 보기 스타일이 style.css 에 있어야 한다')
for (const line of snapCss) {
  const hex = line.match(/#[0-9a-fA-F]{3,8}\b/g) || []
  // 자산군 색은 인라인 --seg 로 주입되고, 아이콘 글자색만 흰색 고정이다.
  assert.deepEqual(hex.filter(h => h.toLowerCase() !== '#fff'), [], `테마 밖 하드코딩 색: ${line.trim()}`)
}
assert.ok(styleSource.includes('.cb-snap-hero-stats{grid-template-columns:repeat(2,minmax(0,1fr))'), '좁은 화면 히어로 지표 재배치')

console.log('PASS: 한눈에 보기 페이지 (배선·수치·소유주 필터·XSS·테마)')
