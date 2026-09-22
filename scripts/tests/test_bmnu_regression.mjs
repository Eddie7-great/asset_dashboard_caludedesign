#!/usr/bin/env node
// BMNU(T-REX 2X Long BMNR) 회귀: 합성 ETF 인식과 시세 미조회 종목의 순위 제외 표식.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../cobalt.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수를 찾을 수 없음`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`${name} 함수 닫는 괄호를 찾을 수 없음`);
}

function extractConst(name) {
  const re = new RegExp(`const ${name} = [\\s\\S]*?;\\n`);
  const m = source.match(re);
  assert.ok(m, `${name} 상수를 찾을 수 없음`);
  return m[0];
}

const ctx = vm.createContext({ console, window: {} });
vm.runInContext(extractFunction('cbStrip'), ctx);
vm.runInContext(extractConst('CB_SINGLE_STOCK_LEV_ISSUER'), ctx);
vm.runInContext(extractConst('CB_NOT_SINGLE_STOCK'), ctx);
vm.runInContext(extractFunction('cbSyntheticEtfHoldings'), ctx);
vm.runInContext(extractFunction('cbIsEtf'), ctx);
vm.runInContext(extractFunction('cbRowPriceStale'), ctx);

// ── cbIsEtf: 구성종목 수집이 실패한 단일종목 레버리지 ETF도 ETF로 인식한다 ──
{
  const bmnu = { grp:'주식', tkr:'BMNU', name:'T-REX 2X Long BMNR Daily Target', market:'', marketType:'', type:'' };
  assert.equal(ctx.cbIsEtf(bmnu), true,
    'market/marketType/type에 ETF가 없고 _etfHoldings.etfs에도 없어도 상품명으로 합성 해석되면 ETF로 인식해야 한다');

  const plainStock = { grp:'주식', tkr:'AAPL', name:'Apple Inc.', market:'', marketType:'', type:'' };
  assert.equal(ctx.cbIsEtf(plainStock), false, '일반 개별주는 여전히 ETF가 아니다');
  console.log('PASS cbIsEtf: 합성 단일종목 ETF(BMNU) 인식, 일반 개별주는 그대로 아님');
}

// ── cbRowPriceStale: 시세 미조회 표식 전파 ────────────────────────
{
  const staleRow = { i: { _priceStale: true } };
  const freshRow = { i: { _priceStale: false } };
  const mergedWithStale = { _items: [{ _priceStale: false }, { _priceStale: true }] };
  const mergedFresh = { _items: [{ _priceStale: false }, { _priceStale: false }] };
  assert.equal(ctx.cbRowPriceStale(staleRow), true);
  assert.equal(ctx.cbRowPriceStale(freshRow), false);
  assert.equal(ctx.cbRowPriceStale(mergedWithStale), true, '병합 행은 원본 중 하나라도 미조회면 미조회다');
  assert.equal(ctx.cbRowPriceStale(mergedFresh), false);
  console.log('PASS cbRowPriceStale: 단일/병합 행의 시세 미조회 판정');
}

console.log('PASS: BMNU 회귀 — 합성 ETF 인식 및 시세 미조회 표식 전파');
