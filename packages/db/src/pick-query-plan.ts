import type { Effect } from '@wringer/core';
import { buildExecQuery } from './build-exec-query.ts';
import type { ExecQuery } from './build-exec-query.ts';
import { isUndeclaredWrite } from './is-undeclared-write.ts';
import { pickQueryEffect } from './pick-query-effect.ts';
import type { DbConfig } from './pick-query-effect.ts';

export interface PlannedQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly write: boolean;
}

export type QueryPlan =
  | { readonly kind: 'undeclared-write' }
  | {
      readonly kind: 'sql';
      readonly adapter: 'sqlite' | 'postgres';
      readonly url: string;
      readonly sql: string;
      readonly params: readonly unknown[];
      readonly write: boolean;
    }
  | {
      readonly kind: 'exec';
      readonly exec: ExecQuery;
      readonly effect: Effect;
      readonly write: boolean;
    };

// Decides how a query runs from the target's config alone, so the driver only carries the plan
// out. A read that the database would not refuse in time is an undeclared write before it runs.
export function pickQueryPlan(
  config: DbConfig,
  query: PlannedQuery,
  timeLeftMs: number,
): QueryPlan {
  const dialect = config.via === 'sql' ? config.adapter : config.dialect;

  if (!query.write && isUndeclaredWrite(dialect, config.via, query.sql)) {
    return { kind: 'undeclared-write' };
  }

  if (config.via === 'sql') {
    return {
      kind: 'sql',
      adapter: config.adapter,
      url: config.url,
      sql: query.sql,
      params: query.params,
      write: query.write,
    };
  }

  return {
    kind: 'exec',
    exec: buildExecQuery({
      dialect: config.dialect,
      program: config.program ?? [config.dialect === 'sqlite' ? 'sqlite3' : 'psql'],
      database: config.database,
      sql: query.sql,
      params: query.params,
      write: query.write,
      timeLeftMs,
    }),

    // The client call already checked this statement against the target's grants.
    effect: pickQueryEffect(query.sql, query.write, config),
    write: query.write,
  };
}
