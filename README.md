# Cobalt — Family Portfolio

[Claude Design](https://claude.ai/design)에서 제작한 **"Cobalt Portfolio v2" 시안의 레이아웃과 테마를
그대로 구현**하고, 기존 `asset_dashboard_claude-code` 앱의 실데이터(KV 자산, 시세·배당 API, 인증)를
연결한 버전입니다.

## 페이지 구성

**Cobalt 시안 8페이지** (`cobalt.js`가 시안 마크업 그대로 렌더링):

1. **대시보드** — 가족 순자산 헤더 + 평가손익/연배당/리스크 배지, 메인에 크게 배치된 자산 배분 도넛·섹터 집중도 바(클릭/재클릭으로 소속 종목 펼침·접힘, 가상화폐는 Crypto로 별도 분류), 하단 보유 자산 내역 표(시장 국기 아이콘·종목명 볼드·티커 동일열·소유주·주수·평단가·현재가·평가금액·수익률 칼럼, 동일 소유주 다계좌 동일종목 취합, 행 클릭 시 우측 상세 패널 토글)
2. **성과 비교** — 소유주별 포트폴리오 vs S&P 500 · KOSPI (벤치마크 실선·소유주 점선, nice-step Y축, 기간 버튼 1/3/6개월·연초 이후·1년으로 실렌더링, 초과수익 표 하단에 세로로 키운 차트 위젯 배치)
3. **가족 자산** — 구성원 카드(비중 바) 클릭 필터 + 보유 자산 표
4. **리스크 진단** — 소유주 버튼(전체/소유주별 리스크 필터) + 점수 링 + 7개 규칙 카드(집중도·가상화폐·섹터·변동성·현금·환노출·분산) + 종목 집중도 ETF 룩스루 차트(보유 ETF의 구성종목 비중을 풀어 직접 보유분과 합산한 실질 종목 비중, 간접 보유는 hover 팝오버로 출처 ETF 상세 표기 — `/api/dashboard?type=etf_holdings`, KR ETF는 pykrx PDF+최근 영업일 재시도·실패 시 yfinance(.KS/.KQ) 폴백, 해외 ETF는 yfinance)
5. **배당 관리** — 연간/월평균/YoC/배당성장률 카드, 월별 배당 캘린더, 종목별 배당 표
6. **증여 플랜** — 유기정기금(연 3% 할인율) 4구간 시뮬레이션 차트 + 표
7. **양도소득세** — 월별 실현손익 기록/차트, 해외 250만원 공제 → 22% 세액 자동 계산
8. **DCA 자동매수** — 규칙 등록/토글/삭제, 월 환산 합계

**기존 기능 뷰** (같은 사이드바에 유지): 자산 내역(CRUD) · 현금 흐름(가계부) · 배당 심화(YoC/CAGR/DRIP) · 추세 분석 · 비중 차트

## Cobalt 디자인 시스템

- **3테마**: 라이트 / 다크 / **네이비(기본)** — 사이드바 세그먼트로 전환, 선택 저장
- **표시 통화**: USD / KRW / JPY 전환 (시안 8페이지에 적용, 기존 뷰는 KRW)
- **타이포그래피**: Manrope(디스플레이) · IBM Plex Mono(숫자) · Noto Sans KR(본문)
- **우하단 시세 위젯**: JPY100/KRW · 금 1g(KRW), 전일 종가 기준
- **용어 툴팁**: YoC·과세표준·유기정기금 등 점선 밑줄 용어에 마우스오버 설명

## 실행

Vercel 호스팅 SPA입니다 — 빌드 단계 없음.

```bash
npm install                      # 서버리스 함수(Node) 의존성
pip install -r requirements.txt  # api/dashboard.py 의존성 (yfinance, pykrx, pandas)
vercel dev                       # http://localhost:3000
```

## Vercel 환경변수

| 변수 | 용도 |
|---|---|
| `KV_REST_API_URL` | Upstash Redis(KV) REST URL — 자산/가계부 등 영구 저장 |
| `KV_REST_API_TOKEN` | Upstash REST 토큰 |
| `DASHBOARD_PASSWORD` | 로그인 비밀번호 |
| `AUTH_TOKEN` | 로그인 성공 시 발급되는 API Bearer 토큰 값 |
| `GNEWS_API_KEY` | (선택) 뉴스 헤드라인 |

기존 배포와 같은 Upstash 인스턴스를 연결하면 기존 자산 데이터가 그대로 표시됩니다.

## 구조

- `index.html` — 모든 뷰가 `<div id="view-*">`로 선언된 단일 페이지
- `cobalt.js` — Cobalt 시안 8페이지 렌더러. `switchView`/`changeOwner`를 감싸 라우팅·재렌더를 통합하고, `script.js`의 데이터(자산·환율·배당 캐시·실현손익)를 그대로 사용
- `script.js` — 데이터 엔진 + 기존 기능 뷰 (~9,100줄, 모듈 시스템 없음)
- `style.css` — Cobalt 디자인 토큰(`:root`=라이트, `[data-theme="dark"]`, `[data-theme="navy"]`) + 시안 토큰 별칭(`--tx`, `--panel`, `--accSoft` 등)
- `api/` — Vercel 서버리스 함수 (가격/배당/환율/검색/KV 프록시/인증)

자세한 개발 규칙은 `CLAUDE.md`를 참고하세요.
