#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const scriptSource = fs.readFileSync(new URL('../../script.js', import.meta.url), 'utf8')
const cobaltSource = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8')
const financeSource = fs.readFileSync(new URL('../../finance.js', import.meta.url), 'utf8')

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} 함수를 찾을 수 없음`)
  const paramsOpen = source.indexOf('(', start)
  let parens = 0
  let paramsClose = -1
  for (let i = paramsOpen; i < source.length; i++) {
    if (source[i] === '(') parens++
    if (source[i] === ')' && --parens === 0) { paramsClose = i; break }
  }
  assert.notEqual(paramsClose, -1, `${name} 함수의 매개변수 괄호를 닫을 수 없음`)
  const open = source.indexOf('{', paramsClose)
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

// HTML 이스케이퍼 자체가 태그·속성·인라인 이벤트 경계를 모두 무력화한다.
const escapeContext = {}
vm.createContext(escapeContext)
vm.runInContext([
  extractFunction(scriptSource, '_cfEsc'),
  extractFunction(scriptSource, 'holdingsEsc'),
  extractFunction(cobaltSource, 'cbEsc'),
].join('\n'), escapeContext)
const payload = `<img src=x onerror="alert('xss')">&'`
for (const name of ['_cfEsc', 'holdingsEsc', 'cbEsc']) {
  const escaped = escapeContext[name](payload)
  assert.doesNotMatch(escaped, /[<>"']/, `${name}는 HTML/속성 경계 문자를 남기지 않음`)
  assert.match(escaped, /&lt;img/, `${name}는 태그 시작을 엔티티로 변환`)
  assert.match(escaped, /&quot;|&#39;/, `${name}는 따옴표를 엔티티로 변환`)
}

// Cobalt 대시보드 키는 JS 문자열에 삽입하지 않고 data 속성에서 읽는다.
assert.doesNotMatch(cobaltSource, /cbDashPick\(\s*['"`]\s*\$\{/, '대시보드 키를 동적 인라인 JS 문자열에 삽입하지 않음')
assert.match(cobaltSource, /data-dash-key="\$\{cbEsc\(r\.key\)\}"/, '대시보드 키는 이스케이프된 data 속성에 보관')
assert.match(cobaltSource, /cbDashPick\(this\.dataset\.dashKey\)/, '대시보드 클릭은 DOM dataset을 통해 전달')

// 재무 목표 ID도 동일하게 data 속성을 사용해 따옴표 탈출 경로를 차단한다.
assert.doesNotMatch(financeSource, /finGoal(?:Edit|Delete)\(\s*['"`]\s*\$\{/, '재무 목표 ID를 동적 인라인 JS 문자열에 삽입하지 않음')
assert.match(financeSource, /data-id="\$\{safeId\}" onclick="finGoalEdit\(this\.dataset\.id\)"/, '재무 목표 수정 ID는 dataset으로 전달')
assert.match(financeSource, /data-id="\$\{safeId\}" onclick="finGoalDelete\(this\.dataset\.id\)"/, '재무 목표 삭제 ID는 dataset으로 전달')

// 원격/로컬 저장소에서 들어오는 문자열을 사용하는 주요 innerHTML 렌더러의 방어 계약.
for (const [pattern, message] of [
  [/_cfEsc\(x\.raw\.owner\s*\|\|\s*['"]-['"]\)/, '모바일 버블 소유주'],
  [/_cfEsc\(x\.raw\.name\s*\|\|\s*x\.raw\.tkr/, '모바일 버블 종목명'],
  [/data-bubble-sector="\$\{_cfEsc\(sector\)\}"/, '버블 섹터 data 속성'],
  [/handleBubbleSectorClick\(this\.dataset\.bubbleSector\)/, '버블 섹터 클릭 전달'],
  [/_cfEsc\(_bubbleLeafLabel\(i\)\)/, '버블 종목명'],
  [/_cfEsc\(d\.tkr\)/, 'Plotly 티커'],
]) assert.match(scriptSource, pattern, `${message}은 HTML 삽입 전에 이스케이프`)

// DCA·배당·계좌·집중도 렌더러는 레거시 뷰(view-dashboard/analysis/target_rebal)에서
// Cobalt 페이지로 옮겨갔다. 방어 계약도 살아있는 렌더러 쪽에서 지킨다.
for (const [pattern, message] of [
  [/cbEsc\([^)]*owner/, 'Cobalt 소유주'],
  [/cbEsc\([^)]*\.name/, 'Cobalt 종목명'],
  [/cbEsc\([^)]*tkr/, 'Cobalt 티커'],
  [/cbEsc\([^)]*acc/, 'Cobalt 계좌명'],
  [/cbEsc\([^)]*[Cc]ycle/, 'Cobalt 주기'],
  [/cbEsc\([^)]*memo/, 'Cobalt 메모'],
]) assert.match(cobaltSource, pattern, `${message}은 HTML 삽입 전에 이스케이프`)
// 사용자 문자열을 이스케이프 없이 템플릿에 그대로 넣지 않는다.
assert.doesNotMatch(cobaltSource, /\$\{(?!cb|_)[a-zA-Z_][\w.]*\.(?:name|tkr|memo)\}/,
  'Cobalt 템플릿에 저장소 문자열 원문 삽입 금지')

assert.match(scriptSource, /document\.createElement\(['"]option['"]\)[\s\S]*option\.textContent=[\s\S]*replaceChildren\(\.\.\.options\)/, 'DRIP 종목 옵션은 DOM textContent로 생성')
assert.match(scriptSource, /safeId=Number\.isSafeInteger\(Number\(at\.id\)\)/, '자동이체 ID는 인라인 핸들러 삽입 전 안전한 숫자로 제한')

// 저장소 경계에서 모든 주요 레코드 유형을 정규화해야 한다.
for (const name of ['_normalizeCfRows', '_normalizeAutoTransfers', '_normalizeMonthlyPLRows', 'fixAssetCurrencies']) {
  assert.match(scriptSource, new RegExp(`function\\s+${name}\\s*\\(`), `${name} 정규화 함수가 존재`)
}
assert.match(scriptSource, /localStorage\.getItem\(['"]cfData['"]\)[\s\S]{0,180}_normalizeCfRows\(/, '로컬 현금흐름 데이터도 사용 전에 정규화')
assert.match(scriptSource, /localStorage\.getItem\(['"]autoTransferData['"]\)[\s\S]{0,180}_normalizeAutoTransfers\(/, '로컬 자동이체 데이터도 사용 전에 정규화')
assert.match(scriptSource, /localStorage\.getItem\(['"]monthlyPLData['"]\)[\s\S]{0,180}_normalizeMonthlyPLRows\(/, '로컬 월별 손익 데이터도 사용 전에 정규화')
assert.match(scriptSource, /monthlyPLData\s*=\s*_normalizeMonthlyPLRows\(normalized\.monthlyPLData\)/, '원격 월별 손익 데이터도 사용 전에 정규화')
assert.match(scriptSource, /cfData\s*=\s*_normalizeCfRows\(normalized\.cfData\)/, '원격 현금흐름 데이터도 사용 전에 정규화')
assert.match(scriptSource, /autoTransferData\s*=\s*_normalizeAutoTransfers\(normalized\.autoTransferData\)/, '원격 자동이체 데이터도 사용 전에 정규화')

// 저장소 정규화는 단순 존재 확인에 그치지 않고 악성/비정상 레코드도 안전한 값으로 축소한다.
const normalizeContext = { OWNERS:['본인','아내','자녀1','아버지'], Date, Set, Number, String, Array, Math }
vm.createContext(normalizeContext)
for (const name of [
  '_boundedStoredText', '_safeStoredNumber', '_safeStoredId', '_isStoredDateKey',
  '_safeStoredToken', '_normalizeStoredOwner', '_normalizeCfRows', '_normalizeAutoTransfers', '_normalizeMonthlyPLRows', '_normalizeGiftActual',
]) vm.runInContext(extractFunction(scriptSource, name), normalizeContext)

const storedPayload = `<img src=x onerror="alert('stored')">\u0000`.repeat(20)
const [cashFlow] = normalizeContext._normalizeCfRows([{
  date:'2026-13-40', type:'임의', cat:storedPayload, desc:storedPayload,
  amt:Infinity, owner:storedPayload, atId:`1);alert(1)//`, scheduleMonth:'2026-99',
}])
assert.equal(cashFlow.date, '미정', '유효하지 않은 현금흐름 날짜는 미정으로 축소')
assert.equal(cashFlow.type, '지출', '허용되지 않은 현금흐름 유형은 안전한 기본값으로 축소')
assert.equal(cashFlow.owner, '미지정', '허용되지 않은 소유주는 미지정으로 축소')
assert.equal(cashFlow.amt, 0, '비유한 금액은 0으로 축소')
assert.doesNotMatch(cashFlow.cat + cashFlow.desc, /[<>\u0000-\u001f\u007f]/, '저장 문자열에서 태그·제어문자를 제거')
assert.ok(cashFlow.desc.length <= 240, '저장 문자열 길이를 제한')
assert.equal('atId' in cashFlow, false, '문자열 주입형 자동이체 ID를 폐기')

const [transfer] = normalizeContext._normalizeAutoTransfers([{
  id:7, owner:storedPayload, type:'임의', cat:storedPayload, desc:storedPayload,
  amt:'1e999', cycle:'javascript:alert(1)', dayOfMonth:99, dayOfWeek:-5,
  amountChanges:[{from:'bad', amt:100}, {from:'2026-09', amt:Infinity}],
  skipMonths:['bad','2026-09','2026-09'],
}])
assert.equal(transfer.id, 7, '안전한 정수 ID는 보존')
assert.equal(transfer.owner, '미지정', '자동이체 소유주 allow-list 적용')
assert.equal(transfer.cycle, 'monthly', '자동이체 주기 allow-list 적용')
assert.equal(transfer.dayOfMonth, 31, '월 일자는 유효 범위로 제한')
assert.equal(transfer.dayOfWeek, 0, '요일은 유효 범위로 제한')
assert.deepEqual(Array.from(transfer.skipMonths), ['2026-09'], '건너뛰기 월은 유효한 고유 값만 보존')
assert.equal(transfer.amountChanges.length, 1, '금액 변경 이력은 유효한 월만 보존')
assert.equal(transfer.amountChanges[0].amt, 0, '변경 금액도 비유한 값을 거부')
assert.equal(normalizeContext._normalizeAutoTransfers([{id:`7);alert(1)//`}]).length, 0, '문자열 주입형 자동이체 ID 레코드는 폐기')

const monthly = normalizeContext._normalizeMonthlyPLRows([
  {id:9, month:'2026-08', amt:'1e99', memo:storedPayload, owner:storedPayload, category:'임의'},
  {id:10, month:'2026-44', amt:1},
])
assert.equal(monthly.length, 1, '월별 손익은 유효한 월 레코드만 보존')
assert.equal(monthly[0].amt, 1_000_000_000_000, '월별 손익 금액 상한 적용')
assert.equal(monthly[0].owner, '', '월별 손익의 잘못된 소유주는 특정 납세자로 꾸미지 않고 미지정 상태로 보존')
assert.equal(monthly[0].category, 'foreign', '월별 손익 분류 allow-list 적용')
assert.equal(monthly[0].account, '일반', '월별 손익 계좌 allow-list의 안전한 기본값 적용')
assert.doesNotMatch(monthly[0].memo, /[<>\u0000-\u001f\u007f]/, '월별 손익 메모에서 태그·제어문자를 제거')
const [isaMonthly] = normalizeContext._normalizeMonthlyPLRows([{id:11,month:'2026-08',amt:1,owner:'본인',category:'domestic',account:'ISA',ruleSetId:'kr-tax-gift-2026.3'}])
assert.equal(isaMonthly.account, 'ISA', '저장·재로드 후 ISA 계좌 분류 보존')
assert.equal(isaMonthly.ruleSetId, 'kr-tax-gift-2026.3', '계산에 사용한 규칙 버전 보존')

const unknownGift = normalizeContext._normalizeGiftActual({childPrior:{confirmed:true,asOf:'2026-08-28'}})
assert.equal(unknownGift.childPrior.amountKnown, false, '증여 실제 합계 미입력은 0원으로 꾸미지 않음')
assert.equal('amount' in unknownGift.childPrior, false, '미입력 증여 합계 필드를 생성하지 않음')
const zeroGift = normalizeContext._normalizeGiftActual({childPrior:{confirmed:true,asOf:'2026-08-28',amount:0,amountKnown:true}})
assert.equal(zeroGift.childPrior.amountKnown, true, '사용자가 명시한 0원은 확인된 금액으로 보존')
assert.equal(zeroGift.childPrior.amount, 0, '명시적 0원 왕복 보존')

const assetContext = {
  OWNERS:normalizeContext.OWNERS,
  KNOWN_US_TICKERS:new Set(['NVDA']),
  _KR_CODE_RE:/^[0-9A-Z]{6}$/i,
  normTkr:value=>String(value || '').replace(/\.(KS|KQ)$/i,'').toUpperCase(),
  Date, Set, Number, String, Array, Math,
}
vm.createContext(assetContext)
for (const name of ['_boundedStoredText', '_safeStoredNumber', '_isStoredDateKey', '_normalizeStoredOwner', 'fixAssetCurrencies']) {
  vm.runInContext(extractFunction(scriptSource, name), assetContext)
}
const [asset] = assetContext.fixAssetCurrencies([{
  grp:'주식', owner:storedPayload, broker:storedPayload, acc:storedPayload,
  name:storedPayload, tkr:`NVDA\"><img src=x onerror=alert(1)>`, cur:'BAD',
  qty:Infinity, avgP:-2, curP:'1e999', dca:true, dcaMode:'bad', dcaAmt:-4,
  dcaQty:Infinity, dcaCur:'BAD', dcaCycle:'<img>', dcaDays:[-1,1,9], dcaDay:99,
}])
assert.equal(asset.owner, '미지정', '자산 소유주 allow-list 적용')
assert.match(asset.tkr, /^[A-Z0-9.^=_-]*$/, '자산 티커를 허용 문자로 제한')
assert.doesNotMatch(asset.name + asset.broker + asset.acc, /[<>\u0000-\u001f\u007f]/, '자산 문자열에서 태그·제어문자를 제거')
assert.ok(['USD','JPY','KRW'].includes(asset.cur), '자산 통화 allow-list 적용')
for (const field of ['qty','avgP','curP','dcaAmt','dcaQty']) {
  assert.ok(Number.isFinite(asset[field]) && asset[field] >= 0, `${field}는 유한한 음수 아닌 값으로 제한`)
}
assert.ok(['amount','qty'].includes(asset.dcaMode), 'DCA 입력 모드 allow-list 적용')
assert.ok(['매일','매주','매월'].includes(asset.dcaCycle), 'DCA 주기 allow-list 적용')
assert.deepEqual(Array.from(asset.dcaDays), [1], 'DCA 요일은 0~6 범위만 보존')
assert.equal(asset.dcaDay, 31, 'DCA 월 일자는 1~31 범위로 제한')

assert.doesNotMatch(scriptSource, /donut-acc-title['"]\)\.innerHTML=`[^`]*\$\{label\}/, '계좌 도넛 라벨을 innerHTML에 원문 삽입하지 않음')

console.log('PASS: 저장형 XSS 렌더링·식별자 전달·저장소 정규화 계약')
