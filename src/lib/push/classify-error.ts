/**
 * 410(Gone)/404(Not Found)는 이 endpoint가 더 이상 유효하지 않다는 뜻이라 "expired"로
 * 구분한다(push-design.md §13 "유효하지 않은 Subscription은 자동으로 비활성화") — 그 외
 * 실패(네트워크 오류/5xx 등)는 일시적일 수 있어 구독을 죽이지 않는다. "server-only" 없이
 * 순수하게 분리해 실제 webpush/네트워크 없이 격리 테스트할 수 있게 한다
 * (`scripts/test-push-invalid-subscription-cleanup.ts`).
 */
export function classifyPushSendError(statusCode: number | undefined): "expired" | "failed" {
  return statusCode === 404 || statusCode === 410 ? "expired" : "failed";
}
