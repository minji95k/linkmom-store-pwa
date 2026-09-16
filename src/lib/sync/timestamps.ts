/**
 * 같은 시각을 나타내는 서로 다른 ISO 8601 문자열 표현(예: Postgres/PostgREST가 돌려주는
 * "2026-09-10T00:00:00+00:00"과 `new Date().toISOString()`이 항상 만드는
 * "2026-09-10T00:00:00.000Z")을 "변경 없음"으로 취급하기 위한 epoch 값 비교.
 *
 * 2026-09-16 실 DEV 검증 중 발견된 버그의 근본 원인: event_campaigns의 변경 감지 로직이
 * 이 두 표현을 단순 문자열(`!==`)로 비교해, 실제로는 같은 시각인데 매 Sync마다
 * "변경됨"으로 오판해 불필요한 campaign_visibility change_log와 last_important_change_at
 * 갱신을 반복 생성하고 있었다.
 */
export function timestampsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = a ?? null;
  const nb = b ?? null;
  if (na === nb) return true; // 둘 다 값 없음(null/undefined)이거나, 완전히 같은 문자열인 경우의 빠른 경로
  if (na === null || nb === null) return false;
  const ta = new Date(na).getTime();
  const tb = new Date(nb).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false; // 파싱 불가능한 값은 안전하게 "다르다"로 취급
  return ta === tb;
}
