import { expect, test } from 'bun:test';
import { buildBrokenBody } from './build-broken-body.ts';

test('it fails a read with the reason', () => {
  const reader = buildBrokenBody('{"items":[', 'the connection dropped').getReader();

  expect(reader.read()).rejects.toThrowWithMessage(Error, 'the connection dropped');
});

test('it fails the whole body with the reason when read to the end', () => {
  const body = new Response(buildBrokenBody('{"items":[', 'the connection dropped'));

  expect(body.text()).rejects.toThrowWithMessage(Error, 'the connection dropped');
});
