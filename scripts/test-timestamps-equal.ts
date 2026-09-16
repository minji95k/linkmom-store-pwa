/**
 * timestampsEqual()의 순수 함수 단위 테스트 — DB/네트워크 전혀 사용 안 함.
 * 2026-09-16 event_campaigns 변경 감지 버그(같은 시각의 다른 ISO 표현을 "변경"으로
 * 오판)를 재현/검증한다. docs/sync-design.md §12 참조.
 *
 * 실행: npm run test:timestamps-equal (환경변수 불필요)
 */
import { timestampsEqual } from "../src/lib/sync/timestamps";

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

// 1) 실제 버그 재현: "+00:00" vs ".000Z" — 같은 시각이므로 true여야 한다 -----------------
record(
  '1. "2026-09-10T00:00:00+00:00" vs "2026-09-10T00:00:00.000Z" — 동일 시각 → true',
  timestampsEqual("2026-09-10T00:00:00+00:00", "2026-09-10T00:00:00.000Z") === true,
);

// 2) 실제로 다른 시각 — false여야 한다 ------------------------------------------------
record(
  "2. 실제 종료일 변경(09-15 vs 09-23) — 다른 시각 → false",
  timestampsEqual("2026-09-15T00:00:00+00:00", "2026-09-23T00:00:00.000Z") === false,
);

// 3) 완전히 동일한 문자열 — true (빠른 경로) --------------------------------------------
record("3. 완전히 같은 문자열 — true", timestampsEqual("2026-09-10T00:00:00Z", "2026-09-10T00:00:00Z") === true);

// 4) null/undefined 처리 ------------------------------------------------------------
record("4. null vs null — true", timestampsEqual(null, null) === true);
record("4b. undefined vs undefined — true", timestampsEqual(undefined, undefined) === true);
record("4c. null vs undefined — true(둘 다 값 없음)", timestampsEqual(null, undefined) === true);
record("4d. null vs 실제 값 — false", timestampsEqual(null, "2026-09-10T00:00:00Z") === false);
record("4e. 실제 값 vs null — false", timestampsEqual("2026-09-10T00:00:00Z", null) === false);

// 5) 타임존 표기가 다르지만 같은 시각(UTC+9 vs Z) — true --------------------------------
record(
  "5. 타임존 표기만 다르고 같은 순간(+09:00 vs Z) — true",
  timestampsEqual("2026-09-10T09:00:00+09:00", "2026-09-10T00:00:00Z") === true,
);

// 6) 파싱 불가능한 문자열 — 안전하게 false로 취급 ---------------------------------------
record("6. 파싱 불가능한 값 — false(안전한 기본값)", timestampsEqual("not-a-date", "2026-09-10T00:00:00Z") === false);
record("6b. 둘 다 파싱 불가능 — false", timestampsEqual("not-a-date", "also-not-a-date") === false);

// 7) 밀리초 단위까지 실제로 다른 경우 — false ------------------------------------------
record(
  "7. 밀리초 단위 실제 차이 — false",
  timestampsEqual("2026-09-10T00:00:00.000Z", "2026-09-10T00:00:00.500Z") === false,
);

console.log("\n요약:", results.filter((r) => r.pass).length, "/", results.length, "PASS");
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error("\n실패한 테스트:");
  for (const f of failed) console.error(` - ${f.name} (${f.detail ?? ""})`);
  process.exit(1);
}
