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

/**
 * `is_initial_import=true`인 상품의 `last_important_change_at`을 그 상품의 실제 change_log
 * 이력만으로 다시 계산한다 — "생성 자체를 나타내는" change_type='new_product' Row는 제외하고,
 * importance가 'minor'가 아닌(=실제 중요 변경, Push 판정과 동일 축) Row 중 가장 최근
 * changed_at만 남긴다. `supabase/migrations/20260922110000_fix_initial_import_new_baseline.sql`의
 * UPDATE 조건과 정확히 같은 규칙이다 — Initial Import 이후 실제 중요 변경이 전혀 없으면
 * null(NEW 아님), 있으면 그 실제 변경 시각을 그대로 보존한다(무조건 null 처리가 아니다).
 */
export interface ChangeLogForRecompute {
  changeType: string;
  importance: "minor" | "important" | "critical";
  changedAt: string;
}

export function recomputeLastImportantChangeAt(changeLogs: ChangeLogForRecompute[]): string | null {
  const candidates = changeLogs.filter((log) => log.changeType !== "new_product" && log.importance !== "minor");
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, log) => (log.changedAt > latest ? log.changedAt : latest), candidates[0]!.changedAt);
}
