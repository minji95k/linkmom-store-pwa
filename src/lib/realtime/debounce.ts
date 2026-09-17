/**
 * 짧은 시간에 몰리는 여러 Realtime Event를 1건의 반응으로 합친다(trailing-edge debounce).
 * 예: 가격+현금가 동시 변경 → UPDATE 이벤트 여러 건 → Banner/재조회는 1회만.
 * 과도한 Queue/버퍼링 시스템 대신 가장 단순한 형태(타이머 1개 리셋)로 구현한다.
 */
export function createDebouncer(delayMs: number, fn: () => void): { trigger: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    trigger() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, delayMs);
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
