# Phase 12 개발 인수인계 문서 (Minimum Admin — 직원 계정 관리)

> **이 문서의 목적**: 현재 대화의 컨텍스트 윈도우가 가득 차서, 새로운 Claude Code 채팅에서 Phase 12(Minimum Admin)를 이어서 진행한다. 이 문서 하나만 읽으면 Phase 0~11의 설계 결정과 현재 저장소/DEV Supabase 실제 상태를 잃지 않고 정확히 이어서 작업할 수 있도록 작성했다.
>
> **작성 방식**: 이전 대화의 기억을 요약한 것이 아니다. 2026-09-18에 아래를 **직접 다시 읽고 재실행**해 검증한 결과다: `git status`/`git log`/`git rev-parse HEAD`, `supabase/migrations/` 29개 파일 전체 목록 + Auth/Role/Store 관련 4개 migration 전문, `docs/*.md` 9개 파일 목록, `package.json`(scripts 전체), 관련 테스트 스위트 11종 전체 재실행, DEV Supabase 읽기 전용 조회(profiles/stores/push_subscriptions 건수/promotions 활성 건수), 현재 `src/app/admin/` 디렉터리 전체 목록(기존 User 관리 코드가 정말 없는지), dev/prod/ngrok 3개 환경 HTTP 응답. **이 문서 작성 중 Production/DEV의 어떤 데이터도 수정하지 않았다** — 실행한 것은 읽기 전용 조회와 이미 자체 정리되는 기존 테스트 스위트뿐이다. Phase 12 코드는 한 줄도 작성하지 않았다.

---

## 1. Git 상태 (2026-09-18, 이 문서 작성 직전 재확인 — 추정 아님)

```
branch: master
HEAD:   5334ebcc6017f4e10ab37b76fb4ee4ab04f3587b
commit message: "Phase 11 complete: web push verified"
working tree: clean (git status 재확인 완료)
```

**Phase 5~11 주요 checkpoint 커밋** (`git log --oneline -20`으로 직접 재확인, 해시/메시지 전부 일치):

| 커밋 | 내용 |
|---|---|
| `464703a` | Phase 5: auth authorization and RLS verified |
| `a4f41fb` | Phase 6 checkpoint: promotion schema + sync engine (Sheet↔Apps Script E2E pending) |
| `ec63965` | Phase 6.5: harden sync safety guards |
| `f4f7906` | Phase 6.5: sync_logs audit columns (sync_mode/received_row_count) + onEdit trigger |
| `591adf1` | Phase 6 complete: Google Sheet sync verified |
| `d0d5ae1` | docs: add Phase 7 handoff document |
| `affd020` | Phase 7 complete: promotion UI verified |
| `84cfdab` | Phase 8 complete: notice system verified |
| `457c262` | Phase 9 skip + Phase 10 realtime WIP |
| `88d9760` | Phase 10 complete: realtime updates verified |
| `5334ebc` | **Phase 11 complete: web push verified (현재 HEAD)** |

Uncommitted 변경사항 없음 — Phase 12는 완전히 깨끗한 상태에서 시작한다.

---

## 2. 프로젝트 최종 목적 (반드시 먼저 이해할 것)

- 링크맘 매장 직원용 **Closed Internal PWA** — 고객용 서비스가 아니다, Public 회원가입 없음.
- **Native App/App Store 앱이 아니다** — Mobile First Responsive PWA, 직원이 모바일 홈 화면에 설치해 사용(Phase 11에서 실제 iPhone 홈 화면 설치까지 검증 완료).
- **ADMIN이 직원 계정을 생성/관리한다** — 지금까지는 이 부분이 전혀 구현되지 않았고(§9 참조), `scripts/seed.ts`로 만든 DEV 테스트 계정 4개만 존재한다(§7 실측 확인).
- Role 3종: `ADMIN`(본사 관리자) / `STORE_MANAGER`(프로모션 조회 외 STAFF와 동일) / `STAFF`(매장 직원).
- 매장은 현재 **용인본점(HQ), 동백점(DONGBAEK)** 2곳, 향후 추가 예정 — 코드 어디에도 매장명/개수를 하드코딩하지 않는다(기존 원칙, Phase 12도 동일하게 지킨다).

---

## 3. Phase 0~11 진행 상태 요약

