"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createStaffAccount, resetToInitialPassword } from "@/lib/admin/users";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/database";

export interface UserFormState {
  error: string | null;
  success?: string | null;
}

const ROLES: UserRole[] = ["ADMIN", "STORE_MANAGER", "STAFF"];

/**
 * 이 파일의 모든 Action은 admin/layout.tsx의 role 게이트를 다시 검증한다
 * (CLAUDE.md 서버 사이드 이중 방어, Phase 12 §15 — Admin Layout의 redirect만 믿지 않는다).
 * is_active까지 함께 확인해, 비활성화된 ADMIN이 기존 세션으로 직원 관리 Action을
 * 실행할 수 없게 한다(§15).
 */
async function requireAdmin() {
  const currentUser = await getCurrentUser();
  if (!currentUser || !currentUser.profile.is_active || currentUser.profile.role !== "ADMIN") {
    throw new Error("관리자만 사용할 수 있습니다.");
  }
  return currentUser;
}

export async function createUserAction(_prevState: UserFormState, formData: FormData): Promise<UserFormState> {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "STAFF") as UserRole;
  const storeId = String(formData.get("store_id") ?? "");

  if (!name || !email || !storeId) {
    return { error: "이름, 이메일, Store를 모두 입력해주세요." };
  }
  if (!ROLES.includes(role)) {
    return { error: "잘못된 Role입니다." };
  }

  const result = await createStaffAccount({ name, email, role, storeId });
  if (result.error) {
    return { error: result.error };
  }

  revalidatePath("/admin/users");
  redirect("/admin/users");
}

export async function updateUserAction(
  userId: string,
  _prevState: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const currentUser = await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "STAFF") as UserRole;
  const storeId = String(formData.get("store_id") ?? "");

  if (!name || !storeId) {
    return { error: "이름과 Store를 입력해주세요." };
  }
  if (!ROLES.includes(role)) {
    return { error: "잘못된 Role입니다." };
  }
  // 내일 배포를 앞두고 ADMIN이 실수로 자기 자신의 Role을 낮춰 관리 화면에서
  // 스스로를 잠그는 사고를 막는다(요구사항에 없는 추가 안전장치, DB/RLS 변경 없음).
  if (userId === currentUser.id && role !== "ADMIN") {
    return { error: "본인의 Role은 변경할 수 없습니다." };
  }

  // Phase 12 §9: 일반 Profile/Store 수정은 ADMIN 세션 + 기존 RLS를 그대로 사용한다.
  const supabase = await createClient();

  const { error: profileError } = await supabase.from("profiles").update({ name, role }).eq("id", userId);
  if (profileError) return { error: `수정 실패: ${profileError.message}` };

  // §10: DB는 N:M 구조를 유지하되, 이번 최소 UI는 "선택한 Store 1개로 교체"만 지원한다.
  const { error: deleteError } = await supabase.from("user_store_access").delete().eq("user_id", userId);
  if (deleteError) return { error: `Store 배정 실패: ${deleteError.message}` };

  const { error: insertError } = await supabase
    .from("user_store_access")
    .insert({ user_id: userId, store_id: storeId });
  if (insertError) return { error: `Store 배정 실패: ${insertError.message}` };

  revalidatePath("/admin/users");
  redirect("/admin/users");
}

export async function toggleActiveAction(
  userId: string,
  nextIsActive: boolean,
  _prevState: UserFormState,
  _formData: FormData,
): Promise<UserFormState> {
  const currentUser = await requireAdmin();

  if (userId === currentUser.id && !nextIsActive) {
    return { error: "본인 계정은 비활성화할 수 없습니다." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ is_active: nextIsActive }).eq("id", userId);
  if (error) return { error: `상태 변경 실패: ${error.message}` };

  revalidatePath("/admin/users");
  return { error: null, success: nextIsActive ? "활성화되었습니다." : "비활성화되었습니다." };
}

export async function resetPasswordAction(
  userId: string,
  _prevState: UserFormState,
  _formData: FormData,
): Promise<UserFormState> {
  await requireAdmin();

  const result = await resetToInitialPassword(userId);
  if (result.error) return { error: result.error };

  revalidatePath("/admin/users");
  return { error: null, success: "비밀번호가 초기 비밀번호로 재설정되었습니다." };
}
