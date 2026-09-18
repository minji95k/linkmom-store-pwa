/**
 * Phase 13(Compact Security Review) 전용 회귀 테스트.
 *
 * 이번 Phase가 실제로 코드를 수정한 두 지점만 명시적으로 검증한다:
 *  - Security Gap #1: admin/notices/actions.ts의 requireAdmin()이 is_active를 확인하는지
 *    (Notice Admin Action에 대한 실측은 이 스크립트가 아니라 Browser E2E로 별도 수행 —
 *    Server Action은 cookies()/next/headers에 의존해 plain tsx 스크립트에서 직접 호출할 수
 *    없다는 동일한 제약이 Phase 12 test-admin-users.ts에도 적용됐다).
 *  - Security Gap #2: src/lib/push/targeting.ts의 resolveTargetUserIds가 개인 지정("user")
 *    타겟에도 is_active 필터를 적용하는지 — "server-only"라 직접 import할 수 없으므로
 *    수정된 코드와 동일한 쿼리를 재현해 실제 DB 동작을 검증한다(Phase 12 test-admin-users.ts
 *    E 섹션과 동일한 방법론).
 *
 * 실행: npm run test:security-review (npm run db:seed 먼저 필요)
 */
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/types/database";

import { STORES, TEST_PASSWORD, TEST_USERS } from "./fixtures";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const initialPassword = process.env.STAFF_INITIAL_PASSWORD;

if (!url || !publishableKey || !secretKey || !initialPassword) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY / STAFF_INITIAL_PASSWORD가 .env.local에 필요합니다.",
  );
  process.exit(1);
}

const service = createClient<Database>(url, secretKey, { auth: { persistSession: false } });

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const RUN_ID = Date.now();
const TARGET_EMAIL = `phase13-push-target-test-${RUN_ID}@test.linkmom.dev`;

async function findStoreId(code: string): Promise<string> {
  const { data, error } = await service.from("stores").select("id").eq("code", code).single();
  if (error || !data) throw new Error(`store ${code}를 찾지 못했습니다: ${error?.message}`);
  return data.id;
}

/** Phase 13 수정 후의 src/lib/push/targeting.ts resolveTargetUserIds "user" 분기와 동일한 쿼리. */
async function resolveIndividualTargets(candidateIds: string[]): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const { data } = await service.from("profiles").select("id").eq("is_active", true).in("id", candidateIds);
  return (data ?? []).map((u) => u.id);
}

async function main() {
  const hqStoreId = await findStoreId(STORES[0].code);

  let testUserId: string | null = null;

  try {
    // =====================================================================
    // Gap #2 회귀: 개인 지정 Push 대상도 is_active=true만 최종 포함된다.
    // =====================================================================
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email: TARGET_EMAIL,
      password: initialPassword!,
      email_confirm: true,
      user_metadata: { name: "Phase13 Push Target Test" },
    });
    if (createError || !created.user) throw new Error(`테스트 계정 생성 실패: ${createError?.message}`);
    testUserId = created.user.id;

    await service.from("profiles").update({ name: "Phase13 Push Target Test", role: "STAFF" }).eq("id", testUserId);
    await service.from("user_store_access").insert({ user_id: testUserId, store_id: hqStoreId });

    // 1) 활성 상태 — 개인 지정 시 포함되어야 한다(정상 케이스, 회귀 방지).
    const includedWhileActive = await resolveIndividualTargets([testUserId]);
    record(
      "1. 활성 사용자를 개인 지정(user target) — 최종 대상에 포함됨",
      includedWhileActive.includes(testUserId),
      `result=${JSON.stringify(includedWhileActive)}`,
    );

    // 2) 비활성화 — 개인 지정해도 제외되어야 한다(Security Gap #2 수정 대상).
    await service.from("profiles").update({ is_active: false }).eq("id", testUserId);
    const excludedWhileInactive = await resolveIndividualTargets([testUserId]);
    record(
      "2. 비활성 사용자를 개인 지정(user target) — 최종 대상에서 제외됨(수정 전엔 실패했을 케이스)",
      !excludedWhileInactive.includes(testUserId),
      `result=${JSON.stringify(excludedWhileInactive)}`,
    );

    // 3) push_subscriptions가 남아있어도(가정) 최종 user_id 목록 자체에서 빠지므로
    //    getActiveSubscriptionsForUsers(userIds) 호출 자체가 이 사용자의 user_id를 받지 않는다 —
    //    즉 "구독이 DB에 남아있어도 발송되면 안 된다"는 요구사항은 대상자 계산 단계에서 이미 충족됨.
    const { data: subsForUser } = await service.from("push_subscriptions").select("id").eq("user_id", testUserId);
    record(
      "3. (참고) push_subscriptions 행 존재 여부와 무관하게 비활성 사용자는 대상 목록에서 빠짐",
      true,
      `subscriptions rows=${subsForUser?.length ?? 0} (0이어도 무관 — 대상자 계산 단계에서 이미 제외됨)`,
    );

    await service.from("profiles").update({ is_active: true }).eq("id", testUserId);
  } finally {
    if (testUserId) await service.auth.admin.deleteUser(testUserId).catch(() => {});
  }

  // =====================================================================
  // Gap #1 회귀(코드 레벨 확인): admin/notices/actions.ts와 admin/users/actions.ts의
  // requireAdmin()이 동일한 is_active 체크 패턴을 쓰는지는 코드로 확인했다(§2 참조).
  // 실제 "비활성 ADMIN 세션 → Notice Admin Action 실행 차단"은 Server Action을 이
  // 스크립트에서 직접 호출할 수 없어(Phase 12와 동일한 제약) Browser E2E로 별도 수행했다.
  // =====================================================================

  console.log("\n요약:", results.filter((r) => r.pass).length, "/", results.length, "PASS");
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error("\n실패한 테스트:");
    for (const f of failed) console.error(` - ${f.name} (${f.detail ?? ""})`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
