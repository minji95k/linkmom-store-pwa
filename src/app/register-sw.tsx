"use client";

import { useEffect } from "react";

/**
 * layout.tsx에서 마운트되는 client component.
 * production 빌드에서만 Service Worker를 등록한다 (dev에서는 HMR과 충돌 방지).
 */
export function RegisterServiceWorker() {
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

  return null;
}
