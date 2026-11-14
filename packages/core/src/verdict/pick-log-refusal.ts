import type { Envelope } from '../envelope/envelope.ts';
import type { RunView } from '../state/build-run-view.ts';
import type { RunViewRefusal } from '../state/create-file-state.ts';
import { findVerdictRefusal } from './find-verdict-refusal.ts';
import { doneCommand } from './read-verdicts.ts';

// Only a verdict that `done` gave needs the run, as it stands under the lock, to still match the
// run `done` read.
export function pickLogRefusal(
  envelope: Envelope,
  read: RunView | undefined,
): RunViewRefusal | null {
  if (envelope.command !== doneCommand || !envelope.ok) {
    return null;
  }

  return (current) => findVerdictRefusal(read, current);
}
