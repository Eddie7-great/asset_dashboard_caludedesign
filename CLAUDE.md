# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

This is a Vercel-hosted single-page app — there is no build step.

- `vercel dev` — run the full stack locally on http://localhost:3000 (serves static `index.html` + `script.js` + `finance.js` + `cobalt.js` + `style.css`, plus the serverless functions under `api/`). `start-server.bat` is a Windows helper that opens Chrome and runs this.
- `npm install` — install the Node deps used by the TypeScript / JavaScript serverless functions (`@vercel/node`, `axios`, `cheerio`, `yahoo-finance2`) **and by the tests** (`cheerio`, `typescript`).
- `npm test` — the full quality gate (`scripts/tests/run_all.mjs`): `node --check` on every `.js`/`.mjs`, then `tsc --noEmit`, then every `scripts/tests/test_*.mjs`, then every `test_*.py`. **This is what CI runs** (`.github/workflows/quality.yml`, on push to `main` and on every PR), so run it before pushing. Individual files still run standalone (`node scripts/tests/test_risk_page.mjs`). Each JS test reads `script.js` / `cobalt.js` / `finance.js` / `index.html` / `style.css` as text, `vm.runInContext`s the individual functions it needs with hand-built fixtures, and asserts on both computed values and rendered HTML. **Run the suite after touching any render function** — several assert on exact markup order, and pulling a new function into a test's vm context often means injecting the constants it closes over. `scripts/tests/*.py` cover the ETF collector.
- `pip install -r requirements.txt` — install the Python deps used by `api/dashboard.py` (`yfinance`, `pykrx`, `pandas`). The Python handler degrades gracefully when these are missing — each import is wrapped in a `try/except` and the corresponding endpoint returns `'미조회'` ("UNAVAILABLE").
- `vercel.json` sets a `maxDuration` per function (15–30s); long-running fetches must respect that.

## Architecture

### Frontend — vanilla JS SPA (no framework, no bundler)

- Four scripts load in a fixed order and it matters — `tax-rules.js` (versioned tax/gift rules and disclosures) → `script.js` (data engine + legacy views) → `finance.js` (재무상태표·목표·데이터 상태) → `cobalt.js` (main pages + router). `cobalt.js` wraps `switchView`, `changeOwner`, `saveAssetsToKV`, `loadAssetsFromKV`, `loadExtDataFromKV`, `fetchDivData`, `updateBenchmark`, `setTheme`, `liveRefresh`, `refreshPyData` to re-render the active page and stamp data-freshness, so it must load last. `finance.js` defines `cbRenderBalanceSheet` / `cbRenderPlan` / `cbRenderDataStatus`, which `cobalt.js` references in `CB_VIEWS` at parse time.
- `index.html` defines every "view" up front as `<div id="view-*">` siblings; `switchView(viewId)` toggles `.active` on one of them. Adding a Cobalt page means: a `<div id="view-X"><div class="cb-scroll" id="cb-X">` block, a sidebar `<button id="menu-X">` inside one of the four `.menu-group` sections, and entries in `CB_VIEWS` + `CB_TITLES` (cobalt.js). Legacy pages instead need an entry in `CB_LEGACY_SUB` so the header subtitle isn't blank.
- `script.js` is a single ~9,100-line file with all logic. Globals shared across modules are real `window.` globals — `pfolioData`, `currentOwner`, `_bubbleOwner`, `_divDataCache`, `RATES`, `benchData`, `divHistory`, `_netWorthHistory`, `_balanceSheet`, `_targetAlloc`, `goalData`, etc. There is no module system; ordering in the file matters.
- Charting is multi-library by intent: **Chart.js 4.4.1** for line/bar/donut, **Highcharts** (+ `highcharts-more.js` for bubble, + `treemap.js`) for legacy charts, **Plotly 2.26.0** for the bubble/sunburst-trace chart (see `renderBubbleChart` in `script.js`). All three are loaded from CDN in `index.html`.
- Persistent state is stored in **Upstash Redis (KV)** via `getKV` / `setKV` (`saveAssetsToKV`, `loadAssetsFromKV`), which call the server-side proxy `api/kv.ts` — the Upstash credentials live in Vercel env vars (`KV_REST_API_URL`, `KV_REST_API_TOKEN`), never in the client. Local `localStorage` is used only for short-lived caches (e.g. `divCache_<YYYY-MM-DD>`, `cfData`).

