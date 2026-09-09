-- Phase 5: Authentication / Authorization
-- profiles: auth.users(id)와 1:1. Role은 ADMIN/STORE_MANAGER/STAFF 3종.
-- docs/database-schema.md §1, docs/permissions.md §1 참조.

create type public.user_role as enum ('ADMIN', 'STORE_MANAGER', 'STAFF');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  email text not null,
  role public.user_role not null default 'STAFF',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is '직원 프로필. auth.users와 1:1. Role/Store 권한의 기준.';

-- auth.users에 신규 사용자가 생성되면 profiles row를 자동 생성한다.
-- 보안 원칙: 신규 가입자는 무조건 STAFF로 시작한다. raw_user_meta_data에 role을
-- 실어 보내더라도 절대 신뢰하지 않는다 (Public Sign-up이 없어 이 경로로 악용될
-- 소지는 낮지만, "클라이언트가 보낸 값으로 권한이 정해지는 통로"를 원천적으로
-- 만들지 않기 위함 — CLAUDE.md 절대 원칙 10, docs/permissions.md §4).
-- 실제 Role 승급은 아래 20260909120300 migration의 ADMIN 전용 UPDATE 경로로만 가능하다.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', new.email),
    new.email,
    'STAFF'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- updated_at 자동 갱신 + "본인이 자기 role/is_active를 못 바꾸게" 막는 방어선.
-- RLS(다음 migration)가 1차 방어선, 이 trigger가 2차 방어선(Defense in Depth).
create function public.profiles_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid()가 NULL이면 Service Role(서버 전용 백엔드 작업 — Sync, 관리자 초대,
  -- Seed 스크립트 등)로 접속한 것이므로 이미 RLS를 우회할 권한이 있다. 그 경우까지
  -- 이 트리거로 막지 않는다. 실제 로그인 세션(auth.uid() 존재)인데 ADMIN이 아닌
  -- 경우만 role/is_active 변경을 차단한다.
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'STAFF/STORE_MANAGER는 자신의 role을 변경할 수 없습니다. ADMIN만 가능합니다.';
    end if;
    if new.is_active is distinct from old.is_active then
      raise exception 'STAFF/STORE_MANAGER는 계정 활성 상태를 변경할 수 없습니다. ADMIN만 가능합니다.';
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;
-- 주의: public.is_admin()은 다음 migration(auth_helper_functions)에서 정의된다.
-- plpgsql 함수 본문은 생성 시점에 참조 객체 존재를 검증하지 않고 호출 시점에만
-- 검증하므로(지연 이름 해석), is_admin()이 아직 없어도 아래 trigger 생성은 문제없다.
create trigger profiles_before_update
  before update on public.profiles
  for each row
  execute function public.profiles_before_update();
