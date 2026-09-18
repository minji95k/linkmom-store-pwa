"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDateTimeKST } from "@/lib/format";
import type { NotificationWithReadStatus } from "@/lib/notifications/queries";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = {
  notice: "공지",
  promotion_change: "프로모션",
  summary: "요약",
};

const IMPORTANCE_BADGE_VARIANT: Record<string, "danger" | "purple" | "neutral"> = {
  critical: "danger",
  important: "purple",
  minor: "neutral",
};

export function NotificationListItem({ notification }: { notification: NotificationWithReadStatus }) {
  const isUnread = !notification.myRead;

  return (
    <Link
      href={notification.deep_link}
      onClick={() => {
        // 읽음 처리는 실패해도 이동을 막지 않는다 — fire-and-forget(keepalive로 페이지
        // 이동 중에도 요청이 끊기지 않게 한다).
        fetch(`/api/notifications/${notification.id}/read`, { method: "POST", keepalive: true }).catch(() => {});
      }}
    >
      <Card className="flex flex-col gap-1.5 active:bg-bg">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={IMPORTANCE_BADGE_VARIANT[notification.importance] ?? "neutral"}>
            {TYPE_LABEL[notification.type] ?? notification.type}
          </Badge>
          {isUnread && (
            <span className="ml-auto flex items-center gap-1 text-[11px] font-bold text-danger">
              <span className="h-1.5 w-1.5 rounded-full bg-danger" />
              NEW
            </span>
          )}
        </div>
        <p className={cn("text-[15px]", isUnread ? "font-bold text-text" : "font-medium text-text-2")}>
          {notification.title}
        </p>
        <p className="whitespace-pre-wrap text-sm text-text-2">{notification.body}</p>
        <span className="text-xs text-text-3">{formatDateTimeKST(notification.created_at)}</span>
      </Card>
    </Link>
  );
}
