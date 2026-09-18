import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { UserRole } from "@/types/database";

/**
 * 신규 직원 공통 초기 비밀번호(CLAUDE.md/Phase 12 확정 사항). 랜덤 생성하지 않는다 —
 * 모든 신규 계정 + 비밀번호 재설정이 동일한 값을 사용한다. Server-only 환경변수로만
 * 관리하며, 이 파일 밖(UI 문구, 로그, DB)에는 값을 노출하지 않는다.
 */
function getStaffInitialPassword(): string {
  const value = process.env.STAFF_INITIAL_PASSWORD;
  if (!value) {
    throw new Error("STAFF_INITIAL_PASSWORD 환경변수가 설정되어 있지 않습니다.");
  }
  return value;
}

export interface CreateStaffAccountInput {
  name: string;
  email: string;
  role: UserRole;
  storeId: string;
}

export interface AdminUserActionResult {
  error?: string;
  userId?: string;
}

/**
 * ADMIN이 신규 직원 계정을 생성한다(Phase 12 §5/§8/§9).
 *
 * 흐름: auth.users 생성 → handle_new_user() 트리거가 role='STAFF' profile을 자동
 * 생성 → Service Role로 name/role/Store를 지정한다(Service Role은 auth.uid()가
 * null이라 profiles_before_update 트리거의 "본인 role 변경 차단" 조건에 걸리지 않는다
 * — supabase/migrations/20260909120000_profiles_and_roles.sql 참조).
 *
 * 중간 단계가 실패하면 방금 이 함수가 만든 auth user만 정확히 삭제한다 — profiles/
 * user_store_access는 auth.users FK의 on delete cascade로 함께 정리되므로 별도
 * cleanup 코드가 필요 없다. 기존 직원 계정은 이 함수가 알고 있는 범위 밖이라
 * 절대 건드릴 수 없다.
 */
export async function createStaffAccount(input: CreateStaffAccountInput): Promise<AdminUserActionResult> {
  const service = createServiceRoleClient();

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email: input.email,
    password: getStaffInitialPassword(),
    email_confirm: true,
    user_metadata: { name: input.name },
  });

  if (createError || !created.user) {
    const message = createError?.message ?? "계정 생성에 실패했습니다.";
    const isDuplicate = /already been registered|already exists|email_exists/i.test(message);
    return { error: isDuplicate ? "이미 등록된 이메일입니다." : `계정 생성 실패: ${message}` };
  }

  const userId = created.user.id;

  try {
    const { error: profileError } = await service
      .from("profiles")
      .update({ name: input.name, role: input.role })
      .eq("id", userId);
    if (profileError) throw profileError;

    const { error: storeError } = await service
      .from("user_store_access")
      .insert({ user_id: userId, store_id: input.storeId });
    if (storeError) throw storeError;

    return { userId };
  } catch (err) {
    // 이번 요청으로 방금 생성한 user id만 삭제한다(cascade로 profiles/user_store_access도 함께 삭제됨).
    await service.auth.admin.deleteUser(userId).catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    return { error: `계정 생성 중 오류가 발생해 되돌렸습니다: ${message}` };
  }
}

/** ADMIN이 비밀번호를 잊은 기존 직원의 비밀번호를 공통 초기 비밀번호로 재설정한다(Phase 12 §17). */
export async function resetToInitialPassword(userId: string): Promise<AdminUserActionResult> {
  const service = createServiceRoleClient();
  const { error } = await service.auth.admin.updateUserById(userId, {
    password: getStaffInitialPassword(),
  });
  if (error) return { error: `재설정 실패: ${error.message}` };
  return { userId };
}
