import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NoticeTypeBadge } from "@/components/notices/notice-badge";
import type { NoticeWithReadStatus } from "@/lib/notices/queries";
import { cn } from "@/lib/utils";

/** 홈에는 "지금 확인해야 할" 것만 요약한다(§10) — 전체 목록은 공지 탭에서 본다. */
export function HomeNoticeSummary({ notices }: { notices: NoticeWithReadStatus[] }) {
  if (notices.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>확인이 필요한 공지</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {notices.map((n) => (
          <Link
            key={n.id}
            href={`/notices/${n.id}`}
            className="flex items-center gap-2 rounded-xl border border-border bg-bg px-3 py-2"
          >
            <NoticeTypeBadge type={n.notice_type} />
            <span className="flex-1 truncate text-sm font-bold text-text">{n.title}</span>
          </Link>
        ))}
        <Link href="/notices" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-end")}>
          공지 전체보기 →
        </Link>
      </CardContent>
    </Card>
  );
}
