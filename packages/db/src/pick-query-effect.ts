import type { Effect } from '@wringer/core';
import { z } from 'zod';

const grantsSchema = z.strictObject({ allow: z.array(z.string().min(1)) });

const sqlConfigSchema = z.strictObject({
  via: z.literal('sql'),
  adapter: z.enum(['sqlite', 'postgres']),
  url: z.string().min(1),
  readOnly: grantsSchema.optional(),
});

const execConfigSchema = z.strictObject({
  via: z.literal('exec'),
  dialect: z.enum(['sqlite', 'postgres']),
  database: z.string().min(1),
  program: z.array(z.string().min(1)).min(1).optional(),
  readOnly: grantsSchema.optional(),
});

export const dbConfigSchema = z.discriminatedUnion('via', [sqlConfigSchema, execConfigSchema]);

export type DbConfig = z.infer<typeof dbConfigSchema>;

export function pickQueryEffect(sql: string, write: boolean, config: DbConfig): Effect {
  const granted = config.readOnly?.allow.includes(sql.trim()) === true;

  return write && !granted ? 'write' : 'read';
}
