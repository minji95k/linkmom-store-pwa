# Phase 7 개발 인수인계 문서 (Promotion UI)

> **이 문서의 목적**: 이 대화의 컨텍스트 윈도우가 가득 차서, 새로운 Claude Code 채팅에서 Phase 7(Promotion UI)부터 이어서 개발한다. 이 문서 하나만 읽으면 Phase 0~6의 설계 결정과 실제 구현 상태를 잃지 않고 정확히 이어서 작업할 수 있도록 작성했다.
>
> **작성 방식**: 이 문서는 기존 대화의 기억에 의존해 요약한 것이 아니다. 아래 "1. 이 문서 작성을 위해 직접 재조사한 소스"에 나열된 실제 코드/문서/migration/git history/package.json/DEV Supabase(읽기 전용)를 2026-09-16에 직접 다시 읽고 실행해 검증한 결과다. **Production 데이터와 DEV 데이터는 이 작업 중 단 하나도 수정하지 않았다** — 실행한 것은 `git status`/`git log`/`ls`/`Read`/DEV Supabase에 대한 SELECT 전용 조회, 그리고 이미 안전성이 검증되어 있고 종료 시 스스로 정리(self-clean)하는 기존 테스트 스크립트(`npm run test:*`)뿐이다.
>
> 이 문서는 `docs/*.md`의 상세 내용을 그대로 복제하지 않는다. **"반드시 알아야 할 결정 + 현재 상태 + 더 읽을 곳"**에 집중한다. 상세 스펙이 필요하면 각 절에서 링크한 문서를 열어라.

---

## 1. 이 문서 작성을 위해 직접 재조사한 소스

- `/CLAUDE.md` (전문 재확인 — 117줄, 절대 원칙 13개 + 전체 lessons-learned 로그)
- `docs/current-system-analysis.md`, `docs/product-requirements.md`, `docs/architecture.md`, `docs/database-schema.md`, `docs/permissions.md`, `docs/sync-design.md`, `docs/push-design.md` (7개 전부 전문 재확인)
- `apps-script/Sync.gs`(567줄), `apps-script/README.md`(전문 재확인)
- `supabase/migrations/*` 21개 파일 목록 확인 + 핵심 SQL 재확인(`event_campaigns` 테이블/뷰, `promotion_sync_state` + `mark_initial_import_completed()`, `promotion_change_logs_minor_not_push_eligible` CHECK 제약, `promotion_rls_and_grants` + `security_hardening_before_live_sync`의 RLS 정책 변천사)
- `src/lib/sync/*` 전체 8개 파일(engine.ts, safety.ts, timestamps.ts, types.ts, validate-request.ts, authenticate.ts, change-classification.ts, core-fields.ts) 및 `src/lib/supabase/*` 전체 4개 파일(client.ts, proxy.ts, server.ts, service-role.ts), `src/proxy.ts`
- `package.json` (scripts 전문)
- `git status`, `git log --oneline --all`, `git branch --show-current`, `git rev-parse HEAD`
- **DEV Supabase 읽기 전용 조회** (Service Role Key로 SELECT만 실행, 쓰기 전혀 없음): `promotions`/`event_campaigns`/`promotion_sync_state`/`sync_logs` 실측
- **테스트 스위트 재실행**: `test:sync:safety`, `test:apps-script:retry`, `test:apps-script:trigger-lifecycle`, `test:timestamps-equal`(이상 4개는 DB/네트워크 전혀 사용 안 함), `test:promotion-rls`, `test:rls`(DEV DB 대상이지만 읽기+격리된 테스트 계정 대상), `test:sync`(DEV DB 대상, 자체적으로 테스트 데이터를 만들고 `finally`에서 스스로 정리 — 이미 안전성이 검증된 스크립트임을 CLAUDE.md에서 확인 후 실행)

### 문서 목록상 실제와 다른 점(발견된 불일치)

- **`docs/deployment.md`는 존재하지 않는다.** `CLAUDE.md` 문서 맵과 사용자 요청 소스 목록에는 있지만 실제 저장소에는 없다. 배포 관련 내용은 `docs/architecture.md` §8 "Deployment Architecture"에 간략히만 있다(Vercel + Supabase + 별도 Apps Script 배포). Phase 15(배포) 이전까지는 이 정도로 충분하지만, 별도 `deployment.md`가 필요해지면 새로 작성해야 한다.
- 그 외 문서/코드/migration은 실제 구현과 완전히 일치했다(문서가 최신 상태와 어긋나는 부분 없음).

---

## 2. Git 상태 (2026-09-16 재확인, 이 문서 작성 직전 기준)

```
branch: master
HEAD:   591adf1cb47eea8b20c9b7882c182aee92da9c13
working tree: clean (nothing to commit)
```

**알려진 checkpoint 커밋(전부 `git log`로 직접 재확인 — 사용자가 제시한 해시와 정확히 일치, 추가/누락 커밋 없음):**

| 커밋 | 내용 |
|---|---|
| `464703a` | Phase 5: auth authorization and RLS verified |
| `a4f41fb` | Phase 6 checkpoint: promotion schema + sync engine (Sheet↔Apps Script E2E pending) |
| `ec63965` | Phase 6.5: harden sync safety guards |
| `f4f7906` | Phase 6.5: sync_logs audit columns (sync_mode/received_row_count) + onEdit trigger |
| `591adf1` | Phase 6 complete: Google Sheet sync verified (**현재 HEAD**) |

이 문서 작성 과정에서 실행한 것은 읽기 전용 조사 + 자체 정리되는 테스트 스크립트뿐이라 **working tree는 여전히 clean**이다(이 파일 `docs/PHASE7_HANDOFF.md`만 새로 추가된 untracked 파일). 커밋 필요 여부 판단은 §12 참조.

---

## 3. 프로젝트 성격 (반드시 먼저 이해할 것)

