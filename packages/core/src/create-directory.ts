import { mkdir } from 'node:fs/promises';

// Creates the folder and every missing parent; a folder that exists is no error.
export async function createDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}
