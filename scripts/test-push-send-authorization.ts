/**
 * Phase 11 §19: "Push Send API는 Server-only, 일반 STAFF가 직접 호출할 수 없어야
 * 한다"를 RLS 레벨에서 검증한다. 애초에 이 프로젝트엔 Push "발송"을 트리거하는
 * 공개 Route가 없다(src/lib/push/*는 서버 코드에서만 import되고, Route Handler로
 * 노출된 적이 없다 — 이건 코드 구조 사실이라 별도 자동 테스트 대상이 아니다). 여기서는
 * "설령 누군가 authenticated 세션으로 notifications/notification_targets/
 * notification_deliveries를 직접 INSERT하려 해도 DB가 막는가"를 확인한다.
 *
 * 실행: npm run test:push-send-authorization (npm run db:seed 먼저 필요)
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

async function main() {
  const staff = createClient<Database>(url!, publishableKey!, { auth: { persistSession: false } });
  const { error: signInError } = await staff.auth.signInWithPassword({
    email: TEST_USERS.staffHq.email,
    password: TEST_PASSWORD,
  });
  if (signInError) throw new Error(`로그인 실패: ${signInError.message}`);

  try {
    // 1) STAFF가 notifications를 직접 INSERT 시도 — 거부돼야 한다(발송은 Service Role 전용).
    const { error: notifInsertError } = await staff
      .from("notifications")
      .insert({ type: "notice", title: "가짜 알림", body: "테스트", deep_link: "/notices/00000000-0000-0000-0000-000000000000" });
    record("1. STAFF — notifications 직접 INSERT 시도는 거부됨", !!notifInsertError, notifInsertError?.message ?? "에러 없음(문제)");

    // 2) STAFF가 notification_targets를 직접 INSERT 시도 — 거부.
    const { error: targetInsertError } = await staff
      .from("notification_targets")
      .insert({ notification_id: "00000000-0000-0000-0000-000000000000", target_type: "all" });
    record("2. STAFF — notification_targets 직접 INSERT 시도는 거부됨", !!targetInsertError, targetInsertError?.message ?? "에러 없음(문제)");

    // 3) STAFF가 notification_deliveries를 직접 INSERT 시도 — 거부.
    const { error: deliveryInsertError } = await staff.from("notification_deliveries").insert({
      notification_id: "00000000-0000-0000-0000-000000000000",
      subscription_id: "00000000-0000-0000-0000-000000000000",
    });
    record("3. STAFF — notification_deliveries 직접 INSERT 시도는 거부됨", !!deliveryInsertError, deliveryInsertError?.message ?? "에러 없음(문제)");

    // 4) STAFF는 notification_settings(Push Go-Live 시각)를 조회할 수 없다(ADMIN 전용).
    const { data: settingsRows, error: settingsError } = await staff.from("notification_settings").select("*");
    record("4. STAFF — notification_settings 조회 시 0건(ADMIN 전용)", !settingsError && (settingsRows ?? []).length === 0, `rows=${(settingsRows ?? []).length}, error=${settingsError?.message ?? "none"}`);

    // 5) STAFF는 notification_settings를 UPDATE할 수 없다(GRANT는 있어도 RLS가 막음).
    const { data: updateResult, error: updateError } = await staff
      .from("notification_settings")
      .update({ push_go_live_at: new Date().toISOString() })
      .eq("id", 1)
      .select();
    record("5. STAFF — notification_settings UPDATE 시도는 0건(에러 아닌 조용한 차단)", !updateError && (updateResult ?? []).length === 0, `affected=${(updateResult ?? []).length}`);

    const { data: settingsAfter } = await service.from("notification_settings").select("push_go_live_at").eq("id", 1).single();
    record("5. 실제 push_go_live_at 값은 변경되지 않음", !!settingsAfter, JSON.stringify(settingsAfter));

    // 6) ADMIN은 notification_settings를 조회할 수 있다(대조군 — RLS가 ADMIN까지 막는
    //    과잉 차단이 아닌지 확인).
    const admin = createClient<Database>(url!, publishableKey!, { auth: { persistSession: false } });
    const { error: adminSignInError } = await admin.auth.signInWithPassword({
      email: TEST_USERS.admin.email,
      password: TEST_PASSWORD,
    });
    if (!adminSignInError) {
      const { data: adminSettings } = await admin.from("notification_settings").select("*").eq("id", 1);
      record("6. ADMIN — notification_settings 조회 가능(대조군)", (adminSettings ?? []).length === 1, `rows=${(adminSettings ?? []).length}`);
    }
    await admin.auth.signOut();
  } finally {
    await staff.auth.signOut();
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
