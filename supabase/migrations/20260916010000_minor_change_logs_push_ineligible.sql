-- importance='minor'인 promotion_change_logs는 항상 push_eligible=false여야 한다.
--
-- 배경: 2026-09-16 실 DEV Sheet A~E 혼합 테스트 검증 중, minor_edit(예: is_active
-- soft-delete 로그, 비고 등 minor 문구 변경 로그)가 push_eligible의 컬럼 기본값(true)을
-- 그대로 물려받아 "중요하지 않은 변경인데 Push 대상"이라는 의미상 모순 상태로 저장되고
-- 있던 것이 드러났다. 지금은 push-design.md §3.2에 정의된 Phase 11의 이중 필터
-- (`importance != 'minor' AND push_eligible = true`)가 실제 발송을 걸러주지만,
-- 그 필터링에만 의존하지 않고 **DB 자체가 애초에 일관된 의미를 갖도록** 고친다.
--
-- push_eligible은 importance의 단순 함수가 아니다(예: new_product 로그는
-- importance='important'이면서도 Initial Import 상품이면 push_eligible=false다 —
-- push-design.md §3.1) — 그래서 "importance='minor' → push_eligible=false"라는
-- 한쪽 방향의 함의만 강제한다(그 반대는 강제하지 않음).

-- 1) 기존 DEV 데이터 백필 — promotion_change_logs(감사 로그)만 수정한다.
--    promotions(실제 프로모션 데이터) 테이블은 이 migration에서 전혀 건드리지 않는다.
update public.promotion_change_logs
set push_eligible = false
where importance = 'minor'
  and push_eligible = true;

-- 2) 앞으로 이 불변조건이 깨지는 INSERT/UPDATE 자체를 DB가 거부하도록 CHECK 제약을 추가한다.
--    (애플리케이션 코드가 실수로 push_eligible을 빼먹거나 잘못 넣어도 DB가 막아준다.)
alter table public.promotion_change_logs
  add constraint promotion_change_logs_minor_not_push_eligible
  check (importance <> 'minor' or push_eligible = false);

comment on constraint promotion_change_logs_minor_not_push_eligible on public.promotion_change_logs is
  'importance=minor인 변경은 항상 push_eligible=false여야 한다 — Push 단계 필터링과 무관하게 DB 자체가 일관된 의미를 갖도록 하는 안전장치(2026-09-16).';
