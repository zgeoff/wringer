import type { StatePort } from '../state/create-file-state.ts';
import type { RunID } from '../state/run-event.ts';
import { WringerError } from '../wringer-error.ts';
import type { SecretSet } from './create-secret-set.ts';

// Adds each secret that a process of the run kept in the run's secrets file. A run whose file is
// gone adds none: each command scrubbed what it wrote.
export async function readRunSecrets(
  state: StatePort,
  secrets: SecretSet,
  runID: RunID,
): Promise<void> {
  for (const stored of await state.readSecrets(runID)) {
    secrets.add(stored);
  }
}

// The read for a run whose declared values live only in its secrets file. A file that is gone or
// unreadable fails with `environment`, as no other source holds the values, so a run without them
// would go on unscrubbed.
export async function readRequiredRunSecrets(
  state: StatePort,
  secrets: SecretSet,
  runID: RunID,
): Promise<void> {
  const stored = await state.readSecretsIfPresent(runID).catch((): null => null);

  if (stored === null) {
    throw new WringerError('environment', {
      message: `The secrets file of run ${runID} is missing or unreadable.`,
      hint: 'Run `down`, then `up` again.',
    });
  }

  for (const secret of stored) {
    secrets.add(secret);
  }
}
