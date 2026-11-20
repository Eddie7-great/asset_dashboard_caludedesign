// 적립식 설정 창(2026-11-20) — 보유 목록 적립식 칸과 적립식 매수 화면이 같은 상태 한 벌(dcaState)·같은 창(#dca-modal)을 쓴다.
// 예전에는 보유 목록이 dca 플래그만, 적립식 화면이 금액만 봐서 중단한 규칙이 한쪽에서만 보였다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = f => fs.readFileSync(new URL(f, root), 'utf8');
const script = read('script.js'), cobalt = read('cobalt.js'), html = read('index.html'), ws = read('workspace-ui.css');
function grab(src, name) {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} 없음`);
  let i = src.indexOf('{', src.indexOf(')', at)), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(at, i + 1);
}
const labelConst = script.match(/const DCA_STATE_LABEL=\{[^}]*\};/)[0].replace('const ', 'var ');

// ── 상태 한 벌: dca × 규칙 유무 네 조합 ──
const base = vm.createContext({ escHtml: s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`) });
vm.runInContext(labelConst, base);
vm.runInContext(script.slice(script.indexOf('const CURRENCY_META'), script.indexOf('function curRateKnown(')), base);
for (const n of ['dcaHasRule', 'dcaState', 'dcaFractionalUs', 'getDcaCycleLabel', 'getDcaCellHtml', 'getDcaAmountText', 'getDcaAmountCellHtml', 'getDcaMergedCellHtml', 'holdingsEsc']) vm.runInContext(grab(script, n), base);
const rule = { grp: '주식', name: 'Tesla', tkr: 'TSLA', cur: 'USD', qty: 3.25, dcaCycle: '매일', dcaAmt: 10000, dcaCur: 'KRW', dcaMode: 'amount' };
assert.equal(base.dcaState({ ...rule, dca: true }), 'on');
assert.equal(base.dcaState({ ...rule, dca: false }), 'paused', '꺼짐 + 규칙 = 중단(다시 켜면 재개)');
assert.equal(base.dcaState({ ...rule, dca: true, dcaAmt: 0 }), 'incomplete', '켜짐 + 금액 0 = 금액 미입력');
assert.equal(base.dcaState({ ...rule, dca: false, dcaAmt: 0 }), 'none');
assert.equal(base.dcaState({ ...rule, dca: false, dcaAmt: 0, dcaMode: 'qty', dcaQty: 0.5 }), 'paused', '수량 방식도 규칙');
assert.equal(base.dcaFractionalUs({ grp: '주식', cur: 'USD', qty: 3.25 }), true, '소수점 미국 주식 = 모으기');
assert.equal(base.dcaFractionalUs({ grp: '주식', cur: 'USD', qty: 3 }), false);
assert.equal(base.dcaFractionalUs({ grp: '주식', cur: 'KRW', qty: 3.5 }), false);
assert.equal(base.dcaFractionalUs({ grp: '가상화폐', cur: 'USD', qty: 0.1 }), false);

