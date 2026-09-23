# CLAUDE.md

### Compact navigation and FunETF (2026-09-10)

- Each ETF-page entry and manual refresh revalidates the published snapshot and queries held ETF symbols through the authenticated, no-store dashboard API. Use only bounded HTTP adapters (FunETF domestically; supported issuers then stockanalysis abroad), never the long KRX/browser retry chain in a function. Limit browser concurrency to two; ignore responses from superseded page entries. Preserve dated/full last-good observations on failures, older dates or undated/partial regressions; display the latest attempt separately from composition asOf. Live observations are session-only; scheduled collection persists history.

- `snap`(한눈에 보기) 화면은 제거됐다 — 고유 내용이던 순자산 추이는 성과 페이지의 투자자산 추이 카드가 대신한다. `navResolve` 의 `snap`→`cdash` 매핑은 옛 링크 호환으로 남긴다.
- The current navigation has seven main destinations. Balance-sheet UI is retired and its renderer, CRUD handlers and CSS are gone; old `balance2` links resolve to home through `navResolve`. **Preserve the stored `_balanceSheet` values and the snapshot jobs** — `finBalanceTotals`/`finSum` still feed goals (`finGoalCurrent`) and the cash buffer (`finCashSafety`) on live pages, and `cashTargetMonths` is edited from the goals page (투자 계획 > 목표). 부동산·부채 자체는 대시보드에서 관리하지 않는다. Home omits duplicate net-worth totals, monthly actions and the trend chart; its allocation, sector and contribution cards sit beside vertically stacked gain/loss rankings, with equal combined heights. Tax summary cards share one desktop row, with responsive wrapping on small screens. Tax/dividend/gift source disclosures remain accessible at the bottom. Section links share button typography and align right.
- Domestic ETF collection first checks FunETF's public catalog and full PDF-basket endpoint. Resolve its product ID from the catalog, not a calculated ISIN. Use the page's published etfPdfYmd, validate fund identity and advertised row count, retain original NAV weights, and reject invalid or unmapped positive stock rows. Never substitute monthly top holdings or normalize weights to 100%. Failures continue through existing issuer/KRX sources. US symbols KR and KRC are stocks, not Korean non-equity ISINs.

### Vercel storage and ETF snapshot deployments (2026-09-15)

- The scheduled ETF collector runs once per weekday after the US close (UTC 22:30 / KST 07:30). A run that changes only `fetchedAt`, `lastAttempt`, or the top-level collection date must leave `data/etf_holdings.json` untouched. Composition dates, holdings, source/coverage, retained state, history, failures, quality summary, and schema changes still persist.
- `vercel.json` skips deployments whose only changed path is `data/etf_holdings.json`. The dashboard therefore reads that public file from the repository's raw GitHub URL first and falls back to the copy bundled with the last code deployment. Keep the raw host in CSP `connect-src`. Any code/configuration change must still exit the ignore command nonzero and deploy normally.

### ETF observations and compact layouts (2026-09-09)

- Re-clicking an ETF owner filter returns to all owners; re-clicking a constituent explicitly clears selection (null is distinct from the initial empty selection). Each owner exposure card is one native details/summary disclosure. Keep verification counts inside the held-ETF selector card.
- ProShares QLD uses the dated complete issuer table, preserving physical-stock NAV weights and excluding swaps, money-market collateral and placeholders. A malformed/truncated table must fall through to a partial source; never infer constituent exposure from the fund's target leverage. A **single-underlying** leveraged ETF is the one exception and is not an inference: when the product name states one stock (`T-REX 2X Long BMNR`), `cbSyntheticEtfHoldings` resolves that stock at the stated multiple. It requires both a single-stock issuer and an underlying that is not an index symbol, and never resolves inverse products. Index-tracking leveraged funds stay unresolved. Allocation analysis retains an HTML weight-list fallback when Plotly is unavailable and merges accounts by owner, asset group and normalized ticker.

