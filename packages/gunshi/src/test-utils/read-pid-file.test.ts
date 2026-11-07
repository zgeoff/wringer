import { expect, onTestFinished, test } from 'bun:test';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '@wringer/core/test-utils/create-test-folder.ts';
import { readPIDFile } from './read-pid-file.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'read-pid-file');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { path: join(directory, 'app.pid') };
}

test('it reads the PID a script wrote with a line end', async () => {
  const ctx = await setupTest();

  await writeFile(ctx.path, '4242\n');

  const pid = await readPIDFile(ctx.path);

  expect(pid).toBe(4242);
});
