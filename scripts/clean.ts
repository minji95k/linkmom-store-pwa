/**
 * Phase 5 테스트 데이터를 DEV Supabase 프로젝트에서 제거한다.
 * 실행: npm run db:seed:clean
 */
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/types/database";

import { TEST_NOTICES, TEST_USERS, type TestUserKey } from "./fixtures";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !secretKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY가 .env.local에 필요합니다.");
  process.exit(1);
}

const admin = createClient<Database>(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  for (const notice of TEST_NOTICES) {
    const { error } = await admin.from("notices").delete().eq("title", notice.title);
    if (error) throw error;
  }
  console.log("- test notices removed");

  const { data: page, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listError) throw listError;

  for (const key of Object.keys(TEST_USERS) as TestUserKey[]) {
    const def = TEST_USERS[key];
    const user = page.users.find((u) => u.email === def.email);
    if (!user) continue;
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
    console.log(`- auth user ${def.email} removed (profiles/user_store_access cascade)`);
  }

  console.log("\nClean 완료. stores 테이블(용인본점/동백점)은 남겨둡니다 — 다시 필요하면 npm run db:seed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
