import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangeBadges } from "@/components/promotions/change-badges";
import { ChangeHistoryList } from "@/components/promotions/change-history-list";
import { DynamicFieldsList } from "@/components/promotions/dynamic-fields-list";
import { PriceLines } from "@/components/promotions/price-block";
import { RealtimeUpdateBanner } from "@/components/realtime/realtime-update-banner";
import { createClient } from "@/lib/supabase/server";
import {
  getCoreFieldDisplayLabels,
  getPromotionByProductId,
  getRecentChangeLogs,
  getVisibleCampaignForPromotion,
  getVisibleDynamicFieldDefs,
  isPromotionNew,
} from "@/lib/promotions/queries";
import { dedupeTrimmed, formatDateKST, valueOrNone } from "@/lib/format";

export const dynamic = "force-dynamic";

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs font-bold text-mint-dark">{label}</dt>
      <dd className="text-sm text-text">{value}</dd>
    </div>
  );
}

export default async function PromotionDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const supabase = await createClient();

  // RLS가 비활성 상시/비노출·예정·종료 행사 상품을 이미 걸러준다 — null이면
  // "존재하지 않음"과 "권한 없음"을 구분하지 않고 그냥 404로 처리한다(§19, 정보 노출 최소화).
  const promotion = await getPromotionByProductId(supabase, productId);
  if (!promotion) notFound();

  const [fieldLabels, dynamicFieldDefs, changeLogs, campaign] = await Promise.all([
    getCoreFieldDisplayLabels(supabase),
    getVisibleDynamicFieldDefs(supabase, promotion.promotion_type),
    getRecentChangeLogs(supabase, promotion.id),
    promotion.promotion_type === "event" ? getVisibleCampaignForPromotion(supabase, promotion.id) : null,
  ]);

  const isNew = isPromotionNew(promotion);
  const colors = dedupeTrimmed(promotion.color);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6 pb-4">
      <Link href="/promotions" className="text-xs font-bold text-text-3">
        ← 프로모션 목록
      </Link>

      <RealtimeUpdateBanner
        channelName={`promotion-detail-${promotion.id}`}
        watches={[{ table: "promotions", event: "UPDATE", filter: `id=eq.${promotion.id}` }]}
        label="이 상품 정보가 변경되었습니다."
      />

      {campaign && (
        <Link href={`/promotions/events/${campaign.id}`}>
          <Badge variant="solid">🔥 {campaign.campaign_name}</Badge>
        </Link>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-bold text-mint-dark">{promotion.brand}</span>
          <h1 className="text-xl font-black text-text">{promotion.product_name}</h1>
        </div>
        <ChangeBadges isNew={isNew} recentImportantLogs={changeLogs} />
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

      <Card>
        <CardHeader>
          <CardTitle>가격</CardTitle>
        </CardHeader>
        <CardContent>
          <PriceLines promotion={promotion} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-1">
          {/* 카드와 동일한 라벨/"없음" 처리(§5, §10) — DB display_label이 아니라
              카드에서 쓰는 짧은 라벨을 그대로 맞춘다. */}
          <DetailRow label="기본구성품" value={valueOrNone(promotion.default_components)} />
          <DetailRow label="증정사은품" value={valueOrNone(promotion.gift)} />
          <DetailRow label="포토후기" value={valueOrNone(promotion.photo_review_benefit)} />
          <DetailRow
            label={fieldLabels.get("store_promotion_allowed") ?? "매장 자체 프로모션"}
            value={promotion.store_promotion_allowed}
          />
          <DetailRow label={fieldLabels.get("store_operation_note") ?? "매장 별 운영"} value={promotion.store_operation_note} />
          <DetailRow label={fieldLabels.get("period_label") ?? "행사 기간"} value={promotion.period_label} />
          <DetailRow label={fieldLabels.get("remarks") ?? "비고"} value={promotion.remarks} />
        </CardContent>
      </Card>

      <DynamicFieldsList fieldDefs={dynamicFieldDefs} extraFields={promotion.extra_fields} />

      <Card>
        <CardHeader>
          <CardTitle>최근 변경 이력</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangeHistoryList logs={changeLogs} fieldDisplayLabels={fieldLabels} />
        </CardContent>
      </Card>

      <p className="text-center text-[11px] text-text-3">
        마지막 업데이트 {formatDateKST(promotion.updated_at)}
      </p>
    </main>
  );
}
