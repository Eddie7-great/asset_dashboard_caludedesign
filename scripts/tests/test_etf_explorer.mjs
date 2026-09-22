import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {load} from 'cheerio';
const ctx=vm.createContext({console,Date,Map,Set,window:{},cbStrip:t=>String(t||'').replace(/\.(KS|KQ)$/,'')});
vm.runInContext(fs.readFileSync('etf-explorer.js','utf8'),ctx);
const s=(holdings,extra={})=>({name:'Fund',asOf:'2026-09-07',source:'provider',coverage:'full',holdings,...extra});
const h=(t,w)=>({t,n:t,w});
const now=new Date('2026-09-09T04:00:00Z');
assert.equal(ctx.etfQuality(s([h('A',50)]),now).reliable,true);
assert.equal(ctx.etfQuality(s([h('A',50)],{coverage:'partial'}),now).reliable,false);
assert.equal(ctx.etfQuality(s([h('A',50)],{asOf:null}),now).age,null);
assert.equal(ctx.etfQuality(s([h('A',50)],{retained:true}),now).reliable,false);
assert.equal(ctx.etfQuality(s([h('A',50)],{asOf:'2026-09-03',active:true}),now).stale,true);
assert.equal(ctx.etfQuality(s([h('A',50)],{asOf:'2026-09-03'}),now).stale,false);
assert.equal(ctx.etfBusinessAge('2026-09-04',new Date('2026-09-07T03:00:00Z')),1);
assert.equal(ctx.etfQuality(s([{t:'ESU6',n:'S&P500 EMINI FUT SEPT2026',w:8}]),now).rows.length,0);
assert.equal(ctx.etfQuality(s([h('A',NaN)]),now).reliable,false);

// 월 1회 공시 상품(disclosure:'monthly')은 5평일이 아니라 35평일 기준을 쓴다 —
// 1629(NEXT FUNDS)가 월말 공시 2주 뒤에도 '지연'으로 찍히던 걸 고친 값이다.
// snapshot_stale(scripts/collect_etf_holdings.py)이 이 숫자와 반드시 같아야 한다.
const monthlyNow=new Date('2026-09-22T04:00:00Z');
assert.equal(ctx.etfQuality(s([h('A',50)],{asOf:'2026-08-31',disclosure:'monthly'}),monthlyNow).stale,false,
  '월간 공시 상품은 16평일 경과로는 지연이 아니다');
assert.equal(ctx.etfQuality(s([h('A',50)],{asOf:'2026-08-31'}),monthlyNow).stale,true,
  '같은 기준일도 disclosure가 없으면(일반 5평일 규칙) 지연이다');
assert.equal(ctx.etfQuality(s([h('A',50)],{asOf:'2026-06-30',disclosure:'monthly'}),monthlyNow).stale,true,
  '월간 공시 상품도 두 달 이상 갱신이 없으면 지연이다');
