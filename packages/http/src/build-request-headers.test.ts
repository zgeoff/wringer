import { expect, test } from 'bun:test';
import { WringerError } from '@wringer/core';
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
  expect(Object.fromEntries(buildRequestHeaders(row.given, row.hasBody))).toStrictEqual(
    row.expected,
  );
});

test('it refuses a header name HTTP forbids with a usage error', () => {
  expect(() => buildRequestHeaders({ 'bad name': 'mug' }, false)).toThrowWithMessage(
    WringerError,
    /^A request header is not valid HTTP/u,
  );
});
