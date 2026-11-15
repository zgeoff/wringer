import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';

const attemptLimit = 10;

// Removes a test's folder and everything in it. Bun's recursive `rm` resolves with no error, yet
// leaves the folder, when another process removes an entry during its walk, so the removal repeats
// until the folder is gone.
export async function removeTestFolder(path: string): Promise<void> {
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });

    if (!existsSync(path)) {
      return;
    }
  }

  throw new Error(`${path} is still there after ${attemptLimit} removals.`);
}
