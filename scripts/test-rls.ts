/**
 * Phase 5 RLS / Authorization 검증 스위트.
 *
 * 반드시 npm run db:seed를 먼저 실행해 테스트 데이터가 있어야 한다.
 * Publishable Key로 각 테스트 계정에 실제로 로그인한 뒤 PostgREST(RLS 적용) 쿼리를
 * 직접 날려서, 화면 로직이 아니라 Database가 실제로 권한을 강제하는지 검증한다.
 *
 * 실행: npm run test:rls
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../src/types/database";

import { STORES, TEST_NOTICES, TEST_PASSWORD, TEST_USERS, type TestUserKey } from "./fixtures";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY가 .env.local에 필요합니다.");
  process.exit(1);
}

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
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

async function noticeTitlesVisibleTo(client: SupabaseClient<Database>): Promise<string[]> {
  const { data, error } = await client.from("notices").select("title").order("title");
  if (error) throw error;
  return (data ?? []).map((row) => row.title as string);
}

async function main() {
  const anon = createClient<Database>(url!, publishableKey!, { auth: { persistSession: false } });

  const admin = await signIn("admin");
  const manager = await signIn("manager");
  const staffHq = await signIn("staffHq");
  const staffDongbaek = await signIn("staffDongbaek");

  const noticeIdByKey = new Map<string, string>();
  {
    const { data, error } = await admin.from("notices").select("id, title");
    if (error) throw error;
    for (const row of data ?? []) {
      const match = TEST_NOTICES.find((n) => n.title === row.title);
      if (match) noticeIdByKey.set(match.key, row.id as string);
    }
  }
  const storeIdByCode = new Map<string, string>();
  {
    const { data, error } = await admin.from("stores").select("id, code");
    if (error) throw error;
    for (const row of data ?? []) storeIdByCode.set(row.code as string, row.id as string);
  }

  // -------------------------------------------------------------------
  // 1) 비로그인 사용자 접근 차단
  // -------------------------------------------------------------------
  {
    const { data, error } = await anon.from("notices").select("id");
    record(
      "1. 비로그인(anon) — notices 조회 시 0건",
      !error && (data?.length ?? -1) === 0,
      `rows=${data?.length}, error=${error?.message ?? "none"}`,
    );
  }
  {
    const { data, error } = await anon.from("profiles").select("id");
    record(
      "1. 비로그인(anon) — profiles 조회 시 0건",
      !error && (data?.length ?? -1) === 0,
      `rows=${data?.length}, error=${error?.message ?? "none"}`,
    );
  }
  {
    const { data, error } = await anon.from("stores").select("id");
    record(
      "1. 비로그인(anon) — stores 조회 시 0건",
      !error && (data?.length ?? -1) === 0,
      `rows=${data?.length}, error=${error?.message ?? "none"}`,
    );
  }

  // -------------------------------------------------------------------
  // 2) STAFF가 다른 매장 데이터 접근 불가
  // -------------------------------------------------------------------
  {
    const titles = await noticeTitlesVisibleTo(staffHq);
    const sawDongbaek = titles.includes("[동백점] DEV 테스트 공지");
    const sawOwnStore = titles.includes("[용인본점] DEV 테스트 공지");
    record(
      "2. STAFF(본점) — 동백점 전용 공지는 안 보임",
      !sawDongbaek,
      `titles=${JSON.stringify(titles)}`,
    );
    record("2. STAFF(본점) — 본점 전용 공지는 보임", sawOwnStore);
  }
  {
    const titles = await noticeTitlesVisibleTo(staffDongbaek);
    const sawHq = titles.includes("[용인본점] DEV 테스트 공지");
    const sawOwnStore = titles.includes("[동백점] DEV 테스트 공지");
    record("2. STAFF(동백점) — 본점 전용 공지는 안 보임", !sawHq, `titles=${JSON.stringify(titles)}`);
    record("2. STAFF(동백점) — 동백점 전용 공지는 보임", sawOwnStore);
  }
  {
    // 다른 매장 소속 정보(user_store_access) 자체도 볼 수 없어야 한다.
    const { data, error } = await staffHq.from("user_store_access").select("user_id");
    const { data: staffHqSelf } = await staffHq.auth.getUser();
    const allSelf = (data ?? []).every((row) => row.user_id === staffHqSelf.user?.id);
    record(
      "2. STAFF — user_store_access에서 자기 행만 보임",
      !error && allSelf,
      `rows=${data?.length}`,
    );
  }

  // -------------------------------------------------------------------
  // 3) STORE_MANAGER가 자신의 매장만 접근 가능
  // -------------------------------------------------------------------
  {
    const titles = await noticeTitlesVisibleTo(manager);
    const expectedVisible = ["[전체] DEV 테스트 공지", "[용인본점] DEV 테스트 공지"];
    const expectedHidden = [
      "[동백점] DEV 테스트 공지",
      "[STAFF 전체] DEV 테스트 공지",
      "[staffHq 개인지정] DEV 테스트 공지",
    ];
    const visibleOk = expectedVisible.every((t) => titles.includes(t));
    const hiddenOk = expectedHidden.every((t) => !titles.includes(t));
    record(
      "3. STORE_MANAGER(본점) — 본점+전체 공지만 보임, 동백점/역할별/개인별은 안 보임",
      visibleOk && hiddenOk,
      `titles=${JSON.stringify(titles)}`,
    );
  }
  {
    // 프로모션 도메인에서는(Phase 6에서 실제 구현) STORE_MANAGER가 전체 매장을 봐야
    // 하지만, 공지처럼 매장이 구조화된 리소스에서는 STAFF와 동일하게 자기 매장만
    // 보는 것이 확정된 설계다(permissions.md §1). 여기서는 그 경계를 명시적으로 검증한다.
    const { data } = await manager.from("stores").select("code");
    const seesAllStores = STORES.every((s) => (data ?? []).some((row) => row.code === s.code));
    record(
      "3. STORE_MANAGER — stores 목록(매장명) 자체는 전체 조회 가능(민감정보 아님)",
      seesAllStores,
    );
  }

  // -------------------------------------------------------------------
  // 4) ADMIN은 전체 접근 가능
  // -------------------------------------------------------------------
  {
    const titles = await noticeTitlesVisibleTo(admin);
    const allVisible = TEST_NOTICES.every((n) => titles.includes(n.title));
    record("4. ADMIN — 테스트 공지 5건 전체 조회 가능", allVisible, `titles=${JSON.stringify(titles)}`);
  }
  {
    const { count, error } = await admin.from("profiles").select("id", { count: "exact", head: true });
    record("4. ADMIN — profiles 전체 조회 가능(테스트 계정 4건 이상)", !error && (count ?? 0) >= 4, `count=${count}`);
  }

  // -------------------------------------------------------------------
  // 5) URL 직접 입력으로 권한 우회 불가 (ID를 알아도 RLS가 막는지)
  // -------------------------------------------------------------------
  {
    const dongbaekNoticeId = noticeIdByKey.get("dongbaek-notice");
    const { data, error } = await staffHq
      .from("notices")
      .select("id")
      .eq("id", dongbaekNoticeId!)
      .maybeSingle();
    record(
      "5. STAFF(본점) — 동백점 공지 id를 직접 지정해도 조회 불가",
      !error && data === null,
      `data=${JSON.stringify(data)}`,
    );
  }
  {
    // 다른 사람의 profile을 id로 직접 조회 시도.
    const { data: adminUser } = await admin.auth.getUser();
    const { data, error } = await staffHq
      .from("profiles")
      .select("id")
      .eq("id", adminUser.user!.id)
      .maybeSingle();
    record(
      "5. STAFF — 관리자 profile id를 직접 지정해도 조회 불가",
      !error && data === null,
      `data=${JSON.stringify(data)}`,
    );
  }
  {
    // stores insert를 직접 API 호출로 시도 (관리자 화면 UI를 거치지 않고).
    const { error } = await staffHq.from("stores").insert({ code: "FAKE", name: "가짜매장" });
    record("5. STAFF — stores 직접 INSERT 시도는 거부됨", !!error, `error=${error?.message}`);
  }
  {
    // user_store_access에 자기 자신을 동백점에 슬쩍 추가하는 시도(매장 접근 자가발급).
    const dongbaekId = storeIdByCode.get("DONGBAEK");
    const { data: staffHqUser } = await staffHq.auth.getUser();
    const { error } = await staffHq
      .from("user_store_access")
      .insert({ user_id: staffHqUser.user!.id, store_id: dongbaekId! });
    record(
      "5. STAFF — user_store_access에 스스로 매장 추가 시도는 거부됨",
      !!error,
      `error=${error?.message}`,
    );
  }

  // -------------------------------------------------------------------
  // 6) Client에서 Role 값을 바꿔도 권한 상승 불가
  // -------------------------------------------------------------------
  {
    const { data: staffHqUser } = await staffHq.auth.getUser();
    const { data, error } = await staffHq
      .from("profiles")
      .update({ role: "ADMIN" })
      .eq("id", staffHqUser.user!.id)
      .select("role");
    const blocked = !!error || (data ?? []).length === 0;
    record(
      "6. STAFF — 자기 profiles.role을 'ADMIN'으로 UPDATE 시도는 거부됨",
      blocked,
      `error=${error?.message ?? "none"}, rows=${JSON.stringify(data)}`,
    );

    const { data: recheck } = await admin
      .from("profiles")
      .select("role")
      .eq("id", staffHqUser.user!.id)
      .single();
    record(
      "6. STAFF — 실제 DB의 role은 여전히 STAFF로 유지됨",
      recheck?.role === "STAFF",
      `role=${recheck?.role}`,
    );
  }
  {
    const { data: staffHqUser } = await staffHq.auth.getUser();
    const { error } = await staffHq
      .from("profiles")
      .update({ is_active: false })
      .eq("id", staffHqUser.user!.id);
    record("6. STAFF — 자기 is_active를 스스로 변경 시도는 거부됨", !!error, `error=${error?.message}`);
  }

  // -------------------------------------------------------------------
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
