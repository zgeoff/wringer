import { onTestFinished } from 'bun:test';
import { readLaunchHost } from '../launch/read-launch-host.ts';
import { createNodeRepoHost } from '../repo-host/create-node-repo-host.ts';
import type { StatePort } from '../state/create-file-state.ts';
import { createRepoState } from '../state/create-repo-state.ts';
import { callSupervisor } from '../supervisor/call-supervisor.ts';
import { runSupervisor } from '../supervisor/run-supervisor.ts';
import { supervisorServiceName } from '../supervisor/supervisor-request.ts';
import type { Session, Wringer } from '../types.ts';
import { createFakePullRequestHost } from './create-fake-pull-request-host.ts';
import { createTestRepo } from './create-test-repo.ts';
import type { TestRepo } from './create-test-repo.ts';

export interface TestSession {
  readonly repo: TestRepo;
  readonly session: Session;
  readonly state: StatePort;
  readonly lines: readonly string[];
}

export interface TestSessionOptions {
  readonly parent: string;
  readonly wringer: Wringer;

  // The process environment of the commands and of the supervisors; empty when omitted.
  readonly env?: Readonly<Record<string, string | undefined>>;
}

// A test repo and a session whose supervisors run inside the test process, so a test drives the
// real supervisor and socket without starting the CLI. One cleanup stops every run the test started,
// then removes the repo, so no supervisor writes into a removed folder.
export async function createTestSession(options: TestSessionOptions): Promise<TestSession> {
  const repo = await createTestRepo(options.parent);

  const lines: string[] = [];
  const supervisors: Promise<void>[] = [];
  const runIDs: string[] = [];
  const state = createRepoState(repo.root, options.wringer.stateDir);

  onTestFinished(async () => {
    const views = await Promise.all(runIDs.map((runID) => state.readRun(runID)));

    await Promise.allSettled(
      views.flatMap((view) =>
        view?.supervisor === null || view === undefined
          ? []
          : [
              callSupervisor({
                socket: view.supervisor.socket,
                request: { service: supervisorServiceName, method: 'stop', args: null },
                signal: AbortSignal.timeout(5000),
              }),
            ],
      ),
    );

    await Promise.allSettled(supervisors);
    await repo.remove();
  });

  return {
    repo,
    state,
    lines,
    session: {
      root: repo.root,
      state,
      repoHost: createNodeRepoHost(),
      pullRequests: createFakePullRequestHost([]),
      env: options.env ?? {},
      output: {
        writeLine: (line) => {
          lines.push(line);
        },
      },
      supervisor: {
        call: callSupervisor,
        start: (request) => {
          runIDs.push(request.runID);

          supervisors.push(
            runSupervisor({
              wringer: options.wringer,
              launchHost: { ...readLaunchHost(), env: { ...readLaunchHost().env, ...options.env } },
              state,
              runID: request.runID,
              target: request.target,
              readyTimeoutMs: 5000,
              stopWaitMs: 5000,
              now: () => new Date(),
              reportError: (message) => {
                lines.push(message);
              },
            }),
          );

          return Promise.resolve();
        },
      },
    },
  };
}