// 최상위 const는 vm 컨텍스트 프로퍼티가 아니라 코드 문자열로 읽는다.
assert.equal(vm.runInContext('ETF_MONTHLY_DISCLOSURE_LIMIT_WEEKDAYS',ctx),35);
const old=s([h('A',30),h('B',20)]),current=s([h('A',35),h('C',10)],{asOf:'2026-09-08'});
let d=ctx.etfCompareSnapshots(current,old);
assert.equal(d.complete,true);assert.equal(d.rows.find(x=>x.t==='B').kind,'편출');assert.equal(d.rows.find(x=>x.t==='C').kind,'편입');
assert.equal(d.rows.find(x=>x.t==='A').delta,5);assert.equal(d.rows.find(x=>x.t==='A').w,35,'No renormalization to 100%');
d=ctx.etfCompareSnapshots({...current,coverage:'partial'},old);
assert.equal(d.complete,false);assert.equal(d.rows.length,1,'Partial lists only compare shared tickers');
assert.equal(ctx.etfCompareSnapshots({...current,source:'other'},old).comparable,false);
assert.equal(ctx.etfCompareSnapshots(current,null).rows.length,0);
assert.equal(ctx.etfCompareSnapshots(current,current).rows.length,0);
ctx.window._krStocksDB={byCode:new Map([['005930',{name:'삼성전자'}],['005935',{name:'삼성전자우'}]])};
ctx.pfolioData=[];
ctx.cbEsc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
ctx.cbDisp=value=>'₩'+value;
assert.equal(ctx.etfIdentity({t:'005930.KS',n:'SAMSUNG (005930)'}).name,'삼성전자');
assert.equal(ctx.etfIdentity({t:'005935',n:'SAMSUNG'}).name,'삼성전자우','Distinct Korean share classes keep their own company names');
assert.equal(ctx.etfIdentity({t:'005930',n:'삼성전자'}).showTicker,false);
for(const name of ['NVIDIA (NVDA)','NVIDIA · NVDA','NVIDIA NVDA']){
  const html=ctx.etfIdentityHtml({t:'NVDA',n:name}),$=load(html);
  assert.equal($('.etf-company b').text(),'NVIDIA');
  assert.equal($('.etf-company small').text(),'NVDA');
  assert.equal(($.text().match(/NVDA/g)||[]).length,1,'Ticker is rendered once beside the company');
}
assert.equal(load(ctx.etfIdentityHtml({t:'X',n:'<img src=x onerror=alert(1)>'}))('img').length,0);
const bars=load(ctx.etfRankChart([h('A',5),h('B',20),h('C',10)]));
assert.equal(bars('.etf-rank-row').first().attr('data-etf-ticker'),'B');
assert.equal(bars('.etf-rank-row').first().find('strong').text(),'20.00%','Bars keep original NAV weights');
assert.equal(bars('canvas').length,0,'The graph never swaps to a WebGL canvas');
const row=(owner,tkr,val,etf=false,grp='주식')=>({i:{owner,tkr,grp,etf},title:tkr,val});
ctx.cbIsEtf=i=>i.etf;
const portfolio=[row('본인','NVDA',200),row('본인','F',100,true),row('본인','F',300,true),row('본인','KRW',200,false,'현금'),row('본인','BTC',100,false,'가상화폐'),row('본인','GOLD',100,false,'금'),row('아내','F',2000,true),row('아내','NVDA',1000)];
const data={etfs:{F:s([h('NVDA',20),h('005930',10)])}};
const saved=JSON.stringify({portfolio,data});
let exposures=ctx.etfExposure('NVDA',portfolio,data,'전체',now),self=exposures.find(o=>o.owner==='본인'),spouse=exposures.find(o=>o.owner==='아내');
assert.equal(self.total,1000,'ETF constituents must not be added to the portfolio denominator');
assert.equal(self.directPct,20);assert.equal(self.indirectPct,8);assert.ok(Math.abs(self.totalPct-28)<1e-10);
assert.equal(self.routes.length,1,'Multiple accounts for the same ETF are combined');
assert.equal(self.routes[0].etfValue,400);assert.equal(self.routes[0].value,80);
assert.ok(Math.abs(self.directShare-200/280*100)<1e-10);
assert.equal(self.directShare+self.indirectShare,100);
assert.equal(spouse.total,3000);assert.ok(Math.abs(spouse.totalPct-1400/3000*100)<1e-10);
assert.equal(ctx.etfExposure('NVDA',portfolio,data,'아내',now).length,1);
assert.equal(ctx.etfExposure('005930',portfolio,data,'본인',now)[0].indirectPct,4,'Indirect-only constituents count without a direct stock position');
const whole=ctx.etfExposure('NVDA',[row('본인','NVDA',300),row('본인','F',700,true)],{etfs:{F:s([h('NVDA',100)])}},'본인',now)[0];
assert.equal(whole.totalPct,100);assert.equal(whole.directShare,30);assert.equal(whole.indirectShare,70);
const empty=ctx.etfExposure('NVDA',[row('본인','NVDA',0)],data,'본인',now)[0];
assert.equal(empty.totalPct,null);assert.equal(empty.directShare,null);
assert.equal(ctx.etfExposure('NVDA',[row('본인','NVDA',Infinity)],data,'본인',now)[0].valid,false);
const partial={etfs:{F:s([h('OTHER',10)],{coverage:'partial',asOf:null})}};
assert.equal(ctx.etfExposure('NVDA',portfolio,partial,'본인',now)[0].uncertain.length,1);
ctx.cbAllRows=()=>[row('본인','F',100,true)];ctx.cbEtfDoc=()=>partial;
const unknownHtml=load(ctx.etfExposureHtml('NVDA',{t:'NVDA',n:'NVIDIA'}));
assert.equal(unknownHtml('.etf-exposure-total strong').text(),'미확인');
assert.match(unknownHtml('.etf-stock-split').text(),/비율 미확정/);
assert.equal(unknownHtml('details.etf-owner-exposure > summary.etf-owner-summary').length,1,'The complete owner card is a native keyboard-operable disclosure');
assert.equal(unknownHtml('details details').length,0,'No nested disclosure targets');
const toggleContext=vm.createContext({document:{activeElement:null},cbRestoreFilterFocus(){}});
vm.runInContext(fs.readFileSync('etf-explorer.js','utf8'),toggleContext);
vm.runInContext('etfRefreshResults=()=>{};cbRenderEtfExplorer=()=>{};',toggleContext);
toggleContext.etfSelect('NVDA');
assert.equal(vm.runInContext('_etfSelected',toggleContext),'NVDA');
toggleContext.etfSelect('NVDA');
assert.equal(vm.runInContext('_etfSelected',toggleContext),null,'A second click explicitly clears the stock instead of reselecting the first row');
toggleContext.etfOwner('본인');toggleContext.etfOwner('본인');
assert.equal(vm.runInContext('_etfOwner',toggleContext),'전체');
assert.equal(JSON.stringify({portfolio,data}),saved,'Exposure exploration does not mutate financial records or published snapshots');
const cobalt=fs.readFileSync('cobalt.js','utf8');
const loader=cobalt.slice(cobalt.indexOf('let _cbEtfPromise='),cobalt.indexOf('\nfunction cbIsEtf('));
let requests=[],fail=false,remoteFail=false;
const good={etfs:{F:current}};
const loadContext=vm.createContext({window:{},AbortController,setTimeout,clearTimeout,cbRerender(){},
  fetch:async url=>{requests.push(url);if(fail||(remoteFail&&url.startsWith('https://')))throw new Error('offline');return {ok:true,json:async()=>good};}});
