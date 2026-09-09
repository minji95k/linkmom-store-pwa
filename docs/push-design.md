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

## 4. Push 대상 이벤트

긴급/중요/필독공지, 행사공지, 신규/필수 교육자료, 신규 프로모션, 위 표의 important/critical 변경. minor 변경은 절대 발송하지 않는다.

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
| 공지 | `/notices/{notice_id}` |
| 교육자료 | `/training/{material_id}` |
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

지원 환경에서 PWA App Badge(`navigator.setAppBadge`) 적용 + Bottom Navigation 내 공지/교육자료 미확인 Count Badge.

## 12. Push 보안 (permissions.md 참조)

- STAFF/STORE_MANAGER는 Push 발송 API 호출 불가(서버 Role 체크 + RLS 이중 방어)
- 사용자는 본인 Subscription만 등록/해제 가능
- VAPID Private Key는 서버 환경변수 전용

## 13. Delivery 상태

`notification_deliveries.status`: `requested` → `sent` | `failed` | `expired`. 실패/만료 시 해당 Subscription 자동 비활성화 대상으로 표시하여 다음 발송에서 제외.
