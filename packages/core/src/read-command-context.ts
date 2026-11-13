import { addEnvSecrets } from './add-env-secrets.ts';
import type { RunView } from './build-run-view.ts';
import type { StatePort } from './create-file-state.ts';
import type { SecretSet } from './create-secret-set.ts';
import { findOwnValue } from './find-own-value.ts';
import { getTarget } from './get-target.ts';
import { pickContextTarget } from './pick-context-target.ts';
import { readRunSecrets } from './read-run-secrets.ts';
import type { Session, TargetDefinition, Wringer } from './types.ts';
import { WringerError } from './wringer-error.ts';

export interface CommandContext {
  readonly targetName: string;
  readonly target: TargetDefinition;
  readonly run: RunView | undefined;
  readonly feature: string | null;
  readonly cursors: Readonly<Record<string, number>>;
}

export interface ContextSources {
  readonly state: StatePort;
  readonly session: Session;
  readonly secrets: SecretSet;
}

// Reads the target, the run and the feature a command acts on. The registry and process env
// sources go into the set first, so they scrub an error thrown while the command builds a driver
// config. The run's secrets file adds what the run's other processes kept.
export async function readCommandContext(
  wringer: Wringer,
  path: readonly string[],
  sources: ContextSources,
): Promise<CommandContext> {
  addEnvSecrets(sources.secrets, { declared: wringer.secrets, env: sources.session.env });

  // A feature names a folder of the run, so only a feature of the map may reach a path; `use` checks
  // the feature it saves, and this checks the one a command passes.
  if (
    sources.session.feature !== undefined &&
    !wringer.features.some((feature) => feature.name === sources.session.feature)
  ) {
    throw new WringerError('usage', {
      message: `The feature map has no feature named ${sources.session.feature}.`,
      hint: 'Run `features` to list them.',
    });
  }

  const pointers = await sources.state.readPointers();

  const targetName = pickContextTarget({
    targetNames: [...wringer.targets.keys()],
    sessionTarget: sources.session.target,
    savedTarget: pointers.target,
    commandKey: path.join(' '),
  });

  const target = getTarget(wringer, targetName);
  const runID = findOwnValue(pointers.currentRun, targetName);
  const run = runID === undefined ? undefined : await sources.state.readRun(runID);

  if (run !== undefined) {
    await readRunSecrets(sources.state, sources.secrets, run.runID);
  }

  return {
    targetName,
    target,
    run,
    feature: sources.session.feature ?? pointers.feature ?? null,

    // Saved cursors are offsets into one run's streams; another run's streams start over.
    cursors: runID !== undefined && pointers.cursorsRun === runID ? pointers.cursors : {},
  };
}
