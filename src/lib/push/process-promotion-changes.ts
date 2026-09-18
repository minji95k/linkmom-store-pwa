import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";

import { groupByPromotionId, partitionByImportance, shouldSendImportantAsSummary, type EligibleLog } from "./batch";
import { createNotificationAndDeliver } from "./create-notification";
import {
  buildPromotionChangeBody,
  buildPromotionChangeTitle,
  buildSummaryBody,
  buildSummaryTitle,
  promotionDeepLink,
  shortFieldLabel,
  summaryDeepLink,
} from "./policy";

export type { EligibleLog };

/**
 * Sync API 호출(1회) 직후 매번 불린다 — 별도 cron/큐 없이, "이번 Sync가 만든
 * change_log들의 집합"을 그대로 Batching Window로 쓴다(push-design.md §5). Apps
 * Script가 이미 onEdit을 3초 디바운스로 묶어 한 번의 Sync 호출로 보내므로, 여기서
 * 다시 시간 기반 윈도우를 만들 필요가 없다 — "짧은 시간 내 다건 변경"이 이미 "1회
 * Sync 호출 안의 change_log 집합"으로 자연스럽게 표현된다.
 *
 * Sync API 응답 자체에는 영향을 주지 않는다(호출부가 결과를 무시하고 best-effort로
 * 부른다) — Push 처리가 실패해도 Apps Script/Sync 성공 여부는 전혀 바뀌지 않는다.
 */
export async function processPendingPromotionPush(): Promise<{ processed: number; notified: number }> {
  const service = createServiceRoleClient();

  const { data: settings } = await service.from("notification_settings").select("push_go_live_at").eq("id", 1).single();
  const goLiveAt = settings?.push_go_live_at;
  if (!goLiveAt) return { processed: 0, notified: 0 };

  // 이중 안전장치(push-design.md §3.2): importance != minor AND push_eligible AND
  // changed_at > go-live 세 조건을 전부 다시 확인한다(엔진이 이미 CHECK 제약/컬럼
  // 기본값으로 보장하지만, 여기서도 추측하지 않고 그대로 재확인한다).
  const { data: logs } = await service
    .from("promotion_change_logs")
    .select("id, promotion_id, product_id, changed_field, change_type, importance")
    .is("notification_id", null)
    .eq("push_eligible", true)
    .neq("importance", "minor")
    .gt("changed_at", goLiveAt)
    .order("changed_at", { ascending: true })
    .limit(500);

  const eligible = (logs ?? []) as EligibleLog[];
  if (eligible.length === 0) return { processed: 0, notified: 0 };

  const { critical, important } = partitionByImportance(eligible);

  let notified = 0;

  // critical(§13: "긴급공지/필독공지/critical 이벤트는 즉시 개별 발송") — 상품별로 묶어서
  // 각 상품 1건씩(같은 상품에 critical 필드가 2개 바뀌어도 그 상품은 1건).
  notified += await notifyEachProductIndividually(service, critical, "critical");

  // important는 "몇 개 상품이 바뀌었는지"로 갈린다(§13 핵심 요구사항: 다건은 Summary,
  // 단건은 §10 예시처럼 상품명이 보이는 개별 알림 — Summary 하나로 뭉뚱그리지 않는다).
  if (important.length > 0) {
    if (shouldSendImportantAsSummary(important)) {
      await notifySummary(service, important);
      notified += 1;
    } else {
      notified += await notifyEachProductIndividually(service, important, "important");
    }
  }

  return { processed: eligible.length, notified };
}

async function notifyEachProductIndividually(
  service: ReturnType<typeof createServiceRoleClient>,
  logs: EligibleLog[],
  importance: "critical" | "important",
): Promise<number> {
  let count = 0;
  for (const [promotionId, productLogs] of groupByPromotionId(logs)) {
    const notificationId = await notifyIndividualProductChange(service, promotionId, productLogs, importance);
    if (notificationId) count += 1;
  }
  return count;
}

/** 같은 상품(promotionId)에서 이번에 함께 바뀐 필드 전부를 1건의 알림으로 묶는다. */
async function notifyIndividualProductChange(
  service: ReturnType<typeof createServiceRoleClient>,
  promotionId: string,
  logs: EligibleLog[],
  importance: "critical" | "important",
): Promise<string | null> {
  const firstLog = logs[0];
  if (!firstLog) return null; // groupByPromotionId가 빈 그룹을 만들지 않으므로 사실상 도달 안 함 — 방어적 가드.

  const { data: promotion } = await service
    .from("promotions")
    .select("product_id, brand, product_name")
    .eq("id", promotionId)
    .maybeSingle();
  if (!promotion) return null;

  const fieldKeys = [...new Set(logs.map((l) => l.changed_field))];
  const { data: fieldDefs } = await service
    .from("promotion_field_definitions")
    .select("field_key, display_label")
    .in("field_key", fieldKeys);
  const labelByKey = new Map((fieldDefs ?? []).map((f) => [f.field_key, f.display_label]));
  const fieldLabels = fieldKeys.map((k) => shortFieldLabel(k, labelByKey.get(k) ?? k));

  const { notificationId } = await createNotificationAndDeliver({
    type: "promotion_change",
    title: buildPromotionChangeTitle(firstLog.change_type),
    body: buildPromotionChangeBody(promotion.brand, promotion.product_name, fieldLabels),
    importance,
    deepLink: promotionDeepLink(promotion.product_id),
    targets: [{ targetType: "all" }], // promotions는 현재 매장별로 분리되지 않는다(permissions.md §2) — 전체 대상.
  });

  const logIds = logs.map((l) => l.id);
  await service.from("promotion_change_logs").update({ notification_id: notificationId }).in("id", logIds);
  return notificationId;
}

async function notifySummary(service: ReturnType<typeof createServiceRoleClient>, logs: EligibleLog[]): Promise<void> {
  const promotionIds = [...new Set(logs.map((l) => l.promotion_id))];
  const { data: promotions } = await service.from("promotions").select("id, brand").in("id", promotionIds);
  const brands = [...new Set((promotions ?? []).map((p) => p.brand))];

  const { notificationId } = await createNotificationAndDeliver({
    type: "summary",
    title: buildSummaryTitle(),
    body: buildSummaryBody(brands, promotionIds.length),
    importance: "important",
    deepLink: summaryDeepLink(),
    targets: [{ targetType: "all" }],
  });

  const logIds = logs.map((l) => l.id);
  await service.from("promotion_change_logs").update({ notification_id: notificationId }).in("id", logIds);
}
