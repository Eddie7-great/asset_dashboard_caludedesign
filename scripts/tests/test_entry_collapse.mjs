// 입력 폼 접기: 현금 흐름·목표 입력 폼은 버튼·수정 시에만 펴고, 저장 로직은 그대로다.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const script = fs.readFileSync(new URL('script.js', root), 'utf8');
const finance = fs.readFileSync(new URL('finance.js', root), 'utf8');
const style = fs.readFileSync(new URL('style.css', root), 'utf8');

// 현금 흐름 — 버튼 줄 + 기본으로 접힌 폼(같은 입력란·같은 저장 버튼을 감쌀 뿐)
assert.match(html, /class="cf-entry-bar"[\s\S]*cfOpenEntry\('in'\)[\s\S]*cfOpenEntry\('out'\)[\s\S]*cfOpenEntry\('auto'\)[\s\S]*<div id="cf-entry-body" hidden>[\s\S]*id="btn-cf-submit" onclick="submitCfEntry\(\)"[\s\S]*<\/div>\s*<!-- 자동이체 목록/);
assert.match(script, /function cfOpenEntry\(kind\)\{\n\s*if \(isMobileLayout\(\)\) return;[\s\S]*resetCfForm\(\)[\s\S]*cfmode-auto':'cfmode-oneshot'[\s\S]*toggleCfMode\(\)[\s\S]*cfShowEntry\(\)/, '버튼은 편집 상태를 비우고 방식·유형을 맞춘 뒤 폼을 편다');
assert.match(script, /function editCF\(idx\)\{\n\s*if \(isMobileLayout\(\)\) return;[^\n]*\n\s*cfShowEntry\(\);/, '수정하면 접힌 폼이 자동으로 펴진다');
assert.match(script, /function cfCloseEntry\(\)\{[\s\S]*resetCfForm\(\)[\s\S]*body\.hidden=true/, '닫기는 편집 상태도 해제한다');

// 목표 — 수정 중이거나, 추가를 눌렀거나, 목표가 하나도 없을 때만 폼을 그린다
assert.match(finance, /const showGoalForm=!!ge\|\|_finGoalFormOpen\|\|!\(goalData\|\|\[\]\)\.length;/);
assert.match(finance, /\$\{showGoalForm\?'':'<button type="button" class="fin-goal-add-btn" onclick="finGoalOpenForm\(\)">＋ 새 목표 추가<\/button>'\}/);
assert.match(finance, /\$\{showGoalForm\?`<div class="cb-panel fin-section" id="fin-goal-form">[\s\S]*<\/button><\/div><\/div><\/div>`:''\}/, '폼 패널은 열고 닫는 div 수가 맞아야 한다');
assert.match(finance, /function finGoalCancel\(\)\{_finGoalEdit=null;_finGoalFormOpen=false;/);
assert.match(finance, /goalData\.push\(g\);_finGoalEdit=null;_finGoalFormOpen=false;finSaveAndRender/, '저장하면 폼을 접는다');
// 모바일은 읽기 전용 — 추가 버튼도 숨긴다
assert.match(style, /#fin-goal-form,\.fin-goal-add-btn,\.fin-form-actions/);

console.log('ok - entry collapse');
