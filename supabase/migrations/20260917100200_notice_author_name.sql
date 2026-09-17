-- 공지 상세에 "작성자"를 보여줘야 하는데(Phase 8 §9), profiles RLS는 본인 행 +
-- ADMIN만 조회 가능하다(20260909120300_rls_core_tables.sql) — STAFF가 author_id로
-- profiles를 join하면 작성자(대개 ADMIN)의 이름을 못 읽는다. profiles RLS를
-- 넓히는 대신(다른 화면에 영향), 작성 시점의 이름을 그대로 스냅샷 저장한다 —
-- 작성자 계정이 나중에 이름이 바뀌거나 비활성화돼도 "그때 누가 썼는지"는
-- 그대로 남아야 한다는 점에서도 스냅샷이 더 정확하다.
alter table public.notices add column author_name text;

update public.notices n
set author_name = p.name
from public.profiles p
where p.id = n.author_id and n.author_name is null;
