#!/usr/bin/env node
// 현금 흐름 고정비 탭의 환산·소유주·동기화 규칙을 검증한다.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../../script.js', import.meta.url), 'utf8')
const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../../style.css', import.meta.url), 'utf8')

function extractFunction(name) {
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
  throw new Error(`${name} 함수 닫는 괄호를 찾을 수 없음`)
}

// 한 줄짜리 const 선언을 소스에서 그대로 가져온다 (테스트 사본이 원본과 어긋나지 않도록)
function extractConstLine(name) {
  const re = new RegExp(`^const ${name}\\s*=.*$`, 'm')
  const m = source.match(re)
  assert.notEqual(m, null, `${name} 선언을 찾을 수 없음`)
  return m[0]
}

const context = {
  DOW_LABELS: ['일','월','화','수','목','금','토'],
  _cfOwner: '전체',
  _effectiveAutoTransferAmt: at => at.amt,
  autoTransferData: [],
  _cfEsc: v => String(v == null ? '' : v),
  Intl,
}
vm.createContext(context)
// 은행 영업일 판정은 _krHolidaySet(연도) 계산기 하나에만 의존한다.
// 예전에는 테스트가 2026년 공휴일을 손으로 넣었지만, 그러면 실제 판정 로직을 건너뛴다.
for (const line of ['_MARKET_HOLIDAY_CACHE', '_KR_ONE_OFF_HOLIDAYS', 'cfColors']) {
  vm.runInContext(extractConstLine(line), context)
}
for (const name of [
  '_cfLocalDateKey',
  '_dateAtNoon',
  '_addDateKey',
  '_krLunarParts',
  '_krHolidaySet',
  '_isKrPublicHoliday',
  '_isKrBankBusinessDay',
  '_nextKrBankBusinessDay',
  '_normalizeAutoTransferSchedules',
  '_autoTransferActiveInMonth',
  '_autoTransferScheduledDate',
  '_autoTransferMonthlyOccurrences',
  '_autoTransferMonthlyEquivalent',
  '_fixedCostCycleText',
  '_autoTransferOccursOn',
  '_nextFixedCostDate',
  '_fixedCostOwnerMatches',
  '_fixedCostDistribution',
  '_fixedCostDistributionHtml',
]) vm.runInContext(extractFunction(name), context)

const monthly = { owner:'본인', amt:300_000, cycle:'monthly', dayOfMonth:25, startMonth:'2026-01', isFixedCost:true }
const weekly = { owner:'아내', amt:10_000, cycle:'weekly', dayOfWeek:1, startMonth:'2026-01', isFixedCost:true }
assert.equal(context._autoTransferMonthlyEquivalent(monthly,2026,8),300_000,'매월 고정비 월 환산')
assert.equal(Math.round(context._autoTransferMonthlyEquivalent(weekly,2026,8)),43_333,'매주 고정비는 연 52회 기준으로 월 환산')
assert.equal(context._fixedCostCycleText(monthly),'매월 25일','결제일 표시')
assert.equal(context._fixedCostCycleText(weekly),'매주 월요일','요일 표시')
const legacyMonthStart={owner:'본인',amt:50_000,cycle:'month-start',startMonth:'2026-01'}
assert.equal(context._normalizeAutoTransferSchedules([legacyMonthStart]),true,'기존 매월초 규칙을 매월 1일로 변환')
assert.deepEqual([legacyMonthStart.cycle,legacyMonthStart.dayOfMonth],['monthly',1],'매월초 호환 데이터')
const wooriMortgage={owner:'본인',amt:1_000_000,cycle:'monthly',dayOfMonth:25,startMonth:'2026-01',businessDayRule:'next'}
const wooriOct=context._autoTransferScheduledDate(wooriMortgage,2026,10)
assert.deepEqual([wooriOct.getFullYear(),wooriOct.getMonth()+1,wooriOct.getDate()],[2026,10,26],'우리은행 주담대 25일이 일요일이면 다음 영업일')
const liberationDay=context._autoTransferScheduledDate({...wooriMortgage,dayOfMonth:15},2026,8)
assert.deepEqual([liberationDay.getFullYear(),liberationDay.getMonth()+1,liberationDay.getDate()],[2026,8,18],'공휴일과 대체공휴일을 건너 다음 은행 영업일')
const monthEnd=context._autoTransferScheduledDate({...wooriMortgage,cycle:'month-end'},2026,5)
assert.deepEqual([monthEnd.getFullYear(),monthEnd.getMonth()+1,monthEnd.getDate()],[2026,6,1],'월말이 일요일이면 다음 달 첫 영업일')
assert.equal(context._autoTransferMonthlyOccurrences({...wooriMortgage,cycle:'month-end'},2026,6).length,2,'이월된 5월말 출금과 6월말 출금을 실제 출금 월에 모두 표시')
assert.equal(context._autoTransferActiveInMonth({...monthly,endMonth:'2026-07'},2026,8),false,'종료 월 이후 제외')
assert.equal(context._autoTransferActiveInMonth({...monthly,skipMonths:['2026-08']},2026,8),false,'건너뛴 달 제외')
const nextDate=context._nextFixedCostDate(monthly,new Date(2026,7,26))
// 9/25는 추석이고 9/26~27 주말, 9/28은 추석 대체공휴일이라 다음 영업일은 9/29다.
// (예전 기대값 9/25는 테스트가 손으로 넣은 공휴일 집합에 추석이 빠져 있어서 나온 값이고,
//  실제 앱은 그때도 9/29를 돌려주고 있었다.)
assert.deepEqual([nextDate.getFullYear(),nextDate.getMonth()+1,nextDate.getDate()],[2026,9,29],'결제일이 지난 경우 다음 달 예정일 — 추석 연휴를 건너뛴다')
context._cfOwner='본인'
assert.equal(context._fixedCostOwnerMatches(monthly),true,'선택 소유주 고정비 포함')
assert.equal(context._fixedCostOwnerMatches(weekly),false,'다른 소유주 고정비 제외')

