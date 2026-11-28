// The 1-based line of an offset in a source text.
export function toLineNumber(source: string, offset: number): number {
  let line = 1;

  for (let index = 0; index < offset && index < source.length; index += 1) {
    if (source[index] === '\n') {
      line += 1;
    }
  }

  return line;
}
