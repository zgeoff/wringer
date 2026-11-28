// A glob that matches exactly one path, so a name such as `[id].ts` matches only itself.
export function escapeGlob(path: string): string {
  return path.replaceAll(/[\\*?[\]{}()!+@|]/gu, String.raw`\$&`);
}
