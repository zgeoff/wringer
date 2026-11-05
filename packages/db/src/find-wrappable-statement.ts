import { findLeadingWord } from './find-leading-word.ts';
import { parseSQLTokens } from './parse-sql-tokens.ts';

type Dialect = 'sqlite' | 'postgres';

// Each read a subquery or a view can hold. SHOW, EXPLAIN and PRAGMA cannot sit in one.
const wrappableWords: Readonly<Record<Dialect, ReadonlySet<string>>> = {
  postgres: new Set(['select', 'with', 'values', 'table']),
  sqlite: new Set(['select', 'with', 'values']),
};

// The statement without its trailing `;`, when it is a read the driver can wrap to learn its
// columns. A `;` left inside it would end the wrapper early, so such a statement has none.
export function findWrappableStatement(dialect: Dialect, sql: string): string | null {
  const statement = sql.trim().replace(/[;\s]+$/u, '');
  const lex = parseSQLTokens(dialect, statement);

  if (!lex.closed || lex.tokens.some((token) => token.kind === 'symbol' && token.text === ';')) {
    return null;
  }

  return wrappableWords[dialect].has(findLeadingWord(lex.tokens) ?? '') ? statement : null;
}
