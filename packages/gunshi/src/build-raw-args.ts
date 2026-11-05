import { WringerError } from '@wringer/core';
import type { GunshiArgs } from './build-gunshi-args.ts';
import { extraWordsArg } from './build-positional-args.ts';

export interface ParsedCommand {
  readonly values: Readonly<Record<string, unknown>>;
  readonly explicit: Readonly<Record<string, boolean>>;

  // The words after `--`, which gunshi assigns to no positional.
  readonly rest: readonly string[];
}

// Only the arguments the caller gave reach the command, so the schema's own defaults fill the rest.
// The words after `--` join the command's list positional. A word no positional takes is a usage
// error, so `down prod` never stops the current target in place of `prod`.
export function buildRawArgs(args: GunshiArgs, parsed: ParsedCommand): Record<string, unknown> {
  const raw: Record<string, unknown> = Object.fromEntries(
    Object.keys(args).flatMap((name) =>
      name !== extraWordsArg && parsed.explicit[name] === true
        ? [[name, parsed.values[name]] as const]
        : [],
    ),
  );

  const extra = toWords(parsed.values[extraWordsArg]);

  const list = Object.entries(args).find(
    ([name, schema]) =>
      name !== extraWordsArg && schema.type === 'positional' && schema.multiple === true,
  );

  if (list !== undefined && parsed.rest.length > 0) {
    const [name, schema] = list;
    const restValues = parsed.rest.map((word) => schema.parse?.(word) ?? word);

    raw[name] = [...toWords(raw[name]), ...restValues];
  }

  const leftover = list === undefined ? [...extra, ...parsed.rest] : extra;

  if (leftover.length > 0) {
    throw new WringerError('usage', {
      message: `The command takes no argument ${leftover.map((word) => `\`${String(word)}\``).join(', ')}.`,
      hint: 'Pass a value with its flag, such as `--target prod`.',
    });
  }

  return raw;
}

// gunshi leaves a multiple positional that took no word unset.
function toWords(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}
