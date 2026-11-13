import { expect, test } from 'bun:test';
import { runEventSchema } from './run-events.ts';

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
