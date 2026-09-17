import Link from "next/link";

import { cn } from "@/lib/utils";

const TABS: { key: string; label: string }[] = [
  { key: "permanent", label: "상시" },
  { key: "event", label: "행사" },
  { key: "new", label: "NEW" },
];

/** tab 전환 시 검색/브랜드/정렬 등 다른 필터는 초기화한다 — 탭마다 의미가 다른 목록이라 자연스럽다. */
export function PromotionTabs({ activeTab, hasVisibleEvents }: { activeTab: string; hasVisibleEvents: boolean }) {
  return (
    <div className="flex gap-1 rounded-xl bg-bg p-1">
      {TABS.filter((t) => t.key !== "event" || hasVisibleEvents).map((tab) => (
        <Link
          key={tab.key}
          href={`/promotions?tab=${tab.key}`}
          className={cn(
            "flex-1 rounded-lg py-2 text-center text-sm font-bold",
            activeTab === tab.key ? "bg-card text-purple-dark shadow-sm" : "text-text-3",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
