import { WringerError, defineDriver, findOwnValue } from '@wringer/core';
import type { DriverSession } from '@wringer/core';
import { z } from 'zod';
import { buildRequestPlan } from './build-request-plan.ts';
import { pickHttpEffect } from './pick-http-effect.ts';

const methodSchema = z.enum(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']);

export const httpRequestSchema = z.strictObject({
  method: methodSchema.default('GET'),
  path: z.string().startsWith('/'),
  headers: z.record(z.string(), z.string()).default({}),
  json: z.unknown().optional(),
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

const optionsSchema = z.strictObject({ timeoutMs: z.number().int().positive().default(30_000) });
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
  json: z.unknown().optional(),
});

// Requests the target's app over HTTP. GET, HEAD and OPTIONS are reads; any other method is a write,
// which a read-only target refuses unless its `readOnly.allow` grants that method and path. Each
// response is kept as evidence. The client is the driver's entry point, so it picks the transport.
export const http = defineDriver({
  name: 'http',
  options: optionsSchema,
  targetConfig: targetConfigSchema,
  client: (session, fence): HttpClient => ({
    request: fence({
      effect: (request: HttpRequest) =>
        pickHttpEffect(request.method ?? 'GET', request.path, session.config.readOnly?.allow ?? []),
      describe: (request) => `${request.method ?? 'GET'} ${request.path}`,
      run: (request) => sendRequest(session, fetch, httpRequestSchema.parse(request)),
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
      run: (args, ctx) =>
        ctx.client.request({
          method: args.method,
          path: args.path,
          headers: Object.fromEntries(args.header.map((header) => splitHeader(header))),
          json: args.json,
        }),
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

type HttpTransport = (url: URL, init: RequestInit) => Promise<Response>;

async function sendRequest(
  session: DriverSession<HttpOptions, HttpConfig>,
  transport: HttpTransport,
  request: ParsedRequest,
): Promise<HttpResponse> {
  const plan = buildRequestPlan({
    target: session.target,
    endpoint: session.config.endpoint,
    baseURL: session.config.baseURL ?? findOwnValue(session.endpoints, session.config.endpoint),
    method: request.method,
    path: request.path,
    headers: request.headers,
    json: request.json,
  });

  const signal = AbortSignal.any([session.signal, AbortSignal.timeout(session.options.timeoutMs)]);

  const fetched = await sendFetch(transport, plan.url, plan.init, signal);

  const result: HttpResponse = {
    status: fetched.response.status,
    headers: Object.fromEntries(fetched.response.headers),
    body: fetched.body,
    json: parseJSONBody(fetched.body),
  };

  await session.evidence.writeFile(
    'http',
    `${request.method.toLowerCase()}.json`,
    JSON.stringify({ request: { ...request, url: plan.url.href }, response: result }, null, 2),
  );

  return result;
}

interface FetchedResponse {
  readonly response: Response;
  readonly body: string;
}

// The body read shares the request's deadline and error mapping: a server can send its headers,
// then stall or drop the connection mid-body.
async function sendFetch(
  transport: HttpTransport,
  url: URL,
  init: RequestInit,
  signal: AbortSignal,
): Promise<FetchedResponse> {
  try {
    const response = await transport(url, { ...init, signal });
    const body = await readBodyText(response, signal);

    return { response, body };
  } catch (error) {
    if (signal.aborted) {
      throw new WringerError('timeout', {
        message: `${init.method ?? 'GET'} ${url.href} timed out.`,
      });
    }

    throw new WringerError('environment', {
      message: `${init.method ?? 'GET'} ${url.href} failed: ${String(error)}`,
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
