import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { buildRunPaths } from './build-state-paths.ts';
import { supervisorCommandName } from './supervisor-protocol.ts';
import type { SupervisorStarter } from './types.ts';

export interface ProcessSupervisorOptions {
  readonly selfCommand: readonly string[];
  readonly root: string;
  readonly stateDir: string;
}

// The supervisor is the repo's own CLI started again with a hidden command, detached in its own
// process group, so it outlives the command that started it and loads the same registry.
export function makeProcessSupervisorStarter(options: ProcessSupervisorOptions): SupervisorStarter {
  return {
    start: (request) => {
      const paths = buildRunPaths(join(options.root, options.stateDir), request.runID);

      mkdirSync(paths.directory, { recursive: true });

      const log = openSync(paths.supervisorLog, 'a');
      const [command = 'bun', ...args] = options.selfCommand;

      const child = spawn(
        command,
        [...args, supervisorCommandName, request.runID, request.target, options.root],
        { cwd: options.root, detached: true, stdio: ['ignore', log, log] },
      );

      child.unref();

      closeSync(log);

      return Promise.resolve();
    },
  };
}
