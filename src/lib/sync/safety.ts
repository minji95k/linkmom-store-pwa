/**
 * Full Snapshot Sync의 대량 비활성화 안전장치.
 *
 * 순수 함수로 분리한 이유: DB나 API를 전혀 건드리지 않고 이 판정 로직 자체를
 * 단위 테스트할 수 있어야 하기 때문이다(scripts/test-sync-safety.ts 참조) —
 * 실 데이터에 위험한 payload를 실제로 쏴보는 것으로 안전장치를 검증하면
 * 안전장치가 잘못됐을 때 그 검증 자체가 사고가 된다.
 */

export interface DeactivationSafetyOptions {
  /** 기존 활성 상품 대비 누락 비율이 이 값을 넘으면 차단한다 (0~1). */
  maxRatio: number;
  /** 누락 건수 절대값이 이 값을 넘으면(비율과 무관하게) 차단한다. */
  maxAbsolute: number;
}

export interface DeactivationSafetyResult {
  missingIds: string[];
  missingCount: number;
  missingRatio: number;
  blocked: boolean;
  reason: string | null;
}

export const DEFAULT_DEACTIVATION_SAFETY: DeactivationSafetyOptions = {
  maxRatio: 0.5,
  maxAbsolute: 50,
};

/**
 * existingActiveProductIds: 이 Sheet 타입에서 현재 활성 상태인 기존 product_id 전체.
 * payloadProductIds: 이번 Sync payload에 (비어있지 않게) 실려 온 product_id 집합.
 */
export function evaluateDeactivationSafety(
  existingActiveProductIds: readonly string[],
  payloadProductIds: ReadonlySet<string>,
  options: DeactivationSafetyOptions,
): DeactivationSafetyResult {
  const missingIds = existingActiveProductIds.filter((id) => !payloadProductIds.has(id));
  const missingCount = missingIds.length;
  const missingRatio = existingActiveProductIds.length > 0 ? missingCount / existingActiveProductIds.length : 0;

  if (missingCount === 0) {
    return { missingIds, missingCount, missingRatio, blocked: false, reason: null };
  }

  const ratioExceeded = missingRatio > options.maxRatio;
  const absoluteExceeded = missingCount > options.maxAbsolute;

  if (!ratioExceeded && !absoluteExceeded) {
    return { missingIds, missingCount, missingRatio, blocked: false, reason: null };
  }

  const reasonParts = [
    `기존 활성 상품 ${existingActiveProductIds.length}건 중 ${missingCount}건(${(missingRatio * 100).toFixed(1)}%)이 이번 payload에 없습니다.`,
  ];
  if (ratioExceeded) reasonParts.push(`허용 비율(${(options.maxRatio * 100).toFixed(0)}%) 초과.`);
  if (absoluteExceeded) reasonParts.push(`허용 건수(${options.maxAbsolute}건) 초과.`);
  reasonParts.push("대량 비활성화를 막기 위해 Sync 전체를 중단합니다 — 관리자 확인이 필요합니다.");

  return { missingIds, missingCount, missingRatio, blocked: true, reason: reasonParts.join(" ") };
}
