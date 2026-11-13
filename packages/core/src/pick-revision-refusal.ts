import type { SecretSet } from './create-secret-set.ts';
import { WringerError } from './wringer-error.ts';

// `revision-read` keeps the revision unscrubbed, as `done` compares it with the revision it reads,
// so a revision that holds any spelling of a known secret fails the doctor. The message names the
// secret, never the value.
export function pickRevisionRefusal(revision: string, secrets: SecretSet): WringerError | null {
  const name = secrets.findSecret(revision);

  if (name === null) {
    return null;
  }

  return new WringerError('usage', {
    message: `The target's revision holds the secret ${name}, and a revision goes unscrubbed into the run log.`,
    hint: `Make \`revision\` return the commit id the deployment runs, with no part of ${name}.`,
  });
}
