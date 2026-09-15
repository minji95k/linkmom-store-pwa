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

## 2. Apps Script 프로젝트 생성 (신규 설치) / 코드 업데이트 (이미 설치되어 있는 경우)

1. DEV Google Spreadsheet 열기
2. 확장 프로그램 → Apps Script
3. 편집기의 **기존 코드 전체를 지우고**, 이 저장소의 [`apps-script/Sync.gs`](./Sync.gs) 최신 내용을
   **처음부터 끝까지 통째로** 붙여넣는다(일부만 고쳐 붙이지 않는다 — `handleEditTrigger` /
   `flushPendingSync` / `installOnEditTrigger` 등 새 함수가 추가됐고 내부 함수 몇 개의
   인자도 바뀌었다). Ctrl+S(💾)로 저장한다.
4. 이미 예전 버전이 설치돼 있었다면 아래 "4. 트리거 등록" 단계를 다시 실행해 트리거를 최신
   함수로 갈아끼운다(`installOnEditTrigger`/`installTriggers` 둘 다 기존 동명 트리거를 지우고
   새로 만들도록 되어 있어 여러 번 실행해도 중복 등록되지 않는다).

## 3. Script Properties 설정 (Secret을 코드에 넣지 않기 위함)

Apps Script 편집기에서 프로젝트 설정(톱니바퀴 아이콘) → **스크립트 속성** → 속성 추가:

| 속성 | 값 |
|---|---|
| `SYNC_API_BASE_URL` | 예: `https://your-app.vercel.app` (로컬 테스트 시 ngrok URL) |
| `SYNC_API_SECRET` | 1번에서 생성한 값 |

## 4. 트리거 등록 (2026-09-14 — onEdit 즉시 반영 + 10분 Full Snapshot Safety Net, 두 개 모두 등록)

이제 트리거가 두 종류다. **둘 다 등록해야** Sheet 수정이 수 초 내로 반영되면서도, 놓친 변경이
있으면 10분마다 자동으로 다시 잡힌다.

1. 드롭다운에서 **`installOnEditTrigger`** 선택 → ▶ 실행.
   - 최초 실행 시 Google이 권한 승인을 요청한다(스프레드시트/외부 URL 호출 권한) — 승인한다.
   - 이제부터 `[상시 프로모션]`/`[행사 프로모션]` 시트를 수정하면 약 3초 후 수정된 Row만
     `sync_mode: "partial"`로 Supabase에 반영된다(`handleEditTrigger` → `flushPendingSync`).
   - 다른 Sheet를 수정해도 아무 API 호출이 발생하지 않는다.
2. 드롭다운에서 **`installTriggers`** 선택 → ▶ 실행.
   - 이후 `syncAll()`이 10분마다 자동 실행되며 두 시트 전체를 `sync_mode: "full_snapshot"`으로
     다시 Sync한다 — onEdit 트리거가 어떤 이유로든 놓친 변경을 되찾아오는 Safety Net이다.
3. 좌측 메뉴 "트리거"(⏰ 아이콘)에서 두 트리거가 모두 등록됐는지 확인한다:
   - `handleEditTrigger` — 이벤트 소스: 스프레드시트에서, 이벤트 유형: 수정 시
   - `syncAll` — 시간 기반, 분 단위 타이머 (10분마다)

즉시 수동 테스트하려면 드롭다운에서 `syncPermanentOnly` 또는 `syncEventOnly`를 선택해 실행한다
(이 둘은 언제 실행해도 항상 Full Snapshot이다).

### product_id write-back Loop 방지 확인 (반드시 직접 확인)

`installOnEditTrigger` 등록 후, 신규 상품 Row를 추가해(product_id 칸은 비워둠) 서버가
product_id를 채번해 셀에 되쓰는 상황을 한 번 만들어보고, Apps Script 편집기 좌측
"실행" 로그에서 `handleEditTrigger`가 그 되쓰기로 인해 **다시 실행되지 않는지** 확인한다.
Apps Script는 스크립트가 직접 쓴 셀 값 변경으로는 onEdit을 발생시키지 않는 것이 공식
동작이라 Loop가 나지 않아야 하지만, 실제로 한 번은 로그로 직접 확인하고 넘어간다.

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

