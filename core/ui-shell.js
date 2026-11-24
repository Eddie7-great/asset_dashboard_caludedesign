// core/ui-shell.js — 화면 틀 — 화면 상태, 테마, 휴대폰 메뉴, 화면 전환(switchView)
// (2026-11-23 script.js 에서 그대로 옮겨 나눈 조각. 로드 순서는 index.html·scripts/tests/_source.mjs)
// =============================================
// 숫자 입력 콤마 포매팅 (text 타입 입력 전용)
// =============================================

// =============================================
// UI 상태
// =============================================
let currentOwner = '전체';
window.cfTrendDetails = {in:[],out:[]};

const now = new Date();
const days = ['일','월','화','수','목','금','토'];
const sideDate = document.getElementById('side-date-display');
if (sideDate) sideDate.innerText = `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')} (${days[now.getDay()]})`;

// =============================================
// 테마
// =============================================
// 3-테마(2026-11-24): 'default'(라이트, 기본) | 'navy' | 'dark' — 모두 리퀴드 글래스.
// 'default'만 data-theme 속성이 없다 — :root 토큰이 곧 라이트 테마다.
const THEMES = ['default','navy','dark'];
// 저장된 테마를 읽는다. 예전 판의 저장값은 한 번만 새 구성으로 옮긴다(themeV '3').
//   themeV 2(기본/라이트/다크): 기본·라이트 → 라이트(default), 다크 → 다크.
//   themeV 없음(그 전 판 라이트/다크/네이비): 라이트·미저장 → 라이트, 네이비 → 네이비, 다크 → 다크.
function _savedTheme(){
  try{
    let t=localStorage.getItem('theme');
    if(localStorage.getItem('themeV')!=='3'){
      t = t==='dark' ? 'dark' : (t==='navy' ? 'navy' : 'default');
      localStorage.setItem('theme',t);
      localStorage.setItem('themeV','3');
    }
    return THEMES.includes(t)?t:'default';
  }catch(e){ return 'default'; }
}
function _applyThemeAttr(mode){
  if (mode === 'default') document.body.removeAttribute('data-theme');
  else document.body.setAttribute('data-theme', mode);
}
// 어두운 바탕(다크·네이비)인가 — 차트 색 분기
function isDarkTheme() {
  const t = document.body.getAttribute('data-theme');
  return t === 'dark' || t === 'navy';
}
function setTheme(mode) {
  if (!THEMES.includes(mode)) mode = 'default';
  _applyThemeAttr(mode);
  // 세그먼트 컨트롤 활성 표시
  THEMES.forEach(t => {
    const b = document.getElementById('theme-seg-' + t);
    if (b) {
      const selected = t === mode;
      b.classList.toggle('active', selected);
      b.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
  });
  applyChartTheme(); // 내부에서 전 차트 재드로우 포함
  // gift 차트 범례 색상 강제 갱신
  try{localStorage.setItem('theme', mode);}catch(e){}
  const activeView = document.querySelector('.view-section.active');
  if (activeView && activeView.id === 'view-bubble') setTimeout(()=>renderBubbleChart('weight'), 200);
  // 현금 흐름 차트는 렌더 시점에 CSS 토큰을 hex로 해석해 쓰므로 테마 변경 시 재렌더
  if (activeView && activeView.id === 'view-cashflow') { try{ renderCashFlow(); }catch(e){} }
}
// 스크립트 로드 즉시 테마 적용 — 로그인 화면부터 저장 테마(없으면 기본) 반영.
// (이 시점엔 파일 후반부 let 변수들이 TDZ 상태라 setTheme→applyChartTheme 전체 호출은 금지)
try{
  const _m0=_savedTheme();
  _applyThemeAttr(_m0);
  THEMES.forEach(t=>{const b=document.getElementById('theme-seg-'+t); if(b){const selected=t===_m0;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',selected?'true':'false');}});
}catch(e){}

// =============================================
// 모바일 내비게이션 (사이드바 드로어)
// =============================================
const _mobileMQ = window.matchMedia('(max-width: 768px)');
function isMobileLayout() { return _mobileMQ.matches; }
function _layoutPreviewMode() {
  const q=new URLSearchParams(location.search);
  return q.get('mobilePreview')==='1' ? 'mobile' : q.get('desktopPreview')==='1' ? 'desktop' : '';
}
function _updateLayoutPreviewLabel() {
  const mode=_layoutPreviewMode();
  const label=document.getElementById('sidebar-layout-label');
  if(label) label.textContent=(mode==='mobile'||(!mode&&isMobileLayout()))?'PC':'모바일';
}
function _layoutPreviewUrl(mode) {
  const url=new URL(location.href);
  url.searchParams.delete('mobilePreview');
  url.searchParams.delete('desktopPreview');
  url.searchParams.set(mode==='mobile'?'mobilePreview':'desktopPreview','1');
  return url.toString();
}
function openLayoutPreview(mode) {
  const overlay=document.getElementById('layout-preview-overlay');
  const frame=document.getElementById('layout-preview-frame');
  if(!overlay||!frame) return;
  const next=mode==='desktop'?'desktop':'mobile';
  overlay.classList.remove('mode-mobile','mode-desktop');
  overlay.classList.add('show','mode-'+next);
  overlay.setAttribute('aria-hidden','false');
  frame.src=_layoutPreviewUrl(next);
}
function closeLayoutPreview() {
  const overlay=document.getElementById('layout-preview-overlay');
  const frame=document.getElementById('layout-preview-frame');
  if(!overlay) return;
  overlay.classList.remove('show','mode-mobile','mode-desktop');
  overlay.setAttribute('aria-hidden','true');
  if(frame) frame.src='about:blank';
}
function toggleLayoutPreview() {
  const mode=_layoutPreviewMode();
  if(mode) {
    try {
      if(window.parent!==window&&typeof window.parent.closeLayoutPreview==='function') {
        window.parent.closeLayoutPreview();
        return;
      }
    } catch(e) {}
    if(window.parent!==window) {
      window.parent.postMessage({type:'close-layout-preview'},'*');
      return;
    }
  }
  openLayoutPreview(isMobileLayout()?'desktop':'mobile');
}
window.addEventListener('message',ev=>{
  const frame=document.getElementById('layout-preview-frame');
  if(ev.data?.type==='close-layout-preview'&&frame&&ev.source===frame.contentWindow) closeLayoutPreview();
});
window.addEventListener('keydown',ev=>{ if(ev.key==='Escape') closeLayoutPreview(); });
if(_mobileMQ.addEventListener) _mobileMQ.addEventListener('change',_updateLayoutPreviewLabel);
setTimeout(_updateLayoutPreviewLabel,0);
let _sidebarReturnFocus = null;
function openSidebar() {
  document.querySelector('.menu-col')?.removeAttribute('inert'); // 넓은 화면에서 접어 둔 채 창을 좁혀도 서랍은 열린다
  _sidebarReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.querySelector('.menu-col')?.classList.add('open');
  document.getElementById('sidebar-backdrop')?.classList.add('show');
  document.getElementById('sidebar-toggle')?.setAttribute('aria-expanded','true');
  if (isMobileLayout()) {
    setTimeout(() => document.querySelector('.menu-col button:not([disabled])')?.focus(), 0);
  }
}
function closeSidebar() {
  const wasOpen = document.querySelector('.menu-col')?.classList.contains('open');
  document.querySelector('.menu-col')?.classList.remove('open');
  document.getElementById('sidebar-backdrop')?.classList.remove('show');
  document.getElementById('sidebar-toggle')?.setAttribute('aria-expanded','false');
  if (wasOpen && _sidebarReturnFocus?.focus) {
    _sidebarReturnFocus.focus();
    _sidebarReturnFocus = null;
  }
}
// 넓은 화면의 사이드바 접기/펴기. 화면 설정이라 localStorage 에만 둔다(KV 에 넣지 않는다).
// 접힌 동안 사이드바는 inert 라 키보드 포커스가 들어가지 않는다. 전환이 끝나면 차트가 새 폭에 맞게 다시 그려지도록 알린다.
function _sideCollapsedSaved(){ try{ return localStorage.getItem('sideCollapsed')==='1'; }catch(e){ return false; } }
function applySideCollapsed(collapsed, persist){
  const on=!!collapsed;
  document.body.classList.toggle('side-collapsed',on);
  const side=document.querySelector('.menu-col');
  if(side){ if(on) side.setAttribute('inert',''); else side.removeAttribute('inert'); }
  const btn=document.getElementById('side-collapse-btn');
  if(btn){ btn.setAttribute('aria-expanded',String(!on)); btn.setAttribute('aria-label',on?'사이드 메뉴 펴기':'사이드 메뉴 접기'); btn.title=on?'사이드 메뉴 펴기':'사이드 메뉴 접기'; }
  if(persist){ try{ localStorage.setItem('sideCollapsed',on?'1':'0'); }catch(e){} }
  clearTimeout(window._sideCollapseTimer);
  window._sideCollapseTimer=setTimeout(()=>{ try{ window.dispatchEvent(new Event('resize')); if(typeof _fitActiveCharts==='function')_fitActiveCharts(); }catch(e){} },420);
}
function toggleSideCollapsed(){ applySideCollapsed(!document.body.classList.contains('side-collapsed'),true); }
function toggleSidebar() {
  document.querySelector('.menu-col')?.classList.contains('open') ? closeSidebar() : openSidebar();
}
// 첫 방문 기본값 — 자주 여는 '요약'·'분석'만 펼쳐 둔다. 4그룹을 모두 펼치면
// 항목이 13개라 접기의 이점이 사라진다. 이후에는 사용자가 접은 상태를 그대로 따른다.
// 활성 뷰의 모든 Chart.js 인스턴스를 컨테이너 크기에 재맞춤
// — display:none 상태에서 생성/갱신된 캔버스가 잘못된 크기로 남는 문제 보정 (잘림/여백 방지)
function _fitActiveCharts() {
  const active = document.querySelector('.view-section.active');
  if (!active) return;
  active.querySelectorAll('canvas').forEach(c => {
    try { if (typeof Chart !== 'undefined' && Chart.getChart) Chart.getChart(c)?.resize(); } catch (e) {}
  });
}

let _viewHistoryRestoring=false;
function _viewMenuButton(id){
  const menuId=id==='cdash'?'dashboard':id;
  return document.getElementById('menu-'+menuId)
    || Array.from(document.querySelectorAll('.menu-btn')).find(b=>(b.getAttribute('onclick')||'').includes(`switchView('${id}'`))
    || null;
}
function _recordViewHistory(id){
  if(_viewHistoryRestoring||!id) return;
  const normalized=typeof navResolve==='function'?navResolve(id):(id==='dashboard'?'cdash':id);
  if(window.history.state?.assetView===normalized) return;
  // 새 문서가 #view=... 딥링크(PC/모바일 미리보기 포함)로 열렸다면
  // 초기 대시보드 렌더가 그 해시를 덮어쓰지 않게 두고 load 복원 단계에서 적용한다.
  const requested=String(location.hash||'').match(/^#view=(.+)$/);
  if(!window.history.state?.assetView&&requested){
    const requestedView=decodeURIComponent(requested[1]);
    if((typeof navResolve==='function'?navResolve(requestedView):requestedView)!==normalized&&document.getElementById('view-'+requestedView)) return;
  }
  const url='#view='+encodeURIComponent(normalized);
  const state={...(window.history.state||{}),assetView:normalized};
  if(!window.history.state?.assetView) window.history.replaceState(state,'',url);
  else window.history.pushState(state,'',url);
}
window.addEventListener('popstate',ev=>{
  const hashMatch=String(location.hash||'').match(/^#view=(.+)$/);
  const target=ev.state?.assetView||(hashMatch?decodeURIComponent(hashMatch[1]):'cdash');
  if(!document.getElementById('view-'+target)) return;
  _viewHistoryRestoring=true;
  try{ switchView(target,_viewMenuButton(target)); }
  finally{ _viewHistoryRestoring=false; }
});

// =============================================
// 뷰 전환
// =============================================
function switchView(viewId, btn) {
  if (!btn) btn=document.getElementById('menu-'+viewId);
  const viewEl = document.getElementById('view-'+viewId);
  if (!viewEl) return;
  // 현재 활성 뷰가 bubble이었고 떠나는 경우: Plotly 인스턴스 정리
  const prevActive = document.querySelector('.view-section.active');
  if (prevActive && prevActive.id === 'view-bubble' && viewId !== 'bubble') {
    if (_bubbleChart) { try { _bubbleChart.destroy(); } catch(e){} _bubbleChart = null; }
  }
  document.querySelectorAll('.menu-btn,.footer-status-btn').forEach(b=>{
    b.classList.remove('active');
    b.removeAttribute('aria-current');
  });
  if(btn){btn.classList.add('active');btn.setAttribute('aria-current','page');}
  document.querySelectorAll('.view-section').forEach(v=>v.classList.remove('active')); viewEl.classList.add('active');
  if (isMobileLayout()) closeSidebar();
  // 좌측 탭 전환 시 소유주 버튼을 '전체'로 초기화 — 제목 계산보다 먼저 수행해야 제목과 버튼 상태가 일치
  // 이 함수가 직접 그리는 화면은 holdings·cashflow·bubble 뿐이다(나머지는 cobalt.js 가 감싸 처리).
  // 같은 세부 메뉴 안 이동(종목별↔계좌별, 일정→월별 등)은 navPrepare 가 이어 준 소유주를 지킨다 — 표식은 한 번 쓰고 지운다.
  const keepOwner = typeof _navKeepOwner!=='undefined' && _navKeepOwner;
  if (typeof _navKeepOwner!=='undefined') _navKeepOwner=false;
  if (viewId==='holdings' && !keepOwner) {
    document.querySelectorAll('#owner-tabs-container .owner-btn').forEach(b=>b.classList.remove('active'));
    const allBtn=document.querySelector('#owner-tabs-container .owner-btn');
    if(allBtn)allBtn.classList.add('active');
    currentOwner='전체';
  }
  const dispOwner = currentOwner==='전체'?'통합':currentOwner;
  const baseTitles={'holdings':' 자산 내역','cashflow':'현금 흐름 관리 (가계부)'};
  let title;
  if (viewId==='holdings') title=dispOwner+baseTitles.holdings;
  else if (viewId==='bubble') {
    const _o = _bubbleOwner || currentOwner || '전체';
    const suffix = (_o === '전체') ? '전체 소유주의 포트폴리오 비중 차트' : `${_o}의 포트폴리오 비중 차트`;
    title = suffix;
  }
  else title=baseTitles[viewId]||viewId;
  document.getElementById('main-title').textContent = title;
  const ownerTabsEl = document.getElementById('owner-tabs-container');
  ownerTabsEl.style.display=(viewId==='holdings')?'flex':'none';
  ownerTabsEl.classList.toggle('holdings-owner-tabs', viewId==='holdings');
  const cfBar = document.getElementById('cf-owner-bar');
  if (cfBar) cfBar.style.display = (viewId==='cashflow') ? 'flex' : 'none';
  const bubbleBar = document.getElementById('bubble-owner-bar');
  if (bubbleBar) bubbleBar.style.display = (viewId==='bubble') ? 'flex' : 'none';
  if (viewId==='cashflow') {
    if(!keepOwner) _cfOwner='전체';
    _cfSection='monthly';
    document.querySelectorAll('#cf-owner-bar .owner-btn').forEach(b=>b.classList.remove('active'));
    const allCfBtn=document.getElementById('cf-owner-'+_cfOwner)||document.getElementById('cf-owner-전체');
    if(allCfBtn)allCfBtn.classList.add('active');
    const ownerInput=document.getElementById('cf-owner-input');if(ownerInput)ownerInput.value=_cfOwner!=='전체'?_cfOwner:'본인';
    resetFixedCostForm();
    switchCashFlowSection('monthly',document.getElementById('cf-section-tab-monthly'));
  }
  if (viewId==='cashflow'){fetchDivData().then(()=>autoAddDividendCashFlow(true)).catch(e=>console.warn('[autoAddDividendCashFlow]',e));renderAutoTransfers();renderCfDivPanel();renderFixedCostView();requestAnimationFrame(()=>{if(window.cfTrendChartInst)window.cfTrendChartInst.resize();renderCashFlow();});}
  if (viewId==='holdings'){
    const hOwner = currentOwner;
    _holdingsBrokerFilter = '전체';
    renderPortfolio(hOwner);
  }
  if (viewId==='bubble'){
    // 현재 owner 와 버블 view 의 owner 탭 active 상태 동기화
    _bubbleOwner = currentOwner || '전체';
    document.querySelectorAll('[id^="sunburst-owner-"]').forEach(b => {
      b.classList.toggle('active', b.id === `sunburst-owner-${_bubbleOwner}`);
    });
    renderBubbleChart('weight');
    // 컨테이너 크기 확보를 위해 두 단계 프레임 이후 호출 (display:none → active 직후 layout flush)
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      renderBubbleChart('weight');
      // 안전망: 300ms 후 재확인 – 컨테이너가 그때 준비되었을 수도 있음
      setTimeout(()=>renderBubbleChart('weight'), 300);
    }));
  }
  // 뷰 활성화 직후 차트들을 새 컨테이너 크기에 재맞춤 (렌더 함수들이 다음 프레임에 캔버스를 만들 수 있어 2회)
  requestAnimationFrame(() => _fitActiveCharts());
  setTimeout(_fitActiveCharts, 350);
  _recordViewHistory(viewId);
}
