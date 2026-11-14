import { extname } from 'node:path';
import type { Evidence } from '../envelope/envelope.ts';

const mediaTypes: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

// An image or a video by its extension, `text/plain` for any other file wringer scrubbed as text,
// so a browser never runs HTML or SVG, and `application/octet-stream` for the rest.
export function pickContentType(evidence: Evidence): string {
  const known = mediaTypes[extname(evidence.path).toLowerCase()];

  if (known !== undefined) {
    return known;
  }

  return evidence.scrub === 'text' ? 'text/plain' : 'application/octet-stream';
}
