import { dirname } from 'node:path';
import { withFileLock } from '@zgeoff/std/with-file-lock';
import { match } from 'ts-pattern';
import { createDirectory } from './create-directory.ts';
import { WringerError } from './wringer-error.ts';

// Runs `work` while this process holds the lock at `path`, waiting up to `waitMs` for another
// holder to let go. The kernel drops the lock when its holder exits, a crash included.
export async function withStateLock<Value>(
  path: string,
  waitMs: number,
  work: () => Promise<Value>,
): Promise<Value> {
  await createDirectory(dirname(path));

  const result = await withFileLock(path, work, { waitMs });

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
