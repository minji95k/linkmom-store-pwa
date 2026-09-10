import type { PromotionType } from "@/types/database";

/**
 * Core Field 헤더 매핑 (docs/current-system-analysis.md §3 실측 기준).
 *
 * 두 Sheet는 같은 개념도 헤더 문자열이 다르다 — 예: 사은품은 상시="증정사은품",
 * 행사="행사 사은품"; 매장프로모션은 상시="매장프로모션"(공백 없음),
 * 행사="매장 프로모션"(공백 있음). 그래서 Sheet별로 별도 매핑 테이블을 둔다.
 *
 * 값은 promotions 테이블의 실제 컬럼명(= promotion_field_definitions.field_key)이다.
 * "product_id"와 "legacy_softr_record_id"는 Core Field이지만 일반 컬럼처럼
 * diff/변경이력 대상으로 취급하지 않는다(엔진에서 별도 처리).
 */
export const PROMOTION_CORE_FIELD_MAP: Record<PromotionType, Record<string, string>> = {
  permanent: {
    "행사 기간": "period_label",
    브랜드: "brand",
    제품명: "product_name",
    컬러: "color",
    공지유형: "notice_type",
    소비자가: "consumer_price",
    "기준 판매가": "base_sale_price",
    "최종 판매가 (카드결제)": "final_price_card",
    "최종판매가 (현금or계좌이체)": "final_price_cash",
    "매장 별 운영": "store_operation_note",
    "기본 구성품": "default_components",
    증정사은품: "gift",
    포토후기: "photo_review_benefit",
    매장프로모션: "store_promotion_allowed",
    비고: "remarks",
    product_id: "product_id",
    "🔐 Softr Record ID": "legacy_softr_record_id",
  },
  event: {
    "행사 기간": "period_label",
    브랜드: "brand",
    제품명: "product_name",
    컬러: "color",
    공지유형: "notice_type",
    소비자가: "consumer_price",
    "기준 판매가": "base_sale_price",
    "최종 판매가 (카드결제)": "final_price_card",
    "최종판매가 (현금or계좌이체)": "final_price_cash",
    "매장 별 운영": "store_operation_note",
    "행사 사은품": "gift",
    "매장 프로모션": "store_promotion_allowed",
    비고: "remarks",
    product_id: "product_id",
    "🔐 Softr Record ID": "legacy_softr_record_id",
  },
};

/** [행사 프로모션] 시트에만 존재하는, promotions가 아니라 event_campaigns로 가는 헤더. */
export const EVENT_CAMPAIGN_FIELD_MAP: Record<string, "name" | "start" | "end" | "visible"> = {
  행사명: "name",
  "행사 시작일": "start",
  "행사 종료일": "end",
  노출여부: "visible",
};

/**
 * Softr 전용 메타데이터 — Dynamic Field 자동 감지에서 제외한다(sync-design.md §6).
 * "최근 수정 건수"는 실측 결과 상품별 데이터가 아니라 요약 통계가 섞여든 것으로
 * 확인되어 특히 주의가 필요하다.
 */
export const EXCLUDED_HEADERS = new Set(["수정일", "NEW", "최근 수정 건수"]);

const NUMBER_FIELDS = new Set([
  "consumer_price",
  "base_sale_price",
  "final_price_card",
  "final_price_cash",
]);

export function isNumberField(fieldKey: string): boolean {
  return NUMBER_FIELDS.has(fieldKey);
}

/** 헤더 문자열 비교는 trim + 연속 공백 정규화 후 정확히 일치해야 한다(sync-design.md §5). */
export function normalizeHeader(header: string): string {
  return header.trim().replace(/\s+/g, " ");
}

export function resolveCoreField(sheet: PromotionType, header: string): string | undefined {
  const normalized = normalizeHeader(header);
  return PROMOTION_CORE_FIELD_MAP[sheet][normalized];
}

export function resolveCampaignField(header: string): "name" | "start" | "end" | "visible" | undefined {
  return EVENT_CAMPAIGN_FIELD_MAP[normalizeHeader(header)];
}

/** 콤마 또는 "+"로 여러 값이 뭉쳐 있는 컬러 셀을 배열로 정규화한다(§72). */
export function parseColorArray(raw: string): string[] {
  return raw
    .split(/[,+]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "-");
}
