import { isDeepStrictEqual } from 'node:util';
import type { RunView } from './build-run-view.ts';
import { WringerError } from './wringer-error.ts';

// `done` judged the run it read when it started. Its verdict stands only while the doctor it
// trusted is still the latest, which holds while the drives it read still open the run's drives
// since the doctor: a later doctor event empties that list.
export function findVerdictRefusal(
  read: RunView | undefined,
  current: RunView | undefined,
): WringerError | null {
  const readDrives = read?.drivesAfterDoctor ?? [];

  const stands =
    current?.doctor === 'passed' &&
    isDeepStrictEqual(current.drivesAfterDoctor.slice(0, readDrives.length), readDrives);

  if (stands) {
    return null;
  }

  return new WringerError('doctor-required', {
    message: `The doctor ran again on run ${current?.runID ?? 'none'} while \`done\` judged it.`,
    hint: 'Run `doctor`, then drive the feature again.',
  });
}
