import type { PromotionType } from "@/types/database";

/**
 * Google Apps Script → Next.js Sync API 계약.
 * Apps Script는 시트의 각 데이터 Row를 "헤더 → 셀 값" 객체로 직렬화해 보낸다.
 * rowNumber는 1-based Google Sheet 행 번호로, product_id를 새로 채번했을 때
 * Apps Script가 정확히 어느 셀에 다시 써야 하는지 알려주기 위해 필요하다.
 */
export interface SyncRow {
  rowNumber: number;
  values: Record<string, string | number | boolean | null | undefined>;
}

/**
 * `full_snapshot`: 이 요청의 rows가 해당 Sheet 타입의 전체 상품 목록이라는 보장.
 *   payload에 없는 기존 product_id는 (안전장치 통과 시) 비활성화 대상이 된다.
 * `partial`: 이 요청이 전체 목록이 아닐 수 있다는 뜻 — 누락된 기존 product_id를
 *   절대 비활성화하지 않는다. 사고 방지를 위해 기본값은 항상 `partial`이다
 *   (2026-09-11 대량 비활성화 사고 이후 도입, docs/sync-design.md §7 참조).
 */
export type SyncMode = "full_snapshot" | "partial";

export interface SyncRequestBody {
  headers: string[];
  rows: SyncRow[];
  /**
   * 기본값 "partial". Apps Script의 정상 전체 Sheet Sync(syncPermanentOnly/
   * syncEventOnly/syncAll)만 "full_snapshot"을 보낸다. 와이어 필드명은 사용자
   * 요구사항 문서의 표기를 그대로 따라 snake_case로 둔다.
   */
  sync_mode?: SyncMode;
  /**
   * 이 payload가 어느 Sheet 타입을 위한 것인지에 대한 발신측 자기 확인.
   * 지정된 경우 호출된 엔드포인트(permanent/event)와 반드시 일치해야 하며,
   * 불일치 시 Sync 자체를 실패 처리한다(§5 source_sheet 일치 확인).
   */
  source_sheet?: PromotionType;
}

export interface SyncRowError {
  rowNumber: number;
  message: string;
}

export interface ProductIdAssignment {
  rowNumber: number;
  productId: string;
}

/** Full Snapshot Sync의 대량 비활성화 안전장치 결과 보고. */
export interface DeactivationGuardReport {
  /** partial 모드라서 비활성화 로직 자체를 시도하지 않은 경우. */
  skipped: boolean;
  /** full_snapshot 모드였지만 안전장치가 발동해 비활성화를 차단한 경우. */
  blocked: boolean;
  reason: string | null;
  missingCount: number;
  missingRatio: number;
}

export interface SyncResponseBody {
  success: boolean;
  syncLogId: string;
  syncMode: SyncMode;
  insertedCount: number;
  updatedCount: number;
  deactivatedCount: number;
  failedCount: number;
  errors: SyncRowError[];
  /** Apps Script가 이 목록을 받아 시트의 product_id 셀에 되써야 한다. */
  productIdAssignments: ProductIdAssignment[];
  deactivationGuard: DeactivationGuardReport;
}
