import type { FileLockResult } from '@zgeoff/std/with-file-lock';
import { match } from 'ts-pattern';
import { WringerError } from './wringer-error.ts';

// The value the locked work returned, or an environment error when another holder kept the lock
// at `path` past the wait.
export function getLockValue<Value>(path: string, result: FileLockResult<Value>): Value {
  return match(result)
    .with({ kind: 'ran' }, (ran) => ran.value)
    .with({ kind: 'busy' }, () => {
      throw new WringerError('environment', {
        message: `Another wringer command holds the lock ${path}.`,
        hint: 'Wait for the other command to end, then run this one again.',
      });
    })
    .exhaustive();
}
