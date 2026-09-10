-- event_campaigns: [행사 프로모션] 시트에 신설되는 행사명/시작일/종료일/노출여부를
-- 담는다(§21~§25, sync-design.md §7 확정 사항). 여러 행사가 동시에 존재할 수 있다.

create table public.event_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_name text not null,
  -- Spreadsheet의 "행사명" 값(trim)을 그대로 매칭 키로 쓴다. 같은 행사명을 쓰는
  -- 여러 상품 Row가 동일 campaign으로 묶인다.
  campaign_key text not null unique,
  start_at timestamptz,
  end_at timestamptz,
  is_visible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.event_campaigns is
  '행사 캠페인. 노출 여부는 is_visible AND 현재시각이 [start_at, end_at] 사이일 때만 true — event_campaigns_visible 뷰가 매 조회 시 재계산하므로 담당자가 OFF를 깜빡해도 자동으로 비노출된다(§23).';

create trigger event_campaigns_set_updated_at
  before update on public.event_campaigns
  for each row
  execute function public.set_updated_at();

create table public.event_campaign_products (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.event_campaigns (id) on delete cascade,
  promotion_id uuid not null references public.promotions (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (campaign_id, promotion_id)
);

create index event_campaign_products_campaign_idx on public.event_campaign_products (campaign_id);
create index event_campaign_products_promotion_idx on public.event_campaign_products (promotion_id);

-- 노출 판정은 매 조회 시 재계산 — 별도 배치 Job이 필요 없다(§23).
-- 시작/종료일이 아직 입력되지 않은 캠페인은 "언제까지가 진행중인지" 알 수 없으므로
-- 안전하게 비노출 처리한다(Safe Default).
create view public.event_campaigns_visible as
select *
from public.event_campaigns
where is_visible = true
  and start_at is not null
  and end_at is not null
  and now() between start_at and end_at;
