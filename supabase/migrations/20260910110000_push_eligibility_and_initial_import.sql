-- Push 정책 수정: Initial Import/Migration으로 생성된 상품은 향후 Push
-- 발송 대상에서 제외한다. promotion_change_logs 기록 자체는 남기되(감사 목적),
-- Phase 11이 실제로 발송할 때 걸러낼 수 있도록 필드를 추가한다.
--
-- 설계 결정:
-- - promotions.is_initial_import: 이 상품이 "해당 Sheet 타입의 첫 Sync"에서
--   들어왔는지 나타내는 감사용 플래그. Sync 엔진이 "이번 실행 전에 이 Sheet
--   타입의 기존 Row가 하나도 없었는가"로 자동 판정한다(수동 설정 불필요 —
--   운영자가 깜빡하고 안 챙길 여지를 없앤다).
-- - promotion_change_logs.push_eligible: Phase 11이 실제로 필터링할 단일
--   컬럼. new_product 로그는 is_initial_import=true인 상품이면 false,
--   그 외(신규 상품이든 기존 상품의 가격/사은품 등 변경이든)에는 기본 true.
--   importance(무엇이 얼마나 중요한 변경인지)와는 독립된 축이다 — importance는
--   "이 필드 종류가 원래 중요한가", push_eligible은 "이 특정 로그 건이
--   지금 시점에 실제로 알림을 쏴도 되는가"를 답한다.

alter table public.promotions
  add column is_initial_import boolean not null default false;

comment on column public.promotions.is_initial_import is
  '이 상품이 해당 promotion_type의 첫 Sync(기존 Row 0건 상태에서의 대량 Import)로 생성됐는지. Phase 11 Push가 이 상품의 new_product 로그를 절대 소급 발송하지 않도록 하는 근거.';

alter table public.promotion_change_logs
  add column push_eligible boolean not null default true;

comment on column public.promotion_change_logs.push_eligible is
  'Phase 11 Push 발송 대상 필터의 기준 컬럼. Initial Import로 생성된 상품의 new_product 로그는 false — 기록(감사)은 남기되 절대 발송하지 않는다. importance와는 별개 축.';

create index promotion_change_logs_push_eligible_idx
  on public.promotion_change_logs (push_eligible, importance, changed_at desc);

-- 이미 실행된 첫 상시 프로모션 실 Sheet Sync(188건)에 소급 적용.
-- 이 migration이 적용되기 전에 이미 들어온 데이터이므로 백필이 필요하다.
-- 판정 기준: 어떤 promotion_type이든, sync_logs상 "이 타입에 대해 신규 건수가
-- 곧 최초 Row 수와 같았던(=그 이전엔 데이터가 없었던) 가장 이른 성공 Sync"의
-- 대상이 된 상품들. 지금 시점에 실제로 존재하는 것은 상시 프로모션 최초
-- Import(188건) 하나뿐이므로 이를 직접 지정해 백필한다.
update public.promotions
set is_initial_import = true
where promotion_type = 'permanent';

update public.promotion_change_logs
set push_eligible = false
where change_type = 'new_product'
  and source_sheet = 'permanent';