// ── 보유 목록 칸: 중단한 규칙은 드러내지 않고 '—'(2026-11-20 8차, 사용자 결정), 인덱스를 주면 칸 전체가 설정 창 버튼 ──
const paused = base.getDcaMergedCellHtml({ ...rule, dca: false });
assert.equal(paused, base.getDcaMergedCellHtml({ ...rule, dca: false, dcaAmt: 0 }), "중단은 설정 없음과 같은 '—'");
assert.doesNotMatch(paused, /중단|is-paused|₩10,000/, '중단 규칙의 주기·금액을 칸에 적지 않는다');
assert.match(base.getDcaMergedCellHtml({ ...rule, dca: true, dcaAmt: 0 }), /<span class="dca-amount is-missing">금액 미입력<\/span>/);
assert.equal((base.getDcaMergedCellHtml({ ...rule, dca: false, dcaAmt: 0 }).match(/—/g) || []).length, 1, '규칙이 없으면 지금처럼 —(사용자 결정)');
assert.doesNotMatch(paused, /<button/, '인덱스가 없으면(휴대폰 등) 버튼이 아니다');
const btn = base.getDcaMergedCellHtml({ ...rule, dca: false }, 7);
assert.match(btn, /^<button type="button" class="dca-cell-btn" onclick="cbDcaEdit\(7\)" title="적립식 꺼짐 — 눌러서 적립식 설정" aria-label="Tesla 적립식 설정 · 꺼짐">/, '눌러서 설정 창을 열면 저장된 규칙이 채워져 켜기만 하면 재개된다');
assert.match(base.getDcaMergedCellHtml({ ...rule, dca: false, dcaAmt: 0 }, 2), /aria-label="Tesla 적립식 설정 · 설정 없음">/, '규칙이 없어도 눌러서 만들 수 있다');
assert.doesNotMatch(base.getDcaMergedCellHtml({ grp: '현금', dca: false }, 3), /<button/, '현금은 적립식 대상이 아니다');
assert.equal((script.match(/<td class="dca-cell">\$\{getDcaMergedCellHtml\(i,_mobileHoldings\?null:pIdx\)\}<\/td>/g) || []).length, 3, '주식·가상화폐·금 표가 모두 인덱스를 넘긴다(휴대폰 제외)');

// ── 설정 창: 기본값·검사·저장 ──
const start = cobalt.indexOf('let _dcaBusy=false;');
const end = cobalt.indexOf('// 창 바깥(어두운 바탕)을 누르면 닫는다 — 안에서 누른 채 끌고 나온 경우는 닫지 않는다(매수·매도 창과 같은 방식).');
assert.ok(start > 0 && end > start);
function el(id, extra = {}) { const cls = new Set(); const attrs = {}; return { id, value: '', checked: false, hidden: false, textContent: '', innerHTML: '', options: [],
  classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) }, setAttribute: (k, v) => { attrs[k] = String(v); }, getAttribute: k => attrs[k], focus() {}, ...extra }; }