assert.match(html,/월별 현금흐름[\s\S]*고정비 관리[\s\S]*id="cf-fixed-owner"/,'고정비 탭과 소유주 입력')
assert.match(html,/월 고정비[\s\S]*연간 환산액[\s\S]*수입 대비 고정비율[\s\S]*다음 결제 예정/,'고정비 요약 위젯')
assert.doesNotMatch(html,/<option value="month-start">매월초<\/option>/,'매월초 선택지 제거')
assert.match(html,/<option value="month-end">매월말<\/option>/,'월마다 다른 마지막 날짜를 위한 매월말 선택지 유지')
assert.match(source,/owner:at\.owner\|\|'미지정'[\s\S]*autoTransferData: autoTransferData/,'자동이체 실체화 소유주와 원격 동기화')
assert.match(source,/_isKrPublicHoliday[\s\S]*_nextKrBankBusinessDay[\s\S]*scheduledKey/, '은행 휴일 다음 영업일 계산')
// 공휴일 표는 _krHolidaySet 하나뿐이어야 한다 — 연도별 목록을 다시 하드코딩하면 갱신을 잊는다.
assert.doesNotMatch(source,/_KR_BANK_HOLIDAYS/, '연도별 공휴일 하드코딩 금지')
assert.match(source,/businessDayRule:'next'[\s\S]*scheduleMonth:ym/, '자동이체 실제 예정일과 약정 월 저장')
assert.match(source,/at\.isFixedCost===true[\s\S]*at\.isFixedCost==null[\s\S]*at\.isFixedCost===false/,'합산·검토·제외 상태 분리')
assert.match(css,/@media \(max-width: 768px\)[\s\S]*cf-fixed-summary-grid[\s\S]*cf-fixed-secondary/,'모바일 고정비 핵심 칼럼 구성')

// 카테고리별 고정비 분포 — 새 계산 없이 표와 같은 _autoTransferMonthlyEquivalent 를 가중치로 쓴다.
{
  const rent={owner:'본인',cat:'주거/통신',amt:1_000_000,cycle:'monthly',dayOfMonth:25,startMonth:'2026-01',isFixedCost:true}
  const food1={owner:'본인',cat:'식비',amt:300_000,cycle:'monthly',dayOfMonth:5,startMonth:'2026-01',isFixedCost:true}
  const food2={owner:'아내',cat:'식비',amt:200_000,cycle:'monthly',dayOfMonth:5,startMonth:'2026-01',isFixedCost:true}
  const dist=context._fixedCostDistribution([rent,food1,food2],2026,8)
  // vm 컨텍스트(별도 realm) 배열이라 프로토타입이 달라 deepStrictEqual 이 실패한다 — 복제 후 비교.
  assert.deepEqual(Array.from(dist).map(d=>d.cat),['주거/통신','식비'],'금액 내림차순 · 카테고리별로 묶는다(같은 카테고리 여러 건 합산)')
  assert.equal(dist.find(d=>d.cat==='식비').amount,500_000,'같은 카테고리의 여러 자동이체를 합산')
  assert.equal(Math.round(dist.find(d=>d.cat==='주거/통신').pct*10)/10,66.7,'비중은 합산액 대비 백분율')
  assert.equal(context._fixedCostDistribution([],2026,8).length,0,'합산된 고정비가 없으면 빈 배열')

  const distHtml=context._fixedCostDistributionHtml([rent,food1,food2],2026,8)
  assert.match(distHtml,/class="sim-stack"/,'차트 라이브러리 없이 sim-stack 누적 막대 패턴을 재사용')
  assert.match(distHtml,/class="cf-fixed-dist-legend"/,'범례 목록을 함께 렌더')
  // 최상위 const는 vm 컨텍스트 프로퍼티가 아니라 코드 문자열로 읽는다.
  const rentColor=vm.runInContext("cfColors['주거/통신']",context)
  assert.match(distHtml,new RegExp('background:'+rentColor.replace('#','\\#')),'cfColors 와 같은 카테고리 색을 쓴다(현금흐름 차트와 동일)')
  assert.match(context._fixedCostDistributionHtml([],2026,8),/합산된 고정비가 없어/,'빈 상태 안내')
}

assert.match(html,/cf-fixed-bottom-row[\s\S]*cf-fixed-table-panel[\s\S]*cf-fixed-dist-panel[\s\S]*id="cf-fixed-dist"/,'내역 표와 분포 시각화를 한 행에 나란히 둔다')
assert.match(css,/\.cf-fixed-bottom-row\{display:grid;grid-template-columns:minmax\(0,1\.4fr\) minmax\(200px,1fr\)/,'표는 컴팩트하게, 분포는 옆 여백에 — 표 단독 사용 대비 폭을 나눈다')
assert.match(source,/const distEl=document\.getElementById\('cf-fixed-dist'\);if\(distEl\)distEl\.innerHTML=_fixedCostDistributionHtml\(included,y,m\)/,'renderFixedCostView 가 표와 같은 included 목록으로 분포를 그린다')

console.log('PASS 현금 흐름 고정비 관리')
