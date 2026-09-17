/**
 * Phase 8 Notice System 수동/브라우저 검증용 DEV 테스트 공지를 생성한다.
 * Phase 5의 scripts/seed.ts(TEST_NOTICES)와는 별개다 — 저건 test:rls 자동화 테스트
 * 전용이라 손대지 않는다. 여기 공지는 전부 제목에 "[DEV Phase8]"을 붙여 실제
 * 운영 공지와 명확히 구분한다(CLAUDE.md "Mock Data는 명확히 분리한다").
 *
 * 실행 전 scripts/seed.ts(npm run db:seed)로 테스트 계정/매장이 먼저 만들어져
 * 있어야 한다(용인본점=HQ, 동백점=DONGBAEK, admin/manager/staffHq/staffDongbaek).
 *
 * 실행: npm run db:seed:notices-phase8 (idempotent — 제목으로 존재 여부 확인 후 skip)
 */
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/types/database";

import { STORES, TEST_USERS } from "./fixtures";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !secretKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY가 .env.local에 필요합니다.");
  process.exit(1);
}

const admin = createClient<Database>(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type NoticeType = Database["public"]["Tables"]["notices"]["Row"]["notice_type"];
type TargetType = Database["public"]["Tables"]["notice_targets"]["Row"]["target_type"];

interface FixtureNotice {
  title: string;
  body: string;
  notice_type: NoticeType;
  is_pinned?: boolean;
  requires_confirmation?: boolean;
  published_at?: string; // 생략 시 now()
  expires_at?: string | null;
  external_link?: string | null;
  target: { type: TargetType; storeCode?: (typeof STORES)[number]["code"]; role?: "ADMIN" };
}

const now = Date.now();
const HOUR = 60 * 60 * 1000;

const FIXTURES: FixtureNotice[] = [
  {
    title: "[DEV Phase8] 전체 일반공지",
    body: "Phase 8 검증용 일반공지입니다. 전체 매장 대상.",
    notice_type: "일반",
    target: { type: "all" },
  },
  {
    title: "[DEV Phase8] 전체 필독공지",
    body: "이 공지는 필독입니다. 상세에서 [확인 완료]를 눌러야 합니다.",
    notice_type: "필독",
    requires_confirmation: true,
    is_pinned: true,
    target: { type: "all" },
  },
  {
    title: "[DEV Phase8] 전체 긴급공지",
    body: "긴급 배지/색상 확인용 공지입니다.",
    notice_type: "긴급",
    target: { type: "all" },
  },
  {
    title: "[DEV Phase8] 용인본점 중요공지",
    body: "용인본점(HQ) 직원에게만 보여야 합니다.",
    notice_type: "중요",
    target: { type: "store", storeCode: "HQ" },
  },
  {
    title: "[DEV Phase8] 동백점 공지",
    body: "동백점(DONGBAEK) 직원에게만 보여야 합니다.",
    notice_type: "운영",
    target: { type: "store", storeCode: "DONGBAEK" },
  },
  {
    title: "[DEV Phase8] ADMIN 전용 테스트공지",
    body: "role=ADMIN 대상 공지입니다. STAFF/STORE_MANAGER에게는 보이면 안 됩니다.",
    notice_type: "시스템",
    target: { type: "role", role: "ADMIN" },
  },
  {
    title: "[DEV Phase8] 게시 예정(아직 비노출) 공지",
    body: "publish_start_at이 미래라 지금은 아무에게도 보이면 안 됩니다.",
    notice_type: "발주",
    published_at: new Date(now + 24 * HOUR).toISOString(),
    target: { type: "all" },
  },
  {
    title: "[DEV Phase8] 게시 종료(비노출) 공지",
    body: "expires_at이 과거라 지금은 아무에게도 보이면 안 됩니다(데이터는 삭제하지 않음).",
    notice_type: "판매가변경",
    published_at: new Date(now - 48 * HOUR).toISOString(),
    expires_at: new Date(now - HOUR).toISOString(),
    target: { type: "all" },
  },
  {
    title: "[DEV Phase8] 외부링크 포함 공지",
    body: "외부 링크(external_link) 표시 확인용입니다.",
    notice_type: "공급가변경",
    external_link: "https://example.com/linkmom-notice-form",
    target: { type: "all" },
  },
];

async function main() {
  console.log("Phase 8 DEV 테스트 공지 Seed 시작:", url);

  const { data: stores, error: storeError } = await admin.from("stores").select("id, code");
  if (storeError) throw storeError;
  const storeIdByCode = new Map((stores ?? []).map((s) => [s.code, s.id]));

  const { data: page, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listError) throw listError;
  const adminUser = page.users.find((u) => u.email === TEST_USERS.admin.email);
  if (!adminUser) {
    console.error("admin 테스트 계정을 찾을 수 없습니다. 먼저 `npm run db:seed`를 실행하세요.");
    process.exit(1);
  }

  let created = 0;
  for (const fixture of FIXTURES) {
    const { data: existing } = await admin.from("notices").select("id").eq("title", fixture.title).maybeSingle();
    if (existing) {
      console.log(`= ${fixture.title} (이미 존재, 건너뜀)`);
      continue;
    }

    const { data: notice, error } = await admin
      .from("notices")
      .insert({
        title: fixture.title,
        body: fixture.body,
        notice_type: fixture.notice_type,
        author_id: adminUser.id,
        is_pinned: fixture.is_pinned ?? false,
        requires_confirmation: fixture.requires_confirmation ?? false,
        published_at: fixture.published_at,
        expires_at: fixture.expires_at ?? null,
        external_link: fixture.external_link ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;

    const storeId = fixture.target.type === "store" ? storeIdByCode.get(fixture.target.storeCode!) : null;
    const { error: targetError } = await admin.from("notice_targets").insert({
      notice_id: notice.id,
      target_type: fixture.target.type,
      store_id: storeId ?? null,
      role: fixture.target.type === "role" ? (fixture.target.role ?? null) : null,
      user_id: null,
    });
    if (targetError) throw targetError;

    console.log(`+ ${fixture.title}`);
    created += 1;
  }

  console.log(`\n완료: 신규 ${created}건, 총 ${FIXTURES.length}건 정의됨.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
