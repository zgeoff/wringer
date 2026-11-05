type Dialect = 'sqlite' | 'postgres';

// Comments and spaces are dropped. A `word` is an unquoted keyword or name as written, a `name` is
// a quoted name's text, and a `string` is a literal's text, dollar-quoted bodies included.
export type SQLToken =
  | { readonly kind: 'word'; readonly text: string }
  | { readonly kind: 'name'; readonly text: string; readonly escaped: boolean }
  | { readonly kind: 'string'; readonly text: string }
  | { readonly kind: 'symbol'; readonly text: string };

export interface SQLLex {
  readonly tokens: readonly SQLToken[];

  // False when a string, a quoted name or a comment runs to the end of the SQL.
  readonly closed: boolean;
}

// The lexer follows each dialect's own rules for where a comment, a string and a quoted name end,
// so a search of the tokens sees exactly the words the database runs. Postgres nests block
// comments and takes `$tag$` bodies and `E'…'` escapes; SQLite does none of these.
export function parseSQLTokens(dialect: Dialect, sql: string): SQLLex {
  const tokens: SQLToken[] = [];
  let index = 0;

  while (index < sql.length) {
    const scan = scanToken(dialect, sql, index);

    if (scan.token !== null) {
      tokens.push(scan.token);
    }

    if (!scan.closed) {
      return { tokens, closed: false };
    }

    index = scan.end;
  }

  return { tokens, closed: true };
}

interface Scan {
  readonly token: SQLToken | null;
  readonly end: number;
  readonly closed: boolean;
}

const spacePattern = /\s/u;
const wordStartPattern = /[\p{L}_]/u;
const wordPattern = /[\p{L}\p{N}_$]/u;

function scanToken(dialect: Dialect, sql: string, start: number): Scan {
  const char = sql.charAt(start);
  const next = sql.charAt(start + 1);

  if (spacePattern.test(char)) {
    return { token: null, end: start + 1, closed: true };
  }

  if (char === '-' && next === '-') {
    const newline = sql.indexOf('\n', start);

    return { token: null, end: newline === -1 ? sql.length : newline + 1, closed: true };
  }

  if (char === '/' && next === '*') {
    return scanBlockComment(sql, start, dialect === 'postgres');
  }

  if (dialect === 'postgres') {
    const postgres = scanPostgresQuote(sql, start);

    if (postgres !== null) {
      return postgres;
    }
  }

  if (char === "'") {
    return scanQuoted(sql, start + 1, "'", (text) => ({ kind: 'string', text }));
  }

  if (char === '"') {
    return scanQuoted(sql, start + 1, '"', (text) => ({ kind: 'name', text, escaped: false }));
  }

  if (dialect === 'sqlite' && char === '`') {
    return scanQuoted(sql, start + 1, '`', (text) => ({ kind: 'name', text, escaped: false }));
  }

  if (dialect === 'sqlite' && char === '[') {
    const close = sql.indexOf(']', start + 1);

    return close === -1
      ? { token: null, end: sql.length, closed: false }
      : {
          token: { kind: 'name', text: sql.slice(start + 1, close), escaped: false },
          end: close + 1,
          closed: true,
        };
  }

  if (wordStartPattern.test(char)) {
    let end = start + 1;

    while (end < sql.length && wordPattern.test(sql.charAt(end))) {
      end += 1;
    }

    return { token: { kind: 'word', text: sql.slice(start, end) }, end, closed: true };
  }

  return { token: { kind: 'symbol', text: char }, end: start + 1, closed: true };
}

// Postgres nests block comments, so `/* a /* b */ c */` is one comment; SQLite ends it at the
// first `*/`.
function scanBlockComment(sql: string, start: number, nests: boolean): Scan {
  let depth = 1;
  let index = start + 2;

  while (index < sql.length) {
    const pair = sql.slice(index, index + 2);

    if (nests && pair === '/*') {
      depth += 1;
      index += 2;
    } else if (pair === '*/') {
      depth -= 1;
      index += 2;

      if (depth === 0) {
        return { token: null, end: index, closed: true };
      }
    } else {
      index += 1;
    }
  }

  return { token: null, end: sql.length, closed: false };
}

const dollarTagPattern = /^\$(?:[\p{L}_][\p{L}\p{N}_]*)?\$/u;

// `U&"…"` spells a name in escapes, `E'…'` takes backslash escapes, and `$tag$…$tag$` holds a
// body with no escapes at all. A `$` with a digit after it is a parameter, such as `$1`.
function scanPostgresQuote(sql: string, start: number): Scan | null {
  const head = sql.slice(start, start + 3).toLowerCase();

  if (head === 'u&"') {
    return scanQuoted(sql, start + 3, '"', (text) => ({ kind: 'name', text, escaped: true }));
  }

  if (head === "u&'") {
    return scanQuoted(sql, start + 3, "'", (text) => ({ kind: 'string', text }));
  }

  if (head.startsWith("e'")) {
    return scanEscapedString(sql, start + 2);
  }

  const tag = dollarTagPattern.exec(sql.slice(start))?.[0];

  if (tag === undefined) {
    return null;
  }

  const bodyStart = start + tag.length;
  const close = sql.indexOf(tag, bodyStart);

  return close === -1
    ? { token: null, end: sql.length, closed: false }
    : {
        token: { kind: 'string', text: sql.slice(bodyStart, close) },
        end: close + tag.length,
        closed: true,
      };
}

// A doubled quote stands for one quote inside the text.
function scanQuoted(
  sql: string,
  bodyStart: number,
  quote: string,
  toToken: (text: string) => SQLToken,
): Scan {
  let text = '';
  let index = bodyStart;

  while (index < sql.length) {
    const char = sql.charAt(index);

    if (char !== quote) {
      text += char;
      index += 1;
    } else if (sql.charAt(index + 1) === quote) {
      text += quote;
      index += 2;
    } else {
      return { token: toToken(text), end: index + 1, closed: true };
    }
  }

  return { token: null, end: sql.length, closed: false };
}

function scanEscapedString(sql: string, bodyStart: number): Scan {
  let text = '';
  let index = bodyStart;

  while (index < sql.length) {
    const char = sql.charAt(index);

    if (char === '\\') {
      text += sql.slice(index, index + 2);
      index += 2;
    } else if (char !== "'") {
      text += char;
      index += 1;
    } else if (sql.charAt(index + 1) === "'") {
      text += "'";
      index += 2;
    } else {
      return { token: { kind: 'string', text }, end: index + 1, closed: true };
    }
  }

  return { token: null, end: sql.length, closed: false };
}
