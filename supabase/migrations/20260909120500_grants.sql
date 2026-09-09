-- 이 DEV 프로젝트는 public 스키마에 대한 기본 권한(anon/authenticated/service_role)이
-- 새로 만든 테이블에 자동으로 상속되지 않는 상태였다(마이그레이션 중 42501 permission
-- denied로 확인). RLS가 실제 행 단위 접근을 이미 통제하므로, 아래 GRANT는 "테이블에
-- 접근을 시도할 수 있는 권한"만 부여할 뿐 보안 경계를 넓히지 않는다 — anon/authenticated는
-- 여전히 각 테이블의 RLS 정책을 통과한 행만 볼 수 있고, service_role은 설계상 RLS를
-- 우회하는 서버 전용 역할이라 전체 권한이 필요하다.

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on routines to anon, authenticated, service_role;
