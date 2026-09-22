/**
 * `ensurePushSubscription`/`requestPushSubscription`/`removePushSubscription`
 * (src/lib/push/subscribe-client.ts) self-healing 로직의 순수 로직 테스트.
 *
 * 2026-09-22 Production Pilot에서 "Notification.permission=granted인데 서버
 * push_subscriptions는 0건"인 상태가 실제로 재현됐다 — 로컬 구독 존재 여부/서버 등록
 * 성공 여부를 UI가 전혀 구분하지 못했기 때문이다. 이 파일은 그 self-heal 로직을
 * 실 브라우저 없이 Notification/ServiceWorker/PushManager/fetch/localStorage를
 * in-memory mock으로 흉내 내 검증한다(Realtime 구독 생명주기 테스트와 같은 패턴 —
 * 이 모듈은 순수 TS라 실제 프로덕션 코드를 그대로 import한다).
 *
 * 실행: npm run test:push-self-heal (환경변수/DB 불필요)
 */

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

type FetchCall = { method: string; endpoint?: string };

function makeSubscription(endpoint: string, onUnsubscribe: () => void) {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "p256dh-mock", auth: "auth-mock" } }),
    unsubscribe: async () => {
      onUnsubscribe();
      return true;
    },
  };
}

/** 매 테스트마다 전역 브라우저 API를 새로 깐다 — 테스트 간 상태가 새어나가지 않게 한다. */
function setupMocks(opts: {
  permission: "default" | "granted" | "denied";
  existingSubscriptionEndpoint?: string | null;
  subscribeThrows?: boolean;
  fetchOk?: boolean;
  storageThrows?: boolean;
}) {
  const fetchCalls: FetchCall[] = [];
  let subscribeCallCount = 0;
  let currentSubscription: ReturnType<typeof makeSubscription> | null =
    opts.existingSubscriptionEndpoint != null
      ? makeSubscription(opts.existingSubscriptionEndpoint, () => {
          currentSubscription = null;
        })
      : null;

  const pushManager = {
    getSubscription: async () => currentSubscription,
    subscribe: async () => {
      subscribeCallCount += 1;
      if (opts.subscribeThrows) throw new Error("subscribe failed");
      currentSubscription = makeSubscription(`https://push.example.com/sub-${subscribeCallCount}`, () => {
        currentSubscription = null;
      });
      return currentSubscription;
    },
  };

  const registration = { pushManager };
  const storage = new Map<string, string>();

  // Node 전역에는 navigator/fetch가 이미 getter-only로 존재할 수 있어(Node 18+) 단순
  // 대입이 아니라 defineProperty로 덮어써야 한다.
  const define = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });

  define("window", globalThis);
  define("navigator", {
    serviceWorker: { ready: Promise.resolve(registration) },
    userAgent: "iPhone",
  });
  define("Notification", {
    permission: opts.permission,
    requestPermission: async () => opts.permission,
  });
  define(
    "localStorage",
    opts.storageThrows
      ? {
          getItem() {
            throw new Error("storage unavailable");
          },
          setItem() {
            throw new Error("storage unavailable");
          },
          removeItem() {
            throw new Error("storage unavailable");
          },
        }
      : {
          getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
          setItem: (k: string, v: string) => {
            storage.set(k, v);
          },
          removeItem: (k: string) => {
            storage.delete(k);
          },
        },
  );

  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "BFhEmockKeyMockKeyMockKeyMockKeyMockKeyMockKeyMockKeyMockKeyMockKeyMockKeyMockKe";

  define("fetch", async (_url: string, init?: { method?: string; body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    fetchCalls.push({ method: init?.method ?? "GET", endpoint: body?.endpoint });
    return { ok: opts.fetchOk !== false };
  });

  return {
    fetchCalls,
    storage,
    getSubscribeCallCount: () => subscribeCallCount,
    getCurrentSubscription: () => currentSubscription,
  };
}

