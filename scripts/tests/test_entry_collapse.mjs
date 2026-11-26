// 입력 폼 접기: 목표 입력 폼은 버튼·수정 시에만 편다. 현금 흐름은 기록 창(2026-11-26)이다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readSource } from './_source.mjs'

const root = new URL('../../', import.meta.url);
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const script = readSource('script.js');
const finance = fs.readFileSync(new URL('finance.js', root), 'utf8');
const style = fs.readFileSync(new URL('style.css', root), 'utf8');

// 현금 흐름 — 입력 칸은 화면에 두지 않고 생키 카드의 ＋ 수입 / － 지출 이 기록 창을 연다(2026-11-26 사용자 결정)
assert.doesNotMatch(html, /id="cf-input-panel"|id="cf-entry-body"|btn-cf-submit/, '화면에 상주하는 입력 칸은 없앴다');
assert.match(html, /<div class="modal-overlay" id="cf-entry-modal" aria-hidden="true">/, '기록 창');
assert.match(script, /function cfEntryOpen\(kind, tab, editIdx\)\{\n\s*if \(isMobileLayout\(\)\) return;/, '휴대폰은 조회 전용');
assert.match(script, /function editCF\(idx\)\{\n\s*if \(isMobileLayout\(\)\) return;[\s\S]*?cfEntryOpen\('in','wife'\)[\s\S]*?cfEntryOpen\(/, '수정하면 같은 기록 창이 그 기록으로 열린다');
assert.match(script, /function cfEntryClose\(\)\{[\s\S]*_cfEntry=null;/, '닫기는 편집 상태도 해제한다');

// 목표 — 수정 중이거나, 추가를 눌렀거나, 목표가 하나도 없을 때만 폼을 그린다
assert.match(finance, /const showGoalForm=!!ge\|\|_finGoalFormOpen\|\|!\(goalData\|\|\[\]\)\.length;/);
assert.match(finance, /\$\{showGoalForm\?'':'<button type="button" class="fin-goal-add-btn" onclick="finGoalOpenForm\(\)">＋ 새 목표 추가<\/button>'\}/);
assert.match(finance, /\$\{showGoalForm\?`<div class="cb-panel fin-section" id="fin-goal-form">[\s\S]*<\/button><\/div><\/div><\/div>`:''\}/, '폼 패널은 열고 닫는 div 수가 맞아야 한다');
assert.match(finance, /function finGoalCancel\(\)\{_finGoalEdit=null;_finGoalFormOpen=false;/);
assert.match(finance, /goalData\.push\(g\);_finGoalEdit=null;_finGoalFormOpen=false;finSaveAndRender/, '저장하면 폼을 접는다');
// 모바일은 읽기 전용 — 추가 버튼도 숨긴다
assert.match(style, /#fin-goal-form,\.fin-goal-add-btn,\.fin-form-actions/);

console.log('ok - entry collapse');
