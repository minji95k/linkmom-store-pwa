# Permissions (Phase 2)

## 1. Role 정의

| Role | 범위 | 비고 |
|---|---|---|
| ADMIN | 전체 매장/전체 데이터, 사용자·매장·공지·교육자료·프로모션·행사·Field·Push·Audit 관리 | 본사 담당자 |
| STORE_MANAGER | 프로모션 포함 전 영역에서 **STAFF와 동일한 조회 범위**(소속 매장 대상 항목만, 현재 노출 중인 행사만) | ⚠️ 갱신(Phase 6.5 보안 재검토, 2026-09-10): 애초 "프로모션 전체 매장 조회"로 확정했던 예외는, 실측 결과 promotions 자체가 애초에 매장별로 분리돼 있지 않아(=STAFF도 이미 전체 매장 데이터를 봄) 실질적 차이가 없었고, 유일하게 실제로 차이를 만들던 지점(비노출/예정/종료된 행사 캠페인 조회)은 "아직 공개 안 한 콘텐츠 미리보기"에 가까워 ADMIN 전용으로 좁혔다. 즉 현재 구현상 STORE_MANAGER의 추가 권한은 없음 — 매장별 데이터 분리가 실제로 도입되면 그때 다시 검토한다 |
| STAFF | 자신이 속한 매장(들)의 데이터만 (프로모션 포함) | 일반 매장 직원 |

Public Sign-up 없음. 계정은 ADMIN이 초대/생성. 비활성화된 계정은 로그인 즉시 차단.

## 2. Store 접근 모델

- `user_store_access` (N:M) — 한 사용자가 여러 매장에 속할 수 있음(§50).
- ADMIN은 `user_store_access`와 무관하게 `profiles.role = 'ADMIN'`이면 전체 매장 허용.
- ✅ **확정**: 현재 매장은 **용인본점, 동백점** 2곳이며, **향후 매장 추가 계획이 있다.** 따라서 매장명·매장 개수를 코드/RLS/Push·Notice Targeting 어디에도 하드코딩하지 않고, `stores` 테이블 행 추가만으로 신규 매장이 자동 반영되도록 설계한다.
- ⚠️ **갱신(Phase 6.5)**: `STORE_MANAGER`의 "전체 매장 프로모션 조회" 예외는 실제 구현·재검토 결과 폐기했다. `promotions`는 현재 매장별로 데이터가 분리되어 있지 않아(모두가 이미 전체 매장 데이터를 봄) 이 예외가 실질적 의미가 없었고, 유일하게 차이가 나던 지점(비노출/예정/종료 행사 캠페인)은 ADMIN 전용으로 좁혔다(아래 `event_campaigns` 참조). 매장별 데이터 분리가 실제로 도입되면 그때 STORE_MANAGER 예외를 다시 설계한다.

## 3. RLS 정책 원칙

- **모든 테이블 RLS 기본 ON.** Service Role Key로만 우회 가능한 서버 전용 작업(Sync API, Push 발송)은 별도 서버 함수/Route에서만 수행.
- URL 조작, API 직접 호출, Client Role 값 조작으로 우회 불가능해야 함 — Frontend 숨김만으로 끝내지 않는다(§50).

### `promotions` (Phase 6에서 실제 구현·검증 완료)
- SELECT: `is_active_user()` AND (`ADMIN`은 전체(비활성 포함) OR `is_active`이면서 (`상시` OR 소속 캠페인이 지금 노출 중인 `행사`)). STORE_MANAGER는 이 정책에서 STAFF와 동일하게 취급한다(§1 갱신 사항). 매장별 노출 예외는 현재 `store_operation_note` 자유텍스트로만 관리되므로 "매장 무관 전체 노출 + 프론트에서 예외 문구 표시" 방식을 기본으로 하고, 매장별 완전 차단이 필요해지면 구조화 테이블 전환 후 RLS 강화한다.
- INSERT/UPDATE/DELETE: 없음(Sync 서버 전용 Service Role만 가능 — `anon`/`authenticated`에는 SELECT GRANT만 존재, RLS 정책도 없음)

