import type { DriverExec } from '../types.ts';
import { WringerError } from '../wringer-error.ts';
import type { FencedExecOptions } from './make-repo-exec.ts';

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
