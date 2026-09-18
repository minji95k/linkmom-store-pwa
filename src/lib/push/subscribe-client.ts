"use client";

/** VAPID 공개키(base64url) → PushManager.subscribe가 요구하는 Uint8Array. 표준 변환 로직. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export type PushSupportStatus = "unsupported" | "ios_not_installed" | "not_requested" | "granted" | "denied";

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

/**
 * 브라우저/설치 상태 기준의 현재 Push 상태를 판정한다(§5/§6). iOS Safari는 홈 화면
 * 설치(standalone) 전에는 Notification/PushManager 전역 자체가 없다 — 이 경우
 * "unsupported"가 아니라 "ios_not_installed"로 구분해 설치 안내를 보여준다.
 */
export function detectPushSupportStatus(): PushSupportStatus {
  if (typeof window === "undefined") return "unsupported";

  const hasCoreApis = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  if (!hasCoreApis) {
    return isIOS() && !isStandalone() ? "ios_not_installed" : "unsupported";
  }

  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return "not_requested";
}

/** 실제 구독 요청: Permission 요청 → PushManager.subscribe → 서버에 등록. */
export async function requestPushSubscription(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: permission === "denied" ? "denied" : "dismissed" };
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return { ok: false, reason: "vapid_key_missing" };
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!res.ok) {
    return { ok: false, reason: "server_error" };
  }

  return { ok: true };
}

/** 이 기기의 구독을 해제한다(§19: 사용자는 자기 Device Subscription만 등록/해제). */
export async function removePushSubscription(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
}
