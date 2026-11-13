import { WringerError, defineDriver, findOwnValue } from '@wringer/core';
import type { DriverSession } from '@wringer/core';
import { z } from 'zod';
import { buildRedactedExchange, buildRedactedRequest } from './build-redacted-exchange.ts';
import { buildRedaction } from './build-redaction.ts';
import { buildRequestPlan } from './build-request-plan.ts';
import { pickHttpEffect } from './pick-http-effect.ts';
import { showPath } from './show-path.ts';

const methodSchema = z.enum(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']);

export const httpRequestSchema = z.strictObject({
  method: methodSchema.default('GET'),
  path: z.string().startsWith('/'),
  headers: z.record(z.string(), z.string()).default({}),
  json: z.unknown().optional(),

  // false: no evidence file for this request. Its secrets still join the set.
  evidence: z.boolean().default(true),
});

export type HttpRequest = z.input<typeof httpRequestSchema>;

export const httpResponseSchema = z.strictObject({
  status: z.number().int(),
  headers: z.record(z.string(), z.string()),
  body: z.string(),
  json: z.unknown(),
});

export type HttpResponse = z.infer<typeof httpResponseSchema>;

export interface HttpClient {
  readonly request: (request: HttpRequest) => Promise<HttpResponse>;
}

export type HttpTransport = (url: URL, init: RequestInit) => Promise<Response>;

const bodyPathSchema = z.string().regex(/^\$(?:\.[^.[\]]+|\[\*\])*$/u);
const nameListSchema = z.array(z.string().min(1)).default([]);

// Added to the default lists: header names in any case, query parameter names, and `$` paths of
// `.name` and `[*]` steps into request and response JSON.
const redactSchema = z.strictObject({
  headers: nameListSchema,
  query: nameListSchema,
  bodyPaths: z.array(bodyPathSchema).default([]),
});

const optionsSchema = z.strictObject({
  redact: redactSchema.prefault({}),

  timeoutMs: z.number().int().positive().default(30_000),

  // Sends each request. A repo passes its own, such as one that goes through a proxy.
  transport: z
    .custom<HttpTransport>((value) => typeof value === 'function')
    .default(() => (url: URL, init: RequestInit) => fetch(url, init)),
});

const grantSchema = z.strictObject({ method: methodSchema, path: z.string().startsWith('/') });

const targetConfigSchema = z.strictObject({
  endpoint: z.string().min(1).default('web'),
  baseURL: z.url().optional(),
  healthPath: z.string().startsWith('/').default('/'),
  readOnly: z.strictObject({ allow: z.array(grantSchema) }).optional(),
});

const headerArgsSchema = z.array(z.string().regex(/^[^:]+:.*$/u)).default([]);

const requestArgsSchema = z.strictObject({
  method: methodSchema.default('GET'),
  path: z.string().startsWith('/'),
  header: headerArgsSchema,

  // The CLI's global `--json` picks the output, so the command takes its JSON body as `--body`.
  body: z.unknown().optional(),
});

// Requests the target's app over HTTP. GET, HEAD and OPTIONS are reads; any other method is a write,
// which a read-only target refuses unless its `readOnly.allow` grants that method and path. Each
// response is kept as evidence.
export const http = defineDriver({
  name: 'http',
  options: optionsSchema,
  targetConfig: targetConfigSchema,
  client: (session, fence): HttpClient => ({
    request: fence({
      effect: (request: HttpRequest) =>
        pickHttpEffect(request.method ?? 'GET', request.path, session.config.readOnly?.allow ?? []),
      describe: (request) => {
        const shown = showPath(request.path, buildRedaction(session.options.redact));

        return `${request.method ?? 'GET'} ${shown}`;
      },
      run: async (request) => {
        const sent = await sendRequest(session, httpRequestSchema.parse(request));

        return sent.real;
      },
    }),
  }),
  commands: (command) => [
    command({
      path: ['http', 'request'],
      summary: 'Send one HTTP request to the target',
      args: requestArgsSchema,
      data: httpResponseSchema,
      decideEffect: (args, config) =>
        pickHttpEffect(args.method, args.path, config.readOnly?.allow ?? []),
      run: async (args, ctx) => {
        const headers = Object.fromEntries(args.header.map((header) => splitHeader(header)));

        const request = httpRequestSchema.parse({
          method: args.method,
          path: args.path,
          headers,
          json: args.body,
        });

        const exchange = await sendRequest(ctx.session, request);

        return exchange.redacted;
      },
    }),
  ],
  checks: [
    {
      name: 'reachable',
      timeoutMs: 10_000,
      run: async (ctx) => {
        const response = await ctx.client.request({ path: ctx.session.config.healthPath });

        if (response.status >= 500) {
          throw new WringerError('check-failed', {
            message: `GET ${ctx.session.config.healthPath} answered ${response.status}.`,
          });
        }
      },
    },
  ],
});

type HttpOptions = z.infer<typeof optionsSchema>;

type HttpConfig = z.infer<typeof targetConfigSchema>;

type ParsedRequest = z.infer<typeof httpRequestSchema>;

interface SentRequest {
  // What the action or check that called gets.
  readonly real: HttpResponse;

  // What leaves the driver: the command's data.
  readonly redacted: HttpResponse;
}

async function sendRequest(
  session: DriverSession<HttpOptions, HttpConfig>,
  request: ParsedRequest,
): Promise<SentRequest> {
  const redaction = buildRedaction(session.options.redact);

  const plan = buildRequestPlan({
    target: session.target,
    endpoint: session.config.endpoint,
    baseURL: session.config.baseURL ?? findOwnValue(session.endpoints, session.config.endpoint),
    method: request.method,
    path: request.path,
    shownPath: showPath(request.path, redaction),
    headers: request.headers,
    json: request.json,
  });

  if (plan.kind === 'refuse') {
    throw new WringerError('usage', { message: plan.message, hint: plan.hint });
  }

  const given = {
    method: request.method,
    path: request.path,
    headers: request.headers,
    json: request.json,
    url: plan.url.href,
  };

  // The request's secrets join the set before it leaves, so an error that holds one is scrubbed.
  const redactedRequest = buildRedactedRequest(given, redaction);

  addSecrets(session, redactedRequest.secrets);

  const signal = AbortSignal.any([session.signal, AbortSignal.timeout(session.options.timeoutMs)]);

  const fetched = await sendFetch(
    session.options.transport,
    plan,
    redactedRequest.request.url,
    signal,
  );

  const real: HttpResponse = {
    status: fetched.response.status,
    headers: readResponseHeaders(fetched.response.headers),
    body: fetched.body,
    json: parseJSONBody(fetched.body),
  };

  const exchange = buildRedactedExchange({ request: given, response: real }, redaction);

  addSecrets(session, exchange.secrets);

  if (request.evidence) {
    await session.evidence.writeFile(
      'http',
      `${request.method.toLowerCase()}.json`,
      JSON.stringify({ request: exchange.request, response: exchange.response }, null, 2),
    );
  }

  return { real, redacted: exchange.response };
}

function addSecrets(
  session: DriverSession<HttpOptions, HttpConfig>,
  secrets: readonly { readonly name: string; readonly value: string }[],
): void {
  for (const secret of secrets) {
    session.secrets.add(secret);
  }
}

type SendPlan = Extract<ReturnType<typeof buildRequestPlan>, { kind: 'send' }>;

interface FetchedResponse {
  readonly response: Response;
  readonly body: string;
}

// The body read shares the request's deadline and error mapping: a server can send its headers,
// then stall or drop the connection mid-body.
async function sendFetch(
  transport: HttpTransport,
  plan: SendPlan,
  shownURL: string,
  signal: AbortSignal,
): Promise<FetchedResponse> {
  try {
    const response = await transport(plan.url, { ...plan.init, signal });
    const body = await readBodyText(response, signal);

    return { response, body };
  } catch (error) {
    if (signal.aborted) {
      throw new WringerError('timeout', {
        message: `${plan.init.method ?? 'GET'} ${shownURL} timed out.`,
      });
    }

    throw new WringerError('environment', {
      message: `${plan.init.method ?? 'GET'} ${shownURL} failed: ${String(error).replaceAll(plan.url.href, shownURL)}`,
      hint: 'Check that the app is up, then run `status`.',
    });
  }
}

// A transport may hand back a body that never sees the request's abort, so `text()` would wait past
// the deadline. Cancelling the reader ends a pending read at once.
async function readBodyText(response: Response, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();

  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();

  if (reader === undefined) {
    return '';
  }

  const cancel = (): void => {
    void reader.cancel(signal.reason);
  };

  signal.addEventListener('abort', cancel, { once: true });

  try {
    let text = '';

    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      text += chunk.value;
    }

    signal.throwIfAborted();

    return text;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

// Iterating `Headers` yields each `set-cookie` on its own, so an object built from it keeps the last
// one. The cookies rejoin with a comma, which the cookie redaction splits again.
function readResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [name, value] of headers) {
    if (name !== 'set-cookie') {
      result[name] = value;
    }
  }

  const cookies = headers.getSetCookie();

  if (cookies.length > 0) {
    result['set-cookie'] = cookies.join(', ');
  }

  return result;
}

function parseJSONBody(body: string): unknown {
  try {
    const parsed: unknown = JSON.parse(body);

    return parsed;
  } catch {
    return null;
  }
}

function splitHeader(header: string): readonly [string, string] {
  const index = header.indexOf(':');

  return [header.slice(0, index).trim(), header.slice(index + 1).trim()];
}
