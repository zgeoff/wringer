// Every glob matches through Bun's matcher, never as a git pathspec, whose `*` and `**` differ, so
// the changed paths, the fingerprint and the report agree on which paths a glob covers.
export function isGlobMatch(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => new Bun.Glob(glob).match(path));
}
