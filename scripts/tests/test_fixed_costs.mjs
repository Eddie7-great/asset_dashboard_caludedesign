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
}
vm.createContext(context)
for (const name of [
  '_autoTransferActiveInMonth',
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
assert.equal(context._autoTransferActiveInMonth({...monthly,endMonth:'2026-07'},2026,8),false,'종료 월 이후 제외')
assert.equal(context._autoTransferActiveInMonth({...monthly,skipMonths:['2026-08']},2026,8),false,'건너뛴 달 제외')
const nextDate=context._nextFixedCostDate(monthly,new Date(2026,7,26))
assert.deepEqual([nextDate.getFullYear(),nextDate.getMonth()+1,nextDate.getDate()],[2026,9,25],'결제일이 지난 경우 다음 달 예정일')
context._cfOwner='본인'
assert.equal(context._fixedCostOwnerMatches(monthly),true,'선택 소유주 고정비 포함')
assert.equal(context._fixedCostOwnerMatches(weekly),false,'다른 소유주 고정비 제외')

assert.match(html,/월별 현금흐름[\s\S]*고정비 관리[\s\S]*id="cf-fixed-owner"/,'고정비 탭과 소유주 입력')
assert.match(html,/월 고정비[\s\S]*연간 환산액[\s\S]*수입 대비 고정비율[\s\S]*다음 결제 예정/,'고정비 요약 위젯')
assert.match(source,/owner:at\.owner\|\|'미지정'[\s\S]*autoTransferData: autoTransferData/,'자동이체 실체화 소유주와 원격 동기화')
assert.match(source,/at\.isFixedCost===true[\s\S]*at\.isFixedCost==null[\s\S]*at\.isFixedCost===false/,'합산·검토·제외 상태 분리')
assert.match(css,/@media \(max-width: 768px\)[\s\S]*cf-fixed-summary-grid[\s\S]*cf-fixed-secondary/,'모바일 고정비 핵심 칼럼 구성')

console.log('PASS 현금 흐름 고정비 관리')
