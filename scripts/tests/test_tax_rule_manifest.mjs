#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const rulesSource = fs.readFileSync(new URL('../../tax-rules.js', import.meta.url), 'utf8')
const scriptSource = fs.readFileSync(new URL('../../script.js', import.meta.url), 'utf8')
const cobaltSource = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8')
const indexSource = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const workflowSource = fs.readFileSync(new URL('../../.github/workflows/tax-rule-watch.yml', import.meta.url), 'utf8')
const checkerSource = fs.readFileSync(new URL('../check-tax-rule-sources.mjs', import.meta.url), 'utf8')

const context = { Date, Intl, Map, Object }
vm.createContext(context)
vm.runInContext(rulesSource, context)
const manifest = context.ASSET_TAX_RULES

assert.equal(manifest.schemaVersion, 1, '규칙 스키마 버전')
assert.equal(manifest.manifestVersion, 'kr-tax-gift-2026.3', '현재 규칙 버전')
assert.equal(Object.isFrozen(manifest), true, '런타임에서 규칙 매니페스트 변경 금지')
assert.equal(Object.isFrozen(manifest.periods[2].values.gift), true, '중첩 규칙 값도 변경 금지')

const ids = manifest.sources.map(source => source.id)
assert.equal(new Set(ids).size, ids.length, '공식 출처 ID 중복 없음')
assert.equal(manifest.sources.every(source => /^https:\/\/(?:www\.)?(?:law\.go\.kr|nts\.go\.kr)\//.test(source.url)), true, '공식 도메인만 사용')
assert.equal(manifest.sources.every(source => Array.isArray(source.expected) && source.expected.length), true, '모든 출처에 변경 감시 문구 존재')

const current = context.assetTaxRulesFor(2026)
assert.equal(current.id, 'kr-tax-gift-2026.3', '2026년 규칙 선택')
assert.equal(context.assetTaxRuleValue('capitalGains.kospiTotalTransactionRate', null, 2024), 0.0018, '2024 KOSPI 총 부담 0.18%')
assert.equal(context.assetTaxRuleValue('capitalGains.kospiTotalTransactionRate', null, 2025), 0.0015, '2025 KOSPI 총 부담 0.15%')
assert.equal(context.assetTaxRuleValue('capitalGains.kospiTotalTransactionRate', null, 2026), 0.002, '2026 KOSPI 총 부담 0.20%')
assert.equal(context.assetTaxRuleValue('capitalGains.kosdaqTotalTransactionRate', null, 2026), 0.002, '2026 KOSDAQ 거래세 0.20%')
assert.equal(context.assetTaxRuleValue('gift.annuityDiscountRate', null, 2026), 0.03, '유기정기금 법정 할인율 3%')
assert.equal(context.assetTaxRuleValue('dividend.highDividendSeparateTaxActive', null, 2026), true, '2026 고배당 특례 활성 기간')
assert.equal(context.assetTaxRuleValue('dividend.highDividendSeparateTaxActive', null, 2024), false, '2024 고배당 특례 미적용')
assert.match(context.assetTaxRuleValue('gift.otherRelativeScope', '', 2025), /2025-03-14 전[\s\S]*이후/, '2025년 중 친족 범위 변경 기록')

assert.equal(context.assetTaxRuleStatus(2026, new Date('2026-08-31T00:00:00+09:00')).state, 'verified', '검토기한 전 공식 근거 확인 상태')
assert.equal(context.assetTaxRuleStatus(2026, new Date('2026-10-01T00:00:00+09:00')).state, 'stale', '검토기한 초과 시 확인 필요')
assert.equal(context.assetTaxRuleStatus(2025, new Date('2026-08-31T00:00:00+09:00')).state, 'historical', '과거 연도는 현재 규칙으로 오인하지 않음')
assert.equal(context.assetTaxRuleStatus(2027, new Date('2027-01-01T00:00:00+09:00')).state, 'unsupported', '검증하지 않은 미래 연도 미지원')

const taxHtml = context.assetTaxRuleDisclosureHtml('capitalGains', 2026)
assert.match(taxHtml, /2026년 적용[\s\S]*kr-tax-gift-2026\.3/, '적용 연도와 규칙 버전 표시')
assert.match(taxHtml, /계산에 적용[\s\S]*계산 가정[\s\S]*제외·주의[\s\S]*공식 기준 출처/, '값·가정·제외·공식 출처를 한 패널에 표시')
assert.match(taxHtml, /KOSPI·KOSDAQ 장내 매도 부담 참고 0\.2%/, '2026 거래세 표시 보정')
assert.match(taxHtml, /target="_blank" rel="noopener noreferrer"/, '공식 출처 새 창 링크 보호')
const divHtml = context.assetTaxRuleDisclosureHtml('dividend', 2026)
assert.match(divHtml, /ISA 유지기간 정산[\s\S]*연간 현금흐름 근사/, 'ISA 한도를 연간 법정 공제로 오인하지 않게 표시')
assert.match(divHtml, /해외 배당의 현지 원천징수/, '해외 배당 계산 제외 표시')
const giftHtml = context.assetTaxRuleDisclosureHtml('gift', 2026)
assert.match(giftHtml, /증여재산공제 사용액[\s\S]*증여세 과세가액 합산/, '공제 사용과 과세가액 합산 규칙 구분')
assert.match(giftHtml, /혼인 신고일 전후 2년[\s\S]*출생·입양일 이후 2년/, '혼인·출산 공제 기간 방향 구분')

assert.ok(indexSource.indexOf('tax-rules.js') < indexSource.indexOf('script.js'), '규칙을 계산 엔진보다 먼저 로드')
assert.equal((cobaltSource.match(/assetTaxRuleDisclosureHtml\('/g) || []).length >= 3, true, '배당·양도소득·증여 화면에 규칙 패널 연결')
assert.match(scriptSource, /ruleSetId=typeof assetTaxRulesFor/, '실현손익 기록에 적용 규칙 버전 저장')
assert.doesNotMatch(cobaltSource, /매도액 0\.15%/, '2026 거래세 구버전 문구 제거')
assert.match(cobaltSource, /ISA 계좌[\s\S]*만기 정산 전 연간 참고/, 'ISA 카드 자체에도 연간 참고임을 표시')
assert.match(cobaltSource, /법정 할인율\(%\)[\s\S]*readonly aria-readonly="true"/, '법정 정기금 할인율 임의 변경 방지')

assert.match(checkerSource, /ALLOWED_HOSTS[\s\S]*MAX_BYTES[\s\S]*redirect: 'manual'/, '공식 출처 점검의 SSRF·응답 크기·리다이렉트 방어')
assert.match(workflowSource, /schedule:[\s\S]*cron:[\s\S]*issues: write[\s\S]*tax-rule-watch/, '매일 점검과 검토 이슈 자동 관리')
assert.doesNotMatch(workflowSource, /pull_request:/, '외부 네트워크·이슈 권한 워크플로를 PR 코드로 실행하지 않음')

console.log('PASS: 세금·증여 규칙 버전·출처·가정·제외·최신성 감시 계약')
