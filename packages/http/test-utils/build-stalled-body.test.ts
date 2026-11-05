import { expect, test } from 'bun:test';
import { setImmediate } from 'node:timers/promises';
import { buildStalledBody } from './build-stalled-body.ts';

test('it sends the prefix first', async () => {
  const reader = buildStalledBody('{"items":[').getReader();

  const first = await reader.read();

  expect(new TextDecoder().decode(first.value)).toBe('{"items":[');
});

test('it neither ends nor fails after the prefix', async () => {
  const reader = buildStalledBody('{"items":[').getReader();

  await reader.read();

  const next = await Promise.race([reader.read(), setImmediate('pending')]);

  expect(next).toBe('pending');
});
