import { SQL } from 'bun';
import type { Row } from './parse-exec-rows.ts';

export interface SQLQueryInput {
  readonly adapter: 'sqlite' | 'postgres';
  readonly url: string;
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly write: boolean;
}

// A read opens SQLite read-only, and runs on Postgres in a read-only transaction, so the database
// refuses a statement that writes whatever the caller claimed.
export async function runSQLQuery(input: SQLQueryInput): Promise<readonly Row[]> {
  const client =
    input.adapter === 'sqlite'
      ? new SQL({ adapter: 'sqlite', filename: input.url, readonly: !input.write })
      : new SQL(input.url);

  try {
    const rows: readonly Row[] =
      input.write || input.adapter === 'sqlite'
        ? await client.unsafe<Row[]>(input.sql, [...input.params])
        : await client.begin('read only', (transaction) =>
            transaction.unsafe<Row[]>(input.sql, [...input.params]),
          );

    return rows.map((row) => Object.fromEntries(Object.entries(row)));
  } finally {
    await client.close();
  }
}
