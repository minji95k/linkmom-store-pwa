-- sync_logs: Sheet별 마지막 정상 Sync 시각과 신규/수정/비활성/실패 건수를
-- Admin 화면에서 확인할 수 있게 한다 (sync-design.md §8).

create table public.sync_logs (
  id uuid primary key default gen_random_uuid(),
  source_sheet public.promotion_type not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  success boolean,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  deactivated_count integer not null default 0,
  failed_count integer not null default 0,
  error_detail jsonb,
  created_at timestamptz not null default now()
);

comment on table public.sync_logs is
  '개별 Row 검증 실패는 failed_count로 집계하고 나머지 Row는 계속 처리한다(§18) — success=false는 Sync 자체가 통째로 실패한 경우에만 쓴다.';

create index sync_logs_source_sheet_started_idx
  on public.sync_logs (source_sheet, started_at desc);
