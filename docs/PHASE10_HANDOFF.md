# Phase 10 개발 인수인계 문서 (Realtime)

> **이 문서의 목적**: 현재 대화의 컨텍스트 윈도우가 가득 차서, 새로운 Claude Code 채팅에서 Phase 10(Realtime)을 이어서 진행한다. 이 문서 하나만 읽으면 Phase 0~9의 설계 결정과 Phase 10의 실제 구현 상태(전부 미커밋)를 잃지 않고 정확히 이어서 작업할 수 있도록 작성했다.
>
> **작성 방식**: 이전 대화의 기억을 요약한 것이 아니다. 아래 "1. 재조사 소스"에 나열한 실제 코드/문서/migration/git 이력/테스트 스위트/DEV Supabase(읽기 전용)를 **2026-09-17에 직접 다시 읽고 재실행**해 검증한 결과다. **이 문서를 작성하는 동안 Production/DEV의 Promotion·Notice·Sync 데이터는 단 하나도 수정하지 않았다** — 실행한 것은 `git status`/`git log`/`Read`/`typecheck`/`lint`, DEV Supabase에 대한 SELECT 전용 조회, 그리고 이미 안전성이 검증되어 있고 종료 시 스스로 원상복구하는 기존 RLS 테스트 스크립트(`npm run test:*-rls`)뿐이다. 새 Phase 10 코드는 이 문서 작성 과정에서 한 줄도 추가/수정하지 않았다.

---

## 1. 이 문서 작성을 위해 직접 재조사한 소스

- `/CLAUDE.md` 전문 재확인(절대 원칙 13개 + Phase 6/6.5/onEdit/Phase 9/Phase 10 전체 lessons-learned 로그)
- `docs/PHASE7_HANDOFF.md`(전문), `docs/product-requirements.md`, `docs/architecture.md`, `docs/database-schema.md`, `docs/permissions.md`, `docs/sync-design.md`, `docs/push-design.md` (전부 전문 재확인)
- `supabase/migrations/` 27개 파일 전체 목록 재확인 + Phase 9/10 신규 2개 파일(`20260917200000_notice_type_education.sql`, `20260917300000_realtime_publication.sql`) 전문 재확인
- `src/components/realtime/realtime-update-banner.tsx`(Realtime 유일 컴포넌트) 전문 재확인
- `scripts/test-realtime-rls.ts` 전문 재확인 + **재실행**
- Realtime을 wiring한 6개 페이지 전부 전문 재확인: `src/app/(staff)/page.tsx`, `promotions/page.tsx`, `promotions/[productId]/page.tsx`, `promotions/events/[campaignId]/page.tsx`, `notices/page.tsx`, `notices/[id]/page.tsx`
- `src/app/(staff)/layout.tsx`(Bottom Nav 뱃지 카운트 계산 위치 확인), `src/components/bottom-nav.tsx`(4탭 확정, 교육자료 탭 제거 확인)
- `src/lib/notices/queries.ts` 전문 재확인(교육 유형 반영 여부)
- `src/proxy.ts`(`/api/*` 세션 리다이렉트 제외 여전히 유효한지 확인)
- `package.json` 전문(scripts 목록)
- `git status`, `git log --oneline --all`, `git branch --show-current`, `git rev-parse HEAD`, `git diff --stat`
- **`npm run typecheck`, `npm run lint` 재실행** — 이 문서 작성 시점 기준 최신 결과
- **RLS/Realtime 테스트 스위트 재실행**(DEV DB 대상, 읽기+자체 정리되는 계정/스크립트만 사용): `test:realtime-rls`, `test:notice-rls`, `test:rls`, `test:promotion-rls`
- **DEV Supabase 읽기 전용 조회**(Service Role Key로 SELECT만, 임시 스크립트를 실행 직후 삭제): `promotions`/`event_campaigns`/`event_campaigns_visible`/`notices`/`profiles`/`stores`/`attachments`/`sync_logs`/`promotion_sync_state` 최신 값

### 문서상 실제와 다른 점(발견된 불일치)

없음. Phase 7 핸드오프가 지적했던 `docs/deployment.md` 부재는 여전히 유효(별도 파일 없음, `architecture.md` §8에만 간략 기술). 그 외 모든 문서/코드/migration은 실제 저장소 상태와 정확히 일치했다.

---

## 2. Git 상태 (2026-09-17, 이 문서 작성 직전 재확인 — 추정 아님)

```
branch: master
HEAD:   84cfdabe0e6400996792db2a053e80fcb2f5113d  ("Phase 8 complete: notice system verified")
working tree: NOT clean — Phase 9 SKIP 작업 + Phase 10 Realtime 작업이 전부 미커밋 상태로 존재
```

**알려진 checkpoint 커밋 (전부 `git log --oneline --all`로 직접 재확인, 사용자가 알고 있는 해시와 정확히 일치, 추가/누락 없음):**

| 커밋 | 내용 |
|---|---|
| `464703a` | Phase 5: auth authorization and RLS verified |
| `a4f41fb` | Phase 6 checkpoint: promotion schema + sync engine (Sheet↔Apps Script E2E pending) |
| `ec63965` | Phase 6.5: harden sync safety guards |
| `f4f7906` | Phase 6.5: sync_logs audit columns (sync_mode/received_row_count) + onEdit trigger |
| `591adf1` | Phase 6 complete: Google Sheet sync verified |
| `d0d5ae1` | docs: add Phase 7 handoff document |
| `affd020` | Phase 7 complete: promotion UI verified |
| `84cfdab` | Phase 8 complete: notice system verified **(현재 HEAD)** |

**현재 uncommitted 변경사항** (`git status --short`, `git diff --stat` 재확인):

Modified (Phase 9 SKIP + Phase 10 wiring 혼재):
```
CLAUDE.md · docs/architecture.md · docs/database-schema.md · docs/permissions.md
docs/product-requirements.md · docs/push-design.md · package.json
src/app/(staff)/layout.tsx · src/app/(staff)/notices/[id]/page.tsx
src/app/(staff)/notices/page.tsx · src/app/(staff)/page.tsx
src/app/(staff)/promotions/[productId]/page.tsx
src/app/(staff)/promotions/events/[campaignId]/page.tsx
src/app/(staff)/promotions/page.tsx · src/app/layout.tsx · src/app/manifest.ts
src/components/admin/notice-form.tsx · src/components/bottom-nav.tsx
src/lib/notices/queries.ts · src/types/database.ts
```
Deleted: `src/app/(staff)/training/page.tsx` (Phase 9 SKIP)

Untracked (신규 파일, 전부 Git에 아직 추가 안 됨):
```
scripts/test-realtime-rls.ts
src/components/realtime/  (realtime-update-banner.tsx 1개 파일)
supabase/migrations/20260917200000_notice_type_education.sql
supabase/migrations/20260917300000_realtime_publication.sql
```

**두 Phase(9 SKIP, 10 Realtime)가 하나의 diff에 섞여 있다** — 아직 어느 것도 커밋되지 않았다. 커밋 시점에 이 둘을 한 커밋으로 묶을지 나눌지는 §24 참조(실행은 사용자 승인 필요).

