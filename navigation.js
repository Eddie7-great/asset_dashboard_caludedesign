// Menu families use existing view IDs so saved links and browser history stay valid.
const APP_NAV = [
  {menu:'dashboard',title:'홈',views:[['cdash','홈']]},
  {menu:'holdings',title:'자산 관리',views:[['holdings','보유 목록'],['etf2','ETF 탐색'],['fam2','구성원 비교'],['bubble','비중 분석']]},
  {menu:'perf2',title:'투자 분석',views:[['perf2','성과'],['risk2','리스크']]},
  {menu:'divm',title:'배당',views:[['divm','배당']]},
  {menu:'plan2',title:'투자 계획',views:[['plan2','목표'],['rebal2','리밸런싱'],['dca2','적립식 매수'],['sim2','투자 시뮬레이터']]},
  {menu:'cashflow',title:'현금 흐름',views:[['cashflow','현금 흐름']]},
  {menu:'tax2',title:'세금·증여',views:[['tax2','실현손익·세금'],['gift2','가족 증여']]},
];
function navResolve(id){ return id==='snap'||id==='dashboard'||id==='balance2'?'cdash':id; }
function navGroup(id){ return APP_NAV.find(g=>g.views.some(v=>v[0]===navResolve(id))); }
function navOwner(id){
  if(id==='etf2')return _etfOwner;
  if(id==='holdings'||id==='bubble')return currentOwner||'전체';
  if(id==='fam2')return _famKey==='all'?'전체':_famKey;
  if(id==='cdash')return _cdashOwner;
  if(id==='plan2'||id==='rebal2')return _finPlanOwner;
  if(id==='dca2')return _cbDcaOwner;
  if(id==='sim2')return _simOwner;
  return null;
}
function navPrepare(id){
  const previous=document.querySelector('.view-section.active')?.id.replace('view-','');
  const from=navGroup(previous),to=navGroup(id);
  // Keep an owner's scope when moving between related tabs or following a home action.
  if(from&&to&&(from===to||previous==='cdash')){
    const owner=navOwner(previous); if(!owner)return;
    if(id==='holdings'||id==='bubble')currentOwner=owner;
    if(id==='fam2')_famKey=owner==='전체'?'all':owner;
    if(id==='etf2')_etfOwner=owner;
    if(id==='plan2'||id==='rebal2')_finPlanOwner=owner;
    if(id==='dca2')_cbDcaOwner=owner;
    if(id==='sim2')_simOwner=owner;
    if(id==='balance2')_finBalanceOwner=owner;
    if(id==='divm')_cbDivOwner=owner;
    if(id==='risk2')_cbRiskOwner=owner;
  }
}
function navSync(id){
  const group=navGroup(id),bar=document.getElementById('page-sections');
  document.querySelectorAll('.menu-btn,.footer-status-btn').forEach(b=>{
    const active=b.id==='menu-'+(group?.menu||id);
    b.classList.toggle('active',active);
    if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
  });
  if(group){
    document.getElementById('main-title').textContent=group.title;
    expandActiveMenuGroup(document.getElementById('menu-'+group.menu));
  }
  if(id==='holdings')document.querySelectorAll('#owner-tabs-container .owner-btn').forEach(b=>{
    const active=b.textContent.trim()===currentOwner;
    b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));
  });
  if(!bar)return;
  bar.hidden=!group||group.views.length<2;
  bar.setAttribute('aria-label',(group?.title||'화면')+' 세부 메뉴');
  bar.innerHTML=group&&group.views.length>1?group.views.map(([view,label])=>
    `<a href="#view=${view}"${view===id?' aria-current="page"':''} onclick="if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();switchView('${view}');">${label}</a>`).join(''):'';
}
let _assetQ='';
function cbAssetMobile(){
  const q=_assetQ.trim().toLowerCase();
  const rows=cbMergeRows(finRows(finOwnerF(currentOwner))).filter(r=>!q||[r.title,r.subTitle,r.i.tkr,r.i.owner].join(' ').toLowerCase().includes(q));
  document.getElementById('portfolio-tables').innerHTML=cbMobileHoldings(cbSortOwnerNameVal(rows),_assetQ,'cbAssetSearch');
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
