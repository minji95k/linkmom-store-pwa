# CLAUDE.md — 링크맘 매장 직원용 내부 운영 PWA

이 파일은 프로젝트 전체에 지속 적용되는 규칙이다. 상세 설계는 `docs/`를 참조한다.

## 문서 맵
- [docs/current-system-analysis.md](docs/current-system-analysis.md) — 현행 Softr/Spreadsheet 실측 분석
- [docs/product-requirements.md](docs/product-requirements.md) — 요구사항/User Journey/Navigation
- [docs/architecture.md](docs/architecture.md) — 시스템 아키텍처
- [docs/database-schema.md](docs/database-schema.md) — DB 스키마/ERD
- [docs/permissions.md](docs/permissions.md) — Role/RLS
- [docs/sync-design.md](docs/sync-design.md) — Google Sheet ↔ Supabase Sync
- [docs/push-design.md](docs/push-design.md) — Web Push 설계

## 절대 원칙 (위반 금지)

1. 이 시스템은 Demo가 아니라 링크맘 본사/매장 직원이 매일 쓰는 **Production 내부 업무 시스템**이다.
2. 프로모션 데이터의 **Source of Truth는 Google Spreadsheet**다. `[상시 프로모션]`과 `[행사 프로모션]`은 서로 다른 목적을 가진 **별개의 Source Sheet**이며 하나로 합치지 않는다.
3. **본사 담당자가 Spreadsheet만 고치면 매장 직원 화면에 반영되어야 한다.** 프로모션 데이터를 고칠 때마다 개발자 개입, Claude Code 실행, Frontend 재배포, Vercel 재배포가 필요한 구조를 절대 만들지 않는다. Sync는 One-way(Sheet → Supabase)만 존재한다.
4. 행사 프로모션은 ON/OFF 노출 제어가 가능해야 하고, ON이어도 종료일이 지나면 **자동으로 비노출**되어야 한다(담당자가 OFF를 깜빡해도 안전). 비노출은 삭제가 아니다 — 데이터는 보존한다. 여러 행사가 동시에 운영될 수 있으므로 캠페인을 하드코딩하지 않는다.
5. Spreadsheet에 새 컬럼이 추가되어도(일반 운영정보라면) **재배포 없이** Sync/표시가 가능해야 한다. Core Field(가격/검색/권한/Push 로직에 쓰이는 것)와 Dynamic Field(JSONB, 그 외 일반 정보)를 구분한다. 새 Dynamic Field의 기본값은 표시 ON / 검색·필터·NEW·Push OFF다.
6. NEW는 "최근 7일 내 수정된 모든 상품"이 아니다. **최근 72시간(Rolling)** 내 신규 상품 또는 가격/프로모션/혜택/사은품/행사기간/판매조건 등 **중요 변경**만 NEW로 취급한다. 공백/오타/표기정리/내부관리 필드/타임스탬프만 바뀐 것은 제외한다.
7. **NEW 판정과 Push 판정은 동일한 Change Classification(`promotion_field_definitions.change_importance`/`push_enabled`)을 공유**한다. 서로 다른 중요도 로직을 만들지 않는다.
8. 다수 상품이 짧은 시간에 함께 수정되면 Push를 건수만큼 보내지 않는다 — Summary Notification으로 통합한다(critical/필독/즉시발송 지정 건은 예외).
9. 공지(신상품 교육 등 교육 목적 공지 포함 — Phase 9 SKIP, 아래 참조)는 대상 매장·Role을 지정할 수 있어야 한다.
10. 사용자·매장 권한은 UI가 아니라 **Database RLS + Server-side Authorization**으로 보호한다. URL 변경, API 직접 호출, Client Role 조작으로 우회되면 안 된다.
11. 가격/프로모션 정보에 오래된 Cache가 노출되면 안 된다(PWA Service Worker는 앱 셸만 캐시, 데이터는 Network First).
12. Supabase Service Role Key, VAPID Private Key는 클라이언트에 절대 노출하지 않는다. `.env*`는 커밋하지 않는다.
13. Native App을 만들지 않는다. Mobile First Responsive PWA다. 직원 화면은 Mobile First, 관리자 화면은 Desktop First(모바일 접근도 가능).

## Tech Stack

