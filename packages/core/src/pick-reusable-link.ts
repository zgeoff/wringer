import type { UploadedLink } from './types.ts';
import type { UploadRecord } from './upload-record.ts';

const minimumLeftMs = 7 * 24 * 60 * 60 * 1000;

// The recorded link for the key while it has 7 days or more before it expires, or while it never
// expires.
export function pickReusableLink(
  record: UploadRecord,
  key: string,
  nowMs: number,
): UploadedLink | null {
  const entry = Object.hasOwn(record, key) ? record[key] : undefined;

  if (entry === undefined) {
    return null;
  }

  if (entry.expiresAt === undefined) {
    return { url: entry.url, expiresAt: null };
  }

  return Date.parse(entry.expiresAt) - nowMs >= minimumLeftMs
    ? { url: entry.url, expiresAt: entry.expiresAt }
    : null;
}