| Phase | 상태 |
|---|---|
| 0~6 (분석/요구사항/아키텍처/Foundation/Auth/Promotion Sync) | ✅ 완료 |
| 7 (Promotion UI) | ✅ 완료 |
| 8 (Notice) | ✅ 완료 |
| 9 (Training) | **SKIPPED** — Notice System(`notice_type='교육'`)으로 흡수 |
| 10 (Realtime) | ✅ 완료 |
| 11 (Web Push) | ✅ 완료 — 실 iPhone Safari PWA E2E 검증까지 완료 |
| **12 (Minimum Admin)** | **← 다음 단계, 미구현** |
| 13 (Security Review) | 예정 |
| 14 (QA) | 예정(Phase 10/11에서 남긴 QA 재확인 항목 있음, §11 참조) |
| 15 (Production) | 예정 |

**Phase 12는 고급 Admin 구축이 아니다** — Production 배포 전 본사 ADMIN이 실제 직원 계정을 안전하게 생성/관리할 수 있는 **최소 기능만** 구현한다(§14).

---

## 4. Phase 6 핵심 구조 (Phase 12에서 수정 대상 아님)

```
Google Sheet(Source of Truth) → Google Apps Script → Next.js Sync API → Supabase
```

- `[상시 프로모션]` / `[행사 프로모션]` — 별개 Source Sheet, 하나로 합치지 않음
- `product_id` 서버 자동 채번 + Sheet 되쓰기(round-trip)
- `sync_mode`: `partial`(onEdit, 기본값, Soft Delete 로직 자체 미실행) / `full_snapshot`(10분 `syncAll`, Safety Guard 통과해야 비활성화 실행)
- onEdit 3초 디바운스, pending은 API 2xx 성공 후에만 제거, 재시도/백오프
- Core Field vs Dynamic Field(JSONB `extra_fields`) 구분
- `promotion_change_logs` + Change Classification(`importance`/`push_eligible`) — NEW 72h·Push가 **동일 기준 공유**
- Event Visibility(`event_campaigns_visible`, `security_invoker=on`)
- Initial Import 상품은 Push 소급 발송 제외(`promotions.is_initial_import`, `promotion_sync_state`)

**Phase 12는 이 구조를 전혀 건드리지 않는다** — `src/lib/sync/`, `apps-script/`는 참조도 필요 없다.

---

## 5. Phase 7 Promotion UI 완료 상태 (재설계 금지)

실 코드 기준(`src/app/(staff)/promotions/`, `src/components/promotions/`) 확인된 기능:

- 홈(EventCampaignBanner + 최근 72h 요약), 프로모션 목록(상시/행사/NEW 탭), 검색/브랜드 필터/정렬
- 상품 상세(`PriceLines` — 소비자가/기준판매가/카드판매가/현금·계좌이체 고정 라벨+색상, `DetailRow` — 기본구성품/증정사은품/포토후기/매장 프로모션/매장 별 운영/행사 기간/비고), 행사 캠페인 상세, 변경 이력
- Dynamic Field 렌더링(`DynamicFieldsList`, `is_visible=true`만)
- 카드/상세 레이아웃은 2026-09-17 사용자 지정 스펙으로 확정됨 — **Phase 12에서 절대 재설계하지 않는다**.

---

## 6. Phase 8 Notice 완료 상태 (read/confirm 시맨틱 변경 금지)

- `notices`(+`external_link`, `author_name`) / `notice_targets`(all/store/role/user) / `notice_reads`(read_at, confirmed_at 별개 상태) / `attachments`(private Storage, Signed URL)
- 게시 기간(`published_at`/`expires_at`) RLS로 강제
- ADMIN CRUD + Targeting + Audience Summary, Bottom Nav 미확인 뱃지(Phase 10에서 실시간화)
- Training Material 전용 시스템은 만들지 않는다 — Notice로 완전히 대체(`notice_type='교육'` 포함, Phase 9 SKIP 결정).
- ⚠️ **기존 Admin 공지 관리(`src/app/admin/notices/`)는 Phase 12가 참고할 유일한 실제 Admin 화면 예시다** — 새 User 관리 화면도 이 폴더 구조/패턴(`layout.tsx` role 게이트, Server Action, `requireAdmin()` 로컬 헬퍼)을 그대로 따르는 것을 권장한다.

