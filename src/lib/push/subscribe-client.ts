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

// "이 기기 알림 끄기"를 명시적으로 누른 적이 있는지 이 기기에만 기록한다(§7 self-heal
// 안전장치). Notification.permission은 사용자가 명시적으로 해제해도 "granted"로 남아있는
// OS 값이라 그것만으로는 "해제했다"는 의도를 표현할 수 없다 — 이 플래그가 없으면 self-heal이
// 방금 끈 알림을 permission=granted라는 이유만으로 곧장 되살려버린다(2026-09-22 Pilot 진단
// 중 검토된 회귀 위험). 기기별 로컬 편의값이라 localStorage로 충분하고, 못 쓰는 환경(private
// mode 등)에서는 조용히 무시한다 — 그 경우 self-heal이 조금 더 적극적으로 동작할 뿐이다.
const OPT_OUT_STORAGE_KEY = "linkmom-push-opted-out";

function readOptOutFlag(): boolean {
  try {
    return window.localStorage.getItem(OPT_OUT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOptOutFlag(optedOut: boolean): void {
  try {
    if (optedOut) window.localStorage.setItem(OPT_OUT_STORAGE_KEY, "1");
    else window.localStorage.removeItem(OPT_OUT_STORAGE_KEY);
  } catch {
    // 저장소를 못 쓰는 환경 — 무시(치명적이지 않음, 위 주석 참고).
  }
}

async function registerSubscriptionWithServer(subscription: PushSubscription): Promise<boolean> {
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  return res.ok;
}

/**
 * permission이 이미 "granted"인 상태를 전제로, 로컬 구독과 서버 등록 상태가 어긋나 있으면
 * 되돌린다(self-healing, 2026-09-22 Production Pilot에서 "Client=활성/서버 DB=0건"이 실제로
 * 재현되어 도입). 기존 로컬 구독이 있으면 재사용해 서버로 다시 보내기만 하고(새 endpoint를
 * 만들지 않음), 없으면 이미 허용된 permission으로 추가 prompt 없이 새로 구독한다. 사용자가
 * 이 기기에서 명시적으로 껐다면(opted-out) 아무것도 하지 않는다 — permission=granted라는
 * 사실만으로 무조건 재구독하지 않는다(§7).
 */
export async function ensurePushSubscription(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (Notification.permission !== "granted") return { ok: false, reason: "not_granted" };
  if (readOptOutFlag()) return { ok: false, reason: "opted_out" };

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) return { ok: false, reason: "vapid_key_missing" };

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const ok = await registerSubscriptionWithServer(subscription);
  return ok ? { ok: true } : { ok: false, reason: "server_error" };
}

/** [알림 받기] 버튼: Permission 요청 → (허용되면) ensurePushSubscription으로 구독+서버 등록. */
export async function requestPushSubscription(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: permission === "denied" ? "denied" : "dismissed" };
  }
  writeOptOutFlag(false); // 사용자가 다시 명시적으로 켰으므로 이전 opt-out 기록은 해제한다.
  return ensurePushSubscription();
}

/** 이 기기의 구독을 해제한다(§19: 사용자는 자기 Device Subscription만 등록/해제). */
export async function removePushSubscription(): Promise<void> {
  writeOptOutFlag(true); // self-heal이 다시 되살리지 않도록 가장 먼저 기록한다.

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
