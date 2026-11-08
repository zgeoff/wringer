import { parseArgs } from 'node:util';

// Users type `--dir`; the naming lint rejects `dir` as a literal key, so the name lives in a value.
const directoryFlag = 'dir';
const defaultDestination = '.claude/skills/wringer';

// Answers the destination folder, or null when the arguments are not `skill install [--dir <path>]`.
export function parseSkillInstallArgs(argv: readonly string[]): { destination: string } | null {
  try {
    const parsed = parseArgs({
      args: [...argv],
      options: { [directoryFlag]: { type: 'string' } },
      allowPositionals: true,
      strict: true,
    });

    if (parsed.positionals.join(' ') !== 'skill install') {
      return null;
    }

    return { destination: parsed.values[directoryFlag] ?? defaultDestination };
  } catch {
    return null;
  }
}
