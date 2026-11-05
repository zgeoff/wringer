import { expect, test } from 'bun:test';
import { buildRequestPlan } from './build-request-plan.ts';

test('it refuses a target with no base URL, naming the endpoint and the config to set', () => {
  expect(() =>
    buildRequestPlan({
      target: 'bare',
      endpoint: 'web',
      baseURL: undefined,
      method: 'GET',
      path: '/api/cart',
      headers: {},
      json: undefined,
    }),
  ).toThrow(
    expect.objectContaining({
      code: 'usage',
      message: 'Target bare has no endpoint web.',
      hint: 'Set `baseURL` in the http config of the target, or name an endpoint it has.',
    }),
  );
});

test.each([
  {
    name: 'a path that leaves the app origin',
    method: 'GET',
    path: '//cdn.example/x',
    json: undefined,
  },
  { name: 'a JSON body on a GET', method: 'GET', path: '/api/cart', json: { item: 'mug' } },
  { name: 'a JSON body on a HEAD', method: 'HEAD', path: '/api/cart', json: { item: 'mug' } },
])('it refuses $name with a usage error', (row) => {
  expect(() =>
    buildRequestPlan({
      target: 'local',
      endpoint: 'web',
      baseURL: 'https://shop.example',
      method: row.method,
      path: row.path,
      headers: {},
      json: row.json,
    }),
  ).toThrow(expect.objectContaining({ code: 'usage' }));
});

test('it plans a POST with its JSON body, its content type and no redirect following', () => {
  const plan = buildRequestPlan({
    target: 'local',
    endpoint: 'web',
    baseURL: 'https://shop.example',
    method: 'POST',
    path: '/api/orders',
    headers: {},
    json: { item: 'mug' },
  });

  expect({
    url: plan.url.href,
    method: plan.init.method,
    contentType: new Headers(plan.init.headers).get('content-type'),
    redirect: plan.init.redirect,
    body: plan.init.body,
  }).toStrictEqual({
    url: 'https://shop.example/api/orders',
    method: 'POST',
    contentType: 'application/json',
    redirect: 'manual',
    body: '{"item":"mug"}',
  });
});

test('it plans a GET with no body', () => {
  const plan = buildRequestPlan({
    target: 'local',
    endpoint: 'web',
    baseURL: 'https://shop.example',
    method: 'GET',
    path: '/api/cart',
    headers: {},
    json: undefined,
  });

  expect(plan.init.body).toBeUndefined();
});
