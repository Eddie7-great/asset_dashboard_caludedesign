# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

This is a Vercel-hosted single-page app — there is no build step.

- `vercel dev` — run the full stack locally on http://localhost:3000 (serves static `index.html` + `script.js` + `finance.js` + `cobalt.js` + `style.css`, plus the serverless functions under `api/`). `start-server.bat` is a Windows helper that opens Chrome and runs this.
- `npm install` — install the Node deps used by the TypeScript / JavaScript serverless functions (`axios`, `cheerio`) **and by the tests** (`cheerio`, `typescript`, `@types/node`). There is no `@vercel/node` dependency — the handler request/response types live in `api/_types.ts` (`ApiRequest` / `ApiResponse`), so the functions type-check without the Vercel runtime package. CI installs with `npm ci --ignore-scripts`, so `package-lock.json` must stay in sync with `package.json`.
- `npm test` — the full quality gate (`scripts/tests/run_all.mjs`): `node --check` on every `.js`/`.mjs`, then `tsc --noEmit`, then every `scripts/tests/test_*.mjs`, then every `test_*.py`. **This is what CI runs** (`.github/workflows/quality.yml`, on push to `main` and on every PR), so run it before pushing. Individual files still run standalone (`node scripts/tests/test_risk_page.mjs`). Each JS test reads `script.js` / `cobalt.js` / `finance.js` / `index.html` / `style.css` as text, `vm.runInContext`s the individual functions it needs with hand-built fixtures, and asserts on both computed values and rendered HTML. **Run the suite after touching any render function** — several assert on exact markup order, and pulling a new function into a test's vm context often means injecting the constants it closes over. `scripts/tests/*.py` cover the ETF collector.
- `pip install -r requirements.txt` — install the Python deps used by `api/dashboard.py` (`yfinance`, `pykrx`, `pandas`). The Python handler degrades gracefully when these are missing — each import is wrapped in a `try/except` and the corresponding endpoint returns `'미조회'` ("UNAVAILABLE").
- `vercel.json` sets a `maxDuration` per function (5–60s: `api/auth.ts` 5, `api/kv.ts` 10, `api/get-stock.ts`·`api/stock-price.js` 15, `api/price.ts` 30, `api/dashboard.py` 60); long-running fetches must respect the limit of the function they run in. The same file also serves the security headers — the CSP `script-src` allowlist must be updated whenever a new CDN is added to `index.html`.

## Architecture

### Frontend — vanilla JS SPA (no framework, no bundler)

- Four scripts load in a fixed order and it matters — `tax-rules.js` (versioned tax/gift rules and disclosures) → `script.js` (data engine + 자산 내역·현금 흐름 화면) → `finance.js` (재무상태표·목표·데이터 상태) → `cobalt.js` (main pages + router). `cobalt.js` wraps `switchView`, `changeOwner`, `saveAssetsToKV`, `loadAssetsFromKV`, `loadExtDataFromKV`, `fetchDivData`, `updateBenchmark`, `setTheme`, `liveRefresh`, `refreshPyData` to re-render the active page and stamp data-freshness, so it must load last. `finance.js` defines `cbRenderBalanceSheet` / `cbRenderPlan` / `cbRenderDataStatus`, which `cobalt.js` references in `CB_VIEWS` at parse time.
- `index.html` defines every "view" up front as `<div id="view-*">` siblings; `switchView(viewId)` toggles `.active` on one of them. Adding a Cobalt page means: a `<div id="view-X"><div class="cb-scroll" id="cb-X">` block, a sidebar `<button id="menu-X">` inside one of the four `.menu-group` sections, and entries in `CB_VIEWS` + `CB_TITLES` (cobalt.js). Legacy pages instead need an entry in `CB_LEGACY_SUB` so the header subtitle isn't blank.
- `script.js` is a single ~9,100-line file with all logic. Globals shared across modules are real `window.` globals — `pfolioData`, `currentOwner`, `_bubbleOwner`, `_divDataCache`, `RATES`, `benchData`, `divHistory`, `_netWorthHistory`, `_balanceSheet`, `_targetAlloc`, `goalData`, etc. There is no module system; ordering in the file matters.
- Charting: **Chart.js 4.4.1** for the 현금 흐름 bar/donut charts and **Plotly 2.26.0** for the bubble/sunburst-trace chart (`renderBubbleChart` in `script.js`) — both loaded from CDN in `index.html` with SRI. Highcharts was dropped when the legacy views went: its only user was the 히트맵 treemap in `view-analysis`. **Cobalt pages use no chart library at all** — they render inline SVG (`cbDonutSvg`, `cbRingSvg`, `finNwChartSvg`), because a page redrawn by `innerHTML` replacement would otherwise need chart-instance lifecycle management.
- Persistent state is stored in **Upstash Redis (KV)** via `getKV` / `setKV` (`saveAssetsToKV`, `loadAssetsFromKV`), which call the server-side proxy `api/kv.ts` — the Upstash credentials live in Vercel env vars (`KV_REST_API_URL`, `KV_REST_API_TOKEN`), never in the client. Local `localStorage` is used only for short-lived caches (e.g. `divCache_<YYYY-MM-DD>`, `cfData`).

