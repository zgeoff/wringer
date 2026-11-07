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

export function ssh(options: SSHOptions): Host {
  return {
    kind: 'ssh',
    run: async (request) => {
      const user = request.access === 'read-only' ? options.readOnlyUser : undefined;

      const result = await runProcess({
        argv: buildSSHArgv({
          binary: options.binary ?? 'ssh',
          destination: options.destination,
          user,
          remote: buildRemoteCommand(request.argv, options.prefix ?? []),
        }),
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
