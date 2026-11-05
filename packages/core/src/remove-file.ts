import { rm } from 'node:fs/promises';

// A file that is already gone is no error.
export async function removeFile(path: string): Promise<void> {
  await rm(path, { force: true });
}
