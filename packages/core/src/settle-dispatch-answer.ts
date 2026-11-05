import { buildEnvelope } from './build-envelope.ts';
import type { EnvelopeInput } from './build-envelope.ts';
import type { Envelope } from './envelope.ts';
import { exitCodeFor } from './error-codes.ts';
import type { ExitCode } from './error-codes.ts';
import type { WringerError } from './wringer-error.ts';

export interface DispatchAnswer {
  readonly envelope: Envelope;
  readonly exitCode: ExitCode;
}

// A failed write of the run's log leaves the command out of the log, so the answer carries that
// failure in place of the command's own outcome, and no data or truncated payload.
export function settleDispatchAnswer(
  input: EnvelopeInput,
  logFailure: WringerError | null,
): DispatchAnswer {
  const final: EnvelopeInput =
    logFailure === null ? input : { ...input, data: null, truncatedPath: null, error: logFailure };

  return {
    envelope: buildEnvelope(final),
    exitCode: final.error === null ? 0 : exitCodeFor[final.error.code],
  };
}
