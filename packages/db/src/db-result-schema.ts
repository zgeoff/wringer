import { z } from 'zod';

export const rowSchema = z.record(z.string(), z.unknown());

export type Row = z.infer<typeof rowSchema>;

// `rowCount` counts the rows a read returned, or the rows a write changed; it is null when the
// database's own client does not report a write's count.
export const dbResultSchema = z.strictObject({
  columns: z.array(z.string()),
  rows: z.array(rowSchema),
  rowCount: z.number().int().nonnegative().nullable(),
});

export type DbResult = z.infer<typeof dbResultSchema>;
