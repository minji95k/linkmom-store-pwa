/**
 * `createRealtimeSubscription`(src/lib/realtime/subscription.ts — RealtimeUpdateBanner와
 * Bottom Nav 공지 뱃지가 공유하는 구독 생명주기 핵심 로직)의 mount/unmount/재진입/rerender
 * 시나리오를 실 DB·브라우저 없이 검증한다.
 *
 * Apps Script 트리거 생명주기를 in-memory mock으로 격리 테스트한 것과 같은 패턴
 * (CLAUDE.md "onEdit 즉시 반영 Trigger 도입" 절 참조)이지만, 이 로직은 순수 TS라 Node에서
 * 실제 프로덕션 코드를 그대로 import해서 테스트한다 — Apps Script(.gs)처럼 별도 언어 런타임에
 * 묶여 있지 않으므로 복제본을 따로 만들 필요가 없다(로직이 갈라질 위험 자체가 없음).
 *
 * 실행: npm run test:realtime-lifecycle (환경변수/DB 불필요)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createRealtimeSubscription, type RealtimeWatch } from "../src/lib/realtime/subscription";
import type { Database } from "../src/types/database";

// ---- Supabase Realtime 클라이언트의 최소 in-memory mock ----------------------------
class MockChannel {
  subscribeCalls = 0;
  onFilters: { event: string; table: string; filter?: string }[] = [];
  private handlers: (() => void)[] = [];

  constructor(public readonly name: string) {}

  on(_type: string, filter: { event: string; table: string; filter?: string }, cb: () => void) {
    this.onFilters.push(filter);
    this.handlers.push(cb);
    return this;
  }

  subscribe() {
    this.subscribeCalls++;
    return this;
  }

  fire() {
    for (const h of this.handlers) h();
  }
}

class MockSupabase {
  channels: MockChannel[] = [];
  removedChannels: MockChannel[] = [];
  removeChannelCalls = 0;
  /** 브라우저의 비동기 세션 로드를 흉내 낸다 — 0보다 크면 dispose가 먼저 도착할 수 있다. */
  getSessionDelayMs = 0;
  sessionToken: string | null = "fake-session-token";
  setAuthCalls = 0;

  channel(name: string) {
    const ch = new MockChannel(name);
    this.channels.push(ch);
    return ch;
  }

  removeChannel(ch: MockChannel) {
    this.removeChannelCalls++;
    this.removedChannels.push(ch);
    this.channels = this.channels.filter((c) => c !== ch);
    return Promise.resolve("ok");
  }

  auth = {
    getSession: async () => {
      if (this.getSessionDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.getSessionDelayMs));
      }
      return { data: { session: this.sessionToken ? { access_token: this.sessionToken } : null } };
    },
  };

  realtime = {
    setAuth: async (_token: string) => {
      this.setAuthCalls++;
    },
  };

  /** removeChannel되지 않고 남아있는(=stale일 수 있는) 채널 수. */
  get liveChannelCount() {
    return this.channels.length;
  }
}

function asClient(mock: MockSupabase): SupabaseClient<Database> {
  return mock as unknown as SupabaseClient<Database>;
}

