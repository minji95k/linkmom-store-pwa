# Database Schema (Phase 2)

> PostgreSQL(Supabase) 기준. 실제 마이그레이션 파일은 Phase 4 이후 `supabase/migrations/`에 작성한다. 여기서는 설계만 확정한다. 가격은 숫자(정수/원 단위), 날짜는 `timestamptz`를 사용하고 문자열 저장을 금지한다(§72, 실측 결과 Spreadsheet의 가격 컬럼도 이미 숫자형이라 이 원칙과 자연스럽게 정합).

## 1. 사용자 / 매장

### `profiles`
Supabase `auth.users`와 1:1.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid (PK, = auth.users.id) | |
| name | text | |
| email | text | |
| role | text (`ADMIN`\|`STORE_MANAGER`\|`STAFF`) | |
| is_active | boolean default true | 비활성화 시 로그인 차단(RLS+Auth 훅) |
| created_at / updated_at | timestamptz | |

### `stores`
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid (PK) | |
| name | text | ✅ 확정: "용인본점", "동백점" (초기 시드 데이터 2건). 향후 매장 추가 계획이 있으므로 코드 어디에도 매장명/개수를 하드코딩하지 않는다 |
| code | text unique | 짧은 코드 (Spreadsheet `매장 별 운영` 자유텍스트 파싱/매핑용, 예: `"동백"`) |
| is_active | boolean default true | |
| created_at / updated_at | timestamptz | |

### `user_store_access`
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid (PK) | |
| user_id | uuid FK → profiles.id | |
| store_id | uuid FK → stores.id | |
| created_at | timestamptz | |

N:M — 한 사용자가 여러 매장에 소속 가능(§50). ADMIN은 이 테이블과 무관하게 전체 매장 접근(Role 체크로 우회).

## 2. 프로모션 (Core + Dynamic)

### `promotions`
Core Field는 실측 Spreadsheet 헤더를 기준으로 매핑한다.

| 컬럼 | 타입 | 원본 Spreadsheet 컬럼(상시/행사) | 설명 |
|---|---|---|---|
| id | uuid (PK) | — | 내부 PK |
| product_id | text unique | *(신설 확정, 서버 자동 채번)* | 회사 소유 불변 식별자 (§15). ✅ 확정: 담당자가 직접 입력하지 않고 **서버가 자동 채번**하여 Apps Script로 시트 셀에 다시 써준다(sync-design.md §4). 마이그레이션 초기엔 `legacy_softr_record_id` 기반 시드 |
| legacy_softr_record_id | text | `🔐 Softr Record ID` | 이관 매핑 참고용, 실측상 상시/행사 각각 유일값 확인됨 |
| promotion_type | text (`permanent`\|`event`) | 시트 출처 | §17 — 어느 Source Sheet 출신인지 식별 |
| brand | text | 브랜드 | |
| product_name | text | 제품명 | |
| color | text[] (array) | 컬러 | 콤마/`+` 구분 다중값이 실측에서 확인되어 배열로 정규화 |
| period_label | text | 행사 기간 | 원문 그대로 보존("상시", "8/1~8/31" 등) — 파싱은 표시용 보조 필드로 별도 처리 가능 |
| notice_type | text | 공지유형 | 실측 결측률 92%(상시) — nullable 필수 |
| consumer_price | integer | 소비자가 | 원 단위 |
| base_sale_price | integer nullable | 기준 판매가 | 행사 시트에서 2건 결측 확인 |
| final_price_card | integer nullable | 최종 판매가(카드결제) | |
| final_price_cash | integer nullable | 최종판매가(현금or계좌이체) | |
| store_operation_note | text | 매장 별 운영 | 자유텍스트("모두 운영"/"OO 불가"). 향후 매장 수 증가 시 구조화 테이블 전환 검토 |
| default_components | text | 기본 구성품 | 상시 전용 |
| gift | text | 증정사은품(상시) / 행사 사은품(행사) | 시트별 컬럼명이 다르므로 Sync 매핑에서 통합 |
| photo_review_benefit | text | 포토후기 | 상시 전용 |
| store_promotion_allowed | text | 매장프로모션 | "가능"/"불가" |
| remarks | text | 비고 | |
| extra_fields | jsonb default '{}' | *(향후 신규 컬럼)* | Dynamic Field 저장소 |
| is_active | boolean default true | — | Soft Delete(빈 Row/제외 대상) |
| is_initial_import | boolean default false | — | ✅ 확정(2026-09-10, 실 DEV Sheet 188건 Import로 검증): 해당 `promotion_type`의 **첫 Sync**(기존 Row 0건 상태)에서 생성됐는지. Sync 엔진이 자동 판정(수동 플래그 아님). Push 소급 발송 방지 근거 — push-design.md §3.1 |
| last_important_change_at | timestamptz nullable | — | NEW 판정 기준 (§44) |
| source_row_updated_at | timestamptz nullable | 수정일(상시만 존재) | 참고용, NEW 판정의 기준으로 직접 사용하지 않음(행사 시트엔 없음 — Sync 자체 diff로 통일) |
| created_at / updated_at | timestamptz | — | |

