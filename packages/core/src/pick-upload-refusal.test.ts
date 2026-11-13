import { expect, test } from 'bun:test';
import { createSecretSet } from './create-secret-set.ts';
import { pickUploadRefusal } from './pick-upload-refusal.ts';
import { buildMockUploadCandidate } from './test-utils/build-mock-upload-candidate.ts';

function setupTest() {
  const secrets = createSecretSet();

  secrets.add({ name: 'SHOP_API_TOKEN', value: 'planted-shop-token', origin: 'declared' });

  return { secrets };
}

test('it returns null for a clean text file', () => {
  const ctx = setupTest();

  const refusal = pickUploadRefusal(buildMockUploadCandidate(), {
    targetUploads: false,
    secrets: ctx.secrets,
  });

  expect(refusal).toBeNull();
});

test.each([
  { reason: 'missing', change: { exists: false } },
  { reason: 'outside-features-folder', change: { isInFeaturesFolder: false } },
  { reason: 'not-a-regular-file', change: { isRegularFile: false } },
  { reason: 'hash-mismatch', change: { sha256: 'b'.repeat(64) } },
  { reason: 'hash-mismatch', change: { sha256: null } },
  { reason: 'secret-found', change: { text: 'the key is planted-shop-token' } },
])('it refuses with $reason', (row) => {
  const ctx = setupTest();
  const candidate = buildMockUploadCandidate(row.change);
  const refusal = pickUploadRefusal(candidate, { targetUploads: false, secrets: ctx.secrets });

  expect(refusal).toStrictEqual({ reason: row.reason, path: candidate.evidence.path });
});

test('it refuses an opaque file from a target that does not upload', () => {
  const ctx = setupTest();
  const clean = buildMockUploadCandidate();

  const candidate = buildMockUploadCandidate({
    evidence: { kind: 'screenshot', path: clean.evidence.path, sha256: 'a'.repeat(64) },
    text: null,
  });

  const refusal = pickUploadRefusal(candidate, { targetUploads: false, secrets: ctx.secrets });

  expect(refusal).toStrictEqual({
    reason: 'opaque-on-local-target',
    path: clean.evidence.path,
  });
});

test('it returns the first failing reason in the order of the reasons', () => {
  const ctx = setupTest();

  const candidate = buildMockUploadCandidate({
    isInFeaturesFolder: false,
    sha256: 'b'.repeat(64),
    text: 'planted-shop-token',
  });

  const refusal = pickUploadRefusal(candidate, { targetUploads: false, secrets: ctx.secrets });

  expect(refusal?.reason).toBe('outside-features-folder');
});

test('it lets an opaque file through from a target that uploads', () => {
  const ctx = setupTest();
  const clean = buildMockUploadCandidate();

  const candidate = buildMockUploadCandidate({
    evidence: {
      kind: 'screenshot',
      path: clean.evidence.path,
      sha256: 'a'.repeat(64),
      scrub: 'opaque',
    },
    text: null,
  });

  const refusal = pickUploadRefusal(candidate, { targetUploads: true, secrets: ctx.secrets });

  expect(refusal).toBeNull();
});
