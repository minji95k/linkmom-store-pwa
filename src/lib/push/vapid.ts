import "server-only";

import webpush from "web-push";

let configured = false;

/**
 * web-push 모듈에 VAPID 키를 1회만 설정한다(모듈 top-level에서 매 호출마다 설정하면
 * 불필요하게 반복 호출된다). VAPID_PRIVATE_KEY는 여기서만 읽는다 — 클라이언트
 * 번들에는 NEXT_PUBLIC_VAPID_PUBLIC_KEY만 노출된다(CLAUDE.md 절대 원칙 12).
 */
export function ensureVapidConfigured(): void {
  if (configured) return;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    throw new Error("VAPID 키(NEXT_PUBLIC_VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT)가 설정되지 않았습니다.");
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export { webpush };
