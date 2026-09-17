/**
 * `createDebouncer`(src/lib/realtime/debounce.ts — RealtimeUpdateBanner와 Bottom Nav
 * 공지 뱃지가 짧은 시간에 몰리는 여러 Realtime Event를 1회 반응으로 합칠 때 쓰는 로직)를
 * 검증한다. 실 타이머를 짧은 지연값으로 써서 실제 setTimeout 동작 그대로 확인한다
 * (fake timer 라이브러리 없이도 충분히 빠르고 결정적이다).
 *
 * 실행: npm run test:realtime-debounce (환경변수/DB 불필요)
 */
import { createDebouncer } from "../src/lib/realtime/debounce";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const DELAY = 50;

  // 1) 짧은 시간에 몰린 여러 trigger() → fn은 1회만 실행 ------------------------------
  {
    let calls = 0;
    const debouncer = createDebouncer(DELAY, () => calls++);
    for (let i = 0; i < 5; i++) {
      debouncer.trigger();
      await sleep(5); // 지연(50ms)보다 훨씬 짧은 간격으로 5회 연타
    }
    record("1. 연타 직후에는 아직 실행 안 됨", calls === 0, String(calls));
    await sleep(DELAY + 30);
    record("1. 5회 연타 → 조용해진 뒤 fn은 정확히 1회 실행(가격+현금가 동시변경 예시)", calls === 1, String(calls));
  }

  // 2) 조용한 구간을 두고 다시 trigger() → 별개의 실행으로 카운트 -----------------------
  {
    let calls = 0;
    const debouncer = createDebouncer(DELAY, () => calls++);
    debouncer.trigger();
    await sleep(DELAY + 30);
    record("2. 첫 윈도우 종료 후 1회 실행", calls === 1, String(calls));

    debouncer.trigger();
    await sleep(DELAY + 30);
    record("2. 두 번째(별개) 이벤트도 정상적으로 다시 실행", calls === 2, String(calls));
  }

  // 3) trigger() 이후 윈도우가 끝나기 전에 cancel() → fn이 아예 실행되지 않는다 ----------
  {
    let calls = 0;
    const debouncer = createDebouncer(DELAY, () => calls++);
    debouncer.trigger();
    debouncer.cancel();
    await sleep(DELAY + 30);
    record("3. cancel() 후에는 fn이 실행되지 않음(예: unmount 시 정리)", calls === 0, String(calls));
  }

  // 4) 공지 생성처럼 서로 다른 이벤트가 짧게 이어져도 최종 1회로 수렴 -------------------
  {
    let calls = 0;
    const debouncer = createDebouncer(DELAY, () => calls++);
    debouncer.trigger(); // notice INSERT
    await sleep(10);
    debouncer.trigger(); // 뒤이은 관련 변경(예: notice_targets 반영 등 후속 쓰기)
    await sleep(10);
    debouncer.trigger();
    await sleep(DELAY + 30);
    record("4. 공지 생성 + 후속 이벤트 묶음 → 사용자에게는 알림 1회", calls === 1, String(calls));
  }

  console.log("\n요약:", results.filter((r) => r.pass).length, "/", results.length, "PASS");
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error("\n실패한 테스트:");
    for (const f of failed) console.error(` - ${f.name} (${f.detail ?? ""})`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
