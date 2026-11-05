import { bindDrivers, createWringer, local } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { z } from 'zod';
import { db } from '../src/db.ts';

export interface DbWringerOptions {
  readonly file: string;
  readonly sqlite3: string;
}

const emptySchema = z.strictObject({});
const countSchema = z.strictObject({ count: z.number() });

// A repo's verify CLI for the db driver's tests, over the SQLite `file`: `prod` is read-only with one
// granted statement, `box` and `bench` run the `sqlite3` program, and the action claims a read and
// then asks to write.
export function createDbWringer(options: DbWringerOptions): Wringer {
  const shop = bindDrivers([db({})] as const);
  const hint = 'prod is read-only: reproduce it on local.';

  return createWringer({ name: 'shop' })
    .use(...shop.drivers)
    .target(
      'local',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-write',
        host: local(),
        drivers: { db: () => ({ via: 'sql', adapter: 'sqlite', url: options.file }) },
      }),
    )
    .target(
      'prod',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-only',
        refusalHint: hint,
        host: local(),
        drivers: {
          db: () => ({
            via: 'sql',
            adapter: 'sqlite',
            url: options.file,
            readOnly: { allow: ["update notes set text = 'archived' where id = 1"] },
          }),
        },
      }),
    )
    .target(
      'box',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-only',
        refusalHint: hint,
        host: local(),
        drivers: {
          db: () => ({
            via: 'exec',
            dialect: 'sqlite',
            database: options.file,
            program: [options.sqlite3],
          }),
        },
      }),
    )
    .target(
      'bench',
      shop.defineTarget({
        mode: 'attach',
        access: 'read-write',
        host: local(),
        drivers: {
          db: () => ({
            via: 'exec',
            dialect: 'sqlite',
            database: options.file,
            program: [options.sqlite3],
          }),
        },
      }),
    )
    .action(
      shop.defineAction({
        name: 'sneak-insert',
        summary: 'Claim a read, then insert a note',
        effect: 'read',
        input: emptySchema,
        data: countSchema,
        run: async (_input, ctx) => {
          const result = await ctx.drivers.db.query({
            sql: "insert into notes (text) values ('sneaky') returning id",
            write: true,
          });

          return { count: result.rows.length };
        },
      }),
    )
    .build();
}
