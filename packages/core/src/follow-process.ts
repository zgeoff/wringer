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
  const [command, ...args] = request.argv;

  if (command === undefined) {
    throw new WringerError('usage', { message: 'A follow needs a command.' });
  }

  const executable = Bun.which(command);

  if (executable === null) {
    throw new WringerError('environment', {
      message: `The command ${command} is not on the PATH.`,
      hint: `Install ${command}, or put it on the PATH.`,
    });
  }

  if (request.signal.aborted) {
    return 0;
  }

  const child = Bun.spawn([executable, ...args], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
    detached: true,
  });

  const killGroup = (): void => {
    killProcessGroup(child.pid);
  };

  request.signal.addEventListener('abort', killGroup, { once: true });

  for await (const line of readStreamLines(child.stdout)) {
    request.onLine(line);
  }

  request.signal.removeEventListener('abort', killGroup);

  return child.exited;
}