### Backend — six Vercel serverless functions under `api/`

Each file is a self-contained handler; they only call each other over HTTP (e.g. `price.ts` calls `/api/dashboard?type=dividend` for the pykrx pathway).

- `api/dashboard.py` (Python `BaseHTTPRequestHandler`) — multiplexed by `?type=` query param: `rates`, `gold`, `price`, `dividend`, `health`, `benchmark`, `fundamentals`, `resolve`. Uses `yfinance` for global tickers and `pykrx` for KRX-only data (KR fundamentals, names, codes). Always returns `{'success': bool, ...}`; on failure returns `'미조회'` instead of raising. (ETF 구성종목 조회는 이 라우트에서 제거됐다 — 아래 배치 참조.)
- `api/price.ts` — TypeScript handler also multiplexed by `?type=`; primary frontend-facing price/dividend route. For `type=dividend` the flow is **pykrx first → Yahoo `events=div` fallback** (used so ETF distributions on KR ETFs are still picked up when pykrx returns no DIV).
- `api/get-stock.ts` — search route. Tries Naver scraping (`searchNaver`, `searchByNaverAC`, `fetchNaverFinance`), then **Yahoo Finance search API** (`searchYahoo`) as the broad-coverage fallback for US tickers Naver doesn't index. Accepts both `?q=` and `?query=` (frontend uses `?query=`).
- `api/stock-price.js` — additional price helper (Node); 네이버 금융 스크래핑으로 국내 주식/ETF 실시간 가격을 반환 (`liveRefreshDomesticEtfs`가 호출).
- `api/kv.ts` — Upstash Redis(KV) 프록시. GET `/api/kv?key=` → Upstash GET, POST `{value}` → Upstash SET. 응답은 Upstash 원형(`{result:...}`) 그대로 전달. 키는 영숫자·`_:.-` 화이트리스트로 검증.
- `api/auth.ts` — 비밀번호 인증 라우트. POST `{password}`가 `DASHBOARD_PASSWORD`와 일치하면 `SESSION_SECRET`으로 서명한 HttpOnly 세션 쿠키를 발급한다. 브라우저에 bearer 비밀을 반환하지 않는다. 서버 내부 `/api/dashboard` 호출에는 별도 `INTERNAL_API_TOKEN`을 사용한다. 필수 환경변수 미설정 시 fail-closed(500).
- `api/price.ts?type=ohlcv&tkr=...&range=1y` — OHLCV+벤치마크 시계열 엔드포인트(`price.ts`에 존재). KR 6자 코드는 `.KS → .KQ` 폴백, 응답에 타깃 bars + `^GSPC` / `^KS11` / 섹터 ETF 종가 동봉. (현재 프론트엔드에서 직접 호출하지 않는 독립 엔드포인트.)

### ETF 구성종목 수집 — GitHub Actions 배치

브라우저에서 외부 사이트를 직접 fetch 하면 CORS 로 막히고, 서버리스 경유는 KRX 왕복이
함수 제한시간(15~30s)을 넘겨 룩스루가 자주 비었다. 그래서 수집은 CI 로 옮겼다.

- `.github/workflows/etf-holdings.yml` — 평일 KST 18:30(cron `30 9 * * 1-5` UTC) + 수동 실행.
  스모크 테스트(5행 미만 실패, 30행 미만 경고) → 파서 단위 테스트 → 수집 → 변경 시에만 커밋.
  리포 시크릿 `KV_REST_API_URL` / `KV_REST_API_TOKEN` 필요.
- `scripts/collect_etf_holdings.py` — KV `assets` 에서 보유 ETF를 추려 수집한다.
  국내는 KRX 내부 JSON API(`bld=dbms/MDC/STAT/standard/MDCSTAT05001`, `isuCd`=12자리 ISIN;
  단축코드→ISIN 매핑은 `MDCSTAT04601`. 두 bld 값 모두 pykrx 소스에서 확인한 것), 실패 시
  ZEROIN 전체 구성종목(운용사 공통) → 운용사 어댑터(TIGER 공식 PDF AJAX) → 네이버 증권 →
  Playwright 순. 해외는 yfinance → stockanalysis → 티커 별칭.
  **pykrx 래퍼를 쓰지 않는다** — 래퍼가 `COMPST_ISU_CD` 를 `[3:9]` 로 잘라
  US ISIN(`US67066G1040`)을 `066G10` 으로 망가뜨려 해외 편입 종목을 매칭할 수 없게 만든다.
