/**
 * Phase 11 §14 Deep Link 규칙 + §10/§11 Lock Screen 문구 정책(src/lib/push/policy.ts)을
 * 실 DB/브라우저 없이 검증한다. 실제 프로덕션 코드를 그대로 import한다.
 *
 * 실행: npm run test:push-deep-link (환경변수/DB 불필요)
 */
import {
  buildNoticeBody,
  buildNoticeTitle,
  buildPromotionChangeBody,
  buildPromotionChangeTitle,
  buildSummaryBody,
  buildSummaryTitle,
  eventCampaignDeepLink,
  isNoticePushEligible,
  noticeDeepLink,
  promotionDeepLink,
  shortFieldLabel,
  summaryDeepLink,
} from "../src/lib/push/policy";

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

// §14 Deep Link 경로 -------------------------------------------------------------
record("프로모션 상세 딥링크", promotionDeepLink("PROD-000123") === "/promotions/PROD-000123", promotionDeepLink("PROD-000123"));
record("공지 딥링크", noticeDeepLink("abc-123") === "/notices/abc-123", noticeDeepLink("abc-123"));
record("행사 딥링크", eventCampaignDeepLink("camp-1") === "/promotions/events/camp-1", eventCampaignDeepLink("camp-1"));
record(
  "다건 요약 딥링크 — 실제 존재하는 라우트(/promotions?tab=new)를 가리킴",
  summaryDeepLink() === "/promotions?tab=new",
  summaryDeepLink(),
);

// §11 Notice Push 대상 정책 -------------------------------------------------------
record("긴급공지는 Push 대상", isNoticePushEligible("긴급") === true);
record("필독공지는 Push 대상", isNoticePushEligible("필독") === true);
record("중요공지는 Push 대상", isNoticePushEligible("중요") === true);
record("일반공지는 기본 Push 제외", isNoticePushEligible("일반") === false);
record("행사공지는 기본 Push 제외(Notice Policy로 분리)", isNoticePushEligible("행사") === false);
record("교육공지는 기본 Push 제외", isNoticePushEligible("교육") === false);

// §10 Promotion Push 문구(Lock Screen 과다 정보 노출 금지) -------------------------
record("가격 변경 타이틀", buildPromotionChangeTitle("price") === "[가격 변경]", buildPromotionChangeTitle("price"));
record("사은품 변경 타이틀", buildPromotionChangeTitle("gift") === "[사은품 변경]", buildPromotionChangeTitle("gift"));
{
  const body = buildPromotionChangeBody("리안", "플릭", ["카드판매가"]);
  record("본문에 브랜드+제품명+필드명 포함, 실제 가격 값은 노출 안 함", body.includes("리안") && body.includes("플릭") && body.includes("카드판매가") && !/\d{3,}/.test(body), body);
}
{
  // 같은 상품에서 카드가+현금가가 동시에 바뀐 경우(2026-09-18 실 iPhone E2E에서 실측된
  // 상황) — 필드 2개가 한 알림에 같이 나열돼야 한다.
  const body = buildPromotionChangeBody("리안", "플릭", ["카드판매가", "현금/계좌이체"]);
  record("동시에 바뀐 필드 여러 개가 한 알림 본문에 함께 나열됨", body.includes("카드판매가") && body.includes("현금/계좌이체"), body);
}

// 짧은 필드 라벨 — 2026-09-18 실 iPhone E2E에서 "최종 판매가 (카드결제)이(가) 변경..."처럼
// Sheet 헤더 원문이 그대로 노출되는 걸 발견해 추가한 보정(product detail 화면과 동일 용어) --
record("카드판매가 짧은 라벨(Sheet 헤더 원문 대신)", shortFieldLabel("final_price_card", "최종 판매가 (카드결제)") === "카드판매가");
record("현금/계좌이체 짧은 라벨", shortFieldLabel("final_price_cash", "최종판매가 (현금or계좌이체)") === "현금/계좌이체");
record("증정사은품 짧은 라벨", shortFieldLabel("gift", "증정사은품") === "증정사은품");
record("행사 기간(campaign_visibility) → '행사 기간'으로 통일", shortFieldLabel("campaign_visibility", "campaign_visibility") === "행사 기간");
record("매핑 없는 필드는 fallback(예: Dynamic Field의 display_label) 그대로 사용", shortFieldLabel("어떤_동적필드", "관리자가 지정한 라벨") === "관리자가 지정한 라벨");

// §11 Notice Push 문구 -------------------------------------------------------------
record("필독공지 타이틀", buildNoticeTitle("필독") === "[필독공지]", buildNoticeTitle("필독"));
record("공지 본문 예시와 형태 일치", buildNoticeBody("9월 판매가 운영 안내") === "9월 판매가 운영 안내이(가) 등록되었습니다.", buildNoticeBody("9월 판매가 운영 안내"));

// §13 Summary 문구 — "리안 외 4개 브랜드, 17개 상품" 형태 -------------------------------
{
  const body = buildSummaryBody(["리안", "뉴나", "시크", "미마", "오르빗"], 17);
  record("여러 브랜드 → '외 N개 브랜드' 형태", body === "리안 외 4개 브랜드, 17개 상품의 정보가 변경되었습니다.", body);
}
{
  const body = buildSummaryBody(["리안"], 3);
  record("단일 브랜드는 '외 N개' 없이 표시", body === "리안, 3개 상품의 정보가 변경되었습니다.", body);
}
record("요약 타이틀", buildSummaryTitle() === "[프로모션 정보 업데이트]", buildSummaryTitle());

console.log("\n요약:", results.filter((r) => r.pass).length, "/", results.length, "PASS");
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error("\n실패한 테스트:");
  for (const f of failed) console.error(` - ${f.name} (${f.detail ?? ""})`);
  process.exit(1);
}
process.exit(0);
