# Production Runbook — 링크맘 매장 직원용 내부 운영 PWA

실제 값(Secret/URL의 세부 정보/초기 비밀번호 등)은 이 문서에 기록하지 않는다. 필요한 값은 Vercel/Supabase Dashboard와 팀 내부 Secret 관리 채널에서 확인한다.

## A. 현재 Production Architecture

```
[PROD] Google Sheet ("링크맘 매장 프로모션 관리")
  └─ [상시 프로모션] / [행사 프로모션] 탭
        │  (담당자가 시트만 수정)
        ▼
Google Apps Script (해당 Sheet에 바인딩)
  ├─ handleEditTrigger (installable onEdit) — 편집 즉시 Partial Sync
  └─ syncAll (시간 기반 트리거, 10분 주기) — Full Snapshot Sync
        │  POST /api/sync/{permanent|event} (Bearer: SYNC_API_SECRET)
        ▼
Vercel Production (Next.js App Router)
  ├─ Sync API Route — Core/Dynamic Field 파싱, 변경분류, 대량비활성화 안전장치
  ├─ Server Actions — Admin 공지/직원 관리
  └─ Web Push 발송 (VAPID, best-effort, 응답 이후 after())
        ▼
Supabase PROD (Postgres + Auth + Realtime + RLS)
  ├─ promotions / promotion_change_logs / event_campaigns
  ├─ notices / notice_targets / notice_reads
  ├─ notifications / notification_targets / notification_deliveries
  └─ profiles / stores / user_store_access / push_subscriptions
        │  (RLS로 직원 화면에 보이는 데이터를 그대로 강제)
        ▼
직원 PWA (iPhone/Android, 홈 화면 설치)
  프로모션 열람 · NEW(72h) · 공지 확인 · Web Push 수신
```

Source of Truth는 **Google Sheet**뿐이다. Supabase는 Sheet를 복제·가공한 결과이고, 직원은 Sheet를 직접 수정하지 않는다(읽기 전용 소비자).

## B. 일상 운영

| 하고 싶은 일 | 방법 |
|---|---|
| 상품 정보(가격/사은품/판매조건 등) 수정 | **[PROD] Google Sheet만 수정한다.** 코드/DB를 직접 만지지 않는다 — 저장하면 10분 이내(또는 즉시 편집 반영 Trigger로 수 초 이내)에 직원 화면에 자동 반영된다. |
| 직원 계정 관리(생성/비활성화/역할 변경) | `/admin/users` |
| 공지 작성/수정 | `/admin/notices` |
| 상품/공지 확인 | 직원은 PWA만 사용한다(관리자 화면 접근 불가). |

## C. 직원 생성 방법

1. `/admin/users`에서 "새 직원 추가".
2. 입력 항목: 이름, 이메일, Store(현재 Production Pilot 범위에서는 **링크맘 전체** 1개만 존재), Role = **STAFF**.
3. 초기 비밀번호는 사전에 확정된 공통 초기 비밀번호를 사용한다(실제 값은 이 문서에 기록하지 않음 — 팀 내부 채널 확인).
4. 직원에게 이메일 + 초기 비밀번호를 안전한 채널로 전달한다.
5. 직원은 최초 로그인 후 **MY → 비밀번호 변경**에서 반드시 본인 비밀번호로 교체한다.

## D. 직원 PWA 설치

**iPhone(Safari 전용 — 다른 브라우저에서는 홈 화면 추가가 동작하지 않는다)**
1. Safari로 Production URL 접속.
2. 하단 공유 버튼 → "홈 화면에 추가".
3. 반드시 **홈 화면에 설치된 아이콘으로 실행**한다 — Safari 탭에서 그대로 쓰면 Web Push를 받을 수 없다(iOS 제약).

**Android(Chrome)**
1. Chrome으로 Production URL 접속.
2. 메뉴 → "앱 설치" 또는 "홈 화면에 추가".

## E. Push 설정

1. PWA에서 **MY → 알림 받기** 클릭.
2. OS 알림 권한 요청 팝업에서 허용.

**문제 발생 시(알림 권한은 허용됐는데 실제로 안 오는 경우):**
- MY 화면에 다시 들어가기(새로고침)만 하면 된다 — self-healing 로직이 로컬 구독과 서버 등록 상태를 자동으로 다시 맞춘다.
- 사용자가 "이 기기 알림 끄기"를 직접 누른 적이 없다면, OS 알림 권한을 다시 건드리거나 앱을 재설치할 필요는 없다.

## F. Google Sheet 운영 주의사항

