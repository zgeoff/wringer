import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from './create-test-folder.ts';

// A `gh` executable that runs the given shell script. Returns a PATH that finds it first.
export async function createFakeGH(parent: string, script: string): Promise<string> {
  const folder = await createTestFolder(parent, 'gh');

  await writeFile(join(folder, 'gh'), `#!/bin/sh\n${script}\n`);
  await chmod(join(folder, 'gh'), 0o755);

  return `${folder}:${process.env['PATH'] ?? ''}`;
}
