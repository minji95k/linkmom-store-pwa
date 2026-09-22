-- 20260911100000/20260911100100이 남긴 결함을 고치는 Additive Corrective Migration이다.
-- 두 과거 Migration 파일은 원칙대로 수정하지 않는다 — Migration 이력은 모든 환경에서
-- 안정적으로 유지돼야 한다.
--
-- ## 근본 원인
-- 20260911100000의 백필 쿼리(`select 'permanent', min(finished_at) ... on conflict do
-- nothing`)는 SQL 집계 함수의 특성상 `sync_logs`에 일치하는 Row가 0건이어도 항상
-- 정확히 1행(값은 NULL)을 만들어낸다 — "신규 환경엔 Row가 없을 것"이라는 암묵적
-- 가정이 깨진다. 그 다음 20260911100100은 이 Row(신규 환경이면 NULL이었을 Row 포함)를
-- 조건 없이 DEV 실측값(2026-09-10T05:52:47.217+00:00)으로 덮어쓴다. 결과적으로 신규
-- Supabase 프로젝트(예: linkmom-store-prod)는 실제 최초 Sync를 하기도 전에 "상시
-- 프로모션 최초 Import가 이미 끝났다"는 상태를 물려받고, 진짜 최초 Import Sync가
-- `is_initial_import=false`/`push_eligible=true`로 오분류되어 불필요한 Push Notification
-- 생성까지 이어진다(2026-09-22 Production 검증에서 실제로 재현·확인됨).
--
-- ## 이 Migration이 하는 일
-- 1. 환경별로 `sync_logs`를 직접 재검사해 "실제로 있었던 상시 최초 Import Sync"를
--    다시 찾는다. MIN(finished_at)이 아니라 MAX(inserted_count)를 기준으로 삼는다 —
--    실측 결과 DEV에는 진짜 최초 Import(188건) 이전에 3건짜리 테스트 Sync 기록이 남아
--    있어 MIN(finished_at)이 그 노이즈를 잘못 집어낸다(20260911100100 자체가 바로 이
--    실수를 사람이 손으로 고친 이력이다). "최초 전체 카탈로그 Import"는 그 성격상
--    이후의 부분/테스트 Sync보다 압도적으로 많은 행을 삽입하므로 MAX(inserted_count)가
--    실제 데이터(DEV 188건, PROD 198건)와 정확히 일치한다.
-- 2. 그 결과가 NULL이면(=이 환경에서 상시 Sheet의 실제 성공 Sync가 아직 한 번도 없었다)
--    Row 자체를 지운다 — 그러면 `src/lib/sync/engine.ts`가 그대로 `isInitialImportRun
--    = true`로 판정하고, 실제 최초 Sync가 끝나면 `mark_initial_import_completed()`가
--    스스로(COALESCE로) 정확한 시각을 채운다. 이후 어떤 신규 환경에서도 이 Migration을
--    다시 고칠 필요가 없다.
-- 3. 그 결과가 기존 저장값과 다르면(=이 환경이 실제로 오염됐다는 뜻, PROD가 이 경우)
--    올바른 값으로 갱신하고, 그 시점까지 `is_initial_import=false`로 잘못 남아있는
--    상시 프로모션과 그 change_log를 정확히 되돌린다: `is_initial_import=true`,
--    `push_eligible=false`, `notification_id`는 NULL(있었다면), 그리고 그 change_log가
--    가리키던 Summary Notification(및 targets/deliveries)을 삭제한다.
-- 4. 같은 시점에 `last_important_change_at`도 NULL로 되돌린다 — engine.ts가 Initial
--    Import 여부와 무관하게 이 값을 무조건 채우던 별개의 결함(NEW 배지 72h 판정에
--    직접 쓰이는 값, `src/lib/promotions/queries.ts`) 때문에, 방금 수정된 상시
--    프로모션들이 실제로는 최초 Import일 뿐인데 며칠간 NEW로 노출될 뻔했다. 코드 쪽
--    재발 방지는 `src/lib/sync/engine.ts`의 `computeNewPromotionFields()` 적용으로
--    별도 처리한다 — 이 Migration은 이미 오염된 과거 데이터만 되돌린다.
-- 5. DEV는 이미 실제 값과 저장값이 일치하므로(직접 재현 확인) 이 Migration 전체가
--    아무것도 바꾸지 않는 No-op이다. 사람이 이미 한 번 수작업으로 맞혀둔 값을 다시
--    건드리지 않는다.

do $$
declare
  v_old_completed_at timestamptz;
  v_real_completed_at timestamptz;
  v_repair_needed boolean;
  v_affected_promotion_ids uuid[];
  v_affected_change_log_ids uuid[];
  v_affected_notification_ids uuid[];
begin
  select initial_import_completed_at into v_old_completed_at
  from public.promotion_sync_state
  where promotion_type = 'permanent';

  select finished_at into v_real_completed_at
  from public.sync_logs
  where source_sheet = 'permanent' and success = true
  order by inserted_count desc, finished_at asc
  limit 1;

  v_repair_needed := v_old_completed_at is distinct from v_real_completed_at;

  if v_real_completed_at is null then
    delete from public.promotion_sync_state where promotion_type = 'permanent';
  else
    insert into public.promotion_sync_state (promotion_type, initial_import_completed_at)
    values ('permanent', v_real_completed_at)
    on conflict (promotion_type) do update
      set initial_import_completed_at = excluded.initial_import_completed_at,
          updated_at = now();
  end if;

  if v_repair_needed and v_real_completed_at is not null then
    select array_agg(id) into v_affected_promotion_ids
    from public.promotions
    where promotion_type = 'permanent'
      and is_initial_import = false
      and created_at <= v_real_completed_at;

    if v_affected_promotion_ids is not null then
      select array_agg(id) into v_affected_change_log_ids
      from public.promotion_change_logs
      where promotion_id = any(v_affected_promotion_ids)
        and source_sheet = 'permanent'
        and change_type = 'new_product'
        and changed_at <= v_real_completed_at;

      select array_agg(distinct notification_id) into v_affected_notification_ids
      from public.promotion_change_logs
      where id = any(v_affected_change_log_ids) and notification_id is not null;

      update public.promotions
      set is_initial_import = true,
          last_important_change_at = null
      where id = any(v_affected_promotion_ids)
        and last_important_change_at <= v_real_completed_at;

      update public.promotion_change_logs
      set notification_id = null
      where id = any(v_affected_change_log_ids) and notification_id is not null;

      update public.promotion_change_logs
      set push_eligible = false
      where id = any(v_affected_change_log_ids) and push_eligible = true;

      if v_affected_notification_ids is not null then
        delete from public.notification_deliveries where notification_id = any(v_affected_notification_ids);
        delete from public.notification_targets where notification_id = any(v_affected_notification_ids);
        delete from public.notifications where id = any(v_affected_notification_ids);
      end if;
    end if;
  end if;
end $$;
