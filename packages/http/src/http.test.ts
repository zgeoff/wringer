import { expect, mock, test } from 'bun:test';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { dispatch } from '@wringer/core';
import { createTestSession } from '@wringer/core/test-utils/create-test-session.ts';
import { HttpResponse, delay, http } from 'msw';
import type { HttpTransport } from './http.ts';
import { buildBrokenBody } from './test-utils/build-broken-body.ts';
import { buildStalledBody } from './test-utils/build-stalled-body.ts';
import { createHttpWringer } from './test-utils/create-http-wringer.ts';
import { createLoopbackApp } from './test-utils/create-loopback-app.ts';
import { server } from './test-utils/mocks/server.ts';
import { SHOP_API_URL, shopRequests } from './test-utils/shop-handlers.ts';

async function setupTest() {
  const wringer = createHttpWringer(SHOP_API_URL);

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  const transport = mock<HttpTransport>((url, init) => fetch(url, init));
  const transportWringer = createHttpWringer(SHOP_API_URL, transport);

  const transportShop = await createTestSession({
    parent: import.meta.dir,
    wringer: transportWringer,
  });

  const app = createLoopbackApp();
  const loopbackWringer = createHttpWringer(app.url);

  const loopbackShop = await createTestSession({
    parent: import.meta.dir,
    wringer: loopbackWringer,
  });

  const failing = mock<HttpTransport>((url, init) =>
    url.pathname === '/'
      ? fetch(url, init)
      : Promise.reject(new Error(`connect failed for ${url.href}`)),
  );

  const failingWringer = createHttpWringer(SHOP_API_URL, failing);

  const failingShop = await createTestSession({
    parent: import.meta.dir,
    wringer: failingWringer,
  });

  const redactingWringer = createHttpWringer(SHOP_API_URL, undefined, {
    headers: ['x-shop-trace'],
    query: ['signature'],
    bodyPaths: ['$.method'],
  });

  const redactingShop = await createTestSession({
    parent: import.meta.dir,
    wringer: redactingWringer,
  });

  return {
    // Every file wringer keeps for an upload or a report: the features folders and the run logs.
    readSinks: async (root: string): Promise<string> => {
      const stateDir = join(root, wringer.stateDir);

      const names = await readdir(stateDir, { recursive: true });

      const sinks = names.filter(
        (name) => /(?:^|\/)features\//u.test(name) || name.endsWith('/log.ndjson'),
      );

      const texts = await Promise.all(
        sinks.map(async (name) => {
          const info = await stat(join(stateDir, name));

          return info.isFile() ? readFile(join(stateDir, name), 'utf8') : '';
        }),
      );

      return texts.join('\n');
    },
    stdout: () => shop.lines.join('\n'),
    redactingRoot: redactingShop.repo.root,
    readRedactingEvidence: async (path: string) => {
      const evidence: unknown = await Bun.file(join(redactingShop.repo.root, path)).json();

      return evidence;
    },
    runRedacting: (path: readonly string[], args: unknown = {}) =>
      dispatch(redactingWringer, path, args, { ...redactingShop.session, target: 'local' }),
    runFailing: (path: readonly string[], args: unknown = {}) =>
      dispatch(failingWringer, path, args, { ...failingShop.session, target: 'local' }),
    root: shop.repo.root,
    transport,
    stopApp: () => app.stop(),
    runWithTransport: (path: readonly string[], args: unknown = {}) =>
      dispatch(transportWringer, path, args, { ...transportShop.session, target: 'local' }),
    runOnLoopback: (path: readonly string[], args: unknown = {}) =>
      dispatch(loopbackWringer, path, args, { ...loopbackShop.session, target: 'local' }),
    readEvidence: async (path: string) => {
      const evidence: unknown = await Bun.file(join(shop.repo.root, path)).json();

      return evidence;
    },
    run: (target: string, path: readonly string[], args: unknown = {}) =>
      dispatch(wringer, path, args, { ...shop.session, target }),
  };
}

