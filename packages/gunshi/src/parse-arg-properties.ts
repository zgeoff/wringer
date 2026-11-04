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

// A field that two branches type differently takes JSON text, so either branch's value parses.
function collectProperties(jsonSchema: unknown): Record<string, ArgProperty> {
  const parsed = objectJSONSchema.safeParse(jsonSchema);

  if (!parsed.success) {
    return {};
  }

  const branches = [...parsed.data.oneOf, ...parsed.data.anyOf].map((branch) =>
    collectProperties(branch),
  );

  return [parsed.data.properties, ...branches].reduce<Record<string, ArgProperty>>(
    (collected, properties) => {
      for (const [name, property] of Object.entries(properties)) {
        const seen = collected[name];

        collected[name] =
          seen === undefined || seen.type === property.type ? (seen ?? property) : {};
      }

      return collected;
    },
    {},
  );
}
