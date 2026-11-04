import { WringerError } from '@wringer/core';
import type { GunshiArgs } from './build-gunshi-args.ts';
import type { Positional } from './build-positionals.ts';
import type { ScalarType } from './parse-arg-properties.ts';

export interface ParsedCommand {
  readonly values: Readonly<Record<string, unknown>>;
  readonly explicit: Readonly<Record<string, boolean>>;
  readonly words: readonly string[];
}

// Only the flags the caller gave reach the command, so the schema's own defaults fill the rest. A
// word no positional takes is a usage error, so `down prod` never stops the current target in
// place of `prod`.
export function buildRawArgs(
  flags: GunshiArgs,
  positionals: readonly Positional[],
  parsed: ParsedCommand,
): Record<string, unknown> {
  const raw: Record<string, unknown> = Object.fromEntries(
    Object.keys(flags).flatMap((name) =>
      parsed.explicit[name] === true ? [[name, parsed.values[name]] as const] : [],
    ),
  );

  let next = 0;

  for (const positional of positionals) {
    if (next >= parsed.words.length) {
      break;
    }

    if (positional.list) {
      raw[positional.name] = parsed.words.slice(next).map((word) => toTyped(word, positional.type));
      next = parsed.words.length;
    } else {
      raw[positional.name] = toTyped(parsed.words[next] ?? '', positional.type);
      next += 1;
    }
  }

  const leftover = parsed.words.slice(next);

  if (leftover.length > 0) {
    throw new WringerError('usage', {
      message: `The command takes no argument ${leftover.map((word) => `\`${word}\``).join(', ')}.`,
      hint: 'Pass a value with its flag, such as `--target prod`.',
    });
  }

  return raw;
}

// A word that does not convert stays text, so the command's schema rejects it with its path.
function toTyped(word: string, type: ScalarType): unknown {
  if (type === 'number' || type === 'integer') {
    const value = Number(word);

    return word.trim() === '' || Number.isNaN(value) ? word : value;
  }

  if (type === 'boolean' && (word === 'true' || word === 'false')) {
    return word === 'true';
  }

  return word;
}