test('it sends a GET and keeps the response as evidence', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['http', 'request'], { path: '/api/cart' });
  const evidence = await ctx.readEvidence(result.envelope.evidence[0]?.path ?? '');

  expect({ data: result.envelope.data, evidence }).toStrictEqual({
    data: {
      status: 200,
      headers: expect.objectContaining({ 'content-type': 'application/json' }),
      body: '{"method":"GET","path":"/api/cart"}',
      json: { method: 'GET', path: '/api/cart' },
    },
    evidence: {
      request: {
        method: 'GET',
        path: '/api/cart',
        headers: {},
        url: 'https://shop.example/api/cart',
      },
      response: expect.objectContaining({ status: 200 }),
    },
  });
});

test('it sends a JSON body with its content type', async () => {
  const ctx = await setupTest();

  const received = mock<(body: unknown, contentType: string | null) => void>();

  server.use(
    http.post(`${SHOP_API_URL}/api/orders`, async (resolver) => {
      const body: unknown = await resolver.request.json();

      received(body, resolver.request.headers.get('content-type'));

      return HttpResponse.json({ ordered: true });
    }),
  );

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);

  await ctx.run('local', ['http', 'request'], {
    method: 'POST',
    path: '/api/orders',
    body: { item: 'mug', count: 2 },
  });

  expect(received).toHaveBeenCalledExactlyOnceWith({ item: 'mug', count: 2 }, 'application/json');
});

test('it sends a JSON body with the content type the caller set, in any letter case', async () => {
  const ctx = await setupTest();

  const received = mock<(contentType: string | null) => void>();

  server.use(
    http.post(`${SHOP_API_URL}/api/orders`, (resolver) => {
      received(resolver.request.headers.get('content-type'));

      return HttpResponse.json({ ordered: true });
    }),
  );

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);

  await ctx.run('local', ['http', 'request'], {
    method: 'POST',
    path: '/api/orders',
    header: ['Content-Type: application/vnd.api+json'],
    body: { item: 'mug' },
  });

  expect(received).toHaveBeenCalledExactlyOnceWith('application/vnd.api+json');
});

test('it refuses a POST on a read-only target with exit code 3 and the target hint', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['http', 'request'], {
    method: 'POST',
    path: '/api/orders',
  });

  expect({
    exitCode: result.exitCode,
    error: result.envelope.error,
    requests: shopRequests.filter((request) => request.startsWith('POST')),
  }).toStrictEqual({
    exitCode: 3,
    error: {
      code: 'read-only',
      message: '`http request` is a write, and target prod is read-only.',
      hint: 'prod is read-only: reproduce the order on local.',
    },
    requests: [],
  });
});

test('it refuses a POST inside an action that declared a read, at the client call', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['action', 'sneak-order']);

  expect({
    exitCode: result.exitCode,
    error: result.envelope.error,
    requests: shopRequests.filter((request) => request.startsWith('POST')),
  }).toStrictEqual({
    exitCode: 3,
    error: {
      code: 'read-only',
      message: 'POST /api/orders is a write, and the target is read-only.',
      hint: 'prod is read-only: reproduce the order on local.',
    },
    requests: [],
  });
});

test('it sends a POST the read-only target grants', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['http', 'request'], {
    method: 'POST',
    path: '/api/search',
    body: { query: 'mug' },
  });

  expect({ exitCode: result.exitCode, request: shopRequests.at(-1) }).toStrictEqual({
    exitCode: 0,
    request: 'POST /api/search',
  });
});

test('it refuses a path that leaves the app origin with a usage error', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['http', 'request'], {
    method: 'POST',
    path: '//127.0.0.1:9/api/search',
    body: { query: 'mug' },
  });

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 2,
    code: 'usage',
  });
});

test('it fails the doctor with a usage error when the target has no endpoint for the client', async () => {
  const ctx = await setupTest();

  await ctx.run('bare', ['attach']);

  const result = await ctx.run('bare', ['doctor']);

  expect(result.envelope.data).toStrictEqual({
    passed: false,
    results: [
      {
        name: 'http.reachable',
        status: 'failed',
        durationMs: expect.any(Number),
        code: 'usage',
        message: 'Target bare has no endpoint web.',
      },
    ],
  });
});

