import { after, NextResponse } from "next/server";

import { processPendingPromotionPush } from "@/lib/push/process-promotion-changes";
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
  // 안전장치가 대량 비활성화를 막아 Sync를 실패시킨 경우는 409(Conflict)로,
  // 그 외 실패는 500으로 구분한다 — Apps Script/관리자가 원인을 바로 구분할 수 있다.
  const status = result.success ? 200 : result.deactivationGuard.blocked ? 409 : 500;

  // Phase 11: permanent와 동일 — Sync 1회의 change_log 집합을 Push Batching Window로 쓴다.
  if (result.success) {
    after(() =>
      processPendingPromotionPush().catch((error) => {
        console.error("processPendingPromotionPush 실패(event):", error);
      }),
    );
  }

  return NextResponse.json(result, { status });
}
