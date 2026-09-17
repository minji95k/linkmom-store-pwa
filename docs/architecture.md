# Architecture (Phase 2)

## 1. Tech Stack 결정

| 영역 | 선택 | 이유 |
|---|---|---|
| Frontend | Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui | SSR/ISR로 캐시 신선도 제어 용이, Vercel과 궁합, 컴포넌트 재사용성 |
| Backend/DB | Supabase (PostgreSQL, Auth, Realtime, Storage, RLS) | Auth+DB+Storage+Realtime을 한 벤더로 통합, RLS로 매장별 권한을 DB 레벨에서 강제 가능 |
| Sync | Google Apps Script → 자체 Next.js API Route(Server-only) → Supabase | Service Role Key를 Apps Script/Client에 노출하지 않기 위한 중계 계층 |
| Push | Web Push 표준(VAPID) + Service Worker | Native App 없이 OS Push 가능, 벤더 종속 없음 |
| Deploy | Vercel | Next.js 공식 지원, Preview 배포로 안전한 검증 |

과도한 Infra(별도 Message Queue, Kubernetes 등)는 현재 규모(SKU 수백~수천, 매장 수십 이내)에 불필요하므로 도입하지 않는다.

## 2. System Architecture

```
Google Spreadsheet ([상시 프로모션] / [행사 프로모션])
        │  onEdit / 정기 Trigger
        ▼
Google Apps Script  ── (Bearer Token 인증) ──▶  Next.js API Route (/api/sync/*)
                                                        │
                                                        │ Service Role Key(서버 전용)
                                                        ▼
                                                Supabase PostgreSQL
                                        (promotions, promotion_change_logs, sync_logs, ...)
                                                        │
                                          ┌─────────────┼──────────────┐
                                          ▼             ▼              ▼
                                   Supabase Realtime   Change 감지    Push 발송 대상 계산
                                          │             │              │
                                          ▼             ▼              ▼
                              열려있는 직원 PWA      NEW/변경표시 갱신   Web Push (VAPID)
                              (자동 갱신 Toast)                          │
                                                                        ▼
                                                              직원 Device (Service Worker)
```

- **One-way Sync 원칙**: Spreadsheet → Supabase만 존재. 직원 PWA에서 원본 프로모션 데이터를 역으로 수정하지 않는다(§12).
- Apps Script는 Supabase Service Role Key를 절대 갖지 않는다. 자체 API가 인증(고정 Secret 또는 서명)을 검증한 뒤에만 Supabase에 쓴다.

## 3. Core Field + Dynamic Field 아키텍처

실측 결과([current-system-analysis.md](./current-system-analysis.md) §3) 현재 알려진 컬럼은 모두 Core Field로 매핑 가능하지만, §26~§33 요구사항에 따라 향후 컬럼 증가에 대비한 Hybrid 구조를 채택한다.

```
Spreadsheet Header 1행 읽기
        │
        ▼
알려진 Header? ──Yes──▶ promotion_field_definitions.source_column_name 매칭
        │                       ▼
        │                 지정된 Core Column에 저장 (promotions.price 등)
        No
        │
        ▼
신규 Header 감지
        │
        ▼
promotion_field_definitions 자동 생성 (Safe Default: 표시 ON / 검색 OFF / Filter OFF / NEW OFF / Push OFF / type=text)
        │
        ▼
promotions.extra_fields (JSONB)에 { "표시라벨": "값" } 저장
        │
        ▼
상품 상세 화면에서 extra_fields를 display_order대로 순회 렌더링 (재배포 불필요)
```

**재배포 없이 가능한 것**: 신규 일반 컬럼 저장/Sync/텍스트 표시, Admin이 Field 표시설정(ON/OFF, 순서, 검색/필터/NEW/Push 대상 여부) 변경.

**추가 개발이 필요한 것**: 새 컬럼이 가격 계산식·특수 UI·새 권한 로직·복잡 검색·새 Workflow·새 Push 정책을 요구하는 경우 (§33).

**주의(실측 기반)**: `수정일`, `NEW`, `최근 수정 건수`, `🔐 Softr Record ID`는 Softr 자체 메타 컬럼으로, Dynamic Field 자동 감지 대상에서 **명시적으로 제외**한다(Sync 설계 §sync-design.md 참조). 특히 `최근 수정 건수`는 상품별 데이터가 아니라 요약 통계 셀이 섞여 들어간 것으로 확인되었으므로 그대로 Dynamic Field화하면 오염된다.

## 4. Event Campaign 아키텍처