test('it fails the doctor with a usage error when the endpoint is named after an inherited key', async () => {
  const ctx = await setupTest();

  await ctx.run('inherited', ['attach']);

  const result = await ctx.run('inherited', ['doctor']);

  expect(result.envelope.data).toStrictEqual({
    passed: false,
    results: [
      {
        name: 'http.reachable',
        status: 'failed',
        durationMs: expect.any(Number),
        code: 'usage',
        message: 'Target inherited has no endpoint constructor.',
      },
    ],
  });
});

test.each(['GET', 'HEAD'])('it refuses a JSON body on a %s with a usage error', async (method) => {
  const ctx = await setupTest();

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['http', 'request'], {
    method,
    path: '/api/cart',
    body: { item: 'mug' },
  });

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    message: result.envelope.error?.message,
  }).toStrictEqual({
    exitCode: 2,
    code: 'usage',
    message: `A ${method} request cannot send a JSON body.`,
  });
});

test('it refuses a header that is not valid HTTP with a usage error', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['http', 'request'], {
    path: '/api/cart',
    header: ['bad name: mug'],
  });

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 2,
    code: 'usage',
  });
});

test('it returns a redirect from a granted POST without following it', async () => {
  const ctx = await setupTest();

  server.use(
    http.post(
      `${SHOP_API_URL}/api/search`,
      () => new HttpResponse(null, { status: 307, headers: { location: '/api/orders' } }),
    ),
  );

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['http', 'request'], {
    method: 'POST',
    path: '/api/search',
  });

  expect({
    exitCode: result.exitCode,
    data: result.envelope.data,
    followed: shopRequests.filter((request) => request.endsWith(' /api/orders')),
  }).toStrictEqual({
    exitCode: 0,
    data: {
      status: 307,
      headers: { location: '/api/orders' },
      body: '',
      json: null,
    },
    followed: [],
  });
});

test('it fails the doctor with the refusal when nothing listens on the app port', async () => {
  const ctx = await setupTest();

  await ctx.runOnLoopback(['attach']);
  await ctx.stopApp();

  const result = await ctx.runOnLoopback(['doctor']);

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 1,
    data: {
      passed: false,
      results: [
        {
          name: 'http.reachable',
          status: 'failed',
          code: 'environment',
          message: expect.stringContaining('ECONNREFUSED'),
          durationMs: expect.any(Number),
        },
      ],
    },
  });
});

test('it answers a request the app port refuses with an environment error and exit code 4', async () => {
  const ctx = await setupTest();

  await ctx.runOnLoopback(['attach']);
  await ctx.runOnLoopback(['doctor']);
  await ctx.stopApp();

  const result = await ctx.runOnLoopback(['http', 'request'], { path: '/api/cart' });

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 4,
    error: expect.objectContaining({
      code: 'environment',
      message: expect.stringContaining('ECONNREFUSED'),
    }),
  });
});

test('it sends each request through the transport the repo passes', async () => {
  const ctx = await setupTest();

  await ctx.runWithTransport(['attach']);
  await ctx.runWithTransport(['doctor']);

  const result = await ctx.runWithTransport(['http', 'request'], { path: '/api/cart' });

  expect({
    data: result.envelope.data,
    calls: ctx.transport.mock.calls,
    requests: shopRequests,
  }).toStrictEqual({
    data: expect.objectContaining({ status: 200, json: { method: 'GET', path: '/api/cart' } }),
    calls: [
      [new URL(`${SHOP_API_URL}/`), expect.objectContaining({ method: 'GET' })],
      [new URL(`${SHOP_API_URL}/api/cart`), expect.objectContaining({ method: 'GET' })],
    ],
    requests: ['GET /', 'GET /api/cart'],
  });
});