vm.runInContext('let _cbEtfLoading=false;'+loader,loadContext);
await loadContext.cbEnsureEtfHoldings();assert.equal(requests.length,1);assert.match(requests[0],/^https:\/\/raw\.githubusercontent\.com/);assert.equal(loadContext.window._etfHoldings,good);
await loadContext.cbEnsureEtfHoldings();assert.equal(requests.length,1,'Do not fetch again on every rerender');
fail=true;await loadContext.cbEnsureEtfHoldings(true);
assert.equal(loadContext.window._etfHoldings,good,'Failed refresh preserves the last valid file');
assert.equal(loadContext.window._etfLoadError,true);
fail=false;remoteFail=true;await loadContext.cbEnsureEtfHoldings(true);
assert.equal(requests.length,5);assert.equal(requests.at(-1),'data/etf_holdings.json');
assert.equal(loadContext.window._etfLoadError,false,'The deployed snapshot recovers when GitHub is unavailable');
// ── ETF 탐색 화면 계약 ─────────────────────────────────────────────
const explorerSource=fs.readFileSync('etf-explorer.js','utf8');
const explorerCss=fs.readFileSync('etf-explorer.css','utf8');
// 진입 시 etfRefreshOnOpen 이 이미 돌므로(cobalt.js CB_VIEWS) 같은 일을 하는 버튼은 없앴다.
assert.doesNotMatch(explorerSource,/자료 다시 확인/,'툴바의 재확인 버튼은 제거됐다');
assert.match(cobalt,/if\(id==='etf2'\)etfRefreshOnOpen\(\)/,'페이지 진입이 조회 경로를 대신한다');
// 구성종목 / 비중 변화 두 모드를 버튼으로 오가던 구조를 없앴다 — 한 표에 비중과 변화를
// 함께 싣는다. 모드가 사라졌으므로 비교 기준을 숨겼다 폈다 할 이유도 없다.
assert.doesNotMatch(explorerSource,/_etfMode|etfMode\(/,'모드 상태와 토글 함수가 사라졌다');
assert.doesNotMatch(explorerSource,/etf-tabs/,'구성종목·비중 변화 탭 줄이 사라졌다');
assert.doesNotMatch(explorerCss,/etf-tabs|is-changes/,'탭과 diff 표 변형 CSS 도 함께 지웠다');
assert.doesNotMatch(explorerSource,/is-hidden/,'비교 기준을 숨기는 삼항이 없다 — 항상 보인다');
assert.match(explorerSource,/class="etf-filters">[\s\S]{0,600}class="etf-compare">비교 기준/,'비교 기준은 검색과 같은 필터 줄에 상시 표시한다');
// 표는 항상 종목·비중·변화 3열. 변화는 비교 기준 스냅샷과의 차이를 티커로 붙인다.
assert.match(explorerSource,/<span>종목<\/span><span>비중<\/span><span>변화<\/span>/,'변화 칼럼을 상시 포함한다');
assert.match(explorerSource,/const deltas=new Map\(diff\.rows\.map/,'변화는 비교 스냅샷을 티커로 찾아 붙인다');
// 점검 ETF 는 본문을 가리지 않게 페이지 하단, 출처 바로 위로 내렸다.
assert.match(explorerSource,/id="etf-network"><\/section>\s*\$\{etfInspectionHtml\(m\.funds\)\}\s*<details class="cb-panel etf-method">/,'점검 위젯은 소유주별 비중 뒤, 출처 앞이다');
assert.match(explorerCss,/\.etf-fund-value\{display:flex;flex-direction:row/,'선택 ETF 평가액은 라벨과 값을 나란히 놓는다');
// 점검 위젯은 '왜 점검인지'만 남긴다 — 소스 시도 이력은 툴바의 role="status" 줄에 계속 있다.
assert.doesNotMatch(explorerSource,/state\?\.attempts\|\|\[\]/,'점검 행에서 소스 시도 이력을 빼 사유를 앞세운다');
assert.match(explorerSource,/etf-inspection-row[\s\S]{0,400}\$\{cbEsc\(q\.label\)\} · 기준/,'이름과 한 줄 사유만 남긴다');
// 총 노출이 100%를 넘는 구조(담보 위 스왑)를 숫자 옆에서 설명한다. 재정규화하지 않는다.
assert.equal(ctx.etfWeightSum([h('A',59.11),h('B',41.08)]).toFixed(2),'100.19','비중 합은 그대로 더한다');
assert.match(explorerSource,/etfWeightSum\(q\.rows\)>100\?' 합계가 100%를 넘는 것은/,'100% 초과를 설명하는 문구를 붙인다');

// ── 직접 보유 판정은 새 필터와 겹침 카드가 공유하는 하나뿐이다 ──────────
// 예전에는 cbLookThrough 와 etfExposure 가 같은 판정을 각자 인라인으로 갖고 있었다.
// 새로 생기는 두 곳(체크박스·겹침 카드)은 cbDirectStockMap 하나만 쓴다.
const cobaltSrc=fs.readFileSync('cobalt.js','utf8');
const directCtx=vm.createContext({
  Map,
  cbStrip:t=>String(t||'').toUpperCase().replace(/\.(KS|KQ|T)$/,''),
  cbIsEtf:i=>!!i.isEtf,
  cbAllRows:()=>[
    {i:{owner:'본인',grp:'주식',tkr:'005930.KS'},title:'삼성전자',val:100},
    {i:{owner:'본인',grp:'주식',tkr:'005930'},   title:'삼성전자',val:50},   // 같은 종목, 다른 계좌
    {i:{owner:'아내',grp:'주식',tkr:'NVDA'},     title:'NVIDIA',  val:70},
    {i:{owner:'본인',grp:'주식',tkr:'QQQ',isEtf:true},title:'QQQ',val:900},  // ETF 는 제외
    {i:{owner:'본인',grp:'현금',tkr:'KRW'},      title:'예수금',  val:300},  // 주식 아님
  ],
});
vm.runInContext(cobaltSrc.slice(cobaltSrc.indexOf('function cbDirectStockMap('),cobaltSrc.indexOf('function cbLookThrough(')),directCtx);
const allDirect=directCtx.cbDirectStockMap('전체');
assert.deepEqual([...allDirect.keys()].sort(),['005930','NVDA'],'개별 주식만, 정규화 티커로 모은다');
assert.equal(allDirect.get('005930').val,150,'같은 종목의 여러 계좌를 합산한다');
assert.ok(!allDirect.has('QQQ'),'ETF 는 겹침의 대상이 아니라 경로다');
assert.ok(!allDirect.has('KRW'),'현금은 주식이 아니다');
const mine=directCtx.cbDirectStockMap('본인');
assert.deepEqual([...mine.keys()],['005930'],'소유주를 고르면 그 사람 것만 센다');
assert.equal(directCtx.cbDirectStockMap().size,2,'소유주 미지정은 가구 전체');

// 체크박스는 검색과 AND 로 걸리고, 누를 때마다 1페이지로 돌아간다.
assert.match(explorerSource,/function etfDirectOnly\(on\)\{_etfDirectOnly=!!on;_etfPage=0;etfRefreshResults\(\);\}/,'직접 보유 토글은 목록만 다시 그린다');
assert.match(explorerSource,/\.filter\(h=>!_etfQuery\|\|[\s\S]{0,160}\)\s*\.filter\(h=>!direct\|\|direct\.has\(cbStrip\(h\.t\)\)\)/,'검색과 직접 보유 필터가 AND 로 겹친다');
assert.match(explorerSource,/const direct=_etfDirectOnly\?cbDirectStockMap\(_etfOwner\):null/,'필터도 공용 판정을 쓰고 소유주 범위를 따른다');
// 겹침 카드는 잠정 자료를 '겹치는 종목 없음'으로 단정하지 않는다.
assert.match(explorerSource,/function etfOverlapHtml\(m\)\{[\s\S]*cbDirectStockMap\(_etfOwner\)/,'겹침 카드도 같은 판정을 쓴다');
assert.match(explorerSource,/const provisional=!m\.quality\.reliable/,'구성종목이 잠정이면 그 사실을 표시한다');
assert.match(explorerSource,/겹치는 종목이 더 있을 수 있습니다/,'잠정 자료로 0 건을 단정하지 않는다');

console.log('PASS ETF freshness, company labels, owner portfolio denominators, direct/indirect exposure, incomplete-data safeguards and explorer layout contracts');
