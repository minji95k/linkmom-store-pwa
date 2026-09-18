import Link from "next/link";

import { NotificationListItem } from "@/components/notifications/notification-list-item";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { getNotificationsForStaff } from "@/lib/notifications/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Phase 11 §16: Notification Center — Push를 놓쳤거나 OS 알림을 차단한 경우를
 * 대비한 앱 내부 목록. 최소 기능(유형/제목/내용/발생시각/중요도/읽음여부/딥링크)만
 * 구현한다 — Bottom Nav에 새 탭을 추가하지 않고 MY 화면에서 링크로만 진입한다
 * (Phase 9에서 5탭→4탭으로 정리한 결정을 다시 뒤집지 않는다).
 */
export default async function NotificationsPage() {
  const currentUser = (await getCurrentUser())!;
  const supabase = await createClient();
  const notifications = await getNotificationsForStaff(supabase, currentUser.id);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6 pb-4">
      <Link href="/my" className="text-xs font-bold text-text-3">
        ← MY
      </Link>
      <h1 className="text-lg font-black">알림함</h1>

      {notifications.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-3">받은 알림이 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {notifications.map((notification) => (
            <NotificationListItem key={notification.id} notification={notification} />
          ))}
        </div>
      )}
    </main>
  );
}