## 9. 자동 Sync + 행사 노출 E2E 검증 체크리스트

트리거 등록 후, 실제 DEV Sheet에서 아래를 순서대로 직접 수정해보고 각 항목을 확인한다.
매번 Apps Script "실행" 로그에서 `[상시 프로모션]`/`[행사 프로모션]` 완료 로그가 몇 초 내로
찍히는지 먼저 확인하고, 필요하면 Supabase 쪽 결과 확인을 요청한다.

1. **상시 상품 가격 1개 수정** → 실행 로그에 약 3초 후 `partial` 완료 로그, `updatedCount:1`
2. **사은품 수정** → 완료 후 해당 상품의 `promotion_change_logs`에 `importance:"important"` 기록(요청 시 확인)
3. **비고 등 minor 문구만 수정** → Sync는 되지만(`updatedCount:1`) `last_important_change_at`은 갱신되지 않음(요청 시 확인)
4. **신규 상품 Row 추가(product_id 칸 비움)** → 완료 로그에 `insertedCount:1` + `productIdAssignments` 1건, 잠시 후 해당 Row의 `product_id` 칸에 자동으로 값이 채워짐. 이때 실행 로그에 `handleEditTrigger`가 **추가로 실행되지 않는지** 확인(Loop 방지 확인)
5. **행사상품 Row 수정** → `[행사 프로모션]` 완료 로그, `sync_mode:"partial"`
6. **관련 없는 다른 Sheet(있다면) 수정** → 실행 로그에 아무 것도 찍히지 않음(API 호출 자체가 없음)
7. **10분 이상 기다리기(또는 드롭다운에서 `syncAll` 수동 실행)** → `full_snapshot` 완료 로그가 두 시트 모두에 대해 찍힘

행사 노출(§sync-design.md §7) 최종 확인 — `[행사 프로모션]`에서 직접 수정하며 각각 확인:

8. **노출여부=ON + 행사 시작일≤오늘≤행사 종료일** → 노출(요청 시 `event_campaigns_visible` 조회로 확인)
9. **노출여부=OFF** → 비노출, 데이터는 보존(삭제 아님)
10. **노출여부=ON + 행사 종료일<오늘(과거)** → 자동 비노출(담당자가 OFF를 깜빡해도 안전)
11. **행사 종료일을 미래로 다시 연장** → 자동 재노출

## 10. 문제 해결

- **401 Unauthorized**: `SYNC_API_SECRET`이 서버 `.env.local`과 Script Properties 양쪽에서 정확히 일치하는지 확인
- **product_id가 안 채워짐**: 헤더 텍스트가 정확히 `product_id`인지(대소문자, 공백) 확인
- **행사 캠페인이 생성 안 됨**: `행사명` 컬럼이 비어있지 않은지 확인 — 비어있으면 그 상품은 어떤 캠페인에도 연결되지 않는다(promotions 행 자체는 정상 생성됨)
- **409 응답 / "대량 비활성화 안전장치 발동" 로그**: `syncAll`/`syncPermanentOnly`/`syncEventOnly`(Full Snapshot 경로)에서만 발생할 수 있다. Sheet에서 실수로 대량의 Row를 지웠거나 필터/숨김으로 `getDataRange()`가 일부만 읽은 것이 아닌지 확인한다 — 정상적인 소규모 단종 처리라면 임계치(기본 누락 비율 50%/절대값 50건)를 조정할 수 있다(`SYNC_DEACTIVATION_MAX_RATIO`/`SYNC_DEACTIVATION_MAX_ABSOLUTE` 서버 환경변수).
- **onEdit 트리거가 반응하지 않음**: 좌측 "트리거" 메뉴에서 `handleEditTrigger`가 실제로 등록돼 있는지, 이벤트 유형이 "수정 시"인지 확인. 등록돼 있는데도 반응이 없다면 `installOnEditTrigger`를 다시 실행(기존 트리거를 지우고 재생성).