---

## 7. Phase 10 Realtime 완료 상태

```
Supabase postgres_changes(promotions/event_campaigns/notices만 publication)
  → createRealtimeSubscription(src/lib/realtime/subscription.ts, 순수 함수, mock으로 격리 테스트)
  → createDebouncer(src/lib/realtime/debounce.ts, 600ms)
  → RealtimeUpdateBanner / Bottom Nav 공지 뱃지(/api/notices/unread-count)
  → 사용자가 [새로고침] 클릭 → router.refresh() → 서버 RLS 재조회
```

- `getSession → setAuth → subscribe` 순서 필수(실측으로 확인된 함정, `RealtimeUpdateBanner` 참조)
- 구독 생명주기 자동 테스트: `scripts/test-realtime-subscription-lifecycle.ts`(19/19 PASS, 재확인 완료)
- debounce 자동 테스트: `scripts/test-realtime-debounce.ts`(6/6 PASS, 재확인 완료)
- 실 Google Sheet E2E(카드가+현금가 동시변경, 사은품 변경+filter 정확성, 행사 종료일 16행 동시변경) 전부 완료

---

## 8. Phase 11 Web Push 완료 상태 (매우 중요 — Phase 12가 절대 건드리면 안 되는 영역)

### 8.1 아키텍처
```
Sync API(성공 후 next/server의 after()) 또는 공지 생성 Server Action(성공 후 after())
  → src/lib/push/process-promotion-changes.ts / notify-notice.ts
  → src/lib/push/create-notification.ts(notifications+notification_targets 생성,
    push_subscriptions 대상자 조회, 발송, notification_deliveries 기록)
  → src/lib/push/send.ts(web-push, VAPID) → 실기기 Push
  → public/sw.js(push/notificationclick) → Deep Link 이동
```

### 8.2 스키마(`20260917400000_push_notifications.sql`)
`notification_settings`(싱글턴, `push_go_live_at` 컷오버 시각) / `push_subscriptions`(User:Device=1:N, `user_id`/`endpoint`/`p256dh`/`auth`/`user_agent`/`is_active`/`created_at`/`last_used_at`) / `notifications`(`type`: notice\|promotion_change\|summary) / `notification_targets`(notice_target_type 재사용) / `notification_reads` / `notification_deliveries`(status: requested→sent\|failed\|expired) / `promotion_change_logs.notification_id`(nullable FK, 처리 여부 겸 발송 대기열).

### 8.3 핵심 동작
- **Batching**: 별도 타이머 큐 없이 "이번 Sync 1회의 change_log 집합"을 그대로 윈도우로 사용. **상품(promotion_id) 단위로 그룹화**해 1개 상품 변경 → 개별 알림(상품명+필드명 포함), 2개 이상 상품 → Summary 1건. critical importance는 상품 수와 무관하게 항상 개별(`src/lib/push/batch.ts`).
- **필드 라벨**: `promotion_field_definitions.display_label`은 Core Field의 경우 Sheet 헤더 원문이라 그대로 쓰면 안 됨 — `src/lib/push/policy.ts`의 `CORE_FIELD_SHORT_LABEL`이 상품 상세 화면과 동일한 짧은 용어로 보정.
- **Notice Push**: `긴급`/`필독`/`중요`만 기본 대상(`NOTICE_TYPES_PUSH_ELIGIBLE`), 기존 `notice_targets`를 그대로 복사해 재사용(별도 타겟팅 계산 없음).
- **Deep Link**: 프로모션 `/promotions/{product_id}`, 공지 `/notices/{id}`, 행사 `/promotions/events/{id}`, 다건요약 `/promotions?tab=new`.
- **Permission UX**: MY 화면 `PushPermissionCard`(로그인 직후 자동 요청 없음, 상태 unsupported/ios_not_installed/not_requested/granted/denied), `useSyncExternalStore`로 SSR-safe 처리.
- **보안**: Push "발송" API 자체가 존재하지 않음(Route Handler로 노출 안 됨, 서버 코드에서만 import) — `notifications`/`notification_targets`/`notification_deliveries`에 authenticated INSERT 정책 자체가 없어 DB 레벨에서도 이중 차단(실측 `test:push-send-authorization` 7/7).
- **Subscription 등록/해제**: `POST/DELETE /api/push/subscribe`(세션 인증 후 Service Role로 씀 — 공유 매장 태블릿에서 계정이 바뀌면 같은 endpoint의 소유자도 바뀌어야 하기 때문).

