import type { ArgToken } from 'gunshi';
import { kebabnize } from 'gunshi/utils';
import type { GunshiArgs } from './build-gunshi-args.ts';

// gunshi hands a custom parse function an empty string for a flag typed with no value after it, so
// `--label` at the end reads as `--label ''`. A value flag takes the word after it, an empty word
// included; one with an option or nothing after it has no value.
export function collectFlagsWithoutValue(
  tokens: readonly ArgToken[],
  args: GunshiArgs,
): readonly string[] {
  const valueFlags = new Set(
    Object.entries(args).flatMap(([name, schema]) =>
      schema.type === 'boolean' ? [] : [`--${kebabnize(name)}`],
    ),
  );

  return tokens.flatMap((token, index) =>
    token.kind === 'option' &&
    token.value === undefined &&
    valueFlags.has(token.rawName ?? '') &&
    tokens[index + 1]?.kind !== 'positional'
      ? [token.rawName ?? '']
      : [],
  );
}
