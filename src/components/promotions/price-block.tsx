import { formatKRW } from "@/lib/format";
import type { Database } from "@/types/database";

type PromotionRow = Database["public"]["Tables"]["promotions"]["Row"];

type PriceFields = Pick<
  PromotionRow,
  "consumer_price" | "base_sale_price" | "final_price_card" | "final_price_cash"
>;

/**
 * 가격 용어/강조 방식은 카드와 상세에서 완전히 동일해야 한다(2026-09-17 사용자 피드백 §10) —
 * "기존 판매가"/"기준가"/"판매가"처럼 표현이 섞이지 않도록 이 한 컴포넌트만 사용한다.
 *
 * 강조 원칙(§3):
 * - 소비자가: 보조 정보 — 작게, 회색
 * - 기준판매가: Black, 최종판매가와 동일 크기 — "이게 기준 가격이다"가 명확해야 함
 * - 카드판매가 / 현금·계좌이체: Red, 기준판매가와 동일 크기 — 실제 결제 금액이라 가장 중요
 *
 * 값이 없는 가격 줄은 그냥 숨긴다(§11) — 억지로 "없음"을 채우지 않는다(가격은 구성품/사은품/
 * 포토후기와 달리 "누락 vs 실제 없음" 구분이 필요 없는 필드라는 판단).
 */
const PRICE_ROWS: {
  key: keyof PriceFields;
  label: string;
  valueClassName: string;
}[] = [
  { key: "consumer_price", label: "소비자가", valueClassName: "text-xs font-normal text-text-3" },
  { key: "base_sale_price", label: "기준판매가", valueClassName: "text-base font-black text-text" },
  { key: "final_price_card", label: "카드판매가", valueClassName: "text-base font-black text-danger" },
  { key: "final_price_cash", label: "현금/계좌이체", valueClassName: "text-base font-black text-danger" },
];

export function PriceLines({ promotion }: { promotion: PriceFields }) {
  const rows = PRICE_ROWS.filter((r) => promotion[r.key] != null);
  if (rows.length === 0) return <p className="text-sm text-text-3">가격 정보 없음</p>;

  return (
    <dl className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.key} className="flex items-baseline justify-between gap-3">
          <dt className="text-xs text-text-3">{r.label}</dt>
          <dd className={r.valueClassName}>{formatKRW(promotion[r.key]!)}</dd>
        </div>
      ))}
    </dl>
  );
}
