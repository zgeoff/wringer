import { expect, onTestFinished, test } from 'bun:test';
import { rm, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { readPIDNamespace } from '../packages/core/src/read-pid-namespace.ts';
import { createTestFolder } from './create-test-folder.ts';

test('it creates a folder in the parent, named after the PID namespace and the test process', async () => {
  const folder = await createTestFolder(import.meta.dir, 'garden');

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  const info = await stat(folder);

  const namePattern = new RegExp(
    `^\\.test-n${readPIDNamespace()}-p${process.pid}-garden-.{6}$`,
    'v',
  );

  expect({
    parent: dirname(folder),
    name: basename(folder),
    isFolder: info.isDirectory(),
  }).toStrictEqual({
    parent: import.meta.dir,
    name: expect.stringMatching(namePattern),
    isFolder: true,
  });
});