function makeCtx({ items, mobile = false, ready = true, save = async () => ({ ok: true }) }) {
  const ids = ['dca-modal', 'dca-edit-title', 'dca-edit-now', 'dca-edit-day', 'dca-edit-on', 'dca-edit-cycle', 'dca-edit-amt', 'dca-edit-cur', 'dca-edit-qty', 'dca-edit-qty-label',
    'dca-edit-error', 'dca-edit-mode-amount', 'dca-edit-mode-qty', 'dca-edit-amt-wrap', 'dca-edit-qty-wrap', 'dca-edit-day-wrap', 'dca-edit-dows', 'dca-edit-state', 'view-holdings'];
  const els = Object.fromEntries(ids.map(id => [id, el(id)]));
  const dows = [0, 1, 2, 3, 4, 5, 6].map(v => el('dow' + v, { value: String(v) }));
  const calls = { save: 0, render: 0, errors: [] };
  const ctx = vm.createContext({
    pfolioData: items, window: { _kvLoadState: { assets: ready ? 'ready' : 'pending', ext: 'ready' } },
    isMobileLayout: () => mobile, showSaveError: m => calls.errors.push(m), cbRenderDca: () => {}, cbEsc: s => String(s ?? ''),
    saveAssetsToKV: async () => { calls.save++; return save(); }, renderPortfolio: () => { calls.render++; }, currentOwner: '전체',
    requestAnimationFrame: fn => fn(), HTMLElement: function () {},
    document: { getElementById: id => els[id] || null, contains: () => true, activeElement: null,
      querySelectorAll: s => (s === '.dca-edit-dow' ? dows : s === '.dca-edit-dow:checked' ? dows.filter(d => d.checked) : []) },
  });
  vm.runInContext(labelConst, ctx);
  for (const n of ['dcaHasRule', 'dcaState', 'dcaFractionalUs']) vm.runInContext(grab(script, n), ctx);
  vm.runInContext(cobalt.slice(start, end).replace(/^const /gm, 'var ').replace(/^let /gm, 'var '), ctx);
  return { ctx, els, dows, calls };
}
{
  const d = makeCtx({ items: [] }).ctx;
  const fr = d.cbDcaEditDefaults({ grp: '주식', cur: 'USD', qty: 0.37, dca: false, dcaCycle: '매월', dcaAmt: 0 });
  assert.equal(fr.cycle, '매일', '규칙 없는 모으기 종목은 매일 기본값');
  assert.equal(fr.on, true, '새로 만들 때는 켠 상태로 연다');
  assert.equal(fr.amt, '');
  assert.equal(d.cbDcaEditDefaults({ grp: '주식', cur: 'KRW', qty: 10, dca: false, dcaCycle: '매월', dcaAmt: 0 }).cycle, '매월');
  const pz = d.cbDcaEditDefaults({ ...rule, dca: false, dcaCycle: '매주', dcaDays: [1, 3], dcaAmt: 5000 });
  assert.deepEqual([pz.on, pz.cycle, pz.amt, [...pz.days]], [false, '매주', 5000, [1, 3]], '중단 규칙은 저장된 값 그대로(켜기만 하면 재개)');

  const ok = d.cbDcaEditPlan({ on: true, cycle: '매주', mode: 'amount', amt: '10,000', cur: 'KRW', qty: '', days: ['3', '1', '1'], day: 9 });
  assert.equal(ok.ok, true);
  assert.deepEqual(Object.keys(ok.patch).sort(), ['dca', 'dcaAmt', 'dcaCur', 'dcaCycle', 'dcaDay', 'dcaDays', 'dcaMode', 'dcaQty'].sort(), '적립식 필드만');
  assert.deepEqual([...ok.patch.dcaDays], [1, 3]);
  assert.equal(ok.patch.dcaAmt, 10000);
  assert.deepEqual([...d.cbDcaEditPlan({ on: true, cycle: '매일', mode: 'amount', amt: 1000, days: [1] }).patch.dcaDays], [], '매주가 아니면 요일을 비운다');
  assert.match(d.cbDcaEditPlan({ on: true, cycle: '매일', mode: 'amount', amt: '' }).error, /금액을 입력/);
  assert.match(d.cbDcaEditPlan({ on: true, cycle: '매일', mode: 'qty', qty: '0' }).error, /수량을 입력/);
  assert.match(d.cbDcaEditPlan({ on: true, cycle: '매주', mode: 'amount', amt: 10, days: [] }).error, /요일/);
  assert.match(d.cbDcaEditPlan({ on: false, cycle: '매일', mode: 'amount', amt: '-5' }).error, /0 이상/);
  assert.equal(d.cbDcaEditPlan({ on: false, cycle: '매일', mode: 'amount', amt: '' }).ok, true, '꺼 둔 채로는 금액 없이도 저장(규칙 보관)');
}
{ // 저장: 적립식 필드만 바뀌고 수량·평균단가·분할 기준일은 그대로, 보유 목록이 열려 있으면 다시 그린다
  const item = { owner: '본인', grp: '주식', name: 'Tesla', tkr: 'TSLA', broker: '토스증권', acc: '일반', cur: 'USD', qty: 3.25, avgP: 180, splitCheckedAt: '2026-11-01', dca: false, dcaCycle: '매월', dcaAmt: 0 };
  const t = makeCtx({ items: [item] });
  t.els['view-holdings'].classList.add('active');
  t.ctx.cbDcaEdit(0);
  assert.ok(t.els['dca-modal'].classList.contains('active'));
  assert.equal(t.els['dca-edit-cycle'].value, '매일');
  assert.equal(t.els['dca-edit-on'].checked, true);
  assert.equal(t.els['dca-edit-day-wrap'].hidden, true, '매일은 매수일 칸을 숨긴다');
  t.els['dca-edit-amt'].value = '5,000';
  await t.ctx.cbDcaEditSave();
  assert.equal(t.calls.save, 1);
  assert.deepEqual([item.dca, item.dcaCycle, item.dcaAmt, item.dcaCur], [true, '매일', 5000, 'KRW']);
  assert.deepEqual([item.qty, item.avgP, item.splitCheckedAt], [3.25, 180, '2026-11-01'], '수량·평균단가·분할 기준일은 건드리지 않는다');
  assert.equal(t.calls.render, 1, '보유 목록을 다시 그린다');
  assert.ok(!t.els['dca-modal'].classList.contains('active'), '저장하면 닫힌다');
}
{ // 실패: 같은 객체가 남아 있으면(충돌 409 등) 직접 되돌리고, 저장 경로가 목록을 되돌렸으면 건드리지 않는다
  const item = { owner: '본인', grp: '주식', name: 'QQQ', tkr: 'QQQ', cur: 'USD', qty: 2, dca: false, dcaCycle: '매월', dcaDay: 25, dcaAmt: 300000, dcaCur: 'KRW' };
  const items = [item];
  const t = makeCtx({ items, save: async () => ({ ok: false }) });
  t.ctx.cbDcaEdit(0); t.els['dca-edit-on'].checked = true;
  await t.ctx.cbDcaEditSave();
  assert.equal(item.dca, false, '같은 객체면 되돌린다');
  assert.equal(t.els['dca-edit-error'].hidden, false);
  const fresh = { ...item };
  const t2 = makeCtx({ items, save: async () => { items.splice(0, 1, fresh); return { ok: false }; } });
  t2.ctx.cbDcaEdit(0); t2.els['dca-edit-on'].checked = true;
  await t2.ctx.cbDcaEditSave();
  assert.equal(fresh.dca, false, '저장 경로가 되돌린 새 목록은 그대로');
}
{ // 가드: 목록이 바뀌어 다른 종목이 그 자리에 오면 저장하지 않는다 · 로드 전 · 휴대폰
  const a = { owner: '본인', grp: '주식', name: 'A', tkr: 'A', cur: 'KRW', qty: 1, dca: false, dcaAmt: 0 };
  const items = [a];
  const t = makeCtx({ items });
  t.ctx.cbDcaEdit(0); t.els['dca-edit-amt'].value = '1000';
  items[0] = { ...a, tkr: 'B', name: 'B' };
  await t.ctx.cbDcaEditSave();
  assert.equal(t.calls.save, 0); assert.match(t.els['dca-edit-error'].textContent, /찾지 못했습니다/);
  const t2 = makeCtx({ items: [{ ...a }], ready: false });
  t2.ctx.cbDcaEdit(0); t2.els['dca-edit-amt'].value = '1000';
  await t2.ctx.cbDcaEditSave();
  assert.equal(t2.calls.save, 0, '두 원격 로드가 ready 여야 저장'); assert.equal(t2.calls.errors.length, 1);
  const t3 = makeCtx({ items: [{ ...a }], mobile: true });
  t3.ctx.cbDcaEdit(0);
  assert.ok(!t3.els['dca-modal'].classList.contains('active'), '휴대폰은 조회 전용');
}

