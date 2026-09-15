-- sync_logs에 sync_mode/received_row_count를 기록해, 사후에 각 실행이 partial이었는지
-- full_snapshot이었는지 DB만으로 확인할 수 있게 한다.
--
-- 배경: 2026-09-15 Secret 교체 검증 중, 실행이 partial인지 full_snapshot인지 sync_logs만
-- 봐서는 구분할 수 없다는 것이 드러났다(카운트만으로는 "1건만 변경된 full_snapshot"과
-- "1건짜리 partial"을 구별 불가) — Apps Script 실행 로그를 따로 봐야만 확정할 수 있었다.
-- 이 컬럼들을 추가하면 sync_logs 조회만으로 사후 검증이 가능해진다.
--
-- 기존 Row는 sync_mode/received_row_count를 실제로 알 수 없으므로(당시 기록되지 않음)
-- NULL로 남긴다 — 추측으로 값을 채우지 않는다. 새로 실행되는 Sync부터 채워진다.

alter table public.sync_logs
  add column sync_mode text check (sync_mode in ('full_snapshot', 'partial')),
  add column received_row_count integer;

comment on column public.sync_logs.sync_mode is
  '이 실행이 partial인지 full_snapshot인지. 2026-09-15 이전 Row는 NULL(당시 미기록, 추측으로 채우지 않음).';
comment on column public.sync_logs.received_row_count is
  '이 실행에서 Apps Script가 보낸 rows 배열의 길이(payload에 실제로 담긴 Row 수). 2026-09-15 이전 Row는 NULL.';
