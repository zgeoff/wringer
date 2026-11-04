import { expect, mock, test } from 'bun:test';
import { join } from 'node:path';
import { dispatch } from '@wringer/core';
import { HttpResponse, delay, http } from 'msw';
import { server } from '../../../test-utils/mocks/node.ts';
import { createTestSession } from '../../core/test-utils/create-test-session.ts';
import { createHttpWringer } from '../test-utils/create-http-wringer.ts';
import { SHOP_API_URL, shopRequests } from '../test-utils/shop-handlers.ts';

async function setupTest() {
  const wringer = createHttpWringer(SHOP_API_URL);

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  return {
    root: shop.repo.root,
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
    json: { item: 'mug', count: 2 },
  });

  expect(received).toHaveBeenCalledExactlyOnceWith({ item: 'mug', count: 2 }, 'application/json');
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
    json: { query: 'mug' },
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
    json: { query: 'mug' },
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

test('it answers a connection failure with an environment error', async () => {
  const ctx = await setupTest();

  server.use(http.get(`${SHOP_API_URL}/api/cart`, () => HttpResponse.error()));

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['http', 'request'], { path: '/api/cart' });

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 4,
    code: 'environment',
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

  expect(result.envelope.error).toStrictEqual({
    code: 'timeout',
    message: 'GET https://shop.example/api/cart timed out.',
    hint: null,
  });
});

test('it answers a body that breaks off mid-read with an environment error', async () => {
  const ctx = await setupTest();

  server.use(
    http.get(`${SHOP_API_URL}/api/cart`, () => {
      const body = new ReadableStream({
        start: (controller) => {
          controller.enqueue(new TextEncoder().encode('{"items":['));
          controller.error(new Error('the connection dropped'));
        },
      });

      return new HttpResponse(body, { headers: { 'content-type': 'application/json' } });
    }),
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
