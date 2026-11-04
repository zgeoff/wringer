import { WringerError } from '@wringer/core';

type Dialect = 'sqlite' | 'postgres';

export interface ExecQueryInput {
  readonly dialect: Dialect;
  readonly program: readonly string[];
  readonly database: string;
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly write: boolean;
}

export interface ExecQuery {
  readonly argv: readonly string[];
  readonly stdin: string;
  readonly printsRows: boolean;
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
    printsRows: true,
  };
}

function buildPostgresQuery(input: ExecQueryInput): ExecQuery {
  // psql runs a backslash outside a quoted string as its own command, such as `\!` for a shell.
  if (input.sql.includes('\\')) {
    throw new WringerError('usage', {
      message: 'A statement for psql must hold no backslash.',
      hint: 'Write the statement without `\\`, or connect with `via: sql`.',
    });
  }

  const argv = [
    ...input.program,
    '-X',
    '-q',
    '-t',
    '-A',
    '-v',
    'ON_ERROR_STOP=1',
    '-d',
    input.database,
  ];

  if (input.write) {
    return { argv, stdin: input.sql, printsRows: false };
  }

  const statement = input.sql.trim().replace(/[;\s]+$/u, '');

  // A `;` inside the statement could end the read-only transaction and run a write after it.
  if (statement.includes(';')) {
    throw new WringerError('usage', {
      message: 'A read runs one statement, with no `;` inside it.',
      hint: 'Split the statements into separate reads.',
    });
  }

  return {
    argv,
    stdin: `begin read only;\nselect coalesce(json_agg(q), '[]'::json) from (\n${statement}\n) q;\ncommit;\n`,
    printsRows: true,
  };
}
