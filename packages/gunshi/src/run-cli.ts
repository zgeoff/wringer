import {
  WringerError,
  buildEnvelope,
  dispatch,
  exitCodeFor,
  makeProcessSupervisorStarter,
  runSupervisorProcess,
  supervisorCommandName,
} from '@wringer/core';
import type { Envelope, Wringer } from '@wringer/core';
import { cli } from 'gunshi';
import { buildGunshiCommands } from './build-gunshi-commands.ts';
import type { Invocation } from './build-gunshi-commands.ts';
import { pickOutputMode } from './pick-output-mode.ts';
import type { OutputMode } from './pick-output-mode.ts';
import { readRepoRoot } from './read-repo-root.ts';
import { renderHumanEnvelope } from './render-human-envelope.ts';
import { renderHumanEvent } from './render-human-event.ts';

export interface CLIPorts {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly isTTY: boolean;
  readonly isAgent: boolean;
  readonly selfCommand: readonly string[];
  readonly writeStdout: (text: string) => void;
}

// Every invocation ends in one envelope and an exit code, whatever failed: gunshi's parse, the
// repo root, or the command. The hidden supervisor command is the exception: it writes no envelope.
export async function runCLI(wringer: Wringer, ports: CLIPorts): Promise<number> {
  const [first, ...rest] = ports.argv;

  if (first === supervisorCommandName) {
    await runSupervisorProcess(wringer, rest);

    return 0;
  }

  const mode = pickOutputMode(ports);

  const parsed = await readInvocation(wringer, ports);

  if (parsed.kind === 'printed') {
    ports.writeStdout(parsed.text);

    return 0;
  }

  if (parsed.kind === 'failed') {
    writeEnvelope(ports, mode, buildFailureEnvelope(parsed.command, parsed.error));

    return exitCodeFor[parsed.error.code];
  }

  return dispatchInvocation(wringer, ports, mode, parsed.invocation);
}

type ParsedInvocation =
  | { readonly kind: 'invoked'; readonly invocation: Invocation }
  | { readonly kind: 'printed'; readonly text: string }
  | { readonly kind: 'failed'; readonly command: string; readonly error: WringerError };

// gunshi only records the invocation; the command runs after `cli` returns, so a gunshi parse error
// and a command error never mix.
async function readInvocation(wringer: Wringer, ports: CLIPorts): Promise<ParsedInvocation> {
  let invocation: Invocation | null = null;

  const subCommands = buildGunshiCommands(wringer, (invoked) => {
    invocation = invoked;
  });

  const command = buildCommandName(ports.argv);

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
      },
    );

    if (invocation !== null) {
      return { kind: 'invoked', invocation };
    }

    return { kind: 'printed', text: `${printed ?? ''}\n` };
  } catch (error) {
    return { kind: 'failed', command, error: toUsageError(error) };
  }
}

function buildCommandName(argv: readonly string[]): string {
  const words = argv.filter((word) => !word.startsWith('-'));

  return words.length === 0 ? 'help' : words.join('.');
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

function writeEnvelope(ports: CLIPorts, mode: OutputMode, envelope: Envelope): void {
  const text = mode === 'json' ? `${JSON.stringify(envelope)}\n` : renderHumanEnvelope(envelope);

  ports.writeStdout(text);
}

function buildFailureEnvelope(command: string, error: WringerError): Envelope {
  return buildEnvelope({
    command,
    target: null,
    instance: null,
    feature: null,
    sha: null,
    durationMs: 0,
    data: null,
    evidence: [],
    cursors: {},
    truncatedPath: null,
    error,
  });
}

async function dispatchInvocation(
  wringer: Wringer,
  ports: CLIPorts,
  mode: OutputMode,
  invocation: Invocation,
): Promise<number> {
  const root = await readRepoRoot(ports.cwd);

  if (root instanceof WringerError) {
    writeEnvelope(ports, mode, buildFailureEnvelope(invocation.path.join('.'), root));

    return exitCodeFor[root.code];
  }

  const result = await dispatch(wringer, invocation.path, invocation.raw, {
    root,
    target: invocation.globals.target,
    feature: invocation.globals.feature,
    timeoutMs: invocation.globals.timeoutMs,
    output: {
      writeLine: (line) => {
        const text = mode === 'json' ? `${line}\n` : renderHumanEvent(line);

        ports.writeStdout(text);
      },
    },
    supervisor: makeProcessSupervisorStarter({
      selfCommand: ports.selfCommand,
      root,
      stateDir: wringer.stateDir,
    }),
  });

  writeEnvelope(ports, mode, result.envelope);

  return result.exitCode;
}
