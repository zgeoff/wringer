import { open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createDirectory } from '@wringer/core';

export interface RawLog {
  readonly write: (bytes: Uint8Array) => void;

  // Resolves once every write has landed, so a stop leaves the whole log on disk.
  readonly close: () => Promise<void>;
}

// Appends the bytes a program wrote, in order, to one file. A failed write is reported once, and
// the log keeps trying later writes, so a full disk never stops the session.
export async function createRawLog(
  path: string,
  reportError: (message: string) => void,
): Promise<RawLog> {
  await createDirectory(dirname(path));

  const handle = await open(path, 'a');

  let pending: Promise<void> = Promise.resolve();
  let failed = false;

  const append = async (previous: Promise<void>, bytes: Uint8Array): Promise<void> => {
    await previous;

    try {
      await handle.write(bytes);
    } catch (error) {
      if (!failed) {
        failed = true;

        reportError(`The raw terminal log ${path} stopped: ${String(error)}`);
      }
    }
  };

  return {
    write: (bytes) => {
      pending = append(pending, Uint8Array.from(bytes));
    },
    close: async () => {
      await pending;

      await handle.close();
    },
  };
}
