import { z } from 'zod';

const storedSecretSchema = z.strictObject({
  name: z.string(),
  value: z.string(),
  origin: z.enum(['declared', 'collected']).default('collected'),
});

export type StoredSecret = z.infer<typeof storedSecretSchema>;

// A record written without an origin is a collected one.
export type StoredSecretInput = z.input<typeof storedSecretSchema>;

// A line that does not parse, such as one a killed writer left torn, is skipped: the file only
// adds protection, so a bad line must never stop a command.
export function parseSecretsFile(text: string): readonly StoredSecret[] {
  return text.split('\n').flatMap((line) => {
    if (line === '') {
      return [];
    }

    const parsed = storedSecretSchema.safeParse(parseJSONLine(line));

    return parsed.success ? [parsed.data] : [];
  });
}

function parseJSONLine(line: string): unknown {
  try {
    const parsed: unknown = JSON.parse(line);

    return parsed;
  } catch {
    return undefined;
  }
}
