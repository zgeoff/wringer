import { WringerError } from '@wringer/core';
import type { ArgToken } from 'gunshi';
import type { GunshiArgs } from './build-gunshi-args.ts';
import { extraWordsArg } from './build-positional-args.ts';

export interface ParsedCommand {
  readonly tokens: readonly ArgToken[];
  readonly values: Readonly<Record<string, unknown>>;
  readonly explicit: Readonly<Record<string, boolean>>;

  // The words after `--` that gunshi assigns to no positional.
  readonly rest: readonly string[];
}

export type RawArgsResult =
  | { readonly ok: true; readonly raw: Record<string, unknown> }
  | { readonly ok: false; readonly error: WringerError };

// The parser reads a word such as `-15` as short options, so it reaches a positional only after
// `--`. A word no positional takes is a usage failure, so `down prod` never stops the current
// target in place of `prod`.
export function buildRawArgs(args: GunshiArgs, parsed: ParsedCommand): RawArgsResult {
  const afterTerminator = collectWordsAfterTerminator(parsed.tokens);

  const values = collectValuesBeforeTerminator(
    args,
    parsed.values,
    parsed.explicit,
    afterTerminator.length - parsed.rest.length,
  );

  const raw: Record<string, unknown> = Object.fromEntries(
    Object.keys(args).flatMap((name) =>
      name !== extraWordsArg && Object.hasOwn(values, name) ? [[name, values[name]] as const] : [],
    ),
  );

  const extra = toWords(values[extraWordsArg]);

  const positionals = Object.entries(args).filter(
    ([name, schema]) => name !== extraWordsArg && schema.type === 'positional',
  );

  const unsetScalars = positionals.filter(
    ([name, schema]) => schema.multiple !== true && !Object.hasOwn(raw, name),
  );

  const restWords = [...afterTerminator];

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
    return {
      ok: false,
      error: new WringerError('usage', {
        message: `The command takes no argument ${leftover.map((word) => `\`${String(word)}\``).join(', ')}.`,
        hint: 'Pass a value with its flag, such as `--target prod`.',
      }),
    };
  }

  return { ok: true, raw };
}

function collectWordsAfterTerminator(tokens: readonly ArgToken[]): readonly string[] {
  const terminator = tokens.findIndex((token) => token.kind === 'option-terminator');

  return terminator === -1 ? [] : tokens.slice(terminator + 1).map((token) => token.value ?? '');
}

// gunshi takes an empty word after `--` as a positional, behind every other positional word, and
// leaves it out of `rest`. Dropping the last `movedCount` positional words gives back what came
// before `--`, so each word after it keeps its place. Only the caller's own values are kept.
function collectValuesBeforeTerminator(
  args: GunshiArgs,
  values: Readonly<Record<string, unknown>>,
  explicit: Readonly<Record<string, boolean>>,
  movedCount: number,
): Readonly<Record<string, unknown>> {
  const given = Object.keys(args).filter((name) => explicit[name] === true);

  const filled = given.flatMap((name) =>
    args[name]?.type === 'positional'
      ? (args[name].multiple === true ? toWords(values[name]) : [values[name]]).map(
          (value) => [name, value] as const,
        )
      : [],
  );

  const kept = filled.slice(0, filled.length - movedCount);

  return Object.fromEntries([
    ...given.flatMap((name) => (args[name]?.type === 'positional' ? [] : [[name, values[name]]])),
    ...given.flatMap((name) => {
      const words = kept.filter(([keptName]) => keptName === name).map(([, value]) => value);

      if (words.length === 0) {
        return [];
      }

      return [[name, args[name]?.multiple === true ? words : words[0]]];
    }),
  ]);
}

// gunshi leaves a multiple positional that took no word unset.
function toWords(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}
