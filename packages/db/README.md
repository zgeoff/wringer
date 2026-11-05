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

- `via: 'sql'` connects from the CLI to the SQLite file in `url` with `bun:sqlite`, or to the
  Postgres URL in `url` with Bun.SQL. At the deadline, the driver cancels a Postgres query in the
  database. A `bun:sqlite` call is synchronous, so a SQLite write can commit after the timeout.
- `via: 'exec'` runs the database's own client on the target's host, with the SQL on stdin:
  `sqlite3 -json`, or `psql` with the rows turned into JSON by `json_agg`. `program` replaces the
  client's command, such as `['docker', 'exec', '-i', 'db', 'psql']`.

A query through `via: 'exec'` has these limits:

- It takes no `params`.
- sqlite3 runs in `-safe` mode, which turns off the dot-commands that reach past the database.
- A statement for psql runs alone, with no backslash and no `;` inside it.
- A Postgres write returns no rows. Connect with `via: 'sql'` to read its `RETURNING` rows.
- A read through psql starts with `select`, `with`, `values` or `table`. A `show` or `explain` fails
  with a usage error, and any other read counts as a write that did not ask to write.
- At the deadline, the host stops the client's process group, locally or on the `ssh()` host. A
  client that `program` starts in a container, such as through `docker exec`, runs on, so a sqlite3
  write there can commit after the timeout.
- psql gets a `statement_timeout` of the time left when it starts, by the database host's clock,
  which must agree with the CLI's. It refuses to start once no time is left.

## Results

A query returns `{ columns, rows, rowCount }`.

- `rowCount` counts the rows a read returned, or the rows a write changed. It is null for a write
  through sqlite3, and for a psql write whose command tag holds no count, such as `CREATE TABLE`.
- On SQLite over `via: 'sql'`, `columns` holds the statement's column names, also for an empty
  result. Elsewhere, `columns` holds the first row's keys, so an empty result has none.

## Reads and writes

- A query is a read unless it passes `write: true`, and a read runs read-only in the database. On
  SQLite, `via: 'sql'` opens the file read-only with `query_only` on, and `via: 'exec'` runs sqlite3
  with `-readonly`. Postgres runs a read in a read-only transaction.
- A query through `via: 'sql'` holds one statement. Postgres refuses a second one, so a read cannot
  end its read-only transaction with `COMMIT`.
- On SQLite, a read that runs `attach`, `vacuum` or `query_only` counts as a write. The words inside
  a string, a quoted name or a comment do not count. A read-only handle still runs `VACUUM INTO`,
  which copies the database to any path.
- On Postgres, a read that holds the word `copy` or `lo_export` counts as a write, because a
  read-only transaction still lets both write server files. Postgres can run SQL from a string, so
  the word counts inside a string or a quoted name too. The words inside a comment never count,
  because Postgres never runs them. A read with a `U&"…"` name counts as a write.
- On Postgres, a `DO` block and a call to a `query_to_xml` or `dblink` function count as writes.
  Each runs SQL from a string that the query can build at run time, where no search sees its words.
- Through psql, a read that starts with `with` and holds `insert`, `update`, `delete` or `merge`
  counts as a write.
- The driver catches only the statements in this list. Connect a read-only target with a role that
  holds no file or program rights, such as `pg_write_server_files`.
- A statement that writes without asking fails with a usage error. A read-only target refuses each
  write with `read-only` and exit code 3, unless `readOnly.allow` lists it verbatim.
- A database the driver cannot reach or open fails with an `environment` error and exit code 4.
