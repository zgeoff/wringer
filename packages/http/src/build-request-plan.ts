import { buildRequestHeaders } from './build-request-headers.ts';

export interface RequestPlanInput {
  readonly target: string;
  readonly endpoint: string;

  // The target's `baseURL`, or else the address of its endpoint, if it has one.
  readonly baseURL: string | undefined;
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly json: unknown;
}

// A request the driver refuses before it sends anything; the caller answers it as a usage error.
export interface RequestRefusal {
  readonly kind: 'refuse';
  readonly message: string;
  readonly hint: string;
}

export type RequestPlan =
  | { readonly kind: 'send'; readonly url: URL; readonly init: RequestInit }
  | RequestRefusal;

// The URL and fetch options of one request, or why the driver refuses it. The caller adds the
// signal.
export function buildRequestPlan(input: RequestPlanInput): RequestPlan {
  if (input.baseURL === undefined) {
    return {
      kind: 'refuse',
      message: `Target ${input.target} has no endpoint ${input.endpoint}.`,
      hint: 'Set `baseURL` in the http config of the target, or name an endpoint it has.',
    };
  }

  const base = new URL(input.baseURL);

  const url = URL.parse(input.path, base.href);

  // A path such as `//host/` resolves to another origin, which the target's grants never cover.
  if (url === null || url.origin !== base.origin) {
    return {
      kind: 'refuse',
      message: `${input.path} is not a path of the app at ${base.origin}.`,
      hint: 'Pass a path that starts with one /, such as /api/search.',
    };
  }

  const hasBody = input.json !== undefined;

  // fetch refuses a body on GET or HEAD, which would otherwise read as an app that is down.
  if (hasBody && (input.method === 'GET' || input.method === 'HEAD')) {
    return {
      kind: 'refuse',
      message: `A ${input.method} request cannot send a JSON body.`,
      hint: 'Pass the values in the path, or send the body with POST, PUT or PATCH.',
    };
  }

  const headers = buildRequestHeaders(input.headers, hasBody);

  if (headers.kind === 'refuse') {
    return headers;
  }

  // A followed 307 or 308 repeats the method and body at a path the target never granted.
  return {
    kind: 'send',
    url,
    init: {
      method: input.method,
      headers: headers.headers,
      redirect: 'manual',
      ...(hasBody ? { body: JSON.stringify(input.json) } : {}),
    },
  };
}
