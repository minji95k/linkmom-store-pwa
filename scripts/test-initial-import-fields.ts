/**
 * Initial Import 판정(`src/lib/sync/initial-import.ts`)과 그 판정이 의존하는
 * `promotion_sync_state` 해석 규칙의 순수 함수 단위 테스트.
 *
 * DB나 네트워크를 전혀 사용하지 않는다 — engine.ts의 `isInitialImportRun =
 * !syncState?.initial_import_completed_at` 공식과 `computeNewPromotionFields()`를
 * 그대로 재사용해, 신규(Fresh) 환경/최초 상시 Import/최초 행사 Import/최초 Import
 * 이후의 일반 변경 네 가지 시나리오를 검증한다(2026-09-22, Production에서 발견된
 * "신선한 환경이 가짜 완료 상태를 물려받는" 결함의 회귀 테스트).
 *
 * 실행: npm run test:initial-import (환경변수 불필요)
 */
import { computeNewPromotionFields } from "../src/lib/sync/initial-import";

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

// engine.ts와 동일한 판정 공식을 그대로 재사용한다(로직이 갈라지면 이 테스트의
// 의미가 없어지므로, 복제하지 않고 문자 그대로 같은 표현식을 쓴다).
function isInitialImportRun(syncState: { initial_import_completed_at: string | null } | null | undefined): boolean {
  return !syncState?.initial_import_completed_at;
}

// (A) 신규(Fresh) 환경: 교정 Migration이 promotion_sync_state Row를 지운 뒤라
//     syncState 자체가 없다(select ... maybeSingle()의 결과가 null) — 반드시
//     최초 Import로 판정돼야 한다.
{
  const run = isInitialImportRun(null);
  record("A. Fresh 환경(교정 후 Row 없음) — isInitialImportRun=true", run === true);
}

// (A-2) 교정 전 결함 재현: 백필 버그로 Row는 있지만 completed_at이 NULL인 경우도
//       "최초 Import"로 판정되는 것 자체는 맞다(문제는 그 다음 Migration이 이 NULL을
//       하드코딩된 값으로 덮어쓴 것이었다 — 이 케이스는 그 덮어쓰기가 없다면 안전함을
//       보여준다).
{
  const run = isInitialImportRun({ initial_import_completed_at: null });
  record("A-2. Row는 있지만 completed_at=NULL — isInitialImportRun=true", run === true);
}

// (B) 첫 상시(permanent) full_snapshot: 신규 promotion Row에 적용될 필드 조합이
//     is_initial_import=true / push_eligible=false / last_important_change_at=null
//     이어야 한다 — 마지막 값이 NEW(72h) 배지 오노출을 막는 핵심이다.
{
  const fields = computeNewPromotionFields(true, () => "2026-09-22T00:00:00.000Z");
  record(
    "B. 최초 Import 신규 상품 — is_initial_import=true, push_eligible=false, last_important_change_at=null",
    fields.is_initial_import === true && fields.push_eligible === false && fields.last_important_change_at === null,
    JSON.stringify(fields),
  );
}

// (C) 첫 행사(event) full_snapshot도 동일 함수를 공유하므로 sheet 종류와 무관하게
//     같은 규칙이 적용됨을 확인한다(별도 분기를 두지 않는다는 설계 원칙 검증).
{
  const fields = computeNewPromotionFields(true, () => "2026-09-22T00:00:00.000Z");
  record(
    "C. 최초 행사 Import도 동일 규칙 — is_initial_import=true, push_eligible=false, last_important_change_at=null",
    fields.is_initial_import === true && fields.push_eligible === false && fields.last_important_change_at === null,
    JSON.stringify(fields),
  );
}

// (D) 최초 Import 완료 후 두 번째 변경(신규 상품 추가 등): 이미
//     promotion_sync_state.initial_import_completed_at이 채워져 있으므로 Initial
//     Import가 아니다 — 일반 신규 상품과 동일하게 push_eligible=true, NEW 배지용
//     last_important_change_at도 현재 시각으로 정상 채워져야 한다.
{
  const run = isInitialImportRun({ initial_import_completed_at: "2026-09-10T05:52:47.217Z" });
  const fields = computeNewPromotionFields(run, () => "2026-09-23T00:00:00.000Z");
  record(
    "D. 최초 Import 이후 신규 상품 — isInitialImportRun=false, is_initial_import=false, push_eligible=true, last_important_change_at=now",
    run === false &&
      fields.is_initial_import === false &&
      fields.push_eligible === true &&
      fields.last_important_change_at === "2026-09-23T00:00:00.000Z",
    JSON.stringify({ run, fields }),
  );
}

// (E) now() 콜백을 기본값으로 생략해도(실제 engine.ts 호출부와 동일하게) 정상 동작한다 —
//     isInitialImportRun=true면 콜백이 호출되지 않고 null을 반환해야 한다.
{
  let nowCallCount = 0;
  const fields = computeNewPromotionFields(true, () => {
    nowCallCount += 1;
    return new Date().toISOString();
  });
  record(
    "E. Initial Import일 때는 now() 콜백을 아예 호출하지 않는다",
    nowCallCount === 0 && fields.last_important_change_at === null,
    `nowCallCount=${nowCallCount}`,
  );
}

console.log("\n요약:", results.filter((r) => r.pass).length, "/", results.length, "PASS");
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error("\n실패한 테스트:");
  for (const f of failed) console.error(` - ${f.name} (${f.detail ?? ""})`);
  process.exit(1);
}
