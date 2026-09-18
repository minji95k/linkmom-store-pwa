import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Phase 12 §14: 비활성화된 계정의 "기존 로그인 세션"을 끊는 전용 경로.
 *
 * (staff)/layout.tsx와 admin/layout.tsx는 Server Component 렌더링 중이라 쿠키를
 * 직접 지울 수 없다(Next.js 제약) — 그래서 is_active=false를 감지하면 이 Route
 * Handler로 redirect만 하고, 실제 signOut(쿠키 삭제)은 여기(Route Handler, 쿠키
 * mutation이 허용되는 위치)에서 수행한 뒤 로그인 화면으로 보낸다.
 * proxy.ts는 "/auth"로 시작하는 경로를 이미 PUBLIC_PATHS로 통과시키므로
 * (src/lib/supabase/proxy.ts) 별도 수정이 필요 없다.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(new URL("/login?inactive=1", request.url));
}
