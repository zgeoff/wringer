import type { CheckResult, RunEvent } from '../run-events.ts';
import { WringerError } from '../wringer-error.ts';

export interface DoctorData {
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
  const passed = results.every((result) => result.status === 'passed');
  const data = { passed, results: [...results] };
  const failed = results.filter((result) => result.status === 'failed');

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
