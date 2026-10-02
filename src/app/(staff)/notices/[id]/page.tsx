import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AttachmentList } from "@/components/notices/attachment-list";
import { ConfirmNoticeButton } from "@/components/notices/confirm-notice-button";
import { NoticeTypeBadge } from "@/components/notices/notice-badge";
import { RealtimeUpdateBanner } from "@/components/realtime/realtime-update-banner";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { formatDateTimeKST } from "@/lib/format";
import { getAttachmentsForNotice, getNoticeForStaffDetail, markNoticeRead } from "@/lib/notices/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NoticeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const currentUser = (await getCurrentUser())!;
  const supabase = await createClient();

  // RLS가 대상/게시기간을 이미 걸렀다 — null이면 "없음"과 "권한 없음"을 구분하지
  // 않고 그냥 404로 처리한다(Promotion 상세와 동일한 원칙, §14).
  const result = await getNoticeForStaffDetail(supabase, id, currentUser.id);
  if (!result) notFound();
  const { notice, myRead } = result;

  // 목록에 노출된 것만으로는 읽음 처리하지 않는다 — 상세를 실제로 연 이 순간에만 기록한다(§7).
  // 2026-10-02 실측 버그 대응: 이 읽음 기록은 부가 효과일 뿐이다 — 이게 실패해도(RLS
  // 정책 변경 등 예상 못 한 사유로) 이미 RLS를 통과해 가져온 공지 본문 자체를 못 보여줄
  // 이유는 없다. 실패를 조용히 삼키지 않고 서버 로그에는 남긴다.
  if (!myRead) {
    try {
      await markNoticeRead(supabase, id, currentUser.id);
    } catch (error) {
      console.error(`markNoticeRead 실패 (noticeId=${id}, userId=${currentUser.id}):`, error);
    }
  }

  const attachments = await getAttachmentsForNotice(id);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6 pb-4">
      <Link href="/notices" className="text-xs font-bold text-text-3">
        ← 공지 목록
      </Link>

      <RealtimeUpdateBanner
        channelName={`notice-detail-${notice.id}`}
        watches={[{ table: "notices", event: "UPDATE", filter: `id=eq.${notice.id}` }]}
        label="이 공지 내용이 수정되었습니다."
      />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {notice.is_pinned && <Badge variant="solid">📌 고정</Badge>}
          <NoticeTypeBadge type={notice.notice_type} />
          {notice.requires_confirmation && notice.notice_type !== "필독" && <Badge variant="purple">필독</Badge>}
        </div>
        <h1 className="text-xl font-black text-text">{notice.title}</h1>
        <p className="text-xs text-text-3">
          {notice.author_name ?? "본사"} · {formatDateTimeKST(notice.published_at)}
        </p>
      </div>

      <Card>
        <CardContent className="whitespace-pre-wrap pt-1 text-sm text-text">{notice.body}</CardContent>
      </Card>

      {notice.external_link && (
        <a
          href={notice.external_link}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl border border-border bg-card p-3 text-center text-sm font-bold text-purple-dark hover:bg-bg"
        >
          🔗 외부 링크 열기
        </a>
      )}

      <AttachmentList attachments={attachments} />

      {notice.requires_confirmation && (
        <ConfirmNoticeButton noticeId={notice.id} confirmed={!!myRead?.confirmed_at} />
      )}
    </main>
  );
}
