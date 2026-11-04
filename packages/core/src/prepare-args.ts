import type { z } from 'zod';
import type { ArgsResult } from './types.ts';

// Parses raw arguments with a command's own schema and hands the typed result to `build`, so the
// typed arguments never leave the closure that knows their type.
export function prepareArgs<Args, Prepared>(
  schema: z.ZodType<Args>,
  raw: unknown,
  build: (args: Args) => Prepared,
): ArgsResult<Prepared> {
  const parsed = schema.safeParse(raw ?? {});

  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) =>
      issue.path.length === 0 ? issue.message : `${issue.path.join('.')}: ${issue.message}`,
    );

    return { ok: false, message: `The arguments are not valid: ${problems.join('; ')}` };
  }

  return { ok: true, prepared: build(parsed.data) };
}
