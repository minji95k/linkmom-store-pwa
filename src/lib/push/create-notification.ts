import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { ChangeImportance, NotificationType } from "@/types/database";

import { deactivateSubscription, sendPushToSubscription } from "./send";
import { getActiveSubscriptionsForUsers, resolveTargetUserIds, type PushTarget } from "./targeting";

export interface CreateNotificationInput {
  type: NotificationType;
  title: string;
  body: string;
  importance: ChangeImportance;
  deepLink: string;
  targets: PushTarget[];
}

/**
 * Notification Center 항목(`notifications`+`notification_targets`) 생성 → 대상자의
 * 활성 Push Subscription에 실제 발송 → `notification_deliveries`에 결과 기록까지
 * 한 번에 수행한다. Service Role 전용(§19 — STAFF가 직접 호출할 수 없는 서버 전용
 * 경로 — Route Handler로도 노출하지 않고 서버 코드에서만 import해서 쓴다).
 */
export async function createNotificationAndDeliver(input: CreateNotificationInput): Promise<{
  notificationId: string;
  deliveredCount: number;
  failedCount: number;
}> {
  const service = createServiceRoleClient();

  const { data: notification, error: notificationError } = await service
    .from("notifications")
    .insert({ type: input.type, title: input.title, body: input.body, importance: input.importance, deep_link: input.deepLink })
    .select("id")
    .single();
  if (notificationError || !notification) {
    throw new Error(`notification 생성 실패: ${notificationError?.message}`);
  }
  const notificationId = notification.id;

  const targetRows = input.targets.map((t) => ({
    notification_id: notificationId,
    target_type: t.targetType,
    store_id: t.storeId ?? null,
    role: t.role ?? null,
    user_id: t.userId ?? null,
  }));
  const { error: targetsError } = await service.from("notification_targets").insert(targetRows);
  if (targetsError) throw new Error(`notification_targets 생성 실패: ${targetsError.message}`);

  const userIds = await resolveTargetUserIds(service, input.targets);
  const subscriptions = await getActiveSubscriptionsForUsers(service, userIds);

  let deliveredCount = 0;
  let failedCount = 0;

  for (const subscription of subscriptions) {
    const { data: delivery } = await service
      .from("notification_deliveries")
      .insert({ notification_id: notificationId, subscription_id: subscription.id, status: "requested" })
      .select("id")
      .single();

    const result = await sendPushToSubscription(subscription, {
      title: input.title,
      body: input.body,
      deepLink: input.deepLink,
      notificationId,
    });

    if (delivery) {
      await service
        .from("notification_deliveries")
        .update({
          status: result.status,
          error_message: result.errorMessage ?? null,
          sent_at: result.status === "sent" ? new Date().toISOString() : null,
        })
        .eq("id", delivery.id);
    }

    if (result.status === "sent") {
      deliveredCount += 1;
      await service.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("id", subscription.id);
    } else {
      failedCount += 1;
      // 410/404(만료 — 브라우저에서 구독이 완전히 해제된 경우)만 비활성화한다.
      // 그 외 "failed"(네트워크 일시 오류, Push 서비스 5xx 등)는 다음 발송에서
      // 다시 시도할 수 있어야 하므로 구독 자체를 죽이지 않는다(§18).
      if (result.status === "expired") {
        await deactivateSubscription(service, subscription.id);
      }
    }
  }

  return { notificationId, deliveredCount, failedCount };
}
