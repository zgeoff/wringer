import { onTestFinished } from 'bun:test';
import { z } from 'zod';

export interface StandInPull {
  readonly number: number;
  readonly head: string;
  readonly state: 'open' | 'closed';
  readonly body: string | null;
  readonly base: string;
  readonly mergedAt?: string | null | undefined;
  readonly forbidden?: boolean | undefined;
}

export interface StandInRequest {
  readonly method: string;
  readonly path: string;
  readonly head: string | null;
  readonly authorization: string | null;
}

export interface StandInOptions {
  readonly token: string;
  readonly pulls: readonly StandInPull[];

  // Answers every request with this status.
  readonly forceStatus?: number | undefined;
}

export interface GitHubStandIn {
  readonly url: string;
  readonly requests: readonly StandInRequest[];
  readonly readBody: (number: number) => string | null | undefined;
}

// A loopback stand-in for the part of GitHub's REST API that reads and writes pull requests, for
// `/repos/acme/shop`. It refuses another token with 401, a `forbidden` pull request with 403, an
// unknown number with 404, and a description over GitHub's length limit with 422.
export function createGitHubStandIn(options: StandInOptions): GitHubStandIn {
  const pulls = new Map(options.pulls.map((pull) => [pull.number, pull]));

  const requests: StandInRequest[] = [];

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,

    // Bun.serve names its request handler `fetch`.
    // oxlint-disable-next-line zgeoff/function-verb
    fetch: (request) => {
      const url = new URL(request.url);

      requests.push({
        method: request.method,
        path: url.pathname,
        head: url.searchParams.get('head'),
        authorization: request.headers.get('authorization'),
      });

      if (options.forceStatus !== undefined) {
        return new Response('{"message":"forced"}', { status: options.forceStatus });
      }

      if (request.headers.get('authorization') !== `Bearer ${options.token}`) {
        return Response.json({ message: 'Bad credentials' }, { status: 401 });
      }

      return answer(pulls, request, url);
    },
  });

  onTestFinished(() => server.stop(true));

  return {
    url: server.url.origin,
    requests,
    readBody: (number) => pulls.get(number)?.body,
  };
}

const bodyLimit = 65_536;

async function answer(
  pulls: Map<number, StandInPull>,
  request: Request,
  url: URL,
): Promise<Response> {
  if (url.pathname === '/repos/acme/shop/pulls' && request.method === 'GET') {
    const head = url.searchParams.get('head');

    return Response.json(
      [...pulls.values()]
        .filter((pull) => pull.state === 'open' && `acme:${pull.head}` === head)
        .map((pull) => buildPullJSON(pull)),
    );
  }

  const number = Number(
    /^\/repos\/acme\/shop\/pulls\/(?<number>\d+)$/u.exec(url.pathname)?.groups?.['number'],
  );

  const pull = pulls.get(number);

  if (pull === undefined) {
    return Response.json({ message: 'Not Found' }, { status: 404 });
  }

  if (pull.forbidden === true) {
    return Response.json({ message: 'Forbidden' }, { status: 403 });
  }

  if (request.method === 'PATCH') {
    const json: unknown = await request.json();

    const written = z.object({ body: z.string() }).parse(json);

    if (written.body.length > bodyLimit) {
      return Response.json({ message: 'Validation Failed' }, { status: 422 });
    }

    const changed = { ...pull, body: written.body };

    pulls.set(number, changed);

    return Response.json(buildPullJSON(changed));
  }

  return Response.json(buildPullJSON(pull));
}

function buildPullJSON(pull: StandInPull): unknown {
  return {
    number: pull.number,
    html_url: `https://github.com/acme/shop/pull/${pull.number}`,
    body: pull.body,
    state: pull.state,
    merged_at: pull.mergedAt ?? null,
    base: { ref: pull.base },
  };
}