- `etf-explorer.js` loads before `cobalt.js`. `etf2` is an asset-management tab, keeping seven main destinations and the related owner scope. The explorer never writes financial records.
- ETF 탐색 툴바에 '자료 다시 확인' 버튼을 두지 않는다 — 페이지 진입 시 `cobalt.js` 의 `CB_VIEWS` 가 `etfRefreshOnOpen()` 을 이미 부르므로 같은 일을 하는 버튼이다. 진행 상태는 툴바의 `role="status"` 줄이, 개별 재조회는 점검 ETF 행의 버튼이 맡는다.
- **구성종목과 비중 변화를 모드로 나누지 않는다 — 한 표에 `종목 | 비중 | 변화` 3열로 함께 싣는다.** 예전에는 `.etf-tabs` 의 두 버튼이 `_etfMode` 를 토글하고 표가 통째로 diff 표로 바뀌었다. 탭·`_etfMode`·`etfMode()` 는 모두 제거됐다. 변화 값은 `etfCompareSnapshots` 결과를 **티커로 찾는 Map** 으로 붙인다 — 그 함수가 변화 없는 행을 빼고 돌려주므로 Map 에 없으면 변화 없음(`—`)이다. 정렬은 비중 내림차순을 유지하고 diff 쪽 정렬을 따르지 않는다. '비교 기준' 드롭다운은 모드가 없어졌으므로 **검색·직접 보유 필터와 같은 `.etf-filters` 줄에 상시 표시**하되, 비교할 이력이 없으면 아예 렌더하지 않는다.
- **ETF 탐색의 '직접 보유' 판정은 `cbDirectStockMap(ownerFilter)` 하나를 쓴다.** `Map<정규화 티커, {tkr,title,val}>` 을 돌려주며 '직접 보유 중인 종목만' 체크박스와 '직접 보유 겹침' 카드가 **둘 다 이것만** 쓴다 — 두 곳이 갈리면 체크박스가 거른 목록과 카드의 종목 수가 어긋난다. `cbLookThrough` 와 `etfExposure` 는 **리팩터링하지 않는다**: 둘은 티커 집합이 아니라 소유주별 누적 금액이 필요해 모양이 다르고 기존 테스트가 그 동작을 고정한다. 겹침 카드는 구성종목이 잠정(`etfQuality(...).reliable === false`)이면 **0 건을 '겹치는 종목 없음'으로 단정하지 않고** 더 있을 수 있다고 밝힌다.
- **점검 ETF 위젯은 페이지 하단, `.etf-network` 뒤 `.etf-method` 앞이다.** 툴바 바로 아래에 두면 본문(비중 분포·구성종목)보다 먼저 나와 정상인 날에도 경고가 화면을 먼저 차지한다.
- **툴바의 '보유 ETF' 라벨은 셀렉트 왼쪽에 한 줄로 둔다.** 라벨을 셀렉트 위에 쌓으면(`flex-direction:column`) 옆 칸의 평가액이 '셀렉트 기준'이 아니라 '라벨+셀렉트 전체' 기준으로 가운데 정렬돼 **셀렉트보다 위로 떠 보인다**(실측 후 중심차 0px 확인). 셀렉트는 `width:auto` 로 가장 긴 종목명에 맞추고 상한만 둔다 — `width:100%` 면 트랙을 통째로 채워 이름 길이와 무관하게 넓어진다.
- 점검 ETF 행은 **이름과 한 줄 사유(`q.label` · 기준일)만** 찍는다. 소스 시도 이력까지 넣으면 정작 '왜 점검인지'가 묻히고, 그 이력은 툴바의 `role="status"` 줄에서 계속 볼 수 있다.
- 주식 비중 합계가 **100%를 넘으면 그 사실을 숫자 옆에서 설명한다**(담보 위에 기초자산이 명시된 스왑을 얹은 구조). 자르거나 재정규화하지 않는다 — `etfWeightSum` 이 그 합의 단일 출처다.
- Collection success is not completeness or freshness. KRX rows with missing equity weights must fall through, not return a domestic/futures subset. Exclude cash, money-market funds and derivatives from stock look-through; keep original NAV weights and distinct share classes. TIME and Invesco adapters use their actual constituent dates. Undated top-holdings data remains partial; fetchedAt never substitutes for asOf.
- Each ETF retains up to 30 source/date snapshots. Same-date corrections replace that observation; an older response cannot overwrite a newer dated snapshot. Failed retrieval preserves the prior valid data and date with retained=true. Only full lists from the same source prove entries/exits; partial lists compare shared tickers only. Weight changes include price effects and never imply actual trades.
- Freshness uses weekdays (exchange holidays not modeled): active ETFs older than 2 weekdays, others older than 5, are delayed. Unknown dates, partial and retained data keep ETF overlap and overall risk grades provisional. `etfQuality` is the frontend authority; match its thresholds in `snapshot_stale`. Check scheduled collection warnings as well as job success.
- ETF exploration uses a stable, selectable horizontal weight chart; never replace it asynchronously with 3D blocks. Korean constituents display company names. **해외 종목은 한글 병기가 필요 없다** — `etfIdentityHtml`이 티커를 `<b>` 주값으로 쓰고 회사명은 `title` 속성에만 남긴다(`etfIdentity(...).kr`로 분기). Neighboring desktop cards stretch to equal height, and long lists retain compact pagination.
- **구성종목 표의 `편입`·`편출` 라벨은 남기고 `비중 증가`·`비중 감소` 라벨은 지운다.** 옆의 %p 값이 증감을 이미 말해 주지만, 신규 편입·편출은 숫자만으로 구분되지 않는다(`etfCompareSnapshots`의 `kind`).
- **툴바의 보유 수량·평균 매입단가·포트 비중은 `etfFundStats`/`etfPortfolioPct`(순수 함수, etf-explorer.js) 하나씩만 쓴다.** 평균 매입단가는 여러 계좌를 KRW 로 합친 `Σ매입금액/Σ수량`이고, 포트 비중의 분모는 `etfExposureHtml` 각주와 같은 정의(그 소유주의 주식·ETF·가상화폐·금·현금 합계, 부동산·부채 제외)다 — 새 분모를 만들지 않는다.
- 추정 연 변동성은 자산군 상수(`CB_VOL`)의 보유비중 가중평균이되 **레버리지·인버스 상품은 노출 배수만큼 키워** 반영한다(`cbLeveragedInverseMeta().mult` — 상품명의 배수 → `CB_LEV_MULT` 표 → 레버리지 2배/인버스 1배 순). 종목별 실제 변동성과 종목 간 상관관계는 여전히 반영하지 않으며 툴팁이 그 사실을 밝힌다.
- **ETF 간 중복도(`cbEtfCrossOverlap`)는 기존 룩스루와 별개 지표다.** 룩스루는 '직접 보유 회사와 겹치는 부분'만 세므로(그 규칙은 그대로 둔다) 직접 보유가 없으면 0 으로 보인다. 이 지표는 같은 소유주의 서로 다른 ETF 가 동시에 담은 회사를 직접 보유 여부와 무관하게 센다. 소유주 경계는 룩스루와 같고, 구성종목을 못 받았거나 잠정인 ETF 는 합산에서 빼고 그 사실을 함께 표시한다. 리스크 카드 그리드는 행 수를 고정하지 않는다 — 고정하면 카드를 추가해도 화면에서 조용히 사라진다.
- Owner exposure uses that owner's entire investment portfolio (stocks/ETFs, crypto, gold and cash; excluding property/debt) as the denominator. ETF value is counted once; indirect stock exposure is ETF value multiplied by its original published stock weight. Separately show direct/indirect shares of the selected stock exposure as 100%. Aggregate accounts within an owner, never mix owner denominators, and distinguish incomplete/retained/undated data from verified zero exposure. This view does not change the existing direct-stock-intersection rule in risk analysis.

### Consolidated workspace (2026-09-08)

- Navigation is defined in `navigation.js`: seven menu families, secondary links retain existing view IDs. `snap`/`dashboard`/`balance2` resolve to `cdash` before history recording. Keep active menu/title, owner scope across related tabs, and back/forward in sync. Home contains investment summaries and compact allocation/ranking cards; a searchable owner-scoped holdings table remains on home, while editing belongs to asset management. `plan2` is goals, `rebal2` is allocation/account diagnostics, `dca2` is scheduling, `sim2` is scenarios.
- Script order: `tax-rules.js` → `script.js` → `finance.js` → `navigation.js` → `backtest.js` → `simulator.js` → `dca-editor.js` → `etf-explorer.js` → `cobalt.js` → `allocation-3d.js`. The new modules define functions only until Cobalt renders. `workspace-ui.css` follows `style.css`.
- Scenarios are memory-only: never persist, update actual holdings or execute trades. Contributions are external funds; prices/FX fixed, returns 0%, fees/taxes/dividends/lot sizes excluded. Validate finite nonnegative inputs and 100% target weights; rounded KRW allocations must conserve the budget. Keep inputs/focus while results update. Scenario and DCA numeric controls use `data-no-comma="1"` to retain native numeric validation. Mobile can edit scenarios although actual finance records remain read-only.
- DCA edits change only the selected asset object's plan fields. Require both remote loads ready, preserve valuation/cost fields, reject stale item references, retain drafts and roll back in-memory plan changes on failure. All writes use the existing CAS save path. No simulated fills.

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

- Scripts load in the order listed in Consolidated workspace above. `cobalt.js` wraps `switchView`, `changeOwner`, `saveAssetsToKV`, `loadAssetsFromKV`, `loadExtDataFromKV`, `fetchDivData`, `updateBenchmark`, `setTheme`, `liveRefresh`, `refreshPyData` to re-render the active page and stamp data-freshness. It must follow the finance/navigation/simulator/editor definitions it references in `CB_VIEWS`. The optional 3D enhancement loads after Cobalt.
- `index.html` defines every view as `<div id="view-*">` siblings; `switchView(viewId)` toggles `.active`. A new page needs a view/container, a renderer in `CB_VIEWS`, and an entry in the appropriate `APP_NAV` family. Keep seven top-level destinations rather than adding a menu button per page. Legacy pages use `CB_LEGACY_SUB` for header descriptions.
- `script.js` is a single ~9,100-line file with all logic. Globals shared across modules are real `window.` globals — `pfolioData`, `currentOwner`, `_bubbleOwner`, `_divDataCache`, `RATES`, `benchData`, `divHistory`, `_netWorthHistory`, `_balanceSheet`, `_targetAlloc`, `goalData`, etc. There is no module system; ordering in the file matters.
- Charting: **Chart.js 4.4.1** for the 현금 흐름 bar/donut charts and **Plotly 2.26.0** for the bubble/sunburst-trace chart (`renderBubbleChart` in `script.js`) — both loaded from CDN in `index.html` with SRI. Highcharts was dropped when the legacy views went: its only user was the 히트맵 treemap in `view-analysis`. **Cobalt pages use no chart library at all** — they render inline SVG (`cbDonutSvg`, `cbRingSvg`, `finNwChartSvg`), because a page redrawn by `innerHTML` replacement would otherwise need chart-instance lifecycle management.
- Persistent state is stored in **Upstash Redis (KV)** via `getKV` / `setKV` (`saveAssetsToKV`, `loadAssetsFromKV`), which call the server-side proxy `api/kv.ts` — the Upstash credentials live in Vercel env vars (`KV_REST_API_URL`, `KV_REST_API_TOKEN`), never in the client. Local `localStorage` is used only for short-lived caches (e.g. `divCache_<YYYY-MM-DD>`, `cfData`).

