import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import type { Evidence } from './envelope.ts';
import type { EvidenceWriter } from './types.ts';

export interface EvidenceWriterOptions {
  readonly root: string;
  readonly directory: string;
  readonly now: () => Date;
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

        await mkdir(options.directory, { recursive: true });

        const path = await writeNewFile(
          options.directory,
          `${formatStamp(options.now())}-${basename(name)}`,
          bytes,
        );

        return record(kind, path, bytes);
      },
      addFile: async (kind, path) => {
        const bytes = await readFile(path);

        return record(kind, path, bytes);
      },
    },
  };
}

// Two writes in one millisecond, from this process or another, can share a name, so the write
// creates the file exclusively and numbers the name until one is free.
async function writeNewFile(directory: string, name: string, bytes: Uint8Array): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    const numbered = attempt === 0 ? name : `${attempt}-${name}`;
    const path = join(directory, numbered);

    const created = await writeExclusive(path, bytes);

    if (created) {
      return path;
    }
  }
}

async function writeExclusive(path: string, bytes: Uint8Array): Promise<boolean> {
  try {
    await writeFile(path, bytes, { flag: 'wx' });

    return true;
  } catch (error) {
    if (isAlreadyThere(error)) {
      return false;
    }

    throw error;
  }
}

function isAlreadyThere(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}

function formatStamp(date: Date): string {
  return date.toISOString().replaceAll(/[:.]/gu, '-');
}
