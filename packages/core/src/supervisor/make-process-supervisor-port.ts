import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { buildRunPaths } from '../state/build-state-paths.ts';
import type { SupervisorExit, SupervisorPort } from '../types.ts';
import { WringerError } from '../wringer-error.ts';
import { callSupervisor } from './call-supervisor.ts';
import { buildSupervisorArgv } from './supervisor-request.ts';

export interface ProcessSupervisorOptions {
  readonly selfCommand: readonly string[];
  readonly root: string;
  readonly stateDir: string;
}

// The supervisor is the repo's own CLI started again with a hidden command, detached in its own
// process group, so it outlives the command that started it and loads the same registry. Calls
// reach it over its Unix socket.
export function makeProcessSupervisorPort(options: ProcessSupervisorOptions): SupervisorPort {
  const exits = new Map<string, Promise<SupervisorExit>>();

  return {
    call: callSupervisor,
    watchExit: (runID) => exits.get(runID) ?? new Promise<SupervisorExit>(() => {}),
    start: (request) => {
      const paths = buildRunPaths(join(options.root, options.stateDir), request.runID);

      mkdirSync(paths.directory, { recursive: true });

      const log = openSync(paths.supervisorLog, 'a');
      const [command = 'bun', ...args] = options.selfCommand;
      const started = Promise.withResolvers<void>();
      const exited = Promise.withResolvers<SupervisorExit>();

      exits.set(request.runID, exited.promise);

      const child = spawn(
        command,
        [
          ...args,
          ...buildSupervisorArgv({
            runID: request.runID,
            target: request.target,
            root: options.root,
          }),
        ],
        { cwd: options.root, detached: true, stdio: ['ignore', log, log] },
      );

      // A command that cannot start, such as one missing from the PATH, fails after spawn returns.
      child.once('spawn', () => {
        started.resolve();
      });

      child.once('exit', (code, signal) => {
        exited.resolve({ code, signal });
      });

      child.once('error', (error) => {
        started.reject(
          new WringerError('environment', {
            message: `The supervisor did not start: ${error.message}`,
            hint: `Check that ${command} runs from ${options.root}.`,
          }),
        );
      });

      child.unref();

      closeSync(log);

      return started.promise;
    },
  };
}
