import { expect, test } from 'bun:test';
import { buildSnapshotWaitError } from './build-snapshot-wait-error.ts';

test('it names the text that never showed and the time waited', () => {
  const error = buildSnapshotWaitError({
    waitedMs: 3250,
    unmet: ['never showed the text "Saved"'],
  });

  expect({ code: error.code, message: error.message, hint: error.hint }).toStrictEqual({
    code: 'check-failed',
    message: 'The page never showed the text "Saved" after 3.3 s.',
    hint: 'Read the last snapshot in the evidence, `snapshot.yaml`, to see what the page showed.',
  });
});

test('it names both texts when neither condition holds', () => {
  const error = buildSnapshotWaitError({
    waitedMs: 1000,
    unmet: ['never showed the text "Saved"', 'still shows the text "Saving"'],
  });

  expect(error.message).toBe(
    'The page never showed the text "Saved" and still shows the text "Saving" after 1.0 s.',
  );
});
