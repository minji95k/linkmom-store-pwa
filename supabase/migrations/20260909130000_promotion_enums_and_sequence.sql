-- Phase 6: Promotion Data Migration / Google Sheet Sync
-- docs/sync-design.md, docs/database-schema.md §2-3 그대로 구현한다.

create type public.promotion_type as enum ('permanent', 'event');
create type public.change_importance as enum ('critical', 'important', 'minor');
create type public.promotion_change_type as enum (
  'new_product', 'price', 'promotion', 'benefit', 'gift', 'event_period',
  'store_operation', 'configuration', 'minor_edit'
);

-- product_id 채번 전략 (sync-design.md §4, "초기 Row"와 "신규 Row"를 구분하지 않는다):
-- Postgres sequence는 동시성 아래에서도 원자적으로 유일한 다음 값을 보장하므로,
-- 최초 Import로 한 번에 188개 상품이 들어오는 경우와 이후 한 개씩 신규 상품이
-- 추가되는 경우를 별도 로직으로 나눌 필요가 없다 — 둘 다 "product_id가 비어있는
-- Row를 만났다"는 동일한 이벤트이고, 이 함수가 순서대로 안전하게 다음 번호를
-- 내어준다. 별도의 "초기용 로직"을 따로 만드는 것이 오히려 두 코드경로 사이의
-- 경합/중복 위험을 키운다.
create sequence public.promotion_product_id_seq start with 1;

create function public.next_product_id()
returns text
language sql
as $$
  select 'PROD-' || lpad(nextval('public.promotion_product_id_seq')::text, 6, '0');
$$;

-- Phase 6부터 등장하는 테이블들이 공통으로 쓰는 updated_at 자동 갱신 트리거.
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
