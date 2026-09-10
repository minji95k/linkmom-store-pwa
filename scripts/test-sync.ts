/**
 * Phase 6 Sync 파이프라인 End-to-End 테스트.
 *
 * 아직 실제 Google Sheet/Apps Script가 연결되지 않았으므로, Apps Script가 보낼
 * 것과 동일한 형태의 JSON payload를 직접 만들어 로컬 Next.js dev server의
 * /api/sync/permanent, /api/sync/event 를 호출한다 — Sheet 앞단(Apps Script)만
 * 빠져 있을 뿐, Next.js API → Supabase 구간은 실제 파이프라인 그대로 검증한다.
 * 데이터는 docs/current-system-analysis.md에서 실측한 실제 상품 값을 그대로 쓴다.
 *
 * 사전 조건: npm run dev (localhost:3000)가 실행 중이어야 한다.
 * 실행: npm run test:sync
 */
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/types/database";

const API_BASE = process.env.SYNC_TEST_BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.SYNC_API_SECRET;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SECRET || !SUPABASE_URL || !SECRET_KEY) {
  console.error("SYNC_API_SECRET / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY가 .env.local에 필요합니다.");
  process.exit(1);
}

const db = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

interface SyncRowInput {
  rowNumber: number;
  values: Record<string, string | number | null>;
}

