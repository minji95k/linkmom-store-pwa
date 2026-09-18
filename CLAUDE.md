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

## Phase 10 완료 (2026-09-17) — Bottom Nav 실시간화, debounce/coalesce, 구독 생명주기 테스트, 실 Google Sheet E2E

- **구독 생명주기(mount/unmount/재구독 방지)를 `src/lib/realtime/subscription.ts`의 순수 함수(`createRealtimeSubscription`)로 분리했다.** `RealtimeUpdateBanner`와 Bottom Nav 공지 뱃지가 이 함수 하나를 공유한다 — 두 곳에 구독 로직을 따로 구현하면 한쪽만 고치고 다른 쪽을 빠뜨리는 사고가 나기 쉽다. 이 프로젝트에 React 컴포넌트 테스트 프레임워크(vitest/RTL 등)가 없어서, Apps Script 트리거 생명주기를 in-memory mock으로 격리 테스트했던 것과 같은 패턴으로 `scripts/test-realtime-subscription-lifecycle.ts`가 mock Supabase 클라이언트로 mount/unmount/빠른 재진입/다중 mount-unmount/동시 구독을 검증한다(19/19 PASS) — Apps Script(.gs)와 달리 순수 TS라 복제본이 아니라 실제 프로덕션 코드를 그대로 import해서 테스트한다.
- **debounce/coalesce는 `src/lib/realtime/debounce.ts`의 단순 trailing-edge 타이머(`createDebouncer`, 600ms) 하나로 구현했다.** 과도한 Queue/버퍼링 시스템을 만들지 않았다 — `RealtimeUpdateBanner`와 Bottom Nav 뱃지 둘 다 이걸 재사용한다. `scripts/test-realtime-debounce.ts`(6/6 PASS)로 격리 검증.
- **Bottom Nav 공지 미확인 뱃지를 실시간화**했다(`src/components/bottom-nav.tsx` + `/api/notices/unread-count`). 페이지 이동 없이도 `notices` INSERT/UPDATE를 구독해 뱃지를 갱신하되, Realtime payload로 "이 공지가 나에게 해당하는지"를 직접 판단하지 않는다 — 이벤트는 "다시 조회해볼 시점" 신호로만 쓰고, 실제 카운트는 항상 세션 쿠키 기반(RLS 적용) API로 재계산한다. 페이지 이동 시에는 기존처럼 Layout의 SSR 재계산 값이 우선한다(prop이 바뀌면 렌더링 중에 상태를 맞추는 React 공식 패턴 사용 — effect 안에서 setState하면 `react-hooks/set-state-in-effect` 린트가 캐스케이딩 리렌더를 경고한다).
- ⚠️ **`sync_logs.updated_count`는 `promotions` 행 변경만 집계하고 `event_campaigns` 메타데이터(종료일 등) 변경은 집계하지 않는다.** 실 Google Sheet E2E 중 행사 캠페인 종료일만 바꾼 Sync가 `updated_count: 0`으로 기록돼 처음엔 "반영 안 됐나?" 헷갈렸다 — 실제로는 `event_campaigns.updated_at`/`end_at`에는 정상 반영돼 있었다. **앞으로 "0건"이라는 카운트만 보고 "아무 것도 안 바뀌었다"고 판단하지 않는다** — 그 카운트가 정확히 무엇을 세는지 먼저 확인한다.
- ⚠️ **[Phase 14 QA 재확인 항목] 오래 유지된 브라우저 탭에서 재로그인을 여러 번 반복하면 세션 쿠키가 일시적으로 꼬여 Server Component 렌더링이 `42501`(Postgres insufficient_privilege)로 실패하는 사례를 2026-09-17 Phase 10 E2E 중 1회 관측했다.** 같은 사용자·같은 작업을 Service Role이 아닌 동일 사용자의 별도 세션 스크립트로 재현했을 때는 즉시 성공했고, 브라우저에서도 재로그인 한 번으로 재현이 사라졌다 — RLS/GRANT 문제가 아니라 그 탭의 쿠키 세션 자체가 일시적으로 깨졌던 것으로 결론지었다(Phase 10 코드가 원인이 아님을 대조 재현으로 확인). **근본 원인은 아직 규명되지 않았다** — Phase 14(QA)에서 세션/쿠키 갱신 경로(`src/lib/supabase/proxy.ts`의 `updateSession`, Supabase 세션 refresh 주기)를 재조사해 재현 조건을 좁힐 것. 그 전까지는 재발 시 재로그인으로 우선 배제해본다.
- **실 Google Sheet E2E 전부 통과(2026-09-17)**: 상시 프로모션 카드가 변경(카드가+현금가 동시 변경, Sheet 수식 연동분 포함) 1행, 사은품 변경(관련 없는 다른 상품 동시 변경 → detail 페이지 filter 정확성 확인) 2행, 행사 종료일 변경(같은 캠페인 16개 행 동시 변경 → 배너 1회, 캠페인 중복 생성 없음, `event_campaign_products` 16건 연결 유지) — 전부 Sheet 편집 → onEdit → Sync → Realtime → Banner → 새로고침 → 최신값까지 실측 확인. 공지도 ADMIN UI로 실제 생성해 Bottom Nav 뱃지 실시간 갱신 + read/confirm 플로우까지 검증 완료.
- **원칙 재확인**: 실 데이터(Sheet/Supabase business row)를 흔드는 검증은 사용자가 직접 Sheet/Admin UI로 수행하고, Claude는 Service Role로 실 promotion/notice row를 절대 직접 수정하지 않는다(2026-09-11 대량 비활성화 사고 이후 확립된 원칙의 연장). 이번 Phase 10 E2E에서 유일한 예외는 Claude 자신이 검증용으로 만든 DEV Fixture 공지 1건을 정확히 그 id로만 지운 것뿐이다.

