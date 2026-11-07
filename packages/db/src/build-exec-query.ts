import { WringerError } from '@wringer/core';
import { buildSqliteReadSelect } from './build-sqlite-read-select.ts';
import { findLeadingWord } from './find-leading-word.ts';
import { findStatementBody } from './find-statement-body.ts';
import { parseSQLTokens } from './parse-sql-tokens.ts';

type Dialect = 'sqlite' | 'postgres';

export interface ExecQueryInput {
  readonly dialect: Dialect;
  readonly program: readonly string[];
  readonly database: string;
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly write: boolean;

  // The command's deadline, in ms since the epoch.
  readonly deadlineAtMs: number;
}

// A client prints JSON `rows`; or, for a read, `columns-and-rows`, one JSON object of both; or
// `columns-then-rows`, a line of the columns, then the rows; or, for a psql write, the
// `command-tag` such as `UPDATE 3`.
export type ExecOutput = 'rows' | 'columns-and-rows' | 'columns-then-rows' | 'command-tag';

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
  if (input.write) {
    return {
      argv: [...input.program, '-safe', '-json', input.database],
      stdin: input.sql,
      output: 'rows',
    };
  }

  const statement = findStatementBody('sqlite', input.sql);

  if (statement === null) {
    throw new WringerError('usage', {
      message: 'A read through sqlite3 runs alone, with no second statement and nothing left open.',
      hint: 'Split the statements into separate queries.',
    });
  }

  const select = buildSqliteReadSelect(statement);
  const view = pickViewName(select);

  // sqlite3 prints nothing for a read with no rows, so a temporary view names the columns first.
  // The view lives in the connection's own temporary database, which a read-only file still allows.
  return {
    argv: [...input.program, '-safe', '-json', '-readonly', input.database],
    stdin: `create temp view ${view} as\n${select}\n;\nselect json_group_array(name) as wringer_columns from pragma_table_info('${view}');\nselect * from ${view};\n`,
    output: 'columns-then-rows',
  };
}

// A temporary view hides any table or view of the same name, so the view takes a name the read
// never mentions.
function pickViewName(select: string): string {
  const text = select.toLowerCase();
  let name = 'wringer_read';

  for (let index = 1; text.includes(name); index += 1) {
    name = `wringer_read_${index}`;
  }

  return name;
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

  // A second statement could end a read's read-only transaction and run a write after it.
  // statement_timeout limits each statement alone, so a script of several runs past the deadline.
  const statement = findStatementBody('postgres', input.sql);

  if (statement === null) {
    throw new WringerError('usage', {
      message: 'A statement for psql runs alone, with no second statement and nothing left open.',
      hint: 'Split the statements into separate queries.',
    });
  }

  // `VERBOSITY=verbose` puts each error's SQLSTATE before its message, so the driver classifies it
  // by code.
  const options = [
    '-t',
    '-A',
    '-v',
    'ON_ERROR_STOP=1',
    '-v',
    'VERBOSITY=verbose',
    '-d',
    input.database,
  ];

  // The deadline's abort stops only the local process, so psql inside a container runs on, and a
  // write could commit after the command reported a timeout. Postgres reads the time left once the
  // transport is up, by the database host's clock, and refuses to start with none left.
  const limit = `do $wringer$ declare left_ms bigint := ${Math.floor(input.deadlineAtMs)} - floor(extract(epoch from clock_timestamp()) * 1000)::bigint; begin if left_ms < 1 then raise exception 'The command''s deadline passed before the statement started.'; end if; perform set_config('statement_timeout', left_ms::text, false); end $wringer$;\n`;

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

  // The statement runs once, in a CTE. The left join gives one row of nulls for an empty result,
  // and `to_json` of that row still names each column, in order.
  return {
    argv,
    stdin: `${limit}begin read only;\nwith q as materialized (\n${statement}\n) select json_build_object('columns', (select coalesce(json_agg(k), '[]'::json) from json_object_keys((select to_json(r) from (select q.* from (values (1)) d(x) left join q on true limit 1) r)) k), 'rows', (select coalesce(json_agg(q), '[]'::json) from q));\ncommit;\n`,
    output: 'columns-and-rows',
  };
}
