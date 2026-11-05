import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { killProcessGroup } from '../src/kill-process-group.ts';

export interface LockHolder {
  // False when the process exited before it took the lock.
  readonly held: boolean;
  readonly kill: () => Promise<void>;
}

// Another process, in a process group of its own, that takes the lock at `lockPath` and keeps it
// until `kill` stops the whole group.
export async function createLockHolder(lockPath: string): Promise<LockHolder> {
  await mkdir(dirname(lockPath), { recursive: true });

  const script = [
    "import { withFileLock } from '@zgeoff/std/with-file-lock';",
    `await withFileLock(${JSON.stringify(lockPath)}, async () => {`,
    "  console.log('held');",
    '  await Bun.sleep(60_000);',
    '});',
  ].join('\n');

  const holder = Bun.spawn([process.execPath, '-e', script], {
    cwd: join(import.meta.dir, '..'),
    stdout: 'pipe',
    detached: true,
  });

  const kill = async (): Promise<void> => {
    killProcessGroup(holder.pid);

    await holder.exited;
  };

  const first = await holder.stdout.getReader().read();

  return { held: !first.done, kill };
}
