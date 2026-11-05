import { WringerError, dispatch, supervisorCommandName } from '@wringer/core';
import type { FingerprintHost, StatePort, SupervisorStarter, Wringer } from '@wringer/core';
import { cli, parseArgs } from 'gunshi';
import { buildGunshiCommands } from './build-gunshi-commands.ts';
import type { Invocation } from './build-gunshi-commands.ts';
import { pickCLIOutcome } from './pick-cli-outcome.ts';
import type { ParsedInvocation } from './pick-cli-outcome.ts';
import { pickCommandName } from './pick-command-name.ts';
import { pickDispatchPlan } from './pick-dispatch-plan.ts';
import { pickOutputMode } from './pick-output-mode.ts';
import type { OutputMode } from './pick-output-mode.ts';
import { renderEnvelope } from './render-envelope.ts';
import { renderHumanEvent } from './render-human-event.ts';
import { toInlineNegativeValues } from './to-inline-negative-values.ts';

interface RepoPorts {
  readonly state: StatePort;
  readonly fingerprintHost: FingerprintHost;
  readonly supervisor: SupervisorStarter;
}

export interface CLIPorts {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly isTTY: boolean;
  readonly isAgent: boolean;
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

  const argv = toInlineNegativeValues(ports.argv);

  const mode = pickOutputMode({
    tokens: parseArgs(argv),
    isTTY: ports.isTTY,
    isAgent: ports.isAgent,
  });

  const parsed = await readInvocation(wringer, { ...ports, argv });

  const outcome = pickCLIOutcome(parsed, mode);

  if (outcome.kind === 'dispatch') {
    return dispatchInvocation(wringer, ports, mode, outcome.invocation);
  }

  ports.writeStdout(outcome.text);

  return outcome.exitCode;
}

// gunshi only records the invocation; the command runs after `cli` returns, so a gunshi parse error
// and a command error never mix. gunshi resolves the command path before it checks the flags, so a
// flag error still names the command.
async function readInvocation(wringer: Wringer, ports: CLIPorts): Promise<ParsedInvocation> {
  let invocation: Invocation | null = null;
  let commandPath: readonly string[] = [];

  const subCommands = buildGunshiCommands(wringer, (invoked) => {
    invocation = invoked;
  });

  try {
    const printed = await cli(
      [...ports.argv],
      {
        name: wringer.name,
        run: () => {
          throw new WringerError('usage', {
            message: 'Name a command.',
            hint: `Run \`${wringer.name} --help\` to list them.`,
          });
        },
      },
      {
        name: wringer.name,
        subCommands,
        strict: true,
        usageSilent: true,
        renderHeader: null,
        renderValidationErrors: null,
        onBeforeCommand: (ctx) => {
          commandPath = ctx.commandPath;
        },
      },
    );

    if (invocation !== null) {
      return { kind: 'invoked', invocation };
    }

    return { kind: 'printed', text: `${printed ?? ''}\n` };
  } catch (error) {
    return {
      kind: 'failed',
      command: pickCommandName(commandPath, ports.argv),
      error: toUsageError(error),
    };
  }
}

// gunshi throws an AggregateError for a parse failure, with one error per problem.
function toUsageError(error: unknown): WringerError {
  if (error instanceof WringerError) {
    return error;
  }

  const problems = error instanceof AggregateError ? error.errors.map(String) : [String(error)];

  return new WringerError('usage', {
    message: problems.map((problem) => problem.replace(/^\w*Error: /u, '')).join(' '),
    hint: 'Add `--help` to the command to see its arguments.',
  });
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
    fingerprintHost: repo.fingerprintHost,
    supervisor: repo.supervisor,
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
