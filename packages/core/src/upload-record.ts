import { z } from 'zod';

const uploadEntrySchema = z.strictObject({
  url: z.string(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  uploadedAt: z.iso.datetime({ offset: true }),
});

// One object keyed by `<host> <sha256>.<extension>`.
const uploadRecordSchema = z.record(z.string(), uploadEntrySchema);

export type UploadRecord = z.infer<typeof uploadRecordSchema>;

// A record that is missing, unreadable or not in this shape reads as empty, so the files upload
// again and the next write replaces it.
export function parseUploadRecord(text: string | null): UploadRecord {
  if (text === null) {
    return {};
  }

  try {
    const parsed = uploadRecordSchema.safeParse(JSON.parse(text));

    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}