- **Demo가 아니라 링크맘 본사/매장 직원이 매일 쓰는 Production 내부 업무 시스템**이다(CLAUDE.md 절대 원칙 1).
- **Native App이 아니다.** Mobile First Responsive PWA. 직원 화면(STAFF/STORE_MANAGER)은 Mobile First, 관리자 화면(ADMIN)은 Desktop First.
- Role은 3종: `ADMIN`(본사 관리자) / `STORE_MANAGER`(매장 책임자) / `STAFF`(매장 직원). 현재 STORE_MANAGER는 프로모션 도메인을 포함해 모든 기능에서 **STAFF와 완전히 동일**하게 동작한다(§9 참조 — Phase 6.5에서 STORE_MANAGER의 "전체 매장 조회" 예외를 폐기했다).
- 매장은 현재 **용인본점, 동백점** 2곳이며 향후 추가 예정. 코드/RLS/Push·Notice Targeting 어디에도 매장명·매장 개수를 하드코딩하지 않는다 — `stores` 테이블 행 추가만으로 확장 가능해야 한다.
- Google Spreadsheet가 프로모션 데이터의 **유일한 Source of Truth**이며 Sync는 **One-way(Sheet → Supabase)**만 존재한다. 본사 담당자가 Spreadsheet만 고치면 되고, 그 어떤 재배포/Claude Code 실행도 일상 운영에 개입하지 않아야 한다.

---

## 4. 최종 아키텍처

```
[Google Spreadsheet]  (Source of Truth)
   ├─ [상시 프로모션] 시트 (188건, permanent)
   └─ [행사 프로모션] 시트 (16건, event — 행사명/시작일/종료일/노출여부 컬럼 신설됨)
          │  onEdit(즉시, ~3초) + syncAll(10분 Safety Net)
          ▼
[Google Apps Script]  (apps-script/Sync.gs)
   - 설치형 onEdit 트리거 → 디바운스(3초 고정윈도우) → flushPendingSync → partial Sync
   - syncAll 10분 주기 → full_snapshot Sync
   - Bearer Token(SYNC_API_SECRET) 첨부, 재시도/백오프, product_id 되쓰기
          │  HTTPS POST (Bearer 인증)
          ▼
[Next.js API Route]  /api/sync/permanent , /api/sync/event
   - src/proxy.ts → src/lib/supabase/proxy.ts: /api/* 는 세션 리다이렉트 제외(자체 인증)
   - src/lib/sync/authenticate.ts: SYNC_API_SECRET 검증
   - src/lib/sync/validate-request.ts (zod): 요청 스키마 검증
   - src/lib/sync/engine.ts: Header→Core Field 매핑, Upsert, Change 감지, Safety Guard,
     product_id 채번, sync_logs 기록
   - Service Role Key(src/lib/supabase/service-role.ts)로만 RLS 우회 — Apps Script는
     이 키를 절대 갖지 않는다
          ▼
[Supabase PostgreSQL]  (RLS + Server-side Authorization 이중 방어)
   - promotions / promotion_field_definitions / promotion_change_logs
   - event_campaigns / event_campaign_products (+ event_campaigns_visible 뷰,
     security_invoker=on)
   - promotion_sync_state (Initial Import 영구 상태), sync_logs (감사 로그)
          │  (Phase 7에서 읽기)
          ▼
[Next.js App Router UI]  ← Phase 7이 여기를 만든다
   - 직원(Mobile First): 홈 / 프로모션(상시·행사·NEW) / 공지 / 교육자료 / MY
   - 관리자(Desktop First): 사용자/매장/공지/교육자료/프로모션/행사/Field설정/Push/Audit
```

일반 클라이언트(브라우저)는 `src/lib/supabase/client.ts`(Publishable Key, RLS 적용), Server Component/Route Handler는 `src/lib/supabase/server.ts`(로그인 세션 쿠키 기준, RLS 적용)를 쓴다. `src/lib/supabase/service-role.ts`(RLS 우회)는 Sync·Push 같은 서버 전용 특권 작업에서만 import한다(`import "server-only"`로 클라이언트 번들 유입을 빌드 타임에 차단).

상세: [architecture.md](./architecture.md), [database-schema.md](./database-schema.md)

---

## 5. Google Spreadsheet 운영 구조

`[상시 프로모션]`과 `[행사 프로모션]`은 **서로 다른 목적을 가진 별개의 Source Sheet**이며 절대 하나로 합치지 않는다. `promotion_type`(`permanent`/`event`)으로 항상 구분한다.

| | 상시 프로모션 | 행사 프로모션 |
|---|---|---|
| 실측 규모 | 188행/18컬럼 | 16행/14컬럼(과거 1개 행사 스냅샷) |
| 노출 제어 | 없음(`is_active`만) | ON/OFF + 기간 자동 제어(신설 컬럼) |
| 캠페인 개념 | 없음(개별 상품) | `event_campaigns`로 그룹핑(`campaign_key`=행사명 trim) |
| 사은품 컬럼명 | `증정사은품` | `행사 사은품`(Sync에서 둘 다 `gift`로 통합) |
| 변경일 추적 | `수정일` 컬럼 있음(신뢰 안 함, 자체 diff 사용) | 없음(자체 diff로만 감지) |

두 시트 모두 `product_id` 컬럼이 있고 담당자는 이 칸에 아무것도 입력하지 않는다(§7 참조). `[행사 프로모션]`에는 `행사명`/`행사 시작일`/`행사 종료일`/`노출여부` 4개 컬럼이 신설되어 있다(개발/복제 시트에서 검증 후 반영하기로 확정, [sync-design.md](./sync-design.md) §7).

Softr 전용 메타컬럼(`수정일`/`NEW`/`최근 수정 건수`/`🔐 Softr Record ID`)은 Dynamic Field 자동 감지에서 제외된다(`src/lib/sync/core-fields.ts`의 `EXCLUDED_HEADERS`). 특히 `최근 수정 건수`는 상품별 데이터가 아니라 Softr 홈 화면 요약 통계가 우연히 한 행에 섞여 들어간 것으로 실측 확인됐다 — 절대 신뢰하지 않는다.

상세: [current-system-analysis.md](./current-system-analysis.md) §3, [sync-design.md](./sync-design.md) §1

---

## 6. Multi-sheet Sync 구현 상태 — **완료, Phase 7에서 손댈 필요 없음**

`src/lib/sync/engine.ts`가 두 엔드포인트(`/api/sync/permanent`, `/api/sync/event`)의 공통 로직을 처리한다:

