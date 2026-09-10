/**
 * DEV Supabase의 Promotion 관련 테이블을 깨끗이 비운다 (Dynamic Field 정의 포함,
 * Core Field 정의는 유지). Sync 테스트를 반복 실행하기 위한 헬퍼.
 * 실행: npm run db:clean:promotions
 */
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/types/database";

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
  await admin.from("event_campaign_products").delete().not("id", "is", null);
  await admin.from("promotion_change_logs").delete().not("id", "is", null);
  await admin.from("event_campaigns").delete().not("id", "is", null);
  await admin.from("promotions").delete().not("id", "is", null);
  await admin.from("promotion_field_definitions").delete().eq("is_core", false);
  await admin.from("sync_logs").delete().not("id", "is", null);
  console.log("promotions 관련 테이블 초기화 완료 (Core Field 정의는 유지).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
