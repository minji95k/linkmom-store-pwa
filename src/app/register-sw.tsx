"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { sanitizeInternalUrl } from "@/lib/push/deep-link-guard";

/**
 * layout.tsx에서 마운트되는 client component.
 * production 빌드에서만 Service Worker를 등록한다 (dev에서는 HMR과 충돌 방지).
 */
export function RegisterServiceWorker() {
  const router = useRouter();

  useEffect(() => {
    if (
      process.env.NODE_ENV === "production" &&
      typeof window !== "undefined" &&
      "serviceWorker" in navigator
    ) {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.error("Service worker registration failed", error);
      });
    }
  }, []);

  // Push 알림 클릭 시 Service Worker(public/sw.js)가 navigate()를 직접 하지 않고
  // postMessage로 목적지 URL만 넘긴다(§3: iOS Standalone PWA가 Background에서 깨어난
  // 직후 WindowClient.navigate()가 route를 안정적으로 반영하지 못하는 문제를 실측 후
  // 우회 — 앱 자신의 Next.js Router가 이동을 수행하는 편이 더 안정적이다). 이 컴포넌트가
  // 앱 전체에 딱 1번(root layout) 마운트되므로 listener도 중복 없이 1번만 등록된다.
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    function handleMessage(event: MessageEvent) {
      if (event.data?.type !== "NOTIFICATION_CLICK") return;
      router.push(sanitizeInternalUrl(event.data.url));
    }

    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handleMessage);
    };
  }, [router]);

  return null;
}
