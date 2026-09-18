import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const dynamic = "force-dynamic";

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/**
 * §19 보안: STAFF가 Push "발송" API를 호출하는 경로는 애초에 존재하지 않는다(발송은
 * src/lib/push/*가 서버 코드에서만 import된다). 이 Route는 "구독 등록/해제"만 한다 —
 * 자기 Device Subscription만 다룰 수 있고, 여기서는 세션으로 로그인 여부를 먼저
 * 확인한 뒤 Service Role로 쓴다(공유 매장 태블릿에서 다른 계정이 로그인하면 같은
 * endpoint의 소유자가 새 사용자로 바뀌어야 하므로 — RLS의 "본인 소유 행만" 제약은
 * 이 재할당을 표현할 수 없어, notices/attachments와 동일한 "세션 인증 + Service Role
 * 쓰기" 패턴을 쓴다). push_subscriptions 자체의 RLS는 API를 우회한 직접 접근에 대한
 * 방어선으로 그대로 유지한다.
 */
export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = subscriptionSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청 형식" }, { status: 400 });
  }

  const userAgent = request.headers.get("user-agent");
  const service = createServiceRoleClient();

  const { error } = await service.from("push_subscriptions").upsert(
    {
      user_id: currentUser.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      user_agent: userAgent,
      is_active: true,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

const unsubscribeSchema = z.object({ endpoint: z.string().url() });

export async function DELETE(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = unsubscribeSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청 형식" }, { status: 400 });
  }

  const service = createServiceRoleClient();
  // 이 계정 소유의 endpoint만 지운다 — 다른 사용자의 구독을 실수로/악의적으로
  // 지우지 못하도록 user_id 조건을 명시한다(세션 인증만으로는 endpoint 소유 확인이
  // 안 되므로 여기서 다시 확인).
  const { error } = await service
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", parsed.data.endpoint)
    .eq("user_id", currentUser.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
