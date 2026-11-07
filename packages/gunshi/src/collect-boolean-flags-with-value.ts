import type { ArgToken } from 'gunshi';
import { kebabnize } from 'gunshi/utils';
import type { GunshiArgs } from './build-gunshi-args.ts';

// gunshi sets a boolean flag to true whatever value follows its `=`, so `--dry-run=false` would
// run the command as a dry run. A boolean flag takes no value: `--no-<flag>` turns it off.
export function collectBooleanFlagsWithValue(
  tokens: readonly ArgToken[],
  args: GunshiArgs,
): readonly string[] {
  const booleanFlags = new Set(
    Object.entries(args).flatMap(([name, schema]) =>
      schema.type === 'boolean' ? [`--${kebabnize(name)}`, `--no-${kebabnize(name)}`] : [],
    ),
  );

  return tokens.flatMap((token) =>
    token.kind === 'option' && token.value !== undefined && booleanFlags.has(token.rawName ?? '')
      ? [token.rawName ?? '']
      : [],
  );
}
