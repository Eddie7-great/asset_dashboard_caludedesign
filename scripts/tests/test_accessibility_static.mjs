import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const css = readFileSync(resolve(root, 'style.css'), 'utf8');
const cobalt = readFileSync(resolve(root, 'cobalt.js'), 'utf8');
const script = readFileSync(resolve(root, 'script.js'), 'utf8');
const finance = readFileSync(resolve(root, 'finance.js'), 'utf8');

assert.match(html, /<form\b[^>]*id="login-form"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="login-title"[^>]*aria-busy="false"[^>]*onsubmit=/);
assert.match(html, /<label\b[^>]*for="login-pw"[^>]*>비밀번호<\/label>/);
assert.match(html, /id="login-pw"[^>]*aria-describedby="login-help login-error"[^>]*aria-invalid="false"/s);
assert.match(html, /id="login-error"[^>]*role="alert"[^>]*aria-live="assertive"/);
assert.match(html, /<div class="layout" inert aria-hidden="true">/, '로그인 전 본문은 포커스·접근성 트리에서 격리');

assert.match(html, /class="modal-content f-col"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="modal-title"[^>]*tabindex="-1"/);
assert.match(html, /class="cf-modal-content"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="cf-details-header"[^>]*tabindex="-1"/);
assert.match(html, /class="modal-close"[^>]*aria-label="[^"]+"/);
assert.match(html, /class="cf-modal-close"[^>]*aria-label="[^"]+"/);