- Frontend: Next.js(App Router) + TypeScript + Tailwind CSS + shadcn/ui
- Backend/DB: Supabase(PostgreSQL, Auth, Realtime, Storage, RLS)
- Sync: Google Apps Script → Next.js API Route(서버 전용) → Supabase
- Push: Web Push(VAPID) + Service Worker
- Deploy: Vercel

## 개발 원칙

- Reference(`reference/softr`, `reference/spreadsheet`, `reference/brand`)를 확인하지 않은 내용을 추측해서 확정하지 않는다.
- 전체 기능을 한 번에 구현하지 않는다. Phase 단위로 진행한다(마스터 프롬프트 §82 순서 기준: 분석 → 요구사항 → 아키텍처 → UI → Foundation → Auth → Promotion Migration → Promotion UI → Notice → ~~Training~~(2026-09-17 SKIP, Notice로 통합) → Realtime → Push → Admin → Security → QA → Deployment).
- Database 변경은 Migration 파일로 관리한다. Production DB 수동 직접수정에 의존하지 않는다.
- TypeScript `any` 사용 최소화. 중복 코드 최소화, 재사용 가능한 Component 사용.
- Mock Data는 명확히 분리한다.
- 각 Phase 완료 시 lint/type check/production build를 실제로 돌려보고 통과를 확인한 뒤 "완료"라고 보고한다.
- UI/Frontend 변경은 실제로 브라우저에서 동작을 확인한 뒤 완료로 보고한다.
- 실제 구현과 문서가 달라지면 `docs/`도 함께 업데이트한다.
- **사용자가 Google Apps Script 등 외부 시스템에서 직접 E2E 수동 테스트를 진행 중인 Phase에서는, 로컬 `npm run dev` 서버를 임의로 종료하지 않는다.** 사용자가 명시적으로 테스트 종료를 알리기 전까지 계속 실행 상태로 둔다(2026-09-15, dev server를 자체 정리 습관으로 죽였다가 사용자의 실 Sheet onEdit 테스트가 서버에 아예 도달하지 못한 사고로 도입). `npm run build`처럼 서버 프로세스를 새로 띄우지 않는 명령은 실행해도 되지만, 실행 후 반드시 dev server가 여전히 응답하는지(`curl`) 확인한다 — `next build`와 `next dev`가 `.next/` 디렉터리를 공유하므로 이론적으로 서로 영향을 줄 수 있다.

## 데이터 관련 주의사항 (실측 기반)

- Spreadsheet의 `수정일`, `NEW`, `최근 수정 건수`, `🔐 Softr Record ID` 컬럼은 Softr 전용 메타데이터다. Dynamic Field 자동 감지 대상에서 제외하고 별도 처리한다. 특히 `최근 수정 건수`는 상품별 데이터가 아니라 요약 통계 셀이 섞여 들어간 것이므로 그대로 신뢰하지 않는다.
- 상시/행사 시트의 사은품 컬럼명이 다르다(`증정사은품` vs `행사 사은품`) — Sync 매핑에서 의미는 같게(`gift`) 통합하되 헤더 이름은 각각 명시적으로 지정한다.

## 확정된 사용자 의사결정 (2026-09-09)

- **[행사 프로모션] 시트 컬럼 신설 동의**: `행사명`/`시작일`/`종료일`/`노출여부`를 신설한다. 실제 운영 시트가 아닌 개발/복제 시트에서 먼저 검증 후 반영한다.
- **`product_id`는 서버 자동 채번**이다. 담당자는 시트에 아무 값도 입력하지 않는다 — 서버가 신규 상품을 감지해 채번한 뒤 Apps Script로 해당 셀에 값을 다시 써준다(Write-back은 이 컬럼 1개에만 한정). 상세: [sync-design.md](docs/sync-design.md) §4.
- **매장은 용인본점, 동백점 2곳으로 확정, 향후 매장 추가 계획이 있다.** 코드/RLS/Push·Notice Targeting 어디에도 매장명·매장 개수를 하드코딩하지 않는다. `stores` 테이블 행 추가만으로 신규 매장이 반영되어야 한다.
- **STORE_MANAGER의 유일한 추가 권한은 "전체 매장(용인본점+동백점)의 프로모션 전체 조회"뿐이다.** 소속 매장에 관계없이 프로모션(상시+행사) 데이터는 전체를 보되, 공지/교육자료 등 그 외 기능은 STAFF와 동일하게 소속 매장 범위로 제한된다. 이는 매장이 늘어나도 "전체"로 자동 확장되는 Role 기반 예외이며 특정 매장명을 조건에 하드코딩하지 않는다. 상세: [permissions.md](docs/permissions.md) §1, §3.
- (미결정) 공지유형/매장별운영 등 자유 텍스트 필드 표기 표준화 여부 — 1차 버전은 시스템이 trim/공백정규화로 흡수하는 것을 기본값으로 진행한다.

