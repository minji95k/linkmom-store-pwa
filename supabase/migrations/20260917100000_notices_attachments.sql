-- Phase 8: Notice System 완성.
-- notices/notice_targets/notice_reads 테이블과 RLS(notice_visible_to_current_user
-- 포함)는 Phase 5에서 이미 구현·검증되어 있다 — 여기서는 그 위에 필요한 것만 더한다.

-- 외부링크(품절 재입고 안내 폼, 사은품 신청 폼 등) — product-requirements.md에
-- 기본 필드로 명시됐지만 Phase 5 스키마엔 없었다.
alter table public.notices add column external_link text;

-- 첨부파일 메타데이터. database-schema.md §4에 이미 설계돼 있던 범용 테이블을
-- 그대로 만든다(notice/training/profile 공용 — Phase 8은 notice만 실제로 쓴다).
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('notice', 'training', 'profile')),
  owner_id uuid not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index attachments_owner_idx on public.attachments (owner_type, owner_id);

comment on table public.attachments is
  'Storage 파일 메타데이터. 실제 파일은 private 버킷(notice-attachments 등)에 있고, 이 테이블은 어느 공지/자료에 속하는지만 기록한다. Signed URL은 서버에서만 발급한다(Phase 8 §13).';

alter table public.attachments enable row level security;

-- notices와 동일한 가시성 규칙을 재사용한다 — 별도 "첨부파일 권한" 로직을 새로 만들지 않는다.
create policy attachments_select_via_owner
  on public.attachments for select
  using (
    public.is_admin()
    or (owner_type = 'notice' and public.notice_visible_to_current_user(owner_id))
  );

create policy attachments_admin_write
  on public.attachments for all
  using (public.is_admin())
  with check (public.is_admin());

grant all on public.attachments to anon, authenticated, service_role;

-- 공지 첨부파일 저장용 Storage 버킷. public=false로 만들어 anon/authenticated에게
-- storage.objects RLS 정책을 단 하나도 주지 않는다 — 즉 Storage REST API로 파일 경로를
-- 직접 알아내 접근해도 이 앱의 Publishable Key로는 절대 열리지 않는다(CLAUDE.md
-- 절대 원칙 12와 같은 원리: 특권 접근은 서버 전용). 업로드/다운로드(Signed URL 발급)는
-- 전부 Service Role로만 수행하고, 그 전에 애플리케이션 코드가 "이 사용자가 이 공지를
-- 볼 수 있는가"를 notices RLS로 먼저 확인한다(§13).
insert into storage.buckets (id, name, public)
values ('notice-attachments', 'notice-attachments', false)
on conflict (id) do nothing;
