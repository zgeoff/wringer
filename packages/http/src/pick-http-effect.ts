import type { Effect } from '@wringer/core';

export interface HttpGrant {
  readonly method: string;
  readonly path: string;
}

const readMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

// GET, HEAD and OPTIONS are reads. Any other call is a write unless the target grants its method and
// path, where the path may be a glob such as `/api/search/*`.
export function pickHttpEffect(method: string, path: string, grants: readonly HttpGrant[]): Effect {
  const upper = method.toUpperCase();

  if (readMethods.has(upper)) {
    return 'read';
  }

  // A path that is no URL matches no grant; the request itself then fails with a usage error.
  const pathname = URL.parse(path, 'http://wringer.invalid')?.pathname;

  if (pathname === undefined) {
    return 'write';
  }

  const granted = grants.some(
    (grant) => grant.method.toUpperCase() === upper && new Bun.Glob(grant.path).match(pathname),
  );

  return granted ? 'read' : 'write';
}
