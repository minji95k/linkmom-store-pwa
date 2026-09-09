# Sync Design (Phase 2)

> 실측 데이터([current-system-analysis.md](./current-system-analysis.md))를 기준으로 설계했다. 두 시트는 헤더 구조가 다르므로 별도 매핑 테이블을 각각 유지한다.

## 1. [상시 프로모션] vs [행사 프로모션] 역할

| | [상시 프로모션] | [행사 프로모션] |
|---|---|---|
| 목적 | 평상시 기본 상품 프로모션 | 한정기간 특별 행사상품 |
| 실측 규모 | 188행 / 18컬럼 | 16행 / 14컬럼 |
| `promotion_type` | `permanent` | `event` |
| 캠페인 개념 | 없음(개별 상품 단위) | `event_campaigns`로 그룹핑 |
| 노출 제어 | 없음(항상 노출, `is_active`만) | ON/OFF + 기간 자동 제어 |
| 사은품 컬럼명 | `증정사은품` | `행사 사은품` (실측상 컬럼명이 다름 — Sync 매핑에서 둘 다 `gift`로 통합) |
| 변경일 추적 | `수정일` 컬럼 존재 | 없음(실측 확인) → Sync 자체 diff로 변경 감지 |

두 시트를 하나의 목록으로 무조건 합치지 않는다(§9). `promotion_type`으로 항상 구분 가능하게 유지한다.

## 2. Source of Truth

Google Spreadsheet → Supabase **One-way Sync**. 직원 PWA는 원본을 수정하지 않는다. 양방향 동기화로 인한 충돌을 원천 차단.

## 3. Architecture

```
Spreadsheet onEdit / 5~10분 주기 Trigger
        ▼
Google Apps Script
    - 시트별로 헤더(1행) 읽기
    - 데이터 행 직렬화(JSON)
    - Bearer Secret Token 첨부
        ▼  HTTPS POST
Next.js API Route  /api/sync/permanent  ,  /api/sync/event
    - Token 검증(401 즉시 반환)
    - Header → Core Field 매핑 (trim 후 exact match)
    - 매핑 안 되는 Header → Dynamic Field 후보
    - Validation (아래 5장)
    - Upsert 실행 (Service Role Key, 서버 프로세스 내부에서만 사용)
    - Change 감지 → promotion_change_logs / last_important_change_at 갱신
    - Push 대상 큐 적재 (push-design.md)
    - sync_logs 기록
        ▼
Supabase PostgreSQL
```

Apps Script는 Service Role Key를 절대 보유하지 않는다(§16).

## 4. Product ID 전략 ✅ 확정(서버 자동 채번)

- 현재 자연키(`브랜드+제품명+컬러`)는 실측상 중복 0건이지만 §15 원칙에 따라 회사 소유의 불변 `product_id`를 별도로 둔다.
- **1단계(마이그레이션)**: `🔐 Softr Record ID`를 `legacy_softr_record_id`로 보존하고, 이를 시드로 `product_id`를 발급(예: `PROD-000001` 순번). 실측상 상시/행사 각각 Record ID가 유일하므로 안전하게 매핑 가능.
- **2단계(운영, 확정된 방식)**: Spreadsheet에 `product_id` 컬럼을 신설한다(§15). **담당자는 이 컬럼에 아무것도 입력하지 않는다.**
  - 담당자가 신규 상품 Row를 추가하고 `product_id`를 빈칸으로 저장 → 다음 Sync 때 서버가 이를 신규 상품으로 인식(빈 `product_id` + 값이 있는 브랜드/제품명 조합) → **서버가 순번 채번(`PROD-000189`식) → Apps Script API를 통해 해당 Row의 `product_id` 셀에 값을 다시 써준다.**
  - Write-back은 `product_id` 컬럼 1개에만 한정한다. 그 외 컬럼은 절대 역기록하지 않는다(One-way 원칙 유지, §12).
  - 실제 운영 시트를 바로 고치지 않고 개발/복제 시트에서 먼저 이 흐름(빈칸 저장 → 자동 채번 → 셀 반영)을 검증한다(§15, §92).

## 5. Multi-sheet Sync 규칙

- **Upsert 기준**: `product_id`(또는 마이그레이션 과도기엔 `legacy_softr_record_id`)로 매칭 → 있으면 UPDATE, 없으면 INSERT
- **삭제/비활성**: 이번 Sync 페이로드에 없는 기존 `product_id`는 즉시 삭제하지 않고 `is_active=false` (Soft Delete). 전체 삭제 후 재등록 방식 금지(§18).
- **빈 Row**: 브랜드/제품명이 모두 공백이면 무시.
- **중복 product_id**: 같은 배치 내 중복 발견 시 해당 Row는 Error로 처리하고 나머지는 계속 진행, `sync_logs.error_detail`에 기록.
- **잘못된 가격값**: 숫자 파싱 실패 시 해당 Row Validation Error 처리, 이전 값 유지(덮어쓰지 않음).
- **컬럼명 공백 불일치 대응**: 실측 결과 `최종 판매가 (카드결제)`와 `최종판매가 (현금or계좌이체)`처럼 표기가 살짝 다름 → 헤더 비교 시 trim + 공백 정규화 후 매칭.

