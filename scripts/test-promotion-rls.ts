/**
 * Phase 6 §16 — Promotion 도메인 RLS 검증.
 * npm run db:seed(Phase 5 계정)를 먼저 실행해 두어야 한다. 그 외 이 스크립트가
 * 검증에 필요한 최소 데이터(비노출 행사 캠페인 1건)는 스스로 만든다 — 다른 테스트
 * 스크립트의 실행 순서나 잔여 상태에 기대지 않는다.
 *
 * 실행: npm run test:promotion-rls
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../src/types/database";

import { TEST_PASSWORD, TEST_USERS, type TestUserKey } from "./fixtures";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  console.error("Supabase 환경변수가 .env.local에 필요합니다.");
  process.exit(1);
}

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

/** 비노출 행사 캠페인 + 연결 상품 1건을 멱등하게 준비한다(§16 STAFF 테스트 전제조건). */
async function ensureHiddenCampaignFixture(admin: SupabaseClient<Database>) {
  const campaignKey = "__test_promotion_rls_hidden_campaign__";
  const { data: existingCampaign } = await admin
    .from("event_campaigns")
    .select("*")
    .eq("campaign_key", campaignKey)
    .maybeSingle();
  const campaign =
    existingCampaign ??
    (
      await admin
        .from("event_campaigns")
        .insert({
          campaign_name: "RLS 테스트용 비노출 캠페인",
          campaign_key: campaignKey,
          is_visible: false,
          start_at: null,
          end_at: null,
        })
        .select()
        .single()
    ).data!;

  const productId = "PROD-RLS-TEST-HIDDEN";
  const { data: existingPromo } = await admin
    .from("promotions")
    .select("*")
    .eq("product_id", productId)
    .maybeSingle();
  const promo =
    existingPromo ??
    (
      await admin
        .from("promotions")
        .insert({
          product_id: productId,
          promotion_type: "event",
          brand: "RLS테스트",
          product_name: "비노출 캠페인 테스트 상품",
        })
        .select()
        .single()
    ).data!;

  await admin
    .from("event_campaign_products")
    .upsert({ campaign_id: campaign.id, promotion_id: promo.id }, { onConflict: "campaign_id,promotion_id" });
}

async function signIn(key: TestUserKey): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(url!, publishableKey!, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({
    email: TEST_USERS[key].email,
    password: TEST_PASSWORD,
  });
  if (error) throw new Error(`${key} 로그인 실패: ${error.message}`);
  return client;
}

