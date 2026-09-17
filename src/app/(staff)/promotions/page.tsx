import { EventCampaignBanner } from "@/components/promotions/event-campaign-banner";
import { PaginationBar } from "@/components/promotions/pagination-bar";
import { PromotionCard } from "@/components/promotions/promotion-card";
import { PromotionFilterBar } from "@/components/promotions/promotion-filter-bar";
import { PromotionTabs } from "@/components/promotions/promotion-tabs";
import { RealtimeUpdateBanner } from "@/components/realtime/realtime-update-banner";
import { createClient } from "@/lib/supabase/server";
import {
  getCampaignProductCount,
  getDistinctActiveBrands,
  getNewPromotions,
  getRecentChangeLogsForPromotions,
  getVisibleEventCampaigns,
  searchPermanentPromotions,
  type PromotionListResult,
  type PromotionSort,
} from "@/lib/promotions/queries";
import type { Database } from "@/types/database";

type EventCampaignRow = Database["public"]["Tables"]["event_campaigns"]["Row"];
type ChangeLogRow = Database["public"]["Tables"]["promotion_change_logs"]["Row"];

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PromotionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const tab = first(sp.tab) ?? "permanent";
  const q = first(sp.q);
  const brand = first(sp.brand);
  const sort = (first(sp.sort) as PromotionSort | undefined) ?? "default";
  const page = Number(first(sp.page) ?? "1") || 1;

  const supabase = await createClient();
  const visibleCampaigns = await getVisibleEventCampaigns(supabase);

  let eventBanners: { campaign: EventCampaignRow; count: number }[] = [];
  let listResult: PromotionListResult | null = null;
  let brands: string[] = [];
  let changeLogsByPromotion = new Map<string, ChangeLogRow[]>();
  let emptyText = "";
  let showSort = false;

  if (tab === "event") {
    for (const campaign of visibleCampaigns) {
      const count = await getCampaignProductCount(supabase, campaign.id);
      eventBanners.push({ campaign, count });
    }
  } else {
    brands = await getDistinctActiveBrands(supabase, "permanent");
    if (tab === "new") {
      listResult = await getNewPromotions(supabase, { q, brand, page });
      emptyText = "최근 72시간 내 NEW 상품이 없습니다.";
    } else {
      listResult = await searchPermanentPromotions(supabase, { q, brand, sort, page });
      emptyText = "검색 결과가 없습니다.";
      showSort = true;
    }
    changeLogsByPromotion = await getRecentChangeLogsForPromotions(
      supabase,
      listResult.items.map((p) => p.id),
    );
  }

  const searchParamsRecord = {
    tab,
    q,
    brand,
    sort: tab === "permanent" && sort === "recent" ? sort : undefined,
  };

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6 pb-4">
      <h1 className="text-lg font-black">프로모션</h1>

      <RealtimeUpdateBanner
        channelName={`promotions-list-${tab}`}
        watches={[
          { table: "promotions", event: "*" },
          { table: "event_campaigns", event: "*" },
        ]}
        label="프로모션 정보가 업데이트되었습니다."
      />

      <PromotionTabs activeTab={tab} hasVisibleEvents={visibleCampaigns.length > 0} />

      {tab === "event" ? (
        eventBanners.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-3">현재 진행 중인 행사가 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {eventBanners.map(({ campaign, count }) => (
              <EventCampaignBanner key={campaign.id} campaign={campaign} productCount={count} />
            ))}
          </div>
        )
      ) : (
        listResult && (
          <div className="flex flex-col gap-3">
            <PromotionFilterBar key={tab} basePath="/promotions" brands={brands} showSort={showSort} />

            <p className="text-xs text-text-3">전체 {listResult.total}건</p>

            {listResult.items.length === 0 ? (
              <p className="py-8 text-center text-sm text-text-3">{emptyText}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {listResult.items.map((promotion) => (
                  <PromotionCard
                    key={promotion.id}
                    promotion={promotion}
                    recentLogs={changeLogsByPromotion.get(promotion.id) ?? []}
                  />
                ))}
              </div>
            )}

            <PaginationBar
              page={listResult.page}
              pageSize={listResult.pageSize}
              total={listResult.total}
              basePath="/promotions"
              searchParams={searchParamsRecord}
            />
          </div>
        )
      )}
    </main>
  );
}
