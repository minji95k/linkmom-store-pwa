"use client";

import { useEffect } from "react";

/**
 * Phase 11 §17: PWA App Badge. Bottom Nav 공지 뱃지(모든 미확인 공지)와 역할을
 * 분리한다 — App Badge는 "중요(critical) 미확인 Notification" 개수만 표시한다
 * (getUnreadCriticalNotificationCount, 페이지 이동 시 SSR로 재계산된 값을 그대로
 * 받는다 — Phase 11 최소 기능 범위라 별도 Realtime 구독은 두지 않는다).
 */
export function AppBadgeSync({ count }: { count: number }) {
  useEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    const nav = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (count > 0) {
      nav.setAppBadge?.(count).catch(() => {});
    } else {
      nav.clearAppBadge?.().catch(() => {});
    }
  }, [count]);

  return null;
}
