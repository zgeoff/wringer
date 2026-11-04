import { buildSpawnError } from './build-spawn-error.ts';
import { killProcessGroup } from './kill-process-group.ts';
import { readStreamLines } from './read-stream-lines.ts';
import { WringerError } from './wringer-error.ts';

export interface FollowProcessRequest {
  readonly argv: readonly string[];
  readonly signal: AbortSignal;
  readonly onLine: (line: string) => void;
}

// The command runs in a process group of its own, and the signal kills the whole group: a child
// the command started, such as a `sleep` under `sh -c`, would otherwise keep stdout open, and the
// follow would never end.
export async function followProcess(request: FollowProcessRequest): Promise<number> {
  const [command] = request.argv;
  const executable = resolveExecutable(command);

  const plan = pickFollowPlan({
    argv: request.argv,
    executable,
    aborted: request.signal.aborted,
  });

  if (plan instanceof WringerError) {
    throw plan;
  }

  if (!plan.start) {
    return 0;
  }

  const child = spawnFollowed(plan.argv);

  const killGroup = (): void => {
    killProcessGroup(child.pid);
  };

  request.signal.addEventListener('abort', killGroup, { once: true });

  // A child the command left behind is killed as the command exits: it may hold stdout open, and
  // nothing could stop it once the abort is unwired. A reader or callback that throws stops the
  // group too, so nothing runs on unread.
  const watchExit = async (): Promise<number> => {
    const exitCode = await child.exited;

    killGroup();

    return exitCode;
  };

  const exited = watchExit();

  try {
    for await (const line of readStreamLines(child.stdout)) {
      request.onLine(line);
    }

    return await exited;
  } catch (error) {
    killGroup();

    await child.exited;

    throw error;
  } finally {
    request.signal.removeEventListener('abort', killGroup);
  }
}

function resolveExecutable(command: string | undefined): string | null {
  if (command === undefined) {
    return null;
  }

  return Bun.which(command);
}

interface FollowPlanInput {
  readonly argv: readonly string[];
  readonly executable: string | null;
  readonly aborted: boolean;
}

type FollowPlan =
  | { readonly start: false }
  | { readonly start: true; readonly argv: readonly string[] };

function pickFollowPlan(input: FollowPlanInput): FollowPlan | WringerError {
  const [command, ...args] = input.argv;

  if (command === undefined) {
    return new WringerError('usage', { message: 'A follow needs a command.' });
  }

  if (input.executable === null) {
    return new WringerError('environment', {
      message: `The command ${command} is not on the PATH.`,
      hint: `Install ${command}, or put it on the PATH.`,
    });
  }

  if (input.aborted) {
    return { start: false };
  }

  return { start: true, argv: [input.executable, ...args] };
}

function spawnFollowed(argv: readonly string[]) {
  try {
    return Bun.spawn([...argv], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
      detached: true,
    });
  } catch (error) {
    throw buildSpawnError(argv.join(' '), error);
  }
}
