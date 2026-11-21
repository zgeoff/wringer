import { expect, test } from 'bun:test';
import { collectEndpointURLs } from './collect-endpoint-urls.ts';

function setupTest() {
  return { runEndpoints: { web: 'http://shop.test', admin: 'http://admin.shop.test' } };
}

test('it lists the default endpoint first, then each listed one', () => {
  const ctx = setupTest();
  const urls = collectEndpointURLs({ endpoint: 'web', endpoints: ['admin'] }, ctx.runEndpoints);

  expect(urls).toStrictEqual([
    { name: 'web', url: 'http://shop.test' },
    { name: 'admin', url: 'http://admin.shop.test' },
  ]);
});

test('it takes the base URL of the config for the default endpoint', () => {
  const ctx = setupTest();

  const urls = collectEndpointURLs(
    { endpoint: 'web', baseURL: 'http://override.test', endpoints: [] },
    ctx.runEndpoints,
  );

  expect(urls).toStrictEqual([{ name: 'web', url: 'http://override.test' }]);
});

test('it lists the default endpoint once when the config lists it again', () => {
  const ctx = setupTest();
  const urls = collectEndpointURLs({ endpoint: 'web', endpoints: ['web'] }, ctx.runEndpoints);

  expect(urls).toStrictEqual([{ name: 'web', url: 'http://shop.test' }]);
});

test.each([
  { case: 'an unknown listed name', config: { endpoint: 'web', endpoints: ['billing'] } },
  { case: 'a name every object inherits', config: { endpoint: 'web', endpoints: ['constructor'] } },
])('it leaves the URL of $case undefined', (row) => {
  const ctx = setupTest();
  const urls = collectEndpointURLs(row.config, ctx.runEndpoints);

  expect(urls[1]).toStrictEqual({ name: row.config.endpoints[0], url: undefined });
});
