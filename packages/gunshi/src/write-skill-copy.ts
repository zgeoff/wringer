import { cp, rm } from 'node:fs/promises';

// Removes the destination first: `cp` into a folder that exists would nest the copy inside it.
export async function writeSkillCopy(source: string, destination: string): Promise<void> {
  await rm(destination, { recursive: true, force: true });

  await cp(source, destination, {
    recursive: true,
    filter: (path) => !path.endsWith('.test.ts'),
  });
}