const WATCHES: RealtimeWatch[] = [{ table: "notices", event: "*" }];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  // 1) mount 시 channel 생성 + 정상 구독(subscribe) -----------------------------------
  {
    const mock = new MockSupabase();
    createRealtimeSubscription(asClient(mock), "test-mount", WATCHES, () => {});
    await sleep(20);
    record("1. mount 시 channel 정확히 1개 생성", mock.channels.length === 1, String(mock.channels.length));
    record("1. mount 시 subscribe 정확히 1회 호출", mock.channels[0]?.subscribeCalls === 1, String(mock.channels[0]?.subscribeCalls));
    record("1. mount 시 setAuth 먼저 호출(getSession→setAuth→subscribe 순서)", mock.setAuthCalls === 1, String(mock.setAuthCalls));
  }

  // 2) unmount 시 removeChannel + stale channel 없음 ----------------------------------
  {
    const mock = new MockSupabase();
    const sub = createRealtimeSubscription(asClient(mock), "test-unmount", WATCHES, () => {});
    await sleep(20);
    sub.dispose();
    record("2. unmount 시 removeChannel 정확히 1회", mock.removeChannelCalls === 1, String(mock.removeChannelCalls));
    record("2. unmount 후 live channel 0개(stale 없음)", mock.liveChannelCount === 0, String(mock.liveChannelCount));

    // dispose를 중복 호출해도(예: React StrictMode 이중 실행) removeChannel이 더 늘지 않는다.
    sub.dispose();
    record("2. dispose 중복 호출해도 removeChannel 추가 호출 없음(idempotent)", mock.removeChannelCalls === 1, String(mock.removeChannelCalls));
  }

  // 3) 빠른 Route 전환 — 세션 로드가 끝나기 전에 unmount되면 subscribe 자체를 안 한다 -------
  {
    const mock = new MockSupabase();
    mock.getSessionDelayMs = 50; // 세션 로드가 느린 상황을 흉내
    const sub = createRealtimeSubscription(asClient(mock), "test-fast-transition", WATCHES, () => {});
    const channel = mock.channels[0]; // dispose가 즉시 channels 배열에서 제거하므로 미리 참조를 잡아둔다
    sub.dispose(); // 세션 로드 완료 전에 즉시 unmount
    await sleep(100); // 세션 로드가 뒤늦게 끝나도 subscribe가 실행되면 안 된다
    record("3. 빠른 Route 전환 — 세션 로드 전 unmount 시 subscribe 안 함", channel?.subscribeCalls === 0, String(channel?.subscribeCalls));
    record("3. 빠른 Route 전환 — removeChannel은 정상 호출됨", mock.removeChannelCalls === 1, String(mock.removeChannelCalls));
    record("3. 빠른 Route 전환 — live channel 0개", mock.liveChannelCount === 0, String(mock.liveChannelCount));
  }

  // 4) 같은 Route 재진입 — mount→unmount→mount, 채널이 누적되지 않는다 -------------------
  {
    const mock = new MockSupabase();
    const sub1 = createRealtimeSubscription(asClient(mock), "test-reenter", WATCHES, () => {});
    await sleep(20);
    const firstChannelName = mock.channels[0]?.name;
    sub1.dispose();

    const sub2 = createRealtimeSubscription(asClient(mock), "test-reenter", WATCHES, () => {});
    await sleep(20);
    const secondChannelName = mock.channels[0]?.name;
    record("4. 재진입 시 채널명이 매번 고유함(uuid 접미사)", firstChannelName !== secondChannelName, `${firstChannelName} vs ${secondChannelName}`);
    record("4. 재진입 후에도 live channel 1개만 존재(누적 없음)", mock.liveChannelCount === 1, String(mock.liveChannelCount));
    sub2.dispose();
    record("4. 재진입분까지 정리 후 live channel 0개", mock.liveChannelCount === 0, String(mock.liveChannelCount));
  }

  // 5) rerender(같은 컴포넌트 인스턴스 유지, dispose/재mount 없음) — 재구독 없음 -----------
  {
    const mock = new MockSupabase();
    createRealtimeSubscription(asClient(mock), "test-rerender", WATCHES, () => {});
    await sleep(20);
    const subscribeCallsAfterMount = mock.channels[0]?.subscribeCalls;
    // React 컴포넌트가 리렌더돼도 effect deps(channelName)가 안 바뀌면 이 함수 자체가
    // 다시 호출되지 않는다 — 여기서는 "아무 것도 다시 안 불러도 상태가 그대로"임을 확인한다.
    await sleep(20);
    record(
      "5. rerender(재호출 없음) 후에도 channel 1개·subscribe 1회 유지",
      mock.channels.length === 1 && mock.channels[0]?.subscribeCalls === subscribeCallsAfterMount,
      `channels=${mock.channels.length}, subscribeCalls=${mock.channels[0]?.subscribeCalls}`,
    );
  }

  // 6) 동일 컴포넌트 여러 번 mount/unmount(스트레스) — 매번 정확히 정리됨 ------------------
  {
    const mock = new MockSupabase();
    const cycles = 5;
    for (let i = 0; i < cycles; i++) {
      const sub = createRealtimeSubscription(asClient(mock), "test-stress", WATCHES, () => {});
      await sleep(10);
      sub.dispose();
    }
    record(`6. ${cycles}회 연속 mount/unmount 후 live channel 0개`, mock.liveChannelCount === 0, String(mock.liveChannelCount));
    record(`6. ${cycles}회 연속 mount/unmount 후 removeChannel 호출 횟수 = mount 횟수`, mock.removeChannelCalls === cycles, String(mock.removeChannelCalls));
  }

  // 7) 서로 다른 channelName의 동시 구독 — 하나를 dispose해도 다른 하나는 살아있는다 --------
  {
    const mock = new MockSupabase();
    const subA = createRealtimeSubscription(asClient(mock), "test-concurrent-a", WATCHES, () => {});
    const subB = createRealtimeSubscription(asClient(mock), "test-concurrent-b", WATCHES, () => {});
    await sleep(20);
    subA.dispose();
    record("7. 동시 구독 중 하나만 dispose — live channel 1개(다른 구독 영향 없음)", mock.liveChannelCount === 1, String(mock.liveChannelCount));
    subB.dispose();
    record("7. 나머지도 dispose 후 live channel 0개", mock.liveChannelCount === 0, String(mock.liveChannelCount));
  }

  // 8) 중복 구독 방지 — watches에 여러 테이블을 줘도 channel은 여전히 1개 -------------------
  {
    const mock = new MockSupabase();
    const multiWatches: RealtimeWatch[] = [
      { table: "notices", event: "*" },
      { table: "promotions", event: "*" },
      { table: "event_campaigns", event: "UPDATE" },
    ];
    createRealtimeSubscription(asClient(mock), "test-multi-watch", multiWatches, () => {});
    await sleep(20);
    record("8. 여러 테이블을 watch해도 channel은 1개(중복 구독 없음)", mock.channels.length === 1, String(mock.channels.length));
    record("8. watch한 테이블 수만큼 on() 필터가 등록됨", mock.channels[0]?.onFilters.length === 3, String(mock.channels[0]?.onFilters.length));
  }

  console.log("\n요약:", results.filter((r) => r.pass).length, "/", results.length, "PASS");
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error("\n실패한 테스트:");
    for (const f of failed) console.error(` - ${f.name} (${f.detail ?? ""})`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
