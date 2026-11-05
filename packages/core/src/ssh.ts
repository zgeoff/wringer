import { randomUUID } from 'node:crypto';
import { findRemoteStopFailure } from './find-remote-stop-failure.ts';
import type { Host } from './host.ts';
import { quoteShellWord } from './quote-shell-word.ts';
import { runProcess } from './run-process.ts';
import type { ProcessResult } from './run-process.ts';
import { toWringerError } from './to-wringer-error.ts';
import { WringerError } from './wringer-error.ts';

export interface PrefixLayer {
  readonly argv: readonly string[];

  // `true` when this layer hands the rest of the command to a shell as one string, such as
  // `sh -c` or `docker exec <container> sh -c`.
  readonly shell: boolean;
}

export interface SSHOptions {
  readonly destination: string;
  readonly readOnlyUser?: string;
  readonly prefix?: readonly PrefixLayer[];
  readonly binary?: string;
}

// ssh exits 255 when it fails to connect or log in; any other code is the remote command's.
const sshConnectionFailedExitCode = 255;
const stopTimeoutMs = 10_000;

interface RemoteIO {
  readonly stdin?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export function ssh(options: SSHOptions): Host {
  return {
    kind: 'ssh',
    run: async (request) => {
      const user = request.access === 'read-only' ? options.readOnlyUser : undefined;
      const prefix = options.prefix ?? [];
      const groupFile = `/tmp/wringer-${randomUUID()}.pgid`;

      const sendRemote = (argv: readonly string[], io: RemoteIO) =>
        runProcess({
          argv: buildSSHArgv({
            binary: options.binary ?? 'ssh',
            destination: options.destination,
            user,
            remote: buildRemoteCommand(argv, prefix),
          }),
          ...io,
        });

      const stops: Promise<ProcessResult>[] = [];

      const stopRemote = (): void => {
        stops.push(
          sendRemote(buildGroupStopArgv(groupFile), { signal: AbortSignal.timeout(stopTimeoutMs) }),
        );
      };

      request.signal?.addEventListener('abort', stopRemote, { once: true });

      const running = sendRemote(buildGroupedArgv(request.argv, groupFile), {
        stdin: request.stdin,
        signal: request.signal,
      });

      const [ran] = await Promise.allSettled([running]);

      request.signal?.removeEventListener('abort', stopRemote);

      const stopped = await Promise.allSettled(stops);

      const stopFailure = findRemoteStopFailure(stopped);

      // A stop that failed can leave the remote command running, so the caller hears of it.
      if (ran.status === 'rejected') {
        const failure = toWringerError(ran.reason);

        throw stopFailure === null
          ? failure
          : new WringerError(failure.code, {
              message: `${failure.message} The remote command may still run: ${stopFailure}`,
              hint: `Check ${options.destination} for the command, and stop it by hand.`,
            });
      }

      if (ran.value.exitCode === sshConnectionFailedExitCode) {
        throw new WringerError('environment', {
          message: `ssh could not reach ${options.destination}: ${ran.value.stderr.trim()}`,
          hint: 'Check that the host is up and that ssh logs in without a prompt.',
        });
      }

      return ran.value;
    },
  };
}

interface SSHArgvInput {
  readonly binary: string;
  readonly destination: string;
  readonly user: string | undefined;
  readonly remote: string;
}

function buildSSHArgv(input: SSHArgvInput): readonly string[] {
  const login = input.user === undefined ? [] : ['-l', input.user];

  return [input.binary, '-o', 'BatchMode=yes', ...login, '--', input.destination, input.remote];
}

// ssh hands its command to the remote login shell, so the outermost layer always parses through a
// shell. Each prefix layer with `shell: true` parses its rest once more, so the rest is quoted once
// more, from the innermost layer out.
function buildRemoteCommand(argv: readonly string[], prefix: readonly PrefixLayer[]): string {
  let words = argv;

  for (const layer of prefix.toReversed()) {
    words = layer.shell ? [...layer.argv, joinShellWords(words)] : [...layer.argv, ...words];
  }

  return joinShellWords(words);
}

function joinShellWords(words: readonly string[]): string {
  return words.map((word) => quoteShellWord(word)).join(' ');
}

// An abort can land before the remote command records its group, so the stop waits 2 s for the
// file. SIGINT goes first, so psql cancels its query on the server; SIGTERM and SIGKILL follow, each
// 1 s after the one before, to what still runs. dash's `kill` refuses `--`.
const groupStopScript = [
  'i=0',
  'while [ ! -f "$1" ] && [ "$i" -lt 20 ]; do sleep 0.1; i=$((i + 1)); done',
  'group=$(cat "$1" 2>/dev/null) || exit 0',
  'for signal in INT TERM KILL; do',
  '  kill -"$signal" "-$group" 2>/dev/null || break',
  '  i=0',
  '  while kill -0 "-$group" 2>/dev/null && [ "$i" -lt 10 ]; do sleep 0.1; i=$((i + 1)); done',
  'done',
  'rm -f "$1"',
].join('\n');

function buildGroupStopArgv(groupFile: string): readonly string[] {
  return ['sh', '-c', groupStopScript, 'wringer', groupFile];
}

// Killing the local ssh leaves the remote command running, so a timed-out write could still
// commit. The command runs in a process group of its own under `setsid`, which needs no terminal,
// and records the group in `groupFile` for the stop; stdin reaches it through fd 3.
const groupedScript = [
  'exec 3<&0',
  'setsid sh -c "$2" <&3 3<&- & child=$!',
  'exec 3<&-',
  'echo "$child" > "$1"',
  'wait "$child"',
  'status=$?',

  // A background process can hold ssh's output open after the command exits, so a watcher that
  // holds none of ssh's pipes keeps the file until the whole group has exited.
  '(while kill -0 "-$child" 2>/dev/null; do sleep 0.1; done; rm -f "$1") </dev/null >/dev/null 2>&1 &',
  'exit "$status"',
].join('\n');

function buildGroupedArgv(argv: readonly string[], groupFile: string): readonly string[] {
  return ['sh', '-c', groupedScript, 'wringer', groupFile, joinShellWords(argv)];
}
