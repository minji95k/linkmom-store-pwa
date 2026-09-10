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

export interface SyncRequestBody {
  headers: string[];
  rows: SyncRow[];
}

export interface SyncRowError {
  rowNumber: number;
  message: string;
}

export interface ProductIdAssignment {
  rowNumber: number;
  productId: string;
}

export interface SyncResponseBody {
  success: boolean;
  syncLogId: string;
  insertedCount: number;
  updatedCount: number;
  deactivatedCount: number;
  failedCount: number;
  errors: SyncRowError[];
  /** Apps Script가 이 목록을 받아 시트의 product_id 셀에 되써야 한다. */
  productIdAssignments: ProductIdAssignment[];
}
