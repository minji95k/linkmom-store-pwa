/**
 * Initial Import(최초 Sync)로 신규 생성되는 promotion Row가 가져야 할 필드 조합을
 * 한 곳에서 결정한다. `is_initial_import`/`push_eligible`는 이미 `isInitialImportRun`
 * 기준으로 분기하고 있었지만 `last_important_change_at`은 무조건 현재 시각을 채우고
 * 있었다 — Initial Import 상품이 NEW(72h Rolling, `src/lib/promotions/queries.ts`)로
 * 노출되는 결함으로 이어졌다(2026-09-22 Production 검증에서 발견). 세 필드 모두 같은
 * 조건(`isInitialImportRun`)에서 파생되므로 하나의 함수로 묶어 재발을 막는다.
 */
export interface InitialImportFieldSet {
  is_initial_import: boolean;
  push_eligible: boolean;
  last_important_change_at: string | null;
}

export function computeNewPromotionFields(
  isInitialImportRun: boolean,
  now: () => string = () => new Date().toISOString(),
): InitialImportFieldSet {
  return {
    is_initial_import: isInitialImportRun,
    push_eligible: !isInitialImportRun,
    last_important_change_at: isInitialImportRun ? null : now(),
  };
}
