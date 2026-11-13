import { expect, test } from 'bun:test';
import { createSecretSet } from './create-secret-set.ts';
import { pickScopeRefusal } from './pick-scope-refusal.ts';

test.each([
  {
    spelling: 'the value',
    value: 'planted-scope-token',
    feature: 'verify-planted-scope-token',
    origin: 'declared' as const,
  },
  {
    spelling: 'a URL component',
    value: 'planted scope token',
    feature: 'verify-planted%20scope%20token',
    origin: 'declared' as const,
  },
  {
    spelling: 'a collected value',
    value: 'planted-scope-token',
    feature: 'verify-planted-scope-token',
    origin: 'collected' as const,
  },
])('it refuses a feature name that holds $spelling of a secret, naming neither', (row) => {
  const secrets = createSecretSet();

  secrets.add({ name: 'SAMPLE_API_TOKEN', value: row.value, origin: row.origin });

  const refusal = pickScopeRefusal([{ name: 'checkout' }, { name: row.feature }], secrets);

  expect({
    code: refusal?.code,
    message: refusal?.message,
    leaked: JSON.stringify({ message: refusal?.message, hint: refusal?.hint }).includes('planted'),
  }).toStrictEqual({
    code: 'usage',
    message: expect.stringContaining(
      'Feature 2 of the registry holds the secret SAMPLE_API_TOKEN in its name',
    ),
    leaked: false,
  });
});

test('it allows feature names that hold no secret', () => {
  const secrets = createSecretSet();

  secrets.add({ name: 'SAMPLE_API_TOKEN', value: 'planted-scope-token', origin: 'declared' });

  expect(pickScopeRefusal([{ name: 'checkout' }, { name: 'search' }], secrets)).toBeNull();
});
