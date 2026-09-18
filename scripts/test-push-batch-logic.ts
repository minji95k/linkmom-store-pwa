/**
 * Phase 11 §13 Batching 핵심 결정(`partitionByImportance`, src/lib/push/process-promotion-changes.ts)을
 * 실 DB 없이 검증한다 — "30개 상품을 한 번에 고치면 Push 30건이 아니라 critical은
 * 개별, important는 Summary 1건으로 나뉘는가"가 이 테스트의 핵심 주장이다.
 *
 * 실행: npm run test:push-batch-logic (환경변수/DB 불필요)
 */
import { groupByPromotionId, partitionByImportance, shouldSendImportantAsSummary, type EligibleLog } from "../src/lib/push/batch";

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function makeLog(overrides: Partial<EligibleLog> = {}): EligibleLog {
  return {
    id: `log-${Math.random()}`,
    promotion_id: "promo-1",
    product_id: "PROD-000001",
    changed_field: "final_price_card",
    change_type: "price",
    importance: "important",
    ...overrides,
  };
}

// 1) 30개 important 변경 → critical 0건, important 30건(1건의 Summary로 묶일 재료) ---
{
  const logs = Array.from({ length: 30 }, () => makeLog({ importance: "important" }));
  const { critical, important } = partitionByImportance(logs);
  record("30개 important 변경 → critical 0건", critical.length === 0, String(critical.length));
  record("30개 important 변경 → important 30건(Summary 1건으로 묶일 재료)", important.length === 30, String(important.length));
}

// 2) critical 섞인 경우 — critical만 개별, 나머지는 important로 남음(§13) ----------------
{
  const logs = [
    makeLog({ importance: "critical" }),
    makeLog({ importance: "important" }),
    makeLog({ importance: "important" }),
    makeLog({ importance: "critical" }),
  ];
  const { critical, important } = partitionByImportance(logs);
  record("critical 2건 분리(개별 즉시발송 대상)", critical.length === 2, String(critical.length));
  record("important 2건 분리(Summary 대상)", important.length === 2, String(important.length));
}

// 3) 전부 critical — Summary가 아예 안 만들어져야 한다(important.length === 0) --------
{
  const logs = Array.from({ length: 5 }, () => makeLog({ importance: "critical" }));
  const { critical, important } = partitionByImportance(logs);
  record("전부 critical → important 0건(Summary 생성 안 함)", important.length === 0, String(important.length));
  record("전부 critical → critical 5건 그대로", critical.length === 5, String(critical.length));
}

// 4) 빈 입력 — 아무것도 없으면 아무 group도 없음 -------------------------------------
{
  const { critical, important } = partitionByImportance([]);
  record("빈 입력 → critical/important 둘 다 0건", critical.length === 0 && important.length === 0);
}

// 5) 서로 다른 상품 5건이 섞여도 partition은 순수하게 importance만 본다(대상 상품 수는
//    호출부의 brands 집계에서 처리 — 여기서는 그 전 단계인 분류만 검증) -------------------
{
  const logs = [
    makeLog({ promotion_id: "p1", product_id: "PROD-1", importance: "important" }),
    makeLog({ promotion_id: "p2", product_id: "PROD-2", importance: "important" }),
    makeLog({ promotion_id: "p3", product_id: "PROD-3", importance: "important" }),
    makeLog({ promotion_id: "p4", product_id: "PROD-4", importance: "important" }),
    makeLog({ promotion_id: "p5", product_id: "PROD-5", importance: "important" }),
  ];
  const { important } = partitionByImportance(logs);
  const distinctProducts = new Set(important.map((l) => l.promotion_id)).size;
  record("서로 다른 상품 5건 → important 5건, 서로 다른 promotion_id 5개(Summary 집계 재료)", important.length === 5 && distinctProducts === 5);
}

// 6) 2026-09-18 실 iPhone E2E에서 발견된 케이스: important 변경이 "1개 상품"뿐이면
//    Summary가 아니라 개별 알림으로 보내야 한다(push-design.md §10 예시와 일치) ---------
{
  const singleProduct = [
    makeLog({ promotion_id: "p1", product_id: "PROD-000019", changed_field: "final_price_card", importance: "important" }),
  ];
  record("important 1개 상품만 변경 → Summary 아님(개별 알림 대상)", shouldSendImportantAsSummary(singleProduct) === false);
}
{
  // 같은 상품에서 카드가+현금가가 동시에 바뀌어도(로그 2건) 여전히 "상품 1개"다.
  const sameProductTwoFields = [
    makeLog({ promotion_id: "p1", product_id: "PROD-000019", changed_field: "final_price_card", importance: "important" }),
    makeLog({ promotion_id: "p1", product_id: "PROD-000019", changed_field: "final_price_cash", importance: "important" }),
  ];
  record("같은 상품의 필드 2개 동시 변경 → 여전히 상품 1개(Summary 아님)", shouldSendImportantAsSummary(sameProductTwoFields) === false);
  const grouped = groupByPromotionId(sameProductTwoFields);
  record("groupByPromotionId — 상품 1개로 그룹화, 로그 2건 보존", grouped.size === 1 && grouped.get("p1")?.length === 2);
}
{
  const twoProducts = [
    makeLog({ promotion_id: "p1", product_id: "PROD-1", importance: "important" }),
    makeLog({ promotion_id: "p2", product_id: "PROD-2", importance: "important" }),
  ];
  record("important 2개 상품 변경 → Summary 대상", shouldSendImportantAsSummary(twoProducts) === true);
}
{
  const thirtyProductsOneField = Array.from({ length: 30 }, (_, i) =>
    makeLog({ promotion_id: `p${i}`, product_id: `PROD-${i}`, importance: "important" }),
  );
  record("상품 30개 동시 변경 → Summary 대상(Push 30건 방지)", shouldSendImportantAsSummary(thirtyProductsOneField) === true);
  record("30개 상품 → groupByPromotionId 결과도 30개 그룹", groupByPromotionId(thirtyProductsOneField).size === 30);
}

console.log("\n요약:", results.filter((r) => r.pass).length, "/", results.length, "PASS");
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error("\n실패한 테스트:");
  for (const f of failed) console.error(` - ${f.name} (${f.detail ?? ""})`);
  process.exit(1);
}
process.exit(0);
