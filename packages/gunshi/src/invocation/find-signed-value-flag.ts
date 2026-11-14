import type { ArgToken } from 'gunshi';

export interface SignedValueFlag {
  readonly flag: string;
  readonly value: string;
}

const signedStartPattern = /^-[\d.]$/u;

// gunshi reads a word such as `-15` as the short options `-1` and `-5`, so `--degrees -15` leaves
// the flag with no value. Each token keeps the index of the word it came from, which gives back the
// whole word for the hint.
export function findSignedValueFlag(
  tokens: readonly ArgToken[],
  argv: readonly string[],
): SignedValueFlag | undefined {
  for (const [index, token] of tokens.entries()) {
    const next = tokens[index + 1];

    const isSignedValue =
      token.kind === 'option' &&
      token.rawName?.startsWith('--') === true &&
      token.value === undefined &&
      next?.kind === 'option' &&
      signedStartPattern.test(next.rawName ?? '');

    const value = next === undefined ? undefined : argv[next.index];

    if (isSignedValue && value !== undefined) {
      return { flag: token.rawName ?? '', value };
    }
  }

  return undefined;
}