## 6. Dynamic Column 감지 및 제외 목록

Header 순회 시 아래 컬럼은 **Dynamic Field 자동 생성 대상에서 제외**(Softr 전용 메타데이터로 간주, 별도 처리):

| 제외 컬럼(상시 시트 실측) | 사유 |
|---|---|
| `수정일` | Softr 자동 타임스탬프. NEW 판정은 자체 diff로 계산하므로 그대로 신뢰하지 않음 |
| `NEW` | Softr의 구(舊) 7일 뱃지 값. 신규 시스템의 NEW 로직과 무관 |
| `최근 수정 건수` | 실측 결과 상품별 데이터가 아니라 요약 통계 셀이 우연히 한 행에 섞여 들어간 것으로 확인됨 — Dynamic Field화 시 데이터 오염 위험 |
| `🔐 Softr Record ID` | `legacy_softr_record_id` Core 컬럼으로 별도 저장, 일반 Dynamic Field 아님 |

그 외 알려지지 않은 새 Header가 나타나면:
1. `promotion_field_definitions`에 자동 행 생성 (Safe Default: 표시 ON, 검색/필터/NEW/Push OFF, type=text)
2. 값은 `promotions.extra_fields`(JSONB)에 `{ field_key: value }`로 저장
3. Admin 화면에서 이후 설정 변경 가능 (재배포 불필요)

## 7. 행사 노출/비노출 & 자동 기간 제어 ✅ 확정(컬럼 신설 동의)

- 실측 결과 [행사 프로모션] 시트에는 노출여부/시작일/종료일/행사명 컬럼이 없었으나, 본사 담당자가 아래 컬럼 신설에 동의했다(product-requirements.md §8):
  - `행사명` (text)
  - `행사 시작일`, `행사 종료일` (연도 포함 명시적 날짜, 예: `2026-09-20`) — 기존 `행사 기간`(자유텍스트, 연도 없음)은 표시용 원문으로 유지
  - `노출여부` (`ON`/`OFF` 값 — Spreadsheet에서 담당자가 쉽게 토글 가능한 형태)
- Sync는 이 값을 그대로 `event_campaigns.is_visible`, `start_at`, `end_at`에 매핑
- 최종 노출 여부는 **DB View(`event_campaigns_visible`)가 매 요청 시 시간 조건을 재계산**하므로, 담당자가 종료 후 OFF 처리를 깜빡해도 자동으로 비노출 처리됨(§23) — 별도 배치 Job 불필요.
- 행사 데이터는 노출 여부와 무관하게 삭제하지 않는다(§21) — `event_campaigns`/`event_campaign_products` 행은 그대로 보존.

## 8. Sync Log

`sync_logs`에 시트별로 다음을 기록:
- source_sheet(permanent/event), 실행시각, 성공여부, 신규/수정/비활성/실패 건수, 실패 사유, 마지막 정상 Sync 시각

Admin 화면 표시 예:
```
상시 프로모션   마지막 정상 Sync 14:32   142건 처리
행사 프로모션   마지막 정상 Sync 14:31   37건 처리
```

## 9. Data Freshness

- 목표: Spreadsheet 저장 → Apps Script Trigger(수 초~수 분 내) → Supabase 반영 → 열려있는 PWA는 Supabase Realtime 구독으로 자동 갱신 Toast, 닫혀있으면 다음 접속 시 최신 데이터.
- 모든 테이블을 Realtime 구독하지 않고 `promotions`, `event_campaigns`, `notices` 등 갱신 신호가 필요한 테이블만 선별 구독(§20).

## 10. 재배포 없이 반영되는 것 vs 개발이 필요한 것

| 재배포 불필요 | 추가 개발 필요 |
|---|---|
| 신규 일반 컬럼 추가 → Dynamic Field로 저장/표시 | 새 컬럼이 가격 계산식에 관여 |
| Admin이 Field 표시순서/검색/필터 On-Off 변경 | 새 컬럼이 특수 UI(예: 이미지 갤러리) 요구 |
| 상품 데이터 값 변경(Spreadsheet 수정) | 새 컬럼이 새로운 권한 로직 요구 |
| 행사 노출 ON/OFF, 기간 변경 | 새로운 Push 정책/Workflow 요구 |
