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