// ── 적립식 매수 화면: 조회 전용(2026-11-20 8차) — 켜 둔 규칙만(같은 dcaState), 수정은 보유 목록 칸의 설정 창 ──
const dcaPage = grab(cobalt, 'cbRenderDca');
assert.match(dcaPage, /\.filter\(x=>\{ const st=dcaState\(x\.i\); return st==='on'\|\|st==='incomplete'; \}\)/, '켜 둔 규칙만 — 중단한 규칙은 빠진다(보유 목록 칸도 —)');
assert.doesNotMatch(dcaPage, /cbDcaEdit\(|dca-rule-edit/, '이 화면에서는 고치지 않는다');
assert.match(dcaPage, /진행 중인 적립식 규칙이 없습니다\. 자산 관리 › 보유 목록의 적립식 칸을 눌러 규칙을 등록하거나 다시 켜세요\./);
assert.match(dcaPage, /진행 중 규칙<\/div><div class="cb-dca-summary-value">\$\{active\.length\}<span>개<\/span><\/div>\$\{incomplete\?`<div class="cb-dca-summary-sub">금액 미입력 \$\{incomplete\}개는 빼고 셉니다<\/div>`:''\}/);
assert.doesNotMatch(dcaPage, /위에서 보유 종목을 선택해/, '없는 기능을 가리키는 옛 안내를 지웠다');
assert.match(grab(script, '_fixedCostDcaGroup'), /dcaState\(i\)==='on'/, '고정비 묶음도 같은 상태 함수');
assert.match(dcaPage, /const active = items\.filter\(x=>dcaState\(x\.i\)==='on'\);/, '금액 미입력은 활성 규칙·일정·합계에서 뺀다');
{ // 금액 미입력 규칙은 일정이 없다(일정 탭·10일 목록이 0원 매수를 띄우지 않게)
  const sc = vm.createContext({ cbDcaIsHoliday: () => false, cbDcaDateKey: d => d.toISOString().slice(0, 10) });
  for (const n of ['dcaHasRule']) vm.runInContext(grab(script, n), sc);
  vm.runInContext(grab(cobalt, 'cbDcaScheduledOn'), sc);
  const day = new Date(2026, 10, 20, 12);
  assert.equal(sc.cbDcaScheduledOn({ dca: true, dcaCycle: '매일', dcaAmt: 1000 }, day), true);
  assert.equal(sc.cbDcaScheduledOn({ dca: true, dcaCycle: '매일', dcaAmt: 0 }, day), false);
}

// ── 마크업·닫기 ──
for (const id of ['dca-edit-on', 'dca-edit-cycle', 'dca-edit-day', 'dca-edit-dows', 'dca-edit-amt', 'dca-edit-cur', 'dca-edit-qty', 'dca-edit-error']) assert.match(html, new RegExp(`id="${id}"`));
assert.match(html, /<div class="modal-overlay" id="dca-modal" aria-hidden="true">\s*<div class="modal-content f-col dca-modal" role="dialog" aria-modal="true" aria-labelledby="dca-edit-title"/);
assert.match(html, /id="dca-edit-amt" class="form-input" placeholder="[^"]*" inputmode="numeric"/, '금액은 입력 중 쉼표');
assert.match(script, /if \(typeof cbDcaEditClose === 'function'\) cbDcaEditClose\(\);/, 'Esc 로 닫는다');
assert.match(cobalt, /_cbModalDownOutside=\(id==='dca-modal'\|\|id==='tax-hold-modal'\)\?id:null;/, '바깥을 누르면 닫는다(안에서 끌고 나온 경우 제외)');
assert.match(ws, /\.dca-cell-btn\{[^}]*color:var\(--tx\)/, '새 버튼은 글자색을 준다');
assert.doesNotMatch(ws, /\.dca-rule-edit|\.dca-rule-actions|\.cb-dca-row\.is-paused/, '관리 칸 CSS 는 지웠다');
// 기존 수정 창은 꺼진 규칙의 금액·주기를 그대로 채운다 — 수량만 고쳐 저장해도 중단 규칙이 지워지지 않는다
const editItemSrc = script.slice(script.indexOf("document.getElementById('add-dca').checked=!!item.dca;"), script.indexOf("document.getElementById('add-dca').checked=!!item.dca;") + 200);
assert.match(editItemSrc, /\n\s*document\.getElementById\('add-dca-cycle'\)\.value=item\.dcaCycle\|\|'매월';\n\s*document\.getElementById\('add-dca-amt'\)\.value=item\.dcaAmt\|\|0;/);

console.log('test_dca_edit: ok');