- `scripts/etf_common.py` — 코드 정규화·주식 판별·소스별 파서. 현금/채권/선물 행은 버리고,
  **비중은 100%로 재정규화하지 않는다**(ETF 순자산 대비 원값 유지 → `equityWeight` 로 주식 비중 합 노출).
  삼성전자/삼성전자우, GOOGL/GOOG 는 통합하지 않는다.
- `data/etf_holdings.json` — 워크플로가 커밋하는 유일한 소스.
  `{asOf, etfs:{code:{name,asOf,source,equityWeight,holdings:[{t,n,w}]}}, failures:[ETF명]}`.
  수집 실패해도 직전 스냅샷이 있으면 유지하고(해당 entry 의 `asOf` 가 곧 stale 표시), 없으면 `failures` 에 이름만 넣는다.
- 프런트(`cbEnsureEtfHoldings` → `cbLookThrough` → `cbLookThroughPanel`)는 이 파일만 읽는다.
  앱 시작 시 `cache: 'no-cache'`로 정적 JSON의 ETag/Last-Modified를 재검증하므로,
  변경이 없으면 캐시 본문을 재사용하고 새 스냅샷이 있을 때만 내려받는다.
  룩스루는 소유주별로 `직접 보유 종목 ∩ 해당 소유주의 ETF 구성종목`만 계산하며,
  전체 보기에서도 서로 다른 소유주의 직접 종목과 ETF를 교차 합산하지 않는다.
  각주에는 구성종목을 못 받은 ETF 이름만 한 줄로 나열하고, 전부 성공이면 각주를 렌더하지 않는다(실패 사유는 비노출).

### Cross-cutting domain rules baked into the code

