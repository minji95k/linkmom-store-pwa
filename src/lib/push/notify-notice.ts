import "server-only";

import { isNoticeCurrentlyPublished } from "@/lib/notices/datetime";
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

  // 최소 안전장치(2026-09-22 Production 실측 버그 대응): notice_targets/RLS의
  // notice_visible_to_current_user()는 published_at<=now<expires_at(게시 기간)까지
  // 확인하는데, 이 Push 경로는 지금까지 그 조건을 전혀 보지 않고 "생성 즉시" 발송했다
  // — 관리자 실수(또는 예약 발행)로 published_at이 미래인 공지도 Push가 먼저 나가버려
  // "Push는 왔는데 공지 상세/목록은 없다"는 상태가 실제로 재현됐다. 예약 발행 시각 도달 시
  // 자동으로 Push를 보내주는 Scheduler는 이번 범위에 없다(Backlog) — 여기서는 "아직 게시
  // 시각이 안 됐거나 이미 만료된 공지의 조기/사후 Push를 막는" 최소 방어만 추가한다.
  const { data: notice } = await service.from("notices").select("published_at, expires_at").eq("id", noticeId).single();
  if (!notice || !isNoticeCurrentlyPublished(notice)) return;

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
