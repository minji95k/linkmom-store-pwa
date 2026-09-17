import { isNumberField } from "@/lib/sync/core-fields";
import { formatKRW } from "@/lib/format";
import type { Database, Json, PromotionChangeType } from "@/types/database";

type ChangeLogRow = Database["public"]["Tables"]["promotion_change_logs"]["Row"];

/**
 * change_type → 카드/상세에 붙일 Badge 한글 라벨.
 * CLAUDE.md 절대 원칙 7: 중요도는 여기서 새로 정하지 않는다 — 이 맵은 순전히
 * 표시용 문구이고, "무엇을 NEW/Push 대상으로 볼지"는 여전히 change_importance만 본다.
 */
export const CHANGE_TYPE_BADGE_LABEL: Record<PromotionChangeType, string> = {
  new_product: "신규 등록",
  price: "가격변경",
  promotion: "프로모션변경",
  benefit: "혜택변경",
  gift: "사은품변경",
  event_period: "행사변경",
  store_operation: "운영변경",
  configuration: "구성변경",
  minor_edit: "표기수정",
};

/**
 * changed_field(field_key) → 카드/변경요약 문구에 쓸 짧은 라벨.
 * promotion_field_definitions.display_label이 있긴 하지만("최종 판매가 (카드결제)")
 * 카드처럼 좁은 공간에는 너무 길어서, 자주 등장하는 Core Field만 별도 축약 라벨을 둔다.
 * 여기 없는 필드(Dynamic Field 포함)는 호출부에서 display_label로 대체한다.
 */
const SHORT_FIELD_LABEL: Record<string, string> = {
  // 2026-09-17 사용자 피드백: 카드/상세와 용어를 통일한다(§10) — "기준가"/"카드가"/
  // "현금가"처럼 줄여 쓰지 않는다.
  consumer_price: "소비자가",
  base_sale_price: "기준판매가",
  final_price_card: "카드판매가",
  final_price_cash: "현금/계좌이체",
  gift: "증정사은품",
  photo_review_benefit: "포토후기",
  store_promotion_allowed: "매장 프로모션",
  store_operation_note: "매장 운영",
  default_components: "기본구성품",
  period_label: "행사 기간",
  notice_type: "공지유형",
  product_id: "상품번호",
};

export function shortFieldLabel(fieldKey: string, fallbackDisplayLabel: string): string {
  return SHORT_FIELD_LABEL[fieldKey] ?? fallbackDisplayLabel;
}

/** before_value/after_value(jsonb)를 화면 표시용 문자열로 변환한다. */
export function formatChangeValue(fieldKey: string, value: Json | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) {
    return value.length === 0 ? "-" : value.map((v) => String(v)).join(", ");
  }
  if (isNumberField(fieldKey) && typeof value === "number") {
    return formatKRW(value);
  }
  return String(value);
}

export interface ChangeSummaryLine {
  fieldLabel: string;
  before: string;
  after: string;
  changeType: PromotionChangeType;
  badgeLabel: string;
}

/** 하나의 change_log 행을 "[라벨] before → after" 한 줄로 요약한다. */
export function summarizeChangeLog(
  log: ChangeLogRow,
  fieldDisplayLabel: string,
): ChangeSummaryLine {
  return {
    fieldLabel: shortFieldLabel(log.changed_field, fieldDisplayLabel),
    before: formatChangeValue(log.changed_field, log.before_value),
    after: formatChangeValue(log.changed_field, log.after_value),
    changeType: log.change_type,
    badgeLabel: CHANGE_TYPE_BADGE_LABEL[log.change_type],
  };
}

/**
 * 카드에 붙일 Badge를 최대 2개로 제한한다: NEW(72h 이내) + 가장 최근 important 이상
 * 변경 1개. 신규 등록 로그(change_type=new_product)만 있으면 NEW 하나만 보여준다
 * (신규 등록 자체를 "가격변경" 등으로 중복 표시할 필요가 없다).
 */
export function pickCardBadges(
  isNew: boolean,
  recentImportantLogs: ChangeLogRow[],
): { label: string; variant: "solid" | "purple" | "mint" | "warning" }[] {
  const badges: { label: string; variant: "solid" | "purple" | "mint" | "warning" }[] = [];
  if (isNew) badges.push({ label: "NEW", variant: "solid" });

  const latestNonNewProduct = recentImportantLogs.find((l) => l.change_type !== "new_product");
  if (latestNonNewProduct && badges.length < 2) {
    badges.push({
      label: CHANGE_TYPE_BADGE_LABEL[latestNonNewProduct.change_type],
      variant: latestNonNewProduct.importance === "critical" ? "warning" : "mint",
    });
  }
  return badges;
}