1. Header trim + 공백정규화 후 `PROMOTION_CORE_FIELD_MAP`(sheet별 별도, `core-fields.ts`)로 Core Field 매핑
2. 매핑 안 되는 Header(단, `EXCLUDED_HEADERS` 제외) → `promotion_field_definitions`에 자동 등록(Safe Default: 표시 ON / 검색·필터·NEW·Push OFF / type=text) + `promotions.extra_fields`(JSONB)에 저장 — **재배포 불필요**로 실제 동작 검증됨(`test:sync` §8)
3. `product_id`(또는 과도기엔 `legacy_softr_record_id`)로 Upsert. 빈 `product_id` Row는 `next_product_id()` Sequence로 채번(`PROD-000NNN`) 후 `productIdAssignments`로 응답에 실어 Apps Script가 셀에 되쓰게 함
4. `[행사 프로모션]`의 `행사명`/`행사 시작일`/`행사 종료일`/`노출여부`는 `event_campaigns`로 별도 매핑(`EVENT_CAMPAIGN_FIELD_MAP`)
5. 브랜드/제품명이 모두 공백인 Row는 정상 스킵(`skippedCount`/`skipped`에 기록 — §11)
6. 셀 값이 빈 문자열이거나 `"-"`이면 `null`로 정규화(`normalizeCellText`, 실측 데이터 패턴)
7. Change 감지 → `promotion_change_logs` 기록 + `last_important_change_at` 갱신(important 이상만) + `sync_logs` 기록

Product ID 전략은 **서버 자동 채번**으로 확정됐다(사용자 의사결정, [sync-design.md](./sync-design.md) §4) — 담당자는 시트에 아무 값도 입력하지 않는다.

---

## 7. 자동 Sync 구조 (실 Google Sheet 연동으로 검증 완료)

두 개의 독립 경로가 있다(`apps-script/Sync.gs`):

**경로 1 — 설치형 onEdit 트리거 (`sync_mode: "partial"`, 기본 경로)**
`[상시 프로모션]`/`[행사 프로모션]` 수정 → `handleEditTrigger`가 Row 번호만 Script Properties에 누적 → 아직 예약 안 됐으면 `DEBOUNCE_DELAY_MS`(3초) 뒤 실행될 `flushPendingSync` 1회성 트리거 예약(고정 윈도우 배칭, 순수 debounce 아님) → flush 시점에 최신 셀 값 재수집 → `sync_mode:"partial"` + `source_sheet:<sheet>`로 API 호출. partial이므로 대량 비활성화 로직 자체가 실행되지 않는다.

**경로 2 — 10분 주기 `syncAll` (`sync_mode: "full_snapshot"`, Safety Net)**
onEdit이 재시작/오류/Quota로 간헐 누락될 수 있으므로 전체 Sheet를 주기적으로 재확인. 이 경로만 대량 비활성화 안전장치(§9)를 실제로 발동시킬 수 있다.

**product_id 되쓰기 Loop 방지**: 되쓰는 동안 `WRITEBACK_IN_PROGRESS_<sheet>` 플래그로 `handleEditTrigger` 재진입을 무시(Apps Script는 스크립트가 쓴 값 변경으로 onEdit을 발생시키지 않는 것이 공식 동작이지만, 이중 방어로 플래그도 건다).

**트리거 생명주기 (평상시 정상 상태, 2026-09-16 자가 치유 로직 도입 후):**

| Handler | 평상시 개수 |
|---|---|
| `handleEditTrigger` | 1개(지속) |
| `syncAll` | 1개(지속, 10분마다) |
| `flushPendingSync` | **0개** (디바운스/재시도 대기 중 짧은 순간만 최대 1개) |

`ScriptApp.getProjectTriggers()`로 실제 트리거 존재 여부를 매번 직접 확인하며(Property 플래그에 의존하지 않음), `flushPendingSync` 실행 시작 시 동일 handler 트리거를 전부 지운 뒤 필요하면 정확히 1개만 재생성한다. `installOnEditTrigger()` 재실행이 공식 리셋 경로다(재부팅 후 등).

상세: [sync-design.md](./sync-design.md) §11, [apps-script/README.md](../apps-script/README.md)

---

## 8. Sync 실패/재시도 정책

| 실패 사유 | 재시도 | 처리 |
|---|---|---|
| 연결 실패/timeout, 5xx, 429 | O | pending 유지, 15초→30초→60초 백오프로 최대 3회(총 4회 시도) |
| 401/403(인증) | X | pending 유지, 로그만(Secret 불일치는 재시도로 해결 안 됨) |
| 409(대량 비활성화 안전장치 차단) | X | pending 유지, 로그만(destructive 상황 자동 재시도 금지) |
| 400 등 기타 4xx | X | pending 유지, 로그만(같은 payload는 다시 보내도 동일하게 실패) |

pending Row는 **API가 실제로 HTTP 2xx 성공했을 때만** 지운다(2xx 전에 지우면 dev server 순단 시 편집이 유실되는 사고가 실제로 있었다 — §14 참조).

> **DEV 한정 주의사항(Vercel 실배포 후 사라지는 제약)**: 현재 DEV Apps Script는 `localhost:3000`을 ngrok으로 터널링해 호출한다. 로컬 `npm run dev` 서버가 내려가 있으면 onEdit Sync가 즉시 실패하고 재시도(최대 105초)까지 소진된 뒤 10분 Full Snapshot Safety Net에 의존하게 된다. **Phase 15(실제 Vercel 배포) 이후에는 이 로컬 서버 의존성 자체가 사라진다** — Apps Script Script Properties의 `SYNC_API_BASE_URL`을 Vercel URL로 바꾸면 된다. Phase 7~14 동안은 이 제약이 계속 유효하므로, **로컬 dev server를 사용자 승인 없이 종료하지 않는다**(CLAUDE.md 개발 원칙에 명시).

---

## 9. Dynamic Column 정책