### Backend — six Vercel serverless functions under `api/`

Each file is a self-contained handler; they only call each other over HTTP (e.g. `price.ts` calls `/api/dashboard?type=dividend` for the pykrx pathway).

- `api/dashboard.py` (Python `BaseHTTPRequestHandler`) — multiplexed by `?type=` query param: `rates`, `gold`, `price`, `dividend`, `health`, `benchmark`, `fundamentals`, `resolve`. Uses `yfinance` for global tickers and `pykrx` for KRX-only data (KR fundamentals, names, codes). Always returns `{'success': bool, ...}`; on failure returns `'미조회'` instead of raising. (ETF 구성종목 조회는 이 라우트에서 제거됐다 — 아래 배치 참조.)
- `api/price.ts` — TypeScript handler also multiplexed by `?type=`; primary frontend-facing price/dividend route. For `type=dividend` the flow is **pykrx first → Yahoo `events=div` fallback** (used so ETF distributions on KR ETFs are still picked up when pykrx returns no DIV).
- `api/get-stock.ts` — search route. Tries Naver scraping (`searchNaver`, `searchByNaverAC`, `fetchNaverFinance`), then **Yahoo Finance search API** (`searchYahoo`) as the broad-coverage fallback for US tickers Naver doesn't index. Accepts both `?q=` and `?query=` (frontend uses `?query=`).
- `api/stock-price.js` — additional price helper (Node); 네이버 금융 스크래핑으로 국내 주식/ETF 실시간 가격을 반환 (`liveRefreshDomesticEtfs`가 호출).
- `api/kv.ts` — Upstash Redis(KV) 프록시이자 **낙관적 동시성(CAS) 게이트**. 키는 `assets` / `ext_data` / `data_freshness` 세 개만 허용하는 allowlist(자유 문자열 화이트리스트가 아니다). GET `/api/kv?key=`는 값과 개정번호를 한 Lua 스크립트로 함께 읽어 `{result, revision}`을 반환한다(Upstash 원형을 그대로 흘리지 않는다). POST `{value, expectedRevision}`은 `__revision__:<key>`가 `expectedRevision`과 같을 때만 쓰고 개정번호를 올린다 — 불일치면 **409**(현재 revision 동봉), `expectedRevision` 누락이면 **428**, 값이 1MB를 넘으면 413, 상류 실패·응답 형식 오류는 **502**다. 프런트 짝은 `script.js`의 `_kvRevisions` 맵과 `_setKVOnce` / `setKV`(키별 쓰기 직렬화 큐)이며, 409를 받으면 대기 중이던 같은 탭 저장까지 중단해 오래된 메모리 상태가 새 revision을 덮어쓰지 않게 한다.
- `api/auth.ts` — 비밀번호 인증 라우트. POST `{password}`가 `DASHBOARD_PASSWORD`와 일치하면 `SESSION_SECRET`으로 서명한 HttpOnly 세션 쿠키를 발급한다. 기존 배포는 `SESSION_SECRET`이 없을 때 `AUTH_TOKEN`을 서버 내부 서명 키로만 임시 사용하며 bearer로는 허용하지 않는다. 서버 내부 `/api/dashboard` 호출은 별도 `INTERNAL_API_TOKEN` 또는 사용자의 세션 쿠키를 사용한다. 필수 환경변수 미설정 시 fail-closed(500).
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

