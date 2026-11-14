import { expect, test } from 'bun:test';
import { pickReopenURL } from './pick-reopen-url.ts';

test.each([
  ['http://127.0.0.1:4100/orders?page=2', 'http://127.0.0.1:4100/orders?page=2'],
  ['https://shop.example/cart#summary', 'https://shop.example/cart#summary'],
  ['about:blank', null],
  ['chrome-error://chromewebdata/', null],
  ['data:text/html,<p>receipt</p>', null],
  ['', null],
])('it reopens %p at %p', (staleURL, expected) => {
  expect(pickReopenURL(staleURL)).toBe(expected);
});
