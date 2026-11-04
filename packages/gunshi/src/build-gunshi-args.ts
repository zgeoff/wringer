import type { CommandInfo } from '@wringer/core';
import type { ArgSchema } from 'gunshi';
import { parseArgProperties, scalarTypeSchema } from './parse-arg-properties.ts';
import type { ArgProperty, ScalarType } from './parse-arg-properties.ts';

export type GunshiArgs = Readonly<Record<string, ArgSchema>>;

// gunshi only types each flag; the command's zod schema still checks the whole object in dispatch,
// so a required flag, a range or a refinement fails there, with a usage error and its path. The
// positionals are left out: the adapter assigns the words itself, in the order the command declares.
export function buildGunshiArgs(info: CommandInfo): GunshiArgs {
  const positionals = new Set(info.positionals);

  return Object.fromEntries(
    Object.entries(parseArgProperties(info))
      .filter(([name]) => !positionals.has(name))
      .map(([name, property]) => [name, pickArgSchema(property)]),
  );
}

// A flag whose value is not one scalar, such as an object, takes JSON text, which gunshi parses
// before the command's schema checks it. A boolean flag also takes `--no-<flag>`, so a flag whose
// default is true can still be turned off.
function pickArgSchema(property: ArgProperty): ArgSchema {
  const described = property.description === undefined ? {} : { description: property.description };
  const choices = property.enum?.filter((choice) => typeof choice === 'string') ?? [];

  if (choices.length > 0 && choices.length === property.enum?.length) {
    return { type: 'enum', choices, ...described };
  }

  const parsedType = scalarTypeSchema.safeParse(property.type);

  if (parsedType.success) {
    return toFlagSchema(parsedType.data, described);
  }

  const itemType = scalarTypeSchema.safeParse(property.items?.type);

  if (property.type === 'array' && itemType.success) {
    return { ...toFlagSchema(itemType.data, described), multiple: true };
  }

  return { type: 'custom', parse: parseJSONFlag, ...described };
}

function toFlagSchema(type: ScalarType, described: Pick<ArgSchema, 'description'>): ArgSchema {
  if (type === 'boolean') {
    return { type: 'boolean', negatable: true, ...described };
  }

  if (type === 'integer') {
    return { type: 'number', ...described };
  }

  // gunshi swaps an empty string for the flag's default, which is undefined here, so `--label ''`
  // would reach the schema as a missing flag. A parse function keeps the value as typed.
  if (type === 'string') {
    return { type, parse: keepFlagText, ...described };
  }

  return { type, ...described };
}

function keepFlagText(value: string): string {
  return value;
}

function parseJSONFlag(value: string): unknown {
  return JSON.parse(value);
}
