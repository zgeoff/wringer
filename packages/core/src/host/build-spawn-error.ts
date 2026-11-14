import { WringerError } from '../wringer-error.ts';

// A spawn that fails, such as for a working folder that does not exist, is a fault of the
// environment the command runs in.
export function buildSpawnError(command: string, error: unknown): WringerError {
  const reason = error instanceof Error ? error.message : String(error);

  return new WringerError('environment', {
    message: `${command} did not start: ${reason}`,
    hint: `Check that ${command} and its working folder exist.`,
  });
}
