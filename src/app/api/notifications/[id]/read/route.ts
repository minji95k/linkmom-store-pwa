import { NextResponse } from "next/server";

import { markNotificationRead } from "@/lib/notifications/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Notification Center 항목을 열람(딥링크 이동)할 때 클라이언트가 fire-and-forget으로
 * 호출한다(keepalive) — notices의 "상세를 실제로 열었을 때만 읽음 처리" 패턴과 동일한
 * 취지를 목록 클릭 시점에 적용한 것(Notification 자체엔 별도 상세 페이지가 없다).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await markNotificationRead(supabase, id, user.id);
  return NextResponse.json({ ok: true });
}
