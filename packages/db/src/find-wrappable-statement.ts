import { findLeadingWord } from './find-leading-word.ts';
import { findStatementBody } from './find-statement-body.ts';
import { parseSQLTokens } from './parse-sql-tokens.ts';

type Dialect = 'sqlite' | 'postgres';

// Each read a subquery or a view can hold. SHOW, EXPLAIN and PRAGMA cannot sit in one.
const wrappableWords: Readonly<Record<Dialect, ReadonlySet<string>>> = {
  postgres: new Set(['select', 'with', 'values', 'table']),
  sqlite: new Set(['select', 'with', 'values']),
};

// The statement without what follows its end, when it is a read the driver can wrap to learn its
// columns.
export function findWrappableStatement(dialect: Dialect, sql: string): string | null {
  const statement = findStatementBody(dialect, sql);

  if (statement === null) {
    return null;
  }

  const lex = parseSQLTokens(dialect, statement);

  return wrappableWords[dialect].has(findLeadingWord(lex.tokens) ?? '') ? statement : null;
}
