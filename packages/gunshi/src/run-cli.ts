import { dispatch, supervisorCommandName } from '@wringer/core';
import type {
  PullRequestHost,
  RepoHost,
  StatePort,
  SupervisorPort,
  Wringer,
  WringerError,
} from '@wringer/core';
import { parseArgs } from 'gunshi';
import type { Invocation } from './build-gunshi-commands.ts';
import { pickCLIOutcome } from './pick-cli-outcome.ts';
import { pickDispatchPlan } from './pick-dispatch-plan.ts';
import { pickOutputMode } from './pick-output-mode.ts';
import type { OutputMode } from './pick-output-mode.ts';
import { renderEnvelope } from './render-envelope.ts';
import { renderHumanEvent } from './render-human-event.ts';
import { resolveInvocation } from './resolve-invocation.ts';
import { scrubParsedInvocation } from './scrub-parsed-invocation.ts';

interface RepoPorts {
  readonly state: StatePort;
  readonly repoHost: RepoHost;
  readonly pullRequests: PullRequestHost;
  readonly supervisor: SupervisorPort;
}

export interface CLIPorts {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly isTTY: boolean;
  readonly isAgent: boolean;

  // The process environment, whose secret-looking values every command scrubs from what it writes.
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly writeStdout: (text: string) => void;
  readonly readRepoRoot: (cwd: string) => Promise<string | WringerError>;
  readonly openRepo: (root: string) => RepoPorts;
  readonly runSupervisor: (wringer: Wringer, argv: readonly string[]) => Promise<void>;
}

// Every invocation ends in one envelope and an exit code, whatever failed: gunshi's parse, the
// repo root, or the command. The hidden supervisor command is the exception: it writes no envelope.
export async function runCLI(wringer: Wringer, ports: CLIPorts): Promise<number> {
  const [first, ...rest] = ports.argv;

  if (first === supervisorCommandName) {
    await ports.runSupervisor(wringer, rest);

    return 0;
  }

  const tokens = parseArgs([...ports.argv]);
  const mode = pickOutputMode({ tokens, isTTY: ports.isTTY, isAgent: ports.isAgent });

  const resolved = await resolveInvocation(wringer, ports.argv);

  const parsed = scrubParsedInvocation(resolved, wringer, ports.env);
  const outcome = pickCLIOutcome(parsed, mode);

  if (outcome.kind === 'dispatch') {
    return dispatchInvocation(wringer, ports, mode, outcome.invocation);
  }

  ports.writeStdout(outcome.text);

  return outcome.exitCode;
}

async function dispatchInvocation(
  wringer: Wringer,
  ports: CLIPorts,
  mode: OutputMode,
  invocation: Invocation,
): Promise<number> {
  const root = await ports.readRepoRoot(ports.cwd);

  const plan = pickDispatchPlan(invocation, root);

  if (plan.kind === 'refuse') {
    ports.writeStdout(renderEnvelope(plan.envelope, mode));

    return plan.exitCode;
  }

  const repo = ports.openRepo(plan.root);

  const result = await dispatch(wringer, invocation.path, invocation.raw, {
    root: plan.root,
    state: repo.state,
    repoHost: repo.repoHost,
    pullRequests: repo.pullRequests,
    supervisor: repo.supervisor,
    env: ports.env,
    target: invocation.globals.target,
    feature: invocation.globals.feature,
    timeoutMs: invocation.globals.timeoutMs,
    output: {
      writeLine: (line) => {
        const text = mode === 'json' ? `${line}\n` : renderHumanEvent(line);

        ports.writeStdout(text);
      },
    },
  });

  ports.writeStdout(renderEnvelope(result.envelope, mode));

  return result.exitCode;
}
