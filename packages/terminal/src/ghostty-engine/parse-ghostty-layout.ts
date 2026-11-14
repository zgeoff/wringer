import { z } from 'zod';

const memberSchema = z.record(z.string(), z.number());
const enumSchema = z.object({ values: memberSchema });
const usizeSchema = z.union([z.literal(4), z.literal(8)]);

const layoutSchema = z.object({
  abi: z.object({ usize_size: usizeSchema }),
  types: z.record(z.string(), z.unknown()),
});

export interface GhosttyLayout {
  readonly usizeSize: 4 | 8;

  // The value of one member of an enum the library describes, such as `GhosttyKey` and `ENTER`.
  readonly enumValue: (enumName: string, member: string) => number;
}

// The library describes its own ABI as JSON, so the binding reads each enum value and the size of
// `usize` from it and hard-codes none.
export function parseGhosttyLayout(json: string): GhosttyLayout {
  const parsed: unknown = JSON.parse(json);
  const layout = layoutSchema.parse(parsed);

  return {
    usizeSize: layout.abi.usize_size,
    enumValue: (enumName, member) => {
      const described = enumSchema.parse(layout.types[enumName]);
      const members = described.values;
      const value = members[member];

      if (value === undefined) {
        throw new Error(`The library's ${enumName} has no member ${member}.`);
      }

      return value;
    },
  };
}
