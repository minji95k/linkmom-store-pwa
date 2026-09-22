# Release v1.0.0 — 링크맘 매장 직원용 내부 운영 PWA

- **Release Date**: 2026-09-22
- **Production URL**: https://linkmom-store-pwa.vercel.app
- **Production Supabase**: `linkmom-store-prod`
- **Rollback 대상**: 기존 Softr 운영 체계(계속 병행 유지 중, 즉시 복귀 가능)

## 주요 기능

| 영역 | 내용 |
|---|---|
| Auth/Roles | Supabase Auth 기반 로그인, ADMIN/STORE_MANAGER/STAFF 3-Role, Server-side + RLS 이중 인가, 비밀번호 변경(MY), 계정 비활성화 시 즉시 접근 차단 |
| Promotions | Google Sheet(상시/행사 2종) One-way Sync, Core/Dynamic Field 자동 구분, product_id 서버 자동 채번+Sheet 되쓰기 |
| Event Promotions | 행사명/시작일/종료일/노출여부 기반 캠페인 자동 그룹화, 기간 경과 시 자동 비노출(데이터 보존) |
| NEW 72h | 최근 72시간 내 신규 등록/중요 변경 상품만 NEW 표시(Change Classification과 Push 판정 공유) |
| Notice/read/confirm | 대상(전체/매장/Role/개인) 지정 공지, 읽음/확인완료 상태 추적, 첨부파일, KST 기준 게시 예약/만료 |
| Realtime | 프로모션/행사/공지 변경 시 배너 알림 → 새로고침 시 서버 재조회(RLS 적용 상태 그대로 반영) |
| Web Push | VAPID 기반 구독, Critical/Important Summary 배칭, 구독 Self-healing, 딥링크(공지/상품) 정상 이동 |
| Admin User Management | `/admin/users`에서 직원 생성/역할 변경/매장 배정/비활성화 |
| Password Change | 최초 로그인 후 MY에서 본인 비밀번호 교체 |
| Google Sheet Auto Sync | onEdit 즉시 반영(Partial) + 10분 Full Snapshot, 대량 비활성화 안전장치, Sync 이력(`sync_logs`) 감사 |

## Production Pilot 검증 결과(PASS)

- Production Supabase 구축/Migration/스키마·RLS·GRANT 전수 검증
- 최초 Google Sheet Initial Sync — 상시 198건 / 행사 38건 / 캠페인 1건(상품 38건 연결)
- **Initial Import 상태 오염 버그**(신선 환경이 가짜 "최초 Import 완료" 상태를 물려받는 결함) 발견 → 근본 원인 수정 + PROD 대상 Row 정확히 복구
- **Initial Import NEW 배지 범람 버그**(상시 198건 + 행사 38건 전체) 발견 → 근본 원인 수정 + PROD 데이터 정정
- Google Apps Script Trigger 설치 확인(`handleEditTrigger` 1개, `syncAll` 1개, `flushPendingSync` 평상시 0개, 중복 없음)
- Production 자동 Partial Sync 실사용 E2E(Sheet 편집 → onEdit → Sync → Realtime 배너 → 새로고침 반영 → 원복까지 전 구간)
- Pilot STAFF 계정 생성, PWA 로그인/설치, 알림 권한 허용까지 실기기 검증
- **Push Subscription이 로컬에는 존재하나 서버 DB에 저장되지 않는 결함** 발견 → Self-healing 로직 추가 → PROD 재검증 PASS
- **공지 게시 시각 Timezone 버그**(KST 입력이 UTC로 오인되어 9시간 밀림, 그 결과 Push는 발송되는데 공지는 안 보이는 불일치) 발견 → 근본 원인 수정 + Push 발송 전 게시기간 재확인 안전장치 추가
- **iOS PWA Background 상태에서 Push 딥링크가 마지막 화면에 머무는 결함** 발견 → Service Worker postMessage + 클라이언트 Router 이동 방식으로 수정 → Cold Start/Background 두 케이스 모두 실기기 재검증 PASS
- 테스트로 생성한 Notice/Push 데이터 전량 정리, 실 운영 데이터(Promotion 198+38건, Store, ADMIN, Pilot STAFF, Push Subscription) 영향 없음 확인

## Android 실기기 미검증 사항

- Android Chrome PWA는 **자동 테스트/코드 리뷰 수준까지만** 커버됐고, 실기기(Push 수신, 홈 화면 설치, Background 딥링크 등)로는 검증되지 않았다.
- iOS Safari(Standalone PWA)만 실기기로 전 과정을 검증했다.

## Known Backlog

- **예약 발행 공지의 "예약 시각 도달 시 자동 Push 발송"**: 현재는 즉시 게시 공지만 즉시 Push되고, 미래 예약 공지는 그 시각 전까지 Push를 보내지 않는 최소 안전장치만 있다. 예약 시각 도달을 감지해 자동으로 Push를 보내는 Scheduler/Cron은 없다(향후 필요 시 별도 설계).
- **간헐적 세션 쿠키 이슈(원인 미규명)**: 오래 유지된 브라우저 탭에서 재로그인을 반복할 때 Server Component 렌더링이 `42501`로 1회 실패한 사례, 그리고 iPhone에서 Push 탭 직후 공지 읽음 기록이 즉시 생기지 않은 사례가 각 1회씩 관측됐다. 두 경우 모두 재현 조건을 좁히지 못했고, 재발 시 재로그인으로 우선 대응한다. 근본 원인 조사는 별도 QA 항목으로 남아있다.
- **매장 분리 미사용**: 현재 Production Pilot은 단일 Store("링크맘 전체")로 운영 중이다. 매장별 데이터 분리(용인본점/동백점 등)가 실제로 필요해지면 기존 `stores`/RLS 설계(이미 매장 추가에 대응 가능하도록 구현됨)를 그대로 활용해 확장한다.

## Rollback

기존 Softr 운영 체계는 계속 유지되고 있다. Production PWA에 문제가 생기면 직원에게 PWA 사용을 일시 중지하도록 안내하고, 기존 Softr Sheet로 즉시 복귀해 업무 공백 없이 운영을 이어갈 수 있다. 상세 절차는 [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) §K 참고.
