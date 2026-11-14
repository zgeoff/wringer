import { join } from 'node:path';
import { buildEnvelopeJSONSchema } from '../src/envelope/build-envelope-json-schema.ts';

await Bun.write(
  join(import.meta.dir, '..', 'envelope.schema.json'),
  `${JSON.stringify(buildEnvelopeJSONSchema(), null, 2)}\n`,
);