### Backend — six Vercel serverless functions under `api/`

Each file is a self-contained handler; they only call each other over HTTP (e.g. `price.ts` calls `/api/dashboard?type=dividend` for the pykrx pathway).

- `api/dashboard.py` (Python `BaseHTTPRequestHandler`) — multiplexed by `?type=` query param: `rates`, `gold`, `price`, `dividend`, `health`, `benchmark`, `resolve`, `etf_holdings`. Uses `yfinance` for global tickers and `pykrx` for KRX-only data (KR fundamentals, names, codes). Always returns `{'success': bool, ...}`; on failure returns `'미조회'` instead of raising. (ETF 구성종목 조회는 이 라우트에서 제거됐다 — 아래 배치 참조.)
- `api/price.ts` — TypeScript handler also multiplexed by `?type=` (기본 시세·`dividend`·`dividend_history`·`splits`·`ohlcv` — 화면이 부르는 것만 둔다. 예전의 `sector`·`search`·`macro`·`news`·`heatmap` 은 호출부가 없어 지웠다); primary frontend-facing price/dividend route. For `type=dividend` the flow is **pykrx first → Yahoo `events=div` fallback** (used so ETF distributions on KR ETFs are still picked up when pykrx returns no DIV).
- `api/get-stock.ts` — search route. Tries Naver scraping (`searchNaver`, `searchByNaverAC`, `fetchNaverFinance`), then **Yahoo Finance search API** (`searchYahoo`) as the broad-coverage fallback for US tickers Naver doesn't index. Accepts both `?q=` and `?query=` (frontend uses `?query=`).
- `api/stock-price.js` — additional price helper (Node); 네이버 금융 스크래핑으로 국내 주식/ETF 실시간 가격을 반환 (`liveRefreshDomesticEtfs`가 호출).
- `api/kv.ts` — Upstash Redis(KV) 프록시이자 **낙관적 동시성(CAS) 게이트**. 키는 `assets` / `ext_data` / `data_freshness` 세 개만 허용하는 allowlist(자유 문자열 화이트리스트가 아니다). GET `/api/kv?key=`는 값과 개정번호를 한 Lua 스크립트로 함께 읽어 `{result, revision}`을 반환한다(Upstash 원형을 그대로 흘리지 않는다). POST `{value, expectedRevision}`은 `__revision__:<key>`가 `expectedRevision`과 같을 때만 쓰고 개정번호를 올린다 — 불일치면 **409**(현재 revision 동봉), `expectedRevision` 누락이면 **428**, 값이 1MB를 넘으면 413, 상류 실패·응답 형식 오류는 **502**다. 프런트 짝은 `script.js`의 `_kvRevisions` 맵과 `_setKVOnce` / `setKV`(키별 쓰기 직렬화 큐)이며, 409를 받으면 대기 중이던 같은 탭 저장까지 중단해 오래된 메모리 상태가 새 revision을 덮어쓰지 않게 한다.
- `api/auth.ts` — 비밀번호 인증 라우트. POST `{password}`가 `DASHBOARD_PASSWORD`와 일치하면 `SESSION_SECRET`으로 서명한 HttpOnly 세션 쿠키를 발급한다. 기존 배포는 `SESSION_SECRET`이 없을 때 `AUTH_TOKEN`을 서버 내부 서명 키로만 임시 사용하며 bearer로는 허용하지 않는다. 서버 내부 `/api/dashboard` 호출은 별도 `INTERNAL_API_TOKEN` 또는 사용자의 세션 쿠키를 사용한다. 필수 환경변수 미설정 시 fail-closed(500).
- `api/price.ts?type=ohlcv&tkr=...&range=1y` — OHLCV+벤치마크 시계열 엔드포인트(`price.ts`에 존재). KR 6자 코드는 `.KS → .KQ` 폴백, 응답에 타깃 bars + `^GSPC` / `^KS11` / 섹터 ETF 종가 동봉. (`backtest.js`의 과거 성과 백테스트가 이 엔드포인트를 호출한다.)

### ETF 구성종목 수집 — GitHub Actions 배치

브라우저에서 외부 사이트를 직접 fetch 하면 CORS 로 막히고, 서버리스 경유는 KRX 왕복이
함수 제한시간을 넘겨 룩스루가 자주 비었다. 긴 재시도와 영구 이력 수집은 CI에서 처리하고, 페이지 진입 시에는 인증 API의 제한된 HTTP 소스도 별도로 조회한다.

- `.github/workflows/etf-holdings.yml` — 미국 장 마감 뒤 평일 KST 07:30(cron `30 22 * * 1-5` UTC) + 수동 실행.
  스모크 테스트(5행 미만 실패, 30행 미만 경고) → 파서 단위 테스트 → 수집 → 변경 시에만 커밋.
  리포 시크릿 `KV_REST_API_URL` / `KV_REST_API_TOKEN` 필요. KRX 경로를 쓰려면 `KRX_ID` / `KRX_PW` 도 함께 설정한다 — 없으면 스모크가 대체 소스로 내려가 조용히 통과할 수 있다.
- `scripts/collect_etf_holdings.py` — KV `assets` 에서 보유 ETF를 추려 수집한다.
  국내는 KRX 내부 JSON API(`bld=dbms/MDC/STAT/standard/MDCSTAT05001`, `isuCd`=12자리 ISIN;
  단축코드→ISIN 매핑은 `MDCSTAT04601`. 두 bld 값 모두 pykrx 소스에서 확인한 것), 실패 시
  ZEROIN 전체 구성종목(운용사 공통) → 운용사 어댑터(TIGER 공식 PDF AJAX) → 네이버 증권 →
  Playwright 순. 해외는 **stockanalysis(전체 바스켓일 때) → 공식 보유명세 파일 → stockanalysis(부분) →
  yfinance → 티커 별칭** 순이다.
  **yfinance 를 stockanalysis 앞에 두지 않는다** — `funds_data.top_holdings` 는 정의상 상위 10종목만
  주는데 먼저 성공하면 체인이 끊겨 전체 바스켓을 영영 못 받는다. 실제로 DRAM 이 3종목(주식비중 40.7%),
  SPYM·1629 가 10종목으로 굳어 룩스루 간접 노출이 통째로 축소됐다.
  **원칙은 '완전한 출처가 먼저, 부분 출처는 폴백'이지 출처의 종류가 아니다.** 그래서 신선한 전체
  바스켓을 받았다면 그쪽이 고정 파일보다 우선이고, 부분 목록뿐이면 파일이 이긴다.
  **pykrx 래퍼를 쓰지 않는다** — 래퍼가 `COMPST_ISU_CD` 를 `[3:9]` 로 잘라
  US ISIN(`US67066G1040`)을 `066G10` 으로 망가뜨려 해외 편입 종목을 매칭할 수 없게 만든다.
