// Menu families use existing view IDs so saved links and browser history stay valid.
const APP_NAV = [
  {menu:'dashboard',title:'홈',views:[['cdash','홈']]},
  {menu:'holdings',title:'자산 관리',views:[['holdings','보유 목록']]},
  {menu:'perf2',title:'투자 분석',views:[['perf2','성과'],['risk2','리스크'],['bubble','구성'],['chart2','차트 공부'],['screen2','종목 찾기']]},
  {menu:'divm',title:'배당',views:[['divm','배당']]},
  {menu:'plan2',title:'투자 계획',views:[['plan2','목표'],['rebal2','리밸런싱'],['sim2','투자 시뮬레이터']]},
  {menu:'cashflow',title:'현금 흐름',views:[['cashflow','현금 흐름']]},
  {menu:'tax2',title:'세금·증여',views:[['tax2','실현손익·세금'],['gift2','가족 증여']]},
  {menu:'report2',title:'결산 리포트',views:[['report2','결산']]},
];
// 페이지 통폐합(2026-11-19): 세부 메뉴에 따로 없는 화면이 속한 세부 메뉴. 화면 id·#view= 주소는 그대로라 옛 링크도 열린다.
// 적립식 매수(dca2)는 2026-11-23 투자 계획에서 보유 목록의 넷째 보기로 옮겼다(사용자 결정) — 조회 화면과 수정하는 곳(보유 목록 적립식 칸)을 한 메뉴에 둔다.
// 종목 찾기(2026-11-26 사용자 결정): 한 화면 안 탭(추세추종·가치투자·둘 다·매크로). 종목 상세(추세추종·가치투자)는 표에서 티커를 눌러 들어가는 화면이라 세부 메뉴에 따로 두지 않는다.
const NAV_HOST = {trend2:'screen2', value2:'screen2', macro2:'screen2', acct2:'holdings', fam2:'holdings', dca2:'holdings', etf2:'bubble', reporty:'report2', cal2:'cashflow'};
// 한 세부 메뉴 안의 보기 전환(같은 보유·같은 결산을 묶음만 바꿔 본다) — 머리줄 아래 오른쪽 밑줄형 줄(#view-mode-bar).
// 현금 흐름의 월별·고정비·일정은 머리줄의 #cf-header-tabs 가 맡는다.
const NAV_MODES = {
  holdings:[['holdings','종목별'],['acct2','계좌별'],['fam2','구성원별'],['dca2','적립식']],
  bubble:[['bubble','비중 지도'],['etf2','ETF 속 종목']],
  report2:[['report2','월간'],['reporty','연간']],
};
let _navModeLast={}, _navKeepOwner=false, _navAssetQ='';
function navResolve(id){ return id==='snap'||id==='dashboard'||id==='balance2'?'cdash':id; }
function navHost(id){ id=navResolve(id); return NAV_HOST[id]||id; }
function navGroup(id){ const host=navHost(id); return APP_NAV.find(g=>g.views.some(v=>v[0]===host)); }
// 세부 메뉴를 누르면 그 메뉴에서 마지막으로 본 보기로 간다(메모리에만, 처음엔 첫 보기).
function navModeTarget(view){ const last=_navModeLast[view]; return last&&NAV_HOST[last]===view?last:view; }
function navOwner(id){
  if(id==='etf2')return _etfOwner;
  if(id==='holdings')return currentOwner||'전체';
  if(id==='bubble')return _bubbleOwner||currentOwner||'전체';
  if(id==='cashflow')return _cfOwner;
  if(id==='fam2')return _famKey==='all'?'전체':_famKey;
  if(id==='cdash')return _cdashOwner;
  if(id==='plan2'||id==='rebal2')return _finPlanOwner;
  if(id==='dca2')return _cbDcaOwner;
  if(id==='sim2')return _simOwner;
  if(id==='acct2')return _acctOwner;
  if(id==='cal2')return _calOwner;
  if(id==='report2'||id==='reporty')return _reportOwner;
  if(id==='chart2')return _chsOwner;
  return null;
}
function navPrepare(id){
  const previous=document.querySelector('.view-section.active')?.id.replace('view-','');
  const from=navGroup(previous),to=navGroup(id);
  // Keep an owner's scope when moving between related tabs or following a home action.
  if(from&&to&&(from===to||previous==='cdash')){
    const owner=navOwner(previous); if(!owner)return;
    // 레거시 화면(보유 목록·현금 흐름)은 들어올 때 소유주를 '전체'로 되돌린다 — 이어 준 소유주는 한 번 지키게 표식을 남긴다.
    if(id==='holdings'||id==='bubble'){currentOwner=owner;_navKeepOwner=true;}
    if(id==='bubble')_bubbleOwner=owner;
    if(id==='cashflow'){_cfOwner=CF_OWNERS.includes(owner)?owner:'전체';_navKeepOwner=true;} // 현금 흐름은 부부(본인·아내)만 다룬다
    if(id==='fam2')_famKey=owner==='전체'?'all':owner;
    if(id==='etf2')_etfOwner=owner;
    if(id==='plan2'||id==='rebal2')_finPlanOwner=owner;
    if(id==='dca2')_cbDcaOwner=owner;
    if(id==='sim2')_simOwner=owner;
    if(id==='acct2')_acctOwner=owner;
    if(id==='cal2')_calOwner=owner;
    if(id==='report2'||id==='reporty')_reportOwner=owner;
    if(id==='divm')_cbDivOwner=owner;
    if(id==='risk2')_cbRiskOwner=owner;
    if(id==='chart2')_chsOwner=owner;
    // 보유 목록 ↔ 구성원별은 같은 보유를 보는 두 보기라 검색어도 잇는다(계좌별을 거쳐 가도 마지막 검색어를 지킨다).
    if(previous==='holdings')_navAssetQ=_holdingsQ;
    if(previous==='fam2')_navAssetQ=_famQ;
    if(from.menu==='holdings'&&id==='holdings')_holdingsQ=_navAssetQ;
    if(from.menu==='holdings'&&id==='fam2')_famQ=_navAssetQ;
  }
}
function navSync(id){
  const group=navGroup(id),host=navHost(id),bar=document.getElementById('page-sections');
  document.querySelectorAll('.menu-btn,.footer-status-btn').forEach(b=>{
    const active=b.id==='menu-'+(group?.menu||id);
    b.classList.toggle('active',active);
    if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
  });
  if(group){
    document.getElementById('main-title').textContent=group.title;
  }
  if(id==='holdings')document.querySelectorAll('#owner-tabs-container .owner-btn').forEach(b=>{
    const active=b.textContent.trim()===currentOwner;
    b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));
  });
  navModeBar(id);
  navCfTabs(id);
  if(!bar)return;
  bar.hidden=!group||group.views.length<2;
  bar.setAttribute('aria-label',(group?.title||'화면')+' 세부 메뉴');
  bar.innerHTML=group&&group.views.length>1?group.views.map(([view,label])=>
    `<a href="#view=${view}"${view===host?' aria-current="page"':''} onclick="if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();switchView(navModeTarget('${view}'));">${label}</a>`).join(''):'';
}
// 보기 전환 줄 — 머리줄 아래(스크롤 영역 밖) 오른쪽, 시뮬레이터 탭과 같은 밑줄형. 보기가 둘 이상인 세부 메뉴에서만 보인다.
function navModeBar(id){
  const el=document.getElementById('view-mode-bar'); if(!el) return;
  const host=navHost(id),modes=NAV_MODES[host];
  el.hidden=!modes;
  el.setAttribute('aria-label',(modes?(navGroup(id)?.views.find(v=>v[0]===host)?.[1]||''):'')+' 보기 전환');
  el.innerHTML=modes?modes.map(([view,label])=>
    `<button type="button" class="cb-btn" data-view-mode="${view}" aria-pressed="${view===id}" onclick="navMode('${view}')">${label}</button>`).join(''):'';
  if(modes)_navModeLast[host]=id;
}
function navMode(view){
  const cur=document.querySelector('.view-section.active')?.id.replace('view-','');
  if(cur===view) return;
  switchView(view);
  if(typeof cbRestoreFilterFocus==='function') cbRestoreFilterFocus('view-mode-bar','data-view-mode',view);
}
// 현금 흐름 머리줄 탭(월별 | 고정비 | 일정) — 일정(cal2)은 다른 화면이지만 같은 탭 줄에서 오간다.
// 현금 흐름 안의 두 구역 강조는 switchCashFlowSection 이 그대로 맡고, 여기서는 일정 화면일 때만 일정 탭을 켠다.
function navCfTabs(id){
  if(id!=='cal2') return;
  document.querySelectorAll('#cf-header-tabs .cf-section-tab').forEach(b=>{
    const sel=b.id==='cf-section-tab-cal';
    b.classList.toggle('active',sel);b.setAttribute('aria-selected',String(sel));
  });
}
// 월별·고정비 버튼: 일정 화면에서 누르면 현금 흐름을 먼저 연 뒤 구역을 바꾼다(현금 흐름 진입이 구역을 월별로 되돌리므로 그 뒤에).
function cfSectionTab(section){
  if(section==='cal'){ if(document.querySelector('.view-section.active')?.id!=='view-cal2') switchView('cal2'); return; }
  if(document.querySelector('.view-section.active')?.id!=='view-cashflow') switchView('cashflow');
  switchCashFlowSection(section,document.getElementById('cf-section-tab-'+section));
}
let _assetQ='',_assetMobileHead='';
// 휴대폰 보유 목록: renderPortfolio 가 계산한 숫자 카드(head) → 자산군 탭 → 조회 전용 카드 목록.
// 숫자 카드는 보관해 두고 검색으로 다시 그릴 때도 그대로 둔다(검색은 행만 숨기고 합계는 바꾸지 않는다).
// 탭 옆 개수는 이 목록에 실제로 보이는 행(계좌 합침 후) 수다.
function cbAssetMobile(head){
  if(head!==undefined)_assetMobileHead=head;
  const q=_assetQ.trim().toLowerCase();
  const all=cbMergeRows(finRows(finOwnerF(currentOwner)));
  const counts={};all.forEach(r=>{counts[r.i.grp]=(counts[r.i.grp]||0)+1;});
  const rows=all.filter(r=>r.i.grp===_holdingsTab&&(!q||[r.title,r.subTitle,r.i.tkr,r.i.owner].join(' ').toLowerCase().includes(q)));
  const tabs='<div class="holdings-tabs holdings-tabs-mobile" role="tablist" aria-label="자산군">'
    +HOLDINGS_TABS.map(g=>`<button type="button" role="tab" class="holdings-tab" data-grp="${g}" aria-selected="${g===_holdingsTab}" tabindex="${g===_holdingsTab?0:-1}" onclick="setHoldingsTab('${g}')">${g}<span>${counts[g]||0}</span></button>`).join('')
    +'</div>';
  document.getElementById('portfolio-tables').innerHTML=_assetMobileHead+tabs+cbMobileHoldings(cbSortOwnerNameVal(rows),_assetQ,'cbAssetSearch');
}
function cbAssetSearch(value){
  _assetQ=value;cbAssetMobile();
  const input=document.getElementById('cb-mobile-search');input?.focus();
  if(input)input.setSelectionRange(value.length,value.length);
}
// Sticky mobile result summary follows the actual header height, including owner tabs.
if(typeof document!=='undefined'&&typeof ResizeObserver!=='undefined'){
  const head=document.getElementById('page-head'),main=document.querySelector('.content-area');
  if(head&&main)new ResizeObserver(()=>main.style.setProperty('--workspace-head-height',head.offsetHeight+'px')).observe(head);
}
