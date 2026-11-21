import { z } from 'zod';
import { raceDeadline } from '../race-deadline.ts';
import { WringerError } from '../wringer-error.ts';
import type { DeclaredSecretSource, DeclaredSecretValues } from './declared-secret-source.ts';

const valuesSchema = z.record(z.string(), z.string().optional());

// Reads the source once. A source that throws fails with `environment` and names only the error's
// class, as its text may hold a secret. A result that is not a record of strings fails the same.
export async function readDeclaredSecrets(
  source: DeclaredSecretSource,
  signal: AbortSignal,
): Promise<DeclaredSecretValues> {
  let result: unknown;

  try {
    result = await raceDeadline(
      Promise.resolve().then(() => (typeof source === 'function' ? source(signal) : source)),
      signal,
    );
  } catch (error) {
    if (error instanceof WringerError && error.code === 'timeout') {
      throw error;
    }

    throw new WringerError('environment', {
      message: `The \`env\` source threw ${describeErrorClass(error)}.`,
      hint: 'Fix the source, then run the command again. Its error text is not shown, as it may hold a secret.',
    });
  }

  const parsed = valuesSchema.safeParse(result);

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
