"use client";

import { useTransition } from "react";

import { deleteAttachmentAction } from "@/app/admin/notices/actions";

export function DeleteAttachmentButton({
  noticeId,
  attachmentId,
  storagePath,
}: {
  noticeId: string;
  attachmentId: string;
  storagePath: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(() => deleteAttachmentAction(noticeId, attachmentId, storagePath))}
      className="text-xs font-bold text-danger disabled:opacity-50"
    >
      삭제
    </button>
  );
}
