import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { NoticeType } from "@/types/database";

import { createNotificationAndDeliver } from "./create-notification";
import { buildNoticeBody, buildNoticeTitle, isNoticePushEligible, noticeDeepLink } from "./policy";
import type { PushTarget } from "./targeting";

/**
 * 신규 공지 생성 직후 Admin Server Action이 best-effort로 호출한다(§11: 긴급/중요/필독만
 * 대상, §12: "기존 Notice Targeting을 그대로 재사용" — notice_targets에 이미 저장된
 * 대상 규칙을 그대로 복사해 notification_targets를 만든다, 별도로 다시 계산하지 않는다).
 */
export async function notifyNoticeCreated(noticeId: string, noticeType: NoticeType, title: string): Promise<void> {
  if (!isNoticePushEligible(noticeType)) return;

  const service = createServiceRoleClient();
  const { data: noticeTargets } = await service
    .from("notice_targets")
    .select("target_type, store_id, role, user_id")
    .eq("notice_id", noticeId);
  if (!noticeTargets || noticeTargets.length === 0) return;

  const targets: PushTarget[] = noticeTargets.map((t) => ({
    targetType: t.target_type,
    storeId: t.store_id ?? undefined,
    role: t.role ?? undefined,
    userId: t.user_id ?? undefined,
  }));

  await createNotificationAndDeliver({
    type: "notice",
    title: buildNoticeTitle(noticeType),
    body: buildNoticeBody(title),
    importance: noticeType === "중요" ? "important" : "critical",
    deepLink: noticeDeepLink(noticeId),
    targets,
  });
}
