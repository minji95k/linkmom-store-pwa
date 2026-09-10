import "server-only";

import { NextResponse } from "next/server";

/**
 * Google Apps Script → 이 API를 호출할 때 쓰는 인증.
 * Apps Script는 Supabase Secret Key를 절대 갖지 않는다(sync-design.md §3) —
 * 대신 이 SYNC_API_SECRET 하나만 Script Properties에 저장해 Bearer 토큰으로 보낸다.
 */
export function verifySyncSecret(request: Request): NextResponse | null {
  const expected = process.env.SYNC_API_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "SYNC_API_SECRET이 서버에 설정되지 않았습니다." }, { status: 500 });
  }

  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;

  if (!token || token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
