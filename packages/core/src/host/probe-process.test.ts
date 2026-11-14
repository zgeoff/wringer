import { expect, test } from 'bun:test';
import { probeProcess } from './probe-process.ts';

test('it answers true for a process that runs', () => {
  expect(probeProcess(process.pid)).toBeTrue();
});

test('it answers false for a process that exited', async () => {
  const child = Bun.spawn(['true']);

  await child.exited;

  expect(probeProcess(child.pid)).toBeFalse();
});

test.each([[0], [-4], [Number.NaN]])('it answers false for the PID %p', (pid) => {
  expect(probeProcess(pid)).toBeFalse();
});
