import { expect, test } from 'bun:test';
import { envelopeSchema } from '../envelope.ts';
import { buildMockEnvelope } from './build-mock-envelope.ts';

test('it builds a passing envelope that parses against the envelope schema', () => {
  expect(envelopeSchema.safeParse(buildMockEnvelope()).success).toBe(true);
});

test('it applies the overrides', () => {
  const envelope = buildMockEnvelope({ command: 'notes add', feature: 'search' });

  expect({ command: envelope.command, feature: envelope.feature }).toStrictEqual({
    command: 'notes add',
    feature: 'search',
  });
});
