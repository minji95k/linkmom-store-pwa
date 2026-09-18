import { NextResponse } from "next/server";

import { getUnreadNotificationCount } from "@/lib/notifications/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Notification Center 미확인 뱃지 조회용. /api/notices/unread-count와 동일 패턴. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const count = await getUnreadNotificationCount(supabase, user.id);
  return NextResponse.json({ count });
}
