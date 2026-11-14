import { secretKeyPattern } from './create-secret-set.ts';
import type { Secret } from './create-secret-set.ts';
import { isURLText, parseURLCredentials } from './parse-url-credentials.ts';

export interface EnvSecretSources {
  // The env names the registry declares as secrets, in the order it lists them.
  readonly declared: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
}

// A declared name with a value is a declared secret. Any other value under a key that
// `secretKeyPattern` matches is collected, unless it is all digits or a URL with no password.
export function collectEnvSecrets(sources: EnvSecretSources): readonly Secret[] {
  const secrets: Secret[] = [];

  for (const name of sources.declared) {
    const value = sources.env[name];

    if (value !== undefined && value !== '') {
      secrets.push({ name, value, origin: 'declared' });
    }
  }

  for (const [name, value] of Object.entries(sources.env)) {
    if (value === undefined || !secretKeyPattern.test(name) || !isCollectable(value)) {
      continue;
    }

    secrets.push({ name, value, origin: 'collected' });

    const credentials = parseURLCredentials(value);

    if (credentials !== null) {
      secrets.push({ name, value: credentials.password, origin: 'collected' });
    }
  }

  return secrets;
}

function isCollectable(value: string): boolean {
  if (value === '' || /^[0-9]+$/u.test(value)) {
    return false;
  }

  return !isURLText(value) || parseURLCredentials(value) !== null;
}
