import { expect, test } from 'bun:test';
import { isListedOrigin } from './is-listed-origin.ts';

test.each([
  { url: 'http://127.0.0.1:4000/orders', origins: ['http://127.0.0.1:4000'], expected: true },
  { url: 'http://127.0.0.1:4001/', origins: ['http://127.0.0.1:4000'], expected: false },
  { url: 'https://127.0.0.1:4000/', origins: ['http://127.0.0.1:4000'], expected: false },
  { url: 'about:blank', origins: ['http://127.0.0.1:4000'], expected: false },
  { url: 'not a url', origins: ['http://127.0.0.1:4000'], expected: false },
  { url: 'http://127.0.0.1:4000/', origins: [], expected: false },
])('#isListedOrigin returns $expected for $url among $origins', (row) => {
  expect(isListedOrigin(row.url, row.origins)).toBe(row.expected);
});
