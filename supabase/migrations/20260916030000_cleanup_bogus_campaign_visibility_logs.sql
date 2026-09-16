-- 2026-09-16 event_campaigns 변경 감지 버그(문자열 비교로 인해 같은 시각의 다른 ISO
-- 표현을 "변경됨"으로 오판)로 쌓인 잘못된 campaign_visibility change_log를 정리하고,
-- 그 여파로 잘못 갱신된 promotions.last_important_change_at을 실제 남은(정상) 로그
-- 기준으로 다시 계산한다.
--
-- 식별 기준: before_value/after_value의 is_visible/start_at/end_at이 (텍스트 표현과
-- 무관하게) 전부 같은 값을 가리키는 campaign_visibility 로그만 "잘못 생성된 로그"로
-- 본다. timestamptz 캐스팅은 "+00:00"과 ".000Z"처럼 표현이 달라도 같은 시각이면 같다고
-- 판정하므로, 애플리케이션 코드(src/lib/sync/timestamps.ts의 timestampsEqual)와 정확히
-- 같은 판정 기준이다. 실제로 값이 달라진 로그(예: 종료일 09-15→09-23, ON→OFF)는 이
-- 조건에 걸리지 않으므로 그대로 보존된다 — is_visible/start_at/end_at 중 하나라도
-- is not distinct from(NULL-안전 비교)를 만족하지 않으면 삭제 대상에서 제외한다.
--
-- promotions 테이블 중 이 정리로 인해 값이 바뀌는 것은 last_important_change_at
-- 뿐이다 — 그 외 어떤 필드도, permanent 상품도 이 migration에서 건드리지 않는다.

-- 1) 정리 전에 "campaign_visibility 로그가 있었던 상품" 목록을 임시로 저장해둔다 —
--    로그를 전부 정리한 뒤에도(그 상품의 로그가 하나도 안 남더라도) last_important_
--    change_at을 다시 계산해야 하므로, 삭제 전 시점의 대상 목록이 필요하다.
create temporary table affected_event_promotions on commit drop as
select distinct promotion_id
from public.promotion_change_logs
where changed_field = 'campaign_visibility';

-- 2) 잘못 생성된 로그만 정확히 골라 삭제한다.
delete from public.promotion_change_logs
where changed_field = 'campaign_visibility'
  and (before_value ->> 'is_visible')::boolean is not distinct from (after_value ->> 'is_visible')::boolean
  and (before_value ->> 'start_at')::timestamptz is not distinct from (after_value ->> 'start_at')::timestamptz
  and (before_value ->> 'end_at')::timestamptz is not distinct from (after_value ->> 'end_at')::timestamptz;

-- 3) 영향받은 상품들의 last_important_change_at을, 정리 후 남은 change_logs 중
--    importance가 important/critical인 것의 최댓값으로 다시 맞춘다. 정상적인 change_log가
--    하나도 안 남은 상품(이론상으로만 가능 — new_product 로그는 항상 important라
--    실제로는 발생하지 않는다)은 NULL로 돌아간다.
update public.promotions p
set last_important_change_at = (
  select max(l.changed_at)
  from public.promotion_change_logs l
  where l.promotion_id = p.id
    and l.importance in ('important', 'critical')
)
where p.id in (select promotion_id from affected_event_promotions)
  and p.last_important_change_at is distinct from (
    select max(l.changed_at)
    from public.promotion_change_logs l
    where l.promotion_id = p.id
      and l.importance in ('important', 'critical')
  );