## Phase 6 구현 메모 (Promotion Sync)

- **DEV Supabase 프로젝트는 새 테이블마다 GRANT를 명시적으로 해줘야 한다.** `alter default privileges`를 한 번 걸어뒀지만(20260909120500_grants.sql), 안전하게 매번 새 테이블 migration 끝에 `grant all on <table> to anon, authenticated, service_role;`을 추가하는 패턴을 계속 따른다 — Phase 5/6 둘 다 이 GRANT 없이는 `permission denied`가 났다.
- **`src/proxy.ts`는 `/api/*` 경로를 세션 리다이렉트 대상에서 제외한다.** Sync API처럼 Bearer 토큰으로 자체 인증하는 Route Handler를 proxy가 `/login`으로 리다이렉트해버리는 버그가 실제로 있었다 — 새 API Route를 추가할 때 이 예외를 건드리지 않는다.
- **PostgREST에서 RLS가 UPDATE/DELETE 대상 행을 0건으로 만들면 `error`가 나지 않는다** — 그냥 0건 성공으로 응답한다. RLS 쓰기 차단을 테스트할 때는 `.select()`로 실제 반환된 행 수와 Service Role로 재조회한 DB 값을 함께 확인해야 한다(단순히 `error` 유무만 보면 오탐이 난다 — 실제로 겪음).
- **`event_campaigns.campaign_key`는 Spreadsheet의 `행사명` 값을 trim한 문자열 그대로다.** 같은 행사명을 쓰는 여러 Row가 자동으로 같은 캠페인으로 묶인다.
- Sync에서 셀 값이 빈 문자열이거나 `"-"`이면 전부 `null`로 정규화한다(실측 데이터 패턴, `src/lib/sync/engine.ts`의 `normalizeCellText`).
- `product_id`는 `next_product_id()` Postgres Sequence로 채번(`PROD-000001`식) — 최초 Import든 신규 Row 추가든 "product_id가 비어있다"는 동일 조건으로 처리하며 별도 분기를 두지 않는다.
- Sync 테스트: `npm run test:sync`(파이프라인 End-to-End, 로컬 dev server 필요), `npm run test:promotion-rls`(Promotion 도메인 RLS), `npm run db:clean:promotions`(테스트 데이터 초기화).

## Phase 6.5 보안 재검토 (실제 Google Sheet 연동 전, 2026-09-10)

- **View는 기본적으로 RLS를 우회한다 — 이 프로젝트에서 실제로 재현·확인함.** `event_campaigns_visible`은 그동안 View 자체의 WHERE절이 우연히 비노출 캠페인을 걸러내고 있었을 뿐 RLS 덕분이 아니었다(진단용 필터 없는 View로 재현: STAFF가 비노출 캠페인까지 조회 가능했음). **앞으로 promotions 도메인에 View를 새로 만들 때마다 반드시 `security_invoker = on`을 설정한다.** (`alter view ... set (security_invoker = on);`)
- **PostgREST에서 GRANT 자체가 없으면 "permission denied" 에러, RLS만으로 막히면 에러 없이 0건 성공**이다. 둘 다 유효한 차단이므로 RLS 테스트를 짤 때 error 유무만 보지 말고 항상 Service Role로 재조회해 실제 DB 값이 안 바뀌었는지 확인한다(`scripts/test-promotion-rls.ts` 참조).
- **anon/authenticated GRANT는 최소 권한으로 좁혔다** — `grant all`이 아니라 SELECT(+필요한 테이블만 UPDATE) 위주로. 상세: docs/permissions.md §6.
- **STORE_MANAGER의 "프로모션 전체 매장 조회" 예외는 폐기했다** — promotions 자체가 매장별로 분리돼 있지 않아 실질적 차이가 없었고, 유일하게 차이 나던 지점(비노출 행사 캠페인 조회)은 ADMIN 전용으로 좁혔다. 매장별 데이터 분리가 실제로 생기면 다시 검토한다. 상세: docs/permissions.md §1.
- Apps Script의 product_id 되쓰기(`writeBackProductIds_`)는 대상 셀이 **비어있을 때만** 쓴다 — payload 생성과 되쓰기 사이에 사람이 행을 삽입/삭제해 rowNumber가 밀렸을 가능성에 대한 방어.

