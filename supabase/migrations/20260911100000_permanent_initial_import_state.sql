-- is_initial_import 판정을 "지금 이 순간 Row가 0건인가"라는 휘발성 조건에서
-- Sheet 타입별 영구 상태값으로 교체한다. 기존 방식(existingByProductId.size===0)은
-- 일반적인 Soft Delete로는 0이 되지 않지만, promotions를 실제로 Hard Delete하는
-- 작업(예: scripts/clean-promotions.ts, 향후 관리자 도구)이 발생하면 그 다음
-- Sync가 다시 "최초 Import"로 오인되어 실제 신규 상품까지 push_eligible=false로
-- 잘못 기록될 수 있다 — 사용자 재검토로 발견.
--
-- 한 번 완료로 기록되면(초기값 NULL -> timestamp) 이후 절대 되돌아가지 않는다.
-- promotions가 전부 삭제되어도 이 테이블의 값은 그대로 남는다.

create table public.promotion_sync_state (
  promotion_type public.promotion_type primary key,
  initial_import_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.promotion_sync_state is
  'Sheet 타입(permanent/event)별 "최초 Import가 이미 끝났는지"를 나타내는 영구 상태. promotions 테이블의 실제 Row 존재 여부와 무관하게 유지된다 — is_initial_import 오판정 방지(push-design.md §3.1).';

create trigger promotion_sync_state_set_updated_at
  before update on public.promotion_sync_state
  for each row
  execute function public.set_updated_at();

-- 최초 완료 시각은 COALESCE로 보호한다: 이미 값이 있으면(=이미 완료됨) 절대
-- 덮어쓰지 않고, 없을 때만(NULL -> now()) 채운다. 동시에 여러 Sync 요청이
-- 들어와도, 반복 호출해도 안전(idempotent)하다.
create function public.mark_initial_import_completed(p_promotion_type public.promotion_type)
returns void
language sql
as $$
  insert into public.promotion_sync_state (promotion_type, initial_import_completed_at)
  values (p_promotion_type, now())
  on conflict (promotion_type) do update
    set initial_import_completed_at = coalesce(
          public.promotion_sync_state.initial_import_completed_at,
          excluded.initial_import_completed_at
        ),
        updated_at = now();
$$;

grant select on public.promotion_sync_state to anon, authenticated;
grant all on public.promotion_sync_state to service_role;
grant execute on function public.mark_initial_import_completed(public.promotion_type) to service_role;

alter table public.promotion_sync_state enable row level security;

create policy promotion_sync_state_admin_select
  on public.promotion_sync_state for select
  using (public.is_admin());

-- 백필: [상시 프로모션] 최초 Import는 이미 실제로 완료됐다(2026-09-10, 188건).
-- sync_logs의 실제 최초 성공 Sync 시각을 그대로 기록해 감사 이력을 정확히 남긴다.
-- [행사 프로모션]은 아직 실제 최초 Sync를 하지 않았으므로 행을 만들지 않는다 —
-- 다음 syncEventOnly 실행이 정확히 "최초 Import"로 판정되어야 한다.
insert into public.promotion_sync_state (promotion_type, initial_import_completed_at)
select 'permanent', min(finished_at)
from public.sync_logs
where source_sheet = 'permanent' and success = true and inserted_count > 0
on conflict (promotion_type) do nothing;
