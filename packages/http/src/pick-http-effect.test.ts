import { expect, test } from 'bun:test';
import { pickHttpEffect } from './pick-http-effect.ts';

test.each([
  { name: 'GET as a read', method: 'GET', path: '/api/cart', effect: 'read' },
  { name: 'head in lower case as a read', method: 'head', path: '/', effect: 'read' },
  { name: 'POST with no grant as a write', method: 'POST', path: '/api/orders', effect: 'write' },
  { name: 'a granted POST as a read', method: 'POST', path: '/api/search/books', effect: 'read' },
  {
    name: 'a granted path with a query as a read',
    method: 'POST',
    path: '/api/search/a?q=1',
    effect: 'read',
  },
  {
    name: 'a grant for another method as a write',
    method: 'DELETE',
    path: '/api/search/a',
    effect: 'write',
  },
] as const)('it picks $name', (row) => {
  const effect = pickHttpEffect(row.method, row.path, [{ method: 'POST', path: '/api/search/*' }]);

  expect(effect).toBe(row.effect);
});