## 첫 실제 Google Sheet E2E Sync (2026-09-10) 확인 사항

- DEV Sheet ↔ Apps Script(ngrok) ↔ Sync API ↔ Supabase 전체 경로로 `[상시 프로모션]` 188건을 실제로 Import해 검증 완료. Core Field 매핑·가격 Numeric 저장·product_id 채번+Sheet 되쓰기·Dynamic Field(미검출, extra_fields 전부 `{}`)·Soft Delete·sync_logs 전부 실측 확인됨.
- **Migration/Initial Import로 생성된 상품은 Push 발송 대상에서 제외한다** (확정, 사용자 지시) — `promotions.is_initial_import` / `promotion_change_logs.push_eligible` 두 컬럼으로 구현·검증 완료. 상세: docs/push-design.md §3.1~3.2.
- ⚠️ **위 `is_initial_import` 판정을 "promotions Row가 0건인지"로만 봤다가 사용자 재검토로 실수를 잡았다** — Hard Delete 후 재Sync하면 다시 0건이 되어 최초 Import로 오판정될 수 있었다. `promotion_sync_state`(Sheet 타입별 영구 상태, Row가 전부 삭제돼도 유지됨)로 교체했고, 실제로 "최초 Sync → Hard Delete → 재Sync" 시나리오를 재현해 수정 전엔 오판정됨/수정 후엔 정상임을 직접 확인했다. **앞으로 "이 테이블에 데이터가 있는지"로 상태를 판단하는 로직을 새로 만들 때는 항상 이 사례를 참고 — Row 존재 여부는 Hard Delete에 취약하다.**
- 테스트 스크립트(`test:sync`, `test:promotion-rls`)는 `promotions`에 실제 라이브 데이터가 들어간 뒤로는 **`npm run db:clean:promotions`를 함부로 실행하면 안 된다** — 실제 Sheet에서 온 데이터까지 지워버린다. 앞으로 이 스크립트들을 실 데이터가 있는 DB에서 돌릴 땐 `event` 타입처럼 아직 비어있는 영역을 쓰거나, 별도 정리 로직으로 테스트 Row만 골라 지운다(product_id 접두사나 특정 브랜드명으로 식별).

## 대량 비활성화 사고 및 `sync_mode` 안전장치 도입 (2026-09-11)

