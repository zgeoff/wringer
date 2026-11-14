import { WringerError } from '../wringer-error.ts';
import { runEventSchema } from './run-event.ts';
import type { RunEvent } from './run-event.ts';

// An event counts once its line ends: the next append cuts a last line with no newline, even one
// that parses, so a reader skips it too. A whole line that is no event is corruption.
export function parseRunLog(text: string): readonly RunEvent[] {
  const lines = text
    .slice(0, text.lastIndexOf('\n') + 1)
    .split('\n')
    .slice(0, -1);

  return lines.map((line, index) => {
    const parsed = runEventSchema.safeParse(parseJSONLine(line));

    if (!parsed.success) {
      throw new WringerError('environment', {
        message: `The run log is corrupt: line ${index + 1} is not a run event.`,
      });
    }

    return parsed.data;
  });
}

function parseJSONLine(line: string): unknown {
  try {
    const parsed: unknown = JSON.parse(line);

    return parsed;
  } catch {
    return undefined;
  }
}
