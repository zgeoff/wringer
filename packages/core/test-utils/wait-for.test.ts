import { expect, test } from 'bun:test';
import { waitFor } from './wait-for.ts';

test('it resolves with the first value the probe returns that is not null', async () => {
  const answers = [null, null, 'ready'];

  const value = await waitFor(() => answers.shift() ?? null);

  expect(value).toBe('ready');
});

test('it rejects when the probe returns null until the time is up', () => {
  expect(waitFor(() => null, { timeoutMs: 50 })).rejects.toThrow('waitFor gave up after 50 ms.');
});
