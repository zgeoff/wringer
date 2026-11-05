import { rm } from 'node:fs/promises';

// Removes the folder and everything in it; a folder that is already gone is no error.
export async function removeDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}
