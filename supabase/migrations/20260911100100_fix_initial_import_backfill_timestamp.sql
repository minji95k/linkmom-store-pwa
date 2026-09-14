-- 20260911100000의 백필 쿼리(min(finished_at) where inserted_count>0)가
-- 실제 Google Sheet E2E Sync가 아니라 Phase 6 검증 중 남아있던 sync_logs
-- 테스트 기록(2026-09-10 01:35, 이미 정리된 합성 테스트 데이터의 흔적)을
-- 잘못 집어냈다. 실제 첫 상시 프로모션 라이브 Sync(188건 Import,
-- sync_logs.id = 6d99b07e-2d91-454d-99df-9f5e93bf02ef, finished_at
-- 2026-09-10T05:52:47.217Z)의 정확한 시각으로 바로잡는다.

update public.promotion_sync_state
set initial_import_completed_at = '2026-09-10T05:52:47.217+00:00'
where promotion_type = 'permanent';
