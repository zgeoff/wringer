import { expect, test } from 'bun:test';
import { buildRequestHeaders } from './build-request-headers.ts';

test.each([
  { given: {}, hasBody: false, expected: {} },
  { given: {}, hasBody: true, expected: { 'content-type': 'application/json' } },
  {
    given: { 'Content-Type': 'text/plain' },
    hasBody: true,
    expected: { 'content-type': 'text/plain' },
  },
  { given: { accept: 'text/html' }, hasBody: false, expected: { accept: 'text/html' } },
])('it builds $expected from $given with a body $hasBody', (row) => {
  const outcome = buildRequestHeaders(row.given, row.hasBody);

  expect(outcome).toStrictEqual({ kind: 'headers', headers: new Headers(row.expected) });
});

test('it refuses a header name HTTP forbids', () => {
  const outcome = buildRequestHeaders({ 'bad name': 'mug' }, false);

  expect(outcome).toStrictEqual({
    kind: 'refuse',
    message: 'A request header is not valid HTTP.',
    hint: 'Pass each header as `Name: value`, with a name of letters, digits and dashes.',
  });
});
