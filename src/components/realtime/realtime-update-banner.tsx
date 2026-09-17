"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createDebouncer } from "@/lib/realtime/debounce";
import { createRealtimeSubscription, type RealtimeWatch } from "@/lib/realtime/subscription";
import { createClient } from "@/lib/supabase/client";

export type { RealtimeWatch };

/** 짧은 시간에 여러 이벤트가 몰려도 Banner 상태 변경은 1회로 합친다(§debounce). */
const COALESCE_WINDOW_MS = 600;

/**
 * Phase 10: 데이터가 바뀌었다고 화면을 자동으로 바꾸거나 스크롤을 리셋하지 않는다.
 * Banner를 띄우고, 사용자가 [새로고침]을 눌렀을 때만 `router.refresh()`로 현재 페이지의
 * Server Component 데이터를 다시 가져온다 — 이 앱은 검색/필터/페이지네이션이 전부
 * 서버 쿼리 기준이라, Realtime payload를 클라이언트에서 직접 머지하면 그 상태와
 * 어긋날 위험이 크다. Realtime은 "새 데이터가 있다"는 신호로만 쓰고, 실제 데이터는
 * 항상 RLS가 적용된 서버 재조회로 가져온다.
 *
 * 구독 생명주기(mount/unmount/재구독 방지)는 `createRealtimeSubscription`으로 분리했고
 * `scripts/test-realtime-subscription-lifecycle.ts`가 mock 클라이언트로 자동 검증한다.
 */
export function RealtimeUpdateBanner({
  watches,
  channelName,
  label = "새로운 정보가 업데이트되었습니다.",
}: {
  watches: RealtimeWatch[];
  channelName: string;
  label?: string;
}) {
  const router = useRouter();
  const [hasUpdate, setHasUpdate] = useState(false);
  // watches는 이 컴포넌트가 살아있는 동안 바뀌지 않는다고 가정한다(호출부가 페이지별로
  // 고정된 값을 넘긴다) — effect 의존성 배열에는 channelName만 넣는다.
  const watchesRef = useRef(watches);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    const debouncer = createDebouncer(COALESCE_WINDOW_MS, () => {
      if (!cancelled) setHasUpdate(true);
    });

    const subscription = createRealtimeSubscription(supabase, channelName, watchesRef.current, () => {
      debouncer.trigger();
    });

    return () => {
      cancelled = true;
      debouncer.cancel();
      subscription.dispose();
    };
  }, [channelName]);

  if (!hasUpdate) return null;

  return (
    <div className="sticky top-0 z-30 flex items-center justify-between gap-3 rounded-xl border border-purple bg-purple-tint px-3 py-2 text-xs font-bold text-purple-dark shadow-sm">
      <span>{label}</span>
      <Button
        type="button"
        size="sm"
        variant="primary"
        onClick={() => {
          setHasUpdate(false);
          router.refresh();
        }}
      >
        새로고침
      </Button>
    </div>
  );
}
