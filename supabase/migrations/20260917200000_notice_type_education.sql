-- Phase 9 SKIP 결정(2026-09-17): 별도 Training Material System을 만들지 않고
-- 교육 목적 공지를 notice_type='교육'으로 구분해 Notice System에 흡수한다
-- (CLAUDE.md, product-requirements.md §4.6 참조). 이 파일은 값 추가만 하고
-- 같은 트랜잭션에서 사용하지 않는다 — ALTER TYPE ADD VALUE 이후 즉시 사용은
-- 별도 트랜잭션에서만 안전하다.
alter type public.notice_type add value if not exists '교육';
