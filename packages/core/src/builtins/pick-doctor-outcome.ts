import type { CheckResult, RunEvent } from '../state/run-event.ts';
import { WringerError } from '../wringer-error.ts';

interface DoctorData {
  readonly passed: boolean;
  readonly results: CheckResult[];
}

export interface DoctorOutcome {
  readonly event: RunEvent;
  readonly data: DoctorData;

  // Thrown after the event is written, so a failed doctor still lands in the run's log.
  readonly failure: WringerError | null;
}

export function pickDoctorOutcome(results: readonly CheckResult[], at: string): DoctorOutcome {
  const failed = results.filter((result) => result.status === 'failed');
  const passed = failed.length === 0;
  const data = { passed, results: [...results] };

  return {
    event: { type: passed ? 'doctor-passed' : 'doctor-failed', at, results: data.results },
    data,
    failure: passed
      ? null
      : new WringerError('check-failed', {
          message: `The doctor failed: ${failed.map((result) => result.name).join(', ')}.`,
          data,
        }),
  };
}
