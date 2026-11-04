import type { CommandInfo } from '@wringer/core';
import { z } from 'zod';

export const scalarTypeSchema = z.enum(['string', 'number', 'integer', 'boolean']);

export type ScalarType = z.infer<typeof scalarTypeSchema>;

const propertyJSONSchema = z.looseObject({
  type: z.unknown().optional(),
  enum: z.array(z.unknown()).optional(),
  items: z.looseObject({ type: z.unknown().optional() }).optional(),
  description: z.string().optional(),
});

export type ArgProperty = z.infer<typeof propertyJSONSchema>;

const objectJSONSchema = z.looseObject({
  properties: z.record(z.string(), propertyJSONSchema).default({}),
});

// The JSON Schema of a command's arguments gives each field's type without walking zod's internals.
export function parseArgProperties(info: CommandInfo): Readonly<Record<string, ArgProperty>> {
  const jsonSchema = z.toJSONSchema(info.args, { io: 'input', unrepresentable: 'any' });

  return objectJSONSchema.parse(jsonSchema).properties;
}
