-- promotions: Core Field + Dynamic Field(JSONB) 하이브리드.
-- docs/database-schema.md §2 그대로. 컬럼 설명은 해당 문서 참조.

create extension if not exists pg_trgm;

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  product_id text not null unique,
  legacy_softr_record_id text,
  promotion_type public.promotion_type not null,

  brand text not null,
  product_name text not null,
  color text[] not null default '{}',
  period_label text,
  notice_type text,

  consumer_price integer,
  base_sale_price integer,
  final_price_card integer,
  final_price_cash integer,

  store_operation_note text,
  default_components text,
  gift text,
  photo_review_benefit text,
  store_promotion_allowed text,
  remarks text,

  extra_fields jsonb not null default '{}'::jsonb,

  is_active boolean not null default true,
  last_important_change_at timestamptz,
  source_row_updated_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.promotions is
  'Google Sheet [상시 프로모션]/[행사 프로모션] Sync 결과. Source of Truth는 Spreadsheet이며 이 테이블은 직원 화면 조회용 캐시. 직접 CRUD하지 않고 오직 Sync API(service_role)만 쓴다.';
comment on column public.promotions.product_id is
  '회사 소유 불변 식별자. 제품명이 아닌 이 값으로 Upsert한다. next_product_id()로 채번.';
comment on column public.promotions.extra_fields is
  'Dynamic Field 저장소. Spreadsheet에 새 컬럼이 생겨도 재배포 없이 여기 쌓인다.';

create index promotions_brand_idx on public.promotions (brand);
create index promotions_product_name_trgm_idx on public.promotions using gin (product_name gin_trgm_ops);
create index promotions_type_idx on public.promotions (promotion_type);
create index promotions_active_idx on public.promotions (is_active);
create index promotions_last_important_change_idx on public.promotions (last_important_change_at desc);

create trigger promotions_set_updated_at
  before update on public.promotions
  for each row
  execute function public.set_updated_at();
