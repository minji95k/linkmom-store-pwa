import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EventCampaignBanner } from "@/components/promotions/event-campaign-banner";
import { HomeNoticeSummary } from "@/components/notices/home-notice-summary";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import {
  getCampaignProductCount,
  getNewPromotions,
  getVisibleEventCampaigns,
} from "@/lib/promotions/queries";
import { getNoticesForStaff, selectHomeNoticeHighlights } from "@/lib/notices/queries";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // (staff)/layout.tsx가 이미 비로그인을 /login으로 보내므로 여기서는 non-null.
  const currentUser = (await getCurrentUser())!;
  const supabase = await createClient();

  const [campaigns, newResult, notices] = await Promise.all([
    getVisibleEventCampaigns(supabase),
    getNewPromotions(supabase, { page: 1 }),
    getNoticesForStaff(supabase, currentUser.id),
  ]);
  const noticeHighlights = selectHomeNoticeHighlights(notices);

  const campaignsWithCount = await Promise.all(
    campaigns.map(async (c) => ({ campaign: c, count: await getCampaignProductCount(supabase, c.id) })),
  );

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div className="text-xl font-black">
          <span className="text-purple">Link</span>
          <span className="text-mint-dark">mom</span>
        </div>
        <span className="text-xs text-text-3">{currentUser.profile.name}님</span>
      </div>

      {/* 우선순위(§10, product-requirements.md §4.1): 긴급/필독 미확인/중요/일반 신규 공지가
          행사 배너·NEW 요약보다 먼저 온다. */}
      <HomeNoticeSummary notices={noticeHighlights} />

      {campaignsWithCount.map(({ campaign, count }) => (
        <EventCampaignBanner key={campaign.id} campaign={campaign} productCount={count} />
      ))}

      <Card>
        <CardHeader>
          <CardTitle>최근 72시간 주요 변경</CardTitle>
          <CardDescription>가격·프로모션·사은품 등 중요 변경만 집계됩니다</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="text-2xl font-black text-purple-dark">{newResult.total}건</div>
          <Link href="/promotions?tab=new" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            NEW 보러가기
          </Link>
        </CardContent>
      </Card>

      <Link href="/promotions" className={cn(buttonVariants({ variant: "outline" }), "justify-center")}>
        브랜드·제품명으로 프로모션 검색 →
      </Link>
    </main>
  );
}