- `scripts/etf_sources.py` + `data/etf_sources/` — **운용사 공식 보유명세 파일 어댑터.**
  공개 조회 소스가 상위 N개만 주는 해외 ETF(1629·SPYM·DRAM)를 위해 운용사 공시 파일을 리포에 커밋해 쓴다.
  순서를 바꿔 GitHub Actions 에서 실제로 돌려 봐도 셋 다 그대로였고(run 35073894717), funetf.co.kr 은
  국내 상장 ETF 카탈로그라 해당 없다. **표준 라이브러리만 쓴다** — xlsx 는 `zipfile`+`ElementTree`,
  PDF 는 콘텐츠 스트림의 `BT`/`Td`/`Tj` 좌표를 직접 읽는다(openpyxl·pypdf 를 넣지 않는다).
  - 등록은 `data/etf_sources/index.json`. **검증에 하나라도 실패하면 조용히 기존 체인으로 폴백한다**
    (식별자 불일치 / 기준일 파싱 실패 / 헤더 불일치 / 비중 합계가 97~103% 밖 / 기대 행 수 미달).
  - `coverage='full'` 의 근거는 **파일의 비중이 순자산 100%를 설명한다는 것**이다 — 상위 N개 목록은
    이 밴드에 들어올 수 없다. 출처가 '파일'이라는 사실 자체는 근거가 아니다.
  - PDF 의 `BT`…`ET` 블록을 정규식으로 찾지 않는다. 본문에 `DRAM ETF Holdings` 같은 문자열이 있으면
    ` ET` 가 먼저 걸려 블록이 잘린다(실제로 표지 제목이 통째로 사라졌다). 줄 단위로 읽고 괄호 깊이를 센다.
  - 반올림 후 `0.0000%` 인 행은 버린다 — SPDR 표의 `CONTRA …`(합병 대기 자리표시자)가 여기 해당한다.
  - `005930 KS` 같은 Bloomberg 접미사는 **알려진 거래소 목록에 한해서만** 뗀다. 공백 뒤를 무조건 버리지 않는다.
  - **한계: 파일이 고정이라 기준일이 멈춘다.** `etfQuality` 기준을 넘기면 '기준일 지연'으로 표시되는데
    그게 사실 그대로다. 갱신은 같은 경로에 새 파일을 덮어쓰고 `expect` 를 맞추면 된다.
    등록에 `url` 을 채우면 `fetch_local_source` 가 매 수집 때 그 주소에서 새 파일을 먼저 받아
    검증하고, 실패(네트워크·형식·검증 모두 포함)하면 조용히 커밋된 파일로 내려간다 — 일일
    공시 상품(SPYM·DRAM)은 이 경로로 고정 기준일 문제 자체를 없앨 수 있다. `url` 없이 두면
    지금처럼 커밋된 파일만 쓴다(동작 변화 없음).
  - **월 1회만 공시하는 상품은 `disclosure:'monthly'` 로 등록한다.** 1629(NEXT FUNDS)처럼 월말에만
    구성종목을 공시하는 상품을 평일 5일 기준으로 재면 매달 대부분의 날짜가 '지연'이 된다 — 파일을
    갱신해도 구조적으로 반복된다. `scripts/collect_etf_holdings.py` 의 `run()` 이 `index.json` 의
    `disclosure` 를 스냅샷 엔트리에 옮겨 적고(프런트는 `data/etf_holdings.json` 만 읽으므로
    `index.json` 자체는 전달되지 않는다), `etfQuality`(etf-explorer.js) 와 `snapshot_stale`
    (collect_etf_holdings.py) 이 그 항목엔 5평일 대신 `ETF_MONTHLY_DISCLOSURE_LIMIT_WEEKDAYS`
    (35평일 — 월간 주기 약 21평일 + 공시 유예 약 2주)를 쓴다. **두 상수는 반드시 같은 값이어야
    한다** — 프런트가 권위이고 Python 쪽이 이를 따라간다.
- **기초자산이 명시된 스왑(TRS)은 그 종목의 노출로 센다 — `parse_tema_pdf` 안에서만.**
  QLD 금지 규칙은 스왑 바스켓 내용을 **알 수 없어서** 둔 것이라 여기에 해당하지 않는다. 근거는 이름
  추측이 아니라 운용사가 쓴 식별자다 — 스왑 행 Identifier 의 첫 토큰이 기초자산의 CUSIP/SEDOL 이고
  그 값이 **같은 표의 현물 주식 행 Identifier 와 일치**한다(`595112103`→MU, `6771720`→005930,
  `6450267`→000660). 현물 행에 없는 기초자산(비상장 CXMT `BTMTQT8`)은 식별자를 코드로 남긴다 —
  어떤 직접 보유와도 매칭되지 않으므로 허위 룩스루를 만들 수 없다.
  `NON_EQUITY_NAME_RE` 의 `스왑|SWAP` 제외는 그대로 두고, 다른 어댑터로 넓히지 않는다.
  **총 노출이 100%를 넘을 수 있다**(DRAM 100.19% — 국채·MMF 담보 위에 스왑을 얹은 구조).
  재정규화하지 않는다.
- `scripts/etf_common.py` — 코드 정규화·주식 판별·소스별 파서. 현금/채권/선물 행은 버리고,
  **비중은 100%로 재정규화하지 않는다**(ETF 순자산 대비 원값 유지 → `equityWeight` 로 주식 비중 합 노출).
  삼성전자/삼성전자우, GOOGL/GOOG 는 통합하지 않는다.
- **`coverage` 는 출처 이름이 아니라 '전부 받았다는 근거'로 정한다.** `collect_one` 이 다섯 번째 값으로
  완전성을 돌려주고 그것만이 `coverage='full'` 의 근거다. stockanalysis 는 응답이 전체 종목 수를
  스스로 밝히고 그 수가 읽은 행 수와 같을 때만 full 이며, 기준일도 응답이 줄 때만 채운다.
  기준일이 있다고 완전한 목록인 것은 아니다 — 상위 N 개 목록에도 날짜는 붙을 수 있다.
  영숫자가 하나도 없는 코드(`--`, `-`)는 티커가 아니라 자리표시자이므로 주식 행에서 제외한다.
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

- `.github/workflows/net-worth-snapshot.yml` — 매일 KST 16:40(cron `40 7 * * *` UTC) + 수동 실행(dry-run 옵션).
  **이 시각을 늦추지 않는다.** GitHub 예약 실행은 몇 시간씩 밀리고(실측 3시간 24분), 기록 날짜는 실행 시각의 KST 날짜라 지연이 KST 자정(UTC 15:00)을 넘기면 그날 항목이 다음 날짜로 찍히고 다음 날 실행이 덮어써 **하루가 통째로 빈다**.
  **기록 전에 계산 대조 테스트를 먼저 통과시킨다.** 리포 시크릿 `KV_REST_API_URL` / `KV_REST_API_TOKEN` 필요.
  ETF 배치와 달리 리포에 커밋하지 않는다 — **운영 KV 의 `ext_data` 를 직접 쓴다**(`permissions: contents: read`).
