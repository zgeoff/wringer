import { parseSQLTokens } from './parse-sql-tokens.ts';
import type { SQLToken } from './parse-sql-tokens.ts';

type Dialect = 'sqlite' | 'postgres';

export function findStatementBody(dialect: Dialect, sql: string): string | null {
  const whole = parseSQLTokens(dialect, sql);

  if (!whole.closed) {
    return null;
  }

  if (!whole.tokens.some(isSemicolon)) {
    return sql.trim();
  }

  for (let index = sql.indexOf(';'); index !== -1; index = sql.indexOf(';', index + 1)) {
    const head = parseSQLTokens(dialect, sql.slice(0, index));
    const tail = parseSQLTokens(dialect, sql.slice(index));

    if (head.closed && !head.tokens.some(isSemicolon) && tail.tokens.every(isSemicolon)) {
      return sql.slice(0, index).trim();
    }
  }

  return null;
}

function isSemicolon(token: SQLToken): boolean {
  return token.kind === 'symbol' && token.text === ';';
}
