import { buildChangeFactsRequest } from '../change-facts/build-change-request.ts';
import { readChangeFacts } from '../change-facts/read-change-facts.ts';
import type { ChangeFacts } from '../change-facts/read-change-facts.ts';
import type { BuiltinContext, Wringer } from '../types.ts';

// The change facts of the worktree against a base: its fingerprint, and each feature's. `wringer`
// is the registry with each feature's files resolved.
export function readCurrentFacts(
  ctx: BuiltinContext,
  wringer: Wringer,
  base: string,
): Promise<ChangeFacts> {
  return readChangeFacts(
    ctx.session.repoHost,
    buildChangeFactsRequest(wringer, ctx.session.root, base),
  );
}