- Header 순회 시 알려지지 않은 새 컬럼이 나타나면 재배포 없이 `promotion_field_definitions`에 자동 등록(Safe Default: 표시 ON / 검색·필터·NEW·Push OFF / type=text) + 값은 `promotions.extra_fields`(JSONB)에 저장.
- Admin 화면(Phase 12+)에서 표시 여부/순서/검색·필터·NEW·Push 활성화를 이후 조정 가능해야 한다(재배포 불필요).
- Core Field(가격/검색/권한/Push 로직에 관여) vs Dynamic Field 판단 기준은 [database-schema.md](./database-schema.md) "Core Field vs Dynamic JSONB 판단 기준" 절 참조.

---

## 10. NEW / Change Classification (72h Rolling) — Push와 완전히 공유

**NEW는 "최근 7일 내 수정된 모든 상품"이 아니다.** 기존 Softr는 이 기준으로 188개 중 135개(72%)가 NEW로 잡혀 신호 대비 잡음이 심했다(실측 확인). 신규 시스템은:

- **최근 72시간(Rolling)** 내 신규 상품 또는 **중요 변경**(가격/프로모션/혜택/사은품/행사기간/판매조건)만 NEW.
- 공백/오타/표기정리/내부관리 필드/타임스탬프만 변경 → **제외**(minor).
- 정렬: `last_important_change_at DESC`, 자동 만료(72h 지나면 그냥 안 보임 — 별도 배치 불필요, 조회 시점에 재계산).
- **NEW 판정과 Push 판정은 완전히 동일한 `promotion_field_definitions.change_importance`/`push_enabled`를 공유**한다(CLAUDE.md 절대 원칙 7) — 별도 로직을 만들지 않는다.

| 변경 필드 | importance | NEW | Push |
|---|---|---|---|
| 소비자가/기준판매가/카드결제가/현금이체가 | important | O | O |
| 프로모션/매장프로모션/판매조건 | important | O | O |
| 기본구성품/증정사은품/행사사은품 | important | O | O |
| 행사기간 | important | O | O |
| 긴급 판매조건 변경 | critical | O | 즉시(Batch 제외) |
| 공백/오타/표기정리/내부관리/타임스탬프만 | minor | X | X |

실제 필드→분류 매핑 구현은 `src/lib/sync/change-classification.ts`의 `CHANGE_TYPE_BY_FIELD`(→`promotion_change_logs.change_type` 분류용, 중요도 자체는 아님)와 `promotion_field_definitions.change_importance`(실제 중요도 소스) 참조.

상세: [product-requirements.md](./product-requirements.md) §4.4, §7, [push-design.md](./push-design.md) §3

---

## 11. Initial Import 상품의 Push 제외 정책

**Migration/Initial Import로 생성된 기존 상품은 Push 발송 대상이 아니다.** 운영 개시 이후 새로 추가되는 상품만 Push 대상.

- `promotion_sync_state`(Sheet 타입별 1행, PK=`promotion_type`): `initial_import_completed_at`이 채워지면(성공 Sync 시 `mark_initial_import_completed()`가 COALESCE로 1회만 채움) **`promotions` Row가 전부 Hard Delete돼도 절대 되돌아가지 않는다.** (최초 설계는 "Row 0건"으로 판정했다가 Hard Delete 재현 테스트에서 오판정 가능성을 발견해 이 영구 상태 테이블로 교체했다.)
- `promotions.is_initial_import`: Sync 엔진이 매 실행 시작 시 `promotion_sync_state`를 조회해 자동 판정(운영자 수동 체크 아님).
- `promotion_change_logs.push_eligible`(기본 `true`): `change_type='new_product'`이고 `is_initial_import=true`면 `push_eligible=false`. 그 외 로그는 기본 `true`.
- **DB CHECK 제약** `promotion_change_logs_minor_not_push_eligible`(`importance <> 'minor' or push_eligible = false`, `20260916010000` migration): `importance='minor'`인 로그는 애초에 `push_eligible=true`로 저장될 수 없다 — 애플리케이션이 실수로 빼먹어도 DB가 막는다.
- **Phase 11 구현 시 반드시 지킬 이중 안전장치**: 발송 대상 = `promotion_change_logs WHERE importance != 'minor' AND push_eligible = true AND changed_at > <Push 기능이 실제로 켜진 시각>`. 컷오버 시각 저장 방식(env var vs 설정 테이블)은 Phase 11에서 결정 — 지금은 스키마 없음.

상세: [push-design.md](./push-design.md) §3.1~3.2

---

## 12. 행사(Event) 노출 로직 — ON/OFF × 기간 매트릭스

| 노출여부 | 기간 조건 | 결과 |
|---|---|---|
| OFF | 무관 | 비노출(데이터는 보존, 삭제 아님) |
| ON | 시작일 ≤ 오늘 ≤ 종료일 | **노출** |
| ON | 시작 전 | 비노출(담당자가 미리 등록해도 안전) |
| ON | 종료일 경과 | **자동 비노출**(담당자가 OFF 깜빡해도 안전) |
| ON | 시작일/종료일 미입력 | 비노출(Safe Default) |

최종 노출 여부는 **매 조회 시 `event_campaigns_visible` 뷰가 재계산**한다(별도 배치 Job 없음):

```sql
create view public.event_campaigns_visible as
select * from public.event_campaigns
where is_visible = true
  and start_at is not null and end_at is not null
  and now() between start_at and end_at;
```

이 View는 `security_invoker = on`이 반드시 설정되어 있어야 한다(§14의 실제 보안 사고 참조) — 새 View를 promotions 도메인에 추가할 때마다 잊지 말 것.

**ADMIN vs STAFF/STORE_MANAGER 노출 범위 차이** (`promotions_select`/`event_campaigns_select` RLS 정책, `20260910100000_security_hardening_before_live_sync.sql`):
- **ADMIN**: `is_active` 여부/노출 여부/기간 무관하게 전체 조회 가능(비활성·비노출·예정·종료 캠페인 전부 포함).
- **STAFF/STORE_MANAGER**(현재 동일 취급): `promotion_type='permanent'`이면 `is_active=true`인 것만. `promotion_type='event'`면 그 상품이 속한 캠페인이 **지금 이 순간 실제로 노출 중**(`is_visible AND 기간 내`)일 때만. 비노출/예정/종료 캠페인은 아예 조회 자체가 안 됨(단순 UI 숨김이 아니라 RLS 차단).

상시/행사는 시각적으로 명확히 구분되어야 한다(배지/색상/섹션 분리, 다중 캠페인 동시 운영 지원 — 하드코딩 금지).

