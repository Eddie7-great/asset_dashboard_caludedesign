# DESIGN.md — 가족 자산 관리 디자인 가이드

이 문서는 기존 코드베이스(`index.html`, `style.css`, `cobalt.js`, `finance.js`, `script.js`)를
역분석해서 정리한 것입니다. 새 화면을 추가하거나 스타일을 수정할 때는 **여기 적힌 값이 아니라
`style.css`의 CSS 변수(`:root` / `[data-theme]`)를 실제 소스로** 취급하세요 — 이 문서가 최신
CSS와 어긋나면 CSS가 맞습니다.

## 목차

1. [전체 레이아웃 구조](#1-전체-레이아웃-구조)
2. [컬러 팔레트](#2-컬러-팔레트)
3. [타이포그래피](#3-타이포그래피)
4. [여백과 간격 규칙](#4-여백과-간격-규칙-spacing-scale)
5. [주요 컴포넌트 스타일](#5-주요-컴포넌트-스타일)
6. [다크모드 지원](#6-다크모드-지원)

---

## 1. 전체 레이아웃 구조

앱은 프레임워크·번들러 없는 순수 SPA로, `index.html`이 모든 "뷰"를 미리 DOM에 올려두고
`switchView(viewId)`가 `.view-section` 중 하나에만 `.active`를 토글하는 방식입니다
(페이지 전환 시 리로드 없음).

### 1.1 데스크톱 골격 (2단 그리드)

```
┌───────────────────────────────────────────────────────────┐
│ body (그라디언트 배경 bg1→bg2, 100vh/100dvh, overflow:hidden) │
│ ┌───────────┐ ┌───────────────────────────────────────────┐│
│ │  .layout  │ │                                           ││
│ │ (grid:    │ │           .content-area (main)             ││
│ │  210px 1fr│ │ ┌─────────────────────────────────────────┐││
│ │  gap:15px │ │ │ #page-head (f-between, 헤더바)          │││
│ │  pad:15px)│ │ │  ☰(모바일) 제목 · 소제목 · 위젯 · 소유주탭│││
│ │           │ │ └─────────────────────────────────────────┘││
│ │ aside     │ │ ┌─────────────────────────────────────────┐││
│ │ .menu-col │ │ │ .view-section.active > .cb-scroll        │││
│ │ ┌───────┐ │ │ │   (스크롤 가능한 본문, 카드/패널들)       │││
│ │ │환율/금 │ │ │ │                                         │││
│ │ │위젯    │ │ │ │                                         │││
│ │ └───────┘ │ │ │                                         │││
│ │ nav 메뉴  │ │ │                                         │││
│ │ (4그룹)   │ │ │                                         │││
│ │ ┌───────┐ │ │ └─────────────────────────────────────────┘││
│ │ │sidebar-│ │ │                                           ││
│ │ │footer  │ │ │                                           ││
│ │ └───────┘ │ │                                           ││
│ └───────────┘ └───────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────┘
```

- 루트 컨테이너 `.layout`은 `display:grid; grid-template-columns:210px 1fr; gap:15px; padding:15px; height:100vh/100dvh` — **사이드바 210px 고정 + 본문 나머지**의 2컬럼 그리드입니다(`style.css:246`).
  - 1100px 이하: 사이드바 180px, gap/padding 10px로 축소 (`style.css:572`).
  - 900px 이하: 사이드바 160px, gap/padding 8px로 축소 (`style.css:575`).
  - 768px 이하(모바일): 그리드를 해제하고 사이드바가 **오프캔버스 드로어**(`.menu-col.open`이 `translateX(-105%)` → `0`)로 전환됩니다 (`style.css:1332`).
- **헤더(header)**: 별도 `<header>` 태그는 없고, 본문 상단의 `#page-head`(class `f-between`)가 그 역할을 합니다. `padding:15px 24px; border-bottom:1px solid var(--border-dark)`이며 좌측부터 제목(`#main-title`) → 소제목(`#main-title-sub`, `cbSetHead()`가 채움) → 페이지별 위젯(`#cb-head-widgets`) → 소유주 탭(`.owner-tabs` 등, `margin-left:auto`로 우측 정렬)이 한 줄에 배치됩니다 (`index.html:110`). 모바일에서는 `☰ | 제목(중앙) | 여백` 3열 그리드 + sticky, 소유주 탭은 둘째 줄로 내려갑니다 (`style.css:1352`).
- **사이드바(aside, `.menu-col`)**: `glass-panel` 스타일(카드형, radius 12px) 위에 세 구역이 세로로 쌓입니다.
  1. 환율/금 위젯(`.side-rates`) — USD/KRW, USD/JPY, JPY100/KRW, GOLD.
  2. 메뉴 내비게이션(`nav#sidebar-menu`) — **요약 / 분석 / 계획 / 기록·관리** 4개의 접이식 `.menu-group` 섹션. 상태는 `localStorage.menuGroupState`에 저장됩니다.
  3. `.sidebar-footer` — 테마 선택 세그먼트, 새로고침·모바일버전·금액가리기 버튼, 마지막 줄에 데이터 상태 진입점(`.footer-status-btn`).
- **본문(main, `.content-area`)**: `f-col`(세로 flex) + `overflow-y:auto`. 헤더(`#page-head`) 아래로 현재 활성화된 `.view-section`의 `.cb-scroll`(`overflow-y:auto; overflow-x:hidden; padding:0 6px 60px 0`)이 실제 스크롤 컨테이너입니다. 본문 안 카드들은 대부분 `.cb-panel`/`.glass-panel`(둥근 모서리 12px 카드) 단위로 그리드/flex 배치됩니다.
- **푸터(footer)**: 페이지 하단에 걸치는 전역 푸터는 없습니다. 사이드바 하단의 `.sidebar-footer`가 그 역할을 겸하며(테마·새로고침·데이터 상태), 각주성 텍스트(세율 근거, ETF 룩스루 실패 안내 등)는 해당 카드 내부에 `.tax-rule-disclosure`/`.fin-disclaimer` 형태로 인라인됩니다.
- **모달**: `.modal-content`는 화면 중앙 오버레이(고정폭 450px, 모바일 `max-width:92vw`), `.login-card`는 앱 진입 시 전체 화면을 덮는 별도 오버레이(`#login-overlay`)입니다.

### 1.2 화면(뷰) 구성 단위

`index.html`은 모든 뷰를 `<div id="view-*" class="view-section">` 형제로 정의하고, Cobalt(신규) 페이지는 그 안에 빈 `<div class="cb-scroll" id="cb-*"></div>`만 두고 `cobalt.js`/`finance.js`가 런타임에 innerHTML을 채웁니다(`CB_VIEWS` 매핑). 새 Cobalt 페이지 추가 시 규칙:
- `<div id="view-X"><div class="cb-scroll" id="cb-X"></div></div>` 블록
- 사이드바 4그룹 중 하나에 `<button id="menu-X">`
- `cobalt.js`의 `CB_VIEWS` + `CB_TITLES`에 등록

`script.js`가 직접 렌더하는 화면(자산 내역·현금 흐름·비중 차트)은 `<div id="view-X">` 안에 마크업이 이미 들어있는 구조로, `CB_LEGACY_SUB`에 헤더 소제목만 등록합니다. 메뉴에서 도달할 수 없던 레거시 뷰 7개(`dashboard`·`portfolio`·`dividend`·`gift`·`family`·`analysis`·`target_rebal`)는 제거됐고, 현재 DOM에 있는 14개 뷰는 모두 사이드바나 푸터에서 열립니다.

---

## 2. 컬러 팔레트

색상은 **전부 CSS 커스텀 프로퍼티(변수)**로 관리되며, 라이트/다크/네이비 3테마가 같은 변수 이름을 다른 값으로 재정의합니다(`style.css:1-15`, `164-192`). 하드코딩 금지 — 테마 전환 시 자동으로 바뀌어야 하는 모든 색은 반드시 `var(--token)`을 씁니다.

### 2.1 라이트 테마 기준 값 (기본 테마)

| 역할 | 변수 | HEX / 값 |
|---|---|---|
| **Primary(강조)** | `--acc` | `#2a6fdb` |
| Primary 연한 배경(10%) | `--acc-soft` | `rgba(42,111,219,.10)` |
| Primary 연한 배경(20%) | `--acc-soft2` | `rgba(42,111,219,.20)` |
| **Secondary(보조 강조 1 – 티일)** | `--acc2` | `#0f9488` |
| **Secondary(보조 강조 2 – 퍼플)** | `--acc3` | `#7c3aed` |
| **Background** 그라디언트 시작 | `--bg1` | `#f4f6fa` |
| Background 그라디언트 끝 | `--bg2` | `#e9edf5` |
| Background 3단(보조) | `--bg3` | `#dfe5f0` |
| 카드/패널 배경(glass) | `--glass` | `#ffffff` |
| 카드 호버 배경 | `--glass-hover` | `#f7f9fc` |
| 내부(인풋 등) 배경 | `--inner-bg` | `#f2f5fa` |
| 헤더 배경 | `--header-bg` | `#ffffff` |
| 모달 배경 | `--modal-bg` | `#ffffff` |
| 패널 테두리 | `--panel-border` / `--border-light` | `#e2e7f0` |
| 진한 테두리(입력폼 등) | `--border-dark` | `#c9d3e6` |
| **Text 1차(제목/본문 강조)** | `--t1` | `#18213a` |
| **Text 2차(본문)** | `--t2` | `#4a5878` |
| **Text 3차(라벨/캡션/보조)** | `--t3` | `#6a7898` |
| 상승/양수 | `--up` | `#178a52` |
| 하락/음수 | `--dn` | `#cf3d5c` |
| 경고 | `--warn` | `#d97706` |
| 금(자산군) | `--gold` | `#b8860b` |
| 보라(자산군/포인트) | `--purple` | `#7c3aed` |
| 차트 격자선 | `--grid` | `#e6eaf2` |
| 카드 그림자 | `--gshadow` | `0 8px 24px -14px rgba(30,50,90,.20)` |
| 호버 배경(투명 accent) | `--hover-bg` | `rgba(42,111,219,.06)` |
| 툴팁 배경/글자/테두리 | `--tipbg` / `--tiptx` / `--tipbd` | `#18213a` / `#f8fafc` / `#31405e` |

> `:root, body` 블록(`style.css:196`)이 시안(Claude Design `.dc.html`) 쪽 네이밍을 그대로 쓸 수 있도록 별칭을 제공합니다: `--tx→--t1`, `--mut→--t2`, `--lab/--dim→--t3`, `--bd→--border-light`, `--bd2→--border-dark`, `--inner→--inner-bg`, `--panel→--glass`, `--panelSolid→--modal-bg`, `--accSoft→--acc-soft`, `--accSoft2→--acc-soft2`, `--hover→--hover-bg`, `--shadow→--gshadow`, `--upSoft`(상승 배경, 테마별로 별도 정의).

### 2.2 데이터 시각화 팔레트 (script.js)

차트·배지 전용 색상 세트로, CSS 변수와 별개로 JS 상수로 관리됩니다.

- **소유주 컬러** `ownerColors` (`script.js:233`): 전체 `#4ecdc4`(티일) · 본인 `#5b9bff`(블루) · 아내 `#f2a33c`(오렌지) · 자녀1 `#4ade80`(그린) · 아버지 `#c084fc`(퍼플)
- **범용 차트 팔레트** `CHART_PALETTE` (`script.js:236`): `#5b9bff #4ecdc4 #f2a33c #fb7185 #c084fc #4ade80 #e8875a #94a3c8 #d4b24a #56c596`
- **현금흐름 카테고리 컬러** `cfColors` (`script.js:1014`): 교통/차량 `#4ecdc4` · 교육 `#f472b6` · 급여 `#5b9bff` · 기타 `#94a3c8` · 문화/생활 `#c084fc` · 식비 `#f2a33c` · 의료/건강 `#fb7185` · 저축/투자 `#56c596` · 주거/통신 `#e8875a` · 배당금 `#4ade80` · 대출납입금 `#fb7185` · 관리비 `#e8875a` · 세금 `#e05572`
- **자산군 컬러** `catColors` (`script.js:3255`, `5202`): 한국주식 `#4ecdc4` · 해외주식 `#5b9bff` · 연금 `#c084fc` · 가상화폐 `#f2a33c` · 금 `#d4b24a` · 현금 `#94a3c8`

이 팔레트는 CSS 다크/네이비 변수와 색조를 공유하도록 골라져 있어(예: `--acc`가 다크에서 `#7aa2ff`, 네이비에서 `#5b9bff`로, 소유주 "본인"의 `#5b9bff`와 겹침) 테마를 바꿔도 차트 색이 어색하게 튀지 않습니다.

### 2.3 로그인 화면 예외

`.login-btn` 배경은 `#1f5fbf`로, 테마 변수가 아닌 고정값입니다(로그인 오버레이는 다크/네이비 전환과 무관하게 항상 동일한 톤 유지). `.login-title` 색만 `var(--acc)`를 씁니다.

---

## 3. 타이포그래피

### 3.1 폰트 패밀리

Google Fonts에서 3개 패밀리를 로드합니다(`index.html:9`):

```html
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Manrope:wght@500;600;700;800&family=Noto+Sans+KR:wght@400;500;700;900&display=swap" rel="stylesheet">
```

| 용도 | font-family | 사용처 |
|---|---|---|
| 기본 본문/UI | `'Noto Sans KR', 'Manrope', 'Pretendard', sans-serif` | `body` 전체 기본값 (`style.css:243`) — 한글 UI 텍스트, 버튼, 라벨 |
| 숫자·로고·영문 강조 | `'Manrope', sans-serif` | 로고 텍스트, KPI 큰 숫자(`.fin-kpi strong`, `.fin-data-hero strong` 등 `font:800 22~28px 'Manrope','Noto Sans KR',sans-serif`) |
| 고정폭(티커·날짜·금액 표) | `'IBM Plex Mono', monospace` | 환율 표시(`.side-rates-date`), 티커(`.advisor-result-tkr`), 표 안 금액(`.fin-rebal-table`), 배당 캘린더 날짜 |

전역적으로 `letter-spacing:-0.01em`이 `body`에 걸려 있어 한글 자간이 살짝 좁혀져 있습니다(`style.css:243`).

### 3.2 크기 체계

Tailwind류의 명시적 스케일 토큰은 없고, 각 컴포넌트마다 `rem` 또는 `px`로 개별 지정되어 있습니다. 실제 코드에서 반복되는 값들을 역할별로 정리하면:

| 역할 | 크기 | 예시 |
|---|---|---|
| 페이지 대제목 | `1.4rem` (≈22.4px), 모바일 `1.05rem` | `#main-title` |
| 로그인 타이틀 | `1.25rem` | `.login-title` |
| 섹션 라벨(대문자성 소제목) | `9.5–11px`, `letter-spacing:.08~.12em` | `.fin-section-head>span`, `.side-seg-label`, `.logo-sub` |
| KPI 큰 숫자 | `22–28px`, `font-weight:800` | `.fin-kpi strong`(22px), `.fin-data-hero strong`(28px), `.fin-safety strong`(27px) |
| 본문/카드 텍스트 | `11–13px` (`.72–.82rem`) | 카드 본문, 표 셀, 버튼 라벨 |
| 캡션/보조 텍스트 | `9–10.5px` | `small`류, 각주, 툴팁 메타 |
| 버튼 텍스트 | `.72–.78rem` (`.owner-btn`, `.cb-btn`, `.footer-btn`) | |
| 로고 배지 이니셜 | `14px` | `.logo-badge` |

주요 규칙:
- **본문 기준(1rem)은 브라우저 기본 16px** — 별도 `html{font-size:...}` 리셋 없음.
- rem/px 혼용이지만 대체로 **11–13px대가 "표준 본문"**, **9–10.5px대가 "캡션"**, **18–28px대가 "강조 숫자(KPI)"**로 3단 구분되는 패턴입니다.

### 3.3 굵기(font-weight)

| weight | 사용 맥락 |
|---|---|
| 400–500 | 일반 본문, placeholder |
| 600 | 보조 라벨, 인풋 값(`.fin-form-grid input`은 `500`) |
| 650–700 | 버튼, 카드 소제목, 표 헤더, 메뉴 항목(`.menu-btn.active{font-weight:700}`) |
| 800–900 | KPI 숫자, 로고, 페이지/모달 타이틀(`Noto Sans KR`은 900까지, `Manrope`는 800까지 로드) |

축약 `font:` 표기(`font:800 22px/1.25 'Manrope','Noto Sans KR',sans-serif` 형태)가 코드 전반에서 반복되는 관용구입니다 — weight, size/line-height, family 순서.

---

## 4. 여백과 간격 규칙 (Spacing scale)

디자인 토큰으로 명시된 spacing scale 변수는 없고, **4px 단위를 기본 격자로 하되 실제로는 4~24px 사이 값을 문맥에 맞춰 촘촘히 씁니다.** 반복 관찰되는 값과 용도:

| 간격 | 주 용도 |
|---|---|
| `2–4px` | 아이콘-텍스트 사이, 배지 내부, 리스트 항목 사이 초미세 간격 |
| `5–7px` | 버튼 내부 요소 gap, 세그먼트 컨트롤(`.owner-tabs` padding 3px), 폼 라벨-인풋 gap |
| `8–10px` | **가장 흔한 "기본 간격"** — 카드 내부 grid/flex gap(`.fin-summary-grid gap:10px`), 버튼 padding 좌우, 폼 그리드 gap |
| `12–14px` | 카드 사이 바깥 간격(`.fin-section{margin-top:12px}`), 사이드바 레이아웃 gap(`15px`), 섹션 head margin-bottom |
| `15–18px` | 헤더 좌우 padding(`#page-head{padding:15px 24px}`), 카드 내부 padding(`.fin-section{padding:17px 18px}`) |
| `20–24px` | 큰 히어로 카드 padding(`.fin-data-hero{padding:20px}`), 헤더 좌우 padding, 로그인 카드 상하 padding |
| `40px` | 로그인 카드 좌우 padding(`.login-card{padding:40px 36px}`) |

**모서리 반경(border-radius)**도 비슷하게 문맥별 스케일을 이룹니다: 작은 배지/버튼 `4–7px`, 인풋·일반 버튼 `8–10px`, 카드(`.glass-panel`, `.cb-panel`) `12px`, 모달 `16px`.

**레이아웃 격자 간격**: `.layout{gap:15px}` (데스크톱) → `10px`(≤1100px) → `8px`(≤900px) → 모바일은 그리드 해제, `.layout{padding:10px}`.

**반응형 그리드 컬럼 축소 규칙**: 4컬럼 요약 그리드(`.fin-summary-grid`, `.cb-fin-income-grid`, `.fin-data-grid` 등)는 1100px 이하에서 2컬럼, 768px 이하에서 1컬럼으로 순차 축소되는 패턴이 전 페이지에서 일관됩니다(`style.css:102-103`, `158-159`).

---

## 5. 주요 컴포넌트 스타일

### 5.1 카드/패널

- **`.glass-panel`** — 앱 전역 기본 카드. `background:var(--glass); border:1px solid var(--panel-border); border-radius:12px; box-shadow:var(--gshadow); padding:14px; display:flex; flex-direction:column`. 사이드바(`.menu-col`)와 로그인 카드도 이 클래스를 베이스로 씁니다.
- **`.cb-panel`** — Cobalt 페이지(신규 UI)의 카드. `background:var(--panel); border:1px solid var(--bd); border-radius:12px; box-shadow:var(--shadow)` — `.glass-panel`과 시각적으로 동일하되 변수 별칭(`--panel`/`--bd`/`--shadow`)을 통해 참조되며, 클릭 가능한 카드(예: 소유주 카드, 성과 카드)는 인라인으로 `cursor:pointer`, 선택 시 `box-shadow:0 0 0 1.5px <강조색>`를 추가해 "선택됨" 상태를 표현합니다.
- **KPI 카드**(`.fin-kpi`) — `padding:16px 17px`, 라벨(`small`, 10.5px, `--lab`) → 큰 숫자(`strong`, 800/22px `Manrope`) → 보조 텍스트 순 세로 배치. 순자산처럼 강조할 카드는 `box-shadow:inset 0 0 0 1px var(--acc)`로 안쪽 테두리를 추가.
- **히어로 카드**(`.fin-data-hero`) — 좌우로 라벨/숫자 블록과 액션 버튼을 배치하는 넓은 카드, `padding:20px`, 숫자 `28px`.

### 5.2 버튼

세 가지 톤이 반복됩니다.

| 클래스 | 스타일 | 용도 |
|---|---|---|
| `.cb-btn`, `.footer-btn` | `background:var(--acc-soft2); border:1px solid var(--border-dark); border-radius:8px; padding:8px 15px; font-weight:700; font-size:.76–.78rem` | 카드 안 보조 액션, 사이드바 푸터 버튼 |
| `.owner-btn` (세그먼트 안) | 기본 `background:transparent; color:var(--t3)`, hover `background:var(--hover-bg)`, `.active{background:var(--acc-soft2); color:var(--t1)}` | 소유주 전환, 테마 전환(`.side-seg-btn`도 동일 패턴) |
| `.fin-form-actions button.primary` | `background:var(--acc); border-color:var(--acc); color:#fff` | 폼 제출(저장/추가) — 유일하게 accent를 **꽉 채워** 쓰는 primary 버튼 |
| `.fin-row-actions button` 등 아웃라인형 | `border:1px solid var(--bd2); background:var(--inner); color:var(--mut)`, hover 시 `border-color/color`만 accent로 전환 | 표 안 행 단위 액션(수정/삭제) |
| `.login-btn` | `background:#1f5fbf`(고정값), `color:#fff`, hover `opacity:.88; translateY(-1px)` | 로그인 제출 — 앱 전체에서 유일하게 필로 채워진 대형 primary |

공통 상호작용: `transition:background .15s, color .15s` (또는 `all .15s`), hover는 배경/테두리색만 바뀌고 그림자·크기 변화는 없음(플랫 미니멀 — 코드 주석에도 "네온/홀로/파티클/스캔라인 효과 제거됨 (플랫 미니멀)"). 터치 기기에서는 `@media (pointer:coarse)`로 버튼/인풋 `min-height:44px`가 강제됩니다(`style.css:36`).

### 5.3 입력 폼

- **일반 텍스트/셀렉트** (`.form-input`, `.fin-form-grid input/select`): `padding:8–10px 9–12px; border:1px solid var(--border-dark)/var(--bd2); border-radius:8px; background:var(--inner-bg)/var(--inner); color:var(--t1)`. focus 시 `border-color:var(--acc)` (+`.form-input`은 `box-shadow:0 0 0 2px rgba(120,140,190,.32)`도 추가).
- 다크 테마 전용 보정: `.form-input`이 `rgba(255,255,255,.06)` 반투명 배경 + `rgba(255,255,255,.12)` 테두리로 대비를 살리고, `<select>` 옵션은 `#1e293b` 배경에 `#f8fafc` 글자로 강제 지정(브라우저 네이티브 드롭다운이 시스템 라이트 팔레트를 쓰는 문제 보정).
- **로그인 인풋**: `padding:12px 16px; border-radius:10px`로 다른 폼보다 여유 있는 크기.
- **폼 레이아웃**: `.fin-form-grid`는 `grid-template-columns:repeat(3,minmax(0,1fr))`(모바일 1열), 각 필드는 `label > (라벨 텍스트 + 인풋)` 세로 스택.
- **모바일 읽기 전용 규칙**: 768px 이하에서 재무 페이지의 폼(`#fin-bs-form`, `#fin-goal-form`)과 행 액션 버튼은 전부 숨기고, 대신 `.fin-mobile-note` 안내 카드를 노출합니다("모바일에서는 조회만 가능" 등).

### 5.4 표(테이블)

- 헤더는 `color:var(--dim)/var(--lab); font-size:9.5–10px; font-weight:700; letter-spacing:.04em`로 라벨보다 더 작고 흐리게.
- 데이터 행은 `border-bottom:1px solid var(--bd)`로 구분, 숫자 컬럼은 `IBM Plex Mono` + 우측 정렬.
- 좁은 화면에서 표는 페이지 자체를 가로로 흔들지 않고 **표 컨테이너만 `overflow-x:auto`**로 좌우 스와이프하는 패턴이 전역 규칙입니다(`style.css:1374`).

### 5.5 배지 / 상태 표시

- **점(dot) 인디케이터**: 6–8px 원, 상태에 따라 `--up`(정상/녹색) / `--dn`(경고/빨강) / `--lab`(미조회/회색) 3색만 사용 — 데이터 상태(`.footer-status-dot`, `.fin-data-card .fin-status-dot`), 액션 리스트(`.fin-action-dot`) 등에서 반복.
- **미조회 배지**(`.unavailable-badge`): `background:var(--inner-bg); border:1px solid var(--border-dark); font-family:'IBM Plex Mono'` — 데이터를 가져오지 못했을 때 `'미조회'` 텍스트를 감싸는 뱃지.
- **세그먼트 컨트롤**(테마 선택, 기간 선택 `.tf-btn`/`.hm-btn`/`.rsk-tf-btn`, 사이드바 데이터 상태): 얇은 `--inner-bg` 배경 트랙 + `.active` 항목만 accent로 채우는 동일한 패턴 반복.

### 5.6 모달 / 오버레이

- **`.modal-content`**: `background:var(--modal-bg); width:450px; border-radius:16px; padding:25px; box-shadow:0 10px 40px rgba(0,0,0,.4); border:1px solid var(--border-dark)`. 카드보다 한 단계 큰 radius(16px)와 훨씬 진한 그림자로 "떠 있는" 레이어를 표현.
- **로그인 오버레이**(`#login-overlay`): `position:fixed; inset:0; z-index:10000`, 배경은 `linear-gradient(135deg, var(--bg1), var(--bg2))` — 본문과 같은 배경 톤을 대각선 그라디언트로 반복.
- 툴팁(`.table-float-tip`)은 스크롤/오버플로우에 잘리지 않도록 `position:fixed` + 전역 body 포털 패턴을 씁니다 — 개별 요소의 `::after` 대신 JS가 하나의 공용 말풍선 DOM을 움직입니다.

---

## 6. 다크모드 지원

**지원함 — 3테마 시스템**(라이트/다크/네이비)이며, 라이트가 기본값입니다.

- 전환 스위치: `document.body.dataset.theme` — `light`는 속성을 아예 제거한 상태(= 기본 `:root` 값 사용), `dark`/`navy`는 `body[data-theme="dark"]` / `body[data-theme="navy"]`로 CSS 변수 블록 전체를 재정의합니다.
- JS 진입점: `setTheme(mode)`(`script.js`)가 `dataset.theme`를 바꾸고 사이드바 세그먼트(`.side-seg-btn.active`) 상태를 동기화, `localStorage`에 선택을 저장. `isDarkTheme()`은 `dark`/`navy` 둘 다에서 `true`.
- 전환 애니메이션: `body{transition:background .3s, color .3s}`, `.glass-panel{transition:background .3s, border .3s}` — 급격한 색 전환 없이 부드럽게 페이드.

### 6.1 테마별 색상 매핑

세 테마 모두 **동일한 변수 이름**을 쓰므로, 컴포넌트 CSS는 테마를 몰라도 됩니다. 핵심 토큰 비교:

| 변수 | 라이트 | 다크 | 네이비 |
|---|---|---|---|
| `--bg1` → `--bg2` (배경 그라디언트) | `#f4f6fa` → `#e9edf5` | `#0d0e12` → `#08090c` | `#0c1a3a` → `#080f24` |
| `--glass` (카드 배경) | `#ffffff` | `#15181e` | `#0e1c3f` |
| `--inner-bg` (인풋/내부 배경) | `#f2f5fa` | `#0e1014` | `#0a1836` |
| `--border-dark` | `#c9d3e6` | `#2c313c` | `#24396b` |
| `--acc` (Primary) | `#2a6fdb` | `#7aa2ff` | `#5b9bff` |
| `--acc2` | `#0f9488` | `#38bdf8` | `#4ecdc4` |
| `--acc3` | `#7c3aed` | `#a78bfa` | `#c084fc` |
| `--t1` (본문 강조 텍스트) | `#18213a` | `#e7e9ee` | `#e6edfb` |
| `--t2` | `#4a5878` | `#a5abb8` | `#9fb0cf` |
| `--t3` (라벨) | `#6a7898` | `#8a909b` | `#7d93bf` |
| `--up` | `#178a52` | `#34d399` | `#4ade80` |
| `--dn` | `#cf3d5c` | `#f87171` | `#fb7185` |
| `--warn` | `#d97706` | `#fbbf24` | `#fbbf24` |
| `--gold` | `#b8860b` | `#fbbf24` | `#d4b24a` |
| `--gshadow`(카드 그림자) | `0 8px 24px -14px rgba(30,50,90,.20)` | `none` | `none` |
| `--tipbg`/`--tiptx`(툴팁) | 어두운 배경+밝은 글자 | **밝은 배경+어두운 글자**(반전) | 밝은 배경+어두운 글자(반전) |

관찰할 점:
- 다크/네이비 테마는 카드 그림자를 아예 없앱니다(`--gshadow:none`) — 어두운 배경에서는 그림자보다 테두리(`--panel-border`)로 카드 경계를 구분.
- 툴팁 배경(`--tipbg`)은 라이트에서 어두운 네이비(`#18213a`)를 쓰고, 다크/네이비 테마에서는 반대로 밝은 배경(`#f4f7fb`/`#edf3ff`)을 씁니다 — 항상 "테마와 반전된" 고대비 팝업을 유지하기 위한 의도적 설계입니다.
- `--upSoft`(상승 값의 옅은 배경)는 라이트 `rgba(23,138,82,.10)`, 다크 `rgba(52,211,153,.12)`, 네이비 `rgba(77,222,128,.12)`로 테마별 accent 색조에 맞춰 별도 조정됩니다.
- 차트/데이터 팔레트(`ownerColors`, `CHART_PALETTE` 등, [2.2](#22-데이터-시각화-팔레트-scriptjs))는 테마와 무관하게 **고정된 HEX 값**을 그대로 씁니다 — 다크 배경에서도 채도가 죽지 않도록 처음부터 밝은 톤(파스텔~비비드)으로 선택되어 있어 별도 다크 변형이 필요 없습니다.
- 시스템 다크모드(`prefers-color-scheme`)에 대한 자동 반응은 없습니다 — 테마는 오직 사용자가 사이드바에서 명시적으로 선택하며 `localStorage`에 저장됩니다.

---

## 부록: 참고 파일 위치

| 항목 | 파일 |
|---|---|
| 디자인 토큰(CSS 변수) 정의 | `style.css:1-15`(라이트), `:164-192`(다크/네이비), `:196-205`(별칭) |
| 레이아웃 그리드 | `style.css:246`(`.layout`), `:296`(`.content-area`), `:1101-1103`(`.cb-scroll`/`.cb-panel`) |
| 모바일 반응형 전면 규칙 | `style.css:1332-`(768px 이하 전용 블록) |
| 폰트 로드 | `index.html:9` |
| 소유주/차트 팔레트 | `script.js:233`(`ownerColors`), `:236`(`CHART_PALETTE`), `:1014`(`cfColors`), `:3255`(`catColors`) |
| 사이드바/메뉴 마크업 | `index.html:34-107` |
| 헤더(`#page-head`) 마크업 | `index.html:109-144` |
| 테마 전환 로직 | `script.js`의 `setTheme()` / `isDarkTheme()` |
