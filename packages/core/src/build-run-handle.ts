import { join } from 'node:path';
import { buildRunPaths } from './build-state-paths.ts';
import type { RunHandle } from './types.ts';

export function buildRunHandle(stateDir: string, runID: string): RunHandle {
  const paths = buildRunPaths(stateDir, runID);

  return {
    id: runID,
    paths,
    childLog: (name) => ({ path: join(paths.children, `${name}.log`) }),
  };
}