`npm run typecheck` / `npm run lint` 둘 다 이 문서 작성 직전 **재실행하여 에러 0건**(clean) 확인했다.

---

## 3. 프로젝트 성격 (반드시 먼저 이해할 것)

- **Demo가 아니라 링크맘 본사/매장 직원이 매일 쓰는 Production 내부 업무 시스템**이다(CLAUDE.md 절대 원칙 1).
- Native App이 아니다. **Mobile First Responsive PWA**. 직원 화면(STAFF/STORE_MANAGER)은 Mobile First, 관리자 화면(ADMIN)은 Desktop First.
- Role 3종: `ADMIN`(본사 관리자) / `STORE_MANAGER`(현재 STAFF와 완전 동일 취급, Phase 6.5에서 예외 폐기) / `STAFF`(매장 직원).
- 매장은 현재 **용인본점(code: HQ), 동백점(code: DONGBAEK)** 2곳, 향후 추가 예정 — 코드/RLS/Push·Notice Targeting 어디에도 매장명·매장 개수를 하드코딩하지 않는다.
- Google Spreadsheet가 프로모션 데이터의 **유일한 Source of Truth**이며 Sync는 **One-way(Sheet → Supabase)**만 존재한다.

---

## 4. 최종 아키텍처 (Phase 10 반영)

```
[Google Spreadsheet] (Source of Truth)
   ├─ [상시 프로모션] (permanent) ── [행사 프로모션] (event, 행사명/시작일/종료일/노출여부 신설됨)
          │ onEdit(3초 디바운스, partial) + syncAll(10분, full_snapshot)
          ▼
[Google Apps Script] (apps-script/Sync.gs) — Bearer(SYNC_API_SECRET), 재시도/백오프, product_id 되쓰기
          │ HTTPS POST
          ▼
[Next.js API Route] /api/sync/permanent , /api/sync/event
   src/proxy.ts(/api/* 세션 리다이렉트 제외) → authenticate.ts → validate-request.ts(zod)
   → engine.ts(Header 매핑/Upsert/Change 감지/Safety Guard/product_id 채번/sync_logs)
   → Service Role Key(server-only)로만 RLS 우회
          ▼
[Supabase PostgreSQL] (RLS + Server-side Authorization 이중 방어)
   promotions / promotion_field_definitions / promotion_change_logs
   event_campaigns / event_campaign_products (+ event_campaigns_visible, security_invoker=on)
   notices / notice_targets / notice_reads / attachments (+ notice-attachments Storage, private)
   promotion_sync_state / sync_logs
          │
          ├──────────────────────────────┐
          ▼ (Phase 7/8에서 읽기)          ▼ (Phase 10 신규, 2026-09-17)
   [Next.js App Router UI]         [Supabase Realtime — postgres_changes]
   직원: 홈/프로모션/공지/MY         publication: promotions, event_campaigns, notices만
   관리자: 사용자/매장/공지/            (RLS 그대로 적용됨 — 실측 확인, §9 참조)
   프로모션/행사/Field/Push/Audit         │
                                          ▼
                              RealtimeUpdateBanner(Client Component)
                              "새 정보 있음" 배너만 표시(자동 리렌더/스크롤 리셋 없음)
                                          │ 사용자가 [새로고침] 클릭
                                          ▼
                              router.refresh() → 서버가 RLS 그대로 재조회
```

일반 클라이언트는 `src/lib/supabase/client.ts`(Publishable Key), Server Component는 `src/lib/supabase/server.ts`(세션 쿠키), 특권 작업은 `src/lib/supabase/service-role.ts`(`server-only`)만 사용 — Phase 10에서 이 구조를 전혀 바꾸지 않았다.

상세: [architecture.md](./architecture.md) §5.5, [database-schema.md](./database-schema.md)

---

## 5. Phase 0~6 완료 상태 요약 (Sync/DB — Phase 10은 여기를 재설계하지 않는다)

**완료됨, 실 데이터로 검증됨, Phase 10에서 손댈 필요 없음:**

- **Multi-sheet Sync**: `[상시 프로모션]`(permanent, 188건 실사용)과 `[행사 프로모션]`(event, 16건)은 별개 Source Sheet, `promotion_type`으로 항상 구분. 사은품 컬럼명이 다름(`증정사은품` vs `행사 사은품`)을 Sync 매핑에서 `gift`로 통합.
- **product_id 자동 채번**: 담당자는 시트에 값을 입력하지 않는다. `next_product_id()` Sequence로 서버가 `PROD-000NNN` 채번 후 Apps Script가 셀에 되쓴다(Write-back은 이 컬럼 1개에만 한정).
- **Core Field vs Dynamic Field**: 알려진 Header는 `promotions`의 Core 컬럼에, 모르는 Header는 `promotion_field_definitions`에 자동 등록(Safe Default: 표시 ON/검색·필터·NEW·Push OFF) 후 `promotions.extra_fields`(JSONB)에 저장 — 재배포 불필요.
- **`sync_mode`(partial/full_snapshot)**: 기본값 `partial`에서는 Soft Delete(비활성화) 로직 자체가 실행되지 않는다. Apps Script의 정상 전체 Sheet Sync만 `full_snapshot`을 보내며, 그때만 §6의 안전장치를 통과해야 비활성화가 실행된다.
- **onEdit 즉시 반영**: 설치형 onEdit 트리거 → 3초 고정 윈도우 디바운스(순수 debounce 아님) → `flushPendingSync` → partial Sync. 10분 `syncAll`이 Safety Net(full_snapshot). pending은 API가 실제 2xx 성공했을 때만 삭제, 실패는 사유별로 재시도/포기 분류.
- **`promotion_sync_state`**: Sheet 타입별 "최초 Import 완료 여부"를 영구 기록(Row 존재 여부로 판단하지 않음 — Hard Delete에 취약했던 과거 설계를 교체).
- **Change Classification**: `promotion_field_definitions.change_importance`/`push_enabled`를 NEW 판정과 Push 판정이 **동일하게** 참조(§7 참조).
- **NEW 72h Rolling**: 최근 72시간 내 신규 상품 또는 중요 변경(가격/프로모션/혜택/사은품/행사기간/판매조건)만 NEW. minor(공백/오타/타임스탬프)는 제외.
- **Event Visibility**: `event_campaigns_visible` View(`security_invoker=on`)가 매 조회 시 시간 조건을 재계산(§8 참조).
- **RLS**: 전 테이블 RLS ON, `anon`은 SELECT만, Sync 쓰기는 Service Role 전용.
- **`sync_logs`**: `sync_mode`/`received_row_count`/`skipped_count`/`skipped_detail` 감사 컬럼 포함.

**⚠️ Phase 10은 위 항목을 재설계하지 않는다 — 재설계가 필요해 보이면 먼저 사용자에게 보고하고 승인받는다(§23 참조).**

상세: [sync-design.md](./sync-design.md), [database-schema.md](./database-schema.md), [docs/PHASE7_HANDOFF.md](./PHASE7_HANDOFF.md) §6~§13(더 상세한 사고 경위 포함)

