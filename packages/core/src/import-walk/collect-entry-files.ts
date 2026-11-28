import { isGlobMatch } from '../change-facts/is-glob-match.ts';

// The files an entry glob names. A glob that names a folder covers every file under it.
export function collectEntryFiles(
  files: readonly string[],
  entries: readonly string[],
): readonly string[] {
  const globs = entries.flatMap((entry) => [entry, `${entry.replace(/\/+$/u, '')}/**`]);

  return files.filter((file) => isGlobMatch(file, globs));
}