### `event_campaigns` / `event_campaign_products`
- SELECT: `is_active_user()` AND (`ADMIN`은 예정/종료/비노출 포함 전체 조회 가능, 그 외는 "노출ON + 시작일≤지금≤종료일"인 캠페인만). ⚠️ Phase 6.5에서 STORE_MANAGER 예외를 제거했다 — 비공개 캠페인 미리보기는 ADMIN 전용.
- 쓰기: Sync 서버 전용
- ⚠️ **View 사용 시 주의**: `event_campaigns_visible` View는 실측으로 확인한 결과 기본 설정(`security_invoker` 미지정)에서는 View Owner 권한으로 실행되어 하위 테이블 RLS를 완전히 우회한다(Postgres의 공식 동작이며 이 프로젝트에서 실제로 재현·확인함). 이 View는 `security_invoker = on`으로 생성해 반드시 호출자의 RLS를 그대로 적용받도록 한다. **앞으로 promotions 도메인에 View를 추가할 때마다 이 설정을 빠뜨리지 않는다.**

### `notices` / `notice_targets` / `notice_reads`
- SELECT notices: 자신의 role/store/user에 해당하는 target이 있는 공지만 (JOIN `notice_targets`)
- INSERT/UPDATE/DELETE notices: `ADMIN`만
- `notice_reads`: 본인 행만 INSERT/UPDATE 가능, SELECT는 본인 것 + ADMIN 전체

### `training_materials` 계열
- notices와 동일 패턴 (대상자만 SELECT, ADMIN만 쓰기, 읽음/완료는 본인만 갱신)

### `push_subscriptions`
- 본인 소유 행만 SELECT/INSERT/DELETE 가능 (§76 — 사용자는 자신의 Subscription만 등록/해제)
- STAFF는 Push 발송 API 호출 불가 (서버 Route에서 Role 체크, RLS로도 이중 방어)

### `notification_deliveries` / `notifications`
- SELECT: 본인에게 발송된 것만 (STAFF/STORE_MANAGER), ADMIN은 전체 + Delivery 결과 조회
- INSERT: 서버(Service Role) 전용

### `sync_logs` / `audit_logs`
- SELECT: `ADMIN`만
- INSERT: 서버 전용

### `profiles` / `stores` / `user_store_access`
- 본인 프로필 SELECT/UPDATE(제한 필드만), 매장/타 직원 목록은 `ADMIN`만 (STORE_MANAGER가 같은 매장 직원 목록을 볼 필요가 생기면 별도 정책 추가)

## 4. Server-side Authorization 이중 방어

RLS는 최종 방어선이고, 추가로:
- 모든 Admin 화면 Route는 서버 컴포넌트/Route Handler에서 `profiles.role` 재검증
- Push 발송, Sync 수신 API는 Service Role Key를 쓰되 자체 인증(Secret/서명 검증)을 반드시 거침
- Privilege Escalation 방지: `role`, `user_store_access` 변경은 ADMIN 전용 Route + Audit Log 필수 기록

## 5. Secrets

- Supabase Service Role Key, VAPID Private Key: 서버 환경변수 전용, 클라이언트 번들에 절대 포함 금지
- `.env*`는 `.gitignore` 처리, 저장소에 커밋 금지

## 6. GRANT 최소 권한 원칙 (Phase 6.5 재검토 후 확정)

이 DEV Supabase 프로젝트는 `public` 스키마의 새 테이블에 anon/authenticated/service_role
권한을 자동으로 물려주지 않는다(Phase 5에서 발견). 이 특성 때문에 매 테이블마다 GRANT를
직접 작성해야 하는데, 처음엔 편의상 `grant all`을 줬다가 실제 연동 전 재검토하며 최소
권한으로 좁혔다. 앞으로 새 테이블을 추가할 때 이 원칙을 따른다:

- `anon`: `SELECT`만. (0건이 나오는 것과 "permission denied"가 나오는 것은 RLS 테스트
  결과가 달라지므로, 아예 GRANT를 안 주는 것보다 SELECT는 주고 RLS로 0건 처리하는 쪽을
  기본으로 한다 — Phase 5/6 테스트 스위트가 이 형태를 가정한다.)
- `authenticated`: 실제로 authenticated 세션에서 쓰기가 필요한 테이블에만 정확히 필요한
  권한(예: `UPDATE`)만 추가. RLS 정책이 없는 명령(INSERT/UPDATE/DELETE)에는 GRANT도
  주지 않는다 — GRANT 단계에서 막히는 것이 RLS 단계에서 조용히 0건 처리되는 것보다
  명확한 실패 모드다.
- `service_role`: Sync/Push 등 서버 전용 로직이 실제로 수행하는 CRUD에 필요한 만큼
  `all`. 어차피 RLS를 우회하므로 세분화할 실익이 적다.
