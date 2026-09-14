-- Phase 6.5: 실제 Google Sheet 연동 전 보안 재검토 결과 반영.
-- 사용자가 명시적으로 요청한 4개 항목을 실제로 DEV DB에서 실험/검증한 뒤 고친다.

-- 1) event_campaigns_visible View가 RLS를 우회하는지 실제로 테스트한 결과,
--    이 Postgres에서 View는 기본적으로 View Owner(테이블 소유자, RLS를 우회하는
--    role) 권한으로 실행되어 하위 테이블의 RLS를 우회한다는 것을 확인했다
--    (진단용 필터 없는 View로 재현: STAFF가 비노출 캠페인까지 조회 가능했음).
--    지금까지는 이 View 자체의 WHERE절(is_visible=true AND 기간내)이 우연히
--    비노출 캠페인을 걸러내고 있었을 뿐 RLS 덕분이 아니었다 — View 정의가
--    바뀌거나 새 View가 추가되면 그 즉시 전체 노출 사고로 이어질 수 있었다.
--    security_invoker=on으로 "View를 호출한 사람의 권한/RLS"를 쓰도록 강제한다.
alter view public.event_campaigns_visible set (security_invoker = on);

-- 2) anon/authenticated GRANT 최소 권한화.
--    기존 migration(20260909130600)에서 "grant all"을 준 것은 RLS가 최종
--    방어선이라는 전제 하에 편의상 그렇게 했으나, 실제 Google Sheet 연동을
--    앞두고 최소 권한 원칙을 다시 적용한다 — anon/authenticated는 어떤 Promotion
--    테이블도 절대 쓰기(INSERT/UPDATE/DELETE)할 필요가 없다(Sync는 service_role
--    전용). 유일한 예외는 promotion_field_definitions에 대한 UPDATE인데, 이는
--    향후 ADMIN 전용 Field 설정 화면(Phase 12)이 is_admin() RLS로 보호된 채
--    authenticated 세션에서 UPDATE를 시도하기 때문이다.
revoke all on
  public.promotions,
  public.promotion_field_definitions,
  public.promotion_change_logs,
  public.event_campaigns,
  public.event_campaign_products,
  public.sync_logs
from anon, authenticated;

grant select on
  public.promotions,
  public.promotion_field_definitions,
  public.promotion_change_logs,
  public.event_campaigns,
  public.event_campaign_products,
  public.sync_logs
to anon, authenticated;

-- promotion_field_definitions만 authenticated에 UPDATE 추가 허용 (RLS의
-- promotion_field_definitions_admin_write 정책이 실제 ADMIN인지 다시 검증한다).
grant update on public.promotion_field_definitions to authenticated;

-- service_role은 Sync 엔진이 INSERT/UPDATE/DELETE를 모두 수행해야 하므로 그대로 유지.
grant all on
  public.promotions,
  public.promotion_field_definitions,
  public.promotion_change_logs,
  public.event_campaigns,
  public.event_campaign_products,
  public.sync_logs
to service_role;

-- 3) 비노출/종료/예정 행사 캠페인 조회를 ADMIN 전용으로 좁힌다.
--    기존 정책은 STORE_MANAGER도 "전체 매장 프로모션 조회" 확정 사항에 따라
--    비노출 캠페인까지 볼 수 있게 했었다. 실제 연동 전 재검토 결과, "매장과 무관하게
--    전체 매장의 프로모션을 본다"는 원래 취지는 매장별로 나뉜 데이터를 넘나드는
--    것이지 "아직 공개하지 않은/종료된 캠페인을 미리 보는 것"과는 다른 문제라고
--    판단해 이 부분만 ADMIN 전용으로 좁힌다. (참고: 현재 promotions는 매장별로
--    분리되어 있지 않아 이 조정이 STORE_MANAGER의 실질적 조회 범위를 STAFF와
--    동일하게 만든다 — docs/permissions.md 갱신 참조)
drop policy if exists event_campaigns_select on public.event_campaigns;
create policy event_campaigns_select
  on public.event_campaigns for select
  using (
    public.is_active_user()
    and (
      public.is_admin()
      or (
        is_visible
        and start_at is not null
        and end_at is not null
        and now() between start_at and end_at
      )
    )
  );

drop policy if exists promotions_select on public.promotions;
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

-- event_campaign_products_select, promotion_change_logs_select는 각각
-- event_campaigns/promotions에 대한 exists 서브쿼리로 재사용하는 구조라
-- (20260909130600 참조) 위 두 정책이 좁혀지면 자동으로 함께 좁혀진다 —
-- 별도 수정이 필요 없다.