```
event_campaigns (캠페인 메타: 이름/시작일/종료일/노출여부)
        │ 1:N
        ▼
event_campaign_products (캠페인별 상품 스냅샷 — promotions와 별도 테이블)
```

**노출 판정 함수** (서버/DB에서 계산, 클라이언트 신뢰 안 함):
```
is_visible_now(campaign) =
    campaign.is_visible = true
    AND now() BETWEEN campaign.start_at AND campaign.end_at
```
- `is_visible=false` → 무조건 비노출
- `is_visible=true` 이고 시작 전 → 비노출(또는 "예정행사" UX)
- `is_visible=true` 이고 종료 후 → 자동 비노출 (담당자가 OFF를 깜빡해도 안전 — DB 함수/View가 시간 조건을 항상 재계산하므로 별도 배치 Job 없이도 정확)
- 삭제 아닌 Soft 처리이므로 종료된 행사 데이터는 그대로 보존됨

다중 캠페인 동시 운영을 기본 가정 (§25) — 캠페인 목록을 하드코딩하지 않음.

## 5. Change Classification 엔진 (NEW + Push 공유)

```
Sync 시 before/after 비교
        │
        ▼
changed_fields = diff(before_core_fields, after_core_fields)
        │
        ▼
promotion_field_definitions에서 각 field의 change_importance 조회
        │
        ▼
importance = max(changed_fields의 importance)  // critical > important > minor
        │
        ├─ importance != minor → promotion_change_logs insert
        │                         → promotions.last_important_change_at = now()
        │                         → NEW 탭 후보 (rolling 72h)
        │                         → push_enabled 필드 포함 시 Push 대상 큐에 적재
        │
        └─ importance = minor → change log만 기록(선택), NEW/Push 제외
```

동일한 `promotion_field_definitions.change_importance` / `push_enabled`를 NEW 판정과 Push 판정이 **함께 참조**하여 §47 요구사항(다른 로직 금지)을 코드 레벨에서 보장한다.

## 5.5 Realtime 아키텍처 (Phase 10, 2026-09-17 완료 — 실 Google Sheet E2E까지 검증됨)

`supabase_realtime` Publication에 **3개 테이블만** 추가한다(무분별한 전체 구독 금지, §10) — `promotions`/`event_campaigns`/`notices`. `notice_reads`/`promotion_change_logs` 등은 구독하지 않는다.

```
Supabase 테이블 UPDATE/INSERT (Sync API 또는 Admin 화면)
        │
        ▼
Supabase Realtime (postgres_changes, RLS 그대로 적용됨 — 실측 확인, 아래 참조)
        │
        ▼
createRealtimeSubscription(src/lib/realtime/subscription.ts)
  — mount/unmount/재구독 방지 등 구독 생명주기를 React에서 분리한 순수 함수
        │
        ▼
createDebouncer(src/lib/realtime/debounce.ts) — 600ms trailing-edge debounce로
여러 이벤트를 1회 반응으로 합침(예: 한 상품의 카드가+현금가 동시 변경, 행사 상품
16건 동시 변경 등 — 전부 배너 1회로 실측 확인)
        │
        ├─ RealtimeUpdateBanner(Client Component) — 페이지별로 "새로운 정보가
        │  업데이트되었습니다" 배너만 띄움(자동 리렌더/스크롤 리셋 없음)
        │
        └─ BottomNav 공지 미확인 뱃지(src/components/bottom-nav.tsx) — 페이지
           이동 없이도 notices INSERT/UPDATE를 감지해 `/api/notices/unread-count`
           (세션 쿠키 기반, RLS 적용)로 재조회. Realtime payload로 대상 여부를
           판단하지 않고 항상 이 API의 RLS 재계산 결과만 신뢰한다.
        │
        ▼
사용자가 [새로고침] 클릭 → router.refresh() → 서버가 RLS 그대로 재조회
```

