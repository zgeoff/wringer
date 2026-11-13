import { expect, test } from 'bun:test';
import { createSecretSet } from './create-secret-set.ts';
import { pickRevisionRefusal } from './pick-revision-refusal.ts';

test.each([{ origin: 'declared' as const }, { origin: 'collected' as const }])(
  'it refuses a revision that holds a $origin secret, naming the secret only',
  (row) => {
    const secrets = createSecretSet();

    secrets.add({ name: 'SAMPLE_API_TOKEN', value: 'beefcafe0042', origin: row.origin });

    const refusal = pickRevisionRefusal('0123beefcafe00429876', secrets);

    expect({
      code: refusal?.code,
      message: refusal?.message,
      leaked: JSON.stringify({ message: refusal?.message, hint: refusal?.hint }).includes(
        'beefcafe0042',
      ),
    }).toStrictEqual({
      code: 'usage',
      message: expect.stringContaining("The target's revision holds the secret SAMPLE_API_TOKEN"),
      leaked: false,
    });
  },
);

test('it allows a revision that holds no secret', () => {
  const secrets = createSecretSet();

  secrets.add({ name: 'SAMPLE_API_TOKEN', value: 'beefcafe0042', origin: 'declared' });

  expect(pickRevisionRefusal('0123456789abcdef', secrets)).toBeNull();
});
