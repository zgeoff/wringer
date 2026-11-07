import { envelopeSchema } from '@wringer/core';
import type { Envelope } from '@wringer/core';
import { parsePublishedEnvelope } from '@wringer/core/test-utils/parse-published-envelope.ts';
import { parsePublishedEvent } from '@wringer/core/test-utils/parse-published-event.ts';
import { z } from 'zod';

export interface CLIOutput {
  // The name of each event line, in the order the CLI printed them.
  readonly events: readonly string[];
  readonly envelope: Envelope;

  // Each way a line breaks the published schema; empty when every line keeps it.
  readonly errors: readonly string[];
}

const eventLineSchema = z.object({ event: z.string() });

// The CLI prints one JSON line per event, then the envelope as its last line.
export function parseCLIOutput(stdout: string): CLIOutput {
  const lines = stdout.trimEnd().split('\n');
  const eventLines = lines.slice(0, -1);
  const last = lines.at(-1) ?? '';

  return {
    events: eventLines.map((line) => eventLineSchema.parse(parseLine(line)).event),
    envelope: envelopeSchema.parse(parseLine(last)),
    errors: [
      ...eventLines.flatMap((line) => parsePublishedEvent(line).errors),
      ...parsePublishedEnvelope(last).errors,
    ],
  };
}

function parseLine(line: string): unknown {
  const parsed: unknown = JSON.parse(line);

  return parsed;
}
