import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateKST } from "@/lib/format";
import type { Database } from "@/types/database";

type EventCampaignRow = Database["public"]["Tables"]["event_campaigns"]["Row"];

/**
 * 상시 프로모션과 시각적으로 명확히 구분되는 행사 캠페인 카드(§13, §14).
 * 캠페인명은 항상 실제 Sheet의 `행사명` 값 그대로 노출한다(테스트 문구를
 * 하드코딩하지 않음 — DEV DB에 남아있는 "DEV 테스트 행사"도 실제 값 그대로 보인다).
 */
export function EventCampaignBanner({
  campaign,
  productCount,
}: {
  campaign: EventCampaignRow;
  productCount: number;
}) {
  const period =
    campaign.start_at && campaign.end_at
      ? `${formatDateKST(campaign.start_at)} ~ ${formatDateKST(campaign.end_at)}`
      : null;

  return (
    <Card className="border-purple/40 bg-purple-tint/40">
      <CardHeader>
        <Badge variant="solid">🔥 진행 중인 행사</Badge>
        <CardTitle>{campaign.campaign_name}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-2">
          {period && <span>{period}</span>}
          <span>행사상품 {productCount}개</span>
        </div>
        <Link href={`/promotions/events/${campaign.id}`}>
          <Button variant="primary" size="sm" className="w-full">
            행사상품 보기
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
