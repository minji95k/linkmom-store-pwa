-- RLS 활성화 + 정책. docs/permissions.md §3 그대로 구현한다.
-- 원칙: 모든 테이블 RLS 기본 ON. Frontend 숨김이 아니라 DB 레벨에서 강제.

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.user_store_access enable row level security;

-- profiles ---------------------------------------------------------------
-- SELECT: 본인 행 + ADMIN은 전체.
create policy profiles_select_self_or_admin
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

-- UPDATE: 본인 행(단, role/is_active 변경은 profiles_before_update 트리거가 차단) + ADMIN은 전체.
create policy profiles_update_self_or_admin
  on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- INSERT/DELETE: 클라이언트에서 직접 불가. 신규 계정은 auth.users 트리거로만 생성되고,
-- 계정 삭제는 Service Role(관리자 서버 Route)에서만 수행한다.

-- stores -------------------------------------------------------------------
-- SELECT: 로그인한 사용자 전체(매장명 자체는 민감정보가 아니며 검색/필터 UI에 필요).
create policy stores_select_authenticated
  on public.stores for select
  using (auth.uid() is not null and public.is_active_user());

-- 쓰기: ADMIN만.
create policy stores_admin_write
  on public.stores for all
  using (public.is_admin())
  with check (public.is_admin());

-- user_store_access ---------------------------------------------------------
-- SELECT: 본인 소속 행 + ADMIN 전체. (STAFF가 다른 직원의 소속 매장을 조회할 수 없다.)
create policy usa_select_self_or_admin
  on public.user_store_access for select
  using (user_id = auth.uid() or public.is_admin());

-- 쓰기: ADMIN만 (매장 배정은 관리자 전용 기능 — docs/product-requirements.md §4.9).
create policy usa_admin_write
  on public.user_store_access for all
  using (public.is_admin())
  with check (public.is_admin());
