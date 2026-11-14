import { findLeadingWord } from './find-leading-word.ts';
import { findStatementBody } from './find-statement-body.ts';
import { parseSQLTokens } from './parse-sql-tokens.ts';

// Each Postgres read a subquery can hold. SHOW and EXPLAIN cannot sit in one.
const wrappableWords: ReadonlySet<string> = new Set(['select', 'with', 'values', 'table']);

export function findWrappableStatement(sql: string): string | null {
  const statement = findStatementBody('postgres', sql);

  if (statement === null) {
    return null;
  }

  const lex = parseSQLTokens('postgres', statement);

  return wrappableWords.has(findLeadingWord(lex.tokens) ?? '') ? statement : null;
}
