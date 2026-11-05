import type { SQLToken } from './parse-sql-tokens.ts';

// The first word of a statement in lower case, past any opening brackets. The lexer has already
// dropped the comments and spaces.
export function findLeadingWord(tokens: readonly SQLToken[]): string | null {
  const first = tokens.find((token) => !(token.kind === 'symbol' && token.text === '('));

  return first?.kind === 'word' ? first.text.toLowerCase() : null;
}
