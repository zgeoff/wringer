import type { StatePort } from './create-file-state.ts';
import { minimumTokenLength } from './create-secret-set.ts';
import type { SecretSet } from './create-secret-set.ts';
import type { RunID } from './run-events.ts';
import { toWringerError } from './to-wringer-error.ts';
import type { CollectedSecret, SecretCollector } from './types.ts';
import type { WringerError } from './wringer-error.ts';

export interface SecretCollectorOptions {
  readonly secrets: SecretSet;
  readonly state: StatePort;
  readonly runID: RunID;

  // Takes the write of each kept secret, settled with its failure or null.
  readonly writes: Promise<WringerError | null>[];
}

// A secret a driver learns at runtime joins the set at once, and goes to the run's secrets file for
// the run's later commands.
export function makeSecretCollector(options: SecretCollectorOptions): SecretCollector['add'] {
  return (secret) => {
    options.secrets.add({ ...secret, origin: 'collected' });

    if (secret.value.length >= minimumTokenLength) {
      options.writes.push(writeSecret(options, secret));
    }
  };
}

async function writeSecret(
  options: SecretCollectorOptions,
  secret: CollectedSecret,
): Promise<WringerError | null> {
  try {
    await options.state.appendSecret(options.runID, secret);

    return null;
  } catch (error) {
    return toWringerError(error);
  }
}
