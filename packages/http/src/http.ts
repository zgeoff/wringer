import { WringerError, defineDriver } from '@wringer/core';
import type { DriverSession } from '@wringer/core';
import { z } from 'zod';
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
// response is kept as evidence.
export const http = defineDriver({
  name: 'http',
  options: optionsSchema,
  targetConfig: targetConfigSchema,
  client: (session, fence): HttpClient => ({
    request: fence({
      effect: (request: HttpRequest) =>
        pickHttpEffect(request.method ?? 'GET', request.path, session.config.readOnly?.allow ?? []),
      describe: (request) => `${request.method ?? 'GET'} ${request.path}`,
      run: (request) => sendRequest(session, httpRequestSchema.parse(request)),
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

async function sendRequest(
  session: DriverSession<HttpOptions, HttpConfig>,
  request: ParsedRequest,
): Promise<HttpResponse> {
  const url = new URL(request.path, getBaseURL(session));

  const hasBody = request.json !== undefined;
  const signal = AbortSignal.any([session.signal, AbortSignal.timeout(session.options.timeoutMs)]);

  const headers = hasBody
    ? { 'content-type': 'application/json', ...request.headers }
    : request.headers;

  // A followed 307 or 308 repeats the method and body at a path the target never granted.
  const response = await sendFetch(url, {
    method: request.method,
    headers,
    signal,
    redirect: 'manual',
    ...(hasBody ? { body: JSON.stringify(request.json) } : {}),
  });

  const body = await response.text();

  const result: HttpResponse = {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body,
    json: parseJSONBody(body),
  };

  await session.evidence.writeFile(
    'http',
    `${request.method.toLowerCase()}.json`,
    JSON.stringify({ request: { ...request, url: url.href }, response: result }, null, 2),
  );

  return result;
}

function getBaseURL(session: DriverSession<HttpOptions, HttpConfig>): string {
  const baseURL = session.config.baseURL ?? session.endpoints[session.config.endpoint];

  if (baseURL === undefined) {
    throw new WringerError('usage', {
      message: `Target ${session.target} has no endpoint ${session.config.endpoint}.`,
      hint: 'Set `baseURL` in the http config of the target, or name an endpoint it has.',
    });
  }

  return baseURL;
}

async function sendFetch(url: URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (init.signal?.aborted === true) {
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
