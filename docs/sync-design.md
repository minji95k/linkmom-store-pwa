# Sync Design (Phase 2)

> 실측 데이터([current-system-analysis.md](./current-system-analysis.md))를 기준으로 설계했다. 두 시트는 헤더 구조가 다르므로 별도 매핑 테이블을 각각 유지한다.

## 1. [상시 프로모션] vs [행사 프로모션] 역할

| | [상시 프로모션] | [행사 프로모션] |
|---|---|---|
| 목적 | 평상시 기본 상품 프로모션 | 한정기간 특별 행사상품 |
| 실측 규모 | 188행 / 18컬럼 | 16행 / 14컬럼 |
| `promotion_type` | `permanent` | `event` |
| 캠페인 개념 | 없음(개별 상품 단위) | `event_campaigns`로 그룹핑 |
| 노출 제어 | 없음(항상 노출, `is_active`만) | ON/OFF + 기간 자동 제어 |
| 사은품 컬럼명 | `증정사은품` | `행사 사은품` (실측상 컬럼명이 다름 — Sync 매핑에서 둘 다 `gift`로 통합) |
| 변경일 추적 | `수정일` 컬럼 존재 | 없음(실측 확인) → Sync 자체 diff로 변경 감지 |

두 시트를 하나의 목록으로 무조건 합치지 않는다(§9). `promotion_type`으로 항상 구분 가능하게 유지한다.

## 2. Source of Truth

Google Spreadsheet → Supabase **One-way Sync**. 직원 PWA는 원본을 수정하지 않는다. 양방향 동기화로 인한 충돌을 원천 차단.

## 3. Architecture

```
Spreadsheet onEdit / 5~10분 주기 Trigger
        ▼
Google Apps Script
    - 시트별로 헤더(1행) 읽기
    - 데이터 행 직렬화(JSON)
    - Bearer Secret Token 첨부
        ▼  HTTPS POST
Next.js API Route  /api/sync/permanent  ,  /api/sync/event
    - Token 검증(401 즉시 반환)
    - Header → Core Field 매핑 (trim 후 exact match)
    - 매핑 안 되는 Header → Dynamic Field 후보
    - Validation (아래 5장)
    - Upsert 실행 (Service Role Key, 서버 프로세스 내부에서만 사용)
    - Change 감지 → promotion_change_logs / last_important_change_at 갱신
    - Push 대상 큐 적재 (push-design.md)
    - sync_logs 기록
        ▼
Supabase PostgreSQL
```

Apps Script는 Service Role Key를 절대 보유하지 않는다(§16).

## 4. Product ID 전략 ✅ 확정(서버 자동 채번)

- 현재 자연키(`브랜드+제품명+컬러`)는 실측상 중복 0건이지만 §15 원칙에 따라 회사 소유의 불변 `product_id`를 별도로 둔다.
- **1단계(마이그레이션)**: `🔐 Softr Record ID`를 `legacy_softr_record_id`로 보존하고, 이를 시드로 `product_id`를 발급(예: `PROD-000001` 순번). 실측상 상시/행사 각각 Record ID가 유일하므로 안전하게 매핑 가능.
- **2단계(운영, 확정된 방식)**: Spreadsheet에 `product_id` 컬럼을 신설한다(§15). **담당자는 이 컬럼에 아무것도 입력하지 않는다.**
  - 담당자가 신규 상품 Row를 추가하고 `product_id`를 빈칸으로 저장 → 다음 Sync 때 서버가 이를 신규 상품으로 인식(빈 `product_id` + 값이 있는 브랜드/제품명 조합) → **서버가 순번 채번(`PROD-000189`식) → Apps Script API를 통해 해당 Row의 `product_id` 셀에 값을 다시 써준다.**
  - Write-back은 `product_id` 컬럼 1개에만 한정한다. 그 외 컬럼은 절대 역기록하지 않는다(One-way 원칙 유지, §12).
  - 실제 운영 시트를 바로 고치지 않고 개발/복제 시트에서 먼저 이 흐름(빈칸 저장 → 자동 채번 → 셀 반영)을 검증한다(§15, §92).

## 5. Multi-sheet Sync 규칙

