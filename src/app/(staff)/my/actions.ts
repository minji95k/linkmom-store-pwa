"use server";

import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";

export interface ChangePasswordState {
  error: string | null;
  success: string | null;
}

/**
 * Phase 12 §19: 모든 로그인 사용자가 MY에서 본인 비밀번호를 변경한다.
 * 현재 비밀번호로 signInWithPassword 재인증 후에만 auth.updateUser로 변경한다 —
 * Service Role을 쓰지 않고 본인 세션 그대로 사용한다(§9).
 */
export async function changePasswordAction(
  _prevState: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const currentPassword = String(formData.get("current_password") ?? "");
  const newPassword = String(formData.get("new_password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { error: "모든 항목을 입력해주세요.", success: null };
  }
  if (newPassword !== confirmPassword) {
    return { error: "새 비밀번호가 일치하지 않습니다.", success: null };
  }
  if (newPassword.length < 8) {
    return { error: "새 비밀번호는 최소 8자 이상이어야 합니다.", success: null };
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { error: "로그인이 필요합니다.", success: null };
  }

  const supabase = await createClient();

  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: currentUser.email,
    password: currentPassword,
  });
  if (reauthError) {
    return { error: "현재 비밀번호가 올바르지 않습니다.", success: null };
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    return { error: `비밀번호 변경 실패: ${updateError.message}`, success: null };
  }

  return { error: null, success: "비밀번호가 변경되었습니다." };
}
