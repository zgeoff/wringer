import { streamEventSchema } from '@wringer/core';

// One NDJSON stream event as one line of text, such as a doctor check as it finishes.
export function renderHumanEvent(line: string): string {
  const event = streamEventSchema.parse(JSON.parse(line));

  return `${event.event}: ${JSON.stringify(event.data)}\n`;
}