test('it answers a response that stalls past the request timeout with a timeout error', async () => {
  const ctx = await setupTest();

  server.use(
    http.get(`${SHOP_API_URL}/api/cart`, async () => {
      await delay('infinite');

      return HttpResponse.json({});
    }),
  );

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['http', 'request'], { path: '/api/cart' });

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 5,
    error: {
      code: 'timeout',
      message: 'GET https://shop.example/api/cart timed out.',
      hint: null,
    },
  });
});

test('it answers a body that stalls after the headers past the request timeout with a timeout error', async () => {
  const ctx = await setupTest();

  server.use(
    http.get(
      `${SHOP_API_URL}/api/cart`,
      () =>
        new HttpResponse(buildStalledBody('{"items":['), {
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['http', 'request'], { path: '/api/cart' });

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 5,
    error: {
      code: 'timeout',
      message: 'GET https://shop.example/api/cart timed out.',
      hint: null,
    },
  });
});

test('it answers a body that breaks off mid-read with an environment error', async () => {
  const ctx = await setupTest();

  server.use(
    http.get(
      `${SHOP_API_URL}/api/cart`,
      () =>
        new HttpResponse(buildBrokenBody('{"items":[', 'the connection dropped'), {
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['http', 'request'], { path: '/api/cart' });

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 4,
    code: 'environment',
  });
});

test('it passes the doctor when the app answers its health path', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['attach']);

  const result = await ctx.run('local', ['doctor']);

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: {
      passed: true,
      results: [expect.objectContaining({ name: 'http.reachable', status: 'passed' })],
    },
  });
});

test('it fails the doctor when the app answers its health path with a 5xx', async () => {
  const ctx = await setupTest();

  await ctx.run('broken', ['attach']);

  const result = await ctx.run('broken', ['doctor']);

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 1,
    data: {
      passed: false,
      results: [expect.objectContaining({ name: 'http.reachable', status: 'failed' })],
    },
  });
});

test('it keeps a planted query token and cookie out of the features folder, the run log, stdout and the envelope', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['http', 'request'], {
    path: '/api/orders?token=planted-query-token',
    header: ['cookie: sid=planted-cookie-token'],
  });

  const everything = [
    await ctx.readSinks(ctx.root),
    ctx.stdout(),
    JSON.stringify(result.envelope),
  ].join('\n');

  expect({
    leaked: everything.match(/planted-(?:query|cookie)-token/gu),
    kept: everything.includes('http.query.token') && everything.includes('http.cookie.sid'),
  }).toStrictEqual({ leaked: null, kept: true });
});

test('it redacts a configured header, query parameter and body path in the evidence', async () => {
  const ctx = await setupTest();

  await ctx.runRedacting(['attach']);
  await ctx.runRedacting(['doctor']);

  const result = await ctx.runRedacting(['http', 'request'], {
    path: '/api/cart?signature=planted-signature',
    header: ['x-shop-trace: planted-trace'],
  });

  const evidence = await ctx.readRedactingEvidence(result.envelope.evidence[0]?.path ?? '');

  expect({ data: result.envelope.data, evidence }).toStrictEqual({
    data: expect.objectContaining({
      body: '{"method":"[redacted:http.body]","path":"/api/cart"}',
      json: { method: '[redacted:http.body]', path: '/api/cart' },
    }),
    evidence: {
      request: {
        method: 'GET',
        path: '/api/cart?signature=[redacted:http.query.signature]',
        headers: { 'x-shop-trace': '[redacted:http.header.x-shop-trace]' },
        url: `${SHOP_API_URL}/api/cart?signature=[redacted:http.query.signature]`,
      },
      response: expect.objectContaining({
        json: { method: '[redacted:http.body]', path: '/api/cart' },
      }),
    },
  });
});

test('it answers a transport failure on a redacted query without the value', async () => {
  const ctx = await setupTest();

  await ctx.runFailing(['attach']);
  await ctx.runFailing(['doctor']);

  const result = await ctx.runFailing(['http', 'request'], {
    path: '/api/cart?token=planted-query-token',
  });

  expect({
    code: result.envelope.error?.code,
    message: result.envelope.error?.message,
  }).toStrictEqual({
    code: 'environment',
    message: `GET ${SHOP_API_URL}/api/cart?token=[redacted:http.query.token] failed: Error: connect failed for ${SHOP_API_URL}/api/cart?token=[redacted:http.query.token]`,
  });
});

