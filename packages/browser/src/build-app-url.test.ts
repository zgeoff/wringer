import { expect, test } from 'bun:test';
import { buildAppURL } from './build-app-url.ts';

test('it resolves a path against the app base URL', () => {
  expect(buildAppURL('/orders?page=2', 'http://127.0.0.1:4100/shop/')).toBe(
    'http://127.0.0.1:4100/orders?page=2',
  );
});

test.each([
  // oxlint-disable-next-line no-script-url -- the guard must refuse this URL
  ['javascript:alert(1)'],
  ['//example.com/orders'],
  ['https://example.com/orders'],
  ['orders'],
  ['//['],
])('it refuses %s with a usage error', (path) => {
  expect(buildAppURL(path, 'http://127.0.0.1:4100/')).toMatchObject({ code: 'usage' });
});
