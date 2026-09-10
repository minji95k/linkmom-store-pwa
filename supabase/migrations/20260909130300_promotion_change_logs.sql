-- promotion_change_logs: Sync 시 실제로 바뀐 Field만 기록한다(§42~§47).
-- NEW 탭과 향후 Push가 공유하는 유일한 변경 이력 소스.

create table public.promotion_change_logs (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions (id) on delete cascade,
  product_id text not null,
  changed_field text not null,
  before_value jsonb,
  after_value jsonb,
  change_type public.promotion_change_type not null,
  importance public.change_importance not null,
  source_sheet public.promotion_type not null,
  changed_at timestamptz not null default now()
);

comment on table public.promotion_change_logs is
  'Sync가 감지한 실제 변경분. changed_field는 promotion_field_definitions.field_key와 대응. minor 변경도 기록은 하되(감사 목적) NEW/Push 판정에서는 importance로 걸러낸다.';

create index promotion_change_logs_promotion_idx
  on public.promotion_change_logs (promotion_id, changed_at desc);
create index promotion_change_logs_importance_idx
  on public.promotion_change_logs (importance, changed_at desc);
create index promotion_change_logs_product_id_idx
  on public.promotion_change_logs (product_id, changed_at desc);
