# Google Sheet → Supabase Sync 설치 가이드 (DEV)

이 가이드는 **DEV Google Spreadsheet 복사본**에 Apps Script를 연결하는 방법이다.
운영 중인 실제 Google Sheet에는 절대 연결하지 않는다.

## 0. 준비물

- DEV Google Spreadsheet (`[상시 프로모션]`, `[행사 프로모션]` 두 시트 존재)
- `SYNC_API_SECRET` (아래 1번에서 생성)
- Next.js 앱이 배포된 URL, 또는 로컬 테스트라면 `ngrok` 등으로 외부에 노출한 `http://localhost:3000` 터널 URL
  (Google 서버가 `UrlFetchApp.fetch()`로 호출하므로 `localhost` 자체는 접근 불가하다)
  - ngrok 무료 플랜을 쓰면 `Sync.gs`가 요청에 `ngrok-skip-browser-warning` 헤더를 이미
    붙이고 있다 — 이게 없으면 ngrok이 JSON 대신 경고 인터스티셜 HTML을 돌려줘서 응답
    파싱이 깨진다. 실제 배포 URL(Vercel 등)을 쓰면 이 헤더는 그냥 무시되니 신경 쓰지 않아도 된다.

## 1. SYNC_API_SECRET 생성

터미널에서:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

이 값을 두 곳에만 넣는다. **코드에 하드코딩하지 않는다.**

1. Next.js 서버의 `.env.local` (`SYNC_API_SECRET=...`)
2. 아래 3번의 Google Apps Script "Script Properties"

## 2. Apps Script 프로젝트 생성

1. DEV Google Spreadsheet 열기
2. 확장 프로그램 → Apps Script
3. 기본 생성된 `Code.gs`의 내용을 지우고, 이 저장소의 [`apps-script/Sync.gs`](./Sync.gs) 내용을 그대로 붙여넣는다

## 3. Script Properties 설정 (Secret을 코드에 넣지 않기 위함)

Apps Script 편집기에서 프로젝트 설정(톱니바퀴 아이콘) → **스크립트 속성** → 속성 추가:

| 속성 | 값 |
|---|---|
| `SYNC_API_BASE_URL` | 예: `https://your-app.vercel.app` (로컬 테스트 시 ngrok URL) |
| `SYNC_API_SECRET` | 1번에서 생성한 값 |

## 4. 트리거 등록

Apps Script 편집기 상단 함수 선택 드롭다운에서 `installTriggers`를 선택하고 ▶ 실행.
최초 실행 시 Google이 권한 승인을 요청한다(외부 URL 호출 권한) — 승인한다.

이후 `syncAll()`이 10분마다 자동 실행되며 두 시트를 순서대로 Sync한다.
즉시 테스트하려면 드롭다운에서 `syncPermanentOnly` 또는 `syncEventOnly`를 선택해 수동 실행한다.

## 5. product_id 컬럼

두 시트 모두에 **빈 `product_id` 컬럼**을 하나 추가해 둔다(위치는 상관없음, 헤더 텍스트가
정확히 `product_id`여야 한다). 신규 상품 Row를 추가할 때 이 칸은 비워 두면 된다 — 다음
Sync 때 서버가 값을 채번해서 이 스크립트가 자동으로 셀에 다시 써준다.

## 6. 행사 프로모션 전용 컬럼

`[행사 프로모션]` 시트에는 아래 4개 컬럼을 추가한다 (sync-design.md §7 확정 사항):

| 컬럼명 | 예시 값 |
|---|---|
| `행사명` | `링크맘 가을 유모차 페어` |
| `행사 시작일` | `2026-09-20` (연도 포함) |
| `행사 종료일` | `2026-10-04` |
| `노출여부` | `ON` 또는 `OFF` |

같은 행사에 속한 여러 상품 Row는 `행사명` 값을 동일하게 입력하면 하나의 캠페인으로 묶인다.

## 7. 실행 로그 확인

Apps Script 편집기 좌측 "실행" 메뉴에서 각 실행의 `Logger.log()` 출력을 확인할 수 있다.
신규/수정/비활성/실패 건수와 오류 목록이 여기 남는다. (Admin 화면에서의 Sync 상태 조회는
Phase 12에서 구현 — 지금은 `sync_logs` 테이블과 이 실행 로그로 확인한다.)

## 8. 문제 해결

- **401 Unauthorized**: `SYNC_API_SECRET`이 서버 `.env.local`과 Script Properties 양쪽에서 정확히 일치하는지 확인
- **product_id가 안 채워짐**: 헤더 텍스트가 정확히 `product_id`인지(대소문자, 공백) 확인
- **행사 캠페인이 생성 안 됨**: `행사명` 컬럼이 비어있지 않은지 확인 — 비어있으면 그 상품은 어떤 캠페인에도 연결되지 않는다(promotions 행 자체는 정상 생성됨)