인덱스: `brand`, `product_name`(trigram/GIN for 검색), `promotion_type`, `is_active`, `last_important_change_at desc`.

### `promotion_field_definitions`
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid (PK) | |
| field_key | text unique | extra_fields의 JSON key와 매칭 |
| source_sheet | text (`permanent`\|`event`) | |
| source_column_name | text | Spreadsheet 헤더 원문(trim 후 비교) |
| display_label | text | |
| display_order | integer | |
| data_type | text default `text` | |
| is_visible | boolean default true | Safe Default (§31) |
| is_searchable | boolean default false | |
| is_filterable | boolean default false | |
| change_importance | text default `minor` (`critical`\|`important`\|`minor`) | |
| push_enabled | boolean default false | |
| created_at / updated_at | timestamptz | |

Core Field(브랜드/가격 등)도 이 테이블에 행을 미리 시드해 두어, NEW/Push 로직이 Core/Dynamic 구분 없이 이 테이블 하나만 참조하도록 한다(§27, §45 설계 일치).

### `promotion_change_logs`
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid (PK) | |
| promotion_id | uuid FK → promotions.id | |
| product_id | text | 비정규화 보관(조회 편의) |
| changed_field | text | field_key |
| before_value | jsonb | |
| after_value | jsonb | |
| change_type | text (`new_product`\|`price`\|`promotion`\|`benefit`\|`gift`\|`event_period`\|`store_operation`\|`configuration`\|`minor_edit`) | |
| importance | text (`critical`\|`important`\|`minor`) | |
| source_sheet | text | |
| push_eligible | boolean default true | ✅ 확정(2026-09-10): Phase 11 Push 발송 필터의 기준 컬럼. `is_initial_import=true`인 상품의 `new_product` 로그는 `false`(기록은 남기되 발송 안 함). `importance`와 별개 축 — push-design.md §3.1 |
| changed_at | timestamptz default now() | |

인덱스: `(promotion_id, changed_at desc)`, `(importance, changed_at desc)`, `(push_eligible, importance, changed_at desc)`.

## 3. 행사 캠페인

### `event_campaigns`
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid (PK) | |
| campaign_name | text | ✅ 신설 확정 — [행사 프로모션] 시트에 `행사명` 컬럼 추가(개발/복제 시트 검증 후 반영) |
| campaign_key | text unique nullable | 신설 `행사명` 컬럼 값 기준으로 매칭 |
| start_at | timestamptz | ✅ 신설 확정 — `시작일` 컬럼(연도 포함 명시적 날짜) |
| end_at | timestamptz | ✅ 신설 확정 — `종료일` 컬럼 |
| is_visible | boolean default false | ✅ 신설 확정 — `노출여부` 컬럼(ON/OFF)을 관리자가 Spreadsheet에서 토글 |
| created_at / updated_at | timestamptz | |

### `event_campaign_products`
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid (PK) | |
| campaign_id | uuid FK → event_campaigns.id | |
| promotion_id | uuid FK → promotions.id | |
| created_at | timestamptz | |

`is_campaign_visible_now(campaign)` View/함수로 §21~§23 로직을 SQL 레벨에서 계산(아래 예시):
```sql
create or replace view event_campaigns_visible as
select *
from event_campaigns
where is_visible = true
  and now() between start_at and end_at;
```

## 4. 공지 / 교육자료

### `notices`
id, title, body, notice_type(`일반`\|`중요`\|`긴급`\|`필독`\|`행사`\|`발주`\|`판매가변경`\|`공급가변경`\|`운영`\|`시스템`), author_id FK→profiles, published_at, expires_at, is_pinned boolean, requires_confirmation boolean, created_at/updated_at.

### `notice_targets`
notice_id FK, target_type(`all`\|`store`\|`role`\|`user`), store_id FK nullable, role text nullable, user_id FK nullable.

### `notice_reads`
notice_id FK, user_id FK, read_at, confirmed_at nullable. Unique(notice_id, user_id).

