# Push Design (Phase 2)

## 1. 표준

Web Push(VAPID) + Service Worker. Native App 없이 iOS(홈 화면 설치 후)/Android 모두 지원.

## 2. Subscription 모델

`push_subscriptions`: User 1 : Device N (§59). 한 사용자가 여러 기기에서 로그인할 수 있으므로 1:1 가정 금지. `endpoint`가 PK 역할(unique). 만료/무효 Subscription은 발송 실패(410/404) 시 자동 비활성화 또는 삭제.

## 3. Change Classification 공유 (architecture.md §5 재사용)

NEW 판정과 **동일한** `promotion_field_definitions.change_importance` / `push_enabled`를 사용한다. 별도의 Push 전용 중요도 로직을 만들지 않는다(§47).

| 변경 유형 | importance | Push |
|---|---|---|
| 가격(소비자가/기준/카드/현금) | important | O |
| 프로모션/판매조건/사은품/구성품/행사기간 | important | O |
| 긴급 판매조건 | critical | O(즉시, Batch 제외) |
| 공백/오타/내부관리/타임스탬프만 | minor | X |

`importance`가 "이 변경이 종류상 중요한가"를 답한다면, 아래 §3.1의 `push_eligible`은 "이 특정 로그 건을 지금 실제로 보내도 되는가"를 답한다 — 서로 다른 축이며, Phase 11은 **둘 다** 만족하는 건만 발송한다(`WHERE importance != 'minor' AND push_eligible = true`).

### 3.1 Initial Import/Migration 상품은 Push 대상에서 제외 (확정, 2026-09-10)

실제 DEV Google Sheet로 첫 `[상시 프로모션]` E2E Sync를 실행해 188개 상품이 한 번에 들어오는 것을 실제로 확인한 뒤 정한 규칙이다. **Migration/Initial Import로 생성된 기존 상품은 Push 발송 대상이 아니다** — `promotion_change_logs` 기록(감사 목적)은 남기되, Phase 11이 이 로그를 소급해서 발송하거나 요약 Push로 묶어 보내면 안 된다. 운영 개시 이후 실제 Google Sheet에 새롭게 추가되는 상품만 `new_product` → Push 대상이다.

구현 (`supabase/migrations/20260910110000_push_eligibility_and_initial_import.sql`, `20260911100000_permanent_initial_import_state.sql`, `src/lib/sync/engine.ts`):

- **`promotion_sync_state`** (Sheet 타입별 1행, PK=`promotion_type`): `initial_import_completed_at`이 `NULL`이면 "이 Sheet 타입은 아직 최초 Import를 마치지 않았다"는 뜻이고, 한 번 값이 채워지면(`mark_initial_import_completed()` 함수가 Sync 성공 시 COALESCE로 채움) **`promotions` Row가 전부 삭제되어도 절대 되돌아가지 않는다.**
  ⚠️ 최초 설계는 "이 Sheet 타입의 `promotions` Row가 지금 0건인가"로 판정했으나, 사용자 재검토로 **Hard Delete가 발생하면 다음 Sync가 다시 "최초 Import"로 오판정될 수 있음**을 발견해 이 영구 상태 테이블로 교체했다. 실제로 `event` 타입에 대해 "최초 Sync → Hard Delete → 재Sync" 시나리오를 재현해, 교체 전 로직이면 오판정됐을 상황에서 신규 상품이 정확히 `is_initial_import=false`로 판정됨을 검증했다.
- **`promotions.is_initial_import`** (boolean): 이 상품이 해당 `promotion_type`의 최초 Import Sync에서 생성됐는지. Sync 엔진이 매 실행 시작 시 `promotion_sync_state`를 조회해 자동 판정한다 — 운영자가 수동으로 체크하는 플래그가 아니다.
- **`promotion_change_logs.push_eligible`** (boolean, 기본 `true`): Phase 11이 실제로 필터링할 단일 컬럼. `change_type='new_product'` 로그는 그 상품이 `is_initial_import=true`면 `push_eligible=false`로 기록된다. 그 외 모든 로그(운영 개시 이후 신규 상품, 기존 상품의 가격/사은품 등 일반 변경)는 기본값 `true`.
- 실제 DEV Supabase에서 188건 Import로 검증 완료: 188개 상품 전부 `is_initial_import=true`, 그 `new_product` 로그 188건 전부 `push_eligible=false`(`initial_import_completed_at`은 실제 첫 라이브 Sync의 `sync_logs.finished_at`으로 정확히 백필). "최초 Import 이후 신규 추가" 및 "Hard Delete 후 재Sync" 두 시나리오 모두 `event` 타입 샌드박스에서 검증 후 테스트 데이터 정리.
- ✅ 확정(2026-09-16): **`importance='minor'`인 로그는 항상 `push_eligible=false`다** — 반대 방향(important/critical이면서 push_eligible=false)은 여전히 가능하다(위 Initial Import 케이스). 이 방향만의 함의를 `promotion_change_logs_minor_not_push_eligible` CHECK 제약으로 DB 스키마에도 강제해뒀다(`20260916010000_minor_change_logs_push_ineligible.sql`) — "중요하지 않은 변경인데 Push 대상"이라는 의미상 모순 상태가 애초에 저장될 수 없다. §3.2의 이중 안전장치는 여전히 유효하며, 이건 그보다 한 단계 더 앞선 방어선이다.

