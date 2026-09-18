import { after, NextResponse } from "next/server";

import { processPendingPromotionPush } from "@/lib/push/process-promotion-changes";
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
  // 안전장치가 대량 비활성화를 막아 Sync를 실패시킨 경우는 409(Conflict)로,
  // 그 외 실패는 500으로 구분한다 — Apps Script/관리자가 원인을 바로 구분할 수 있다.
  const status = result.success ? 200 : result.deactivationGuard.blocked ? 409 : 500;

  // Phase 11: Sync가 만든 change_log 집합을 그대로 Push Batching Window로 쓴다
  // (push-design.md §5, CLAUDE.md Phase 11 절). engine.ts는 전혀 건드리지 않고
  // 응답 전송 후 best-effort로만 실행(Vercel 같은 서버리스 환경에서 응답 후 함수가
  // 바로 종료돼도 이 콜백은 끝까지 실행되도록 next/server의 after()를 쓴다) — 실패해도
  // Sync 성공 여부/응답에는 전혀 영향 없음.
  if (result.success) {
    after(() =>
      processPendingPromotionPush().catch((error) => {
        console.error("processPendingPromotionPush 실패(permanent):", error);
      }),
    );
  }

  return NextResponse.json(result, { status });
}
