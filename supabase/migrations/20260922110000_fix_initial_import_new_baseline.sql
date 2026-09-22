-- 20260922100000은 그 시점에 이미 오분류(is_initial_import=false)돼 있던 permanent
-- 198건의 is_initial_import/push_eligible/알림 상태와 last_important_change_at을 함께
-- 되돌렸다. 하지만 event처럼 is_initial_import 판정 자체는 처음부터 옳았던(=state 오염이
-- 없었던) 상품은 그 Migration의 대상이 아니었다 — 그런데도 `last_important_change_at`이
-- Initial Import 여부와 무관하게 무조건 채워지던 별개의 engine.ts 결함(같은 날 함께 고친
-- `computeNewPromotionFields()`, src/lib/sync/initial-import.ts) 때문에, event 최초
-- Import 38건이 Production에서 실제로 NEW(72h) 후보로 노출되는 것을 실측 확인했다.
--
-- 이 Migration은 promotion_type이나 특정 캠페인명/product_id/날짜를 하드코딩하지 않고,
-- `is_initial_import = true`인 모든 상품(현재/향후 permanent·event 어디든)에 대해
-- last_important_change_at을 다음 기준으로 재계산한다:
--
--   그 상품의 change_log 중 "생성 자체를 나타내는 change_type='new_product'"를 제외하고,
--   importance <> 'minor'(=실제 중요 변경, push 판정과 동일 축 — CLAUDE.md 절대 원칙 7)인
--   가장 최근 changed_at.
--
-- 그런 Row가 하나도 없으면(=Initial Import 이후 실제 중요 변경이 전혀 없었다) NULL로
-- 되돌린다. 반대로 Initial Import 이후 실제로 가격/사은품/행사기간 등이 바뀐 적이 있는
-- 상품이라면 그 실제 변경 시각이 그대로 보존된다 — 무조건 NULL 처리가 아니다(사용자 지시).
--
-- 이미 20260922100000으로 올바르게 NULL이 된 permanent 198건도 같은 로직을 다시 태우면
-- 결과가 그대로 NULL이라 안전하다(WHERE 절이 실제로 값이 달라지는 Row만 골라 갱신하므로
-- 재실행해도, 두 Migration이 겹쳐도 문제 없다). Fresh 환경은 애초에 is_initial_import=true
-- Row 자체가 아직 없으므로 이 UPDATE는 대상 0건으로 아무 일도 하지 않는다.

update public.promotions p
set last_important_change_at = (
  select max(pcl.changed_at)
  from public.promotion_change_logs pcl
  where pcl.promotion_id = p.id
    and pcl.change_type <> 'new_product'
    and pcl.importance <> 'minor'
)
where p.is_initial_import = true
  and p.last_important_change_at is distinct from (
    select max(pcl.changed_at)
    from public.promotion_change_logs pcl
    where pcl.promotion_id = p.id
      and pcl.change_type <> 'new_product'
      and pcl.importance <> 'minor'
  );
