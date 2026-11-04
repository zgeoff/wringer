import { join } from 'node:path';
import type { StatePort } from './create-file-state.ts';
import type { Envelope } from './envelope.ts';
import { verdictSchema } from './report-schema.ts';
import type { Verdict } from './report-schema.ts';

export const doneCommand = 'done';

// Merges the verdicts of every run in the worktree: the latest `done` per feature wins.
export async function readVerdicts(
  state: StatePort,
  root: string,
): Promise<ReadonlyMap<string, Verdict>> {
  const runs = await state.listRuns();
  const events = await Promise.all(runs.map((runID) => state.readRunEvents(runID)));

  const envelopes = events
    .flat()
    .flatMap((event) =>
      event.type === 'envelope' && event.envelope.command === doneCommand && event.envelope.ok
        ? [event.envelope]
        : [],
    );

  const verdicts = await Promise.all(envelopes.map((envelope) => readVerdict(envelope, root)));

  const latest = new Map<string, Verdict>();

  for (const verdict of verdicts
    .flat()
    .toSorted((left, right) => left.at.localeCompare(right.at))) {
    latest.set(verdict.feature, verdict);
  }

  return latest;
}

// A verdict over the data cap sits in the payload file the envelope names, not in the envelope.
async function readVerdict(envelope: Envelope, root: string): Promise<readonly Verdict[]> {
  const data: unknown =
    envelope.truncatedPath === undefined
      ? envelope.data
      : await Bun.file(join(root, envelope.truncatedPath)).json();

  const parsed = verdictSchema.safeParse(data);

  return parsed.success ? [parsed.data] : [];
}
