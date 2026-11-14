import { z } from 'zod';
import { WringerError } from '../wringer-error.ts';

const gitFailureSchema = z.object({ exitCode: z.number(), stderr: z.string() });

// `merge-base` exits 1 with nothing on stderr when the two share no commit, and also exits 1 when
// it cannot read an ancestor, with the read error on stderr. Only the first means no shared commit.
export function pickMergeBaseFailure(failure: unknown, noSharedCommit: WringerError): unknown {
  const data = failure instanceof WringerError ? failure.data : undefined;
  const parsed = gitFailureSchema.safeParse(data);

  return parsed.success && parsed.data.exitCode === 1 && parsed.data.stderr.trim() === ''
    ? noSharedCommit
    : failure;
}