- `scripts/net_worth_snapshot.py` — KV `assets`·`ext_data` 를 읽어 시세를 갱신하고 오늘자 항목을 기록한다.
  - 시세 조회는 `api/dashboard.py` 를 import 해 그대로 쓴다(중복 구현 금지). 다만 **시장 판정은 저장된 `grp`/`cur`** 로 한다
    — `get_prices` 의 `isdigit()` 규칙은 KRX 영숫자 코드(`0117V0`)를 미국 주식으로 오인한다.
  - 쓰기는 `api/kv.ts` 와 **같은 CAS 프로토콜**(개정번호)로 하고 충돌 시 최대 3회 재시도한다 — 사용자가 앱에서 저장 중인 내용을 덮어쓰지 않는다.
  - 시세를 못 받은 종목은 **0 이 아니라 저장된 직전 값을 유지한다**(가짜 급락 방지). USD 환율 조회에 실패하면 아예 기록하지 않는다.
  - 날짜는 **KST 기준**이다 — 러너는 UTC라 그대로 쓰면 하루 밀려 같은 날이 두 건이 된다.
  - **예약 실행은 '실행 시각'이 아니라 '직전 예정 시각(UTC 07:40)의 KST 날짜'를 기준일로 쓴다**
    (`scheduled_kst_date`, 워크플로가 `--anchor-utc 07:40` 을 예약 실행에만 넘긴다).
    실측 지연이 중앙값 4시간 56분·최악 6시간 44분(KST 23:24, 경계까지 36분)이라 여유만으로는
    언젠가 자정을 넘긴다. 수동 실행은 앵커 없이 현재 KST 날짜를 쓴다.
    `build_entry` 는 날짜를 인자로 받으므로 이 규칙은 계산을 건드리지 않는다 — 앱과의 대조 테스트는 그대로 유효하다.

### Cross-cutting domain rules baked into the code

- **Owners** are a fixed enum: `본인 / 아내 / 자녀1 / 아버지`, plus `전체` for the aggregate view. Owner-keyed objects (`benchData[tf].data`, `divHistory[year]`, `ownerColors`) all assume this list.
- **Asset groups** (`item.grp`) are `주식 / 가상화폐 / 금 / 현금`. ETFs live under `주식`. The bubble/sunburst chart only includes `주식` + `가상화폐`.
- **Currency normalization**: 지원 통화의 **단일 출처는 `script.js` 의 `CURRENCY_META`** 이고 `CASH_CURRENCIES` 가 그 목록이다(현재 KRW/USD/JPY/AUD). 기호·현금 소수 자릿수·국기를 여기서만 정의하고, `fixAssetCurrencies` 의 allow-list 도 이 목록을 그대로 쓴다 — 예전처럼 `cur==='USD'?'$':(cur==='JPY'?'¥':'₩')` 3항 분기를 파일마다 두면 통화를 늘릴 때 반드시 몇 군데를 빠뜨린다(호주달러 예수금에 태극기가 붙었다). `cbFmtNative`·현금 배지·국기·잔액 입력 소수 허용이 모두 이 정의를 따른다.
  `RATES = { USD, JPY, AUD, KRW: 1 }` 는 `/api/dashboard?type=rates`(`usd_krw`/`usd_jpy`/`jpy100_krw`/`aud_krw`)로 갱신된다. **지원 통화에는 반드시 환율 시드값을 둔다** — 없으면 `RATES[cur]||1` 경로가 1:1 로 떨어져 A$1 이 ₩1 로 계산된다. 조회에 실패해도 시드를 지우지 않고 `_priceStale` 로만 드러낸다. 배치(`net_worth_snapshot.py`)는 `missing_rate_currencies` 로 **보유 통화의 환율이 하나라도 없으면 기록을 건너뛴다** — 계산 규칙(`asset_value_krw` 의 `rates.get(cur,1)`)은 앱과 같아야 하므로 그대로 두고 기록 직전에 막는다.
  Per-item `cur` should be `USD` for US stocks, `KRW` for everything else; `fixAssetCurrencies` auto-corrects misclassified rows on load using `KNOWN_US_TICKERS` and a 6-char alphanumeric regex for KRX codes (note the regex allows letters, e.g. `0117V0` for newer KRX codes).
