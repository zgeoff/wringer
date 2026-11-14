import type { LaunchLine } from './launch-line-schema.ts';
import { launchLineSchema } from './launch-line-schema.ts';

// A line that holds no JSON object, such as plain text or a JSON array, reaches `ready` as its text.
export function parseLaunchLine(line: string): LaunchLine {
  const parsed = launchLineSchema.safeParse(parseJSON(line));

  return parsed.success ? parsed.data : { message: line };
}

function parseJSON(line: string): unknown {
  try {
    const parsed: unknown = JSON.parse(line);

    return parsed;
  } catch {
    return undefined;
  }
}
