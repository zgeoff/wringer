import { z } from 'zod';
import { raceDeadline } from '../race-deadline.ts';
import { WringerError } from '../wringer-error.ts';
import type { DeclaredSecretSource, DeclaredSecretValues } from './declared-secret-source.ts';

const valuesSchema = z.record(z.string(), z.string().optional());

// Reads the source once. A source that throws, or a result with a getter that throws, fails with
// `environment` and names only the error's class, as its text may hold a secret. Only the
// command's own deadline gives a timeout.
export async function readDeclaredSecrets(
  source: DeclaredSecretSource,
  signal: AbortSignal,
): Promise<DeclaredSecretValues> {
  let parsed: z.ZodSafeParseResult<DeclaredSecretValues>;

  try {
    const result: unknown = await raceDeadline(
      Promise.resolve().then(() => (typeof source === 'function' ? source(signal) : source)),
      signal,
    );

    parsed = valuesSchema.safeParse(result);
  } catch (error) {
    if (signal.aborted) {
      throw new WringerError('timeout', {
        message: "The command's deadline passed while the `env` source was read.",
        hint: 'Pass a longer `--timeout-ms`, then run `up` again.',
      });
    }

    throw new WringerError('environment', {
      message: `The \`env\` source threw ${describeErrorClass(error)}.`,
      hint: 'Fix the source, then run the command again. Its error text is not shown, as it may hold a secret.',
    });
  }

  if (!parsed.success) {
    throw new WringerError('environment', {
      message: 'The `env` source did not give a record of secret names to string values.',
      hint: 'Make `env` a record, or a function that returns one, of `{ NAME: "value" }`.',
    });
  }

  return parsed.data;
}

function describeErrorClass(error: unknown): string {
  return error instanceof Error
    ? `an error of class ${error.constructor.name}`
    : 'a value that is not an error';
}