async function main() {
  const mod = await import("../src/lib/push/subscribe-client");

  // 1) permission=default(not_requested) — 자동 subscribe 없음 ----------------------
  {
    const mocks = setupMocks({ permission: "default" });
    const result = await mod.ensurePushSubscription();
    record(
      "1. permission=default — ensurePushSubscription은 아무 것도 하지 않는다",
      !result.ok && result.reason === "not_granted" && mocks.getSubscribeCallCount() === 0 && mocks.fetchCalls.length === 0,
      JSON.stringify(result),
    );
  }

  // 2) permission=denied — 자동 subscribe 없음 --------------------------------------
  {
    const mocks = setupMocks({ permission: "denied" });
    const result = await mod.ensurePushSubscription();
    record(
      "2. permission=denied — ensurePushSubscription은 아무 것도 하지 않는다",
      !result.ok && result.reason === "not_granted" && mocks.getSubscribeCallCount() === 0 && mocks.fetchCalls.length === 0,
      JSON.stringify(result),
    );
  }

  // 3) granted + 기존 local subscription 있음 — 재사용, 새 구독 생성 없이 서버 등록 1회 ---
  {
    const mocks = setupMocks({ permission: "granted", existingSubscriptionEndpoint: "https://push.example.com/existing" });
    const result = await mod.ensurePushSubscription();
    record(
      "3. granted + 기존 구독 있음 — subscribe() 재호출 없이 기존 endpoint로 서버 등록 1회",
      result.ok === true &&
        mocks.getSubscribeCallCount() === 0 &&
        mocks.fetchCalls.length === 1 &&
        mocks.fetchCalls[0]!.method === "POST" &&
        mocks.fetchCalls[0]!.endpoint === "https://push.example.com/existing",
      JSON.stringify({ result, fetchCalls: mocks.fetchCalls, subscribeCalls: mocks.getSubscribeCallCount() }),
    );
  }

  // 4) granted + local subscription 없음 — subscribe() 1회 생성 + 서버 등록 1회 ---------
  {
    const mocks = setupMocks({ permission: "granted", existingSubscriptionEndpoint: null });
    const result = await mod.ensurePushSubscription();
    record(
      "4. granted + 구독 없음 — subscribe() 1회 생성 후 서버 등록 1회",
      result.ok === true && mocks.getSubscribeCallCount() === 1 && mocks.fetchCalls.length === 1,
      JSON.stringify({ result, fetchCalls: mocks.fetchCalls, subscribeCalls: mocks.getSubscribeCallCount() }),
    );
  }

  // 5) 서버 등록 실패 — 오류 상태 반환, 함수 내부에서 자동 재시도(반복 호출) 없음 -----------
  {
    const mocks = setupMocks({ permission: "granted", existingSubscriptionEndpoint: "https://push.example.com/existing", fetchOk: false });
    const result = await mod.ensurePushSubscription();
    record(
      "5. 서버 등록 실패 — ok:false, server_error, fetch는 정확히 1회만(내부 재시도 없음)",
      !result.ok && result.reason === "server_error" && mocks.fetchCalls.length === 1,
      JSON.stringify({ result, fetchCalls: mocks.fetchCalls }),
    );
  }

  // 6) 같은 mount 안에서 재호출(rerender 시뮬레이션) — 두 번째 호출은 새 구독을 또 안 만든다 --
  {
    const mocks = setupMocks({ permission: "granted", existingSubscriptionEndpoint: null });
    const first = await mod.ensurePushSubscription();
    const second = await mod.ensurePushSubscription();
    record(
      "6. 연속 두 번 호출해도 subscribe()는 최초 1회만, 서버 등록은 매 호출 시 기존 구독으로 재전송(중복 생성 없음)",
      first.ok && second.ok && mocks.getSubscribeCallCount() === 1 && mocks.fetchCalls.length === 2,
      JSON.stringify({ subscribeCalls: mocks.getSubscribeCallCount(), fetchCalls: mocks.fetchCalls }),
    );
  }

  // 7) unmount 후 재mount(새 mock 환경, 로컬 구독은 실제로는 유지됨을 흉내) — self-heal 재실행 가능 --
  {
    const mocks = setupMocks({ permission: "granted", existingSubscriptionEndpoint: "https://push.example.com/persisted" });
    const afterRemount = await mod.ensurePushSubscription();
    record(
      "7. unmount/remount 후에도(새 effect 실행) 기존 구독을 정상적으로 재등록한다",
      afterRemount.ok === true && mocks.getSubscribeCallCount() === 0 && mocks.fetchCalls.length === 1,
      JSON.stringify(afterRemount),
    );
  }

  // 8) 명시적 opt-out 상태에서는 permission=granted여도 재구독하지 않는다(§7 핵심) -----------
  {
    const mocks = setupMocks({ permission: "granted", existingSubscriptionEndpoint: null });
    mocks.storage.set("linkmom-push-opted-out", "1");
    const result = await mod.ensurePushSubscription();
    record(
      "8. 이 기기에서 명시적으로 껐으면(opted-out) self-heal이 재구독하지 않는다",
      !result.ok && result.reason === "opted_out" && mocks.getSubscribeCallCount() === 0 && mocks.fetchCalls.length === 0,
      JSON.stringify(result),
    );
  }

  // 9) removePushSubscription — opt-out 플래그를 기록하고, DELETE 요청 후 로컬 구독 해제 ---
  {
    const mocks = setupMocks({ permission: "granted", existingSubscriptionEndpoint: "https://push.example.com/to-remove" });
    await mod.removePushSubscription();
    const stillSubscribed = await mocks.getCurrentSubscription();
    record(
      "9. removePushSubscription — DELETE 1회 호출 + opt-out 플래그 기록 + 로컬 구독 해제",
      mocks.fetchCalls.length === 1 &&
        mocks.fetchCalls[0]!.method === "DELETE" &&
        mocks.storage.get("linkmom-push-opted-out") === "1" &&
        stillSubscribed === null,
      JSON.stringify({ fetchCalls: mocks.fetchCalls, optOut: mocks.storage.get("linkmom-push-opted-out") }),
    );
  }

  // 10) requestPushSubscription — 사용자가 [알림 받기]를 다시 누르면 opt-out을 해제하고 정상 등록 --
  {
    const mocks = setupMocks({ permission: "granted", existingSubscriptionEndpoint: null });
    mocks.storage.set("linkmom-push-opted-out", "1"); // 이전에 꺼둔 상태를 흉내
    const result = await mod.requestPushSubscription();
    record(
      "10. [알림 받기] 재클릭 — opt-out 해제 후 정상적으로 구독+서버 등록",
      result.ok === true && mocks.storage.get("linkmom-push-opted-out") === undefined && mocks.fetchCalls.length === 1,
      JSON.stringify({ result, optOut: mocks.storage.get("linkmom-push-opted-out"), fetchCalls: mocks.fetchCalls }),
    );
  }

  // 11) localStorage를 못 쓰는 환경(private mode 등)에서도 크래시 없이 self-heal이 동작 ------
  {
    const mocks = setupMocks({ permission: "granted", existingSubscriptionEndpoint: null, storageThrows: true });
    const result = await mod.ensurePushSubscription();
    record(
      "11. localStorage 접근 불가 환경에서도 크래시 없이 self-heal 진행(opt-out 확인은 무시하고 통과)",
      result.ok === true && mocks.getSubscribeCallCount() === 1,
      JSON.stringify(result),
    );
  }

  console.log("\n요약:", results.filter((r) => r.pass).length, "/", results.length, "PASS");
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error("\n실패한 테스트:");
    for (const f of failed) console.error(` - ${f.name} (${f.detail ?? ""})`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
