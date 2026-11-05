import { WringerError } from '@wringer/core';
import { findLeadingWord } from './find-leading-word.ts';
import { parseSQLTokens } from './parse-sql-tokens.ts';

type Dialect = 'sqlite' | 'postgres';

export interface ExecQueryInput {
  readonly dialect: Dialect;
  readonly program: readonly string[];
  readonly database: string;
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly write: boolean;

  // The ms left before the command's deadline.
  readonly timeLeftMs: number;
}

// A client prints JSON `rows`, or, for a psql write, the `command-tag` such as `UPDATE 3`.
export type ExecOutput = 'rows' | 'command-tag';

export interface ExecQuery {
  readonly argv: readonly string[];
  readonly stdin: string;
  readonly output: ExecOutput;
}

// The SQL goes on stdin, so no shell layer between here and the database client quotes it. A read
// runs read-only in the database itself: sqlite3 opens the file with `-readonly`, and psql wraps the
// statement in a read-only transaction that `json_agg` turns into one line of JSON.
export function buildExecQuery(input: ExecQueryInput): ExecQuery {
  if (input.params.length > 0) {
    throw new WringerError('usage', {
      message: 'A target that runs the database client takes no `params`.',
      hint: 'Write the values into the SQL, or connect with `via: sql`.',
    });
  }

  if (input.dialect === 'sqlite') {
    return buildSqliteQuery(input);
  }

  return buildPostgresQuery(input);
}

// `-safe` turns off the dot-commands that reach past the database, such as `.shell`, and `.open`,
// which would reopen the file for writing.
function buildSqliteQuery(input: ExecQueryInput): ExecQuery {
  const readOnly = input.write ? [] : ['-readonly'];

  return {
    argv: [...input.program, '-safe', '-json', ...readOnly, input.database],
    stdin: input.sql,
    output: 'rows',
  };
}

const unwrappableReadWords = new Set(['show', 'explain']);

function buildPostgresQuery(input: ExecQueryInput): ExecQuery {
  // psql runs a backslash outside a quoted string as its own command, such as `\!` for a shell.
  if (input.sql.includes('\\')) {
    throw new WringerError('usage', {
      message: 'A statement for psql must hold no backslash.',
      hint: 'Write the statement without `\\`, or connect with `via: sql`.',
    });
  }

  const statement = input.sql.trim().replace(/[;\s]+$/u, '');

  // A `;` inside the statement could end a read's read-only transaction and run a write after it.
  // statement_timeout limits each statement alone, so a script of several runs past the deadline.
  if (statement.includes(';')) {
    throw new WringerError('usage', {
      message: 'A statement for psql runs alone, with no `;` inside it.',
      hint: 'Split the statements into separate queries.',
    });
  }

  const options = ['-t', '-A', '-v', 'ON_ERROR_STOP=1', '-d', input.database];

  // The deadline's abort stops only the local process, so psql inside a container runs on, and a
  // write could commit after the command reported a timeout. A statement_timeout of 0 means none.
  const limit = `set statement_timeout = ${Math.max(1, Math.ceil(input.timeLeftMs))};\n`;

  // Without `-q`, psql prints a write's command tag, which carries the count of rows it changed.
  if (input.write) {
    return {
      argv: [...input.program, '-X', ...options],
      stdin: `${limit}${input.sql}`,
      output: 'command-tag',
    };
  }

  const argv = [...input.program, '-X', '-q', ...options];

  // Postgres refuses SHOW and EXPLAIN inside the subquery that turns the rows into JSON.
  const leading = findLeadingWord(parseSQLTokens('postgres', statement).tokens);

  if (unwrappableReadWords.has(leading ?? '')) {
    throw new WringerError('usage', {
      message: 'A read through psql cannot run `show` or `explain`.',
      hint: 'Connect with `via: sql` to run it.',
    });
  }

  return {
    argv,
    stdin: `${limit}begin read only;\nselect coalesce(json_agg(q), '[]'::json) from (\n${statement}\n) q;\ncommit;\n`,
    output: 'rows',
  };
}