---

## 6. Phase 6 대량 비활성화 안전장치 상세 (재확인)

- **사고(2026-09-11)**: 안전장치 없이 1건짜리 테스트 payload를 실 API에 보냈다가, "이번 Sync에 없는 기존 product_id는 무조건 비활성화"하던 로직이 실 데이터 188건 중 187건을 그 자리에서 `is_active=false`로 만들었다. 즉시 발견해 전량 복구.
- **`partial`(기본값)**: Soft Delete 로직 자체를 실행하지 않음 — 어떤 payload를 보내도 누락 상품을 건드릴 수 없음.
- **`full_snapshot`**: Apps Script의 정상 전체 Sheet Sync만 사용. 아래를 모두 통과해야 비활성화 실행:
  1. Row parse 성공 여부(파싱/검증 실패가 하나라도 있으면 payload를 전체로 신뢰 안 함)
  2. 누락 비율 50% 초과 또는 누락 절대값 50건 초과 시 중단(`SYNC_DEACTIVATION_MAX_RATIO`/`SYNC_DEACTIVATION_MAX_ABSOLUTE` 환경변수로 조정)
- 하나라도 걸리면 비활성화를 전혀 실행하지 않고 Sync 자체를 실패(`success:false`, HTTP 409)로 기록한다 — 일부만 처리하고 조용히 성공 보고하지 않는다.
- **트리거 생명주기(2026-09-16 자가 치유 로직)**: 평상시 `handleEditTrigger` 1개 + `syncAll` 1개(둘 다 지속) + `flushPendingSync` 0개. Property 플래그가 아니라 `ScriptApp.getProjectTriggers()`로 실제 트리거 존재 여부를 직접 확인.

상세: [sync-design.md](./sync-design.md) §10~§11

---

## 7. NEW / Change Classification 규칙 (재확인, Phase 10에서 재사용만 함)

| 변경 필드 | importance | NEW | Push |
|---|---|---|---|
| 소비자가/기준판매가/카드결제가/현금이체가 | important | O | O |
| 프로모션/매장프로모션/판매조건 | important | O | O |
| 기본구성품/증정사은품/행사사은품 | important | O | O |
| 행사기간 | important | O | O |
| 긴급 판매조건 변경 | critical | O | 즉시(Batch 제외) |
| 공백/오타/표기정리/내부관리 필드/타임스탬프만 | minor | X | X |

NEW 판정과 Push 판정은 `promotion_field_definitions.change_importance`/`push_enabled`를 **동일하게** 참조한다(CLAUDE.md 절대 원칙 7, 별도 로직 금지). Phase 10의 Realtime 배너는 이 분류와 **무관**하게 동작한다 — "무언가 바뀌었다"는 신호만 주고 무엇이 바뀌었는지는 판단하지 않는다(의도적 설계, §14 참조).

---

## 8. Event Visibility 규칙 (재확인)

| 노출여부 | 기간 조건 | 결과 |
|---|---|---|
| OFF | 무관 | 비노출(데이터 보존) |
| ON | 시작일 ≤ 오늘 ≤ 종료일 | **노출** |
| ON | 시작 전 | 비노출 |
| ON | 종료일 경과 | **자동 비노출**(담당자가 OFF 깜빡해도 안전) |
| ON | 재연장(종료일을 미래로 다시 수정) | 다시 노출로 전환(뷰가 매번 재계산하므로 별도 처리 불필요) |

```sql
create view public.event_campaigns_visible as
select * from public.event_campaigns
where is_visible = true and start_at is not null and end_at is not null
  and now() between start_at and end_at;
```

- 이 View는 `security_invoker = on` 필수(§13 사고 참조) — 없으면 View Owner 권한으로 실행되어 RLS를 우회한다.
- **ADMIN**: 비활성/비노출/예정/종료 전부 조회 가능. **STAFF/STORE_MANAGER**: `permanent`는 `is_active=true`만, `event`는 소속 캠페인이 지금 이 순간 실제로 노출 중일 때만(RLS 차단, 단순 UI 숨김 아님).
- Phase 10 Realtime의 `event_campaigns` watch는 `UPDATE`만 구독한다(예: campaign 상세 페이지) — 노출 여부 재계산 자체는 여전히 조회 시점 View가 담당하며, Realtime은 "다시 조회해볼 시점"을 알려줄 뿐이다.

---

## 9. Timestamp 비교 버그 교훈 (재확인 — Phase 10 코드에도 적용됨)

**사고(2026-09-16)**: `event_campaigns` 변경 감지가 `start_at`/`end_at`을 문자열로 비교(`prior.start_at !== startAt`)해, Supabase가 돌려주는 `"+00:00"` 표현과 새로 계산한 `".000Z"` 표현이 같은 시각인데도 "변경됨"으로 오판 — 4일간 143건의 불필요한 로그가 쌓였다(139건 정리 완료).

**수정**: `src/lib/sync/timestamps.ts`의 `timestampsEqual()`(epoch 비교)로 교체.

**일반화된 교훈**: DB에서 온 timestamptz 값과 애플리케이션이 새로 계산한 timestamp는 **절대 문자열로 비교하지 않는다**. Phase 10에서도 이 패턴을 의식했다 — `RealtimeUpdateBanner`는 애초에 타임스탬프를 비교하는 로직 자체를 두지 않고(변경 여부 판단을 서버 재조회에 완전히 위임), payload 내용을 클라이언트에서 파싱/비교하지 않도록 설계했다. 이후 Realtime 관련 코드에 시각 비교 로직을 추가해야 한다면 이 사고를 반드시 참고할 것.

---

## 10. Phase 7 Promotion UI 완료 상태 (재확인, 커밋 `affd020`)

- **완료된 화면**: 홈(EventCampaignBanner+최근 72h 요약), 프로모션 목록(상시/행사/NEW 서브탭), 검색/브랜드 필터/정렬, 상품 상세, 행사 캠페인 상세, 변경 이력, Dynamic Field 렌더링.
- **카드 가격/정보 레이아웃**(사용자 지정 스펙으로 재디자인 완료): 라벨+색상 구분(소비자가=회색/작게, 기준판매가=검정, 카드결제가=빨강, 현금이체가=빨강, 전부 같은 크기), 기본구성품/증정사은품/포토후기는 값이 없으면 "없음" 표시, 비고는 값이 있을 때만 표시.
- **버그 수정**: 컬러 배지 React key 중복 경고 — Sheet 원본 데이터에 실제 중복 값이 있었던 것이 원인, `dedupeTrimmed()` 헬퍼로 해결(`src/lib/format.ts`). 이 함수는 Phase 10에서도 상품 상세 페이지 색상 배지에 그대로 재사용 중(§코드 확인).
- **⚠️ 확정 지시사항**: 이 카드/상세 UI를 Phase 10에서 불필요하게 재디자인하지 않는다 — 이번 재조사에서 실제 소스(`promotions/[productId]/page.tsx` 등)를 다시 읽어 확인한 결과 Phase 10 작업(Realtime 배너 삽입)은 각 페이지 최상단에 `<RealtimeUpdateBanner>` 한 줄만 추가했을 뿐, 카드/상세의 기존 레이아웃·필드 순서·색상 스킴은 전혀 건드리지 않았다.