- **Upsert 기준**: `product_id`(또는 마이그레이션 과도기엔 `legacy_softr_record_id`)로 매칭 → 있으면 UPDATE, 없으면 INSERT
- **삭제/비활성**: 이번 Sync 페이로드에 없는 기존 `product_id`는 즉시 삭제하지 않고 `is_active=false` (Soft Delete). 전체 삭제 후 재등록 방식 금지(§18). **단, 이 비활성화 자체가 `sync_mode=full_snapshot`이고 안전장치를 통과했을 때만 실행된다 — §11 참조(2026-09-11 대량 비활성화 사고 이후 도입).**
- **빈 Row**: 브랜드/제품명이 모두 공백이면 무시.
- **중복 product_id**: 같은 배치 내 중복 발견 시 해당 Row는 Error로 처리하고 나머지는 계속 진행, `sync_logs.error_detail`에 기록.
- **잘못된 가격값**: 숫자 파싱 실패 시 해당 Row Validation Error 처리, 이전 값 유지(덮어쓰지 않음).
- **컬럼명 공백 불일치 대응**: 실측 결과 `최종 판매가 (카드결제)`와 `최종판매가 (현금or계좌이체)`처럼 표기가 살짝 다름 → 헤더 비교 시 trim + 공백 정규화 후 매칭.

## 6. Dynamic Column 감지 및 제외 목록

Header 순회 시 아래 컬럼은 **Dynamic Field 자동 생성 대상에서 제외**(Softr 전용 메타데이터로 간주, 별도 처리):

| 제외 컬럼(상시 시트 실측) | 사유 |
|---|---|
| `수정일` | Softr 자동 타임스탬프. NEW 판정은 자체 diff로 계산하므로 그대로 신뢰하지 않음 |
| `NEW` | Softr의 구(舊) 7일 뱃지 값. 신규 시스템의 NEW 로직과 무관 |
| `최근 수정 건수` | 실측 결과 상품별 데이터가 아니라 요약 통계 셀이 우연히 한 행에 섞여 들어간 것으로 확인됨 — Dynamic Field화 시 데이터 오염 위험 |
| `🔐 Softr Record ID` | `legacy_softr_record_id` Core 컬럼으로 별도 저장, 일반 Dynamic Field 아님 |

그 외 알려지지 않은 새 Header가 나타나면:
1. `promotion_field_definitions`에 자동 행 생성 (Safe Default: 표시 ON, 검색/필터/NEW/Push OFF, type=text)
2. 값은 `promotions.extra_fields`(JSONB)에 `{ field_key: value }`로 저장
3. Admin 화면에서 이후 설정 변경 가능 (재배포 불필요)

## 7. 행사 노출/비노출 & 자동 기간 제어 ✅ 확정(컬럼 신설 동의)

- 실측 결과 [행사 프로모션] 시트에는 노출여부/시작일/종료일/행사명 컬럼이 없었으나, 본사 담당자가 아래 컬럼 신설에 동의했다(product-requirements.md §8):
  - `행사명` (text)
  - `행사 시작일`, `행사 종료일` (연도 포함 명시적 날짜, 예: `2026-09-20`) — 기존 `행사 기간`(자유텍스트, 연도 없음)은 표시용 원문으로 유지
  - `노출여부` (`ON`/`OFF` 값 — Spreadsheet에서 담당자가 쉽게 토글 가능한 형태)
- Sync는 이 값을 그대로 `event_campaigns.is_visible`, `start_at`, `end_at`에 매핑
- 최종 노출 여부는 **DB View(`event_campaigns_visible`)가 매 요청 시 시간 조건을 재계산**하므로, 담당자가 종료 후 OFF 처리를 깜빡해도 자동으로 비노출 처리됨(§23) — 별도 배치 Job 불필요.
- 행사 데이터는 노출 여부와 무관하게 삭제하지 않는다(§21) — `event_campaigns`/`event_campaign_products` 행은 그대로 보존.

## 8. Sync Log

`sync_logs`에 시트별로 다음을 기록:
- source_sheet(permanent/event), 실행시각, 성공여부, 신규/수정/비활성/실패 건수, 실패 사유, 마지막 정상 Sync 시각
- `sync_mode`(full_snapshot/partial), `received_row_count` — 이 실행이 어떤 모드로 몇 행을 받았는지. §11의 onEdit Partial/10분 Full Snapshot 두 경로가 실제로 도입된 뒤, "이 실행이 partial이었는지 full_snapshot이었는지"를 Apps Script 실행 로그가 아니라 DB만으로 사후 확인할 수 있어야 한다는 필요가 2026-09-15 Secret 교체 검증 과정에서 실제로 드러나 추가했다(`20260915090000_sync_logs_mode_and_row_count.sql`). 요청 접수 시점에 즉시 기록되므로 source_sheet 불일치로 인한 즉시 실패 건도 남는다.

