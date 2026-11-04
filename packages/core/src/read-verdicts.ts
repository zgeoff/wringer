import type { StatePort } from './create-file-state.ts';
import { verdictSchema } from './report-schema.ts';
import type { Verdict } from './report-schema.ts';

export const doneCommand = 'done';

// Merges the verdicts of every run in the worktree: the latest `done` per feature wins.
export async function readVerdicts(state: StatePort): Promise<ReadonlyMap<string, Verdict>> {
  const runs = await state.listRuns();
  const events = await Promise.all(runs.map((runID) => state.readRunEvents(runID)));

  const verdicts = events.flat().flatMap((event) => {
    if (event.type !== 'envelope' || event.envelope.command !== doneCommand || !event.envelope.ok) {
      return [];
    }

    const parsed = verdictSchema.safeParse(event.envelope.data);

    return parsed.success ? [parsed.data] : [];
  });

  const latest = new Map<string, Verdict>();

  for (const verdict of verdicts.toSorted((left, right) => left.at.localeCompare(right.at))) {
    latest.set(verdict.feature, verdict);
  }

  return latest;
}
