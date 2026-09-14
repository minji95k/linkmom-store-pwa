import { z } from "zod";

const syncRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]).optional()),
});

export const syncRequestSchema = z.object({
  headers: z.array(z.string()),
  rows: z.array(syncRowSchema),
  // 기본값은 항상 "partial" — 명시적으로 "full_snapshot"을 보낸 요청만 누락된
  // 기존 상품을 비활성화할 수 있다(2026-09-11 대량 비활성화 사고 이후 도입).
  sync_mode: z.enum(["full_snapshot", "partial"]).default("partial"),
  source_sheet: z.enum(["permanent", "event"]).optional(),
});
