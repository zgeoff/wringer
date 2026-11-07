import { basename, join, relative } from 'node:path';
import type { Evidence } from './envelope.ts';
import type { EvidenceFiles, EvidenceWriter } from './types.ts';

export interface EvidenceWriterOptions {
  readonly root: string;
  readonly directory: string;
  readonly now: () => Date;
  readonly files: EvidenceFiles;
}

export interface CollectingEvidenceWriter {
  readonly writer: EvidenceWriter;
  readonly collected: readonly Evidence[];
}

// Each path in an envelope is relative to the worktree root, so it reads the same from any folder.
export function createEvidenceWriter(options: EvidenceWriterOptions): CollectingEvidenceWriter {
  const collected: Evidence[] = [];

  const record = (kind: string, path: string, content: Uint8Array): Evidence => {
    const evidence = {
      kind,
      path: relative(options.root, path),
      sha256: new Bun.CryptoHasher('sha256').update(content).digest('hex'),
    };

    collected.push(evidence);

    return evidence;
  };

  return {
    collected,
    writer: {
      directory: options.directory,
      writeFile: async (kind, name, content) => {
        const bytes = typeof content === 'string' ? Buffer.from(content) : content;

        await options.files.createDirectory(options.directory);

        const path = await writeNumberedFile(
          options.files,
          options.directory,
          `${formatStamp(options.now())}-${basename(name)}`,
          bytes,
        );

        return record(kind, path, bytes);
      },
      addFile: async (kind, path) => {
        const bytes = await options.files.readBytes(path);

        return record(kind, path, bytes);
      },
    },
  };
}

// Two writes in one millisecond, from this process or another, can share a name, so the write
// creates the file exclusively and numbers the name until one is free.
async function writeNumberedFile(
  files: EvidenceFiles,
  directory: string,
  name: string,
  bytes: Uint8Array,
): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    const numbered = attempt === 0 ? name : `${attempt}-${name}`;
    const path = join(directory, numbered);

    const created = await files.writeNewFile(path, bytes);

    if (created) {
      return path;
    }
  }
}

function formatStamp(date: Date): string {
  return date.toISOString().replaceAll(/[:.]/gu, '-');
}
