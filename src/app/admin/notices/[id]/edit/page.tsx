import Link from "next/link";
import { notFound } from "next/navigation";

import { DeleteAttachmentButton } from "@/components/admin/delete-attachment-button";
import { NoticeForm } from "@/components/admin/notice-form";
import { NoticeAudienceSummaryCard } from "@/components/admin/notice-audience-summary";
import { updateNoticeAction } from "@/app/admin/notices/actions";
import { getAttachmentsForNotice, getNoticeAudienceSummary } from "@/lib/notices/queries";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function EditNoticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: notice }, { data: targets }, { data: stores }, summary, attachments] = await Promise.all([
    supabase.from("notices").select("*").eq("id", id).maybeSingle(),
    supabase.from("notice_targets").select("*").eq("notice_id", id),
    supabase.from("stores").select("id, name").eq("is_active", true).order("name"),
    getNoticeAudienceSummary(supabase, id),
    getAttachmentsForNotice(id),
  ]);

  if (!notice) notFound();

  const targetRows = targets ?? [];
  const initialValues = {
    title: notice.title,
    body: notice.body,
    notice_type: notice.notice_type,
    is_pinned: notice.is_pinned,
    requires_confirmation: notice.requires_confirmation,
    external_link: notice.external_link,
    published_at: notice.published_at,
    expires_at: notice.expires_at,
    targetAll: targetRows.some((t) => t.target_type === "all"),
    targetStoreIds: targetRows.filter((t) => t.target_type === "store").map((t) => t.store_id!),
    targetRoles: targetRows.filter((t) => t.target_type === "role").map((t) => t.role!) as UserRole[],
  };

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <Link href="/admin/notices" className="text-xs font-bold text-text-3">
        ← 공지 목록
      </Link>
      <h1 className="text-lg font-black">공지 수정</h1>

      <NoticeAudienceSummaryCard summary={summary} requiresConfirmation={notice.requires_confirmation} />

      {attachments.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
          <p className="text-xs font-bold text-text-2">첨부파일</p>
          {attachments.map((a) => (
            <div key={a.id} className="flex items-center justify-between text-sm">
              <a href={a.url ?? "#"} target="_blank" rel="noopener noreferrer" className="truncate text-text hover:underline">
                📎 {a.storage_path.split("/").pop()}
              </a>
              <DeleteAttachmentButton noticeId={id} attachmentId={a.id} storagePath={a.storage_path} />
            </div>
          ))}
        </div>
      )}

      <NoticeForm
        action={updateNoticeAction.bind(null, id)}
        stores={stores ?? []}
        initialValues={initialValues}
        submitLabel="수정 저장"
      />
    </main>
  );
}
