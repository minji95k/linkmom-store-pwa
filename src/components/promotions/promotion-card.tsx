import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ChangeBadges } from "@/components/promotions/change-badges";
import { PriceLines } from "@/components/promotions/price-block";
import { dedupeTrimmed, valueOrNone } from "@/lib/format";
import { isPromotionNew } from "@/lib/promotions/queries";
import type { Database } from "@/types/database";

type PromotionRow = Database["public"]["Tables"]["promotions"]["Row"];
type ChangeLogRow = Database["public"]["Tables"]["promotion_change_logs"]["Row"];

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold text-mint-dark">{label}</dt>
      <dd className="text-sm text-text">{value}</dd>
    </div>
  );
}

/**
 * 2026-09-17 사용자 피드백: 브랜드/상품명/컬러 → 가격(라벨 포함, 색상으로 우선순위
 * 구분) → 구분선 → 기본구성품/증정사은품/포토후기(없으면 "없음") → 구분선 → 비고
 * 순으로 고정한다. 상시/행사/NEW 목록이 전부 이 컴포넌트 하나를 공유하므로 세 화면
 * 모두 동일한 구조로 보인다(§9).
 */
export function PromotionCard({
  promotion,
  recentLogs,
}: {
  promotion: PromotionRow;
  recentLogs: ChangeLogRow[];
}) {
  const isNew = isPromotionNew(promotion);
  const remarks = promotion.remarks?.trim();
  const hasRemarks = remarks && remarks !== "-";
  const colors = dedupeTrimmed(promotion.color);

  return (
    <Link href={`/promotions/${promotion.product_id}`}>
      <Card className="flex flex-col gap-3 active:bg-bg">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-xs font-bold text-mint-dark">{promotion.brand}</span>
            <span className="text-[15px] font-bold text-text">{promotion.product_name}</span>
          </div>
          <ChangeBadges isNew={isNew} recentImportantLogs={recentLogs} />
        </div>

        {colors.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {colors.map((c) => (
              <Badge key={c} variant="neutral">
                {c}
              </Badge>
            ))}
          </div>
        )}

        <PriceLines promotion={promotion} />

        <dl className="flex flex-col gap-2 border-t border-border pt-3">
          <InfoLine label="기본구성품" value={valueOrNone(promotion.default_components)} />
          <InfoLine label="증정사은품" value={valueOrNone(promotion.gift)} />
          <InfoLine label="포토후기" value={valueOrNone(promotion.photo_review_benefit)} />
        </dl>

        {hasRemarks && (
          <div className="border-t border-border pt-3">
            <dt className="text-xs font-bold text-mint-dark">비고</dt>
            <dd className="text-sm text-text">{remarks}</dd>
          </div>
        )}
      </Card>
    </Link>
  );
}
