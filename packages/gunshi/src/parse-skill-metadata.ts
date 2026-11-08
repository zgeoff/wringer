import { z } from 'zod';
import { parseShellWords } from './parse-shell-words.ts';

export type SkillMetadata =
  | {
      readonly ok: true;
      readonly templateVersion: number;
      readonly cliWords: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

const frontmatterSchema = z.looseObject({
  metadata: z.looseObject({
    'wringer-template': z.number().int().positive(),
    'wringer-command': z.string().min(1),
  }),
});

const frontmatterPattern = /^---\r?\n(?<yaml>[\s\S]*?)\r?\n---\r?\n/u;

// The wringer fields of a verify skill's YAML frontmatter: the template version the skill was
// written from, and the words that call the repo's CLI, such as `bun verify`.
export function parseSkillMetadata(text: string): SkillMetadata {
  const yaml = frontmatterPattern.exec(text)?.groups?.['yaml'];

  if (yaml === undefined) {
    return { ok: false, reason: 'The skill has no YAML frontmatter.' };
  }

  const parsed = frontmatterSchema.safeParse(parseYAML(yaml));

  if (!parsed.success) {
    return {
      ok: false,
      reason:
        'The frontmatter lacks `metadata.wringer-template` as a whole number or `metadata.wringer-command` as text.',
    };
  }

  const cliWords = parseShellWords(parsed.data.metadata['wringer-command']);

  if (cliWords === null || cliWords.length === 0) {
    return { ok: false, reason: '`metadata.wringer-command` is not a command line.' };
  }

  return { ok: true, templateVersion: parsed.data.metadata['wringer-template'], cliWords };
}

// Bun's YAML parser throws on text that is not YAML; the schema then reports the field as missing.
function parseYAML(yaml: string): unknown {
  try {
    return Bun.YAML.parse(yaml);
  } catch {
    return null;
  }
}
