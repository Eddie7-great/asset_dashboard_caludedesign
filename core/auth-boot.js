// core/auth-boot.js — 로그인·로딩 — 로그인 화면, 로그인 뒤 로딩 화면
// (2026-11-23 script.js 에서 그대로 옮겨 나눈 조각. 로드 순서는 index.html·scripts/tests/_source.mjs)
// =============================================
// 인증 (로그인)
// =============================================
function _setAuthenticatedUi(authenticated){
  const overlay=document.getElementById('login-overlay');
  const layout=document.querySelector('.layout');
  if(overlay){
    overlay.style.display=authenticated?'none':'flex';
    overlay.setAttribute('aria-hidden',authenticated?'true':'false');
  }
  if(layout){
    if(authenticated){layout.removeAttribute('inert');layout.removeAttribute('aria-hidden');}
    else{layout.setAttribute('inert','');layout.setAttribute('aria-hidden','true');}
  }
}

async function authFetch(url, options = {}) {
  // 인증 정보는 HttpOnly 쿠키로만 전송한다. 이전 빌드의 bearer 토큰은 즉시 폐기해
  // DOM XSS가 발생하더라도 JavaScript에서 세션 비밀을 읽을 수 없게 한다.
  try { sessionStorage.removeItem('_dashAuth'); } catch(e) {}
  options.credentials = 'same-origin';
  options.cache = options.cache || 'no-store';
  const res = await fetch(url, options);
  if (res.status === 401) {
    bootFinish();   // 로딩 중 세션이 끊기면 뼈대를 남기지 않는다
    _setAuthenticatedUi(false);
    document.getElementById('login-pw')?.focus();
  }
  return res;
}

// ── 로그인 뒤 첫 로딩(2026-11-20, 시안 D — 사용자 결정) ── 화면 전체를 덮는 스플래시: 로고 막대가 진행에 따라 차례로 자라고
// 단계 점 4개가 하나씩 켜진다(직전 세션 시안 원본 renderD 를 그대로 옮겼다. 지금 점의 고리만 느리게 숨 쉰다 — 단계 사이에 멈춰 보이지 않게).
// 단계는 실제로 기다리는 일 그대로다(initDashboard 의 호출 순서·병렬은 바꾸지 않고 끝날 때 표시만 한다).
// 걷는 때(2026-11-20 8차, 사용자 결정): 시세 반영까지 끝나면. 배당·환율은 기다리지 않는다 — 환율은 시세 응답(/api/price)에 실려 와
// 금액이 맞고, 국내 배당 조회가 20초 넘게 걸려 예전의 '배당·환율까지(시세 뒤 최대 8초)' 대기가 매번 8초를 꽉 채웠다.
// 자산 로드 실패는 바로(오류 안내가 보이게), 다른 화면으로 이동·세션 만료(401)·BOOT_SAFETY_MS(25초)도 걷는다.
const BOOT_STEPS=[['auth','로그인 확인'],['assets','보유 자산 불러오는 중'],['ext','재무 기록 불러오는 중'],['prices','시세 반영 중']];
const BOOT_SAFETY_MS=25000;
let _boot=null;
function _bootReduced(){ return typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches; }
// 로고 막대 세 개의 높이(0~1) — 진행률 p 에 따라 첫 막대부터 차례로 자란다(시안과 같은 식).
function bootGrowth(p){ return [0,1,2].map(k=>Math.max(0,Math.min(1,(p-k*.28)/.36))); }
function bootStart(){
  const sp=document.getElementById('boot-splash'); if(!sp) return;
  _boot={done:new Set(['auth']),revealed:false,safety:0};
  sp.hidden=false; sp.classList.remove('is-leaving');
  document.querySelector('.layout')?.setAttribute('inert','');   // 덮는 동안 가려진 메뉴에 포커스가 가지 않게
  _bootPaint();
  _boot.safety=setTimeout(bootFinish,BOOT_SAFETY_MS);
}
function _bootPaint(){
  if(!_boot) return;
  const n=_boot.done.size,total=BOOT_STEPS.length;
  const next=BOOT_STEPS.find(([k])=>!_boot.done.has(k));
  const sp=document.getElementById('boot-splash');
  if(sp) bootGrowth(n/total).forEach((g,k)=>sp.style.setProperty('--g'+(k+1),g.toFixed(3)));
  document.querySelectorAll('#boot-dots>li').forEach((li,k)=>{
    const key=BOOT_STEPS[k]&&BOOT_STEPS[k][0];
    li.className=_boot.done.has(key)?'is-done':(next&&next[0]===key?'is-now':'');
  });
  const step=document.getElementById('boot-step'); if(step) step.textContent=next?next[1]+' …':'준비 완료';
  const st=document.getElementById('boot-status'); if(st) st.textContent=next?`${next[1]} (${n}/${total})`:'불러오기 완료';
}
function bootStep(key){
  if(!_boot||_boot.done.has(key)) return;
  _boot.done.add(key); _bootPaint();
  if(BOOT_STEPS.every(([k])=>_boot.done.has(k))) setTimeout(bootFinish,_bootReduced()?0:320);   // 마지막 막대가 다 자라는 걸 보고 걷는다
}
// 스플래시를 걷는다. 걷는 순간 지금 화면의 등장 움직임·숫자 올리기를 돌린다 — 덮여 있는 동안 돈 움직임은 안 보였다.
function bootReveal(){
  if(!_boot||_boot.revealed) return;
  _boot.revealed=true;
  const loginShown=document.getElementById('login-overlay')?.style.display==='flex';
  if(!loginShown) document.querySelector('.layout')?.removeAttribute('inert');   // 로그인 화면이 다시 떠 있으면 잠금 유지
  const sp=document.getElementById('boot-splash');
  if(sp){
    if(_bootReduced()) sp.hidden=true;
    else{ sp.classList.add('is-leaving'); setTimeout(()=>{sp.hidden=true;sp.classList.remove('is-leaving');},240); }
  }
  const id=document.querySelector('.view-section.active')?.id?.replace('view-','');
  if(id&&typeof cbMarkEntering==='function') cbMarkEntering(id);
  if(id&&typeof cbCountUp==='function') cbCountUp(id);
  if(typeof _fitActiveCharts==='function') requestAnimationFrame(()=>_fitActiveCharts());
}
function bootFinish(){
  if(!_boot) return;
  bootReveal();
  clearTimeout(_boot.safety);
  const st=document.getElementById('boot-status'); if(st) st.textContent='불러오기 완료';
  _boot=null;
}

