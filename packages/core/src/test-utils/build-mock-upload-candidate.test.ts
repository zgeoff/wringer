import { expect, test } from 'bun:test';
import { buildMockUploadCandidate } from './build-mock-upload-candidate.ts';

test('it builds a clean text file in a features folder', () => {
  const candidate = buildMockUploadCandidate();

  expect({
    exists: candidate.exists,
    isInFeaturesFolder: candidate.isInFeaturesFolder,
    isRegularFile: candidate.isRegularFile,
    hashesMatch: candidate.sha256 === candidate.evidence.sha256,
  }).toStrictEqual({
    exists: true,
    isInFeaturesFolder: true,
    isRegularFile: true,
    hashesMatch: true,
  });
});

test('it applies the overrides', () => {
  const candidate = buildMockUploadCandidate({ exists: false });

  expect(candidate.exists).toBe(false);
});
