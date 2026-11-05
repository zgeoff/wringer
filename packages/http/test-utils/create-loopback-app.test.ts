import { expect, test } from 'bun:test';
import { createLoopbackApp } from './create-loopback-app.ts';

test('it answers a request with a 200 while it runs', async () => {
  const app = createLoopbackApp();

  const response = await fetch(`${app.url}/api/cart`);

  expect(response.status).toBe(200);
});

test('it refuses a connection once the test stops it', async () => {
  const app = createLoopbackApp();

  await app.stop();

  expect(fetch(`${app.url}/api/cart`)).rejects.toThrow(/ECONNREFUSED/u);
});
