import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { NoticeAudienceSummary } from "@/lib/notices/queries";

/** Phase 12에서 지표가 늘어나도 이 카드에 항목만 추가하면 된다(§12). */
export function NoticeAudienceSummaryCard({
  summary,
  requiresConfirmation,
}: {
  summary: NoticeAudienceSummary;
  requiresConfirmation: boolean;
}) {
  const items = [
    { label: "대상 직원 수", value: summary.targetCount },
    { label: "읽은 직원 수", value: summary.readCount },
    { label: "미열람 수", value: summary.unreadCount },
    ...(requiresConfirmation
      ? [
          { label: "확인 완료 수", value: summary.confirmedCount },
          { label: "미확인 수", value: summary.unconfirmedCount },
        ]
      : []),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>열람 현황</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-3 text-center">
        {items.map((item) => (
          <div key={item.label}>
            <div className="text-xl font-black text-text">{item.value}</div>
            <div className="text-[11px] text-text-3">{item.label}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
