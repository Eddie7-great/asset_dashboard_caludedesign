// core/startup.js — 시작 — 페이지 로드 때 초기화(initDashboard), 보유 목록 정렬, 배당 성장률
// (2026-11-23 script.js 에서 그대로 옮겨 나눈 조각. 로드 순서는 index.html·scripts/tests/_source.mjs)
// =============================================
// window.onload - 차트 초기화
// =============================================
// [4] ESC 키로 모달 닫기
document.addEventListener('keydown', function(e) {
  const addModal=document.getElementById('add-modal');
  if(e.key==='Tab'&&addModal?.classList.contains('active')){
    const focusable=Array.from(addModal.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
      .filter(el=>el.getClientRects().length>0);
    if(focusable.length){
      const first=focusable[0],last=focusable[focusable.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  }
  const cfModal=document.getElementById('cfDetailModal');
  if(e.key==='Tab'&&cfModal?.classList.contains('active')){
    const focusable=Array.from(cfModal.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
      .filter(el=>el.getClientRects().length>0);
    if(focusable.length){
      const first=focusable[0],last=focusable[focusable.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  }
  if (e.key === 'Escape') {
    closeAddModal();
    closeTradeModal();
    if (typeof cbDcaEditClose === 'function') cbDcaEditClose();
    if (typeof cbTaxHoldClose === 'function') cbTaxHoldClose();
    if (typeof cbDashPopClose === 'function') cbDashPopClose();
    if (typeof closeREModal === 'function') closeREModal();
    if (typeof closeLiabModal === 'function') closeLiabModal();
    closeCfDetails();
    closeSidebar();
    const dd=document.getElementById('search-dropdown');
    if(dd)dd.style.display='none';
  }
});
// 검색 드롭다운 외부 클릭시 닫기
document.addEventListener('click', function(e) {
  const srch = document.getElementById('add-search');
  const dd = document.getElementById('search-dropdown');
  if (dd && srch && !srch.contains(e.target) && !dd.contains(e.target)) {
    dd.style.display = 'none';
  }
});

// [5] 포트폴리오 테이블 정렬 — 상태는 자산군 표마다 {field, dir}. 머리글을 누르면 정렬하고, 시세 갱신 등으로 표를
// 다시 그린 뒤에도 renderPortfolio 가 applyPortfolioSort 로 같은 순서를 되살린다. 다른 화면으로 옮기면 지운다
// (cobalt.js cbResetViewState). 숫자 칸은 첫 클릭 내림차순, 소유주·계좌·종목은 오름차순. 값이 없는 행은 어느 방향에서도 끝.
let _sortState = {}; // {grpName: {field, dir}}
function sortPortfolioTable(grpName, field, thEl) {
  if (!_sortState[grpName]) _sortState[grpName] = {field: null, dir: 1};
  const st = _sortState[grpName];
  if (st.field === field) { st.dir *= -1; } else { st.field = field; st.dir = PORTFOLIO_SORT_ASC_FIRST.includes(field) ? 1 : -1; }
  const header = thEl.closest('th') || thEl;
  applyPortfolioSort(header.closest('table'), st);
}
function applyPortfolioSort(table, st) {
  if (!table || !st || !st.field) return;
  table.querySelectorAll('th.sortable').forEach(th => {
    const on = th.getAttribute('data-sort-field') === st.field;
    th.classList.remove('sort-asc','sort-desc');
    if (on) th.classList.add(st.dir === -1 ? 'sort-desc' : 'sort-asc');
    th.setAttribute('aria-sort', on ? (st.dir === -1 ? 'descending' : 'ascending') : 'none');
  });
  const tbody = table.querySelector('tbody');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const text = st.field === 'acct' || st.field === 'name';
  const getVal = row => {
    const raw = row.getAttribute('data-sort-' + st.field.toLowerCase());
    if (raw == null || raw === '') return null;
    if (text) return raw;
    return Number.isFinite(Number(raw)) ? Number(raw) : null;
  };
  const keyed = rows.map((row, idx) => ({row, idx, v: getVal(row)}));
  keyed.sort((a, b) => {
    if (a.v == null) return b.v == null ? a.idx - b.idx : 1;
    if (b.v == null) return -1;
    const c = text ? String(a.v).localeCompare(String(b.v), 'ko') : a.v - b.v;
    return c * st.dir || a.idx - b.idx;
  });
  keyed.forEach(x => tbody.appendChild(x.row));
}

function initDashboard(){
  initCfDropdowns();
  document.getElementById('cf-date').value=_cfLocalDateKey(currentCfDate);

  // IME 한글 조합 이벤트 리스너 (조합 중 검색 방지)
  const searchInput = document.getElementById('add-search');
  if (searchInput) {
    searchInput.addEventListener('compositionstart', function(){ _isComposing = true; });
    searchInput.addEventListener('compositionend', function(){
      _isComposing = false;
      onSearchInput(); // 조합 완료 시 검색 실행
    });
    // Enter 키: 드롭다운 첫 번째 항목 선택 또는 API 검색 실행
    searchInput.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const dd = document.getElementById('search-dropdown');
      if (dd && dd.style.display !== 'none') {
        const first = dd.querySelector('div[onclick]');
        if (first) { first.click(); return; }
      }
      searchStockByApi();
    });
  }

  // Chart.js 는 CDN 에서 온다. 로드에 실패했는데 여기서 그대로 new Chart 를 하면
  // initDashboard 가 통째로 중단되고, 그 아래의 KV 로드(loadAssetsFromKV)까지 실행되지 않아
  // 차트뿐 아니라 자산·순자산·배당이 전부 빈 화면이 된다. 차트만 포기하고 나머지는 띄운다.
  if (typeof Chart === 'undefined') {
    window.cfTrendChartInst = null;
  } else {

    window.cfTrendChartInst=new Chart(document.getElementById('cfTrendChart').getContext('2d'),{type:'bar',data:{labels:[],datasets:[{data:[],backgroundColor:[],borderRadius:4}]},options:{plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>{const idx=c.dataIndex,mIn=window.cfTrendDetails.in[idx]||0,mOut=window.cfTrendDetails.out[idx]||0,net=c.raw,sign=net<0?'-₩':'₩';return[` 순현금흐름: ${sign}${Math.abs(net).toLocaleString()}`,` 총 수입: ₩${mIn.toLocaleString()}`,` 총 지출: ₩${mOut.toLocaleString()}`];}}}},scales:{x:{grid:{display:false}},y:{grid:{color:'rgba(150,150,150,.15)',borderDash:[2,2]},ticks:{callback:v=>v===0?'₩0':(v<0?'-₩':'₩')+Math.abs(v/10000).toLocaleString()+'만'}}}}});
  }

  // 테마 복원 — 3테마 (default/light/dark), 저장값 없으면 기본
  setTheme(_savedTheme());

  // (예전 화이트리스트 — 포커스 때 쉼표 제거·벗어날 때만 쉼표 — 는 없앴다. 그 칸들이 아래 입력 중 쉼표를 건너뛰게 만들었다.)
  // 2-1. 대시보드 전체 자동 쉼표 — inputmode=numeric/decimal 모든 input에 실시간 콤마 삽입
  try { initGlobalCommaInputs(); } catch(e){}

  changeOwner('전체', null);
  // 창을 열면 항상 대시보드로 시작
  switchView('dashboard', document.getElementById('menu-dashboard'));
  renderAutoTransfers();

  // 초기 로드: KV에서 자산 로드 후 EOD 시세 1회 반영
  (async () => {
    // KRX 종목 DB(data/stocks.json)와 자산을 병렬 로드
    // 로딩 화면 단계 표시(bootStep)는 각 약속이 끝날 때 붙인다 — 호출 순서·병렬은 그대로. 자산을 못 불러오면 오류 안내가 보이게 바로 걷는다.
    const [assetsResult,extResult]=await Promise.all([
      loadAssetsFromKV().then(r=>{bootStep('assets');if(!r?.ok)bootReveal();return r;}),
      loadExtDataFromKV().then(r=>{bootStep('ext');return r;}),
      loadKoreanStocksDB()]);
    // 로컬 기본값을 원격 데이터 위에 저장하지 않도록, 확장 KV 로드 성공 뒤에만 자동이체를 실체화한다.
    if(assetsResult?.ok&&extResult?.ok) applyAutoTransfers();
    // 1차: stocks.json 기반으로 티커/초기값 주입 → 화면 즉시 채움
    if(assetsResult?.ok) injectInitialFromStocksDB();
    // 2차: 기존 EOD 시세(Yahoo 기반) 반영 — 페이지 진입 시 '전일 종가 갱신' 버튼과 동일한 자동 갱신
    // 시세 반영이 끝나면 로딩 화면을 걷는다(사용자 결정) — 시세 조회가 예외로 끝나도(뒤 단계는 예전처럼 멈춘다) 걷는다.
    try{ if(assetsResult?.ok) await refreshMarketPrices(); }
    finally{ bootStep('prices'); }
    // 환율/금 등 Python 데이터도 자산 로드 완료 직후 자동 수집 (버튼 클릭 불필요) — 로딩 화면은 이것을 기다리지 않는다.
    refreshPyData({includeDividends:!!assetsResult?.ok&&!!extResult?.ok})
      .catch(e=>console.warn('[refreshPyData]',e));
    // 벤치마크 차트: 자산·시세(curP) 로드가 끝난 시점에 1회 로드 (고정 타이머 경합 제거).
    //   await 하지 않고 병렬 실행 — 이후 DCA/스냅샷 단계가 벤치마크 로딩을 기다리지 않도록.
    if(assetsResult?.ok) fetchBenchmarkData();
    // DCA는 증권사에서 체결되므로 이 앱에서는 일정만 표시한다.
    // 순자산 일별 스냅샷 저장 (하루 1회)
    if(assetsResult?.ok&&extResult?.ok) await saveNetWorthSnapshot();
    else console.warn('[initDashboard] 원본 KV 로드 실패로 순자산 스냅샷 저장을 건너뜁니다.');
    // 국내 시세 보완은 refreshMarketPrices에서 주 시세 API와 함께 최종 판정한다.
    if(assetsResult?.ok) fetchDivData();
    // 액면분할·병합 자동 반영 — 각 항목의 기준일(splitCheckedAt) 이후 분할만 반영한다.
    if(assetsResult?.ok) checkSplitAdjustments();
  })();
}

// 주소의 미리보기 파라미터만으로 인증을 건너뛸 수 없다. 같은 출처 부모가 소유한
// iframe인지 확인하고, 서버가 세션을 인증한 경우에만 자식 화면을 시작한다.
async function startTrustedLayoutPreview(){
  let embedded=false;
  try {
    embedded=!!_layoutPreviewMode() && window.parent!==window
      && window.parent.location.origin===location.origin
      && window.parent.document.getElementById('layout-preview-frame')?.contentWindow===window;
  } catch(e) {}
  if(!embedded) return false;
  _setAuthenticatedUi(false);
  try {
    const res=await fetch('/api/auth',{method:'GET',credentials:'same-origin',cache:'no-store'});
    if(res.ok && (await res.json()).authenticated===true) _startDashboardAfterAuth();
  } catch(e) { console.warn('[preview auth]',e); }
  return true;
}

window.onload = async function() {
  initAmountPrivacy();
  try { sessionStorage.removeItem('_dashAuth'); } catch(e) {}
  if(await startTrustedLayoutPreview()) return;
  // 페이지를 열 때마다(새로고침 포함) 비밀번호를 다시 받는다.
  // 남아 있는 세션 쿠키를 먼저 서버에서 폐기해, 게이트가 화면 장식에 그치지 않고
  // 실제로 API 호출까지 막히도록 한다. 폐기 요청이 실패해도 게이트는 그대로 띄운다(fail-closed).
  try { await fetch('/api/auth',{method:'DELETE',credentials:'same-origin',cache:'no-store'}); }
  catch(e) { console.warn('[auth] 기존 세션 폐기 실패 — 로그인 화면은 그대로 표시합니다.', e); }
  _setAuthenticatedUi(false);
  document.getElementById('login-pw')?.focus();
};

// 예전 목표 & 리밸런싱 화면의 KV 키. 구버전 클라이언트 호환을 위해 read/write 만 유지한다.
window._targetAlloc = window._targetAlloc || null;  // {groups, region, threshold} — UI 제거, KV 페이로드만 보존

// 국기 인라인 SVG — 이모지 폰트 미지원 환경에서도 태극기(건곤감리)·일장기·성조기를 정확히 렌더
function _mktFlagSvg(market, px) {
  // 태극기는 작은 높이에서 네 괘가 뭉개지기 쉬워 최소 16px을 확보한다.
  const requestedH = px || 13, h = market === 'KR' ? Math.max(requestedH, 16) : requestedH;
  const w = Math.round(h * 1.5);
  const open = `<svg width="${w}" height="${h}" viewBox="0 0 36 24" style="display:inline-block;vertical-align:-2px;border:1px solid rgba(0,0,0,.15);border-radius:2px">`;
  if (market === 'JP') {
    return `${open}<rect width="36" height="24" fill="#fff"/><circle cx="18" cy="12" r="7" fill="#bc002d"/></svg>`;
  }
  if (market === 'US') {
    let s = '';
    for (let i = 0; i < 13; i++) s += `<rect x="0" y="${(i * 24 / 13).toFixed(2)}" width="36" height="${(24 / 13).toFixed(2)}" fill="${i % 2 === 0 ? '#b22234' : '#fff'}"/>`;
    s += `<rect x="0" y="0" width="15" height="${(7 * 24 / 13).toFixed(2)}" fill="#3c3b6e"/>`;
    // 별 대용 흰 점 격자 (작은 아이콘에서 성조기 식별용)
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) s += `<circle cx="${(1.6 + c * 2.9).toFixed(2)}" cy="${(1.8 + r * 3).toFixed(2)}" r="0.6" fill="#fff"/>`;
    return `${open}${s}</svg>`;
  }
  // KR — 태극기: 흰 바탕 + 태극(적/청) + 건곤감리 4괘
  const cx = 18, cy = 12, R = 6.4, r = R / 2;
  const taeguk = `<g transform="rotate(-33.69 ${cx} ${cy})"><circle cx="${cx}" cy="${cy}" r="${R}" fill="#0047a0"/>`
    + `<path d="M ${cx - R} ${cy} a ${R} ${R} 0 0 1 ${2 * R} 0 a ${r} ${r} 0 0 1 ${-R} 0 a ${r} ${r} 0 0 0 ${-R} 0 z" fill="#cd2e3a"/></g>`;
  // 3바 괘: pat=[상,중,하] (true=이어진 막대, false=끊긴 막대), (cx,cy) 중심
  const tw = 8.4, th = 1.7, gap = 1.15, brk = 1.8;
  const tri = (tcx, tcy, pat) => pat.map((solid, i) => {
    const y = (tcy + (i - 1) * (th + gap) - th / 2).toFixed(2);
    if (solid) return `<rect x="${(tcx - tw / 2).toFixed(2)}" y="${y}" width="${tw}" height="${th}" fill="#111"/>`;
    const seg = ((tw - brk) / 2).toFixed(2);
    return `<rect x="${(tcx - tw / 2).toFixed(2)}" y="${y}" width="${seg}" height="${th}" fill="#111"/><rect x="${(tcx + brk / 2).toFixed(2)}" y="${y}" width="${seg}" height="${th}" fill="#111"/>`;
  }).join('');
  // 법정 도안처럼 네 괘를 태극을 향한 대각선 축으로 배치해 작은 아이콘에서도 눌려 보이지 않게 한다.
  const gwae = `<g transform="rotate(-33.69 7.5 5.2)">${tri(7.5, 5.2, [true, true, true])}</g>`       // 건 ☰ 좌상
    + `<g transform="rotate(33.69 28.5 5.2)">${tri(28.5, 5.2, [false, true, false])}</g>`              // 감 ☵ 우상
    + `<g transform="rotate(33.69 7.5 18.8)">${tri(7.5, 18.8, [true, false, true])}</g>`               // 리 ☲ 좌하
    + `<g transform="rotate(-33.69 28.5 18.8)">${tri(28.5, 18.8, [false, false, false])}</g>`;          // 곤 ☷ 우하
  return `${open}<rect width="36" height="24" fill="#fff"/>${taeguk}${gwae}</svg>`;
}
