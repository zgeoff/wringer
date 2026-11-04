import { Ajv2020 } from 'ajv/dist/2020.js';
import publishedSchema from '../packages/core/envelope.schema.json' with { type: 'json' };
import type { PublishedEnvelopeResult } from './parse-published-envelope.ts';

const ajv = new Ajv2020({ allErrors: true, strict: true });

ajv.addSchema(publishedSchema);

const validate = ajv.compile({ $ref: `${publishedSchema.$id}#/$defs/streamEvent` });

// Checks one event line a streaming command wrote, such as a doctor's check, against the stream
// event the core package publishes beside its envelope.
export function parsePublishedEvent(line: string): PublishedEnvelopeResult {
  const valid = validate(JSON.parse(line));

  return {
    valid,
    errors: (validate.errors ?? []).map((error) => `${error.instancePath} ${error.message ?? ''}`),
  };
}
