-- sync_logs에 skipped_count/skipped_detail을 추가해, received_row_count(Apps Script가
-- 보낸 행 수)와 실제 insert/update 처리 건수가 어긋날 때 관리자가 원인을 바로 알 수
-- 있게 한다.
--
-- 배경: 2026-09-16 syncAll Full Snapshot 검증 중 permanent received_row_count=191인데
-- active 건수는 190건뿐인 것이 발견됐다. 브랜드/제품명이 모두 빈 Row는 §18에 따라
-- 정상적으로 스킵되지만, 그동안 엔진이 이유를 전혀 기록하지 않고 조용히 continue만 해서
-- 사후에 "어느 Row가 왜 스킵됐는지" 전혀 알 수 없었다.

alter table public.sync_logs
  add column skipped_count integer,
  add column skipped_detail jsonb;

comment on column public.sync_logs.skipped_count is
  '브랜드/제품명이 모두 비어있어 정상적으로 스킵된 Row 수(실패가 아님, §18). 2026-09-16 이전 Row는 NULL(당시 미기록, 추측으로 채우지 않음).';
comment on column public.sync_logs.skipped_detail is
  '스킵된 각 Row의 rowNumber/사유 목록(errors와 동일한 {rowNumber, message} 배열 형태). 2026-09-16 이전 Row는 NULL.';
