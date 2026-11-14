import type { CommandInfo } from '@wringer/core';
import type { ArgSchema } from 'gunshi';
import type { GunshiArgs } from './build-gunshi-args.ts';
import { parseArgProperties, scalarTypeSchema } from './parse-arg-properties.ts';
import type { ArgProperty, ScalarType } from './parse-arg-properties.ts';

// gunshi gives the words that no declared positional takes to this hidden one, so the adapter can
// refuse them.
export const extraWordsArg = 'wringer-extra-words';

// The positionals in the order the command declares them, for gunshi to assign. Each converts its
// words to the type the command's schema gives it; every one is optional to gunshi, so the schema
// requires or defaults it.
export function buildPositionalArgs(info: CommandInfo | null): GunshiArgs {
  const properties = info === null ? {} : parseArgProperties(info);

  const declared = (info?.positionals ?? []).map((name): [string, ArgSchema] => {
    const property = properties[name];
    const list = property?.type === 'array';
    const wordType = list ? property.items?.type : property?.type;
    const type = pickWordType(property, wordType);

    const described =
      property?.description === undefined ? {} : { description: property.description };

    return [
      name,
      {
        type: 'positional',
        required: false,
        ...(list ? { multiple: true } : {}),
        parse: (word: string) => toTyped(word, type),
        ...described,
      },
    ];
  });

  return Object.fromEntries([
    ...declared,
    [extraWordsArg, { type: 'positional', required: false, multiple: true, hidden: true }],
  ]);
}

type WordType = ScalarType | 'json';

// A field the schema gives no one scalar type, such as an object, takes JSON text, as its flag
// would.
function pickWordType(property: ArgProperty | undefined, wordType: unknown): WordType {
  const parsed = scalarTypeSchema.safeParse(wordType);

  if (parsed.success) {
    return parsed.data;
  }

  return property === undefined ? 'string' : 'json';
}

// A word that does not convert stays text, so the command's schema rejects it with its path.
function toTyped(word: string, type: WordType): unknown {
  if (type === 'json') {
    return parseJSONWord(word);
  }

  if (type === 'number' || type === 'integer') {
    const value = Number(word);

    return word.trim() === '' || Number.isNaN(value) ? word : value;
  }

  if (type === 'boolean' && (word === 'true' || word === 'false')) {
    return word === 'true';
  }

  return word;
}

function parseJSONWord(word: string): unknown {
  try {
    return JSON.parse(word);
  } catch {
    return word;
  }
}