상세: [product-requirements.md](./product-requirements.md) §4.3, §6, [sync-design.md](./sync-design.md) §7, [permissions.md](./permissions.md) §3

---

## 13. `event_campaigns` 타임스탬프 비교 버그 (Lessons Learned, 상세)

**증상**: 2026-09-16, 캠페인이 하나라도 있으면 거의 모든 Sync(10분 Full Snapshot 포함)마다 "변경됨"으로 오판해 실 DEV DB에 불필요한 `campaign_visibility` change_log와 `last_important_change_at` 갱신이 4일간 **143건** 쌓였다(실제 상태 변경은 4건뿐).

**근본 원인**: 변경 감지 로직이 `start_at`/`end_at`을 **문자열**로 비교(`prior.start_at !== startAt`)했다. Supabase(PostgREST)가 돌려주는 표현(`"2026-09-10T00:00:00+00:00"`)과, 매번 새로 `new Date(startRaw).toISOString()`로 계산한 표현(`"2026-09-10T00:00:00.000Z"`)은 **같은 시각인데 문자열이 다르다** — 문자열 비교로는 항상 "다르다"로 판정됐다.

**수정**: `src/lib/sync/timestamps.ts`의 `timestampsEqual()`(epoch 값, 즉 `new Date(x).getTime()` 비교)로 교체. `is_visible`은 그대로 boolean 비교 유지.

```ts
export function timestampsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = a ?? null, nb = b ?? null;
  if (na === nb) return true;
  if (na === null || nb === null) return false;
  const ta = new Date(na).getTime(), tb = new Date(nb).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return ta === tb;
}
```

**오염 데이터 정리**(`20260916030000_cleanup_bogus_campaign_visibility_logs.sql`): `timestamptz` 캐스팅 비교(애플리케이션과 동일 기준)로 실제로 값이 안 바뀐 로그만 정확히 골라 삭제(143건 중 139건 삭제, 실제 변경 4건은 보존). 영향받은 `promotions.last_important_change_at`은 남은 정상 로그 기준으로 재계산. `promotions`의 다른 필드나 permanent 상품은 전혀 건드리지 않았다.

**일반화된 교훈 (Phase 7 UI 개발 시에도 적용됨)**: **DB에서 온 timestamptz 값과 애플리케이션에서 새로 계산한 timestamp를 절대 문자열(`!==`)로 비교하지 않는다 — 항상 `new Date(x).getTime()`으로 변환해 비교한다.** 이 세션에서 같은 패턴("DB가 돌려주는 표현과 코드가 새로 만든 표현이 겉보기엔 다르지만 의미는 같을 수 있다")이 `promotion_sync_state`의 Row-존재-여부 오판정 버그(§11)에 이어 두 번째로 실제 사고를 냈다 — Phase 7에서 날짜/시각을 다루는 UI 로직(예: "종료 임박" 표시, NEW 72h 계산 등)을 짤 때 이 함정을 항상 의심할 것.

---

## 14. 현재 DEV 데이터 베이스라인 (2026-09-16, 직접 재확인 — 추정 아님)

DEV Supabase에 Service Role Key로 SELECT 전용 조회를 실행해 얻은 실측값이다.

| 항목 | 값 |
|---|---|
| `promotions` permanent — `is_active=true` | **188건** (예상과 일치) |
| `promotions` permanent — 전체(비활성 포함) | 190건 |
| `promotions` event — `is_active=true` | **16건** (예상과 일치) |
| `promotions` event — 전체(비활성 포함) | 17건 |
| `sync_logs` 최근 8건 `skipped_count` | 전부 **0** (예상과 일치) |
| `promotion_sync_state` | `permanent`: `initial_import_completed_at` = 2026-09-10T05:52:47Z / `event`: 2026-09-11T08:44:07Z — 둘 다 완료 상태 |
| `event_campaigns` | 2건 |

### ⚠️ 발견된 divergence — 테스트 잔재물 (실 데이터 아님, 그러나 DEV DB에 그대로 남아있음)

활성 건수(188/16)는 정확히 예상과 일치했지만, **비활성 상태로 남아있는 테스트 잔재물**이 있다는 것을 확인했다(단순 브랜드/제품명에 `test`(영문) 검색으로는 안 걸리고 한글 `테스트`로만 걸린다 — Phase 7에서 유사한 조사를 할 때 참고):

| product_id / campaign_key | 내용 | 상태 |
|---|---|---|
| `PROD-000238` | 브랜드/제품명 = "테스트2" (permanent) | `is_active=false` |
| `PROD-000232` | 브랜드/제품명 = "테스트" (permanent) | `is_active=false` |
| `PROD-RLS-TEST-HIDDEN` | "RLS테스트 / 비노출 캠페인 테스트 상품" (event) | `is_active=false` |
| `__test_promotion_rls_hidden_campaign__` | "RLS 테스트용 비노출 캠페인" | `is_visible=false` (비노출) |
| `DEV 테스트 행사` | 캠페인명 그대로 | **`is_visible=true`, 2026-09-10~2026-09-23 — 지금 이 순간 `event_campaigns_visible`에 실제로 노출 중** |

**"DEV 테스트 행사" 캠페인은 현재 실제로 노출 중 상태다.** Phase 7에서 행사 프로모션 UI를 만들고 DEV로 확인하면 이 테스트 캠페인이 실제 데이터처럼 화면에 나타날 것이다 — 혼동하지 말 것. 비활성 상품 3건은 `is_active=false`라 STAFF/STORE_MANAGER RLS에는 어차피 안 보이지만 ADMIN 화면에는 보일 수 있다.

이 잔재물들은 과거 수동 E2E 검증(RLS 테스트, onEdit 트리거 실제 Sheet 테스트 등) 과정에서 남은 것으로 보이며, `promotions`/`event_campaigns`를 실제로 수정하는 작업이라 **이 문서 작성 세션에서는 절대 건드리지 않았다**. 정리가 필요하다면 사용자 승인 후 별도 작업으로 진행할 것.

---

## 15. Auth / 권한 현재 상태 (Phase 5 완료)

