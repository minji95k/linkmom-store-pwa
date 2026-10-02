-- 2026-10-02 Production 실측 버그 대응: ADMIN이 자신이 열람 가능한(role/store/user 등
-- 전체가 아닌 Targeting) Notice의 상세에 처음 들어가면 markNoticeRead()의 notice_reads
-- INSERT가 RLS(42501)로 막혀 상세 페이지 전체가 Server Error로 떨어졌다.
--
-- notices_select_targeted_or_admin / notice_targets_select_via_notice는 둘 다
-- `is_admin() or notice_visible_to_current_user(...)`로 ADMIN 예외가 있는데,
-- notice_reads_insert_self(20260909120400_notices.sql)에는 이 예외가 빠져 있었다 —
-- ADMIN의 current_role()이 'ADMIN'이라 role 타겟 조건(`nt.role = current_role()`)을
-- 만족하지 못해 notice_visible_to_current_user()가 ADMIN 본인에게도 false를 반환했다.
--
-- user_id = auth.uid() 조건은 그대로 유지한다 — ADMIN도 본인 소유 행만 쓸 수 있고,
-- 다른 사용자의 notice_reads를 대신 생성할 수 없다(이 수정이 그 조건을 건드리지 않는다).
drop policy if exists notice_reads_insert_self on public.notice_reads;

create policy notice_reads_insert_self
  on public.notice_reads for insert
  with check (
    user_id = auth.uid()
    and (public.is_admin() or public.notice_visible_to_current_user(notice_id))
  );