- **실제로 벌어진 사고**: 위 항목의 경고를 실제로 어겼다 — `updated_at` 불필요 갱신 버그 수정을 검증한다며 1건짜리 테스트 payload를 실 라이브 `/api/sync/permanent`에 직접 보냈고, 당시 "이번 Sync에 없는 기존 product_id는 무조건 비활성화"하던 Soft Delete 로직이 아무 안전장치 없이 실행되어 실 데이터 188건 중 187건이 전부 `is_active=false`가 됐다. 즉시 발견(응답의 `deactivatedCount:188`)해 전량 재활성화 + 오류 change_log 삭제 + 테스트 상품 제거로 완전 복구했지만, 사용자에게 전체 경위를 투명하게 보고했다.
- **재발 방지 설계**: `sync_mode`(`full_snapshot`/`partial`, 기본값 `partial`) 도입. **partial(기본값)에서는 Soft Delete 로직 자체를 아예 실행하지 않는다** — 그 어떤 payload를 보내도 누락된 상품을 건드릴 수 없다. Apps Script의 정상 전체 Sheet Sync(`syncPermanentOnly`/`syncEventOnly`/`syncAll`)만 명시적으로 `full_snapshot`을 보내며, 그때도 Row parse 실패 여부 + 누락 비율(50% 초과)/절대값(50건 초과) 임계치를 모두 통과해야만 실제 비활성화가 실행된다. 상세 설계: docs/sync-design.md §10, 구현: `src/lib/sync/safety.ts` + `engine.ts`.
- **테스트가 실 데이터를 위험하게 만들 수 있다는 교훈**: 이 사고 자체가 "테스트/검증 목적의 API 호출"이 원인이었다. 이후로는 (1) 안전장치의 판정 로직은 DB를 전혀 쓰지 않는 순수 함수 단위 테스트로 분리해 검증하고(`scripts/test-sync-safety.ts`), (2) 실 API 통합 테스트는 "비활성화가 실행되지 않는" 방향만 실 데이터로 검증하며(기본값 partial 안전성, full_snapshot 안전장치 차단), "정상적으로 비활성화가 성공하는" 경로는 실 데이터를 재구성해 섞는 방식 자체가 또 다른 사고 벡터가 될 수 있어 의도적으로 실 DEV DB 대상 검증 범위에서 제외했다. **테스트 스크립트가 실 데이터가 있는 도메인에 새로운 검증을 추가할 때는 항상 "이 테스트가 실패하거나 버그가 있으면 최악의 경우 무엇이 깨지는가"를 먼저 따져보고, 그 최악의 경우가 되돌릴 수 없는 것이면 순수 함수 분리나 격리된 fixture로 우회한다.**
- `test-sync.ts`는 이제 실행 종료 시(성공/실패/예외 무관) `main()`의 `finally`에서 자신이 만든 테스트 상품/캠페인/Dynamic Field 정의를 스스로 정리한다 — 매 실행마다 실 데이터 옆에 테스트 잔여물이 쌓이지 않는다.

## onEdit 즉시 반영 Trigger 도입 (2026-09-14)

