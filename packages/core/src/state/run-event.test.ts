import { expect, test } from 'bun:test';
import { runEventSchema } from './run-event.ts';

test('it keeps the fingerprint of a feature named __proto__ in a scopes-read event', () => {
  const event = runEventSchema.parse({
    type: 'scopes-read',
    at: '2026-11-04T10:00:00.500Z',
    featureFingerprints: [
      ['checkout', 'empty'],
      ['__proto__', 'empty'],
    ],
  });

  expect(event).toStrictEqual({
    type: 'scopes-read',
    at: '2026-11-04T10:00:00.500Z',
    featureFingerprints: [
      ['checkout', 'empty'],
      ['__proto__', 'empty'],
    ],
  });
});

test('it parses a revision-read event and refuses a branch name as the revision', () => {
  const at = '2026-11-04T10:00:00.500Z';

  expect([
    runEventSchema.safeParse({ type: 'revision-read', at, revision: '5e1d0a7' }).success,
    runEventSchema.safeParse({ type: 'revision-read', at, revision: 'main' }).success,
  ]).toStrictEqual([true, false]);
});
