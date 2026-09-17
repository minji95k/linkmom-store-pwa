/**
 * Phase 10: Supabase Realtime(postgres_changes)이 실제로 RLS를 적용하는지 실측 검증.
 *
 * 이 스크립트가 필요한 이유: "Realtime은 RLS를 존중한다"는 것은 Supabase의 문서상
 * 동작이지만, 이 프로젝트는 "가정하지 말고 직접 확인" 원칙을 지킨다(CLAUDE.md
 * Phase 6.5/6 lessons). STAFF 세션으로 자신이 볼 수 없는 행(비활성 상품, 다른 매장
 * 공지)의 변경을 구독했을 때 실제로 이벤트가 안 오는지, 반대로 볼 수 있는 행의
 * 변경은 정상 수신되는지를 둘 다 확인한다(음성 테스트만으로는 "설정이 잘못돼서
 * 아무것도 안 오는 것"과 "RLS가 제대로 막은 것"을 구분할 수 없다).
 *
 * 실행: npm run test:realtime-rls (npm run db:seed 먼저 필요)
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

function waitForEvent(
  channel: ReturnType<ReturnType<typeof createClient>["channel"]>,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }, timeoutMs);
    // 호출부가 .on(...)을 이미 걸어둔 채로 넘기고, 실제 콜백 안에서 이 resolve를 부른다.
    (channel as unknown as { _testResolve?: (v: boolean) => void })._testResolve = (v: boolean) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(v);
      }
    };
  });
}

async function main() {
  const staff = createClient<Database>(url!, publishableKey!, { auth: { persistSession: false } });
  const { error: signInError } = await staff.auth.signInWithPassword({
    email: TEST_USERS.staffHq.email,
    password: TEST_PASSWORD,
  });
  if (signInError) throw new Error(`로그인 실패: ${signInError.message}`);

  // ---------------------------------------------------------------
  // 1) STAFF가 못 보는 상품(비활성) 변경 → 이벤트가 오면 안 된다.
  // ---------------------------------------------------------------
  {
    const { data: inactive } = await service
      .from("promotions")
      .select("id, remarks")
      .eq("product_id", "PROD-000232")
      .maybeSingle();

    if (!inactive) {
      record("1. STAFF — 비활성 상품 변경 구독 안 됨", false, "PROD-000232 fixture 없음(스킵 불가)");
    } else {
      const channel = staff.channel(`test-invisible-${crypto.randomUUID()}`);
      const waiter = waitForEvent(channel, 4000);
      channel
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "promotions", filter: `id=eq.${inactive.id}` },
          () => (channel as unknown as { _testResolve: (v: boolean) => void })._testResolve(true),
        )
        .subscribe();
      await new Promise((r) => setTimeout(r, 800)); // subscribe 확정 대기

      await service.from("promotions").update({ remarks: `realtime-test-${Date.now()}` }).eq("id", inactive.id);

      const gotEvent = await waiter;
      await staff.removeChannel(channel);
      record("1. STAFF — 비활성(RLS 비가시) 상품 UPDATE는 이벤트로 안 옴", !gotEvent, `event received=${gotEvent}`);

      // 원상복구
      await service.from("promotions").update({ remarks: inactive.remarks }).eq("id", inactive.id);
    }
  }

  // ---------------------------------------------------------------
  // 2) STAFF가 보는 상품(활성, 상시) 변경 → 이벤트가 와야 한다(구독 자체가 동작하는지 확인).
  // ---------------------------------------------------------------
  {
    const { data: visible } = await service
      .from("promotions")
      .select("id, remarks")
      .eq("promotion_type", "permanent")
      .eq("is_active", true)
      .limit(1)
      .single();
    if (!visible) throw new Error("활성 permanent 프로모션이 하나도 없습니다.");

    const channel = staff.channel(`test-visible-${crypto.randomUUID()}`);
    const waiter = waitForEvent(channel, 4000);
    channel
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "promotions", filter: `id=eq.${visible.id}` },
        () => (channel as unknown as { _testResolve: (v: boolean) => void })._testResolve(true),
      )
      .subscribe();
    await new Promise((r) => setTimeout(r, 800));

    await service.from("promotions").update({ remarks: `realtime-test-${Date.now()}` }).eq("id", visible.id);

    const gotEvent = await waiter;
    await staff.removeChannel(channel);
    record("2. STAFF — 활성(RLS 가시) 상품 UPDATE는 이벤트로 옴(구독 자체가 동작함 확인)", gotEvent, `event received=${gotEvent}`);

    await service.from("promotions").update({ remarks: visible.remarks }).eq("id", visible.id);
  }

  // ---------------------------------------------------------------
  // 3) STAFF(본점)가 못 보는 동백점 전용 공지 UPDATE → 이벤트가 오면 안 된다.
  // ---------------------------------------------------------------
  {
    const { data: dongbaekNotice } = await service
      .from("notices")
      .select("id, body")
      .eq("title", "[DEV Phase8] 동백점 공지")
      .maybeSingle();

    if (!dongbaekNotice) {
      record("3. STAFF(본점) — 동백점 공지 UPDATE 이벤트 안 옴", false, "fixture 없음(db:seed:notices-phase8 먼저 실행)");
    } else {
      const channel = staff.channel(`test-notice-invisible-${crypto.randomUUID()}`);
      const waiter = waitForEvent(channel, 4000);
      channel
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "notices", filter: `id=eq.${dongbaekNotice.id}` },
          () => (channel as unknown as { _testResolve: (v: boolean) => void })._testResolve(true),
        )
        .subscribe();
      await new Promise((r) => setTimeout(r, 800));

      await service.from("notices").update({ body: `realtime-test-${Date.now()}` }).eq("id", dongbaekNotice.id);

      const gotEvent = await waiter;
      await staff.removeChannel(channel);
      record("3. STAFF(본점) — 동백점 전용 공지 UPDATE는 이벤트로 안 옴", !gotEvent, `event received=${gotEvent}`);

      await service.from("notices").update({ body: dongbaekNotice.body }).eq("id", dongbaekNotice.id);
    }
  }

  // ---------------------------------------------------------------
  // 4) STAFF가 보는 전체 대상 공지 UPDATE → 이벤트가 와야 한다.
  // ---------------------------------------------------------------
  {
    const { data: allNotice } = await service
      .from("notices")
      .select("id, body")
      .eq("title", "[DEV Phase8] 전체 일반공지")
      .maybeSingle();

    if (!allNotice) {
      record("4. STAFF — 전체 대상 공지 UPDATE 이벤트 옴", false, "fixture 없음");
    } else {
      const channel = staff.channel(`test-notice-visible-${crypto.randomUUID()}`);
      const waiter = waitForEvent(channel, 4000);
      channel
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "notices", filter: `id=eq.${allNotice.id}` },
          () => (channel as unknown as { _testResolve: (v: boolean) => void })._testResolve(true),
        )
        .subscribe();
      await new Promise((r) => setTimeout(r, 800));

      await service.from("notices").update({ body: `realtime-test-${Date.now()}` }).eq("id", allNotice.id);

      const gotEvent = await waiter;
      await staff.removeChannel(channel);
      record("4. STAFF — 전체 대상 공지 UPDATE는 이벤트로 옴", gotEvent, `event received=${gotEvent}`);

      await service.from("notices").update({ body: allNotice.body }).eq("id", allNotice.id);
    }
  }

  await staff.auth.signOut();

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