Admin 화면 표시 예:
```
상시 프로모션   마지막 정상 Sync 14:32   142건 처리
행사 프로모션   마지막 정상 Sync 14:31   37건 처리
```

## 9. Data Freshness

- 목표: Spreadsheet 저장 → Apps Script Trigger(수 초~수 분 내) → Supabase 반영 → 열려있는 PWA는 Supabase Realtime 구독으로 자동 갱신 Toast, 닫혀있으면 다음 접속 시 최신 데이터.
- 모든 테이블을 Realtime 구독하지 않고 `promotions`, `event_campaigns`, `notices` 등 갱신 신호가 필요한 테이블만 선별 구독(§20).

## 10. 대량 비활성화 안전장치 (`sync_mode`) ✅ 확정 (2026-09-11 실 데이터 사고 이후 도입)

### 사고 경위

Phase 6.5 실 데이터 검증 도중, `updated_at` 불필요 갱신 버그를 고치고 이를 실 API로 재검증하려고 1건짜리 테스트 payload를 실제 `/api/sync/permanent`에 직접 보냈다. 당시 "이번 Sync 페이로드에 없는 기존 product_id는 비활성화"라는 §5 규칙이 **무조건, 별도 안전장치 없이** 실행되고 있었기 때문에, 실 데이터 188건 중 187건이 그 자리에서 전부 `is_active=false`로 비활성화되는 사고가 발생했다. 즉시 발견해 전량 복구했지만, 이 사고를 계기로 "누락 = 비활성화"라는 구조 자체를 재설계했다.

### 설계

Sync Request에 `sync_mode` 필드를 도입한다(`SyncRequestBody.sync_mode`, `src/lib/sync/types.ts` / `validate-request.ts`):

```
sync_mode = "full_snapshot" | "partial"   (기본값: "partial")
```

- **`partial`(기본값)**: 이 payload가 전체 목록이라는 보장이 없다는 뜻. §5의 Soft Delete 로직 **자체를 실행하지 않는다** — 누락된 기존 product_id가 있어도 절대 건드리지 않는다. 직접 API 호출·부분 재전송·재시도 등 "전체가 아닐 수 있는" 모든 경우를 기본적으로 안전하게 만든다.
- **`full_snapshot`**: 이 payload가 해당 Sheet 타입의 전체 상품 목록이라는 명시적 보장. Apps Script의 정상적인 전체 Sheet Sync(`syncPermanentOnly`, `syncEventOnly`, `syncAll` — `apps-script/Sync.gs`)만 이 값을 보낸다. 이때만, 그것도 아래 안전장치를 모두 통과했을 때만 Soft Delete를 실행한다.

`source_sheet` 필드(`"permanent" | "event"`)도 함께 도입해, 발신측이 "이 payload는 이 Sheet용이다"를 스스로 명시하게 한다. 지정됐는데 호출된 엔드포인트와 다르면 Sync 자체를 즉시 실패시킨다(잘못된 Sheet의 payload가 엉뚱한 엔드포인트로 들어오는 사고 방지).

### `full_snapshot`에서만 적용되는 안전장치 (`src/lib/sync/safety.ts`, `engine.ts`)

`full_snapshot`이고 누락된 기존 product_id가 1건이라도 있으면, 실제 비활성화 전에 아래를 순서대로 확인한다. 하나라도 걸리면 **비활성화를 전혀 실행하지 않고, 이번 Sync 실행 자체를 실패(`success:false`, HTTP 409)로 기록**한다 — 일부만 처리하고 조용히 성공으로 보고하지 않는다.

1. **Row parse 성공 여부**: 이번 실행에서 Row 파싱/검증 실패(`errors.length > 0`)가 하나라도 있으면 이 payload를 "전체 목록"으로 신뢰할 수 없다고 보고 중단.
2. **누락 비율/절대값 임계치** (`evaluateDeactivationSafety`): 기존 활성 상품 대비 누락 비율이 **50% 초과**이거나, 누락 절대값이 **50건 초과**이면 중단. 둘 중 하나만 넘어도 차단한다(예: 188건 중 187건 누락 — 비율 99.5%, 절대값 187건, 둘 다 초과 → 즉시 중단). 임계치는 `SYNC_DEACTIVATION_MAX_RATIO` / `SYNC_DEACTIVATION_MAX_ABSOLUTE` 환경변수로 조정 가능(기본 0.5 / 50).