- Role: `ADMIN` / `STORE_MANAGER` / `STAFF`. `profiles.role`.
- 매장 소속: `user_store_access`(N:M, 매장명 하드코딩 없음).
- **STORE_MANAGER의 "전체 매장(용인본점+동백점) 프로모션 전체 조회" 예외는 Phase 6.5에서 폐기됐다** — promotions 자체가 매장별로 분리돼 있지 않아 실질적 차이가 없었고, 유일하게 차이 나던 지점(비노출 행사 캠페인 조회)은 ADMIN 전용으로 좁혔다. **현재 STORE_MANAGER는 프로모션 도메인을 포함해 모든 기능에서 STAFF와 완전히 동일하다.** 매장별 데이터 분리가 실제로 생기면 재검토 대상.
- 자기 자신의 `role`/`is_active`는 STAFF/STORE_MANAGER가 스스로 변경 불가(ADMIN만 가능) — RLS로 강제, `test:rls` §6에서 실측 검증됨.
- 공지 Targeting: 전체/특정매장/복수매장/특정Role/특정사용자 — `test:rls`가 매장별 필터링이 실제로 동작함을 검증(본점/동백점 교차 확인).

상세: [permissions.md](./permissions.md)

---

## 16. RLS / 보안 주의사항 (반드시 지킬 것)

1. **이 DEV Supabase 프로젝트는 새 테이블마다 GRANT를 명시적으로 해줘야 한다.** `alter default privileges`를 걸어뒀지만 실무적으로는 매 신규 테이블 migration 끝에 `grant ... to anon, authenticated, service_role;`을 명시하는 패턴을 계속 따른다(Phase 5/6 둘 다 이거 없이 `permission denied` 실제로 발생).
2. **View는 기본적으로 RLS를 우회한다** — 이 프로젝트에서 실제로 재현·확인됨(§13 인접 사고, `event_campaigns_visible`). promotions 도메인에 새 View를 만들 때마다 반드시 `security_invoker = on`을 설정한다.
3. **PostgREST에서 GRANT 자체가 없으면 "permission denied" 에러, RLS만으로 막히면 에러 없이 0건 성공**이다. RLS 테스트를 짤 때 error 유무만 보지 말고 항상 Service Role로 재조회해 실제 DB 값이 안 바뀌었는지 확인한다.
4. anon/authenticated GRANT는 최소 권한(SELECT 위주, `promotion_field_definitions`만 authenticated UPDATE 허용 — Phase 12 Admin Field 설정 화면용)으로 좁혀져 있다. Sync 쓰기는 Service Role 전용.
5. **절대 원칙**: Supabase Secret Key, VAPID Private Key는 클라이언트에 절대 노출하지 않는다. `.env*`는 커밋하지 않는다. 이 문서를 포함해 어떤 `docs/*.md`에도 실제 Secret 값을 적지 않는다(§18 참조).

---

## 17. 환경변수 이름 목록 (값은 기재하지 않음 — `.env.local`에만 존재, git 미추적)

실제 값은 이 문서는 물론 어떤 문서에도 적지 않는다. 새 채팅에서 필요하면 `.env.local`을 직접 읽어 확인할 것(사용자 로컬 파일이며 커밋 대상 아님).

| 변수명 | Scope | 용도 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Client + Server | RLS 적용되는 공개 키(구 anon key 체계의 신규 명칭) |
| `SUPABASE_SECRET_KEY` | **Server 전용** | RLS 우회(구 Service Role Key 체계의 신규 명칭). `server-only` import로 클라이언트 번들 유입 차단됨 |
| `SUPABASE_DB_URL` | Server 전용 | `scripts/migrate.ts` 등 직접 Postgres 연결용 |
| `SYNC_API_SECRET` | Server 전용 | Apps Script → Sync API Bearer 인증 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Client + Server | Web Push 구독 등록용 |
| `VAPID_PRIVATE_KEY` | **Server 전용** | Web Push 발송 서명 — 절대 클라이언트 노출 금지 |
| `VAPID_SUBJECT` | Server 전용 | VAPID `mailto:` subject |
| `SYNC_DEACTIVATION_MAX_RATIO` | Server 전용(옵션) | 대량 비활성화 안전장치 비율 임계치, 기본 0.5 |
| `SYNC_DEACTIVATION_MAX_ABSOLUTE` | Server 전용(옵션) | 대량 비활성화 안전장치 절대값 임계치, 기본 50 |

Apps Script 쪽 별도 Secret(Script Properties, 이 저장소 밖에 존재): `SYNC_API_BASE_URL`, `SYNC_API_SECRET`(Next.js와 동일 값). ngrok을 쓴다면 ngrok authtoken도 Apps Script 저장소 밖에 있다 — 이 문서에는 값도, 존재 위치 외의 정보도 기재하지 않는다.

---

## 18. Secret Rotation 상태

**Secret 교체(rotation)는 완료된 상태다** (2026-09-15 언급된 검증 작업 — `sync_mode`/`received_row_count` 로깅이 이 교체 검증 과정에서 필요해져 추가됐다, §7 참조). 실제 값은 이 문서에 없고, 앞으로도 어떤 문서에도 기록하지 않는다. 다음 Secret 교체가 필요해지면 `apps-script/README.md` §1~§3 절차를 그대로 따르면 된다(Script Properties 갱신 + `.env.local` 갱신, 코드 하드코딩 금지).

---

## 19. Phase 0~6 주요 버그/사고 요약표

