-- Phase 8 §5: 게시 시작 전/종료 후 자동 비노출. Phase 5의 notice_visible_to_current_user는
-- Targeting(대상)만 확인하고 게시기간은 전혀 보지 않았다 — RLS가 최종 방어선이어야
-- 하므로(Phase 8 지시사항 §4) 여기서 게시기간 조건을 추가한다. ADMIN은 여전히
-- notices_select_targeted_or_admin 정책의 첫 번째 OR 분기(is_admin())로 전체를
-- 보므로 이 함수 변경의 영향을 받지 않는다 — event_campaigns_visible과 동일한 패턴.
create or replace function public.notice_visible_to_current_user(target_notice_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and public.is_active_user()
    and exists (
      select 1
      from public.notices n
      join public.notice_targets nt on nt.notice_id = n.id
      where n.id = target_notice_id
        and now() >= n.published_at
        and (n.expires_at is null or now() <= n.expires_at)
        and (
          nt.target_type = 'all'
          or (nt.target_type = 'role' and nt.role = public.current_role())
          or (nt.target_type = 'user' and nt.user_id = auth.uid())
          or (nt.target_type = 'store' and public.has_store_access(nt.store_id))
        )
    );
$$;
