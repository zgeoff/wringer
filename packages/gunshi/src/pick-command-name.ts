import type { Wringer } from '@wringer/core';

// The envelope names the longest registered command the leading words spell, so a flag's value or
// a positional never reaches it.
export function pickCommandName(wringer: Wringer, argv: readonly string[]): string {
  const firstFlag = argv.findIndex((word) => word.startsWith('-'));
  const words = firstFlag === -1 ? argv : argv.slice(0, firstFlag);
  const lengths = Array.from({ length: words.length }, (_, index) => words.length - index);
  const length = lengths.find((count) => wringer.commands.has(words.slice(0, count).join(' ')));

  if (length !== undefined) {
    return words.slice(0, length).join('.');
  }

  return argv.length === 0 ? 'help' : 'unknown';
}
