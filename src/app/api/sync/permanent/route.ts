import { NextResponse } from "next/server";

import { verifySyncSecret } from "@/lib/sync/authenticate";
import { runPromotionSync } from "@/lib/sync/engine";
import { syncRequestSchema } from "@/lib/sync/validate-request";

export const runtime = "nodejs";

/**
 * Google Apps Script([상시 프로모션])가 호출하는 Sync 엔드포인트.
 * docs/sync-design.md §3 아키텍처의 "Next.js API Route" 지점.
 */
export async function POST(request: Request) {
  const authError = verifySyncSecret(request);
  if (authError) return authError;

  const json = await request.json().catch(() => null);
  const parsed = syncRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청 형식", detail: parsed.error.flatten() }, { status: 400 });
  }

  const result = await runPromotionSync("permanent", parsed.data);
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
