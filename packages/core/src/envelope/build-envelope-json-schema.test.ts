import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { parsePublishedEnvelope } from '../test-utils/parse-published-envelope.ts';
import { buildEnvelopeJSONSchema } from './build-envelope-json-schema.ts';

test('it matches the envelope schema the package publishes', async () => {
  const published: unknown = await Bun.file(
    join(import.meta.dir, '..', '..', 'envelope.schema.json'),
  ).json();

  expect(published).toStrictEqual(buildEnvelopeJSONSchema());
});

test.each([
  ['a failed envelope with no error', { ok: false }],
  ['a passed envelope with an error', { error: { code: 'usage', message: 'Bad.', hint: null } }],
  ['a truncated envelope with no path', { truncated: true }],
  ['a path with no truncated flag', { truncatedPath: '.wringer/runs/r1/payloads/1.json' }],
])('it rejects %s, as the runtime schema does', (_name, change) => {
  const envelope = {
    wringer: 1,
    ok: true,
    command: 'status',
    target: 'local',
    instance: null,
    feature: null,
    sha: null,
    durationMs: 4,
    data: null,
    evidence: [],
    cursors: {},
    error: null,
    ...change,
  };

  expect(parsePublishedEnvelope(JSON.stringify(envelope)).valid).toBe(false);
});
