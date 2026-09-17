import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export interface RealtimeWatch {
  table: "promotions" | "event_campaigns" | "notices";
  event?: "INSERT" | "UPDATE" | "*";
  /** PostgREST 스타일 단일 컬럼 필터, 예: `id=eq.<uuid>`. 생략하면 테이블 전체 변경을 구독한다. */
  filter?: string;
}

/**
 * `RealtimeUpdateBanner`/Bottom Nav 뱃지가 공유하는 구독 생명주기 핵심 로직.
 * React에 의존하지 않는 순수 함수로 분리해뒀다 — `scripts/test-realtime-subscription-lifecycle.ts`가
 * mock Supabase 클라이언트로 mount/unmount/rerender 시나리오를 직접 호출해 검증한다
 * (Apps Script 트리거 생명주기를 in-memory mock으로 격리 테스트한 것과 같은 패턴, CLAUDE.md 참조).
 *
 * ⚠️ 실측으로 확인한 함정: `createBrowserClient`는 쿠키에서 세션을 비동기로 읽는다.
 * `channel.subscribe()`를 세션 로드보다 먼저 호출하면 Realtime 소켓이 anon 권한으로
 * 인증돼버려(구독 자체는 SUBSCRIBED로 "성공"한 것처럼 보이지만) RLS가 모든 행을 막아
 * 이벤트가 전혀 안 온다. `supabase.auth.getSession()`으로 먼저 세션을 확보해
 * `supabase.realtime.setAuth(token)`을 명시적으로 호출한 뒤에만 구독한다.
 */
export function createRealtimeSubscription(
  supabase: SupabaseClient<Database>,
  channelName: string,
  watches: RealtimeWatch[],
  onChange: () => void,
): { dispose: () => void } {
  let cancelled = false;
  // 채널 이름에 매 호출마다 고유한 접미사를 붙인다 — 같은 이름의 채널이 이미 존재하는
  // 상태에서 다시 subscribe하면 Supabase가 기존 채널을 재사용/충돌시킬 수 있어(예: 빠른
  // 페이지 이동 중 언마운트-마운트가 겹치는 경우), 항상 새 topic으로 만들고 dispose에서
  // 정확히 그 채널만 제거한다(중복 구독 방지).
  const channel = supabase.channel(`${channelName}:${crypto.randomUUID()}`);

  for (const watch of watches) {
    channel.on(
      "postgres_changes",
      {
        event: watch.event ?? "*",
        schema: "public",
        table: watch.table,
        filter: watch.filter,
      },
      onChange,
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

  return {
    dispose() {
      // 세션 로드를 기다리는 중에 dispose가 먼저 불리면(빠른 라우트 전환) cancelled로
      // 이후 setAuth/subscribe를 막고, removeChannel은 정확히 1회만 호출한다.
      if (cancelled) return;
      cancelled = true;
      supabase.removeChannel(channel);
    },
  };
}
