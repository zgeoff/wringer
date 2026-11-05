import { randomUUID } from 'node:crypto';
import type { Host } from './host.ts';
import { quoteShellWord } from './quote-shell-word.ts';
import { runProcess } from './run-process.ts';
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

      const stops: Promise<unknown>[] = [];

      const stopRemote = (): void => {
        stops.push(
          sendRemote(buildGroupStopArgv(groupFile), { signal: AbortSignal.timeout(stopTimeoutMs) }),
        );
      };

      request.signal?.addEventListener('abort', stopRemote, { once: true });

      try {
        const result = await sendRemote(buildGroupedArgv(request.argv, groupFile), {
          stdin: request.stdin,
          signal: request.signal,
        });

        if (result.exitCode === sshConnectionFailedExitCode) {
          throw new WringerError('environment', {
            message: `ssh could not reach ${options.destination}: ${result.stderr.trim()}`,
            hint: 'Check that the host is up and that ssh logs in without a prompt.',
          });
        }

        return result;
      } finally {
        request.signal?.removeEventListener('abort', stopRemote);

        await Promise.allSettled(stops);
      }
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

// An abort can land before the remote command has recorded its group, so the stop waits up to 2 s
// for the file. It sends SIGINT first, so a client such as psql cancels its query on the server,
// then SIGTERM to whatever of the group is still running 2 s later. dash's `kill` refuses `--`.
const groupStopScript = [
  'i=0',
  'while [ ! -f "$1" ] && [ "$i" -lt 20 ]; do sleep 0.1; i=$((i + 1)); done',
  'group=$(cat "$1" 2>/dev/null) || exit 0',
  'kill -INT "-$group" 2>/dev/null',
  'i=0',
  'while kill -0 "-$group" 2>/dev/null && [ "$i" -lt 20 ]; do sleep 0.1; i=$((i + 1)); done',
  'kill -TERM "-$group" 2>/dev/null',
  'rm -f "$1"',
].join('; ');

function buildGroupStopArgv(groupFile: string): readonly string[] {
  return ['sh', '-c', groupStopScript, 'wringer', groupFile];
}

// Killing the local ssh leaves the remote command running, so a timed-out write could still
// commit. The remote command runs in a process group of its own, under `setsid` so no terminal is
// needed, and records the group in `groupFile`; stdin reaches it through fd 3.
const groupedScript = [
  'exec 3<&0',
  'setsid sh -c "$2" <&3 3<&- & child=$!',
  'exec 3<&-',
  'echo "$child" > "$1"',
  'wait "$child"',
  'status=$?',
  'rm -f "$1"',
  'exit "$status"',
].join('; ');

function buildGroupedArgv(argv: readonly string[], groupFile: string): readonly string[] {
  return ['sh', '-c', groupedScript, 'wringer', groupFile, joinShellWords(argv)];
}
