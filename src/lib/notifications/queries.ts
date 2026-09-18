import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;
type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];
type NotificationReadRow = Database["public"]["Tables"]["notification_reads"]["Row"];

export interface NotificationWithReadStatus extends NotificationRow {
  myRead: Pick<NotificationReadRow, "read_at"> | null;
}

/**
 * Notification Center 목록(§16). notice_reads/notices 패턴과 동일하게 RLS
 * (`notification_visible_to_current_user`)가 대상을 이미 걸러주므로, 여기서는
 * "내가 읽었는지"만 별도 조회해 합친다.
 */
export async function getNotificationsForStaff(supabase: Client, userId: string): Promise<NotificationWithReadStatus[]> {
  const { data: notifications, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;

  const ids = (notifications ?? []).map((n) => n.id);
  let reads: NotificationReadRow[] = [];
  if (ids.length > 0) {
    const { data } = await supabase.from("notification_reads").select("*").eq("user_id", userId).in("notification_id", ids);
    reads = data ?? [];
  }
  const readByNotification = new Map(reads.map((r) => [r.notification_id, r]));

  return (notifications ?? []).map((n) => ({ ...n, myRead: readByNotification.get(n.id) ?? null }));
}

export async function getUnreadNotificationCount(supabase: Client, userId: string): Promise<number> {
  const { data: notifications } = await supabase.from("notifications").select("id");
  const ids = (notifications ?? []).map((n) => n.id);
  if (ids.length === 0) return 0;

  const { data: reads } = await supabase
    .from("notification_reads")
    .select("notification_id")
    .eq("user_id", userId)
    .in("notification_id", ids);
  const readIds = new Set((reads ?? []).map((r) => r.notification_id));
  return ids.filter((id) => !readIds.has(id)).length;
}

/** §17 App Badge 기준: critical 중요도 미확인 건수만("중요 미확인 Notification Count"). */
export async function getUnreadCriticalNotificationCount(supabase: Client, userId: string): Promise<number> {
  const { data: notifications } = await supabase.from("notifications").select("id").eq("importance", "critical");
  const ids = (notifications ?? []).map((n) => n.id);
  if (ids.length === 0) return 0;

  const { data: reads } = await supabase
    .from("notification_reads")
    .select("notification_id")
    .eq("user_id", userId)
    .in("notification_id", ids);
  const readIds = new Set((reads ?? []).map((r) => r.notification_id));
  return ids.filter((id) => !readIds.has(id)).length;
}

export async function markNotificationRead(supabase: Client, notificationId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("notification_reads")
    .upsert({ notification_id: notificationId, user_id: userId }, { onConflict: "notification_id,user_id", ignoreDuplicates: true });
  if (error) throw error;
}