test('it scrubs an Authorization token that an action passes on into its data', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['action', 'send-auth'], { token: 'planted-auth-token' });

  expect(result.envelope.data).toStrictEqual({
    sent: '[redacted:http.header.authorization]',
    isReal: true,
  });
});

test('it writes no evidence file for a request with evidence off, and the action gets the real response', async () => {
  const ctx = await setupTest();

  await ctx.runRedacting(['attach']);
  await ctx.runRedacting(['doctor']);

  const result = await ctx.runRedacting(['action', 'send-auth'], { token: 'planted-auth-token' });

  expect({ evidence: result.envelope.evidence, data: result.envelope.data }).toStrictEqual({
    evidence: [],
    data: { sent: '[redacted:http.header.authorization]', isReal: true },
  });
});

test('it keeps two planted set-cookie values out of every sink when the body echoes them', async () => {
  const ctx = await setupTest();

  server.use(
    http.get(`${SHOP_API_URL}/api/login`, () => {
      const headers = new Headers();

      headers.append('set-cookie', 'sid=planted-first-cookie; Path=/');
      headers.append('set-cookie', 'cart=planted-second-cookie; Path=/');

      return HttpResponse.json(
        { echoed: ['planted-first-cookie', 'planted-second-cookie'] },
        { headers },
      );
    }),
  );

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['http', 'request'], { path: '/api/login' });

  const everything = [
    await ctx.readSinks(ctx.root),
    ctx.stdout(),
    JSON.stringify(result.envelope),
  ].join('\n');

  expect(everything.match(/planted-(?:first|second)-cookie/gu)).toBeNull();
});

test('it keeps the unquoted copy of a quoted request cookie out of every sink when the body echoes it', async () => {
  const ctx = await setupTest();

  server.use(
    http.get(`${SHOP_API_URL}/api/echo-cookie`, (info) =>
      HttpResponse.json({ echoed: info.request.headers.get('cookie')?.replaceAll('"', '') }),
    ),
  );

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['http', 'request'], {
    path: '/api/echo-cookie',
    header: ['cookie: sid="planted-quoted-request-cookie"'],
  });

  const everything = [
    await ctx.readSinks(ctx.root),
    ctx.stdout(),
    JSON.stringify(result.envelope),
  ].join('\n');

  expect({
    leaked: everything.match(/planted-quoted-request-cookie/gu),
    kept: everything.includes('http.cookie.sid'),
  }).toStrictEqual({ leaked: null, kept: true });
});

test('it keeps the unquoted copy of a quoted set-cookie out of every sink when the body echoes it', async () => {
  const ctx = await setupTest();

  server.use(
    http.get(`${SHOP_API_URL}/api/login`, () =>
      HttpResponse.json(
        { echoed: 'planted-quoted-response-cookie' },
        { headers: { 'set-cookie': 'sid="planted-quoted-response-cookie"; Path=/' } },
      ),
    ),
  );

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['http', 'request'], { path: '/api/login' });

  const everything = [
    await ctx.readSinks(ctx.root),
    ctx.stdout(),
    JSON.stringify(result.envelope),
  ].join('\n');

  expect({
    leaked: everything.match(/planted-quoted-response-cookie/gu),
    kept: everything.includes('http.cookie.sid'),
  }).toStrictEqual({ leaked: null, kept: true });
});

test('it refuses an action post to a URL with a password on a read-only target without the password', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['action', 'post-to'], {
    path: '//visitor:planted-url-pass@shop.example/',
  });

  const everything = [
    await ctx.readSinks(ctx.root),
    ctx.stdout(),
    JSON.stringify(result.envelope),
  ].join('\n');

  expect({
    leaked: everything.match(/planted-url-pass/gu),
    code: result.envelope.error?.code,
  }).toStrictEqual({ leaked: null, code: 'usage' });
});
