import { expect, test } from 'bun:test';
import { readUnusedPort } from './read-unused-port.ts';

test('it gives a loopback port that refuses a connection', async () => {
  const port = await readUnusedPort();

  expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow(/ECONNREFUSED/u);
});
