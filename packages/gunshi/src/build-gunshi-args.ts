import type { CommandInfo } from '@wringer/core';
import type { ArgSchema } from 'gunshi';
import { keepFlagText } from './keep-flag-text.ts';
import { parseArgProperties, scalarTypeSchema } from './parse-arg-properties.ts';
import type { ArgProperty, ScalarType } from './parse-arg-properties.ts';

export type GunshiArgs = Readonly<Record<string, ArgSchema>>;

// gunshi only types each flag; the command's zod schema still checks the whole object in dispatch,
// so a required flag, a range or a refinement fails there, with a usage error and its path. The
// positionals are left out, for gunshi to take as positionals.
export function buildGunshiArgs(info: CommandInfo): GunshiArgs {
  const positionals = new Set(info.positionals);

  return Object.fromEntries(
    Object.entries(parseArgProperties(info))
      .filter(([name]) => !positionals.has(name))
      .map(([name, property]) => [name, pickArgSchema(property)]),
  );
}

// A non-scalar flag takes JSON text, which gunshi parses before the command's schema checks it. A
// boolean flag also takes `--no-<flag>`. An enum flag keeps its text, empty included, as a string
// flag does, and the command's schema checks the choice.
function pickArgSchema(property: ArgProperty): ArgSchema {
  const described = property.description === undefined ? {} : { description: property.description };
  const choices = property.enum?.filter((choice) => typeof choice === 'string') ?? [];

  if (choices.length > 0 && choices.length === property.enum?.length) {
    return { type: 'enum', choices, parse: keepFlagText, ...described };
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

  if (type === 'string') {
    return { type, parse: keepFlagText, ...described };
  }

  return { type, ...described };
}

function parseJSONFlag(value: string): unknown {
  return JSON.parse(value);
}
