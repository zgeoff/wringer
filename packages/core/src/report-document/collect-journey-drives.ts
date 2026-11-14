import type { Envelope } from '../envelope/envelope.ts';
import type { RunEvent } from '../state/run-event.ts';

// The drives of one feature that its latest `done` in the run counted: the drives since the doctor
// last passed, up to that `done`. Null when the log holds no such `done`.
export function collectJourneyDrives(
  events: readonly RunEvent[],
  feature: string,
): readonly Envelope[] | null {
  let drives: Envelope[] = [];
  let counted: Envelope[] | null = null;
  let isPassed = false;

  for (const event of events) {
    if (event.type === 'doctor-passed') {
      isPassed = true;
      drives = [];
    } else if (event.type === 'doctor-failed') {
      isPassed = false;
      drives = [];
    } else if (event.type === 'envelope') {
      if (event.drive && isPassed) {
        drives.push(event.envelope);
      } else if (
        event.envelope.command === 'done' &&
        event.envelope.ok &&
        isDoneOf(event.envelope, feature)
      ) {
        counted = drives.filter((drive) => drive.feature === feature);
      }
    }
  }

  return counted;
}

function isDoneOf(envelope: Envelope, feature: string): boolean {
  return (
    typeof envelope.data === 'object' &&
    envelope.data !== null &&
    'feature' in envelope.data &&
    envelope.data.feature === feature
  );
}
