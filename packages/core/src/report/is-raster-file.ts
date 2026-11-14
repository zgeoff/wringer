import { extname } from 'node:path';
import type { JourneyFile } from '../report-document/report-document.ts';

const rasterExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

export function isRasterFile(file: JourneyFile): boolean {
  return rasterExtensions.has(extname(file.evidence.path).toLowerCase());
}
