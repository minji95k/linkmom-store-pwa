"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export interface RealtimeWatch {
  table: "promotions" | "event_campaigns" | "notices";
  event?: "INSERT" | "UPDATE" | "*";
  /** PostgREST 스타일 단일 컬럼 필터, 예: `id=eq.<uuid>`. 생략하면 테이블 전체 변경을 구독한다. */
  filter?: string;
}

/**
 * Phase 10 §11: 데이터가 바뀌었다고 화면을 자동으로 바꾸거나 스크롤을 리셋하지 않는다.
 * 배너를 띄우고, 사용자가 [새로고침]을 눌렀을 때만 `router.refresh()`로 현재 페이지의
 * Server Component 데이터를 다시 가져온다 — 이 앱은 검색/필터/페이지네이션이 전부
 * 서버 쿼리 기준이라, Realtime payload를 클라이언트에서 직접 머지하면 그 상태와
 * 어긋날 위험이 크다. Realtime은 "새 데이터가 있다"는 신호로만 쓰고, 실제 데이터는
 * 항상 RLS가 적용된 서버 재조회로 가져온다.
 *
 * ⚠️ 실측으로 확인한 함정: `createBrowserClient`는 쿠키에서 세션을 비동기로 읽는다.
 * `channel.subscribe()`를 세션 로드보다 먼저 호출하면 Realtime 소켓이 anon 권한으로
 * 인증돼버려(구독 자체는 SUBSCRIBED로 "성공"한 것처럼 보이지만) RLS가 모든 행을
 * 막아 이벤트가 전혀 안 온다 — 겉보기엔 정상 구독인데 실제로는 조용히 아무것도 못
 * 받는 상태라 발견하기 어렵다. `supabase.auth.getSession()`으로 먼저 세션을 확보해
 * `supabase.realtime.setAuth(token)`을 명시적으로 호출한 뒤에만 구독한다.
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
    // 채널 이름에 매 마운트마다 고유한 접미사를 붙인다 — 같은 이름의 채널이 이미
    // 존재하는 상태에서 다시 subscribe하면 Supabase가 기존 채널을 재사용/충돌시킬 수
    // 있어(예: 빠른 페이지 이동 중 언마운트-마운트가 겹치는 경우), 항상 새 topic으로
    // 만들고 cleanup에서 정확히 그 채널만 제거한다(중복 구독 방지).
    const channel = supabase.channel(`${channelName}:${crypto.randomUUID()}`);

    for (const watch of watchesRef.current) {
      channel.on(
        "postgres_changes",
        {
          event: watch.event ?? "*",
          schema: "public",
          table: watch.table,
          filter: watch.filter,
        },
        () => setHasUpdate(true),
      );
    }

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) {
        await supabase.realtime.setAuth(session.access_token);
      }
      if (cancelled) return;
      channel.subscribe();
    })();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
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
