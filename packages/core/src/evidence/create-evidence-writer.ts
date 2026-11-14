import { basename, isAbsolute, join, relative } from 'node:path';
import type { Evidence } from '../envelope/envelope.ts';
import type { SecretSet } from '../secrets/create-secret-set.ts';
import type { EvidenceFiles, EvidenceWriter } from '../types.ts';
import { WringerError } from '../wringer-error.ts';
import { pickEvidenceScrub } from './pick-evidence-scrub.ts';

export interface EvidenceWriterOptions {
  readonly root: string;
  readonly directory: string;
  readonly now: () => Date;
  readonly files: EvidenceFiles;

  // No writer exists without a set: every text file passes through it.
  readonly secrets: SecretSet;
}

export interface CollectingEvidenceWriter {
  readonly writer: EvidenceWriter;
  readonly collected: readonly Evidence[];
}

// Each path in an envelope is relative to the worktree root, so it reads the same from any folder.
export function createEvidenceWriter(options: EvidenceWriterOptions): CollectingEvidenceWriter {
  const collected: Evidence[] = [];

  const record = (
    kind: string,
    path: string,
    content: Uint8Array,
    scrub: 'text' | 'opaque',
  ): Evidence => {
    const evidence = {
      kind,
      path: relative(options.root, path),
      sha256: new Bun.CryptoHasher('sha256').update(content).digest('hex'),
      scrub,
    };

    collected.push(evidence);

    return evidence;
  };

  return {
    collected,
    writer: {
      directory: options.directory,
      writeFile: async (kind, name, content) => {
        const plan = pickEvidenceScrub(name, content);

        if (plan.kind === 'refuse') {
          throw new WringerError('internal', { message: plan.message });
        }

        // The whole file goes through the set at once, so a secret never splits across chunks.
        const bytes = plan.scrub ? Buffer.from(options.secrets.scrubText(plan.text)) : plan.bytes;

        await options.files.createDirectory(options.directory);

        const path = await writeNumberedFile(
          options.files,
          options.directory,
          `${formatStamp(options.now())}-${basename(name)}`,
          bytes,
        );

        return record(kind, path, bytes, plan.recorded);
      },
      addFile: async (kind, path) => {
        await refuseUnsafeFile(options, path);

        const bytes = await options.files.readBytes(path);

        return record(kind, path, bytes, 'opaque');
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

// A tool wrote the file, and wringer never rewrites it, so it must be a plain file in the writer's
// own folder: a symlink could point at any file on the machine.
async function refuseUnsafeFile(options: EvidenceWriterOptions, path: string): Promise<void> {
  const facts = await options.files.inspectFile(path);
  const folder = await options.files.inspectFile(options.directory);

  if (facts === null || !facts.isRegularFile) {
    throw new WringerError('internal', {
      message: `The evidence file ${basename(path)} is not a regular file.`,
    });
  }

  const inside = folder === null ? '' : relative(folder.realPath, facts.realPath);

  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    throw new WringerError('internal', {
      message: `The evidence file ${basename(path)} is outside the evidence folder.`,
    });
  }
}
