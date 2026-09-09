# Permissions (Phase 2)

## 1. Role 정의

| Role | 범위 | 비고 |
|---|---|---|
| ADMIN | 전체 매장/전체 데이터, 사용자·매장·공지·교육자료·프로모션·행사·Field·Push·Audit 관리 | 본사 담당자 |
| STORE_MANAGER | **프로모션(상시+행사) 전체 매장 조회.** 그 외(공지/교육자료 등)는 STAFF와 동일하게 자신이 속한 매장 대상 항목만 | ✅ 확정(사용자 결정): 유일한 추가 권한은 "전체 매장 프로모션 조회"뿐이며, 사용자 관리·공지 작성 등 관리 기능은 없음 |
| STAFF | 자신이 속한 매장(들)의 데이터만 (프로모션 포함) | 일반 매장 직원 |

Public Sign-up 없음. 계정은 ADMIN이 초대/생성. 비활성화된 계정은 로그인 즉시 차단.

## 2. Store 접근 모델

- `user_store_access` (N:M) — 한 사용자가 여러 매장에 속할 수 있음(§50).
- ADMIN은 `user_store_access`와 무관하게 `profiles.role = 'ADMIN'`이면 전체 매장 허용.
- ✅ **확정**: 현재 매장은 **용인본점, 동백점** 2곳이며, **향후 매장 추가 계획이 있다.** 따라서 매장명·매장 개수를 코드/RLS/Push·Notice Targeting 어디에도 하드코딩하지 않고, `stores` 테이블 행 추가만으로 신규 매장이 자동 반영되도록 설계한다.
- ✅ **확정**: `STORE_MANAGER`는 `user_store_access`에 등록된 소속 매장과 무관하게 **`promotions`/`event_campaigns`(및 관련 View)에 한해 전체 매장 데이터를 조회**할 수 있다. 이는 매장 개수가 늘어나도 "전체"로 자동 확장되는 **Role 기반 예외**이며, 특정 매장 이름을 조건에 명시하지 않는다. 공지·교육자료 등 그 외 테이블에서는 STAFF와 동일하게 `user_store_access` 기준으로 제한된다.

## 3. RLS 정책 원칙

- **모든 테이블 RLS 기본 ON.** Service Role Key로만 우회 가능한 서버 전용 작업(Sync API, Push 발송)은 별도 서버 함수/Route에서만 수행.
- URL 조작, API 직접 호출, Client Role 값 조작으로 우회 불가능해야 함 — Frontend 숨김만으로 끝내지 않는다(§50).

### `promotions`
- SELECT: `is_active = true` AND (`ADMIN` OR `STORE_MANAGER`(role 자체가 곧 전체 매장 허용 — `user_store_access` 조회 불필요) OR `STAFF`이면서 접근 가능한 매장向 데이터). 매장별 노출 예외는 현재 `store_operation_note` 자유텍스트로 관리되므로 STAFF도 1차 버전은 "매장 무관 전체 노출 + 프론트에서 예외 문구 표시" 방식을 기본으로 하고, 매장별 완전 차단이 필요해지면 구조화 테이블 전환 후 RLS 강화한다.
- INSERT/UPDATE/DELETE: 없음(Sync 서버 전용 Service Role만 가능, RLS 대상 아님)

```sql
-- promotions SELECT 정책 예시 (의사코드)
using (
  is_active = true
  and (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('ADMIN', 'STORE_MANAGER'))
    or exists (
      select 1 from user_store_access usa
      join profiles p on p.id = usa.user_id
      where usa.user_id = auth.uid() and p.role = 'STAFF'
      -- 매장별 완전 차단이 도입되면 여기서 store_id 매칭 조건 추가
    )
  )
)
```

### `event_campaigns` / `event_campaign_products`
- SELECT: `event_campaigns_visible` View 기준(모든 Role 공통) + `ADMIN`/`STORE_MANAGER`는 예정/종료 포함 전체 조회 가능(§1 STORE_MANAGER 확정 권한과 동일하게 프로모션 도메인 전체 매장/전체 상태 조회)
- 쓰기: Sync 서버 전용

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
