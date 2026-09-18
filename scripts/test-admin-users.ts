/**
 * Phase 12(Minimum Admin — 직원 계정 관리) 검증 스위트.
 *
 * 이 스크립트가 검증하는 범위(의도적으로 좁힘):
 *  - DB/RLS/Auth 레벨에서 실제로 강제되는 것 (Service Role + 로그인 세션으로 직접 쿼리)
 *  - src/lib/admin/users.ts(계정 생성/재설정)의 핵심 동작이 의존하는 Supabase 기본기
 *    (auth.admin.createUser 중복 이메일 거부, auth.admin.deleteUser의 cascade,
 *    signInWithPassword 재인증)
 *
 * 이 스크립트가 검증하지 "않는" 범위:
 *  - Server Action(src/app/admin/users/actions.ts)의 requireAdmin() 자체 — Next.js
 *    Server Action은 RSC 전용 프로토콜(Next-Action 헤더 등)로 호출되고, getCurrentUser/
 *    createClient는 cookies()(next/headers)에 의존해 요청 컨텍스트 밖(plain tsx)에서
 *    호출하면 즉시 throw한다(Phase 11 "server-only" 교훈과 동일한 제약, CLAUDE.md 참조).
 *    이 계층은 Browser E2E(§23 I/J)로 검증한다.
 *  - 로그인 자체 차단(§13)·기존 세션 강제 로그아웃(§14) — Supabase Auth 자체는
 *    profiles.is_active를 모르므로(우리 App 코드가 차단), Browser E2E(§23 E/F)로 검증한다.
 *
 * 반드시 npm run db:seed를 먼저 실행해 기존 Phase 5 테스트 계정이 있어야 한다.
 * 이 스크립트가 새로 만드는 계정은 전부 disposable(생성→검증→즉시 삭제)이며,
 * 실행 종료 시(성공/실패 무관) finally에서 스스로 정리한다.
 *
 * 실행: npm run test:admin-users
 */
import { randomUUID } from "node:crypto";

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
function note(text: string) {
  console.log(`[NOTE] ${text}`);
}

function signedInClient() {
  return createClient<Database>(url!, publishableKey!, { auth: { persistSession: false } });
}

async function signIn(key: "admin" | "manager" | "staffHq" | "staffDongbaek") {
  const client = signedInClient();
  const { error } = await client.auth.signInWithPassword({ email: TEST_USERS[key].email, password: TEST_PASSWORD });
  if (error) throw new Error(`${key} 로그인 실패: ${error.message}`);
  return client;
}

const RUN_ID = Date.now();
const CLEANUP_TEST_EMAIL = `phase12-cleanup-test-${RUN_ID}@test.linkmom.dev`;
const MAIN_TEST_EMAIL = `phase12-user-test-${RUN_ID}@test.linkmom.dev`;

async function findStoreId(code: string): Promise<string> {
  const { data, error } = await service.from("stores").select("id").eq("code", code).single();
  if (error || !data) throw new Error(`store ${code}를 찾지 못했습니다: ${error?.message}`);
  return data.id;
}

async function deleteAuthUserQuietly(userId: string | null) {
  if (!userId) return;
  await service.auth.admin.deleteUser(userId).catch(() => {});
}

