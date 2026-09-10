import { NextResponse } from "next/server";

import { verifySyncSecret } from "@/lib/sync/authenticate";
import { runPromotionSync } from "@/lib/sync/engine";
import { syncRequestSchema } from "@/lib/sync/validate-request";

export const runtime = "nodejs";

/**
 * Google Apps Script([행사 프로모션])가 호출하는 Sync 엔드포인트.
 * 상시와 별개 엔드포인트로 분리해 두 Sheet를 절대 하나로 합치지 않는다(§9).
 */
export async function POST(request: Request) {
  const authError = verifySyncSecret(request);
  if (authError) return authError;

  const json = await request.json().catch(() => null);
  const parsed = syncRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청 형식", detail: parsed.error.flatten() }, { status: 400 });
  }

  const result = await runPromotionSync("event", parsed.data);
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