- **단순(simple) `onEdit(e)` 트리거는 `UrlFetchApp`을 쓸 수 없다** — Apps Script가 권한이 필요한 서비스 호출을 인증되지 않은 단순 트리거에서는 막는다. 그래서 Sheet 수정에 반응해 API를 호출해야 하는 로직은 반드시 **설치형(installable) 트리거**(`ScriptApp.newTrigger(...).forSpreadsheet(ss).onEdit().create()`)로 등록해야 한다 — 사람이 최초 한 번 실행해 권한을 승인해야 동작한다.
- **디바운스는 "매 편집마다 타이머 리셋"이 아니라 "고정 윈도우 배칭"으로 구현했다** — 첫 편집 시점에 한 번만 지연 트리거를 예약하고, 그 창 안에 들어오는 추가 편집은 Row 목록에만 누적한다. 순수 debounce는 계속 편집이 이어지면 반영이 무한정 밀릴 수 있어 "가능한 한 빠르게 반영"이라는 목표와 맞지 않다.
- Google Apps Script의 1회성 시간 기반 트리거(`.timeBased().after(ms).create()`)는 실행 후 자동으로 삭제된다 — 디바운스용 트리거를 직접 지울 필요가 없다.
- **스크립트가 `Range.setValue()`로 쓴 값은 onEdit을 발생시키지 않는 것이 Apps Script의 공식 동작**이다(product_id write-back이 Loop를 유발하지 않는 근거). 다만 이 프로젝트는 "가정하지 말고 직접 확인" 원칙을 지키므로, `WRITEBACK_IN_PROGRESS_<sheet>` Script Property 플래그로 이중 방어를 걸어두고, 실제 설치 후 반드시 실행 로그로 재발이 없는지 확인한다(`apps-script/README.md` §9).
- Partial Sync(수정된 Row만 전송)는 §대량 비활성화 안전장치 항목의 `sync_mode="partial"` 덕분에 구조적으로 안전하다 — onEdit 경로를 아무리 자주/작게 호출해도 비활성화 로직 자체가 실행되지 않는다. 안전장치는 10분 Full Snapshot 경로에만 적용된다.
- ⚠️ **처음엔 `sync_logs`에 `sync_mode`를 기록하지 않았다** — 2026-09-15 실 Secret 교체 검증 중 사용자가 "이 실행이 partial인지 full_snapshot인지 DB로 확인해달라"고 요청했을 때, `inserted/updated/deactivated_count`만으로는 두 모드를 구분할 수 없다는 게 드러났다("1건만 변경된 full_snapshot"과 "1건짜리 partial"이 카운트상 동일). `sync_mode`/`received_row_count` 컬럼을 추가(`20260915090000_sync_logs_mode_and_row_count.sql`)해 해결했다. **앞으로 요청의 어떤 속성(모드, 트리거 종류 등)을 사후 감사에서 구분해야 할 가능성이 있다면, 카운트/결과값만 로그에 남기지 말고 그 속성 자체를 처음부터 명시적으로 기록한다.**
- ⚠️ **처음엔 `flushPendingSync`가 API 호출 "전에" pending Row 목록을 지웠다** — 2026-09-15 dev server가 잠깐 죽어있는 동안 사용자의 실 Sheet 편집이 서버에 도달하지 못했는데, pending이 이미 지워진 뒤라 그 편집들이 onEdit 경로에서 완전히 유실됐다(다행히 10분 Full Snapshot Safety Net이 결국 잡아냈다 — 사고 나기 전 설계 의도 그대로 동작). **pending은 반드시 API 요청이 실제로 성공(2xx)한 뒤에만 지운다**로 고치고, 연결 실패/timeout/5xx/429는 15초→30초→60초 백오프로 최대 3회 재시도(공유 카운터 `SYNC_RETRY_COUNT`), 401/403/409/400처럼 재시도해도 결과가 같을 실패는 즉시 로그만 남기고 pending도 그대로 둔다(다음 편집이나 Full Snapshot이 이어받음). 판정 로직(`classifySyncFailure_`/`nextRetryDelayMs_`)은 Apps Script 서비스에 의존하지 않는 순수 함수로 분리해 `scripts/test-apps-script-retry.ts`로 격리 테스트한다(Apps Script는 Node에서 직접 실행할 수 없으므로 로직을 수동으로 복제 — 둘 중 하나를 고치면 반드시 같이 고칠 것).
- ⚠️ **"실행된 1회성 Apps Script 트리거는 항상 즉시 삭제된다"는 가정에 기댔다가, 재부팅 후 "사용 중지됨" 상태의 `flushPendingSync` 트리거가 여러 개 누적된 것을 발견했다(2026-09-16)** — 정확한 원인은 Google 쪽 내부 동작이라 완전히 특정하지 못했다. "예약이 이미 돼 있는지"를 `FLUSH_SCHEDULED` Property 플래그로 판단하던 방식도 같이 제거했다 — 이 플래그가 실제 트리거 존재 여부와 어긋나면(트리거가 수동 삭제되는 등) pending이 영원히 안 풀리는 사고가 날 수 있었다. **Property 플래그 대신 `ScriptApp.getProjectTriggers()`로 실제 트리거 목록을 직접 확인**하고, `flushPendingSync`는 실행되자마자 자신을 포함한 동일 handler 트리거를 전부 지운 뒤 필요하면 정확히 1개만 다시 만들도록 스스로 상태를 보증한다. **앞으로 "플랫폼이 어떤 리소스를 알아서 정리해줄 것"이라는 가정에 의존하는 로직을 만들 때는, 그 가정이 깨졌을 때를 대비해 코드 스스로 매번 실제 상태를 확인하고 정리하는 자가 치유(self-healing) 경로를 기본으로 넣는다** — 정확한 원인 규명이 불가능하거나 비용이 크면 증상 재발을 막는 방향으로 고치는 것으로 충분하다. `ScriptApp`/`PropertiesService`는 순수 함수로 분리할 수 없어, `scripts/test-apps-script-trigger-lifecycle.ts`가 최소 in-memory mock으로 흉내 내 격리 테스트한다.
- ⚠️ **`promotion_change_logs.push_eligible`이 `importance`와 별개 축이라는 설계(§3.1) 때문에, `importance='minor'`인 로그도 컬럼 기본값(`true`)을 그대로 물려받아 저장되고 있었다(2026-09-16, 실 A~E 테스트 검증 중 발견)** — "중요하지 않은 변경인데 Push 대상"이라는 의미상 모순. Phase 11의 이중 필터(`importance != 'minor' AND push_eligible = true`)가 실제 발송은 걸러주지만, **DB 자체가 애초에 일관된 의미를 갖도록** `importance <> 'minor' or push_eligible = false`라는 한쪽 방향 CHECK 제약을 추가했다(`20260916010000_minor_change_logs_push_ineligible.sql`, 기존 DEV 데이터 4건도 함께 백필 — `promotions` 테이블은 손대지 않고 `promotion_change_logs`만). 반대 방향(important인데 push_eligible=false, 예: Initial Import new_product)은 여전히 허용되므로 CHECK을 한쪽으로만 걸었다. **앞으로 "두 컬럼이 서로 다른 축이라 독립적"이라고 설계해도, 실제로는 한쪽 방향의 함의가 성립하는 조합이 있다면 그 함의를 CHECK 제약으로 스키마에 새겨둔다** — 애플리케이션 코드가 실수로 빼먹어도 DB가 막아준다.
- ⚠️ **`event_campaigns` 변경 감지가 `start_at`/`end_at`을 문자열로 비교하고 있었다(2026-09-16 발견)** — Supabase가 돌려주는 `"+00:00"` 표현과 매번 새로 계산하는 `new Date().toISOString()`의 `".000Z"` 표현이 같은 시각인데도 문자열로는 달라, 캠페인이 있는 거의 모든 Sync(10분 Full Snapshot 포함)마다 "변경됨"으로 오판해 실 DEV DB에 불필요한 `campaign_visibility` 로그와 `last_important_change_at` 갱신이 4일간 143건 쌓였다. `timestampsEqual()`(epoch 비교) 순수 함수로 고치고(`src/lib/sync/timestamps.ts`), 기존 오염 로그는 `timestamptz` 캐스팅 비교(애플리케이션과 동일 기준)로 실제 값이 안 바뀐 것만 정확히 골라 삭제 + 영향받은 상품의 `last_important_change_at`을 남은 정상 로그 기준으로 재계산했다(`20260916030000_cleanup_bogus_campaign_visibility_logs.sql`). **DB에서 온 timestamptz 값과 애플리케이션에서 새로 계산한 timestamp를 비교할 때는 절대 문자열(`!==`)로 비교하지 않는다 — 항상 `new Date(x).getTime()`으로 변환해 비교한다.** 같은 세션에서 `promotion_sync_state`(Row 존재 여부로 상태 판단하지 않기)에 이어 "DB가 돌려주는 표현과 코드가 새로 만든 표현이 겉보기엔 다르지만 의미는 같을 수 있다"는 패턴이 두 번째로 실제 사고를 냈다 — 이런 비교는 항상 의심하고 직접 확인한다.
- ⚠️ **브랜드/제품명이 모두 비어 정상 스킵되는 Row(§5)를 엔진이 아무 기록 없이 조용히 `continue`하고 있었다** — `received_row_count`(Apps Script가 보낸 행 수)와 실제 처리 건수가 어긋났을 때 원인을 전혀 알 수 없었다(2026-09-16 `syncAll` 최종 검증 중 발견: permanent 191행 수신, 190건만 존재). `sync_logs.skipped_count`/`skipped_detail`을 추가해 스킵된 Row 번호와 사유를 기록하게 하자, 바로 다음 실행에서 "Row 1024, 브랜드/제품명 공백"이라는 정확한 원인이 드러났다. **"정상적으로 무시하는 경우"도 그냥 넘어가지 말고, 그 사실 자체를 사후 감사 가능한 형태로 남겨야 나중에 "왜 숫자가 안 맞지?"라는 질문에 코드를 다시 뒤지지 않고 답할 수 있다.**