async function main() {
  const hqStoreId = await findStoreId(STORES[0].code); // HQ
  const dongbaekStoreId = await findStoreId(STORES[1].code); // DONGBAEK

  const admin = await signIn("admin");
  const manager = await signIn("manager");
  const staffHq = await signIn("staffHq");

  let cleanupTestUserId: string | null = null;
  let mainTestUserId: string | null = null;
  let mainTestClient: ReturnType<typeof signedInClient> | null = null;

  try {
    // =====================================================================
    // A) 계정 생성 실패 시 cleanup — src/lib/admin/users.ts의 createStaffAccount가
    //    의존하는 Supabase 기본기를 직접 재현해 검증한다(§8/§24).
    // =====================================================================
    {
      const { data: created, error: createError } = await service.auth.admin.createUser({
        email: CLEANUP_TEST_EMAIL,
        password: initialPassword!,
        email_confirm: true,
        user_metadata: { name: "Phase12 Cleanup Test" },
      });
      record("A1. disposable auth user 생성 성공", !createError && !!created.user, createError?.message);
      cleanupTestUserId = created?.user?.id ?? null;

      if (cleanupTestUserId) {
        const { data: profileAfterTrigger } = await service
          .from("profiles")
          .select("role")
          .eq("id", cleanupTestUserId)
          .single();
        record(
          "A2. handle_new_user() 트리거가 role='STAFF'로 profile을 자동 생성함",
          profileAfterTrigger?.role === "STAFF",
          `role=${profileAfterTrigger?.role}`,
        );

        // 잘못된 store_id(존재하지 않는 UUID)로 배정 시도 — FK 위반으로 실패해야 한다.
        const { error: badStoreError } = await service
          .from("user_store_access")
          .insert({ user_id: cleanupTestUserId, store_id: randomUUID() });
        record("A3. 존재하지 않는 store_id로 user_store_access INSERT 시도는 실패함(FK)", !!badStoreError, badStoreError?.message);

        // createStaffAccount와 동일하게: 이번 요청으로 만든 이 user만 삭제한다.
        await service.auth.admin.deleteUser(cleanupTestUserId);

        const { data: profileAfterDelete } = await service
          .from("profiles")
          .select("id")
          .eq("id", cleanupTestUserId)
          .maybeSingle();
        record("A4. auth user 삭제 시 profiles row도 cascade로 함께 삭제됨", !profileAfterDelete);

        const { data: accessAfterDelete } = await service
          .from("user_store_access")
          .select("id")
          .eq("user_id", cleanupTestUserId);
        record(
          "A4. auth user 삭제 시 user_store_access에도 고아 행이 남지 않음",
          (accessAfterDelete ?? []).length === 0,
          `rows=${accessAfterDelete?.length}`,
        );
        cleanupTestUserId = null; // 이미 삭제됨 — finally에서 재시도할 필요 없음
      }
    }

    {
      // A5) 중복 이메일 — 같은 이메일로 두 번째 계정 생성 시도는 거부되어야 한다.
      const { data: first, error: firstError } = await service.auth.admin.createUser({
        email: MAIN_TEST_EMAIL,
        password: initialPassword!,
        email_confirm: true,
        user_metadata: { name: "Phase12 E2E Test Staff" },
      });
      record("A5-setup. 메인 테스트 계정 생성 성공", !firstError && !!first.user, firstError?.message);
      mainTestUserId = first?.user?.id ?? null;

      const { error: dupError } = await service.auth.admin.createUser({
        email: MAIN_TEST_EMAIL,
        password: initialPassword!,
        email_confirm: true,
      });
      record("A5. 동일 이메일로 재생성 시도는 거부됨", !!dupError, dupError?.message ?? "에러 없음(문제)");
    }

    if (!mainTestUserId) throw new Error("메인 테스트 계정 생성에 실패해 이후 테스트를 진행할 수 없습니다.");

    // 나머지 계정 생성 흐름 완료(정상 경로): name/role/store 지정.
    {
      const { error } = await service
        .from("profiles")
        .update({ name: "Phase12 E2E Test Staff", role: "STAFF" })
        .eq("id", mainTestUserId);
      if (error) throw error;
      const { error: accessError } = await service
        .from("user_store_access")
        .insert({ user_id: mainTestUserId, store_id: hqStoreId });
      if (accessError) throw accessError;
    }

    // =====================================================================
    // B) 비ADMIN은 타인의 계정을 관리할 수 없다(RLS 레벨, §21) — STAFF/STORE_MANAGER 둘 다.
    // =====================================================================
    {
      const { data: roleUpdateResult, error: roleUpdateError } = await staffHq
        .from("profiles")
        .update({ role: "ADMIN" })
        .eq("id", mainTestUserId)
        .select();
      record(
        "B1. STAFF — 타인(disposable test user)의 role을 ADMIN으로 UPDATE 시도는 0건",
        !roleUpdateError && (roleUpdateResult ?? []).length === 0,
        `affected=${roleUpdateResult?.length}, error=${roleUpdateError?.message ?? "none"}`,
      );

      const { data: activeUpdateResult, error: activeUpdateError } = await staffHq
        .from("profiles")
        .update({ is_active: false })
        .eq("id", mainTestUserId)
        .select();
      record(
        "B2. STAFF — 타인의 is_active를 UPDATE 시도는 0건",
        !activeUpdateError && (activeUpdateResult ?? []).length === 0,
        `affected=${activeUpdateResult?.length}`,
      );

      const { error: storeInsertError } = await staffHq
        .from("user_store_access")
        .insert({ user_id: mainTestUserId, store_id: dongbaekStoreId });
      record("B3. STAFF — 타인을 다른 매장에 배정(INSERT)하는 시도는 거부됨", !!storeInsertError, storeInsertError?.message);

      const { data: deleteResult, error: deleteError } = await staffHq
        .from("user_store_access")
        .delete()
        .eq("user_id", mainTestUserId)
        .select();
      record(
        "B4. STAFF — 타인의 user_store_access DELETE 시도는 0건",
        !deleteError && (deleteResult ?? []).length === 0,
        `affected=${deleteResult?.length}`,
      );

      const { data: managerRoleUpdate, error: managerRoleError } = await manager
        .from("profiles")
        .update({ role: "ADMIN" })
        .eq("id", mainTestUserId)
        .select();
      record(
        "B5. STORE_MANAGER — 타인의 role을 UPDATE 시도도 동일하게 0건(직원 관리 권한 없음, §21)",
        !managerRoleError && (managerRoleUpdate ?? []).length === 0,
        `affected=${managerRoleUpdate?.length}`,
      );

      const { data: dbCheck } = await service.from("profiles").select("role, is_active").eq("id", mainTestUserId).single();
      record(
        "B6. 실제 DB 값은 위 시도들과 무관하게 role=STAFF, is_active=true 그대로 유지됨",
        dbCheck?.role === "STAFF" && dbCheck?.is_active === true,
        `role=${dbCheck?.role}, is_active=${dbCheck?.is_active}`,
      );
    }

    // =====================================================================
    // C) ADMIN 세션으로 활성/비활성/재활성화 + Role/Store 변경 라운드트립(§9의 "ADMIN
    //    세션 + 기존 RLS" 원칙 그대로 — updateUserAction/toggleActiveAction과 동일 경로).
    // =====================================================================
    {
      const { data: deactivated, error: deactivateError } = await admin
        .from("profiles")
        .update({ is_active: false })
        .eq("id", mainTestUserId)
        .select();
      record("C1. ADMIN — 비활성화(is_active=false) 성공", !deactivateError && (deactivated ?? []).length === 1);

      const { data: reactivated, error: reactivateError } = await admin
        .from("profiles")
        .update({ is_active: true })
        .eq("id", mainTestUserId)
        .select();
      record("C2. ADMIN — 재활성화(is_active=true) 성공", !reactivateError && (reactivated ?? []).length === 1);

      const { error: roleUpdateError } = await admin
        .from("profiles")
        .update({ role: "STORE_MANAGER" })
        .eq("id", mainTestUserId);
      const { error: accessDeleteError } = await admin.from("user_store_access").delete().eq("user_id", mainTestUserId);
      const { error: accessInsertError } = await admin
        .from("user_store_access")
        .insert({ user_id: mainTestUserId, store_id: dongbaekStoreId });
      record(
        "C3. ADMIN — Role(STAFF→STORE_MANAGER)/Store(HQ→DONGBAEK) 변경 성공",
        !roleUpdateError && !accessDeleteError && !accessInsertError,
        `${roleUpdateError?.message ?? ""}${accessDeleteError?.message ?? ""}${accessInsertError?.message ?? ""}`,
      );

      const { data: dbCheck } = await service
        .from("profiles")
        .select("role, is_active")
        .eq("id", mainTestUserId)
        .single();
      const { data: accessCheck } = await service
        .from("user_store_access")
        .select("store_id")
        .eq("user_id", mainTestUserId);
      record(
        "C4. 실제 DB에 role=STORE_MANAGER, is_active=true, Store=DONGBAEK 1건만 반영됨",
        dbCheck?.role === "STORE_MANAGER" &&
          dbCheck?.is_active === true &&
          (accessCheck ?? []).length === 1 &&
          accessCheck?.[0]?.store_id === dongbaekStoreId,
        `role=${dbCheck?.role}, access=${JSON.stringify(accessCheck)}`,
      );

      // 이후 섹션(D/E)이 기대하는 상태로 되돌린다: STAFF / HQ / 활성.
      await service.from("profiles").update({ role: "STAFF" }).eq("id", mainTestUserId);
      await service.from("user_store_access").delete().eq("user_id", mainTestUserId);
      await service.from("user_store_access").insert({ user_id: mainTestUserId, store_id: hqStoreId });
    }

    // =====================================================================
    // F) 본인 비밀번호 변경이 의존하는 Supabase Auth 기본기(§19) — 재인증 성공/실패,
    //    변경 후 새 비밀번호로만 로그인 가능.
    // =====================================================================
    {
      mainTestClient = signedInClient();
      const { error: wrongPwError } = await mainTestClient.auth.signInWithPassword({
        email: MAIN_TEST_EMAIL,
        password: "완전히-틀린-비밀번호-999",
      });
      record("F1. 잘못된 현재 비밀번호로 재인증 시도는 실패함", !!wrongPwError, wrongPwError?.message);

      const { error: rightPwError } = await mainTestClient.auth.signInWithPassword({
        email: MAIN_TEST_EMAIL,
        password: initialPassword!,
      });
      record("F2. 올바른 현재 비밀번호(초기 비밀번호)로 재인증 성공", !rightPwError, rightPwError?.message);

      const NEW_PASSWORD = "Phase12-New-Pw-9!";
      const { error: updateError } = await mainTestClient.auth.updateUser({ password: NEW_PASSWORD });
      record("F3. 비밀번호 변경(updateUser) 성공", !updateError, updateError?.message);

      const oldPwClient = signedInClient();
      const { error: oldStillWorksError } = await oldPwClient.auth.signInWithPassword({
        email: MAIN_TEST_EMAIL,
        password: initialPassword!,
      });
      record("F4. 변경 후 기존 초기 비밀번호로는 로그인 실패함", !!oldStillWorksError, oldStillWorksError?.message);

      const newPwClient = signedInClient();
      const { error: newPwError } = await newPwClient.auth.signInWithPassword({
        email: MAIN_TEST_EMAIL,
        password: NEW_PASSWORD,
      });
      record("F5. 변경 후 새 비밀번호로 로그인 성공", !newPwError, newPwError?.message);
      await newPwClient.auth.signOut();
      await oldPwClient.auth.signOut();

      // 이후 섹션(D)과 §17(ADMIN 초기 비밀번호 재설정)을 위해 다시 로그인해둔다
      // (mainTestClient는 이제 NEW_PASSWORD 세션을 들고 있다 — 세션 자체는 그대로 유효).
    }

    // =====================================================================
    // D) 비활성 계정: 대부분의 테이블은 즉시 봉쇄, 단 본인 profile 행은 예외
    //    (Handoff §10에 문서화된 기존 gap — Phase 12에서 로그인 차단/강제 로그아웃으로
    //    보완했지만 RLS 자체의 이 특성은 유지된다. Browser E2E로 실제 강제 로그아웃을 검증).
    // =====================================================================
    {
      if (!mainTestClient) throw new Error("F 섹션에서 mainTestClient가 생성되지 않았습니다.");
      const activeSessionClient = mainTestClient;

      const { data: storesWhileActive } = await activeSessionClient.from("stores").select("id");
      record("D1. 활성 상태 — 본인 세션으로 stores 조회 가능", (storesWhileActive ?? []).length > 0, `rows=${storesWhileActive?.length}`);

      await service.from("profiles").update({ is_active: false }).eq("id", mainTestUserId);

      const { data: storesWhileInactive, error: storesError } = await activeSessionClient.from("stores").select("id");
      record(
        "D2. 비활성화 후 — 동일 세션(재로그인 없음)으로 stores 조회 시 0건(RLS is_active_user() 차단)",
        !storesError && (storesWhileInactive ?? []).length === 0,
        `rows=${storesWhileInactive?.length}`,
      );

      const { data: selfProfile } = await activeSessionClient.from("profiles").select("id").eq("id", mainTestUserId).maybeSingle();
      note(
        "D3. 비활성화 후에도 본인 profiles 행 자체는 여전히 조회됨(profiles_select_self_or_admin은 is_active를 안 봄, " +
          `기존 확인된 gap, Handoff §10) — selfProfile=${JSON.stringify(selfProfile)}. RLS만으로는 완전히 봉쇄되지 않으므로 ` +
          "Phase 12가 로그인 차단(§13)/기존 세션 강제 로그아웃(§14)을 앱 레벨에서 별도로 구현한 이유가 바로 이것이다.",
      );

      await service.from("profiles").update({ is_active: true }).eq("id", mainTestUserId);
    }

    // =====================================================================
    // E) Push 대상 제외(§16) — src/lib/push/targeting.ts는 "server-only"라 이 스크립트가
    //    직접 import할 수 없으므로(Phase 11 교훈과 동일한 제약), 동일한 쿼리를 그대로
    //    재현해 실제 DB 동작을 검증한다.
    // =====================================================================
    {
      await service.from("profiles").update({ is_active: false }).eq("id", mainTestUserId);

      const { data: allTargets } = await service.from("profiles").select("id").eq("is_active", true);
      record(
        "E1. 전체 대상('all') 쿼리 — 비활성 사용자는 제외됨",
        !(allTargets ?? []).some((u) => u.id === mainTestUserId),
      );

      const { data: roleTargets } = await service.from("profiles").select("id").eq("is_active", true).in("role", ["STAFF"]);
      record(
        "E2. Role 대상('STAFF') 쿼리 — 비활성 사용자는 제외됨",
        !(roleTargets ?? []).some((u) => u.id === mainTestUserId),
      );

      const { data: accessRows } = await service.from("user_store_access").select("user_id").eq("store_id", hqStoreId);
      const candidateIds = [...new Set((accessRows ?? []).map((a) => a.user_id))];
      const { data: activeAtStore } = await service.from("profiles").select("id").eq("is_active", true).in("id", candidateIds);
      record(
        "E3. 매장 대상(HQ) 쿼리 — user_store_access 행은 남아있어도 비활성 사용자는 최종 대상에서 제외됨",
        candidateIds.includes(mainTestUserId) && !(activeAtStore ?? []).some((u) => u.id === mainTestUserId),
        `candidateIncludesUser=${candidateIds.includes(mainTestUserId)}`,
      );

      note(
        "E4. src/lib/push/targeting.ts의 개인 지정('user' target) 분기는 is_active 필터가 없다(코드 확인, " +
          "resolveTargetUserIds의 `if (t.targetType === \"user\" && t.userId) userIds.add(t.userId)` — 무조건 추가). " +
          "즉 특정 개인을 콕 집어 지정한 공지/알림은 그 사람이 비활성화돼도 대상에 남을 수 있다. " +
          "지시사항(§16)에 따라 Push Architecture는 이번 Phase에서 변경하지 않았다 — Phase 13 Security Review로 넘긴다.",
      );

      await service.from("profiles").update({ is_active: true }).eq("id", mainTestUserId);
    }
  } finally {
    await deleteAuthUserQuietly(cleanupTestUserId);
    await deleteAuthUserQuietly(mainTestUserId);
    await mainTestClient?.auth.signOut().catch(() => {});
    await admin.auth.signOut();
    await manager.auth.signOut();
    await staffHq.auth.signOut();
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
