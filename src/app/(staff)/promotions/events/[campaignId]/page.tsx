import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { PaginationBar } from "@/components/promotions/pagination-bar";
import { PromotionCard } from "@/components/promotions/promotion-card";
import { PromotionFilterBar } from "@/components/promotions/promotion-filter-bar";
import { RealtimeUpdateBanner } from "@/components/realtime/realtime-update-banner";
import { createClient } from "@/lib/supabase/server";
import {
  getCampaignProducts,
  getDistinctBrandsForCampaign,
  getRecentChangeLogsForPromotions,
  getVisibleCampaignById,
} from "@/lib/promotions/queries";
import { formatDateKST } from "@/lib/format";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EventCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { campaignId } = await params;
  const sp = await searchParams;
  const q = first(sp.q);
  const brand = first(sp.brand);
  const page = Number(first(sp.page) ?? "1") || 1;

  const supabase = await createClient();

  // event_campaigns_visible로 조회하므로, 비노출/예정/종료된 캠페인 id를 URL로 직접
  // 입력해도 STAFF/STORE_MANAGER에게는 여기서 그대로 404가 된다(§13, §19 요구사항).
  const campaign = await getVisibleCampaignById(supabase, campaignId);
  if (!campaign) notFound();

  const [result, brands] = await Promise.all([
    getCampaignProducts(supabase, campaignId, { q, brand, page }),
    getDistinctBrandsForCampaign(supabase, campaignId),
  ]);

  const changeLogsByPromotion = await getRecentChangeLogsForPromotions(
    supabase,
    result.items.map((p) => p.id),
  );

  const basePath = `/promotions/events/${campaignId}`;
  const period =
    campaign.start_at && campaign.end_at
      ? `${formatDateKST(campaign.start_at)} ~ ${formatDateKST(campaign.end_at)}`
      : null;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6 pb-4">
      <Link href="/promotions?tab=event" className="text-xs font-bold text-text-3">
        ← 행사 목록
      </Link>

      <RealtimeUpdateBanner
        channelName={`campaign-detail-${campaignId}`}
        watches={[
          { table: "promotions", event: "*" },
          { table: "event_campaigns", event: "UPDATE", filter: `id=eq.${campaignId}` },
        ]}
        label="행사 정보가 업데이트되었습니다."
      />

      <div>
        <Badge variant="solid">🔥 진행 중인 행사</Badge>
        <h1 className="mt-1 text-xl font-black text-text">{campaign.campaign_name}</h1>
        {period && <p className="text-xs text-text-3">{period}</p>}
      </div>

      <PromotionFilterBar basePath={basePath} brands={brands} showSort={false} />

      <p className="text-xs text-text-3">행사상품 {result.total}건</p>

      {result.items.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-3">검색 결과가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((promotion) => (
            <PromotionCard
              key={promotion.id}
              promotion={promotion}
              recentLogs={changeLogsByPromotion.get(promotion.id) ?? []}
            />
          ))}
        </div>
      )}

      <PaginationBar
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        basePath={basePath}
        searchParams={{ q, brand }}
      />
    </main>
  );
}
