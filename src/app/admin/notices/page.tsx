import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { NoticeTypeBadge } from "@/components/notices/notice-badge";
import { formatDateTimeKST } from "@/lib/format";
import { getNoticeAudienceSummary } from "@/lib/notices/queries";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminNoticesPage() {
  const supabase = await createClient();
  const { data: notices } = await supabase
    .from("notices")
    .select("*")
    .order("is_pinned", { ascending: false })
    .order("published_at", { ascending: false });

  const rows = await Promise.all(
    (notices ?? []).map(async (n) => ({ notice: n, summary: await getNoticeAudienceSummary(supabase, n.id) })),
  );

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-black">공지 관리</h1>
        <Link href="/admin/notices/new" className={cn(buttonVariants({ variant: "primary", size: "sm" }))}>
          + 새 공지
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-text-3">등록된 공지가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map(({ notice, summary }) => (
            <Card key={notice.id} className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {notice.is_pinned && <Badge variant="solid">📌 고정</Badge>}
                    <NoticeTypeBadge type={notice.notice_type} />
                    {notice.requires_confirmation && notice.notice_type !== "필독" && (
                      <Badge variant="purple">필독</Badge>
                    )}
                  </div>
                  <p className="font-bold text-text">{notice.title}</p>
                  <p className="text-xs text-text-3">
                    {formatDateTimeKST(notice.published_at)}
                    {notice.expires_at && ` ~ ${formatDateTimeKST(notice.expires_at)}`}
                  </p>
                </div>
                <Link
                  href={`/admin/notices/${notice.id}/edit`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  수정
                </Link>
              </div>

              <div className="flex flex-wrap gap-3 border-t border-border pt-2 text-xs text-text-2">
                <span>대상 {summary.targetCount}명</span>
                <span>읽음 {summary.readCount}명</span>
                <span>미열람 {summary.unreadCount}명</span>
                {notice.requires_confirmation && (
                  <>
                    <span>확인완료 {summary.confirmedCount}명</span>
                    <span>미확인 {summary.unconfirmedCount}명</span>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
