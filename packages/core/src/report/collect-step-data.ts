import type { Journey } from '../report-document/report-document.ts';
import type { SecretSet } from '../secrets/create-secret-set.ts';
import { formatStepData } from './format-step-data.ts';

// The data text of each step, or null where the step shows none. A journey whose evidence stays
// local shows no data.
export function collectStepData(journey: Journey, secrets: SecretSet): readonly (string | null)[] {
  return journey.steps.map((step) =>
    journey.evidence === 'upload'
      ? formatStepData(
          step.data,
          step.files.map((file) => file.evidence),
          secrets,
        )
      : null,
  );
}