## Phase 11 완료 (2026-09-18) — Web Push(VAPID) + Notification Center, 실 iPhone PWA E2E 검증

- **VAPID 키는 코드/로그/문서에 값을 남기지 않고 생성했다.** `web-push`의 `generateVAPIDKeys()`를 1회성 스크립트로 실행해 결과를 `.env.local`에 직접 파일 쓰기로 기록하고, 스크립트는 즉시 삭제했다 — stdout에는 길이(87자/43자)만 출력하고 값 자체는 한 번도 출력하지 않았다. **앞으로 이런 신규 Secret 생성이 필요하면 항상 이 패턴(직접 파일 기록 + 길이만 로그)을 따른다 — 채팅에 값이 남으면 그 자체로 노출이다.**
- ⚠️→정정: `.env.local`에 새 `NEXT_PUBLIC_*` 값을 추가한 뒤 **dev server 재시작이 반드시 필요할 거라 예상했으나, 실측 결과 Turbopack dev 서버는 재시작 없이도 해당 청크를 요청 시점에 재컴파일해 새 값을 반영했다**(직접 번들 소스를 fetch해 새 VAPID Public Key가 인라인된 것을 확인). **추측하지 말고 항상 실제로 확인한다는 원칙이 여기서도 맞아떨어졌다** — "당연히 재시작이 필요할 것"이라는 가정도 검증 없이 사용자에게 전달할 뻔했다.
- **`public/sw.js`(Service Worker)는 `NODE_ENV === "production"`일 때만 등록된다**(`src/app/register-sw.tsx`, Phase 4 결정 — dev의 HMR과 충돌 방지). 즉 **Push 구독/실제 Push 수신은 `npm run dev`로는 테스트할 수 없고 `npm run build && npm run start`(production 모드)가 필요하다.** 이 프로덕션 서버는 dev server와 별개 프로세스/포트로 띄워야 사용자가 진행 중인 dev 작업을 방해하지 않는다.
- ⚠️ **Web Push(Service Worker)는 secure context(HTTPS)가 필요하다 — `localhost`는 예외지만, 휴대폰에서 접속하려면 로컬 IP만으로는 안 된다.** 실 Device E2E는 Vercel 배포 또는 ngrok 같은 HTTPS 터널이 필요하다(Apps Script onEdit 연동에 이미 ngrok을 쓰고 있으므로 같은 방식 재사용 가능) — 사용자에게 이 전제조건을 먼저 안내했다.
- **`Notification.permission`에는 표준 change 이벤트가 없다.** 권한 상태(`unsupported`/`ios_not_installed`/`not_requested`/`granted`/`denied`)를 컴포넌트 마운트 시 읽어야 하는데, `useEffect`+`setState`로 하면 `react-hooks/set-state-in-effect` 린트가 "매 마운트마다 렌더가 한 번 더 발생"한다고 경고한다(Phase 10의 Bottom Nav 뱃지 때와 같은 종류의 경고). 이번엔 prop 변화가 아니라 "브라우저 전용 값의 최초 읽기 + SSR-safe placeholder"였으므로, prop 비교 patch 패턴 대신 **`useSyncExternalStore(subscribeNoop, detectPushSupportStatus, () => "checking")`**를 썼다 — React가 정확히 이 "서버 placeholder → 클라이언트 실제 값" 전환을 위해 제공하는 API라 hydration mismatch 없이 안전하다. **앞으로 "브라우저 전용 API를 마운트 시 한 번만 읽어야 하는" 경우는 useEffect가 아니라 useSyncExternalStore(구독할 이벤트가 없으면 빈 unsubscribe)를 먼저 고려한다.**
- **Batching Window를 별도 타이머 큐로 만들지 않았다** — Apps Script의 onEdit이 이미 3초 디바운스로 여러 Row 편집을 한 번의 Sync 호출로 묶어 보내므로(Phase 6 설계), "이번 Sync 1회가 만든 `promotion_change_logs` 집합"을 그대로 Push Batching Window로 재사용했다(`src/lib/push/process-promotion-changes.ts`, Sync Route Handler가 성공 응답 후 `next/server`의 `after()`로 best-effort 호출). Phase 10이 Realtime debounce에서 확립한 "간단한 구조 재사용" 원칙과 같은 결정이다.
- **Vercel 같은 서버리스 환경에서 응답을 보낸 뒤 fire-and-forget으로 던진 Promise는 완료를 보장받지 못한다** — 함수가 응답 직후 바로 종료(freeze)될 수 있다. `next/server`의 **`after()`**(Next 15+ 공식 API, Route Handler/Server Function 어디서나 사용 가능, `redirect()`가 호출돼도 실행 보장)로 Push 처리 후속 작업을 감쌌다 — Sync API 응답/공지 등록 자체의 성공 여부에는 전혀 영향 주지 않으면서도 서버리스 환경에서 실제로 끝까지 실행되도록 보장한다.
- **테스트가 `"server-only"`를 import하는 모듈을 plain `tsx` 스크립트에서 직접 import하면 즉시 throw한다**(webpack 번들러의 poison-pill 메커니즘이 아니라 패키지 자체가 무조건 throw하는 방식이라, Node에서 바로 실행하면 걸린다 — Phase 10의 `RealtimeUpdateBanner` 때는 이 문제가 없었는데, 그 모듈엔애초에 `"server-only"`가 없었기 때문이었다). Batching 판정(`partitionByImportance`)과 오류 분류(`classifyPushSendError`) 로직을 `"server-only"` 없는 별도 순수 모듈(`src/lib/push/batch.ts`, `classify-error.ts`)로 분리해 실제 서버 코드(`process-promotion-changes.ts`, `send.ts`)가 이걸 re-export하는 방식으로 격리 테스트 가능하게 만들었다. **앞으로 "server-only" 모듈 안의 로직을 스크립트로 테스트해야 하면, 그 부분만 server-only 없는 형제 모듈로 미리 분리해둔다.**
- **Push 발송 "API" 자체는 존재하지 않는다** — `src/lib/push/*`는 어떤 Route Handler로도 노출되지 않고, Sync Route(성공 후 `after()`)와 공지 생성 Server Action(성공 후 `after()`)에서만 import된다. §19 "STAFF가 Push 발송 API를 직접 호출할 수 없어야 한다"를 "그런 API 자체가 없다"로 가장 강하게 만족시켰다 — 동시에 `notifications`/`notification_targets`/`notification_deliveries`에 authenticated용 INSERT 정책을 아예 만들지 않아 DB 레벨에서도 이중으로 막혀 있음을 실측 확인(`test:push-send-authorization` 7/7 PASS).
- **실 Device E2E를 위해 프로덕션 빌드를 dev server(3000)와 별개 포트(3001)로 띄우고, 사용자가 Apps Script onEdit용으로 이미 쓰고 있던 고정 ngrok 도메인(`henchman-thickness-serpent.ngrok-free.dev`)을 사용자 승인 하에 일시적으로 3000→3001로 재지정했다.** ngrok 무료 플랜은 동시 터널 1개 제한이라 별도 터널을 새로 열 수 없었다 — 기존 터널 프로세스를 정확히 찾아(`Get-CimInstance Win32_Process`로 커맨드라인 확인) 그 프로세스만 종료 후 동일 `--url` 플래그로 3001을 가리키도록 재기동했다. dev server(3000) 자체는 전혀 건드리지 않았다. **Windows에서 백그라운드로 띄운 `next start`를 `TaskStop`으로 정리해도 실제 리스닝 프로세스가 곧바로 안 죽는 경우가 있었다** — `netstat -ano`로 포트를 쥔 PID를 직접 확인해 `Stop-Process -Force`로 재차 정리해야 재기동이 성공했다(2회 반복 발생, 재현성 있는 패턴으로 기록).
- ⚠️ **[실사고, 수정 완료] `promotion_field_definitions.display_label`은 Core Field의 경우 Sheet 헤더 원문("최종 판매가 (카드결제)")을 그대로 담고 있다 — 상품 상세 화면(`price-block.tsx`)은 이 값을 안 쓰고 자체적으로 짧은 라벨("카드판매가" 등)을 하드코딩한다는 사실을 놓쳤다.** 실 iPhone Push로 "최종 판매가 (카드결제)이(가) 변경되었습니다."가 그대로 발송되는 걸 실측 후 발견 — `promotion_field_definitions`를 참조하는 새 기능을 만들 때 "표시용 라벨이 필요하면 이 테이블의 `display_label`이 당연히 UI 친화적일 것"이라고 가정했던 게 틀렸다. `src/lib/push/policy.ts`에 Core Field 전용 짧은 라벨 매핑(`CORE_FIELD_SHORT_LABEL`, `price-block.tsx`/`DetailRow`와 동일한 용어)을 추가하고, Dynamic Field 등 매핑에 없는 것만 `display_label`로 폴백하도록 고쳤다. **앞으로 `promotion_field_definitions.display_label`을 새 화면/알림에 쓸 때는 그 값이 Sheet 헤더 원문일 수 있다는 걸 전제하고, 사람이 읽을 최종 텍스트(Push, UI)는 항상 실제 렌더링 결과로 확인한다.**
- ⚠️ **[실사고, 수정 완료] "important 변경은 전부 Summary로 묶는다"를 문자 그대로 구현했다가, 상품 1개만 바뀌어도 상품명 없는 일반 문구("OO, 1개 상품의 정보가 변경되었습니다.")가 나가는 걸 실 iPhone에서 발견했다** — §10 예시("[가격 변경] 리안 플릭...")는 애초에 "1개 상품만 바뀌면 그 상품을 지목하는 개별 알림"을 기대하는 문구였다. `groupByPromotionId`/`shouldSendImportantAsSummary`(`src/lib/push/batch.ts`)를 추가해 "이번 배치에 서로 다른 상품이 2개 이상 섞였을 때만" Summary로 묶고, 상품 1개(그 상품의 필드가 여러 개 동시에 바뀌어도 "상품 1개")면 §10 형식의 개별 알림+해당 상품 딥링크로 보낸다. **"다건이면 묶는다"는 요구사항을 "이번에 건드린 change_log 개수"가 아니라 "이번에 건드린 대상(상품) 개수"로 해석해야 한다는 걸 실측 후에 알았다 — 요구사항의 "건"이 로그 건수인지 대상 건수인지 헷갈리면 항상 예시 문구를 기준으로 재확인한다.**
- ⚠️ **[Phase 14 QA 재확인 항목, 42501과 같은 계열] 실 iPhone PWA에서 Push(필독공지) 탭 → 상세 진입까지는 정상이었는데, 그 방문에서 `markNoticeRead`가 DB에 전혀 기록되지 않은 사례를 1회 관측했다(2026-09-18).** 증거: Push 발송 02:11:40 vs 실제 `notice_reads.read_at`이 생긴 시점은 그로부터 1시간 47분 뒤(Claude가 PC로 직접 방문했을 때) — 그 사이 사용자의 iPhone 방문으로는 행 자체가 안 생겼다. `[확인 완료]` 버튼이 "동작 안 함"으로 보인 건 실은 버튼/Server Action 문제가 아니라 이 앞 단계(읽음 기록 누락)의 결과였다 — `confirmNotice()`는 대상 행이 없으면 에러 없이 0건 처리되는 게 원래 설계다(Phase 6.5 확립). **범위 분리 재현으로 PC+ngrok Production은 100% 정상(같은 서버·같은 DB·같은 RLS)임을 먼저 확인**했고, 그다음 **새 테스트 공지 1건으로 iPhone 최초 진입만 다시 검증하자 이번엔 `read_at`이 정상 생성됐다** — 1회성이라 재현 조건을 못 좁혔다. Service Worker의 fetch 핸들러는 POST/Server Action에 전혀 관여하지 않음을 코드로 재확인했으므로 SW 캐싱이 원인은 아니다. **코드는 변경하지 않았다** — 원인 불명 상태에서 Notice/RLS를 임의로 재설계하지 않는다는 원칙을 지켰다. Phase 14에서 재발 시, 이 케이스와 기존 `42501` 케이스를 같은 계열(백그라운드→포그라운드 전환 직후 첫 요청에서의 세션/쿠키 타이밍)로 묶어서 조사할 것.
- **실 iPhone PWA E2E 전부 통과(2026-09-18)**: 홈 화면 설치 → 로그인 → 알림 받기(OS 권한 허용) → Subscription 생성(`web.push.apple.com` endpoint 실측 확인) → Background 전환 → 실 DEV Sheet 가격 변경 → Lock Screen Push 수신 → 탭 → 상품 상세 딥링크 정상 → 로그인 유지 확인. 공지 Push(필독)도 ADMIN UI로 실제 생성해 수신·딥링크·재검증된 read/confirm 흐름까지 확인. 알림 해제(`push_subscriptions` 행 삭제) → 재활성화(새 endpoint 재구독)까지 실측 확인. iOS Safari PWA만 실기기 검증했고, Android Chrome PWA는 자동 테스트/코드 수준에서만 커버됨(§22 인정 범위).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
