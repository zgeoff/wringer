import { WringerError } from '@wringer/core';
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

export interface RequestPlan {
  readonly url: URL;
  readonly init: RequestInit;
}

// The URL and fetch options of one request, or a usage error for a request the driver refuses
// before it sends anything. The caller adds the signal.
export function buildRequestPlan(input: RequestPlanInput): RequestPlan {
  if (input.baseURL === undefined) {
    throw new WringerError('usage', {
      message: `Target ${input.target} has no endpoint ${input.endpoint}.`,
      hint: 'Set `baseURL` in the http config of the target, or name an endpoint it has.',
    });
  }

  const base = new URL(input.baseURL);

  const url = URL.parse(input.path, base.href);

  // A path such as `//host/` resolves to another origin, which the target's grants never cover.
  if (url === null || url.origin !== base.origin) {
    throw new WringerError('usage', {
      message: `${input.path} is not a path of the app at ${base.origin}.`,
      hint: 'Pass a path that starts with one /, such as /api/search.',
    });
  }

  const hasBody = input.json !== undefined;

  // fetch refuses a body on GET or HEAD, which would otherwise read as an app that is down.
  if (hasBody && (input.method === 'GET' || input.method === 'HEAD')) {
    throw new WringerError('usage', {
      message: `A ${input.method} request cannot send a JSON body.`,
      hint: 'Pass the values in the path, or send the body with POST, PUT or PATCH.',
    });
  }

  // A followed 307 or 308 repeats the method and body at a path the target never granted.
  return {
    url,
    init: {
      method: input.method,
      headers: buildRequestHeaders(input.headers, hasBody),
      redirect: 'manual',
      ...(hasBody ? { body: JSON.stringify(input.json) } : {}),
    },
  };
}
