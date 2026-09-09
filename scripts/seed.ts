/**
 * DEV Supabase 프로젝트에 Phase 5 테스트 데이터를 생성한다.
 * Secret Key로 실행하며(RLS 우회), 운영 데이터/운영 Google Sheet와는
 * 완전히 무관하다.
 *
 * 실행: npm run db:seed   (.env.local에 NEXT_PUBLIC_SUPABASE_URL /
 *                            SUPABASE_SECRET_KEY가 있어야 한다)
 */
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/types/database";

import { STORES, TEST_NOTICES, TEST_PASSWORD, TEST_USERS, type TestUserKey } from "./fixtures";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !secretKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY가 .env.local에 필요합니다.");
  process.exit(1);
}

const admin = createClient<Database>(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function upsertStores() {
  const storeIdByCode = new Map<string, string>();
  for (const store of STORES) {
    const { data: existing } = await admin
      .from("stores")
      .select("id")
      .eq("code", store.code)
      .maybeSingle();

    if (existing) {
      storeIdByCode.set(store.code, existing.id as string);
      continue;
    }

    const { data, error } = await admin
      .from("stores")
      .insert({ code: store.code, name: store.name })
      .select("id")
      .single();
    if (error) throw error;
    storeIdByCode.set(store.code, data.id as string);
    console.log(`+ store ${store.name} (${store.code})`);
  }
  return storeIdByCode;
}

async function upsertUser(key: TestUserKey) {
  const def = TEST_USERS[key];

  const { data: page, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listError) throw listError;
  const existing = page.users.find((u) => u.email === def.email);

  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: def.email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { name: def.name },
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`+ auth user ${def.email}`);
  }

  // handle_new_user 트리거가 role='STAFF'로 profile을 만든다.
  // 여기서 Service Role로 실제 role을 맞춰준다 (profiles_before_update 트리거는
  // auth.uid()가 없는 Service Role 호출을 막지 않는다 — migration 20260909120000 참조).
  const { error: updateError } = await admin
    .from("profiles")
    .update({ name: def.name, role: def.role, is_active: true })
    .eq("id", userId);
  if (updateError) throw updateError;

  return userId;
}

async function upsertStoreAccess(userId: string, storeIds: string[]) {
  for (const storeId of storeIds) {
    const { data: existing } = await admin
      .from("user_store_access")
      .select("id")
      .eq("user_id", userId)
      .eq("store_id", storeId)
      .maybeSingle();
    if (existing) continue;

    const { error } = await admin.from("user_store_access").insert({ user_id: userId, store_id: storeId });
    if (error) throw error;
  }
}

async function seedNotices(userIdByKey: Record<TestUserKey, string>, storeIdByCode: Map<string, string>) {
  const adminUserId = userIdByKey.admin;

  for (const notice of TEST_NOTICES) {
    const { data: existing } = await admin
      .from("notices")
      .select("id")
      .eq("title", notice.title)
      .maybeSingle();
    if (existing) continue;

    const { data: created, error } = await admin
      .from("notices")
      .insert({
        title: notice.title,
        body: `Phase 5 RLS 검증용 테스트 공지입니다 (target: ${JSON.stringify(notice.target)}).`,
        notice_type: "일반",
        author_id: adminUserId,
      })
      .select("id")
      .single();
    if (error) throw error;

    const target = notice.target;
    const targetRow: Database["public"]["Tables"]["notice_targets"]["Insert"] = {
      notice_id: created.id,
      target_type: target.type,
      store_id: target.type === "store" ? storeIdByCode.get(target.storeCode) : null,
      role: target.type === "role" ? target.role : null,
      user_id: target.type === "user" ? userIdByKey[target.userKey] : null,
    };

    const { error: targetError } = await admin.from("notice_targets").insert(targetRow);
    if (targetError) throw targetError;
    console.log(`+ notice ${notice.title}`);
  }
}

async function main() {
  console.log("Seeding DEV Supabase project:", url);

  const storeIdByCode = await upsertStores();

  const userIdByKey = {} as Record<TestUserKey, string>;
  for (const key of Object.keys(TEST_USERS) as TestUserKey[]) {
    userIdByKey[key] = await upsertUser(key);
  }

  for (const key of Object.keys(TEST_USERS) as TestUserKey[]) {
    const def = TEST_USERS[key];
    const storeIds = def.storeCodes.map((code) => storeIdByCode.get(code)!).filter(Boolean);
    await upsertStoreAccess(userIdByKey[key], storeIds);
  }

  await seedNotices(userIdByKey, storeIdByCode);

  console.log("\nSeed 완료. 테스트 계정 (비밀번호 공통):", TEST_PASSWORD);
  for (const key of Object.keys(TEST_USERS) as TestUserKey[]) {
    console.log(`  - ${TEST_USERS[key].role.padEnd(14)} ${TEST_USERS[key].email}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
