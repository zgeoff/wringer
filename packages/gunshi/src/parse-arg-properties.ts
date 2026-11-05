import type { CommandInfo } from '@wringer/core';
import { z } from 'zod';

export const scalarTypeSchema = z.enum(['string', 'number', 'integer', 'boolean']);

export type ScalarType = z.infer<typeof scalarTypeSchema>;

const itemSchema = z.looseObject({ type: z.unknown().optional() });

// A tuple's JSON Schema holds `items: false`, so its items have no one type.
const noItemSchema = z.boolean().transform(() => ({ type: null }));

const propertyJSONSchema = z.looseObject({
  type: z.unknown().optional(),
  enum: z.array(z.unknown()).optional(),
  items: z.union([itemSchema, noItemSchema]).optional(),
  description: z.string().optional(),
});

export type ArgProperty = z.infer<typeof propertyJSONSchema>;

// The JSON Schema of a command's arguments gives each field's type without walking zod's internals.
// A union's fields all become flags, and the command's own schema then checks which branch matched.
export function parseArgProperties(info: CommandInfo): Readonly<Record<string, ArgProperty>> {
  const jsonSchema = z.toJSONSchema(info.args, { io: 'input', unrepresentable: 'any' });

  return collectProperties(jsonSchema);
}

// A union of objects, such as a discriminated union, puts its fields under `oneOf` or `anyOf`.
const objectJSONSchema = z.looseObject({
  properties: z.record(z.string(), propertyJSONSchema).default({}),
  oneOf: z.array(z.unknown()).default([]),
  anyOf: z.array(z.unknown()).default([]),
});

// A field that two branches type differently, items included, takes JSON text, so either branch's
// value parses. Two enums of one type join their choices.
function collectProperties(jsonSchema: unknown): Record<string, ArgProperty> {
  const parsed = objectJSONSchema.safeParse(jsonSchema);

  if (!parsed.success) {
    return {};
  }

  const branches = [...parsed.data.oneOf, ...parsed.data.anyOf].map((branch) =>
    collectProperties(branch),
  );

  // A Map holds any argument name, `constructor` included, as its own key.
  const collected = new Map<string, ArgProperty>();

  for (const properties of [parsed.data.properties, ...branches]) {
    for (const [name, property] of Object.entries(properties)) {
      const seen = collected.get(name);
      const merged = seen === undefined ? property : pickMergedProperty(seen, property);

      collected.set(name, merged);
    }
  }

  return Object.fromEntries(collected);
}

function pickMergedProperty(seen: ArgProperty, property: ArgProperty): ArgProperty {
  if (seen.type !== property.type || seen.items?.type !== property.items?.type) {
    return {};
  }

  if (seen.enum === undefined || property.enum === undefined) {
    return seen.enum === property.enum ? seen : {};
  }

  return { ...seen, enum: [...new Set([...seen.enum, ...property.enum])] };
}
