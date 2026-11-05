import { buildSpawnError } from './build-spawn-error.ts';
import { killProcessGroup } from './kill-process-group.ts';
import { WringerError } from './wringer-error.ts';

export interface ProcessRequest {
  readonly argv: readonly string[];
  readonly cwd?: string | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly stdin?: string | Uint8Array | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export async function runProcess(request: ProcessRequest): Promise<ProcessResult> {
  const result = await runProcessBytes(request);

  return { ...result, stdout: new TextDecoder().decode(result.stdout) };
}

export interface ProcessBytesResult {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

// Keeps stdout as the bytes the command wrote, for output that must reach another command unchanged.
export async function runProcessBytes(request: ProcessRequest): Promise<ProcessBytesResult> {
  const env = { ...process.env, ...request.env };
  const cwd = request.cwd ?? process.cwd();
  const [command] = request.argv;
  const executable = resolveExecutable(command, { PATH: env['PATH'] ?? '', cwd });

  const plan = pickProcessPlan({
    argv: request.argv,
    executable,
    aborted: hasAborted(request.signal),
  });

  if (plan instanceof WringerError) {
    throw plan;
  }

  const child = startProcess(plan, { cwd, env, stdin: request.stdin });

  const killGroup = (): void => {
    killProcessGroup(child.pid);
  };

  request.signal?.addEventListener('abort', killGroup, { once: true });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).bytes(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  request.signal?.removeEventListener('abort', killGroup);

  const outcome = pickProcessOutcome({
    command: plan.command,
    aborted: hasAborted(request.signal),
    result: { exitCode, stdout, stderr },
  });

  if (outcome instanceof WringerError) {
    throw outcome;
  }

  return outcome;
}

interface ExecutableSearch {
  readonly PATH: string;
  readonly cwd: string;
}

// Bun.which resolves a relative command against the folder it is given, so it must be the folder
// the command runs in.
function resolveExecutable(command: string | undefined, search: ExecutableSearch): string | null {
  if (command === undefined) {
    return null;
  }

  return Bun.which(command, search);
}

interface ProcessPlanInput {
  readonly argv: readonly string[];
  readonly executable: string | null;
  readonly aborted: boolean;
}

interface ProcessPlan {
  readonly command: string;
  readonly argv: readonly string[];
}

function pickProcessPlan(input: ProcessPlanInput): ProcessPlan | WringerError {
  const [command, ...args] = input.argv;

  if (command === undefined) {
    return new WringerError('usage', { message: 'An exec needs a command.' });
  }

  if (input.executable === null) {
    return new WringerError('environment', {
      message: `The command ${command} is not on the PATH.`,
      hint: `Install ${command}, or put it on the PATH.`,
    });
  }

  // Bun.spawn throws a plain AbortError on a signal that has already fired.
  if (input.aborted) {
    return new WringerError('timeout', {
      message: `${command} did not start: its deadline had passed.`,
    });
  }

  return { command, argv: [input.executable, ...args] };
}

function hasAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

interface StartOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdin?: string | Uint8Array | undefined;
}

// The command runs in a process group of its own, so the deadline also stops a child it started,
// which would otherwise hold the output pipes open past the deadline.
function startProcess(plan: ProcessPlan, options: StartOptions) {
  try {
    return Bun.spawn([...plan.argv], {
      cwd: options.cwd,
      env: { ...options.env },
      stdin: options.stdin === undefined ? 'ignore' : Buffer.from(options.stdin),
      stdout: 'pipe',
      stderr: 'pipe',
      detached: true,
    });
  } catch (error) {
    throw buildSpawnError(plan.command, error);
  }
}

interface ProcessOutcomeInput {
  readonly command: string;
  readonly aborted: boolean;
  readonly result: ProcessBytesResult;
}

function pickProcessOutcome(input: ProcessOutcomeInput): ProcessBytesResult | WringerError {
  if (input.aborted) {
    return new WringerError('timeout', {
      message: `${input.command} ran past its deadline and was stopped.`,
    });
  }

  return input.result;
}