## Phase 9(Training Material System) SKIP 결정 (2026-09-17)

- **별도 Training Material System(전용 테이블 4종/Bottom Nav 탭/Admin UI)은 구현하지 않기로 확정했다.** 신상품 교육/제품 가이드/상담 가이드/브랜드 교육 등 기존 교육자료 용도는 **Phase 8 Notice System**의 첨부파일(`attachments`)/외부링크(`notices.external_link`)/필독(`requires_confirmation`)/확인완료(`notice_reads.confirmed_at`)/Targeting(`notice_targets`)으로 전부 대체한다. 근거: 교육자료가 요구하는 기능이 공지사항과 완전히 동일한 구조라 별도 시스템을 유지할 이유가 없다는 사용자 판단. 상세: docs/product-requirements.md §4.6.
- 공지 유형(`notice_type`)에 `교육`을 추가했다(교육 목적 공지 구분용, 변경 중요도는 다른 정보성 유형과 동일하게 `minor`) — Change Classification 로직은 새로 만들지 않는다(절대 원칙 7).
- Bottom Navigation을 `[홈][프로모션][공지][교육자료][MY]` 5탭에서 **`[홈][프로모션][공지][MY]` 4탭**으로 정리했다. `/training` Placeholder Route도 제거했다 — 남겨둘 이유가 없는 죽은 코드를 그대로 두지 않는다.
- 이 결정 이후 문서상 `training_materials`/`training_material_*` 테이블은 **계획 기록으로만 남아있고 실제로 존재하지 않는다**(database-schema.md §4, permissions.md 참조) — 향후 이 테이블들을 실제로 만들 필요가 생기면 이 SKIP 결정을 먼저 뒤집어야 한다.

