import { addEnvSecrets, createSecretSet, scrubFailure } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import type { ParsedInvocation } from './pick-cli-outcome.ts';

// A parse failure can quote the arguments the person typed, such as an unknown command followed by
// a header, so its error passes through the secrets of the registry and the environment.
export function scrubParsedInvocation(
  parsed: ParsedInvocation,
  wringer: Wringer,
  env: Readonly<Record<string, string | undefined>>,
): ParsedInvocation {
  if (parsed.kind !== 'failed') {
    return parsed;
  }

  const secrets = createSecretSet();

  try {
    addEnvSecrets(secrets, { declared: wringer.secrets, env });
  } catch {
    // A declared value that is too short is reported by the command that runs next; the values
    // added before it still scrub this error.
  }

  return { ...parsed, error: scrubFailure(parsed.error, secrets) ?? parsed.error };
}
