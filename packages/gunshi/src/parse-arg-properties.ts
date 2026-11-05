import { findOwnValue } from '@wringer/core';
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

// A schema with an `id` in its metadata sits under `$defs`, and its place holds a `$ref` to it.
const defsJSONSchema = z.looseObject({ $defs: z.record(z.string(), z.unknown()).default({}) });

// The JSON Schema of a command's arguments gives each field's type without walking zod's internals.
// A union's fields all become flags, and the command's own schema then checks which branch matched.
export function parseArgProperties(info: CommandInfo): Readonly<Record<string, ArgProperty>> {
  const jsonSchema = z.toJSONSchema(info.args, { io: 'input', unrepresentable: 'any' });
  const defs = defsJSONSchema.parse(jsonSchema).$defs;

  return collectProperties(jsonSchema, defs);
}

// A union of objects, such as a discriminated union, puts its fields under `oneOf` or `anyOf`.
const objectJSONSchema = z.looseObject({
  properties: z.record(z.string(), z.unknown()).default({}),
  oneOf: z.array(z.unknown()).default([]),
  anyOf: z.array(z.unknown()).default([]),
});

// A field that two branches type differently, items included, takes JSON text, so either branch's
// value parses. Two enums of one type join their choices.
function collectProperties(
  jsonSchema: unknown,
  defs: Readonly<Record<string, unknown>>,
): Record<string, ArgProperty> {
  const parsed = objectJSONSchema.safeParse(findReferenced(jsonSchema, defs));

  if (!parsed.success) {
    return {};
  }

  const branches = [...parsed.data.oneOf, ...parsed.data.anyOf].map((branch) =>
    collectProperties(branch, defs),
  );

  const own = Object.fromEntries(
    Object.entries(parsed.data.properties).flatMap(([name, property]) => {
      const typed = propertyJSONSchema.safeParse(findReferenced(property, defs));

      return typed.success ? [[name, typed.data] as const] : [];
    }),
  );

  // A Map holds any argument name, `constructor` included, as its own key.
  const collected = new Map<string, ArgProperty>();

  for (const properties of [own, ...branches]) {
    for (const [name, property] of Object.entries(properties)) {
      const seen = collected.get(name);
      const merged = seen === undefined ? property : pickMergedProperty(seen, property);

      collected.set(name, merged);
    }
  }

  return Object.fromEntries(collected);
}

const refJSONSchema = z.looseObject({ $ref: z.string().startsWith('#/$defs/') });

// The schema a local `$ref` names, or the schema itself when it holds no such reference.
function findReferenced(jsonSchema: unknown, defs: Readonly<Record<string, unknown>>): unknown {
  const ref = refJSONSchema.safeParse(jsonSchema);

  if (!ref.success) {
    return jsonSchema;
  }

  return findOwnValue(defs, toPointerSegment(ref.data.$ref.slice('#/$defs/'.length))) ?? jsonSchema;
}

// A JSON Pointer escapes `/` as `~1` and `~` as `~0`; decoding `~1` first keeps `~01` as `~1`.
function toPointerSegment(escaped: string): string {
  return escaped.replaceAll('~1', '/').replaceAll('~0', '~');
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
