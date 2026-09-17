import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { NoticeTypeBadge } from "@/components/notices/notice-badge";
import { formatDateKST } from "@/lib/format";
import type { NoticeWithReadStatus } from "@/lib/notices/queries";
import { cn } from "@/lib/utils";

export function NoticeListItem({ notice }: { notice: NoticeWithReadStatus }) {
  const isUnread = !notice.myRead;
  const isUnconfirmedRequired = notice.requires_confirmation && !notice.myRead?.confirmed_at;

  return (
    <Link href={`/notices/${notice.id}`}>
      <Card className="flex flex-col gap-1.5 active:bg-bg">
        <div className="flex flex-wrap items-center gap-1.5">
          {notice.is_pinned && <Badge variant="solid">📌 고정</Badge>}
          <NoticeTypeBadge type={notice.notice_type} />
          {/* notice_type 자체가 "필독"이면 아래에서 이미 "필독"을 보여주므로 중복 표시하지 않는다. */}
          {notice.requires_confirmation && notice.notice_type !== "필독" && <Badge variant="purple">필독</Badge>}
          {isUnread && (
            <span className="ml-auto flex items-center gap-1 text-[11px] font-bold text-danger">
              <span className="h-1.5 w-1.5 rounded-full bg-danger" />
              NEW
            </span>
          )}
        </div>
        <p className={cn("text-[15px]", isUnread ? "font-bold text-text" : "font-medium text-text-2")}>
          {notice.title}
        </p>
        <div className="flex items-center gap-2 text-xs text-text-3">
          <span>{formatDateKST(notice.published_at)}</span>
          {isUnconfirmedRequired && <span className="font-bold text-warning">확인 필요</span>}
        </div>
      </Card>
    </Link>
  );
}
