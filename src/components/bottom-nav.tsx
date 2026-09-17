"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { createDebouncer } from "@/lib/realtime/debounce";
import { createRealtimeSubscription } from "@/lib/realtime/subscription";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const BADGE_COALESCE_WINDOW_MS = 600;

// Phase 9(Training Material System) SKIP 결정(2026-09-17)으로 [교육자료] 탭을 없앴다 —
// 교육 목적 공지는 notice_type='교육'으로 Notice 탭에 통합됐다(CLAUDE.md 참조).
const NAV_ITEMS = [
  { href: "/", label: "홈", icon: HomeIcon },
  { href: "/promotions", label: "프로모션", icon: TagIcon },
  { href: "/notices", label: "공지", icon: BellIcon },
  { href: "/my", label: "MY", icon: UserIcon },
] as const;

/** "/promotions/PROD-1" 같은 하위 경로에서도 "프로모션" 탭이 활성 표시되어야 한다. */
function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Phase 10: Bottom Nav 공지 뱃지 실시간화. `initialUnreadNoticeCount`는 이 Layout이
 * Server Component로 렌더될 때마다(페이지 이동 시 매번, staff 페이지가 전부
 * `dynamic = "force-dynamic"`이라 매 요청 재실행됨) RLS 기준으로 새로 계산된 값이다.
 * 여기에 더해, 화면을 이동하지 않고 그대로 머무는 동안에도 `notices` 테이블 변경을
 * 구독해 뱃지가 갱신되도록 한다 — Realtime payload 자체로 대상 여부를 판단하지 않고
 * "무언가 바뀌었다"는 신호로만 쓰고, 실제 카운트는 항상 `/api/notices/unread-count`
 * (세션 쿠키 기반, RLS 적용)로 재조회한다. 이미 읽은 공지는 notice_reads 행이 그대로
 * 남아있으므로 내용이 수정돼도 다시 unread로 잡히지 않는다(Phase 8 semantics 그대로).
 */
export function BottomNav({ initialUnreadNoticeCount = 0 }: { initialUnreadNoticeCount?: number }) {
  const pathname = usePathname();
  const [unreadNoticeCount, setUnreadNoticeCount] = useState(initialUnreadNoticeCount);
  // 페이지 이동으로 Layout이 새 값을 내려주면 그 값을 우선한다 — effect의 setState 대신
  // "이전 렌더의 prop을 기억해뒀다가 렌더링 중에 조정"하는 React 공식 패턴을 쓴다
  // (effect 안에서 곧바로 setState하면 리렌더가 한 번 더 발생해 react-hooks/set-state-in-effect가
  // 경고한다 — https://react.dev/learn/you-might-not-need-an-effect).
  const [prevInitialCount, setPrevInitialCount] = useState(initialUnreadNoticeCount);
  if (initialUnreadNoticeCount !== prevInitialCount) {
    setPrevInitialCount(initialUnreadNoticeCount);
    setUnreadNoticeCount(initialUnreadNoticeCount);
  }

  useEffect(() => {
    let cancelled = false;

    const refetchCount = () => {
      fetch("/api/notices/unread-count", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { count?: number } | null) => {
          if (!cancelled && data && typeof data.count === "number") {
            setUnreadNoticeCount(data.count);
          }
        })
        .catch(() => {
          // 네트워크 오류 시 조용히 무시 — 다음 이벤트나 다음 페이지 이동이 다시 시도한다.
        });
    };

    const debouncer = createDebouncer(BADGE_COALESCE_WINDOW_MS, refetchCount);
    const supabase = createClient();
    const subscription = createRealtimeSubscription(
      supabase,
      "bottom-nav-notice-count",
      [
        { table: "notices", event: "INSERT" },
        { table: "notices", event: "UPDATE" },
      ],
      () => debouncer.trigger(),
    );

    return () => {
      cancelled = true;
      debouncer.cancel();
      subscription.dispose();
    };
  }, []);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-md items-stretch justify-between px-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-bold",
                active ? "text-purple" : "text-text-3",
              )}
            >
              <span className="relative">
                <Icon className="h-5 w-5" active={active} />
                {item.href === "/notices" && unreadNoticeCount > 0 && (
                  <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
                    {unreadNoticeCount > 99 ? "99+" : unreadNoticeCount}
                  </span>
                )}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function HomeIcon({ className, active }: { className?: string; active?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1v-8.5Z"
        stroke="currentColor"
        strokeWidth={active ? 2 : 1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TagIcon({ className, active }: { className?: string; active?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M11.5 4H5a1 1 0 0 0-1 1v6.5a1 1 0 0 0 .3.7l9 9a1 1 0 0 0 1.4 0l7-7a1 1 0 0 0 0-1.4l-9-9a1 1 0 0 0-.7-.3Z"
        stroke="currentColor"
        strokeWidth={active ? 2 : 1.6}
        strokeLinejoin="round"
      />
      <circle cx="8.2" cy="8.2" r="1.3" fill="currentColor" />
    </svg>
  );
}

function BellIcon({ className, active }: { className?: string; active?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M6 10.5a6 6 0 1 1 12 0v3.7l1.5 2.8H4.5L6 14.2v-3.7Z"
        stroke="currentColor"
        strokeWidth={active ? 2 : 1.6}
        strokeLinejoin="round"
      />
      <path d="M10 19.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth={active ? 2 : 1.6} />
    </svg>
  );
}

function UserIcon({ className, active }: { className?: string; active?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="8.2" r="3.2" stroke="currentColor" strokeWidth={active ? 2 : 1.6} />
      <path
        d="M4.8 20c1-3.4 4-5.3 7.2-5.3s6.2 1.9 7.2 5.3"
        stroke="currentColor"
        strokeWidth={active ? 2 : 1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}
