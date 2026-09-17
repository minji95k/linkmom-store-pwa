/** DB의 Numeric 가격 값을 "598,000원" 형태로 변환한다. null/undefined는 호출부에서 처리한다. */
export function formatKRW(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

export function formatDateTimeKST(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateKST(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * 기본구성품/증정사은품/포토후기처럼 "실제로 없음"과 "누락"을 직원이 구분해야 하는
 * 필드용. Sync 엔진이 빈 문자열/"-"를 이미 null로 정규화하지만(normalizeCellText),
 * 방어적으로 여기서도 한 번 더 처리한다.
 */
export function valueOrNone(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "없음";
  const trimmed = raw.trim();
  return trimmed === "" || trimmed === "-" ? "없음" : trimmed;
}

/**
 * `promotions.color`(text[])처럼 Spreadsheet에서 그대로 들어온 배열을 화면에
 * Badge로 그리기 전에 정리한다: 공백 제거 → 빈 값 제거 → 중복 제거.
 * 2026-09-17 발견: 같은 컬러가 중복 입력된 실제 데이터("어반올리브" 2회)가 있어
 * `key={color}`로 map하면 React가 "two children with the same key" 경고를 낸다.
 * 직원 화면에서 같은 컬러를 두 번 보여줄 이유가 없으므로, 경고를 숨기는
 * `key={`${c}-${i}`}` 대신 렌더링 이전에 배열 자체를 정리한다. 원본 DB 값은
 * 그대로 두고 화면 표시용으로만 정리한다 — Sync 엔진/원본 데이터는 건드리지 않는다.
 */
export function dedupeTrimmed(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const trimmed = raw.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
