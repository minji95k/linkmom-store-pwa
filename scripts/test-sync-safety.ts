/**
 * Sync 대량 비활성화 안전장치(src/lib/sync/safety.ts)의 순수 함수 단위 테스트.
 *
 * 이 테스트는 DB나 네트워크를 전혀 사용하지 않는다 — 모든 입력이 이 파일 안의
 * 순수 배열/Set 값이다. 2026-09-11 실 데이터 대량 비활성화 사고 이후, "안전장치가
 * 실제로 안전한지"를 실 데이터에 위험한 payload를 쏴보는 방식으로 검증하면 안전장치
 * 자체가 잘못됐을 때 그 검증이 곧 사고가 된다 — 그래서 판정 로직을 이렇게 완전히
 * 고립된 순수 함수로 분리해 검증한다(별도 test mode / isolated fixture 전략).
 *
 * 실행: npm run test:sync:safety (환경변수 불필요)
 */
import { DEFAULT_DEACTIVATION_SAFETY, evaluateDeactivationSafety } from "../src/lib/sync/safety";

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function makeIds(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i + 1}`);
}

// 1) 아무것도 누락되지 않음 — 항상 통과 --------------------------------------------
{
  const existing = makeIds("P", 188);
  const payload = new Set(existing);
  const r = evaluateDeactivationSafety(existing, payload, DEFAULT_DEACTIVATION_SAFETY);
  record("1. 누락 0건 — blocked=false, missingCount=0", !r.blocked && r.missingCount === 0, JSON.stringify(r));
}

// 2) 실제 사고 재현: 기존 188건인데 payload에 1건만 존재 — 반드시 차단 ------------------
{
  const existing = makeIds("P", 188);
  const payload = new Set([existing[0]!]);
  const r = evaluateDeactivationSafety(existing, payload, DEFAULT_DEACTIVATION_SAFETY);
  record(
    "2. 188건 중 1건만 payload에 존재(실제 사고 재현) — blocked=true, missingCount=187",
    r.blocked && r.missingCount === 187,
    JSON.stringify(r),
  );
}

// 3) 임계치 이하의 소량 누락 — 정상적으로 허용되어야 함 -----------------------------
{
  const existing = makeIds("P", 188);
  const payload = new Set(existing.slice(0, 186)); // 2건만 누락 (~1.06%, 절대 2건)
  const r = evaluateDeactivationSafety(existing, payload, DEFAULT_DEACTIVATION_SAFETY);
  record(
    "3. 188건 중 2건만 누락(비율/절대값 모두 임계치 이하) — blocked=false, missingCount=2",
    !r.blocked && r.missingCount === 2,
    JSON.stringify(r),
  );
}

// 4) 비율 임계치(기본 50%) 초과 — 절대값은 작아도 차단 -----------------------------
{
  const existing = makeIds("P", 10);
  const payload = new Set(existing.slice(0, 4)); // 6건 누락 = 60%
  const r = evaluateDeactivationSafety(existing, payload, DEFAULT_DEACTIVATION_SAFETY);
  record(
    "4. 10건 중 6건 누락(60%, 절대값 6은 임계치 50 미만) — 비율 초과로 blocked=true",
    r.blocked && r.missingRatio > 0.5,
    JSON.stringify(r),
  );
}

// 5) 절대값 임계치(기본 50건) 초과 — 비율이 낮아도 차단 -----------------------------
{
  const existing = makeIds("P", 1000);
  const payload = new Set(existing.slice(0, 949)); // 51건 누락 = 5.1%
  const r = evaluateDeactivationSafety(existing, payload, DEFAULT_DEACTIVATION_SAFETY);
  record(
    "5. 1000건 중 51건 누락(5.1%, 비율은 낮지만 절대값 51 > 50) — 절대값 초과로 blocked=true",
    r.blocked && r.missingCount > 50,
    JSON.stringify(r),
  );
}

// 6) 경계값: 정확히 임계치와 같으면 차단하지 않음(초과만 차단, "이상"이 아니라 "초과") ---
{
  const existing = makeIds("P", 100);
  const payload = new Set(existing.slice(0, 50)); // 정확히 50건 누락 = 정확히 50% = maxRatio
  const r = evaluateDeactivationSafety(existing, payload, DEFAULT_DEACTIVATION_SAFETY);
  record(
    "6. 정확히 임계 비율(50%)과 같음 — 초과가 아니므로 blocked=false",
    !r.blocked,
    JSON.stringify(r),
  );
}
{
  const existing = makeIds("P", 200);
  const payload = new Set(existing.slice(0, 150)); // 정확히 50건 누락 = maxAbsolute
  const r = evaluateDeactivationSafety(existing, payload, DEFAULT_DEACTIVATION_SAFETY);
  record(
    "6b. 정확히 임계 절대값(50건)과 같음 — 초과가 아니므로 blocked=false",
    !r.blocked,
    JSON.stringify(r),
  );
}

// 7) 기존 활성 상품이 0건 — 비율 계산 0으로 나누기 방지, 차단 안 함 ----------------------
{
  const r = evaluateDeactivationSafety([], new Set<string>(), DEFAULT_DEACTIVATION_SAFETY);
  record("7. 기존 활성 상품 0건 — missingRatio=0, blocked=false", r.missingRatio === 0 && !r.blocked, JSON.stringify(r));
}

// 8) 커스텀 임계치를 더 엄격하게 주면 그 값을 따른다 --------------------------------
{
  const existing = makeIds("P", 100);
  const payload = new Set(existing.slice(0, 95)); // 5건 누락 = 5%, 기본 임계치라면 통과
  const strict = { maxRatio: 0.5, maxAbsolute: 3 }; // 절대값 임계치를 3건으로 강화
  const r = evaluateDeactivationSafety(existing, payload, strict);
  record(
    "8. 커스텀 임계치(절대값 3건)를 주면 5건 누락도 차단됨 — 옵션이 실제로 적용됨",
    r.blocked,
    JSON.stringify(r),
  );
}

// 9) missingIds 목록이 실제로 누락된 id만 정확히 담고 있는지 -----------------------------
{
  const existing = ["A", "B", "C", "D"];
  const payload = new Set(["A", "C"]);
  const r = evaluateDeactivationSafety(existing, payload, DEFAULT_DEACTIVATION_SAFETY);
  record(
    "9. missingIds가 정확히 [B, D]",
    r.missingIds.length === 2 && r.missingIds.includes("B") && r.missingIds.includes("D"),
    JSON.stringify(r.missingIds),
  );
}

console.log("\n요약:", results.filter((r) => r.pass).length, "/", results.length, "PASS");
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error("\n실패한 테스트:");
  for (const f of failed) console.error(` - ${f.name} (${f.detail ?? ""})`);
  process.exit(1);
}
