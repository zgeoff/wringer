import { WringerError, defineDriver, findOwnValue } from '@wringer/core';
import type { DriverSession } from '@wringer/core';
import { z } from 'zod';
import { buildRequestPlan } from './build-request-plan.ts';
import { pickHttpEffect } from './pick-http-effect.ts';
import type { HttpGrant } from './pick-http-effect.ts';
import {
  buildRedactedExchange,
  buildRedactedRequest,
} from './redaction/build-redacted-exchange.ts';
import { buildRedaction } from './redaction/build-redaction.ts';
import { showPath } from './show-path.ts';

const methodSchema = z.enum(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']);

export const httpRequestSchema = z.strictObject({
  method: methodSchema.default('GET'),
  path: z.string().startsWith('/'),
  headers: z.record(z.string(), z.string()).default({}),
  json: z.unknown().optional(),

  // false: no evidence file for this request. Its secrets still join the set.
  evidence: z.boolean().default(true),

  // The endpoint to send to: the target's own, or one named in its `endpoints`.
  endpoint: z.string().min(1).optional(),

  // false: the transport leaves the session off this request.
  auth: z.boolean().default(true),
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

// What the driver tells a transport about a request: the endpoint it goes to, and whether it goes
// with the session.
export interface HttpTransportRoute {
  readonly endpoint: string;
  readonly auth: boolean;
}

export type HttpTransport = (
  url: URL,
  init: RequestInit,
  route: HttpTransportRoute,
) => Promise<Response>;

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
    .default(() => runFetch),
});

const grantSchema = z.strictObject({
  method: methodSchema,
  path: z.string().startsWith('/'),

  // The endpoint the grant covers; none means the target's own endpoint.
  endpoint: z.string().min(1).optional(),
});

const namedEndpointSchema = z.strictObject({
  healthPath: z.string().startsWith('/').default('/'),

  // false: the doctor requests the health path without the session.
  healthAuth: z.boolean().default(true),
});

const targetConfigSchema = z.strictObject({
  endpoint: z.string().min(1).default('web'),

  // Applies to the endpoint above only.
  baseURL: z.url().optional(),
  healthPath: z.string().startsWith('/').default('/'),
  healthAuth: z.boolean().default(true),

  // More endpoints the driver may call, each at its address in the target's endpoints.
  endpoints: z.record(z.string().min(1), namedEndpointSchema).default({}),
  readOnly: z.strictObject({ allow: z.array(grantSchema) }).optional(),
});

const headerArgsSchema = z.array(z.string().regex(/^[^:]+:.*$/u)).default([]);

const requestArgsSchema = z.strictObject({
  method: methodSchema.default('GET'),
  path: z.string().startsWith('/'),
  header: headerArgsSchema,
  endpoint: z.string().min(1).optional(),

  // `--no-auth` sends the request without the session.
  auth: z.boolean().default(true),

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
        pickHttpEffect(
          request.method ?? 'GET',
          request.path,
          grantsFor(session.config, request.endpoint ?? session.config.endpoint),
        ),
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
        pickHttpEffect(args.method, args.path, grantsFor(config, args.endpoint ?? config.endpoint)),
      run: async (args, ctx) => {
        const headers = Object.fromEntries(args.header.map((header) => splitHeader(header)));

        const request = httpRequestSchema.parse({
          method: args.method,
          path: args.path,
          headers,
          json: args.body,
          endpoint: args.endpoint,
          auth: args.auth,
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
        const config = ctx.session.config;

        for (const endpoint of listEndpointNames(ctx.session)) {
          const probe = pickHealth(config, endpoint);
          const where = endpoint === config.endpoint ? '' : ` on endpoint ${endpoint}`;

          const response = await requestHealth(
            ctx.client,
            endpoint,
            probe,
            endpoint === config.endpoint,
          );

          if (response.status >= 500) {
            throw new WringerError('check-failed', {
              message: `GET ${probe.healthPath}${where} answered ${response.status}.`,
            });
          }
        }
      },
    },
  ],
});

// The driver tells its own transport from a repo's by this function.
function runFetch(url: URL, init: RequestInit): Promise<Response> {
  return fetch(url, init);
}

type HttpConfig = z.infer<typeof targetConfigSchema>;

// The grants that cover one endpoint. A grant with no endpoint covers the target's own.
function grantsFor(config: HttpConfig, endpoint: string): readonly HttpGrant[] {
  return (config.readOnly?.allow ?? []).filter(
    (grant) => (grant.endpoint ?? config.endpoint) === endpoint,
  );
}

type HttpOptions = z.infer<typeof optionsSchema>;

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
  const endpoint = request.endpoint ?? session.config.endpoint;
  const names = listEndpointNames(session);

  if (!names.includes(endpoint)) {
    throw new WringerError('usage', {
      message: `Target ${session.target} has no http endpoint ${endpoint}.`,
      hint: `Name one of: ${names.join(', ')}.`,
    });
  }

  refuseUnreceivedAuth(session, request);

  const isDefault = endpoint === session.config.endpoint;

  const plan = buildRequestPlan({
    target: session.target,
    endpoint,
    baseURL:
      (isDefault ? session.config.baseURL : undefined) ?? findOwnValue(session.endpoints, endpoint),
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
    { shownURL: redactedRequest.request.url, route: { endpoint, auth: request.auth } },
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
      JSON.stringify(
        {
          endpoint,
          auth: request.auth,
          request: exchange.request,
          response: exchange.response,
        },
        null,
        2,
      ),
    );
  }

  return { real, redacted: exchange.response };
}