### 순자산 스냅샷 기록 — GitHub Actions 배치

앱은 브라우저를 열어야만 그날 스냅샷을 남긴다. 며칠 안 들어가면 그 날짜가 영구히 비고,
순자산 추이의 기간 버튼(1M/3M/6M/1Y/전체)이 전부 같은 구간을 그린다.

- `.github/workflows/net-worth-snapshot.yml` — 매일 KST 18:40(cron `40 9 * * *` UTC) + 수동 실행(dry-run 옵션).
  **기록 전에 계산 대조 테스트를 먼저 통과시킨다.** 리포 시크릿 `KV_REST_API_URL` / `KV_REST_API_TOKEN` 필요.
  ETF 배치와 달리 리포에 커밋하지 않는다 — **운영 KV 의 `ext_data` 를 직접 쓴다**(`permissions: contents: read`).
- `scripts/net_worth_snapshot.py` — KV `assets`·`ext_data` 를 읽어 시세를 갱신하고 오늘자 항목을 기록한다.
  - 시세 조회는 `api/dashboard.py` 를 import 해 그대로 쓴다(중복 구현 금지). 다만 **시장 판정은 저장된 `grp`/`cur`** 로 한다
    — `get_prices` 의 `isdigit()` 규칙은 KRX 영숫자 코드(`0117V0`)를 미국 주식으로 오인한다.
  - 쓰기는 `api/kv.ts` 와 **같은 CAS 프로토콜**(개정번호)로 하고 충돌 시 최대 3회 재시도한다 — 사용자가 앱에서 저장 중인 내용을 덮어쓰지 않는다.
  - 시세를 못 받은 종목은 **0 이 아니라 저장된 직전 값을 유지한다**(가짜 급락 방지). USD 환율 조회에 실패하면 아예 기록하지 않는다.
  - 날짜는 **KST 기준**이다 — 러너는 UTC라 그대로 쓰면 하루 밀려 같은 날이 두 건이 된다.

### Cross-cutting domain rules baked into the code

