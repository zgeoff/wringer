import { readdir, readlink } from 'node:fs/promises';
import { join } from 'node:path';

const descriptorsFolder = '/proc/self/fd';

// How many of this process's open file descriptors point at `path`, on Linux. A lock waiter opens
// the lock file before it polls for the lock, so a second descriptor shows a caller waiting on it.
export async function readOpenDescriptorCount(path: string): Promise<number> {
  const descriptors = await readdir(descriptorsFolder);

  const targets = await Promise.all(
    descriptors.map((descriptor) =>
      readlink(join(descriptorsFolder, descriptor)).catch(() => null),
    ),
  );

  return targets.filter((target) => target === path).length;
}