assert.match(html, /<nav\b[^>]*id="sidebar-menu"[^>]*aria-label="[^"]+"/);
assert.match(html, /id="menu-dashboard"[^>]*aria-current="page"/);
assert.match(cobalt, /removeAttribute\('aria-current'\)/, '화면 전환 시 이전 메뉴의 현재 페이지 상태 제거');
assert.match(cobalt, /setAttribute\('aria-current','page'\)/, '화면 전환 시 새 메뉴에 현재 페이지 상태 설정');
assert.match(cobalt, /cb-snap-month[^`]+tabindex="0"[^`]+role="img"[^`]+aria-label=/, '월별 배당 막대 키보드·스크린리더 지원');
assert.match(script, /addEventListener\('focusin',[\s\S]*showTableFloatTip/, '키보드 포커스에서도 설명 툴팁 표시');
assert.match(script, /addEventListener\('focusout',[\s\S]*hideTableFloatTip/, '키보드 포커스 이탈 시 설명 툴팁 닫기');
// 터치 기기에는 hover 도 focus 도 없다. 탭으로 열고 바깥 탭으로 닫히지 않으면
// 폰에서는 기준·면책 설명(data-tip)을 읽을 방법이 전혀 없다.
assert.match(script, /_tipTouchPointer[\s\S]*addEventListener\('click',[\s\S]*showTableFloatTip/, '터치 탭으로 설명 툴팁 열기');
// 차트 터치는 문서 위임으로 붙인다 — SVG <rect> 의 인라인 onpointerdown 은 동작하지 않는다.
assert.match(script, /addEventListener\('pointerdown'[\s\S]*data-chart-hit[\s\S]*finNwHover[\s\S]*cbPerfHover/, '차트 히트 영역 터치를 문서 위임으로 처리');
assert.match(script, /data-chart-hit[\s\S]*cb-perf-tip/, '차트 밖을 탭하면 차트 툴팁 닫기');
assert.match(finance, /data-chart-hit="finNw:\$\{i\}"/, '순자산 추이 차트 히트 영역에 위임용 인덱스 표식');
assert.match(cobalt, /data-chart-hit="perf:\$\{i\}"/, '성과 비교 차트 히트 영역에 위임용 인덱스 표식');
// 터치가 흉내 내는 mouseout 이 방금 연 설명을 즉시 닫아버리던 문제를 막는 유예 창.
assert.match(script, /TOUCH_MOUSE_GRACE[\s\S]*mouseFromTouch/, '터치 직후 흉내 마우스 이벤트를 무시');
// Chart.js CDN 이 죽어도 initDashboard 가 끝까지 돌아야 한다 — 여기서 멈추면 KV 로드까지
// 실행되지 않아 자산·순자산·배당이 전부 빈 화면이 된다.
assert.match(script, /if \(typeof Chart === 'undefined'\) \{\s*\n\s*window\.cfDonutChartInst = null; window\.cfTrendChartInst = null;\s*\n\s*\} else \{/, 'Chart.js 로드 실패 시 현금 흐름 차트 생성을 건너뛴다');
// 모바일에서 헤더 소제목을 통째로 숨기면 '전일 종가 기준' 같은 면책 문구가 사라진다 → 토글로 대체.
assert.match(html, /id="page-sub-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="main-title-sub"[^>]*aria-label=/, '모바일 설명 토글 버튼');
assert.match(css, /body\.head-sub-open #main-title-sub\{display:block/, '토글을 열면 모바일에서도 소제목이 보인다');
assert.match(cobalt, /function cbSetHead[\s\S]*page-sub-toggle[\s\S]*cbHeadSubOpen\(false\)/, '화면을 옮기면 이전 화면 설명은 접는다');

const canvases = [...html.matchAll(/<canvas\b([^>]*)>([\s\S]*?)<\/canvas>/g)];
// 레거시 뷰 7개를 걷어내면서 캔버스는 현금 흐름의 둘만 남았다. Cobalt 페이지는
// Chart.js 대신 인라인 SVG 를 쓰므로 앞으로도 캔버스가 크게 늘 이유가 없다.
assert.ok(canvases.length >= 2, `expected at least 2 canvases, found ${canvases.length}`);
// 보이지 않는 캔버스에 Chart 인스턴스를 만들어 갱신하는 패턴을 다시 들이지 않는다
// (예전 gaugeUs·gaugeCrypto·historyChart·miniDivChart·familyBarChart 가 그랬다).
assert.doesNotMatch(html, /<canvas\b[^>]*style="[^"]*display:\s*none/, '숨겨진 캔버스 금지');
for (const [, attrs, fallback] of canvases) {
  const id = attrs.match(/\bid="([^"]+)"/)?.[1] ?? '(unknown)';
  assert.match(attrs, /\brole="img"/, `${id} must expose an image role`);
  assert.match(attrs, /\baria-label="[^"]+"/, `${id} must have an accessible name`);
  assert.ok(fallback.trim().length > 0, `${id} must provide fallback text`);
}

const sourcedScripts = [...html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)><\/script>/g)];
// 레거시 뷰를 걷어내며 유일한 Highcharts 사용처(히트맵 트리맵)가 사라져 CDN 3개를 제거했다.
// 남은 외부 스크립트는 Chart.js(현금 흐름 차트)와 Plotly(비중 차트) 둘뿐이다.
assert.ok(sourcedScripts.length >= 2, `expected at least 2 sourced scripts, found ${sourcedScripts.length}`);
for (const [, before, src, after] of sourcedScripts) {
  assert.match(`${before} ${after}`, /\bdefer\b/, `${src} must be deferred`);
}
assert.doesNotMatch(html, /code\.highcharts\.com/, 'Highcharts 는 더 이상 로드하지 않는다');
// 남은 CDN 스크립트는 모두 SRI + crossorigin 을 갖춰야 한다.
for (const [, before, src, after] of sourcedScripts) {
  if (!/^https?:/.test(src)) continue;
  assert.match(`${before} ${after}`, /integrity="sha384-[^"]+"/, `${src} must use SRI`);
  assert.match(`${before} ${after}`, /crossorigin="anonymous"/, `${src} must set crossorigin`);
}

assert.doesNotMatch(html, /<(?:div|span|th|tr|li|a)\b[^>]*\bonclick=/i);
assert.match(css, /:focus-visible/);
assert.match(css, /prefers-reduced-motion\s*:\s*reduce/);
assert.match(css, /@media\s*\(pointer:coarse\)/);
assert.match(css, /@media\s*\(max-width:400px\)[\s\S]*?#login-overlay[\s\S]*?padding/);

console.log(`PASS: static accessibility and loading checks (${canvases.length} canvases)`);