### 8.4 실 iPhone Safari PWA E2E 검증 완료 항목(2026-09-18)
- PWA 홈 화면 설치 → STAFF 로그인 → 알림 받기(OS 권한 허용) → Push Subscription 생성(`web.push.apple.com` endpoint, 실측 확인, **값은 이 문서에 기록하지 않음**)
- Background 상태에서 실 DEV Sheet 가격 변경 → Lock Screen Push 수신 → 탭 → 상품 상세 Deep Link 정상, 로그인 유지
- ADMIN UI로 필독공지 실제 생성 → Push 수신 → 탭 → 공지 상세 Deep Link → read/confirm 흐름 정상(재검증 완료, §11 참조)
- 알림 해제(`push_subscriptions` 행 삭제 확인) → 재활성화(새 endpoint 재구독) 정상
- **Android Chrome PWA는 실기기 미검증**(코드/자동 테스트로만 커버, Web Push 표준 API 공통 사용이라 동작 예상되나 미확인).

### 8.5 Phase 12에서 지켜야 할 것
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`/`SYNC_API_SECRET` 등 기존 환경변수 이름 그대로 유지.
- Push Batching/Deep Link/Targeting 로직 재설계 금지.
- **`push_subscriptions`의 실 iPhone 구독 행을 절대 삭제하지 않는다** — Phase 14 QA에서 재사용 예정(§12).

---

## 9. Phase 11 주요 수정/교훈 (CLAUDE.md "Phase 11 완료" 절에 이미 기록됨, 요약만)

1. **필드 라벨 Sheet 헤더 원문 노출 버그** — 수정 완료(§8.3)
2. **1개 상품도 Summary로 가던 batching 오류** — 수정 완료, 1개=개별/2개 이상=Summary/critical=항상 개별(§8.3)
3. **expired(410/404) 구독만 비활성화, 그 외 실패는 구독 유지** — `classifyPushSendError`(`src/lib/push/classify-error.ts`)로 순수 함수 분리, 격리 테스트
4. **Client bundle Secret scan 통과** — `.next/static` 전체(27개 파일)에서 `VAPID_PRIVATE_KEY`/`SUPABASE_SECRET_KEY`/`SYNC_API_SECRET` 미검출 확인(스캔 스크립트 자체가 값을 출력하지 않도록 작성)
5. ⚠️ **[Phase 14 QA 재확인 항목, 미해결] iPhone PWA에서 Push(필독공지) 탭 → 상세 진입은 정상인데 `notice_reads`(read_at)가 DB에 기록되지 않은 사례 1회 관측(2026-09-18).** PC+ngrok Production으로 범위 분리 재현 시도 → 100% 정상(같은 서버·DB·RLS). 신규 테스트 공지로 iPhone 재검증 → 이번엔 정상. **재현 조건을 못 좁혔고 코드는 변경하지 않았다** — 기존 `42501`(Phase 10) 이슈와 같은 계열(백그라운드→포그라운드 전환 직후 세션/쿠키 타이밍)로 추정. Push/Notice 코드 자체의 결함이 아님을 대조 재현으로 확인했으므로 Phase 12 진행을 막지 않으나, **Phase 14에서 반드시 재조사할 것**.
6. **Turbopack dev 서버는 `.env.local`의 `NEXT_PUBLIC_*` 값 변경 시 재시작 없이도 요청 시점에 재컴파일해 반영한다** — "당연히 재시작 필요할 것"이라는 가정이 실측으로 틀렸음이 확인됨(webpack 시절 지식이 이 프로젝트에는 안 맞을 수 있다 — CLAUDE.md 상단 "This is NOT the Next.js you know" 경고와 일치하는 사례).

---

## 10. Phase 5 Auth/Role/Store 핵심 구조 (Phase 12가 실제로 다룰 영역 — 재확인 완료)

이번 문서 작성을 위해 `20260909120000_profiles_and_roles.sql`/`20260909120100_stores_and_access.sql`/`20260909120200_auth_helper_functions.sql`/`20260909120300_rls_core_tables.sql` 4개 migration을 전문 재확인했다.

- **`profiles`**: `auth.users(id)`와 1:1(`on delete cascade`). `id`/`name`/`email`/`role`/`is_active`/`created_at`/`updated_at`.
- **신규 계정 생성 흐름(이미 구현됨, Phase 12가 재사용)**: `auth.users`에 INSERT되면 `handle_new_user()` 트리거가 자동으로 `profiles` row를 만든다 — **`role`은 무조건 `'STAFF'`로 고정**(요청에 role이 담겨 와도 절대 신뢰 안 함, 보안 설계). 즉 Phase 12의 "직원 생성" 플로우는: (1) Supabase Auth Admin API(`auth.admin.createUser`, Service Role 전용, `src/lib/supabase/service-role.ts` 재사용)로 계정 생성 → 트리거가 STAFF profile 자동 생성 → (2) 이어서 ADMIN 권한으로 `role`/`user_store_access`를 원하는 값으로 UPDATE/INSERT하는 **2단계 흐름**이 되어야 한다.
- **`profiles_before_update` 트리거(DB 레벨 2차 방어선)**: `auth.uid()`가 있는데(=실제 로그인 세션) ADMIN이 아니면 `role`/`is_active` 변경 시 예외를 던진다(RLS와 별개로 트리거 레벨에서도 막음 — Defense in Depth). Service Role(`auth.uid() is null`)은 이 트리거에 걸리지 않는다.
- **RLS(`rls_core_tables.sql`)**:
  - `profiles`: SELECT는 본인 행 + ADMIN 전체. UPDATE는 본인 행(단 role/is_active는 트리거가 차단) + ADMIN 전체. **INSERT/DELETE 정책이 아예 없다** — 신규 계정은 auth 트리거로만, 계정 삭제는 존재하지 않는 경로(§18 "삭제 금지" 요구사항과 이미 합치함).
  - ⚠️ **`profiles_select_self_or_admin` 정책 자체는 `is_active_user()`를 체크하지 않는다** — 즉 본인 행 조회(`id = auth.uid()`)는 계정이 비활성화돼도 여전히 허용된다. 대신 `stores`/`notices`/`promotions`/`notifications` 등 **다른 모든 테이블의 정책·Helper 함수는 `is_active_user()`를 이미 전부 거치고 있어서**, 비활성 계정은 로그인은 되지만(Supabase Auth 자체는 profiles.is_active를 모른다) 본인 프로필 외에는 아무 데이터도 못 본다 — 사실상 이미 봉쇄된 상태다. **다만 "계정이 비활성화되었습니다"처럼 사용자에게 명확히 알려주는 UX/명시적 로그인 차단은 아직 없다** — `src/lib/auth/get-current-user.ts`/`src/proxy.ts`는 `is_active` 여부로 분기하지 않는다(직접 코드 재확인). Phase 12에서 "최소 변경"으로 이 gap만 메울지, 기존 RLS 봉쇄로 충분하다고 볼지는 §18 작업 시 결정할 사항.
  - `stores`: SELECT는 로그인+활성 사용자 전체(매장명은 민감정보 아님). 쓰기는 ADMIN만.
  - `user_store_access`: SELECT는 본인 소속 + ADMIN 전체. 쓰기는 ADMIN만.
- **Helper 함수**(`auth_helper_functions.sql`, 전부 `security definer`, RLS 재귀 방지): `current_role()`, `is_active_user()`, `is_admin()`, `is_store_manager()`, `has_store_access(store_id)`. **Phase 12의 모든 새 RLS 정책은 이 함수들을 그대로 재사용한다 — 새 Helper 함수를 만들 필요가 없어 보인다.**
- **기존 Admin 화면**: `src/app/admin/layout.tsx`(role 게이트, `getCurrentUser().profile.role !== "ADMIN"`이면 `redirect("/")`), `src/app/admin/page.tsx`(대시보드, 직원/매장/공지 카운트만 표시 — "직원 관리" 링크 없음), `src/app/admin/notices/`(Phase 8 CRUD 예시). **`src/app/admin/users/` 등 User 관리 코드는 전혀 없음(디렉터리 목록으로 직접 확인)** — Phase 12는 완전히 새로 만드는 작업이다.
- **비밀번호 변경/재설정 관련 코드도 전혀 없음**(파일 검색으로 확인) — `src/app/(staff)/my/page.tsx`에 "비밀번호 변경은 이후 Phase에서 제공됩니다" placeholder 문구만 있다.

---

## 11. 현재 DEV 환경 (2026-09-18, 이 문서 작성 직전 재확인)

```
http://localhost:3000        → dev server (npm run dev, 계속 실행 중)
http://localhost:3001        → production build server (npm run build && PORT=3001 npm run start)
https://henchman-thickness-serpent.ngrok-free.dev → 현재 localhost:3001(Production)을 가리킴
```

- 세 환경 전부 HTTP 응답 확인(`dev: 307`, `prod: 307`, `ngrok: 200` — 방금 재확인).
- **이 ngrok 고정 도메인은 Apps Script Sync API 주소로도 동시에 쓰이고 있다** — Phase 11 E2E를 위해 사용자 승인 하에 3000→3001로 일시 재지정한 상태이며, **Phase 12에서 임의로 되돌리거나 재지정하지 않는다**(사용자가 필요하면 직접 지시).
- dev server(3000)는 Phase 12 작업 중에도 절대 종료하지 않는다(기존 원칙 그대로).

---

## 12. Push Subscription 보존 필수

현재 실 iPhone(STAFF `staff-hq@test.linkmom.dev`)의 Push Subscription이 `push_subscriptions`에 **1건, `is_active=true`로 활성 상태 보존**되어 있다(방금 재확인 — 건수만, endpoint 값은 이 문서 어디에도 기록하지 않았다). **Phase 14 QA에서 재사용할 예정이므로 Phase 12 작업 중 절대 삭제/비활성화하지 않는다.** Phase 12가 "계정 비활성화"(§18) 기능을 구현할 때, 이 계정(`staff-hq@test.linkmom.dev`)을 테스트 대상으로 쓰지 않도록 주의하거나, 쓰더라도 테스트 종료 후 반드시 다시 활성화할 것.

---

## 13. 테스트 스위트 — 이 문서 작성 직전 전체 재실행 결과 (2026-09-18)

| 명령 | 결과 |
|---|---|
| `npm run test:rls` | **19/19 PASS** |
| `npm run test:promotion-rls` | **12/12 PASS** |
| `npm run test:notice-rls` | **23/23 PASS**(fixture 절대시각 문제는 `scripts/seed-notices-phase8.ts`에 `refreshDatesOnRerun` 옵션 추가로 앱/RLS 코드 변경 없이 해결 완료 — Phase 11 세션에서 수정) |
| `npm run test:realtime-rls` | **4/4 PASS** |
| `npm run test:realtime-lifecycle` | **19/19 PASS** |
| `npm run test:realtime-debounce` | **6/6 PASS** |
| `npm run test:push-deep-link` | **24/24 PASS** |
| `npm run test:push-batch-logic` | **14/14 PASS** |
| `npm run test:push-invalid-subscription-cleanup` | **7/7 PASS** |
| `npm run test:push-subscriptions-rls` | **11/11 PASS** |
| `npm run test:push-send-authorization` | **7/7 PASS** |

재실행하지 않은 것(Phase 12와 무관, 이전 Phase에서 이미 통과 확인됨): `test:sync`, `test:sync:safety`, `test:apps-script:retry`, `test:apps-script:trigger-lifecycle`, `test:timestamps-equal`.

**Phase 12에서 추가할 것으로 예상되는 테스트**: 새 User 관리 RLS 테스트(예: `test:admin-users-rls` — STAFF가 타인 role/store를 못 바꾸는지, 본인 role/is_active를 못 바꾸는지는 이미 `test:rls`가 일부 커버하지만 "ADMIN이 신규 계정을 만드는 흐름", "ADMIN이 비활성화한 계정이 실제로 봉쇄되는지"는 아직 테스트가 없다).

---

## 14. Phase 12 목표 (Minimum Admin — 범위를 임의로 넓히지 않는다)

Production 배포 전, 본사 ADMIN이 실제 직원 계정을 안전하게 생성/관리할 수 있는 **최소 기능만**:

1. 직원 목록
2. 직원 생성(이름/이메일/Store/Role)
3. Store 지정
4. Role 지정
5. 활성/비활성
6. 임시 비밀번호 재설정(ADMIN이 트리거)
7. MY에서 본인 비밀번호 변경(모든 로그인 사용자)

---

## 15. Phase 12에서 제외(Backlog) — 구현 금지

Admin 통계 Dashboard/차트, 직원 활동 로그 UI, CSV 대량등록, 복잡한 Permission Editor, 매장 CRUD 고도화, SMTP/초대메일, **직원 삭제**, 감사로그 Dashboard, 일괄 Role 수정, 고급 Push Admin/Push 통계, 로그인 이력 UI, 교육관리, 근태, 조직도, 그 외 Nice-to-have Admin 기능 전부.

---

## 16. Phase 12 권한 정책

- **ADMIN**: 직원 목록/생성/이름 수정/Role 수정/Store 수정/활성·비활성/임시 비밀번호 reset.
- **STORE_MANAGER**: 이번 Phase에서 직원 관리 권한 없음.
- **STAFF**: 직원 관리 권한 없음.
- **모든 로그인 사용자**: MY에서 본인 비밀번호 변경 가능.
- Public Sign-up: OFF 유지(기존 그대로, 변경 안 함).

---

## 17. 비밀번호 정책 (Phase 12 구현 시 반드시 지킬 것)

- 비밀번호 DB 저장 금지, 기존 비밀번호 조회 기능 없음, 로그 출력 금지.
- ADMIN의 reset은 **Server-only Supabase Auth Admin API**(`auth.admin.updateUserById` 또는 `auth.admin.generateLink` 등, Service Role 전용 — `src/lib/supabase/service-role.ts` 기존 패턴 재사용)로만 수행.
- STAFF 본인 비밀번호 변경은 **현재 비밀번호 재인증 후 변경**.
- Role/Store는 본인이 수정 불가(이미 `profiles_before_update` 트리거 + RLS로 role/is_active는 막혀 있음 — §10 참조. Store(`user_store_access`)는 RLS상 쓰기가 ADMIN 전용으로 이미 막혀 있음, 재확인 완료).

---

## 18. 계정 비활성화 (Phase 12 핵심)

- 비활성 직원: 신규 로그인 차단(§10에서 확인했듯 현재는 "데이터 접근 봉쇄"까지는 RLS로 이미 되지만 "로그인 자체 차단" UX는 없음 — 최소 변경으로 메울지 결정 필요), 보호된 앱 접근 차단(이미 RLS로 사실상 됨), Push 발송 대상 제외(§8.3 targeting이 `profiles.is_active=true`만 대상으로 거르는지 `src/lib/push/targeting.ts`의 `resolveTargetUserIds` 재확인 필요 — 이미 `eq("is_active", true)` 필터가 있음, 코드 재확인 완료).
- 재활성화: 기존 profile/store/role 유지, 정상 로그인 가능(단순히 `is_active=true`로 되돌리면 됨 — 이미 스키마가 이를 지원).
- **삭제 후 재생성 방식 금지** — RLS 자체가 애초에 DELETE 정책을 정의하지 않아 구조적으로 이미 막혀 있음(§10 재확인).

---

## 19. Phase 12 Browser E2E 목표(계획, 아직 미실행)

A. ADMIN 직원 목록 B. DEV STAFF 신규 생성 C. 신규 계정 로그인 D. Role/Store 수정 E. 비활성화 → 로그인/접근 차단 F. 재활성화 → 정상 로그인 G. ADMIN 임시 비밀번호 reset H. STAFF MY 비밀번호 변경 I. STAFF `/admin/users` 직접 접근 차단(이미 `admin/layout.tsx`의 role 게이트가 모든 `/admin/*` 하위 경로에 자동 적용됨 — 재확인 완료, 새 코드 불필요).

**실제 운영 직원은 아직 생성하지 않는다** — 전부 DEV 테스트 계정으로 검증.

---

## 20. Phase 12에서 승인 없이 절대 변경 금지

Google Sheet schema, Sync Engine, Apps Script, `product_id`, Sync Safety Guard, NEW 72h, Event Visibility, Promotion UI(카드/상세 레이아웃), Notice read/confirm 시맨틱, Realtime 구조, Web Push 아키텍처(VAPID/Batching/Deep Link), RLS 모델(`is_admin()`/`has_store_access()` 등 기존 Helper 함수). **Phase 12는 User/Admin 계정 관리 범위만 다룬다.**

---

## 21. 환경변수 이름 목록 (값은 기재하지 않음)

`.env.local`에만 존재(git 미추적, `.gitignore` 확인 완료 — `.env`/`.env.local`/`.env.*.local` 전부 제외):

| 변수명 | 용도 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | RLS 적용 공개 키 |
| `SUPABASE_SECRET_KEY` | 서버 전용, RLS 우회(Auth Admin API 호출에도 필요) |
| `SUPABASE_DB_URL` | migration 적용 전용 |
| `SYNC_API_SECRET` | Apps Script → Sync API Bearer 인증 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Push 구독(클라이언트) |
| `VAPID_PRIVATE_KEY` | Push 발송 서명(서버 전용) |
| `VAPID_SUBJECT` | VAPID mailto |

이 문서를 포함해 어떤 `docs/*.md`에도 실제 Key/Password/DB URL/endpoint/VAPID Private Key 값을 적지 않는다.

---

## 22. BOOTSTRAP INSTRUCTIONS — 새 Claude Code 채팅이 처음 할 일

1. 이 문서(`docs/PHASE12_HANDOFF.md`) 전체를 정독한다.
2. `/CLAUDE.md`를 읽는다(절대 원칙 + Phase 5~11 lessons-learned 로그 전체, 특히 "Phase 11 완료" 절).
3. `git status`, `git log --oneline -15`, `git rev-parse HEAD`를 실행해 §1과 실제 저장소가 일치하는지 확인한다 — 다르면 실제 상태를 우선한다.
4. Auth/profile/store/admin/MY 관련 코드를 직접 조사한다: `supabase/migrations/20260909120000~120300*.sql`(4개), `src/app/admin/`, `src/lib/auth/get-current-user.ts`, `src/app/(staff)/my/page.tsx`, `src/lib/supabase/service-role.ts`, `src/app/login/`. §10에 이미 요약이 있지만 직접 다시 읽고 대조한다.
5. DEV Supabase 확인이 필요하면 읽기 전용 SELECT만(Service Role, 임시 스크립트는 실행 직후 삭제) — Promotion/Notice/Push 데이터를 절대 수정하지 않는다. **`push_subscriptions`의 실 iPhone 구독 행은 삭제/비활성화하지 않는다(§12).**
6. dev(3000)/production(3001)/ngrok 상태를 curl로 확인한다 — **임의로 재시작/종료/재지정하지 않는다**(§11).
7. **코드를 수정하기 전에 먼저 사용자에게 현재 Auth/Role/Store 구조 조사 결과와 Phase 12 구현 계획(직원 생성 2단계 흐름, 비밀번호 reset API 선택 등 §10/§17에서 결정이 필요한 지점 포함)을 보고하고 합의한다.** 합의 없이 바로 구현을 시작하지 않는다.
8. §20(변경 금지 목록)에 해당하는 항목을 건드려야 할 것 같으면 반드시 먼저 멈추고 사용자에게 보고 후 승인받는다.
9. 합의 후 **Minimum Admin만**(§14) 구현한다 — §15(Backlog) 항목을 임의로 추가하지 않는다.
10. 각 기능 단위 완료 시 lint/typecheck/production build를 실제로 돌리고, UI 변경은 브라우저(가능하면 실제 dev/prod 환경)에서 동작을 확인한 뒤에만 "완료"로 보고한다.
11. Phase 12 작업이 §19(E2E 목표)를 실제로 검증 완료하기 전까지는 **Phase 13(Security Review)으로 자동 진행하지 않는다.**
12. dev server(3000)는 사용자가 명시적으로 종료를 알리기 전까지 계속 실행 상태로 둔다(기존 원칙 그대로).

---

*이 문서는 2026-09-18에 저장소를 직접 재조사하고 DEV Supabase를 읽기 전용으로 조회하며 관련 테스트 스위트 11종을 전부 재실행해 작성됐다. Production/DEV의 어떤 데이터도 수정하지 않았으며, Phase 12 코드는 이 작업 중 한 줄도 작성하지 않았다.*
