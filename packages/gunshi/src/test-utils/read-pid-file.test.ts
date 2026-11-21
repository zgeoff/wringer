import { expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import { readPIDFile } from './read-pid-file.ts';

function setupTest() {
  const directory = createTempDir('read-pid-file').path;

  return { path: join(directory, 'app.pid') };
}

test('it reads the PID a script wrote with a line end', async () => {
  const ctx = setupTest();

  await writeFile(ctx.path, '4242\n');

  const pid = await readPIDFile(ctx.path);

  expect(pid).toBe(4242);
});