안전장치를 통과하면 기존과 동일하게 누락된 product_id를 `is_active=false`로 비활성화하고 `promotion_change_logs`에 기록한다.

응답(`SyncResponseBody.deactivationGuard`)에 항상 판정 결과를 담아 반환한다: `skipped`(partial이라 아예 시도 안 함), `blocked`(full_snapshot인데 안전장치가 막음), `reason`, `missingCount`, `missingRatio`. `apps-script/Sync.gs`는 HTTP 409를 별도로 로그에 남겨 담당자가 바로 원인을 알 수 있게 한다.

### 테스트 전략 — 실 데이터를 절대 건드리지 않는 격리된 검증

- **순수 함수 단위 테스트** (`scripts/test-sync-safety.ts`, `npm run test:sync:safety`): 안전장치의 판정 로직(`evaluateDeactivationSafety`)을 DB/네트워크 없이 순수 배열/Set 값만으로 검증한다. 실제 사고와 동일한 시나리오(188건 중 1건만 존재)를 포함해 임계치 경계값까지 전부 커버 — 안전장치 자체가 잘못돼도 이 테스트는 절대 실 데이터에 영향을 줄 수 없다.
- **API 통합 테스트** (`scripts/test-sync.ts` §9a/§9b/§9c, `npm run test:sync`): 기본값 `partial`로는 실 데이터를 포함한 어떤 payload를 보내도 비활성화가 발생하지 않음을 실 DEV 환경에서 직접 검증하고(§9a, 실제 사고를 안전하게 재현), `full_snapshot`으로 누락 비율이 큰 payload를 보내도 안전장치가 막아 실 데이터가 전혀 바뀌지 않음을 검증한다(§9b). 두 경로 모두 "비활성화가 실행되지 않는" 방향만 실 데이터로 검증하므로 구조적으로 안전하다. 이 스크립트가 만드는 테스트 상품/캠페인/Dynamic Field 정의는 실행 종료 시(성공/실패 무관) `main()`의 `finally`에서 반드시 정리되어, 실 데이터 옆에 테스트 잔여물이 남지 않는다.
- **의도적으로 실 데이터와 섞어 `full_snapshot`의 성공적인 비활성화(정상 케이스)까지 실 DEV DB에서 end-to-end로 검증하지는 않았다** — 실 상품 전량을 재구성해 payload에 포함시키는 방식은 재구성 로직에 버그가 있을 경우 그 자체가 사고가 될 수 있어, 이번 사고의 심각성을 고려해 의도적으로 범위에서 제외했다. 해당 코드 경로(누락분만 반복문으로 비활성화)는 안전장치 도입 이전부터 있던 로직 그대로이며, 안전장치 통과 여부만 새로 추가됐다.

## 11. 자동 Sync 즉시 반영 — onEdit 트리거 + 디바운스 + Full Snapshot Safety Net ✅ 확정 (2026-09-14)

§3의 "Spreadsheet onEdit / 5~10분 주기 Trigger"를 실제로 구현했다. 10분 주기 `syncAll`만으로는
최대 10분의 반영 지연이 생기므로, 담당자가 Spreadsheet를 수정하면 **수 초 내로** 반영되도록
두 개의 독립적인 트리거 경로를 둔다(`apps-script/Sync.gs`).

### 경로 1 — 설치형 onEdit 트리거 (기본 경로, `sync_mode: "partial"`)

- `[상시 프로모션]`/`[행사 프로모션]` 시트가 수정되면 **설치형(installable)** onEdit 트리거
  `handleEditTrigger`가 실행된다. 단순(simple) `onEdit(e)` 트리거는 `UrlFetchApp` 같은 인증이
  필요한 서비스를 쓸 수 없어(Apps Script 권한 제약) 설치형으로만 구현 가능하다 — 사람이
  `installOnEditTrigger()`를 한 번 실행해야 등록된다.