### `training_materials`
id, product_name, brand, category, image_url, summary, key_selling_points text, author_id FK, is_important boolean, is_required boolean, created_at/updated_at.

### `training_material_files`
id, material_id FK, file_type(`pdf`\|`image`\|`ppt`\|`doc`\|`url`\|`video_url`\|`detail_page_url`), storage_path or external_url.

### `training_material_targets`
material_id FK, target_type/store_id/role/user_id — notice_targets와 동일 패턴.

### `training_material_reads`
material_id FK, user_id FK, read_at, completed_at nullable. Unique(material_id, user_id).

## 5. Push / Notification

### `push_subscriptions`
id, user_id FK, endpoint text unique, p256dh text, auth text, device_label text nullable, created_at, last_seen_at.  
(User:Device = 1:N — 실측 요구사항 §59와 일치)

### `notifications`
id, type(`notice`\|`training`\|`price_change`\|`promotion_change`\|`event`\|`summary`), title, body, importance, deep_link, created_at.

### `notification_targets`
notification_id FK, target_type/store_id/role/user_id.

### `notification_deliveries`
id, notification_id FK, subscription_id FK, status(`requested`\|`sent`\|`failed`\|`expired`), sent_at, error_message nullable.

### `user_notification_preferences`
user_id FK (PK), push_enabled boolean, categories jsonb (카테고리별 on/off, 필요 시).

## 6. Sync / Audit

### `sync_logs`
id, source_sheet(`permanent`\|`event`), started_at, finished_at, success boolean, inserted_count, updated_count, deactivated_count, failed_count, error_detail jsonb nullable, **`sync_mode`**(`full_snapshot`\|`partial`, nullable) **`received_row_count`**(integer, nullable) — 이 실행이 어떤 모드로 몇 개 Row를 받았는지, 사후에 DB만으로 확인할 수 있게 2026-09-15 추가(`20260915090000_sync_logs_mode_and_row_count.sql`). 요청을 받는 즉시(성공/실패와 무관하게) 기록되므로 source_sheet 불일치 등으로 즉시 실패한 경우에도 감사 목적으로 남는다. 2026-09-15 이전 Row는 당시 기록되지 않아 두 컬럼 모두 NULL(추측으로 채우지 않음).

### `promotion_sync_state` ✅ 확정(2026-09-11, 실제 Hard Delete 재현 테스트로 검증)
promotion_type(PK), initial_import_completed_at timestamptz nullable. Sheet 타입별 "최초 Import가 끝났는지"를 나타내는 영구 상태 — `promotions` Row 개수가 아니라 이 테이블로 판정해야 하는 이유는 `is_initial_import` 판정 로직이 단순 "Row 0건 여부"면 Hard Delete 후 재Sync 시 오판정될 수 있기 때문(push-design.md §3.1). `mark_initial_import_completed(promotion_type)` 함수가 COALESCE로 최초 1회만 값을 채우고 이후 절대 덮어쓰지 않는다.

### `audit_logs`
id, actor_id FK→profiles, action text, target_table text, target_id text, before jsonb, after jsonb, created_at.

### `attachments`
id, owner_type(`notice`\|`training`\|`profile`), owner_id, storage_path, mime_type, size_bytes, uploaded_by FK, created_at.

## 7. ERD 요약

```
profiles ─┬─< user_store_access >─┬─ stores
          │                        │
          │                        └─< promotions.store_operation_note (텍스트, 관계아님 — 향후 구조화 검토)
          │
          ├─< notice_reads >── notices ─< notice_targets
          ├─< training_material_reads >── training_materials ─< training_material_files
          │                                        └─< training_material_targets
          ├─< push_subscriptions >─< notification_deliveries >── notifications ─< notification_targets
          └─< audit_logs

promotions ─< promotion_change_logs
           ─< event_campaign_products >── event_campaigns
promotion_field_definitions (참조 전용, FK 없음 — field_key 매칭)
sync_logs (독립 테이블, promotions와 논리적 연관)
```

## 8. Core Field vs Dynamic JSONB 판단 기준

- **Core Field로 컬럼화**: 검색/필터/가격계산/NEW-Push 판정/권한 로직에 직접 쓰이는 필드 (현재 15개 실측 Core 후보 전부 해당).
- **Dynamic(JSONB `extra_fields`)로 저장**: 향후 신설되는 일반 정보성 컬럼(§26 예시: 택배배송 여부, DP 여부 등) — 기본은 표시만 하고 검색/필터/NEW/Push는 OFF.
