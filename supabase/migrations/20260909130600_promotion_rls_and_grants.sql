-- Phase 5에서 확인했듯, 이 DEV 프로젝트는 신규 테이블에 대한 기본 권한을
-- anon/authenticated/service_role에 자동 상속하지 않는다. 매 신규 테이블마다
-- 명시적으로 GRANT한다. RLS가 실제 행 단위 접근을 통제하므로 이 GRANT는
-- "테이블에 접근을 시도할 수 있는 권한"만 부여할 뿐이다.

grant all on
  public.promotions,
  public.promotion_field_definitions,
  public.promotion_change_logs,
  public.event_campaigns,
  public.event_campaign_products,
  public.sync_logs
to anon, authenticated, service_role;

grant select on public.event_campaigns_visible to anon, authenticated, service_role;

alter table public.promotions enable row level security;
alter table public.promotion_field_definitions enable row level security;
alter table public.promotion_change_logs enable row level security;
alter table public.event_campaigns enable row level security;
alter table public.event_campaign_products enable row level security;
alter table public.sync_logs enable row level security;

-- promotions ---------------------------------------------------------------
-- ADMIN/STORE_MANAGER: 상시+행사 전체(비활성 포함, ADMIN만) 조회 가능
--   — "STORE_MANAGER는 프로모션 도메인에 한해 전체 매장/전체 상태를 본다"는
--   확정 사항(permissions.md §1)을 여기서도 그대로 적용한다.
-- STAFF: 상시는 항상, 행사는 캠페인이 "지금 노출 중"일 때만 (§21~§23)
create policy promotions_select
  on public.promotions for select
  using (
    public.is_active_user()
    and (
      public.is_admin()
      or (
        is_active
        and (
          promotion_type = 'permanent'
          or public.is_store_manager()
          or exists (
            select 1
            from public.event_campaign_products ecp
            join public.event_campaigns ec on ec.id = ecp.campaign_id
            where ecp.promotion_id = promotions.id
              and ec.is_visible
              and ec.start_at is not null
              and ec.end_at is not null
              and now() between ec.start_at and ec.end_at
          )
        )
      )
    )
  );

-- 쓰기: 아무 정책도 없다 = authenticated/anon는 절대 INSERT/UPDATE/DELETE 불가.
-- Sync는 오직 Service Role(RLS 우회)로만 수행한다 — "URL/API 직접 호출로 원본을
-- 수정할 수 없다"를 DB 레벨에서 강제한다 (CLAUDE.md 절대 원칙 3, 10).

-- promotion_field_definitions ------------------------------------------------
create policy promotion_field_definitions_select
  on public.promotion_field_definitions for select
  using (public.is_active_user());

create policy promotion_field_definitions_admin_write
  on public.promotion_field_definitions for all
  using (public.is_admin())
  with check (public.is_admin());

-- promotion_change_logs ------------------------------------------------------
-- "이 사람이 볼 수 있는 change log"는 "이 사람이 볼 수 있는 promotion의 change
-- log"와 정확히 같다. promotions_select 정책을 중복 구현하지 않고, promotions에
-- 대한 서브쿼리가 그 테이블의 RLS를 그대로 타는 것을 이용해 재사용한다.
create policy promotion_change_logs_select
  on public.promotion_change_logs for select
  using (
    exists (select 1 from public.promotions p where p.id = promotion_change_logs.promotion_id)
  );

-- event_campaigns -------------------------------------------------------------
create policy event_campaigns_select
  on public.event_campaigns for select
  using (
    public.is_active_user()
    and (
      public.is_admin()
      or public.is_store_manager()
      or (
        is_visible
        and start_at is not null
        and end_at is not null
        and now() between start_at and end_at
      )
    )
  );

-- event_campaign_products -----------------------------------------------------
create policy event_campaign_products_select
  on public.event_campaign_products for select
  using (
    exists (select 1 from public.event_campaigns ec where ec.id = event_campaign_products.campaign_id)
  );

-- sync_logs --------------------------------------------------------------------
-- 운영 내부 정보 — ADMIN만 조회 (product-requirements.md §69 System > Sync 상태).
create policy sync_logs_admin_select
  on public.sync_logs for select
  using (public.is_admin());
