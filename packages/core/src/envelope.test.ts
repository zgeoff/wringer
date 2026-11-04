import { expect, test } from 'bun:test';
import { envelopeSchema } from './envelope.ts';
import type { Envelope } from './envelope.ts';

test('it rejects an ok envelope that carries an error', () => {
  const result = envelopeSchema.safeParse({
    wringer: 1,
    ok: true,
    command: 'status',
    target: null,
    instance: null,
    feature: null,
    sha: null,
    durationMs: 3,
    data: {},
    evidence: [],
    cursors: {},
    error: { code: 'internal', message: 'Boom.', hint: null },
  });

  expect(result.error?.issues).toPartiallyContain({ path: ['error'] });
});

test('it rejects a truncated envelope that names no path for its data', () => {
  const result = envelopeSchema.safeParse({
    wringer: 1,
    ok: true,
    command: 'db.query',
    target: 'local',
    instance: 'mf3k2a-7q1z',
    feature: null,
    sha: null,
    durationMs: 3,
    data: null,
    evidence: [],
    cursors: {},
    truncated: true,
    error: null,
  });

  expect(result.error?.issues).toPartiallyContain({ path: ['truncatedPath'] });
});

test('it accepts a truncated envelope that names the path of its data', () => {
  const envelope: Envelope = {
    wringer: 1,
    ok: true,
    command: 'db.query',
    target: 'local',
    instance: 'mf3k2a-7q1z',
    feature: null,
    sha: null,
    durationMs: 3,
    data: null,
    evidence: [],
    cursors: {},
    truncated: true,
    truncatedPath: '.wringer/runs/mf3k2a-7q1z/features/none/payload.json',
    error: null,
  };

  expect(envelopeSchema.safeParse(envelope).data).toStrictEqual(envelope);
});