async function main() {
  const admin = createClient<Database>(url!, secretKey!, { auth: { autoRefreshToken: false, persistSession: false } });
  const anon = createClient<Database>(url!, publishableKey!, { auth: { persistSession: false } });

  const staffHq = await signIn("staffHq");
  const adminUser = await signIn("admin");
  const managerUser = await signIn("manager");

  // ---- 1) 비로그인 사용자 조회 불가 -------------------------------------------------
  {
    const { data, error } = await anon.from("promotions").select("id");
    record("1. 비로그인 — promotions 조회 시 0건", !error && (data?.length ?? -1) === 0, `rows=${data?.length}`);
  }

  // ---- 이 스크립트 자체의 전제 조건을 자체적으로 만든다(다른 테스트 스크립트의 실행
  // 순서/잔여 상태에 기대지 않는다) — 비노출 행사 캠페인 + 연결 상품 1건.
  await ensureHiddenCampaignFixture(admin);

  // ---- 2) STAFF 권한 범위: 상시는 보이고, 노출 안 된 행사는 안 보임 -------------------------
  const { data: staffPromotions } = await staffHq.from("promotions").select("promotion_type, product_id");
  const staffPermanentCount = (staffPromotions ?? []).filter((p) => p.promotion_type === "permanent").length;
  record(
    "2. STAFF — 상시 프로모션은 조회 가능",
    staffPermanentCount > 0,
    `permanent rows=${staffPermanentCount}`,
  );

  const { data: allEventCampaigns } = await admin.from("event_campaigns").select("*");
  const hiddenCampaign = (allEventCampaigns ?? []).find((c) => !c.is_visible);
  if (hiddenCampaign) {
    const { data: hiddenProducts } = await admin
      .from("event_campaign_products")
      .select("promotion_id")
      .eq("campaign_id", hiddenCampaign.id);
    const hiddenPromotionIds = new Set((hiddenProducts ?? []).map((p) => p.promotion_id));
    const { data: staffEventVisible } = await staffHq
      .from("promotions")
      .select("id")
      .eq("promotion_type", "event");
    const staffCanSeeHidden = (staffEventVisible ?? []).some((p) => hiddenPromotionIds.has(p.id));
    record(
      "2. STAFF — 노출 OFF/기간 종료된 행사 캠페인의 상품은 안 보임",
      !staffCanSeeHidden,
    );
  } else {
    record("2. STAFF — 비노출 행사 캠페인 테스트", false, "테스트용 비노출 캠페인 없음 — npm run test:sync 먼저 실행 필요");
  }

  // ---- 3) STORE_MANAGER — 비노출/종료 캠페인은 ADMIN만 볼 수 있도록 재검토 후 확정
  //         (Phase 6.5 보안 재검토 — STAFF와 동일하게 "지금 노출 중"인 것만 조회 가능) ----
  if (hiddenCampaign) {
    const { data: managerEvent } = await managerUser.from("promotions").select("id").eq("promotion_type", "event");
    const { data: hiddenProducts } = await admin
      .from("event_campaign_products")
      .select("promotion_id")
      .eq("campaign_id", hiddenCampaign.id);
    const hiddenPromotionIds = new Set((hiddenProducts ?? []).map((p) => p.promotion_id));
    const managerCanSeeHidden = (managerEvent ?? []).some((p) => hiddenPromotionIds.has(p.id));
    record(
      "3. STORE_MANAGER — 비노출 행사 캠페인 상품은 안 보임(ADMIN 전용으로 재확정)",
      !managerCanSeeHidden,
    );
  }
  const { data: managerCampaigns } = await managerUser.from("event_campaigns").select("id");
  record(
    "3. STORE_MANAGER — event_campaigns는 노출 중인 것만 조회(비노출 제외)",
    (managerCampaigns?.length ?? -1) < (allEventCampaigns?.length ?? -1),
    `manager=${managerCampaigns?.length}, total=${allEventCampaigns?.length}`,
  );

  // ---- 4) ADMIN 전체 접근 --------------------------------------------------------
  const { count } = await adminUser.from("promotions").select("id", { count: "exact", head: true });
  const { count: totalCount } = await admin.from("promotions").select("id", { count: "exact", head: true });
  record(
    "4. ADMIN — promotions 전체 조회 가능(Service Role과 동일 건수)",
    count === totalCount,
    `admin=${count}, total=${totalCount}`,
  );
  const { data: adminSyncLogs } = await adminUser.from("sync_logs").select("id");
  record("4. ADMIN — sync_logs 조회 가능", (adminSyncLogs?.length ?? 0) > 0);
  const { data: staffSyncLogs, error: staffSyncLogsError } = await staffHq.from("sync_logs").select("id");
  record(
    "4-보조. STAFF — sync_logs는 조회 불가(0건, ADMIN 전용)",
    !staffSyncLogsError && (staffSyncLogs?.length ?? -1) === 0,
  );

  // ---- 5) Secret Key 없이 Client에서 쓰기 시도 — 전부 거부되어야 함 -----------------------
  {
    const { error } = await staffHq.from("promotions").insert({
      product_id: "PROD-HACK-001",
      promotion_type: "permanent",
      brand: "해킹",
      product_name: "권한 우회 테스트 상품",
    });
    record("5. STAFF — promotions 직접 INSERT 시도는 거부됨", !!error, `error=${error?.message}`);
  }
  // 주의: 쓰기가 막히는 방식은 두 가지다 — (a) GRANT 자체가 없어 "permission
  // denied" 에러가 나거나, (b) GRANT는 있지만 RLS가 대상 행을 0건으로 만들어
  // 에러 없이 조용히 0건 성공으로 응답하는 경우. 둘 다 "쓰기가 막혔다"는 유효한
  // 결과이므로 error 유무만으로 판정하지 않고, 항상 Service Role로 재조회한
  // 실제 DB 값이 그대로인지로 최종 판정한다.
  {
    const { data: anyPromo } = await admin.from("promotions").select("id, brand").limit(1).single();
    const originalBrand = anyPromo!.brand;
    const { data: updateResult, error } = await adminUser
      .from("promotions")
      .update({ brand: "RLS_BYPASS_TEST" })
      .eq("id", anyPromo!.id)
      .select();
    const { data: recheck } = await admin.from("promotions").select("brand").eq("id", anyPromo!.id).single();
    const blockedByError = !!error;
    const blockedByRls = !error && (updateResult?.length ?? 0) === 0;
    record(
      "5. ADMIN 역할이어도 (Secret Key 없는) authenticated 세션으로는 promotions UPDATE 불가 — Sync는 오직 Service Role",
      (blockedByError || blockedByRls) && recheck?.brand === originalBrand,
      `error=${error?.message}, affectedRows=${updateResult?.length}, dbValueUnchanged=${recheck?.brand === originalBrand}`,
    );
  }
  {
    const { data: anyCampaign } = await admin.from("event_campaigns").select("id, is_visible").limit(1).single();
    const original = anyCampaign!.is_visible;
    const { data: updateResult } = await staffHq
      .from("event_campaigns")
      .update({ is_visible: !original })
      .eq("id", anyCampaign!.id)
      .select();
    const { data: recheck } = await admin.from("event_campaigns").select("is_visible").eq("id", anyCampaign!.id).single();
    record(
      "5. STAFF — event_campaigns 직접 UPDATE(행사 강제 노출) 시도는 거부됨",
      (updateResult?.length ?? 0) === 0 && recheck?.is_visible === original,
      `affectedRows=${updateResult?.length}, dbValueUnchanged=${recheck?.is_visible === original}`,
    );
  }
  {
    const { data: anyDef } = await admin
      .from("promotion_field_definitions")
      .select("id, push_enabled")
      .limit(1)
      .single();
    const original = anyDef!.push_enabled;
    const { data: updateResult } = await staffHq
      .from("promotion_field_definitions")
      .update({ push_enabled: !original })
      .eq("id", anyDef!.id)
      .select();
    const { data: recheck } = await admin
      .from("promotion_field_definitions")
      .select("push_enabled")
      .eq("id", anyDef!.id)
      .single();
    record(
      "5. STAFF — promotion_field_definitions 직접 UPDATE 시도는 거부됨",
      (updateResult?.length ?? 0) === 0 && recheck?.push_enabled === original,
      `affectedRows=${updateResult?.length}, dbValueUnchanged=${recheck?.push_enabled === original}`,
    );
  }

  console.log("\n요약:", results.filter((r) => r.pass).length, "/", results.length, "PASS");
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error("\n실패한 테스트:");
    for (const f of failed) console.error(` - ${f.name} (${f.detail ?? ""})`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
