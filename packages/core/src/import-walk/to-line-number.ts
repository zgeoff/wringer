// The 1-based line of an offset in a source text. A line ends at `\n`, `\r\n`, a lone `\r`, or
// the Unicode line and paragraph separators, as the parser counts them.
export function toLineNumber(source: string, offset: number): number {
  return source.slice(0, offset).split(/\r\n|[\n\r\u2028\u2029]/u).length;
}
