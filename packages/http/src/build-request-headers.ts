import type { RequestRefusal } from './build-request-plan.ts';

export type HeadersOutcome =
  | { readonly kind: 'headers'; readonly headers: Headers }
  | RequestRefusal;

// Headers match names in any case, so a caller's `Content-Type` replaces the default. `Headers`
// throws a TypeError for a name or value HTTP forbids, which is the caller's to fix.
export function buildRequestHeaders(
  given: Readonly<Record<string, string>>,
  hasBody: boolean,
): HeadersOutcome {
  const headers = toHeaders(given);

  if (headers === null) {
    return {
      kind: 'refuse',
      message: 'A request header is not valid HTTP.',
      hint: 'Pass each header as `Name: value`, with a name of letters, digits and dashes.',
    };
  }

  if (hasBody && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  return { kind: 'headers', headers };
}

function toHeaders(given: Readonly<Record<string, string>>): Headers | null {
  try {
    return new Headers(given);
  } catch {
    return null;
  }
}
