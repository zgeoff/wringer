import { WringerError } from '@wringer/core';

// Headers match names in any case, so a caller's `Content-Type` replaces the default. `Headers`
// throws a TypeError for a name or value HTTP forbids, which is the caller's to fix.
export function buildRequestHeaders(
  given: Readonly<Record<string, string>>,
  hasBody: boolean,
): Headers {
  const headers = toHeaders(given);

  if (hasBody && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  return headers;
}

function toHeaders(given: Readonly<Record<string, string>>): Headers {
  try {
    return new Headers(given);
  } catch (error) {
    throw new WringerError('usage', {
      message: `A request header is not valid HTTP: ${error instanceof Error ? error.message : String(error)}`,
      hint: 'Pass each header as `Name: value`, with a name of letters, digits and dashes.',
    });
  }
}
