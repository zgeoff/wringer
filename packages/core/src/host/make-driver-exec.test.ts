import { expect, test } from 'bun:test';
import { local } from './local.ts';
import { makeDriverExec } from './make-driver-exec.ts';

test("it runs a driver's read on a read-only target", async () => {
  const exec = makeDriverExec({
    host: local(),
    access: 'read-only',
    hint: 'Read the logs instead.',
    signal: AbortSignal.timeout(5000),
  });

  const result = await exec(['printf', 'ok'], 'read');

  expect(result.stdout).toBe('ok');
});

test("it refuses a driver's write on a read-only target", () => {
  const exec = makeDriverExec({
    host: local(),
    access: 'read-only',
    hint: 'Read the logs instead.',
    signal: AbortSignal.timeout(5000),
  });

  expect(exec(['touch', 'x'], 'write')).rejects.toMatchObject({ code: 'read-only' });
});
