/**
 * 공지 게시/만료 시각 KST↔UTC 변환(src/lib/notices/datetime.ts)의 순수 함수 단위 테스트.
 *
 * 2026-09-22 Production에서 실제로 재현된 버그의 회귀 테스트다: Admin이 datetime-local에
 * 입력한 KST 시각이 서버(Vercel, UTC)에서 잘못 해석돼 9시간 미래로 저장됐고, 그 결과
 * 공지가 RLS(notice_visible_to_current_user)에서 안 보이는데 Push는 먼저 나가는
 * 불일치가 발생했다. DB/네트워크 없이 순수 Date 연산만 검증한다.
 *
 * 실행: npm run test:notice-datetime (환경변수 불필요)
 */
import { isNoticeCurrentlyPublished, kstDatetimeLocalToUtcIso, utcIsoToKstDatetimeLocal } from "../src/lib/notices/datetime";

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

// (A) KST datetime-local → UTC ISO — 실측 버그 케이스 그대로 재현 -----------------------
{
  const result = kstDatetimeLocalToUtcIso("2026-09-22T17:14");
  record("A. KST 2026-09-22T17:14 → UTC 2026-09-22T08:14:00.000Z", result === "2026-09-22T08:14:00.000Z", result);
}

// (A-2) 자정 부근 — 날짜가 바뀌는 경계도 정확해야 한다(KST 03:00 → 전날 UTC 18:00) --------
{
  const result = kstDatetimeLocalToUtcIso("2026-09-22T03:00");
  record("A-2. KST 2026-09-22T03:00 → UTC 2026-09-21T18:00:00.000Z(날짜 경계)", result === "2026-09-21T18:00:00.000Z", result);
}

// (B) UTC ISO → KST datetime-local(Edit Form Prefill) ----------------------------------
{
  const result = utcIsoToKstDatetimeLocal("2026-09-22T08:14:00Z");
  record("B. UTC 2026-09-22T08:14:00Z → KST datetime-local 2026-09-22T17:14", result === "2026-09-22T17:14", result);
}

// (B-2) 날짜 경계(UTC 18:00 → KST 다음날 03:00) -----------------------------------------
{
  const result = utcIsoToKstDatetimeLocal("2026-09-21T18:00:00Z");
  record("B-2. UTC 2026-09-21T18:00:00Z → KST datetime-local 2026-09-22T03:00(날짜 경계)", result === "2026-09-22T03:00", result);
}

// (C) Create → Edit → Save round-trip에서 시간 변화가 없어야 한다 -----------------------
{
  const adminInput = "2026-09-22T17:14";
  const savedUtc = kstDatetimeLocalToUtcIso(adminInput); // Create 저장
  const editPrefill = utcIsoToKstDatetimeLocal(savedUtc); // Edit 화면에 다시 채울 값
  const resavedUtc = kstDatetimeLocalToUtcIso(editPrefill); // Edit에서 그대로 저장
  record(
    "C. Create→Edit prefill→Save round-trip — 입력값과 최종 UTC 저장값이 일관됨",
    editPrefill === adminInput && resavedUtc === savedUtc,
    JSON.stringify({ adminInput, savedUtc, editPrefill, resavedUtc }),
  );
}

// (D) 현재 시각 기준으로 이미 게시된 공지 — 노출 대상 ------------------------------------
{
  const now = new Date("2026-09-22T08:22:27Z");
  const notice = { published_at: "2026-09-22T08:00:00Z", expires_at: null };
  record("D. published_at이 이미 지남, expires_at 없음 — 게시 중(visible)", isNoticeCurrentlyPublished(notice, now) === true);
}

// (E) 미래 예약 공지 — 아직 비노출, Push도 보내면 안 됨 ----------------------------------
{
  const now = new Date("2026-09-22T08:22:27Z");
  // 실제 재현된 버그 값 그대로: 생성 시각(08:15)보다 미래인 published_at(17:14)
  const notice = { published_at: "2026-09-22T17:14:00Z", expires_at: null };
  record(
    "E. published_at이 미래(실측 버그 값) — 아직 게시 전(not visible), Push 차단 대상",
    isNoticeCurrentlyPublished(notice, now) === false,
  );
}

// (F) 이미 만료된 공지 — Push를 보내면 안 됨 ----------------------------------------------
{
  const now = new Date("2026-09-22T08:22:27Z");
  const notice = { published_at: "2026-09-20T00:00:00Z", expires_at: "2026-09-21T00:00:00Z" };
  record("F. expires_at이 이미 지남 — 만료(not visible), Push 차단 대상", isNoticeCurrentlyPublished(notice, now) === false);
}

// (F-2) 경계값: expires_at과 정확히 같은 시각은 "이미 만료"로 취급(DB RLS의 now<=expires_at와 동일 기준) --
{
  const now = new Date("2026-09-22T08:22:27Z");
  const notice = { published_at: "2026-09-20T00:00:00Z", expires_at: "2026-09-22T08:22:27Z" };
  record(
    "F-2. now === expires_at 경계 — DB의 now<=expires_at 조건과 반대 방향(now>expires_at)이라 이 함수는 false 반환하지 않음(포함)",
    isNoticeCurrentlyPublished(notice, now) === true,
    "DB 조건 now<=expires_at를 그대로 반영: 경계 포함",
  );
}

// (G) published_at과 정확히 같은 시각 — 게시 시작 경계는 포함(now>=published_at) ------------
{
  const now = new Date("2026-09-22T08:22:27Z");
  const notice = { published_at: "2026-09-22T08:22:27Z", expires_at: null };
  record("G. now === published_at 경계 — 게시 시작 포함(visible)", isNoticeCurrentlyPublished(notice, now) === true);
}

console.log("\n요약:", results.filter((r) => r.pass).length, "/", results.length, "PASS");
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error("\n실패한 테스트:");
  for (const f of failed) console.error(` - ${f.name} (${f.detail ?? ""})`);
  process.exit(1);
}
