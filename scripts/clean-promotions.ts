/**
 * DEV Supabase의 Promotion 관련 테이블을 깨끗이 비운다 (Dynamic Field 정의 포함,
 * Core Field 정의는 유지). Sync 테스트를 반복 실행하기 위한 헬퍼.
 *
 * ⚠️ 실제 Google Sheet에서 동기화된 데이터가 있는 상태에서 절대 실행하지 않는다
 * (실 데이터를 전부 지운다). 2026-09-10 첫 실 Sheet E2E Sync 검증 때 이 스크립트를
 * 실 데이터가 섞인 DB에서 실행할 뻔한 적이 있다 — 실행 전 반드시 대상 프로젝트가
 * 순수 테스트 전용인지 확인한다.
 *
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
  // promotion_sync_state도 함께 초기화한다 — 안 지우면 "최초 Import 완료" 기록이
  // 남아있어 다음 테스트 Sync가 실제로는 처음인데도 is_initial_import=false로
  // 잘못 판정된다(promotions Row 삭제와 무관하게 영구 보존되도록 설계했기 때문 —
  // 바로 그 특성 때문에 테스트 재실행 시에는 명시적으로 같이 지워줘야 한다).
  await admin.from("promotion_sync_state").delete().not("promotion_type", "is", null);
  console.log("promotions 관련 테이블 초기화 완료 (Core Field 정의는 유지).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
