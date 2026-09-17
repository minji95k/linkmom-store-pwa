import { redirect } from "next/navigation";

import { BottomNav } from "@/components/bottom-nav";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { getUnreadNoticeCount } from "@/lib/notices/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * 직원(Mobile First) 화면 전체를 감싸는 Route Group Layout.
 * 홈/프로모션/공지/MY가 전부 이 아래에 있고 Bottom Navigation을 공유한다
 * (교육자료는 Phase 9 SKIP — notice_type='교육' 공지로 통합, CLAUDE.md 참조).
 * proxy.ts는 "로그인했는지"만 본다 — role별 화면 분기가 없는 이 그룹은 로그인 여부만
 * 다시 검증한다(admin/layout.tsx가 /admin에서 하는 것과 같은 이중 방어 패턴).
 */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    redirect("/login");
  }

  const supabase = await createClient();
  const unreadNoticeCount = await getUnreadNoticeCount(supabase, currentUser.id);

  return (
    <div className="min-h-dvh pb-20">
      {children}
      <BottomNav initialUnreadNoticeCount={unreadNoticeCount} />
    </div>
  );
}
