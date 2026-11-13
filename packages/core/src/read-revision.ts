import { z } from 'zod';
import { raceDeadline } from './race-deadline.ts';
import { revisionSchema } from './run-events.ts';
import { toWringerError } from './to-wringer-error.ts';
import type { DriveContext, RevisionFunction } from './types.ts';
import { WringerError } from './wringer-error.ts';

// How long a target's `revision` may run, in the doctor and in `done` alike.
export const revisionTimeoutMs = 5000;
const normalizedRevisionSchema = z.string().trim().toLowerCase().pipe(revisionSchema);

// Calls the target's `revision` on the drive's read-only clients. The value is trimmed and
// lowercased, and anything but 7 to 64 hex characters fails.
export async function readRevision(revision: RevisionFunction, ctx: DriveContext): Promise<string> {
  const read = Promise.try(() =>
    revision({
      target: ctx.target,
      endpoints: ctx.endpoints,
      drivers: ctx.drivers,
      signal: ctx.signal,
    }),
  );

  // A target's `revision` is user code: nothing but this check stops it returning a non-string.
  const value: unknown = await raceDeadline(read, ctx.signal).catch((error: unknown) => {
    throw toRevisionFailure(error);
  });

  const parsed = normalizedRevisionSchema.safeParse(value);

  if (!parsed.success) {
    throw new WringerError('check-failed', {
      message: `The target's revision is not 7 to 64 hex characters: ${formatRevisionValue(value)}.`,
      hint: 'Make `revision` return the commit id the deployment runs.',
    });
  }

  return parsed.data;
}

// A `revision` that throws a plain error failed to reach the deployment, which is the environment's
// failure, never a bug in wringer.
function toRevisionFailure(error: unknown): WringerError {
  const failure = toWringerError(error);

  if (failure.code !== 'internal') {
    return failure;
  }

  return new WringerError('environment', {
    message: `The revision call failed: ${error instanceof Error ? error.message : String(error)}`,
  });
}

// A string is described by its length, never echoed: a cut echo could split a secret, and the sink
// scrubbing it would then miss the half that stays.
function formatRevisionValue(value: unknown): string {
  if (typeof value === 'string') {
    return `a string of ${value.length} characters`;
  }

  return value === null ? 'null' : typeof value;
}
