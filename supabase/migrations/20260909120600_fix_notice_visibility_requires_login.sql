-- 버그 수정: notice_visible_to_current_user가 target_type='all' 조건을
-- auth.uid() 존재 여부와 무관하게 true로 평가해, 비로그인(anon) 사용자도
-- "전체" 대상 공지를 볼 수 있었다 (npm run test:rls로 실제 발견 — anon이
-- notices에서 1건을 조회함). 로그인 + 활성 계정이라는 전제를 먼저 검사하도록
-- 고친다. CLAUDE.md 절대 원칙 10(URL/API 직접 호출로 우회 불가)과
-- product-requirements.md의 "비로그인 사용자 접근 차단" 요구사항을 충족시킨다.

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
      from public.notice_targets nt
      where nt.notice_id = target_notice_id
        and (
          nt.target_type = 'all'
          or (nt.target_type = 'role' and nt.role = public.current_role())
          or (nt.target_type = 'user' and nt.user_id = auth.uid())
          or (nt.target_type = 'store' and public.has_store_access(nt.store_id))
        )
    );
$$;
