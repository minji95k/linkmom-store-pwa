/**
 * Phase 11 §19: "사용자는 자기 Device Subscription만 등록/해제할 수 있어야 한다"를
 * 실측 검증한다(push_subscriptions RLS). 테스트가 만드는 행은 가짜 endpoint를 쓰는
 * 순수 테스트 데이터이며(실제 브라우저 구독이 아님, Promotion/Notice 업무 데이터와
 * 무관), 종료 시 스스로 정리한다(성공/실패 무관, finally).
 *
 * 실행: npm run test:push-subscriptions-rls (npm run db:seed 먼저 필요)
 */
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/types/database";

import { TEST_PASSWORD, TEST_USERS } from "./fixtures";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY가 필요합니다.");
  process.exit(1);
}

const service = createClient<Database>(url, secretKey, { auth: { persistSession: false } });

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const TEST_ENDPOINT = `https://fcm.googleapis.com/fcm/send/test-push-rls-${Date.now()}`;

async function main() {
  const staffHq = createClient<Database>(url!, publishableKey!, { auth: { persistSession: false } });
  const staffDongbaek = createClient<Database>(url!, publishableKey!, { auth: { persistSession: false } });
  const anon = createClient<Database>(url!, publishableKey!, { auth: { persistSession: false } });

  const { error: signIn1 } = await staffHq.auth.signInWithPassword({
    email: TEST_USERS.staffHq.email,
    password: TEST_PASSWORD,
  });
  if (signIn1) throw new Error(`staffHq 로그인 실패: ${signIn1.message}`);
  const { error: signIn2 } = await staffDongbaek.auth.signInWithPassword({
    email: TEST_USERS.staffDongbaek.email,
    password: TEST_PASSWORD,
  });
  if (signIn2) throw new Error(`staffDongbaek 로그인 실패: ${signIn2.message}`);

  const {
    data: { user: staffHqUser },
  } = await staffHq.auth.getUser();
  const {
    data: { user: staffDongbaekUser },
  } = await staffDongbaek.auth.getUser();
  if (!staffHqUser || !staffDongbaekUser) throw new Error("세션에서 user를 가져오지 못했습니다.");

  let subscriptionId: string | null = null;

  try {
    // 1) 본인 소유 Subscription 등록 ------------------------------------------------
    const { data: inserted, error: insertError } = await staffHq
      .from("push_subscriptions")
      .insert({ user_id: staffHqUser.id, endpoint: TEST_ENDPOINT, p256dh: "test-p256dh", auth: "test-auth" })
      .select("id")
      .single();
    record("1. staffHq — 본인 소유 Subscription INSERT 성공", !insertError && !!inserted, insertError?.message);
    subscriptionId = inserted?.id ?? null;

    // 2) 다른 사용자의 user_id로 등록 시도(위장) — 거부돼야 한다 -----------------------
    const { error: impersonateError } = await staffDongbaek
      .from("push_subscriptions")
      .insert({ user_id: staffHqUser.id, endpoint: `${TEST_ENDPOINT}-impersonate`, p256dh: "x", auth: "y" });
    record("2. staffDongbaek — 타인 user_id로 위장 INSERT 시도는 거부됨", !!impersonateError, impersonateError?.message ?? "에러 없음(문제)");

    // 3) 본인 것만 SELECT 가능(타인 것은 안 보임) -----------------------------------
    if (subscriptionId) {
      const { data: seenByOther } = await staffDongbaek.from("push_subscriptions").select("id").eq("id", subscriptionId);
      record("3. staffDongbaek — 타인 Subscription id 직접 지정해도 조회 불가", (seenByOther ?? []).length === 0, `rows=${(seenByOther ?? []).length}`);

      const { data: seenBySelf } = await staffHq.from("push_subscriptions").select("id").eq("id", subscriptionId);
      record("3. staffHq — 본인 Subscription은 조회 가능", (seenBySelf ?? []).length === 1, `rows=${(seenBySelf ?? []).length}`);
    }

    // 4) 타인 Subscription UPDATE 시도 — 0건 성공(에러 아님, Phase 6.5 교훈) ------------
    if (subscriptionId) {
      const { data: updateResult, error: updateError } = await staffDongbaek
        .from("push_subscriptions")
        .update({ is_active: false })
        .eq("id", subscriptionId)
        .select();
      record("4. staffDongbaek — 타인 Subscription UPDATE 시도는 0건(에러 아닌 조용한 차단)", !updateError && (updateResult ?? []).length === 0, `affected=${(updateResult ?? []).length}`);

      const { data: dbValue } = await service.from("push_subscriptions").select("is_active").eq("id", subscriptionId).single();
      record("4. 실제 DB 값은 그대로 is_active=true", dbValue?.is_active === true, String(dbValue?.is_active));
    }

    // 5) 타인 Subscription DELETE 시도 — 0건 성공 ------------------------------------
    if (subscriptionId) {
      const { data: deleteResult, error: deleteError } = await staffDongbaek
        .from("push_subscriptions")
        .delete()
        .eq("id", subscriptionId)
        .select();
      record("5. staffDongbaek — 타인 Subscription DELETE 시도는 0건", !deleteError && (deleteResult ?? []).length === 0, `affected=${(deleteResult ?? []).length}`);

      const { data: stillExists } = await service.from("push_subscriptions").select("id").eq("id", subscriptionId).maybeSingle();
      record("5. 실제 DB에 행이 그대로 남아있음", !!stillExists);
    }

    // 6) 비로그인(anon) — push_subscriptions 조회 시 0건 ------------------------------
    const { data: anonRows, error: anonError } = await anon.from("push_subscriptions").select("id");
    record("6. 비로그인(anon) — push_subscriptions 조회 시 0건", !anonError && (anonRows ?? []).length === 0, `rows=${(anonRows ?? []).length}, error=${anonError?.message ?? "none"}`);

    // 7. ADMIN은 전체 조회 가능(is_admin() 예외) -------------------------------------
    const adminClient = createClient<Database>(url!, publishableKey!, { auth: { persistSession: false } });
    const { error: adminSignInError } = await adminClient.auth.signInWithPassword({
      email: TEST_USERS.admin.email,
      password: TEST_PASSWORD,
    });
    if (!adminSignInError && subscriptionId) {
      const { data: adminView } = await adminClient.from("push_subscriptions").select("id").eq("id", subscriptionId);
      record("7. ADMIN — 타 사용자 Subscription도 조회 가능", (adminView ?? []).length === 1, `rows=${(adminView ?? []).length}`);
    }
    await adminClient.auth.signOut();

    // 8) 본인 소유 Subscription DELETE(정상 해제) -------------------------------------
    if (subscriptionId) {
      const { data: ownDelete, error: ownDeleteError } = await staffHq
        .from("push_subscriptions")
        .delete()
        .eq("id", subscriptionId)
        .select();
      record("8. staffHq — 본인 Subscription 정상 해제(DELETE) 성공", !ownDeleteError && (ownDelete ?? []).length === 1, `affected=${(ownDelete ?? []).length}`);
      subscriptionId = null;
    }
  } finally {
    // 정리: 테스트가 어느 단계에서 실패했든 이 endpoint로 남은 행을 전부 지운다.
    await service.from("push_subscriptions").delete().like("endpoint", `${TEST_ENDPOINT}%`);
    await staffHq.auth.signOut();
    await staffDongbaek.auth.signOut();
  }

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
