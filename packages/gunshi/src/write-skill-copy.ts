import { cp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { findSkillCopyRefusal } from './find-skill-copy-refusal.ts';
import type { DestinationState } from './find-skill-copy-refusal.ts';

export interface SkillCopyPaths {
  readonly source: string;
  readonly destination: string;
  readonly cwd: string;
}

export type SkillCopyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

// Removes the destination first: `cp` into a folder that exists would nest the copy inside it.
export async function writeSkillCopy(paths: SkillCopyPaths): Promise<SkillCopyResult> {
  const state = await readDestinationState(paths.destination);

  const reason = findSkillCopyRefusal({ ...paths, state });

  if (reason !== null) {
    return { ok: false, reason };
  }

  await rm(paths.destination, { recursive: true, force: true });

  await cp(paths.source, paths.destination, {
    recursive: true,
    filter: (path) => !path.endsWith('.test.ts'),
  });

  return { ok: true };
}

async function readDestinationState(destination: string): Promise<DestinationState> {
  const exists = await stat(destination).then(
    () => true,
    () => false,
  );

  if (!exists) {
    return 'absent';
  }

  const skill = Bun.file(join(destination, 'SKILL.md'));

  const hasSkill = await skill.exists();

  if (!hasSkill) {
    return 'other';
  }

  const text = await skill.text();

  return isWringerSkill(text) ? 'wringer-skill' : 'other';
}

const frontmatterPattern = /^---\r?\n(?<yaml>[\s\S]*?)\r?\n---\r?\n/u;
const frontmatterSchema = z.looseObject({ name: z.literal('wringer') });

function isWringerSkill(text: string): boolean {
  const yaml = frontmatterPattern.exec(text)?.groups?.['yaml'];

  if (yaml === undefined) {
    return false;
  }

  try {
    return frontmatterSchema.safeParse(Bun.YAML.parse(yaml)).success;
  } catch {
    return false;
  }
}
