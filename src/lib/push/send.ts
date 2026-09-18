import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import { classifyPushSendError } from "./classify-error";
import { ensureVapidConfigured, webpush } from "./vapid";

export { classifyPushSendError };

type Client = SupabaseClient<Database>;
type Subscription = Database["public"]["Tables"]["push_subscriptions"]["Row"];

export interface PushPayload {
  title: string;
  body: string;
  deepLink: string;
  notificationId: string;
}

export interface SendResult {
  status: "sent" | "failed" | "expired";
  errorMessage?: string;
}

/** 1건의 Subscription에 실제로 발송한다(오류 분류는 classify-error.ts 참조). */
export async function sendPushToSubscription(subscription: Subscription, payload: PushPayload): Promise<SendResult> {
  ensureVapidConfigured();

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        deepLink: payload.deepLink,
        notificationId: payload.notificationId,
      }),
    );
    return { status: "sent" };
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    const message = error instanceof Error ? error.message : String(error);
    return { status: classifyPushSendError(statusCode), errorMessage: message };
  }
}

export async function deactivateSubscription(service: Client, subscriptionId: string): Promise<void> {
  await service.from("push_subscriptions").update({ is_active: false }).eq("id", subscriptionId);
}
