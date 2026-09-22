/**
 * public/sw.js의 notificationclick 핸들러(2026-09-22 iOS PWA Background 딥링크 수정)와
 * src/lib/push/deep-link-guard.ts의 sanitizeInternalUrl()을 검증한다.
 *
 * public/sw.js는 이 프로젝트의 빌드 파이프라인 밖에 있는 정적 파일이라 일반 import가
 * 안 된다 — Node의 vm 모듈로 self/clients/caches를 최소한으로 mock한 샌드박스에서
 * 그 소스 코드를 그대로 실행해, 실제 배포되는 파일 자체를 대상으로 테스트한다(복제본이
 * 아니라 진짜 프로덕션 파일 — Apps Script(.gs)를 Node mock으로 흉내 냈던 것과 같은
 * 패턴이지만, 이 파일은 순수 JS라 소스 자체를 그대로 돌릴 수 있다는 점이 다르다).
 *
 * 실행: npm run test:push-deep-link-navigation (환경변수/DB 불필요)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

import { sanitizeInternalUrl } from "../src/lib/push/deep-link-guard";

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

// ---- sanitizeInternalUrl 순수 함수 테스트 -------------------------------------------
record("1. Notice URL은 그대로 통과 — /notices/abc-123", sanitizeInternalUrl("/notices/abc-123") === "/notices/abc-123");
record(
  "2. Promotion URL은 그대로 통과 — /promotions/PROD-000123",
  sanitizeInternalUrl("/promotions/PROD-000123") === "/promotions/PROD-000123",
);
record("3. 절대 외부 URL은 차단됨 — https://evil.com → /", sanitizeInternalUrl("https://evil.com") === "/");
record("4. 프로토콜 상대 URL(//evil.com)도 차단됨 → /", sanitizeInternalUrl("//evil.com") === "/");
record("5. 문자열이 아니거나 없음 → /", sanitizeInternalUrl(undefined) === "/" && sanitizeInternalUrl(null) === "/");
record("6. 빈 문자열 → /(내부 상대경로 아님)", sanitizeInternalUrl("") === "/");

// ---- public/sw.js를 실제로 로드해 notificationclick 핸들러를 검증 --------------------
const swSource = readFileSync(join(import.meta.dirname, "..", "public", "sw.js"), "utf-8");

function makeSandbox(matchAllResult: any[]) {
  const calls: { openWindow: string[]; matchAllArgs: any[] } = { openWindow: [], matchAllArgs: [] };
  const listeners: Record<string, (event: any) => void> = {};

  const sandbox: any = {
    console,
    self: {
      addEventListener: (type: string, handler: (event: any) => void) => {
        listeners[type] = handler;
      },
      skipWaiting: () => {},
      registration: { showNotification: () => Promise.resolve() },
      clients: {
        matchAll: (args: any) => {
          calls.matchAllArgs.push(args);
          return Promise.resolve(matchAllResult);
        },
        openWindow: (url: string) => {
          calls.openWindow.push(url);
          return Promise.resolve(null);
        },
        claim: () => Promise.resolve(),
      },
    },
    caches: {
      open: () => Promise.resolve({ addAll: () => Promise.resolve(), match: () => Promise.resolve(undefined), put: () => {} }),
      keys: () => Promise.resolve([]),
      delete: () => Promise.resolve(true),
      match: () => Promise.resolve(undefined),
    },
    fetch: () => Promise.reject(new Error("not used in this test")),
  };
  vm.createContext(sandbox);
  vm.runInContext(swSource, sandbox, { filename: "sw.js" });
  return { sandbox, calls, listeners };
}

function makeClient(opts: { focusDelayMs?: number } = {}) {
  const calls: { focus: number; postMessage: any[] } = { focus: 0, postMessage: [] };
  const order: string[] = [];
  return {
    calls,
    order,
    client: {
      focus: async () => {
        calls.focus += 1;
        order.push("focus");
        if (opts.focusDelayMs) await new Promise((r) => setTimeout(r, opts.focusDelayMs));
      },
      postMessage: (msg: any) => {
        calls.postMessage.push(msg);
        order.push("postMessage");
      },
    },
  };
}

async function triggerNotificationClick(listeners: Record<string, (event: any) => void>, dataUrl: unknown) {
  let waited: Promise<unknown> = Promise.resolve();
  const event = {
    notification: { close: () => {}, data: { url: dataUrl } },
    waitUntil: (p: Promise<unknown>) => {
      waited = p;
    },
  };
  const handler = listeners.notificationclick;
  if (!handler) throw new Error("notificationclick 리스너가 등록되지 않았습니다");
  handler(event);
  await waited;
}

async function main() {
  // 7) 기존 window 없음 → openWindow(sanitized url), postMessage/focus 없음 -----------
  {
    const { calls, listeners } = makeSandbox([]);
    await triggerNotificationClick(listeners, "/notices/abc-123");
    record(
      "7. 기존 window 없음 — openWindow(url) 호출, postMessage 없음",
      calls.openWindow.length === 1 && calls.openWindow[0] === "/notices/abc-123",
      JSON.stringify(calls),
    );
  }

  // 8) 기존 window 있음 → focus 먼저, 그 다음 postMessage(NOTIFICATION_CLICK) — navigate() 없음 --
  {
    const { client, calls: clientCalls, order } = makeClient({ focusDelayMs: 5 });
    const { calls, listeners } = makeSandbox([client]);
    await triggerNotificationClick(listeners, "/notices/abc-123");
    record(
      "8. 기존 window 있음 — focus 1회 후 postMessage 1회(순서 보장), openWindow는 호출 안 함",
      clientCalls.focus === 1 &&
        clientCalls.postMessage.length === 1 &&
        clientCalls.postMessage[0].type === "NOTIFICATION_CLICK" &&
        clientCalls.postMessage[0].url === "/notices/abc-123" &&
        order[0] === "focus" &&
        order[1] === "postMessage" &&
        calls.openWindow.length === 0,
      JSON.stringify({ clientCalls, order, openWindow: calls.openWindow }),
    );
  }

  // 9) Notice URL — sw.js 내부에서도 그대로 보존됨 -------------------------------------
  {
    const { client, calls: clientCalls } = makeClient();
    const { listeners } = makeSandbox([client]);
    await triggerNotificationClick(listeners, "/notices/79541658-279a-44f0-8937-edfecf100c36");
    record(
      "9. Notice deep link가 postMessage에 그대로 전달됨",
      clientCalls.postMessage[0]?.url === "/notices/79541658-279a-44f0-8937-edfecf100c36",
    );
  }

  // 10) Promotion URL — sw.js 내부에서도 그대로 보존됨(Phase 11 회귀 없음) -----------------
  {
    const { client, calls: clientCalls } = makeClient();
    const { listeners } = makeSandbox([client]);
    await triggerNotificationClick(listeners, "/promotions/PROD-000123");
    record(
      "10. Promotion deep link가 postMessage에 그대로 전달됨(Phase 11 회귀 없음)",
      clientCalls.postMessage[0]?.url === "/promotions/PROD-000123",
    );
  }

  // 11) 외부 URL — sw.js 내부에서 이미 "/"로 막힘(openWindow 경로) -----------------------
  {
    const { calls, listeners } = makeSandbox([]);
    await triggerNotificationClick(listeners, "https://evil.com/phish");
    record("11. 외부 URL(openWindow 경로) — /로 차단됨", calls.openWindow[0] === "/", JSON.stringify(calls));
  }
  {
    const { client, calls: clientCalls } = makeClient();
    const { listeners } = makeSandbox([client]);
    await triggerNotificationClick(listeners, "//evil.com/phish");
    record(
      "12. 프로토콜 상대 외부 URL(postMessage 경로) — /로 차단됨",
      clientCalls.postMessage[0]?.url === "/",
      JSON.stringify(clientCalls),
    );
  }

  // 13) data.url 자체가 없는 경우(payload 누락) — "/"로 안전하게 대체 -------------------
  {
    const { calls, listeners } = makeSandbox([]);
    await triggerNotificationClick(listeners, undefined);
    record("13. url 누락 — /로 대체", calls.openWindow[0] === "/");
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
