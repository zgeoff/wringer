import { expect, test } from 'bun:test';
import { buildRequestPlan } from './build-request-plan.ts';

test('it refuses a target with no base URL, naming the endpoint and the config to set', () => {
  const plan = buildRequestPlan({
    target: 'bare',
    endpoint: 'web',
    baseURL: undefined,
    method: 'GET',
    path: '/api/cart',
    shownPath: '/api/cart',
    headers: {},
    json: undefined,
  });

  expect(plan).toStrictEqual({
    kind: 'refuse',
    message: 'Target bare has no endpoint web.',
    hint: 'Set `baseURL` in the http config of the target, or name an endpoint it has.',
  });
});

test.each([
  {
    name: 'a path that leaves the app origin',
    method: 'GET',
    path: '//cdn.example/x',
    headers: {},
    json: undefined,
    message: '//cdn.example/x is not a path of the app at https://shop.example.',
  },
  {
    name: 'a path that is no URL',
    method: 'GET',
    path: '//[',
    headers: {},
    json: undefined,
    message: '//[ is not a path of the app at https://shop.example.',
  },
  {
    name: 'a JSON body on a GET',
    method: 'GET',
    path: '/api/cart',
    headers: {},
    json: { item: 'mug' },
    message: 'A GET request cannot send a JSON body.',
  },
  {
    name: 'a JSON body on a HEAD',
    method: 'HEAD',
    path: '/api/cart',
    headers: {},
    json: { item: 'mug' },
    message: 'A HEAD request cannot send a JSON body.',
  },
  {
    name: 'a header name HTTP forbids',
    method: 'GET',
    path: '/api/cart',
    headers: { 'bad name': 'mug' },
    json: undefined,
    message: 'A request header is not valid HTTP.',
  },
])('it refuses $name', (row) => {
  const plan = buildRequestPlan({
    target: 'local',
    endpoint: 'web',
    baseURL: 'https://shop.example',
    method: row.method,
    path: row.path,
    shownPath: row.path,
    headers: row.headers,
    json: row.json,
  });

  expect(plan).toStrictEqual({ kind: 'refuse', message: row.message, hint: expect.any(String) });
});

test('it plans a POST with its JSON body, its content type and no redirect following', () => {
  const plan = buildRequestPlan({
    target: 'local',
    endpoint: 'web',
    baseURL: 'https://shop.example',
    method: 'POST',
    path: '/api/orders',
    shownPath: '/api/orders',
    headers: {},
    json: { item: 'mug' },
  });

  expect(plan).toStrictEqual({
    kind: 'send',
    url: new URL('https://shop.example/api/orders'),
    init: {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json' }),
      redirect: 'manual',
      body: '{"item":"mug"}',
    },
  });
});

test('it plans a GET with no body', () => {
  const plan = buildRequestPlan({
    target: 'local',
    endpoint: 'web',
    baseURL: 'https://shop.example',
    method: 'GET',
    path: '/api/cart',
    shownPath: '/api/cart',
    headers: {},
    json: undefined,
  });

  expect(plan).toStrictEqual({
    kind: 'send',
    url: new URL('https://shop.example/api/cart'),
    init: { method: 'GET', headers: new Headers(), redirect: 'manual' },
  });
});

test.each([
  {
    name: 'a base URL with credentials',
    baseURL: 'https://alice:planted-url-pass@shop.example',
    path: '/api/cart',
  },
  {
    name: 'a path with credentials on the base host',
    baseURL: 'https://shop.example',
    path: '//alice:planted-url-pass@shop.example/api/cart',
  },
  {
    name: 'a path with credentials on another host',
    baseURL: 'https://shop.example',
    path: '//alice:planted-url-pass@cdn.example/x',
  },
  {
    name: 'a path with a username only',
    baseURL: 'https://shop.example',
    path: '//alice@shop.example/api/cart',
  },
])('it refuses $name without the password in the message', (row) => {
  const plan = buildRequestPlan({
    target: 'local',
    endpoint: 'web',
    baseURL: row.baseURL,
    method: 'GET',
    path: row.path,
    shownPath: row.path,
    headers: {},
    json: undefined,
  });

  expect(plan.kind).toBe('refuse');
  expect(JSON.stringify(plan)).not.toContain('planted-url-pass');
});

test('it names the origin only when it refuses credentials', () => {
  const plan = buildRequestPlan({
    target: 'local',
    endpoint: 'web',
    baseURL: 'https://shop.example',
    method: 'GET',
    path: '//alice:planted-url-pass@shop.example/api/cart',
    shownPath: '//alice:planted-url-pass@shop.example/api/cart',
    headers: {},
    json: undefined,
  });

  expect(plan).toStrictEqual({
    kind: 'refuse',
    message: 'A request to https://shop.example carries a username or password in its URL.',
    hint: expect.any(String),
  });
});

test('it names the shown path, not the given one, when a path leaves the origin', () => {
  const plan = buildRequestPlan({
    target: 'local',
    endpoint: 'web',
    baseURL: 'https://shop.example',
    method: 'GET',
    path: '//cdn.example/x?token=planted-query-token',
    shownPath: '//cdn.example/x?token=[redacted:http.query.token]',
    headers: {},
    json: undefined,
  });

  expect(plan).toStrictEqual({
    kind: 'refuse',
    message:
      '//cdn.example/x?token=[redacted:http.query.token] is not a path of the app at https://shop.example.',
    hint: expect.any(String),
  });
});
