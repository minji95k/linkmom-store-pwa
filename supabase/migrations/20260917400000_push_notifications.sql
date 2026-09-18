-- Phase 11: Web Push(VAPID) + 앱 내부 Notification Center.
-- 설계 원문: docs/push-design.md, docs/database-schema.md §5. 여기서는 그 설계를 그대로
-- 스키마화한다. Phase 6 Sync Engine 로직(src/lib/sync/engine.ts)은 건드리지 않고,
-- promotion_change_logs에 "이미 알림으로 처리됐는지"만 추적하는 컬럼 1개만 추가한다.

-- ---------------------------------------------------------------------------
-- 0) push_go_live_at: Push 기능이 실제로 켜진 시각(push-design.md §3.2 안전장치).
--    이 마이그레이션이 적용되는 그 순간이 곧 "Push 인프라가 존재하기 시작한 시각"이므로
--    now()를 그대로 컷오버 시각으로 쓴다 — Phase 7~10 개발 중 쌓인 이력이나 Initial
--    Import 이력이 Push 활성화 순간 한꺼번에 발송되는 사고를 원천 차단한다. 싱글턴
--    테이블로 만들어 Phase 12 Admin UI가 필요 시(예: 사고 후 재정비) 갱신할 수 있게 한다.
create table public.notification_settings (
  id smallint primary key default 1,
  push_go_live_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_settings_singleton check (id = 1)
);
insert into public.notification_settings (id) values (1);

alter table public.notification_settings enable row level security;

create policy notification_settings_select_admin
  on public.notification_settings for select
  using (public.is_admin());

create policy notification_settings_update_admin
  on public.notification_settings for update
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.notification_settings to anon, authenticated;
grant update on public.notification_settings to authenticated;
grant all on public.notification_settings to service_role;

-- ---------------------------------------------------------------------------
-- 1) push_subscriptions: User 1 : Device N (push-design.md §2, product-requirements.md §59).
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);
create index push_subscriptions_active_idx on public.push_subscriptions (user_id, is_active) where is_active;

alter table public.push_subscriptions enable row level security;

-- 본인 소유 행만 SELECT/INSERT/UPDATE/DELETE 가능 (permissions.md §"push_subscriptions").
create policy push_subscriptions_select_self_or_admin
  on public.push_subscriptions for select
  using (user_id = auth.uid() or public.is_admin());

create policy push_subscriptions_insert_self
  on public.push_subscriptions for insert
  with check (user_id = auth.uid());

create policy push_subscriptions_update_self
  on public.push_subscriptions for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy push_subscriptions_delete_self
  on public.push_subscriptions for delete
  using (user_id = auth.uid());

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.push_subscriptions to anon;
grant all on public.push_subscriptions to service_role;

-- ---------------------------------------------------------------------------
-- 2) notifications / notification_targets / notification_reads / notification_deliveries.
--    notice_target_type(all/store/role/user)을 그대로 재사용한다 — notice_targets와
--    셰이프가 완전히 동일한 개념이라 별도 enum을 만들지 않는다.
create type public.notification_type as enum ('notice', 'promotion_change', 'summary');

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  type public.notification_type not null,
  title text not null,
  body text not null,
  importance public.change_importance not null default 'important',
  deep_link text not null,
  created_at timestamptz not null default now()
);

create table public.notification_targets (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  target_type public.notice_target_type not null,
  store_id uuid references public.stores (id) on delete cascade,
  role public.user_role,
  user_id uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint notification_targets_shape check (
    (target_type = 'all' and store_id is null and role is null and user_id is null)
    or (target_type = 'store' and store_id is not null and role is null and user_id is null)
    or (target_type = 'role' and store_id is null and role is not null and user_id is null)
    or (target_type = 'user' and store_id is null and role is null and user_id is not null)
  )
);

create index notification_targets_notification_id_idx on public.notification_targets (notification_id);