상세: [PHASE7_HANDOFF.md](./PHASE7_HANDOFF.md)

---

## 11. Phase 8 Notice System 완료 상태 (재확인, 커밋 `84cfdab`)

- **스키마**: `notices`(+`external_link`, `author_name` 추가됨), `notice_targets`, `notice_reads`, 신규 `attachments`(owner_type polymorphic) + private Storage 버킷 `notice-attachments`(`public:false`, storage.objects 정책 0개 — 전부 Service Role 경유).
- **게시 기간**: `notice_visible_to_current_user()` 함수가 `published_at`/`expires_at` 체크를 타겟팅 체크와 함께 수행하도록 확장됨(SECURITY DEFINER).
- **UI/기능**: 유형별 배지, 필독→확인완료 플로우, 첨부파일(Signed URL 10분), 외부링크, ADMIN CRUD + 대상 지정(전체/매장/복수매장/Role/개인) + 열람·확인 현황(Audience Summary).
- **버그 수정**: "필독" 유형 공지에서 필독 배지가 두 번(유형 배지 + requires_confirmation 배지) 표시되던 문제 — `notice.notice_type !== "필독"` 가드 추가. 이번 재조사에서 `notices/[id]/page.tsx:51`에 이 가드가 여전히 존재함을 직접 확인했다.
- **현재 `notice_type` enum**: `일반`/`중요`/`긴급`/`필독`/`행사`/`발주`/`판매가변경`/`공급가변경`/`운영`/`시스템`/**`교육`**(Phase 9 SKIP으로 추가, 아래 참조).
- **Phase 9 흡수**: 교육 목적 공지는 별도 시스템 없이 이 Notice System을 그대로 쓴다(§12).

상세: [database-schema.md](./database-schema.md) §4, [permissions.md](./permissions.md), CLAUDE.md "Phase 9 SKIP 결정" 절

---

## 12. Phase 9 상태 — SKIPPED (2026-09-17 확정, 재확인)

- 별도 Training Material System(전용 테이블 4종/Admin UI)은 **구현하지 않는다.** 확정.
- Bottom Nav: `[홈][프로모션][공지][교육자료][MY]` 5탭 → **`[홈][프로모션][공지][MY]` 4탭**. `src/components/bottom-nav.tsx` 재확인 결과 `NAV_ITEMS`가 정확히 4개 항목이고 `BookIcon` 함수도 완전히 제거됨.
- `/training` Route 삭제됨(`src/app/(staff)/training/page.tsx` git status상 `D`로 확인).
- `notice_type`에 `교육` 추가(마이그레이션 적용 완료, DEV DB 반영 확인). 변경 중요도는 다른 정보성 유형과 동일하게 `normal`(내부 랭킹 기준, DB의 `change_importance`와는 별개 축 — 혼동 주의, `src/lib/notices/queries.ts`의 `IMPORTANCE_BY_TYPE`에서 확인).
- **문서 업데이트 완료**(재확인): CLAUDE.md, product-requirements.md(§3/§4.1/§4.5/§4.6/§4.7/§4.9/§8), database-schema.md(§4 경고), permissions.md(training_materials 섹션 재작성), push-design.md(§4/§7/§11) — 전부 "Phase 9 SKIP" 명시.
- ⚠️ **커밋 안 됨** — 위 모든 변경이 Phase 10 작업과 함께 현재 uncommitted 상태다(§2 참조).

---

## 13. Phase 10 현재 진행 상태 — 실제 코드에서 확인한 사실만 (추측 없음)

### 13.1 존재하는 Realtime 파일

- `src/components/realtime/realtime-update-banner.tsx` — 유일한 Realtime 컴포넌트. `"use client"`, `useEffect`+`useState`, `RealtimeWatch[]` 타입으로 감시 대상 테이블/이벤트/필터를 페이지별로 주입받는 범용 배너.
- `scripts/test-realtime-rls.ts` — RLS-over-Realtime 실측 검증 스크립트(4개 테스트, 아래 §17 참조).
- `supabase/migrations/20260917300000_realtime_publication.sql` — `supabase_realtime` publication에 `promotions`/`event_campaigns`/`notices` 3개 테이블만 추가.

### 13.2 배너가 실제로 연결된 페이지 (6곳, 전부 재확인)

| 페이지 | channelName | watches |
|---|---|---|
| `(staff)/page.tsx`(홈) | `home` | notices(*), promotions(*), event_campaigns(*) |
| `promotions/page.tsx`(목록) | `` promotions-list-${tab} `` | promotions(*), event_campaigns(*) |
| `promotions/[productId]/page.tsx`(상세) | `` promotion-detail-${promotion.id} `` | promotions(UPDATE, filter=id) |
| `promotions/events/[campaignId]/page.tsx`(캠페인 상세) | `` campaign-detail-${campaignId} `` | promotions(*), event_campaigns(UPDATE, filter=id) |
| `notices/page.tsx`(목록) | `notices-list` | notices(*) |
| `notices/[id]/page.tsx`(상세) | `` notice-detail-${notice.id} `` | notices(UPDATE, filter=id) |

### 13.3 확인된 미완료/미검증 항목 (추측이 아니라 코드를 직접 읽어 확인한 사실)

1. **Bottom Nav 미확인 공지 뱃지는 Realtime에 연결되어 있지 않다.** `src/app/(staff)/layout.tsx:23`에서 `getUnreadNoticeCount()`를 매 Server Component 렌더(=페이지 이동/새로고침) 시점에만 호출한다. 홈 화면 배너를 눌러 `router.refresh()`가 일어나면 레이아웃까지 다시 렌더되어 뱃지가 갱신되긴 하지만(레이아웃이 children을 감싸므로), **배너를 누르지 않고 방치 중**이면 다른 기기/관리자가 새 공지를 등록해도 뱃지 숫자는 절대 자동으로 바뀌지 않는다. 이 자체를 Realtime 구독으로 만들지, 아니면 "배너 클릭 시 갱신"으로 충분하다고 볼지는 Phase 10 남은 범위에서 결정할 사항이다.
2. **명시적인 debounce/coalescing 로직은 없다.** `RealtimeUpdateBanner`는 `setHasUpdate(true)`만 호출하는 단순 boolean 플래그라서, 첫 이벤트 이후 추가 이벤트가 와도 상태가 이미 `true`라 리렌더가 자연히 억제된다(값이 안 바뀌면 React가 재렌더하지 않음) — 결과적으로 "여러 이벤트 → 배너 1번 표시"는 되지만, 이것이 의도적으로 설계된 디바운스인지 우연한 부작용인지 코드에 명시돼 있지 않다. **다건 이벤트가 짧은 시간에 몰렸을 때의 동작을 별도로 스트레스 테스트한 적은 없다**(1~2개 이벤트로 수동 확인한 것이 전부).
3. **구독 생명주기의 정식 회귀 테스트 스크립트가 없다.** 브라우저 콘솔에서 컴포넌트 재마운트 시 `CLOSED → SUBSCRIBED` 쌍이 깨끗하게 나오는 것을 수동으로 확인했다는 기록(이전 세션)은 있지만, 빠른 라우트 전환/다중 탭에서 채널이 누적되지 않는지를 자동으로 검증하는 스크립트는 이 저장소에 존재하지 않는다(`scripts/` 디렉터리에 realtime 관련 파일은 `test-realtime-rls.ts` 하나뿐이며, 이는 RLS 검증이지 생명주기 검증이 아니다).
4. **Google Sheet를 통한 실제 E2E는 아직 한 번도 실행되지 않았다.** `test-realtime-rls.ts`와 이전 세션의 수동 검증은 전부 Service Role 클라이언트로 직접 UPDATE하거나 Admin UI를 통해 갱신한 것이며, 실제 Google Sheet를 수정해 Apps Script → Sync API → Supabase → Realtime → 브라우저 배너로 이어지는 전체 경로를 실측한 적이 없다.
5. **채널 이름에 `crypto.randomUUID()` 접미사를 쓰는 방식**(`realtime-update-banner.tsx:53`)이 "중복 구독 방지"라는 의도로 도입됐지만, 이로 인해 같은 페이지를 여러 탭에서 열었을 때 서버(Supabase Realtime) 쪽에 채널이 몇 개까지 늘어나는지, Realtime 연결 자체에 사실상 제한이 있는지는 별도로 확인한 적이 없다(현재 매장 수·동시 접속자 규모에서 문제가 될 가능성은 낮다고 판단되지만, 검증된 사실은 아니다).

**요약**: RLS 적용 여부·인증 타이밍 버그·기본 배너 UX는 실측 검증까지 끝났고 안정적이다. 남은 것은 "뱃지 실시간화 여부 결정", "다건 이벤트 스트레스 테스트", "구독 생명주기 자동 회귀 테스트", "Google Sheet 기반 진짜 E2E" 4가지다.

---

## 14. Phase 10 목표 (재확인, 변경 없음)

- promotions/event_campaigns/notices에 한해 Realtime 적용. **모든 테이블을 구독하지 않는다**(§13 SQL 주석에 명시).
- UX가 사용자를 놀라게 하거나 스크롤을 리셋하면 안 된다 — 배너 + 수동 새로고침을 우선한다(자동 병합/자동 리렌더 금지).
- 실제 Sheet/Admin 변경으로 브라우저 E2E 검증(Google Sheet 경로는 §13.3 항목 4로 아직 미완료).
- 중복 이벤트/메모리 누수/무한 리렌더/중복 구독이 없는지 확인(부분 확인됨, §13.3 항목 2·3 참조).
- "완료"로 보기 전에 전체 회귀 스위트(lint/typecheck/build + RLS 스위트 전부)를 통과시킨다.
- **Phase 11(Push)로 자동 진행하지 않는다.**

---

## 15. Realtime 보안 요구사항 (재확인 — 현재 구현이 이를 만족하는지 코드로 확인)

- **클라이언트에 Secret Key 노출 금지**: `realtime-update-banner.tsx`는 `createClient()`(publishable key 기반 브라우저 클라이언트)만 사용, Secret Key/Service Role Key를 import하지 않음 — 확인됨.
- **Publishable Key + 세션 기반**: `supabase.auth.getSession()` → `supabase.realtime.setAuth(session.access_token)` → `channel.subscribe()` 순서를 반드시 지킨다(§16 참조, 세션 없으면 setAuth를 건너뛰고 anon으로 구독 — 이 경우 RLS가 모든 행을 막아 사실상 아무 이벤트도 안 오는 안전한 실패 모드가 된다).
- **RLS 유지**: 새 정책을 추가하지 않았다 — 기존 테이블 RLS가 Realtime에도 그대로 적용됨을 실측 확인(§17).
- **새로고침 시 RLS 재적용**: `router.refresh()`는 Server Component를 다시 실행하므로 `src/lib/supabase/server.ts`(세션 쿠키 기반, RLS 적용)를 다시 거친다 — Realtime payload 자체를 신뢰하지 않고 항상 서버 재조회로 데이터를 가져온다는 설계 원칙이 실제 구현과 일치함을 확인했다.

---

## 16. 구독 생명주기 체크리스트 (현재 상태 — 코드 기준)

| 항목 | 상태 |
|---|---|
| Mount 시 구독 | ✅ `useEffect`에서 `getSession → setAuth → subscribe` 순서로 구현됨 |
| Unmount 시 정리 | ✅ `useEffect` cleanup에서 `cancelled=true` + `supabase.removeChannel(channel)` |
| 세션 로드 경합(비동기) 방지 | ✅ `cancelled` 플래그로 언마운트 후 `setAuth`/`subscribe` 호출 방지 |
| 채널 이름 충돌 방지 | ✅ `${channelName}:${crypto.randomUUID()}`로 마운트마다 고유 topic |
| 재렌더마다 재구독 여부 | 부분 확인 — `watchesRef`로 `watches` 배열 참조 변경에는 반응하지 않도록 했으나(effect deps는 `channelName`만), **호출부가 `watches`를 매 렌더 새 배열 리터럴로 넘기고 있어도 재구독은 안 일어난다는 것까지는 실제 확인**(ref 패턴은 정확히 이 문제를 막기 위한 것). 다만 이 페이지들은 전부 Server Component라 클라이언트 재렌더 자체가 드물어, "빈번한 재렌더 상황"에서의 스트레스 테스트는 하지 않았다. |
| 빠른 라우트 전환 시 중복 구독 | 수동 확인만 있음(콘솔 로그로 CLOSED→SUBSCRIBED 확인, 이전 세션) — 자동 테스트 없음(§13.3 항목 3) |
| 다중 탭 동시 구독 | 미검증 |
| 다건 이벤트 debounce/coalesce | 우연히 동작하는 것으로 보이나 명시적 설계/테스트 없음(§13.3 항목 2) |

---

## 17. RLS-over-Realtime 실측 결과 (재실행 완료, 이 문서 작성 시점 기준 최신)

`npm run test:realtime-rls` 재실행 결과:

```
[PASS] 1. STAFF — 비활성(RLS 비가시) 상품 UPDATE는 이벤트로 안 옴 — event received=false
[PASS] 2. STAFF — 활성(RLS 가시) 상품 UPDATE는 이벤트로 옴(구독 자체가 동작함 확인) — event received=true
[PASS] 3. STAFF(본점) — 동백점 전용 공지 UPDATE는 이벤트로 안 옴 — event received=false
[PASS] 4. STAFF — 전체 대상 공지 UPDATE는 이벤트로 옴 — event received=true

요약: 4 / 4 PASS
```

각 테스트는 서비스 롤로 값을 바꾼 뒤 즉시 원상복구하므로 DEV 데이터에 흔적을 남기지 않는다(재실행 후 `git status`/DB 값 모두 이상 없음 확인).

**함정(재확인, CLAUDE.md/architecture.md에 이미 기록됨)**: 브라우저의 `createBrowserClient`는 쿠키 세션을 비동기로 읽는다. `channel.subscribe()`를 세션 로드 전에 호출하면 소켓이 anon으로 인증되어, 구독 자체는 "SUBSCRIBED"로 성공한 것처럼 보이지만 RLS가 전부 막아 이벤트가 하나도 안 온다 — Node 스크립트에서는 재현 안 되고 브라우저에서만 재현된다. 현재 구현은 이 순서를 지키고 있음을 코드로 재확인했다(§13.1, §15).

---

## 18. 다음 세션에서 진행할 수동 E2E 테스트 시나리오 (계획, 아직 미실행)

로컬 dev server가 이미 떠 있으므로(§25 부트스트랩 참조) 종료하지 말고 그대로 사용한다.

- **시나리오 A — 홈 화면 다중 테이블 배너**: 브라우저 탭 1개를 STAFF로 로그인해 홈에 대기시킨 상태에서, 다른 탭(ADMIN)이나 Service Role 스크립트로 (a) 공지 신규 등록 (b) 프로모션 가격 변경 (c) 행사 노출 ON 세 가지를 각각 발생시켜 홈 배너가 매번 뜨는지, 새로고침 후 실제 반영되는지 확인.
- **시나리오 B — 상세 페이지 필터 정확성**: 상품 상세 페이지 A를 열어둔 채, DB에서 상품 A가 아닌 다른 상품(B)을 변경했을 때 배너가 **뜨지 않는지**(filter=`id=eq.<A>`가 실제로 다른 행의 이벤트를 걸러내는지) 확인.
- **시나리오 C — 빠른 연속 변경(디바운스/coalesce 실측)**: 같은 상품을 1초 간격으로 5회 연속 UPDATE했을 때 배너가 1번만 뜨는지, 리렌더나 상태 꼬임이 없는지 확인(§13.3 항목 2에서 지적한 미검증 사항).
- **시나리오 D — Google Sheet 실경로 E2E**: DEV Sheet에서 실제로 셀을 수정해 Apps Script(onEdit, 3초 디바운스) → Sync API → Supabase UPDATE → Realtime → 브라우저 배너까지 전체 경로가 실제로 동작하는지 확인(§13.3 항목 4, 지금까지 한 번도 실행 안 된 유일한 진짜 E2E 경로). ngrok 터널과 로컬 dev server가 모두 살아있어야 한다.

시나리오 A/B는 비교적 빠르게 끝나고, C/D가 이번 Phase 10에서 가장 중요하게 남은 검증이다.

---

## 19. 현재 DEV 데이터 베이스라인 (2026-09-17, 이 문서 작성 시점 재조회 — 추정 아님)

Service Role Key로 SELECT 전용 조회(임시 스크립트, 조회 직후 삭제, 파일은 저장소에 남아있지 않음):

| 항목 | 값 |
|---|---|
| `promotions` permanent — `is_active=true` | **188건** |
| `promotions` permanent — 전체(비활성 포함) | 190건 |
| `promotions` event — `is_active=true` | **16건** |
| `promotions` event — 전체(비활성 포함) | 17건 |
| `event_campaigns` 전체 | 2건 |
| `event_campaigns_visible`(지금 이 순간 노출 중) | **1건** |
| `notices` 전체 | **14건**(Phase 5 fixture 5 + Phase 8 fixture 9) |
| `profiles` | 4건(테스트 계정) |
| `stores` | 용인본점(HQ), 동백점(DONGBAEK) 2건 |
| `attachments` | 0건 |
| `promotion_sync_state` | permanent: `initial_import_completed_at`=2026-09-10T05:52:47Z / event: 2026-09-11T08:44:07Z — 둘 다 완료 |
| 최근 `sync_logs` 5건 | 전부 `success=true`, `sync_mode=full_snapshot`(10분 주기 정상 동작 중, 가장 최근 2026-09-17T06:08 UTC) |

Phase 7 핸드오프(§14)가 기록했던 테스트 잔재물(`PROD-000232`/`PROD-000238`="테스트" 계열, RLS 테스트용 비노출 캠페인, "DEV 테스트 행사" 캠페인)이 위 "전체" 수치와 "활성" 수치의 차이(permanent 190 vs 188, event 17 vs 16)에 여전히 반영되어 있는 것으로 보인다 — **이번 조사에서 이 잔재물을 직접 다시 나열하지는 않았고(범위 밖), 삭제하지도 않았다.** 정리가 필요하면 별도로 사용자 승인 후 진행할 것.

---

## 20. Auth / RLS 요약 (변경 없음, 재확인)

- Role: `ADMIN`/`STORE_MANAGER`/`STAFF`(`profiles.role`), STORE_MANAGER는 전 영역에서 STAFF와 동일.
- 매장 소속: `user_store_access`(N:M, 하드코딩 없음).
- 모든 테이블 RLS ON, `anon`은 SELECT만, 쓰기는 Service Role 또는 특정 authenticated 정책(`notice_reads` 본인 행 등)만.
- `promotions`/`event_campaigns` INSERT/UPDATE/DELETE는 authenticated 세션으로 불가 — Sync는 항상 Service Role.
- View(`event_campaigns_visible`)는 반드시 `security_invoker=on`.

상세: [permissions.md](./permissions.md)

---

## 21. 환경변수 이름 목록 (값은 절대 기재하지 않음)

`.env.local`에만 존재(git 미추적). 실제 값이 필요하면 새 채팅에서 `.env.local`을 직접 읽을 것 — 이 문서를 포함한 어떤 `docs/*.md`에도 값을 적지 않는다.

| 변수명 | Scope | 용도 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Client+Server | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Client+Server | RLS 적용 공개 키(Realtime 브라우저 클라이언트도 이 키 사용) |
| `SUPABASE_SECRET_KEY` | Server 전용 | RLS 우회. `server-only`로 클라이언트 번들 유입 차단 |
| `SUPABASE_DB_URL` | Server 전용 | 직접 Postgres 연결(migrate 스크립트 등) |
| `SYNC_API_SECRET` | Server 전용 | Apps Script → Sync API Bearer 인증 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Client+Server | Web Push 구독 등록(Phase 11 대비, 아직 미사용) |
| `VAPID_PRIVATE_KEY` | Server 전용 | Web Push 발송 서명(Phase 11 대비, 아직 미사용) |
| `VAPID_SUBJECT` | Server 전용 | VAPID mailto subject(Phase 11 대비) |
| `SYNC_DEACTIVATION_MAX_RATIO` | Server 전용(옵션) | 대량 비활성화 안전장치 비율 임계치, 기본 0.5 |
| `SYNC_DEACTIVATION_MAX_ABSOLUTE` | Server 전용(옵션) | 대량 비활성화 안전장치 절대값 임계치, 기본 50 |

Apps Script 쪽 Script Properties(이 저장소 밖): `SYNC_API_BASE_URL`, `SYNC_API_SECRET`(Next.js와 동일 값). ngrok authtoken도 저장소 밖.

**Secret Rotation 상태**: 2026-09-15 교체 완료(Phase 7 핸드오프 §18 기록). Phase 10 진행 중 추가 교체는 없었다.

---

## 22. 테스트 스위트 — 이 문서 작성 직전 재실행한 실제 결과 (2026-09-17)

| 명령 | 대상 | 결과 |
|---|---|---|
| `npm run typecheck` | 전체 소스 | **에러 0건** |
| `npm run lint` | 전체 소스 | **에러 0건** |
| `npm run test:realtime-rls` | DEV DB(읽기+즉시 원상복구) | **4 / 4 PASS** |
| `npm run test:notice-rls` | DEV DB(읽기+즉시 원상복구) | **23 / 23 PASS** |
| `npm run test:rls` | DEV DB(읽기+격리 계정) | **19 / 19 PASS** |
| `npm run test:promotion-rls` | DEV DB(읽기+격리 계정) | **12 / 12 PASS** |

재실행하지 않은 것(범위상 Phase 10과 무관, 이전 세션에서 이미 통과 확인됨 — Phase 7 핸드오프 §20 참조): `test:sync`, `test:sync:safety`, `test:apps-script:retry`, `test:apps-script:trigger-lifecycle`, `test:timestamps-equal`. **`npm run build`도 이 문서 작성 세션에서는 실행하지 않았다** — dev server가 실행 중인 상태에서 `.next/`를 공유하는 `next build`를 도는 것은 CLAUDE.md 개발 원칙상 "실행 후 dev server 응답 확인"까지 필요한 작업이라, 이번 요청 범위(조사+문서화 전용, 코드 미변경)에서는 보수적으로 생략했다. 다음 세션에서 Phase 10 코드를 추가 변경한 뒤에는 반드시 `npm run build` + dev server 응답 확인까지 실행할 것.

**절대 실행하면 안 되는 명령**: `npm run db:clean:promotions` — 실 Sheet 데이터까지 전부 지운다.

---

## 23. Phase 0~10 주요 버그/사고 요약표 (전체, 재확인)

| # | 시점 | 사고/버그 | 근본 원인 | 수정 |
|---|---|---|---|---|
| 1 | Phase 0~4 | TypeScript 7 / ESLint 10 비호환 | 툴체인 버전 조합 문제 | 버전 pin |
| 2 | Phase 4 | `middleware.ts` 관례 deprecated | Next.js 16 컨벤션 변경 | `src/proxy.ts`로 이관 |
| 3 | Phase 6.5 | `event_campaigns_visible` View가 RLS 우회 | Postgres View는 기본 Owner 권한(RLS 우회) | `security_invoker=on` |
| 4 | Phase 6 | `is_initial_import`이 Hard Delete 후 재Sync 시 오판정 가능 | "Row 0건"이라는 휘발성 조건으로 상태 판단 | `promotion_sync_state` 영구 상태 테이블 |
| 5 | 2026-09-11 | **대량 비활성화 사고**(실 데이터 188건 중 187건) | "Sync에 없으면 무조건 비활성화" 안전장치 부재 | `sync_mode` + 비율·절대값 임계치 |
| 6 | Phase 6 | `updated_at` 불필요 갱신 | 값이 안 바뀐 필드까지 매번 SET | 변경된 필드만 SET |
| 7 | 2026-09-15 | `flushPendingSync` pending 유실(dev server 순단 중 편집 누락) | API 호출 전에 pending 삭제 | 2xx 성공 시에만 삭제 + 재시도/백오프 |
| 8 | 2026-09-16 | 재부팅 후 disabled `flushPendingSync` 트리거 누적 | Property 플래그가 실제 트리거 존재 여부와 어긋남 | `ScriptApp.getProjectTriggers()` 직접 확인 + 자가 치유 |
| 9 | 2026-09-16 | `push_eligible`이 `importance='minor'`에도 기본값(true) 유지 | 두 컬럼을 완전 독립 축으로 설계 | CHECK 제약 추가 |
| 10 | 2026-09-16 | `event_campaigns` 변경 감지 오탐(143건 오염 로그) | timestamptz를 문자열로 비교 | `timestampsEqual()`(epoch 비교) |
| 11 | 2026-09-16 | 스킵된 Row(브랜드/제품명 공백)가 무기록 `continue` | 정상 스킵도 감사 기록 없었음 | `sync_logs.skipped_count`/`skipped_detail` |
| 12 | Phase 7 | 컬러 배지 React key 중복 경고 | Sheet 원본 데이터에 실제 중복 컬러 값 존재 | `dedupeTrimmed()` 헬퍼 |
| 13 | Phase 8 | "필독" 유형 공지에서 필독 배지 중복 표시 | 유형 배지와 requires_confirmation 배지가 별개로 표시됨 | `notice_type !== "필독"` 가드 |
| 14 | Phase 8 | `test-notice-rls.ts` 재실행 시 비idempotent(사전 read 상태 가정) | 이전 실행이 만든 read row가 남아있음 | 스크립트 시작 시 서비스 롤로 사전 정리 |
| 15 | Phase 8 | 커밋 직전 발견한 정체불명 "테스트" 공지 | 사용자가 수동으로 폼을 시험 사용한 것으로 추정 | AskUserQuestion으로 확인 후 삭제 |
| 16 | Phase 9 | `.next/types/validator.ts`가 삭제된 `/training` 라우트 참조 | 라우트 삭제 후 타입 캐시 미갱신 | `npx next typegen` 재실행 |
| 17 | Phase 10 | **브라우저 Realtime 구독이 "SUBSCRIBED"인데도 이벤트 미수신** | `createBrowserClient`의 비동기 세션 로드와 `subscribe()`의 경합 — anon으로 소켓 인증됨 | `getSession()→setAuth()→subscribe()` 순서 강제 |

---

## 24. Phase 10에서 사용자 승인 없이 절대 바꾸면 안 되는 것 (Phase 7 §22 목록 + Realtime 관련 추가)

Google Sheet 컬럼 구조, `apps-script/Sync.gs` 로직, `product_id` 채번 전략, `sync_mode` 구분, 대량 비활성화 Safety Guard, RLS 정책 구조(`promotions_select`/`event_campaigns_select`), NEW/Push Change Classification 기준, 행사 노출 로직(`event_campaigns_visible`), Initial Import Push 제외 정책, **Promotion Card UX(§10 카드/상세 레이아웃)**, **Notice read/confirm 시맨틱(§11)**.

**Phase 10 한정 추가 항목**:
- `supabase_realtime` publication에 포함된 3개 테이블 목록(무분별하게 확장하지 않는다 — 새 테이블을 추가하려면 먼저 "왜 이 테이블의 실시간 신호가 사용자 가치가 있는지"를 사용자와 상의).
- 배너 방식 UX(자동 병합 대신 수동 새로고침) — 검색/필터/페이지네이션이 서버 쿼리 기준인 한 이 원칙을 뒤집지 않는다.
- `getSession → setAuth → subscribe` 순서.

---

## 25. Git/커밋 상태 재평가

- 현재 uncommitted 상태(§2)에는 **Phase 9 SKIP 작업 전체**와 **Phase 10 Realtime 작업 전체**가 섞여 있다.
- 이 문서 작성 과정에서 실행한 모든 것은 읽기 전용 조사 + typecheck/lint(코드 미수정) + 자체 원상복구되는 RLS 테스트뿐이라, 이 uncommitted diff 자체는 이 문서 작성 전과 완전히 동일하다(추가/변경 없음).
- **커밋 여부·시점·메시지는 사용자 승인 없이 실행하지 않는다** — 아래는 실행이 아니라 권장 사항이다.
  - **권장**: 새 채팅으로 넘어가기 전에 지금 상태를 커밋해두면, 다음 세션이 "Phase 9 SKIP + Phase 10 Realtime(부분 완료)"라는 명확한 체크포인트 위에서 시작할 수 있다. 두 Phase가 논리적으로 다르지만(하나는 제거/문서 정리, 하나는 신규 기능), 실제 diff가 이미 상당 부분 얽혀 있어(예: `notice_type`에 `교육` 추가는 Phase 9지만 같은 파일에서 Realtime import도 추가된 페이지들이 있음) 굳이 분리 커밋을 시도하면 리스크만 커진다.
  - **권장 커밋 메시지 예시** (실행은 사용자 지시 시):
    ```
    Phase 9 skip + Phase 10 realtime: notice education type, 4-tab nav, realtime banners
    ```
  - 커밋 전 최종 확인 권장 목록: `git status`(위 목록과 일치하는지), `.env*` 미포함 확인, `git diff --cached`에서 Secret 패턴 스캔, typecheck/lint(이미 이 문서에서 재확인함, §22), 브라우저에서 최소 1회 실동작 확인(다음 세션에서 §18 시나리오 A만이라도 먼저 돌려본 뒤 커밋하는 것을 권장).

---

## 26. Secret 처리 규칙 (이 문서 자체에도 적용됨, 자체 검토 완료)

- 이 문서에는 Supabase Secret Key, DB 비밀번호, 전체 DB 연결 URL, `SYNC_API_SECRET`, ngrok authtoken, VAPID Private Key의 **실제 값을 단 하나도 적지 않았다** — §21에 환경변수 이름만 나열했다.
- **자체 Secret Scan 결과**(작성 완료 직후 재검토): 위 6종의 실제 값 패턴(base64/`postgres://`/`sk-`/`eyJ` 등 키 형태 문자열)이 이 문서 어디에도 없음을 확인했다. 문서 내 모든 코드 스니펫(`timestampsEqual`, RLS 정책, View 정의, `RealtimeUpdateBanner` 발췌 등)은 로직만 담고 있으며 자격증명을 포함하지 않는다.
- DEV Supabase 조회에 쓴 임시 스크립트(`scripts/_tmp_readonly_baseline.ts`)는 실행 직후 삭제했다 — `git status`로 저장소에 남아있지 않음을 재확인했다.
- **Markdown/일관성 자체 점검**: 표/코드 블록 렌더링 확인, 문서 내 링크(`architecture.md`, `database-schema.md` 등)가 실제 존재하는 파일을 가리키는지 확인, 이 문서가 언급하는 커밋 해시·파일 경로·테스트 결과 수치는 전부 §1의 재조사 과정에서 직접 재확인한 값이며 이전 대화 기억에서 그대로 옮긴 것이 아니다.
- **완결성 점검**: 사용자가 요청한 28개 섹션 항목(Git 상태/프로젝트 성격/아키텍처/Phase 0-6 요약/안전장치/NEW·Push/Event Visibility/Timestamp 교훈/Phase 7 상태/Phase 8 상태/Phase 9 상태/Phase 10 진행상태(코드 기준)/Phase 10 목표/보안 요구사항/생명주기 체크리스트/E2E 시나리오/DEV 베이스라인/Auth·RLS/환경변수 이름/시크릿 로테이션/테스트 결과/버그표/재설계 금지 목록/커밋 판단/BOOTSTRAP)를 전부 이 문서의 각 절로 매핑했다.

---

## 27. BOOTSTRAP INSTRUCTIONS — 새 Claude Code 채팅이 처음 할 일

1. 이 문서(`docs/PHASE10_HANDOFF.md`) 전체를 정독한다.
2. `git status`, `git log --oneline -10`, `git rev-parse HEAD`를 실행해 §2의 상태(HEAD `84cfdab`, uncommitted diff 목록)와 실제 저장소가 일치하는지 확인한다 — 사용자가 그 사이 커밋했을 수 있으니 먼저 실제로 확인하고, 이 문서의 서술과 다르면 실제 상태를 우선한다.
3. `/CLAUDE.md`를 다시 읽어 절대 원칙과 lessons-learned 로그에 이 문서 이후 추가된 내용이 있는지 확인한다.
4. §13(Phase 10 현재 진행 상태)과 §16(생명주기 체크리스트)을 다시 한번 실제 코드(`src/components/realtime/realtime-update-banner.tsx`, Realtime을 쓰는 6개 페이지)와 대조해 이 문서 작성 이후 변경이 없었는지 확인한다.
5. `npm run dev`가 이미 떠 있는지 확인한다(`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` 등). **사용자가 실 Sheet/브라우저 E2E 테스트를 이어가고 있을 수 있으므로 이미 떠 있다면 임의로 재시작/종료하지 않는다**(CLAUDE.md 개발 원칙).
6. DEV Supabase 확인이 필요하면 §19의 방식(임시 스크립트로 SELECT만, 실행 직후 삭제)을 따르고 **Promotion/Notice/Sync 데이터를 절대 수정하지 않는다.**
7. **코드를 수정하기 전에 먼저 사용자에게 현재 상태(§13 요약)를 보고하고, 다음에 무엇부터 할지(§18의 A/B/C/D 시나리오 중 어느 것부터? 뱃지 실시간화를 할지 말지?) 합의한다.** 합의 없이 바로 구현을 시작하지 않는다.
8. §24(재설계 금지 목록)에 해당하는 항목을 건드려야 할 것 같으면 반드시 먼저 멈추고 사용자에게 보고 후 승인을받는다.
9. Phase 6/7/8의 안정된 영역(Sync 엔진, Promotion Card UX, Notice read/confirm 시맨틱)은 승인 없이 손대지 않는다.
10. 수동 브라우저 E2E 진행 중에는 **로컬 dev server를 절대 임의로 종료하지 않는다.**
11. 이번 Phase 10 작업이 §14(목표)의 항목들을 실 데이터/실 브라우저로 검증 완료하기 전까지는 **Phase 11(Push)로 자동 진행하지 않는다.**
12. 각 기능 단위 완료 시 `npm run lint`/`npm run typecheck`/`npm run build`를 실제로 돌리고, UI 변경은 브라우저에서 실제 동작을 확인한 뒤에만 "완료"로 보고한다.

---

*이 문서는 2026-09-17에 저장소를 직접 재조사하고 DEV Supabase를 읽기 전용으로 조회하며 RLS/Realtime 테스트 스위트를 재실행해 작성됐다. Production/DEV의 Promotion·Notice·Sync 데이터는 전혀 수정하지 않았으며, Phase 10 코드도 이 작업 중 추가/수정하지 않았다.*
