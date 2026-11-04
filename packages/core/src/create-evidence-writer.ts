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
        const path = join(options.directory, `${formatStamp(options.now())}-${basename(name)}`);
        const bytes = typeof content === 'string' ? Buffer.from(content) : content;

        await mkdir(options.directory, { recursive: true });
        await writeFile(path, bytes);

        return record(kind, path, bytes);
      },
      addFile: async (kind, path) => {
        const bytes = await readFile(path);

        return record(kind, path, bytes);
      },
    },
  };
}

function formatStamp(date: Date): string {
  return date.toISOString().replaceAll(/[:.]/gu, '-');
}