- `handleEditTrigger`는 API를 즉시 부르지 않는다. 수정된 Row 번호만 Script Properties에
  누적하고, 아직 flush가 예약돼 있지 않으면 `DEBOUNCE_DELAY_MS`(기본 3초) 뒤에 실행될
  1회성 트리거(`flushPendingSync`)를 예약한다 — 같은 Row를 짧은 시간에 여러 셀 고쳐도
  Sync API가 여러 번 불리지 않도록 하는 마이크로배칭이다. `LockService`로 동시 실행 시
  Property 값이 깨지지 않게 보호한다.
  - 순수 debounce(매 편집마다 타이머를 리셋)가 아니라 **고정 윈도우 배칭**을 선택했다 —
    편집이 계속 이어지면 순수 debounce는 반영이 무한히 밀릴 수 있는데, 고정 윈도우는
    첫 편집 후 항상 최대 `DEBOUNCE_DELAY_MS` 내에 반영을 보장한다("가능한 한 빠르게
    반영"이라는 목표에 더 부합).
- 예약된 시점에 `flushPendingSync` → `flushPendingSyncForSheet_`가 그 사이 누적된 Row
  번호들을 **flush 시점 기준 최신 셀 값으로 다시 읽어** payload를 구성하고, `sync_mode:
  "partial"`, `source_sheet: <sheet>`로 `/api/sync/permanent`(또는 `/event`)를 호출한다.
  다른 Sheet의 수정은 `handleEditTrigger` 진입부에서 즉시 무시되어 API 호출 자체가 없다.
- **partial이므로 §10의 비활성화 로직 자체가 실행되지 않는다** — 수정된 몇 개 Row만
  보내는 이 경로가 실수로 나머지 상품을 비활성화할 구조적 가능성이 없다.

### 경로 2 — 10분 주기 syncAll (Safety Net, `sync_mode: "full_snapshot"`)

- 기존 `installTriggers()`로 등록하는 `syncAll` 10분 주기 트리거를 그대로 유지한다. onEdit
  트리거는 Apps Script 재시작/일시적 오류/Quota 등으로 간헐적으로 누락될 수 있으므로, 이
  경로가 전체 Sheet를 주기적으로 다시 읽어 놓친 변경을 되찾아온다.
- 이 경로만 `sync_mode: "full_snapshot"`을 보내고, §10의 안전장치(Row parse 확인,
  누락 비율/절대값 임계치)를 전부 통과해야 실제 비활성화가 일어난다 — onEdit 경로의
  잦은 호출과 무관하게 안전장치는 이 경로에서만, 항상 동일하게 적용된다.

### product_id write-back과 Loop 방지

- 신규 Row(product_id 빈칸)가 Partial Sync로 처리되면 서버가 채번한 product_id를 기존과
  동일한 `writeBackProductIds_`가 해당 셀에 되쓴다. 이 되쓰기 자체가 다시 `handleEditTrigger`를
  유발해 무한 Loop가 되지 않도록, 되쓰는 동안 Script Properties에 `WRITEBACK_IN_PROGRESS_
  <sheet>` 플래그를 세워두고 `handleEditTrigger` 진입부에서 이 플래그가 있으면 즉시 무시한다.
  Apps Script 공식 동작상 스크립트가 직접 쓴 셀 값 변경은 onEdit을 발생시키지 않는 것이
  정상이라 이 플래그 없이도 Loop가 나지 않아야 하지만, 설치 후 실제로 한 번은 실행 로그로
  직접 재발이 없는지 확인한다(`apps-script/README.md` §4 "Loop 방지 확인" / §9 체크리스트).
- Row 번호는 payload 구성 시점과 되쓰기 시점 사이에 사람이 행을 삽입/삭제하면 다른 상품을
  가리킬 수 있다(기존 Full Snapshot 경로와 동일한 한계). 대상 셀이 비어있을 때만 쓰는 기존
  방어가 그대로 적용되고, 설사 이 Row 번호 드리프트로 되쓰기가 한 번 건너뛰어져도 10분
  Full Snapshot Safety Net이 product_id 기준으로 다시 확인해 정합성을 맞춘다.

## 12. 재배포 없이 반영되는 것 vs 개발이 필요한 것

| 재배포 불필요 | 추가 개발 필요 |
|---|---|
| 신규 일반 컬럼 추가 → Dynamic Field로 저장/표시 | 새 컬럼이 가격 계산식에 관여 |
| Admin이 Field 표시순서/검색/필터 On-Off 변경 | 새 컬럼이 특수 UI(예: 이미지 갤러리) 요구 |
| 상품 데이터 값 변경(Spreadsheet 수정) | 새 컬럼이 새로운 권한 로직 요구 |
| 행사 노출 ON/OFF, 기간 변경 | 새로운 Push 정책/Workflow 요구 |
