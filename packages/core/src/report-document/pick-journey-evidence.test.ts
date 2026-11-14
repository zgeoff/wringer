import { expect, test } from 'bun:test';
import { pickJourneyEvidence } from './pick-journey-evidence.ts';
import type { JourneyEvidenceFacts } from './pick-journey-evidence.ts';

function setupTest() {
  const at = '2026-11-04T10:00:00.000Z';

  const buildFacts = (overrides: Partial<JourneyEvidenceFacts>): JourneyEvidenceFacts => ({
    verdict: {
      feature: 'checkout',
      fingerprint: 'b'.repeat(40),
      featureFingerprint: 'a'.repeat(40),
      run: 'r1',
      at,
      target: { name: 'preview', evidence: 'upload' },
      pin: { kind: 'local' },
      evidence: [],
    },
    targetEvidence: 'upload',
    hasRunLog: true,
    isUploadAllowed: true,
    ...overrides,
  });

  return { buildFacts };
}

test('it uploads when the verdict, the target and the flag allow it', () => {
  const ctx = setupTest();

  expect(pickJourneyEvidence(ctx.buildFacts({}))).toBe('upload');
});

test('it names no-upload-flag when only the flag forbids it', () => {
  const ctx = setupTest();

  expect(pickJourneyEvidence(ctx.buildFacts({ isUploadAllowed: false }))).toBe('no-upload-flag');
});

test('it names recorded-local when the verdict kept evidence local', () => {
  const ctx = setupTest();
  const facts = ctx.buildFacts({});

  const local = {
    ...facts,
    verdict: { ...facts.verdict, target: { name: 'preview', evidence: 'local' as const } },
  };

  expect(pickJourneyEvidence(local)).toBe('recorded-local');
});

test('it names target-gone when the registry lost the target', () => {
  const ctx = setupTest();

  expect(pickJourneyEvidence(ctx.buildFacts({ targetEvidence: null }))).toBe('target-gone');
});

test('it names target-local when the target now keeps evidence local', () => {
  const ctx = setupTest();

  expect(pickJourneyEvidence(ctx.buildFacts({ targetEvidence: 'local' }))).toBe('target-local');
});

test('it names run-log-missing before any other cause', () => {
  const ctx = setupTest();
  const facts = ctx.buildFacts({ hasRunLog: false, targetEvidence: null, isUploadAllowed: false });

  expect(pickJourneyEvidence(facts)).toBe('run-log-missing');
});
