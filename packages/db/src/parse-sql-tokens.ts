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

  // False when a string, a quoted name or a block comment runs to the end of the SQL.
  readonly closed: boolean;
}

interface Scan {
  readonly token: SQLToken | null;
  readonly end: number;
  readonly closed: boolean;
}

// Each rule reads one token at `start`, or returns null when the text there is not its kind.
type Rule = (sql: string, start: number) => Scan | null;

// The order matters where two rules share a first character: `E'` and `U&"` come before a word.
const dialectRules: Readonly<Record<Dialect, readonly Rule[]>> = {
  postgres: [
    scanSpace,
    makeLineCommentRule(/[\n\r]/u),
    makeBlockCommentRule(true),
    makeQuotedRule({ open: 'u&"', close: '"', doubles: true }, toEscapedNameToken),
    makeQuotedRule({ open: "u&'", close: "'", doubles: true }, toStringToken),
    scanEscapedString,
    scanDollarQuoted,
    makeQuotedRule({ open: "'", close: "'", doubles: true }, toStringToken),
    makeQuotedRule({ open: '"', close: '"', doubles: true }, toNameToken),
    scanWord,
  ],
  sqlite: [
    scanSpace,
    makeLineCommentRule(/\n/u),
    makeBlockCommentRule(false),
    makeQuotedRule({ open: "'", close: "'", doubles: true }, toStringToken),
    makeQuotedRule({ open: '"', close: '"', doubles: true }, toNameToken),
    makeQuotedRule({ open: '`', close: '`', doubles: true }, toNameToken),
    makeQuotedRule({ open: '[', close: ']', doubles: false }, toNameToken),
    scanWord,
  ],
};

// The rules follow each dialect's own scanner, so a search of the tokens sees exactly the words the
// database runs. Postgres ends a line comment at CR or LF and nests block comments; SQLite ends a
// line comment at LF only.
export function parseSQLTokens(dialect: Dialect, sql: string): SQLLex {
  const rules = dialectRules[dialect];
  const tokens: SQLToken[] = [];
  let index = 0;

  while (index < sql.length) {
    const scan = scanToken(rules, sql, index);

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

const spacePattern = /\s/u;

function scanSpace(sql: string, start: number): Scan | null {
  return spacePattern.test(sql.charAt(start))
    ? { token: null, end: start + 1, closed: true }
    : null;
}

// A line comment runs to its newline, or to the end of the SQL.
function makeLineCommentRule(newlinePattern: RegExp): Rule {
  return (sql, start) => {
    if (!sql.startsWith('--', start)) {
      return null;
    }

    let end = start + 2;

    while (end < sql.length && !newlinePattern.test(sql.charAt(end))) {
      end += 1;
    }

    return { token: null, end, closed: true };
  };
}

// With nesting, `/* a /* b */ c */` is one comment; without, it ends at the first `*/`.
function makeBlockCommentRule(nests: boolean): Rule {
  return (sql, start) => {
    if (!sql.startsWith('/*', start)) {
      return null;
    }

    let depth = 1;
    let index = start + 2;

    while (index < sql.length) {
      if (nests && sql.startsWith('/*', index)) {
        depth += 1;
        index += 2;
      } else if (sql.startsWith('*/', index)) {
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
  };
}

interface Quote {
  readonly open: string;
  readonly close: string;

  // When true, a doubled close quote stands for one quote inside the text.
  readonly doubles: boolean;
}

function makeQuotedRule(quote: Quote, toToken: (text: string) => SQLToken): Rule {
  return (sql, start) => {
    const head = sql.slice(start, start + quote.open.length).toLowerCase();

    if (head !== quote.open) {
      return null;
    }

    let text = '';
    let index = start + quote.open.length;

    while (index < sql.length) {
      const char = sql.charAt(index);

      if (char !== quote.close) {
        text += char;
        index += 1;
      } else if (quote.doubles && sql.charAt(index + 1) === quote.close) {
        text += quote.close;
        index += 2;
      } else {
        return { token: toToken(text), end: index + 1, closed: true };
      }
    }

    return { token: null, end: sql.length, closed: false };
  };
}

function toEscapedNameToken(text: string): SQLToken {
  return { kind: 'name', text, escaped: true };
}

function toStringToken(text: string): SQLToken {
  return { kind: 'string', text };
}

// `E'…'` takes backslash escapes as well as a doubled quote.
function scanEscapedString(sql: string, start: number): Scan | null {
  if (sql.slice(start, start + 2).toLowerCase() !== "e'") {
    return null;
  }

  let text = '';
  let index = start + 2;

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

const dollarTagPattern = /^\$(?:[\p{L}_][\p{L}\p{N}_]*)?\$/u;

// `$tag$…$tag$` holds a body with no escapes at all. A `$` with a digit after it is a parameter,
// such as `$1`, which no tag matches.
function scanDollarQuoted(sql: string, start: number): Scan | null {
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

function toNameToken(text: string): SQLToken {
  return { kind: 'name', text, escaped: false };
}

const wordStartPattern = /[\p{L}_]/u;
const wordPattern = /[\p{L}\p{N}_$]/u;

function scanWord(sql: string, start: number): Scan | null {
  if (!wordStartPattern.test(sql.charAt(start))) {
    return null;
  }

  let end = start + 1;

  while (end < sql.length && wordPattern.test(sql.charAt(end))) {
    end += 1;
  }

  return { token: { kind: 'word', text: sql.slice(start, end) }, end, closed: true };
}

function scanToken(rules: readonly Rule[], sql: string, start: number): Scan {
  for (const rule of rules) {
    const scan = rule(sql, start);

    if (scan !== null) {
      return scan;
    }
  }

  return { token: { kind: 'symbol', text: sql.charAt(start) }, end: start + 1, closed: true };
}