let _dashboardInitStarted = false;
function _startDashboardAfterAuth(){
  _setAuthenticatedUi(true);
  if(window.innerWidth>768) applySideCollapsed(_sideCollapsedSaved(),false);
  if (_dashboardInitStarted) return;
  _dashboardInitStarted = true;
  bootStart();
  initDashboard();
  setTimeout(_fitActiveCharts, 800);
  setTimeout(_fitActiveCharts, 2500);
}

// 로그인 화면 편의 기능 — 인증 경로(attemptLogin → /api/auth)는 건드리지 않는다.
// 비밀번호 보기: 잘못 친 비밀번호를 눈으로 확인한다. force 로 강제로 숨길 수 있다(로그인 성공 시).
function loginToggleReveal(force){
  const pw=document.getElementById('login-pw'),btn=document.getElementById('login-reveal');
  if(!pw||!btn) return;
  const show=typeof force==='boolean'?force:pw.type==='password';
  pw.type=show?'text':'password';
  btn.setAttribute('aria-pressed',String(show));
  btn.setAttribute('aria-label',show?'비밀번호 숨기기':'비밀번호 보기');
}
// Caps Lock 이 켜져 있으면 입력칸 아래에 알린다(대소문자 비밀번호가 틀리는 가장 흔한 이유).
function loginCapsCheck(ev){
  const el=document.getElementById('login-caps');
  if(!el||!ev||typeof ev.getModifierState!=='function') return;
  el.hidden=!ev.getModifierState('CapsLock');
}
// 로그인 성공 시 오버레이를 짧게(160ms, 이즈 인) 흐리게 한 뒤 대시보드를 띄운다.
function _loginFadeOut(){
  const overlay=document.getElementById('login-overlay');
  const reduce=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!overlay||reduce) return Promise.resolve();
  overlay.classList.add('is-leaving');
  return new Promise(r=>setTimeout(()=>{overlay.classList.remove('is-leaving');r();},160));
}

async function attemptLogin() {
  const pwEl = document.getElementById('login-pw');
  const errEl = document.getElementById('login-error');
  pwEl?.setAttribute('aria-invalid','false');
  errEl.style.display = 'none';
  errEl.textContent = '';
  const btn = document.querySelector('.login-btn');
  btn.disabled = true;
  btn.textContent = '확인 중...';
  btn.setAttribute('aria-busy','true');
  document.getElementById('login-form')?.setAttribute('aria-busy','true');
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwEl.value })
    });
    if (res.ok) {
      try { sessionStorage.removeItem('_dashAuth'); } catch(e) {}
      pwEl.value='';
      pwEl.setAttribute('aria-invalid','false');
      loginToggleReveal(false);
      await _loginFadeOut();
      _startDashboardAfterAuth();
    } else {
      let message = res.status===429 ? '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.' : '비밀번호가 올바르지 않습니다.';
      try{ const body=await res.json(); if(body&&typeof body.error==='string'&&body.error.length<=120) message=body.error; }catch(e){}
      errEl.textContent = message;
      errEl.style.display = 'block';
      pwEl.setAttribute('aria-invalid','true');
      pwEl.value = '';
      pwEl.focus();
    }
  } catch (e) {
    errEl.textContent = '서버 연결 오류. 다시 시도하세요.';
    errEl.style.display = 'block';
    pwEl?.setAttribute('aria-invalid','true');
  }
  btn.disabled = false;
  btn.textContent = '확인';
  btn.removeAttribute('aria-busy');
  document.getElementById('login-form')?.removeAttribute('aria-busy');
}
