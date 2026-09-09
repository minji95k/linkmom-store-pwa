-- 공지사항 최소 스키마 (Phase 8에서 첨부파일 등과 함께 완성된다).
-- Phase 5에서 미리 만드는 이유: 실제 프로모션 테이블은 Phase 6에서 생기고,
-- 프로모션은 설계상 "매장 무관 전체 노출"이라 매장 격리 테스트 대상으로 적절하지
--않다(docs/permissions.md §3 참조 — STORE_MANAGER의 "전체 매장 조회"는 프로모션에
-- 한정된 예외다). 공지는 대상(전체/매장/Role/개인)이 명확히 구조화되어 있어
-- Phase 5가 요구하는 "매장별 접근 제어"를 실제 데이터로 검증하기에 적합하다.

create type public.notice_type as enum (
  '일반', '중요', '긴급', '필독', '행사', '발주', '판매가변경', '공급가변경', '운영', '시스템'
);

create type public.notice_target_type as enum ('all', 'store', 'role', 'user');

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  notice_type public.notice_type not null default '일반',
  author_id uuid references public.profiles (id),
  is_pinned boolean not null default false,
  requires_confirmation boolean not null default false,
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notice_targets (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.notices (id) on delete cascade,
  target_type public.notice_target_type not null,
  store_id uuid references public.stores (id) on delete cascade,
  role public.user_role,
  user_id uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint notice_targets_shape check (
    (target_type = 'all' and store_id is null and role is null and user_id is null)
    or (target_type = 'store' and store_id is not null and role is null and user_id is null)
    or (target_type = 'role' and store_id is null and role is not null and user_id is null)
    or (target_type = 'user' and store_id is null and role is null and user_id is not null)
  )
);

create table public.notice_reads (
  notice_id uuid not null references public.notices (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  confirmed_at timestamptz,
  primary key (notice_id, user_id)
);

create index notice_targets_notice_id_idx on public.notice_targets (notice_id);
create index notice_targets_store_id_idx on public.notice_targets (store_id) where store_id is not null;

-- 현재 로그인 사용자에게 이 공지가 노출 대상인지.
-- STORE_MANAGER는 STAFF와 동일하게 "자신이 속한 매장"만 본다 — 프로모션과 달리
-- 공지에는 STORE_MANAGER 전체매장 예외를 적용하지 않는다 (확정 사항, permissions.md §1).
create function public.notice_visible_to_current_user(target_notice_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
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

alter table public.notices enable row level security;
alter table public.notice_targets enable row level security;
alter table public.notice_reads enable row level security;

create policy notices_select_targeted_or_admin
  on public.notices for select
  using (public.is_admin() or public.notice_visible_to_current_user(id));

create policy notices_admin_write
  on public.notices for all
  using (public.is_admin())
  with check (public.is_admin());

create policy notice_targets_select_via_notice
  on public.notice_targets for select
  using (public.is_admin() or public.notice_visible_to_current_user(notice_id));

create policy notice_targets_admin_write
  on public.notice_targets for all
  using (public.is_admin())
  with check (public.is_admin());

create policy notice_reads_select_self_or_admin
  on public.notice_reads for select
  using (user_id = auth.uid() or public.is_admin());

create policy notice_reads_insert_self
  on public.notice_reads for insert
  with check (user_id = auth.uid() and public.notice_visible_to_current_user(notice_id));

create policy notice_reads_update_self
  on public.notice_reads for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
