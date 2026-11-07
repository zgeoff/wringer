import type { Access, Host } from './host.ts';
import type { DriverExec, RepoExec } from './types.ts';
import { WringerError } from './wringer-error.ts';

export interface FencedExecOptions {
  readonly host: Host;
  readonly access: Access;
  readonly hint: string;
  readonly signal: AbortSignal;
}

// Repo code has no way to mark a raw exec as a read, so a read-only target refuses every one. A
// driver states the effect of each of its own execs.
export function makeRepoExec(options: FencedExecOptions): RepoExec {
  return (argv, execOptions) => {
    if (options.access === 'read-only') {
      return Promise.reject(
        new WringerError('read-only', {
          message: `Raw exec of ${argv[0] ?? 'a command'} is refused on a read-only target.`,
          hint: options.hint,
        }),
      );
    }

    return options.host.run({
      argv,
      access: options.access,
      stdin: execOptions?.stdin,
      signal: options.signal,
    });
  };
}

export function makeDriverExec(options: FencedExecOptions): DriverExec {
  return (argv, effect, execOptions) => {
    if (options.access === 'read-only' && effect !== 'read') {
      return Promise.reject(
        new WringerError('read-only', {
          message: `${argv[0] ?? 'A command'} is a write, and the target is read-only.`,
          hint: options.hint,
        }),
      );
    }

    return options.host.run({
      argv,
      access: options.access,
      stdin: execOptions?.stdin,
      signal: options.signal,
    });
  };
}
