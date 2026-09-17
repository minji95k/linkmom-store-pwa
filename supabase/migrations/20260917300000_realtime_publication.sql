-- Phase 10: Realtime을 켤 테이블만 최소로 고른다(§10 "무분별하게 구독하지 않는다").
-- 실제 사용자 가치가 있는 3개만 추가한다:
--   promotions      — 가격/사은품/판매조건/행사기간/신규상품 변경
--   event_campaigns — 행사 노출 ON/OFF, 기간 변경
--   notices         — 신규/중요/긴급/필독 공지 등록, 공지 수정
-- notice_reads/notice_targets/promotion_change_logs 등은 구독하지 않는다 — 클라이언트는
-- "무언가 바뀌었다"는 신호만 받고 실제 데이터는 항상 RLS가 적용된 서버 쿼리로 다시
-- 가져온다(§11 새로고침 배너 방식), Realtime payload 자체를 신뢰하지 않는다.
--
-- RLS와의 관계: Supabase Realtime의 postgres_changes는 테이블에 RLS가 켜져 있으면
-- 구독자의 JWT(anon/authenticated) 기준으로 SELECT 정책을 그대로 적용해 필터링한다
-- (Realtime Authorization). 세 테이블 모두 이미 RLS가 켜져 있으므로 추가 정책은
-- 필요 없다 — 다만 "정말 그런지"는 추측하지 않고 Phase 10 검증 단계에서 실제로
-- STAFF 세션으로 비활성/비노출 데이터 변경을 구독해 이벤트가 안 오는지 직접 확인한다.
alter publication supabase_realtime add table public.promotions;
alter publication supabase_realtime add table public.event_campaigns;
alter publication supabase_realtime add table public.notices;