- **Owners** are a fixed enum: `본인 / 아내 / 자녀1 / 아버지`, plus `전체` for the aggregate view. Owner-keyed objects (`benchData[tf].data`, `divHistory[year]`, `ownerColors`) all assume this list.
- **Asset groups** (`item.grp`) are `주식 / 가상화폐 / 금 / 현금`. ETFs live under `주식`. The bubble/sunburst chart only includes `주식` + `가상화폐`.
- **Currency normalization**: `RATES = { USD, JPY, KRW: 1 }` is loaded from `/api/dashboard?type=rates`. Per-item `cur` should be `USD` for US stocks, `KRW` for everything else; `fixAssetCurrencies` auto-corrects misclassified rows on load using `KNOWN_US_TICKERS` and a 6-char alphanumeric regex for KRX codes (note the regex allows letters, e.g. `0117V0` for newer KRX codes).
- **KR ticker shape**: stripped form is `^[0-9A-Z]{6}$` (not just digits — KRX issues alphanumeric short codes). Suffix `.KS` (KOSPI) or `.KQ` (KOSDAQ) is used when calling Yahoo. `data/stocks.json` is loaded into `window._krStocksDB` for autocomplete; `KR_TICKERS` and `US_LOCAL` arrays in `script.js` are small offline fallbacks only.
- **Benchmark math**: `_jsBenchmarkFallback` (JS) and `get_benchmark` (Python) both **drop today's intraday bar** before computing period returns, and use `^GSPC` / `^KS11` (the actual indices), not the SPY/069500 ETFs. Note this is a **backcast** — today's holdings and weights are applied retroactively over the whole period, so 성과 비교 is not a realized return and the page says so. Actual money over time lives in `_netWorthHistory` (see below).
- **Dividend pipeline**: `fetchDivData` populates `window._divDataCache` per-ticker → `syncDivHistory` projects that into `divHistory[year][owner][month]` (net) and `divHistoryGross[...]` (gross), applying ISA/연금 tax rules per `getAccountDivTaxInfo(item.acc)`. Only items with `grp === '주식'` contribute. ETF distributions are treated as dividends (Yahoo's `events.dividends` covers both). Years come from `divHistoryYears()` (작년·올해·내년) — never hard-code them; read a year with `divHistoryOf(year, owner)`, which always returns a 12-slot array.
- **티커 목록은 반드시 서버 상한에 맞춰 잘라 보낸다.** 서버는 요청당 티커 수를 검증한다 — `api/price.ts`·`api/dashboard.py`의 `MAX_TICKERS = 25`, 벤치마크 포트폴리오(`p_tkrs`)는 `api/dashboard.py`에서 **20**. 상한을 넘기면 서버가 요청 *전체*를 `too_many_tickers`로 거부하므로, 보유 종목이 늘어난 순간 시세·배당이 통째로 비고 데이터 상태가 영구히 '확인 필요'로 남는다. 클라이언트는 `script.js`의 `API_TICKER_CHUNK`(25) / `BENCH_TICKER_LIMIT`(20)과 `_chunkTickers()`를 써서 나눠 보낸다 — `liveRefresh`, `fetchDivData`, `fetchPyPrices`, `fetchPyDividends`가 청크로 요청하고 결과를 병합하며, `fetchBenchmarkData`의 `loadOwner`는 평가액 상위 20종목만 보낸다(주석의 'Top-N 시뮬레이션'이 이 뜻이다). **상한은 입력 검증이므로 올려서 해결하지 않는다.** 부분 실패는 숨기지 않는다 — 성공한 청크의 값은 반영하되 `ok:false`로 보고하고, `fetchDivData`는 **성공한 청크의 티커만** `divCacheTickers_<날짜>`에 verified로 기록한다(실패분을 verified로 적으면 다음 접속에서 조회 없이 넘어가 배당이 영영 빈다).
- **소유주 벤치마크 라인이 없으면 성공으로 보고하지 않는다.** `fetchBenchmarkData`의 `targets`와 `cobalt.js` `cbVerifyPerfOwnersOnOpen`의 `investedOwners`는 **둘 다 `qty` 기준**이어야 한다(`curP`를 요구하면 시세가 빈 소유주가 조용히 대상에서 빠져 라인이 없는데도 초록불이 된다). `loadOwner`도 보유 종목이 있는 소유주는 포트폴리오 시리즈를 받아야만 성공으로 센다.
- **Tax and gift values have exactly one source**: `tax-rules.js`. Production calculations read it through `assetTaxRuleValue` / `_taxRuleValue`; do not add tax thresholds, rates, deductions, effective dates, or legal assumptions inline. `assetTaxRuleDisclosureHtml` must remain attached to 배당 관리, 양도소득세, 가족 증여, and their legacy views. Monthly realized-P/L records preserve the applicable `ruleSetId`.
- **Dividend cash-flow has exactly one engine**: `allocateDividendTax(entries, threshold)` in `script.js`, on top of `getAccountDivTaxInfo(acc)`. Every consumer routes through it — `syncDivHistory`, `cbDivTaxAllocate`, `cbDivMonthlyForYear`, `finAccountDiagnostics`, and `autoAddDividendCashFlow`.
  The engine's ISA 200만원/9.9% calculation is only an **annual cash-flow approximation** because the app does not know the account's full lifetime statutory net income. It is not an annual legal exemption. Feed every holding at once so the approximation is applied once per owner and split pro rata, and keep every ISA result labelled `연간 현금흐름 참고`; actual ISA tax is settled at maturity/termination over the account lifetime.
  The financial-income threshold card is also a **partial proximity indicator** based only on general-account dividends entered in the app. Never label it a legal comprehensive-tax determination; interest and external financial income are excluded.
- **Tax-rule update procedure**: edit values, official sources, assumptions/exclusions, `verifiedAt`, `nextReviewAt`, period version, and `manifestVersion` together; add an entry to `docs/tax-rule-changelog.md`; run `npm run check:tax-rules`, `npm run check:tax-rules:remote`, and `npm test`. The daily `.github/workflows/tax-rule-watch.yml` may only alert; it must never auto-change legal values. Unsupported future years and expired human-review dates must remain visibly non-verified.
- **Dividend cash-flow auto-registration deletes rows.** `autoAddDividendCashFlow` prunes app-generated `divKey` rows (6-part `div_TKR_OWNER_ACCTYPE_YR_MO`) for the viewed 연·월. It may only delete on *positive* evidence: the holding is gone, the user deleted the key, or a **cache/API-confirmed** schedule (`_divSource === 'cache'`) says there is no payment that month. A static-DB fallback (`_divSource === 'db'`) shows up even when the API failed, so it is never grounds for deletion — otherwise a failed fetch erases real records. Rows without a `divKey`, and rows outside the viewed 연·월, are never touched. `scripts/tests/test_dividend_tax.mjs` pins all of these.
- **"월 필수지출" has exactly one definition**: `finMonthlyFixedCost(ownerF)` in `finance.js` — 지출 autoTransfers with `isFixedCost === true`, excluding `FIN_SAVING_CATS` ('저축/투자', an asset transfer that doesn't reduce net worth), sized by `_autoTransferMonthlyEquivalent`. Unclassified (`isFixedCost == null`) rows are **not** summed; they come back as `pendingCount`/`pendingMonthly` so the UI can nag. The 리스크 진단 liquidity card delegates to `finCashSafety` so both pages show the same number — don't re-derive it.
- **Net worth history**: `updateNetWorthSnapshot()` rewrites today's entry in `window._netWorthHistory` (max 365 days) **in memory only** — the caller decides whether to persist, so 재무상태표 CRUD can refresh the KPI without an extra KV write. `saveNetWorthSnapshot()` does update + save. Persisted in KV `ext_data`.
  Entries come in three shapes and `finSnapshotKind(entry)` is the only thing that may classify them: `schemaV >= 2` → `full`; `schemaV === 1` → `investment`; **no `schemaV` at all → look at the structure** (`nonInvestmentAssets` or `netByOwner` present ⇒ `full`, else `investment`), because an intermediate build wrote full net worth without stamping a version. Treating every unversioned entry as v1 throws away comparable history. `finSnapshotNet` / `finSnapshotOwnerNet` build on it; comparing shapes blindly makes the day a user registers real estate look like a market move. The chart lives in 가족 재무상태표 (`finNwSeries` / `finNwChartSvg`).
  **순자산 계산은 이제 두 곳에 있다** — 앱의 `updateNetWorthSnapshot`(브라우저를 열 때)과 배치의 `scripts/net_worth_snapshot.py` `build_entry`(매일 KST 18:40, 아래 참조). 둘은 같은 `netWorthHistory` 배열에 번갈아 `schemaV: 2` 항목을 쓰므로 **한쪽만 고치면 같은 그래프에 기준이 다른 점이 섞이고** 브리지의 '설명되지 않는 차이'가 통째로 왜곡된다. 한쪽을 고치면 반드시 다른 쪽도 고치고, `scripts/tests/test_net_worth_snapshot.py`가 같은 입력을 양쪽에 넣어 결과를 대조한다(node 를 못 돌리면 로컬에서만 SKIP, **CI 에서는 실패**).
  기록이 선택 기간을 못 채우면 `finNwCoverage` / `finNwCoverageNote`가 실제 표시 구간을 한 줄로 밝힌다 — 이걸 숨기면 기간 버튼을 눌러도 MDD 가 안 변하는 것이 고장으로 보인다. 재무상태표와 한눈에 보기가 같은 함수를 쓴다.
- **Dates use local time, never `toISOString()`**: `finLocalDateKey(date)` in `finance.js`. `toISOString().slice(0,10)` is UTC, so in KST it returns *yesterday* before 09:00 — snapshot keys, the bridge's "exclude today", and cashflow ranges all silently shift by a day.
- **KV load state gates writes**: `window._kvLoadState = {assets, ext}` (`'pending' | 'ready'`). `saveAssetsToKV` / `saveExtDataToKV` refuse to write while the matching source is not `ready`, so a failed load never overwrites real KV data with empty defaults. `api/kv.ts` returns 502 on an upstream failure or malformed body rather than passing it through as success.
- **Refresh is per-source**: `manualRefresh(source)` where source is `'all'` or a `finDataStatusRows` key (`assets`/`ext`/`prices`/`dividends`/`rates`/`benchmark`). It skips work that depends on an unloaded ledger and returns `{ok, results}`. Data-status cards call it with their own key.
- **Data status distinguishes three states**: `finDataStatusRows()` returns `state` of `'ok'` / `'warn'` / `'pending'`. Only an explicit `finMarkFresh` record makes a row `ok`; **never infer freshness from in-memory data** (a check like `pfolioData.length >= 0` is always true and shows a permanent false green). `'pending'` means not yet fetched and is **not** an error — the sidebar footer only reddens for `'warn'`. `_dataFreshness` is persisted to KV, so records carry a `session` stamp and `sameSession` tells you whether the timestamp is from this browser or another device.
- **워크플로 `run:` 값에 `": "`(콜론+공백)를 넣지 않는다.** 따옴표 없는 평문 스칼라에는 이 시퀀스가 올 수 없어 워크플로 파일 전체가 파싱되지 않고, 그러면 GitHub 은 **잡을 하나도 만들지 못한 채 런을 즉시 실패**시킨다 — 실행 목록에서 name 이 워크플로 이름 대신 파일 경로로 떨어지는 것이 그 표식이다. 실제로 `--only-binary=:all: numpy` 한 줄이 품질 게이트를 통째로 멈춰 세웠고, 그동안 `npm test` 는 계속 초록이었다. 해당 값은 블록 스칼라(`run: |`)로 둔다. `scripts/tests/test_workflow_yaml.mjs` 가 지킨다. **워크플로 변경은 로컬 테스트로 검증되지 않는다 — PR 을 열어 CI 를 실제로 돌려야 확인된다.**
- **반응형이 필요한 폭 제약을 인라인 `style` 로 두지 않는다.** 인라인 스타일은 미디어쿼리가 덮을 수 없어 좁은 화면에서 요소가 뷰포트를 넘고, `.content-area{overflow-x:hidden}` 에 잘려 **금액이 `200,000` → `200` 으로 읽히는** 상태가 된다(가족 증여 페이지에서 실제로 그랬다). 클래스로 빼고 style.css 에서 폭을 준다 — `.cb-fam-card-grid`(5→3→2열), `.cb-gift-panel`(모바일 `flex-basis:100%`), `.cb-lt-*`(좁은 화면에서 마지막 칸 숨김)가 이 이유로 클래스화됐다. 세로 스택으로 전환하는 flex 컨테이너는 인라인 `align-items:flex-start` 도 함께 풀어야 한다(`.cb-dash-split` — 안 풀면 자식이 max-content 폭으로 부풀어 표를 가로로 넘길 수조차 없다).
- **CDN 라이브러리 사용부는 반드시 `typeof X === 'undefined'` 로 가드한다.** `initDashboard` 안에서 가드 없이 `new Chart(...)` 를 하면 CDN 로드 실패 시 함수가 통째로 중단되고 **그 아래 `loadAssetsFromKV` 까지 실행되지 않아** 차트뿐 아니라 자산·순자산·배당이 전부 빈 화면이 된다. 최상위 `Chart.register` 블록만 가드하고 이쪽을 놓쳐 같은 버그가 두 번 났다.
- **배당 지급월 폴백은 `cbDefaultDivMonths(cycle)` 하나만 쓴다.** API 응답에 `months` 가 없을 때 주기 기반(연 1회 → 12월) → 주기도 미상이면 분기 가정 순으로 내려간다. `cbDivMonthlyForYear`(월별 막대)와 `cbUpcomingDividendSchedule`(다가오는 배당)이 **반드시 같은 값**을 써야 한다 — 한쪽만 고쳐서 같은 화면의 두 위젯이 '12월 1회'와 '분기 4회'를 동시에 보여준 적이 있다.
- **`cbSnapDivCoverage` 는 `_divDataCache` 키를 verified 대용으로 쓰지 않는다.** 그 캐시에는 배당이 **있는** 종목만 들어가므로 무배당 종목이 통째로 '미확인'으로 잡혀, 이 함수가 애초에 없애려던 오판(데이터 행 수로 판정)을 그대로 되풀이한다. 판정 근거(`window._divFetchCoverage`)가 현재 화면의 티커를 다 덮지 못하면 경고하지 말고 `pending`('확인 중')으로 둔다.
- **`fetchDivData` 의 in-flight 가드에서 정리(`finally`)는 반환하는 프라미스 체인 *안*에 둔다.** 밖에서 정리하면 호출자가 `await` 에서 깨어나는 시점에 아직 in-flight 로 남아 있어, 바로 뒤에 종목을 추가하고 다시 부른 조회가 지난 결과를 그대로 돌려받고 **신규 종목이 영영 조회되지 않는다.** 강제 갱신(`force=true`)은 재사용하지 않고 앞선 조회 뒤에 이어 붙인다.
- **터치 상호작용은 마우스 경로와 분리해서 다룬다.** 브라우저는 탭 뒤에 `mouseover→mousedown→click→mouseout` 을 흉내 내고, 그 흉내 `mouseout` 이 방금 연 설명을 즉시 닫는다 — `script.js` 의 `TOUCH_MOUSE_GRACE` 유예 창이 이걸 막으므로 없애지 말 것. 차트 터치는 **문서 위임**이어야 한다(`data-chart-hit="finNw:<i>"` / `"perf:<i>"`): SVG `<rect>` 의 인라인 `onpointerdown` 은 브라우저가 이벤트 핸들러 속성으로 받아주지 않아 동작하지 않는다(`onmousemove` 와 다르다). 모바일은 헤더 소제목을 숨기므로 `#page-sub-toggle`('ⓘ')이 기준·면책 문구에 닿는 유일한 통로다 — `cbSetHead` 가 이 버튼의 표시와 접힘을 함께 관리한다.
- **클릭으로 동작하는 요소는 `role="button" tabindex="0"` 만 달면 된다 — 인라인 `onkeydown` 을 붙이지 않는다.** Enter·Space 활성화는 `script.js` 의 문서 위임 한 곳이 처리한다(`[role="button"][tabindex="0"]` 를 찾아 `.click()`; 진짜 `button`·`a`·`input` 은 브라우저가 이미 처리하므로 제외). 요소마다 스니펫을 복사하면 새로 만드는 곳에서 빠뜨리고, 위임과 함께 두면 **이중 실행되어 토글이 두 번 뒤집힌다**(눌러도 아무 일 없는 것처럼 보인다). 포커스 링은 `style.css` 의 `:where(...[tabindex]):focus-visible` 이 이미 준다. `scripts/tests/test_layout_guards.mjs` 가 클릭 전용 요소·잔존 인라인 `onkeydown`·위임 존재를 함께 지킨다.
- **필터 재렌더 후 포커스 복원은 `cbRestoreFilterFocus(rootId, attr, value)` 하나로 한다.** 페이지가 `innerHTML` 로 통째로 다시 그려지면 눌렀던 버튼이 사라져 키보드 포커스가 문서 맨 앞으로 튄다. 페이지마다 따로 만들지 말고 이 헬퍼를 쓰고, 기간·기준 버튼에는 `data-*` 표식과 `aria-pressed` 를 함께 단다.
- **Net worth bridge** (`finNetWorthBridge`): 이전 순자산 + 순현금흐름 + 설명되지 않는 차이. The cashflow term excludes `FIN_SAVING_CATS` for the same reason as above. The residual is deliberately *not* labelled "가격 변동" — unrecorded transfers and manual asset edits land there too.

## Conventions

- UI strings, comments, and labels are in Korean. Keep that style when adding new UI.
- The frontend uses the Cobalt 3-theme system — `light` (default) / `dark` / `navy` — via `document.body.dataset.theme` (`light` = attribute removed). Switch with `setTheme(mode)` in `script.js`; `isDarkTheme()` is true for both `dark` and `navy`. CSS variables (`--t1`, `--t3`, `--inner-bg`, `--acc`, `--acc-soft`, `--tipbg`, etc.) in `style.css` are the source of truth — never hard-code colors that need to flip with the theme. Chart JS constants (`ownerColors`, `CHART_PALETTE`, `cfColors`) use the Cobalt palette (`#5b9bff`, `#4ecdc4`, `#f2a33c`, `#c084fc`, `#4ade80`, …).
- When adding a new owner-aware widget, sync from `currentOwner` in `changeOwner()` and re-render in `switchView()` for the relevant `viewId`. Cobalt pages instead keep their own owner state and render owner buttons via `cbSetHead(sub, cbOwnerBtns(state, 'handlerName'))`. **Every calculation a page shows must respect that filter** — pass the owner through rather than computing household totals under an owner tab; if a number genuinely can't be filtered (e.g. the net worth bridge, which only has household snapshots), label it "가구 전체" on the card.
- **Sidebar menu** is four collapsible `.menu-group` sections — 요약 / 분석 / 계획 / 기록·관리. State persists in `localStorage.menuGroupState`; `_setMenuGroup(group, collapsed, persist)` is the only writer, and auto-expanding the active group persists too so the saved state never disagrees with the screen. `MENU_GROUP_DEFAULT_COLLAPSED` sets first-visit defaults. 데이터 상태 is reached from the sidebar footer status button (`.footer-status-btn`), not a menu row.
- **Mobile (≤768px) is read-only on the finance pages** — the 768px media query hides `#fin-bs-form`, `#fin-goal-form`, `.fin-form-actions`, `.fin-row-actions`. Any new form there must render a `finMobileNote(...)` callout so the missing controls are explained rather than just absent.
- **사람이 읽는 판본은 `docs/invariants.md`** — 같은 규칙을 증상 중심으로 풀어 쓴 문서이고, `npm test` 로는 검증되지 않는 영역(워크플로·모바일 레이아웃·CDN 실패·터치)을 따로 정리해 두었다. 새 불변조건이 생기면 **이 파일과 그 문서를 같은 커밋에서 함께** 고친다.
- **List row actions key off item `id`, not array index** — the balance-sheet and goal lists are owner-filtered, so an index from the rendered list points at the wrong row. Use `finBalanceFind` / `finGoalFind`, and edit in place with `splice(i, 1, row)` so the row doesn't jump to the bottom. `finEnsureState()` backfills `id` on legacy rows.
