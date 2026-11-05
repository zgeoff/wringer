import { join } from 'node:path';
import type { RunID } from './run-events.ts';

export interface StatePaths {
  readonly root: string;
  readonly state: string;
  readonly locks: string;
  readonly runs: string;

  // The late failures of commands that ran with no run, whose log would otherwise take them.
  readonly lateFailures: string;
}

export function buildStatePaths(stateDir: string): StatePaths {
  return {
    root: stateDir,
    state: join(stateDir, 'state.json'),
    locks: join(stateDir, 'locks'),
    runs: join(stateDir, 'runs'),
    lateFailures: join(stateDir, 'late-failures.ndjson'),
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
}

export function buildRunPaths(stateDir: string, runID: RunID): RunPaths {
  const directory = join(buildStatePaths(stateDir).runs, runID);

  return {
    directory,
    manifest: join(directory, 'manifest.json'),
    log: join(directory, 'log.ndjson'),
    socket: join(directory, 'supervisor', 'sock'),
    supervisorLog: join(directory, 'supervisor.log'),
    streams: join(directory, 'streams'),
    children: join(directory, 'children'),
    features: join(directory, 'features'),
  };
}
