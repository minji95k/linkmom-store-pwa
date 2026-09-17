/**
 * Phase 8 Notice System RLS 검증 스위트.
 *
 * 반드시 `npm run db:seed`와 `npm run db:seed:notices-phase8`를 먼저 실행해야 한다.
 * Publishable Key로 각 테스트 계정에 실제로 로그인해 PostgREST(RLS 적용) 쿼리를
 * 직접 날린다 — 화면 로직이 아니라 Database가 실제로 권한을 강제하는지 검증한다.
 *
 * 실행: npm run test:notice-rls
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../src/types/database";

import { TEST_PASSWORD, TEST_USERS, type TestUserKey } from "./fixtures";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY가 .env.local에 필요합니다.");
  process.exit(1);
}

// 이 스위트는 seed 계정(staffHq/staffDongbaek)의 notice_reads를 실제로 만든다 —
// 재실행 시 "아직 안 읽음"을 전제하는 검증이 이전 실행의 흔적 때문에 깨질 수 있다.
// notice_reads에는 DELETE RLS 정책이 아예 없어(본인도 못 지움) Service Role로만
// 정리 가능하다 — 이 스크립트가 만든 read/confirm 흔적을 시작 시 스스로 치운다.
const serviceRole = createClient<Database>(url, secretKey, { auth: { persistSession: false } });

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function signIn(key: TestUserKey): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(url!, publishableKey!, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: TEST_USERS[key].email, password: TEST_PASSWORD });
  if (error) throw new Error(`${key} 로그인 실패: ${error.message}`);
  return client;
}

async function titlesVisibleTo(client: SupabaseClient<Database>): Promise<string[]> {
  const { data, error } = await client.from("notices").select("title").like("title", "[DEV Phase8]%");
  if (error) throw error;
  return (data ?? []).map((r) => r.title);
}

const TITLES = {
  all: "[DEV Phase8] 전체 일반공지",
  required: "[DEV Phase8] 전체 필독공지",
  urgent: "[DEV Phase8] 전체 긴급공지",
  hq: "[DEV Phase8] 용인본점 중요공지",
  dongbaek: "[DEV Phase8] 동백점 공지",
  adminOnly: "[DEV Phase8] ADMIN 전용 테스트공지",
  future: "[DEV Phase8] 게시 예정(아직 비노출) 공지",
  expired: "[DEV Phase8] 게시 종료(비노출) 공지",
  link: "[DEV Phase8] 외부링크 포함 공지",
};

async function main() {
  const anon = createClient<Database>(url!, publishableKey!, { auth: { persistSession: false } });
  const admin = await signIn("admin");
  const manager = await signIn("manager");
  const staffHq = await signIn("staffHq");
  const staffDongbaek = await signIn("staffDongbaek");

  const { data: adminNotices, error: adminListError } = await admin
    .from("notices")
    .select("id, title")
    .like("title", "[DEV Phase8]%");
  if (adminListError) throw adminListError;
  const idByTitle = new Map((adminNotices ?? []).map((n) => [n.title, n.id]));
  for (const [key, title] of Object.entries(TITLES)) {
    if (!idByTitle.has(title)) {
      console.error(`Phase 8 fixture 누락: ${title} (${key}) — npm run db:seed:notices-phase8 먼저 실행하세요.`);
      process.exit(1);
    }
  }

  // 8/9번 검증은 "아직 안 읽음" 전제로 시작해야 한다 — 재실행 시에도 항상 그 전제가
  // 성립하도록, 이 스위트가 이전에 만들었을 수 있는 read/confirm 흔적을 먼저 지운다.
  {
    const { data: hqUser } = await staffHq.auth.getUser();
    const { data: dongbaekUser } = await staffDongbaek.auth.getUser();
    const noticeIds = [idByTitle.get(TITLES.all)!, idByTitle.get(TITLES.required)!];
    const userIds = [hqUser.user!.id, dongbaekUser.user!.id];
    const { error } = await serviceRole.from("notice_reads").delete().in("notice_id", noticeIds).in("user_id", userIds);
    if (error) throw error;
  }

  // 1) 비로그인
  {
    const { data, error } = await anon.from("notices").select("id").like("title", "[DEV Phase8]%");
    record("1. 비로그인 — Phase8 공지 0건", !error && (data?.length ?? -1) === 0, `rows=${data?.length}`);
  }

  // 2) STAFF(본점): 전체/본점 대상은 보이고, 동백점/ADMIN전용/게시기간 밖은 안 보임
  {
    const titles = await titlesVisibleTo(staffHq);
    const shouldSee = [TITLES.all, TITLES.required, TITLES.urgent, TITLES.hq, TITLES.link];
    const shouldNotSee = [TITLES.dongbaek, TITLES.adminOnly, TITLES.future, TITLES.expired];
    record(
      "2. STAFF(본점) — 전체/본점 대상 공지는 보임",
      shouldSee.every((t) => titles.includes(t)),
      `titles=${JSON.stringify(titles)}`,
    );
    record(
      "2. STAFF(본점) — 동백점/ADMIN전용/게시기간 밖 공지는 안 보임",
      shouldNotSee.every((t) => !titles.includes(t)),
      `titles=${JSON.stringify(titles)}`,
    );
  }

  // 3) STAFF(동백점)
  {
    const titles = await titlesVisibleTo(staffDongbaek);
    record("3. STAFF(동백점) — 동백점 공지는 보임", titles.includes(TITLES.dongbaek));
    record("3. STAFF(동백점) — 용인본점 중요공지는 안 보임", !titles.includes(TITLES.hq));
  }

  // 4) STORE_MANAGER(본점) — 공지는 STAFF와 동일 취급(permissions.md §1, 프로모션과 다른 경계)
  {
    const titles = await titlesVisibleTo(manager);
    record("4. STORE_MANAGER(본점) — 본점 대상 공지는 보임", titles.includes(TITLES.hq));
    record("4. STORE_MANAGER — ADMIN 전용 공지는 안 보임", !titles.includes(TITLES.adminOnly));
  }

  // 5) ADMIN — 게시기간과 무관하게 전체
  {
    const titles = await titlesVisibleTo(admin);
    const allNine = Object.values(TITLES);
    record(
      "5. ADMIN — 게시 예정/종료 포함 Phase8 공지 9건 전체 조회 가능",
      allNine.every((t) => titles.includes(t)),
      `count=${titles.length}`,
    );
  }

  // 6) 게시기간 자동 비노출 — ADMIN 아닌 모든 세션에서 확인
  for (const [label, client] of [
    ["STAFF(본점)", staffHq],
    ["STAFF(동백점)", staffDongbaek],
    ["STORE_MANAGER", manager],
  ] as const) {
    const titles = await titlesVisibleTo(client);
    record(`6. ${label} — 게시 예정 공지는 비노출`, !titles.includes(TITLES.future));
    record(`6. ${label} — 게시 종료 공지는 비노출(데이터 삭제 아님, ADMIN은 5번에서 확인됨)`, !titles.includes(TITLES.expired));
  }

  // 7) 다른 매장 URL 직접 접근(ID를 알아도 RLS가 막는지)
  {
    const dongbaekId = idByTitle.get(TITLES.dongbaek)!;
    const { data, error } = await staffHq.from("notices").select("id").eq("id", dongbaekId).maybeSingle();
    record("7. STAFF(본점) — 동백점 공지 id 직접 지정해도 조회 불가", !error && data === null, `data=${JSON.stringify(data)}`);
  }
  {
    const adminOnlyId = idByTitle.get(TITLES.adminOnly)!;
    const { data, error } = await staffHq.from("notices").select("id").eq("id", adminOnlyId).maybeSingle();
    record("7. STAFF — ADMIN 전용 공지 id 직접 지정해도 조회 불가", !error && data === null, `data=${JSON.stringify(data)}`);
  }
  {
    const futureId = idByTitle.get(TITLES.future)!;
    const { data, error } = await staffHq.from("notices").select("id").eq("id", futureId).maybeSingle();
    record("7. STAFF — 게시 예정 공지 id 직접 지정해도 조회 불가", !error && data === null, `data=${JSON.stringify(data)}`);
  }

  // 8) 읽음(unread/read) — 본인 상태만 변경 가능
  const allNoticeId = idByTitle.get(TITLES.all)!;
  {
    const { data: staffHqUser } = await staffHq.auth.getUser();
    const { error } = await staffHq
      .from("notice_reads")
      .upsert({ notice_id: allNoticeId, user_id: staffHqUser.user!.id }, { onConflict: "notice_id,user_id" });
    record("8. STAFF — 자신의 notice_reads insert(읽음 처리) 성공", !error, `error=${error?.message}`);
  }
  {
    // staffDongbaek이 같은 공지에 대해 staffHq의 read row를 조회 시도 — 본인 것만 보여야 한다.
    const { data } = await staffDongbaek.from("notice_reads").select("user_id").eq("notice_id", allNoticeId);
    const { data: dongbaekUser } = await staffDongbaek.auth.getUser();
    const onlySelf = (data ?? []).every((r) => r.user_id === dongbaekUser.user?.id);
    record("8. STAFF(동백점) — notice_reads 조회 시 자기 행만 보임(타인 읽음 여부 노출 안 됨)", onlySelf, `rows=${data?.length}`);
  }
  {
    // staffHq가 staffDongbaek의 읽음 상태를 직접 UPDATE 시도 — RLS가 0건으로 막아야 한다(에러 아님, Phase6에서 겪은 것과 동일 패턴).
    // "행 자체가 없어서 0건"이 아니라 "RLS가 막아서 0건"임을 증명하기 위해 먼저
    // staffDongbaek 본인이 read row를 실제로 만들어둔다.
    const { data: dongbaekUser } = await staffDongbaek.auth.getUser();
    const { error: selfInsertError } = await staffDongbaek
      .from("notice_reads")
      .upsert({ notice_id: allNoticeId, user_id: dongbaekUser.user!.id }, { onConflict: "notice_id,user_id" });
    if (selfInsertError) throw selfInsertError;

    const { data, error } = await staffHq
      .from("notice_reads")
      .update({ confirmed_at: new Date().toISOString() })
      .eq("notice_id", allNoticeId)
      .eq("user_id", dongbaekUser.user!.id)
      .select();
    record(
      "8. STAFF — 실제로 존재하는 타인의 notice_reads를 UPDATE해도 0건(에러 아닌 조용한 차단)",
      !error && (data ?? []).length === 0,
      `error=${error?.message ?? "none"}, affected=${data?.length}`,
    );

    const { data: recheck } = await admin
      .from("notice_reads")
      .select("confirmed_at")
      .eq("notice_id", allNoticeId)
      .eq("user_id", dongbaekUser.user!.id)
      .single();
    record(
      "8. STAFF의 UPDATE 시도 이후에도 실제 DB 값은 안 바뀜(confirmed_at 그대로 null)",
      recheck?.confirmed_at === null,
      `confirmed_at=${recheck?.confirmed_at}`,
    );
  }

  // 9) 필독 확인 완료(confirmed) — read 없이는 confirm 불가
  const requiredNoticeId = idByTitle.get(TITLES.required)!;
  {
    const { data: dongbaekUser } = await staffDongbaek.auth.getUser();
    // staffDongbaek은 아직 이 공지를 "읽지"(notice_reads insert) 않은 상태.
    const { data, error } = await staffDongbaek
      .from("notice_reads")
      .update({ confirmed_at: new Date().toISOString() })
      .eq("notice_id", requiredNoticeId)
      .eq("user_id", dongbaekUser.user!.id)
      .select();
    record(
      "9. STAFF — read 기록 없이 confirm(UPDATE) 시도 시 0건",
      !error && (data ?? []).length === 0,
      `affected=${data?.length}`,
    );

    const { error: insertError } = await staffDongbaek
      .from("notice_reads")
      .upsert({ notice_id: requiredNoticeId, user_id: dongbaekUser.user!.id }, { onConflict: "notice_id,user_id" });
    const { data: confirmed, error: confirmError } = await staffDongbaek
      .from("notice_reads")
      .update({ confirmed_at: new Date().toISOString() })
      .eq("notice_id", requiredNoticeId)
      .eq("user_id", dongbaekUser.user!.id)
      .select("confirmed_at");
    record(
      "9. STAFF — read 후에는 confirm 성공(read와 confirmed는 별도 상태)",
      !insertError && !confirmError && (confirmed ?? []).length === 1 && confirmed?.[0]?.confirmed_at !== null,
      `error=${confirmError?.message ?? "none"}`,
    );
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