- **`product_id` 컬럼은 절대 수동으로 입력/수정/삭제하지 않는다.** 신규 상품 행은 이 셀을 비워두면 서버가 자동으로 채번해 되쓴다.
- **행사명 / 행사 시작일 / 행사 종료일 / 노출여부**(행사 프로모션 시트 전용): 같은 행사명을 쓰는 여러 행은 자동으로 하나의 캠페인으로 묶인다. 시작/종료일과 노출여부의 실제 동작은 아래 G절 참고.
- **`[상시 프로모션]` / `[행사 프로모션]` 시트 이름을 임의로 바꾸지 않는다** — Apps Script가 이 이름으로 시트를 찾는다.
- **기존 Core Header(브랜드/제품명/가격/사은품 등 이미 쓰이고 있는 컬럼명)를 임의로 바꾸지 않는다** — 헤더 문자열로 매핑하므로, 이름을 바꾸면 그 컬럼이 통째로 인식되지 않는다. 컬럼 순서를 바꾸는 것은 안전하다(위치가 아니라 헤더 텍스트로 매핑).
- **새 컬럼(Dynamic Field) 추가는 지원된다** — 추가하면 재배포 없이 자동으로 인식되지만, 기본값은 "표시만 ON, 검색/필터/NEW/Push는 OFF"다. 검색·Push 대상으로 삼고 싶은 필드가 새로 필요하면 사전에 영향 범위를 확인 후 진행한다(단순 추가만으로는 부족할 수 있음).

## G. 행사 운영

- **노출여부 = OFF** → 기간과 무관하게 무조건 비노출.
- **노출여부 = ON + 오늘이 행사 기간 내** → 노출.
- **노출여부 = ON + 오늘이 행사 기간 전/후** → **자동으로 비노출**된다(담당자가 OFF로 바꾸는 걸 깜빡해도 안전). 노출 종료는 데이터 삭제가 아니라 화면에서만 숨기는 것이므로, 데이터는 그대로 남아 있다.

## H. 자동 Sync

| Trigger | 역할 | 평상시 개수 |
|---|---|---|
| `handleEditTrigger` | installable onEdit — 셀 편집을 3초 디바운스 후 Partial Sync(비활성화 로직 없음, 안전) | **1개** |
| `syncAll` | 시간 기반, 10분 주기 — Full Snapshot Sync(대량 비활성화 안전장치 적용) | **1개** |
| `flushPendingSync` | 디바운스용 1회성 트리거 — 실행 직후 스스로 정리됨 | 평상시 **0개**(쌓여있으면 §I 참고) |

Apps Script 트리거 목록에서 이 개수를 벗어나면(중복 `handleEditTrigger`, `flushPendingSync` 누적 등) 비정상 상태다.

## I. 장애 확인

1. **`sync_logs`(Supabase)**: 최근 Sync가 `success=true`인지, `sync_mode`(partial/full_snapshot)가 기대와 맞는지, `failed_count`/`skipped_count`/`error_detail`/`skipped_detail`을 확인한다.
2. **Vercel Logs**(Production Deployment → Logs): Sync API/Server Action에서 5xx나 예외가 있는지 확인한다.
3. **`notification_deliveries`(Supabase)**: Push 발송 결과의 `status`/`error_message`를 확인한다(`sent`/`failed`/`expired`).
4. **Supabase Logs**(Dashboard → Logs): Postgres/API 레벨 에러를 확인한다.

## J. 절대 하면 안 되는 것

- DEV와 PROD Secret(.env.local ↔ .env.production.local, Supabase 프로젝트, VAPID 키)을 혼용하지 않는다.
- 이미 채번된 `product_id`를 재생성/재사용하지 않는다.
- Production Supabase에서 DEV용 seed/clean 스크립트(`db:seed*`, `db:clean:promotions` 등)를 실행하지 않는다 — DEV 전용이다.
- `syncAll`을 검증 목적으로 반복 수동 실행하지 않는다 — 실 데이터에 불필요한 Sync 이력만 쌓인다.
- PROD DB를 Service Role로 직접 임의 수정하지 않는다 — 데이터 변경은 항상 Migration 파일 또는 정식 Admin 기능을 통한다.
- Service Role Key/VAPID Private Key를 클라이언트 코드, 로그, 문서, 커밋에 노출하지 않는다.

## K. Rollback

Production PWA에 심각한 문제가 발생하면:

1. 직원들에게 PWA 사용을 일시 중지하도록 안내한다.
2. 기존 Softr 운영 체계로 되돌린다(**기존 Softr Sheet는 계속 유지되고 있으므로** 그대로 사용 재개 가능).
3. 기존 Softr Sheet를 그대로 사용해 업무 공백 없이 운영을 이어간다.
4. PROD 문제를 진단·수정한다(DEV에서 먼저 재현/검증 후 PROD 적용 원칙 유지).
5. 문제 해결 후 다시 소규모 Pilot으로 검증한 뒤 전체 재개한다.