- **시세·배당 응답은 `quoteKey(tkr)`(앞뒤 공백 제거 + 대문자)로 매칭한다.** 서버(`api/price.ts`)가 요청 티커를 그렇게 바꿔 응답 키로 쓰므로, 저장된 `bmnu`·` NVDA` 를 그대로 찾으면 **가격을 받고도 매번 '미조회'**가 된다. `normTkr`/`normDivTkr` 도 `quoteKey` 위에 있다. 저장된 티커 문자열 자체는 바꾸지 않는다(수정·삭제가 그 값으로 행을 찾는다). **`_priceStale` 은 켜는 곳마다 끄는 곳이 있어야 한다** — KV 에 저장돼 다음 접속까지 따라오므로, 금(금 시세 수신 시)·현금(`curRateKnown`)처럼 켜기만 하던 경로는 데이터 상태를 영구 빨간불로 만든다. `scripts/tests/test_ticker_chunking.mjs` 가 지킨다.
- **KR ticker shape**: stripped form is `^[0-9A-Z]{6}$` (not just digits — KRX issues alphanumeric short codes). Suffix `.KS` (KOSPI) or `.KQ` (KOSDAQ) is used when calling Yahoo. `data/stocks.json` is loaded into `window._krStocksDB` for autocomplete; `KR_TICKERS` and `US_LOCAL` arrays in `script.js` are small offline fallbacks only.
- **Benchmark math**: `_jsBenchmarkFallback` (JS) and `get_benchmark` (Python) both **drop today's intraday bar** before computing period returns, and use `^GSPC` / `^KS11` (the actual indices), not the SPY/069500 ETFs. Note this is a **backcast** — today's holdings and weights are applied retroactively over the whole period, so 성과 비교 is not a realized return and the page says so. Actual money over time lives in `_netWorthHistory` (see below).
- **Dividend pipeline**: `fetchDivData` populates `window._divDataCache` per-ticker → `syncDivHistory` projects that into `divHistory[year][owner][month]` (net) and `divHistoryGross[...]` (gross), applying ISA/연금 tax rules per `getAccountDivTaxInfo(item.acc)`. Only items with `grp === '주식'` contribute. ETF distributions are treated as dividends (Yahoo's `events.dividends` covers both). Years come from `divHistoryYears()` (작년·올해·내년) — never hard-code them; read a year with `divHistoryOf(year, owner)`, which always returns a 12-slot array.
- **티커 목록은 반드시 서버 상한에 맞춰 잘라 보낸다.** 서버는 요청당 티커 수를 검증한다 — `api/price.ts`·`api/dashboard.py`의 `MAX_TICKERS = 25`, 벤치마크 포트폴리오(`p_tkrs`)는 `api/dashboard.py`에서 **20**. 상한을 넘기면 서버가 요청 *전체*를 `too_many_tickers`로 거부하므로, 보유 종목이 늘어난 순간 시세·배당이 통째로 비고 데이터 상태가 영구히 '확인 필요'로 남는다. 클라이언트는 `script.js`의 `API_TICKER_CHUNK`(25) / `BENCH_TICKER_LIMIT`(20)과 `_chunkTickers()`를 써서 나눠 보낸다 — `liveRefresh`, `fetchDivData`, `fetchPyPrices`, `fetchPyDividends`가 청크로 요청하고 결과를 병합하며, `fetchBenchmarkData`의 `loadOwner`는 평가액 상위 20종목만 보낸다(주석의 'Top-N 시뮬레이션'이 이 뜻이다). **상한은 입력 검증이므로 올려서 해결하지 않는다.** 부분 실패는 숨기지 않는다 — 성공한 청크의 값은 반영하되 `ok:false`로 보고하고, `fetchDivData`는 **성공한 청크의 티커만** `divCacheTickers_<날짜>`에 verified로 기록한다(실패분을 verified로 적으면 다음 접속에서 조회 없이 넘어가 배당이 영영 빈다).
- **소유주 벤치마크 라인이 없으면 성공으로 보고하지 않는다.** `fetchBenchmarkData`의 `targets`와 `cobalt.js` `cbVerifyPerfOwnersOnOpen`의 `investedOwners`는 **둘 다 `qty` 기준**이어야 한다(`curP`를 요구하면 시세가 빈 소유주가 조용히 대상에서 빠져 라인이 없는데도 초록불이 된다). `loadOwner`도 보유 종목이 있는 소유주는 포트폴리오 시리즈를 받아야만 성공으로 센다.
- **가족 증여 화면도 소유주 탭을 렌더한다** — 같은 메뉴 가족(`tax2` ↔ `gift2`)이 `_cbTaxOwner` 를 공유하고 `cbTaxOwner(o)` 가 **지금 열린 화면**을 다시 그린다(투자 계획 가족의 `finPlanOwner` 와 같은 방식). 위젯 없이 `cbSetHead` 를 부르면 `#cb-head-widgets` 가 `display:none` 이 되고, 헤더 컨트롤 줄이 `justify-content:flex-end` 라 **세부 메뉴 링크가 그 폭만큼 오른쪽으로 튄다**(실측 324px, 1280~1440px 에서는 헤더 높이까지 63↔102px 로 바뀜). 탭을 살리면 146px 로 줄고 높이도 대부분 맞는다.
  증여 금액은 **가구 공통 계획 하나**(자녀 한 명·배우자 한 명)라 소유주별로 다시 계산하지 않는다. 대신 `cbGiftOwnerScope(owner)` 가 **그 소유주가 당사자인 계획만** 남긴다 — 전체·본인은 둘 다(본인이 증여자), 아내는 부부 증여, 자녀1은 자녀 증여, 아버지는 해당 없음이라 이유를 밝히는 안내를 그린다. 소유주 enum 이 `본인/아내/자녀1/아버지` 로 고정이라 이 당사자 판정이 확정적이다. **아무것도 거르지 않는 탭을 그리지 않는다** — 그건 필터가 있다는 거짓말이다.
- **Tax and gift values have exactly one source**: `tax-rules.js`. Production calculations read it through `assetTaxRuleValue` / `_taxRuleValue`; do not add tax thresholds, rates, deductions, effective dates, or legal assumptions inline. `assetTaxRuleDisclosureHtml` must remain attached to 배당 관리, 양도소득세, 가족 증여, and their legacy views. Monthly realized-P/L records preserve the applicable `ruleSetId`.
- **Dividend cash-flow has exactly one engine**: `allocateDividendTax(entries, threshold)` in `script.js`, on top of `getAccountDivTaxInfo(acc)`. Every consumer routes through it — `syncDivHistory`, `cbDivTaxAllocate`, `cbDivMonthlyForYear`, `finAccountDiagnostics`, and `autoAddDividendCashFlow`.
  The engine's ISA 200만원/9.9% calculation is only an **annual cash-flow approximation** because the app does not know the account's full lifetime statutory net income. It is not an annual legal exemption. Feed every holding at once so the approximation is applied once per owner and split pro rata, and keep every ISA result labelled `연간 현금흐름 참고`; actual ISA tax is settled at maturity/termination over the account lifetime.
  The financial-income threshold card is also a **partial proximity indicator** based only on general-account dividends entered in the app. Never label it a legal comprehensive-tax determination; interest and external financial income are excluded.
- **Tax-rule update procedure**: edit values, official sources, assumptions/exclusions, `verifiedAt`, `nextReviewAt`, period version, and `manifestVersion` together; add an entry to `docs/tax-rule-changelog.md`; run `npm run check:tax-rules`, `npm run check:tax-rules:remote`, and `npm test`. The daily `.github/workflows/tax-rule-watch.yml` may only alert; it must never auto-change legal values. Unsupported future years and expired human-review dates must remain visibly non-verified.
  **감시기는 '규칙 변경'과 '출처 접속 실패'를 같은 심각도로 다루지 않는다.** `scripts/check-tax-rule-sources.mjs`의 종료 코드가 그 구분이다 — `1` = 매니페스트 오류·변경 의심·일부 출처만 실패(진짜 확인할 것이 생김, 실행 빨강), `2` = **한 곳도 읽지 못함**(law.go.kr 접속 장애. 규칙이 바뀐 신호가 아니므로 워크플로가 경고로 낮추고, 검토 이슈는 그대로 연다). 둘을 합치면 접속 장애가 이어지는 동안 매일 같은 빨간 X 가 쌓여 그 사이의 진짜 변경을 지나치게 된다. 실제로 law.go.kr 이 17개 출처 전부 timeout 나며 이 상태가 됐다.
- **Dividend cash-flow auto-registration deletes rows.** `autoAddDividendCashFlow` prunes app-generated `divKey` rows (6-part `div_TKR_OWNER_ACCTYPE_YR_MO`) for the viewed 연·월. It may only delete on *positive* evidence: the holding is gone, the user deleted the key, or a **cache/API-confirmed** schedule (`_divSource === 'cache'`) says there is no payment that month. A static-DB fallback (`_divSource === 'db'`) shows up even when the API failed, so it is never grounds for deletion — otherwise a failed fetch erases real records. Rows without a `divKey`, and rows outside the viewed 연·월, are never touched. `scripts/tests/test_dividend_tax.mjs` pins all of these.
- **액면분할·병합은 사용자에게 묻지 않고 자동 반영한다 — 근거는 항목의 `splitCheckedAt`(이 날짜 기준으로 수량·매입가가 맞다는 기준일) 하나다.** 등록·수정 모달 저장(`newData`)과 수량/매입가 인라인 수정이 오늘 날짜를 찍고, `checkSplitAdjustments` 는 그 날짜 **이후** Yahoo 분할만 수량×ratio·매입가÷ratio(취득원가 보존)로 바꾸고 기준일을 분할일로 올린다 — 값과 기준일이 한 저장에 같이 들어가 두 번 곱해지지 않고, 저장 실패 시 메모리를 전부 되돌린다. 기준일이 빈 레거시 항목은 숫자를 건드리지 않고 오늘로 백필한다. 예전 배너는 기준일이 비면 5년치 분할을 전부 후보로 띄웠고 모달이 `splitCheckedAt` 을 버려서, **사기 전의 분할까지 반영하라고 물었다**. 사용자가 직접 확인한 값은 `SPLIT_ONE_TIME_FIXES`(행이 정확히 하나이고 기준일이 공시일 이전일 때만)로 넣는다. `scripts/tests/test_split_detection.mjs` 가 지킨다.
- 현금 안전판 목표 개월수(`cashTargetMonths`)는 **투자 계획 > 목표의 `finGoalContext` 현금 안전판 패널**에서 바꾼다(`finSaveCashTarget` → `cbRenderPlan`). 그 화면이 이미 같은 값을 '현금 안전판 · 월 필수지출 기준'으로 보여주고 있어 바로 옆이 제자리다. 모바일은 읽기 전용이라 `finMobileNote` 를 렌더한다. 리스크 진단의 '현금 유동성 커버리지' 카드는 제거했고, **그 카드만 쓰던 인사이트 `control` 슬롯과 `.cb-risk-insight-control` CSS 도 함께 지웠다** — 보조 진단은 8개다.
  `finGoalContext`의 세 `.cb-panel`(투자자산·월 적립·현금 안전판)은 값 줄이 같은 높이에 오도록 `display:flex;flex-direction:column`이고, 현금 안전판 패널만 있는 `.fin-cash-target`(목표 개월 입력·저장·부족액)은 `<b>` **앞에** 둔다 — 뒤에 두면 그 CSS의 `border-top`이 행 높이를 키워 옆 두 패널엔 없는 '3번째 층'이 카드 맨 아래에 떠 보인다.
- **목표 연결 자산군 도넛**(`finGoalAllocationCard`, 투자 계획 > 목표)은 `goalData`를 `linkClass`로 묶어 `cbDonutSvg`로 그린다. CB_CLS 키(crypto/us/kr/jp/gold/cash)는 그 자산군 버킷으로, `net`/`investment`/`manual`은 `FIN_GOAL_BUCKET_META`의 순자산·투자자산·직접 입력 버킷으로 묶는다. 버킷 금액은 **`finGoalCurrent`가 이미 계산한 값을 그대로 합산**하며 새로 계산하지 않는다. 목표는 가구 공통이라(소유주 필드 없음) 오너 필터를 받지 않는다. `clickFn`을 넘기지 않는다 — onclick이 붙으면 `test_layout_guards.mjs`가 `role="button" tabindex="0"`을 요구한다. 연결된 목표가 없으면(버킷 합계 0) 카드를 렌더하지 않는다.
- **"월 필수지출" has exactly one definition**: `finMonthlyFixedCost(ownerF)` in `finance.js` — 지출 autoTransfers with `isFixedCost === true`, excluding `FIN_SAVING_CATS` ('저축/투자', an asset transfer that doesn't reduce net worth), sized by `_autoTransferMonthlyEquivalent`. Unclassified (`isFixedCost == null`) rows are **not** summed; they come back as `pendingCount`/`pendingMonthly` so the UI can nag. The 리스크 진단 liquidity card delegates to `finCashSafety` so both pages show the same number — don't re-derive it.
- **Net worth history**: `updateNetWorthSnapshot()` rewrites today's entry in `window._netWorthHistory` (max 365 days) **in memory only** — the caller decides whether to persist, so 재무상태표 CRUD can refresh the KPI without an extra KV write. `saveNetWorthSnapshot()` does update + save. Persisted in KV `ext_data`.
  Entries come in three shapes and `finSnapshotKind(entry)` is the only thing that may classify them: `schemaV >= 2` → `full`; `schemaV === 1` → `investment`; **no `schemaV` at all → look at the structure** (`nonInvestmentAssets` or `netByOwner` present ⇒ `full`, else `investment`), because an intermediate build wrote full net worth without stamping a version. Treating every unversioned entry as v1 throws away comparable history. `finSnapshotNet` / `finSnapshotOwnerNet` build on it; comparing shapes blindly makes the day a user registers real estate look like a market move. 차트는 **투자 분석 > 성과**의 '투자자산 추이' 카드(`finInvestTrendCard`)에 있다 — 한눈에 보기와 재무상태표 화면이 사라지면서 옮겼다. 소유주 버튼과 기간 버튼은 `.fin-trend-tabs` 안의 **서로 다른 `.owner-tabs` 두 개**다(하나로 이어 붙이면 '전체'가 두 번 나오고 경계가 사라진다). hover 가이드(`#fin-nw-guide` 세로 점선 + `#fin-nw-marker`)는 **SVG 안**에 둔다 — 성과 차트처럼 HTML 오버레이로 하면 `viewBox` 의 padL/padR 을 퍼센트로 다시 계산해야 하는데, 렌더 시점에 이미 정확한 좌표를 알고 있다. 부동산·부채는 대시보드에서 관리하지 않으므로 순자산이 아니라 **스냅샷의 `portfolio` / `portfolioByOwner`(투자자산)만** 그린다(`finSnapshotInvestment`). `portfolio` 가 없는 과거 'full' 항목은 `total - nonInvestmentAssets + liabilities` 로 역산하고, 구성요소마저 없으면 버린다. 이 기준은 v1·v2 가 바로 비교되므로 순자산 기준보다 커버리지가 넓다. 성과 비교는 백캐스트라 실제 금액 추이가 아니며, 그 각주가 이 카드를 가리킨다.
  **순자산 계산은 이제 두 곳에 있다** — 앱의 `updateNetWorthSnapshot`(브라우저를 열 때)과 배치의 `scripts/net_worth_snapshot.py` `build_entry`(매일 KST 16:40, 아래 참조). 둘은 같은 `netWorthHistory` 배열에 번갈아 `schemaV: 2` 항목을 쓰므로 **한쪽만 고치면 같은 그래프에 기준이 다른 점이 섞이고** 브리지의 '설명되지 않는 차이'가 통째로 왜곡된다. 한쪽을 고치면 반드시 다른 쪽도 고치고, `scripts/tests/test_net_worth_snapshot.py`가 같은 입력을 양쪽에 넣어 결과를 대조한다(node 를 못 돌리면 로컬에서만 SKIP, **CI 에서는 실패**).
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
- **월별 현금흐름의 '선택 달 요약'(`cfMonthSummaryHtml`)은 독립 패널이 아니라 우측 수입/지출 구성 차트 카드 하단(`#cf-month-summary`, `.cf-chart-summary`)에 붙는다.** 예전엔 별도 요약 패널과 차트 카드가 총수입·총지출·순현금흐름을 각각 표시해 중복이었다 — 차트 카드의 정적 `#cf-tot-in`/`#cf-tot-out`/`#cf-tot-net`은 지웠고 `cfMonthSummaryHtml`의 출력이 그 세 값의 유일한 출처다. `.cf-grid`에서 `.cf-chart-column`이 `grid-row:1/3`으로 입력부+예전 요약 패널 두 행을 모두 차지해 차트 열 전체 세로 폭이 커진다. **새 계산을 하지 않는다** — `renderCashFlow` 가 이미 구한 `tIn`/`tOut`/`expByCat` 만 받는다. **저축률과 순현금흐름은 서로 다른 숫자다**: 순현금흐름은 `tIn − tOut`(통장에 남은 돈)이고, 저축률은 `FIN_SAVING_CATS`('저축/투자') 지출을 소비에서 **되돌린** 뒤의 비율이다. 그 카테고리는 자산 이동이라 순자산을 줄이지 않고, `finMonthlyFixedCost` 와 `finNetWorthBridge` 가 같은 이유로 제외한다 — 셋이 어긋나면 같은 화면이 서로 다른 '지출'을 말하게 된다. 수입이 0인 달은 저축률을 내지 않는다(`—`). 미분류 자동이체 안내는 `finMonthlyFixedCost` 의 `pendingCount`/`pendingMonthly` 를 그대로 쓴다.
- **Net worth bridge** (`finNetWorthBridge`): 이전 순자산 + 순현금흐름 + 설명되지 않는 차이. The cashflow term excludes `FIN_SAVING_CATS` for the same reason as above. The residual is deliberately *not* labelled "가격 변동" — unrecorded transfers and manual asset edits land there too.
- **고정비 관리(`renderFixedCostView`)의 내역 표와 분포 시각화는 `.cf-fixed-bottom-row`에 나란히 둔다.** 표 혼자 쓰던 행을 표(`.cf-fixed-table-panel`)와 분포(`.cf-fixed-dist-panel`, `#cf-fixed-dist`)가 나눠 쓰면서 표가 컴팩트해지고 그 옆 여백에 카테고리별 분포가 들어간다. `_fixedCostDistribution(included,y,m)`은 표와 같은 `included` 목록·같은 `_autoTransferMonthlyEquivalent` 가중치로 카테고리를 접을 뿐 새 계산을 하지 않는다. 색은 월별 현금흐름과 같은 `cfColors`를 쓰고(카테고리별 색이 화면마다 갈리지 않는다), 차트 라이브러리를 새로 붙이지 않고 `.sim-stack`(100% 누적 막대) 패턴을 재사용한다.

## Conventions

- **배당 API는 종목 단위 `verifiedTickers`를 반환한다.** HTTP 200이나 청크 요청 성공만으로 종목을 확인 완료로 기록하지 않는다. `fetchDividendHistory`도 25개씩 나누며, 실패한 종목의 이전 이력은 보존한다. 빈 배당 이력은 서버가 성공을 확인했을 때만 무배당 근거로 쓴다. 확인되지 않은 ETF 구성종목으로 중복 노출 0%를 표시하지 않는다.
- **정렬은 표시 문자열이 아니라 행의 `data-sort-*` 원시 숫자를 사용한다.** 통화 기호·금액 가리기·음수 부호에 영향을 받지 않아야 하며, 취득가 미상은 어느 방향에서도 마지막이다.
- **레이아웃 미리보기는 인증 예외가 아니라 세션 재검증이다.** 동일 출처 부모의 실제 `#layout-preview-frame`에서만 GET `/api/auth` 확인 후 시작한다. 새 최상위 페이지는 기존 DELETE 후 재로그인 규칙을 유지한다.
- **3D는 선택적 시각 효과다.** SVG·키보드 범례를 유지하고, 모바일·WebGL 실패 시 SVG를 표시한다. 정지 상태·화면 밖·숨긴 탭에서는 프레임 루프를 멈추며, 페이지 전환 시 geometry/material/renderer를 해제한다. 재렌더 시 같은 차트 호스트를 재사용한다.

- UI strings, comments, and labels are in Korean. Keep that style when adding new UI.
- The frontend uses the Cobalt 3-theme system — `light` (default) / `dark` / `navy` — via `document.body.dataset.theme` (`light` = attribute removed). Switch with `setTheme(mode)` in `script.js`; `isDarkTheme()` is true for both `dark` and `navy`. CSS variables (`--t1`, `--t3`, `--inner-bg`, `--acc`, `--acc-soft`, `--tipbg`, etc.) in `style.css` are the source of truth — never hard-code colors that need to flip with the theme. Chart JS constants (`ownerColors`, `CHART_PALETTE`, `cfColors`) use the Cobalt palette (`#5b9bff`, `#4ecdc4`, `#f2a33c`, `#c084fc`, `#4ade80`, …).
- When adding a new owner-aware widget, sync from `currentOwner` in `changeOwner()` and re-render in `switchView()` for the relevant `viewId`. Cobalt pages instead keep their own owner state and render owner buttons via `cbSetHead(sub, cbOwnerBtns(state, 'handlerName'))`. **Every calculation a page shows must respect that filter** — pass the owner through rather than computing household totals under an owner tab; if a number genuinely can't be filtered (e.g. the net worth bridge, which only has household snapshots), label it "가구 전체" on the card.
- **Sidebar menu** is a flat list of the seven `.menu-btn` destinations in `index.html` — the four collapsible `.menu-group` sections were retired along with their state, CSS and `localStorage.menuGroupState`. 데이터 상태 is reached from the sidebar footer status button (`.footer-status-btn`), not a menu row.
- **Mobile (≤768px) is read-only on the finance pages** — the 768px media query hides `#fin-bs-form`, `#fin-goal-form`, `.fin-form-actions`, `.fin-row-actions`. Any new form there must render a `finMobileNote(...)` callout so the missing controls are explained rather than just absent.
- **사람이 읽는 판본은 `docs/invariants.md`** — 같은 규칙을 증상 중심으로 풀어 쓴 문서이고, `npm test` 로는 검증되지 않는 영역(워크플로·모바일 레이아웃·CDN 실패·터치)을 따로 정리해 두었다. 새 불변조건이 생기면 **이 파일과 그 문서를 같은 커밋에서 함께** 고친다.
- **List row actions key off item `id`, not array index** — the balance-sheet and goal lists are owner-filtered, so an index from the rendered list points at the wrong row. Use `finBalanceFind` / `finGoalFind`, and edit in place with `splice(i, 1, row)` so the row doesn't jump to the bottom. `finEnsureState()` backfills `id` on legacy rows.

### Historical simulation and compact controls (2026-09-11)

- Header section links precede owner/period controls. Home has no bottom shortcuts; sector expansions use overseas tickers and Korean/Japanese names. DCA registration/editing opens the holding editor; the schedule page retains review and pause controls.
- Backtesting is read-only and uses authenticated search/OHLCV APIs. Require positive adjusted prices for every completed daily bar; do not silently substitute raw prices. Initial purchase uses the first available close, monthly contributions start the next month, and purchase fees reduce units. Display native currency and actual coverage. CAGR and drawdown describe adjusted-price performance, while portfolio gain divides profit by contributions. Never mix these measures or imply FX/tax coverage. Abort and ignore superseded requests.
- Rebalance reference allocations are sourced comparison examples, not presets: market-based asset groups cannot automatically represent stock/bond allocations. Goal monthly funding estimates assume zero return and remain separate for overlapping goals.
- **리밸런싱의 자산군 입력(`.fin-target-inputs`)은 4개씩 2줄로 고정한다** — `FIN_DEFAULT_TARGET`의 6개 자산군(가상화폐·미국·한국·일본·금·현금) + 허용 편차 + 목표 저장 버튼으로 정확히 8칸이다(`repeat(4,minmax(0,1fr))`, workspace-ui.css). `.fin-rebal-table`의 숫자 칼럼(현재·목표·편차·필요 조정액·월 DCA 보정안)은 우측 정렬한다(`>div>span:not(:first-child){text-align:right}`) — 첫 칸(자산군 라벨)만 아이콘+텍스트라 좌측 정렬로 둔다.

### Header, summary and dividend follow-ups (2026-09-14)
- Keep title and descriptive text in one heading line; group section and owner/period controls together. Cash-flow tabs use this group. ETF explorer has no redundant hero labels.
- Home restores the selected-holding summary beside its searchable list. Selection must remain within visible owner/search results; portfolio weight uses the unsearched owner scope. Family header filters drive holdings and allocation widgets. Only the public sidebar GOLD quote is exempt from amount privacy; portfolio gold remains masked.
- The 90-day dividend list is an estimate from historical recurring patterns and current holdings, not a confirmed future-payment calendar. Never label recurring payDay as exact. Unknown dates use intersecting calendar months (including partial boundary months), never an invented 15th. Explain boundary uncertainty and estimated pre-tax amounts.

### ETF diagnostics and compact risk layout (2026-09-14)
- Domestic live ETF lookup tries FunETF first; within the time budget it can use known TIME products, then a single Zeroin request. Keep source attempts visible and preserve last-good observations. Targeted retries are restricted to held ETFs and superseded requests cannot remain stuck loading. Scheduled Zeroin retries keep their existing default.
- ETF inspection rows explain completeness/date/freshness instead of changing warnings to success. Risk score width follows its grid track and both overview columns stretch together; priority notes derive from the selected owner’s existing rule results.
- Data status lists stale-price holdings and explains retry, ticker/currency checks and broker comparison; never interpret request success as real-time exchange data.
