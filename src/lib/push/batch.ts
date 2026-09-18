import type { PromotionChangeType } from "@/types/database";

export interface EligibleLog {
  id: string;
  promotion_id: string;
  product_id: string;
  changed_field: string;
  change_type: PromotionChangeType;
  importance: "critical" | "important";
}

/**
 * Batching 핵심 결정 로직(push-design.md §5, §13: critical은 개별 즉시발송, important는
 * 전부 묶어 Summary 1건). "server-only" 없이 순수하게 분리해 `scripts/test-push-batch-logic.ts`가
 * DB/서버 환경 없이 그대로 import해서 검증할 수 있게 한다.
 */
export function partitionByImportance(logs: EligibleLog[]): { critical: EligibleLog[]; important: EligibleLog[] } {
  return {
    critical: logs.filter((l) => l.importance === "critical"),
    important: logs.filter((l) => l.importance === "important"),
  };
}

/** 같은 상품(promotion_id)의 여러 필드 변경을 1건으로 묶기 위한 그룹핑. */
export function groupByPromotionId(logs: EligibleLog[]): Map<string, EligibleLog[]> {
  const map = new Map<string, EligibleLog[]>();
  for (const log of logs) {
    const group = map.get(log.promotion_id);
    if (group) group.push(log);
    else map.set(log.promotion_id, [log]);
  }
  return map;
}

/**
 * important 묶음이 딱 1개 상품만 건드렸다면(예: 카드가+현금가 동시 변경도 "1개 상품") —
 * push-design.md §10 예시("[가격 변경] 리안 플릭 ...")처럼 상품명이 드러나는 개별 알림을
 * 보낸다. 2개 이상 상품이 섞였을 때만 §13의 Summary("리안 외 4개 브랜드...")로 묶는다.
 */
export function shouldSendImportantAsSummary(important: EligibleLog[]): boolean {
  return groupByPromotionId(important).size > 1;
}
