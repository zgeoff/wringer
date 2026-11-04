import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { dispatch } from '@wringer/core';
import { createTestSession } from '../../core/test-utils/create-test-session.ts';
import { createHttpWringer } from '../test-utils/create-http-wringer.ts';
import { createShopServer } from '../test-utils/create-shop-server.ts';

async function setupTest() {
  const server = createShopServer();

  onTestFinished(() => server.stop());

  const wringer = createHttpWringer(server.url);

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  return {
    root: shop.repo.root,
    requests: server.requests,
    run: (target: string, path: readonly string[], args: unknown = {}) =>
      dispatch(wringer, path, args, { ...shop.session, target }),
  };
}

test('it sends a GET and keeps the response as evidence', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['http', 'request'], { path: '/api/cart' });

  const evidencePath = result.envelope.evidence[0]?.path ?? '';

  const evidence: unknown = await Bun.file(join(ctx.root, evidencePath)).json();

  expect({ data: result.envelope.data, evidence }).toMatchObject({
    data: { status: 200, json: { method: 'GET', path: '/api/cart' } },
    evidence: { request: { method: 'GET', path: '/api/cart' }, response: { status: 200 } },
  });
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
    requests: ctx.requests.filter((request) => request.startsWith('POST')),
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
    requests: ctx.requests.filter((request) => request.startsWith('POST')),
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

  expect({ exitCode: result.exitCode, requests: ctx.requests.at(-1) }).toStrictEqual({
    exitCode: 0,
    requests: 'POST /api/search',
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

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['http', 'request'], {
    method: 'POST',
    path: '/api/search?to=/api/orders',
  });

  expect({
    exitCode: result.exitCode,
    data: result.envelope.data,
    requests: ctx.requests.filter((request) => request.startsWith('POST')),
  }).toStrictEqual({
    exitCode: 0,
    data: expect.objectContaining({
      status: 307,
      headers: expect.objectContaining({ location: '/api/orders' }),
    }),
    requests: ['POST /api/search'],
  });
});

test('it passes the doctor when the app answers its health path', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['attach']);

  const result = await ctx.run('local', ['doctor']);

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toMatchObject({
    exitCode: 0,
    data: { passed: true, results: [{ name: 'http.reachable', status: 'passed' }] },
  });
});

test('it fails the doctor when the app answers its health path with a 5xx', async () => {
  const ctx = await setupTest();

  await ctx.run('broken', ['attach']);

  const result = await ctx.run('broken', ['doctor']);

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toMatchObject({
    exitCode: 1,
    data: { passed: false, results: [{ name: 'http.reachable', status: 'failed' }] },
  });
});