### 3.2 Phase 11 구현 시 반드시 지킬 이중 안전장치

`push_eligible`은 Sync 시점에 정확히 계산되지만, Phase 6~10 사이 개발·테스트 과정에서 쌓이는 다른 이력(예: 이 문서 자체를 검증하며 만든 테스트 데이터)까지 완벽히 막아주는 것은 아니다. Phase 11에서 실제 발송 로직을 만들 때 **아래 조건을 추가 방어선으로 반드시 건다**:

```
발송 대상 = promotion_change_logs
  WHERE importance != 'minor'
    AND push_eligible = true
    AND changed_at > <Push 기능이 실제로 켜진 시각>   -- 예: 환경변수 PUSH_ENABLED_AT
                                                        -- 또는 시스템 설정 테이블 1행
```

"Push 기능이 실제로 켜진 시각" 이전에 발생한 로그는 `push_eligible` 값과 무관하게 무조건 제외한다 — Initial Import뿐 아니라 Phase 7~10 개발 중 발생한 모든 이력이 Push 활성화 순간 한꺼번에 쏟아지는 사고를 원천 차단하는 마지막 안전장치다. 이 컷오버 시각 저장 방식(환경변수 vs 설정 테이블)은 Phase 11에서 실제 발송 인프라를 만들 때 결정한다 — 지금은 스키마를 추가하지 않는다(쓰는 곳이 없는 테이블을 미리 만들지 않음).

## 4. Push 대상 이벤트

긴급/중요/필독공지(신상품 교육 공지 포함 — Phase 9 SKIP, product-requirements.md §4.6), 행사공지, 신규 프로모션, 위 표의 important/critical 변경. minor 변경은 절대 발송하지 않는다.

## 5. Batching (다건 변경 통합)

```
Sync 1회 처리 중 발생한 important 이상 변경 건들을 임시 큐에 적재
        ▼
Batching Window (예: 2~5분, 설정 가능) 대기
        ▼
Window 종료 시:
    - critical 또는 "즉시발송" 지정 건 → 개별 즉시 발송 (Batch 제외)
    - 나머지 important 건 → 브랜드/건수 요약한 Summary 알림 1건 생성
      예: "리안 외 4개 브랜드, 17개 상품의 프로모션 조건이 변경되었습니다."
      → deep_link: /promotions/updates
```

30개 상품을 한 번에 고치면 Push 30건이 아니라 Summary 1건이 발송되도록 반드시 보장한다(§62).

## 6. Targeting

전체/특정매장/복수매장/특정Role/특정사용자. `notification_targets`를 통해 계산 후, 대상자의 `push_subscriptions`에만 발송. 접근 권한 없는 데이터 관련 Push는 애초에 대상자 계산 단계에서 제외한다.

## 7. Deep Link

| 유형 | 경로 |
|---|---|
| 프로모션 상세 | `/promotions/{product_id}` |
| 공지(교육 공지 포함) | `/notices/{notice_id}` |
| 최근 변경 요약 | `/promotions/updates` |
| 행사 | `/events/{campaign_id}` |

## 8. Foreground / Background

- Foreground(앱 열려있음): Supabase Realtime 구독 → 화면 자동 갱신 + "새로운 프로모션 정보가 업데이트되었습니다" Toast. Web Push는 중복 노출 방지를 위해 Foreground에서는 OS 배너 대신 인앱 Toast로 대체 가능.
- Background/종료: Service Worker가 Web Push 수신 → OS 알림 표시 → 클릭 시 Deep Link로 이동.

## 9. Permission UX

- 로그인 직후 즉시 Permission 요청 금지(§68).
- 목적 설명 화면 노출 후 "[알림 받기]" 버튼 클릭 시에만 OS Permission 요청.
- 상태 관리: `unsupported` / `not_requested` / `granted` / `denied`.
- iOS는 홈 화면 설치가 선행되어야 Push가 동작하므로, 설치 안내 UX를 Permission 요청 전에 노출.

## 10. Notification Center

Push를 놓쳤거나 OS 알림을 차단한 경우를 대비해 `notifications` + `notification_deliveries`를 앱 내부 목록으로 노출. 유형/제목/내용/발생시간/중요도/읽음여부/딥링크 표시.

## 11. Badge

지원 환경에서 PWA App Badge(`navigator.setAppBadge`) 적용 + Bottom Navigation 공지 탭 미확인 Count Badge(Phase 8에서 구현 완료 — 교육 공지도 포함).

## 12. Push 보안 (permissions.md 참조)

- STAFF/STORE_MANAGER는 Push 발송 API 호출 불가(서버 Role 체크 + RLS 이중 방어)
- 사용자는 본인 Subscription만 등록/해제 가능
- VAPID Private Key는 서버 환경변수 전용

## 13. Delivery 상태

`notification_deliveries.status`: `requested` → `sent` | `failed` | `expired`. 실패/만료 시 해당 Subscription 자동 비활성화 대상으로 표시하여 다음 발송에서 제외.
