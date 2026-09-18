import { redirect } from "next/navigation";

import { BottomNav } from "@/components/bottom-nav";
import { AppBadgeSync } from "@/components/notifications/app-badge-sync";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { getUnreadNoticeCount } from "@/lib/notices/queries";
import { getUnreadCriticalNotificationCount } from "@/lib/notifications/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * 직원(Mobile First) 화면 전체를 감싸는 Route Group Layout.
 * 홈/프로모션/공지/MY가 전부 이 아래에 있고 Bottom Navigation을 공유한다
 * (교육자료는 Phase 9 SKIP — notice_type='교육' 공지로 통합, CLAUDE.md 참조).
 * proxy.ts는 "로그인했는지"만 본다 — role별 화면 분기가 없는 이 그룹은 로그인 여부만
 * 다시 검증한다(admin/layout.tsx가 /admin에서 하는 것과 같은 이중 방어 패턴).
 *
 * Phase 12: 계정이 비활성화된 채로 남은 기존 세션은 /auth/deactivated로 보내
 * 세션 자체를 끊는다 — RLS가 데이터를 막아주는 것과 별개로, 사용자 입장에서는
 * 로그인 화면으로 튕겨나가야 한다(§14).
 */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    redirect("/login");
  }
  if (!currentUser.profile.is_active) {
    redirect("/auth/deactivated");
  }

  const supabase = await createClient();
  const [unreadNoticeCount, unreadCriticalNotificationCount] = await Promise.all([
    getUnreadNoticeCount(supabase, currentUser.id),
    getUnreadCriticalNotificationCount(supabase, currentUser.id),
  ]);

  return (
    <div className="min-h-dvh pb-20">
      {children}
      <BottomNav initialUnreadNoticeCount={unreadNoticeCount} />
      <AppBadgeSync count={unreadCriticalNotificationCount} />
    </div>
  );
}
