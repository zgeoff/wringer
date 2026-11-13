import type { Envelope } from '@wringer/core';
import { z } from 'zod';

const markdownDataSchema = z.looseObject({ markdown: z.string() });

// A person reads the same envelope as an agent, as text: the error and its hint, or the data. A
// command whose data carries Markdown, such as `report`, prints only that Markdown.
export function renderHumanEnvelope(envelope: Envelope): string {
  if (envelope.error !== null) {
    const hint = envelope.error.hint === null ? '' : `\nhint: ${envelope.error.hint}`;

    return `${envelope.command} failed (${envelope.error.code}): ${envelope.error.message}${hint}\n`;
  }

  const markdown = markdownDataSchema.safeParse(envelope.data);

  if (markdown.success) {
    return `${markdown.data.markdown}\n`;
  }

  const truncated =
    envelope.truncatedPath === undefined
      ? ''
      : `\nThe data was too large to print; it is in ${envelope.truncatedPath}.`;

  const data = envelope.data === null ? '' : `\n${JSON.stringify(envelope.data, null, 2)}`;

  return `${envelope.command} passed${data}${truncated}\n`;
}
