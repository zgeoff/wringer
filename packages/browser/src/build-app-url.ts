import { WringerError } from '@wringer/core';

// A goto opens a page of the target app and nothing else: a `javascript:` URL would run a script
// that clicks past the write fence, and `//host/` would leave the app.
export function buildAppURL(path: string, baseURL: string): string | WringerError {
  const base = new URL(baseURL);
  const url = new URL(path, base);

  if (!path.startsWith('/') || path.startsWith('//') || url.origin !== base.origin) {
    return new WringerError('usage', {
      message: `${path} is not a path of the app at ${base.origin}.`,
      hint: 'Pass a path that starts with one /, such as /orders.',
    });
  }

  return url.href;
}
