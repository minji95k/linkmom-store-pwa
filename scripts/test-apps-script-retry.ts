/**
 * apps-script/Sync.gs의 재시도 판정 로직(classifySyncFailure_/nextRetryDelayMs_) 단위 테스트.
 *
 * Google Apps Script(.gs)는 PropertiesService/UrlFetchApp/LockService 같은 Apps Script
 * 전용 전역 서비스에 의존하므로 Node에서 그 파일을 직접 import/실행할 수 없다. 그래서 이
 * 두 함수는 Apps Script 서비스에 전혀 의존하지 않는 순수 함수로 작성했고, 이 파일이 동일한
 * 로직을 그대로 복제해 Node에서 격리 테스트한다 — DB/네트워크/실제 Google Sheet를 전혀
 * 건드리지 않는다(2026-09-15 dev server 다운으로 onEdit 편집이 유실된 사고 이후 도입한
 * 재시도 로직의 검증 전략, docs/sync-design.md §11 참조).
 *
 * ⚠️ apps-script/Sync.gs의 classifySyncFailure_/nextRetryDelayMs_/RETRY_BACKOFF_MS를 고치면
 * 이 파일의 복제본도 반드시 함께 고칠 것 — 빌드 시스템이 없어 자동으로 동기화되지 않는다.
 *
 * 실행: npm run test:apps-script:retry (환경변수 불필요)
 */

// ---- apps-script/Sync.gs의 복제본 (동일 로직 유지 필수) ---------------------------
const RETRY_BACKOFF_MS = [15000, 30000, 60000];
const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;

interface ClassifyOpts {
  networkError?: boolean;
  jsonParseFailed?: boolean;
  httpStatus?: number;
}

function classifySyncFailure_(opts: ClassifyOpts): { retryable: boolean; reason: string } {
  if (opts.networkError) return { retryable: true, reason: "network" };
  if (opts.jsonParseFailed) return { retryable: true, reason: "bad_response" };
  const status = opts.httpStatus;
  if (status === 401 || status === 403) return { retryable: false, reason: "auth" };
  if (status === 409) return { retryable: false, reason: "guard_blocked" };
  if (status === 429) return { retryable: true, reason: "rate_limited" };
  if (typeof status === "number" && status >= 500) return { retryable: true, reason: "server_error" };
  return { retryable: false, reason: "client_error" };
}

function nextRetryDelayMs_(retryCount: number): number | null {
  if (retryCount < 1 || retryCount > RETRY_BACKOFF_MS.length) return null;
  return RETRY_BACKOFF_MS[retryCount - 1]!;
}
// ---- 복제본 끝 ------------------------------------------------------------------

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

// 1) 연결 실패(네트워크 예외) — 재시도 대상 (DEV localhost 다운 사고 재현) -----------------
{
  const r = classifySyncFailure_({ networkError: true });
  record("1. 연결 실패(network) — retryable=true", r.retryable && r.reason === "network", JSON.stringify(r));
}

// 2) 응답 파싱 실패(ngrok 경고 페이지 등) — 재시도 대상 -----------------------------------
{
  const r = classifySyncFailure_({ jsonParseFailed: true });
  record("2. 응답 파싱 실패(bad_response) — retryable=true", r.retryable && r.reason === "bad_response", JSON.stringify(r));
}

// 3) 5xx — 재시도 대상 ------------------------------------------------------------------
for (const status of [500, 502, 503]) {
  const r = classifySyncFailure_({ httpStatus: status });
  record(`3. ${status} — retryable=true(server_error)`, r.retryable && r.reason === "server_error", JSON.stringify(r));
}

// 4) 429 — 재시도 대상 ------------------------------------------------------------------
{
  const r = classifySyncFailure_({ httpStatus: 429 });
  record("4. 429 — retryable=true(rate_limited)", r.retryable && r.reason === "rate_limited", JSON.stringify(r));
}

// 5) 401/403 — 재시도 금지(인증 오류) ----------------------------------------------------
for (const status of [401, 403]) {
  const r = classifySyncFailure_({ httpStatus: status });
  record(`5. ${status} — retryable=false(auth)`, !r.retryable && r.reason === "auth", JSON.stringify(r));
}

// 6) 409 — 재시도 금지(안전장치 차단, destructive retry 금지) -----------------------------
{
  const r = classifySyncFailure_({ httpStatus: 409 });
  record("6. 409 — retryable=false(guard_blocked)", !r.retryable && r.reason === "guard_blocked", JSON.stringify(r));
}

// 7) 400 등 그 외 4xx — 재시도 금지(같은 payload면 다시 보내도 똑같이 실패) -------------------
{
  const r = classifySyncFailure_({ httpStatus: 400 });
  record("7. 400 — retryable=false(client_error)", !r.retryable && r.reason === "client_error", JSON.stringify(r));
}

// 8) 백오프 시퀀스 — 15초 → 30초 → 60초, 그 다음은 재시도 한도 초과(null) ---------------------
{
  const delays = [1, 2, 3].map(nextRetryDelayMs_);
  record(
    "8. 재시도 1~3회차 백오프 = [15000, 30000, 60000]",
    JSON.stringify(delays) === JSON.stringify([15000, 30000, 60000]),
    JSON.stringify(delays),
  );
  const exceeded = nextRetryDelayMs_(4);
  record("8b. 4회차(한도 초과) — null(무한 재시도 금지)", exceeded === null, String(exceeded));
}

// 9) retryCount 0 또는 음수 — 잘못된 입력 방어(null) --------------------------------------
{
  record("9. retryCount=0 — null", nextRetryDelayMs_(0) === null);
  record("9b. retryCount=-1 — null", nextRetryDelayMs_(-1) === null);
}

// 10) MAX_ATTEMPTS = 최초 1회 + 재시도 3회 = 4 -------------------------------------------
{
  record("10. MAX_ATTEMPTS === 4(최초 1회 + 재시도 3회)", MAX_ATTEMPTS === 4, String(MAX_ATTEMPTS));
}

console.log("\n요약:", results.filter((r) => r.pass).length, "/", results.length, "PASS");
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error("\n실패한 테스트:");
  for (const f of failed) console.error(` - ${f.name} (${f.detail ?? ""})`);
  process.exit(1);
}

export {}; // 이 파일을 모듈로 취급시켜 다른 독립 실행 스크립트와 top-level 식별자가 충돌하지 않게 한다
