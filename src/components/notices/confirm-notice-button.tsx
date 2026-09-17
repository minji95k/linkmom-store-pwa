"use client";

import { useTransition } from "react";

import { confirmNoticeAction } from "@/app/(staff)/notices/[id]/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ConfirmNoticeButton({ noticeId, confirmed }: { noticeId: string; confirmed: boolean }) {
  const [isPending, startTransition] = useTransition();

  if (confirmed) {
    return <Badge variant="mint">✅ 확인 완료</Badge>;
  }

  return (
    <Button
      variant="primary"
      className="w-full"
      disabled={isPending}
      onClick={() => startTransition(() => confirmNoticeAction(noticeId))}
    >
      {isPending ? "처리 중..." : "확인 완료"}
    </Button>
  );
}
