-- 매장 목록 + 사용자-매장 소속 관계 (N:M).
-- 확정 사항(CLAUDE.md): 현재 매장은 용인본점/동백점 2곳이며 향후 매장이 추가될 수
-- 있으므로 매장명·매장 개수를 어디에도 하드코딩하지 않는다. 이 테이블에 행을
-- 추가하는 것만으로 신규 매장이 반영되어야 한다.

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.stores is '매장 목록. 향후 매장 추가는 이 테이블에 INSERT만으로 처리한다.';

create table public.user_store_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, store_id)
);

comment on table public.user_store_access is
  '사용자-매장 소속(N:M). STAFF/STORE_MANAGER는 이 테이블에 등록된 매장 데이터만 접근 가능. ADMIN은 이 테이블과 무관하게 전체 매장 접근.';

create index user_store_access_store_id_idx on public.user_store_access (store_id);
