import type { Secret } from './create-secret-set.ts';
import { parseURLCredentials } from './parse-url-credentials.ts';

// The password of each URL in a driver's config, and the `user:password` pair that Basic auth
// encodes, both under the placeholder name `<driver>.url`.
export function collectURLPasswords(driver: string, config: unknown): readonly Secret[] {
  return collectStrings(config).flatMap((text): Secret[] => {
    const credentials = parseURLCredentials(text);

    if (credentials === null) {
      return [];
    }

    const name = `${driver}.url`;

    return [
      { name, value: credentials.password, origin: 'collected' },
      { name, value: `${credentials.username}:${credentials.password}`, origin: 'collected' },
    ];
  });
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (typeof value !== 'object' || value === null) {
    return [];
  }

  return Object.values(value).flatMap((item: unknown) => collectStrings(item));
}
