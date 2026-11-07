import type { EnvelopeInput } from './build-envelope.ts';
import type { CappedData } from './cap-data.ts';
import type { Evidence } from './envelope.ts';
import type { EnvelopePayload } from './pick-envelope-payload.ts';

export interface EnvelopeFacts {
  readonly command: string;
  readonly target: string | null;
  readonly instance: string | null;
  readonly feature: string | null;
  readonly sha: string | null;
  readonly durationMs: number;
  readonly driveEvidence: readonly Evidence[];
  readonly payload: EnvelopePayload;
  readonly capped: CappedData;
}

// The envelope's data is what the cap left; a payload that failed to cap fails the envelope unless
// an earlier failure already did.
export function settleEnvelope(facts: EnvelopeFacts): EnvelopeInput {
  return {
    command: facts.command,
    target: facts.target,
    instance: facts.instance,
    feature: facts.feature,
    sha: facts.sha,
    durationMs: facts.durationMs,
    data: facts.capped.data,
    evidence: [...facts.driveEvidence, ...facts.capped.evidence],
    cursors: facts.payload.cursors,
    truncatedPath: facts.capped.truncatedPath,
    error: facts.payload.failure ?? facts.capped.failure,
  };
}
