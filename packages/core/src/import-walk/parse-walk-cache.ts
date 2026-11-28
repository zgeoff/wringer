import { z } from 'zod';

const reachSchema = z.strictObject({
  reached: z.array(z.string()).readonly(),
  warnings: z.array(z.string()).readonly(),
});

const walkCacheSchema = z.record(z.string(), reachSchema);

export type FeatureReach = z.infer<typeof reachSchema>;

export type WalkCache = z.infer<typeof walkCacheSchema>;

// Null for text that is no cache, such as a file a crash cut short.
export function parseWalkCache(text: string): WalkCache | null {
  try {
    const parsed = walkCacheSchema.safeParse(JSON.parse(text));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
