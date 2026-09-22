/**
 * Service Worker(public/sw.js)의 notificationclick → postMessage({type, url})로 전달된
 * url이 실제로 안전한 내부 상대 경로인지 검증한다. 이 앱이 지원하는 모든 내부 딥링크는
 * "/"로 시작하는 상대 경로("/notices/...", "/promotions/..." 등)이므로, "//"(프로토콜
 * 상대 URL)나 절대 URL(https://... 등)은 외부 사이트로 이동할 수 있으니 전부 "/"로
 * 대체한다(2026-09-22 iOS PWA Background 딥링크 수정 시 도입).
 *
 * public/sw.js는 이 프로젝트의 빌드 파이프라인 밖에 있는 정적 파일이라(등록된 브라우저가
 * 그대로 실행, TS를 import할 수 없음 — Apps Script(.gs)와 같은 제약) 이 함수를 그쪽에서
 * 직접 import할 수 없다. sw.js 안에 동일 로직을 손으로 복제해뒀다 — 어느 한쪽을 고치면
 * 반드시 다른 쪽도 같이 고칠 것.
 */
export function sanitizeInternalUrl(url: unknown): string {
  if (typeof url !== "string") return "/";
  if (!url.startsWith("/") || url.startsWith("//")) return "/";
  return url;
}
