import { expect, test } from 'bun:test';
import { readPIDNamespace } from './read-pid-namespace.ts';

test('it reads the PID namespace as digits, or as host where the system has no /proc', () => {
  expect(readPIDNamespace()).toMatch(/^(?:\d+|host)$/u);
});

test('it reads the same namespace each time in one process', () => {
  const first = readPIDNamespace();
  const second = readPIDNamespace();

  expect(second).toBe(first);
});
