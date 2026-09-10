-- promotion_field_definitions: Core Field(양쪽 Sheet 공통 개념, source_sheet=NULL)와
-- Dynamic Field(Sheet별로 발견된 컬럼, source_sheet 지정)를 한 테이블에서 관리한다.
-- NEW 판정과 Push 판정이 이 테이블 하나만 참조하도록 하여(§27, §45) 서로 다른
-- 중요도 로직이 생기지 않게 한다 (CLAUDE.md 절대 원칙 7).

create table public.promotion_field_definitions (
  id uuid primary key default gen_random_uuid(),
  field_key text not null unique,
  is_core boolean not null default false,
  -- Core Field는 두 Sheet 모두에 적용되는 개념이라 source_sheet가 없다(NULL).
  -- Dynamic Field는 발견된 Sheet가 명확해야 한다.
  source_sheet public.promotion_type,
  source_column_name text,
  display_label text not null,
  display_order integer not null default 0,
  data_type text not null default 'text',
  is_visible boolean not null default true,
  is_searchable boolean not null default false,
  is_filterable boolean not null default false,
  change_importance public.change_importance not null default 'minor',
  push_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotion_field_definitions_dynamic_needs_source check (
    is_core or (source_sheet is not null and source_column_name is not null)
  )
);

comment on table public.promotion_field_definitions is
  'Core+Dynamic Field 메타데이터. 새 Spreadsheet 컬럼이 발견되면 Sync가 이 테이블에 자동으로 행을 추가한다 — 재배포 없이 반영되는 지점 (docs/sync-design.md §6, §10).';

-- Dynamic Field는 (source_sheet, source_column_name) 조합으로 기존 정의를 찾는다.
-- Core Field는 여기 포함되지 않는다(Sheet마다 원본 헤더 문자열이 다를 수 있으므로
-- 코드의 CORE_FIELD_MAP이 헤더→field_key 매핑의 기준이다 — 이 인덱스는 Dynamic만).
create unique index promotion_field_definitions_dynamic_lookup
  on public.promotion_field_definitions (source_sheet, source_column_name)
  where not is_core;

create trigger promotion_field_definitions_set_updated_at
  before update on public.promotion_field_definitions
  for each row
  execute function public.set_updated_at();

-- Core Field 15종 시드. change_importance/push_enabled는
-- product-requirements.md §7 Change Classification 표 그대로.
insert into public.promotion_field_definitions
  (field_key, is_core, display_label, display_order, data_type, is_searchable, is_filterable, change_importance, push_enabled)
values
  ('brand', true, '브랜드', 10, 'text', true, true, 'minor', false),
  ('product_name', true, '제품명', 20, 'text', true, false, 'minor', false),
  ('color', true, '컬러', 30, 'text[]', true, false, 'minor', false),
  ('period_label', true, '행사 기간', 40, 'text', false, false, 'important', true),
  ('notice_type', true, '공지유형', 50, 'text', false, true, 'minor', false),
  ('consumer_price', true, '소비자가', 60, 'integer', false, false, 'important', true),
  ('base_sale_price', true, '기준 판매가', 70, 'integer', false, false, 'important', true),
  ('final_price_card', true, '최종 판매가 (카드결제)', 80, 'integer', false, false, 'important', true),
  ('final_price_cash', true, '최종 판매가 (현금/계좌이체)', 90, 'integer', false, false, 'important', true),
  ('store_operation_note', true, '매장 별 운영', 100, 'text', false, false, 'important', true),
  ('default_components', true, '기본 구성품', 110, 'text', false, false, 'important', true),
  ('gift', true, '증정 사은품', 120, 'text', false, false, 'important', true),
  ('photo_review_benefit', true, '포토후기 혜택', 130, 'text', false, false, 'important', true),
  ('store_promotion_allowed', true, '매장 자체 프로모션', 140, 'text', false, false, 'important', true),
  ('remarks', true, '비고', 150, 'text', false, false, 'minor', false);
