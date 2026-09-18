import type { NoticeType, PromotionChangeType } from "@/types/database";

/**
 * Phase 11 §11(요구사항): "일반공지까지 모두 Push할지는 Notification Policy로 분리".
 * 긴급/필독/중요만 기본 Push 대상이다 — 이 Set 하나만 고치면 정책이 바뀐다(Phase 12
 * Admin UI가 필요해지면 이 상수를 DB 설정으로 옮기는 것으로 충분하다).
 */
export const NOTICE_TYPES_PUSH_ELIGIBLE: ReadonlySet<NoticeType> = new Set(["긴급", "필독", "중요"]);

export function isNoticePushEligible(noticeType: NoticeType): boolean {
  return NOTICE_TYPES_PUSH_ELIGIBLE.has(noticeType);
}

/**
 * push-design.md §10: Lock Screen에 너무 상세한 정보를 노출하지 않는다 — "무엇이
 * 바뀌었는지" 카테고리만 표시하고 실제 값(가격 등)은 앱에서 확인하게 한다.
 */
const CHANGE_TYPE_LABEL: Record<PromotionChangeType, string> = {
  new_product: "신규 상품",
  price: "가격 변경",
  promotion: "프로모션 변경",
  benefit: "혜택 변경",
  gift: "사은품 변경",
  event_period: "행사 변경",
  store_operation: "매장 운영 변경",
  configuration: "구성품 변경",
  minor_edit: "정보 수정",
};

export function changeTypeLabel(changeType: PromotionChangeType): string {
  return CHANGE_TYPE_LABEL[changeType] ?? "정보 변경";
}

/**
 * `promotion_field_definitions.display_label`은 Core Field의 경우 Sheet 헤더 원문
 * ("최종 판매가 (카드결제)")을 그대로 담고 있다 — Sync가 헤더를 그대로 등록하기 때문이다.
 * 상품 상세 화면은 이 값을 안 쓰고 `PriceLines`/`DetailRow`에서 자체적으로 짧은 라벨을
 * 하드코딩한다(2026-09-17 사용자 피드백 §10, `src/components/promotions/price-block.tsx`).
 * Push 알림도 같은 짧은 표현을 써야 Lock Screen에서 자연스럽다 — 2026-09-18 실 iPhone
 * E2E에서 "최종 판매가 (카드결제)이(가) 변경되었습니다."로 나가는 걸 실제로 확인하고 추가.
 * 여기 없는 field_key(Dynamic Field 등)는 `promotion_field_definitions.display_label`을
 * 그대로 쓴다(호출부 fallback).
 */
const CORE_FIELD_SHORT_LABEL: Record<string, string> = {
  consumer_price: "소비자가",
  base_sale_price: "기준판매가",
  final_price_card: "카드판매가",
  final_price_cash: "현금/계좌이체",
  gift: "증정사은품",
  default_components: "기본구성품",
  photo_review_benefit: "포토후기",
  store_promotion_allowed: "매장 자체 프로모션",
  period_label: "행사 기간",
  remarks: "비고",
  campaign_visibility: "행사 기간", // engine.ts가 캠페인 변경을 이 synthetic field_key로 기록한다.
};

export function shortFieldLabel(fieldKey: string, fallback: string): string {
  return CORE_FIELD_SHORT_LABEL[fieldKey] ?? fallback;
}

export function buildPromotionChangeTitle(changeType: PromotionChangeType): string {
  return `[${changeTypeLabel(changeType)}]`;
}

/** fieldLabels: 이 상품에서 이번에 같이 바뀐 필드들(예: 카드가+현금가 동시 변경 → 2개). */
export function buildPromotionChangeBody(brand: string, productName: string, fieldLabels: string[]): string {
  const fields = fieldLabels.length > 0 ? fieldLabels.join(", ") : "정보";
  return `${brand} ${productName}\n${fields}이(가) 변경되었습니다.`;
}

export function buildSummaryTitle(): string {
  return "[프로모션 정보 업데이트]";
}

/** push-design.md §5 예시: "리안 외 4개 브랜드, 17개 상품의 판매조건이 변경되었습니다." */
export function buildSummaryBody(brands: string[], productCount: number): string {
  const [first, ...rest] = brands;
  const brandText = rest.length > 0 ? `${first} 외 ${rest.length}개 브랜드` : (first ?? "여러 상품");
  return `${brandText}, ${productCount}개 상품의 정보가 변경되었습니다.`;
}

export function buildNoticeTitle(noticeType: NoticeType): string {
  return `[${noticeType}공지]`;
}

export function buildNoticeBody(title: string): string {
  return `${title}이(가) 등록되었습니다.`;
}

// ---- Deep Link (push-design.md §7, 실제 존재하는 라우트로 보정) --------------------
export function promotionDeepLink(productId: string): string {
  return `/promotions/${productId}`;
}

export function noticeDeepLink(noticeId: string): string {
  return `/notices/${noticeId}`;
}

export function eventCampaignDeepLink(campaignId: string): string {
  return `/promotions/events/${campaignId}`;
}

/**
 * push-design.md §7 원안은 `/promotions/updates`였으나 그런 라우트가 실제로 없다 —
 * "최근 72시간 주요 변경"을 이미 보여주는 실제 라우트(`/promotions?tab=new`, 홈 화면
 * "NEW 보러가기" 링크와 동일)로 보정한다.
 */
export function summaryDeepLink(): string {
  return "/promotions?tab=new";
}
