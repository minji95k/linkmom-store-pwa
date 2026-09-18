// 링크맘 매장 운영 PWA — Service Worker
//
// 원칙 (docs/architecture.md §7, CLAUDE.md 절대 원칙 11):
// - 앱 셸(정적 자산)만 캐시한다.
// - 프로모션/가격 등 실제 데이터를 담는 API 응답은 오래된 캐시가 보이지 않도록
//   캐시하지 않고 항상 네트워크에서 가져온다 (Network Only).
// - 새 버전 배포 시 즉시 활성화되어 사용자가 새로고침만 하면 최신 앱 셸을 받는다.

const CACHE_VERSION = "app-shell-v1";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  // API/데이터 요청: 캐시를 절대 사용하지 않는다 (가격·프로모션 최신성 보장).
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // 정적 앱 셸 자산: Stale-While-Revalidate.
  if (APP_SHELL.includes(url.pathname) || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached ?? network;
      }),
    );
    return;
  }

  // 그 외 모든 경로(페이지 내비게이션 포함): Network First, 실패 시 홈으로 대체.
  event.respondWith(
    fetch(request).catch(() => caches.match("/").then((res) => res ?? Response.error())),
  );
});

// ---------------------------------------------------------------------------
// Phase 11: Web Push. 앱이 Background/종료 상태일 때만 의미가 있다 — Foreground에서는
// Phase 10 Realtime Banner가 이미 알려주므로(push-design.md §8, §15) Service Worker는
// "지금 이 페이지가 떠 있는지"를 구분하지 않고 항상 OS 알림을 띄운다. 중복 노출을
// 완전히 막으려면 클라이언트가 Foreground 여부를 SW에 알려야 하는데, 그건 이 범위를
// 넘는 복잡도라 Phase 11에서는 "Realtime Banner + OS 알림이 동시에 뜰 수 있음"을
// 감수한다(Foreground에서 알림을 못 보는 것보다 안전한 쪽).
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  const { title, body, deepLink, notificationId } = payload;
  if (!title) return;

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body ?? "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: notificationId ?? undefined, // 같은 notification의 중복 표시를 자연스럽게 합친다.
      data: { url: deepLink ?? "/" },
    }),
  );
});

// 클릭 시 Deep Link로 이동한다(§14). 이미 열려있는 탭이 있으면 그 탭을 포커스+이동,
// 없으면 새 탭을 연다 — 로그인 안 돼 있으면 proxy.ts가 /login?next=<deepLink>로
// 알아서 보내고, 로그인 후 next 파라미터로 원래 위치에 복귀한다(이미 구현돼 있음,
// 이 Service Worker는 그냥 deepLink로 이동시키기만 하면 된다).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) return client.navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
