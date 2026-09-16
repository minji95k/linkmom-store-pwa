/**
 * apps-script/Sync.gs의 flushPendingSync 트리거 생명주기 규칙을 mock ScriptApp으로
 * 검증한다. Google Apps Script(.gs)는 ScriptApp/PropertiesService/LockService 같은
 * Apps Script 전용 전역 서비스에 의존하므로 Node에서 직접 실행할 수 없다 — 그래서 이
 * 파일은 그 서비스들을 최소한의 in-memory mock으로 흉내 내고, Sync.gs의 트리거
 * 생성/정리 로직을 동일하게 복제해 실 Google Sheet/Supabase를 전혀 건드리지 않고
 * "트리거가 항상 0개 또는 1개만 존재한다"는 불변조건을 검증한다
 * (2026-09-16 재부팅 후 disabled flushPendingSync 트리거가 누적됐던 사고 이후 도입).
 *
 * ⚠️ apps-script/Sync.gs의 handleEditTrigger 예약 로직 / flushPendingSync의 자기 정리
 * 로직을 고치면, 이 파일의 mock 시뮬레이션도 반드시 함께 고칠 것 — 빌드 시스템이 없어
 * 자동으로 동기화되지 않는다.
 *
 * 실행: npm run test:apps-script:trigger-lifecycle (환경변수 불필요)
 */

// ---- ScriptApp의 최소 in-memory mock ---------------------------------------------
interface MockTrigger {
  id: number;
  handler: string;
}

class MockScriptApp {
  private triggers: MockTrigger[] = [];
  private nextId = 1;

  getProjectTriggers(): MockTrigger[] {
    return this.triggers.slice();
  }

  /** 실제 ScriptApp.newTrigger(name).timeBased().after(ms).create()의 최소 흉내. */
  createTimeBasedTrigger(handler: string): MockTrigger {
    const t: MockTrigger = { id: this.nextId++, handler };
    this.triggers.push(t);
    return t;
  }

  deleteTrigger(t: MockTrigger): void {
    this.triggers = this.triggers.filter((x) => x.id !== t.id);
  }

  count(handler: string): number {
    return this.triggers.filter((t) => t.handler === handler).length;
  }
}

// ---- apps-script/Sync.gs 트리거 생명주기 로직의 복제본 -----------------------------
function hasScheduledFlushTrigger(app: MockScriptApp): boolean {
  return app.getProjectTriggers().some((t) => t.handler === "flushPendingSync");
}

function deleteFlushPendingSyncTriggers(app: MockScriptApp): void {
  app.getProjectTriggers().forEach((t) => {
    if (t.handler === "flushPendingSync") app.deleteTrigger(t);
  });
}

/** handleEditTrigger의 예약 판단부 복제본: 이미 존재하면 새로 만들지 않는다. */
function simulateEdit(app: MockScriptApp): void {
  if (!hasScheduledFlushTrigger(app)) {
    app.createTimeBasedTrigger("flushPendingSync");
  }
}

/**
 * flushPendingSync 실행부 복제본: 시작하자마자 동일 handler를 전부 지우고,
 * 재시도가 필요하면 정확히 1개만 다시 만든다.
 */
function simulateFlushRun(app: MockScriptApp, needsRetry: boolean): void {
  deleteFlushPendingSyncTriggers(app);
  if (needsRetry) {
    app.createTimeBasedTrigger("flushPendingSync");
  }
}
// ---- 복제본 끝 --------------------------------------------------------------------

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

// A) 시트 1회 수정 → flushPendingSync 최대 1개 생성 → 처리 → 제거 ---------------------
{
  const app = new MockScriptApp();
  simulateEdit(app); // 편집 1회 → 디바운스 트리거 예약
  record("A1. 편집 1회 후 flushPendingSync 정확히 1개", app.count("flushPendingSync") === 1, String(app.count("flushPendingSync")));
  simulateFlushRun(app, false); // 성공 → 재시도 불필요
  record("A2. flush 성공 처리 후 flushPendingSync 0개", app.count("flushPendingSync") === 0, String(app.count("flushPendingSync")));
}

