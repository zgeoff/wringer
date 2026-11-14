import { join } from 'node:path';
import type { RunID } from './run-event.ts';

export interface StatePaths {
  readonly root: string;
  readonly state: string;
  readonly locks: string;
  readonly runs: string;

  // The late failures of commands that ran with no run, whose log would otherwise take them.
  readonly lateFailures: string;

  // The reuse record of uploaded evidence links.
  readonly uploads: string;
}

export function buildStatePaths(stateDir: string): StatePaths {
  return {
    root: stateDir,
    state: join(stateDir, 'state.json'),
    locks: join(stateDir, 'locks'),
    runs: join(stateDir, 'runs'),
    lateFailures: join(stateDir, 'late-failures.ndjson'),
    uploads: join(stateDir, 'uploads.json'),
  };
}

export interface RunPaths {
  readonly directory: string;
  readonly manifest: string;
  readonly log: string;
  readonly socket: string;
  readonly supervisorLog: string;
  readonly streams: string;
  readonly children: string;
  readonly features: string;

  // The collected secrets of the run, one JSON object per line, outside `features`.
  readonly secrets: string;

  // The lock every writer of the run's log and manifest holds.
  readonly lock: string;
}

export function buildRunPaths(stateDir: string, runID: RunID): RunPaths {
  const statePaths = buildStatePaths(stateDir);
  const directory = join(statePaths.runs, runID);

  return {
    lock: join(statePaths.locks, `run-${runID}.lock`),
    directory,
    manifest: join(directory, 'manifest.json'),
    log: join(directory, 'log.ndjson'),
    socket: join(directory, 'supervisor', 'sock'),
    supervisorLog: join(directory, 'supervisor.log'),
    streams: join(directory, 'streams'),
    children: join(directory, 'children'),
    features: join(directory, 'features'),
    secrets: join(directory, 'secrets.ndjson'),
  };
}
