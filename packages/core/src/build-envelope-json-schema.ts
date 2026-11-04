import { z } from 'zod';
import { envelopeSchema, streamEventSchema } from './envelope.ts';

// The published schema covers both lines a command can write: an NDJSON event of a streaming
// command, and the one envelope that ends every command.
export function buildEnvelopeJSONSchema(): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://unpkg.com/@wringer/core/envelope.schema.json',
    title: 'wringer envelope',
    $defs: {
      envelope: buildSubschema(envelopeSchema),
      streamEvent: buildSubschema(streamEventSchema),
    },
    $ref: '#/$defs/envelope',
  };
}

// Only the root of a JSON Schema document may name its dialect.
function buildSubschema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, ...subschema } = z.toJSONSchema(schema, { io: 'output' });

  return subschema;
}
