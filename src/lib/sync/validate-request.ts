import { z } from "zod";

const syncRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]).optional()),
});

export const syncRequestSchema = z.object({
  headers: z.array(z.string()),
  rows: z.array(syncRowSchema),
});
