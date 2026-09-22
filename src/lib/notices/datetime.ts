/**
 * 공지 게시/만료 시각 변환 — 이 PWA는 한국 매장 직원용 내부 시스템이므로
 * `<input type="datetime-local">`(타임존 정보 없는 wall-clock 문자열)은 명시적으로
 * Asia/Seoul(KST, UTC+09:00, DST 없음) 기준으로 해석/표시한다.
 *
 * 2026-09-22 Production에서 실제로 재현된 버그: 예전 코드는 `new Date(raw).toISOString()`과
 * `d.getHours()` 등 "실행 환경의 로컬 타임존"에 의존했다 — Admin 브라우저(KST)에서 값을
 * 표시할 땐 우연히 맞았지만, 서버(Vercel, UTC)에서 그 문자열을 다시 해석해 저장할 때
 * 9시간 밀렸다. 이 파일의 두 함수는 실행 환경의 로컬 타임존을 절대 쓰지 않는다
 * (Date.UTC/getUTC* 계열만 사용) — 어디서 실행하든 결과가 같다.
 */

const KST_OFFSET_MINUTES = 9 * 60;

/** "YYYY-MM-DDTHH:mm"(datetime-local, KST wall time) → UTC ISO 문자열. */
export function kstDatetimeLocalToUtcIso(datetimeLocal: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(datetimeLocal);
  if (!match) {
    throw new Error(`올바르지 않은 datetime-local 값입니다: ${datetimeLocal}`);
  }
  const [, year, month, day, hour, minute] = match;
  const utcMs =
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)) -
    KST_OFFSET_MINUTES * 60 * 1000;
  return new Date(utcMs).toISOString();
}

/** UTC ISO 문자열 → "YYYY-MM-DDTHH:mm"(datetime-local에 넣을 KST wall time). */
export function utcIsoToKstDatetimeLocal(iso: string): string {
  const kst = new Date(new Date(iso).getTime() + KST_OFFSET_MINUTES * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}T${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`;
}

/**
 * "지금 이 공지가 실제로 게시 중인가"(published_at <= now < expires_at)를 판정한다.
 * `notice_visible_to_current_user()`(DB RLS)가 확인하는 게시 기간 조건과 정확히 같은
 * 규칙이다 — Notice Push 발송 전에도 같은 기준으로 한 번 더 확인해, 예약(미래) 공지나
 * 이미 만료된 공지가 조기/사후에 Push되는 것을 막는다(2026-09-22 Production 실측 버그
 * 대응, src/lib/push/notify-notice.ts에서 사용).
 */
export function isNoticeCurrentlyPublished(
  notice: { published_at: string; expires_at: string | null },
  now: Date = new Date(),
): boolean {
  if (new Date(notice.published_at) > now) return false;
  // DB RLS는 "now() <= expires_at"이면 아직 보여야 한다고 판정한다(경계 포함) — 여기도
  // 같은 방향으로 맞춘다: expires_at이 now보다 "엄격히 이전"일 때만 만료로 취급한다.
  if (notice.expires_at && new Date(notice.expires_at) < now) return false;
  return true;
}
