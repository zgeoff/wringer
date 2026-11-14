import type { StatePort } from '../state/create-file-state.ts';
import type { RunID } from '../state/run-event.ts';
import type { SecretSet } from './create-secret-set.ts';

// Adds each secret that a process of the run kept in the run's secrets file. A run whose file is
// gone adds none: each command scrubbed what it wrote.
export async function readRunSecrets(
  state: StatePort,
  secrets: SecretSet,
  runID: RunID,
): Promise<void> {
  for (const stored of await state.readSecrets(runID)) {
    secrets.add({ ...stored, origin: 'collected' });
  }
}