| # | 시점 | 사고/버그 | 근본 원인 | 수정 |
|---|---|---|---|---|
| 1 | Phase 0~4 | TypeScript 7 / ESLint 10 비호환 | 툴체인 버전 조합 문제 | 버전 pin |
| 2 | Phase 4 | `middleware.ts` 관례 deprecated | Next.js 16 컨벤션 변경 | `src/proxy.ts`로 이관 |
| 3 | Phase 6.5 | `event_campaigns_visible` View가 RLS 우회 | Postgres View는 기본적으로 Owner 권한(RLS 우회)으로 실행 | `security_invoker=on` |
| 4 | Phase 6 | `is_initial_import`이 Hard Delete 후 재Sync 시 오판정 가능 | "Row 0건"이라는 휘발성 조건으로 상태 판단 | `promotion_sync_state` 영구 상태 테이블 |
| 5 | 2026-09-11 | **대량 비활성화 사고**(실 데이터 188건 중 187건 비활성화) | "이번 Sync에 없으면 무조건 비활성화" 안전장치 부재 | `sync_mode`(full_snapshot/partial) + 비율·절대값 임계치 |
| 6 | Phase 6 | `updated_at` 불필요 갱신 | 값이 안 바뀐 필드까지 매번 SET | 변경된 필드만 SET |
| 7 | 2026-09-15 | `flushPendingSync` pending 유실(dev server 순단 중 편집 누락) | API 호출 **전에** pending 삭제 | 2xx 성공 시에만 삭제 + 재시도/백오프 분류 |
| 8 | 2026-09-16 | 재부팅 후 disabled `flushPendingSync` 트리거 누적 | Property 플래그가 실제 트리거 존재 여부와 어긋날 수 있음 | `ScriptApp.getProjectTriggers()` 직접 확인 + 자가 치유 |
| 9 | 2026-09-16 | `push_eligible`이 `importance='minor'`에도 기본값(true) 유지 | 두 컬럼을 완전 독립 축으로 설계 | `promotion_change_logs_minor_not_push_eligible` CHECK 제약 |
| 10 | 2026-09-16 | `event_campaigns` 변경 감지 오탐(143건 오염 로그) | timestamptz를 문자열로 비교 | `timestampsEqual()`(epoch 비교), 오염 로그 정리 |
| 11 | 2026-09-16 | 스킵된 Row(브랜드/제품명 공백)가 무기록으로 `continue` | 정상 스킵도 감사 기록이 없었음 | `sync_logs.skipped_count`/`skipped_detail` |

---

## 20. 테스트 스위트 — 이 문서 작성 직전 재실행해 확인한 실제 값 (2026-09-16)

모든 명령을 실제로 재실행해 확인했다(추정치 아님). 결과는 사용자가 제시한 마지막 확인값과 **전부 정확히 일치**한다.

| 명령 | 대상 | 결과 |
|---|---|---|
| `npm run test:sync:safety` | 순수 함수(DB 없음) | **10 / 10 PASS** |
| `npm run test:apps-script:retry` | 순수 함수(DB 없음) | **15 / 15 PASS** |
| `npm run test:apps-script:trigger-lifecycle` | in-memory mock(DB 없음) | **11 / 11 PASS** |
| `npm run test:timestamps-equal` | 순수 함수(DB 없음) | **12 / 12 PASS** |
| `npm run test:promotion-rls` | DEV DB(읽기+격리 계정) | **12 / 12 PASS** |
| `npm run test:rls` | DEV DB(읽기+격리 계정) | **19 / 19 PASS** |
| `npm run test:sync` | DEV DB(E2E, 자체 생성 데이터는 `finally`에서 스스로 정리) | **40 / 40 PASS** |

`test:sync` 실행 후 로그에 "정리 완료: 테스트 상품 5건, 캠페인/Dynamic Field 정의 제거 — 실 데이터는 그대로 유지됨"이 출력됨을 직접 확인했고, 실행 전후 `git status`가 clean임도 재확인했다(테스트 스크립트는 소스 코드를 건드리지 않는다).

**절대 실행하면 안 되는 명령**: `npm run db:clean:promotions` — 실 Sheet에서 들어온 라이브 데이터까지 전부 지운다(CLAUDE.md에 명시). Phase 7 개발 중에도 이 명령은 쓰지 않는다.

---

## 21. Phase 7 시작 상태 — Promotion UI

Phase 6까지 완료된 것: **DB 스키마 + Sync 엔진 + Apps Script + RLS 전부 실 데이터로 검증 완료.** Phase 7은 이 위에 **읽기 전용 UI**를 쌓는 작업이다.

**Sync Engine은 Phase 7에서 변경할 필요가 없다.** UI는 이미 채워진 `promotions`/`event_campaigns`/`promotion_change_logs`/`event_campaigns_visible`을 Supabase 클라이언트(`src/lib/supabase/server.ts` 또는 `client.ts`, RLS 그대로 적용)로 읽기만 하면 된다.

Phase 7이 구현해야 하는 것 (product-requirements.md §4.2~§4.4 기준):

- **상시 프로모션 리스트**: 브랜드 검색/필터, 통합검색(브랜드/제품명/컬러), Mobile Card View / Desktop Table View
- **행사 프로모션**: `event_campaigns` 단위 그룹핑 표시, 노출 조건 만족 캠페인만(`event_campaigns_visible` 활용), 상시와 시각적으로 명확히 구분, 다중 캠페인 동시 지원
- **상품 상세**: 가격 2종(카드/현금), 사은품, 구성품, 매장별 운영조건, 포토후기 혜택
- **NEW (최근 72시간)**: §10 기준 그대로, 무엇이 바뀌었는지(before→after) 카드에 직접 표시
- **변경 요약**: `promotion_change_logs` 활용
- **Dynamic Field 렌더링**: `promotion_field_definitions.is_visible=true`인 필드를 `extra_fields`(JSONB)에서 동적으로 읽어 표시(하드코딩 금지 — 새 컬럼이 추가돼도 UI 코드 재배포 없이 보여야 한다는 것이 핵심 요구사항)
- **Mobile-first UX**: 직원 화면은 Bottom Navigation(`[홈][프로모션][공지][교육자료][MY]`), 프로모션 탭 내부 `상시`/`행사`/`NEW` 서브탭

성능/비기능 요구사항: 188~수천 SKU 규모까지 서버사이드 검색/페이지네이션(전체 로드 후 client filter 지양), 가격/프로모션 데이터는 Stale Cache 금지(Network First).

상세: [product-requirements.md](./product-requirements.md) §1, §3, §4.1~§4.4

---

## 22. Phase 7에서 사용자 승인 없이 절대 바꾸면 안 되는 것

아래 항목을 변경해야 할 필요가 생기면, **먼저 이유/영향 범위를 사용자에게 보고하고 승인을 받은 뒤에만** 진행한다.

