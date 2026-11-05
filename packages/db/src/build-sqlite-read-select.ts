import { WringerError } from '@wringer/core';
import { match } from 'ts-pattern';
import { findLeadingWord } from './find-leading-word.ts';
import { parseSQLTokens } from './parse-sql-tokens.ts';
import type { SQLToken } from './parse-sql-tokens.ts';

// The select a view can hold for one SQLite read, so the read's columns survive an empty result. A
// pragma read becomes a select from the pragma's table-valued function, which SQLite gives each
// pragma that returns rows and changes nothing; its argument is the hidden `arg` column.
export function buildSqliteReadSelect(statement: string): string {
  const tokens = parseSQLTokens('sqlite', statement).tokens;

  return match(findLeadingWord(tokens))
    .with('select', 'with', 'values', () => statement)
    .with('pragma', () => buildPragmaSelect(tokens.slice(1)))
    .with('explain', () => {
      // The sqlite3 shell prints an explain as a text table, even with `-json`.
      throw new WringerError('usage', {
        message: 'A read through sqlite3 cannot run `explain`.',
        hint: "Connect with `via: 'sql'` to run it.",
      });
    })
    .otherwise(() => {
      throw new WringerError('usage', {
        message: 'A read through sqlite3 starts with `select`, `with`, `values` or `pragma`.',
      });
    });
}

function buildPragmaSelect(tokens: readonly SQLToken[]): string {
  const [name, next, ...rest] = tokens;

  if (next?.kind === 'symbol' && next.text === '.') {
    throw new WringerError('usage', {
      message: 'A pragma read through sqlite3 names no schema.',
      hint: 'sqlite3 opens only the main database for a read, so drop the schema.',
    });
  }

  if (name === undefined || (name.kind !== 'word' && name.kind !== 'name')) {
    throw buildPragmaFormError();
  }

  const value = next === undefined ? null : parsePragmaValue(next, rest);
  const source = `"pragma_${name.text.replaceAll('"', '""')}"`;

  return value === null
    ? `select * from ${source}`
    : `select * from ${source} where arg = '${value.replaceAll("'", "''")}'`;
}

function buildPragmaFormError(): WringerError {
  return new WringerError('usage', {
    message:
      'A pragma read through sqlite3 is `pragma name`, `pragma name(value)` or `pragma name = value`.',
  });
}

const numberPattern = /^[+-]?\d+$/u;

// The value of `pragma name = value` or `pragma name(value)`: a name, a string or an integer.
function parsePragmaValue(opener: SQLToken, rest: readonly SQLToken[]): string {
  const isCall = opener.kind === 'symbol' && opener.text === '(';
  const isSet = opener.kind === 'symbol' && opener.text === '=';
  const closer = rest.at(-1);

  if (!isSet && !(isCall && closer?.kind === 'symbol' && closer.text === ')')) {
    throw buildPragmaFormError();
  }

  const parts = isCall ? rest.slice(0, -1) : rest;
  const [only] = parts;

  if (parts.length === 1 && only !== undefined && only.kind !== 'symbol') {
    return only.text;
  }

  const digits = parts.map((part) => (part.kind === 'symbol' ? part.text : '')).join('');

  if (parts.length > 0 && numberPattern.test(digits)) {
    return digits;
  }

  throw buildPragmaFormError();
}
