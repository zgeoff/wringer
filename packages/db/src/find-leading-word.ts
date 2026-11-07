import type { SQLToken } from './parse-sql-tokens.ts';

export function findLeadingWord(tokens: readonly SQLToken[]): string | null {
  const first = tokens.find((token) => !(token.kind === 'symbol' && token.text === '('));

  return first?.kind === 'word' ? first.text.toLowerCase() : null;
}
