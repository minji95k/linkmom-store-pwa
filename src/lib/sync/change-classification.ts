import type { PromotionChangeType } from "@/types/database";

/**
 * changed_field(field_key) → change_type 매핑.
 * 실제 NEW/Push "중요도"는 여기서 정하지 않는다 — 그건 promotion_field_definitions.
 * change_importance가 유일한 기준이다(CLAUDE.md 절대 원칙 7). 이 맵은 오직
 * promotion_change_logs.change_type 분류용이다.
 */
const CHANGE_TYPE_BY_FIELD: Record<string, PromotionChangeType> = {
  consumer_price: "price",
  base_sale_price: "price",
  final_price_card: "price",
  final_price_cash: "price",
  store_promotion_allowed: "promotion",
  default_components: "configuration",
  gift: "gift",
  photo_review_benefit: "benefit",
  period_label: "event_period",
  store_operation_note: "store_operation",
};

export function classifyChangeType(fieldKey: string): PromotionChangeType {
  return CHANGE_TYPE_BY_FIELD[fieldKey] ?? "minor_edit";
}
