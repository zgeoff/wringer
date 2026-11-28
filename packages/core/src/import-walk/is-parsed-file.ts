const parsedExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

// Whether the walk reads the file for imports. A file of another kind, such as JSON, is only
// reached.
export function isParsedFile(file: string): boolean {
  const dot = file.lastIndexOf('.');

  return dot !== -1 && parsedExtensions.has(file.slice(dot));
}
