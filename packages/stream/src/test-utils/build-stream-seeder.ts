import { open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDirectory, local } from '@wringer/core';
import { appendWholeText } from '../append-whole-text.ts';
import { readFileFrom } from '../read-file-from.ts';
import { startStreamRecorder } from '../start-stream-recorder.ts';
import { waitOrAbort } from '../wait-or-abort.ts';

export interface StreamSeederOptions {
  // The recorder writes `<name>.ndjson` here; each source log goes in its parent folder.
  readonly streams: string;
  readonly now: () => Date;
}

export interface StreamSeeder {
  readonly stream: (name: string, lines: readonly string[]) => Promise<void>;
}

// Seeds a stream file by recording `lines` from a file source until the recorder stops.
export function buildStreamSeeder(options: StreamSeederOptions): StreamSeeder {
  return {
    stream: async (name, lines) => {
      const log = join(options.streams, '..', `${name}.log`);

      await writeFile(log, lines.map((line) => `${line}\n`).join(''));

      const recorder = await startStreamRecorder({
        sources: { [name]: { file: log } },
        directory: options.streams,
        host: local(),
        access: 'read-only',
        now: options.now,
        createDirectory,
        appendText: appendWholeText,
        readFileFrom: (path, from, limitBytes) =>
          readFileFrom(path, from, limitBytes, (file) => open(file, 'r')),
        wait: waitOrAbort,
        pendingLimit: 10_000,
      });

      await recorder.stop();
    },
  };
}
