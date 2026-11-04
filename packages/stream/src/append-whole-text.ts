import { appendFile, stat, truncate } from 'node:fs/promises';

// An append that fails part-way, such as on a full disk, leaves the bytes it wrote; they are cut,
// so a retry of the same text never doubles a record or splices a torn one into the file.
export async function appendWholeText(path: string, text: string): Promise<void> {
  const size = await readFileSize(path);

  try {
    await appendFile(path, text);
  } catch (error) {
    await truncate(path, size);

    throw error;
  }
}

async function readFileSize(path: string): Promise<number> {
  try {
    const info = await stat(path);

    return info.size;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return 0;
    }

    throw error;
  }
}
