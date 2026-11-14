import { z } from 'zod';

// Each line a launched app prints to stdout reaches the plan's `ready` as one of these.
export const launchLineSchema = z.record(z.string(), z.unknown());

export type LaunchLine = Readonly<z.infer<typeof launchLineSchema>>;
