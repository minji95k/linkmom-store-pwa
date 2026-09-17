import { NextResponse } from "next/server";

import { getUnreadNoticeCount } from "@/lib/notices/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Bottom Nav 공지 미확인 뱃지의 Realtime 갱신용. 세션 쿠키 기반 Client(Publishable
 * Key)로만 조회해 RLS가 그대로 적용된다 — Realtime 이벤트는 "다시 조회해볼 시점"
 * 신호로만 쓰고, 실제 대상 판정(매장/Role)은 이 API가 RLS로 매번 다시 계산한다
 * (Service Role을 쓰지 않는다 — CLAUDE.md 절대 원칙 10/12).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const count = await getUnreadNoticeCount(supabase, user.id);
  return NextResponse.json({ count });
}
