import { Ajv2020 } from 'ajv/dist/2020.js';
import publishedSchema from '../../envelope.schema.json' with { type: 'json' };

export interface PublishedEnvelopeResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const validate = new Ajv2020({ allErrors: true, strict: true }).compile(publishedSchema);

// Checks one line a wringer command wrote against the schema file the core package publishes, so a
// test fails when the output and the published contract drift apart.
export function parsePublishedEnvelope(line: string): PublishedEnvelopeResult {
  const valid = validate(JSON.parse(line));

  return {
    valid,
    errors: (validate.errors ?? []).map((error) => `${error.instancePath} ${error.message ?? ''}`),
  };
}