async function callSync(sheet: "permanent" | "event", headers: string[], rows: SyncRowInput[]) {
  const res = await fetch(`${API_BASE}/api/sync/${sheet}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ headers, rows }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

const PERMANENT_HEADERS = [
  "행사 기간",
  "브랜드",
  "제품명",
  "컬러",
  "공지유형",
  "소비자가",
  "기준 판매가",
  "최종 판매가 (카드결제)",
  "최종판매가 (현금or계좌이체)",
  "매장 별 운영",
  "기본 구성품",
  "증정사은품",
  "포토후기",
  "매장프로모션",
  "비고",
  "product_id",
];

const EVENT_HEADERS = [
  "행사 기간",
  "브랜드",
  "제품명",
  "컬러",
  "공지유형",
  "소비자가",
  "기준 판매가",
  "최종 판매가 (카드결제)",
  "최종판매가 (현금or계좌이체)",
  "매장 별 운영",
  "행사 사은품",
  "매장 프로모션",
  "비고",
  "product_id",
  "행사명",
  "행사 시작일",
  "행사 종료일",
  "노출여부",
];

function bella(productId: string | null) {
  return {
    "행사 기간": "상시",
    브랜드: "리안",
    제품명: "벨라 휴대용 유모차",
    컬러: "코튼 베이지, 클래식 토프",
    공지유형: null,
    소비자가: 478000,
    "기준 판매가": 398000,
    "최종 판매가 (카드결제)": 368000,
    "최종판매가 (현금or계좌이체)": 349600,
    "매장 별 운영": "모두 운영",
    "기본 구성품": "캐링백, 컵홀더",
    증정사은품: "방풍커버(S)",
    포토후기: "Npay 5천원",
    매장프로모션: "가능",
    비고: null,
    product_id: productId,
  };
}

function flick(productId: string | null, cardPrice: number, remarks: string | null) {
  return {
    "행사 기간": "상시",
    브랜드: "리안",
    제품명: "플릭 절충형 유모차",
    컬러: "클래식 토프, 시크 블랙",
    공지유형: null,
    소비자가: 628000,
    "기준 판매가": 628000,
    "최종 판매가 (카드결제)": cardPrice,
    "최종판매가 (현금or계좌이체)": 568100,
    "매장 별 운영": "모두 운영",
    "기본 구성품": "-",
    증정사은품: "방풍커버(L)",
    포토후기: "Npay 1만원",
    매장프로모션: "가능",
    비고: remarks,
    product_id: productId,
  };
}

function kidfix(productId: string | null, gift: string) {
  return {
    "행사 기간": "상시",
    브랜드: "브라이텍스",
    제품명: "키드픽스 M I-Size",
    컬러: "블랙, 미드나잇그레이",
    공지유형: null,
    소비자가: 480000,
    "기준 판매가": 330000,
    "최종 판매가 (카드결제)": 313500,
    "최종판매가 (현금or계좌이체)": 313500,
    "매장 별 운영": "동백 불가",
    "기본 구성품": null,
    증정사은품: gift,
    포토후기: null,
    매장프로모션: "기준 판매가의 5%",
    비고: null,
    product_id: productId,
  };
}

async function getPromotion(productId: string) {
  const { data } = await db.from("promotions").select("*").eq("product_id", productId).single();
  return data;
}

async function getChangeLogs(productId: string) {
  const { data } = await db
    .from("promotion_change_logs")
    .select("*")
    .eq("product_id", productId)
    .order("changed_at", { ascending: false });
  return data ?? [];
}

async function main() {
  console.log("=== Permanent sheet ===\n");

  // 1) 초기 Import (§13) --------------------------------------------------------
  const r1 = await callSync("permanent", PERMANENT_HEADERS, [
    { rowNumber: 2, values: bella(null) },
    { rowNumber: 3, values: flick(null, 598000, null) },
    { rowNumber: 4, values: kidfix(null, "쿨시트, 발받침대") },
  ]);
  record(
    "1. 초기 Import — 3건 모두 신규 INSERT, product_id 3개 채번",
    r1.status === 200 && r1.body.insertedCount === 3 && r1.body.productIdAssignments.length === 3,
    JSON.stringify(r1.body),
  );

  const [bellaId, flickId, kidfixId] = r1.body.productIdAssignments.map(
    (a: { productId: string }) => a.productId,
  );

  const flickAfterInsert = await getPromotion(flickId);
  record(
    "1. INSERT된 상품의 last_important_change_at이 설정됨(신규상품=NEW 대상)",
    !!flickAfterInsert?.last_important_change_at,
  );

  // 2) 동일 데이터 재동기화 — 변경 없음 확인 (idempotency) --------------------------
  const r2 = await callSync("permanent", PERMANENT_HEADERS, [
    { rowNumber: 2, values: bella(bellaId) },
    { rowNumber: 3, values: flick(flickId, 598000, null) },
    { rowNumber: 4, values: kidfix(kidfixId, "쿨시트, 발받침대") },
  ]);
  record(
    "2. 동일 값으로 재동기화 — updatedCount 0 (가짜 변경 없음)",
    r2.status === 200 && r2.body.updatedCount === 0 && r2.body.insertedCount === 0,
    JSON.stringify(r2.body),
  );

  // 3) 가격 변경 (important) ------------------------------------------------------
  const flickBefore = await getPromotion(flickId);
  const r3 = await callSync("permanent", PERMANENT_HEADERS, [
    { rowNumber: 2, values: bella(bellaId) },
    { rowNumber: 3, values: flick(flickId, 568000, null) }, // 598,000 -> 568,000
    { rowNumber: 4, values: kidfix(kidfixId, "쿨시트, 발받침대") },
  ]);
  const flickAfterPriceChange = await getPromotion(flickId);
  const priceLogs = await getChangeLogs(flickId);
  record(
    "3. 가격 변경 — updatedCount 1",
    r3.status === 200 && r3.body.updatedCount === 1,
    JSON.stringify(r3.body),
  );
  record(
    "3. promotions.final_price_card 실제로 568000으로 반영",
    flickAfterPriceChange?.final_price_card === 568000,
  );
  record(
    "3. promotion_change_logs에 price/important 기록, before=598000 after=568000",
    priceLogs.some(
      (l) =>
        l.changed_field === "final_price_card" &&
        l.change_type === "price" &&
        l.importance === "important" &&
        l.before_value === 598000 &&
        l.after_value === 568000,
    ),
    JSON.stringify(priceLogs.map((l) => ({ f: l.changed_field, b: l.before_value, a: l.after_value }))),
  );
  record(
    "3. last_important_change_at 갱신됨(가격은 important)",
    !!flickAfterPriceChange?.last_important_change_at &&
      flickAfterPriceChange.last_important_change_at !== flickBefore?.last_important_change_at,
  );

  // 4) 사은품 변경 (important) -----------------------------------------------------
  const r4 = await callSync("permanent", PERMANENT_HEADERS, [
    { rowNumber: 2, values: bella(bellaId) },
    { rowNumber: 3, values: flick(flickId, 568000, null) },
    { rowNumber: 4, values: kidfix(kidfixId, "쿨시트, 발받침대, 방풍커버(L)") },
  ]);
  const kidfixLogs = await getChangeLogs(kidfixId);
  record(
    "4. 사은품 변경 — gift/important 기록",
    r4.body.updatedCount === 1 &&
      kidfixLogs.some((l) => l.changed_field === "gift" && l.importance === "important"),
    JSON.stringify(r4.body),
  );

  // 5) Minor 변경(비고) — NEW/Push 판정에서 제외되는지 확인 (§41) --------------------
  const flickBeforeMinor = await getPromotion(flickId);
  const r5 = await callSync("permanent", PERMANENT_HEADERS, [
    { rowNumber: 2, values: bella(bellaId) },
    { rowNumber: 3, values: flick(flickId, 568000, "매장 진열용 1대 별도 보관") }, // 비고만 변경
    { rowNumber: 4, values: kidfix(kidfixId, "쿨시트, 발받침대, 방풍커버(L)") },
  ]);
  const flickAfterMinor = await getPromotion(flickId);
  const minorLogs = await getChangeLogs(flickId);
  record(
    "5. 비고(minor) 변경 — updatedCount 1이지만",
    r5.body.updatedCount === 1,
    JSON.stringify(r5.body),
  );
  record(
    "5. change_log importance=minor로 기록됨",
    minorLogs.some((l) => l.changed_field === "remarks" && l.importance === "minor"),
  );
  record(
    "5. last_important_change_at은 그대로(NEW 대상 아님) — minor 수정은 NEW/Push 제외(§41)",
    flickAfterMinor?.last_important_change_at === flickBeforeMinor?.last_important_change_at,
  );

  // 6) 잘못된 가격값 — Validation Error, 기존 값 유지 -------------------------------
  const flickBeforeInvalid = await getPromotion(flickId);
  const r6 = await callSync("permanent", PERMANENT_HEADERS, [
    { rowNumber: 2, values: bella(bellaId) },
    { rowNumber: 3, values: { ...flick(flickId, 568000, null), "최종 판매가 (카드결제)": "가격미정" as unknown as number } },
    { rowNumber: 4, values: kidfix(kidfixId, "쿨시트, 발받침대, 방풍커버(L)") },
  ]);
  const flickAfterInvalid = await getPromotion(flickId);
  record(
    "6. 잘못된 가격값 — failedCount >= 1로 기록",
    r6.body.failedCount >= 1,
    JSON.stringify(r6.body.errors),
  );
  record(
    "6. 잘못된 가격이어도 기존 final_price_card(568000) 값은 그대로 유지됨(덮어쓰지 않음)",
    flickAfterInvalid?.final_price_card === flickBeforeInvalid?.final_price_card,
  );

  // 7) 중복 product_id (같은 배치 내) ------------------------------------------------
  const r7 = await callSync("permanent", PERMANENT_HEADERS, [
    { rowNumber: 2, values: bella(bellaId) },
    { rowNumber: 3, values: flick(flickId, 568000, null) },
    { rowNumber: 4, values: kidfix(kidfixId, "쿨시트, 발받침대, 방풍커버(L)") },
    { rowNumber: 5, values: { ...bella(bellaId), 제품명: "벨라 휴대용 유모차(중복행)" } },
  ]);
  record(
    "7. 같은 배치 내 중복 product_id — Error로 처리되고 나머지는 계속 진행",
    r7.status === 200 && r7.body.failedCount >= 1 && r7.body.errors.some((e: { message: string }) => e.message.includes("중복")),
    JSON.stringify(r7.body.errors),
  );

  // 8) 신규 Dynamic Column ---------------------------------------------------------
  const dynamicHeader = "택배배송 여부";
  const r8 = await callSync("permanent", [...PERMANENT_HEADERS, dynamicHeader], [
    { rowNumber: 2, values: { ...bella(bellaId), [dynamicHeader]: "가능" } },
    { rowNumber: 3, values: { ...flick(flickId, 568000, null), [dynamicHeader]: "불가" } },
    { rowNumber: 4, values: kidfix(kidfixId, "쿨시트, 발받침대, 방풍커버(L)") },
  ]);
  const { data: newFieldDef } = await db
    .from("promotion_field_definitions")
    .select("*")
    .eq("source_sheet", "permanent")
    .eq("source_column_name", dynamicHeader)
    .maybeSingle();
  const bellaAfterDynamic = await getPromotion(bellaId);
  record("8. Dynamic Column Sync 자체는 성공", r8.status === 200, JSON.stringify(r8.body));
  record(
    "8. promotion_field_definitions에 신규 필드 자동 등록 (표시ON/검색OFF/필터OFF/NEW·Push OFF, text)",
    !!newFieldDef &&
      newFieldDef.is_visible === true &&
      newFieldDef.is_searchable === false &&
      newFieldDef.is_filterable === false &&
      newFieldDef.change_importance === "minor" &&
      newFieldDef.push_enabled === false &&
      newFieldDef.data_type === "text",
    JSON.stringify(newFieldDef),
  );
  record(
    "8. 재배포 없이 promotions.extra_fields에 실제 값이 저장됨",
    (bellaAfterDynamic?.extra_fields as Record<string, string>)?.[newFieldDef?.field_key ?? ""] === "가능",
    JSON.stringify(bellaAfterDynamic?.extra_fields),
  );

  // 9) Soft Delete (배치에서 사라진 상품) --------------------------------------------
  const r9 = await callSync("permanent", PERMANENT_HEADERS, [{ rowNumber: 2, values: bella(bellaId) }]);
  const flickAfterRemoval = await getPromotion(flickId);
  const kidfixAfterRemoval = await getPromotion(kidfixId);
  record(
    "9. 배치에서 빠진 상품 2건 — Soft Delete(is_active=false), deactivatedCount=2",
    r9.body.deactivatedCount === 2 && flickAfterRemoval?.is_active === false && kidfixAfterRemoval?.is_active === false,
    JSON.stringify(r9.body),
  );
  record("9. 삭제가 아니라 Row는 그대로 남아있음(Soft Delete)", !!flickAfterRemoval && !!kidfixAfterRemoval);

  // 복구 — 이후 event 테스트에 영향 없도록 원복
  await callSync("permanent", PERMANENT_HEADERS, [
    { rowNumber: 2, values: bella(bellaId) },
    { rowNumber: 3, values: flick(flickId, 568000, null) },
    { rowNumber: 4, values: kidfix(kidfixId, "쿨시트, 발받침대, 방풍커버(L)") },
  ]);

  console.log("\n=== Event sheet ===\n");

  const now = Date.now();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const yesterday = fmt(new Date(now - 24 * 3600 * 1000));
  const nextWeek = fmt(new Date(now + 7 * 24 * 3600 * 1000));
  const lastWeek = fmt(new Date(now - 14 * 24 * 3600 * 1000));

  function mimaJarimax(productId: string | null, visible: string, start: string, end: string) {
    return {
      "행사 기간": "8/13~8/26",
      브랜드: "미마",
      제품명: "자리맥스 디럭스 유모차",
      컬러: "샴페인프레임, 블랙프레임",
      공지유형: "링크맘 행사",
      소비자가: 2490000,
      "기준 판매가": null,
      "최종 판매가 (카드결제)": 599000,
      "최종판매가 (현금or계좌이체)": 599000,
      "매장 별 운영": "모두 운영",
      "행사 사은품": "링크맘 단독 사은품 미마 자리맥스 방충망 증정",
      "매장 프로모션": "불가",
      비고: "방충망 한정수량 20ea",
      product_id: productId,
      행사명: "링크맘 가을 유모차 페어",
      "행사 시작일": start,
      "행사 종료일": end,
      노출여부: visible,
    };
  }

  // 10) 행사 초기 Import + 노출 ON (진행중) ------------------------------------------
  const r10 = await callSync("event", EVENT_HEADERS, [
    { rowNumber: 2, values: mimaJarimax(null, "ON", yesterday, nextWeek) },
  ]);
  const [mimaId] = r10.body.productIdAssignments.map((a: { productId: string }) => a.productId);
  const { data: campaign } = await db
    .from("event_campaigns")
    .select("*")
    .eq("campaign_key", "링크맘 가을 유모차 페어")
    .single();
  record("10. 행사 상품 초기 Import 성공", r10.status === 200 && r10.body.insertedCount === 1, JSON.stringify(r10.body));
  record(
    "10. event_campaigns 생성, is_visible=true (ON + 기간 내)",
    !!campaign && campaign.is_visible === true,
    JSON.stringify(campaign),
  );
  const { data: link } = await db
    .from("event_campaign_products")
    .select("*")
    .eq("campaign_id", campaign!.id)
    .eq("promotion_id", (await getPromotion(mimaId))!.id)
    .maybeSingle();
  record("10. event_campaign_products 연결 생성됨", !!link);

  // ADMIN 관점 조회 함수 (Service Role은 RLS 우회하므로 View로 직접 검증)
  const { data: visibleCampaigns } = await db.from("event_campaigns_visible").select("*");
  record(
    "10. event_campaigns_visible 뷰에 포함됨(노출 로직 정상)",
    (visibleCampaigns ?? []).some((c) => c.id === campaign!.id),
  );

  // 11) 행사 OFF -------------------------------------------------------------------
  const r11 = await callSync("event", EVENT_HEADERS, [
    { rowNumber: 2, values: mimaJarimax(mimaId, "OFF", yesterday, nextWeek) },
  ]);
  const { data: campaignAfterOff } = await db.from("event_campaigns").select("*").eq("id", campaign!.id).single();
  const { data: visibleAfterOff } = await db.from("event_campaigns_visible").select("*").eq("id", campaign!.id);
  const mimaLogs = await getChangeLogs(mimaId);
  record("11. 행사 OFF 반영 — is_visible=false", r11.status === 200 && campaignAfterOff?.is_visible === false);
  record("11. OFF 상태면 event_campaigns_visible에서 제외됨", (visibleAfterOff ?? []).length === 0);
  record(
    "11. campaign_visibility 변경이 promotion_change_logs에 event_period/important로 기록",
    mimaLogs.some((l) => l.changed_field === "campaign_visibility" && l.change_type === "event_period" && l.importance === "important"),
  );
  record("11. 행사 데이터는 삭제되지 않고 그대로 보존됨(is_active 유지)", (await getPromotion(mimaId))?.is_active === true);

  // 12) 행사 ON이지만 기간 종료(자동 비노출) ------------------------------------------
  const r12 = await callSync("event", EVENT_HEADERS, [
    { rowNumber: 2, values: mimaJarimax(mimaId, "ON", lastWeek, yesterday) },
  ]);
  const { data: visibleAfterExpired } = await db.from("event_campaigns_visible").select("*").eq("id", campaign!.id);
  record(
    "12. 노출여부 ON이어도 종료일이 지났으면 자동 비노출(담당자가 OFF 깜빡해도 안전)",
    r12.status === 200 && (visibleAfterExpired ?? []).length === 0,
  );

  // 13) 행사기간 변경으로 다시 노출 ---------------------------------------------------
  const r13 = await callSync("event", EVENT_HEADERS, [
    { rowNumber: 2, values: mimaJarimax(mimaId, "ON", yesterday, nextWeek) },
  ]);
  const { data: visibleAfterExtend } = await db.from("event_campaigns_visible").select("*").eq("id", campaign!.id);
  record(
    "13. 행사기간을 다시 연장하면 자동으로 노출 재개",
    r13.status === 200 && (visibleAfterExtend ?? []).some((c) => c.id === campaign!.id),
  );

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
