# Cobalt — Family Portfolio

가족 자산 대시보드의 **Cobalt 디자인** 버전입니다. [Claude Design](https://claude.ai/design)에서 제작한
"Cobalt Portfolio v2" 시안을 기존 `asset_dashboard_claude-code` 앱 전체(11개 뷰 + 백엔드)에 입혔습니다.

## Cobalt 디자인에서 반영된 것

- **3테마**: 라이트 / 다크 / **네이비(기본)** — 사이드바 하단 세그먼트 컨트롤로 전환, 선택은 `localStorage`에 저장
- **Cobalt 팔레트**: 코발트 블루(`#5b9bff`) 액센트, 소유주·자산군·차트 색상 전면 교체
- **타이포그래피**: Manrope(디스플레이) · IBM Plex Mono(숫자) · Noto Sans KR(본문)
- **사이드바**: "C" 로고 배지, 메뉴 아이콘, 테마 세그먼트, `↻ 시세 갱신` 버튼
- **우하단 시세 위젯**: JPY100/KRW · 금 1g(KRW) 고정 카드 (전일 종가, 모바일에서는 숨김)
- **패널/툴팁/버튼**: 12px 라운드 패널, 테마 연동 툴팁(`--tipbg`), 소프트 액센트 활성 상태

기능(자산 CRUD, 벤치마크 비교, 가족 현황, 배당 분석, 증여 시뮬레이션, 양도세 기록, DCA 규칙,
추세 분석, 비중 차트 등)과 데이터 파이프라인은 원본 앱과 동일합니다.

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
- `script.js` — 전체 로직 (~9,100줄, 모듈 시스템 없음)
- `style.css` — Cobalt 디자인 토큰(`:root`=라이트, `[data-theme="dark"]`, `[data-theme="navy"]`) + 컴포넌트
- `api/` — Vercel 서버리스 함수 (가격/배당/환율/검색/KV 프록시/인증)

자세한 개발 규칙은 `CLAUDE.md`를 참고하세요.
