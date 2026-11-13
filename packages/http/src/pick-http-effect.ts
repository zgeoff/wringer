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
  const url = URL.parse(path, 'http://wringer.invalid');

  if (url === null) {
    return 'write';
  }

  // The driver refuses a URL with credentials as a usage error before it sends anything, so the
  // write fence must not answer first with a message that shows the password.
  if (url.username !== '' || url.password !== '') {
    return 'read';
  }

  const pathname = url.pathname;

  const granted = grants.some(
    (grant) => grant.method.toUpperCase() === upper && new Bun.Glob(grant.path).match(pathname),
  );

  return granted ? 'read' : 'write';
}
