import { expect, mock, test } from 'bun:test';
import { createCleanupRegistry } from './create-cleanup-registry.ts';

test('it runs each registered cleanup in the order registered', () => {
  const registry = createCleanupRegistry();
  const calls: string[] = [];

  registry.register(() => {
    calls.push('close the till');
  });

  registry.register(() => {
    calls.push('lock the door');
  });

  registry.runAll();

  expect(calls).toStrictEqual(['close the till', 'lock the door']);
});

test('it runs a cleanup only once when every cleanup runs twice', () => {
  const registry = createCleanupRegistry();
  const cleanup = mock<() => void>();

  registry.register(cleanup);
  registry.runAll();
  registry.runAll();

  expect(cleanup).toHaveBeenCalledTimes(1);
});
