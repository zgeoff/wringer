import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { buildEnvelopeJSONSchema } from './build-envelope-json-schema.ts';

test('it matches the envelope schema the package publishes', async () => {
  const published: unknown = await Bun.file(
    join(import.meta.dir, '..', 'envelope.schema.json'),
  ).json();

  expect(published).toStrictEqual(buildEnvelopeJSONSchema());
});