1. Google Sheet 컬럼 구조/헤더 이름 (Sync 매핑이 깨짐)
2. `apps-script/Sync.gs`의 Sync 로직(트리거/디바운스/재시도/Loop 방지)
3. `product_id` 채번 전략(서버 자동 채번, 되쓰기는 이 컬럼 1개에만 한정)
4. `sync_mode`(`full_snapshot`/`partial`) 구분과 그 의미
5. 대량 비활성화 Safety Guard(임계치, 판정 로직)
6. RLS 정책 구조(특히 `promotions_select`/`event_campaigns_select`의 ADMIN vs STAFF/STORE_MANAGER 분기)
7. NEW/Push Change Classification 기준(`promotion_field_definitions.change_importance`/`push_enabled`, 72h Rolling)
8. 행사 노출 로직(ON/OFF × 기간 매트릭스, `event_campaigns_visible` 뷰의 재계산 방식)
9. Initial Import Push 제외 정책(`promotion_sync_state`/`is_initial_import`/`push_eligible`)

Phase 7은 순수 읽기 UI이므로 위 9개를 건드릴 이유가 원칙적으로 없어야 한다 — 만약 UI 요구사항 때문에 이 중 하나를 건드려야 할 것 같다면, 그 자체가 "설계를 다시 검토해야 한다"는 신호로 보고 먼저 사용자와 상의할 것.

---

## 23. 지금 커밋이 필요한가? (판단, 실행은 사용자 승인 후)

- **현재 working tree는 이 문서(`docs/PHASE7_HANDOFF.md`)를 제외하면 clean**이고 HEAD(`591adf1`)는 마지막 checkpoint와 정확히 일치한다.
- 이 문서 작성을 위해 실행한 모든 조사/테스트는 소스 코드나 DEV 데이터를 전혀 바꾸지 않았다(읽기 전용 + 자체 정리되는 테스트).
- **판단**: 이 문서(`docs/PHASE7_HANDOFF.md`) 자체는 새로 추가된 파일이므로, 새 채팅으로 넘어가기 전에 **커밋해두는 것을 권장한다** — 그래야 이 인수인계 문서 자체도 Git 이력으로 보존되고, 다음 Phase 7 작업 커밋과 섞이지 않는다. 다만 이는 destructive 작업이 아닌 일반적인 파일 추가 커밋이므로 실행 여부는 사용자 승인에 따른다(**이 세션은 사용자 승인 없이 커밋을 실행하지 않았다** — CLAUDE.md 원칙 및 "사용자가 명시적으로 요청할 때만 커밋" 원칙 준수).
- 권장 커밋 메시지 예시(실행은 사용자 지시 시):
  ```
  docs: add Phase 7 handoff document
  ```

---

## 24. 절대 지켜야 할 Secret 처리 규칙 (이 문서 자체에도 적용됨)

- 이 문서에는 Supabase Secret Key, DB 비밀번호, 전체 DB 연결 URL, `SYNC_API_SECRET`, ngrok authtoken, VAPID Private Key의 **실제 값을 단 하나도 적지 않았다** — §17에 환경변수 **이름**만 나열했다.
- **최종 Secret Scan 결과**(이 파일 작성 완료 직후 직접 재검토): 위 6종 Secret의 실제 값 패턴(예: base64 문자열, `postgres://...` 형태의 연결 문자열, `sk-`/`eyJ` 등 키 형태 문자열)이 이 문서 어디에도 없음을 확인했다. 이 문서에 등장하는 모든 코드 스니펫(`timestampsEqual`, RLS 정책, View 정의 등)은 로직만 담고 있으며 실제 자격증명을 포함하지 않는다.
- 앞으로 이 문서를 갱신할 때도 이 규칙을 유지할 것.

---

## 25. BOOTSTRAP INSTRUCTIONS — 새 Claude Code 채팅이 처음 할 일

새 채팅에서 사용자가 이 문서를 붙여넣거나 경로를 알려주면, 아래 순서로 진행한다.

1. **이 문서(`docs/PHASE7_HANDOFF.md`) 전체를 정독**한다 — Phase 0~6의 설계 결정과 현재 상태를 파악한다.
2. `git status`, `git log --oneline -5`를 실행해 이 문서가 설명하는 상태(HEAD `591adf1` 또는 그 이후 커밋)와 실제 저장소 상태가 일치하는지 확인한다.
3. `/CLAUDE.md`를 다시 읽어 절대 원칙 13개와 이후 추가된 lessons-learned 로그를 확인한다(이 문서 이후 추가된 내용이 있을 수 있다).
4. §21(Phase 7 시작 상태)과 §22(절대 바꾸면 안 되는 것 목록)를 다시 한번 확인한다.
5. Phase 7 UI 작업에 필요한 만큼만 `docs/product-requirements.md`, `docs/database-schema.md`, `docs/permissions.md`를 열어 상세를 확인한다(이 문서가 요약해준 것 이상이 필요할 때).
6. `npm run dev`로 로컬 서버가 이미 떠 있는지 확인한다(사용자가 실 Sheet E2E 테스트를 계속 진행 중일 수 있으므로, 이미 떠 있다면 **임의로 재시작/종료하지 않는다**).
7. §14(현재 DEV 데이터 베이스라인)의 테스트 잔재물 안내를 숙지한다 — 특히 "DEV 테스트 행사" 캠페인이 실제로 노출 중이라는 점.
8. UI 구현을 시작하기 전, 어떤 화면부터 만들지(예: 상시 프로모션 리스트부터? 상세 페이지부터?) 사용자와 먼저 합의한다 — 전체를 한 번에 만들지 않는다(Phase 단위 원칙).
9. 구현 중 §22의 9개 항목 중 하나라도 건드려야 할 것 같으면, 먼저 멈추고 사용자에게 이유/영향을 보고한 뒤 승인을 받는다.
10. 각 기능 단위 완료 시 lint/typecheck/build를 실제로 돌리고, UI 변경은 브라우저에서 실제 동작을 확인한 뒤에만 "완료"로 보고한다(CLAUDE.md 개발 원칙).

---

*이 문서는 2026-09-16에 저장소를 직접 재조사하고 DEV Supabase를 읽기 전용으로 조회하며 기존 테스트 스위트를 재실행해 작성됐다. Production/DEV 데이터는 전혀 수정하지 않았다.*
