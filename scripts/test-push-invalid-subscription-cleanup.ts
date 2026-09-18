/**
 * Phase 11 §18: "유효하지 않은 Push Subscription은 자동으로 비활성화" 판정 로직
 * (src/lib/push/classify-error.ts)을 실 webpush/네트워크 없이 검증한다.
 * src/lib/push/create-notification.ts는 이 결과가 "expired"일 때만
 * deactivateSubscription을 호출한다(코드 리뷰로 대조 확인 — 순수 판정 로직 자체는
 * 여기서 직접 테스트한다).
 *
 * 실행: npm run test:push-invalid-subscription-cleanup (환경변수/DB 불필요)
 */
import { classifyPushSendError } from "../src/lib/push/classify-error";

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

record("410(Gone) → expired(비활성화 대상)", classifyPushSendError(410) === "expired");
record("404(Not Found) → expired(비활성화 대상)", classifyPushSendError(404) === "expired");
record("500(서버 오류) → failed(구독 유지, 재시도 여지)", classifyPushSendError(500) === "failed");
record("429(Rate Limit) → failed(구독 유지)", classifyPushSendError(429) === "failed");
record("statusCode 없음(네트워크 오류 등) → failed(구독 유지)", classifyPushSendError(undefined) === "failed");
record("400(Bad Request) → failed(엔드포인트 자체 문제가 아님)", classifyPushSendError(400) === "failed");
record("401(인증 오류, VAPID 키 문제 등) → failed(구독 문제 아님, 죽이면 안 됨)", classifyPushSendError(401) === "failed");

console.log("\n요약:", results.filter((r) => r.pass).length, "/", results.length, "PASS");
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error("\n실패한 테스트:");
  for (const f of failed) console.error(` - ${f.name} (${f.detail ?? ""})`);
  process.exit(1);
}
process.exit(0);
