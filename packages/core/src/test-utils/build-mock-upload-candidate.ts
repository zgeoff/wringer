import type { UploadCandidate } from '../evidence/pick-upload-refusal.ts';

// A clean text file in a run's features folder, whose recorded hash matches the bytes on disk.
export function buildMockUploadCandidate(
  overrides: Partial<UploadCandidate> = {},
): UploadCandidate {
  const path = '.wringer/runs/r-7c1/features/place-order/2026-11-04-note.txt';

  return {
    evidence: { kind: 'note', path, sha256: 'a'.repeat(64), scrub: 'text' },
    exists: true,
    realPath: `/repo/${path}`,
    isInFeaturesFolder: true,
    isRegularFile: true,
    sha256: 'a'.repeat(64),
    text: 'a clean file',
    ...overrides,
  };
}
