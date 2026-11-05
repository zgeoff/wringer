import { readFile } from 'node:fs/promises';

// The PID a test's script wrote to `path`.
export async function readPIDFile(path: string): Promise<number> {
  const text = await readFile(path, 'utf8');

  return Number(text.trim());
}
