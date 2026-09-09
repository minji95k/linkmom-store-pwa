-- RLS 정책에서 재사용하는 Helper 함수.
-- SECURITY DEFINER로 만든 이유: 예를 들어 profiles 테이블의 RLS 정책 안에서
-- "내 role이 뭔지" 확인하려고 profiles를 다시 SELECT하면, 그 SELECT 자체가
-- 다시 RLS를 타면서 무한 재귀에 빠질 수 있다. SECURITY DEFINER 함수는
-- RLS를 우회해 안전하게 한 번만 조회하므로 이 문제를 피한다. 모두 읽기 전용이며
-- auth.uid() 기준으로만 동작해 오남용 표면이 없다.

create function public.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false);
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() = 'ADMIN' and public.is_active_user();
$$;

create function public.is_store_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() = 'STORE_MANAGER' and public.is_active_user();
$$;

-- 특정 매장(target_store_id)에 접근 가능한지. ADMIN은 항상 true.
create function public.has_store_access(target_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_active_user()
    and (
      public.is_admin()
      or exists (
        select 1
        from public.user_store_access usa
        where usa.user_id = auth.uid()
          and usa.store_id = target_store_id
      )
    );
$$;

comment on function public.has_store_access is
  'STAFF/STORE_MANAGER는 user_store_access에 등록된 매장만 true. ADMIN은 항상 true. 비활성 계정은 항상 false.';