// The default endpoint, then each endpoint the driver's config or the target names.
function listEndpointNames(session: DriverSession<HttpOptions, HttpConfig>): string[] {
  return [
    ...new Set([
      session.config.endpoint,
      ...Object.keys(session.config.endpoints),
      ...Object.keys(session.endpoints),
    ]),
  ];
}

// A transport that declares fewer than three parameters cannot receive the auth choice.
function refuseUnreceivedAuth(
  session: DriverSession<HttpOptions, HttpConfig>,
  request: ParsedRequest,
): void {
  const config = session.config;
  const transport = session.options.transport;

  const leavesSessionOff =
    !request.auth ||
    !config.healthAuth ||
    Object.values(config.endpoints).some((named) => !named.healthAuth);

  if (!leavesSessionOff || transport === runFetch || transport.length >= 3) {
    return;
  }

  throw new WringerError('usage', {
    message: 'A request without the session needs a transport that takes the route.',
    hint: 'Declare the third parameter of the transport, `(url, init, route)`, and leave the session off when `route.auth` is false.',
  });
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

interface SentRoute {
  readonly shownURL: string;
  readonly route: HttpTransportRoute;
}

// The body read shares the request's deadline and error mapping: a server can send its headers,
// then stall or drop the connection mid-body.
async function sendFetch(
  transport: HttpTransport,
  plan: SendPlan,
  sent: SentRoute,
  signal: AbortSignal,
): Promise<FetchedResponse> {
  const shownURL = sent.shownURL;

  try {
    const response = await transport(plan.url, { ...plan.init, signal }, sent.route);
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

interface HealthProbe {
  readonly healthPath: string;
  readonly healthAuth: boolean;
}

// An endpoint with no entry in the config's `endpoints` is probed at the defaults.
function pickHealth(config: HttpConfig, endpoint: string): HealthProbe {
  if (endpoint === config.endpoint) {
    return config;
  }

  return findOwnValue(config.endpoints, endpoint) ?? { healthPath: '/', healthAuth: true };
}

// A failure that escapes the request names the endpoint, as a bad status does.
async function requestHealth(
  client: HttpClient,
  endpoint: string,
  probe: HealthProbe,
  isDefault: boolean,
): Promise<HttpResponse> {
  try {
    return await client.request({
      path: probe.healthPath,
      endpoint,
      auth: probe.healthAuth,
    });
  } catch (error) {
    if (isDefault || !(error instanceof WringerError)) {
      throw error;
    }

    const message = `${error.message} (endpoint ${endpoint})`;

    const details =
      error.hint === undefined
        ? { message, data: error.data }
        : { message, hint: error.hint, data: error.data };

    throw new WringerError(error.code, details);
  }
}
