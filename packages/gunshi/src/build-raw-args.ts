import { WringerError } from '@wringer/core';
import type { GunshiArgs } from './build-gunshi-args.ts';
import { extraWordsArg } from './build-positional-args.ts';

export interface ParsedCommand {
  readonly values: Readonly<Record<string, unknown>>;
  readonly explicit: Readonly<Record<string, boolean>>;

  // The words after `--`, which gunshi assigns to no positional.
  readonly rest: readonly string[];
}

// The parser reads a word such as `-15` as short options, so it reaches a positional only after
// `--`. A word no positional takes is a usage error, so `down prod` never stops the current target
// in place of `prod`.
export function buildRawArgs(args: GunshiArgs, parsed: ParsedCommand): Record<string, unknown> {
  const raw: Record<string, unknown> = Object.fromEntries(
    Object.keys(args).flatMap((name) =>
      name !== extraWordsArg && parsed.explicit[name] === true
        ? [[name, parsed.values[name]] as const]
        : [],
    ),
  );

  const extra = toWords(parsed.values[extraWordsArg]);

  const positionals = Object.entries(args).filter(
    ([name, schema]) => name !== extraWordsArg && schema.type === 'positional',
  );

  const unsetScalars = positionals.filter(
    ([name, schema]) => schema.multiple !== true && !(name in raw),
  );

  const restWords = [...parsed.rest];

  for (const [name, schema] of unsetScalars) {
    const word = restWords.shift();

    if (word !== undefined) {
      raw[name] = schema.parse?.(word) ?? word;
    }
  }

  const list = positionals.find(([, schema]) => schema.multiple === true);

  if (list !== undefined && restWords.length > 0) {
    const [name, schema] = list;
    const restValues = restWords.map((word): unknown => schema.parse?.(word) ?? word);

    raw[name] = [...toWords(raw[name]), ...restValues];
  }

  const leftover = list === undefined ? [...extra, ...restWords] : extra;

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