- **Owners** are a fixed enum: `본인 / 아내 / 자녀1 / 아버지`, plus `전체` for the aggregate view. Owner-keyed objects (`benchData[tf].data`, `divHistory[year]`, `ownerColors`) all assume this list.
- **Asset groups** (`item.grp`) are `주식 / 가상화폐 / 금 / 현금`. ETFs live under `주식`. The bubble/sunburst chart only includes `주식` + `가상화폐`.
- **Currency normalization**: `RATES = { USD, JPY, KRW: 1 }` is loaded from `/api/dashboard?type=rates`. Per-item `cur` should be `USD` for US stocks, `KRW` for everything else; `fixAssetCurrencies` auto-corrects misclassified rows on load using `KNOWN_US_TICKERS` and a 6-char alphanumeric regex for KRX codes (note the regex allows letters, e.g. `0117V0` for newer KRX codes).
- **KR ticker shape**: stripped form is `^[0-9A-Z]{6}$` (not just digits — KRX issues alphanumeric short codes). Suffix `.KS` (KOSPI) or `.KQ` (KOSDAQ) is used when calling Yahoo. `data/stocks.json` is loaded into `window._krStocksDB` for autocomplete; `KR_TICKERS` and `US_LOCAL` arrays in `script.js` are small offline fallbacks only.
- **Benchmark math**: `_jsBenchmarkFallback` (JS) and `get_benchmark` (Python) both **drop today's intraday bar** before computing period returns, and use `^GSPC` / `^KS11` (the actual indices), not the SPY/069500 ETFs. Note this is a **backcast** — today's holdings and weights are applied retroactively over the whole period, so 성과 비교 is not a realized return and the page says so. Actual money over time lives in `_netWorthHistory` (see below).
- **Dividend pipeline**: `fetchDivData` populates `window._divDataCache` per-ticker → `syncDivHistory` projects that into `divHistory[year][owner][month]` (net) and `divHistoryGross[...]` (gross), applying ISA/연금 tax rules per `getAccountDivTaxInfo(item.acc)`. Only items with `grp === '주식'` contribute. ETF distributions are treated as dividends (Yahoo's `events.dividends` covers both). Years come from `divHistoryYears()` (작년·올해·내년) — never hard-code them; read a year with `divHistoryOf(year, owner)`, which always returns a 12-slot array.
- **Tax and gift values have exactly one source**: `tax-rules.js`. Production calculations read it through `assetTaxRuleValue` / `_taxRuleValue`; do not add tax thresholds, rates, deductions, effective dates, or legal assumptions inline. `assetTaxRuleDisclosureHtml` must remain attached to 배당 관리, 양도소득세, 가족 증여, and their legacy views. Monthly realized-P/L records preserve the applicable `ruleSetId`.
- **Dividend cash-flow has exactly one engine**: `allocateDividendTax(entries, threshold)` in `script.js`, on top of `getAccountDivTaxInfo(acc)`. Every consumer routes through it — `syncDivHistory`, `cbDivTaxAllocate`, `cbDivMonthlyForYear`, `finAccountDiagnostics`, and `autoAddDividendCashFlow`.
  The engine's ISA 200만원/9.9% calculation is only an **annual cash-flow approximation** because the app does not know the account's full lifetime statutory net income. It is not an annual legal exemption. Feed every holding at once so the approximation is applied once per owner and split pro rata, and keep every ISA result labelled `연간 현금흐름 참고`; actual ISA tax is settled at maturity/termination over the account lifetime.
  The financial-income threshold card is also a **partial proximity indicator** based only on general-account dividends entered in the app. Never label it a legal comprehensive-tax determination; interest and external financial income are excluded.
- **Tax-rule update procedure**: edit values, official sources, assumptions/exclusions, `verifiedAt`, `nextReviewAt`, period version, and `manifestVersion` together; add an entry to `docs/tax-rule-changelog.md`; run `npm run check:tax-rules`, `npm run check:tax-rules:remote`, and `npm test`. The daily `.github/workflows/tax-rule-watch.yml` may only alert; it must never auto-change legal values. Unsupported future years and expired human-review dates must remain visibly non-verified.
- **Dividend cash-flow auto-registration deletes rows.** `autoAddDividendCashFlow` prunes app-generated `divKey` rows (6-part `div_TKR_OWNER_ACCTYPE_YR_MO`) for the viewed 연·월. It may only delete on *positive* evidence: the holding is gone, the user deleted the key, or a **cache/API-confirmed** schedule (`_divSource === 'cache'`) says there is no payment that month. A static-DB fallback (`_divSource === 'db'`) shows up even when the API failed, so it is never grounds for deletion — otherwise a failed fetch erases real records. Rows without a `divKey`, and rows outside the viewed 연·월, are never touched. `scripts/tests/test_dividend_tax.mjs` pins all of these.
- **"월 필수지출" has exactly one definition**: `finMonthlyFixedCost(ownerF)` in `finance.js` — 지출 autoTransfers with `isFixedCost === true`, excluding `FIN_SAVING_CATS` ('저축/투자', an asset transfer that doesn't reduce net worth), sized by `_autoTransferMonthlyEquivalent`. Unclassified (`isFixedCost == null`) rows are **not** summed; they come back as `pendingCount`/`pendingMonthly` so the UI can nag. The 리스크 진단 liquidity card delegates to `finCashSafety` so both pages show the same number — don't re-derive it.
- **Net worth history**: `updateNetWorthSnapshot()` rewrites today's entry in `window._netWorthHistory` (max 365 days) **in memory only** — the caller decides whether to persist, so 재무상태표 CRUD can refresh the KPI without an extra KV write. `saveNetWorthSnapshot()` does update + save. Persisted in KV `ext_data`.
  Entries come in three shapes and `finSnapshotKind(entry)` is the only thing that may classify them: `schemaV >= 2` → `full`; `schemaV === 1` → `investment`; **no `schemaV` at all → look at the structure** (`nonInvestmentAssets` or `netByOwner` present ⇒ `full`, else `investment`), because an intermediate build wrote full net worth without stamping a version. Treating every unversioned entry as v1 throws away comparable history. `finSnapshotNet` / `finSnapshotOwnerNet` build on it; comparing shapes blindly makes the day a user registers real estate look like a market move. The chart lives in 가족 재무상태표 (`finNwSeries` / `finNwChartSvg`).
- **Dates use local time, never `toISOString()`**: `finLocalDateKey(date)` in `finance.js`. `toISOString().slice(0,10)` is UTC, so in KST it returns *yesterday* before 09:00 — snapshot keys, the bridge's "exclude today", and cashflow ranges all silently shift by a day.
- **KV load state gates writes**: `window._kvLoadState = {assets, ext}` (`'pending' | 'ready'`). `saveAssetsToKV` / `saveExtDataToKV` refuse to write while the matching source is not `ready`, so a failed load never overwrites real KV data with empty defaults. `api/kv.ts` returns 502 on an upstream failure or malformed body rather than passing it through as success.
- **Refresh is per-source**: `manualRefresh(source)` where source is `'all'` or a `finDataStatusRows` key (`assets`/`ext`/`prices`/`dividends`/`rates`/`benchmark`). It skips work that depends on an unloaded ledger and returns `{ok, results}`. Data-status cards call it with their own key.
- **Data status distinguishes three states**: `finDataStatusRows()` returns `state` of `'ok'` / `'warn'` / `'pending'`. Only an explicit `finMarkFresh` record makes a row `ok`; **never infer freshness from in-memory data** (a check like `pfolioData.length >= 0` is always true and shows a permanent false green). `'pending'` means not yet fetched and is **not** an error — the sidebar footer only reddens for `'warn'`. `_dataFreshness` is persisted to KV, so records carry a `session` stamp and `sameSession` tells you whether the timestamp is from this browser or another device.
- **Net worth bridge** (`finNetWorthBridge`): 이전 순자산 + 순현금흐름 + 설명되지 않는 차이. The cashflow term excludes `FIN_SAVING_CATS` for the same reason as above. The residual is deliberately *not* labelled "가격 변동" — unrecorded transfers and manual asset edits land there too.

## Conventions

- UI strings, comments, and labels are in Korean. Keep that style when adding new UI.
- The frontend uses the Cobalt 3-theme system — `light` (default) / `dark` / `navy` — via `document.body.dataset.theme` (`light` = attribute removed). Switch with `setTheme(mode)` in `script.js`; `isDarkTheme()` is true for both `dark` and `navy`. CSS variables (`--t1`, `--t3`, `--inner-bg`, `--acc`, `--acc-soft`, `--tipbg`, etc.) in `style.css` are the source of truth — never hard-code colors that need to flip with the theme. Chart JS constants (`ownerColors`, `CHART_PALETTE`, `cfColors`, `catColors`) use the Cobalt palette (`#5b9bff`, `#4ecdc4`, `#f2a33c`, `#c084fc`, `#4ade80`, …).
- When adding a new owner-aware widget, sync from `currentOwner` in `changeOwner()` and re-render in `switchView()` for the relevant `viewId`. Cobalt pages instead keep their own owner state and render owner buttons via `cbSetHead(sub, cbOwnerBtns(state, 'handlerName'))`. **Every calculation a page shows must respect that filter** — pass the owner through rather than computing household totals under an owner tab; if a number genuinely can't be filtered (e.g. the net worth bridge, which only has household snapshots), label it "가구 전체" on the card.
- **Sidebar menu** is four collapsible `.menu-group` sections — 요약 / 분석 / 계획 / 기록·관리. State persists in `localStorage.menuGroupState`; `_setMenuGroup(group, collapsed, persist)` is the only writer, and auto-expanding the active group persists too so the saved state never disagrees with the screen. `MENU_GROUP_DEFAULT_COLLAPSED` sets first-visit defaults. 데이터 상태 is reached from the sidebar footer status button (`.footer-status-btn`), not a menu row.
- **Mobile (≤768px) is read-only on the finance pages** — the 768px media query hides `#fin-bs-form`, `#fin-goal-form`, `.fin-form-actions`, `.fin-row-actions`. Any new form there must render a `finMobileNote(...)` callout so the missing controls are explained rather than just absent.
- **List row actions key off item `id`, not array index** — the balance-sheet and goal lists are owner-filtered, so an index from the rendered list points at the wrong row. Use `finBalanceFind` / `finGoalFind`, and edit in place with `splice(i, 1, row)` so the row doesn't jump to the bottom. `finEnsureState()` backfills `id` on legacy rows.
