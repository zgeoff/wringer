<div align="center">
  <h1>@wringer/db</h1>

  <p>
    <a href="https://www.npmjs.com/package/@wringer/db"><img src="https://img.shields.io/npm/v/@wringer/db" alt="npm version"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>
</div>

The db driver for wringer: it runs SQL on a target's SQLite or Postgres database.

## Install

```bash
bun add @wringer/core @wringer/db
```

The package runs on [Bun](https://bun.sh) 1.3 or newer.

## Usage

```ts
import { createWringer, local, ssh } from '@wringer/core';
import { db } from '@wringer/db';

export const registry = createWringer({ name: 'shop' })
  .use(db({}))
  .target('local', {
    mode: 'attach',
    access: 'read-write',
    host: local(),
    drivers: { db: () => ({ via: 'sql', adapter: 'sqlite', url: '/srv/shop/shop.db' }) },
  })
  .target('prod', {
    mode: 'attach',
    access: 'read-only',
    host: ssh({ destination: 'deploy@shop.example' }),
    drivers: { db: () => ({ via: 'exec', dialect: 'postgres', database: 'shop' }) },
  })
  .build();
```

An action calls `ctx.drivers.db.query({ sql, params, write })`. The CLI adds `db query "<sql>"`,
with `--write` for a statement that writes, and the doctor check `db.connect`.

## Connections

- `via: 'sql'` connects from the CLI with `bun:sqlite` or Bun.SQL to the database in `url`. Postgres
  stops a query at a `statement_timeout` of the time left, and the driver cancels it at the
  deadline. A `bun:sqlite` call is synchronous, so a SQLite write can commit after the timeout.
- `via: 'exec'` runs the database's own client on the target's host, with the SQL on stdin:
  `sqlite3 -json`, or `psql` with the rows turned into JSON by `json_agg`. `program` replaces the
  client's command, such as `['docker', 'exec', '-i', 'db', 'psql']`.

A query through `via: 'exec'` has these limits:

- It takes no `params`.
- sqlite3 runs in `-safe` mode, which turns off the dot-commands that reach past the database.
- A statement for psql, or a read for sqlite3, runs alone, and one for psql holds no backslash.
- A Postgres write returns no rows. Connect with `via: 'sql'` to read its `RETURNING` rows.
- An `explain` read, or a `show` through psql, fails with a usage error. sqlite3 runs a `pragma`
  read as its table-valued function, with no schema, so run a pragma that sets a value as a write.
- At the deadline, the host stops the client's process group. A client that `program` starts in a
  container, such as with `docker exec`, runs on, so a sqlite3 write there can commit after it.
- psql gets a `statement_timeout` of the time left when it starts, by the database host's clock,
  which must agree with the CLI's. It refuses to start once no time is left.

## Results

A query returns `{ columns, rows, rowCount }`.

- `rowCount` counts the rows a read returned, or the rows a write changed. It is null for a write
  through sqlite3, and for a psql write whose command tag holds no count, such as `CREATE TABLE`.
- `columns` holds a read's columns in order, also with no rows: from the statement on SQLite
  `via: 'sql'`, else from a wrapper, or from the first row of a Postgres `show` or `explain`.

## Reads and writes

- A query is a read unless it passes `write: true`, and a read runs read-only in the database. On
  SQLite, `via: 'sql'` opens the file read-only with `query_only` on, and `via: 'exec'` runs sqlite3
  with `-readonly`. Postgres runs a read in a read-only transaction.
- A query through `via: 'sql'` holds one statement, so a read cannot end its transaction early.
- On SQLite, a read starts with `select`, `with`, `values`, `explain` or `pragma`, and one that runs
  `attach`, `vacuum` or `query_only` counts as a write. A read-only handle still runs `VACUUM INTO`,
  which copies the database to any path.
- On Postgres, a read starts with `select`, `with`, `values`, `table`, `show` or `explain`, and
  holds none of `insert`, `update`, `delete`, `merge`, `into`, `create`, `execute` or `declare`. Any
  other read counts as a write: a read-only transaction still runs `NOTIFY`, `SET` or `PREPARE`.
- On Postgres, a read that holds the word `copy` or `lo_export` counts as a write, inside a string
  or a quoted name too, but never inside a comment: a read-only transaction still lets both write
  server files. A `DO` block, which runs SQL from a string, and a `U&"…"` name count as writes.
- On Postgres, a read calls only [the listed functions](src/find-unlisted-postgres-call.ts), such as
  `count`. Any other call counts as a write: a read-only transaction still runs `set_config`,
  `pg_sleep` or `pg_terminate_backend`. So do a schema other than `pg_catalog` before a function
  name, and a column list after a name, such as `with totals(day, amount)`.
- The driver catches only these statements, so give a read-only target a role with no file rights.
- A statement that writes without asking fails with a usage error. A read-only target refuses each
  write with `read-only` and exit code 3, unless `readOnly.allow` lists it verbatim.
- A database that the driver cannot reach or open, or that refuses a declared write, such as a
  replica, fails with exit code 4 (`environment`). A statement stopped at the deadline exits 5.