-- notice_visible_to_current_user와 완전히 동일한 패턴(대상 판정만, 게시기간 개념 없음 —
-- notifications는 생성 즉시 유효하고 별도 게시예약/만료가 없다).
create function public.notification_visible_to_current_user(target_notification_id uuid)
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
      from public.notification_targets nt
      where nt.notification_id = target_notification_id
        and (
          nt.target_type = 'all'
          or (nt.target_type = 'role' and nt.role = public.current_role())
          or (nt.target_type = 'user' and nt.user_id = auth.uid())
          or (nt.target_type = 'store' and public.has_store_access(nt.store_id))
        )
    );
$$;

alter table public.notifications enable row level security;
alter table public.notification_targets enable row level security;

create policy notifications_select_targeted_or_admin
  on public.notifications for select
  using (public.is_admin() or public.notification_visible_to_current_user(id));

create policy notification_targets_select_via_notification
  on public.notification_targets for select
  using (public.is_admin() or public.notification_visible_to_current_user(notification_id));

-- INSERT/UPDATE/DELETE 정책 없음 — 발송(생성)은 항상 service_role 전용(§19: STAFF가
-- Push 발송 API를 직접 호출할 수 없어야 한다. 애초에 authenticated에게 쓰기 정책 자체가
-- 없으므로 API를 우회해도 DB 레벨에서 막힌다).

grant select on public.notifications to anon, authenticated;
grant select on public.notification_targets to anon, authenticated;
grant all on public.notifications to service_role;
grant all on public.notification_targets to service_role;

-- Notification Center 읽음 상태 — notice_reads와 동일 패턴(사용자별 독립 상태).
create table public.notification_reads (
  notification_id uuid not null references public.notifications (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

alter table public.notification_reads enable row level security;

create policy notification_reads_select_self_or_admin
  on public.notification_reads for select
  using (user_id = auth.uid() or public.is_admin());

create policy notification_reads_insert_self
  on public.notification_reads for insert
  with check (user_id = auth.uid() and public.notification_visible_to_current_user(notification_id));

grant select, insert on public.notification_reads to authenticated;
grant select on public.notification_reads to anon;
grant all on public.notification_reads to service_role;

-- Delivery 로그(push-design.md §13) — 상태: requested → sent | failed | expired.
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'sent', 'failed', 'expired')),
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index notification_deliveries_notification_id_idx on public.notification_deliveries (notification_id);
create index notification_deliveries_subscription_id_idx on public.notification_deliveries (subscription_id);

alter table public.notification_deliveries enable row level security;

-- 본인에게 발송된 것만 SELECT(자신 소유 subscription 기준), ADMIN은 전체(permissions.md).
create policy notification_deliveries_select_self_or_admin
  on public.notification_deliveries for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.push_subscriptions ps
      where ps.id = subscription_id and ps.user_id = auth.uid()
    )
  );

grant select on public.notification_deliveries to anon, authenticated;
grant all on public.notification_deliveries to service_role;

-- ---------------------------------------------------------------------------
-- 3) promotion_change_logs에 "이미 알림/Push로 처리됐는지"만 추적하는 컬럼 1개 추가.
--    Sync 엔진(engine.ts)의 기존 INSERT 로직은 전혀 건드리지 않는다 — 기본값 NULL로
--    시작해 Push 처리기가 처리한 로그에만 사후에 채운다. 하나의 notification이 여러
--    change_log을 요약(summary)으로 묶을 수 있으므로 N:1(여러 로그 → notification 1개).
alter table public.promotion_change_logs
  add column notification_id uuid references public.notifications (id);

create index promotion_change_logs_push_pending_idx
  on public.promotion_change_logs (changed_at)
  where notification_id is null and push_eligible and importance <> 'minor';

comment on column public.promotion_change_logs.notification_id is
  'Phase 11: 이 변경이 이미 어떤 notification(개별 또는 summary)으로 처리됐는지. NULL이면 아직 미처리(발송 대기).';
