"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/get-current-user";
import { confirmNotice } from "@/lib/notices/queries";
import { createClient } from "@/lib/supabase/server";

/** read와 별개 상태다(§8) — [확인 완료] 버튼에서만 호출된다. */
export async function confirmNoticeAction(noticeId: string): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) throw new Error("로그인이 필요합니다.");

  const supabase = await createClient();
  await confirmNotice(supabase, noticeId, currentUser.id);

  revalidatePath(`/notices/${noticeId}`);
  revalidatePath("/notices");
  revalidatePath("/");
}
