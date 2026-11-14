import { WringerError, exitCodeFor } from '@wringer/core';
import type { Envelope } from '@wringer/core';
import type { Invocation } from '../gunshi-commands/build-gunshi-commands.ts';
import { buildFailureEnvelope } from '../output/build-failure-envelope.ts';

export type DispatchPlan =
  | { readonly kind: 'refuse'; readonly envelope: Envelope; readonly exitCode: number }
  | { readonly kind: 'dispatch'; readonly root: string; readonly invocation: Invocation };

// A command runs only inside a repo; outside one, the invocation ends in the root's error.
export function pickDispatchPlan(
  invocation: Invocation,
  root: string | WringerError,
): DispatchPlan {
  if (root instanceof WringerError) {
    return {
      kind: 'refuse',
      envelope: buildFailureEnvelope(invocation.path.join('.'), root),
      exitCode: exitCodeFor[root.code],
    };
  }

  return { kind: 'dispatch', root, invocation };
}
