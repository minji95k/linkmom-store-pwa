import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, NotificationTargetType, UserRole } from "@/types/database";

type Client = SupabaseClient<Database>;

export interface PushTarget {
  targetType: NotificationTargetType;
  storeId?: string;
  role?: UserRole;
  userId?: string;
}

/**
 * notice_targets 해석 로직(notices/queries.ts의 getNoticeAudienceSummary)과 동일한
 * 패턴 — target 규칙(전체/매장/Role/개인)을 실제 active user_id 목록으로 풀어낸다.
 * push-design.md §6: "접근 권한 없는 데이터 관련 Push는 대상자 계산 단계에서 제외".
 */
export async function resolveTargetUserIds(service: Client, targets: PushTarget[]): Promise<string[]> {
  const userIds = new Set<string>();

  if (targets.some((t) => t.targetType === "all")) {
    const { data } = await service.from("profiles").select("id").eq("is_active", true);
    for (const u of data ?? []) userIds.add(u.id);
    return [...userIds];
  }

  const roles = targets.filter((t) => t.targetType === "role").map((t) => t.role!);
  if (roles.length > 0) {
    const { data } = await service.from("profiles").select("id").eq("is_active", true).in("role", roles);
    for (const u of data ?? []) userIds.add(u.id);
  }

  for (const t of targets) {
    if (t.targetType === "user" && t.userId) userIds.add(t.userId);
  }

  const storeIds = targets.filter((t) => t.targetType === "store").map((t) => t.storeId!);
  if (storeIds.length > 0) {
    const { data: access } = await service.from("user_store_access").select("user_id").in("store_id", storeIds);
    const candidateIds = [...new Set((access ?? []).map((a) => a.user_id))];
    if (candidateIds.length > 0) {
      const { data: activeUsers } = await service
        .from("profiles")
        .select("id")
        .eq("is_active", true)
        .in("id", candidateIds);
      for (const u of activeUsers ?? []) userIds.add(u.id);
    }
  }

  return [...userIds];
}

/** 대상 user_id들의 활성 Push Subscription 전체(User:Device 1:N). */
export async function getActiveSubscriptionsForUsers(
  service: Client,
  userIds: string[],
): Promise<Database["public"]["Tables"]["push_subscriptions"]["Row"][]> {
  if (userIds.length === 0) return [];
  const { data } = await service.from("push_subscriptions").select("*").in("user_id", userIds).eq("is_active", true);
  return data ?? [];
}
