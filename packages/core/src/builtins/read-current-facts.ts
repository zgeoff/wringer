import { buildChangeFactsRequest } from '../change-facts/build-change-request.ts';
import { readChangeFacts } from '../change-facts/read-change-facts.ts';
import type { ChangeFacts } from '../change-facts/read-change-facts.ts';
import type { BuiltinContext } from '../types.ts';

// The change facts of the worktree against a base: its fingerprint, and each feature's.
export function readCurrentFacts(ctx: BuiltinContext, base: string): Promise<ChangeFacts> {
  return readChangeFacts(
    ctx.session.repoHost,
    buildChangeFactsRequest(ctx.wringer, ctx.session.root, base),
  );
}
