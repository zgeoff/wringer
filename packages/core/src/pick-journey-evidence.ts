import type { LocalCause } from './report-document.ts';
import type { Verdict } from './report-schema.ts';

export interface JourneyEvidenceFacts {
  readonly verdict: Verdict;

  // The registry target's `evidence` setting, or null when the registry no longer has the target.
  readonly targetEvidence: 'upload' | 'local' | null;
  readonly hasRunLog: boolean;
  readonly isUploadAllowed: boolean;
}

// A journey uploads when the flag allows it, the verdict's target had `evidence: 'upload'` when
// `done` recorded it, and the registry's target of that name still has it.
export function pickJourneyEvidence(facts: JourneyEvidenceFacts): 'upload' | LocalCause {
  if (!facts.hasRunLog) {
    return 'run-log-missing';
  }

  if (facts.verdict.target.evidence === 'local') {
    return 'recorded-local';
  }

  if (facts.targetEvidence === null) {
    return 'target-gone';
  }

  if (facts.targetEvidence === 'local') {
    return 'target-local';
  }

  return facts.isUploadAllowed ? 'upload' : 'no-upload-flag';
}