## Phase 10 Realtime 도입 (2026-09-17)

- **`supabase_realtime` Publication은 기본적으로 테이블이 하나도 안 걸려있다.** `alter publication supabase_realtime add table ...`로 명시적으로 추가해야 한다(실측 확인 — `puballtables=false`, 멤버 0개였음). `promotions`/`event_campaigns`/`notices` 3개만 추가했다 — "무분별하게 구독하지 않는다"는 지시사항에 따라 `notice_reads`/`promotion_change_logs` 등은 구독 대상에서 제외.
- ⚠️ **Realtime의 RLS 적용 여부를 문서만 믿고 넘어가지 않았다 — 실제로 재현·확인함.** STAFF 세션으로 자신이 볼 수 없는 행(비활성 상품, 다른 매장 전용 공지)의 UPDATE를 구독했을 때 이벤트가 오는지, 반대로 볼 수 있는 행은 정상 수신되는지 둘 다 스크립트로 확인했다(`scripts/test-realtime-rls.ts`) — Phase 6.5의 "View는 기본적으로 RLS를 우회한다"를 실측으로 발견했던 것과 같은 습관. 결과: Supabase Realtime의 `postgres_changes`는 실제로 RLS를 그대로 적용한다(정상 동작 확인, 별도 정책 불필요).
- ⚠️ **브라우저에서 구독이 "SUBSCRIBED"로 성공했는데도 이벤트가 하나도 안 오는 함정을 실제로 겪었다.** `createBrowserClient`(쿠키 기반 세션)는 세션을 비동기로 읽는데, `channel.subscribe()`를 그 로드보다 먼저 호출하면 Realtime 소켓이 anon 권한으로 붙어버린다 — 채널 자체는 정상 구독된 것처럼 보이지만(status: SUBSCRIBED) RLS가 모든 행을 막아 조용히 아무 이벤트도 안 온다. Node 스크립트(로그인 완료 후에만 구독)에서는 100% 재현이 안 되고 브라우저에서만 재현돼 원인 파악에 시간이 걸렸다. **해결**: `supabase.auth.getSession()`으로 세션을 먼저 확보하고 `await supabase.realtime.setAuth(session.access_token)`을 명시적으로 호출한 뒤에만 `channel.subscribe()`한다(`src/components/realtime/realtime-update-banner.tsx`). **앞으로 브라우저에서 Realtime을 구독하는 코드를 새로 만들 때는 항상 이 순서(getSession → setAuth → subscribe)를 지킨다 — "구독 성공"과 "이벤트 수신"은 별개로 확인해야 하는 것으로 취급한다.**
- UX는 데이터가 바뀌었다고 화면을 자동으로 바꾸거나 스크롤을 리셋하지 않는다 — 배너를 띄우고 사용자가 [새로고침]을 눌렀을 때만 `router.refresh()`한다. 검색/필터/페이지네이션이 전부 서버 쿼리 기준이라 Realtime payload를 클라이언트에서 직접 머지하면 그 상태와 어긋날 위험이 커서, Realtime은 "새 데이터가 있다"는 신호로만 쓰고 실제 데이터는 항상 RLS가 적용된 서버 재조회로 가져온다.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
