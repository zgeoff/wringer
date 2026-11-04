import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isErrorCode } from './is-error-code.ts';

// A cursor is a byte offset into a stream's NDJSON file, so reading the cursors costs one stat per
// stream, however long the streams grow.
export async function readCursors(streamsDirectory: string): Promise<Record<string, number>> {
  const names = await readStreamNames(streamsDirectory);

  const files = names.filter((name) => name.endsWith('.ndjson'));

  const sizes = await Promise.all(
    files.map(async (name) => {
      const info = await stat(join(streamsDirectory, name));

      return [basename(name, '.ndjson'), info.size] as const;
    }),
  );

  return Object.fromEntries(sizes);
}

async function readStreamNames(streamsDirectory: string): Promise<readonly string[]> {
  try {
    return await readdir(streamsDirectory);
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return [];
    }

    throw error;
  }
}
