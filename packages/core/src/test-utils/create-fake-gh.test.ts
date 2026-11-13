import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { runProcess } from '../run-process.ts';
import { createFakeGH } from './create-fake-gh.ts';
import { createTestFolder } from './create-test-folder.ts';

test('it puts a gh that runs the script on the PATH', async () => {
  const parent = await createTestFolder(import.meta.dir, 'parent');

  onTestFinished(() => rm(parent, { recursive: true, force: true }));

  const path = await createFakeGH(parent, 'echo hello');
  const result = await runProcess({ argv: ['gh'], env: { PATH: path } });

  expect(result).toStrictEqual({ exitCode: 0, stdout: 'hello\n', stderr: '' });
});
