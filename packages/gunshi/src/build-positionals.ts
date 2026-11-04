import type { CommandInfo } from '@wringer/core';
import { parseArgProperties, scalarTypeSchema } from './parse-arg-properties.ts';
import type { ScalarType } from './parse-arg-properties.ts';

export interface Positional {
  readonly name: string;
  readonly type: ScalarType;
  readonly list: boolean;
}

// The positionals in the order the command declares them, each with the type its words convert to.
export function buildPositionals(info: CommandInfo): readonly Positional[] {
  const properties = parseArgProperties(info);

  return (info.positionals ?? []).map((name) => {
    const property = properties[name];
    const list = property?.type === 'array';
    const declared = list ? property.items?.type : property?.type;
    const parsed = scalarTypeSchema.safeParse(declared);

    return { name, type: parsed.success ? parsed.data : 'string', list };
  });
}
