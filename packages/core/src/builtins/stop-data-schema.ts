import { z } from 'zod';

export const stopDataSchema = z.strictObject({
  run: z.string().nullable(),
  stopped: z.boolean(),
});

export type StopData = z.infer<typeof stopDataSchema>;