// B) 시트 여러 번 빠르게 수정 → 트리거 중복 생성 없이 Row만 누적 -----------------------
{
  const app = new MockScriptApp();
  for (let i = 0; i < 10; i++) simulateEdit(app); // 디바운스 창 안에서 10번 연속 편집
  record(
    "B. 10회 연속 편집 후에도 flushPendingSync는 여전히 1개(중복 생성 없음)",
    app.count("flushPendingSync") === 1,
    String(app.count("flushPendingSync")),
  );
}

// C) API 실패 → pending 유실 없이 제한적 재시도, 트리거는 항상 0개 또는 1개만 -------------
{
  const app = new MockScriptApp();
  simulateEdit(app);
  record("C0. 최초 예약 — 1개", app.count("flushPendingSync") === 1);

  // 1~3차 재시도: 실패할 때마다 정확히 1개만 유지되어야 한다(누적되면 안 됨)
  for (let attempt = 1; attempt <= 3; attempt++) {
    simulateFlushRun(app, true); // 재시도 필요 → 다시 1개 예약
    record(`C${attempt}. 재시도 ${attempt}회차 실행 후에도 flushPendingSync는 1개(누적 안 됨)`, app.count("flushPendingSync") === 1, String(app.count("flushPendingSync")));
  }

  // 4번째(한도 초과) — 재시도 중단, 트리거 0개(하지만 pending Row 자체는 이 시뮬레이션
  // 대상이 아니다 — Sync.gs 쪽에서 SYNC_RETRY_COUNT만 지우고 PENDING_ROWS는 그대로 둔다)
  simulateFlushRun(app, false);
  record("C4. 재시도 한도 초과 후 flushPendingSync 0개(더 이상 예약 안 함)", app.count("flushPendingSync") === 0, String(app.count("flushPendingSync")));
}

// D) 재부팅 등으로 stale/중복 트리거가 이미 여러 개 쌓여 있던 상태에서 자가 치유 ------------
{
  const app = new MockScriptApp();
  // 사고 재현: 정상적으로는 생길 수 없지만, 재부팅/Apps Script 자체 오류 처리 등으로
  // 이미 여러 개가 쌓여 있었다고 가정한다.
  app.createTimeBasedTrigger("flushPendingSync");
  app.createTimeBasedTrigger("flushPendingSync");
  app.createTimeBasedTrigger("flushPendingSync");
  record("D0. 사고 재현 — stale 트리거 3개가 이미 존재", app.count("flushPendingSync") === 3);

  simulateFlushRun(app, false); // flushPendingSync가 실행되면(성공) 전부 정리되어야 한다
  record("D1. flushPendingSync 실행 후 stale 트리거 전부 정리되어 0개", app.count("flushPendingSync") === 0, String(app.count("flushPendingSync")));

  // 같은 사고 상황에서 편집이 먼저 들어오는 경우: hasScheduledFlushTrigger가 이미
  // 존재한다고 보고 새로 만들지 않는다(중복을 더 늘리지 않음) — 실제 정리는 다음
  // flushPendingSync 실행이 담당한다.
  const app2 = new MockScriptApp();
  app2.createTimeBasedTrigger("flushPendingSync");
  app2.createTimeBasedTrigger("flushPendingSync");
  simulateEdit(app2);
  record("D2. stale 트리거가 있는 상태에서 편집이 와도 더 늘어나지 않음", app2.count("flushPendingSync") === 2, String(app2.count("flushPendingSync")));
}

console.log("\n요약:", results.filter((r) => r.pass).length, "/", results.length, "PASS");
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error("\n실패한 테스트:");
  for (const f of failed) console.error(` - ${f.name} (${f.detail ?? ""})`);
  process.exit(1);
}

export {}; // 이 파일을 모듈로 취급시켜 다른 독립 실행 스크립트와 top-level 식별자가 충돌하지 않게 한다
