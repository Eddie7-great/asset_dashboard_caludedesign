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

const context = {
  DOW_LABELS: ['일','월','화','수','목','금','토'],
  _cfOwner: '전체',
  _effectiveAutoTransferAmt: at => at.amt,
  autoTransferData: [],
  _KR_BANK_HOLIDAYS: new Set([
    '2026-05-01','2026-05-05','2026-05-24','2026-05-25','2026-07-17',
    '2026-08-15','2026-08-17','2026-10-03','2026-10-05','2026-10-09',
  ]),
}
vm.createContext(context)
for (const name of [
  '_cfLocalDateKey',
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
assert.deepEqual([nextDate.getFullYear(),nextDate.getMonth()+1,nextDate.getDate()],[2026,9,25],'결제일이 지난 경우 다음 달 예정일')
context._cfOwner='본인'
assert.equal(context._fixedCostOwnerMatches(monthly),true,'선택 소유주 고정비 포함')
assert.equal(context._fixedCostOwnerMatches(weekly),false,'다른 소유주 고정비 제외')

assert.match(html,/월별 현금흐름[\s\S]*고정비 관리[\s\S]*id="cf-fixed-owner"/,'고정비 탭과 소유주 입력')
assert.match(html,/월 고정비[\s\S]*연간 환산액[\s\S]*수입 대비 고정비율[\s\S]*다음 결제 예정/,'고정비 요약 위젯')
assert.doesNotMatch(html,/<option value="month-start">매월초<\/option>/,'매월초 선택지 제거')
assert.match(html,/<option value="month-end">매월말<\/option>/,'월마다 다른 마지막 날짜를 위한 매월말 선택지 유지')
assert.match(source,/owner:at\.owner\|\|'미지정'[\s\S]*autoTransferData: autoTransferData/,'자동이체 실체화 소유주와 원격 동기화')
assert.match(source,/_KR_BANK_HOLIDAYS[\s\S]*_nextKrBankBusinessDay[\s\S]*scheduledKey/, '은행 휴일 다음 영업일 계산')
assert.match(source,/businessDayRule:'next'[\s\S]*scheduleMonth:ym/, '자동이체 실제 예정일과 약정 월 저장')
assert.match(source,/at\.isFixedCost===true[\s\S]*at\.isFixedCost==null[\s\S]*at\.isFixedCost===false/,'합산·검토·제외 상태 분리')
assert.match(css,/@media \(max-width: 768px\)[\s\S]*cf-fixed-summary-grid[\s\S]*cf-fixed-secondary/,'모바일 고정비 핵심 칼럼 구성')

console.log('PASS 현금 흐름 고정비 관리')
