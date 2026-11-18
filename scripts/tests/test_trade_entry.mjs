#!/usr/bin/env node
// 매수·매도 입력 — 보유 목록의 종목명을 누르면 수량·평균단가를 바꾸고, 주식 매도는 실현손익 기록에 남긴다.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const scriptSource = fs.readFileSync(new URL('../../script.js', import.meta.url), 'utf8')
const indexSource = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const styleSource = fs.readFileSync(new URL('../../style.css', import.meta.url), 'utf8')
const workspaceSource = fs.readFileSync(new URL('../../workspace-ui.css', import.meta.url), 'utf8')
const cobaltSource = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8')

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} 함수를 찾을 수 없음`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1) }
  }
  throw new Error(`${name} 함수의 닫는 괄호를 찾을 수 없음`)
}

const ctx = {
  OWNERS: ['본인', '아내', '자녀1', '아버지'],
  _taxRuleValue: (_k, fallback) => fallback,
  assetTaxRulesFor: year => ({ id: `rules-${year}` }),
}
vm.createContext(ctx)
vm.runInContext(extractFunction(scriptSource, 'getAccountDivTaxInfo'), ctx)
vm.runInContext(extractFunction(scriptSource, 'tradeApplyPlan'), ctx)
const plan = (item, t) => ctx.tradeApplyPlan(item, { today: '2026-11-17', date: '2026-11-17', ...t })

const kr = { grp: '주식', owner: '본인', acc: 'ISA', name: '삼성전자', tkr: '005930', qty: 120, avgP: 71000, cur: 'KRW', unit: '주' }
const us = { grp: '주식', owner: '아내', acc: '일반', name: 'NVIDIA', tkr: 'NVDA', qty: 40, avgP: 95, cur: 'USD', unit: '주' }
const btc = { grp: '가상화폐', owner: '본인', acc: '일반', name: '비트코인', tkr: 'BTC', qty: 0.21, avgP: 98000000, cur: 'USD', unit: '개' }
const gold = { grp: '금', owner: '아버지', acc: '금현물', name: '금', tkr: 'GOLD_1', qty: 37.5, avgP: 0, costUnknown: true, cur: 'KRW', unit: 'g' }

// ── 매수: 수량을 더하고 평균단가는 가중평균 ─────────────────────
const buy = plan(kr, { side: 'buy', qty: 30, price: 80000 })
assert.equal(buy.ok, true)
assert.equal(buy.next.qty, 150, '매수 수량을 더한다')
assert.equal(buy.next.avgP, 72800, '평균단가 = (120×71000 + 30×80000) ÷ 150')
assert.equal(buy.pl, null, '매수는 실현손익 기록을 만들지 않는다')
assert.equal(plan(kr, { side: 'buy', qty: 30 }).ok, false, '매수는 단가가 필수')
assert.equal(plan(kr, { side: 'buy', qty: 0, price: 1 }).ok, false, '수량 0 거부')
assert.equal(plan(kr, { side: 'buy', qty: 1, price: 1, date: '2026-11-18' }).ok, false, '미래 날짜 거부')
assert.equal(plan(gold, { side: 'buy', qty: 1, price: 180000 }).ok, false, '취득가 미상 자산은 평균을 낼 수 없어 매수 입력을 받지 않는다')
assert.equal(plan({ ...kr, grp: '현금' }, { side: 'buy', qty: 1, price: 1 }).ok, false, '현금은 대상이 아니다')

// ── 매도(국내): 평균단가 유지, 손익 = (매도가 − 평균단가) × 수량 ──
const sell = plan(kr, { side: 'sell', qty: 50, price: 90000, id: 77 })
assert.equal(sell.next.qty, 70)
assert.equal(sell.next.avgP, 71000, '매도는 평균단가를 바꾸지 않는다')
assert.deepEqual(JSON.parse(JSON.stringify(sell.pl)), { id: 77, month: '2026-11', amt: 950000, memo: '삼성전자 50주 매도 @90,000', owner: '본인', category: 'domestic', account: 'ISA', ruleSetId: 'rules-2026' },
  '국내 매도는 계좌 세제 구분·규칙 버전과 함께 실현손익 기록을 만든다')
assert.equal(plan(kr, { side: 'sell', qty: 50, price: 90000, realizedKrw: '900000' }).pl.amt, 900000, '사용자가 고친 실현손익이 계산값보다 우선')
assert.equal(plan({ ...kr, acc: '연금저축' }, { side: 'sell', qty: 1, price: 80000 }).pl.account, '연금저축')
assert.equal(plan(kr, { side: 'sell', qty: 121, price: 90000 }).ok, false, '보유 수량 초과 매도 거부')
assert.equal(plan(kr, { side: 'sell', qty: 10 }).ok, false, '국내 매도는 단가나 실현손익 중 하나가 필요')
assert.equal(plan(kr, { side: 'sell', qty: 10, price: 80000, date: '2025-12-30' }).pl.month, '2025-12', '귀속 월은 거래일을 따른다')
assert.equal(plan(kr, { side: 'sell', qty: 10, price: 80000, date: '2025-12-30' }).pl.ruleSetId, 'rules-2025', '규칙 버전은 거래 연도를 따른다')

// ── 매도(해외): 자동 계산하지 않는다 — 원화 실현손익 직접 입력 필수 ──
assert.equal(plan(us, { side: 'sell', qty: 10, price: 150 }).ok, false, '해외 매도는 단가만으로 실현손익을 지어내지 않는다')
const usSell = plan(us, { side: 'sell', qty: 10, price: 150, realizedKrw: '-123456' })
assert.equal(usSell.pl.amt, -123456)
assert.equal(usSell.pl.category, 'foreign')
assert.equal(usSell.pl.account, '일반', '해외주식은 일반 계좌')
assert.equal(usSell.next.qty, 30)

// ── 전량 매도·가상화폐·금 ───────────────────────────────────────
const all = plan(btc, { side: 'sell', qty: 0.21 })
assert.equal(all.ok, true)
assert.equal(all.remove, true, '전량 매도는 행 삭제 대상')
assert.equal(all.pl, null, '가상화폐 매도는 주식 양도세 화면에 넣지 않는다')
assert.equal(plan(gold, { side: 'sell', qty: 7.5 }).pl, null, '금 매도도 실현손익 기록을 만들지 않는다')
assert.equal(plan(gold, { side: 'sell', qty: 7.5 }).next.qty, 30)

// ── 화면 연결 ───────────────────────────────────────────────────
assert.match(scriptSource, /class="holdings-inline-name holdings-trade-link"[^`]*role="button" tabindex="0"[^`]*onclick="openTradeModal\(\$\{tradeIdx\}\)"/, '종목명이 매수·매도 입력을 연다')
assert.doesNotMatch(scriptSource, /holdings-trade-link[^`]*onkeydown/, 'Enter·Space 는 문서 위임이 처리한다')
assert.equal((scriptSource.match(/getHoldingsAssetCellHtml\([^\n]*?,pIdx\)/g) || []).length, 3, '주식·가상화폐·금 행만 연결하고 현금은 연결하지 않는다')
assert.match(scriptSource, /function openTradeModal\(idx\)\{\s*if\(isMobileLayout\(\)\) return;/, '휴대폰은 조회 전용')
assert.match(scriptSource, /function submitTrade\(\)\{[\s\S]*_kvLoadState\?\.assets!=='ready'\|\|window\._kvLoadState\?\.ext!=='ready'[\s\S]*tradeApplyPlan\(item,_tradeInput\(\)\)[\s\S]*splitCheckedAt:_cfLocalDateKey\(new Date\(\)\)[\s\S]*monthlyPLData\.push\(plan\.pl\);saveMonthlyPL\(\);[\s\S]*saveAssetsToKV\(\);/,
  '두 원장을 모두 불러온 뒤에만 저장하고, 분할 기준일을 오늘로 찍고, 실현손익과 자산을 함께 저장한다')
assert.doesNotMatch(extractFunction(scriptSource, 'submitTrade'), /현금|예수금/, '예수금은 연동하지 않는다')
assert.match(indexSource, /id="trade-modal"[\s\S]*id="trade-side-buy" aria-pressed="true"[\s\S]*id="trade-date"[\s\S]*id="trade-qty"[\s\S]*id="trade-price"[\s\S]*id="trade-pl"[\s\S]*onclick="submitTrade\(\)"/, '매수·매도 입력 창')
assert.match(scriptSource, /closeAddModal\(\);\s*closeTradeModal\(\);/, 'Esc 로 닫힌다')

// ── 다크 테마에서 보이지 않던 것들 ─────────────────────────────
assert.match(styleSource, /\.btn-action\{[^}]*color:var\(--mut\)/, '관리 버튼은 글자색을 정한다 — 안 정하면 버튼 기본색(검정)이라 다크에서 안 보인다')
assert.match(workspaceSource, /:where\(a\)\{color:var\(--acc\)\}/, '색을 정하지 않은 링크도 테마 강조색을 쓴다')
assert.match(workspaceSource, /\.fin-ice-seg\.l3\{color:var\(--on-acc\)/, '계좌 막대 글자는 바탕(강조색) 위 글자 토큰')
assert.doesNotMatch(scriptSource, /ticks:\{font:\{size:(9|10|11)\}/, '차트 눈금 글자도 12px 아래로 내려가지 않는다')
const dark = styleSource.slice(styleSource.indexOf('--t1:#e7e9ee'), styleSource.indexOf('--t1:#e7e9ee') + 60)
assert.match(dark, /--t2:#c2c8d2;--t3:#a9b0bc/, '다크 테마의 보조 글자(축 눈금·캡션)는 배경 대비를 높인 값')

console.log('test_trade_entry: ok')
// 2026-11-18 3차: 창 바깥(어두운 바탕)을 누르면 닫힌다 — 안에서 누른 채 끌고 나온 경우는 닫지 않는다
assert.match(scriptSource, /e\.target\.id==='trade-modal'&&_tradeDownOutside\)closeTradeModal\(\)/, '매수·매도 창은 바깥을 누르면 닫힌다(안에서 끌고 나온 경우 제외)')
// 2026-11-18 3차: 실현손익 ↔ 보유 연동
{
  const stock = { grp: '주식', owner: '본인', acc: '일반', cur: 'KRW', qty: 10, avgP: 1000, name: 'SK스퀘어', tkr: '402340.KS' }
  const skipped = plan(stock, { side: 'sell', qty: 4, skipPl: true })
  assert.equal(skipped.ok, true, '이미 기록한 매도는 단가·손익 없이도 수량만 줄인다')
  assert.equal(skipped.pl, null, '실현손익 줄을 새로 만들지 않는다(중복 방지)')
  assert.equal(skipped.next.qty, 6)
  assert.equal(skipped.next.avgP, 1000, '평균단가는 그대로')
  assert.equal(plan(stock, { side: 'sell', qty: 11, skipPl: true }).ok, false, '보유보다 많이 팔 수 없다')
  vm.runInContext(extractFunction(scriptSource, 'tradeExistingPlRows'), ctx)
  const rows = [{ owner: '본인', memo: 'SK스퀘어 10주 매도' }, { owner: '아내', memo: 'SK스퀘어 매도' }, { owner: '본인', memo: '402340 일부 매도' }, { owner: '본인', memo: '삼성전자 매도' }]
  assert.equal(ctx.tradeExistingPlRows(stock, rows).length, 2, '같은 소유주 · 메모에 종목명이나 티커가 있는 줄만 안내')
  assert.match(indexSource, /id="trade-pl-skip"[^>]*>\s*실현손익은 이미 기록함/, '매도 창에 이미 기록함 선택')
  assert.match(cobaltSource, /id="cb-tax-hold"[\s\S]*id="cb-tax-hold-qty"/, '실현손익 입력 줄에 보유 반영(종목·수량)')
  assert.match(cobaltSource, /tradeApplyPlan\(item,\{side:'sell',qty,date:finLocalDateKey\(new Date\(\)\),today:finLocalDateKey\(new Date\(\)\),skipPl:true\}\)/, '보유 반영은 매도 창과 같은 계산(새 실현손익 줄 없음)')
}
