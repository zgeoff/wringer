import { collectEnvSecrets } from './collect-env-secrets.ts';
import type { EnvSecretSources } from './collect-env-secrets.ts';
import type { SecretSet } from './create-secret-set.ts';

// Adds the registry's declared env names and the secret-looking process env values to the set. A
// declared value under 8 characters throws a `usage` error that names the variable, never the value.
export function addEnvSecrets(secrets: SecretSet, sources: EnvSecretSources): void {
  for (const secret of collectEnvSecrets(sources)) {
    secrets.add(secret);
  }
}