- **RLS 적용 여부는 추측하지 않고 실측했다**(`scripts/test-realtime-rls.ts`, 4/4 PASS): STAFF 세션으로 비활성 상품/다른 매장 공지 UPDATE를 구독하면 이벤트가 안 오고, 자신이 볼 수 있는 행의 UPDATE는 정상 수신됨을 직접 확인했다.
- **함정(실측)**: 브라우저 클라이언트(`createBrowserClient`)는 쿠키에서 세션을 비동기로 읽는다. `channel.subscribe()`를 세션 로드 전에 호출하면 Realtime 소켓이 anon 권한으로 붙어버려(구독 자체는 "SUBSCRIBED"로 성공한 것처럼 보이지만) RLS가 전부 막아 이벤트가 하나도 안 오는, 겉보기엔 정상인데 실제로는 조용히 죽어있는 상태가 된다. `supabase.auth.getSession()`으로 세션을 먼저 확보하고 `supabase.realtime.setAuth(token)`을 명시적으로 호출한 뒤에만 구독해야 한다 — `createRealtimeSubscription`에 구현.
- Realtime payload 자체는 신뢰하지 않는다 — 검색/필터/페이지네이션이 서버 쿼리 기준이라, "새 데이터가 있다"는 신호로만 쓰고 실제 데이터는 항상 RLS가 적용된 서버 재조회(`router.refresh()` 또는 `/api/notices/unread-count`)로 가져온다.
- **구독 생명주기 자동 회귀 테스트**(`scripts/test-realtime-subscription-lifecycle.ts`, 19/19 PASS): mount/unmount/빠른 재진입/여러 번 mount-unmount/동시 구독 등을 in-memory mock Supabase 클라이언트로 검증한다. React 컴포넌트 테스트 프레임워크가 이 프로젝트에 없어서, Apps Script 트리거 생명주기를 mock으로 격리 테스트했던 것과 같은 패턴을 따르되 실제 프로덕션 코드(`createRealtimeSubscription`)를 그대로 import해서 검증한다(순수 TS라 복제본이 필요 없음).
- **debounce/coalesce 자동 테스트**(`scripts/test-realtime-debounce.ts`, 6/6 PASS).
- **실 Google Sheet E2E로 검증 완료**(2026-09-17): 상시 프로모션 카드가 변경(1행), 사은품 변경(관련 없는 다른 상품과 동시 변경 → 필터 정확성 확인), 행사 프로모션 종료일 변경(같은 캠페인의 16개 행을 동시 변경 → 배너 1회만 표시, 캠페인 중복 생성 없음, `event_campaign_products` 연결 16건 유지)까지 전부 실제 Sheet 편집 → onEdit → Sync → Realtime → 배너 → 새로고침 → 최신값 확인 경로로 실측했다. `sync_logs.updated_count`는 `promotions` 행 변경만 집계하므로, 행사 캠페인 메타데이터(종료일 등)만 바뀐 Sync는 `updated_count: 0`이어도 정상이다 — 실제 반영 여부는 항상 `event_campaigns.updated_at`/해당 컬럼 값으로 확인해야 한다.
- **주의(세션 관련, Phase 10 코드와 무관)**: 브라우저 탭을 매우 오래 유지하며 여러 번 재로그인을 반복하면 쿠키 세션이 일시적으로 꼬여 Server Component 렌더링이 `42501`(Postgres insufficient_privilege)로 실패하는 사례를 관측했다. 같은 사용자로 재로그인하면 즉시 정상화되었고, Service Role/동일 사용자 세션으로 직접 재현했을 때는 오류가 나지 않아 RLS/GRANT 문제가 아님을 확인했다 — Realtime/Phase 10 코드가 원인이 아니라 세션 쿠키 갱신 관련 기존 이슈로 추정된다(별도 Phase에서 필요 시 재조사).

## 6. Push 아키텍처 개요

상세는 [push-design.md](./push-design.md). 핵심: Change 감지 → Push 대상 큐 적재 → Batching Window(예: 2~5분) 내 다건 발생 시 Summary 1건으로 통합 → 대상자(Store/Role 기준) 필터링 → Delivery.

## 7. PWA / Cache 전략

- Service Worker는 앱 셸(정적 자산)만 캐시하고, 프로모션/가격 API 응답은 **Network First** 또는 `no-store`로 처리하여 §74 요구사항(오래된 가격 노출 금지) 충족.
- 새 버전 배포 시 SW `skipWaiting` + `clients.claim` + 클라이언트 새 버전 안내 배너.

## 8. Deployment Architecture

- Vercel: Next.js 앱 (Preview/Production 환경 분리)
- Supabase: Production 프로젝트 1개(+ 필요 시 개발용 프로젝트 별도) — Migration은 Supabase CLI/SQL migration 파일로 버전 관리
- Google Apps Script: 별도 배포(시트에 바인딩), 서버 API 엔드포인트만 바라봄

## 9. 관련 문서

- [database-schema.md](./database-schema.md) — 전체 Entity/ERD
- [permissions.md](./permissions.md) — Role/RLS
- [sync-design.md](./sync-design.md) — Multi-sheet Sync 상세
- [push-design.md](./push-design.md) — Push 상세
